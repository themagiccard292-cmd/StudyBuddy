// Calls Google Gemini from the server. The API key lives in the GEMINI_API_KEY environment variable
// and is never sent to the browser.
import { HttpError } from "./http.js";
import { backupConfig, callBackup } from "./backup.js";

const MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";
const FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL || "gemini-3.5-flash-lite";
const endpoint = (model) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Read at call time so a host with a short request limit (Netlify) can lower them with environment variables.
const primaryTimeoutMs = () => Number(process.env.GEMINI_PRIMARY_TIMEOUT_MS) || 20_000;
const fallbackTimeoutMs = () => Number(process.env.GEMINI_FALLBACK_TIMEOUT_MS) || 40_000;
const COOL_OFF_MS = 120_000;
const GEMINI_DOWN_MS = 60_000;
let primaryCoolOffUntil = 0;
let geminiDownUntil = 0;

/** For tests: forget that Gemini (or its main model) was slow or unavailable. */
export const resetGeminiCooldown = () => {
  primaryCoolOffUntil = 0;
  geminiDownUntil = 0;
};

/** An upstream failure. `temporary` means worth skipping Gemini for a minute (busy, rate limited, timing out). */
const upstreamError = (message, temporary) => Object.assign(new HttpError(502, message), { temporary });

/**
 * Ask the AI. Gemini first (main model, then the lighter one); if that fails and a backup provider is configured
 * (see backup.js), the backup answers instead. After a temporary Gemini failure, later requests go straight to the
 * backup for a minute so students don't each wait through the same failure.
 */
export async function callGemini(opts) {
  const key = process.env.GEMINI_API_KEY;
  const backup = backupConfig();
  if (!key && !backup) throw new HttpError(503, "The AI isn't set up yet. The site owner needs to add a GEMINI_API_KEY.");

  let failure;
  if (key && !(backup && Date.now() < geminiDownUntil)) {
    try {
      return await callGeminiOnly(opts, key);
    } catch (e) {
      if (!backup || !(e instanceof HttpError) || e.status !== 502) throw e;
      failure = e;
      if (e.temporary) geminiDownUntil = Date.now() + GEMINI_DOWN_MS;
      console.warn("Gemini failed, using the backup AI:", e.message);
    }
  }
  if (!backup) throw failure ?? new HttpError(502, "The AI couldn't answer that. Please try again.");
  return callBackup(backup, opts);
}

async function callGeminiOnly({ system, messages, json = false, temperature = 0.7, maxOutputTokens = 8192 }, key) {
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: messages.map((m) => ({ role: m.role, parts: [{ text: m.text }] })),
    generationConfig: {
      temperature,
      maxOutputTokens,
      ...(json ? { responseMimeType: "application/json" } : {}),
      thinkingConfig: { thinkingLevel: "low" }, // keeps answers quick for a student who's waiting
    },
  };

  // The main model sometimes slows to a crawl or hits its quota. Give it a short leash, then fall back to the
  // lighter (much faster) model, and remember for a couple of minutes so later students skip the wait.
  const coolingDown = Date.now() < primaryCoolOffUntil;
  const plan = coolingDown ? [FALLBACK_MODEL, FALLBACK_MODEL] : [MODEL, FALLBACK_MODEL, FALLBACK_MODEL];
  let res = null;
  for (let i = 0; i < plan.length; i++) {
    const isPrimary = plan[i] === MODEL && !coolingDown && i === 0;
    try {
      res = await fetch(endpoint(plan[i]), {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(isPrimary ? primaryTimeoutMs() : fallbackTimeoutMs()),
      });
    } catch (e) {
      console.error("Gemini network error:", plan[i], e.message);
      res = null;
      if (isPrimary) primaryCoolOffUntil = Date.now() + COOL_OFF_MS;
      if (i === plan.length - 1) throw upstreamError("The AI took too long to answer. Please try again.", true);
      continue;
    }
    if (res.ok) break;
    const detail = (await res.text()).slice(0, 300);
    console.error("Gemini error", plan[i], res.status, detail);
    const temporary = [429, 500, 503].includes(res.status);
    if (isPrimary && temporary) primaryCoolOffUntil = Date.now() + COOL_OFF_MS;
    if (!temporary || i === plan.length - 1) {
      throw upstreamError(
        [429, 503].includes(res.status)
          ? "The AI is very busy right now. Try again in a minute."
          : "The AI couldn't answer that. Please try again.",
        temporary
      );
    }
    await sleep(500 * (i + 1));
  }
  if (!res || !res.ok) throw upstreamError("The AI couldn't answer that. Please try again.", false);

  const data = await res.json();
  const cand = data.candidates?.[0];
  const text = (cand?.content?.parts ?? []).map((p) => p.text ?? "").join("");
  if (!text.trim()) {
    console.error("Gemini empty response", cand?.finishReason);
    throw upstreamError("The AI didn't return an answer. Try rewording, or try again.", false);
  }
  return text;
}

function parseJson(text) {
  return JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
}

/** JSON mode + a validator (returns the cleaned value or throws). Retries once with a nudge. */
export async function geminiJson(opts, validate) {
  let problem = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const messages =
      attempt === 0
        ? opts.messages
        : [
            ...opts.messages,
            {
              role: "user",
              text: `Your last reply was not valid JSON in the requested shape (${problem}). Reply again with ONLY the JSON.`,
            },
          ];
    const text = await callGemini({ ...opts, messages, json: true });
    try {
      return validate(parseJson(text));
    } catch (e) {
      problem = e.message || "wrong shape";
    }
  }
  throw new HttpError(502, "The AI sent back something unexpected. Please try again.");
}
