# Badminton Match Master 開發規範

## 規格優先順序

- 現行產品需求以 `docs/product/Badminton_Match_Master_PRD_V2.4.md` 為唯一正式 PRD。
- `docs/archive`、`prototype` 與研究文件只供歷史參考；與現行 PRD 衝突時不得採用。
- 所有 UI 新增、修正與重構必須先閱讀並遵循 PRD 第 14 章「響應式版面與視覺規範」。
- 若新需求與第 14 章衝突，先更新 PRD 並取得設計決策，再進行程式實作；不得建立未記錄的單頁例外。

## UI 實作最低要求

- 重用 `src/styles/global.css` 的語意 Token 與共用元件，不在頁面新增品牌綠色、獨立版寬或重複的按鈕／輸入框規格。
- 登入後桌機頁面的實際內容最大寬度統一為 1040px。
- 綠色只表示成功／完成狀態；主要 CTA、選取、Focus 與連結使用藍色。
- 一般表單維持「欄位名稱＋紅色必填星號／輸入控制」兩行結構，Placeholder 遵循 PRD 14.10。
- 優先使用留白、分隔線、資料列與表格，卡片只保留給具有獨立操作或狀態邊界的單位。
- 間距、文字層級、CTA 層級與響應式驗收依 PRD 14.8–14.14 執行。

## 完成前檢查

- 執行 `pnpm typecheck`、`pnpm lint`、`pnpm test` 與 `pnpm build`。
- 至少檢查 360px 手機、768px 平板與 1280px 桌機，不得依賴 Hover 才能完成核心操作。
