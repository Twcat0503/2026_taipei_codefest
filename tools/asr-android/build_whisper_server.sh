#!/usr/bin/env bash
# 為 Android 編譯 whisper.cpp 的 whisper-server（語音辨識 HTTP 服務），
# 輸出到 android/app/src/main/jniLibs/<abi>/libwhisper_server.so。
#
# 原始碼：whisper.cpp（https://github.com/ggml-org/whisper.cpp）
# 固定 commit：727d3e7666485e12450746b523bfb4e7f057cc5e
#   （2026-11-05，"whisper : clamp segment end times to the audio length (#4137)"）
# 這個版本的 examples/server/server.cpp 在 --host 以 .sock 結尾時會綁定 unix domain socket。
# whisper-server 沒有 API key，App 以 unix socket 取代 TCP 埠，避免同一支手機上的其他 App 連線；
# 所以腳本會檢查原始碼具備這個功能，沒有就中止。
#
# 用法（任何目錄皆可執行）：
#   bash tools/asr-android/build_whisper_server.sh             # 預設 arm64-v8a 與 x86_64
#   bash tools/asr-android/build_whisper_server.sh arm64-v8a   # 只編手機用的版本
#   bash tools/asr-android/build_whisper_server.sh x86_64      # 只編模擬器用的版本
#
# 需要：cmake、ninja，以及 Android NDK（預設 30.0.16248370，可用 NDK_VERSION 覆寫）；
# 未設定 WHISPER_SRC 時還需要 git。
# 環境變數（皆可省略）：
#   ANDROID_NDK_HOME  NDK 路徑；未設定時使用 $ANDROID_HOME/ndk/$NDK_VERSION
#   NDK_VERSION       預設 30.0.16248370
#   WHISPER_SRC       既有的 whisper.cpp 原始碼目錄；未設定時依 WHISPER_REF 取得到快取目錄
#   WHISPER_REF       未設定 WHISPER_SRC 時要取得的 commit（完整 40 字元 SHA）或 tag，預設為上面的固定 commit
#   WHISPER_REPO      未設定 WHISPER_SRC 時使用的 git 網址，預設 https://github.com/ggml-org/whisper.cpp.git
#   ANDROID_API       預設 28（Android 9）；更舊的裝置無法執行
#   ASR_CACHE_DIR     快取與建置目錄，預設 ~/.cache/townpass-asr；
#                     各 ABI 的建置目錄為 $ASR_CACHE_DIR/whisper-build-<abi>
#
# 注意：
#   - 專案路徑含非 ASCII 字元（例如中文資料夾）時，NDK 工具鏈可能出錯，所以不在專案內編譯；
#     ASR_CACHE_DIR 也請指到純 ASCII 路徑。
#   - arm64-v8a 的 configure 會由 ggml 從 GitHub 下載 KleidiAI 原始碼，第一次需要網路。
#   - configure 時 whisper.cpp 會在原始碼目錄產生 bindings/javascript/package.json（其 .gitignore 已忽略）。
#   - 請用 bash（Git Bash、macOS、Linux）執行。CMake 參數含 "armv8.2-a+dotprod"，PowerShell 會把它切壞；
#     腳本在 configure 後會檢查 CMakeCache.txt，不符就中止。
set -euo pipefail

WHISPER_PINNED_COMMIT=727d3e7666485e12450746b523bfb4e7f057cc5e
WHISPER_REF="${WHISPER_REF:-$WHISPER_PINNED_COMMIT}"
WHISPER_REPO="${WHISPER_REPO:-https://github.com/ggml-org/whisper.cpp.git}"
NDK_VERSION="${NDK_VERSION:-30.0.16248370}"
ANDROID_API="${ANDROID_API:-28}"
CACHE_DIR="${ASR_CACHE_DIR:-$HOME/.cache/townpass-asr}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT_DIR="$REPO_ROOT/android/app/src/main/jniLibs"

REF_DIRNAME="${WHISPER_REF//\//_}"
SRC_DIR="${WHISPER_SRC:-$CACHE_DIR/whisper.cpp-${REF_DIRNAME:0:12}}"

if [ "$#" -gt 0 ]; then ABIS=("$@"); else ABIS=(arm64-v8a x86_64); fi

log() { printf '[asr-build] %s\n' "$*"; }
die() { printf '[asr-build] 錯誤：%s\n' "$*" >&2; exit 1; }

# 先檢查 ABI，免得編了一半才發現參數打錯
for abi in "${ABIS[@]}"; do
  case "$abi" in
    arm64-v8a|x86_64) ;;
    *) die "不支援的 ABI：$abi（可用 arm64-v8a、x86_64）" ;;
  esac
done

# 找 NDK
SDK_ROOT="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
NDK="${ANDROID_NDK_HOME:-}"
if [ -z "$NDK" ] && [ -n "$SDK_ROOT" ]; then NDK="$SDK_ROOT/ndk/$NDK_VERSION"; fi
[ -n "$NDK" ] && [ -d "$NDK" ] || die "找不到 NDK（請設定 ANDROID_NDK_HOME，或 ANDROID_HOME 並安裝 NDK $NDK_VERSION）"
[ -f "$NDK/build/cmake/android.toolchain.cmake" ] || die "NDK 結構不符：$NDK"

# 主機平台對應的 NDK prebuilt 目錄
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) HOST_TAG=windows-x86_64 ;;
  Darwin) HOST_TAG=darwin-x86_64 ;;
  Linux) HOST_TAG=linux-x86_64 ;;
  *) die "不支援的主機系統：$(uname -s)" ;;
esac
PREBUILT="$NDK/toolchains/llvm/prebuilt/$HOST_TAG"

tool() { # 找 NDK 工具；Windows 上檔名帶 .exe
  if [ -x "$PREBUILT/bin/$1" ]; then echo "$PREBUILT/bin/$1"
  elif [ -x "$PREBUILT/bin/$1.exe" ]; then echo "$PREBUILT/bin/$1.exe"
  else die "找不到 NDK 工具：$1"; fi
}
STRIP="$(tool llvm-strip)"
READELF="$(tool llvm-readelf)"
elf() { "$READELF" "$@" | tr -d '\r'; } # llvm-readelf 在 Windows 上可能輸出 CRLF

command -v cmake >/dev/null || die "需要 cmake"
command -v ninja >/dev/null || die "需要 ninja"

# 取得 whisper.cpp 原始碼（WHISPER_SRC 優先；否則固定版本，已存在就不更新）
if [ -n "${WHISPER_SRC:-}" ]; then
  [ -f "$SRC_DIR/CMakeLists.txt" ] || die "WHISPER_SRC 不是 whisper.cpp 原始碼目錄：$SRC_DIR"
elif [ ! -f "$SRC_DIR/CMakeLists.txt" ]; then
  command -v git >/dev/null || die "需要 git（或以 WHISPER_SRC 指定既有的原始碼）"
  log "取得 whisper.cpp $WHISPER_REF → $SRC_DIR"
  mkdir -p "$SRC_DIR"
  [ -d "$SRC_DIR/.git" ] || git -C "$SRC_DIR" init -q
  git -C "$SRC_DIR" remote get-url origin >/dev/null 2>&1 || git -C "$SRC_DIR" remote add origin "$WHISPER_REPO"
  git -C "$SRC_DIR" fetch --depth 1 origin "$WHISPER_REF"
  git -C "$SRC_DIR" checkout -q --detach FETCH_HEAD
fi

SRC_COMMIT="$(git -C "$SRC_DIR" rev-parse HEAD 2>/dev/null || echo unknown)"
log "whisper.cpp 原始碼：$SRC_DIR（commit $SRC_COMMIT）"
if [ "$SRC_COMMIT" != "$WHISPER_PINNED_COMMIT" ]; then
  log "警告：commit 與腳本驗證過的 $WHISPER_PINNED_COMMIT 不同，產物行為以該版本為準"
fi

SERVER_CPP="$SRC_DIR/examples/server/server.cpp"
[ -f "$SERVER_CPP" ] || die "找不到 $SERVER_CPP"
grep -q 'AF_UNIX' "$SERVER_CPP" || die "這個 whisper.cpp 版本的 whisper-server 不支援 unix domain socket（--host *.sock），請改用較新的 commit"

for abi in "${ABIS[@]}"; do
  case "$abi" in
    arm64-v8a)
      # 手機：與 llama 腳本相同，以 ARMv8.2 + dotprod 為基準；KleidiAI 提供 ARM 最佳化 kernel。
      ARCH_FLAGS=(-DGGML_CPU_ARM_ARCH=armv8.2-a+dotprod -DGGML_CPU_KLEIDIAI=ON)
      LIB_ARCH=aarch64
      WANT_MACHINE=AArch64 ;;
    x86_64)
      # 模擬器：只用於功能測試，效能數字不代表手機。
      ARCH_FLAGS=(-DGGML_CPU_KLEIDIAI=OFF)
      LIB_ARCH=x86_64
      WANT_MACHINE=X86-64 ;;
  esac

  BUILD_DIR="$CACHE_DIR/whisper-build-$abi"
  # whisper-server 在 examples/server，由 WHISPER_BUILD_EXAMPLES 決定是否納入建置；
  # 這個 commit 的 CMake 沒有引用 WHISPER_BUILD_SERVER（只宣告），一併開啟是為了日後升級版本時仍能建置。
  # 只建 whisper-server target，不會編 cli、bench 等其他範例。
  log "configure $abi → $BUILD_DIR"
  cmake -S "$SRC_DIR" -B "$BUILD_DIR" -G Ninja \
    -DCMAKE_TOOLCHAIN_FILE="$NDK/build/cmake/android.toolchain.cmake" \
    -DANDROID_ABI="$abi" -DANDROID_PLATFORM="android-$ANDROID_API" -DANDROID_STL=c++_static \
    -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DGGML_NATIVE=OFF \
    -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_EXAMPLES=ON -DWHISPER_BUILD_SERVER=ON \
    "${ARCH_FLAGS[@]}" -Wno-dev

  # 確認 -D 參數真的寫進快取（防止 shell 把 "+" 之類的字元切壞）
  for flag in "${ARCH_FLAGS[@]}"; do
    name="${flag#-D}"; name="${name%%=*}"; want="${flag#*=}"
    got="$(sed -n "s/^$name:[A-Z]*=//p" "$BUILD_DIR/CMakeCache.txt" | tr -d '\r')"
    [ "$got" = "$want" ] || die "CMakeCache.txt 的 $name 是「$got」，預期「$want」（請用 bash 執行，不要用 PowerShell）"
  done

  log "build whisper-server ($abi)"
  cmake --build "$BUILD_DIR" --target whisper-server

  DEST="$OUT_DIR/$abi"
  LIB="$DEST/libwhisper_server.so"
  mkdir -p "$DEST"
  cp "$BUILD_DIR/bin/whisper-server" "$LIB"
  "$STRIP" --strip-unneeded "$LIB"

  # 驗證 ELF：機器類型要對，執行時依賴不可含 libc++_shared.so（已用 c++_static 靜態連結）
  MACHINE="$(elf -h "$LIB" | sed -n 's/^ *Machine: *//p')"
  case "$MACHINE" in
    *"$WANT_MACHINE"*) ;;
    *) die "ELF 機器類型不符：$MACHINE（預期含 $WANT_MACHINE）" ;;
  esac
  NEEDED="$(elf -d "$LIB" | sed -n 's/.*Shared library: \[\(.*\)\]$/\1/p')"
  if grep -qxF 'libc++_shared.so' <<<"$NEEDED"; then
    die "$LIB 依賴 libc++_shared.so（應為 c++_static）；NEEDED：$(tr '\n' ' ' <<<"$NEEDED")"
  fi

  # 執行時需要的 OpenMP 共享函式庫（Android 系統不提供），與執行檔放在同一目錄；
  # 與 libllama_server.so 共用同一份 libomp.so（同一個 NDK 版本時內容相同）。
  OMP_NOTE=""
  if grep -qxF 'libomp.so' <<<"$NEEDED"; then
    OMP="$(ls "$PREBUILT"/lib/clang/*/lib/linux/"$LIB_ARCH"/libomp.so 2>/dev/null | tail -n 1 || true)"
    [ -n "$OMP" ] || die "找不到 libomp.so（$LIB_ARCH）"
    cp "$OMP" "$DEST/libomp.so"
    OMP_NOTE="，libomp.so $(du -h "$DEST/libomp.so" | cut -f1)"
  fi

  log "驗證 ELF：$MACHINE；NEEDED：$(tr '\n' ' ' <<<"$NEEDED")"
  log "完成 $abi：libwhisper_server.so $(du -h "$LIB" | cut -f1)$OMP_NOTE → $DEST"
done

log "全部完成。"
