/**
 * Rhea Interview Proxy — Cloudflare Worker
 * ----------------------------------------
 * Holds the LLM API key as a server-side SECRET (never sent to the browser),
 * authenticates users with username/password, and proxies chat to the provider.
 *
 * Endpoints:
 *   POST /api/login  { username, password }            -> { token, role }
 *   POST /api/chat   { system, messages, provider?, model? }  (Bearer token)  -> { text }
 *
 * Secrets/vars (set via wrangler — see README):
 *   AUTH_SECRET       random string used to sign session tokens
 *   USERS_JSON        {"rhea":{"hash":"<sha256(pw)>","role":"admin"}, ...}
 *   OPENROUTER_KEY / GEMINI_KEY / GROQ_KEY   provider keys (only set what you use)
 *   ALLOWED_ORIGIN    e.g. https://rhea.example.com (or * for testing)
 *   DEFAULT_PROVIDER  openrouter | gemini | groq
 *   OPENROUTER_MODEL / GEMINI_MODEL / GROQ_MODEL   default model ids
 */

const enc = new TextEncoder();
const TOKEN_TTL_MS = 1000 * 60 * 60 * 8; // 8 hours

// ---- lightweight per-isolate rate limiter (best-effort; use KV/DO for hard limits) ----
const RL = { login: new Map(), chat: new Map() };
function rateLimit(map, key, max, windowMs) {
  const now = Date.now();
  const e = map.get(key);
  if (!e || now > e.reset) { map.set(key, { n: 1, reset: now + windowMs }); return true; }
  if (e.n >= max) return false;
  e.n++; return true;
}
function clientId(req) { return req.headers.get('CF-Connecting-IP') || 'anon'; }

// ---- server-side guardrails (cannot be bypassed from the browser) ----
const INJECTION = /(ignore|disregard|forget|override)\s+(all\s+|the\s+|your\s+|previous\s+|prior\s+|above\s+)*(instructions|rules|prompt|guardrails)|reveal\s+(your\s+)?(system\s+)?(prompt|instructions|rules)|you\s+are\s+now\s+a\b|pretend\s+(to\s+be|you\s+are)|jailbreak|developer\s+mode|do\s+anything\s+now/i;
const UNSAFE = /\b(build|make|create)\s+(a\s+)?(bomb|weapon|explosive)|how\s+to\s+(kill|harm|hurt)\s+(a\s+)?(person|someone|people)|child\s*p|self.?harm|suicide\s+method/i;
function guardReply(text) {
  if (UNSAFE.test(text)) return "I can't help with that. I'm strictly an interview coach for Power BI & data engineering — ask me a DAX, modeling, SQL, or pipeline question.";
  if (INJECTION.test(text)) return "I stay locked to my role as your Power BI / data engineering interview coach and won't change instructions. What topic do you want to drill?";
  return null;
}

async function sha256Hex(s) {
  const b = await crypto.subtle.digest('SHA-256', enc.encode(s));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}
function b64url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s) {
  return atob(s.replace(/-/g, '+').replace(/_/g, '/'));
}
async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
async function sign(payloadObj, secret) {
  const key = await hmacKey(secret);
  const payload = b64url(enc.encode(JSON.stringify(payloadObj)));
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  return payload + '.' + b64url(sig);
}
async function verify(token, secret) {
  if (!token || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  const key = await hmacKey(secret);
  const expected = b64url(await crypto.subtle.sign('HMAC', key, enc.encode(payload)));
  if (expected !== sig) return null;
  try {
    const obj = JSON.parse(b64urlDecode(payload));
    if (obj.exp && Date.now() > obj.exp) return null;
    return obj;
  } catch { return null; }
}

function cors(env) {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}
function json(data, status, env) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...cors(env) } });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors(env) });

    // ---------- LOGIN ----------
    if (url.pathname === '/api/login' && req.method === 'POST') {
      if (!rateLimit(RL.login, clientId(req), 8, 10 * 60 * 1000))
        return json({ error: 'Too many attempts — wait a few minutes.' }, 429, env);
      const { username, password } = await req.json().catch(() => ({}));
      const users = JSON.parse(env.USERS_JSON || '{}');
      const u = users[(username || '').toLowerCase()];
      // constant-ish: always hash, then compare
      const h = await sha256Hex(password || '');
      if (!u || h !== u.hash) return json({ error: 'Invalid username or password.' }, 401, env);
      const token = await sign(
        { u: username.toLowerCase(), role: u.role, exp: Date.now() + TOKEN_TTL_MS },
        env.AUTH_SECRET
      );
      return json({ token, role: u.role }, 200, env);
    }

    // ---------- CHAT ----------
    if (url.pathname === '/api/chat' && req.method === 'POST') {
      const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
      const sess = await verify(token, env.AUTH_SECRET);
      if (!sess) return json({ error: 'Unauthorized — sign in again.' }, 401, env);
      if (!rateLimit(RL.chat, sess.u || clientId(req), 30, 60 * 1000))
        return json({ error: 'Slow down — too many requests this minute.' }, 429, env);

      const body = await req.json().catch(() => ({}));
      const provider = body.provider || env.DEFAULT_PROVIDER || 'openrouter';
      const messages = Array.isArray(body.messages) ? body.messages.slice(-20) : [];
      const system = String(body.system || '').slice(0, 8000);
      // server-side guard: block injection / unsafe on the latest user turn
      const lastUser = [...messages].reverse().find(m => m.role === 'user');
      const blocked = lastUser && guardReply(String(lastUser.content || ''));
      if (blocked) return json({ text: blocked }, 200, env);
      try {
        const text = await callUpstream(provider, system, messages, env, body.model);
        return json({ text }, 200, env);
      } catch (e) {
        return json({ error: String(e.message || e) }, 502, env);
      }
    }

    return json({ error: 'Not found' }, 404, env);
  }
};

async function callUpstream(provider, system, messages, env, model) {
  if (provider === 'gemini') {
    const m = model || env.GEMINI_MODEL || 'gemini-2.0-flash';
    if (!env.GEMINI_KEY) throw new Error('GEMINI_KEY not configured');
    const contents = messages.map(x => ({ role: x.role === 'assistant' ? 'model' : 'user', parts: [{ text: x.content }] }));
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${env.GEMINI_KEY}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents, generationConfig: { temperature: 0.7, maxOutputTokens: 900 } })
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error?.message || ('HTTP ' + r.status));
    return j.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '(empty)';
  }

  // OpenAI-compatible providers
  const map = {
    groq: { url: 'https://api.groq.com/openai/v1/chat/completions', key: env.GROQ_KEY, model: model || env.GROQ_MODEL || 'llama-3.3-70b-versatile' },
    openrouter: { url: 'https://openrouter.ai/api/v1/chat/completions', key: env.OPENROUTER_KEY, model: model || env.OPENROUTER_MODEL || 'openai/gpt-oss-20b:free' }
  };
  const cfg = map[provider];
  if (!cfg) throw new Error('Unknown provider: ' + provider);
  if (!cfg.key) throw new Error(provider.toUpperCase() + '_KEY not configured');

  const r = await fetch(cfg.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + cfg.key,
      'HTTP-Referer': env.ALLOWED_ORIGIN || 'https://rhea.local',
      'X-Title': 'Rhea Interviewer'
    },
    body: JSON.stringify({ model: cfg.model, temperature: 0.7, max_tokens: 900, messages: [{ role: 'system', content: system }, ...messages] })
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message || ('HTTP ' + r.status));
  return j.choices?.[0]?.message?.content || '(empty)';
}
