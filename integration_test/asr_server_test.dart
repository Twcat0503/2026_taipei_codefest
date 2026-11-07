import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:town_pass/service/asr_service.dart';

/// 端到端測試：Dart → MethodChannel → Kotlin → libwhisper_server.so（unix socket）→ 代理 → OpenAI 格式 API。
///
/// 需要 Android 模擬器或實機，並事先完成（步驟見 tools/asr-android/README.md）：
///   1. 執行 tools/asr-android/build_whisper_server.sh，產生 libwhisper_server.so
///   2. 把 int4 模型放到 App 私有目錄 files/asr/models/
///   3. 把測試音檔放到 files/asr-test/clip.wav（warm-up 範例，普通話，轉寫結果應含「硬碟」與「931」）
///   `fvm flutter test integration_test/asr_server_test.dart -d <device-id> --no-uninstall`
void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  tearDown(() async {
    await AsrService.stop();
  });

  testWidgets('啟動 → OpenAI 格式轉寫 → 停止', (tester) async {
    final clip = File(_clipPath);
    expect(clip.existsSync(), isTrue, reason: '缺少測試音檔：$_clipPath（見 README）');

    final started = await AsrService.start(threads: 2);
    expect(started.error, isNull, reason: started.error);
    expect(started.running, isTrue);
    expect(started.threads, 2);
    final baseUrl = started.baseUrl!;
    final apiKey = started.apiKey!;
    final model = started.model!;
    expect(baseUrl, startsWith('http://127.0.0.1:'));

    final client = HttpClient();
    addTearDown(() => client.close(force: true));

    // 沒有 API key 必須被拒絕
    final unauthorized = await _send(client, 'GET', '$baseUrl/models');
    expect(unauthorized.status, 401);

    // 模型列表
    final models = await _send(
      client,
      'GET',
      '$baseUrl/models',
      apiKey: apiKey,
    );
    expect(models.status, 200);
    expect(models.body, contains(model));

    // 未知路由回 404；非 multipart 的轉寫請求回 400
    final notFound = await _send(
      client,
      'GET',
      '$baseUrl/chat/completions',
      apiKey: apiKey,
    );
    expect(notFound.status, 404);
    final wrongType = await _send(
      client,
      'POST',
      '$baseUrl/audio/transcriptions',
      apiKey: apiKey,
      body: {'a': 1},
    );
    expect(wrongType.status, 400);

    // CORS 預檢：瀏覽器跨來源呼叫前會送 OPTIONS，不帶 API key，回 204 與允許的標頭
    final preflight = await client.openUrl(
      'OPTIONS',
      Uri.parse('$baseUrl/audio/transcriptions'),
    );
    preflight.headers.set('Origin', 'http://localhost:5173');
    preflight.headers.set('Access-Control-Request-Method', 'POST');
    preflight.headers.set(
      'Access-Control-Request-Headers',
      'authorization,content-type',
    );
    final preflightResponse = await preflight.close();
    await preflightResponse.drain<void>();
    expect(preflightResponse.statusCode, 204);
    expect(preflightResponse.headers.value('access-control-allow-origin'), '*');
    expect(
      preflightResponse.headers.value('access-control-allow-headers'),
      contains('Authorization'),
    );

    // 轉寫：multipart/form-data，欄位與 OpenAI 相同，並指定語言
    final transcript = await _postAudio(
      client,
      '$baseUrl/audio/transcriptions',
      apiKey: apiKey,
      fields: {'model': model, 'language': 'zh', 'response_format': 'json'},
      file: clip.readAsBytesSync(),
    );
    expect(transcript.status, 200, reason: transcript.body);
    final text =
        (jsonDecode(transcript.body) as Map<String, dynamic>)['text'] as String;
    debugPrint('asr transcript: $text');
    expect(text, contains('硬碟'));
    expect(text, contains('931'));

    // 不在模型語言清單內的代碼要被拒絕（whisper.cpp 會默默誤判，例如 yue）
    final badLanguage = await _postAudio(
      client,
      '$baseUrl/audio/transcriptions',
      apiKey: apiKey,
      fields: {'model': model, 'language': 'yue'},
      file: clip.readAsBytesSync(),
    );
    expect(badLanguage.status, 400, reason: badLanguage.body);
    expect(badLanguage.body, contains('yue'));

    // 重複 start 應回傳同一個服務
    final again = await AsrService.start();
    expect(again.baseUrl, baseUrl);

    final stopped = await AsrService.stop();
    expect(stopped.running, isFalse);
    expect(await _isPortOpen(baseUrl), isFalse);
  }, timeout: const Timeout(Duration(minutes: 20)));

  testWidgets('子行程異常結束後重啟會關閉舊代理', (tester) async {
    final first = await AsrService.start(threads: 2);
    expect(first.running, isTrue, reason: first.error);
    final oldUrl = first.baseUrl!;
    await _terminateAsrChild();

    // /proc 已看到結束時，Java 的 process reaper 仍可能尚未更新 exitValue。
    // 等 start 不再沿用舊服務，再驗證新服務沒有留下舊代理。
    final deadline = DateTime.now().add(const Duration(seconds: 10));
    var restarted = await AsrService.start(threads: 2);
    while (restarted.running &&
        restarted.apiKey == first.apiKey &&
        DateTime.now().isBefore(deadline)) {
      await Future<void>.delayed(const Duration(milliseconds: 50));
      restarted = await AsrService.start(threads: 2);
    }
    expect(restarted.running, isTrue, reason: restarted.error);
    expect(restarted.apiKey != first.apiKey, isTrue, reason: '重新啟動應換發 API key');

    final client = HttpClient();
    addTearDown(() => client.close(force: true));
    if (restarted.baseUrl == oldUrl) {
      // OS 可以重用 port，但不能繼續接受前一次服務的 key。
      final staleKey = await _send(
        client,
        'GET',
        '$oldUrl/models',
        apiKey: first.apiKey,
      );
      expect(staleKey.status, 401);
    } else {
      expect(await _isPortOpen(oldUrl), isFalse, reason: '重啟不能留下舊代理');
    }
    final models = await _send(
      client,
      'GET',
      '${restarted.baseUrl}/models',
      apiKey: restarted.apiKey,
    );
    expect(models.status, 200);
    await AsrService.stop();
    expect(await _isPortOpen(oldUrl), isFalse);
    expect(await _isPortOpen(restarted.baseUrl!), isFalse);
  }, timeout: const Timeout(Duration(minutes: 5)));

  testWidgets('未驗證閒置連線有數量上限且釋放後能繼續服務', (tester) async {
    final started = await AsrService.start(threads: 2);
    expect(started.running, isTrue, reason: started.error);
    final uri = Uri.parse(started.baseUrl!);
    final sockets = <Socket>[];
    final closed = <Future<void>>[];
    var refusedExtraConnection = false;
    try {
      // 僅開 12 條本機連線，確認有界容量；不做資源耗盡壓力測試。
      for (var i = 0; i < 12; i++) {
        final socket = await Socket.connect(uri.host, uri.port);
        sockets.add(socket);
        final done = Completer<void>();
        void complete() {
          if (!done.isCompleted) done.complete();
        }

        socket.listen(
          (_) {},
          onDone: complete,
          onError: (Object _) => complete(),
        );
        closed.add(done.future);
      }
      try {
        await Future.any(closed).timeout(const Duration(seconds: 2));
        refusedExtraConnection = true;
      } on TimeoutException {
        // 無界佇列會一直保留全部連線，而不是拒絕超量請求。
      }
    } finally {
      for (final socket in sockets) {
        socket.destroy();
      }
    }
    expect(refusedExtraConnection, isTrue, reason: '代理不能無限累積未驗證連線');
    final client = HttpClient();
    addTearDown(() => client.close(force: true));
    // 釋放後應很快恢復服務；關閉端的排程可能比 destroy() 慢幾毫秒，所以在期限內重試。
    final recovered = await _waitForModels(
      client,
      started.baseUrl!,
      started.apiKey!,
    );
    expect(recovered, isTrue, reason: '釋放閒置連線後代理應能再次服務');
  }, timeout: const Timeout(Duration(minutes: 5)));

  testWidgets('畸形 HTTP 標頭會回傳錯誤且不終止 App', (tester) async {
    final started = await AsrService.start(threads: 2);
    expect(started.running, isTrue, reason: started.error);
    final oversized = await _rawRequest(
      started.baseUrl!,
      'GET /v1/models HTTP/1.1\r\nX-Large: ${'x' * (16 * 1024)}',
    );
    expect(oversized, startsWith('HTTP/1.1 431 '));
    final incomplete = await _rawRequest(
      started.baseUrl!,
      'GET /v1/models HTTP/1.1\r\nHost: localhost\r\n',
    );
    expect(incomplete, startsWith('HTTP/1.1 400 '));
    final client = HttpClient();
    addTearDown(() => client.close(force: true));
    final models = await _send(
      client,
      'GET',
      '${started.baseUrl}/models',
      apiKey: started.apiKey,
    );
    expect(models.status, 200);
  }, timeout: const Timeout(Duration(minutes: 5)));
}

/// 在 5 秒內重試 GET /v1/models，直到回傳 200；期限內仍失敗則回傳 false。
Future<bool> _waitForModels(
  HttpClient client,
  String baseUrl,
  String apiKey,
) async {
  final deadline = DateTime.now().add(const Duration(seconds: 5));
  while (DateTime.now().isBefore(deadline)) {
    try {
      final response = await _send(
        client,
        'GET',
        '$baseUrl/models',
        apiKey: apiKey,
      );
      if (response.status == 200) return true;
    } on SocketException {
      // 代理仍在處理已釋放的連線時，新連線可能被直接關閉，稍後再試。
    } on HttpException {
      // 連線在回覆標頭前被關閉，同樣稍後再試。
    }
    await Future<void>.delayed(const Duration(milliseconds: 100));
  }
  return false;
}

Future<String> _rawRequest(String baseUrl, String request) async {
  final uri = Uri.parse(baseUrl);
  final socket = await Socket.connect(uri.host, uri.port);
  try {
    final response = socket.cast<List<int>>().transform(utf8.decoder).join();
    socket.add(utf8.encode(request));
    await socket.flush();
    await socket.close(); // 半關閉傳送方向，仍接收代理的錯誤回覆。
    return await response.timeout(const Duration(seconds: 5));
  } finally {
    socket.destroy();
  }
}

Future<void> _terminateAsrChild() async {
  // 不依賴 Android 版本可能無法寫出的 PID 檔；只找目前測試 App 的直接子行程。
  final processes = await Process.run('/system/bin/ps', [
    '-A',
    '-o',
    'PID,PPID,NAME',
  ]);
  expect(processes.exitCode, 0, reason: '${processes.stderr}');
  final children = const LineSplitter()
      .convert(processes.stdout as String)
      .map((line) => line.trim().split(RegExp(r'\s+')))
      .where(
        (fields) =>
            fields.length == 3 &&
            fields[1] == '$pid' &&
            fields[2] == 'libwhisper_server.so',
      )
      .toList();
  expect(children, hasLength(1), reason: '只能終止目前測試 App 的唯一 ASR 子行程');
  final childPid = int.parse(children.single[0]);
  expect(childPid, greaterThan(1));
  final command = File('/proc/$childPid/cmdline');
  expect(command.readAsStringSync(), contains('libwhisper_server.so'));
  final killed = await Process.run('/system/bin/kill', ['-9', '$childPid']);
  expect(killed.exitCode, 0, reason: '${killed.stderr}');
  final deadline = DateTime.now().add(const Duration(seconds: 5));
  while (DateTime.now().isBefore(deadline)) {
    try {
      if (command.readAsBytesSync().isEmpty) return;
    } on FileSystemException {
      return;
    }
    await Future<void>.delayed(const Duration(milliseconds: 50));
  }
  fail('ASR 子行程未在期限內結束');
}

/// App 私有目錄（applicationId com.example.townpass）內的測試音檔。
const String _clipPath =
    '/data/user/0/com.example.townpass/files/asr-test/clip.wav';

class _Response {
  _Response(this.status, this.body);
  final int status;
  final String body;
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
  if (body != null) {
    // 明確設定 Content-Length；否則 Dart 會改用 chunked，代理會以 411 拒絕。
    final bytes = utf8.encode(jsonEncode(body));
    request.contentLength = bytes.length;
    request.add(bytes);
  }
  final response = await request.close();
  final text = await response.transform(utf8.decoder).join();
  return _Response(response.statusCode, text);
}

Future<_Response> _postAudio(
  HttpClient client,
  String url, {
  required String apiKey,
  required Map<String, String> fields,
  required List<int> file,
}) async {
  final boundary = 'asr-test-${DateTime.now().microsecondsSinceEpoch}';
  final body = BytesBuilder();
  void line(String s) => body.add(utf8.encode('$s\r\n'));
  fields.forEach((name, value) {
    line('--$boundary');
    line('Content-Disposition: form-data; name="$name"');
    line('');
    line(value);
  });
  line('--$boundary');
  line('Content-Disposition: form-data; name="file"; filename="clip.wav"');
  line('Content-Type: audio/wav');
  line('');
  body.add(file);
  line('');
  line('--$boundary--');
  final bytes = body.takeBytes();

  final request = await client.openUrl('POST', Uri.parse(url));
  request.headers.set(HttpHeaders.authorizationHeader, 'Bearer $apiKey');
  request.headers.set(
    HttpHeaders.contentTypeHeader,
    'multipart/form-data; boundary=$boundary',
  );
  request.contentLength = bytes.length;
  request.add(bytes);
  final response = await request.close();
  final text = await response.transform(utf8.decoder).join();
  return _Response(response.statusCode, text);
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
