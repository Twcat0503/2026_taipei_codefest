#!/usr/bin/env bash
# 為 Android 編譯 llama-server（OpenAI 相容 API），輸出到 android/app/src/main/jniLibs/<abi>/。
#
# 用法（任何目錄皆可執行）：
#   bash tools/llm-android/build_llama_server.sh             # 預設 arm64-v8a 與 x86_64
#   bash tools/llm-android/build_llama_server.sh arm64-v8a   # 只編手機用的版本
#   bash tools/llm-android/build_llama_server.sh x86_64      # 只編模擬器用的版本
#
# 需要：git、cmake、ninja，以及 Android NDK（預設 30.0.16248370，可用 NDK_VERSION 覆寫）。
# 環境變數（皆可省略）：
#   ANDROID_NDK_HOME  NDK 路徑；未設定時使用 $ANDROID_HOME/ndk/$NDK_VERSION
#   NDK_VERSION       預設 30.0.16248370
#   LLAMA_TAG         預設 v0.9.0（LFM3 需要 b11960 / v0.8.0 以上）
#   LLAMA_SRC         既有的 llama.cpp 原始碼目錄；未設定時 clone 到快取目錄
#   ANDROID_API       預設 28（Android 9）；更舊的裝置無法執行
#   LLM_CACHE_DIR     快取與建置目錄，預設 ~/.cache/townpass-llm
set -euo pipefail

LLAMA_TAG="${LLAMA_TAG:-v0.9.0}"
NDK_VERSION="${NDK_VERSION:-30.0.16248370}"
ANDROID_API="${ANDROID_API:-28}"
CACHE_DIR="${LLM_CACHE_DIR:-$HOME/.cache/townpass-llm}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT_DIR="$REPO_ROOT/android/app/src/main/jniLibs"
SRC_DIR="${LLAMA_SRC:-$CACHE_DIR/llama.cpp-$LLAMA_TAG}"

if [ "$#" -gt 0 ]; then ABIS=("$@"); else ABIS=(arm64-v8a x86_64); fi

log() { printf '[llm-build] %s\n' "$*"; }
die() { printf '[llm-build] 錯誤：%s\n' "$*" >&2; exit 1; }

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

command -v git >/dev/null || die "需要 git"
command -v cmake >/dev/null || die "需要 cmake"
command -v ninja >/dev/null || die "需要 ninja"

# 取得 llama.cpp 原始碼（固定版本）
if [ ! -d "$SRC_DIR/.git" ]; then
  log "clone llama.cpp $LLAMA_TAG → $SRC_DIR"
  mkdir -p "$(dirname "$SRC_DIR")"
  git clone --depth 1 --branch "$LLAMA_TAG" https://github.com/ggml-org/llama.cpp.git "$SRC_DIR"
fi

for abi in "${ABIS[@]}"; do
  case "$abi" in
    arm64-v8a)
      # 手機：以 ARMv8.2 + dotprod 為基準；KleidiAI 提供 ARM 最佳化 kernel。
      ARCH_FLAGS=(-DGGML_CPU_ARM_ARCH=armv8.2-a+dotprod -DGGML_CPU_KLEIDIAI=ON)
      LIB_ARCH=aarch64 ;;
    x86_64)
      # 模擬器：只用於功能測試，效能數字不代表手機。
      ARCH_FLAGS=(-DGGML_CPU_KLEIDIAI=OFF)
      LIB_ARCH=x86_64 ;;
    *) die "不支援的 ABI：$abi（可用 arm64-v8a、x86_64）" ;;
  esac

  BUILD_DIR="$CACHE_DIR/build-$LLAMA_TAG-$abi"
  # LLAMA_USE_PREBUILT_UI=OFF：不從 Hugging Face 下載網頁 UI。App 以 --no-webui 執行，用不到；
  # 關掉後建置只需要 git 來源，不需要外部網路或額外下載，產物也較小。
  log "configure $abi → $BUILD_DIR"
  cmake -S "$SRC_DIR" -B "$BUILD_DIR" -G Ninja \
    -DCMAKE_TOOLCHAIN_FILE="$NDK/build/cmake/android.toolchain.cmake" \
    -DANDROID_ABI="$abi" -DANDROID_PLATFORM="android-$ANDROID_API" -DANDROID_STL=c++_static \
    -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DGGML_NATIVE=OFF \
    -DLLAMA_BUILD_TESTS=OFF -DLLAMA_BUILD_TOOLS=ON -DLLAMA_BUILD_SERVER=ON \
    -DLLAMA_USE_PREBUILT_UI=OFF \
    "${ARCH_FLAGS[@]}" -Wno-dev

  log "build llama-server ($abi)"
  cmake --build "$BUILD_DIR" --target llama-server

  DEST="$OUT_DIR/$abi"
  mkdir -p "$DEST"
  cp "$BUILD_DIR/bin/llama-server" "$DEST/libllama_server.so"
  "$STRIP" --strip-unneeded "$DEST/libllama_server.so"

  # 執行時需要的 OpenMP 共享函式庫（Android 系統不提供），與執行檔放在同一目錄
  OMP="$(ls "$PREBUILT"/lib/clang/*/lib/linux/"$LIB_ARCH"/libomp.so 2>/dev/null | tail -n 1 || true)"
  [ -n "$OMP" ] || die "找不到 libomp.so（$LIB_ARCH）"
  cp "$OMP" "$DEST/libomp.so"

  log "驗證 ELF：$("$READELF" -h "$DEST/libllama_server.so" | grep -E 'Machine' | sed 's/^ *//')"
  log "完成 $abi：libllama_server.so $(du -h "$DEST/libllama_server.so" | cut -f1)，libomp.so $(du -h "$DEST/libomp.so" | cut -f1) → $DEST"
done

log "全部完成。"
