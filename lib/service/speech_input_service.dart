import 'package:flutter/services.dart';

/// 系統語音辨識（Android SpeechRecognizer）的 Dart 介面，給安心助手的語音輸入用。
///
/// 一次只辨識一句。事件格式見 `android/.../speech/SpeechInput.kt`：
/// `{type: listening | partial | final | error, text?, error?}`。
/// 新的 [start] 會取代上一次的收音，舊的 [onEvent] 不再收到事件。
class SpeechInputService {
  SpeechInputService._();

  static const MethodChannel _channel = MethodChannel('town_pass/speech');
  static void Function(Map<String, Object?> event)? _onEvent;
  static bool _bound = false;

  static void _bind() {
    if (_bound) return;
    _bound = true;
    _channel.setMethodCallHandler((call) async {
      if (call.method != 'event') return;
      final Object? arguments = call.arguments;
      if (arguments is! Map) return;
      _onEvent?.call(Map<String, Object?>.from(arguments));
    });
  }

  /// 開始收音。平台沒有這個 channel（例如 iOS）時回傳 false。
  static Future<bool> start({
    required String language,
    required void Function(Map<String, Object?> event) onEvent,
  }) async {
    _bind();
    _onEvent = onEvent;
    try {
      await _channel.invokeMethod<void>('start', {'language': language});
      return true;
    } on MissingPluginException {
      _onEvent = null;
      return false;
    } on PlatformException {
      _onEvent = null;
      return false;
    }
  }

  /// 說完了：停止收音，最終文字會以 `final` 事件送出。
  static Future<void> stop() async {
    try {
      await _channel.invokeMethod<void>('stop');
    } on MissingPluginException {
      // 沒有原生實作時沒有東西要停。
    }
  }

  /// 放棄這一次辨識。
  static Future<void> cancel() async {
    _onEvent = null;
    try {
      await _channel.invokeMethod<void>('cancel');
    } on MissingPluginException {
      // 沒有原生實作時沒有東西要停。
    }
  }
}
