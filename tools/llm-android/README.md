# 本機 LLM 模組（LFM3-VL-2B，OpenAI 相容 API）— Android

在 Android 上以 llama.cpp 的 `llama-server` 執行 LiquidAI 的多模態模型 **LFM3-VL-2B**（語言模型 Q4_0 QAD + 視覺投影檔 mmproj Q8_0，GGUF），
對外提供 OpenAI 格式的 API（`/v1/models`、`/v1/chat/completions`，支援串流與圖片輸入）。

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

伺服器的實際啟動參數：`-m <模型>`、`--mmproj <視覺投影檔>`、`-c <contextSize>`、`-t <threads>`、`-fa on|off`、`-ctk <kv>`、`-ctv <kv>`、`-np 1`、`--jinja`、`--reasoning off`（回覆直接在 `content`，不產生 thinking）、`--no-webui`，綁定 `127.0.0.1` 並以隨機 API key 保護。
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

第一次啟動時自動從 `huggingface.co/LiquidAI/LFM3-VL-2B-GGUF` 下載兩個檔案（大小與 SHA-256 已於 2026-11-08 與 HF 的 LFS 雜湊核對）：

| 檔案 | 用途 | 大小（bytes） | SHA-256 |
|---|---|---|---|
| `LFM3-VL-2B-QAD-Q4_0.gguf` | 語言模型（Quantization-Aware Distillation 的 Q4_0） | 1,049,615,648 | `621c455376cb96a20891697deb9975c6fb47dd5ea98ed3ad1f3b7e8f24f0b1e6` |
| `mmproj-LFM3-VL-2B-Q8_0.gguf` | 視覺投影檔（影像編碼器） | 203,031,872 | `c5c5b58d544a18da919172d2d0368090ea1a4a351b6feb7f8a326a264a5918ab` |

- 下載後先驗證大小與 SHA-256，通過才使用；存放在 App 的 `filesDir/llm/models/`。
- 該目錄內不屬於目前設定的檔案（例如舊版的 `LFM3-1.7B-QAD-Q4_0.gguf`）會在啟動時刪除，避免佔用空間。
- mmproj 選 Q8_0（約 194 MiB），比 F16（約 361 MiB）省記憶體；`LlmConfig(mmproj = null)` 可只做文字推論。
- 模型**不**隨 APK 發佈（見下方「授權」）。

## 圖片輸入

載入 mmproj 後，`/v1/chat/completions` 接受 OpenAI 格式的圖片內容（建議用 data URI，伺服器只綁 loopback、不會替你下載外部網址）：

```json
{
  "model": "lfm3-vl-2b-q4_0",
  "messages": [{
    "role": "user",
    "content": [
      {"type": "text", "text": "這張單據要繳多少錢？"},
      {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64,..."}}
    ]
  }]
}
```

模型卡建議的取樣參數：`temperature 0.1`、`top_k 50`、`top_p 1.0`、`min_p 0.0`、`repeat_penalty 1.1`。
目前 Vue 端只送文字；要讓使用者拍照或選圖，需要另外接相機／檔案選取與前端的訊息格式。

## 調校（量化、上下文與速度）

以下數字全部在 **x86_64 模擬器**（6 vCPU）以前一版的純文字 **LFM3-1.7B** Q4_0 QAD 量測，換成 LFM3-VL-2B 後尚未重測；`llama-bench` 的 `±` 為標準差。
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

- **效能尚未在手機上驗證。** 換成 LFM3-VL-2B 後也還沒在模擬器重測。目前只做過 x86_64 模擬器的功能測試與調校量測，上述數字**不代表手機**。
  執行緒自動偵測、KV 與 flash attention 的預設，都要在實機上用上面的步驟確認。
- 最低支援 Android 9（API 28）。Flutter 專案的 `minSdk` 已對齊 28。
- **授權相容性未決。** 模型採 [LFM Open License v1.0](https://huggingface.co/LiquidAI/LFM3-VL-2B-GGUF/blob/main/LICENSE)：年營收達 1,000 萬美元以上的法人做商業使用不在授權範圍。
  打包進 APK 或對外散布前，需要確認它與 AGPL-3.0 的相容性。目前模型只在執行時下載。
- 橋接白名單目前只有開發環境 `http://10.0.2.2:5173` 、`http://localhost:5173` 與 `http://127.0.0.1:5173`。正式網域要加入 `kLlmAllowedOrigins` 前需經審查，因為 API key 會交給白名單來源。
- 其他既有的橋接 handler 仍未做來源檢查，這是專案原本就存在的問題，不屬於本模組。
- WebView 中的 https 頁面請求 `http://127.0.0.1` 會遇到混合內容限制，尚未驗證。目前的測試都是 Dart 直接呼叫。
- 下載／啟動取消已接入：stop 會使啟動 ticket 失效、斷開下載並清理子行程；前端收到 idle 前不宣稱已停止。

## Agent 整合

Vue 端已新增 PhoneModel；橋接使用 data.requestId 對應回覆，並限制主框架與來源。見 [手機模型契約](../../frontend/agent-mvp/docs/phone-model.md)。原有無 requestId 的 Dart／橋接用法仍可呼叫；新的 adapter 需要回覆包含 requestId。
