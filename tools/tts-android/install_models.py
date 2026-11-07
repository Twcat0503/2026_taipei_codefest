"""Explicit, no-overwrite model installation for a stopped Town Pass debug APK.

Run with Python -I -X utf8. Models must already be converted and verified against
models.json; this tool never downloads models, stops the app, or installs an APK.
"""
import argparse
import importlib.util
import json
from pathlib import Path
import re
import shlex
import subprocess
import sys
import uuid

TOOLS = Path(__file__).resolve().parent
MANIFEST_PATH = TOOLS / 'models.json'
PACKAGE = 'com.example.townpass'
MODEL_NAMES = ('barbet-q8_0-tokenizer.gguf', 'codec-q8_0-lmq8.gguf')
DESTINATION = 'no_backup/tts/models'
COMMAND_TIMEOUT = 30
TRANSFER_TIMEOUT = 1200
HASH_TIMEOUT = 600

# Explicit file loading works under -I without adding any directory to sys.path.
_SPEC = importlib.util.spec_from_file_location('tts_model_tools', TOOLS / 'model_tools.py')
_MODEL_TOOLS = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(_MODEL_TOOLS)

# All remote paths are fixed, or validated tool-generated staging paths. Reject
# dangling symlinks as well as ordinary existing destinations before any write.
PARENT_CHECKS = (
    'for p in no_backup no_backup/tts; do '
    '[ ! -L "$p" ] || exit 1; '
    'if [ -e "$p" ]; then [ -d "$p" ] || exit 1; fi; done; '
)
DESTINATION_CHECK = f'[ ! -e {DESTINATION} ]; [ ! -L {DESTINATION} ]; '


class InstallError(RuntimeError):
    pass


def load_expected():
    manifest = json.loads(MANIFEST_PATH.read_text(encoding='utf-8'))
    expected = manifest.get('quantized') if isinstance(manifest, dict) else None
    if not isinstance(expected, dict) or set(expected) != set(MODEL_NAMES):
        raise ValueError('Manifest must contain exactly the two supported model basenames')
    for name, spec in expected.items():
        if Path(name).name != name or '/' in name or '\\' in name:
            raise ValueError('Unsafe model basename')
        if (not isinstance(spec, dict) or type(spec.get('bytes')) is not int
                or spec['bytes'] <= 0 or not isinstance(spec.get('sha256'), str)
                or re.fullmatch(r'[0-9a-f]{64}', spec['sha256']) is None):
            raise ValueError(f'Invalid size or SHA256 in manifest: {name}')
    return expected


class Adb:
    def __init__(self, executable, serial):
        self.prefix = [executable, '-s', serial]

    def run(self, arguments, operation, *, timeout=COMMAND_TIMEOUT, stdin=None, check=True):
        try:
            result = subprocess.run(
                self.prefix + arguments,
                stdin=stdin if stdin is not None else subprocess.DEVNULL,
                stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                timeout=timeout, check=False, shell=False,
            )
        except subprocess.TimeoutExpired:
            raise InstallError(f'{operation}: timeout after {timeout}s') from None
        except OSError as error:
            raise InstallError(f'{operation}: cannot execute adb ({type(error).__name__})') from None
        if check and result.returncode != 0:
            # Do not dump process output or command lines into logs.
            raise InstallError(f'{operation}: adb exited {result.returncode}')
        return result

    def private_shell(self, script, operation, *, stdin=None, timeout=COMMAND_TIMEOUT):
        # adb shell joins arguments verbatim; exec-in already escapes each one.
        # Pre-quoting exec-in would turn the whole script into one command name.
        program = 'set -eu; ' + script
        return self.run(
            ['exec-in' if stdin is not None else 'shell', 'run-as', PACKAGE,
             'sh', '-c', program if stdin is not None else shlex.quote(program)],
            operation, stdin=stdin, timeout=timeout,
        )

    def require_stopped(self):
        result = self.run(['shell', 'pidof', PACKAGE], 'Check app process', check=False)
        if result.returncode == 1 and not result.stdout.strip() and not result.stderr.strip():
            return
        if result.returncode == 0 and result.stdout.strip():
            raise InstallError('App is running. Stop the app yourself before installing; no force-stop was sent.')
        raise InstallError('Cannot confirm app is stopped: pidof failed or returned an unexpected result')


def verify_device_hashes(output, stage, expected):
    try:
        lines = output.decode('ascii').splitlines()
    except UnicodeDecodeError:
        raise InstallError('Device SHA256 response is not ASCII') from None
    actual = {}
    for line in lines:
        match = re.fullmatch(r'([0-9a-f]{64}) [ *](.+)', line)
        if match is None or match[2] in actual:
            raise InstallError('Device SHA256 response is malformed or duplicated')
        actual[match[2]] = match[1]
    wanted = {f'{stage}/{name}': expected[name]['sha256'] for name in MODEL_NAMES}
    if actual != wanted:
        raise InstallError('Device SHA256 mismatch or missing model; nothing was published')


def install_models(models, serial, executable='adb'):
    if not serial or any(ord(char) < 32 for char in serial):
        raise ValueError('A nonempty, explicit device serial is required')
    expected = load_expected()
    models = Path(models).resolve(strict=True)
    # Both local files must pass before even pidof/run-as is allowed to run.
    _MODEL_TOOLS.verify_files(models, expected)
    adb = Adb(executable, serial)
    adb.require_stopped()
    adb.run(['shell', 'run-as', PACKAGE, 'true'], 'run-as unavailable; install a debuggable APK')
    adb.private_shell(PARENT_CHECKS + DESTINATION_CHECK,
                      'Destination exists or parent is unsafe; refusing to overwrite')

    stage = f'no_backup/tts/.install-{uuid.uuid4().hex}'
    if re.fullmatch(r'no_backup/tts/\.install-[0-9a-f]{32}', stage) is None:
        raise ValueError('Invalid generated staging path')
    quoted_stage = shlex.quote(stage)
    stage_checks = PARENT_CHECKS + f'[ ! -L {quoted_stage} ]; [ -d {quoted_stage} ]; '
    # mkdir (without -p for the unique directory) establishes ownership. If its
    # acknowledgement is lost, do not delete a path whose creation is unconfirmed.
    adb.private_shell(
        'umask 077; ' + PARENT_CHECKS + DESTINATION_CHECK
        + f'mkdir -p no_backup/tts; mkdir -m 700 {quoted_stage}',
        f'Staging creation unconfirmed ({stage}); inspect this path if interrupted',
    )
    try:
        # Android 9 toybox lacks -T. Probe on owned, empty directories before
        # transferring model bytes; never fall back to an unsafe nested move.
        adb.private_shell(
            stage_checks + f'mkdir {quoted_stage}/.publish-probe; '
            + f'mv -nT {quoted_stage}/.publish-probe {quoted_stage}/.publish-probe-ok; '
            + f'rmdir {quoted_stage}/.publish-probe-ok',
            'Device mv -nT unavailable; safe no-overwrite publication is required',
        )
        for name in MODEL_NAMES:
            target = shlex.quote(stage + '/' + name)
            ok = shlex.quote(stage + '/' + name + '.ok')
            failed = shlex.quote(stage + '/' + name + '.fail')
            with (models / name).open('rb') as source:
                # exec-in returns once stdin is sent, not when the remote cat exits.
                # The remote shell records its own result; only that record is trusted.
                adb.private_shell(
                    'umask 077; set -C; ' + stage_checks
                    + f'if cat > {target}; then : > {ok}; else : > {failed}; fi',
                    f'Transfer failed for {name}', stdin=source, timeout=TRANSFER_TIMEOUT,
                )
            # Wait for that record before hashing. Either record ends the wait at once;
            # the loop bound stays below the host-side command timeout.
            # The record only says the remote cat has exited. Its exit status alone
            # is not trusted: on some devices (seen on a Pixel 10 Pro XL, Android 17)
            # cat reports EIO when reading the end of the exec-in stream after every
            # byte was written. A regular file of exactly the expected size is
            # required either way, and the SHA-256 check below still gates publishing.
            size = expected[name]['bytes']
            adb.private_shell(
                stage_checks + 'n=0; '
                + f'while [ ! -f {ok} ] && [ ! -f {failed} ]; do n=$((n+1)); '
                + '[ "$n" -le 1100 ] || exit 1; sleep 1; done; '
                + f'[ -f {target} ]; [ ! -L {target} ]; '
                + f'[ "$(wc -c < {target} | tr -d " ")" -eq {size} ]; rm -f -- {ok} {failed}',
                f'Transfer completion not confirmed for {name} (missing or incomplete on device)',
                timeout=TRANSFER_TIMEOUT,
            )
        hashes = adb.run(
            ['shell', 'run-as', PACKAGE, 'sha256sum']
            + [shlex.quote(f'{stage}/{name}') for name in MODEL_NAMES],
            'Device SHA256 verification failed', timeout=HASH_TIMEOUT,
        )
        verify_device_hashes(hashes.stdout, stage, expected)
        adb.require_stopped()
        adb.private_shell(
            stage_checks + DESTINATION_CHECK
            + f'mv -nT {quoted_stage} {DESTINATION}; '
            + f'[ ! -e {quoted_stage} ]; [ ! -L {quoted_stage} ]',
            'Publish failed (destination may exist); existing models were not replaced',
        )
    except BaseException:
        try:
            # Never remove models, parent directories, or another installation's
            # staging. Parent/symlink checks also apply to cleanup.
            adb.private_shell(
                PARENT_CHECKS + f'[ ! -L {quoted_stage} ]; rm -rf -- {quoted_stage}',
                f'Cleanup failed for owned staging {stage}',
            )
        except (InstallError, KeyboardInterrupt) as cleanup_error:
            print(f'Cleanup failed; inspect owned staging {stage}: {cleanup_error}', file=sys.stderr)
        raise
    print(f'Installed both verified models in {PACKAGE}:{DESTINATION}')


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--adb', default='adb', help='adb executable path (default: adb)')
    parser.add_argument('--serial', required=True, help='explicit target device serial')
    parser.add_argument('--models', required=True, type=Path, help='existing quantized model directory')
    args = parser.parse_args(argv)
    try:
        install_models(args.models, args.serial, args.adb)
    except KeyboardInterrupt:
        print('Installation interrupted; no existing models were removed.', file=sys.stderr)
        return 130
    except (InstallError, OSError, ValueError) as error:
        print(f'Installation failed: {error}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
