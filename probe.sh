#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 MbaoWang
# komari-cnroute 回程探測腳本（由 Komari 插件透過遠端執行下發到 agent）
# 用法: bash probe.sh <tool> <install_nexttrace> <max_hops> <id>=<ip> [<id>=<ip> ...]
#   tool: auto | nexttrace | mtr | traceroute
# 輸出（給插件解析）:
#   ##TOOL <名稱>
#   ##BEGIN <id> <ip> <fmt>      fmt: lines | mtrjson | ntjson | tr
#   ...原始或精簡後輸出...
#   ##END <id>
# 精簡 lines 格式: H|ttl|ip|asn|owner|rtt_ms|geo

TOOL="${1:-auto}"
INSTALL_NT="${2:-false}"
MAXHOP="${3:-30}"
shift 3 2>/dev/null || true

export LANG=C LC_ALL=C
export PATH="$PATH:/usr/local/bin:/usr/sbin:/sbin"
have() { command -v "$1" >/dev/null 2>&1; }

if [ "$INSTALL_NT" = "true" ] && ! have nexttrace && have curl; then
  # 官方安裝腳本（僅在插件設定中開啟「自動安裝 NextTrace」時執行）
  curl -fsSL --max-time 60 https://nxtrace.org/nt 2>/dev/null | bash >/dev/null 2>&1 || true
fi

pick_tool() {
  case "$TOOL" in
    nexttrace|mtr|traceroute) have "$TOOL" && { echo "$TOOL"; return; } ;;
  esac
  for t in nexttrace mtr traceroute; do
    have "$t" && { echo "$t"; return; }
  done
  echo none
}
T="$(pick_tool)"
echo "##TOOL $T"
if [ "$T" = none ]; then
  echo "##ERROR 找不到 nexttrace / mtr / traceroute，請在此伺服器安裝其中之一（建議 nexttrace 或 mtr）"
  exit 2
fi

# nexttrace JSON -> 精簡行（有 python3 才做，否則直接回傳原始 JSON 讓插件解析）
NT_COMPACT='
import json,sys
raw=sys.stdin.read()
s=raw.find("{"); e=raw.rfind("}")
try: d=json.loads(raw[s:e+1])
except Exception:
    sys.stdout.write(raw); sys.exit(0)
def g(o,*ks):
    if not isinstance(o,dict): return None
    low={k.lower():v for k,v in o.items()}
    for k in ks:
        v=low.get(k.lower())
        if v not in (None,""): return v
    return None
hops=g(d,"hops") or []
for i,att in enumerate(hops):
    if isinstance(att,dict): att=[att]
    best=None
    for a in att or []:
        addr=g(a,"address")
        ip=g(addr,"ip") if isinstance(addr,dict) else addr
        if ip: best=(a,ip); break
    ttl=i+1
    if not best:
        print("H|%d|*||||"%ttl); continue
    a,ip=best
    ttl=g(a,"ttl") or ttl
    geo=g(a,"geo") or {}
    asn=str(g(geo,"asnumber","asn") or "").upper().replace("AS","")
    owner=str(g(geo,"owner","isp","whois") or "").replace("|"," ")
    loc=" ".join(str(x) for x in [g(geo,"country"),g(geo,"prov"),g(geo,"city")] if x).replace("|"," ")
    rtt=g(a,"rtt")
    try: rtt="%.1f"%(float(rtt)/1e6)
    except Exception: rtt=""
    print("H|%s|%s|%s|%s|%s|%s"%(ttl,ip,asn,owner,rtt,loc))
'

run_one() {
  local id="$1" ip="$2" out="$3" fam=""
  case "$ip" in *:*) fam="-6" ;; esac
  {
    # IPv6 目標：伺服器沒有 IPv6 路由時直接回報，不浪費時間追蹤
    if [ -n "$fam" ] && have ip && ! ip -6 route get "$ip" >/dev/null 2>&1; then
      echo "##BEGIN $id $ip none"
      echo "##NOTE 此伺服器沒有 IPv6 路由"
      echo "##END $id"
      return
    fi
    case "$T" in
      nexttrace)
        if have python3; then
          echo "##BEGIN $id $ip lines"
          nexttrace -j -q 1 -m "$MAXHOP" "$ip" 2>/dev/null | python3 -c "$NT_COMPACT"
        else
          echo "##BEGIN $id $ip ntjson"
          nexttrace -j -q 1 -m "$MAXHOP" "$ip" 2>/dev/null
        fi ;;
      mtr)
        if mtr --help 2>&1 | grep -q -- '--json'; then
          echo "##BEGIN $id $ip mtrjson"
          mtr $fam -z -n -j -c 2 -m "$MAXHOP" "$ip" 2>/dev/null
        else
          echo "##BEGIN $id $ip mtrtxt"
          mtr $fam -z -n -r -w -c 2 -m "$MAXHOP" "$ip" 2>/dev/null
        fi ;;
      traceroute)
        echo "##BEGIN $id $ip tr"
        traceroute $fam -A -n -q 1 -w 2 -m "$MAXHOP" "$ip" 2>/dev/null \
          || traceroute $fam -n -q 1 -w 2 -m "$MAXHOP" "$ip" 2>/dev/null ;;
    esac
    echo
    echo "##END $id"
  } >"$out" 2>&1
}

TMP="$(mktemp -d 2>/dev/null || echo /tmp/cnroute.$$)"
mkdir -p "$TMP"
n=0
for pair in "$@"; do
  id="${pair%%=*}"; ip="${pair#*=}"
  case "$ip" in *[!0-9a-fA-F:.]*|"") continue ;; esac   # 僅允許 IP，避免注入
  n=$((n+1))
  run_one "$id" "$ip" "$TMP/$n.out" &
  # nexttrace 同時跑太多會互相干擾，每 3 個等一下
  if [ $((n % 3)) -eq 0 ]; then wait; fi
done
wait
for i in $(seq 1 "$n"); do cat "$TMP/$i.out" 2>/dev/null; done
rm -rf "$TMP"
exit 0
