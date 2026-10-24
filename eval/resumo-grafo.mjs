// Junta os res/grafo*.jsonl e imprime a tabela de tempo do grafo.
//   node eval/resumo-grafo.mjs res
import fs from "node:fs";
import path from "node:path";

const dir = process.argv[2] || "res";
const rows = [];
const walk = (d) => {
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, f.name);
    if (f.isDirectory()) walk(p);
    else if (f.name.endsWith(".jsonl"))
      for (const l of fs.readFileSync(p, "utf8").split("\n").filter(Boolean)) rows.push(JSON.parse(l));
  }
};
walk(dir);

const fmt = (s) => `${Math.floor(s / 60)}m${String(Math.round(s % 60)).padStart(2, "0")}s`;
const group = (re) => rows.filter((r) => re.test(r.cenario));
const med = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : NaN;
};

console.log("# Tempo de construção do grafo (Bitwarden, GitHub Actions)\n");
console.log(`Runner: ${rows[0]?.cpus ?? "?"} CPUs. Mesmo comando do select-tests.sh: \`graphify-fast.py extract . --no-cluster --code-only\`.\n`);
console.log("| Cenário | Commit | Tempo | Cache | Grafo | Arestas | sha do grafo |");
console.log("|---|---|---|---|---|---|---|");
for (const r of rows.filter((r) => !r.cenario.startsWith("seq_")))
  console.log(`| ${r.cenario} | ${r.commit} | **${fmt(r.segundos)}** (${r.segundos}s) | ${r.cache_mb} MB, ${r.cache_arquivos} arq. | ${r.grafo_mb} MB | ${r.arestas} | \`${r.sha}\` |`);

const seq = rows.filter((r) => r.cenario.startsWith("seq_")).sort((a, b) => a.cenario.localeCompare(b.cenario));
if (seq.length) {
  console.log("\n## Cache acumulado: um commit depois do outro, no mesmo cache\n");
  console.log("Cada linha reaproveita o cache da anterior, como PRs seguidos num CI com cache. Se o cache crescesse até atrapalhar, o tempo subiria ao longo da lista.\n");
  console.log("| # | Commit | Tempo | Cache | Arquivos no cache | Arestas |");
  console.log("|---|---|---|---|---|---|");
  for (const r of seq) console.log(`| ${r.cenario.replace("seq_", "")} | ${r.commit} | **${fmt(r.segundos)}** | ${r.cache_mb} MB | ${r.cache_arquivos} | ${r.arestas} |`);
  const warm = seq.slice(1).map((r) => r.segundos);
  console.log(`\nMediana dos commits com cache quente: **${fmt(med(warm))}**; o primeiro (frio): **${fmt(seq[0].segundos)}**.`);
}

const frios = group(/^frio_head/), quentes = group(/^quente_checkout_novo/);
const shas = new Set(rows.filter((r) => /^(frio_head|quente_)/.test(r.cenario)).map((r) => r.sha));
console.log(`\n**Grafo idêntico entre frio e quente (mesmo commit):** ${shas.size === 1 ? "sim" : `NÃO (${shas.size} versões)`}.`);
if (frios.length && quentes.length)
  console.log(`\n**Frio (mediana):** ${fmt(med(frios.map((r) => r.segundos)))}. **Quente, checkout novo (mediana):** ${fmt(med(quentes.map((r) => r.segundos)))}.`);
