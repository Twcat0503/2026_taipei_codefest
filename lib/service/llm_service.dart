import 'package:flutter/services.dart';

/// 允許透過 WebView 橋接呼叫本機 LLM 的網頁來源（origin）。
/// 目前只含開發環境的 Vue dev server（AGENTS.md 的 10.0.2.2 模擬器網址）。
/// 正式網域要加入前需經團隊審查，因為 API key 會交給這些來源。
const Set<String> kLlmAllowedOrigins = {
  'http://10.0.2.2:5173',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
};

bool isLlmOriginAllowed(String? origin) =>
    origin != null && kLlmAllowedOrigins.contains(origin);

/// 本機 LLM 服務狀態（對應 Android 端的 LlmStatus）。
class LlmStatus {
  const LlmStatus({
    required this.phase,
    required this.running,
    this.baseUrl,
    this.apiKey,
    this.model,
    this.error,
    this.threads,
    this.contextSize,
    this.kvCacheType,
    this.flashAttention,
  });

  /// idle / downloading / starting / running / error
  final String phase;
  final bool running;

  /// OpenAI 相容 API 的基底網址，例如 `http://127.0.0.1:53124/v1`。只有 running 時有值。
  final String? baseUrl;

  /// 呼叫 API 時放進 `Authorization: Bearer <apiKey>`。只有 start() 會回傳。
  final String? apiKey;
  final String? model;
  final String? error;

  /// 實際採用的設定（只有 running 時有值）。threads 是原生端自動決定或你指定的值。
  final int? threads;
  final int? contextSize;
  final String? kvCacheType;
  final bool? flashAttention;

  factory LlmStatus.fromMap(Map<Object?, Object?> map) => LlmStatus(
    phase: map['phase'] as String? ?? 'idle',
    running: map['running'] as bool? ?? false,
    baseUrl: map['baseUrl'] as String?,
    apiKey: map['apiKey'] as String?,
    model: map['model'] as String?,
    error: map['error'] as String?,
    threads: map['threads'] as int?,
    contextSize: map['contextSize'] as int?,
    kvCacheType: map['kvCacheType'] as String?,
    flashAttention: map['flashAttention'] as bool?,
  );

  factory LlmStatus.failed(String message) =>
      LlmStatus(phase: 'error', running: false, error: message);

  Map<String, Object?> toJson({bool includeKey = false}) => {
    'phase': phase,
    'running': running,
    'baseUrl': baseUrl,
    'model': model,
    'error': error,
    'threads': threads,
    'contextSize': contextSize,
    'kvCacheType': kvCacheType,
    'flashAttention': flashAttention,
    if (includeKey) 'apiKey': apiKey,
  };
}

/// 本機 LLM 服務的 Dart 介面（僅 Android）。
///
/// 模型下載與 llama-server 子行程管理都在 Android 端，見
/// `android/app/src/main/kotlin/com/example/townpass/llm/LlmServer.kt`。
/// 其他程式碼可以直接呼叫這三個方法，網頁則透過 WebView 橋接（llm_start / llm_stop / llm_status）。
class LlmService {
  LlmService._();

  static const MethodChannel _channel = MethodChannel('town_pass/llm');

  /// 啟動服務。第一次會下載約 1 GB 的模型，可能需要數分鐘。已在執行則直接回傳目前狀態。
  ///
  /// - [threads]：省略時依大核數自動決定。
  /// - [contextSize]：512–16384，預設 4096。
  /// - [kvCacheType]：`q8_0`（預設）或 `f16`。
  /// - [flashAttention]：預設開啟；KV 為 `q8_0` 時一律開啟（V 量化需要）。
  static Future<LlmStatus> start({
    int? threads,
    int contextSize = 4096,
    String kvCacheType = 'q8_0',
    bool flashAttention = true,
  }) => _call('start', {
    'threads': ?threads,
    'contextSize': contextSize,
    'kvCacheType': kvCacheType,
    'flashAttention': flashAttention,
  });

  /// 停止服務並釋放記憶體。未在執行時也安全。
  static Future<LlmStatus> stop() => _call('stop');

  /// 查詢狀態（不含 API key）。
  static Future<LlmStatus> status() => _call('status');

  static Future<LlmStatus> _call(
    String method, [
    Map<String, Object?>? arguments,
  ]) async {
    try {
      final map = await _channel.invokeMapMethod<Object?, Object?>(
        method,
        arguments,
      );
      return LlmStatus.fromMap(map ?? const {});
    } on PlatformException catch (e) {
      return LlmStatus.failed(e.message ?? e.code);
    } on MissingPluginException {
      return LlmStatus.failed('本機 LLM 目前只支援 Android');
    }
  }
}
