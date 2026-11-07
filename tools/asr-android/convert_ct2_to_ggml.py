#!/usr/bin/env python3
"""把 CTranslate2 格式的 Whisper 模型（faster-whisper 用的 model.bin）轉成 whisper.cpp 的 GGML 檔。

用法：
    python tools/asr-android/convert_ct2_to_ggml.py MODEL_DIR OUT_PATH [--ftype f16|f32]

    MODEL_DIR  CTranslate2 模型目錄（必填），需有 model.bin 與 vocabulary.json；
               preprocessor_config.json、config.json 若存在會拿來交叉檢查。
    OUT_PATH   輸出的 GGML 檔（必填），例如 ggml-model-f16.bin。
    --ftype    權重精度，預設 f16；f32 的檔案大小約為兩倍。

只依賴 Python 標準函式庫與 numpy（不需要 torch、transformers、ctranslate2）。
q4_0 等量化請再用 whisper.cpp 的 whisper-quantize 處理這裡輸出的 f16 檔。
只支援浮點權重（float16 / float32 / bfloat16）；int8 量化過的 CTranslate2 模型無法還原。

輸出格式與 whisper.cpp 的 models/convert-h5-to-ggml.py 相同（舊式 "ggml" magic，
由 src/whisper.cpp 的 whisper_model_load() 讀取）：
  1. 檔頭：magic 與 11 個 int32 超參數
     n_vocab, n_audio_ctx, n_audio_state, n_audio_head, n_audio_layer,
     n_text_ctx, n_text_state, n_text_head, n_text_layer, n_mels, ftype
  2. mel 濾波器：n_mel、n_fft（= 1 + 400 / 2），接著 n_mel * n_fft 個 float32
  3. 詞彙：數量，接著每個 token 的 uint32 長度與原始 bytes。與官方 ggml 模型相同，
     只寫 <|endoftext|> 之前的一般 BPE token；特殊、語言、時間戳 token 由 whisper.cpp
     依 n_vocab 自行補上，所以這裡會檢查詞彙表的特殊 token 排列與 whisper.cpp 的假設一致。
  4. 張量：int32 n_dims、名稱長度、ttype（0 = f32、1 = f16），各維大小（反序，ne[0] 在前），
     名稱，資料。2、3 維權重存 f16（--ftype f32 時存 f32）；1 維張量、conv bias
     （reshape 成 [n, 1]）與兩個 positional embedding 一律存 f32。

CTranslate2 → whisper.cpp 張量對映（依 CTranslate2 轉換器的 WhisperLoader 與 fuse_linear）：
  encoder/conv{1,2}/{weight,bias}         → encoder.conv{1,2}.*（weight 軸序與 HF 相同
                                            [out, in, kernel]，不需轉置）
  encoder/position_encodings/encodings    → encoder.positional_embedding
  encoder/layer_norm/{gamma,beta}         → encoder.ln_post.{weight,bias}
  */layer_N/self_attention/linear_0       → attn.{query,key,value}（沿 dim0 依 q、k、v 拼接）
  */layer_N/self_attention/linear_1       → attn.out
  */layer_N/self_attention/layer_norm     → attn_ln
  decoder/layer_N/attention/linear_0      → cross_attn.query
  decoder/layer_N/attention/linear_1      → cross_attn.{key,value}（沿 dim0 依 k、v 拼接）
  decoder/layer_N/attention/linear_2      → cross_attn.out
  decoder/layer_N/attention/layer_norm    → cross_attn_ln
  */layer_N/ffn/linear_0、linear_1        → mlp.0、mlp.2
  */layer_N/ffn/layer_norm                → mlp_ln
  decoder/embeddings/weight               → decoder.token_embedding.weight
  decoder/position_encodings/encodings    → decoder.positional_embedding
  decoder/layer_norm/{gamma,beta}         → decoder.ln.{weight,bias}
  decoder/projection/weight               與 token embedding 綁定（tied），不寫出
whisper.cpp 的 key 投影沒有 bias；CTranslate2 融合時以 0 補上，這裡驗證該段全為 0 後丟棄
（若不為 0，代表融合順序與預期不同，直接報錯）。
"""

import argparse
import json
import os
import struct
import sys

import numpy as np

GGML_FILE_MAGIC = 0x67676D6C  # "ggml"

# CTranslate2 model.bin 的格式版本與規格名稱（CTranslate2 python/ctranslate2/specs/model_spec.py）
CT2_BINARY_VERSION = 6
CT2_SPEC_NAME = "WhisperSpec"
CT2_SPEC_REVISION = 3

# CTranslate2 DataType 列舉的順序（include/ctranslate2/types.h）
CT2_DTYPES = {
    0: ("float32", "<f4"),
    1: ("int8", "i1"),
    2: ("int16", "<i2"),
    3: ("int32", "<i4"),
    4: ("float16", "<f2"),
    5: ("bfloat16", "<u2"),
}
CT2_FLOAT_DTYPES = ("float32", "float16", "bfloat16")

# 讀取並檢查、但不寫出的純量變數；值為 None 表示只讀不檢查
CT2_SCALARS = {
    "encoder/num_heads": None,
    "decoder/num_heads": None,
    "decoder/pre_norm": 1,
    "decoder/activation": 3,  # common_spec.Activation.GELU
    "decoder/scale_embeddings": 0,
    "decoder/alibi": 0,
    "decoder/start_from_zero_embedding": 0,
    "decoder/alibi_use_positive_positions": None,
    "decoder/scale_alibi": None,
    "decoder/alignment_heads": None,
    "decoder/alignment_layer": None,
}

# whisper.cpp 寫死的音訊前處理參數（WHISPER_SAMPLE_RATE、WHISPER_N_FFT、WHISPER_HOP_LENGTH、WHISPER_CHUNK_SIZE）
SAMPLE_RATE = 16000
N_FFT = 400
HOP_LENGTH = 160
CHUNK_LENGTH = 30

# whisper.cpp 的語言表（src/whisper.cpp 的 g_lang），索引即 language id
WHISPER_CPP_LANGS = (
    "en", "zh", "de", "es", "ru", "ko", "fr", "ja", "pt", "tr", "pl", "ca", "nl", "ar", "sv",
    "it", "id", "hi", "fi", "vi", "he", "uk", "el", "ms", "cs", "ro", "da", "hu", "ta", "no",
    "th", "ur", "hr", "bg", "lt", "la", "mi", "ml", "cy", "sk", "te", "fa", "lv", "bn", "sr",
    "az", "sl", "kn", "et", "mk", "br", "eu", "is", "hy", "ne", "mn", "bs", "kk", "sq", "sw",
    "gl", "mr", "pa", "si", "km", "sn", "yo", "so", "af", "oc", "ka", "be", "tg", "sd", "gu",
    "am", "yi", "lo", "uz", "fo", "ht", "ps", "tk", "nn", "mt", "sa", "lb", "my", "bo", "tl",
    "mg", "as", "tt", "haw", "ln", "ha", "ba", "jw", "su", "yue",
)

# 即使 ftype 為 f16，whisper.cpp 也以 GGML_TYPE_F32 建立的 2 維張量
F32_TENSORS = frozenset((
    "encoder.conv1.bias",
    "encoder.conv2.bias",
    "encoder.positional_embedding",
    "decoder.positional_embedding",
))

# whisper-quantize 讀詞彙時用 char word[129]，token 不可超過 128 bytes
MAX_TOKEN_BYTES = 128


class ConversionError(Exception):
    pass


def check(cond, msg):
    if not cond:
        raise ConversionError(msg)


class Ct2ModelBin:
    """CTranslate2 model.bin（binary version 6）的唯讀索引，張量於取用時才讀進記憶體。

    格式（CTranslate2 ModelSpec._serialize，little-endian）：
      uint32 version；string spec_name；uint32 revision；uint32 n_variables；
      每個變數：string name、uint8 rank、uint32 dims[rank]、uint8 dtype、uint32 nbytes、資料；
      uint32 n_aliases；每個 alias：string alias、string target。
      string = uint16 長度（含結尾 NUL）+ UTF-8 bytes + NUL。
    """

    def __init__(self, path):
        self.path = path
        self.variables = {}  # name -> (shape, dtype_name, numpy_dtype, offset, nbytes)
        self.aliases = {}
        self.used = set()
        self._file = open(path, "rb")
        self._index()

    def close(self):
        self._file.close()

    def _read(self, fmt):
        size = struct.calcsize(fmt)
        buf = self._file.read(size)
        check(len(buf) == size, "model.bin 提早結束（檔案不完整？）")
        return struct.unpack(fmt, buf)

    def _read_string(self):
        (length,) = self._read("<H")
        raw = self._file.read(length)
        check(len(raw) == length and raw.endswith(b"\0"), "model.bin 的字串格式不正確")
        return raw[:-1].decode("utf-8")

    def _index(self):
        f = self._file
        file_size = os.fstat(f.fileno()).st_size
        (self.version,) = self._read("<I")
        check(self.version == CT2_BINARY_VERSION,
              "不支援的 model.bin 版本 %d（只驗證過版本 %d）" % (self.version, CT2_BINARY_VERSION))
        self.spec_name = self._read_string()
        check(self.spec_name == CT2_SPEC_NAME,
              "model.bin 的規格是 %r，不是 %r" % (self.spec_name, CT2_SPEC_NAME))
        (self.revision,) = self._read("<I")
        check(self.revision == CT2_SPEC_REVISION,
              "WhisperSpec revision %d 未驗證（只驗證過 %d）" % (self.revision, CT2_SPEC_REVISION))
        (n_vars,) = self._read("<I")
        for _ in range(n_vars):
            name = self._read_string()
            (rank,) = self._read("<B")
            shape = tuple(self._read("<%dI" % rank)) if rank else ()
            (type_id,) = self._read("<B")
            (nbytes,) = self._read("<I")
            check(type_id in CT2_DTYPES, "變數 %s 的 dtype id %d 不明" % (name, type_id))
            dtype_name, np_dtype = CT2_DTYPES[type_id]
            count = int(np.prod(shape, dtype=np.int64))
            check(count * np.dtype(np_dtype).itemsize == nbytes,
                  "變數 %s 的大小 %d 與形狀 %s 不符" % (name, nbytes, shape))
            self.variables[name] = (shape, dtype_name, np_dtype, f.tell(), nbytes)
            f.seek(nbytes, os.SEEK_CUR)
        (n_aliases,) = self._read("<I")
        for _ in range(n_aliases):
            alias = self._read_string()
            self.aliases[alias] = self._read_string()
        check(f.tell() == file_size, "model.bin 結尾有多餘資料（%d / %d bytes）" % (f.tell(), file_size))

    def has(self, name):
        return name in self.variables or name in self.aliases

    def shape(self, name):
        target = self.aliases.get(name, name)
        check(target in self.variables, "model.bin 缺少變數 %s" % name)
        return self.variables[target][0]

    def get(self, name):
        """讀取變數；浮點權重一律回傳 float32 numpy 陣列（float16 → float32 為無損轉換）。"""
        target = self.aliases.get(name, name)
        check(target in self.variables, "model.bin 缺少變數 %s" % name)
        self.used.add(name)
        self.used.add(target)
        shape, dtype_name, np_dtype, offset, nbytes = self.variables[target]
        self._file.seek(offset)
        data = np.fromfile(self._file, dtype=np_dtype, count=nbytes // np.dtype(np_dtype).itemsize)
        check(data.size * data.itemsize == nbytes, "讀取變數 %s 時資料不足" % name)
        data = data.reshape(shape)
        if dtype_name == "bfloat16":
            data = (data.astype(np.uint32) << 16).view(np.float32)
        elif dtype_name in CT2_FLOAT_DTYPES:
            data = data.astype(np.float32)
        return data

    def get_float(self, name):
        target = self.aliases.get(name, name)
        check(target in self.variables, "model.bin 缺少變數 %s" % name)
        dtype_name = self.variables[target][1]
        check(dtype_name in CT2_FLOAT_DTYPES,
              "變數 %s 是 %s；只支援浮點權重（int8 量化過的模型無法轉換）" % (name, dtype_name))
        return self.get(name)

    def get_scalar(self, name):
        check(self.has(name) and self.shape(name) == (), "model.bin 缺少純量 %s" % name)
        return self.get(name).item()


def slaney_mel_filters(sr=SAMPLE_RATE, n_fft=N_FFT, n_mels=80, fmin=0.0, fmax=None):
    """Slaney 式 mel 濾波器（等同 librosa.filters.mel 預設：htk=False、norm='slaney'）。

    以 float64 計算後轉成 float32，形狀為 [n_mels, 1 + n_fft // 2]。
    """
    if fmax is None:
        fmax = sr / 2.0
    f_sp = 200.0 / 3.0                 # 線性區每個 mel 的 Hz 數
    min_log_hz = 1000.0                # 對數區起點（Hz）
    min_log_mel = min_log_hz / f_sp    # 對數區起點（mel）
    logstep = np.log(6.4) / 27.0       # 對數區步長

    def hz_to_mel(hz):
        hz = np.asarray(hz, dtype=np.float64)
        log_part = min_log_mel + np.log(np.maximum(hz, min_log_hz) / min_log_hz) / logstep
        return np.where(hz >= min_log_hz, log_part, hz / f_sp)

    def mel_to_hz(mel):
        mel = np.asarray(mel, dtype=np.float64)
        log_part = min_log_hz * np.exp(logstep * (mel - min_log_mel))
        return np.where(mel >= min_log_mel, log_part, mel * f_sp)

    fft_freqs = np.fft.rfftfreq(n=n_fft, d=1.0 / sr)
    mel_freqs = mel_to_hz(np.linspace(hz_to_mel(fmin), hz_to_mel(fmax), n_mels + 2))
    fdiff = np.diff(mel_freqs)
    ramps = np.subtract.outer(mel_freqs, fft_freqs)
    lower = -ramps[:-2] / fdiff[:-1, None]
    upper = ramps[2:] / fdiff[1:, None]
    weights = np.maximum(0.0, np.minimum(lower, upper))
    enorm = 2.0 / (mel_freqs[2:n_mels + 2] - mel_freqs[:n_mels])
    weights *= enorm[:, None]
    return weights.astype(np.float32)


def bytes_to_unicode():
    """GPT-2 byte-level BPE 的 byte → unicode 字元對照（與 whisper.cpp 轉換器相同）。"""
    bs = (list(range(ord("!"), ord("~") + 1)) + list(range(ord("¡"), ord("¬") + 1))
          + list(range(ord("®"), ord("ÿ") + 1)))
    cs = bs[:]
    n = 0
    for b in range(256):
        if b not in bs:
            bs.append(b)
            cs.append(256 + n)
            n += 1
    return dict(zip(bs, (chr(c) for c in cs)))


def load_vocab_section(model_dir, n_vocab):
    """回傳要寫入 GGML 的 BPE token bytes 清單，並檢查特殊 token 的排列。"""
    with open(os.path.join(model_dir, "vocabulary.json"), "r", encoding="utf-8") as f:
        tokens = json.load(f)
    check(isinstance(tokens, list), "vocabulary.json 應為 token 清單")
    check(len(tokens) == n_vocab,
          "vocabulary.json 有 %d 個 token，但 token embedding 有 %d 列" % (len(tokens), n_vocab))
    check(n_vocab >= 51865, "只支援多語模型（n_vocab >= 51865），目前 n_vocab = %d" % n_vocab)

    # whisper.cpp 依 n_vocab 推算的特殊 token id（whisper_model_load 的 vocab 區塊）
    num_languages = n_vocab - 51765 - 1
    check(num_languages <= len(WHISPER_CPP_LANGS),
          "語言 token 數 %d 超過 whisper.cpp 語言表的 %d 種" % (num_languages, len(WHISPER_CPP_LANGS)))
    dt = num_languages - 98
    eot, sot = 50257, 50258
    expected = {
        eot: "<|endoftext|>",
        sot: "<|startoftranscript|>",
        50357 + dt: "<|translate|>",
        50358 + dt: "<|transcribe|>",
        50359 + dt: "<|startoflm|>",
        50360 + dt: "<|startofprev|>",
        50361 + dt: ("<|nocaptions|>", "<|nospeech|>"),
        50362 + dt: "<|notimestamps|>",
        50363 + dt: "<|0.00|>",
        n_vocab - 1: "<|30.00|>",
    }
    for i, lang in enumerate(WHISPER_CPP_LANGS[:num_languages]):
        expected[sot + 1 + i] = "<|%s|>" % lang
    for idx, want in sorted(expected.items()):
        ok = tokens[idx] in want if isinstance(want, tuple) else tokens[idx] == want
        check(ok, "token %d 是 %r，whisper.cpp 預期 %r；特殊 token 排列不同，無法直接轉換"
              % (idx, tokens[idx], want))

    byte_decoder = {c: b for b, c in bytes_to_unicode().items()}
    out = []
    for i, tok in enumerate(tokens[:eot]):
        try:
            raw = bytes(byte_decoder[c] for c in tok)
        except KeyError:
            raise ConversionError("token %d（%r）不是 byte-level BPE 字串" % (i, tok))
        check(len(raw) <= MAX_TOKEN_BYTES, "token %d 長 %d bytes，超過 whisper-quantize 的上限" % (i, len(raw)))
        out.append(raw)
    return out, num_languages


def check_side_configs(model_dir, n_mels, sot, num_languages):
    """若有 preprocessor_config.json / config.json，確認與 whisper.cpp 的固定前處理及語言 token 一致。"""
    path = os.path.join(model_dir, "preprocessor_config.json")
    if os.path.isfile(path):
        with open(path, "r", encoding="utf-8") as f:
            pre = json.load(f)
        for key, want in (("feature_size", n_mels), ("sampling_rate", SAMPLE_RATE), ("n_fft", N_FFT),
                          ("hop_length", HOP_LENGTH), ("chunk_length", CHUNK_LENGTH)):
            if key in pre:
                check(pre[key] == want, "preprocessor_config.json 的 %s = %r，whisper.cpp 固定為 %r"
                      % (key, pre[key], want))
    path = os.path.join(model_dir, "config.json")
    if os.path.isfile(path):
        with open(path, "r", encoding="utf-8") as f:
            cfg = json.load(f)
        if cfg.get("lang_ids") is not None:
            want = list(range(sot + 1, sot + 1 + num_languages))
            check(sorted(cfg["lang_ids"]) == want,
                  "config.json 的 lang_ids 不是連續的 %d..%d" % (want[0], want[-1]))


class GgmlWriter:
    def __init__(self, fout, use_f16):
        self.fout = fout
        self.use_f16 = use_f16
        self.names = []
        self.n_f16 = 0
        self.n_f32 = 0

    def tensor(self, name, data):
        check(name not in self.names, "張量 %s 重複寫出" % name)
        if self.use_f16 and data.ndim >= 2 and name not in F32_TENSORS:
            data = data.astype("<f2")
            ttype = 1
            self.n_f16 += 1
        else:
            data = data.astype("<f4")
            ttype = 0
            self.n_f32 += 1
        encoded = name.encode("utf-8")
        self.fout.write(struct.pack("<iii", data.ndim, len(encoded), ttype))
        self.fout.write(struct.pack("<%di" % data.ndim, *reversed(data.shape)))
        self.fout.write(encoded)
        self.fout.write(np.ascontiguousarray(data).tobytes())
        self.names.append(name)


def split_rows(data, parts, what):
    check(data.shape[0] % parts == 0, "%s 的第 0 維 %d 無法平分成 %d 段" % (what, data.shape[0], parts))
    return np.split(data, parts, axis=0)


def drop_zero_key_bias(bias, what):
    peak = float(np.abs(bias).max())
    check(peak == 0.0, "%s 的 key bias 段不為 0（max |b| = %g），融合順序可能不是 q、k、v" % (what, peak))


def write_linear(w, model, src, dst, d_state):
    weight = model.get_float(src + "/weight")
    check(weight.ndim == 2 and weight.shape[1] in (d_state, 4 * d_state),
          "%s/weight 形狀 %s 不符" % (src, weight.shape))
    w.tensor(dst + ".weight", weight)
    w.tensor(dst + ".bias", model.get_float(src + "/bias"))


def write_layer_norm(w, model, src, dst):
    w.tensor(dst + ".weight", model.get_float(src + "/gamma"))
    w.tensor(dst + ".bias", model.get_float(src + "/beta"))


def write_self_attention(w, model, src, dst, d_state):
    weight = model.get_float(src + "/linear_0/weight")
    bias = model.get_float(src + "/linear_0/bias")
    check(weight.shape == (3 * d_state, d_state), "%s/linear_0/weight 形狀 %s 不符" % (src, weight.shape))
    wq, wk, wv = split_rows(weight, 3, src + "/linear_0/weight")
    bq, bk, bv = split_rows(bias, 3, src + "/linear_0/bias")
    drop_zero_key_bias(bk, src)
    w.tensor(dst + ".query.weight", wq)
    w.tensor(dst + ".query.bias", bq)
    w.tensor(dst + ".key.weight", wk)
    w.tensor(dst + ".value.weight", wv)
    w.tensor(dst + ".value.bias", bv)
    write_linear(w, model, src + "/linear_1", dst + ".out", d_state)


def write_cross_attention(w, model, src, dst, d_state):
    write_linear(w, model, src + "/linear_0", dst + ".query", d_state)
    weight = model.get_float(src + "/linear_1/weight")
    bias = model.get_float(src + "/linear_1/bias")
    check(weight.shape == (2 * d_state, d_state), "%s/linear_1/weight 形狀 %s 不符" % (src, weight.shape))
    wk, wv = split_rows(weight, 2, src + "/linear_1/weight")
    bk, bv = split_rows(bias, 2, src + "/linear_1/bias")
    drop_zero_key_bias(bk, src)
    w.tensor(dst + ".key.weight", wk)
    w.tensor(dst + ".value.weight", wv)
    w.tensor(dst + ".value.bias", bv)
    write_linear(w, model, src + "/linear_2", dst + ".out", d_state)


def write_ffn(w, model, src, dst, d_state):
    write_linear(w, model, src + "/linear_0", dst + ".mlp.0", d_state)
    write_linear(w, model, src + "/linear_1", dst + ".mlp.2", d_state)
    write_layer_norm(w, model, src + "/layer_norm", dst + ".mlp_ln")


def count_layers(model, side):
    n = 0
    while model.has("%s/layer_%d/ffn/linear_0/weight" % (side, n)):
        n += 1
    return n


def convert(model_dir, out_path, use_f16):
    model = Ct2ModelBin(os.path.join(model_dir, "model.bin"))
    try:
        scalars = {}
        for name, want in CT2_SCALARS.items():
            if not model.has(name):
                check(want is None and not name.endswith("num_heads"), "model.bin 缺少純量 %s" % name)
                continue
            scalars[name] = model.get_scalar(name)
            check(want is None or scalars[name] == want,
                  "%s = %r，whisper.cpp 的架構需要 %r" % (name, scalars[name], want))

        emb_shape = model.shape("decoder/embeddings/weight")
        enc_pe_shape = model.shape("encoder/position_encodings/encodings")
        dec_pe_shape = model.shape("decoder/position_encodings/encodings")
        conv1_shape = model.shape("encoder/conv1/weight")
        n_vocab, n_text_state = emb_shape
        n_audio_ctx, n_audio_state = enc_pe_shape
        n_text_ctx = dec_pe_shape[0]
        n_mels = conv1_shape[1]
        n_audio_layer = count_layers(model, "encoder")
        n_text_layer = count_layers(model, "decoder")
        n_audio_head = int(scalars["encoder/num_heads"])
        n_text_head = int(scalars["decoder/num_heads"])
        check(n_audio_state == n_text_state == dec_pe_shape[1], "encoder 與 decoder 的寬度不同")
        check(conv1_shape == (n_audio_state, n_mels, 3), "encoder/conv1/weight 形狀 %s 不符" % (conv1_shape,))
        check(model.shape("encoder/conv2/weight") == (n_audio_state, n_audio_state, 3),
              "encoder/conv2/weight 形狀不符")
        check(n_audio_layer > 0 and n_text_layer > 0, "找不到 encoder / decoder 層")

        # 輸出投影必須與 token embedding 共用（whisper.cpp 直接拿 token embedding 算 logits）
        if model.has("decoder/projection/weight"):
            if model.aliases.get("decoder/projection/weight") != "decoder/embeddings/weight":
                same = np.array_equal(model.get_float("decoder/projection/weight"),
                                      model.get_float("decoder/embeddings/weight"))
                check(same, "decoder/projection/weight 與 token embedding 不同；whisper.cpp 不支援獨立的輸出投影")
            model.used.add("decoder/projection/weight")
        if model.has("decoder/projection/bias"):
            check(not np.any(model.get_float("decoder/projection/bias")),
                  "decoder/projection/bias 不為 0；whisper.cpp 不支援輸出投影的 bias")

        vocab, num_languages = load_vocab_section(model_dir, n_vocab)
        check_side_configs(model_dir, n_mels, 50258, num_languages)
        filters = slaney_mel_filters(n_mels=n_mels)

        hparams = (n_vocab, n_audio_ctx, n_audio_state, n_audio_head, n_audio_layer,
                   n_text_ctx, n_text_state, n_text_head, n_text_layer, n_mels, 1 if use_f16 else 0)
        print("hparams: n_vocab=%d n_audio_ctx=%d n_audio_state=%d n_audio_head=%d n_audio_layer=%d "
              "n_text_ctx=%d n_text_state=%d n_text_head=%d n_text_layer=%d n_mels=%d ftype=%d" % hparams)
        print("詞彙：寫入 %d 個 BPE token，語言 token %d 個" % (len(vocab), num_languages))

        out_dir = os.path.dirname(os.path.abspath(out_path))
        os.makedirs(out_dir, exist_ok=True)
        tmp_path = out_path + ".part"
        d = n_audio_state
        try:
            with open(tmp_path, "wb") as fout:
                fout.write(struct.pack("<I", GGML_FILE_MAGIC))
                fout.write(struct.pack("<11i", *hparams))
                fout.write(struct.pack("<ii", *filters.shape))
                fout.write(filters.astype("<f4").tobytes())
                fout.write(struct.pack("<i", len(vocab)))
                for raw in vocab:
                    fout.write(struct.pack("<I", len(raw)))
                    fout.write(raw)

                w = GgmlWriter(fout, use_f16)
                w.tensor("encoder.conv1.weight", model.get_float("encoder/conv1/weight"))
                w.tensor("encoder.conv1.bias", model.get_float("encoder/conv1/bias").reshape(-1, 1))
                w.tensor("encoder.conv2.weight", model.get_float("encoder/conv2/weight"))
                w.tensor("encoder.conv2.bias", model.get_float("encoder/conv2/bias").reshape(-1, 1))
                w.tensor("encoder.positional_embedding", model.get_float("encoder/position_encodings/encodings"))
                for i in range(n_audio_layer):
                    src, dst = "encoder/layer_%d" % i, "encoder.blocks.%d" % i
                    write_self_attention(w, model, src + "/self_attention", dst + ".attn", d)
                    write_layer_norm(w, model, src + "/self_attention/layer_norm", dst + ".attn_ln")
                    write_ffn(w, model, src + "/ffn", dst, d)
                write_layer_norm(w, model, "encoder/layer_norm", "encoder.ln_post")

                w.tensor("decoder.token_embedding.weight", model.get_float("decoder/embeddings/weight"))
                w.tensor("decoder.positional_embedding", model.get_float("decoder/position_encodings/encodings"))
                for i in range(n_text_layer):
                    src, dst = "decoder/layer_%d" % i, "decoder.blocks.%d" % i
                    write_self_attention(w, model, src + "/self_attention", dst + ".attn", d)
                    write_layer_norm(w, model, src + "/self_attention/layer_norm", dst + ".attn_ln")
                    write_cross_attention(w, model, src + "/attention", dst + ".cross_attn", d)
                    write_layer_norm(w, model, src + "/attention/layer_norm", dst + ".cross_attn_ln")
                    write_ffn(w, model, src + "/ffn", dst, d)
                write_layer_norm(w, model, "decoder/layer_norm", "decoder.ln")

            unused = sorted(set(model.variables) - model.used)
            check(not unused, "model.bin 有未處理的變數（架構可能不是標準 Whisper）：%s" % ", ".join(unused[:10]))
            expected_tensors = 7 + 15 * n_audio_layer + 4 + 24 * n_text_layer
            check(len(w.names) == expected_tensors,
                  "寫出 %d 個張量，whisper.cpp 預期 %d 個" % (len(w.names), expected_tensors))
        except BaseException:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
            raise
        os.replace(tmp_path, out_path)
    finally:
        model.close()

    print("張量：%d 個（f16 %d、f32 %d）" % (len(w.names), w.n_f16, w.n_f32))
    print("輸出：%s（%d bytes）" % (out_path, os.path.getsize(out_path)))


def main(argv=None):
    # Windows 上輸出到管線時預設用 ANSI 字碼頁（如 cp950），統一改成 UTF-8 以免中文訊息亂碼
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="backslashreplace")
        except (AttributeError, ValueError):
            pass
    parser = argparse.ArgumentParser(
        description="把 CTranslate2 Whisper 模型（model.bin）轉成 whisper.cpp 的 GGML 檔")
    parser.add_argument("model_dir", help="CTranslate2 模型目錄（含 model.bin 與 vocabulary.json）")
    parser.add_argument("out_path", help="輸出的 GGML 檔路徑")
    parser.add_argument("--ftype", choices=("f16", "f32"), default="f16", help="權重精度（預設 f16）")
    args = parser.parse_args(argv)
    try:
        convert(args.model_dir, args.out_path, args.ftype == "f16")
    except (ConversionError, OSError) as e:
        print("錯誤：%s" % e, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
