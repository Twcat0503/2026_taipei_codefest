"""Regression checks for official-only tokenizer repair. Run with Python -I -X utf8.

Tests catch missing/wrong vocabulary, merge order, special IDs/types, unsupported
pre-tokenization, and any change to existing non-tokenizer metadata or tensors.
They read the official Tokenizer independently, never import the repair script.
"""
import argparse
import ctypes as C
import hashlib
import json
import os
from pathlib import Path
import sys
import unittest

import gguf
from tokenizers import Tokenizer


def digest_array(array):
    h = hashlib.sha256()
    raw = memoryview(array).cast("B")
    for start in range(0, len(raw), 8 * 1024 * 1024):
        h.update(raw[start:start + 8 * 1024 * 1024])
    return h.hexdigest()


# C ABI from the pinned llama.h, not any checkpoint/downloaded Python module.
class ModelParams(C.Structure):
    _fields_ = [
        ("devices", C.c_void_p), ("tensor_buft_overrides", C.c_void_p),
        ("n_gpu_layers", C.c_int32), ("split_mode", C.c_int),
        ("main_gpu", C.c_int32), ("tensor_split", C.c_void_p),
        ("progress_callback", C.c_void_p), ("progress_callback_user_data", C.c_void_p),
        ("kv_overrides", C.c_void_p),
        *[(name, C.c_bool) for name in (
            "vocab_only", "use_mmap", "use_direct_io", "use_mlock",
            "check_tensors", "use_extra_bufts", "no_host", "no_alloc")],
    ]


class RepairTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.src = gguf.GGUFReader(str(ARGS.source))
        cls.dst = gguf.GGUFReader(str(ARGS.candidate))
        cls.hf = Tokenizer.from_file(str(ARGS.official / "tokenizer.json"))
        cls.document = json.loads((ARGS.official / "tokenizer.json").read_text(encoding="utf-8"))
        cls.config = json.loads((ARGS.official / "config.json").read_text(encoding="utf-8"))["barbet_config"]
        cls.hf_vocab = cls.hf.get_vocab(with_added_tokens=True)

    def field(self, key):
        self.assertTrue(key in self.dst.fields, "missing metadata: " + key)
        return self.dst.fields[key].contents()

    def test_model_is_real_bpe(self):
        self.assertEqual(self.field("tokenizer.ggml.model"), "gpt2")

    def test_all_official_token_ids_and_unused_embedding_rows(self):
        tokens = self.field("tokenizer.ggml.tokens")
        self.assertEqual(len(tokens), self.config["vocab_size"])
        self.assertEqual(len(set(tokens)), len(tokens), "ambiguous duplicate token strings")
        for token, idx in self.hf_vocab.items():
            if tokens[idx] != token:
                self.fail(f"official token {idx} differs: {token!r} != {tokens[idx]!r}")
        types = self.field("tokenizer.ggml.token_type")
        for idx in set(range(len(tokens))) - set(self.hf_vocab.values()):
            self.assertEqual(types[idx], 5, f"padding row {idx} must be UNUSED")

    def test_merges_order_matches_official_bpe(self):
        expected = [" ".join(pair) if isinstance(pair, list) else pair
                    for pair in self.document["model"]["merges"]]
        self.assertEqual(self.field("tokenizer.ggml.merges"), expected)

    def test_token_types_match_added_token_semantics(self):
        types = self.field("tokenizer.ggml.token_type")
        self.assertEqual(len(types), self.config["vocab_size"])
        added = {item["id"]: item for item in self.document["added_tokens"]}
        for token, idx in self.hf_vocab.items():
            expected = 2 if idx == self.config["unk_token_id"] else (
                3 if added.get(idx, {}).get("special") else 4 if idx in added else 1)
            if types[idx] != expected:
                self.fail(f"token type at ID {idx}: {types[idx]} != {expected}")

    def test_standard_special_ids(self):
        for key, value in (("bos", 114689), ("eos", 114690),
                           ("padding", 114691), ("unknown", 114688)):
            self.assertEqual(self.field(f"tokenizer.ggml.{key}_token_id"), value)
        self.assertFalse(self.field("tokenizer.ggml.add_bos_token"))
        self.assertFalse(self.field("tokenizer.ggml.add_eos_token"))
        self.assertFalse(self.field("tokenizer.ggml.add_space_prefix"))

    def test_exact_official_tokenizer_document_preserved(self):
        # Retain the entire official Sequence and BPE options, not only a
        # misleading 'default' preset. Current runtime may not consume it.
        self.assertEqual(json.loads(self.field("tokenizer.huggingface.json")), self.document)
        self.assertNotIn(self.field("tokenizer.ggml.pre"), ("", "none", "default"))

    def test_original_nontokenizer_metadata_is_byte_identical(self):
        for key, src in self.src.fields.items():
            if key.startswith(("GGUF.", "tokenizer.")):
                continue
            self.assertIn(key, self.dst.fields)
            dst = self.dst.fields[key]
            self.assertEqual(b"".join(x.tobytes() for x in src.parts),
                             b"".join(x.tobytes() for x in dst.parts), key)

    def test_all_tensor_descriptors_and_bytes_unchanged(self):
        self.assertEqual(len(self.src.tensors), 324)
        self.assertEqual(len(self.dst.tensors), len(self.src.tensors))
        for src, dst in zip(self.src.tensors, self.dst.tensors):
            self.assertEqual(src.name, dst.name)
            self.assertEqual(src.tensor_type, dst.tensor_type, src.name)
            self.assertEqual(src.shape.tolist(), dst.shape.tolist(), src.name)
            self.assertEqual(src.n_bytes, dst.n_bytes, src.name)
            self.assertEqual(src.data_offset - self.src.data_offset,
                             dst.data_offset - self.dst.data_offset, src.name)
            self.assertEqual(digest_array(src.data), digest_array(dst.data), src.name)
        # This also covers inter-tensor padding and any trailing bytes.
        self.assertEqual(digest_array(self.src.data[self.src.data_offset:]),
                         digest_array(self.dst.data[self.dst.data_offset:]))
        self.assertEqual(self.dst.data_offset % self.dst.alignment, 0)

    def test_runtime_tokens_match_official(self):
        if not ARGS.dll:
            self.skipTest("pass --dll to check actual runtime tokenizer")
        self.assertEqual(self.field("tokenizer.ggml.model"), "gpt2")
        handles = []
        if os.name == "nt":
            handles = [os.add_dll_directory(str(path.resolve()))
                       for path in [ARGS.dll.parent, *ARGS.dll_directory]]
        lib = C.CDLL(str(ARGS.dll))
        lib.llama_model_default_params.restype = ModelParams
        lib.llama_model_default_params.argtypes = []
        lib.llama_model_load_from_file.restype = C.c_void_p
        lib.llama_model_load_from_file.argtypes = [C.c_char_p, ModelParams]
        lib.llama_model_get_vocab.restype = C.c_void_p
        lib.llama_model_get_vocab.argtypes = [C.c_void_p]
        lib.llama_tokenize.restype = C.c_int32
        lib.llama_tokenize.argtypes = [C.c_void_p, C.c_char_p, C.c_int32,
                                      C.POINTER(C.c_int32), C.c_int32, C.c_bool, C.c_bool]
        lib.llama_model_free.argtypes = [C.c_void_p]
        lib.llama_model_free.restype = None
        params = lib.llama_model_default_params()
        params.vocab_only = True
        params.n_gpu_layers = 0
        model = lib.llama_model_load_from_file(str(ARGS.candidate).encode("utf-8"), params)
        self.assertTrue(model, "runtime refused the candidate tokenizer")
        samples = [
            "您好，這是語音測試。", "<|audio_start|>",
            "<s><|task:text_to_speech|>您好，這是語音測試。<|audio_start|>",
            "abc12345ABC", "1234567890", "HelloWorld HTTPServer XMLParser",
            "I'M Don't shouldn't 're 's", "e\u0301", "a\n\n b", "\r\n\t  ",
            "繁體中文、臺北市；注音ㄅㄆㄇ，混合English ABC123。", "😊😀",
            "ÀÉÖàéöİıΣσςǅǆǄ Aᵃ中é", "a b　c\u0085d",
            "\x00\x01\x02\x0b\x0c\x1f end", "𐐀𐐨𝔄𝔞ＡａⅣⅳ１２３",
        ]
        # 固定種子涵蓋大小寫、組合記號、多語文字、數字與空白交界。
        import random
        rng = random.Random(20261107)
        alphabet = "abcXYZ0123456臺北您好語音\r\n\t /'?!。ÀéİıΣσςǅǆǄᵃ́ 　😊𐐀𐐨𝔄𝔞ＡａⅣⅳ１２３"
        samples += [''.join(rng.choice(alphabet) for _ in range(rng.randrange(1, 80)))
                    for _ in range(400)]
        samples += ["a" + item["content"] + "中" for item in self.document["added_tokens"]]
        if ARGS.runtime_short_only:
            samples = samples[:3]
        failures = []
        try:
            vocab = lib.llama_model_get_vocab(model)
            for text in samples:
                expected = self.hf.encode(text, add_special_tokens=False).ids
                raw = text.encode("utf-8")
                buf = (C.c_int32 * (len(raw) + 32))()
                size = lib.llama_tokenize(vocab, raw, len(raw), buf, len(buf), False, True)
                actual = list(buf[:size]) if size >= 0 else [f"capacity error {size}"]
                if actual != expected:
                    failures.append({"text": text, "official": expected, "runtime": actual})
            print("RUNTIME_PARITY", json.dumps({"cases": len(samples), "failures": failures}, ensure_ascii=False), flush=True)
            self.assertFalse(failures, json.dumps(failures, ensure_ascii=False))
        finally:
            lib.llama_model_free(model)
            for handle in handles:
                handle.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--candidate", type=Path, required=True)
    parser.add_argument("--official", type=Path, required=True)
    parser.add_argument("--dll", type=Path)
    parser.add_argument("--dll-directory", type=Path, action="append", default=[])
    parser.add_argument("--runtime-short-only", action="store_true")
    ARGS, remaining = parser.parse_known_args()
    unittest.main(argv=[sys.argv[0]] + remaining, verbosity=2)
