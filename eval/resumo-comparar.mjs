// Junta res/cmp-*.json e imprime a comparacao tsc x bundle.
import fs from "node:fs";
const dir = process.argv[2] || "res";
const rows = fs.readdirSync(dir).filter((f) => /^cmp-.*\.json$/.test(f))
  .map((f) => JSON.parse(fs.readFileSync(`${dir}/${f}`, "utf8"))).sort((a, b) => a.id.localeCompare(b.id));
const dif = rows.filter((r) => !r.iguais);
const soma = (k) => rows.reduce((s, r) => s + r[k], 0);
console.log("# Seletor tsc x bundle esbuild, 60 mutantes\n");
console.log(`Mutantes comparados: **${rows.length}**. Seleção idêntica (modo e lista): **${rows.length - dif.length}**. Diferentes: **${dif.length}**.\n`);
console.log(`Tempo total de seleção: tsc ${soma("t_tsc")} s, bundle ${soma("t_bundle")} s.\n`);
if (dif.length) {
  console.log("## Diferenças\n\n| Mutante | Arquivo | tsc | bundle | só no tsc | só no bundle |\n|---|---|---|---|---|---|");
  for (const r of dif)
    console.log(`| ${r.id} | ${r.arquivo} | ${r.modo_tsc} ${r.sel_tsc} | ${r.modo_bundle} ${r.sel_bundle} | ${r.so_no_tsc} | ${r.so_no_bundle} |`);
}
console.log("\n## Todos\n\n| Mutante | Modo | Selecionados (tsc / bundle) | Iguais |\n|---|---|---|---|");
for (const r of rows) console.log(`| ${r.id} | ${r.modo_tsc}/${r.modo_bundle} | ${r.sel_tsc} / ${r.sel_bundle} | ${r.iguais ? "sim" : "**NÃO**"} |`);
