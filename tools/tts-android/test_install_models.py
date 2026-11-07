"""Installer tests: real local files/shell, an injected adb process boundary only.

No Android device is contacted. Host shell tests do not establish Android toybox,
run-as, exec-in, or USB behaviour; those require separate device verification.
Run with Python -I -B -X utf8.
"""
import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import shlex
import shutil
import subprocess
import tempfile
import time
import unittest
from unittest import mock

SCRIPT = Path(__file__).with_name('install_models.py')
INSTALLER = None
if SCRIPT.is_file():
    SPEC = importlib.util.spec_from_file_location('install_models', SCRIPT)
    INSTALLER = importlib.util.module_from_spec(SPEC)
    SPEC.loader.exec_module(INSTALLER)

REAL_RUN = subprocess.run
SHELL = shutil.which('sh')
NAMES = ('barbet-q8_0-tokenizer.gguf', 'codec-q8_0-lmq8.gguf')
PACKAGE = 'com.example.townpass'


class LocalAdb:
    """Run emitted private-directory shell commands in a disposable local root.

    Only pidof/run-as availability and transport failures are simulated. Actual
    mkdir/cat/sha256sum/mv/rm determine filesystem results, not a mock filesystem.
    """
    def __init__(self, root):
        self.root = root
        self.calls = []
        self.running_on_check = None
        self.pid_checks = 0
        self.run_as_available = True
        self.stream_failure = None
        self.hash_output = None
        self.corrupt_upload = False
        self.destination_race = False
        self.cleanup_failure = False
        self.creation_failure = False
        self.pid_failure = False
        self.mv_no_target = True
        self.defer_transfers = False
        self.pending_transfers = []
        self.remote_write_conflict = False

    def __call__(self, argv, **kwargs):
        assert isinstance(argv, list), 'adb must use argv, not a local shell'
        assert argv[:3] == ['adb with spaces', '-s', 'test-serial;not-a-shell']
        assert not kwargs.get('shell', False)
        assert 0 < kwargs['timeout'] <= 1200
        assert 'input' not in kwargs, 'stream a file descriptor, not an in-memory model'
        self.calls.append((argv, kwargs))
        remote = argv[3:]
        if remote == ['shell', 'pidof', PACKAGE]:
            self.pid_checks += 1
            if self.pid_failure:
                return subprocess.CompletedProcess(argv, 1, b'', b'pidof failed')
            if self.pid_checks == self.running_on_check:
                return subprocess.CompletedProcess(argv, 0, b'1234\n', b'')
            return subprocess.CompletedProcess(argv, 1, b'', b'')
        assert remote[0] in ('shell', 'exec-in')
        assert remote[1:3] == ['run-as', PACKAGE]
        if not self.run_as_available:
            return subprocess.CompletedProcess(argv, 1, b'', b'not debuggable')
        command = remote[3:]
        script = ''
        if command[:2] == ['sh', '-c']:
            script = command[-1] if remote[0] == 'exec-in' else shlex.split(command[-1])[0]
        if 'mkdir -m 700' in script and self.creation_failure:
            return subprocess.CompletedProcess(argv, 1, b'', b'mkdir refused')
        if remote[0] == 'exec-in':
            source = kwargs['stdin']
            assert not isinstance(source, (bytes, str, io.BytesIO))
            assert source.fileno() >= 0
            assert source.tell() == 0
            if self.stream_failure == 'timeout':
                raise subprocess.TimeoutExpired(argv, kwargs['timeout'])
            if self.stream_failure == 'write' and Path(source.name).name == NAMES[1]:
                return subprocess.CompletedProcess(argv, 1, b'', b'write failed')
            if self.remote_write_conflict and Path(source.name).name == NAMES[0]:
                # The remote shell cannot open the target, while exec-in may still exit 0.
                staging = next((self.root / 'no_backup/tts').glob('.install-*'))
                (staging / NAMES[0]).mkdir()
        if command and command[0] == 'sha256sum':
            if self.corrupt_upload:
                path = next((self.root / 'no_backup/tts').glob('.install-*/' + NAMES[1]))
                path.write_bytes(b'corrupted on device')
            if self.hash_output is not None:
                return subprocess.CompletedProcess(argv, 0, self.hash_output, b'')
        if 'mv -nT' in script and not self.mv_no_target:
            return subprocess.CompletedProcess(argv, 1, b'', b'unknown option T')
        if 'mv ' in script and ' no_backup/tts/models;' in script and self.destination_race:
            destination = self.root / 'no_backup/tts/models'
            destination.mkdir()
            (destination / 'existing').write_bytes(b'leave me alone')
        if 'rm -rf' in script and self.cleanup_failure:
            return subprocess.CompletedProcess(argv, 1, b'', b'cleanup failed')
        # adb exec-in escapes each argv item; adb shell joins them verbatim.
        # Raw exec transport does not report the remote command's exit status.
        remote_command = ' '.join(shlex.quote(arg) for arg in command) if remote[0] == 'exec-in' else ' '.join(command)
        if remote[0] == 'exec-in' and self.defer_transfers:
            # exec-in may return before the remote cat finishes; keep the bytes pending.
            self.pending_transfers.append((remote_command, Path(kwargs['stdin'].name)))
            return subprocess.CompletedProcess(argv, 0, b'', b'')
        if 'while [ ! -f ' in script:
            # The completion wait is the only point where a deferred remote write may finish.
            self.flush_pending()
        result = REAL_RUN(
            [SHELL, '-c', remote_command], cwd=self.root,
            stdin=kwargs.get('stdin', subprocess.DEVNULL),
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            timeout=kwargs['timeout'], check=False,
        )
        if remote[0] == 'exec-in':
            return subprocess.CompletedProcess(argv, 0, b'', b'')
        return result

    def flush_pending(self):
        for remote_command, source_path in self.pending_transfers:
            with source_path.open('rb') as source:
                REAL_RUN([SHELL, '-c', remote_command], cwd=self.root, stdin=source,
                         stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30, check=False)
        self.pending_transfers.clear()

    def scripts(self):
        return [argv[-1] if argv[3] == 'exec-in' else shlex.split(argv[-1])[0]
                for argv, _ in self.calls if argv[6:8] == ['sh', '-c']]


class InstallerTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(INSTALLER, 'install_models.py is not implemented')
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.models = self.root / 'source models'
        self.models.mkdir()
        self.data = {NAMES[0]: b'GGUF backbone fixture', NAMES[1]: b'GGUF codec fixture'}
        for name, data in self.data.items():
            (self.models / name).write_bytes(data)
        self.manifest = self.root / 'manifest.json'
        self.expected = {name: {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
                         for name, data in self.data.items()}
        self.write_manifest(self.expected)
        self.device = self.root / 'private-app-root'
        self.device.mkdir()
        self.transport = LocalAdb(self.device)
        self.stderr = io.StringIO()
        self.stdout = io.StringIO()
        patch = mock.patch.object(INSTALLER, 'MANIFEST_PATH', self.manifest)
        patch.start()
        self.addCleanup(patch.stop)

    def write_manifest(self, quantized):
        self.manifest.write_text(json.dumps({'quantized': quantized}), encoding='utf-8')

    def install(self, argv=None):
        if argv is None:
            argv = ['--adb', 'adb with spaces', '--serial', 'test-serial;not-a-shell',
                    '--models', str(self.models)]
        with mock.patch.object(INSTALLER.subprocess, 'run', side_effect=self.transport), \
                contextlib.redirect_stdout(self.stdout), contextlib.redirect_stderr(self.stderr):
            return INSTALLER.main(argv)

    def require_shell(self):
        if SHELL is None:
            self.skipTest('host POSIX sh unavailable; not an Android verification')

    def assert_no_staging(self):
        self.assertEqual(list((self.device / 'no_backup/tts').glob('.install-*')), [])

    def test_cli_requires_explicit_serial_and_models(self):
        for argv in (['--models', str(self.models)], ['--serial', 'test-serial']):
            with self.subTest(argv=argv), self.assertRaises(SystemExit) as error:
                self.install(argv)
            self.assertEqual(error.exception.code, 2)
        self.assertEqual(self.transport.calls, [])

    def test_corrupt_missing_or_truncated_source_never_contacts_adb(self):
        path = self.models / NAMES[1]
        for data in (b'x' * len(self.data[NAMES[1]]), b'short', None):
            with self.subTest(data=data):
                if data is None:
                    path.unlink()
                else:
                    path.write_bytes(data)
                self.assertEqual(self.install(), 1)
                self.assertEqual(self.transport.calls, [])

    def test_manifest_requires_exact_safe_model_names(self):
        for name in ('../escape.gguf', 'extra.gguf', 'x;touch injected', 'dir\\file.gguf'):
            with self.subTest(name=name):
                self.write_manifest({NAMES[0]: self.expected[NAMES[0]], name: self.expected[NAMES[1]]})
                self.assertEqual(self.install(), 1)
                self.assertEqual(self.transport.calls, [])
        self.write_manifest({NAMES[0]: self.expected[NAMES[0]]})
        self.assertEqual(self.install(), 1)
        self.assertEqual(self.transport.calls, [])

    def test_manifest_rejects_invalid_size_or_hash_before_adb(self):
        for spec in ({'bytes': True, 'sha256': '0' * 64},
                     {'bytes': 20, 'sha256': 'not-a-sha256'},
                     {'bytes': -1, 'sha256': '0' * 64}):
            with self.subTest(spec=spec):
                self.write_manifest({NAMES[0]: spec, NAMES[1]: self.expected[NAMES[1]]})
                self.assertEqual(self.install(), 1)
                self.assertEqual(self.transport.calls, [])

    def test_running_app_is_refused_without_force_stop(self):
        self.transport.running_on_check = 1
        self.assertEqual(self.install(), 1)
        self.assertEqual(len(self.transport.calls), 1)
        self.assertIn('stop', self.stderr.getvalue().lower())
        self.assertEqual(list(self.device.iterdir()), [])

    def test_pidof_failure_is_not_treated_as_stopped(self):
        self.transport.pid_failure = True
        self.assertEqual(self.install(), 1)
        self.assertEqual(len(self.transport.calls), 1)
        self.assertEqual(list(self.device.iterdir()), [])

    def test_release_or_unavailable_run_as_fails_before_writes(self):
        self.transport.run_as_available = False
        self.assertEqual(self.install(), 1)
        self.assertEqual(len(self.transport.calls), 2)
        self.assertEqual(list(self.device.iterdir()), [])

    def test_existing_destination_is_never_overwritten_or_deleted(self):
        self.require_shell()
        destination = self.device / 'no_backup/tts/models'
        destination.mkdir(parents=True)
        marker = destination / 'existing'
        marker.write_bytes(b'leave me alone')
        self.assertEqual(self.install(), 1)
        self.assertEqual(marker.read_bytes(), b'leave me alone')
        self.assert_no_staging()
        self.assertFalse(any('rm ' in script for script in self.transport.scripts()))

    def test_existing_regular_file_destination_is_refused(self):
        self.require_shell()
        destination = self.device / 'no_backup/tts/models'
        destination.parent.mkdir(parents=True)
        destination.write_bytes(b'not a directory')
        self.assertEqual(self.install(), 1)
        self.assertEqual(destination.read_bytes(), b'not a directory')
        self.assert_no_staging()

    def test_dangling_destination_symlink_is_refused(self):
        self.require_shell()
        destination = self.device / 'no_backup/tts/models'
        destination.parent.mkdir(parents=True)
        try:
            destination.symlink_to(self.root / 'nonexistent', target_is_directory=True)
        except OSError:
            self.skipTest('host does not permit symlink creation')
        self.assertEqual(self.install(), 1)
        self.assertTrue(destination.is_symlink())
        self.assert_no_staging()

    def test_parent_symlink_is_refused_without_touching_target(self):
        self.require_shell()
        outside = self.root / 'outside'
        outside.mkdir()
        try:
            (self.device / 'no_backup').symlink_to(outside, target_is_directory=True)
        except OSError:
            self.skipTest('host does not permit symlink creation')
        self.assertEqual(self.install(), 1)
        self.assertEqual(list(outside.iterdir()), [])

    def test_streams_files_only_to_private_staging_and_publishes_after_both_hashes(self):
        self.require_shell()
        self.assertEqual(self.install(), 0, self.stderr.getvalue())
        destination = self.device / 'no_backup/tts/models'
        self.assertEqual({path.name: path.read_bytes() for path in destination.iterdir()}, self.data)
        self.assert_no_staging()
        streams = [(argv, options) for argv, options in self.transport.calls if argv[3] == 'exec-in']
        self.assertEqual(len(streams), 2)
        for argv, options in streams:
            self.assertTrue(options['stdin'].closed)
            script = argv[-1]
            self.assertIn('no_backup/tts/.install-', script)
            self.assertNotIn('/sdcard', script)
            self.assertNotIn('/data/local/tmp', script)
        commands = [argv for argv, _ in self.transport.calls]
        hashes = next(i for i, argv in enumerate(commands) if 'sha256sum' in argv)
        publish = next(i for i, argv in enumerate(commands)
                       if 'mv ' in argv[-1] and ' no_backup/tts/models;' in argv[-1])
        self.assertLess(hashes, publish)
        self.assertTrue(all(name in ' '.join(commands[hashes]) for name in NAMES))
        self.assertEqual(self.transport.pid_checks, 2)

    def test_unsupported_mv_is_rejected_before_any_model_transfer(self):
        self.require_shell()
        self.transport.mv_no_target = False
        self.assertEqual(self.install(), 1)
        self.assertFalse(any(argv[3] == 'exec-in' for argv, _ in self.transport.calls))
        self.assert_no_staging()
        self.assertFalse((self.device / 'no_backup/tts/models').exists())

    def test_waits_for_remote_completion_when_exec_in_returns_early(self):
        self.require_shell()
        self.transport.defer_transfers = True
        self.assertEqual(self.install(), 0, self.stderr.getvalue())
        destination = self.device / 'no_backup/tts/models'
        self.assertEqual({path.name: path.read_bytes() for path in destination.iterdir()}, self.data)
        self.assertEqual(self.transport.pending_transfers, [])
        self.assert_no_staging()
        commands = [argv for argv, _ in self.transport.calls]
        waits = [i for i, argv in enumerate(commands) if 'while [ ! -f ' in argv[-1]]
        hashes = next(i for i, argv in enumerate(commands) if 'sha256sum' in argv)
        self.assertEqual(len(waits), 2)
        self.assertLess(max(waits), hashes)

    def test_remote_write_failure_is_reported_without_waiting_for_timeout(self):
        self.require_shell()
        self.transport.remote_write_conflict = True
        started = time.monotonic()
        self.assertEqual(self.install(), 1)
        # The remote failure record must end the wait at once, not after a long poll.
        self.assertLess(time.monotonic() - started, 15)
        self.assertIn('Transfer completion not confirmed', self.stderr.getvalue())
        waits = [argv for argv, _ in self.transport.calls if 'while [ ! -f ' in argv[-1]]
        self.assertEqual(len(waits), 1)
        self.assert_no_staging()
        self.assertFalse((self.device / 'no_backup/tts/models').exists())
        self.assertFalse(any('mv ' in script and ' no_backup/tts/models;' in script
                             for script in self.transport.scripts()))

    def test_device_hash_mismatch_cleans_only_owned_staging(self):
        self.require_shell()
        keep = self.device / 'no_backup/tts/keep'
        keep.parent.mkdir(parents=True)
        keep.write_bytes(b'unrelated private data')
        self.transport.corrupt_upload = True
        self.assertEqual(self.install(), 1)
        self.assertIn('Device SHA256 mismatch', self.stderr.getvalue())
        self.assertTrue(any('rm ' in script for script in self.transport.scripts()))
        self.assert_no_staging()
        self.assertFalse((keep.parent / 'models').exists())
        self.assertEqual(keep.read_bytes(), b'unrelated private data')
        self.assertFalse(any('mv ' in script and ' no_backup/tts/models;' in script
                             for script in self.transport.scripts()))

    def test_missing_device_hash_cannot_publish(self):
        self.require_shell()
        self.transport.hash_output = b''
        self.assertEqual(self.install(), 1)
        self.assertIn('Device SHA256', self.stderr.getvalue())
        self.assertTrue(any('rm ' in script for script in self.transport.scripts()))
        self.assert_no_staging()
        self.assertFalse((self.device / 'no_backup/tts/models').exists())
        self.assertFalse(any('mv ' in script and ' no_backup/tts/models;' in script
                             for script in self.transport.scripts()))

    def test_partial_transfer_failure_cleans_staging(self):
        self.require_shell()
        self.transport.stream_failure = 'write'
        self.assertEqual(self.install(), 1)
        self.assertIn('Transfer failed for ' + NAMES[1], self.stderr.getvalue())
        self.assert_no_staging()
        self.assertFalse((self.device / 'no_backup/tts/models').exists())

    def test_timeout_closes_stream_and_cleans_staging(self):
        self.require_shell()
        self.transport.stream_failure = 'timeout'
        self.assertEqual(self.install(), 1)
        self.assert_no_staging()
        streams = [options['stdin'] for argv, options in self.transport.calls if argv[3] == 'exec-in']
        self.assertEqual(len(streams), 1)
        self.assertTrue(all(source.closed for source in streams))
        self.assertIn('timeout', self.stderr.getvalue().lower())

    def test_app_starting_during_copy_prevents_publication(self):
        self.require_shell()
        self.transport.running_on_check = 2
        self.assertEqual(self.install(), 1)
        self.assertEqual(self.transport.pid_checks, 2)
        self.assertIn('App is running', self.stderr.getvalue())
        self.assert_no_staging()
        self.assertFalse((self.device / 'no_backup/tts/models').exists())

    def test_destination_created_during_copy_is_preserved(self):
        self.require_shell()
        self.transport.destination_race = True
        self.assertEqual(self.install(), 1)
        destination = self.device / 'no_backup/tts/models'
        self.assertEqual(list(path.name for path in destination.iterdir()), ['existing'])
        self.assertEqual((destination / 'existing').read_bytes(), b'leave me alone')
        self.assert_no_staging()

    def test_cleanup_failure_is_reported_and_existing_models_survive(self):
        self.require_shell()
        self.transport.destination_race = True
        self.transport.cleanup_failure = True
        self.assertEqual(self.install(), 1)
        self.assertIn('cleanup', self.stderr.getvalue().lower())
        self.assertIn('failed', self.stderr.getvalue().lower())
        self.assertEqual((self.device / 'no_backup/tts/models/existing').read_bytes(), b'leave me alone')
        self.assertEqual(len(list((self.device / 'no_backup/tts').glob('.install-*'))), 1)

    def test_unconfirmed_staging_creation_never_deletes_unowned_data(self):
        self.require_shell()
        self.transport.creation_failure = True
        self.assertEqual(self.install(), 1)
        self.assertIn('Staging creation unconfirmed', self.stderr.getvalue())
        self.assertFalse(any('rm ' in script for script in self.transport.scripts()))

    def test_each_install_gets_a_unique_staging_directory(self):
        self.require_shell()
        self.assertEqual(self.install(), 0, self.stderr.getvalue())
        parent = self.device / 'no_backup/tts'
        (parent / 'models').rename(parent / 'previous')
        self.assertEqual(self.install(), 0, self.stderr.getvalue())
        creates = [script for script in self.transport.scripts() if 'mkdir -m 700' in script]
        self.assertEqual(len(creates), 2)
        self.assertNotEqual(creates[0], creates[1])


if __name__ == '__main__':
    unittest.main(verbosity=2)
