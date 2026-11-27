// A second AI provider, used automatically when Gemini is busy, over its limit, or down.
// Configure it with environment variables (nothing is hard-coded, and the key never reaches the browser):
//   BACKUP_AI_KEY        the provider's API key (setting this turns the backup on)
//   BACKUP_AI_PROVIDER   "openai" (default; any OpenAI-compatible service) or "anthropic"
//   BACKUP_AI_MODEL      model name (required for "openai"; defaults to claude-haiku-5-5 for "anthropic")
//   BACKUP_AI_BASE_URL   for "openai": the service's base URL (default https://api.openai.com/v1)
//   BACKUP_AI_JSON_MODE  set to "off" if the service rejects response_format (JSON mode)
//   BACKUP_AI_TIMEOUT_MS how long to wait for it (default 25000)
import { HttpError } from "./http.js";

export function backupConfig(env = process.env) {
  const key = env.BACKUP_AI_KEY;
  if (!key) return null;
  const provider = (env.BACKUP_AI_PROVIDER || "openai").toLowerCase();
  if (!["openai", "anthropic"].includes(provider)) {
    console.error(`! BACKUP_AI_PROVIDER must be "openai" or "anthropic" (got "${provider}"): backup AI is off.`);
    return null;
  }
  const model = env.BACKUP_AI_MODEL || (provider === "anthropic" ? "claude-haiku-5-5" : "");
  if (!model) {
    console.error("! BACKUP_AI_MODEL is required for the openai-compatible backup: backup AI is off.");
    return null;
  }
  const baseUrl = (env.BACKUP_AI_BASE_URL || (provider === "anthropic" ? "https://api.anthropic.com" : "https://api.openai.com/v1")).replace(/\/$/, "");
  return { provider, key, model, baseUrl, jsonMode: env.BACKUP_AI_JSON_MODE !== "off" };
}

const JSON_ONLY = "\n\nReply with ONLY valid JSON and no other text.";

/** Same inputs as callGemini; returns the reply text. */
export async function callBackup(cfg, { system, messages, json = false }) {
  const timeout = Number(process.env.BACKUP_AI_TIMEOUT_MS) || 25_000;
  const turns = messages.map((m) => ({ role: m.role === "user" ? "user" : "assistant", content: m.text }));
  const systemText = json ? system + JSON_ONLY : system;

  let url;
  let headers;
  let body;
  if (cfg.provider === "anthropic") {
    url = `${cfg.baseUrl}/v1/messages`;
    headers = { "content-type": "application/json", "x-api-key": cfg.key, "anthropic-version": "2023-06-01" };
    body = { model: cfg.model, max_tokens: 4096, system: systemText, messages: turns };
  } else {
    url = `${cfg.baseUrl}/chat/completions`;
    headers = { "content-type": "application/json", authorization: `Bearer ${cfg.key}` };
    body = {
      model: cfg.model,
      messages: [{ role: "system", content: systemText }, ...turns],
      ...(json && cfg.jsonMode ? { response_format: { type: "json_object" } } : {}),
    };
  }

  let res;
  try {
    res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(timeout) });
  } catch (e) {
    console.error("Backup AI network error:", e.message);
    throw new HttpError(502, "The AI took too long to answer. Please try again.");
  }
  if (!res.ok) {
    console.error("Backup AI error", cfg.provider, cfg.model, res.status, (await res.text()).slice(0, 300));
    throw new HttpError(502, [429, 503, 529].includes(res.status) ? "The AI is very busy right now. Try again in a minute." : "The AI couldn't answer that. Please try again.");
  }
  const data = await res.json();
  const text =
    cfg.provider === "anthropic"
      ? (data.content ?? []).map((p) => p.text ?? "").join("")
      : (data.choices?.[0]?.message?.content ?? "");
  if (!String(text).trim()) throw new HttpError(502, "The AI didn't return an answer. Try rewording, or try again.");
  return text;
}
