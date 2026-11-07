import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:town_pass/service/asr_service.dart';
import 'package:town_pass/util/web_message_handler/local_ai_origin.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  const channel = MethodChannel('town_pass/asr');
  final messenger =
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;

  tearDown(() => messenger.setMockMethodCallHandler(channel, null));

  test('start 會把 threads 傳給原生端，並解析回傳的 baseUrl 與 apiKey', () async {
    MethodCall? seen;
    messenger.setMockMethodCallHandler(channel, (call) async {
      seen = call;
      return {
        'phase': 'running',
        'running': true,
        'baseUrl': 'http://127.0.0.1:9100/v1',
        'apiKey': 'k2',
        'model': 'taiwan-tongues-asr-ce-v1.0-q4_0',
        'error': null,
        'threads': 4,
      };
    });

    final status = await AsrService.start(threads: 4);

    expect(seen!.method, 'start');
    expect(seen!.arguments, {'threads': 4});
    expect(status.running, isTrue);
    expect(status.baseUrl, 'http://127.0.0.1:9100/v1');
    expect(status.apiKey, 'k2');
    expect(status.model, 'taiwan-tongues-asr-ce-v1.0-q4_0');
    expect(status.threads, 4);
  });

  test('預設 start 不傳 threads，交給原生端依大核數決定', () async {
    MethodCall? seen;
    messenger.setMockMethodCallHandler(channel, (call) async {
      seen = call;
      return {'phase': 'running', 'running': true};
    });

    await AsrService.start();

    expect(seen!.arguments, isEmpty);
  });

  test('原生端錯誤（例如模型不存在）會變成 error 狀態，而不是拋出例外', () async {
    messenger.setMockMethodCallHandler(channel, (call) async {
      throw PlatformException(code: 'asr_error', message: '缺少 ASR 模型');
    });

    final status = await AsrService.start();

    expect(status.running, isFalse);
    expect(status.phase, 'error');
    expect(status.error, '缺少 ASR 模型');
  });

  test('stop 回傳未執行狀態', () async {
    messenger.setMockMethodCallHandler(
      channel,
      (call) async => {'phase': 'idle', 'running': false},
    );

    final status = await AsrService.stop();

    expect(status.running, isFalse);
    expect(status.phase, 'idle');
  });

  test('沒有原生實作的平台回傳「只支援 Android」的錯誤狀態', () async {
    final status = await AsrService.status();

    expect(status.running, isFalse);
    expect(status.error, contains('Android'));
  });

  test('status 的 toJson 預設不含 apiKey', () {
    const status = AsrStatus(
      phase: 'running',
      running: true,
      baseUrl: 'http://127.0.0.1:9100/v1',
      apiKey: 'secret',
    );

    expect(status.toJson().containsKey('apiKey'), isFalse);
    expect(status.toJson(includeKey: true)['apiKey'], 'secret');
  });

  test('ASR 與 LLM 共用同一份網頁來源白名單', () {
    expect(isLocalAiOriginAllowed('http://10.0.2.2:5173'), isTrue);
    expect(isLocalAiOriginAllowed('https://evil.example'), isFalse);
  });
}
