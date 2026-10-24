// Le a saida `jest --json` de uma execucao com o mutante e, opcionalmente, a de
// uma reexecucao dos mesmos arquivos SEM o mutante. Imprime um JSON:
//   genuine  arquivos que falham com o mutante e passam sem ele (a falha e do mutante)
//   flaky    arquivos que falham nas duas execucoes (instaveis ou ja quebrados)
//   compile  arquivos cuja suite nem rodou por erro de compilacao TS (mutante invalido)
//
//   node eval/falhas.mjs mutante.json [base.json]
import fs from "node:fs";
import path from "node:path";

const rel = (p) => path.relative(process.cwd(), p).split(path.sep).join("/");
const failedOf = (file) => {
  const r = JSON.parse(fs.readFileSync(file, "utf8"));
  const failed = [];
  const compile = [];
  for (const t of r.testResults || []) {
    if (t.status !== "failed") continue;
    failed.push(rel(t.name));
    if (/error TS\d+|\bTS\d{4}:/.test(t.message || "") && (t.assertionResults || []).length === 0) compile.push(rel(t.name));
  }
  return { failed, compile, total: r.numTotalTests ?? 0, failedTests: r.numFailedTests ?? 0 };
};

const [, , mutFile, baseFile] = process.argv;
const m = failedOf(mutFile);
const base = baseFile && fs.existsSync(baseFile) ? new Set(failedOf(baseFile).failed) : new Set();
const flaky = m.failed.filter((f) => base.has(f));
const genuine = m.failed.filter((f) => !base.has(f));
console.log(JSON.stringify({ genuine, flaky, compile: m.compile, total: m.total, failedTests: m.failedTests }));
