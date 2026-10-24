#!/usr/bin/env bash
# Mede uma extracao do graphify e acrescenta uma linha a res/grafo.jsonl.
#
#   bash eval/grafo.sh <cenario>        (na raiz do repo; precisa de TGS e VENV)
#
# Registra: tempo, tamanho do grafo (nos, arestas, MB), tamanho do cache e o
# sha256 do graph.json (para conferir que o grafo e o mesmo com cache frio e quente).
set -uo pipefail

LABEL="$1"
mkdir -p res
start=$(date +%s.%N)
PYTHONHASHSEED=0 "$VENV/bin/python" "$TGS/selector/bin/graphify-fast.py" extract . --no-cluster --code-only > "res/extract-$LABEL.log" 2>&1
rc=$?
end=$(date +%s.%N)

G=graphify-out/graph.json
secs=$(awk -v a="$start" -v b="$end" 'BEGIN { printf "%.1f", b - a }')
nodes=$(jq '.nodes | length' "$G" 2>/dev/null); nodes=${nodes:-0}
edges=$(jq '(.edges // .links) | length' "$G" 2>/dev/null); edges=${edges:-0}
graph_mb=$(du -sm "$G" 2>/dev/null | cut -f1); graph_mb=${graph_mb:-0}
cache_mb=$(du -sm graphify-out/cache 2>/dev/null | cut -f1); cache_mb=${cache_mb:-0}
cache_files=$(find graphify-out/cache -type f 2>/dev/null | wc -l)
sha=$(sha256sum "$G" 2>/dev/null | cut -c1-16)

jq -nc \
  --arg nome "$LABEL" --arg commit "$(git rev-parse --short=10 HEAD)" --arg sha "$sha" \
  --argjson s "$secs" --argjson rc "$rc" --argjson nodes "$nodes" --argjson edges "$edges" \
  --argjson graph_mb "$graph_mb" --argjson cache_mb "$cache_mb" --argjson cache_files "$cache_files" \
  --argjson cpus "$(nproc)" \
  '{cenario:$nome,commit:$commit,segundos:$s,rc:$rc,sha:$sha,nos:$nodes,arestas:$edges,grafo_mb:$graph_mb,cache_mb:$cache_mb,cache_arquivos:$cache_files,cpus:$cpus}' \
  | tee -a res/grafo.jsonl
