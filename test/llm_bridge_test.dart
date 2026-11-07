import 'dart:convert';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:town_pass/util/web_message_handler/tp_web_message_handler.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const channel = MethodChannel('town_pass/llm');
  final messenger =
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
  tearDown(() => messenger.setMockMethodCallHandler(channel, null));

  test(
    'LLM bridge correlates startup and omits keys from status and stop',
    () async {
      messenger.setMockMethodCallHandler(
        channel,
        (call) async => {
          'phase': call.method == 'stop' ? 'idle' : 'running',
          'running': call.method != 'stop',
          'baseUrl': 'http://127.0.0.1:9000/v1',
          'apiKey': 'fictional-test-key',
          'model': 'fixture',
        },
      );
      for (final handler in [
        LlmStartMessageHandler(),
        LlmStatusMessageHandler(),
        LlmStopMessageHandler(),
      ]) {
        Map? reply;
        await handler.handle(
          message: {'requestId': 'test-request'},
          sourceOrigin: WebUri('http://127.0.0.1:5173'),
          isMainFrame: true,
          onReply: (message) => reply = jsonDecode(message.data),
        );
        expect(reply!['name'], handler.name);
        expect(reply!['data']['requestId'], 'test-request');
        expect(
          (reply!['data'] as Map).containsKey('apiKey'),
          handler.name == 'llm_start',
        );
      }
    },
  );

  test('LLM bridge refuses unapproved origins and child frames before native calls', () async {
    var calls = 0;
    messenger.setMockMethodCallHandler(channel, (_) async {
      calls++;
      return {};
    });
    for (final handler in [
      LlmStartMessageHandler(),
      LlmStatusMessageHandler(),
      LlmStopMessageHandler(),
    ]) {
      for (final mainFrame in [true, false]) {
        Map? reply;
        await handler.handle(
          message: {'requestId': 'denied'},
          sourceOrigin: WebUri(
            mainFrame ? 'https://evil.example' : 'http://127.0.0.1:5173',
          ),
          isMainFrame: mainFrame,
          onReply: (message) => reply = jsonDecode(message.data),
        );
        expect(reply!['data']['error'], 'origin_not_allowed');
        expect(reply!['data']['requestId'], 'denied');
        expect((reply!['data'] as Map).containsKey('apiKey'), isFalse);
      }
    }
    expect(calls, 0);
  });
}
