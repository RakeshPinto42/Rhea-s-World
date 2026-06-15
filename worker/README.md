# Rhea Interview Proxy — Cloudflare Worker

A tiny serverless proxy that makes the AI mock interviewer **actually secure**:

- The LLM **API key lives server-side** as a Worker secret — never sent to the browser.
- Users **log in** (username + password); the Worker issues a signed session token.
- The browser calls **your Worker**, not OpenRouter/Gemini directly.

This is the real version of the client-side gate. With it deployed, no key or
credential is exposed in the page source.

---

## 1. Prerequisites

- A free [Cloudflare account](https://dash.cloudflare.com/sign-up)
- Node.js installed
- Wrangler CLI:
  ```bash
  npm install -g wrangler
  wrangler login
  ```

## 2. Hash your user passwords

Passwords are stored as SHA-256 hashes (never plaintext). Compute them:

**PowerShell (Windows):**
```powershell
$pw = "admin@123"
[BitConverter]::ToString([System.Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($pw))).Replace("-","").ToLower()
```

**bash/macOS/Linux:**
```bash
printf '%s' 'admin@123' | shasum -a 256 | awk '{print $1}'
```

Do this for each user. Build a `USERS_JSON` like:
```json
{
  "rhea":  { "hash": "<sha256 of admin password>", "role": "admin" },
  "guest": { "hash": "<sha256 of user password>",  "role": "user"  }
}
```

## 3. Set secrets

From the `worker/` folder:

```bash
wrangler secret put AUTH_SECRET
# paste a long random string (e.g. `openssl rand -hex 32`)

wrangler secret put USERS_JSON
# paste the JSON from step 2 (single line is fine)

wrangler secret put OPENROUTER_KEY
# paste your OpenRouter key   (or GEMINI_KEY / GROQ_KEY)
```

Only set the provider key(s) you actually use. Match `DEFAULT_PROVIDER` in
`wrangler.toml` to whichever key you set.

## 4. Lock the origin (recommended)

In `wrangler.toml`, set `ALLOWED_ORIGIN` to your deployed site URL so other
sites can't call your Worker, e.g.:
```toml
ALLOWED_ORIGIN = "https://rhea.pages.dev"
```

## 5. Deploy

```bash
wrangler deploy
```

Wrangler prints a URL like `https://rhea-interview-proxy.<your-subdomain>.workers.dev`.

## 6. Point the site at the Worker

Open **`auth.js`** (site root) and **`interview.html`** and set:
```js
const WORKER_URL = "https://rhea-interview-proxy.<your-subdomain>.workers.dev";
```
- Empty string `""` = local/offline mode (client-side deterrent only).
- A URL = real auth + server-held key.

When `WORKER_URL` is set:
- The site login posts to `/api/login` and stores the returned token (per tab).
- The interviewer sends chat to `/api/chat` with `Authorization: Bearer <token>`;
  the Worker injects the key and calls the provider.

---

## Endpoints

| Method | Path         | Body                                          | Returns        |
|--------|--------------|-----------------------------------------------|----------------|
| POST   | `/api/login` | `{ username, password }`                      | `{ token, role }` |
| POST   | `/api/chat`  | `{ system, messages, provider?, model? }` + Bearer | `{ text }` |

Tokens are HMAC-signed and expire in 8 hours.

## Hardening ideas (optional)

- Put the whole site behind **Cloudflare Access** (Zero Trust) for SSO/OAuth —
  then you can drop the username/password gate entirely.
- Add per-user rate limiting with a KV namespace.
- Rotate `AUTH_SECRET` to invalidate all sessions.
- Serve the static site from **Cloudflare Pages** and bind the Worker on a route
  like `/api/*` so everything is same-origin (no CORS needed).
