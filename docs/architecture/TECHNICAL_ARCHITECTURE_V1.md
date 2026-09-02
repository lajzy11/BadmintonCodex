# 羽球零打與排點系統：技術架構 V1

> 對應產品規格：`../product/Badminton_Match_Master_PRD_V2.4.md`  
> 狀態：第一版開發基線  
> 更新日期：2026-08-28

## 1. 技術決策摘要

第一版採用單一 Web App 搭配 Supabase：

- 前端：React、TypeScript、Vite、React Router、TanStack Query。
- UI：以響應式 Web 為主，桌機／平板共用元件；手機改用點選與底部動作列，不實作拖曳。
- 後端：Supabase Auth、PostgreSQL、Row Level Security（RLS）、Realtime、Edge Functions。
- 部署：前端使用可免費部署靜態網站的平台；後端使用 Supabase 免費方案開始。
- 資料來源：正式資料只存在 PostgreSQL；LocalStorage 僅存 UI 偏好、未送出的短期草稿，不作為正式資料庫。
- 第一版不引入獨立應用伺服器，以降低部署、維護及付費成本。

這個架構能支援登入、跨裝置資料、自助報到、即時排點與 Demo LINE Pay；未來新增球團多人管理或公開報名時，不必更換資料庫模型。

## 2. 系統邊界

```text
團主瀏覽器 ── Supabase Auth ──┐
      │                       │
      ├── RLS 查詢／一般編輯 ─┼── PostgreSQL
      ├── Transaction RPC ────┤
      └── Realtime 訂閱 ──────┘

球友掃 QR Code ── Public Edge Functions ── PostgreSQL
                         │
                         └── Demo LINE Pay 狀態機
```

### 2.1 可由前端直接存取的操作

登入後的團主可透過 RLS 直接讀取自己球團的資料，也可直接執行單筆、低風險編輯，例如：

- 編輯活動文字資料、球團預設資料及常用球館。
- 編輯單一球友的備註、級數、性別與方案。
- 調整顯示順序或偏好設定。

### 2.2 必須走交易函式（Database RPC）的操作

同時修改多張資料表、可能發生競爭或需要完整回復的操作，不由前端連續送出多個寫入：

- `create_activity`：建立活動、1–5 個方案、初始球場及預排 1。
- `duplicate_activity`：複製活動設定，不複製名單、付款與對戰紀錄。
- `batch_checkin_and_collect`：批次報到並收款，或僅報到。
- `assign_preview_group`：新增或取代預排成員，處理一次性條件及超時覆寫。
- `start_match_from_preview`：把指定預排安排至指定球場，可跳過前面的預排。
- `finish_match`：完成比賽、寫入比分、清空球場並讓球友回到可排點狀態。
- `cancel_match`：取消進行中的對戰，不建立作廢紀錄類型。
- `archive_activity` / `restore_activity`：封存或還原，仍受最多三個未封存活動限制。
- `end_activity`：團主手動結束活動，停止自動排點及自助報到。

RPC 必須再次驗證 `auth.uid()` 的球團權限；不能只信任前端傳入的 organization 或 activity ID。

### 2.3 必須走 Edge Function 的操作

- 帳號註冊與帳號名稱登入。
- 開啟／關閉自助報到工作階段及建立 QR Code token。
- 未登入球友讀取可認領名單、認領身分及 Demo LINE Pay 付款。
- 需要使用 Supabase secret key 的管理操作。

Secret key 只存在 Edge Function 環境，絕不放入前端 bundle、LocalStorage 或 QR Code。

## 3. 帳號與登入設計

### 3.1 為什麼需要登入轉接層

產品規格使用「英文字母、數字、底線」的帳號名稱，但 Supabase 密碼登入原生識別欄位是 email 或 phone。因此前端不直接把帳號名稱傳給 `signInWithPassword`，而是透過 Edge Function 做轉換。

### 3.2 帳號名稱規則

- 輸入後轉為小寫，大小寫視為同一帳號。
- 正規表示式：`^[a-z0-9_]{4,30}$`。
- 至少包含一個英文字母或數字，不能全部由底線組成。
- 顯示名稱與登入帳號分離，顯示名稱可使用中文。

### 3.3 註冊流程

1. `auth-register` 驗證帳號名稱、密碼與球團名稱。
2. 以伺服器端 `USERNAME_PEPPER` 對正規化帳號做 HMAC，產生不可逆、可重算的內部 email，例如 `{digest}@auth.local.invalid`。
3. 使用 Supabase Admin API 建立已確認的 Auth user；密碼只交由 Auth 儲存。
4. 在單一資料庫交易中建立 `profiles`、`organizations` 與 owner membership。
5. 若第 4 步失敗，Edge Function 補償刪除剛建立的 Auth user。
6. 回傳登入 session；前端不會看到內部 email。

內部 email 不具寄信用途。第一版保留「修改密碼／忘記密碼」介面標示為上線功能，不假裝能寄送重設信。

### 3.4 登入流程

1. `auth-login` 正規化帳號名稱，使用相同 HMAC 算出內部 email。
2. Edge Function 呼叫 Supabase password sign-in。
3. 成功後回傳 session；錯誤統一顯示「帳號或密碼錯誤」，避免洩露帳號是否存在。
4. 依 IP 與帳號 digest 限流；日誌不得記錄密碼、完整 token 或 session。

## 4. 權限與資料所有權

### 4.1 V1 權限模型

- 一個使用者帳號擁有一個球團。
- 只有 owner 可以存取該球團及其活動。
- 資料庫已保留 `admin`、`member` 角色，第一版 UI 不開放新增成員。
- 每個活動以下所有資料都以 `activity_id` 歸屬，包括方案、名單、場地、預排、對戰、付款及自助報到工作階段。

### 4.2 RLS 原則

- 所有 public schema 業務資料表均啟用 RLS。
- 登入者只能讀寫自己擁有的球團資料。
- `anon` 不具任何資料表 policy，不能直接讀取完整名單。
- 公開 QR 流程只透過狹窄的 Edge Function response 取得所需欄位。
- 球團第一次建立由註冊 Edge Function 執行；因 membership 尚不存在，前端不能直接建立 organization。

### 4.3 公開自助報到的資料最小化

雖然第一版依決策直接顯示名單供認領，API 仍只回傳：

- member public claim id
- 姓名與同名辨識標記
- 方案代碼與方案時間
- 是否已被認領

不回傳備註、付款歷程、關係偏好、完整活動會員資料或團主帳號資料。

## 5. 自助報到與 Demo LINE Pay

### 5.1 顯示條件

團主介面及球友入口只有在以下條件同時成立時顯示自助報到：

- 活動帳務已開啟。
- 活動付款方式包含 LINE Pay。
- 球團已完成 Demo LINE Pay 示意設定。
- 團主已開啟此活動的自助報到；允許在活動開始前提前開啟。
- 活動尚未手動結束。

條件不符時不顯示按鈕，不顯示一個永遠無法執行的 disabled 流程。

### 5.2 Token 設計

- 開啟時由伺服器產生至少 256-bit 隨機 token。
- QR Code URL 帶原始 token；資料庫只存 SHA-256 hash。
- 一個活動同時只能有一個未關閉工作階段。
- 關閉、結束活動或重新產生 QR Code 後，舊 token 立即失效。
- public API 比較 hash、工作階段狀態與活動狀態，不以可猜測的 activity UUID 作為憑證。

### 5.3 認領與付款狀態機

```text
選擇姓名 → 確認方案 → 原子認領 → Demo 付款處理中
                                  ├─ 成功：付款完成＋報到完成
                                  └─ 失敗：可重試，不重複認領或重複收款
```

- 認領使用資料庫交易及 row lock，兩支手機不能同時認領同一人。
- Demo 付款仍建立 payment，`environment=demo`，transaction id 以 `DEMO-` 開頭。
- Demo 付款 endpoint 接受 idempotency key；重送同一請求只回傳原結果。
- 第一版點擊付款可直接成功，但畫面保留處理中與成功步驟。

## 6. 即時排點與併發控制

### 6.1 單一真實來源

球場狀態、預排順序、球友出勤狀態及對戰紀錄以資料庫為準。TanStack Query cache 只作顯示加速；Realtime 收到異動後更新或失效相關 query。

活動「到最早方案時間自動進入進行中」採用有效狀態判定：讀取活動時，若資料庫狀態為 scheduled 且目前時間已到最早方案開始時間，畫面立即視為 in progress，並呼叫具條件更新的 `activate_due_activity` RPC 寫回狀態。所有開始比賽及自助報到 API 也使用相同判定，不能依賴某一台瀏覽器剛好在線。活動結束不使用時間自動推導，只能由團主執行 `end_activity`。

### 6.2 自動模式

- 自動模式開關是活動進行中的操作狀態，切換立即生效。
- 演算法一次可計算多組候選，依順序填入預排卡，不要求立刻填滿所有球場。
- 預排球友超過有效時間時，自動模式必須更換；只有找不到任何人選才停止並提示。
- 人工模式可由團主對該球友給予該次預排的超時覆寫，讓他仍可上場。
- `one_time_expired_override` 只跟著該預排名額，不永久改變方案資格。

### 6.3 競爭條件

開始比賽時 RPC 必須鎖定目標球場、預排與四位球友，並驗證：

- 球場目前沒有進行中比賽。
- 四人仍在同一個預排且未被安排到別場。
- 四人未取消、已報到且不在其他進行中比賽。
- 超時者具有團主授予的一次性覆寫；自動模式不能建立覆寫。

任一條件失敗就整筆回復並要求畫面重新同步。

## 7. 資料模型說明

資料庫 migration 位於：

- `supabase/migrations/202608280001_initial_schema.sql`
- `supabase/migrations/202608280002_integrity_guards.sql`

重要模型決策：

- 活動保存 `venue_snapshot`，因此日後修改常用球館不會改掉歷史活動地址。
- 方案使用獨立資料表，最多 A–E 五個；已有成員的方案刪除由 RPC 拒絕或要求統一轉移。
- 成員關係使用正規化資料表，不把綁定／避免同場塞進 JSON array。
- 預排與正式對戰的四位成員各自使用 join table，能在資料庫限制 slot 與重複成員。
- `matches` 保留取消狀態；第一版不提供作廢功能，也不提供保存後修改球員／隊伍。
- 比分只限制 0–99，不強制 21 分或勝兩分；相同比分為「未分勝負」。
- 已取消球友仍保留稽核資料，但排除活動名單人數及應收金額。
- 未出席且標記不予追究者排除應收金額；球券只記付款方式與方案金額，不記張數。

## 8. 建議前端模組

```text
src/
  app/                 路由、session、query client
  features/auth/       註冊、登入
  features/activities/ 活動清單、建立／編輯、複製、總覽
  features/members/    名單、匯入、報到、付款、詳情
  features/dispatch/   球場、預排、自動模式、叫號
  features/matches/    結束比賽、比分、紀錄
  features/self-checkin/ 球友掃碼流程
  features/settings/   球團、Demo LINE Pay、帳號占位功能
  lib/supabase/        client、generated database types
  shared/              共用 UI、格式化、錯誤訊息
```

排點頁狀態不可全部集中在單一大型 component。球場區、預排序列、可排名單與情境工具列各自維護顯示狀態，共享的伺服器狀態交由 query cache 管理。

## 9. 免費方案與成長界線

第一版可以零額外付費完成 Demo，但免費額度不等於永久保證。開發時應：

- 圖片上傳暫不開放，避免 Storage 成本。
- Realtime 只訂閱目前打開的活動，不訂閱整個球團歷史資料。
- 對戰與付款紀錄分頁查詢，不一次載入全部。
- 封存活動仍保留；三活動限制只計算未封存活動。
- 定期檢查 Supabase 專案容量、Realtime 連線及 Edge Function 使用量。

若未來公開報名量或同時場次大幅增加，再評估付費方案、背景工作佇列及獨立應用伺服器。

## 10. 驗證與測試基線

### 10.1 資料庫測試

- 使用 owner A 的 JWT 無法讀寫 owner B 的任何球團或活動資料。
- anon key 無法直接 select 任一業務表。
- 第四個未封存活動建立失敗；封存一個後可再建立。
- 方案跨活動、預排跨活動、球員跨對戰活動與付款跨活動全部失敗。
- 同球場不能同時存在兩場進行中比賽。
- 同球友不能同時存在於兩張預排卡。
- 跨午夜方案可儲存，且 `end_at > start_at`。
- 等分、A 勝、B 勝與無比分時，result 分別正確導出。

### 10.2 流程測試

- 建立活動三步驟、從範本建立（日期預設今天）、複製活動。
- 空名單起始選項：新增單人、匯入、稍後加入。
- 桌機批次「報到並收款」及次要「僅報到」。
- 自助報到提前開啟、重複認領競爭、Demo 付款重送。
- 預排 2／3 跳過前組上場。
- 自動模式遇到超時預排會換人；無候選才停止。
- 活動到最早方案時間自動呈現進行中，但只有團主能手動結束。

### 10.3 UI 尺寸

至少驗證 360px 手機、768px 平板、1280px 桌機。手機不測拖曳；姓名在名單卡、預排卡、球場卡始終是第一視覺層級。

## 11. 建議開發順序

1. 建立 Supabase 專案、套用 migrations、產生 TypeScript database types。
2. 完成 username 註冊／登入 Edge Functions 與 session route guard。
3. 完成球團設定與活動建立／複製／封存。
4. 完成名單、方案、匯入、團主報到及帳務。
5. 完成球場、預排、對戰交易 RPC 及 Realtime 同步。
6. 完成 QR 自助認領與 Demo LINE Pay。
7. 完成總覽、分享文字、匯出及各裝置驗收。

在第 5 步前先用 SQL 測試證明 RLS 與 RPC 競爭條件；否則排點 UI 即使看似正常，多裝置操作仍可能產生重複上場或狀態分裂。
