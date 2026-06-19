/* Verify all exercises: Python solutions+tests via python, SQL/DAX via sqlite3. */
const { execSync, execFileSync } = require("child_process");
const { RHEA_EXERCISES, RHEA_DB_SEED } = require("./exercises.js");

let fails = 0;
const counts = {};

function runPy(src) {
  return execFileSync("python", ["-c", src], { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
}
function runSql(sql) {
  // feed seed + query to sqlite3 in-memory; non-zero exit or stderr => error
  return execFileSync("sqlite3", [":memory:"], { input: RHEA_DB_SEED + "\n" + sql, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
}

for (const lang of ["python", "sql", "powerbi"]) {
  const list = RHEA_EXERCISES[lang];
  counts[lang] = list.length;
  const ids = new Set();
  for (const ex of list) {
    if (ids.has(ex.id)) { console.log(`DUPLICATE ID: ${ex.id}`); fails++; }
    ids.add(ex.id);
    try {
      if (lang === "python") {
        const chk = ex.check || {};
        if (chk.tests != null) {
          runPy(ex.solution + "\n" + chk.tests);
        } else if (chk.stdout != null) {
          const out = runPy(ex.solution).replace(/\r\n/g, "\n");
          if (out !== chk.stdout) {
            console.log(`STDOUT MISMATCH ${ex.id}\n  got: ${JSON.stringify(out)}\n  exp: ${JSON.stringify(chk.stdout)}`);
            fails++;
          }
        } else { console.log(`NO CHECK ${ex.id}`); fails++; }
      } else {
        runSql(ex.check.sql);
      }
    } catch (e) {
      const msg = (e.stderr || e.stdout || e.message || "").toString().split("\n").slice(0, 3).join(" | ");
      console.log(`FAIL ${lang} ${ex.id}: ${msg}`);
      fails++;
    }
  }
}

console.log("\ncounts:", counts);
console.log(fails ? `\n❌ ${fails} failures` : "\n✅ all exercises pass");
process.exit(fails ? 1 : 0);
