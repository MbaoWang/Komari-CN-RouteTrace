#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 MbaoWang
# komari-cnroute 回程探測腳本（由 Komari 插件透過遠端執行下發到 agent）
# 用法: bash probe.sh <tool> <install_nexttrace> <max_hops> <parallel> <id>=<目標>,<port>,<icmp|tcp>,<4|6>[,<封包大小>] ...
#   封包大小：大包測試用（例如 1400 = nexttrace --psize 1400），空白 = 工具預設
#   目標：IP 或網域（網域由這台伺服器自己解析，例如 Zstatic CDN 的 sh-ct-v4.ip.zstaticcdn.com）
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
PAR="${4:-3}"
shift 4 2>/dev/null || true

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
  echo "##ERROR noTool"
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

# 網域解析：依目標版本取 A 或 AAAA
resolve() {
  local h="$1" v="$2" r=""
  if [ "$v" = 6 ]; then
    # getent ahostsv6 在網域沒有 AAAA 時會回傳 ::ffff:<IPv4>（AI_V4MAPPED），必須過濾掉
    r=$(getent ahostsv6 "$h" 2>/dev/null | awk '$1 !~ /^::[fF]{4}:/ && $1 ~ /:/ {print $1; exit}')
    [ -z "$r" ] && have dig && r=$(dig +short AAAA "$h" 2>/dev/null | grep -E '^[0-9a-fA-F:]+$' | grep -iv '^::ffff:' | head -1)
  else
    r=$(getent ahostsv4 "$h" 2>/dev/null | awk '$1 ~ /^[0-9.]+$/ {print $1; exit}')
    [ -z "$r" ] && have dig && r=$(dig +short A "$h" 2>/dev/null | grep -E '^[0-9.]+$' | head -1)
  fi
  echo "$r"
}

run_one() {
  local id="$1" target="$2" port="$3" proto="$4" ver="$5" out="$6" psize="$7" ip fam=""
  {
    ip="$target"
    case "$target" in
      *:*)
        case "$target" in *[!0-9a-fA-F:.]*) ip="$(resolve "$target" "$ver")" ;; esac ;;
      *[!0-9.]*)
        ip="$(resolve "$target" "$ver")" ;;
    esac
    if [ -z "$ip" ]; then
      echo "##BEGIN $id - none"
      echo "##NOTE resolve $target"
      echo "##END $id"
      return
    fi
    case "$ip" in *:*) fam="-6" ;; esac
    # IPv6 目標：伺服器沒有 IPv6 路由時直接回報，不浪費時間追蹤
    if [ -n "$fam" ] && have ip && ! ip -6 route get "$ip" >/dev/null 2>&1; then
      echo "##BEGIN $id $ip none"
      echo "##NOTE noIpv6"
      echo "##END $id"
      return
    fi
    # mtr(8) 與 Linux traceroute(8) 在 TCP SYN 模式下會靜默忽略封包大小參數，只有 nexttrace 支援 TCP 大封包
    if [ "$proto" = tcp ] && [ -n "$psize" ] && [ "$T" != nexttrace ]; then
      echo "##BEGIN $id $ip none"
      echo "##NOTE bigNeedNt $T"
      echo "##END $id"
      return
    fi
    # TCP 模式：送 SYN 到指定 port（例如 Zstatic 節點的 80），目的地一定會回應
    local nt_tcp="" mtr_tcp="" tr_tcp=""
    if [ "$proto" = tcp ]; then
      nt_tcp="-T -p $port"; mtr_tcp="--tcp --port $port"; tr_tcp="-T -p $port"
    fi
    # 大包：封包大小（含 IP 與探測標頭）；traceroute 的封包長度是放在目標後面的參數
    local nt_ps="" mtr_ps="" tr_ps=""
    if [ -n "$psize" ]; then
      nt_ps="--psize $psize"; mtr_ps="-s $psize"; tr_ps="$psize"
    fi
    case "$T" in
      nexttrace)
        if have python3; then
          echo "##BEGIN $id $ip lines"
          nexttrace $nt_tcp $nt_ps -j -q 3 -m "$MAXHOP" "$ip" 2>/dev/null | python3 -c "$NT_COMPACT"
        else
          echo "##BEGIN $id $ip ntjson"
          nexttrace $nt_tcp $nt_ps -j -q 3 -m "$MAXHOP" "$ip" 2>/dev/null
        fi ;;
      mtr)
        if mtr --help 2>&1 | grep -q -- '--json'; then
          echo "##BEGIN $id $ip mtrjson"
          mtr $fam $mtr_tcp $mtr_ps -z -n -j -c 3 -m "$MAXHOP" "$ip" 2>/dev/null
        else
          echo "##BEGIN $id $ip mtrtxt"
          mtr $fam $mtr_tcp $mtr_ps -z -n -r -w -c 3 -m "$MAXHOP" "$ip" 2>/dev/null
        fi ;;
      traceroute)
        echo "##BEGIN $id $ip tr"
        traceroute $fam $tr_tcp -A -n -q 2 -w 2 -m "$MAXHOP" "$ip" $tr_ps 2>/dev/null \
          || traceroute $fam $tr_tcp -n -q 2 -w 2 -m "$MAXHOP" "$ip" $tr_ps 2>/dev/null ;;
    esac
    echo
    echo "##END $id"
  } >"$out" 2>&1
}

TMP="$(mktemp -d 2>/dev/null || echo /tmp/cnroute.$$)"
mkdir -p "$TMP"
n=0
case "$PAR" in ''|*[!0-9]*) PAR=3 ;; esac
[ "$PAR" -lt 1 ] && PAR=1
for pair in "$@"; do
  # 只允許 IP / 網域字元，避免注入
  case "$pair" in *[!A-Za-z0-9.:,=_-]*) continue ;; esac
  id="${pair%%=*}"; rest="${pair#*=}"
  target="${rest%%,*}"; rest="${rest#*,}"
  port="${rest%%,*}"; rest="${rest#*,}"
  proto="${rest%%,*}"; rest="${rest#*,}"
  ver="${rest%%,*}"; psize=""
  case "$rest" in *,*) psize="${rest#*,}" ;; esac
  case "$psize" in *[!0-9]*) psize="" ;; esac
  # 封包大小限制在 28～9000，其餘忽略
  if [ -n "$psize" ] && { [ "$psize" -lt 28 ] || [ "$psize" -gt 9000 ]; }; then psize=""; fi
  [ -z "$target" ] && continue
  case "$port" in ''|*[!0-9]*) port=80 ;; esac
  [ "$proto" = tcp ] || proto=icmp
  [ "$ver" = 6 ] || ver=4
  n=$((n+1))
  run_one "$id" "$target" "$port" "$proto" "$ver" "$TMP/$n.out" "$psize" &
  # 同時跑太多會互相干擾，每 PAR 個等一下
  if [ $((n % PAR)) -eq 0 ]; then wait; fi
done
wait
for i in $(seq 1 "$n"); do cat "$TMP/$i.out" 2>/dev/null; done
rm -rf "$TMP"
exit 0
