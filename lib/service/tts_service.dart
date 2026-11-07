import 'package:flutter/services.dart';

/// 本機 TTS 服務狀態（對應 Android 端的回覆）。
class TtsStatus {
  const TtsStatus({
    required this.phase,
    required this.running,
    this.baseUrl,
    this.apiKey,
    this.model,
    this.threads,
    this.error,
  });

  /// idle / starting / running / error
  final String phase;
  final bool running;

  /// 語音 API 的基底網址，只有服務可用時有值。
  final String? baseUrl;

  /// 只有成功 start() 才保留，供 Authorization 的 Bearer 憑證使用。
  final String? apiKey;
  final String? model;
  final int? threads;
  final String? error;

  factory TtsStatus.fromMap(
    Map<Object?, Object?> map, {
    bool includeKey = false,
  }) {
    final phase = map['phase'] as String? ?? 'idle';
    final error = map['error'] as String?;
    final running =
        phase == 'running' && map['running'] == true && error == null;
    return TtsStatus(
      phase: phase,
      running: running,
      baseUrl: running ? map['baseUrl'] as String? : null,
      apiKey: includeKey && running ? map['apiKey'] as String? : null,
      model: map['model'] as String?,
      threads: map['threads'] as int?,
      error: error,
    );
  }

  factory TtsStatus.failed(String message) =>
      TtsStatus(phase: 'error', running: false, error: message);

  bool get _available => phase == 'running' && running && error == null;

  /// 預設不輸出 key；即使明確要求，也不能輸出錯誤狀態或空的 key。
  Map<String, Object?> toJson({bool includeKey = false}) => {
    'phase': phase,
    'running': _available,
    'baseUrl': _available ? baseUrl : null,
    'model': model,
    'threads': threads,
    'error': error,
    if (includeKey && _available && apiKey != null) 'apiKey': apiKey,
  };
}

/// Android 本機 TTS 的 Dart 介面；模型與子行程由原生端管理。
class TtsService {
  TtsService._();

  static const MethodChannel _channel = MethodChannel('town_pass/tts');

  /// 啟動服務；省略 [threads] 時由原生端決定資源配置。
  static Future<TtsStatus> start({int? threads}) =>
      _call('start', {'threads': ?threads});

  /// 停止服務並釋放資源；不回傳 API key。
  static Future<TtsStatus> stop() => _call('stop');

  /// 查詢狀態；不回傳 API key。
  static Future<TtsStatus> status() => _call('status');

  static Future<TtsStatus> _call(
    String method, [
    Map<String, Object?>? arguments,
  ]) async {
    try {
      final map = await _channel.invokeMapMethod<Object?, Object?>(
        method,
        arguments,
      );
      // 即使原生端誤送 key，status / stop 也不能保留到 Dart 狀態中。
      return TtsStatus.fromMap(map ?? const {}, includeKey: method == 'start');
    } on PlatformException catch (e) {
      return TtsStatus.failed(e.message ?? e.code);
    } on MissingPluginException {
      return TtsStatus.failed('本機 TTS 目前只支援 Android');
    }
  }
}
