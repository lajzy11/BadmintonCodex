# 本機開發與使用者操作指引

## 由 Codex 執行開發

Codex 的內建環境已有 Node.js 與 pnpm，因此我可以直接安裝、測試及啟動專案。這不代表你的 Windows PowerShell 已安裝這些工具。

## 你要自行啟動時

先在 PowerShell 檢查：

```powershell
node --version
pnpm --version
```

若顯示無法辨識，請依序執行：

```powershell
winget install OpenJS.NodeJS.LTS
```

安裝後關閉並重新開啟 PowerShell，再執行：

```powershell
npm install --global pnpm@11.19.0
```

確認 `node --version` 與 `pnpm --version` 都有輸出後，才執行：

```powershell
Set-Location C:\Users\lajzy\Desktop\BadmintonCodex
pnpm dev
```

終端會顯示本機網址，通常是 `http://localhost:5173`。按 `Ctrl+C` 可停止。

目前未連接 Supabase 時會以「展示模式」啟動，登入表單可直接進入活動中心，不會寫入正式帳號資料。

## 目前不需要你操作的項目

- 若所有開發與啟動都交由 Codex執行，不需要為此額外安裝 Node.js 或 pnpm。
- 不需要現在建立 `.env.local`。
- 不需要現在執行 SQL migration。
- 不需要更新全域 pnpm；終端出現新版提示時可以忽略。

## 接上雲端資料庫時需要你的操作

等開發進入 Auth／正式資料階段，我會需要你建立免費 Supabase 專案，因為帳號及專案擁有權必須在你名下。屆時步驟如下：

1. 前往 `https://supabase.com/dashboard` 並登入。
2. 選擇 **New project**。
3. 選擇你的 Organization，輸入專案名稱，例如 `badminton-match-master`。
4. 建立一組安全的 Database Password 並自行保存。
5. Region 選擇離台灣使用者較近的區域。
6. 建立完成後，進入 **Project Settings → API**。
7. 把 Project URL 與 Publishable key 提供給我，或自行填入 `.env.local`：

```powershell
Copy-Item .env.example .env.local
```

```dotenv
VITE_SUPABASE_URL=你的_Project_URL
VITE_SUPABASE_PUBLISHABLE_KEY=你的_Publishable_key
VITE_APP_MODE=connected
```

請不要把 Database Password、Secret key 或 service role key 貼進聊天、前端程式或 `.env.local` 的 `VITE_` 變數。後續需要 Edge Function secret 時，我會提供只在 Supabase Dashboard 儲存的方式。

## 驗證指令

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

四項都通過才視為目前版本可交付。
