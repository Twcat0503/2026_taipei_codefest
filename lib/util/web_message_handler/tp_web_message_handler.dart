import 'dart:async';

import 'package:flutter/cupertino.dart';
import 'package:flutter/services.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:flutter_tts/flutter_tts.dart';
import 'package:geolocator/geolocator.dart';
import 'package:get/get.dart';
import 'package:share_plus/share_plus.dart';
import 'package:town_pass/gen/assets.gen.dart';
import 'package:town_pass/service/account_service.dart';
import 'package:town_pass/service/device_service.dart';
import 'package:town_pass/service/geo_locator_service.dart';
import 'package:town_pass/service/llm_service.dart';
import 'package:town_pass/service/notification_service.dart';
import 'package:town_pass/service/shared_preferences_service.dart';
import 'package:town_pass/service/subscription_service.dart';
import 'package:town_pass/util/tp_button.dart';
import 'package:town_pass/util/tp_dialog.dart';
import 'package:town_pass/util/tp_route.dart';
import 'package:town_pass/util/tp_text.dart';
import 'package:town_pass/util/web_message_handler/tp_web_message_reply.dart';
import 'package:url_launcher/url_launcher.dart';

abstract class TPWebMessageHandler {
  String get name;

  Future<void> handle({
    required Object? message,
    required WebUri? sourceOrigin,
    required bool isMainFrame,
    required Function(WebMessage replyWebMessage)? onReply,
  });

  WebMessage replyWebMessage({required Object? data}) {
    return TPWebStringMessageReply(name: name, data: data).message;
  }
}

class UserinfoWebMessageHandler extends TPWebMessageHandler {
  @override
  String get name => 'userinfo';

  @override
  Future<void> handle({
    required Object? message,
    required WebUri? sourceOrigin,
    required bool isMainFrame,
    required onReply,
  }) async {
    onReply?.call(
      replyWebMessage(data: Get.find<AccountService>().account ?? []),
    );
  }
}

class LaunchMapWebMessageHandler extends TPWebMessageHandler {
  @override
  String get name => 'launch_map';

  @override
  handle({
    required Object? message,
    required WebUri? sourceOrigin,
    required bool isMainFrame,
    required Function(WebMessage reply)? onReply,
  }) async {
    if (message == null || message is! String) {
      onReply?.call(replyWebMessage(data: false));
    }
    final Uri uri = Uri.parse(message as String);
    final bool canLaunch = await canLaunchUrl(uri);

    onReply?.call(replyWebMessage(data: canLaunch));

    if (canLaunch) {
      // 地圖網址交給地圖 App（沒有時才開瀏覽器）；不在 App 內開，Google 地圖不支援 WebView。
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    }
  }
}

class Agree1999MessageHandler extends TPWebMessageHandler {
  @override
  String get name => '1999agree';

  @override
  handle({
    required Object? message,
    required WebUri? sourceOrigin,
    required bool isMainFrame,
    required Function(WebMessage reply)? onReply,
  }) async {
    if (message == null) {
      onReply?.call(replyWebMessage(data: false));
    }
    final Uri uri = Uri.parse('tel://1999');

    final bool canLaunch = await canLaunchUrl(uri);
    if (!canLaunch) {
      onReply?.call(replyWebMessage(data: false));
      return;
    }

    final bool userAgreement =
        SharedPreferencesService().instance.getBool(
          SharedPreferencesService.keyPhoneCallUserAgreement,
        ) ??
        false;
    if (!userAgreement) {
      await Get.toNamed(TPRoute.phoneCallUserAgreement);

      final bool userAgreement =
          SharedPreferencesService().instance.getBool(
            SharedPreferencesService.keyPhoneCallUserAgreement,
          ) ??
          false;
      if (!userAgreement) {
        onReply?.call(replyWebMessage(data: false));
        return;
      }
    }

    await TPDialog.show(
      padding: const EdgeInsets.symmetric(horizontal: 68, vertical: 40),
      showCloseCross: true,
      barrierDismissible: false,
      content: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Assets.svg.phoneCallService.svg(),
          const TPText('語音通報', style: TPTextStyles.titleSemiBold),
          const SizedBox(height: 8),
          const TPText('電話撥號'),
          const SizedBox(height: 24),
          TPButton.primary(
            text: '立即撥號',
            onPressed: () async => await launchUrl(uri),
          ),
        ],
      ),
    );
  }
}

class PhoneCallMessageHandler extends TPWebMessageHandler {
  @override
  String get name => 'phone_call';

  @override
  handle({
    required Object? message,
    required WebUri? sourceOrigin,
    required bool isMainFrame,
    required Function(WebMessage reply)? onReply,
  }) async {
    if (message == null) {
      onReply?.call(replyWebMessage(data: false));
    }
    final Uri uri = Uri.parse('tel://${message!}');
    final bool canLaunch = await canLaunchUrl(uri);

    onReply?.call(replyWebMessage(data: canLaunch));

    if (canLaunch) {
      await launchUrl(uri);
    }
  }
}

class LocationMessageHandler extends TPWebMessageHandler {
  @override
  String get name => 'location';

  @override
  handle({
    required Object? message,
    required WebUri? sourceOrigin,
    required bool isMainFrame,
    required Function(WebMessage reply)? onReply,
  }) async {
    Position? position;

    // might have permission issue
    try {
      position = await Get.find<GeoLocatorService>().position();
    } catch (error) {
      printError(info: error.toString());
    }

    onReply?.call(replyWebMessage(data: position?.toJson() ?? []));
  }
}

class DeviceInfoMessageHandler extends TPWebMessageHandler {
  @override
  String get name => 'deviceinfo';

  @override
  handle({
    required Object? message,
    required WebUri? sourceOrigin,
    required bool isMainFrame,
    required Function(WebMessage reply)? onReply,
  }) async {
    onReply?.call(
      replyWebMessage(
        data: Get.find<DeviceService>().baseDeviceInfo?.data ?? [],
      ),
    );
  }
}

class OpenLinkMessageHandler extends TPWebMessageHandler {
  @override
  String get name => 'open_link';

  @override
  handle({
    required Object? message,
    required WebUri? sourceOrigin,
    required bool isMainFrame,
    required Function(WebMessage reply)? onReply,
  }) async {
    switch (message as String?) {
      case String uri:
        await TPRoute.openUri(uri: uri);
      case null:
        onReply?.call(replyWebMessage(data: false));
    }
  }
}

class NotifyMessageHandler extends TPWebMessageHandler {
  @override
  String get name => 'notify';

  @override
  Future<void> handle({
    required Object? message,
    required WebUri? sourceOrigin,
    required bool isMainFrame,
    required Function(WebMessage replyWebMessage)? onReply,
  }) async {
    switch (message) {
      case Object json when json is Map<String, dynamic>:
        NotificationService.showNotification(
          title: json['title'],
          content: json['content'],
        );
        final String content = json['content'];
        if (RegExp(r'已訂閱(.+)').hasMatch(content)) {
          final String target = RegExp(r'已訂閱(.+)')
              .firstMatch(content)!
              .group(1)!;
          Get.find<SubscriptionService>().addSubscription(title: target);
        } else if (RegExp(r'已取消訂閱(.+)').hasMatch(content)) {
          final String target = RegExp(r'已取消訂閱(.+)')
              .firstMatch(content)!
              .group(1)!;
          Get.find<SubscriptionService>().removeSubscription(title: target);
        }
      default:
        onReply?.call(replyWebMessage(data: false));
        return;
    }
  }
}

class QRCodeScanMessageHandler extends TPWebMessageHandler {
  @override
  String get name => 'qr_code_scan';

  @override
  Future<void> handle({
    required Object? message,
    required WebUri? sourceOrigin,
    required bool isMainFrame,
    required onReply,
  }) async {
    final result = await Get.toNamed(TPRoute.qrCodeScan);
    onReply?.call(replyWebMessage(data: result));
  }
}

/// 朗讀（TTS）。
///
/// Android WebView 沒有 `speechSynthesis`，所以網頁端的「唸給我聽」一律走這支
/// handler。支援兩種協定：
///
/// 新版（data 帶 `requestId`）：每則回覆都會帶回同一個 `requestId`。
/// - 朗讀 `{requestId, action?: 'speak', text, lang?: 'zh-TW', rate?: 1.0}`：
///   `rate` 採 Web Speech API 語意（1.0＝正常語速，非數字視為 1.0），實際限制在
///   0.5～2.0 倍。開始朗讀前先回 `{event: 'start'}`，之後恰好回一個終止事件：
///   `done`（唸完）、`stopped`（被 stop 或更新的朗讀請求打斷）、或 `error`
///   （另帶 `error`：`empty_text`、`language_unavailable`、`engine_error`）。
///   驗證失敗（空字串、語言不支援）或開始前就被打斷時不會有 `start`，只回終止事件。
///   新的朗讀請求一律會打斷前一個，即使它自己驗證失敗。
/// - 停止 `{requestId, action: 'stop'}`：回 `{ok: true}`。
/// - 其他 `action`：回 `{ok: false, error: 'unknown_action'}`。
///
/// 舊版（data 沒有 `requestId`）：`{"text": "...", "lang": "zh-TW"}` 開始朗讀時回
/// `true`，沒唸成回 `false`；`{"stop": true}` 停止並回 `true`。
class TtsMessageHandler extends TPWebMessageHandler {
  static final FlutterTts _tts = FlutterTts();

  /// 只設定一次的初始化（含 `awaitSpeakCompletion`）；失敗時清掉，下次請求再試。
  static Future<void>? _configuration;

  /// 每個朗讀／停止請求加 1。朗讀迴圈發現數字變了，就代表自己被打斷。
  static int _generation = 0;

  /// 最後一次成功套用到引擎的語言，同語言不重複呼叫 `setLanguage`。
  static String? _language;

  /// 目前這一段 utterance 的錯誤通知。flutter_tts 4.2.5 的 Android 端在
  /// `onError` 時不會讓 `speak()` 回傳（只有 `onDone` 與 `stop()` 會），
  /// 所以要靠 error handler 才不會卡住。
  static Completer<Object?>? _engineFailure;

  @override
  String get name => 'tts';

  /// 還原靜態狀態，讓每個測試從乾淨的初始狀態開始。
  @visibleForTesting
  static void resetForTesting() {
    _configuration = null;
    _language = null;
    _engineFailure = null;
  }

  @override
  Future<void> handle({
    required Object? message,
    required WebUri? sourceOrigin,
    required bool isMainFrame,
    required Function(WebMessage replyWebMessage)? onReply,
  }) async {
    final Map data = message is Map ? message : const {};

    if (data['requestId'] != null) {
      await _handleRequest(data, message, onReply);
    } else {
      await _handleLegacy(data, onReply);
    }
  }

  Future<void> _handleRequest(
    Map data,
    Object? message,
    Function(WebMessage replyWebMessage)? onReply,
  ) async {
    void reply(Map<String, Object?> response) =>
        onReply?.call(replyWebMessage(data: _withRequestId(message, response)));

    switch (data['action'] ?? 'speak') {
      case 'stop':
        _generation++;
        await _tts.stop();
        reply({'ok': true});
      case 'speak':
        final _TtsOutcome outcome = await _speak(
          text: (data['text'] ?? '').toString(),
          language: _languageOf(data),
          rate: _flutterTtsRate(data['rate']),
          onStart: () => reply({'event': 'start'}),
        );
        reply(switch (outcome) {
          _TtsOutcome.done => {'event': 'done'},
          _TtsOutcome.stopped => {'event': 'stopped'},
          _TtsOutcome.emptyText => {'event': 'error', 'error': 'empty_text'},
          _TtsOutcome.languageUnavailable => {
            'event': 'error',
            'error': 'language_unavailable',
          },
          _TtsOutcome.engineError => {
            'event': 'error',
            'error': 'engine_error',
          },
        });
      default:
        reply({'ok': false, 'error': 'unknown_action'});
    }
  }

  Future<void> _handleLegacy(
    Map data,
    Function(WebMessage replyWebMessage)? onReply,
  ) async {
    // 停止朗讀：使用者按了「停止」或換頁時呼叫
    if (data['stop'] == true) {
      _generation++;
      await _tts.stop();
      onReply?.call(replyWebMessage(data: true));
      return;
    }

    // 舊版協定一個請求只回一次：開始朗讀時回 true，沒唸成回 false
    bool replied = false;
    await _speak(
      text: (data['text'] ?? '').toString(),
      language: _languageOf(data),
      rate: _flutterTtsRate(1.0),
      onStart: () {
        replied = true;
        onReply?.call(replyWebMessage(data: true));
      },
    );
    if (!replied) {
      onReply?.call(replyWebMessage(data: false));
    }
  }

  /// 打斷前一個朗讀，依序唸完 [text] 的每一段，回傳結束的原因。
  /// 每次 await 後都檢查 generation，被打斷時一律回報 [_TtsOutcome.stopped]。
  static Future<_TtsOutcome> _speak({
    required String text,
    required String language,
    required double rate,
    required VoidCallback onStart,
  }) async {
    final int generation = ++_generation;
    bool superseded() => generation != _generation;

    try {
      await _configure();
      await _tts.stop();
      if (superseded()) return _TtsOutcome.stopped;

      final List<String> chunks = splitTextForTts(text);
      if (chunks.isEmpty) return _TtsOutcome.emptyText;

      final bool languageReady = await _useLanguage(language);
      if (superseded()) return _TtsOutcome.stopped;
      if (!languageReady) return _TtsOutcome.languageUnavailable;

      await _tts.setSpeechRate(rate);
      if (superseded()) return _TtsOutcome.stopped;

      onStart();
      for (final String chunk in chunks) {
        if (superseded()) return _TtsOutcome.stopped;
        final Object? result = await _speakChunk(chunk);
        if (result != 1 && result != true) {
          return superseded() ? _TtsOutcome.stopped : _TtsOutcome.engineError;
        }
      }
      return _TtsOutcome.done;
    } catch (error) {
      Get.log('tts: $error', isError: true);
      return superseded() ? _TtsOutcome.stopped : _TtsOutcome.engineError;
    }
  }

  static Future<void> _configure() => _configuration ??= _initialize();

  static Future<void> _initialize() async {
    try {
      _tts.setErrorHandler((_) {
        final Completer<Object?>? failure = _engineFailure;
        if (failure != null && !failure.isCompleted) {
          failure.complete(null);
        }
      });
      // 讓 speak() 等到整段唸完才回傳（Android 唸完回 1、被 stop() 打斷回 0）
      await _tts.awaitSpeakCompletion(true);
      await _tts.setVolume(1.0);
      await _tts.setPitch(1.0);
    } catch (_) {
      _configuration = null;
      rethrow;
    }
  }

  /// 確認引擎支援 [language]，並在和上次不同時才切換。
  static Future<bool> _useLanguage(String language) async {
    if (await _tts.isLanguageAvailable(language) != true) return false;
    if (_language != language) {
      if (await _tts.setLanguage(language) != 1) return false;
      _language = language;
    }
    return true;
  }

  /// 唸一段文字。flutter_tts 唸完回 1；被 stop() 打斷回 0；引擎回報錯誤則回 null。
  static Future<Object?> _speakChunk(String chunk) async {
    final Completer<Object?> failure = Completer<Object?>();
    _engineFailure = failure;
    try {
      return await Future.any<Object?>([_tts.speak(chunk), failure.future]);
    } finally {
      if (identical(_engineFailure, failure)) _engineFailure = null;
    }
  }

  static String _languageOf(Map data) {
    final Object? language = data['lang'];
    final String value = language is String ? language.trim() : '';
    return value.isEmpty ? 'zh-TW' : value;
  }

  /// Web Speech API 的 rate（1.0＝正常語速）換算成 flutter_tts 的 speech rate。
  /// flutter_tts 在 Android 會再乘以 2（所以 0.5＝正常語速），因此先乘 0.5。
  static double _flutterTtsRate(Object? rate) {
    final double webRate = rate is num && rate.isFinite ? rate.toDouble() : 1.0;
    return (webRate * 0.5).clamp(0.25, 1.0).toDouble();
  }
}

enum _TtsOutcome { done, stopped, emptyText, languageUnavailable, engineError }

/// 把 [text] 切成適合 Android `TextToSpeech` 的段落（單次輸入上限 4000 字元）。
///
/// 盡量在 [maxLength] 以內最後一個句尾（`。！？；.!?;` 與換行）切開，標點留在前一段；
/// 找不到句尾才硬切（不會切在 surrogate pair 中間）。每段都會 trim，空段會丟掉。
@visibleForTesting
List<String> splitTextForTts(String text, {int maxLength = 3000}) {
  const String sentenceEnds = '。！？；.!?;\n';
  final int limit = maxLength < 1 ? 1 : maxLength;
  final List<String> chunks = [];

  String rest = text;
  while (rest.length > limit) {
    int cut = 0;
    for (int i = limit - 1; i >= 0; i--) {
      if (sentenceEnds.contains(rest[i])) {
        cut = i + 1;
        break;
      }
    }
    if (cut == 0) {
      cut = limit;
      final bool splitsSurrogatePair =
          _isHighSurrogate(rest.codeUnitAt(cut - 1)) &&
          _isLowSurrogate(rest.codeUnitAt(cut));
      if (splitsSurrogatePair) cut = cut > 1 ? cut - 1 : cut + 1;
    }
    chunks.add(rest.substring(0, cut));
    rest = rest.substring(cut);
  }
  chunks.add(rest);

  return chunks
      .map((String chunk) => chunk.trim())
      .where((String chunk) => chunk.isNotEmpty)
      .toList();
}

bool _isHighSurrogate(int codeUnit) => codeUnit >= 0xD800 && codeUnit <= 0xDBFF;

bool _isLowSurrogate(int codeUnit) => codeUnit >= 0xDC00 && codeUnit <= 0xDFFF;

/// 系統分享。
///
/// `navigator.share` 在 Android WebView 同樣不支援，溝通卡要靠這支 handler
/// 才能傳給家人或櫃檯。參數：`{"text": "...", "subject": "..."}`。
class ShareMessageHandler extends TPWebMessageHandler {
  @override
  String get name => 'share';

  @override
  Future<void> handle({
    required Object? message,
    required WebUri? sourceOrigin,
    required bool isMainFrame,
    required Function(WebMessage replyWebMessage)? onReply,
  }) async {
    final Map data = message is Map ? message : const {};
    final String text = (data['text'] ?? '').toString().trim();

    if (text.isEmpty) {
      onReply?.call(replyWebMessage(data: false));
      return;
    }

    final ShareResult result = await SharePlus.instance.share(
      ShareParams(text: text, subject: (data['subject'] ?? '').toString()),
    );

    onReply?.call(
      replyWebMessage(data: result.status == ShareResultStatus.success),
    );
  }
}

/// 觸覺回饋（震動）。參數：`{"requestId"?: "...", "type": "..."}`，`type` 為
/// `selection`、`light`、`medium`、`heavy`、`success`、`warning`、`error`。
///
/// 回覆 `{requestId?, ok: true}`；`type` 缺少或不認得時回覆
/// `{requestId?, ok: false, error: 'unknown_type'}`，不會觸發震動。
/// `success`、`warning`、`error` 在 Android API 30 以下沒有效果（Flutter 引擎的
/// 限制），但仍回覆 `ok: true`。
class HapticMessageHandler extends TPWebMessageHandler {
  @override
  String get name => 'haptic';

  @override
  Future<void> handle({
    required Object? message,
    required WebUri? sourceOrigin,
    required bool isMainFrame,
    required Function(WebMessage replyWebMessage)? onReply,
  }) async {
    final Map data = message is Map ? message : const {};

    final Future<void> Function()? feedback = switch (data['type']) {
      'selection' => HapticFeedback.selectionClick,
      'light' => HapticFeedback.lightImpact,
      'medium' => HapticFeedback.mediumImpact,
      'heavy' => HapticFeedback.heavyImpact,
      'success' => HapticFeedback.successNotification,
      'warning' => HapticFeedback.warningNotification,
      'error' => HapticFeedback.errorNotification,
      _ => null,
    };

    if (feedback == null) {
      onReply?.call(
        replyWebMessage(
          data: _withRequestId(message, {'ok': false, 'error': 'unknown_type'}),
        ),
      );
      return;
    }

    await feedback();
    onReply?.call(replyWebMessage(data: _withRequestId(message, {'ok': true})));
  }
}

/// 回報系統的無障礙與顯示偏好。參數：`{"requestId"?: "..."}`。
///
/// 回覆 `{requestId?, screenReader, boldText, highContrast, reduceMotion,
/// invertColors, textScale}`：
/// - `screenReader` 是 TalkBack 等螢幕閱讀器的觸控探索是否開啟。使用螢幕閱讀器
///   會洩漏身心障礙資訊，所以只有主 frame 且來源在 [kLlmAllowedOrigins] 內才回
///   報，否則為 `null`（目前白名單只有開發用 origin，正式網域要加入前需經團隊審查）。
/// - `boldText` 在 Android API 31 以下、`highContrast` 在 Android API 34 以下
///   固定為 `false`（Flutter 引擎讀不到）。
/// - `reduceMotion` 是系統「移除動畫」或 iOS 的「減少動態效果」。
/// - 其餘欄位只是顯示偏好，一律回報；`textScale` 為系統字級倍率（1.0＝預設）。
class A11yStateMessageHandler extends TPWebMessageHandler {
  @override
  String get name => 'a11y_state';

  @override
  Future<void> handle({
    required Object? message,
    required WebUri? sourceOrigin,
    required bool isMainFrame,
    required Function(WebMessage replyWebMessage)? onReply,
  }) async {
    final dispatcher = WidgetsBinding.instance.platformDispatcher;
    final features = dispatcher.accessibilityFeatures;
    final bool mayReportScreenReader =
        isMainFrame && isLlmOriginAllowed(_originOf(sourceOrigin));

    onReply?.call(
      replyWebMessage(
        data: _withRequestId(message, {
          'screenReader': mayReportScreenReader
              ? features.accessibleNavigation
              : null,
          'boldText': features.boldText,
          'highContrast': features.highContrast,
          'reduceMotion': features.disableAnimations || features.reduceMotion,
          'invertColors': features.invertColors,
          'textScale': dispatcher.textScaleFactor,
        }),
      ),
    );
  }
}

/// 取得來源網址的 origin；無法解析時回傳 null（視為不允許）。
String? _originOf(WebUri? uri) {
  if (uri == null) return null;
  try {
    return uri.origin;
  } catch (_) {
    return null;
  }
}

/// 把請求的 `requestId` 帶進 [response]，讓網頁端對得上回覆；
/// 只接受長度 ≤ 64 的字串，其他型別或過長的 id 一律不帶。
Map<String, Object?> _withRequestId(
  Object? request,
  Map<String, Object?> response,
) {
  final id = request is Map ? request['requestId'] : null;
  return {...response, if (id is String && id.length <= 64) 'requestId': id};
}

Map<String, Object?> _llmReply(
  Object? request,
  Map<String, Object?> response,
) => _withRequestId(request, response);

/// 啟動本機 LLM 服務。只接受 [kLlmAllowedOrigins] 內的網頁來源；回覆中包含 apiKey。
/// 不接受網頁端傳入 threads / contextSize，避免網頁改變資源用量。
class LlmStartMessageHandler extends TPWebMessageHandler {
  @override
  String get name => 'llm_start';

  @override
  Future<void> handle({
    required Object? message,
    required WebUri? sourceOrigin,
    required bool isMainFrame,
    required Function(WebMessage replyWebMessage)? onReply,
  }) async {
    if (!isMainFrame || !isLlmOriginAllowed(_originOf(sourceOrigin))) {
      onReply?.call(
        replyWebMessage(
          data: _llmReply(message, {
            'phase': 'error',
            'running': false,
            'error': 'origin_not_allowed',
          }),
        ),
      );
      return;
    }
    final status = await LlmService.start();
    onReply?.call(
      replyWebMessage(
        data: _llmReply(message, status.toJson(includeKey: true)),
      ),
    );
  }
}

/// 停止本機 LLM 服務（同樣只接受白名單來源）。
class LlmStopMessageHandler extends TPWebMessageHandler {
  @override
  String get name => 'llm_stop';

  @override
  Future<void> handle({
    required Object? message,
    required WebUri? sourceOrigin,
    required bool isMainFrame,
    required Function(WebMessage replyWebMessage)? onReply,
  }) async {
    if (!isMainFrame || !isLlmOriginAllowed(_originOf(sourceOrigin))) {
      onReply?.call(
        replyWebMessage(
          data: _llmReply(message, {
            'phase': 'error',
            'running': false,
            'error': 'origin_not_allowed',
          }),
        ),
      );
      return;
    }
    final status = await LlmService.stop();
    onReply?.call(replyWebMessage(data: _llmReply(message, status.toJson())));
  }
}

/// 查詢本機 LLM 狀態（不含 apiKey）。
class LlmStatusMessageHandler extends TPWebMessageHandler {
  @override
  String get name => 'llm_status';

  @override
  Future<void> handle({
    required Object? message,
    required WebUri? sourceOrigin,
    required bool isMainFrame,
    required Function(WebMessage replyWebMessage)? onReply,
  }) async {
    if (!isMainFrame || !isLlmOriginAllowed(_originOf(sourceOrigin))) {
      onReply?.call(
        replyWebMessage(
          data: _llmReply(message, {
            'phase': 'error',
            'running': false,
            'error': 'origin_not_allowed',
          }),
        ),
      );
      return;
    }
    final status = await LlmService.status();
    onReply?.call(replyWebMessage(data: _llmReply(message, status.toJson())));
  }
}
