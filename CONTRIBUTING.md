# 貢獻指南（Contributing Guide）

2026 台北秋季程式節工作坊的團隊協作規範。本 repo 為 [taipei-doit/TownPass](https://github.com/taipei-doit/TownPass) 快照，授權 GPL-3.0，所有貢獻同樣以 GPL-3.0 釋出。

環境需求與建置指令見 [AGENTS.md](AGENTS.md)（FVM 釘選 Flutter 版本，首次必跑 `build_runner`）。

## 開發流程

1. **不要直接在 `main` 上開工。** 先從最新 `main` 切出 feature branch，命名：
   - `feat/<short-name>`：新功能
   - `fix/<short-name>`：修 bug
   - `docs/<short-name>`：文件
   - `refactor/<short-name>`、`chore/<short-name>`：其他
2. 本地開發、自測（見下方「提交前自檢」）。
3. 開 PR 到 `main`，一個 PR 只做一件事。
4. **PR 需至少一位 reviewer approve**，由維護者以 **squash merge** 併入 `main`。

## Commit 規範

- 使用 [Conventional Commits](https://www.conventionalcommits.org/)，內文用英文：`feat:` `fix:` `refactor:` `perf:` `test:` `docs:` `chore:`。
- Subject 用祈使句、小寫開頭、不加句號、不超過 72 字元。
- 一個 commit 一件事；commit message 不加 AI 署名行。

## PR 規範

- 標題沿用 Conventional Commits 風格（squash merge 後即成為 `main` 上的 commit message）。
- 內文寫清楚：改什麼、為什麼、如何驗證；UI 變更請附截圖或錄影。
- 合併前無自動化門檻（本 repo 目前無 CI），但請**自行確認**：

  ```sh
  fvm flutter analyze
  fvm flutter test
  ```

  結果貼在 PR 內文即可。

## 生成檔與資料

- `*.g.dart`、`lib/gen/` 為生成檔，**勿手動編輯**；修改來源後執行 `fvm dart run build_runner build`，並將生成結果與來源修改放同一個 commit。
- Asset 一律引用 flutter_gen 常數，不手寫路徑字串。
- 目前資料走 `assets/mock_data/`，新增 mock 資料請維持相同結構與命名。

## 其他

- 發現與本規範不符的既有程式碼，可在 PR 內提出，但不要順手做大範圍重構。
- 問題與討論請開 GitHub Issue。
