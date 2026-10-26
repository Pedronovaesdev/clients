#!/usr/bin/env bash
# Para cada mutante do shard: aplica o bug, roda o seletor ANTIGO (tsc) e o NOVO
# (bundle esbuild) e compara modo e lista de testes. Nao roda Jest.
#   bash eval/comparar.sh <shard> <total_shards>      (TGS_OLD, TGS_NEW, TS_FROM, GRAPHIFY)
set -uo pipefail
export LC_ALL=C
SHARD="$1"; NSH="$2"
mkdir -p res
BASE="$(git rev-parse HEAD)"
mapfile -t IDS < <(jq -r '.[].id' eval/mutants.json)

sel() { # $1 pasta da ferramenta, $2 prefixo de saida
  rm -rf .selector-out
  local t0=$(date +%s)
  GITHUB_STEP_SUMMARY=/dev/null TGS_NO_BUILD=1 bash "$1/selector/bin/select-tests.sh" --project . --lang angular \
    --base HEAD~1 --head HEAD --dry-run > "work/$2.log" 2>&1 || true
  echo $(( $(date +%s) - t0 )) > "work/$2.t"
  cat .selector-out/mode.txt > "work/$2.mode" 2>/dev/null || echo fail-safe > "work/$2.mode"
  sort -u .selector-out/selected-tests.txt > "work/$2.sel" 2>/dev/null || : > "work/$2.sel"
}

mkdir -p work
for i in "${!IDS[@]}"; do
  (( i % NSH == SHARD )) || continue
  ID="${IDS[$i]}"
  git reset -q --hard "$BASE"
  FILE="$(TS_FROM="$TS_FROM" node eval/mutate.mjs apply eval/mutants.json "$ID")" || continue
  git -c user.name=eval -c user.email=eval@example.invalid commit -qam "mutante $ID"
  sel "$TGS_OLD" old
  sel "$TGS_NEW" new
  iguais=false
  [[ "$(cat work/old.mode)" == "$(cat work/new.mode)" ]] && cmp -s work/old.sel work/new.sel && iguais=true
  jq -n --arg id "$ID" --arg f "$FILE" --argjson ig "$iguais" \
    --arg mo "$(cat work/old.mode)" --arg mn "$(cat work/new.mode)" \
    --argjson no "$(grep -c . work/old.sel || true)" --argjson nn "$(grep -c . work/new.sel || true)" \
    --argjson to "$(cat work/old.t)" --argjson tn "$(cat work/new.t)" \
    --arg so "$(comm -23 work/old.sel work/new.sel | head -20 | tr '\n' ' ')" \
    --arg sn "$(comm -13 work/old.sel work/new.sel | head -20 | tr '\n' ' ')" \
    '{id:$id,arquivo:$f,iguais:$ig,modo_tsc:$mo,modo_bundle:$mn,sel_tsc:$no,sel_bundle:$nn,t_tsc:$to,t_bundle:$tn,so_no_tsc:$so,so_no_bundle:$sn}' \
    > "res/cmp-$ID.json"
  cat "res/cmp-$ID.json"
done
git reset -q --hard "$BASE"
