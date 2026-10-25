# 2026 Taipei Codefest — Town Pass Workshop

2026 台北秋季程式節工作坊專案。程式碼為 [taipei-doit/TownPass](https://github.com/taipei-doit/TownPass) 的快照（不帶 upstream 歷史），GPL-3.0。

## 技術棧與版本

- Flutter **3.47.6**，版本來源：`.fvmrc`（用 FVM 管理，不要用系統 Flutter）。
- Dart SDK `>=3.13.0 <4.0.0`（見 `pubspec.yaml`）。
- 狀態管理／路由：`get`（GetX）；JSON 序列化：`json_serializable` + `build_runner`；asset 引用由 `flutter_gen_runner` 產生。

## 指令

```sh
fvm install                      # 首次：安裝 .fvmrc 釘選的 Flutter
fvm flutter pub get              # 安裝相依
fvm dart run build_runner build  # 產生 *.g.dart 與 flutter_gen asset 引用（首次必跑）
fvm flutter run                  # 執行
fvm flutter analyze              # lint
fvm flutter test                 # 全部測試
fvm flutter test test/widget_test.dart   # 單一測試檔
```

## 架構入門點

- `lib/main.dart`：進入點。
- `lib/page/<feature>/`：一個功能一個目錄（home、bill、city_service、account…），頁面專屬 widget 放各頁的 `widget/` 子目錄。
- `lib/service/`：服務層；`lib/bean/`：資料模型（多為 JSON serializable）。
- `lib/util/`：共用 UI 元件一律 `tp_` 前綴（`tp_button.dart`、`tp_colors.dart`、`tp_text_styles.dart`…），新共用元件沿用此命名。
- `assets/mock_data/`：mock 資料；`assets/svg/`、`assets/image/` 經 flutter_gen 產生常數，勿手寫 asset 路徑字串。
- `test/`：目前僅 `widget_test.dart`。

## 環境變數

無。資料目前走 `assets/mock_data/`。

## 團隊協作規範

完整規範見 [CONTRIBUTING.md](CONTRIBUTING.md)，重點摘要：

- 不在 `main` 直接開工；切 `feat/`、`fix/`、`docs/` 等 prefix 的 feature branch，經 PR 併入。
- PR 需至少一人 review，由維護者 squash merge；合併前無 CI 門檻，但 PR 內文附 `fvm flutter analyze` + `fvm flutter test` 自檢結果。
- Commit message 用 Conventional Commits（英文，subject ≤72 字元、祈使句、無句號）；一個 commit／PR 一件事。
- 生成檔（`*.g.dart`、`lib/gen/`）已被 gitignore、不進 commit；勿手動編輯，改來源後跑 `build_runner` 於本地產生。
- API key 等機密不進 commit：`.env` 已 gitignore，key 名稱登記 `.env.example`，source code 不硬編碼。
- 新增相依套件須為開源且與 GPL-3.0 相容（MIT／BSD／Apache-2.0），PR 內說明選用理由。

## 已知 gotchas

- 需先接受 Xcode license：`sudo xcodebuild -license accept`，否則 brew／iOS build 會失敗。
- 首次跑不起來多半是沒跑 `build_runner build`（缺 `*.g.dart`／`lib/gen/`）。
- 改 `pubspec.yaml` 的 assets／fonts 後要重跑 `dart run build_runner build` 才更新 flutter_gen 常數。
- 上游 TownPass 持續演進；本 repo 為快照，要對照 upstream 請看 origin repo。
