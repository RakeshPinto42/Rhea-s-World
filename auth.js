/* =====================================================================
   Rhea's World — site-wide access gate (include on every page)
   ---------------------------------------------------------------------
   Locks ALL pages behind a login. Two modes:
     • WORKER_URL set  -> real auth via the Cloudflare Worker (secure).
     • WORKER_URL empty -> local client-side check (deterrent only;
       creds are visible in this file via devtools — not real security).

   Exposes:  window.RHEA_AUTH = { user, role, token? }
   Event:    document 'rhea-auth' fires on unlock
   Helper:   window.rheaSignOut()
   ===================================================================== */
(function () {
  // ===== CONFIG =====
  const WORKER_URL = ""; // e.g. "https://rhea-interview-proxy.xxx.workers.dev" — empty = local mode
  window.RHEA_WORKER_URL = WORKER_URL; // shared with interview.html for secure chat
  const ACCOUNTS = {     // used only in local mode
    "rhea":  { pass: "admin@123",   role: "admin" },
    "guest": { pass: "powerbi2026", role: "user"  }
  };
  const SKEY = "rhea_site_session";

  // hide page content until unlocked (prevents flash of locked content)
  const s = document.createElement("style");
  s.textContent = "html.rhea-locked body{visibility:hidden!important}";
  document.documentElement.appendChild(s);
  document.documentElement.classList.add("rhea-locked");

  function unlock(sess) {
    window.RHEA_AUTH = sess;
    document.documentElement.classList.remove("rhea-locked");
    const o = document.getElementById("rhea-gate");
    if (o) o.remove();
    document.dispatchEvent(new CustomEvent("rhea-auth", { detail: sess }));
  }
  window.rheaSignOut = function () {
    sessionStorage.removeItem(SKEY);
    location.reload();
  };

  // already signed in this tab?
  const saved = sessionStorage.getItem(SKEY);
  if (saved) { try { unlock(JSON.parse(saved)); return; } catch (e) {} }

  function buildGate() {
    const wrap = document.createElement("div");
    wrap.id = "rhea-gate";
    wrap.setAttribute("style",
      "position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;" +
      "padding:20px;font-family:'IBM Plex Sans',system-ui,sans-serif;" +
      "background:radial-gradient(60% 60% at 50% 28%,#161b24,#080a10);");
    wrap.innerHTML =
      '<form id="rhea-gate-form" autocomplete="off" style="width:100%;max-width:360px;background:#11151d;' +
      'border:1px solid #252c38;border-radius:18px;padding:30px 28px;box-shadow:0 30px 70px -20px rgba(0,0,0,.7);text-align:center;color:#e8edf5">' +
      '<div style="display:inline-grid;place-items:center;width:46px;height:46px;border-radius:12px;background:#e3bf3a;color:#1b1500;font-weight:700;font-size:1.2rem;margin-bottom:14px">R</div>' +
      '<h2 style="font-size:1.2rem;margin:0 0 4px">Rhea&rsquo;s World</h2>' +
      '<p style="font-size:.86rem;color:#9aa4b4;margin:0 0 20px">Private &mdash; sign in to continue.</p>' +
      '<input id="rhea-u" type="text" autocomplete="username" placeholder="username" ' +
      'style="width:100%;font-size:.95rem;padding:11px 12px;border-radius:10px;border:1px solid #252c38;background:#0f1218;color:#e8edf5;outline:none;margin-bottom:10px">' +
      '<input id="rhea-p" type="password" autocomplete="current-password" placeholder="password" ' +
      'style="width:100%;font-size:.95rem;padding:11px 12px;border-radius:10px;border:1px solid #252c38;background:#0f1218;color:#e8edf5;outline:none">' +
      '<button type="submit" style="width:100%;margin-top:18px;background:#e3bf3a;border:none;color:#1b1500;font-weight:700;font-size:.95rem;padding:12px;border-radius:11px;cursor:pointer">Sign in</button>' +
      '<div id="rhea-err" style="color:#ff6b6b;font-size:.84rem;min-height:18px;margin-top:10px"></div>' +
      '<div style="font-size:.72rem;color:#6b7484;margin-top:6px">Authorized users only.</div>' +
      '</form>';
    return wrap;
  }

  function attach() {
    const gate = buildGate();
    document.documentElement.appendChild(gate);
    const err = gate.querySelector("#rhea-err");
    gate.querySelector("#rhea-u").focus();
    gate.querySelector("#rhea-gate-form").addEventListener("submit", async function (e) {
      e.preventDefault();
      const u = gate.querySelector("#rhea-u").value.trim();
      const p = gate.querySelector("#rhea-p").value;
      err.textContent = "";
      try {
        if (WORKER_URL) {
          const r = await fetch(WORKER_URL + "/api/login", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username: u, password: p })
          });
          const j = await r.json();
          if (!r.ok) { err.textContent = j.error || "Invalid login."; return; }
          const sess = { user: u.toLowerCase(), role: j.role, token: j.token };
          sessionStorage.setItem(SKEY, JSON.stringify(sess));
          unlock(sess);
        } else {
          const a = ACCOUNTS[u.toLowerCase()];
          if (a && a.pass === p) {
            const sess = { user: u.toLowerCase(), role: a.role };
            sessionStorage.setItem(SKEY, JSON.stringify(sess));
            unlock(sess);
          } else {
            err.textContent = "Invalid username or password.";
          }
        }
      } catch (ex) {
        err.textContent = "Login failed: " + (ex.message || ex);
      }
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", attach);
  else attach();
})();
