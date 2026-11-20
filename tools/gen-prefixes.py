#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 MbaoWang
"""從 bgp.tools 路由表重新產生 prefix4.js 與 prefix6.js（中國三網骨幹相關 ASN 的宣告前綴）。
用法（在插件目錄執行）: python3 tools/gen-prefixes.py
bgp.tools 要求自動化程式帶有可辨識的 User-Agent。"""
import datetime, ipaddress, json, sys, urllib.request

# 骨幹 / 國際網
ASNS = [4809, 23764, 58807, 58453, 10099, 9929, 4134, 4837, 9808]
# 各省網（只用來辨識是哪一家，不代表骨幹）；需與 lib.js 的 FAMILY_ASN 一致
ASNS += [4811, 4812, 4813, 4816, 23650, 23724, 4808, 9800, 17621, 17622, 17623, 17816, 135061,
         24400, 56040, 56041, 56042, 56044, 56046, 56047, 56048]
src = sys.argv[1] if len(sys.argv) > 1 else None  # 可指定已下載的 table.jsonl


def lines():
    if src:
        yield from open(src, "rb")
        return
    req = urllib.request.Request("https://bgp.tools/table.jsonl", headers={"User-Agent": "komari-cnroute prefix generator"})
    with urllib.request.urlopen(req, timeout=300) as r:
        yield from r


by = {4: {a: set() for a in ASNS}, 6: {a: set() for a in ASNS}}
for line in lines():
    if not line.strip().startswith(b"{"):
        continue
    d = json.loads(line)
    if d.get("ASN") in by[4]:
        n = ipaddress.ip_network(d["CIDR"])
        by[n.version][d["ASN"]].add(n)

today = datetime.date.today()
head = f"// 由 bgp.tools table.jsonl（{today} 抓取）產生：中國三網骨幹相關 ASN 的 IPv{{v}} 宣告前綴\n"

# IPv4：[網路位址整數, 前綴長度, ASN]，依前綴長度由長到短（最長前綴優先）
# 同一 ASN 內才合併，不同 ASN 的細分前綴（例如 AS4837 的 202.97.128.0/19）保留
out4 = []
for a in ASNS:
    for n in ipaddress.collapse_addresses(sorted(by[4][a])):
        out4.append([int(n.network_address), n.prefixlen, a])
out4.sort(key=lambda x: -x[1])
with open("prefix4.js", "w") as f:
    f.write(head.format(v=4))
    f.write("// 格式：[網路位址（32 位元整數）, 前綴長度, ASN]，依前綴長度由長到短排序（最長前綴優先）\n")
    f.write("module.exports = [\n" + ",\n".join(json.dumps(x) for x in out4) + "\n];\n")

out6 = []
for a in ASNS:
    for n in ipaddress.collapse_addresses(sorted(by[6][a])):
        out6.append([n.network_address.exploded.replace(":", "")[: (n.prefixlen + 3) // 4], n.prefixlen, a])
out6.sort(key=lambda x: -x[1])
with open("prefix6.js", "w") as f:
    f.write(head.format(v=6))
    f.write("// 格式：[前綴的十六進位字串（不含冒號）, 前綴長度, ASN]，依前綴長度由長到短排序（最長前綴優先）\n")
    f.write("module.exports = [\n" + ",\n".join(json.dumps(x) for x in out6) + ",\n")
    f.write("// 備援：聯通在 2408:8000::/20 內宣告了大量細分前綴但沒有宣告整段，用來辨識「是聯通」（不代表骨幹）\n")
    f.write('["24088", 20, 4837]\n];\n')
print(f"prefix4.js: {len(out4)} 筆, prefix6.js: {len(out6) + 1} 筆", file=sys.stderr)
