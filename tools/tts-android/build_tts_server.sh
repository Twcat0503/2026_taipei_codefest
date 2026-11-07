#!/usr/bin/env bash
# 使用已取得的pinned codec.cpp source；模型權重不參與native build。
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
: "${ANDROID_NDK_HOME:?請指定 Android NDK r30 路徑}"
: "${CODEC_SOURCE_DIR:?請指定 README 所列 pinned codec.cpp checkout}"
: "${TTS_BUILD_DIR:?請指定 repo 外的 ASCII build 目錄}"
ABI="${1:-arm64-v8a}"
case "$ABI" in
  arm64-v8a) TRIPLE=aarch64-linux-android; ARM_ARCH=armv8-a ;;
  x86_64) TRIPLE=x86_64-linux-android; ARM_ARCH= ;;
  *) printf '不支援 ABI: %s\n' "$ABI" >&2; exit 2 ;;
esac
HOST="$(uname -s)"
case "$HOST" in
  MINGW*|MSYS*|CYGWIN*) HOST_TAG=windows-x86_64; EXE=.exe ;;
  Darwin*) HOST_TAG=darwin-x86_64; EXE= ;;
  *) HOST_TAG=linux-x86_64; EXE= ;;
esac
# CMake/NDK 使用原生路徑；Git Bash 的 /c/... 不是Windows工具的絕對路徑。
native_path() { if command -v cygpath >/dev/null; then cygpath -m "$1"; else printf '%s\n' "$1"; fi; }
SOURCE="$(native_path "$CODEC_SOURCE_DIR")"
NDK="$(native_path "$ANDROID_NDK_HOME")"
BUILD="$(native_path "$TTS_BUILD_DIR/$ABI")"
TOOLS="$(native_path "$ROOT/tools/tts-android")"
OUT="${TTS_OUTPUT_DIR:-$ROOT/android/app/src/main/jniLibs/$ABI}"
PYTHON_ARGS=()
if [[ -n "${TTS_PYTHON:-}" ]]; then PYTHON_ARGS+=("-DPython3_EXECUTABLE=$(native_path "$TTS_PYTHON")"); fi
cmake -S "$TOOLS" -B "$BUILD" -G Ninja \
  -DCODEC_SOURCE_DIR="$SOURCE" \
  -DCMAKE_TOOLCHAIN_FILE="$NDK/build/cmake/android.toolchain.cmake" \
  -DANDROID_NDK="$NDK" -DANDROID_ABI="$ABI" -DANDROID_PLATFORM=android-28 \
  -DANDROID_STL=c++_shared -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_POSITION_INDEPENDENT_CODE=ON -DBUILD_SHARED_LIBS=OFF \
  -DGGML_STATIC=OFF -DGGML_BACKEND_DL=OFF -DGGML_NATIVE=OFF \
  -DGGML_OPENMP=OFF -DGGML_CPU_KLEIDIAI=OFF -DGGML_LLAMAFILE=OFF \
  -DGGML_CPU_ARM_ARCH="$ARM_ARCH" -DGGML_SVE=OFF \
  -DGGML_SSE42=OFF -DGGML_AVX=OFF -DGGML_AVX2=OFF -DGGML_AVX512=OFF \
  -DGGML_FMA=OFF -DGGML_F16C=OFF -DGGML_BMI2=OFF \
  -DGGML_CUDA=OFF -DGGML_VULKAN=OFF -DGGML_OPENCL=OFF \
  "${PYTHON_ARGS[@]}"
cmake --build "$BUILD" --target townpass-tts-server --parallel "${JOBS:-4}"
READELF="$NDK/toolchains/llvm/prebuilt/$HOST_TAG/bin/llvm-readelf$EXE"
STDLIB="$NDK/toolchains/llvm/prebuilt/$HOST_TAG/sysroot/usr/lib/$TRIPLE/libc++_shared.so"
for ELF in "$BUILD/townpass-tts-server" "$BUILD/ttsbackbone/libttsbackbone.so" "$STDLIB"; do
  "$READELF" -h -l -d "$ELF"
done
# 先檢查全部相容性，再寫入任何 APK 輸入；衝突時保留整組既有產物。
if [[ -e "$OUT/libc++_shared.so" || -L "$OUT/libc++_shared.so" ]] && ! cmp -s "$STDLIB" "$OUT/libc++_shared.so"; then
  printf 'libc++_shared.so 與現有版本不同；請先檢查其他native套件相容性，未覆蓋。\n' >&2
  exit 1
fi
mkdir -p "$OUT"
cp "$BUILD/townpass-tts-server" "$OUT/libtts_server.so"
cp "$BUILD/ttsbackbone/libttsbackbone.so" "$OUT/libttsbackbone.so"
cp "$STDLIB" "$OUT/libc++_shared.so"
printf '完成 %s；僅native產物，模型需另行安裝。\n' "$ABI"
