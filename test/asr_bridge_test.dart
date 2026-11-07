import 'dart:convert';

import 'package:flutter/services.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:town_pass/util/web_message_handler/tp_web_message_handler.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const channel = MethodChannel('town_pass/asr');
  final messenger =
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
  tearDown(() => messenger.setMockMethodCallHandler(channel, null));

  List<TPWebMessageHandler> handlers() => [
    AsrStartMessageHandler(),
    AsrStatusMessageHandler(),
    AsrStopMessageHandler(),
  ];

  test('ASR 回覆保留 requestId，只有啟動回傳 API key', () async {
    final methods = <String>[];
    messenger.setMockMethodCallHandler(channel, (call) async {
      methods.add(call.method);
      return {
        'phase': call.method == 'stop' ? 'idle' : 'running',
        'running': call.method != 'stop',
        'baseUrl': 'http://127.0.0.1:9100/v1',
        'apiKey': 'fictional-asr-test-key',
        'model': 'taiwan-tongues-asr-ce-v1.0-q4_0',
        'threads': 2,
        'error': null,
      };
    });
    for (final handler in handlers()) {
      Map? reply;
      await handler.handle(
        message: {'requestId': 'asr-request'},
        sourceOrigin: WebUri('http://localhost:5173'),
        isMainFrame: true,
        onReply: (message) => reply = jsonDecode(message.data),
      );
      expect(reply!['name'], handler.name);
      expect(reply!['data']['requestId'], 'asr-request');
      expect(
        (reply!['data'] as Map).containsKey('apiKey'),
        handler.name == 'asr_start',
      );
    }
    expect(methods, ['start', 'status', 'stop']);
  });

  test('ASR 拒絕允許來源的子框架且不呼叫原生端', () async {
    var calls = 0;
    messenger.setMockMethodCallHandler(channel, (_) async {
      calls++;
      return {'phase': 'running', 'running': true};
    });
    for (final handler in handlers()) {
      Map? reply;
      await handler.handle(
        message: {'requestId': 'subframe'},
        sourceOrigin: WebUri('http://localhost:5173'),
        isMainFrame: false,
        onReply: (message) => reply = jsonDecode(message.data),
      );
      expect(reply!['data']['error'], 'origin_not_allowed');
      expect(reply!['data']['phase'], 'error');
      expect(reply!['data']['requestId'], 'subframe');
      expect((reply!['data'] as Map).containsKey('apiKey'), isFalse);
    }
    expect(calls, 0);
  });

  test('ASR 拒絕未授權或缺少來源且保留錯誤請求編號', () async {
    var calls = 0;
    messenger.setMockMethodCallHandler(channel, (_) async {
      calls++;
      return {};
    });
    for (final handler in handlers()) {
      for (final origin in [WebUri('https://evil.example'), null]) {
        Map? reply;
        await handler.handle(
          message: {'requestId': 'denied'},
          sourceOrigin: origin,
          isMainFrame: true,
          onReply: (message) => reply = jsonDecode(message.data),
        );
        expect(reply!['data']['error'], 'origin_not_allowed');
        expect(reply!['data']['requestId'], 'denied');
        expect((reply!['data'] as Map).containsKey('apiKey'), isFalse);
      }
    }
    expect(calls, 0);
  });

  test('ASR 接受與 LLM 相同的 loopback 來源且不接受網頁覆寫執行緒', () async {
    MethodCall? seen;
    messenger.setMockMethodCallHandler(channel, (call) async {
      seen = call;
      return {'phase': 'running', 'running': true};
    });
    Map? reply;
    await AsrStartMessageHandler().handle(
      message: {'threads': 16, 'requestId': 'loopback'},
      sourceOrigin: WebUri('http://127.0.0.1:5173'),
      isMainFrame: true,
      onReply: (message) => reply = jsonDecode(message.data),
    );
    expect(reply!['data']['running'], isTrue);
    expect(seen!.method, 'start');
    expect(seen!.arguments, isEmpty);
  });

  test('ASR 不回傳不合法或過長的 requestId', () async {
    messenger.setMockMethodCallHandler(
      channel,
      (_) async => {'phase': 'idle', 'running': false},
    );
    for (final id in [123, 'x' * 65]) {
      Map? reply;
      await AsrStatusMessageHandler().handle(
        message: {'requestId': id},
        sourceOrigin: WebUri('http://localhost:5173'),
        isMainFrame: true,
        onReply: (message) => reply = jsonDecode(message.data),
      );
      expect((reply!['data'] as Map).containsKey('requestId'), isFalse);
    }
  });
}
