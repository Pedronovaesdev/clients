// Gerador de mutantes para a analise de seguranca da selecao de testes.
//
//   node eval/mutate.mjs gen   <seed> <quantidade> <saida.json>
//   node eval/mutate.mjs apply <mutantes.json> <id>      (imprime o arquivo alterado)
//
// gen: sorteia (com semente fixa) arquivos de producao e, em cada um, UM ponto
// de mutacao. Os operadores preservam os tipos, para o mutante compilar:
//   === <-> !==, == <-> !=, && <-> ||, < <-> >=, > <-> <=, + -> - (so com literal
//   numerico), true <-> false, if (c) -> if (!(c)).
// Ficam de fora: tipos, decorators e condicoes de laco (risco de laco infinito).
//
// O TypeScript vem de TS_FROM (pasta com node_modules/typescript) ou do cwd.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const req = createRequire(path.join(process.env.TS_FROM || process.cwd(), "noop.js"));
const ts = req("typescript");
const K = ts.SyntaxKind;

const BINARY = new Map([
  [K.EqualsEqualsEqualsToken, "!=="],
  [K.ExclamationEqualsEqualsToken, "==="],
  [K.EqualsEqualsToken, "!="],
  [K.ExclamationEqualsToken, "=="],
  [K.AmpersandAmpersandToken, "||"],
  [K.BarBarToken, "&&"],
  [K.LessThanToken, ">="],
  [K.GreaterThanToken, "<="],
  [K.LessThanEqualsToken, ">"],
  [K.GreaterThanEqualsToken, "<"],
]);

const EXCLUDE_PATH =
  /(\.spec\.|\.test\.|\.d\.ts$|\.stories\.|\.mock|\.module\.ts$|routing|environment|jest\.config|\.e2e|\/testing\/|\/test-|\/spec\/|\/fixtures?\/|\/mocks?\/|\/migrations?\/|\/e2e\/|\/scripts\/|\/storybook\/|\/stories\/|\/node_modules\/)/;

function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sitesOf(file, text) {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const sites = [];
  const lineOf = (pos) => sf.getLineAndCharacterOfPosition(pos).line + 1;
  const isNum = (n) => n.kind === K.NumericLiteral;
  const add = (node, start, end, to, op) =>
    sites.push({ start, end, from: text.slice(start, end), to, op, line: lineOf(start) });

  function visit(node, noLoop) {
    if (ts.isDecorator(node) || ts.isTypeNode(node) || ts.isImportDeclaration(node)) return;
    if (ts.isForStatement(node)) {
      for (const c of [node.initializer, node.condition, node.incrementor]) if (c) visit(c, true);
      visit(node.statement, noLoop);
      return;
    }
    if (ts.isWhileStatement(node) || ts.isDoStatement(node)) {
      visit(node.expression, true);
      visit(node.statement, noLoop);
      return;
    }
    if (!noLoop) {
      if (ts.isBinaryExpression(node)) {
        const k = node.operatorToken.kind;
        const op = node.operatorToken;
        if (BINARY.has(k)) add(node, op.getStart(sf), op.getEnd(), BINARY.get(k), "binario");
        else if (k === K.PlusToken && (isNum(node.left) || isNum(node.right)))
          add(node, op.getStart(sf), op.getEnd(), "-", "aritmetico");
      } else if (node.kind === K.TrueKeyword || node.kind === K.FalseKeyword) {
        add(node, node.getStart(sf), node.getEnd(), node.kind === K.TrueKeyword ? "false" : "true", "booleano");
      } else if (ts.isIfStatement(node)) {
        const e = node.expression;
        add(node, e.getStart(sf), e.getEnd(), `!(${text.slice(e.getStart(sf), e.getEnd())})`, "nega-if");
      }
    }
    ts.forEachChild(node, (c) => visit(c, noLoop));
  }
  visit(sf, false);
  return sites;
}

function syntaxOk(file, text) {
  const out = ts.transpileModule(text, {
    fileName: file,
    reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, experimentalDecorators: true },
  });
  return !(out.diagnostics || []).some((d) => d.category === ts.DiagnosticCategory.Error);
}

const [, , cmd, ...args] = process.argv;

if (cmd === "gen") {
  const [seed, count, outFile] = args;
  const files = execFileSync("git", ["ls-files", "libs", "apps", "bitwarden_license"], { encoding: "utf8", maxBuffer: 1 << 28 })
    .split("\n")
    .filter((f) => f.endsWith(".ts") && !EXCLUDE_PATH.test(f))
    .sort();
  const rnd = mulberry32(Number(seed));
  for (let i = files.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [files[i], files[j]] = [files[j], files[i]];
  }
  const mutants = [];
  for (const file of files) {
    if (mutants.length >= Number(count)) break;
    const text = fs.readFileSync(file, "utf8");
    const sites = sitesOf(file, text);
    if (sites.length === 0) continue;
    const s = sites[Math.floor(rnd() * sites.length)];
    const mutated = text.slice(0, s.start) + s.to + text.slice(s.end);
    if (!syntaxOk(file, mutated)) continue;
    mutants.push({ id: `m${String(mutants.length + 1).padStart(2, "0")}`, file, ...s });
  }
  fs.writeFileSync(outFile, JSON.stringify(mutants, null, 2));
  console.error(`${mutants.length} mutantes de ${files.length} arquivos candidatos`);
  for (const m of mutants) console.error(`${m.id} ${m.file}:${m.line} ${m.op}: ${m.from} -> ${m.to}`);
} else if (cmd === "apply") {
  const [list, id] = args;
  const m = JSON.parse(fs.readFileSync(list, "utf8")).find((x) => x.id === id);
  if (!m) throw new Error(`mutante ${id} nao existe`);
  const text = fs.readFileSync(m.file, "utf8");
  if (text.slice(m.start, m.end) !== m.from) throw new Error(`o arquivo ${m.file} nao bate com o mutante ${id}`);
  fs.writeFileSync(m.file, text.slice(0, m.start) + m.to + text.slice(m.end));
  console.log(m.file);
} else {
  console.error("uso: mutate.mjs gen <seed> <n> <saida> | apply <lista> <id>");
  process.exit(2);
}
