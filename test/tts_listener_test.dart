import 'dart:async';
import 'dart:convert';

import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:town_pass/util/tp_web_view.dart';
import 'package:town_pass/util/web_message_handler/tp_web_message_listener.dart';

const _runningStatus = <String, Object?>{
  'phase': 'running',
  'running': true,
  'baseUrl': 'http://127.0.0.1:9100/v1',
  'apiKey': 'fixture-key',
  'model': 'bluemagpie-q8_0',
  'threads': 2,
  'error': null,
};

class _TestWebViewPlatform extends InAppWebViewPlatform {
  @override
  PlatformInAppWebViewWidget createPlatformInAppWebViewWidget(
    PlatformInAppWebViewWidgetCreationParams params,
  ) => _TestWebViewWidget(params);

  @override
  PlatformWebMessageListener createPlatformWebMessageListener(
    PlatformWebMessageListenerCreationParams params,
  ) => _TestWebMessageListener(params);
}

class _TestWebViewWidget extends PlatformInAppWebViewWidget {
  _TestWebViewWidget(super.params) : super.implementation();

  @override
  Widget build(BuildContext context) => const SizedBox.shrink();

  @override
  T controllerFromPlatform<T>(PlatformInAppWebViewController controller) =>
      params.controllerFromPlatform!(controller) as T;

  @override
  void dispose() {}
}

class _RecordingController extends PlatformInAppWebViewController {
  _RecordingController()
    : super.implementation(
        const PlatformInAppWebViewControllerCreationParams(id: 'tts-test'),
      );

  late PlatformWebMessageListener listener;
  final postedMessages = <({WebMessage message, WebUri? targetOrigin})>[];

  @override
  Future<void> addWebMessageListener(
    PlatformWebMessageListener listener,
  ) async {
    this.listener = listener;
  }

  @override
  Future<void> postWebMessage({
    required WebMessage message,
    WebUri? targetOrigin,
  }) async {
    postedMessages.add((message: message, targetOrigin: targetOrigin));
  }
}

class _TestWebMessageListener extends PlatformWebMessageListener {
  _TestWebMessageListener(super.params) : super.implementation();
}

// 模擬 Android 1.1.3：Dart proxy 共用同一個 native listener，
// 每次 incoming 都覆寫 native replyProxy，並非綁定原請求的 frame。
class _MutableReplyProxy extends PlatformJavaScriptReplyProxy {
  _MutableReplyProxy(PlatformWebMessageListener listener)
    : super.implementation(
        PlatformJavaScriptReplyProxyCreationParams(
          webMessageListener: listener,
        ),
      );

  String recipient = 'main';
  final deliveries = <({String recipient, Map<String, dynamic> reply})>[];

  @override
  Future<void> postMessage(WebMessage message) async {
    deliveries.add((recipient: recipient, reply: jsonDecode(message.data)));
  }
}

Future<void> _post(
  WebMessageListener listener,
  _MutableReplyProxy proxy, {
  required String name,
  String? origin = 'http://127.0.0.1:5173',
  bool isMainFrame = true,
  String requestId = 'tts-request',
  Map<String, Object?>? data,
}) {
  proxy.recipient = isMainFrame ? 'main' : 'evil-iframe';
  // 套件將 callback 宣告為 void；保留實際 async callback 的 Future，
  // 讓測試等待真正的 listener dispatch 完成，不靠延遲或直接呼叫 handler。
  final onPostMessage =
      listener.onPostMessage!
          as Future<void> Function(
            WebMessage?,
            WebUri?,
            bool,
            PlatformJavaScriptReplyProxy,
          );
  return onPostMessage(
    WebMessage(
      data: jsonEncode({
        'name': name,
        'data': data ?? {'requestId': requestId},
      }),
    ),
    origin == null ? null : WebUri(origin),
    isMainFrame,
    proxy,
  );
}

void _expectNoProxyKey(_MutableReplyProxy proxy) {
  for (final delivery in proxy.deliveries) {
    expect(delivery.reply.toString(), isNot(contains('fixture-key')));
    final data = delivery.reply['data'];
    if (data is Map) expect(data.containsKey('apiKey'), isFalse);
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  const channel = MethodChannel('town_pass/tts');
  final messenger =
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
  final nativeCalls = <MethodCall>[];
  final originalPlatform = InAppWebViewPlatform.instance;

  setUp(() {
    InAppWebViewPlatform.instance = _TestWebViewPlatform();
    nativeCalls.clear();
    messenger.setMockMethodCallHandler(channel, (call) async {
      nativeCalls.add(call);
      return _runningStatus;
    });
  });

  tearDown(() {
    messenger.setMockMethodCallHandler(channel, null);
    if (originalPlatform != null) {
      InAppWebViewPlatform.instance = originalPlatform;
    }
  });

  test('pending tts_start 後的 evil iframe incoming 不得接走 key', () async {
    final started = Completer<void>();
    final startResult = Completer<Map<String, Object?>>();
    messenger.setMockMethodCallHandler(channel, (call) async {
      nativeCalls.add(call);
      started.complete();
      return startResult.future;
    });
    final safeReplies = <({WebMessage reply, WebUri targetOrigin})>[];
    final listener = TPWebMessageListener.webMessageListener(
      onTtsReply: (reply, targetOrigin) async {
        safeReplies.add((reply: reply, targetOrigin: targetOrigin));
      },
    );
    final proxy = _MutableReplyProxy(listener.platform);

    final pendingStart = _post(listener, proxy, name: 'tts_start');
    await started.future;
    await _post(
      listener,
      proxy,
      name: 'tts_status',
      origin: 'https://evil.example',
      isMainFrame: false,
      requestId: 'evil-request',
    );
    expect(nativeCalls.map((call) => call.method), ['start']);
    expect(safeReplies, isEmpty);
    expect(proxy.deliveries.single.recipient, 'evil-iframe');
    expect(
      proxy.deliveries.single.reply['data']['error'],
      'origin_not_allowed',
    );

    startResult.complete(_runningStatus);
    await pendingStart;

    _expectNoProxyKey(proxy);
    expect(proxy.deliveries, hasLength(1));
    expect(safeReplies, hasLength(1));
    expect(safeReplies.single.targetOrigin.toString(), 'http://127.0.0.1:5173');
    expect(jsonDecode(safeReplies.single.reply.data), {
      'name': 'tts_start',
      'data': {..._runningStatus, 'requestId': 'tts-request'},
    });
  });

  for (final method in ['start', 'stop', 'status']) {
    test('tts_$method 無安全 callback 時 fail closed，且不呼叫原生端', () async {
      final listener = TPWebMessageListener.webMessageListener();
      final proxy = _MutableReplyProxy(listener.platform);

      await _post(listener, proxy, name: 'tts_$method');

      _expectNoProxyKey(proxy);
      expect(proxy.deliveries, isEmpty);
      expect(nativeCalls, isEmpty);
    });

    test('tts_$method 的授權回覆只送安全 callback，保留原 origin 與 requestId', () async {
      final safeReplies = <({WebMessage reply, WebUri targetOrigin})>[];
      final listener = TPWebMessageListener.webMessageListener(
        onTtsReply: (reply, targetOrigin) async {
          safeReplies.add((reply: reply, targetOrigin: targetOrigin));
        },
      );
      final proxy = _MutableReplyProxy(listener.platform);

      await _post(
        listener,
        proxy,
        name: 'tts_$method',
        origin: 'http://localhost:5173',
      );

      expect(nativeCalls.map((call) => call.method), [method]);
      expect(proxy.deliveries, isEmpty);
      expect(safeReplies, hasLength(1));
      expect(
        safeReplies.single.targetOrigin.toString(),
        'http://localhost:5173',
      );
      final reply = jsonDecode(safeReplies.single.reply.data) as Map;
      expect(reply['name'], 'tts_$method');
      expect(reply['data']['requestId'], 'tts-request');
      expect(reply['data']['running'], isTrue);
      expect((reply['data'] as Map).containsKey('apiKey'), method == 'start');
    });
  }

  for (final request in <({String? origin, bool isMainFrame})>[
    (origin: 'https://evil.example', isMainFrame: true),
    (origin: 'http://127.0.0.1:5173', isMainFrame: false),
    (origin: null, isMainFrame: true),
    (origin: 'file:///page.html', isMainFrame: true),
  ]) {
    test('tts_start 拒絕 $request，不呼叫安全 callback 或原生服務', () async {
      final safeReplies = <WebMessage>[];
      final listener = TPWebMessageListener.webMessageListener(
        onTtsReply: (reply, _) async => safeReplies.add(reply),
      );
      final proxy = _MutableReplyProxy(listener.platform);

      await _post(
        listener,
        proxy,
        name: 'tts_start',
        origin: request.origin,
        isMainFrame: request.isMainFrame,
      );

      expect(nativeCalls, isEmpty);
      expect(safeReplies, isEmpty);
      _expectNoProxyKey(proxy);
      expect(proxy.deliveries.single.reply, {
        'name': 'tts_start',
        'data': {
          'phase': 'error',
          'running': false,
          'error': 'origin_not_allowed',
          'requestId': 'tts-request',
        },
      });
    });
  }

  testWidgets('TPInAppWebView 將 TTS 回覆交給 controller 並保留 targetOrigin', (
    tester,
  ) async {
    final controller = _RecordingController();
    await tester.pumpWidget(const TPInAppWebView());
    final view = tester.widget<InAppWebView>(find.byType(InAppWebView));
    view.platform.params.onWebViewCreated!(
      InAppWebViewController.fromPlatform(platform: controller),
    );
    await tester.pump();
    final listener = WebMessageListener.fromPlatform(
      platform: controller.listener,
    );
    final proxy = _MutableReplyProxy(controller.listener);

    await _post(
      listener,
      proxy,
      name: 'tts_start',
      origin: 'http://10.0.2.2:5173',
    );

    expect(controller.postedMessages, hasLength(1));
    expect(
      controller.postedMessages.single.targetOrigin.toString(),
      'http://10.0.2.2:5173',
    );
    expect(jsonDecode(controller.postedMessages.single.message.data), {
      'name': 'tts_start',
      'data': {..._runningStatus, 'requestId': 'tts-request'},
    });
    expect(proxy.deliveries, isEmpty);
  });

  test('舊 tts 與 llm_status 仍走原 replyProxy，不使用 TTS callback', () async {
    const systemChannel = MethodChannel('flutter_tts');
    const llmChannel = MethodChannel('town_pass/llm');
    final systemCalls = <MethodCall>[];
    final llmCalls = <MethodCall>[];
    messenger.setMockMethodCallHandler(systemChannel, (call) async {
      systemCalls.add(call);
      return 1;
    });
    messenger.setMockMethodCallHandler(llmChannel, (call) async {
      llmCalls.add(call);
      return {'phase': 'idle', 'running': false};
    });
    addTearDown(() {
      messenger.setMockMethodCallHandler(systemChannel, null);
      messenger.setMockMethodCallHandler(llmChannel, null);
    });
    final safeReplies = <WebMessage>[];
    final listener = TPWebMessageListener.webMessageListener(
      onTtsReply: (reply, _) async => safeReplies.add(reply),
    );
    final proxy = _MutableReplyProxy(listener.platform);

    await _post(listener, proxy, name: 'tts', data: {'stop': true});
    await _post(listener, proxy, name: 'llm_status');

    expect(systemCalls.map((call) => call.method), ['stop']);
    expect(llmCalls.map((call) => call.method), ['status']);
    expect(nativeCalls, isEmpty);
    expect(safeReplies, isEmpty);
    expect(proxy.deliveries, hasLength(2));
    expect(proxy.deliveries.first.reply, {'name': 'tts', 'data': true});
    expect(proxy.deliveries.last.reply['name'], 'llm_status');
    expect(proxy.deliveries.last.reply['data']['requestId'], 'tts-request');
    _expectNoProxyKey(proxy);
  });

  for (final failure in <Object>[
    StateError('WebView disposed'),
    FlutterError('WebView controller is no longer attached'),
    PlatformException(code: 'disposed'),
  ]) {
    test('安全 callback 的 ${failure.runtimeType} 安靜丟棄，不回退或停止服務', () async {
      final listener = TPWebMessageListener.webMessageListener(
        onTtsReply: (_, _) async => throw failure,
      );
      final proxy = _MutableReplyProxy(listener.platform);

      await expectLater(_post(listener, proxy, name: 'tts_start'), completes);

      expect(nativeCalls.map((call) => call.method), ['start']);
      _expectNoProxyKey(proxy);
      expect(proxy.deliveries, isEmpty);
    });
  }

  test('同步拋出的安全 reply 錯誤也不會逃出 void plugin callback', () async {
    final listener = TPWebMessageListener.webMessageListener(
      onTtsReply: (_, _) => throw FlutterError('WebView disposed'),
    );
    final proxy = _MutableReplyProxy(listener.platform);

    await expectLater(_post(listener, proxy, name: 'tts_start'), completes);

    expect(nativeCalls.map((call) => call.method), ['start']);
    _expectNoProxyKey(proxy);
    expect(proxy.deliveries, isEmpty);
  });
}
