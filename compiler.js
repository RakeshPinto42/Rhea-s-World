/* =====================================================================
   Rhea Code Compiler — engine + UI
   Python  : Pyodide (CPython in WASM)
   SQL/DAX : sql.js (SQLite in WASM) over a shared seeded database
   ===================================================================== */
(function () {
  "use strict";

  const PYODIDE_VER = "0.26.4";
  const SQLJS_VER   = "1.12.0";

  const SCHEMA_TEXT = {
    sql:
`Tables in this database:
  departments(id, name)
  employees(id, name, dept_id, salary, hire_date)   -- dept_id -> departments.id`,
    powerbi:
`Star schema (think of these as your Power BI model):
  products(id, name, category)
  sales(id, order_date, product_id, qty, amount)    -- product_id -> products.id`
  };

  /* ---------------- theme + nav (match site pattern) ---------------- */
  const tBtn = document.getElementById("themeBtn");
  function setTheme(t) {
    document.documentElement.setAttribute("data-theme", t);
    localStorage.setItem("rhea_theme", t);
    tBtn.innerHTML = t === "dark" ? "&#9728; Light" : "&#9789; Dark";
  }
  tBtn.onclick = () =>
    setTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark");
  setTheme(localStorage.getItem("rhea_theme") || "light");

  const navToggle = document.getElementById("navToggle");
  const navLinks = document.getElementById("navLinks");
  navToggle.addEventListener("click", () => {
    const o = navLinks.classList.toggle("open");
    navToggle.setAttribute("aria-expanded", o);
  });
  navLinks.addEventListener("click", e => {
    if (e.target.tagName === "A") {
      navLinks.classList.remove("open");
      navToggle.setAttribute("aria-expanded", "false");
    }
  });

  /* ---------------- DOM refs ---------------- */
  const $ = id => document.getElementById(id);
  const langtabsEl = $("langtabs"), exlistEl = $("exlist");
  const exTitle = $("exTitle"), exLvl = $("exLvl"), exPrompt = $("exPrompt"), exSchema = $("exSchema");
  const editor = $("editor"), edLabel = $("edLabel"), engineStatus = $("engineStatus");
  const runBtn = $("runBtn"), checkBtn = $("checkBtn"), resetBtn = $("resetBtn");
  const output = $("output"), verdict = $("verdict"), solBox = $("solBox"), solCode = $("solCode");
  const solSummary = solBox.querySelector("summary");

  const LANGS = [
    { key: "python",  label: "Python",   ext: "main.py" },
    { key: "sql",     label: "SQL",      ext: "query.sql" },
    { key: "powerbi", label: "Power BI / DAX", ext: "measure.sql" },
  ];
  const LVL = { beg: ["beg", "Beginner"], int: ["int", "Intermediate"], adv: ["adv", "Advanced"] };

  let curLang = "python";
  let curEx = null;

  /* ---------------- progress (localStorage) ---------------- */
  const PKEY = "rhea_compiler_done";
  const loadDone = () => { try { return JSON.parse(localStorage.getItem(PKEY)) || {}; } catch { return {}; } };
  const done = loadDone();
  function markDone(lang, id) {
    (done[lang] = done[lang] || {})[id] = true;
    localStorage.setItem(PKEY, JSON.stringify(done));
  }
  const isDone = (lang, id) => !!(done[lang] && done[lang][id]);

  /* ---------------- editor: per-exercise draft + tab key ---------------- */
  const draftKey = (lang, id) => `rhea_draft_${lang}_${id}`;
  editor.addEventListener("keydown", e => {
    if (e.key === "Tab") {
      e.preventDefault();
      const s = editor.selectionStart, en = editor.selectionEnd;
      editor.value = editor.value.slice(0, s) + "    " + editor.value.slice(en);
      editor.selectionStart = editor.selectionEnd = s + 4;
    }
  });
  editor.addEventListener("input", () => {
    if (curEx) localStorage.setItem(draftKey(curLang, curEx.id), editor.value);
  });

  /* ---------------- render: language tabs ---------------- */
  function renderLangTabs() {
    langtabsEl.innerHTML = "";
    LANGS.forEach(l => {
      const list = RHEA_EXERCISES[l.key] || [];
      const d = list.filter(e => isDone(l.key, e.id)).length;
      const b = document.createElement("button");
      b.className = "langtab" + (l.key === curLang ? " on" : "");
      const gradeable = list.filter(e => !e.concept);
      const gd = gradeable.filter(e => isDone(l.key, e.id)).length;
      b.innerHTML = `${l.label} <span class="pc">${gd}/${gradeable.length}</span>`;
      b.onclick = () => selectLang(l.key);
      langtabsEl.appendChild(b);
    });
  }

  /* ---------------- render: exercise sidebar ---------------- */
  function makeItem(ex) {
    const btn = document.createElement("button");
    const d = isDone(curLang, ex.id);
    btn.className = "exitem" + (d ? " done" : "") + (curEx && curEx.id === ex.id ? " on" : "");
    const star = ex.important ? '<span class="star">&#9733;</span>' : "";
    const dot = ex.concept ? '<span class="dot concept">?</span>' : `<span class="dot">${d ? "&#10003;" : ""}</span>`;
    btn.innerHTML = `${dot}<span>${star}${ex.title}</span>`;
    btn.onclick = () => selectExercise(ex);
    return btn;
  }
  function renderSidebar() {
    const list = RHEA_EXERCISES[curLang] || [];
    exlistEl.innerHTML = "";
    // pinned ★ Interview group (important exercises), ordered by level
    const important = list.filter(e => e.important);
    if (important.length) {
      const g = document.createElement("div");
      g.className = "exgrp star-grp";
      g.innerHTML = "&#9733; Interview &mdash; important";
      exlistEl.appendChild(g);
      ["beg", "int", "adv"].forEach(lv =>
        important.filter(e => e.level === lv).forEach(ex => exlistEl.appendChild(makeItem(ex))));
    }
    // remaining, grouped by level
    ["beg", "int", "adv"].forEach(lv => {
      const items = list.filter(e => e.level === lv && !e.important);
      if (!items.length) return;
      const g = document.createElement("div");
      g.className = "exgrp";
      g.textContent = LVL[lv][1];
      exlistEl.appendChild(g);
      items.forEach(ex => exlistEl.appendChild(makeItem(ex)));
    });
    const gradeable = list.filter(e => !e.concept);
    const d = gradeable.filter(e => isDone(curLang, e.id)).length;
    const p = document.createElement("div");
    p.className = "exprog";
    p.textContent = `Progress: ${d} / ${gradeable.length} solved`;
    exlistEl.appendChild(p);
  }

  /* ---------------- select language / exercise ---------------- */
  function selectLang(key) {
    curLang = key;
    edLabel.textContent = LANGS.find(l => l.key === key).ext;
    const list = RHEA_EXERCISES[key] || [];
    renderLangTabs();
    selectExercise(list[0]);
    // warm the right engine
    if (key === "python") ensurePyodide(); else ensureSql();
  }

  function selectExercise(ex) {
    curEx = ex;
    renderSidebar();
    exTitle.innerHTML = (ex.important ? '<span class="star">&#9733;</span> ' : "") + ex.title;
    exLvl.className = "lvl " + ex.level;
    exLvl.textContent = LVL[ex.level][1];
    exPrompt.innerHTML = ex.prompt;
    if (curLang === "python") {
      exSchema.hidden = true;
    } else {
      exSchema.hidden = false;
      exSchema.textContent = SCHEMA_TEXT[curLang];
    }

    const concept = !!ex.concept;
    runBtn.style.display = concept ? "none" : "";
    checkBtn.style.display = concept ? "none" : "";
    solSummary.textContent = concept ? "Reveal model answer" : "Show solution";
    if (concept) {
      solCode.innerHTML = ex.answer;
      editor.placeholder = "Scratch space — write your answer, then reveal the model answer below.";
    } else {
      solCode.textContent = ex.solution;
      editor.placeholder = "";
    }

    const draft = localStorage.getItem(draftKey(curLang, ex.id));
    editor.value = draft != null ? draft : ex.starter;
    solBox.open = false;
    clearOutput();
    if (concept) {
      const n = document.createElement("div");
      n.className = "tip";
      n.innerHTML = "&#128172; Conceptual interview question — no code to run. Answer it out loud or in the editor, then reveal the model answer below.";
      output.appendChild(n);
    }
  }

  function clearOutput() {
    output.textContent = "";
    verdict.className = "";
    verdict.innerHTML = "";
  }
  function showText(text, kind) {
    output.innerHTML = "";
    const span = document.createElement("span");
    if (kind === true || kind === "err") span.className = "er";
    else if (kind === "ok") span.className = "ok";
    span.textContent = text;
    output.appendChild(span);
  }
  function showVerdict(pass, msg) {
    verdict.className = "verdict " + (pass ? "pass" : "fail");
    verdict.innerHTML = (pass ? "&#10003; " : "&#10007; ") + msg;
  }
  // append a contextual tip box below the output
  function showTip(html) {
    if (!html) return;
    const d = document.createElement("div");
    d.className = "tip";
    d.innerHTML = "&#128161; " + html;
    output.appendChild(d);
  }
  // build a helpful tip from the failure kind + error text (+ optional ex.hint)
  function genTip(lang, kind, err, ex) {
    const base = ex && ex.hint ? `<b>Hint:</b> ${ex.hint}<br>` : "";
    const e = err || "";
    let t = "";
    if (kind === "pyerr") {
      if (/AssertionError/.test(e)) t = "A hidden test failed — your code runs but returns the wrong value for some input. Check edge cases: empty input, negatives, ties, zero.";
      else if (/NameError/.test(e)) t = "A name isn't defined. Implement the function with the <i>exact</i> name and parameters the task asks for.";
      else if (/SyntaxError|IndentationError/.test(e)) t = "Syntax or indentation problem. Check colons after <code>def/if/for</code>, matching brackets, and consistent 4-space indents.";
      else if (/TypeError/.test(e)) t = "Type error — usually wrong number of arguments or mixing <code>str</code> and <code>int</code>. Check what you return and how it's called.";
      else if (/ZeroDivisionError/.test(e)) t = "Division by zero — guard the denominator before dividing.";
      else if (/IndexError|KeyError/.test(e)) t = "Index/key out of range — check bounds and that a key exists before accessing it.";
      else t = "Your code raised an error. The <b>last line</b> of the traceback above names the exact problem.";
    } else if (kind === "stdout") {
      t = "Printed text differs from expected. Compare the two blocks above — check wording, capitalisation, spaces, and the trailing newline.";
    } else if (kind === "sqlerr") {
      if (/no such column/i.test(e)) t = "Unknown column. Check spelling against the schema panel, and qualify columns with the table alias (e.g. <code>e.salary</code>).";
      else if (/no such table/i.test(e)) t = "Unknown table. Use the exact table names listed in the schema panel above.";
      else if (/syntax error/i.test(e)) t = "SQL syntax error. Check commas between columns and clause order: <code>SELECT … FROM … WHERE … GROUP BY … HAVING … ORDER BY</code>.";
      else if (/ambiguous/i.test(e)) t = "Ambiguous column — it exists in more than one joined table. Prefix it with the table alias.";
      else if (/misuse of aggregate|group by/i.test(e)) t = "Aggregate misuse — every non-aggregated column in SELECT must appear in GROUP BY.";
      else t = "The database rejected the query. Read the error message above.";
    } else if (kind === "sqlmismatch") {
      t = "Query runs, but the result differs. Re-check filters (<code>WHERE</code>), grouping (<code>GROUP BY</code>), the aggregate used, column order &amp; aliases, and any required <code>ORDER BY</code>.";
    }
    return base + t;
  }

  /* =================== PYTHON engine (Pyodide) =================== */
  let pyodide = null, pyLoading = null;
  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = src; s.onload = res; s.onerror = () => rej(new Error("failed to load " + src));
      document.head.appendChild(s);
    });
  }
  function busy(msg) { engineStatus.innerHTML = msg ? `<span class="spin"></span>${msg}` : ""; }

  function ensurePyodide() {
    if (pyodide) return Promise.resolve(pyodide);
    if (pyLoading) return pyLoading;
    busy("loading Python runtime…");
    pyLoading = (async () => {
      await loadScript(`https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VER}/full/pyodide.js`);
      pyodide = await loadPyodide({ indexURL: `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VER}/full/` });
      busy("");
      return pyodide;
    })();
    return pyLoading;
  }

  const PY_RUNNER = `
import io, contextlib, traceback, json
_g = {}
_out = io.StringIO()
_err = None
try:
    with contextlib.redirect_stdout(_out):
        exec(_USER, _g)
        if _TEST:
            exec(_TEST, _g)
except Exception:
    _err = traceback.format_exc()
_RESULT = json.dumps({"out": _out.getvalue(), "err": _err})
`;

  async function runPython(userSrc, testSrc) {
    const py = await ensurePyodide();
    py.globals.set("_USER", userSrc);
    py.globals.set("_TEST", testSrc || "");
    await py.runPythonAsync(PY_RUNNER);
    return JSON.parse(py.globals.get("_RESULT"));
  }

  /* =================== SQL engine (sql.js) =================== */
  let db = null, sqlLoading = null;
  function ensureSql() {
    if (db) return Promise.resolve(db);
    if (sqlLoading) return sqlLoading;
    busy("loading SQL engine…");
    sqlLoading = (async () => {
      await loadScript(`https://cdnjs.cloudflare.com/ajax/libs/sql.js/${SQLJS_VER}/sql-wasm.js`);
      const SQL = await initSqlJs({ locateFile: f => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/${SQLJS_VER}/${f}` });
      db = new SQL.Database();
      db.run(RHEA_DB_SEED);
      busy("");
      return db;
    })();
    return sqlLoading;
  }

  // run sql, return last result set {columns, values} or null; throws on error
  function runSql(sql) {
    const res = db.exec(sql);
    return res.length ? res[res.length - 1] : null;
  }

  function renderTable(result, state) {
    if (!result) { showText("(no rows returned)", state === "ok" ? "ok" : state === "bad" ? "err" : null); return; }
    const wrap = document.createElement("div");
    wrap.className = "tblwrap" + (state ? " " + state : "");
    const t = document.createElement("table");
    t.className = "rtbl";
    const thead = document.createElement("tr");
    result.columns.forEach(c => { const th = document.createElement("th"); th.textContent = c; thead.appendChild(th); });
    t.appendChild(thead);
    result.values.forEach(row => {
      const tr = document.createElement("tr");
      row.forEach(cell => { const td = document.createElement("td"); td.textContent = cell === null ? "NULL" : cell; tr.appendChild(td); });
      t.appendChild(tr);
    });
    wrap.appendChild(t);
    output.innerHTML = "";
    output.appendChild(wrap);
  }

  // normalize a result set for comparison
  function normResult(r) {
    if (!r) return [];
    return r.values.map(row => row.map(c => (typeof c === "number" ? Math.round(c * 1e6) / 1e6 : c)));
  }
  function rowsEqual(a, b, ordered) {
    const A = a.map(r => JSON.stringify(r));
    const B = b.map(r => JSON.stringify(r));
    if (!ordered) { A.sort(); B.sort(); }
    return A.length === B.length && A.every((x, i) => x === B[i]);
  }

  /* =================== Run / Check / Reset =================== */
  async function doRun() {
    if (curEx && curEx.concept) return;
    clearOutput();
    runBtn.disabled = checkBtn.disabled = true;
    try {
      if (curLang === "python") {
        busy("running…");
        const r = await runPython(editor.value, "");
        if (r.err) showText(r.err, true);
        else showText(r.out || "(no output)");
      } else {
        await ensureSql();
        const r = runSql(editor.value);
        renderTable(r);
      }
    } catch (e) {
      showText(String(e.message || e), true);
    } finally {
      busy(""); runBtn.disabled = checkBtn.disabled = false;
    }
  }

  async function doCheck() {
    if (curEx && curEx.concept) return;
    clearOutput();
    runBtn.disabled = checkBtn.disabled = true;
    try {
      let pass = false, detail = "", tip = "";
      const chk = curEx.check || {};

      if (curLang === "python") {
        busy("checking…");
        const r = await runPython(editor.value, chk.tests || "");
        if (r.err) {
          showText(r.err, "err");
          detail = chk.tests ? "A hidden test failed." : "Your code raised an error.";
          tip = genTip("python", "pyerr", r.err, curEx);
        } else if (chk.stdout != null && r.out !== chk.stdout) {
          detail = "Output did not match expected.";
          showOutputDiff(r.out, chk.stdout);
          tip = genTip("python", "stdout", null, curEx);
        } else {
          pass = true;
          showText(r.out || "(passed — no output)", "ok");
        }
      } else {
        await ensureSql();
        let userRes;
        try {
          userRes = runSql(editor.value);
        } catch (sqlE) {
          const msg = String(sqlE.message || sqlE);
          showText(msg, "err");
          detail = "The query did not run.";
          tip = genTip("sql", "sqlerr", msg, curEx);
        }
        if (!detail) {
          const refRes = runSql(chk.sql);
          pass = rowsEqual(normResult(userRes), normResult(refRes), !!chk.ordered);
          renderTable(userRes, pass ? "ok" : "bad");
          if (!pass) {
            detail = "Result set didn't match the expected result.";
            tip = genTip("sql", "sqlmismatch", null, curEx);
          }
        }
      }

      if (pass) {
        markDone(curLang, curEx.id);
        renderSidebar(); renderLangTabs();
        showVerdict(true, "Correct! Exercise solved.");
      } else {
        showVerdict(false, detail || "Not quite — try again.");
        showTip(tip);
      }
    } catch (e) {
      showText(String(e.message || e), "err");
      showVerdict(false, "Error while running your answer.");
    } finally {
      busy(""); runBtn.disabled = checkBtn.disabled = false;
    }
  }

  function showOutputDiff(got, want) {
    output.innerHTML = "";
    const mk = (label, txt, cls) => {
      const d = document.createElement("div");
      const h = document.createElement("div");
      h.style.color = "var(--faint)"; h.textContent = label;
      const p = document.createElement("span");
      if (cls) p.className = cls;
      p.textContent = txt || "(empty)";
      d.appendChild(h); d.appendChild(p); d.style.marginBottom = "10px";
      return d;
    };
    output.appendChild(mk("your output:", got, "er"));
    output.appendChild(mk("expected:", want, "ok"));
  }

  function doReset() {
    if (!curEx) return;
    editor.value = curEx.starter;
    localStorage.removeItem(draftKey(curLang, curEx.id));
    clearOutput();
    editor.focus();
  }

  runBtn.onclick = doRun;
  checkBtn.onclick = doCheck;
  resetBtn.onclick = doReset;
  // Ctrl/Cmd+Enter to run
  editor.addEventListener("keydown", e => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); doRun(); }
  });

  /* ---------------- boot ---------------- */
  function boot() {
    renderLangTabs();
    selectLang("python");
  }
  if (window.RHEA_AUTH) boot();
  else document.addEventListener("rhea-auth", boot, { once: true });
})();
