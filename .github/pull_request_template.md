## 指示

在您提交 pull request 前請先閱讀並遵守以下指示：

- 創建一個 issue 來說明這個 pull request 解決了什麼事，以防我們覺得這項 pull request 不需要納入專案中。

**⚠️👆 在您提交 pull request 前刪除這些指示 👆⚠️**

## pull request 類型

- [ ] Feature
- [ ] Bug Fix

## Checklist

在提交 pull request 前請確認下列事項皆已確認。

- [ ] pull request 將會解決 issue 問題
- [ ] pull request 只解決 issue 提到的問題，並沒有其他額外變更
- [ ] 已執行所屬棧的自檢指令並將結果貼於內文（Flutter：`analyze`／`test`；前端：`pnpm lint`／`pnpm test`）
- [ ] Flutter 變更已於 Android 裝置／模擬器驗證
- [ ] 設計自檢通過（WCAG 2.1 AA、TalkBack、字級 200%、觸控目標 48dp、語言標示；見 CONTRIBUTING.md「設計規範」）
- [ ] diff 中沒有 API key、token 等機密（`.env` 未進 commit）
- [ ] 新增的相依套件為開源且與 GPL-3.0 相容，並已於內文說明理由

## 受影響的 issue

## 額外說明
