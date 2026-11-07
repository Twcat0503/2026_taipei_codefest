# 第三方元件與授權 · Third-Party Notices

本專案以 [AGPL-3.0](LICENSE) 授權。下列元件來自第三方，依各自的授權條款使用；本文件整理它們的來源與授權，不取代各元件的原始授權條款。

This project is licensed under [AGPL-3.0](LICENSE). The components below come from third parties and are used under their own terms. This file lists where they come from and how they are licensed; it does not replace their original license texts.

最後檢查：2026-11-08（檢查方式見文末）· Last checked: 2026-11-08 (see "How this was checked").

## 上游專案與素材 · Upstream projects and assets

| 元件 Component | 位置 Location | 授權 License | 說明 Notes |
| --- | --- | --- | --- |
| [Town Pass](https://github.com/taipei-doit/TownPass)（臺北市政府資訊局 Taipei City Government DOIT） | repo 根目錄的 Flutter app · the Flutter app at the repo root | GPL-3.0 | 本 repo 以其快照為基礎；GPL-3.0 的部分依 GPLv3 第 13 條併入 AGPL-3.0 的成品。· This repo starts from a snapshot of it; the GPL-3.0 parts are combined into the AGPL-3.0 work under GPLv3 section 13. |
| Town Pass 圖示與圖片 · icons and images | `assets/` | 隨上游 Town Pass · as in upstream Town Pass | 隨快照帶入。· Came with the snapshot. |
| [TownPass-Services](https://github.com/taipei-doit/TownPass-Services) | `frontend/` | 未附授權條款 · no license file | 依城市通開發文件的指示 fork 使用，正式散布前需向臺北市政府資訊局確認授權。· Forked as the Town Pass developer guide instructs; confirm the license with the Department of Information Technology before wider distribution. |
| PingFang TC 字型 · fonts | `fonts/` | Apple 專有字型 · Apple proprietary | 隨上游 Town Pass 快照帶入，**不在本專案的 AGPL-3.0 授權範圍內**，計畫改用開源字型。· Came with the upstream snapshot and is **not covered by this project's AGPL-3.0 license**; to be replaced with an open font. |

## 本機 AI 執行環境 · On-device AI runtimes

這些原始碼在建置時另行取得或內嵌於建置工具，編譯出的 `.so` 不進 git。· Their sources are fetched or vendored at build time; the compiled `.so` files are not committed.

| 元件 Component | 授權 License | 用途 Used for |
| --- | --- | --- |
| [llama.cpp](https://github.com/ggml-org/llama.cpp) | MIT | LFM3 本機推論（`tools/llm-android/`）；BlueMagpie TTS backbone · on-device LLM; TTS backbone |
| [whisper.cpp](https://github.com/ggml-org/whisper.cpp) | MIT | 本機 ASR（`tools/asr-android/`）· on-device ASR |
| [ggml](https://github.com/ggml-org/ggml) | MIT | 張量運算 · tensor library |
| [codec.cpp](https://github.com/mybigday/codec.cpp) | MIT | BlueMagpie TTS 聲碼 · TTS codec (`tools/tts-android/`) |
| cpp-httplib、nlohmann/json | MIT | TTS 本機 HTTP 與 JSON · TTS loopback HTTP and JSON |
| pocketfft | BSD-3-Clause | TTS 訊號處理 · TTS signal processing |
| Android NDK libc++ | Apache-2.0 WITH LLVM-exception | C++ 標準函式庫 · C++ standard library |

## 模型（不包含在本 repo 或 APK）· Models (not included in this repo or the APK)

| 模型 Model | 授權 License | 說明 Notes |
| --- | --- | --- |
| [LFM3-1.7B](https://huggingface.co/LiquidAI)（Liquid AI） | 模型卡標示 `lfm1.0`（二手資料指為 LFM Open License v1.0，全文待確認）· tagged `lfm1.0` (reported as LFM Open License v1.0; full text not yet verified) | 執行時另行下載；打包或散布前需確認授權全文。· Downloaded at run time; check the full license before bundling or redistributing. |
| [Taiwan-Tongues-ASR-CE-v1.0](https://huggingface.co/adi-gov-tw/Taiwan-Tongues-ASR-CE-v1.0)（adi-gov-tw） | [TRAIL-M](https://huggingface.co/adi-gov-tw/Taiwan-Tongues-ASR-CE-v1.0/blob/main/LICENSE) | 需自行轉換與安裝；不發布衍生權重。· Converted and installed by each developer; derived weights are not published. |
| [BlueMagpie-TTS](https://huggingface.co/OpenFormosa/BlueMagpie-TTS)（OpenFormosa） | `other`（限研究與評估）· research and evaluation only | 不散布權重、衍生權重或生成語音。· Weights, derived weights and generated speech are not distributed. |

## 軟體相依 · Software dependencies

- **Web 正式相依**（`frontend/agent-mvp`、`tools/townpass`、`frontend`）：MIT、Apache-2.0、BSD-2-Clause、BSD-3-Clause、ISC。· **Web production dependencies**: MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC.
- **Flutter 套件**（`pubspec.lock`）：直接相依為 MIT、BSD-3-Clause、Apache-2.0；間接相依另有 BSD-2-Clause，以及 3 個只用於 Linux 桌面的 MPL-2.0 套件（`dbus`、`geoclue`、`gsettings`），不會打包進 Android APK。· **Flutter packages**: direct dependencies are MIT, BSD-3-Clause and Apache-2.0; transitive ones add BSD-2-Clause and three Linux-desktop-only MPL-2.0 packages that are not bundled into the Android APK.
- **開發與測試工具**（不隨產品散布）：Playwright（Apache-2.0）、axe-core（MPL-2.0）等。· **Development and test tools** (not shipped): Playwright (Apache-2.0), axe-core (MPL-2.0) and others.
- **離線模型轉換工具**（Python）：PyTorch、NumPy、SciPy（BSD）；PyYAML、gguf（MIT）；tokenizers、safetensors、Transformers、huggingface-hub（Apache-2.0）。· **Offline model conversion tools** (Python): as listed.

## 開放資料 · Open data

App 使用的開放資料依[《政府資料開放授權條款－第1版》](https://data.gov.tw/license)顯名，畫面上每次查詢都標示提供機關、資料集與資料時間；資料集清單見 [README 的資料來源](README.md#資料來源)。

The open data used by the app is attributed under the [Open Government Data License, version 1.0](https://data.gov.tw/license); every lookup shows the provider, dataset and data time. The dataset list is in [the README's data sources](README.en.md#data-sources).

## 檢查方式 · How this was checked

```sh
# Web production dependencies (in frontend/agent-mvp, tools/townpass and frontend)
pnpm licenses list --prod

# Flutter packages: classify each hosted package in pubspec.lock by the LICENSE file in the pub cache
fvm flutter pub get
```

模型與執行環境的授權依各模型卡與 `tools/llm-android/`、`tools/asr-android/`、`tools/tts-android/` 的 README。· Model and runtime licenses follow each model card and the READMEs under `tools/*-android/`.
