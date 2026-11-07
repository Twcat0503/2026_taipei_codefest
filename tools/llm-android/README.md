# 本機 LLM 模組（LFM3-1.7B，OpenAI 相容 API）— Android

在 Android 上以 llama.cpp 的 `llama-server` 執行 LiquidAI **LFM3-1.7B**（Q4_0 QAD，GGUF），
對外提供 OpenAI 格式的 API（`/v1/models`、`/v1/chat/completions`，支援串流）。

## 給其他程式碼調用的介面

| 呼叫端 | 介面 | 說明 |
|---|---|---|
| Dart | `LlmService.start({threads, contextSize, kvCacheType, flashAttention})`、`stop()`、`status()` | `lib/service/llm_service.dart`。`start` 回傳 `baseUrl` 與 `apiKey` |
| WebView（Vue） | `window.flutterObject.postMessage(JSON.stringify({name: 'llm_start'}))` | `llm_start`、`llm_stop`、`llm_status`，只接受 `kLlmAllowedOrigins` 內的來源；不接受網頁端傳入調校參數 |
| 任何已取得金鑰的程式 | `POST {baseUrl}/chat/completions`，`Authorization: Bearer <apiKey>` | OpenAI 格式；`{baseUrl}/models` 列出模型 |

`start` 的參數（都可省略，省略時使用下列預設）：

| 參數 | 預設 | 說明 |
|---|---|---|
| `threads` | 自動 | 依大核數決定（見下方「執行緒」）。可手動指定 1–16 |
| `contextSize` | 4096 | 上下文長度，範圍 512–16384 |
| `kvCacheType` | `q8_0` | KV cache 型別，`q8_0` 或 `f16` |
| `flashAttention` | `true` | 非 `f16` 的 KV 會強制開啟（V 量化需要） |

超出範圍時 `start` 回傳 `phase: error`，不會啟動服務。

回傳的狀態欄位：`phase`（`idle` / `downloading` / `starting` / `running` / `error`）、`running`、`baseUrl`、`model`、`error`。
只有 `start` 會回傳 `apiKey`；`status` 與 `stop` 不回傳。

伺服器的實際啟動參數：`-c <contextSize>`、`-t <threads>`、`-fa on|off`、`-ctk <kv>`、`-ctv <kv>`、`-np 1`、`--jinja`、`--reasoning off`（回覆直接在 `content`，不產生 thinking）、`--no-webui`，綁定 `127.0.0.1` 並以隨機 API key 保護。
實際採用的值會寫進 `llm/llama-server.log` 開頭的 `[launch]` 行。

## 檔案

- `tools/llm-android/build_llama_server.sh`：編譯 `llama-server`，輸出到 `android/app/src/main/jniLibs/<abi>/`
- `lib/service/llm_service.dart`：Dart API 與來源白名單
- `lib/util/web_message_handler/tp_web_message_handler.dart`：`llm_start` / `llm_stop` / `llm_status` 橋接 handler
- `android/app/src/main/kotlin/com/example/townpass/llm/LlmServer.kt`：下載模型、啟動與停止子行程、健康檢查、大核偵測（`CpuTopology`）
- `android/app/src/main/kotlin/com/example/townpass/MainActivity.kt`：MethodChannel `town_pass/llm`
- `android/app/src/main/res/xml/network_security_config.xml`：只允許 `127.0.0.1` / `localhost` 的明文 HTTP
- `test/llm_service_test.dart`（單元測試）、`integration_test/llm_server_test.dart`（端到端，含 f16 替代參數的第二輪）

## 建置

1. 安裝 `git`、`cmake`、`ninja`，以及 Android NDK（本次驗證使用 `30.0.16248370`，可用環境變數 `NDK_VERSION` 覆寫）。
2. 編譯（Git Bash、macOS 或 Linux 皆可）：
   ```sh
   bash tools/llm-android/build_llama_server.sh x86_64      # 模擬器
   bash tools/llm-android/build_llama_server.sh arm64-v8a   # 手機
   ```
   預設兩者都編。腳本會 clone llama.cpp `v0.9.0` 到快取目錄；已有原始碼時可用 `LLAMA_SRC` 指定。
   編譯不從 Hugging Face 下載網頁 UI（`LLAMA_USE_PREBUILT_UI=OFF`），App 以 `--no-webui` 執行，用不到。
3. 產物 `libllama_server.so` 與 `libomp.so` 位於 `android/app/src/main/jniLibs/<abi>/`，已列入 `.gitignore`，不進版本控制。

## 模型

- 第一次啟動時自動下載 `LFM3-1.7B-QAD-Q4_0.gguf`，來源 `huggingface.co/LiquidAI/LFM3-1.7B-GGUF`。
- 大小 1,049,615,680 bytes，SHA-256 `43a7d09a0e9cba91b63eb7052488b9564569bddfd65754d2e426465e572a7452`（已與 HF 的 LFS 雜湊核對）。
- 下載後先驗證大小與 SHA-256，通過才使用；存放在 App 的 `filesDir/llm/models/`。
- 模型**不**隨 APK 發佈（見下方「授權」）。

## 調校（量化、上下文與速度）

以下數字全部在 **x86_64 模擬器**（6 vCPU）量測，Q4_0 QAD 模型，`llama-bench` 的 `±` 為標準差。
**這些數字只用於相對比較，不代表手機**，手機上的最佳值要依「裝置上的量測」重新確認。

**flash attention 與 KV 量化**（pp512 = prefill，tg128 = 解碼，單位 t/s）：

| 設定 | pp512 | tg128 |
|---|---|---|
| fa off、KV f16 | 27.58 ± 0.11 | 12.07 ± 0.46 |
| fa on、KV f16 | 31.98 ± 0.85 | 12.34 ± 1.14 |
| **fa on、KV q8_0（預設）** | **32.39 ± 0.56** | **13.10 ± 1.03** |
| fa on、KV q4_0 | 31.21 ± 0.21 | 12.55 ± 0.75 |

**深度 2048 時的解碼**（tg64 @ d2048）：KV f16 為 8.27 ± 0.89 t/s，**KV q8_0 為 12.26 ± 0.47 t/s**。
這是預設選 q8_0 的主要理由。q4_0 短上下文略慢於 q8_0，且量化誤差較大，所以不開放。

**KV cache 記憶體**（`llama_kv_cache: CPU KV buffer size`，模型權重另計 993.13 MiB）：

| `-c` | KV f16 | KV q8_0 |
|---|---|---|
| 4096 | 48.00 MiB | 25.50 MiB |
| 16384 | 192.00 MiB | 102.00 MiB |

每 token 約 12 KiB（f16）或 6.4 KiB（q8_0）。上下文預設 4096；上限 16384 時 q8_0 的 KV 約 102 MiB，記憶體代價可接受，但解碼速度會隨深度下降，所以不建議預設拉高。

**執行緒數**（fa on、KV q8_0，pp512 / tg128）：2 執行緒 11.35 / 5.21；4 執行緒 19.84 / 9.44；6 執行緒 32.39 / 13.10。
x86 模擬器幾乎線性擴展，但手機的大核數與小核差異大，**預設不能照搬**。預設改為依大核數自動決定。

**Batch**（fa on、KV q8_0，pp512）：`n_batch 512 / n_ubatch 128` 為 34.12 ± 4.34，`2048 / 512` 為 31.21 ± 0.72，差異在誤差內，維持預設。

### 執行緒（自動偵測）

`CpuTopology` 讀取 `/sys/devices/system/cpu/cpu*/cpufreq/cpuinfo_max_freq`，頻率 ≥ 最高頻率 × 0.8 的核心算大核，結果限制在 1–16。
讀不到頻率資訊（例如模擬器）時退回 `min(4, 可用核心數)`。這個規則在常見的三叢集 SoC 上大致對應「1 顆超大核 + 數顆大核」，**在實機上尚未驗證**。

### 在手機上做量測（建議）

1. 編譯 arm64 的 `llama-bench`（與 `llama-server` 同一個建置目錄）：
   ```sh
   cmake --build ~/.cache/townpass-llm/build-v0.9.0-arm64-v8a --target llama-bench
   ```
2. 用 `adb` 推到手機（`llama-bench`、`libomp.so`、模型檔放同一個目錄），然後在手機上執行：
   ```sh
   LD_LIBRARY_PATH=. ./llama-bench -m <model>.gguf -t 4,6,8 -p 512 -n 128 -r 3 -fa 1 -ctk q8_0,f16 -ctv q8_0,f16 -o md
   ```
3. 確認 KleidiAI 使用的 kernel：啟動 App 後看 `llm/llama-server.log`，應有 `kleidiai: primary q4 kernel feature ...` 行（I8MM 或 DOTPROD）。
4. 若要看 KV 大小，可在 `llama-server` 加 `-lv 4`，log 會印出 `llama_kv_cache: CPU KV buffer size`。

## 測試

- 單元測試（不需裝置）：`fvm flutter test test/llm_service_test.dart`
- 模擬器端到端（需先編譯 `x86_64` 版，且模擬器能連到 Hugging Face）：
  `fvm flutter test integration_test/llm_server_test.dart -d <emulator-id>`
  第一輪用預設參數，第二輪用 `kvCacheType: 'f16'`、`flashAttention: false`、`contextSize: 2048`。

## 已知限制與待決事項

- **效能尚未在手機上驗證。** 目前只做過 x86_64 模擬器的功能測試與調校量測，上述數字**不代表手機**。
  執行緒自動偵測、KV 與 flash attention 的預設，都要在實機上用上面的步驟確認。
- 最低支援 Android 9（API 28）。Flutter 專案的 `minSdk` 目前是 Flutter 預設值，尚未與此對齊。
- **授權未決。** 模型標示為 `lfm1.0`；二手說明為 LFM Open License v1.0（年營收 1,000 萬美元以下可免費商用，超過需付費授權）。
  打包進 APK 或對外散布前，需要確認官方授權全文與 AGPL-3.0 的相容性。目前模型只在執行時下載。
- 橋接白名單目前只有開發環境 `http://10.0.2.2:5173` 與 `http://localhost:5173`。正式網域要加入 `kLlmAllowedOrigins` 前需經審查，因為 API key 會交給白名單來源。
- 其他既有的橋接 handler 仍未做來源檢查，這是專案原本就存在的問題，不屬於本模組。
- WebView 中的 https 頁面請求 `http://127.0.0.1` 會遇到混合內容限制，尚未驗證。目前的測試都是 Dart 直接呼叫。
- 下載模型時呼叫 `stop()` 會等到下載結束（操作鎖），還沒實作取消。
