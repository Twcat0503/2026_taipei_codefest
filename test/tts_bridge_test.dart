import 'dart:convert';

import 'package:flutter/services.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:town_pass/util/web_message_handler/tp_web_message_handler.dart';
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

Future<Map<String, dynamic>> _handle(
  TPWebMessageHandler handler, {
  Object? message = const {'requestId': 'tts-request'},
  String? origin = 'http://127.0.0.1:5173',
  bool isMainFrame = true,
}) async {
  final replies = <Map<String, dynamic>>[];
  await handler.handle(
    message: message,
    sourceOrigin: origin == null ? null : WebUri(origin),
    isMainFrame: isMainFrame,
    onReply: (reply) => replies.add(jsonDecode(reply.data)),
  );
  expect(replies, hasLength(1));
  expect(replies.single['name'], handler.name);
  return (replies.single['data'] as Map).cast<String, dynamic>();
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  const channel = MethodChannel('town_pass/tts');
  const systemChannel = MethodChannel('flutter_tts');
  final messenger =
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
  final nativeCalls = <MethodCall>[];
  final handlers = <String, TPWebMessageHandler>{
    'start': TtsStartMessageHandler(),
    'stop': TtsStopMessageHandler(),
    'status': TtsStatusMessageHandler(),
  };

  setUp(() {
    nativeCalls.clear();
    messenger.setMockMethodCallHandler(channel, (call) async {
      nativeCalls.add(call);
      return {
        ..._runningStatus,
        if (call.method == 'stop') ...{'phase': 'idle', 'running': false},
      };
    });
  });

  tearDown(() {
    messenger.setMockMethodCallHandler(channel, null);
    messenger.setMockMethodCallHandler(systemChannel, null);
  });

  for (final entry in handlers.entries) {
    final method = entry.key;
    final handler = entry.value;

    for (final origin in [
      'http://10.0.2.2:5173',
      'http://localhost:5173',
      'http://127.0.0.1:5173',
    ]) {
      test('$method 接受 $origin 的主 frame，保留 requestId 且不轉發資源參數', () async {
        final reply = await _handle(
          handler,
          origin: origin,
          message: {
            'requestId': 'tts-request',
            'threads': 64,
            'model': 'other-model',
            'modelPath': '/untrusted/model.gguf',
            'path': '/untrusted/runtime',
            'url': 'https://evil.example/model',
            'baseUrl': 'http://evil.example/v1',
            'voice': 'unapproved',
            'reference_audio': 'https://evil.example/reference.wav',
            'apiKey': 'untrusted-key',
          },
        );

        expect(handler.name, 'tts_$method');
        expect(nativeCalls, hasLength(1));
        expect(nativeCalls.single.method, method);
        expect(nativeCalls.single.arguments, method == 'start' ? {} : null);
        expect(reply['requestId'], 'tts-request');
        expect(reply['phase'], method == 'stop' ? 'idle' : 'running');
        expect(reply['running'], method != 'stop');
        expect(
          reply['baseUrl'],
          method == 'stop' ? null : 'http://127.0.0.1:9100/v1',
        );
        expect(reply.containsKey('apiKey'), method == 'start');
        if (method == 'start') expect(reply['apiKey'], 'fixture-key');
      });
    }

    final deniedRequests = <({String? origin, bool isMainFrame})>[
      (origin: null, isMainFrame: true),
      (origin: 'https://evil.example', isMainFrame: true),
      (origin: 'http://127.0.0.1.evil.test:5173', isMainFrame: true),
      (origin: 'http://127.0.0.1:5174', isMainFrame: true),
      (origin: 'https://localhost:5173', isMainFrame: true),
      (origin: 'file:///local-page.html', isMainFrame: true),
      (origin: 'data:text/html,untrusted', isMainFrame: true),
      (origin: 'http://127.0.0.1:5173', isMainFrame: false),
      (origin: 'http://localhost:5173', isMainFrame: false),
      (origin: 'http://10.0.2.2:5173', isMainFrame: false),
    ];
    for (final request in deniedRequests) {
      test('$method 拒絕 $request，且完全不呼叫原生端', () async {
        final reply = await _handle(
          handler,
          origin: request.origin,
          isMainFrame: request.isMainFrame,
        );

        expect(nativeCalls, isEmpty);
        expect(reply['phase'], 'error');
        expect(reply['running'], isFalse);
        expect(reply['error'], 'origin_not_allowed');
        expect(reply['requestId'], 'tts-request');
        expect(reply['baseUrl'], isNull);
        expect(reply.containsKey('apiKey'), isFalse);
      });
    }

    for (final allowed in [true, false]) {
      test(
        '$method 的${allowed ? '成功' : '拒絕'}回覆只保留長度不超過 64 的字串 requestId',
        () async {
          final validIds = ['', 'r' * 64];
          final invalidMessages = <Object?>[
            {'requestId': 'r' * 65},
            {'requestId': 1},
            {'requestId': null},
            {
              'requestId': ['nested'],
            },
            {},
            null,
            'not-a-map',
          ];
          final origin = allowed
              ? 'http://127.0.0.1:5173'
              : 'https://evil.example';
          for (final id in validIds) {
            final reply = await _handle(
              handler,
              origin: origin,
              message: {'requestId': id},
            );
            expect(reply['requestId'], id);
          }
          for (final message in invalidMessages) {
            final reply = await _handle(
              handler,
              origin: origin,
              message: message,
            );
            expect(reply.containsKey('requestId'), isFalse);
          }
          expect(nativeCalls, hasLength(allowed ? 9 : 0));
        },
      );
    }

    test('$method 的原生錯誤回覆不洩漏舊 endpoint 或 key', () async {
      messenger.setMockMethodCallHandler(channel, (call) async {
        nativeCalls.add(call);
        return {
          ..._runningStatus,
          'phase': 'error',
          'running': false,
          'error': '模型載入失敗',
        };
      });

      final reply = await _handle(handler);

      expect(nativeCalls, hasLength(1));
      expect(reply['phase'], 'error');
      expect(reply['running'], isFalse);
      expect(reply['error'], '模型載入失敗');
      expect(reply['requestId'], 'tts-request');
      expect(reply['baseUrl'], isNull);
      expect(reply.containsKey('apiKey'), isFalse);
    });

    test('$method 的平台錯誤仍回覆 requestId 且不包含 key', () async {
      messenger.setMockMethodCallHandler(channel, (call) async {
        nativeCalls.add(call);
        throw PlatformException(code: 'tts_error', message: '執行失敗');
      });

      final reply = await _handle(handler);

      expect(nativeCalls, hasLength(1));
      expect(reply['phase'], 'error');
      expect(reply['running'], isFalse);
      expect(reply['error'], '執行失敗');
      expect(reply['requestId'], 'tts-request');
      expect(reply['baseUrl'], isNull);
      expect(reply.containsKey('apiKey'), isFalse);
    });

    test('listener 的 tts_$method 註冊能實際呼叫對應原生服務', () async {
      final registered = TPWebMessageListener.messageHandler.singleWhere(
        (handler) => handler.name == 'tts_$method',
      );

      final reply = await _handle(registered);

      expect(nativeCalls, hasLength(1));
      expect(nativeCalls.single.method, method);
      expect(reply['requestId'], 'tts-request');
    });
  }

  test('listener 保留舊 tts 系統朗讀與停止，不會啟動本機模型', () async {
    final systemCalls = <MethodCall>[];
    messenger.setMockMethodCallHandler(systemChannel, (call) async {
      systemCalls.add(call);
      // The system tts handler checks the language before speaking.
      return call.method == 'isLanguageAvailable' ? true : 1;
    });
    final handler = TPWebMessageListener.messageHandler.singleWhere(
      (handler) => handler.name == 'tts',
    );
    final replies = <Map<String, dynamic>>[];
    for (final message in [
      {'text': '  你好  ', 'lang': 'zh-TW'},
      {'stop': true},
    ]) {
      await handler.handle(
        message: message,
        sourceOrigin: null,
        isMainFrame: false,
        onReply: (reply) => replies.add(jsonDecode(reply.data)),
      );
    }

    expect(nativeCalls, isEmpty);
    final speech = systemCalls.singleWhere((call) => call.method == 'speak');
    expect(speech.arguments, anyOf('你好', {'text': '你好', 'focus': false}));
    expect(systemCalls.last.method, 'stop');
    expect(replies, [
      {'name': 'tts', 'data': true},
      {'name': 'tts', 'data': true},
    ]);
  });
}
