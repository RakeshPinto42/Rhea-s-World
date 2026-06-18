# Rhea's World 🌐

A Power BI & data-engineering portfolio + interview-prep suite. Static site, no build step.

## Pages
| File | What it is |
|------|-----------|
| `index.html` | Landing page — animated data-core hero, glass dashboard |
| `learn.html` | The Handbook — 17-chapter Power BI + data engineering reference |
| `projects.html` | Project Lab — 8 deep-dive Kaggle builds + a 100+ project catalog |
| `study.html` | Interview trainer — ~115 Q&A, filters, timed mock |
| `interview.html` | AI mock interviewer — live LLM, voice, guardrails |
| `auth.js` | Site-wide login gate (all pages) |
| `worker/` | Cloudflare Worker — secure auth + LLM proxy (optional) |

## Access
The whole site is gated by `auth.js`. Accounts live in `ACCOUNTS` inside `auth.js`
(local mode only). Treat any password committed here as **public** — see warning below.

> ⚠️ **Client-side gate = deterrent, not real security.** On a public repo the
> creds are visible in source. For real protection, deploy the Cloudflare Worker
> (`worker/README.md`) and set `WORKER_URL` in `auth.js`, or put the site behind
> Cloudflare Access.

## Run locally
Just open `index.html`, or serve for the voice mic (needs https/localhost):
```bash
python -m http.server 8000   # then http://localhost:8000
```

## AI interviewer
Pick a provider (Ollama local / Gemini / Groq / OpenRouter) and key as admin, or
route everything through the Worker proxy so the key stays server-side.

🤖 Built with [Claude Code](https://claude.com/claude-code)
