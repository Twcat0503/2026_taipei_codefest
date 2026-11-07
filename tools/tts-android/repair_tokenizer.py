"""Attach official tokenizer data without converting or touching tensor bytes.

Run with Python -I -X utf8. --pre is intentionally explicit: a supported preset
is not proof of equivalent pre-tokenization. Run test_tokenizer_repair.py with
--dll before accepting any artifact. --vocab-only writes a small runtime probe.
Only reads official JSON and this user's self-converted source GGUF; never reads
community weights/header, torch checkpoints, or any remote executable code.
"""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import shutil
import struct

import gguf


def pack_string(value):
    raw = value.encode("utf-8")
    return struct.pack("<Q", len(raw)) + raw


def record(key, value, kind, subtype=None):
    prefix = pack_string(key) + struct.pack("<I", kind)
    if kind == 8:
        return prefix + pack_string(value)
    if kind == 4:
        return prefix + struct.pack("<I", value)
    if kind == 7:
        return prefix + struct.pack("<?", value)
    if kind == 9:
        prefix += struct.pack("<IQ", subtype, len(value))
        if subtype == 8:
            return prefix + b"".join(pack_string(item) for item in value)
        if subtype == 5:
            return prefix + struct.pack("<" + "i" * len(value), *value)
    raise ValueError(f"unsupported metadata type {kind}/{subtype}")


def official_metadata(directory, n_vocab, pre):
    raw = (directory / "tokenizer.json").read_text(encoding="utf-8")
    doc = json.loads(raw)
    tc = json.loads((directory / "tokenizer_config.json").read_text(encoding="utf-8"))
    config = json.loads((directory / "config.json").read_text(encoding="utf-8"))["barbet_config"]
    assert config["vocab_size"] == n_vocab
    assert doc["model"]["type"] == "BPE"
    assert doc["normalizer"] is None
    assert doc["model"]["ignore_merges"] is False
    assert doc["model"]["byte_fallback"] is False
    assert doc["model"]["continuing_subword_prefix"] == ""
    assert doc["model"]["end_of_word_suffix"] == ""
    assert doc["post_processor"]["single"] == [{"Sequence": {"id": "A", "type_id": 0}}]
    assert not doc["post_processor"]["special_tokens"]
    vocab = dict(doc["model"]["vocab"])
    types = [5] * n_vocab
    tokens = [None] * n_vocab
    for token, idx in vocab.items():
        assert 0 <= idx < n_vocab and tokens[idx] is None
        tokens[idx] = token
        types[idx] = 1
    for item in doc["added_tokens"]:
        idx, token = item["id"], item["content"]
        assert 0 <= idx < n_vocab
        assert tokens[idx] in (None, token)
        assert not any(item[k] for k in ("single_word", "lstrip", "rstrip", "normalized"))
        tokens[idx] = token
        types[idx] = 3 if item["special"] else 4
        vocab[token] = idx
    for idx in range(n_vocab):
        if tokens[idx] is None:
            tokens[idx] = f"[PAD{idx}]"
    assert len(set(tokens)) == n_vocab
    types[config["unk_token_id"]] = 2
    merges = [" ".join(item) if isinstance(item, list) else item for item in doc["model"]["merges"]]
    for merge in merges:
        left, right = merge.split(" ")
        assert left in vocab and right in vocab
    items = [
        record("tokenizer.ggml.model", "gpt2", 8),
        record("tokenizer.ggml.pre", pre, 8),
        record("tokenizer.ggml.tokens", tokens, 9, 8),
        record("tokenizer.ggml.merges", merges, 9, 8),
        record("tokenizer.ggml.token_type", types, 9, 5),
        record("tokenizer.ggml.add_bos_token", False, 7),
        record("tokenizer.ggml.add_eos_token", False, 7),
        record("tokenizer.ggml.add_space_prefix", tc["add_prefix_space"], 7),
        record("tokenizer.huggingface.json", json.dumps(doc, ensure_ascii=False, separators=(",", ":")), 8),
    ]
    for gguf_name, config_name in (("bos", "bos"), ("eos", "eos"),
                                   ("padding", "pad"), ("unknown", "unk")):
        idx = config[config_name + "_token_id"]
        assert vocab[tc[config_name + "_token"]] == idx
        items.append(record(f"tokenizer.ggml.{gguf_name}_token_id", idx, 4))
    print(json.dumps({"official_tokens": len(vocab), "vocab_rows": n_vocab,
                      "merges": len(merges), "token_types": Counter(types),
                      "pre_preset_under_test": pre,
                      "official_pre_tokenizer": doc["pre_tokenizer"],
                      "runtime_parity": "NOT_YET_VERIFIED"}, ensure_ascii=False), flush=True)
    return items


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", required=True, type=Path)
    ap.add_argument("--official", required=True, type=Path)
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--pre", choices=["bluemagpie"], default="bluemagpie")
    ap.add_argument("--vocab-only", action="store_true")
    args = ap.parse_args()
    source = args.source.resolve(strict=True)
    output = args.out.resolve()
    if output.parent != source.parent or output.suffix != ".gguf":
        raise ValueError("output must be a new GGUF alongside the existing out/ source")
    if output.exists() or output == source:
        raise FileExistsError(output)
    r = gguf.GGUFReader(str(source))
    assert r.byte_order == "I" and r.fields["GGUF.version"].contents() == 3
    assert r.fields["general.architecture"].contents() == "barbet"
    assert len(r.tensors) == 324
    metadata = [b"".join(part.tobytes() for part in field.parts)
                for key, field in r.fields.items()
                if not key.startswith(("GGUF.", "tokenizer."))]
    metadata += official_metadata(args.official, r.fields["barbet.vocab_size"].contents(), args.pre)
    # Preserve every tensor descriptor byte (including type and relative offset).
    first = r.tensors[0].field.offset
    last = r.tensors[-1].field
    end = last.offset + sum(part.nbytes for part in last.parts)
    with output.open("xb") as target:
        target.write(struct.pack("<4sIQQ", b"GGUF", 3, 0 if args.vocab_only else len(r.tensors), len(metadata)))
        for item in metadata:
            target.write(item)
        if not args.vocab_only:
            target.write(memoryview(r.data[first:end]))
        target.write(b"\0" * (-target.tell() % r.alignment))
        offset = target.tell()
        if not args.vocab_only:
            with source.open("rb") as original:
                original.seek(r.data_offset)
                shutil.copyfileobj(original, target, length=8 * 1024 * 1024)
    with output.open("rb") as f:
        digest = hashlib.file_digest(f, "sha256").hexdigest()
    print(json.dumps({"output": str(output), "size": output.stat().st_size,
                      "sha256": digest, "data_offset": offset,
                      "source_data_offset": int(r.data_offset), "vocab_only_probe": args.vocab_only,
                      "acceptance": "CANDIDATE; run independent metadata, tensor and runtime regression"}), flush=True)


if __name__ == "__main__":
    main()
