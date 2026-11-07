import 'dart:convert';

import 'package:town_pass/util/web_message_handler/tp_web_message_handler.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';

abstract class TPWebMessageListener {
  // 將訊息處理器列表快取起來，避免每次訪問時都重複建立新的實例。
  // 這樣做可以提升應用程式的啟動效能，因為這些處理器通常是無狀態的。
  static final List<TPWebMessageHandler> _cachedMessageHandlers = [
    UserinfoWebMessageHandler(),
    LaunchMapWebMessageHandler(),
    PhoneCallMessageHandler(),
    Agree1999MessageHandler(),
    LocationMessageHandler(),
    DeviceInfoMessageHandler(),
    OpenLinkMessageHandler(),
    NotifyMessageHandler(),
    QRCodeScanMessageHandler(),
    TtsMessageHandler(),
    ShareMessageHandler(),
    HapticMessageHandler(),
    A11yStateMessageHandler(),
    LlmStartMessageHandler(),
    LlmStopMessageHandler(),
    LlmStatusMessageHandler(),
    AsrStartMessageHandler(),
    AsrStopMessageHandler(),
    AsrStatusMessageHandler(),
    TtsStartMessageHandler(),
    TtsStopMessageHandler(),
    TtsStatusMessageHandler(),
  ];

  static List<TPWebMessageHandler> get messageHandler => _cachedMessageHandlers;

  /// 授權主 frame 的 tts_* 回覆必須透過 [onTtsReply]，不可使用共享 replyProxy。
  /// 呼叫端須以 controller.postWebMessage 送往指定 origin（window message 事件）。
  /// 未提供安全回覆通道時不執行 TTS 請求，亦不回退到 replyProxy。
  static WebMessageListener webMessageListener({
    Future<void> Function(WebMessage reply, WebUri targetOrigin)? onTtsReply,
  }) {
    return WebMessageListener(
      jsObjectName: 'flutterObject',
      onPostMessage: (webMessage, sourceOrigin, isMainFrame, replyProxy) async {
        if (webMessage == null) {
          return;
        }

        final Map dataMap = jsonDecode(webMessage.data);
        for (TPWebMessageHandler handler in messageHandler) {
          if (handler.name == dataMap['name']) {
            final isTts =
                handler is TtsStartMessageHandler ||
                handler is TtsStopMessageHandler ||
                handler is TtsStatusMessageHandler;
            final useSafeReply =
                isTts &&
                isTtsRequestAllowed(
                  sourceOrigin: sourceOrigin,
                  isMainFrame: isMainFrame,
                );
            if (useSafeReply && onTtsReply == null) return;

            // Android 1.1.3 的 replyProxy 會被下一則 incoming 覆寫。
            // 在 await 前固定原請求 origin，由原生 postWebMessage 阻擋跨源導頁競態。
            final targetOrigin = useSafeReply
                ? WebUri(sourceOrigin!.origin)
                : null;
            WebMessage? ttsReply;
            await handler.handle(
              message: dataMap['data'],
              sourceOrigin: sourceOrigin,
              isMainFrame: isMainFrame,
              onReply: (reply) {
                if (useSafeReply) {
                  ttsReply = reply;
                } else {
                  return replyProxy.postMessage(reply);
                }
              },
            );
            if (ttsReply != null) {
              try {
                await onTtsReply!(ttsReply!, targetOrigin!);
              } catch (_) {
                // WebView 可能已 dispose；安全丟棄，不讓錯誤逃出 plugin 的 void callback。
                // 不記錄可能含 key 的 payload、不回退共享 proxy，也不停止其他頁共用的服務。
              }
            }
          }
        }
      },
    );
  }
}
