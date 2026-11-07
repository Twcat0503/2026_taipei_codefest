<!-- PR 標題沿用 Conventional Commits（例：feat: add font size switcher），squash merge 後即為 main 上的 commit message。 -->

## 改了什麼、為什麼

## 如何驗證

<!-- 貼上自檢指令的結果；UI 變更請附 Android 實機或模擬器的截圖／錄影。 -->

## Checklist

- [ ] 一個 PR 只做一件事，沒有夾帶無關變更
- [ ] 已執行所屬棧的自檢指令並將結果貼於上方（Flutter：`fvm flutter analyze`／`fvm flutter test`；前端：`pnpm lint`／`pnpm test`）
- [ ] Flutter 變更已於 Android 裝置／模擬器驗證
- [ ] 設計自檢通過（WCAG 2.1 AA、TalkBack、字級 200%、觸控目標 48dp、語言標示；見 CONTRIBUTING.md「設計規範」）
- [ ] diff 中沒有 API key、token 等機密，也沒有個人環境檔或內部文件（見 CONTRIBUTING.md「個人開發環境與內部文件」）
- [ ] 新增的相依套件為開源且與 AGPL-3.0 相容，並已於內文說明理由

## 相關 issue（若有）

<!-- 例：Closes #12 -->
