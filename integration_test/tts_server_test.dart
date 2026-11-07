import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';

const _channel = MethodChannel('town_pass/tts');
const _modelsInstalled = bool.fromEnvironment('TTS_MODELS_INSTALLED');
const _model = 'bluemagpie-q8_0';

/// 真實 Android 通道與本機子行程測試，不以 mock 取代模型推論。
///
/// 預設驗證未安裝模型的失敗路徑；已安裝並核對模型後才加上
/// `--dart-define=TTS_MODELS_INSTALLED=true` 執行完整語音測試。
void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('未安裝模型或原生執行檔時回報穩定錯誤', (tester) async {
    await _invoke('stop');
    final started = await _invoke('start');
    _expectStopped(started, phase: 'error');
    expect(started['error'], isIn(['TTS_MODEL_MISSING', 'TTS_BINARY_MISSING']));
    final status = await _invoke('status');
    _expectStopped(status, phase: 'error');
    expect(status['error'], started['error']);
    _expectStopped(await _invoke('stop'));
  }, skip: _modelsInstalled);

  testWidgets('僅接受範圍內的整數 threads，不接受模型或路徑參數', (tester) async {
    await _invoke('stop');
    for (final arguments in <Object>[
      {'threads': 0},
      {'threads': 17},
      {'threads': -1},
      {'threads': 1.5},
      {'threads': '4'},
      {'threads': true},
      {'model': 'other'},
      {'url': 'https://invalid.example/model.gguf'},
      {'path': '/not-a-model'},
      'invalid',
    ]) {
      final rejected = await _invoke('start', arguments);
      _expectStopped(rejected, phase: 'error');
      expect(rejected['error'], 'TTS_INVALID_CONFIG');
    }
    _expectStopped(await _invoke('stop'));
  });

  testWidgets(
    '啟動、驗證授權與請求、UTF-8 WAV/PCM、停止及重啟金鑰輪替',
    (tester) async {
      await _invoke('stop');
      addTearDown(() => _invoke('stop'));
      final client = HttpClient();
      addTearDown(() => client.close(force: true));

      final started = await _invoke('start', {'threads': 2});
      _expectRunning(started, withKey: true);
      expect(started['threads'], 2);
      final baseUrl = started['baseUrl']! as String;
      final apiKey = started['apiKey']! as String;
      final status = await _invoke('status');
      _expectRunning(status);
      expect(status['baseUrl'], baseUrl);
      expect(status['threads'], 2);

      // 超過 cached worker 的 60 秒回收時間；建立 child 的執行緒必須仍存活。
      await Future<void>.delayed(const Duration(seconds: 65));
      final afterIdle = await _invoke('status')
          .timeout(const Duration(seconds: 2));
      _expectRunning(afterIdle);
      expect(afterIdle['baseUrl'], baseUrl);

      final unauthorized = await _send(client, 'GET', '$baseUrl/models');
      expect(unauthorized.status, 401);
      final models = await _send(
        client,
        'GET',
        '$baseUrl/models',
        apiKey: apiKey,
      );
      expect(models.status, 200);
      expect(jsonDecode(utf8.decode(models.bytes))['data'][0]['id'], _model);

      final request = <String, Object?>{
        'model': _model,
        'input': '你好，台北。',
        'voice': 'default',
        'response_format': 'wav',
      };
      final unauthorizedSpeech = await _send(
        client,
        'POST',
        '$baseUrl/audio/speech',
        body: request,
      );
      expect(unauthorizedSpeech.status, 401);
      for (final invalid in <Map<String, Object?>>[
        {...request, 'model': 'other'},
        {...request, 'voice': 'other'},
        {...request, 'response_format': 'mp3'},
        {...request, 'reference_audio': 'not-supported'},
        {...request, 'input': ' \t\r\n　'},
      ]) {
        final rejected = await _send(
          client,
          'POST',
          '$baseUrl/audio/speech',
          apiKey: apiKey,
          body: invalid,
        );
        expect(rejected.status, 400);
        expect(utf8.decode(rejected.bytes).contains(apiKey), isFalse);
      }

      final wav = await _send(
        client,
        'POST',
        '$baseUrl/audio/speech',
        apiKey: apiKey,
        body: request,
      );
      expect(wav.status, 200);
      _expectWav(wav.bytes);
      final pcm = await _send(
        client,
        'POST',
        '$baseUrl/audio/speech',
        apiKey: apiKey,
        body: {...request, 'response_format': 'pcm'},
      );
      expect(pcm.status, 200);
      expect(pcm.bytes.length, greaterThan(0));
      expect(pcm.bytes.length.isEven, isTrue);
      expect(pcm.bytes.any((sample) => sample != 0), isTrue);

      final again = await _invoke('start');
      _expectRunning(again, withKey: true);
      expect(again['baseUrl'], baseUrl);
      expect(again['apiKey'] == apiKey, isTrue);
      _expectStopped(await _invoke('stop'));
      expect(await _isPortOpen(baseUrl), isFalse);

      final restarted = await _invoke('start');
      _expectRunning(restarted, withKey: true);
      expect(restarted['apiKey'] != apiKey, isTrue);
      expect(restarted['threads'], inInclusiveRange(1, 4));
      final oldKey = await _send(
        client,
        'GET',
        '${restarted['baseUrl']}/models',
        apiKey: apiKey,
      );
      expect(oldKey.status, 401);
      _expectStopped(await _invoke('stop'));
      expect(await _isPortOpen(restarted['baseUrl']! as String), isFalse);
    },
    skip: !_modelsInstalled,
    timeout: const Timeout(Duration(minutes: 20)),
  );

  testWidgets(
    '冷啟動時 status 不阻塞，stop 取消 hash 或模型載入且不洩漏金鑰',
    (tester) async {
      await _invoke('stop');
      addTearDown(() => _invoke('stop'));
      final pending = _invoke('start');
      final clock = Stopwatch()..start();
      Map<String, Object?> status;
      do {
        status = await _invoke('status').timeout(const Duration(seconds: 2));
        if (status['phase'] == 'starting') break;
        expect(status['phase'], 'idle');
        await Future<void>.delayed(const Duration(milliseconds: 10));
      } while (clock.elapsed < const Duration(seconds: 5));
      expect(status['phase'], 'starting');
      expect(status.containsKey('apiKey'), isFalse);
      expect(status['baseUrl'], isNull);
      final stopped = await _invoke('stop')
          .timeout(const Duration(seconds: 10));
      _expectStopped(stopped);
      _expectStopped(await pending.timeout(const Duration(seconds: 10)));
      _expectStopped(await _invoke('status'));
    },
    skip: !_modelsInstalled,
    timeout: const Timeout(Duration(minutes: 2)),
  );

  testWidgets(
    'stop 接受後立即 start，舊 cleanup 不取消或終止新 generation',
    (tester) async {
      await _invoke('stop');
      addTearDown(() => _invoke('stop'));
      final first = _invoke('start');
      final clock = Stopwatch()..start();
      while ((await _invoke('status'))['phase'] != 'starting') {
        expect(clock.elapsed < const Duration(seconds: 5), isTrue);
        await Future<void>.delayed(const Duration(milliseconds: 10));
      }
      // MethodChannel 保證發送順序；刻意不等待 stop 完成就接受下一個 start。
      final stopping = _invoke('stop');
      final replacement = _invoke('start', {'threads': 2});
      _expectStopped(await stopping.timeout(const Duration(seconds: 10)));
      final cancelled = await first.timeout(const Duration(seconds: 10));
      expect(cancelled.containsKey('apiKey'), isFalse);
      final running = await replacement.timeout(const Duration(minutes: 5));
      _expectRunning(running, withKey: true);
      final current = await _invoke('status');
      _expectRunning(current);
      expect(current['baseUrl'], running['baseUrl']);

      // 再覆蓋已有 child 的 stop/start 交錯，而不只是 hash 取消。
      final oldKey = running['apiKey']! as String;
      final stoppingChild = _invoke('stop');
      final next = _invoke('start', {'threads': 2});
      _expectStopped(await stoppingChild.timeout(const Duration(seconds: 10)));
      final restarted = await next.timeout(const Duration(minutes: 5));
      _expectRunning(restarted, withKey: true);
      expect(restarted['apiKey'] != oldKey, isTrue);
      _expectRunning(await _invoke('status'));
      final client = HttpClient();
      addTearDown(() => client.close(force: true));
      final models = await _send(
        client,
        'GET',
        '${restarted['baseUrl']}/models',
        apiKey: restarted['apiKey']! as String,
      );
      expect(models.status, 200);
    },
    skip: !_modelsInstalled,
    timeout: const Timeout(Duration(minutes: 12)),
  );
}

Future<Map<String, Object?>> _invoke(String method, [Object? arguments]) async {
  final result = await _channel.invokeMapMethod<String, Object?>(
    method,
    arguments,
  );
  expect(result, isNotNull);
  return result!;
}

void _expectStopped(Map<String, Object?> status, {String phase = 'idle'}) {
  expect(status['phase'], phase);
  expect(status['running'], isFalse);
  expect(status['baseUrl'], isNull);
  expect(status['model'], isNull);
  expect(status['threads'], isNull);
  expect(status.containsKey('apiKey'), isFalse);
  if (phase == 'idle') expect(status['error'], isNull);
}

void _expectRunning(Map<String, Object?> status, {bool withKey = false}) {
  // 先顯示穩定錯誤碼，避免啟動失敗只留下 phase 不符而無法定位；不輸出整份 status。
  expect(status['error'], isNull);
  expect(status['phase'], 'running');
  expect(status['running'], isTrue);
  expect(status['model'], _model);
  expect(status['threads'], inInclusiveRange(1, 16));
  final uri = Uri.parse(status['baseUrl']! as String);
  expect(uri.scheme, 'http');
  expect(uri.host, '127.0.0.1');
  expect(uri.path, '/v1');
  expect(uri.port, inInclusiveRange(1, 65535));
  if (withKey) {
    // 以布林值驗證，避免測試失敗時將真正的金鑰印到測試輸出。
    expect(
      status['apiKey'] is String &&
          RegExp(r'^[0-9a-f]{64}$').hasMatch(status['apiKey']! as String),
      isTrue,
    );
  } else {
    expect(status.containsKey('apiKey'), isFalse);
  }
}

void _expectWav(Uint8List bytes) {
  expect(bytes.length, greaterThanOrEqualTo(44));
  expect(ascii.decode(bytes.sublist(0, 4)), 'RIFF');
  expect(ascii.decode(bytes.sublist(8, 12)), 'WAVE');
  final view = ByteData.sublistView(bytes);
  expect(view.getUint32(4, Endian.little) + 8, bytes.length);
  var offset = 12;
  var foundFormat = false;
  var foundData = false;
  while (offset + 8 <= bytes.length) {
    final length = view.getUint32(offset + 4, Endian.little);
    final end = offset + 8 + length;
    expect(end, lessThanOrEqualTo(bytes.length));
    final chunk = ascii.decode(bytes.sublist(offset, offset + 4));
    if (chunk == 'fmt ') {
      expect(length, greaterThanOrEqualTo(16));
      expect(view.getUint16(offset + 8, Endian.little), 1);
      expect(view.getUint16(offset + 10, Endian.little), 1);
      expect(view.getUint32(offset + 12, Endian.little), 48000);
      expect(view.getUint16(offset + 22, Endian.little), 16);
      foundFormat = true;
    }
    if (chunk == 'data') {
      expect(length, greaterThan(0));
      expect(
        bytes.sublist(offset + 8, end).any((sample) => sample != 0),
        isTrue,
      );
      foundData = true;
      break;
    }
    offset = end + (length % 2);
  }
  expect(foundFormat, isTrue);
  expect(foundData, isTrue);
}

class _Response {
  _Response(this.status, this.bytes);
  final int status;
  final Uint8List bytes;
}

Future<_Response> _send(
  HttpClient client,
  String method,
  String url, {
  String? apiKey,
  Map<String, Object?>? body,
}) async {
  final request = await client.openUrl(method, Uri.parse(url));
  request.headers.contentType = ContentType.json;
  if (apiKey != null) {
    request.headers.set(HttpHeaders.authorizationHeader, 'Bearer $apiKey');
  }
  if (body != null) request.add(utf8.encode(jsonEncode(body)));
  final response = await request.close().timeout(const Duration(minutes: 5));
  final bytes = await response
      .fold<BytesBuilder>(BytesBuilder(copy: false), (builder, chunk) {
        builder.add(chunk);
        return builder;
      })
      .timeout(const Duration(minutes: 5));
  return _Response(response.statusCode, bytes.takeBytes());
}

Future<bool> _isPortOpen(String baseUrl) async {
  final uri = Uri.parse(baseUrl);
  try {
    final socket = await Socket.connect(
      uri.host,
      uri.port,
      timeout: const Duration(seconds: 2),
    );
    socket.destroy();
    return true;
  } on SocketException {
    return false;
  }
}
