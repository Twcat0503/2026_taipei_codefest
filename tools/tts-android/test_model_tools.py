"""模型來源與輸出驗證的失敗封閉測試。"""
import hashlib
import importlib.util
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from unittest import mock
import unittest

SPEC = importlib.util.spec_from_file_location('model_tools', Path(__file__).with_name('model_tools.py'))
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class ModelVerificationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.data = b'GGUF\x03\0\0\0fixture'
        self.file = self.directory / 'model.gguf'
        self.file.write_bytes(self.data)
        self.expected = {'model.gguf': {'bytes': len(self.data), 'sha256': hashlib.sha256(self.data).hexdigest()}}

    def test_valid_file(self):
        MODULE.verify_files(self.directory, self.expected)

    def test_same_size_corruption(self):
        self.file.write_bytes(b'x' * len(self.data))
        with self.assertRaises(ValueError):
            MODULE.verify_files(self.directory, self.expected)

    def test_truncated_file(self):
        self.file.write_bytes(self.data[:-1])
        with self.assertRaises(ValueError):
            MODULE.verify_files(self.directory, self.expected)

    def test_missing_file(self):
        self.file.unlink()
        with self.assertRaises(ValueError):
            MODULE.verify_files(self.directory, self.expected)

    def test_reject_path_escape(self):
        with self.assertRaises(ValueError):
            MODULE.verify_files(self.directory, {'../model.gguf': self.expected['model.gguf']})

    def test_official_directory_rejects_extra_checkpoint_or_subdirectory(self):
        for name, directory in [('extra.pt', False), ('nested', True)]:
            with self.subTest(name=name):
                extra = self.directory / name
                if directory:
                    extra.mkdir()
                else:
                    extra.write_bytes(b'unverified checkpoint')
                try:
                    with self.assertRaises(ValueError):
                        MODULE.verify_files(self.directory, self.expected, exact=True)
                finally:
                    extra.rmdir() if directory else extra.unlink()

    def test_exact_directory_accepts_only_manifest_files(self):
        MODULE.verify_files(self.directory, self.expected, exact=True)

    def test_quantized_directory_can_retain_conversion_intermediates(self):
        (self.directory / 'intermediate.gguf').write_bytes(b'intermediate')
        MODULE.verify_files(self.directory, self.expected)

    def test_conversion_environment_forces_safe_torch_loading(self):
        with mock.patch.dict(os.environ, {'TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD': '1'}):
            env = MODULE.conversion_environment()
        self.assertEqual(env['TORCH_FORCE_WEIGHTS_ONLY_LOAD'], '1')
        self.assertNotIn('TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD', env)
        # 使用無害、但不在 weights-only allowlist 的 datetime，不執行任意 pickle。
        import datetime
        import torch
        checkpoint = self.directory / 'not-weights.pt'
        torch.save({'date': datetime.datetime(2026, 11, 7)}, checkpoint)
        result = subprocess.run(
            [sys.executable, '-I', '-c',
             'import sys,torch; torch.load(sys.argv[1], weights_only=False)', str(checkpoint)],
            env=env, capture_output=True, text=True, timeout=30, check=False,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Weights only load failed', result.stderr)

    def test_conversion_requires_both_q8_flags(self):
        commands = MODULE.conversion_commands(Path('/runtime'), Path('/official'), Path('/out'), Path('/quantizer'))
        codec = next(c for c in commands if any('convert-to-gguf.py' in str(x) for x in c))
        self.assertEqual(codec[codec.index('--quantization') + 1], 'Q8_0')
        self.assertEqual(codec[codec.index('--lm-quantization') + 1], 'Q8_0')
        python_commands = [c for c in commands if Path(c[0]) != Path('/quantizer')]
        self.assertEqual(len(python_commands), 3)
        self.assertTrue(all(c[1:4] == ['-I', '-X', 'utf8'] for c in python_commands))


if __name__ == '__main__':
    unittest.main(verbosity=2)
