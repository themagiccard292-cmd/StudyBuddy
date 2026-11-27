# StudyBuddy

An AI study partner for students (middle school, high school, college) in any subject, with a teacher side for
classes and homework. Students study from **their own notes**; teachers upload curriculum and chat with the AI to
build homework.

## Run it on your own computer

Needs Node 22.5 or newer.

```bash
npm install
cp .env.example .env        # then put your Gemini API key in .env
npm start                   # http://localhost:3000
```

With no `DATABASE_URL`, it keeps teacher data in a local Postgres (PGlite) inside the `data/` folder, so there is nothing
else to install. The Gemini key lives **only** in `.env` (or a real environment variable) on the server. It is never sent
to the browser.

| Setting | Default | What it does |
| --- | --- | --- |
| `GEMINI_API_KEY` | none | Your Google Gemini key (required for AI features) |
| `DATABASE_URL` | none | A Postgres connection string. **Required when hosted on Netlify** |
| `SESSION_SECRET` | random each start | Salts the hashed-IP visitor key. Set a long random string so it stays stable |
| `DAILY_AI_LIMIT` | `300` | AI calls per visitor per day, to keep costs bounded. `0` turns the limit off |
| `PORT` | `3000` | Port (local / Render only) |
| `DATABASE_PATH` | `data/pglite` | Where local data is kept when there is no `DATABASE_URL` |
| `TRUST_PROXY` | off | Set to `1` behind a reverse proxy (Render) so the real visitor IP is used for the daily limit |
| `BACKUP_AI_KEY` (+ `BACKUP_AI_PROVIDER`, `BACKUP_AI_MODEL`, `BACKUP_AI_BASE_URL`) | none | A second AI provider used when Gemini is busy or down. See "Backup AI provider" below |
| `GEMINI_MODEL` / `GEMINI_FALLBACK_MODEL` | `gemini-3.8-flash` / `gemini-3.5-flash-lite` | Models used. If the main one is slow or rate limited, the app switches to the fallback automatically |

## Backup AI provider

If Gemini is rate limited, overloaded, slow or rejects the key, StudyBuddy can fall back to a second provider so students
still get an answer. It is off until you set `BACKUP_AI_KEY`. The order is: Gemini main model, Gemini light model, backup.
After a temporary Gemini failure, requests go straight to the backup for a minute so students don't each wait.

**Any OpenAI-compatible service** (OpenAI, Groq, OpenRouter, Together, Mistral and many others):

```
BACKUP_AI_KEY=the-providers-api-key
BACKUP_AI_MODEL=the-model-name            # required; take it from the provider's docs
BACKUP_AI_BASE_URL=https://api.openai.com/v1   # default; change it for other providers
```

**Anthropic (Claude):**

```
BACKUP_AI_KEY=your-anthropic-key
BACKUP_AI_PROVIDER=anthropic              # model defaults to claude-haiku-5-5; set BACKUP_AI_MODEL to change it
```

If a service rejects JSON mode, set `BACKUP_AI_JSON_MODE=off`. `BACKUP_AI_TIMEOUT_MS` (default 25000) sets how long to
wait. `/api/health` shows `backupAiConfigured`. On Netlify, add these as environment variables like the others.
Quality and wording will differ a little between providers, and student notes sent for AI help can go to the backup
company too when it is used, so check its data policy before turning it on.

## Put it online with Netlify

Netlify serves the pages as static files and runs the API as one serverless function
(`netlify/functions/api.js`). Because a function has no disk, teacher data lives in a hosted Postgres database.

1. **Database.** Make a free Postgres database at [neon.com](https://neon.com) and copy its **connection string**
   (it starts with `postgres://`).
2. **GitHub.** Put this folder in a GitHub repo (keep `package.json` at the top level; never commit `.env`).
3. **Netlify.** Add new site, import the repo. Netlify reads `netlify.toml` (build command, publish folder, redirects,
   security headers), so leave the build settings as they are.
4. **Environment variables** (Site configuration, Environment variables), available to builds and Functions:
   - `GEMINI_API_KEY`: your Gemini key
   - `DATABASE_URL`: the Postgres connection string from step 1
   - `SESSION_SECRET`: any long random string
5. **Deploy**, then open `https://your-site.netlify.app/api/health`. You should see
   `{"ok":true,"database":true,"aiConfigured":true}`. If `database` is false, `DATABASE_URL` is missing or wrong.

The tables are created automatically the first time the API runs. Netlify's own database add-on is supported through
the `NETLIFY_DB_URL` setting, but Neon with `DATABASE_URL` is the tested path.

Notes for Netlify: AI calls are given 10 seconds on the main model and 18 on the fallback so they finish inside
Netlify's function time limit. The first request after a quiet period is slower (cold start). Login-attempt limiting is
per function instance, so it is weaker than on a single server.

## Put it online with Render (alternative)

`render.yaml` is a Blueprint: **New, Blueprint**, pick the repo, paste your Gemini key. It adds a persistent disk for the
local database. Render's free plan can't have a disk, so pick a paid plan. Or set `DATABASE_URL` to Neon and skip the disk.

## What's in it

**Students** (no account, no login)
- Paste notes or upload a PDF / text file (PDFs are read in the browser and never uploaded). Notes show in a side panel.
- **Quiz me:** multiple choice and short answer, one at a time. Wrong answers get a hint first, never the answer;
  after two tries (or on request) the answer is shown with a 1-2 sentence explanation.
- **Explain it back:** explain a concept in your own words, get kind, specific feedback on what's right, missing or wrong.
- **Chat:** answers only from your notes unless you ask it to go beyond them.
- **Flashcards**, **Practice problems** (math and applied problems, with LaTeX), and full **Tests** graded at the end.
- **Weak spots:** topics you keep missing, with a "practice my weak spots" button. Progress is a streak and a
  "topics mastered" count.
- **Classes:** join with a 6-letter code and a first name. See class materials and homework, hand it in, get instant feedback.

**Teachers** (email + password)
- Create classes with a join code; upload curriculum (paste or PDF) for the AI to follow.
- Chat with the AI about the homework you want, optionally from a textbook; edit every question; publish.
- See who finished, their scores and attempts, and which questions the class found hardest.

Notes, progress and study history stay in the student's browser (`localStorage`). The database stores only teacher
accounts, classes, curriculum, homework and class results.

## Privacy and safety

- No ads, no analytics, no third-party requests: fonts, math rendering and the PDF reader are all served from this site.
- Students give a first name and a class code. No email, no password, no other personal information.
- Visitor IPs are used only to count the daily limit, as a salted hash; the raw IP is never stored.
- Homework answer keys never reach a student's browser until after they hand it in.
- Anything pasted into notes is passed to the AI as data, not instructions.
- Teacher passwords are hashed with scrypt; sessions use HttpOnly cookies; a Content-Security-Policy is set; changes to
  data need a header only this site's pages send, which blocks cross-site forms.

## Gemini quota

Google's free tier limits requests per minute. A classroom all using the AI at once can hit it, and students then see
"The AI is very busy right now. Try again in a minute." For real classroom use, enable billing on the Google AI Studio
project that owns your key.

## Tests

```bash
npm test
```

API tests run with Gemini mocked (no network, no cost) against a real Postgres (PGlite). Set `TEST_DATABASE_URL` to run
the same tests through the real Postgres driver. They cover accounts, class isolation, the answer-key privacy rule,
grading and retakes, the daily limit, the model fail-over, the backup provider, web files, and the Netlify function, build and config.

## Layout

```
server/            Express app, database, Gemini client, prompts, routes (ai, teacher, student)
netlify/functions/ api.js: the API as a Netlify Function
scripts/           build-netlify.mjs assembles dist/; build-icons.mjs regenerates the icon set
public/            The site: plain JavaScript modules, CSS, no build step
  js/pages/        One file per page
test/              API tests
netlify.toml       Netlify build, redirects and headers
render.yaml        Render Blueprint (alternative host)
```
