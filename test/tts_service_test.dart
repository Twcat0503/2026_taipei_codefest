import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:town_pass/service/tts_service.dart';

const _runningStatus = <String, Object?>{
  'phase': 'running',
  'running': true,
  'baseUrl': 'http://127.0.0.1:9100/v1',
  'apiKey': 'fixture-key',
  'model': 'bluemagpie-q8_0',
  'threads': 2,
  'error': null,
};

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  const channel = MethodChannel('town_pass/tts');
  final messenger =
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
  final operations = <String, Future<TtsStatus> Function()>{
    'start': () => TtsService.start(),
    'stop': TtsService.stop,
    'status': TtsService.status,
  };

  tearDown(() => messenger.setMockMethodCallHandler(channel, null));

  test('start 只傳指定的 threads，並解析原生狀態與完整序列化欄位', () async {
    final calls = <MethodCall>[];
    messenger.setMockMethodCallHandler(channel, (call) async {
      calls.add(call);
      return _runningStatus;
    });

    final status = await TtsService.start(threads: 2);

    expect(calls, hasLength(1));
    expect(calls.single.method, 'start');
    expect(calls.single.arguments, {'threads': 2});
    expect(status.phase, 'running');
    expect(status.running, isTrue);
    expect(status.baseUrl, 'http://127.0.0.1:9100/v1');
    expect(status.apiKey, 'fixture-key');
    expect(status.model, 'bluemagpie-q8_0');
    expect(status.threads, 2);
    expect(status.error, isNull);
    expect(status.toJson(), {
      'phase': 'running',
      'running': true,
      'baseUrl': 'http://127.0.0.1:9100/v1',
      'model': 'bluemagpie-q8_0',
      'threads': 2,
      'error': null,
    });
    expect(status.toJson().containsKey('apiKey'), isFalse);
    expect(status.toJson(includeKey: true)['apiKey'], 'fixture-key');
  });

  test('start 省略 threads 時，讓原生端決定資源配置', () async {
    MethodCall? seen;
    messenger.setMockMethodCallHandler(channel, (call) async {
      seen = call;
      return _runningStatus;
    });

    await TtsService.start();

    expect(seen!.method, 'start');
    expect(seen!.arguments, isEmpty);
  });

  for (final method in ['stop', 'status']) {
    test('$method 不傳參數，且即使原生誤送 key 也不保留或序列化', () async {
      final calls = <MethodCall>[];
      messenger.setMockMethodCallHandler(channel, (call) async {
        calls.add(call);
        // 故意回傳仍在執行的狀態，確保不能只依 running 決定是否保留 key。
        return _runningStatus;
      });

      final status = await operations[method]!();

      expect(calls, hasLength(1));
      expect(calls.single.method, method);
      expect(calls.single.arguments, isNull);
      expect(status.running, isTrue);
      expect(status.baseUrl, 'http://127.0.0.1:9100/v1');
      expect(status.apiKey, isNull);
      expect(status.toJson().containsKey('apiKey'), isFalse);
      expect(status.toJson(includeKey: true).containsKey('apiKey'), isFalse);
    });
  }

  test('stop 的 idle 回覆不留下原生誤送的舊 endpoint', () async {
    messenger.setMockMethodCallHandler(
      channel,
      (_) async => {..._runningStatus, 'phase': 'idle', 'running': false},
    );

    final status = await TtsService.stop();

    expect(status.phase, 'idle');
    expect(status.running, isFalse);
    expect(status.baseUrl, isNull);
    expect(status.apiKey, isNull);
    expect(status.toJson()['baseUrl'], isNull);
  });

  for (final entry in operations.entries) {
    for (final message in ['缺少 TTS 執行檔', null]) {
      test('${entry.key} 將 PlatformException 轉成無 endpoint 與 key 的錯誤', () async {
        messenger.setMockMethodCallHandler(channel, (_) async {
          throw PlatformException(code: 'tts_error', message: message);
        });

        final status = await entry.value();

        expect(status.phase, 'error');
        expect(status.running, isFalse);
        expect(status.error, message ?? 'tts_error');
        expect(status.baseUrl, isNull);
        expect(status.apiKey, isNull);
        expect(status.toJson(includeKey: true).containsKey('apiKey'), isFalse);
      });
    }

    test('${entry.key} 在沒有原生實作的平台回傳 Android 錯誤而不拋出例外', () async {
      final status = await entry.value();

      expect(status.phase, 'error');
      expect(status.running, isFalse);
      expect(status.error, contains('Android'));
      expect(status.baseUrl, isNull);
      expect(status.apiKey, isNull);
      expect(status.toJson(includeKey: true).containsKey('apiKey'), isFalse);
    });

    test('${entry.key} 遇到空的原生回覆時使用安全的 idle 預設值', () async {
      messenger.setMockMethodCallHandler(channel, (_) async => null);

      final status = await entry.value();

      expect(status.toJson(includeKey: true), {
        'phase': 'idle',
        'running': false,
        'baseUrl': null,
        'model': null,
        'threads': null,
        'error': null,
      });
    });
  }

  final unavailableStates = [
    {'phase': 'idle', 'running': false, 'error': null},
    {'phase': 'starting', 'running': false, 'error': null},
    {'phase': 'error', 'running': false, 'error': '模型載入失敗'},
    {'phase': 'running', 'running': false, 'error': null},
    {'phase': 'error', 'running': true, 'error': '子行程已結束'},
    {'phase': 'running', 'running': true, 'error': '子行程已結束'},
  ];
  for (final state in unavailableStates) {
    test('start 不會把不可用狀態 $state 的舊 endpoint 或 key 當成成功', () async {
      messenger.setMockMethodCallHandler(
        channel,
        (_) async => {..._runningStatus, ...state},
      );

      final status = await TtsService.start();

      expect(status.phase, state['phase']);
      expect(status.running, isFalse);
      expect(status.error, state['error']);
      expect(status.baseUrl, isNull);
      expect(status.apiKey, isNull);
      expect(status.toJson(includeKey: true)['baseUrl'], isNull);
      expect(status.toJson(includeKey: true).containsKey('apiKey'), isFalse);
    });
  }

  test('直接建立的錯誤狀態即使帶有 key 也不會序列化 endpoint 或 key', () {
    const status = TtsStatus(
      phase: 'error',
      running: false,
      baseUrl: 'http://127.0.0.1:9100/v1',
      apiKey: 'fixture-key',
      error: '模型載入失敗',
    );

    expect(status.toJson(includeKey: true)['baseUrl'], isNull);
    expect(status.toJson(includeKey: true).containsKey('apiKey'), isFalse);
  });
}
