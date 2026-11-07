"""真實檔案發布回歸；只替換外部編譯器與 ELF 檢查工具。"""
from pathlib import Path
import os
import shutil
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).with_name('build_tts_server.sh')
BASH = shutil.which('bash')


@unittest.skipUnless(BASH, '需要 POSIX bash')
class NativePublishTests(unittest.TestCase):
    def test_runtime_conflict_preserves_all_existing_binaries(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            fake_bin = root / 'bin'
            fake_bin.mkdir()
            for name, content in [('cmake', '#!/bin/sh\nexit 0\n'),
                                  ('uname', '#!/bin/sh\nprintf Linux\n')]:
                tool = fake_bin / name
                tool.write_text(content, encoding='utf-8', newline='\n')
                tool.chmod(0o755)
            build = root / 'build/arm64-v8a'
            (build / 'ttsbackbone').mkdir(parents=True)
            (build / 'townpass-tts-server').write_bytes(b'new server')
            (build / 'ttsbackbone/libttsbackbone.so').write_bytes(b'new backbone')
            ndk = root / 'ndk/toolchains/llvm/prebuilt/linux-x86_64'
            (ndk / 'bin').mkdir(parents=True)
            readelf = ndk / 'bin/llvm-readelf'
            readelf.write_text('#!/bin/sh\nexit 0\n', encoding='utf-8', newline='\n')
            readelf.chmod(0o755)
            stdlib = ndk / 'sysroot/usr/lib/aarch64-linux-android/libc++_shared.so'
            stdlib.parent.mkdir(parents=True)
            stdlib.write_bytes(b'new C++ runtime')
            output = root / 'output'
            output.mkdir()
            previous = {'libtts_server.so': b'old server',
                        'libttsbackbone.so': b'old backbone',
                        'libc++_shared.so': b'existing incompatible runtime'}
            for name, data in previous.items():
                (output / name).write_bytes(data)
            env = os.environ.copy()
            env.update(ANDROID_NDK_HOME=str(root / 'ndk'), CODEC_SOURCE_DIR=str(root),
                       TTS_BUILD_DIR=str(root / 'build'), TTS_OUTPUT_DIR=str(output))
            # Bash 的 PATH 使用冒號；Windows 的其餘 PATH 由啟動後的 shell 保留。
            command = 'p="$1"; if command -v cygpath >/dev/null; then p=$(cygpath -u "$p"); fi; export PATH="$p:$PATH"; exec bash "$2" arm64-v8a'
            result = subprocess.run([BASH, '-c', command, 'test', fake_bin.as_posix(), SCRIPT.as_posix()],
                                    env=env, capture_output=True, timeout=30, check=False)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('libc++_shared.so'.encode(), result.stderr)
            for name, data in previous.items():
                self.assertEqual((output / name).read_bytes(), data, name)


if __name__ == '__main__':
    unittest.main(verbosity=2)
