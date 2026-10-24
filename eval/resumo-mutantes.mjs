// Junta res/*.json (um por mutante) e imprime o resumo em Markdown.
//   node eval/resumo-mutantes.mjs res
import fs from "node:fs";
import path from "node:path";

const dir = process.argv[2] || "res";
const rows = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")))
  .sort((a, b) => a.id.localeCompare(b.id));

const count = (v) => rows.filter((r) => r.veredito === v).length;
const caught = count("CAUGHT"), escaped = count("ESCAPED"), survived = count("SURVIVED");
const full = count("FULL"), invalid = count("INVALID"), hang = count("HANG");

// intervalo de Wilson (95%) para a proporcao k/n
function wilson(k, n) {
  if (n === 0) return [0, 0];
  const z = 1.96, p = k / n, d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n), m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [(c - m) / d, (c + m) / d];
}
const pct = (x) => `${(100 * x).toFixed(1)}%`;

const detectaveis = caught + escaped;
const [lo, hi] = wilson(escaped, detectaveis);
const sel = rows.filter((r) => r.veredito !== "FULL" && r.veredito !== "INVALID" && r.veredito !== "HANG");

console.log("# Mutantes: a selecao deixa bugs passarem?\n");
console.log(`Mutantes avaliados: **${rows.length}**. Cada um é uma alteração pequena (operador trocado, condição negada) num arquivo de produção sorteado.\n`);
console.log("| Veredito | Mutantes | Significado |");
console.log("|---|---|---|");
console.log(`| CAUGHT | ${caught} | um teste selecionado falha: o bug seria pego |`);
console.log(`| **ESCAPED** | **${escaped}** | os selecionados passam, mas um teste não selecionado falha: **escape** |`);
console.log(`| SURVIVED | ${survived} | nenhum teste da suíte detecta: a seleção não tem culpa |`);
console.log(`| FULL | ${full} | a ferramenta mandou rodar tudo (seguro por construção) |`);
console.log(`| INVALID | ${invalid} | não compila |`);
console.log(`| HANG | ${hang} | estourou o tempo |\n`);
console.log(`**Taxa de escape:** ${escaped} de ${detectaveis} mutantes que a suíte completa detecta (${pct(detectaveis ? escaped / detectaveis : 0)}; IC 95%: ${pct(lo)} a ${pct(hi)}).\n`);
if (full) console.log(`Os ${full} mutantes em modo FULL ficam fora da conta porque a suíte completa roda.\n`);

if (escaped) {
  console.log("## Escapes\n");
  console.log("| Mutante | Arquivo:linha | Mudança | Selecionados | Teste que falhou fora da seleção |");
  console.log("|---|---|---|---|---|");
  for (const r of rows.filter((x) => x.veredito === "ESCAPED"))
    console.log(`| ${r.id} | ${r.arquivo}:${r.linha} | \`${r.de}\` → \`${r.para}\` | ${r.selecionados} | ${(r.detalhe?.genuine || []).slice(0, 3).join("<br>")} |`);
  console.log("");
}

console.log("## Todos os mutantes\n");
console.log("| Mutante | Veredito | Arquivo:linha | Operador | Selecionados | Seleção | Etapa 1 | Etapa 2 |");
console.log("|---|---|---|---|---|---|---|---|");
const s = (x) => (x ? `${x}s` : "-");
for (const r of rows)
  console.log(`| ${r.id} | ${r.veredito} | ${r.arquivo}:${r.linha} | ${r.operador} | ${r.modo === "selective" ? r.selecionados : r.modo} | ${s(r.t_selecao)} | ${s(r.t_etapa1)} | ${s(r.t_etapa2)} |`);
if (sel.length) {
  const m = sel.map((r) => r.selecionados).sort((a, b) => a - b);
  console.log(`\nTestes selecionados por mutante (sem FULL/INVALID/HANG): mediana ${m[Math.floor(m.length / 2)]}, mínimo ${m[0]}, máximo ${m[m.length - 1]}.`);
}
