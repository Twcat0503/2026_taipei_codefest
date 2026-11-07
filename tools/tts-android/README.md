# BlueMagpie：Android 本機短句 TTS（研究／評估）

本目錄提供模型驗證／轉換、Android native build、**明確 opt-in 的 debug 模型安裝工具**與呼叫範例。推論目標是 **Android 手機本機 CPU**，不是 PC 伺服器：Windows host 只用於離線轉換、編譯及契約測試。Android runtime 不需要 Python，也不會把文字傳到遠端。

此功能獨立於既有 `tts` bridge／系統 `FlutterTts` 朗讀，**不替換既有朗讀**。沒有模型時，應明確提示不可用，不能假裝合成成功；文字資訊與原有系統朗讀仍須保留。

## 授權與使用邊界

- 官方模型為 [OpenFormosa/BlueMagpie-TTS](https://huggingface.co/OpenFormosa/BlueMagpie-TTS)，model card 的 `license` 是 **`other`，不是 MIT**。本流程限研究／評估；在取得必要權利及同意之前，不再散布 checkpoint、衍生權重或生成語音。程式碼開源不等於取得模型、訓練資料、聲音或生成內容的權利。
- 不提供真人 reference audio、speaker embedding 上傳或聲音複製介面；`voice` 僅接受 `default`。不使用真人音色參考做測試。
- Runtime 原始碼依各自授權檔：[codec.cpp MIT](https://github.com/mybigday/codec.cpp/blob/main/LICENSE)、[llama.cpp MIT](https://github.com/ggml-org/llama.cpp/blob/master/LICENSE)、[ggml MIT](https://github.com/ggml-org/ggml/blob/master/LICENSE)。保留上游 notices；vendored cpp-httplib、nlohmann/json 為 MIT，pocketfft 為 BSD-3-Clause；NDK libc++ 依 LLVM 的 Apache-2.0 WITH LLVM-exception 授權。
- 新增 native 相依是上述 codec／backbone 及其既有 HTTP／JSON 元件，目的是在手機完成合成；不新增 Dart 套件，也不引入 PC 交付服務。`install_models.py` 與安裝測試本身只用 Python 標準函式庫；離線轉換才需要下列 Python 套件。PyTorch、NumPy、SciPy 為 BSD 系授權，PyYAML、gguf 為 MIT，tokenizers、safetensors、Transformers、huggingface-hub 為 Apache-2.0；仍須保留安裝版本附帶的授權及第三方 notices。

## 模型與量化範圍

`models.json` 是官方 **revision、runtime pins、檔名、大小與 SHA-256 的單一來源**。下載、轉換與安裝都讀取它；不要自行改 hash 來接受不同來源或不一致產物。`source.revision` 指定官方快照；`runtime.codec_cpp`、`runtime.llama_cpp`、`runtime.ggml` 與 `runtime.tokenizers` 指定相容版本。

| 安裝檔名 | bytes | tensor 類型與量化範圍 |
| --- | ---: | --- |
| `barbet-q8_0-tokenizer.gguf` | 1,166,805,312 | Barbet backbone：183 個 Q8_0、141 個 F32；包含修復後的官方 BPE／特殊 token metadata |
| `codec-q8_0-lmq8.gguf` | 1,089,524,000 | 共 150 個 Q8_0、250 個 F32、75 個 F16；LM-side 為 150 個 Q8_0、92 個 F32，AudioVAE 保留 F16／F32 |

合計 **2,256,329,312 bytes，約 2.26 GB／2.10 GiB 磁碟**。這不是 RAM 用量：載入、KV／Mamba state、工作 graph、音訊緩衝區及 app 都另需記憶體。**Q8_0 不是全 int8**，也不代表每個運算都有整數加速；不承諾實機速度、即時率或可用記憶體門檻。

## Host 準備

以下是 **Git Bash／POSIX shell** 範例，不是 PowerShell 語法。請從 repo 根目錄執行，以自己的絕對路徑替換示例；Windows 的原生 Python／CMake 路徑使用 `C:/...`。建議 repo、runtime 與 build 都放在 ASCII 路徑，避免 Windows 工具對非 ASCII 路徑的限制。不要把模型下載目錄當作工作目錄，也不要將腳本放入其中。

準備 Git（含 submodules）、Python 3.12（參考環境 3.12.9）、CMake ≥3.22、Ninja、C/C++17 toolchain；Windows host 參考使用 MinGW-w64 GCC／G++，將其 bin 加入本次終端的 PATH。Android 另需 SDK platform-tools、NDK 及 FVM 管理的 Flutter。

```bash
# 在 repo 根目錄設定；Windows 可用 pwd -W 取得原生格式的 REPO。
REPO="$(pwd -W)"                   # Linux/macOS 改為 pwd
WORK="C:/tts-work"                 # repo 外、尚不存在的專用工作目錄
mkdir "$WORK"
python -I -m venv "$WORK/venv"
PY="$WORK/venv/Scripts/python.exe"  # POSIX 改為 "$WORK/venv/bin/python"
MANIFEST="$REPO/tools/tts-android/models.json"
CODEC_SOURCE_DIR="$WORK/codec.cpp"
OFFICIAL="$WORK/official"
QUANTIZED="$WORK/quantized"        # convert 會建立，請勿先 mkdir

TOKENIZERS_VERSION=$("$PY" -I -c 'import json,sys; print(json.load(open(sys.argv[1]))["runtime"]["tokenizers"])' "$MANIFEST")
"$PY" -I -m pip install torch==2.15.0 numpy==2.5.4 scipy==1.18.1 \
  PyYAML==6.0.3 safetensors==0.8.0 transformers==5.22.2 \
  huggingface-hub==2.4.0 "tokenizers==$TOKENIZERS_VERSION"
```

上列版本來自轉換環境的 package metadata，不是所有平台的完整 transitive lockfile。`gguf` 的版本是 **0.19.0，但必須從套過 patches 的 pinned llama.cpp 安裝**，不能只裝同版號的未修補 PyPI 套件。下節 configure 後才安裝它。若環境由不含 pip 的工具建立，可另建含 pip 的專用 venv，不要在模型資料目錄內修補環境。

### 1. 只下載五個官方檔案

`pytorch_model.bin`、`audiovae.pth`、`config.json`、`tokenizer.json`、`tokenizer_config.json` 的預期大小與 hash 均在 manifest。官方資料約 8.19 GB；轉換工具另要求輸出磁碟至少 5 GB 可用（不含來源、venv、build 或中間產物），請另外預留空間。

下例只讀取官方 pinned revision 的指定檔案，不下載／執行模型 repo 的 Python，不使用 `trust_remote_code`。來源寫入獨立的新空目錄；失敗後不要把混雜資料當成完整下載。

```bash
"$PY" -I -X utf8 - "$MANIFEST" "$OFFICIAL" <<'PY'
import json, shutil, sys, urllib.request
from pathlib import Path
manifest = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
destination = Path(sys.argv[2])
destination.mkdir(exist_ok=False)
for name in manifest["official"]:
    if Path(name).name != name or "/" in name or "\\" in name:
        raise ValueError("unexpected filename")
    url = f'{manifest["source"]["url"]}/resolve/{manifest["source"]["revision"]}/{name}'
    with urllib.request.urlopen(url, timeout=120) as source, (destination / name).open("xb") as output:
        shutil.copyfileobj(source, output, 1024 * 1024)
PY
"$PY" -I -X utf8 "$REPO/tools/tts-android/model_tools.py" verify official "$OFFICIAL"
```

### 2. 取得 pinned runtime，先 configure 套 patch

```bash
CODEC_REV=$("$PY" -I -c 'import json,sys; print(json.load(open(sys.argv[1]))["runtime"]["codec_cpp"])' "$MANIFEST")
git clone --no-checkout https://github.com/mybigday/codec.cpp.git "$CODEC_SOURCE_DIR"
git -C "$CODEC_SOURCE_DIR" checkout --detach "$CODEC_REV"
git -C "$CODEC_SOURCE_DIR" submodule update --init --recursive

cmake -S "$REPO/tools/tts-android" -B "$WORK/host-configure" -G Ninja \
  -DCODEC_SOURCE_DIR="$CODEC_SOURCE_DIR" -DPython3_EXECUTABLE="$PY" \
  -DCMAKE_C_COMPILER=gcc -DCMAKE_CXX_COMPILER=g++ -DCMAKE_BUILD_TYPE=Release \
  -DBUILD_SHARED_LIBS=OFF -DGGML_NATIVE=OFF -DGGML_OPENMP=OFF \
  -DGGML_CUDA=OFF -DGGML_VULKAN=OFF

LLAMA="$CODEC_SOURCE_DIR/common/third-party/llama.cpp"
"$PY" -I -m pip install "$LLAMA/gguf-py"
```

這個 configure **不是啟動 host TTS server**。它檢查三個 runtime pins，套用本 repo 的 `http-receive-deadline.patch` 與 `mobile-runtime.patch`，透過 codec.cpp 的 `SetupLlamaPatches.cmake` 依序套上上游架構 patches，再套本 repo 的 `bluemagpie-tokenizer.patch`。最後以 manifest 指定的 tokenizers 產生 `bluemagpie-unicode-data.h`，並檢查生成表 SHA-256；已存在但 hash 不符會停止。共用 codec source 的多個 ABI configure 透過同一個跨 process 檔案鎖序列化上述準備階段，build 目錄仍各自獨立。

順序不可反過來：Barbet converter、GGUF 架構與 tokenizer 都依賴 patches。不要以停用 patch／hash 檢查的方式繞過不相容版本。Unicode 表由 configure 呼叫 `generate_bluemagpie_unicode.py`，不必自行產生近似表。

### 3. 建立 quantizer，再轉換

```bash
cmake -S "$LLAMA" -B "$WORK/quantizer-build" -G Ninja \
  -DCMAKE_C_COMPILER=gcc -DCMAKE_CXX_COMPILER=g++ -DCMAKE_BUILD_TYPE=Release \
  -DBUILD_SHARED_LIBS=OFF -DLLAMA_BUILD_COMMON=ON -DLLAMA_BUILD_TOOLS=ON \
  -DLLAMA_BUILD_TESTS=OFF -DLLAMA_BUILD_EXAMPLES=OFF \
  -DLLAMA_BUILD_SERVER=OFF -DLLAMA_BUILD_APP=OFF \
  -DLLAMA_CURL=OFF -DLLAMA_OPENSSL=OFF -DGGML_NATIVE=OFF -DGGML_OPENMP=OFF
cmake --build "$WORK/quantizer-build" --target llama-quantize --parallel 4
QUANTIZER="$WORK/quantizer-build/bin/llama-quantize.exe"  # POSIX 無 .exe

"$PY" -I -X utf8 "$REPO/tools/tts-android/model_tools.py" convert \
  --official "$OFFICIAL" --runtime "$CODEC_SOURCE_DIR" \
  --quantizer "$QUANTIZER" --out "$QUANTIZED"
"$PY" -I -X utf8 "$REPO/tools/tts-android/model_tools.py" verify quantized "$QUANTIZED"
```

`convert` 先驗來源與 revision、拒絕已存在的輸出目錄，再執行下列固定順序；不需要重新下載模型。

1. `convert_barbet_to_gguf.py --src … --config … --out barbet-f16.gguf --outtype f16`。
2. `llama-quantize barbet-f16.gguf barbet-q8_0.gguf Q8_0 4`。
3. `repair_tokenizer.py --source … --official … --out barbet-q8_0-tokenizer.gguf`：只依官方 tokenizer 修復 metadata，不改 tensor bytes。
4. `scripts/convert-to-gguf.py --model-type bluemagpie --checkpoint-path … --output codec-q8_0-lmq8.gguf --outtype F16 --quantization Q8_0 --lm-outtype F16 --lm-quantization Q8_0`。
5. 核對兩個安裝檔的完整 SHA-256。未修復的 `barbet-q8_0.gguf` 是 parity 測試的來源，不是要安裝的 backbone。

官方來源目錄必須**恰好只有 manifest 的五個檔案**；額外 checkpoint、cache 或子目錄都會被拒絕，避免上游 precision detector 遞迴掃到未驗證資料。若已有混雜下載，另外建立乾淨目錄並只複製五個已驗證檔案，不要刪除其他資料或放寬驗證。

所有 Python 子命令都用 `-I -X utf8`，腳本與 checkpoint 分離，且強制 `TORCH_FORCE_WEIGHTS_ONLY_LOAD=1`，清除相反的 `TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD`。`-I` 本身不能防止一般 pickle 執行程式碼；不得停用 weights-only 或為未知物件加入 allowlist 來繞過失敗。不要執行下載目錄內的程式；host 轉換可用 RAM 與手機推論 RAM 是不同需求。

## Android native build 與 APK

本輪 native toolchain 使用 **NDK 30.0.16248370**；目前 `android/app/build.gradle` 的 app NDK pin 是 **29.0.13113456**。兩者不是同一個設定，APK 的 native packaging／libc++ 相容性仍須另外驗證，不能因三個 ELF 產生成功就宣稱 APK 或裝置推論已通過。

`build_tts_server.sh` 的三個必填環境變數是 `ANDROID_NDK_HOME`、`CODEC_SOURCE_DIR`、`TTS_BUILD_DIR`；`TTS_PYTHON` 可選（Unicode 表還沒生成時，指定裝有正確 tokenizers 的 Python）。另外可設定 `JOBS`、`TTS_OUTPUT_DIR`。每個 ABI 使用自己的 build／輸出目錄。

```bash
export ANDROID_NDK_HOME="C:/Android/Sdk/ndk/30.0.16248370"
export CODEC_SOURCE_DIR
export TTS_BUILD_DIR="$WORK/android-build"
export TTS_PYTHON="$PY"
bash "$REPO/tools/tts-android/build_tts_server.sh" arm64-v8a
bash "$REPO/tools/tts-android/build_tts_server.sh" x86_64
```

腳本使用 Ninja、Android API 28、`c++_shared`、Release、CPU-only／保守 ISA，目標為 `townpass-tts-server`。它先以 NDK `llvm-readelf` 檢查三個 ELF，再將以下檔案複製到 `android/app/src/main/jniLibs/<ABI>/`。

- `libtts_server.so`：以 `.so` 檔名包裝的可執行 server。
- `libttsbackbone.so`：隔離 llama／ggml 符號的 backbone。
- `libc++_shared.so`：相同 NDK 的 C++ runtime。若輸出已有不同內容的同名檔，腳本會拒絕覆蓋，先處理其他 native 套件的相容性。

Gradle 使用 legacy JNI packaging，讓 executable 可解壓到 `nativeLibraryDir`。**ELF、APK、checkpoint、GGUF、generated build 產物都不得進 git**。

建置 app 的入口（須另行確認環境／裝置結果）如下，Flutter 一律使用 repo 的 FVM pin。

```bash
fvm install
fvm flutter pub get
fvm dart run build_runner build
fvm flutter build apk --debug --target-platform android-arm64,android-x64
```

## Debug 模型安裝：明確指定裝置、不覆蓋

先自行安裝可 `run-as com.example.townpass` 的 **debug APK**，再由使用者停止 app。只離開畫面或呼叫 `TtsService.stop()` 不代表 app process 已停止；工具檢查 `pidof`，仍在執行就拒絕，**不會自行 force-stop**。安裝期間勿重開 app，勿同時操作該 private 目錄。

```bash
ADB="C:/Android/Sdk/platform-tools/adb.exe"
SERIAL="your-explicit-device-serial"
"$PY" -I -X utf8 "$REPO/tools/tts-android/install_models.py" \
  --adb "$ADB" --serial "$SERIAL" --models "$QUANTIZED"
```

- `--adb` 預設為 PATH 中的 `adb`；`--serial`、`--models` 必填；package 固定，不接受任意 app／remote destination。
- **先在 host 驗完兩檔大小與 SHA-256，才執行任何 adb**。每個命令皆帶 `-s`；local subprocess 使用 argv，不以 local shell 執行外部輸入。
- 拒絕既有 `no_backup/tts/models`（包含 symlink／dangling symlink）及不安全的父目錄。使用 app private 的唯一 `no_backup/tts/.install-<隨機值>` staging；`adb exec-in run-as` 以檔案 stdin 串流寫入，不把約 2 GB 放入 Python RAM，亦不用 `/sdcard` 或 `/data/local/tmp` 中轉。
- 裝置端 `sha256sum` 必須回傳兩個完整且符合的 hash；再檢查 app 已停止、目的仍不存在，才以不覆蓋的目錄 rename 發布為 `no_backup/tts/models`。不混用新舊檔，也不讀取其他 app 資料。
- 發布前會在裝置上以空目錄探測 `mv -nT`（不覆蓋，也不巢狀移動）。依 [AOSP android-9.0.0_r1 的 toybox `mv` 原始碼](https://android.googlesource.com/platform/external/toybox/+/android-9.0.0_r1/toys/posix/cp.c)，Android 9 的 `mv` 沒有 `-T`；探測失敗時工具在傳輸任何模型前就拒絕，不會退回不安全的 `mv` 形式。
- `adb exec-in` 返回只代表 host 已送出 stdin，不代表遠端 `cat` 已完成（見 [AOSP adb 用戶端原始碼](https://android.googlesource.com/platform/packages/modules/adb/+/refs/heads/main/client/commandline.cpp)）。每個檔案由遠端 shell 自行寫入 `.ok` 或 `.fail` 結果；工具等待該結果（上限 1,200 秒，`.fail` 立即失敗）後才計算 SHA。
- 命令 timeout 30 秒、每檔傳輸與完成結果等待各 1,200 秒、兩檔 SHA 600 秒。成功 exit 0；安裝失敗 exit 1；CLI 缺參數 exit 2；中斷 exit 130。
- 失敗只嘗試刪除本次**確認建立成功**的 staging，不刪 `models` 或其他資料；cleanup 失敗會報出 staging 路徑。若建立／rename 時失去裝置回覆，結果可能不確定：工具回報失敗，不猜測成功，也不刪除未確認屬於本次的目錄。請人工檢查，不要盲目重跑或刪除 app 資料。

模型位於 `Context.noBackupFilesDir/tts/models`，不參與系統備份。APK 不內含模型；**release 安裝策略尚未實作，沒有自動下載或替換功能**。工具也不自動刪除既有模型來做升級。

## Dart API 與生命週期

`lib/service/tts_service.dart` 透過 `town_pass/tts` MethodChannel 提供以下靜態方法。

```dart
import 'package:town_pass/service/tts_service.dart';

Future<void> useLocalTts() async {
  final ready = await TtsService.start(threads: 2); // 可省略；合法範圍 1..16
  try {
    if (!ready.running || ready.apiKey == null || ready.baseUrl == null) {
      throw StateError(ready.error ?? 'TTS_NOT_READY');
    }
    // ready.baseUrl 已包含 /v1；以 Bearer ready.apiKey 呼叫 audio/speech。
    // 不 print ready、不記錄 key，也不寫 SharedPreferences 或檔案。
    final state = await TtsService.status(); // state.apiKey 必為 null
    if (!state.running) throw StateError(state.error ?? 'TTS_STOPPED');
  } finally {
    await TtsService.stop(); // 無 key；也可取消尚在 hash／載入的 start
  }
}
```

狀態有 `idle`／`starting`／`running`／`error`、`running`、`baseUrl`、`model`、`threads`、`error`。只有成功 `start` 回傳 `apiKey`；`status`／`stop` 不回傳 key，失敗時也不保留可用 endpoint。未指定 threads 時使用 big-core 數並上限 4；網頁不可以覆寫 threads、路徑、模型或資源參數。

同一個仍運作的服務重複 `start` 會重用 key；**stop 後重新 start 才輪替 key**。Android 端以服務層的持久 FIFO 執行緒處理 start／stop，不隨 Activity 回收，也不因閒置回收，因為 native child 的 parent-death signal 綁在建立它的執行緒上。stop 在接受當下撤銷目前 generation，排在它之前的 start 不會取消排在它之後的新 start；`status` 只讀取快照，不等待載入。只有目前的 Activity owner 銷毀時才停止服務，較舊 owner 的延遲清理不影響新 Activity。Native child 自行綁定 loopback 隨機 port，載入完成後經私有 stdout 協定回報 PID 與 READY；收到可信 READY 前不送出 Bearer。停止時先 SIGTERM，逾時後只對已由私有協定確認且仍存活的子行程送 SIGKILL。這些生命週期保護仍需裝置整合驗證，不是背景常駐服務承諾。

## WebView bridge 與 HTTP 範例

送出仍使用 `window.flutterObject.postMessage(JSON.stringify({name, data}))`。新能力是 `tts_start`、`tts_status`、`tts_stop`；`data.requestId` 是最多 64 字元的字串，會原樣帶回。僅允許主 frame，重用 `kLlmAllowedOrigins`，**未擴增 allowlist**。

- `http://10.0.2.2:5173`
- `http://localhost:5173`
- `http://127.0.0.1:5173`

正式來源不會自動授權。Native HTTP 的 CORS 也使用這組來源；無 Origin 的原生 client 仍須 Bearer 授權。Server 只綁 `127.0.0.1` 隨機 port，不對區網開放。

**TTS 的成功授權回覆聽 `window.addEventListener('message', …)`，不是 `flutterObject` 的 message 事件。** Listener 在 await 前固定原請求 origin，以 main-frame `controller.postWebMessage(..., targetOrigin: originalOrigin)` 回覆，避免共享 replyProxy 被另一個 request／跨源導頁覆寫。既有 LLM 與舊 `tts` 仍維持原事件通道，不要一起改接。

下例只示範契約，不是前端產品程式。以隨機 requestId 配對、timeout 與型別檢查處理「沒有 bridge／沒有回覆」；key 僅存在函式記憶體，不 log、不放 storage。呼叫端應將錯誤轉成可見提示，並保留文字／系統朗讀替代方案。

```javascript
function ttsRequest(name, timeoutMs = 240000) {
  if (!['tts_start', 'tts_status', 'tts_stop'].includes(name) ||
      typeof window.flutterObject?.postMessage !== 'function') {
    return Promise.reject(new Error('本機 TTS bridge 不可用'));
  }
  const requestId = Array.from(crypto.getRandomValues(new Uint8Array(16)),
    b => b.toString(16).padStart(2, '0')).join('');
  return new Promise((resolve, reject) => {
    const finish = (error, value) => {
      clearTimeout(timer);
      window.removeEventListener('message', receive);
      error ? reject(error) : resolve(value);
    };
    const receive = event => {
      if (typeof event.data !== 'string') return;
      let reply;
      try { reply = JSON.parse(event.data); } catch { return; }
      const data = reply?.data;
      if (reply?.name !== name || !data || typeof data !== 'object' ||
          data.requestId !== requestId) return;
      if (typeof data.phase !== 'string' || typeof data.running !== 'boolean' ||
          (data.error != null && typeof data.error !== 'string')) {
        finish(new Error('TTS 回覆型別錯誤')); return;
      }
      finish(data.error ? new Error('TTS 無法完成請求') : null, data);
    };
    const timer = setTimeout(() => finish(new Error('TTS bridge 等待逾時')), timeoutMs);
    window.addEventListener('message', receive);
    try {
      window.flutterObject.postMessage(JSON.stringify({ name, data: { requestId } }));
    } catch {
      finish(new Error('TTS bridge 傳送失敗'));
    }
  });
}

let ttsQueue = Promise.resolve();
// 同一頁共用同一個本機服務；序列化呼叫，避免後一次的 tts_stop 中斷前一次合成。
function speakShortText(text) {
  const run = ttsQueue.then(() => speakOnce(text));
  ttsQueue = run.catch(() => {});
  return run;
}

async function speakOnce(text) {
  if (typeof text !== 'string' || !text.trim() || Array.from(text).length > 80 ||
      new TextEncoder().encode(text).length > 320 ||
      /[<>\u0000-\u001f\u007f-\u009f\ud800-\udfff]/u.test(text)) {
    throw new Error('請提供不含控制字元的短句');
  }
  let ready, objectUrl, audio, playTimer;
  const controller = new AbortController();
  let requestTimer;
  try {
    ready = await ttsRequest('tts_start');
    if (!ready.running || ready.phase !== 'running' ||
        typeof ready.baseUrl !== 'string' ||
        !/^http:\/\/127\.0\.0\.1:[0-9]{1,5}\/v1$/.test(ready.baseUrl) ||
        typeof ready.apiKey !== 'string' || !/^[0-9a-f]{64}$/.test(ready.apiKey) ||
        ready.model !== 'bluemagpie-q8_0') throw new Error('TTS 尚未就緒');
    requestTimer = setTimeout(() => controller.abort(), 185000);
    const response = await fetch(`${ready.baseUrl}/audio/speech`, {
      method: 'POST', signal: controller.signal, cache: 'no-store',
      headers: { Authorization: `Bearer ${ready.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: ready.model, input: text,
        voice: 'default', response_format: 'wav' }),
    });
    if (!response.ok) throw new Error(`TTS HTTP ${response.status}`);
    const blob = await response.blob();
    clearTimeout(requestTimer);
    if (blob.type !== 'audio/wav' || blob.size <= 44 || blob.size > 2880044) {
      throw new Error('TTS 音訊格式錯誤');
    }
    objectUrl = URL.createObjectURL(blob);
    audio = new Audio(objectUrl);
    await new Promise((resolve, reject) => {
      audio.onended = resolve;
      audio.onerror = () => reject(new Error('音訊播放失敗'));
      playTimer = setTimeout(() => reject(new Error('音訊播放逾時')), 35000);
      audio.play().catch(() => reject(new Error('請由使用者操作允許播放')));
    });
  } finally {
    clearTimeout(requestTimer); clearTimeout(playTimer); controller.abort();
    if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load(); }
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    ready = undefined;
    await ttsRequest('tts_stop', 10000);
  }
}
// await ttsRequest('tts_status', 5000); // 無 apiKey
// 由使用者操作呼叫 speakShortText；捕捉錯誤後顯示可見訊息，不輸出回覆物件。
```

音訊 autoplay 可能被 WebView 拒絕，需使用者操作；UI 的停止操作也要 pause 自己的 Audio 並釋放 object URL，不能只停止 native server。前端 fetch 中止不等於 native 合成取消，可用 `tts_stop` 終止該服務；下次 start 再取得新 key。範例每次朗讀結束都會 `tts_stop`，以示範釋放記憶體，因此下一句會重新載入模型；實際頁面若要連續朗讀，應改為離頁或閒置時才停止服務。

### HTTP 限制

`baseUrl` 已含 `/v1`。`GET ${baseUrl}/models` 與 `POST ${baseUrl}/audio/speech` 都需要 `Authorization: Bearer <記憶體中的 key>`。

- JSON 只接受字串欄位 `model`、`input`、`voice`、`response_format`；model 固定 `bluemagpie-q8_0`，voice 只能 `default`，format 可為 `wav`（預設）或 raw `pcm`。不接受任意模型、檔案／URL、reference、clone 或取樣參數。
- `input` 最多 **80 個 Unicode scalar、320 UTF-8 bytes**，不得為空／純空白或含 `<`、`>`。呼叫端不應傳控制字元；native 拒絕非空白控制碼（tab／LF／CR／NEL 視為空白，仍不能全空白），上例採更嚴格的無控制字元輸入。
- Request body 上限 **4,096 bytes**；同時僅一個合成工作，多出的合法請求回 **429**。未授權回 401，不允許的 Origin 回 403，無效請求回 400，錯誤 Content-Type 回 415；只比對 media type（大小寫不敏感、可帶 `charset` 等參數），`application/jsonp` 等前綴相似值同樣回 415。
- 音訊固定 **48 kHz、mono、little-endian PCM16**；WAV 包含 RIFF header。最多 **30 秒**輸出，且僅 `stop_reason == stop_head`、有有效 sample 時才成功；不是將達到 frame 上限的殘缺音訊當成功。
- 請求標頭與本文的收件總期限為 **5 秒**；超過即關閉該連線並釋放 HTTP worker，慢速送資料不會長期占住 worker。這與合成的 180 秒 deadline 分開計算。
- Native 每次合成 deadline **180 秒**；到期結束子行程，client 可能收到斷線而非 JSON timeout。其他合成錯誤回 502。範例的 HTTP timeout 額外留 5 秒傳輸餘裕。重新 start／status 處理失效 endpoint，不重用失效 key。
- 回應 `Cache-Control: no-store`。服務不記錄使用者文字或 key；status／stop 都不能用來取回 key。

## 測試與驗證界線

以下為重現指令，**不是宣稱這些 Android 驗證已全部通過**。安裝工具測試只替換 adb process 邊界，將產生的 shell 指令跑在 host 暫存 private-root；沒有接觸 Android。它不能證明實機 `run-as`、`exec-in`、toybox、USB、大檔傳輸或 APK 可用。

```bash
# 來源／量化工具：10 tests；含真 PyTorch weights-only 載入測試，需離線轉換環境的 torch。
"$PY" -I -B -X utf8 "$REPO/tools/tts-android/test_model_tools.py"
# 安裝工具：24 tests；需 host sh／coreutils（Windows 從 Git Bash 跑）。
"$PY" -I -B -X utf8 "$REPO/tools/tts-android/test_install_models.py"
# Android 發布保護：1 test；使用假的 cmake／readelf，需 Git Bash，不接觸 NDK。
"$PY" -I -B -X utf8 "$REPO/tools/tts-android/test_build_publish.py"
```

沒有 host `sh` 時會 skip shell 測試；沒有建立 symlink 權限時兩個 symlink 測試會 skip，須如實報告，不以 skipped 當作通過裝置測試。

Tokenizer 測試共 **9 tests**；完整 runtime parity 為 **585 cases**，必須提供從同一套 patched llama.cpp 建出的、可被 host Python 載入的 library。可另建 shared `llama` target，不要拿 Android ELF 給 Windows Python 載入。

```bash
cmake -S "$LLAMA" -B "$WORK/parity-build" -G Ninja \
  -DCMAKE_C_COMPILER=gcc -DCMAKE_CXX_COMPILER=g++ -DCMAKE_BUILD_TYPE=Release \
  -DBUILD_SHARED_LIBS=ON -DLLAMA_BUILD_TESTS=OFF -DLLAMA_BUILD_EXAMPLES=OFF \
  -DLLAMA_BUILD_TOOLS=OFF -DLLAMA_BUILD_SERVER=OFF -DLLAMA_BUILD_APP=OFF \
  -DLLAMA_OPENSSL=OFF -DGGML_NATIVE=OFF -DGGML_OPENMP=OFF
cmake --build "$WORK/parity-build" --target llama --parallel 4
# 指定 parity-build/bin 中實際生成的 llama shared library 的絕對路徑。
# Windows MinGW 通常為 libllama.dll；其他 toolchain 依產物檔名調整。
TOKENIZER_DLL="$WORK/parity-build/bin/libllama.dll"
"$PY" -I -X utf8 "$REPO/tools/tts-android/test_tokenizer_repair.py" \
  --source "$QUANTIZED/barbet-q8_0.gguf" \
  --candidate "$QUANTIZED/barbet-q8_0-tokenizer.gguf" --official "$OFFICIAL" \
  --dll "$TOKENIZER_DLL" --dll-directory "$WORK/parity-build/bin"
```

Windows 若還需要 MinGW runtime DLL，另加 `--dll-directory` 指向該 toolchain 的 bin。省略 `--dll` 會 skip runtime parity；`--runtime-short-only` 只有前三例，不是完整 585-case 驗證。

```bash
# 不載模型的 CMake HTTP 契約測試與私有啟動協定測試（2 個 CTest）。
cmake -S "$REPO/tools/tts-android" -B "$WORK/http-tests" -G Ninja \
  -DCODEC_SOURCE_DIR="$CODEC_SOURCE_DIR" -DTTS_HTTP_TESTS_ONLY=ON \
  -DCMAKE_C_COMPILER=gcc -DCMAKE_CXX_COMPILER=g++ -DCMAKE_BUILD_TYPE=Release
cmake --build "$WORK/http-tests" --target tts-http-api-test tts-startup-protocol-test --parallel 4
ctest --test-dir "$WORK/http-tests" --output-on-failure

# repo 根目錄：Dart 靜態檢查／單元測試。
fvm flutter analyze
fvm flutter test test/tts_service_test.dart test/tts_bridge_test.dart test/tts_listener_test.dart
fvm flutter test

# 專用 Android 測試裝置：預設驗證沒有 model／binary 時的失敗路徑。
fvm flutter test --no-uninstall integration_test/tts_server_test.dart -d "$SERIAL"
# 已安裝且核對完整模型後，才執行真實合成／停止／重啟／取消載入測試。
fvm flutter test --no-uninstall integration_test/tts_server_test.dart -d "$SERIAL" \
  --dart-define=TTS_MODELS_INSTALLED=true
```

尚須以目標手機獨立量測／驗證：APK 安裝與 native packaging、完整模型載入、private streaming／SHA／發布、WAV／PCM 與 key rotation、stop／載入取消／process 死亡清理，以及 **實機 peak RAM、冷／熱啟動時間、合成延遲、耗電／溫度及人工音質**。Host hash／單元測試、tokenizer parity 或 emulator 成功均不能替代手機效能與音質結論。
