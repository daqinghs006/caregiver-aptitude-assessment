# 居服職涯適性自我評估｜匿名統計版

這是獨立於其他系統的專案，包含公開自我評估網頁、需要管理金鑰的匿名統計頁面、Cloudflare Worker API 及 D1 資料表。

## 功能與限制

- `index.html`：八題情境、1～3 分計分、8～24 分三區間、自動顯示個人結果。當 API 配置完成時，作答完整後會匿名回傳八題分數；同一次作答修改答案只更新同一筆紀錄。失敗時會明確告知並可重試。
- `admin.html`：管理員輸入部署時設定的金鑰，查看總回覆份數、整體平均、最高／最低分、8～24 分各分數份數、三種適性級距及 8 項能力平均與 1/2/3 分份數；可匯出 UTF-8 BOM CSV，用 Excel 開啟。
- `cloudflare/worker.js`：公眾可匿名提交；統計及 CSV 需持有管理金鑰，答案由伺服器重新計算總分。僅允許指定網頁來源的瀏覽器跨網域存取。
- `cloudflare/schema.sql`：D1 資料表及索引。資料庫不保存姓名、電話、電子郵件、IP、User-Agent。Cloudflare 基礎設施本身可能留存其他請求記錄，請檢查其記錄政策。

**重要**：這是自我探索，不是正式測驗，不能單憑結果決定僱用。匿名回覆數 ≠ 去重後的人數；沒有帳號就無法嚴格阻擋重複填答或惡意提交。必要時在後端額外加 Cloudflare Turnstile 和速率限制。

## 第 1 步：GitHub Pages（公開前端）

在 GitHub 專案 `daqinghs006/caregiver-aptitude-assessment` → Settings → Pages → Build and deployment：
- Source：Deploy from a branch
- Branch：main
- Folder：/(root)
- Save

成功後網址：`https://daqinghs006.github.io/caregiver-aptitude-assessment/`

統計後台網址：`https://daqinghs006.github.io/caregiver-aptitude-assessment/admin.html`

此時後台尚不能取得任何資料；需要完成以下 Cloudflare 步驟。

## 第 2 步：Cloudflare D1 資料庫

1. 登入 Cloudflare，前往 Workers & Pages → D1（或 Storage & databases → D1），建立 D1 資料庫，名稱建議 `caregiver-assessment`。
2. 到 D1 的 Console / Query 視窗，**執行 `cloudflare/schema.sql` 中的全部 SQL**（或用 Wrangler 命令導入）。
3. 記錄此 D1 資料庫（綁定名稱需為 `DB`）。

**Wrangler CLI 方案**（需已有 npm、Cloudflare 帳號權限）：

```bash
cd cloudflare
npx wrangler login
npx wrangler d1 create caregiver-assessment
```

把 `cloudflare/wrangler.jsonc` 的 `database_id` 改成上一指令回傳的真實 UUID。然後：

```bash
npx wrangler d1 execute caregiver-assessment --remote --file=./schema.sql
```

**不要**把帳號金鑰、管理金鑰寫進 `wrangler.jsonc` 或任何公開程式碼。

## 第 3 步：部署 Cloudflare Worker

**Wrangler 方案**：

```bash
cd cloudflare
npx wrangler deploy
npx wrangler secret put ADMIN_TOKEN
```

設定 `ADMIN_TOKEN` 為自行保管、**至少 24 字元（建議 40 字元以上）**的隨機管理金鑰。指令會要求在終端機輸入金鑰；不要提交到 GitHub 或傳給其他人。

**Cloudflare 網頁控制台方案**：建立名為 `caregiver-assessment-api` 的 Worker，貼上 `cloudflare/worker.js`，部署後：
- Settings → Bindings：新增 D1 database binding，變數名必須是 `DB`，選擇上一階段 D1 資料庫。
- Settings → Variables and Secrets：新增 secret `ADMIN_TOKEN`（至少 24 字元）；新增一般變數 `ALLOWED_ORIGIN`=`https://daqinghs006.github.io`。
- 重新部署，使綁定和設定生效。

部署後用瀏覽器開啟 `https://<實際 Worker 網址>/api/health`，預期回傳：`{"ok":true,"storage_ready":true}`。

## 第 4 步：連接網頁與 API

開啟根目錄的 `config.js`，設定為實際公開 Worker HTTPS 網址：

```js
window.CAREGIVER_API_BASE = 'https://caregiver-assessment-api.YOUR-SUBDOMAIN.workers.dev';
```

`config.js` 是公開檔案，**只能寫 Worker 網址，絕對不可以包含管理員金鑰**。重新提交 GitHub，等待 Pages 部署完成。然後進行端到端測試：

1. 用一般瀏覽器填好 8 題，確認個人分數與「已匿名回傳」字樣。
2. 開啟 `admin.html`，以 `ADMIN_TOKEN` 登入，確認累計為 1 份且平均分數與剛才作答相同。
3. 回到原頁修改一題，確認仍是 1 份，平均分數更新。
4. 使用重新填寫按鈕再做一份，確認總回覆變 2 份。
5. 匯出 CSV，使用 Excel 開啟檢查中文欄位、八項分數與總分。
6. 錯誤的管理金鑰應得到 401，無法查詢統計或匯出。

## 安全性與營運注意事項

- 管理金鑰由 Cloudflare Secret 保存；前端在登入期間僅於記憶體保存，不使用 localStorage、sessionStorage 或 URL 傳遞金鑰，頁面重整必須重新登入。
- Worker 僅在已驗證授權時提供統計及 CSV。GitHub 上的公開程式本身沒有資料庫權限。
- 設定允許來源不是阻擋程式直接請求的防線。正式公開招募或較大流量時，請加 Cloudflare Turnstile、WAF／速率限制與資料保留期限。
- 一個頁面填完八題後，同次頁面中的修改使用同一匿名 ID；重新填寫會產生新 ID。匿名無法驗證是否為同一個人。
- CSV 一次匯出上限 20,000 筆（超過會提示需分批功能），避免一次載入過多資料。
- HTTPS／CORS 限制為 `https://daqinghs006.github.io`，適用該帳號下的 GitHub Pages 網站；若未來改自訂網域，需要一起更新 Worker 的 `ALLOWED_ORIGIN`。
- 定期備份 D1，限制 Cloudflare 管理帳號權限，遵循臺灣個資法及適當的告知與保存政策。

## 專案檔案

- `index.html` — 填答及個人結果
- `admin.html` — 受密碼保護的管理統計前端
- `config.js` — 唯一需要填入公開 Worker URL 的前端設定
- `cloudflare/worker.js` — API 後端
- `cloudflare/schema.sql` — D1 Schema
- `cloudflare/wrangler.jsonc` — Wrangler 部署設定範本