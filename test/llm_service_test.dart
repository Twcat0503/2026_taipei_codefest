import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:town_pass/service/llm_service.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  const channel = MethodChannel('town_pass/llm');
  final messenger =
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;

  tearDown(() => messenger.setMockMethodCallHandler(channel, null));

  test('start 會把 threads 與 contextSize 傳給原生端，並解析回傳狀態', () async {
    MethodCall? seen;
    messenger.setMockMethodCallHandler(channel, (call) async {
      seen = call;
      return {
        'phase': 'running',
        'running': true,
        'baseUrl': 'http://127.0.0.1:9000/v1',
        'apiKey': 'k1',
        'model': 'lfm3-1.7b-q4_0',
        'error': null,
        'threads': 3,
        'contextSize': 2048,
        'kvCacheType': 'q8_0',
        'flashAttention': true,
      };
    });

    final status = await LlmService.start(threads: 3, contextSize: 2048);

    expect(seen!.method, 'start');
    expect(seen!.arguments, {
      'threads': 3,
      'contextSize': 2048,
      'kvCacheType': 'q8_0',
      'flashAttention': true,
    });
    expect(status.running, isTrue);
    expect(status.baseUrl, 'http://127.0.0.1:9000/v1');
    expect(status.apiKey, 'k1');
    expect(status.threads, 3);
    expect(status.contextSize, 2048);
    expect(status.kvCacheType, 'q8_0');
    expect(status.flashAttention, isTrue);
  });

  test('預設 start 不傳 threads（交給原生端自動決定），KV 為 q8_0、flash attention 開啟', () async {
    MethodCall? seen;
    messenger.setMockMethodCallHandler(channel, (call) async {
      seen = call;
      return {'phase': 'running', 'running': true};
    });

    await LlmService.start();

    expect(seen!.arguments, {
      'contextSize': 4096,
      'kvCacheType': 'q8_0',
      'flashAttention': true,
    });
  });

  test('可以指定 f16 KV 與關閉 flash attention', () async {
    MethodCall? seen;
    messenger.setMockMethodCallHandler(channel, (call) async {
      seen = call;
      return {'phase': 'running', 'running': true};
    });

    await LlmService.start(kvCacheType: 'f16', flashAttention: false);

    expect(seen!.arguments, {
      'contextSize': 4096,
      'kvCacheType': 'f16',
      'flashAttention': false,
    });
  });

  test('原生端錯誤會變成 error 狀態，而不是拋出例外', () async {
    messenger.setMockMethodCallHandler(channel, (call) async {
      throw PlatformException(
        code: 'llm_error',
        message: '缺少 libllama_server.so',
      );
    });

    final status = await LlmService.start();

    expect(status.running, isFalse);
    expect(status.phase, 'error');
    expect(status.error, '缺少 libllama_server.so');
  });

  test('沒有原生實作的平台回傳「只支援 Android」的錯誤狀態', () async {
    final status = await LlmService.status();

    expect(status.running, isFalse);
    expect(status.error, contains('Android'));
  });

  test('status 的 toJson 預設不含 apiKey', () {
    const status = LlmStatus(
      phase: 'running',
      running: true,
      baseUrl: 'http://127.0.0.1:9000/v1',
      apiKey: 'secret',
    );

    expect(status.toJson().containsKey('apiKey'), isFalse);
    expect(status.toJson(includeKey: true)['apiKey'], 'secret');
  });

  test('只允許開發環境的網頁來源', () {
    expect(isLlmOriginAllowed('http://10.0.2.2:5173'), isTrue);
    expect(isLlmOriginAllowed('http://localhost:5173'), isTrue);
    expect(isLlmOriginAllowed('https://evil.example'), isFalse);
    expect(isLlmOriginAllowed(null), isFalse);
  });
}
