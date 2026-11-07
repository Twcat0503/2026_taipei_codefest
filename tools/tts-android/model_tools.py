"""從已下載的官方來源自行轉換Q8_0；所有checkpoint先驗大小及SHA256。

用 Python -I -X utf8 執行。下載資料與這些腳本分開，不下載或執行模型repo的Python。
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

TOOLS = Path(__file__).resolve().parent


def verify_files(directory, expected, *, exact=False):
    directory = directory.resolve(strict=True)
    # 上游 precision detector 會遞迴掃描 checkpoint；官方輸入只能有已驗白名單。
    if exact and {entry.name for entry in directory.iterdir()} != set(expected):
        raise ValueError('官方來源目錄只能包含 manifest 的五個檔案，不允許額外檔案或子目錄')
    for name, spec in expected.items():
        if Path(name).name != name or '/' in name or '\\' in name:
            raise ValueError('不允許模型路徑跳脫')
        path = directory / name
        if path.is_symlink() or not path.is_file() or path.stat().st_size != spec['bytes']:
            raise ValueError(f'缺少檔案或大小不符: {name}')
        with path.open('rb') as source:
            actual = hashlib.file_digest(source, 'sha256').hexdigest()
        if actual != spec['sha256']:
            raise ValueError(f'SHA256不符: {name}')
        print(f'已驗證: {name}', flush=True)


def conversion_environment():
    env = os.environ.copy()
    # 即使 pinned 上游明寫 weights_only=False，也禁止一般 pickle 反序列化。
    env.pop('TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD', None)
    env['TORCH_FORCE_WEIGHTS_ONLY_LOAD'] = '1'
    return env


def conversion_commands(runtime, official, output, quantizer):
    python = [sys.executable, '-I', '-X', 'utf8']
    return [
        python + [str(runtime / 'common/third-party/llama.cpp/convert_barbet_to_gguf.py'),
                  '--src', str(official / 'pytorch_model.bin'), '--config', str(official / 'config.json'),
                  '--out', str(output / 'barbet-f16.gguf'), '--outtype', 'f16'],
        [str(quantizer), str(output / 'barbet-f16.gguf'), str(output / 'barbet-q8_0.gguf'), 'Q8_0', '4'],
        python + [str(TOOLS / 'repair_tokenizer.py'), '--source', str(output / 'barbet-q8_0.gguf'),
                  '--official', str(official), '--out', str(output / 'barbet-q8_0-tokenizer.gguf')],
        python + [str(runtime / 'scripts/convert-to-gguf.py'), '--model-type', 'bluemagpie',
                  '--checkpoint-path', str(official), '--output', str(output / 'codec-q8_0-lmq8.gguf'),
                  '--outtype', 'F16', '--quantization', 'Q8_0', '--lm-outtype', 'F16', '--lm-quantization', 'Q8_0'],
    ]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    verify = commands.add_parser('verify')
    verify.add_argument('kind', choices=['official', 'quantized'])
    verify.add_argument('directory', type=Path)
    convert = commands.add_parser('convert')
    convert.add_argument('--official', required=True, type=Path)
    convert.add_argument('--runtime', required=True, type=Path)
    convert.add_argument('--quantizer', required=True, type=Path)
    convert.add_argument('--out', required=True, type=Path)
    args = parser.parse_args()
    manifest = json.loads((TOOLS / 'models.json').read_text(encoding='utf-8'))
    if args.command == 'verify':
        verify_files(args.directory, manifest[args.kind], exact=args.kind == 'official')
        return
    runtime = args.runtime.resolve(strict=True)
    official = args.official.resolve(strict=True)
    quantizer = args.quantizer.resolve(strict=True)
    output = args.out.resolve()
    if output.exists():
        raise FileExistsError('輸出目錄必須是新目錄，避免覆蓋先前模型')
    for path, revision in ((runtime, manifest['runtime']['codec_cpp']),
                           (runtime / 'common/third-party/llama.cpp', manifest['runtime']['llama_cpp'])):
        actual = subprocess.check_output(['git', '-C', str(path), 'rev-parse', 'HEAD'], text=True).strip()
        if actual != revision:
            raise ValueError('runtime revision不符')
    verify_files(official, manifest['official'], exact=True)
    if shutil.disk_usage(output.parent).free < 5_000_000_000:
        raise OSError('轉換輸出至少需5GB可用磁碟空間，不含官方checkpoint')
    output.mkdir()
    for command in conversion_commands(runtime, official, output, quantizer):
        subprocess.run(command, cwd=TOOLS, env=conversion_environment(), check=True)
    verify_files(output, manifest['quantized'])
    print('Q8產物hash已通過；仍需執行tokenizer parity與Android推論測試。')


if __name__ == '__main__':
    main()
