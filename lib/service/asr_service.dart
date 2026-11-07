import 'package:flutter/services.dart';

/// 本機 ASR 服務狀態（對應 Android 端的 AsrStatus）。
class AsrStatus {
  const AsrStatus({
    required this.phase,
    required this.running,
    this.baseUrl,
    this.apiKey,
    this.model,
    this.error,
    this.threads,
  });

  /// idle / starting / running / error
  final String phase;
  final bool running;

  /// OpenAI 相容 API 的基底網址，例如 `http://127.0.0.1:53124/v1`。只有 running 時有值。
  final String? baseUrl;

  /// 呼叫 API 時放進 `Authorization: Bearer <apiKey>`。只有 start() 會回傳。
  final String? apiKey;
  final String? model;
  final String? error;

  /// 實際採用的執行緒數（只有 running 時有值）。
  final int? threads;

  factory AsrStatus.fromMap(Map<Object?, Object?> map) => AsrStatus(
    phase: map['phase'] as String? ?? 'idle',
    running: map['running'] as bool? ?? false,
    baseUrl: map['baseUrl'] as String?,
    apiKey: map['apiKey'] as String?,
    model: map['model'] as String?,
    error: map['error'] as String?,
    threads: map['threads'] as int?,
  );

  factory AsrStatus.failed(String message) =>
      AsrStatus(phase: 'error', running: false, error: message);

  Map<String, Object?> toJson({bool includeKey = false}) => {
    'phase': phase,
    'running': running,
    'baseUrl': baseUrl,
    'model': model,
    'error': error,
    'threads': threads,
    if (includeKey) 'apiKey': apiKey,
  };
}

/// 本機語音轉文字（ASR）服務的 Dart 介面（僅 Android）。
///
/// 服務由 Android 端管理：whisper-server 子行程 + 127.0.0.1 的 OpenAI 相容代理，
/// 見 `android/app/src/main/kotlin/com/example/townpass/asr/`。
/// 呼叫方式與 [LlmService] 相同：start 取得 baseUrl 與 apiKey 後，以 OpenAI 格式呼叫
/// `POST {baseUrl}/audio/transcriptions`（multipart，欄位 file、language 等）。
class AsrService {
  AsrService._();

  static const MethodChannel _channel = MethodChannel('town_pass/asr');

  /// 僅在允許來源的 WebView 由使用者要求收音時，請 Android 顯示麥克風授權。
  static Future<bool> requestMicrophonePermission() async {
    try {
      return await _channel
              .invokeMethod<bool>('microphonePermission')
              .timeout(const Duration(seconds: 60), onTimeout: () => false) ??
          false;
    } on PlatformException {
      return false;
    } on MissingPluginException {
      return false;
    }
  }

  /// 啟動服務。模型不隨 APK 發佈，須事先放在 App 私有目錄（做法見 tools/asr-android/README.md）。
  /// 已在執行則直接回傳目前狀態。
  ///
  /// - [threads]：省略時依大核數自動決定。
  static Future<AsrStatus> start({int? threads}) =>
      _call('start', {'threads': ?threads});

  /// 停止服務並釋放記憶體。未在執行時也安全。
  static Future<AsrStatus> stop() => _call('stop');

  /// 查詢狀態（不含 API key）。
  static Future<AsrStatus> status() => _call('status');

  static Future<AsrStatus> _call(
    String method, [
    Map<String, Object?>? arguments,
  ]) async {
    try {
      final map = await _channel.invokeMapMethod<Object?, Object?>(
        method,
        arguments,
      );
      return AsrStatus.fromMap(map ?? const {});
    } on PlatformException catch (e) {
      return AsrStatus.failed(e.message ?? e.code);
    } on MissingPluginException {
      return AsrStatus.failed('本機 ASR 目前只支援 Android');
    }
  }
}
