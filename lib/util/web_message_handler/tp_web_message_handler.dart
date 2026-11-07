import 'dart:async';

import 'package:flutter/cupertino.dart';
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
/// Android WebView 沒有 `speechSynthesis`（見 research/09），所以網頁端的
/// 「唸給我聽」一律走這支 handler。參數：
/// `{"text": "...", "lang": "zh-TW"}` 或 `{"stop": true}`。
class TtsMessageHandler extends TPWebMessageHandler {
  static final FlutterTts _tts = FlutterTts();
  static bool _configured = false;

  @override
  String get name => 'tts';

  @override
  Future<void> handle({
    required Object? message,
    required WebUri? sourceOrigin,
    required bool isMainFrame,
    required Function(WebMessage replyWebMessage)? onReply,
  }) async {
    final Map data = message is Map ? message : const {};

    // 停止朗讀：使用者按了「停止」或換頁時呼叫
    if (data['stop'] == true) {
      await _tts.stop();
      onReply?.call(replyWebMessage(data: true));
      return;
    }

    final String text = (data['text'] ?? '').toString().trim();
    if (text.isEmpty) {
      await _tts.stop();
      onReply?.call(replyWebMessage(data: false));
      return;
    }

    if (!_configured) {
      await _tts.setLanguage((data['lang'] ?? 'zh-TW').toString());
      // Android 的 speech rate 0.5 約等於正常語速
      await _tts.setSpeechRate(0.5);
      await _tts.setVolume(1.0);
      await _tts.setPitch(1.0);
      _configured = true;
    }

    await _tts.stop();
    final dynamic result = await _tts.speak(text);
    onReply?.call(replyWebMessage(data: result == 1 || result == true));
  }
}

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

/// 取得來源網址的 origin；無法解析時回傳 null（視為不允許）。
String? _originOf(WebUri? uri) {
  if (uri == null) return null;
  try {
    return uri.origin;
  } catch (_) {
    return null;
  }
}

Map<String, Object?> _llmReply(Object? request, Map<String, Object?> response) {
  final id = request is Map ? request['requestId'] : null;
  return {...response, if (id is String && id.length <= 64) 'requestId': id};
}

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
