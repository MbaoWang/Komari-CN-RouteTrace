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
2. **寫出怎麼交接進中國**：結果頁每格三行——第一行「怎麼交接」、第二行「完整走法」（和第一行相同時不顯示）、第三行接入方式與延遲。

   網路名稱用 ASN 加骨幹名稱：`4134(163)`、`4837(169)`、`9808`、`10099`、`9929`、`CMIN2`、`CMI`、`CTGNet`。
   確定是骨幹時寫 `4134(163)` / `4837(169)`；無法確定時照 AS 寫 `4134` / `4837`；只有真正的省網 AS（例如 4811 上海電信、17621 上海聯通、24400 上海移動）才寫「省網」。
   CN2 那一段（含之前的 163）整段寫成 `CN2 GIA` / `CN2 GT`。

   | 情況 | 第一行 | 第二行 | 第三行 |
   |---|---|---|---|
   | 機房直接接 CN2，全程 59.43 | `CN2 GIA` | | `直連` |
   | NTT 在聖荷西就交給電信 163 的海外節點（218.30.x） | `4134(163)` | `NTT → 4134(163)` | `經 NTT 海外交接` |
   | Lumen 在香港交給 CMI | `Lumen → CMI` | `Lumen → CMI → 9808` | `當地交接` |
   | Lumen → Verizon，Verizon 長途帶到中國交給 169 | `Verizon → 4837(169)` | `Lumen → Verizon → 4837(169)` | `長途承載` |
   | 電信 CTGNet 入境，163 再交給聯通 | `CTGNet → 4134(163) → 4837(169)` | | `直連` |
   | 先經 163 海外節點再進 CN2，交給上海聯通 | `CN2 GT → 聯通省網` | | `直連` |
   | 移動 CMIN2 入境，9808 再交給廣東電信（AS4134） | `CMIN2 → 9808 → 4134` | | `直連` |
   | 移動 CMIN2 入境，9808 再交給電信 | `CMIN2 → 9808 → 4134(163)` | | `直連` |
   | 聯通 CUG 接 9929 | `10099 → 9929` | | `直連` |

   - 國際業者承載了多遠，看它自己最後一跳的延遲（三網的海外交接點常常沒回應，不能用第一個看到的三網跳點）
   - AS4134 / 4837 / 9808 的跳點之後若還有同一家的省網 AS，表示它是骨幹（例如 IPv6 的 `240e:20::`）
   - **海外交接**：國際業者在海外就把流量交給三網（交接點在國外），跨海段走的是三網自己的網路，所以第一行只寫三網的網路，業者寫在小字
   - **當地交接**：在香港 / 國內才交給三網；**長途承載**：國際業者先帶一大段才交接（交接前延遲增加超過設定值，預設 50 ms）；這兩種第一行寫「業者 → 入境網路」
   - 交接點在不在國外，看 nexttrace 回報的地理位置；沒有地理位置時（mtr / traceroute）以延遲判斷
   - 三網在海外的骨幹節點（例如電信 163 在美國的 218.30.x，AS4134）視為該骨幹，不會當成省網
   - 同一家骨幹最後交給自家省網的收尾不寫；移動 CMI / CMIN2 入境後接 9808 再交給移動省網時，第一行省略 9808
   - Telegram 寫成一行，例如 `Verizon → 4837(169) · 長途承載`
   - 延遲比較的是機房第一跳和第一個三網跳點；每一跳取「這跳以及之後所有跳點的最低延遲」，避免路由器回應 ICMP 虛高造成誤判
3. **位址歸屬看 bgp.tools 前綴，不只看追蹤工具的 ASN**：
   - 例如 CMIN2 的 `223.119.8.0/21` 等段，工具常回報成 CMI（AS58453），會依前綴修正
   - `202.97.128.0/19` 在 BGP 上是聯通 AS4837 宣告的，不會再被當成電信 163
   - 各省網 AS（AS4812 上海電信、AS17621 上海聯通、AS24400 上海移動…）也在表內，用來辨識是哪一家
   - 骨幹互連位址常常不對外宣告（例如 CN2 的 59.43.0.0/16 在 BGP 上查不到），這些才用 backtrace 的備援表
4. **骨幹看網段**：AS4134 / AS4837 / AS9808 同時包含骨幹與省網，只有落在骨幹段才算：
   163 = AS4134 的 202.97.x，4837（169）= 219.158.x，CMNET = 221.183.x / 111.24.x
5. **CN2 GIA / GT**：GIA 是全程走 CN2（59.43），最後才交給當地電信；中間經過 163 的就是 GT，包括
   CN2 之前先經過電信 163 的海外節點（例如 218.30.x，AS4134）、或 CN2 之後接上 202.97 骨幹。只看到 1 跳 CN2 → 證據不足
6. **聯通 / 移動**：9929 > CUG > 4837；CMIN2 > CMI > CMNET。先經 4837 再進 9929、先經 CMI 再進 CMIN2，標示「混合」
7. **IPv6**：
   - CN2 = `2400:9380:9xxx` 與 240e 內的細分前綴；CTGNet = `2400:9380:axxx`；CMIN2 = `2402:4f00:f000::/36`；CUG = `2401:8a00::/32`
   - 2400:9380::/32 是電信骨幹 / 國際網設施段：`9xxx` = CN2、`axxx` = CTGNet、`8xxx` = 163；沒有宣告的互連位址（例如香港的 `2400:9380:a009::c`）依同樣規則判斷
   - 電信 AS4134 宣告的是整片 `240e::/20`；163 骨幹互連位址 `240e:0::/32`（相當於 IPv4 的 202.97）另外辨識
   - 移動 CMNET 骨幹互連位址 `2409:8080::/32`
   - 聯通 4837 / 169 骨幹互連位址 `2408:8000::/32`（相當於 IPv4 的 219.158）
   - CN2 之後沒經過 163 骨幹、≤2 跳 AS4134 就到目的地 → GIA（確認）；更多跳 → GIA（推測）
8. 目的地本身那一跳不算骨幹證據（例如部分目標位址落在 9929 的宣告段內）

每個目標展開後都會顯示「判斷依據」。路徑清楚（到達目的地，且交接點前後沒有逾時）時不標「推測」；
只有 IPv6 的 CN2 之後還有多跳 AS4134（分不出是 163 骨幹還是省網）這種路徑再完整也無法斷定的情況，才會保留「推測」。前綴會變動，可在插件目錄執行 `python3 tools/gen-prefixes.py` 重新產生兩張表。
ICMP 追蹤結果可能和實際 TCP 流量走法不同，結果僅供參考。

## 檢測目標

預設使用 [Zstatic CDN](https://www.zstaticcdn.com/) 的各省三網節點當作回程終點（節點清單取自其 `/api/v1/DescribeAllNodes`）：

- 網址格式：`<省份代碼>-<ct|cu|cm>-v4.ip.zstaticcdn.com`，IPv6 把 `v4` 換成 `v6`；節點開放 TCP 80
- 插件設定「Zstatic 省份」填省份名稱或代碼（例如 `北京,上海,廣東` 或 `bj,sh,gd`，簡繁都可以），填「全部」= 31 省
- 網域由伺服器自己解析，CDN 換 IP 也不用改設定
- 每一跳送 3 個探測封包（nexttrace / mtr），避免 202.97 這類骨幹路由器偶爾沒回應就漏掉
- 「追蹤方式」預設 auto：網域目標用 TCP 80（目的地一定會回應），IP 目標用 ICMP；TCP 追蹤需要 root 權限（agent 預設是 root）
- 也可以把「IPv4 / IPv6 目標來源」改成 custom，自行填入目標（每行 `名稱,IP 或網域,ct|cu|cm[,port]`）
- 省份多時可調高「同時追蹤的目標數」；等待時間會依目標數自動放寬

舊版預設的北京 / 上海 / 廣州 DNS 伺服器 IP 取自 oneclickvirt/backtrace，這些主機不一定回應追蹤封包，常出現「未到達」。

## IPv4 / IPv6

插件設定分成「IPv4 檢測」和「IPv6 檢測」兩區，各自有開關、伺服器選擇和目標清單：

- IPv4 預設開啟、IPv6 預設關閉
- 每區的「檢測的伺服器」不選 = 全部；例如 IPv4 測全部、IPv6 只選有 IPv6 的幾台
- 網頁右上角可以切換 IPv4 / IPv6，Telegram 回覆會分成兩段
- 選了 IPv6 但伺服器沒有 IPv6 路由時，會標示「此伺服器沒有 IPv6 路由」
- IPv6 預設也使用 Zstatic 的 IPv6 節點；自訂模式的預設清單取自 backtrace（三網位址段 240e / 2408 / 2409 的 7 個）

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

發布新版：把 `komari-plugin.json` 的 `version` 改成新版本號（例如 `1.0.1`）推到 main，
GitHub Actions 會自動打包並建立 `v1.0.1` 標籤與 Release；發布說明可放在 `.github/release-notes/v1.0.1.md`。

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
- **結果頁版面**：每台伺服器一張卡片，每個地區一行、電信 / 聯通 / 移動各一欄；點任一格展開該路線每個 AS 的詳細路徑與判斷依據。
  自訂目標中名稱沒有「電信 / 聯通 / 移動」字樣的會放在「其他」列
- **浮動按鈕**：插件設定開啟「在 Komari 首頁顯示浮動按鈕」（預設開），前台右下角（可改左下角）會出現 48px 方形圖示按鈕
  （白底黑色線條圖示，深色主題自動反轉，風格與 [Komari-Plugin-UnlockTest](https://github.com/livingfree2023/Komari-Plugin-UnlockTest) 一致），
  點擊後以彈出視窗顯示結果。同一個角落已有其他插件的浮動按鈕（例如 UnlockTest）時，會對齊同一欄、自動排在它上方。
  外觀與 UnlockTest 一致：頁面上有它的按鈕時直接沿用它的圓角、底色、邊框與陰影；沒有時依主題伺服器卡片的圓角決定（與 UnlockTest 相同規則）。
  按鈕可以拖曳移動，位置會記在各自的瀏覽器。彈出視窗是唯讀的，不提供檢測按鈕；後台、終端機頁面不會出現按鈕（包括用 [admin-path](https://github.com/Grandova/Backend-Customize-path-For-Komari) 插件自訂的後台路徑）
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
自動檢測發現線路有意義的改變時，會推播給所有允許的 chat，並列出變了哪一項與原本 / 現在的線路：
交接的國際業者、接入方式、入境網路（CN2 GIA / GT、CTGNet、9929、10099、CMIN2、CMI…）、途中轉給哪家電信商。
國內段只是骨幹與省網的差異（例如 `4134(163)` 與 `電信省網`、`4837(169)` 與 `聯通省網`、`9808` 與 `移動省網`），
多半只是某一跳這次有沒有回應，不會推播。
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

## 語言

支援繁體中文、简体中文、English、日本語。

- **結果頁、浮動按鈕**：跟隨 Komari 面板的語言（面板右上角切換語言後，結果頁與按鈕會跟著換）；沒有設定時依瀏覽器語言
- **插件設定頁**：欄位名稱與說明依後台語言顯示
- **Telegram 機器人**：每位使用者依自己 Telegram 的介面語言回覆，指令選單也依語言顯示；
  線路變更推播用該聊天最後一次互動的語言，還沒互動過的聊天用設定中的「機器人預設語言」
- 結果以語言中立的代碼儲存，同一筆結果可用不同語言顯示；舊版插件留下的結果在下一次檢測前仍以中文顯示

## 字體

- 從首頁浮動按鈕打開時，結果頁直接沿用 Komari 面板主題實際使用的字體與字型檔，換主題也會一致
- 直接開結果頁網址時，參考 [Komari-Theme-LuminaPlus](https://github.com/shanyang242/Komari-Theme-LuminaPlus) 字體順序與文字渲染設定：
  英數字為 [Inter](https://github.com/rsms/inter)（Inter Variable，隨插件打包在 `page/fonts/`，SIL Open Font License 1.1），中文依序為蘋方 / 冬青黑體 / 微軟雅黑

## 授權

本專案以 [GNU General Public License v3.0 或更新版本](LICENSE)（GPL-3.0-or-later）釋出。
你可以自由使用、修改、再散佈，但散佈修改後的版本時必須同樣以 GPL 開放原始碼。

### 第三方資料與參考

- [oneclickvirt/backtrace](https://github.com/oneclickvirt/backtrace)（Apache-2.0）：線路判別規則、未宣告骨幹網段的備援表
  （`lib.js` 的 `PREFIX4_FALLBACK`、CMIN2 網段）與預設回程目標 IP 參考自此專案
- [Zstatic CDN](https://www.zstaticcdn.com/)：預設的各省三網檢測節點
- [bgp.tools](https://bgp.tools)：`prefix4.js` / `prefix6.js` 由其公開路由表產生
- [Inter](https://github.com/rsms/inter)（SIL OFL 1.1）：`page/fonts/inter-latin-wght-normal.woff2`，授權全文見 `page/fonts/Inter-OFL.txt`
