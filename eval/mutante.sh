#!/usr/bin/env bash
# Avalia UM mutante: a selecao de testes teria deixado o bug passar?
#
#   bash eval/mutante.sh <id>      (na raiz do repo, com npm ci feito e eval/mutants.json)
#
# Variaveis: TGS (pasta do test-graph), GRAPHIFY (executavel do graphify).
#
# Veredito gravado em res/<id>.json:
#   CAUGHT    um teste selecionado falha com o mutante (e passa sem ele)
#   ESCAPED   os selecionados passam, mas um teste NAO selecionado falha: escape real
#   SURVIVED  nenhum teste da suite detecta o mutante (a selecao nao tem culpa)
#   FULL      a ferramenta mandou rodar a suite completa (nao testa a selecao)
#   INVALID   o mutante nao compila (erro de TypeScript)
#   HANG      estourou o tempo (provavel laco infinito)
set -uo pipefail
export LC_ALL=C   # sort e comm precisam da mesma ordem

ID="$1"
mkdir -p res work
JEST_FLAGS=(--coverage=false --maxWorkers=2 --workerIdleMemoryLimit=1500MiB)
T1="${T_ETAPA1:-45m}"
T2="${T_ETAPA2:-90m}"

FILE="$(node eval/mutate.mjs apply eval/mutants.json "$ID")" || exit 1
MUT="$(jq -c --arg id "$ID" '.[] | select(.id==$id)' eval/mutants.json)"
git -c user.name=eval -c user.email=eval@example.invalid commit -qam "mutante $ID"

write() { # veredito, detalhe(json), etapa1(s), etapa2(s)
  jq -n --argjson m "$MUT" --arg v "$1" --argjson d "${2:-null}" \
    --arg mode "${MODE:-}" --argjson n "${N_SEL:-0}" --argjson tsel "${T_SEL:-0}" \
    --argjson t1 "${3:-0}" --argjson t2 "${4:-0}" \
    '{id:$m.id,arquivo:$m.file,linha:$m.line,operador:$m.op,de:$m.from,para:$m.to,
      veredito:$v,modo:$mode,selecionados:$n,t_selecao:$tsel,t_etapa1:$t1,t_etapa2:$t2,detalhe:$d}' \
    > "res/$ID.json"
  cat "res/$ID.json"
}

# --- selecao (a ferramenta de verdade, com o cache do grafo restaurado) -------
start=$(date +%s)
bash "$TGS/selector/bin/select-tests.sh" --project . --lang angular \
  --base HEAD~1 --head HEAD --dry-run > work/select.log 2>&1 || true
T_SEL=$(( $(date +%s) - start ))
MODE="$(cat .selector-out/mode.txt 2>/dev/null || echo fail-safe)"
cp .selector-out/selected-tests.txt work/selected.txt 2>/dev/null || : > work/selected.txt
cp .selector-out/report.md work/report.md 2>/dev/null || true
N_SEL=$(grep -c . work/selected.txt || true)

if [[ "$MODE" == "full" || "$MODE" == "fail-safe" ]]; then
  write FULL "{\"modo\":\"$MODE\"}"
  exit 0
fi

# roda os arquivos de uma lista; $1 lista, $2 json de saida, $3 tempo limite, $4... flags extras
run_list() {
  local list="$1" out="$2" limit="$3"; shift 3
  local files
  mapfile -t files < "$list"
  [[ ${#files[@]} -gt 0 ]] || { echo '{"testResults":[]}' > "$out"; return 0; }
  timeout "$limit" npx jest "${JEST_FLAGS[@]}" "$@" --json --outputFile="$out" --runTestsByPath "${files[@]}" > work/jest.log 2>&1
}

# falhas genuinas = falham com o mutante e passam sem ele
analisa() { # json do mutante -> imprime o json de falhas.mjs ja descontando o baseline
  local mut="$1" res failed
  res="$(node eval/falhas.mjs "$mut")"
  failed="$(jq -r '.genuine[]' <<<"$res")"
  if [[ -n "$failed" ]]; then
    printf '%s\n' "$failed" > work/falhou.txt
    git checkout -q HEAD~1 -- "$FILE"
    run_list work/falhou.txt work/base.json 20m || true
    git checkout -q HEAD -- "$FILE"
    res="$(node eval/falhas.mjs "$mut" work/base.json)"
  fi
  echo "$res"
}

# --- etapa 1: so os testes selecionados ----------------------------------------
start=$(date +%s)
run_list work/selected.txt work/s1.json "$T1"; rc=$?
T1S=$(( $(date +%s) - start ))
if [[ $rc -eq 124 ]]; then write HANG '{"etapa":1}' "$T1S"; exit 0; fi
R1="$(analisa work/s1.json)"
if [[ "$(jq '.compile|length' <<<"$R1")" -gt 0 ]]; then write INVALID "$R1" "$T1S"; exit 0; fi
if [[ "$(jq '.genuine|length' <<<"$R1")" -gt 0 ]]; then write CAUGHT "$R1" "$T1S"; exit 0; fi

# --- etapa 2: o resto da suite (os testes que a ferramenta NAO escolheu) -------
npx jest --listTests 2>/dev/null | sed "s#^$PWD/##" | sort -u > work/todos.txt
sort -u work/selected.txt > work/sel_ord.txt
comm -23 work/todos.txt work/sel_ord.txt > work/resto.txt
start=$(date +%s)
run_list work/resto.txt work/s2.json "$T2" --bail=1; rc=$?
T2S=$(( $(date +%s) - start ))
if [[ $rc -eq 124 ]]; then write HANG '{"etapa":2}' "$T1S" "$T2S"; exit 0; fi
R2="$(analisa work/s2.json)"
if [[ "$(jq '.compile|length' <<<"$R2")" -gt 0 ]]; then write INVALID "$R2" "$T1S" "$T2S"; exit 0; fi
if [[ "$(jq '.genuine|length' <<<"$R2")" -gt 0 ]]; then write ESCAPED "$R2" "$T1S" "$T2S"; exit 0; fi
write SURVIVED "$R2" "$T1S" "$T2S"
