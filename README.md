# Komari-CN-RouteTrace

[Komari](https://github.com/komari-monitor/komari) 回程路由檢測插件（插件代號 `cnroute`）。

在 Komari 監控的每台伺服器上，定時追蹤**回程到中國電信 / 聯通 / 移動**的路徑，
把逐跳結果**按 AS 壓縮**顯示，並自動判斷 CN2 GIA / CN2 GT / 163 / 9929 / 4837 / CMIN2 / CMI 等線路。

## 運作方式

```
Komari 後台（插件）──admin:exec──▶ 各台 agent 執行 probe.sh（nexttrace / mtr / traceroute）
       ▲                                     │
       └──── admin:getTaskResultsByTaskId ◀──┘  原始輸出
解析 → 遮罩本機 IP → 合併同 AS 跳點 → 判斷線路 → 存到 data/plugin-data/cnroute/results.json
公開頁面 /api/plugin/cnroute/page/index.html 讀取 /api/cnroute/data
```

## 線路判別方法

規則參考 [oneclickvirt/backtrace](https://github.com/oneclickvirt/backtrace) 與 NodeSeek 社群對 GIA / GT 的討論；
IPv4 / IPv6 的位址歸屬都使用 [bgp.tools](https://bgp.tools) 路由表的宣告前綴（`prefix4.js` / `prefix6.js`，最長前綴比對）。

1. **只看入境那一段**：找出回程第一個進入的中國三網，線路只根據這一段判斷，之後在境內轉交其他電信商的不算。
   例如經 202.97（163）入境後才交給聯通，結果是「電信 163 → 境內轉聯通」，不會判成聯通 4837。
2. **標出交接的國際業者**：經國際業者交給三網時，標籤會寫是誰交接的，例如：
   - `Lumen 轉國內移動`：Lumen（AS3356）直接交給移動當地網，沒經過 CMIN2 / CMI / CMNET 骨幹
   - `NTT 轉電信 CN2 GIA`、`Lumen 轉電信 163 → 境內轉聯通`
   - 機房直接接三網時沒有前綴，例如 `電信 CN2 GIA`、`直連國內移動`
   - 完整的國際段（例如 `Arelion (AS1299) → NTT (AS2914)`）在展開後的「國際段」顯示
3. **位址歸屬看 bgp.tools 前綴，不只看追蹤工具的 ASN**：
   - 例如 CMIN2 的 `223.119.8.0/21` 等段，工具常回報成 CMI（AS58453），會依前綴修正
   - `202.97.128.0/19` 在 BGP 上是聯通 AS4837 宣告的，不會再被當成電信 163
   - 各省網 AS（AS4812 上海電信、AS17621 上海聯通、AS24400 上海移動…）也在表內，用來辨識是哪一家
   - 骨幹互連位址常常不對外宣告（例如 CN2 的 59.43.0.0/16 在 BGP 上查不到），這些才用 backtrace 的備援表
4. **骨幹看網段**：AS4134 / AS4837 / AS9808 同時包含骨幹與省網，只有落在骨幹段才算：
   163 = AS4134 的 202.97.x，4837（169）= 219.158.x，CMNET = 221.183.x / 111.24.x
5. **CN2 GIA / GT**：59.43 之後接上 202.97 → GT；全程 59.43、最後才交給當地電信 → GIA；只看到 1 跳 → 證據不足
6. **聯通 / 移動**：9929 > CUG > 4837；CMIN2 > CMI > CMNET。先經 4837 再進 9929、先經 CMI 再進 CMIN2，標示「混合」
7. **IPv6**：
   - CN2 = `2400:9380:9xxx` 與 240e 內的細分前綴；CTGNet = `2400:9380:axxx`；CMIN2 = `2402:4f00:f000::/36`；CUG = `2401:8a00::/32`
   - 電信 AS4134 宣告的是整片 `240e::/20`，骨幹與省網分不開，只有 `2400:9380:8xxx` 當作 163 骨幹證據（推測）
   - CN2 之後 ≤2 跳 AS4134 就到目的地 → GIA（確認）；更多跳 → GIA（推測）
8. 目的地本身那一跳不算骨幹證據（例如部分目標位址落在 9929 的宣告段內）

每個目標展開後都會顯示「判斷依據」。前綴會變動，可在插件目錄執行 `python3 tools/gen-prefixes.py` 重新產生兩張表。
ICMP 追蹤結果可能和實際 TCP 流量走法不同，結果僅供參考。

## IPv4 / IPv6

插件設定分成「IPv4 檢測」和「IPv6 檢測」兩區，各自有開關、伺服器選擇和目標清單：

- IPv4 預設開啟、IPv6 預設關閉
- 每區的「檢測的伺服器」不選 = 全部；例如 IPv4 測全部、IPv6 只選有 IPv6 的幾台
- 網頁右上角可以切換 IPv4 / IPv6，Telegram 回覆會分成兩段
- 選了 IPv6 但伺服器沒有 IPv6 路由時，會標示「此伺服器沒有 IPv6 路由」
- 預設 IPv6 目標取自 backtrace，只保留明確屬於三網位址段（240e / 2408 / 2409）的 7 個

## 隱私 / 遮罩

- 伺服器本機 IP 只以遮罩後的形式輸出（預設 `203.0.*.*`，可改為 `203.*.*.*` 或全部隱藏）。
- 預設也會遮罩**本機機房所在 AS**內的跳點 IP 和地理位置（這些閘道 IP 也會暴露伺服器網段）。
- 內網跳點顯示為「內網」。
- 在 Komari 設為「隱藏」的伺服器，訪客看不到；未遮罩的原始 IP 不會寫入儲存檔或 API 輸出。

## 安裝

1. 到 [Releases](https://github.com/MbaoWang/Komari-CN-RouteTrace/releases/latest) 下載 `komari-cnroute.zip`。
2. Komari 後台 → 插件 → 匯入這個 zip（更新時重新匯入即可覆蓋，設定與結果會保留）。
3. 啟用時需核准權限：
   - `allowSystemRPC`：下發遠端指令到 agent、讀取伺服器清單
   - `allowRoutes`：提供資料 API
   - `allowHTMLInject`：在首頁顯示浮動按鈕
4. 在插件設定中選擇 IPv4 / IPv6 要檢測的伺服器、目標與間隔。

自行打包：在 repository 根目錄執行

```bash
zip -r komari-cnroute.zip komari-plugin.json script.js lib.js prefix4.js prefix6.js telegram.js float.js probe.sh page README.md
```

## Agent 需求

- Linux，agent **不能**開啟 `--disable-web-ssh`（插件靠遠端執行運作）。
- 至少安裝下列其中一種工具（依序自動選用）：
  - **nexttrace**（推薦，自帶 ASN + 地理位置；有 python3 時輸出會先在 agent 端精簡）
  - **mtr**（`apt install mtr-tiny`；使用 `-z` 查 ASN）
  - **traceroute**（`apt install traceroute`；使用 `-A` 查 ASN）
- 也可在設定中開啟「自動安裝 NextTrace」（會執行官方安裝腳本 `nxtrace.org/nt`）。

## 查看結果

- 直接開 `https://你的面板/api/plugin/cnroute/page/index.html`，或在後台側邊欄點「回程路由」
- **浮動按鈕**：插件設定開啟「在 Komari 首頁顯示浮動按鈕」（預設開），前台右下角（可改左下角）會出現「回程路由」按鈕，
  點擊後以彈出視窗顯示結果。彈出視窗是唯讀的，不提供檢測按鈕；後台、終端機頁面不會出現按鈕
- 需要同時開啟「訪客可查看結果」，訪客才看得到按鈕；關閉時只有登入的管理員看得到
- IPv4 / IPv6 分頁只會列出有被選入該版本檢測的伺服器
- 浮動按鈕需要「HTML 注入」權限，啟用 / 更新插件時會要求核准

## Telegram 機器人

1. 向 [@BotFather](https://t.me/BotFather) 建立機器人，把 Token 填到插件設定「Bot Token」。
2. 對機器人傳 `/id`，它會回你的 chat id；填到「允許的 Chat ID」（多個用逗號分隔，群組 ID 是負數）。
3. 之後只有清單內的 ID 能操作，其他人只會收到「未授權」與自己的 ID。

| 指令 | 說明 |
|---|---|
| `/list` | 伺服器列表與目前線路（附按鈕） |
| `/route <伺服器>` | 最近一次結果；按鈕可展開每個目標的 AS 詳細路徑、或重新檢測 |
| `/trace <伺服器\|all>` | 遠端立即檢測，完成後自動回報 |
| `/trace <伺服器> <IP>` | 從該伺服器追蹤到任意 IP（可在設定中關閉） |
| `/status` | 間隔、檢測中的伺服器等 |

`<伺服器>` 可填 `/list` 的編號、名稱關鍵字或 UUID 開頭。
自動檢測發現某目標的主要線路改變（例如 CN2 GIA → 163）時，會推播給所有允許的 chat。
Komari 主機連不到 Telegram 時，可在「Telegram API 位址」填自建反代。
機器人回覆一樣套用 IP 遮罩規則。

## API

| 方法 | 路徑 | 權限 | 說明 |
|---|---|---|---|
| GET | `/api/cnroute/data` | 訪客（可在設定關閉） | 遮罩後的結果 |
| POST | `/api/cnroute/run[?uuid=…]` | 管理員 | 立即檢測全部或單台 |

## 注意

- 每次檢測都是一次 Komari 遠端執行，會在稽核日誌留下紀錄；間隔最少 5 分鐘。
- 9 個目標每 3 個一組並行，nexttrace 一輪約 1～3 分鐘；逾時可在設定中調整。
- 線路判斷依 bgp.tools 前綴與 59.43.x / 202.97.x 等骨幹網段推斷，僅供參考。

## 授權

本專案以 [GNU General Public License v3.0 或更新版本](LICENSE)（GPL-3.0-or-later）釋出。
你可以自由使用、修改、再散佈，但散佈修改後的版本時必須同樣以 GPL 開放原始碼。

### 第三方資料與參考

- [oneclickvirt/backtrace](https://github.com/oneclickvirt/backtrace)（Apache-2.0）：線路判別規則、未宣告骨幹網段的備援表
  （`lib.js` 的 `PREFIX4_FALLBACK`、CMIN2 網段）與預設回程目標 IP 參考自此專案
- [bgp.tools](https://bgp.tools)：`prefix4.js` / `prefix6.js` 由其公開路由表產生
