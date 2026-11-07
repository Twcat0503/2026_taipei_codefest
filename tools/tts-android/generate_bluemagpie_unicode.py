"""以 HF tokenizers 相同的 regex 引擎產生 BlueMagpie Unicode 分類表。

Python -I -X utf8 generate_bluemagpie_unicode.py <新 header 路徑>
只產生編譯期常數，Android runtime 不需要 Python 或 HF tokenizers。
"""
import sys
from pathlib import Path
import tokenizers
from tokenizers import Regex, pre_tokenizers


def main():
    if tokenizers.__version__ != "0.23.3":
        raise RuntimeError("requires tokenizers==0.23.3")
    output = Path(sys.argv[1])
    # 所有合法 Unicode scalar；分類由實際 tokenizer 引擎決定，不用近似大小寫。
    text = ''.join(chr(cp) for cp in range(0x110000) if not 0xD800 <= cp <= 0xDFFF)
    classes = bytearray(b'?' * 0x110000)
    for prop, code in [('Lu', 'U'), ('Lt', 'T'), ('Ll', 'l'), ('Lm', 'm'),
                       ('Lo', 'o'), ('M', 'M'), ('N', '0')]:
        splitter = pre_tokenizers.Split(Regex(r'\p{' + prop + '}+'), behavior='removed', invert=True)
        for match, _ in splitter.pre_tokenize_str(text):
            for char in match:
                classes[ord(char)] = ord(code)
    whitespace = pre_tokenizers.Split(Regex(r'\s+'), behavior='removed', invert=True)
    for match, _ in whitespace.pre_tokenize_str(text):
        for char in match:
            classes[ord(char)] = 11
    # regex 內有這四個 literal；其餘 whitespace 以 VT 保留 \s 語意。
    for char in '\r\n /':
        classes[ord(char)] = ord(char)
    ranges = [(0, classes[0])]
    for cp in range(1, len(classes)):
        if classes[cp] != classes[cp - 1]:
            ranges.append((cp, classes[cp]))
    content = '// 由 generate_bluemagpie_unicode.py 產生；HF tokenizers ' + tokenizers.__version__ + '\n'
    content += 'struct bluemagpie_unicode_range { uint32_t start; unsigned char category; };\n'
    content += 'static constexpr bluemagpie_unicode_range bluemagpie_unicode_ranges[] = {\n'
    content += ''.join(f'    {{0x{cp:X}, {code}}},\n' for cp, code in ranges)
    content += '};\n'
    with output.open('x', encoding='utf-8', newline='\n') as f:
        f.write(content)
    print(f'tokenizers={tokenizers.__version__} ranges={len(ranges)} bytes={len(content.encode("utf-8"))}')


if __name__ == '__main__':
    main()
