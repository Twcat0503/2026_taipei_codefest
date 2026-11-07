# tools/asr-android

本機語音轉文字（ASR）服務的建置與模型準備說明。App 端程式在 `android/app/src/main/kotlin/com/example/townpass/asr/`，啟停方式與 [LLM 服務](../llm-android/README.md) 相同：start 取得 `baseUrl` 與 `apiKey`，之後以 OpenAI 格式呼叫。ASR 使用音檔 multipart API，不是 LLM 的 chat JSON；兩個服務各自有獨立的 URL 與 key。

模型是 [adi-gov-tw/Taiwan-Tongues-ASR-CE-v1.0](https://huggingface.co/adi-gov-tw/Taiwan-Tongues-ASR-CE-v1.0)（Whisper large-v2 微調）。上游提供 FP16 的 CTranslate2 權重，本目錄的工具把它轉成 whisper.cpp 的 GGML，再量化為 int4（q4_0）。

## 架構

```
WebView / Dart ─ MethodChannel town_pass/asr、bridge asr_start ─▶ AsrServer
                                                                   │
OpenAI 格式 API ◀─ AsrProxy（127.0.0.1、Bearer 驗證、只轉發兩條路由）
                                                                   │ unix socket（App 私有目錄）
                                              whisper-server（libwhisper_server.so，子行程）
```

- whisper-server 沒有 API key，所以只綁 App 私有目錄內的 unix socket，不直接暴露 TCP 服務。
- `AsrProxy` 是唯一的 TCP 入口，只開放 `GET /v1/models` 與 `POST /v1/audio/transcriptions`，其餘路徑回 404。
- 模型不隨 APK 發佈，也不會自動下載。App 只讀取 `files/asr/models/ggml-taiwan-tongues-q4_0.bin`，大小或 SHA-256 不符就拒絕啟動。
- 服務啟動時產生隨機 API key 與 port；執行中重複 start 會沿用同一個服務。stop 後重新啟動會重新產生 key 並分配 port。
- 代理最多同時處理 4 條連線、保留 4 條排隊連線，超出容量會直接關閉連線；停止時一併關閉已接受的連線。子行程異常結束後再次 start，會先清理舊代理再啟動新服務。
- WebView 只有白名單來源的主框架可以控制服務；只有 start 回覆包含 key，status 與 stop 不包含（見 `lib/util/web_message_handler/local_ai_origin.dart`）。

## API

base URL 由 start 回傳，格式為 `http://127.0.0.1:<port>/v1`。

| 方法 | 路徑 | 說明 |
|---|---|---|
| GET | `/v1/models` | 模型列表；需要 `Authorization: Bearer <apiKey>` |
| POST | `/v1/audio/transcriptions` | multipart/form-data；需要 Bearer |

轉寫欄位：

- `file`（必填）：音檔。whisper.cpp 內建的 miniaudio 會解碼並自動降混、重新取樣為 16 kHz；WAV（44.1 kHz 立體聲）已在模擬器上測試，MP3、FLAC 依 miniaudio 的預設解碼器支援，但尚未實測。**不支援 m4a／AAC**。
- `language`：小寫的 Whisper 語言代碼，預設 `auto`（自動偵測）。可用的代碼見下方〈語言〉，其他值回 400。
- `response_format`：`json`（預設）、`text`、`srt`、`vtt`、`verbose_json`。
- `model`：可省略。服務只載入一個模型，這個欄位不會切換模型。

整個 multipart body 上限 **25 MiB**；必須提供 `Content-Length`，不接受 chunked request。代理會串行轉發推論請求。錯誤回應使用 OpenAI 的格式：`{"error": {"message": "...", "type": "...", "param": null, "code": null}}`。

範例（以 start 回傳的值替換）：

```sh
curl -H "Authorization: Bearer $API_KEY" \
  -F file=@clip.wav -F language=zh -F response_format=json \
  "$BASE_URL/audio/transcriptions"
```

App 端呼叫：

- Dart：`AsrService.start({int? threads})`、`AsrService.stop()`、`AsrService.status()`。
- 網頁（WebView bridge）：`asr_start`、`asr_stop`、`asr_status`，只接受 `kLocalAiAllowedOrigins` 內的來源與主框架。白名單沿用 LLM 的 `http://10.0.2.2:5173`、`http://localhost:5173`、`http://127.0.0.1:5173`；正式網域需經團隊審查後加入。網頁不能指定 threads。
- bridge 請求的 `data.requestId` 若為最多 64 字元的字串，成功與錯誤回覆都會保留；可用來對應非同步請求。

```js
window.flutterObject.postMessage(JSON.stringify({
  name: 'asr_start',
  data: { requestId: 'asr-1' },
}));
// 從 flutterObject 的 message 事件接收 JSON 字串 { name, data }。
// 先檢查 data.running 與 data.error，再使用 data.baseUrl / data.apiKey。
```

這裡提供的是服務控制與音檔 API，不包含錄音 UI、麥克風收音或 VAD 切段。

## 語言

- `language` 接受 Whisper 的 99 種語言代碼（例如 `zh`、`en`）與 `auto`。代碼清單與 whisper.cpp 語言表的 id 0–98 相同，也就是權重 `config.json` 的 `lang_ids`（50259–50357）對應的語言。
- whisper.cpp 的語言表有 `yue`（粵語），但這個模型（large-v2）沒有對應的 token。代理會拒絕 `yue`，避免傳入不相容的語言 token。
- 權重與 tokenizer 沒有 `nan`（閩南語）與 `hak`（客語）的獨立 token，whisper.cpp 也不接受這兩個代碼，因此目前只能用 `zh` 或 `auto`。這是參數限制，不是對台語／客語辨識能力的保證或否定；實際品質仍需代表性音訊評估。

## 準備模型

需求：Python 3 與 numpy（轉換器不需要 torch）、cmake 與 C++ 編譯器（建置 whisper-quantize）。CT2、f16 與 q4_0 權重合計約 7.1 GB，建議至少預留 **8 GB 以上**，另加原始碼、建置產物與套件快取的空間。

下載請使用新的空目錄，模型資料與工具腳本分開放置；不要從下載目錄執行 Python。以下命令從 repo 根目錄執行，`models/ct2` 與 `models/whisper.cpp` 必須尚未存在。

1. 下載 CTranslate2 權重（`model.bin` 為 3,086,913,037 bytes）：

   ```sh
   mkdir -p models
   mkdir models/ct2
   REVISION=46b5eb7ee167ac2fd06cfe02f40e8fac416e5086
   BASE=https://huggingface.co/adi-gov-tw/Taiwan-Tongues-ASR-CE-v1.0/resolve/$REVISION
   for f in model.bin config.json vocabulary.json tokenizer.json preprocessor_config.json; do
     curl -fL "$BASE/$f" -o "models/ct2/$f" || exit 1
   done
   ```

2. 轉成 whisper.cpp GGML（f16）。輸出 3,094,623,691 bytes：

   ```sh
   python -I tools/asr-android/convert_ct2_to_ggml.py models/ct2 models/ggml-taiwan-tongues-f16.bin
   ```

   轉換器只依賴標準庫與 numpy，會把 CT2 的融合 QKV、KV 拆回 whisper.cpp 的張量，並以 numpy 計算 mel filters。

3. 以同一個 whisper.cpp commit 建置 whisper-quantize。App 的 jniLibs 也用這個 commit，請勿混用：

   ```sh
   git clone https://github.com/ggml-org/whisper.cpp models/whisper.cpp
   git -C models/whisper.cpp checkout 727d3e7666485e12450746b523bfb4e7f057cc5e
   cmake -S models/whisper.cpp -B models/whisper.cpp/build -DWHISPER_BUILD_TESTS=OFF
   cmake --build models/whisper.cpp/build --target whisper-quantize -j
   ```

4. 量化為 int4（q4_0）。預期結果為 888,932,891 bytes，SHA-256 `b0c0e9b3bb90f515ea45cd2bb01a06bc45c4a04693b25af23b8b96ab12de79d7`：

   ```sh
   models/whisper.cpp/build/bin/whisper-quantize \
     models/ggml-taiwan-tongues-f16.bin models/ggml-taiwan-tongues-q4_0.bin q4_0
   sha256sum models/ggml-taiwan-tongues-q4_0.bin
   ```

   雜湊不同可能是下載內容、轉換或量化環境不同，必須先確認原因，不要直接略過校驗。App 會拒絕載入不符的檔案。

5. 放進 App 私有目錄（只適用於 debug 建置，因為 `run-as` 需要 debuggable；多裝置時每個 adb 命令都加 `-s <device-id>`）：

   ```sh
   adb shell run-as com.example.townpass mkdir -p files/asr/models
   MSYS_NO_PATHCONV=1 adb push models/ggml-taiwan-tongues-q4_0.bin /data/local/tmp/asr-model.bin
   MSYS_NO_PATHCONV=1 adb shell run-as com.example.townpass cp \
     /data/local/tmp/asr-model.bin files/asr/models/ggml-taiwan-tongues-q4_0.bin
   adb shell run-as com.example.townpass sha256sum files/asr/models/ggml-taiwan-tongues-q4_0.bin
   MSYS_NO_PATHCONV=1 adb shell rm /data/local/tmp/asr-model.bin
   ```

   複製期間需要同時容納兩份模型，並預留 APK 更新空間；確認裝置端雜湊與上方預期值相同後才啟動。Windows 請用 `adb push` 傳輸二進位檔，不要以 `adb shell` 的標準輸入替代。`MSYS_NO_PATHCONV=1` 用來避免 Git Bash 自動改寫 Android 路徑。

   模型第一次啟動時會計算 SHA-256，結果記在 `files/asr/models/<檔名>.verified`，之後若檔案大小、修改時間或預期雜湊有變，會重新計算。

## 建置 whisper-server（jniLibs）

```sh
ANDROID_HOME="$LOCALAPPDATA/Android/Sdk" bash tools/asr-android/build_whisper_server.sh
```

- 預設同時建置 `arm64-v8a` 與 `x86_64`，產物為 `android/app/src/main/jniLibs/<abi>/libwhisper_server.so` 與 `libomp.so`（已列入 `.gitignore`）。
- 需要 cmake、ninja 與 NDK（預設 30.0.16248370，可用 `NDK_VERSION` 覆寫）。`ANDROID_HOME` 或 `ANDROID_NDK_HOME` 至少要設定一個。
- arm64 的 configure 會從 GitHub 取得 KleidiAI 原始碼，第一次需要網路。
- 腳本固定 whisper.cpp commit `727d3e7`。`WHISPER_SRC` 可指定既有的原始碼目錄，`ASR_CACHE_DIR` 可指定建置目錄（請用純 ASCII 路徑）。**切換 `WHISPER_SRC`、`WHISPER_REF` 或 NDK 時，請使用新的 `ASR_CACHE_DIR`**，避免沿用不同來源／工具鏈的 CMake cache。
- 本目錄的 `.gitattributes` 固定 `.sh` 使用 LF，避免 Windows checkout 改為 CRLF 後無法執行。

## 測試

- 單元測試（不需要裝置）：

  ```sh
  fvm flutter test test/asr_service_test.dart test/asr_bridge_test.dart
  ```

  bridge 測試涵蓋來源白名單、主框架限制、requestId、key 僅於 start 回傳，以及拒絕網頁覆寫 threads。

- 整合測試（需要模擬器或實機，且已完成上面的模型與 jniLibs 步驟）：

  裝置除了模型空間，還要預留更新 APK 的空間。建議測試 AVD 使用 10 GB data partition；若安裝時空間不足，Flutter 可能解除安裝再重裝，連同模型與音檔一起清除。

  ```sh
  fvm flutter test integration_test/asr_server_test.dart -d <device-id> --no-uninstall
  ```

  測試需要音檔 `files/asr-test/clip.wav`。可用上游的 warm-up 範例（普通話、44.1 kHz 立體聲、約 11 秒），來源為 <https://raw.githubusercontent.com/adi-gov-tw/Taiwan-Tongues-ASR-CE/main/api/stt_streaming/warm_up.wav>。這個檔案不隨 repo 發佈，授權以上游為準。轉寫結果應包含「硬碟」與「931」。

  放入音檔的方式與模型相同：先建立 `files/asr-test`，再以 `adb push` 與 `run-as cp` 放入 `files/asr-test/clip.wav`，最後刪除暫存檔。整合測試另涵蓋子行程異常重啟、閒置連線上限與畸形 HTTP 標頭；異常重啟案例會刻意終止測試 App 自己啟動的 whisper 子行程。

  `--no-uninstall` 保留測試後的 App 與模型；若省略，Flutter 預設會解除安裝。再次執行前確認 App、模型與音檔都在，必要時先 `adb install -r` 再放入並核對雜湊。

## 已知限制與未驗證項目

- **效能未在實機量測**。模擬器（x86_64）只驗證功能，數字不代表手機。模型約 0.89 GB，載入與推論的記憶體需求與速度待實測。
- 整合測試只驗證一段約 11 秒音檔的服務流程與關鍵文字，不是準確率基準；尚未完成代表性的國語／台語／客語品質評估，也未驗證超過 30 秒的長音檔。
- arm64 建置以 `armv8.2-a+dotprod` 為基準，沒有 dotprod 的機型可能無法執行。
- **模型散布**：轉換與量化後的權重是 [TRAIL-M](https://huggingface.co/adi-gov-tw/Taiwan-Tongues-ASR-CE-v1.0/blob/main/LICENSE) 授權的衍生物，散布時須依條款處理授權、修改聲明與使用限制。目前不發布或託管權重；正式整合散布與 AGPL-3.0 的相容性待團隊確認。whisper.cpp 採 MIT 授權，建置原始碼來源為 <https://github.com/ggml-org/whisper.cpp>。
- 網頁直接 `fetch` 到 `127.0.0.1` 的 CORS、Private Network Access 與 mixed-content 行為尚未在 WebView 驗證。透過 bridge 拿到 URL/key **不代表**後續 HTTP 請求一定會被 WebView 放行，需另行完成整合驗證。
