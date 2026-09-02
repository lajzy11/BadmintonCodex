# Badminton Match Master

羽球零打活動、報到、帳務與排點管理系統。

## 專案結構

```text
src/                  React 前端程式
supabase/migrations/  PostgreSQL schema、RLS 與完整性規則
docs/product/         現行產品規格
docs/architecture/    技術架構與開發決策
docs/planning/        開發規劃
docs/development/     本機環境與操作指引
docs/research/        田調、競品與需求研究
docs/archive/         舊版 PRD
prototype/            V2.3 HTML 操作原型（僅供參考）
data/reference/       參考資料
data/samples/         測試用資料
```

現行規格請以 [PRD V2.4](docs/product/Badminton_Match_Master_PRD_V2.4.md) 為準，技術決策見 [Technical Architecture V1](docs/architecture/TECHNICAL_ARCHITECTURE_V1.md)。

所有新頁面、功能修正與重構都必須遵循 PRD 第 14 章的最新視覺規範；若需求與規範衝突，應先更新 PRD 並取得設計決策，再修改程式碼。

第一次啟動請閱讀 [本機開發與使用者操作指引](docs/development/LOCAL_SETUP.md)。

## 本機啟動

建議使用 Node.js 24、pnpm 11；Codex 內建環境與使用者自己的 PowerShell 是兩套獨立環境。

```bash
pnpm install
Copy-Item .env.example .env.local
pnpm dev
```

尚未填入 Supabase 設定時，應用程式會進入本機展示模式；接上正式專案後再填寫 `.env.local`。

## 常用指令

```bash
pnpm dev
pnpm build
pnpm lint
pnpm typecheck
pnpm test
```
