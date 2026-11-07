import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:town_pass/service/llm_service.dart';

/// 端到端測試：Dart → MethodChannel → Kotlin → libllama_server.so → OpenAI 格式 API。
///
/// 需要 Android 模擬器或實機，且已執行 tools/llm-android/build_llama_server.sh。
///   `fvm flutter test integration_test/llm_server_test.dart -d <device-id>`
void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('啟動 → OpenAI 格式 API → 停止', (tester) async {
    final warming = LlmService.start();
    await Future<void>.delayed(const Duration(milliseconds: 500));
    final beforeCancel = await LlmService.status();
    expect([
      'downloading',
      'starting',
      'running',
    ], contains(beforeCancel.phase));
    final cancelled = await LlmService.stop().timeout(
      const Duration(seconds: 15),
    );
    expect(cancelled.phase, 'idle');
    await warming;
    expect((await LlmService.status()).running, isFalse);

    final started = await LlmService.start();
    expect(started.error, isNull, reason: started.error);
    expect(started.running, isTrue);
    // 預設值：q8_0 KV、flash attention 開啟、上下文 4096；執行緒由原生端自動決定
    expect(started.threads, isNotNull);
    expect(started.contextSize, 4096);
    expect(started.kvCacheType, 'q8_0');
    expect(started.flashAttention, isTrue);
    debugPrint(
      'llm round1 settings: threads=${started.threads} ctx=${started.contextSize} '
      'kv=${started.kvCacheType} fa=${started.flashAttention}',
    );
    final baseUrl = started.baseUrl!;
    final apiKey = started.apiKey!;
    final model = started.model!;

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

    // 非串流 chat completions；預設已關閉 thinking，content 應直接有答案
    final chat = await _send(
      client,
      'POST',
      '$baseUrl/chat/completions',
      apiKey: apiKey,
      body: {
        'model': model,
        'messages': [
          {'role': 'user', 'content': '請用一句話介紹台北市。'},
        ],
        'max_tokens': 128,
        'temperature': 0,
      },
    );
    expect(chat.status, 200);
    final choice =
        (jsonDecode(chat.body)['choices'] as List).first
            as Map<String, dynamic>;
    final content =
        (choice['message'] as Map<String, dynamic>)['content'] as String;
    expect(content.trim(), isNotEmpty);

    // Agent requires a structured tool decision, not just non-empty prose.
    final decision = await _send(
      client,
      'POST',
      '$baseUrl/chat/completions',
      apiKey: apiKey,
      body: {
        'model': model,
        'messages': [
          {
            'role': 'system',
            'content': 'Route municipal user requests. Bills or payment status use bills. Books use library. Return only JSON.',
          },
          {'role': 'user', 'content': '我想看到我這期的帳單與繳費狀態'},
        ],
        'response_format': {
          'type': 'json_schema',
          'json_schema': {
            'name': 'route',
            'strict': true,
            'schema': {
              'type': 'object',
              'properties': {
                'domain': {
                  'type': 'string',
                  'enum': ['bills', 'library'],
                },
              },
              'required': ['domain'],
              'additionalProperties': false,
            },
          },
        },
        'temperature': 0,
        'max_tokens': 64,
        'stream': false,
      },
    );
    expect(decision.status, 200);
    final decisionMessage =
        jsonDecode(decision.body)['choices'][0]['message']['content'] as String;
    expect(jsonDecode(decisionMessage)['domain'], 'bills');

    // 重複 start 應回傳同一個服務，不會另外啟動一個
    final again = await LlmService.start();
    expect(again.baseUrl, baseUrl);

    final stopped = await LlmService.stop();
    expect(stopped.running, isFalse);
    expect(await _isPortOpen(baseUrl), isFalse);

    // 第二輪：f16 KV、關閉 flash attention、較短上下文，確認替代參數也能正常服務
    final second = await LlmService.start(
      kvCacheType: 'f16',
      flashAttention: false,
      contextSize: 2048,
    );
    expect(second.error, isNull, reason: second.error);
    expect(second.running, isTrue);
    expect(second.contextSize, 2048);
    expect(second.kvCacheType, 'f16');
    expect(second.flashAttention, isFalse);
    final secondClient = HttpClient();
    addTearDown(() => secondClient.close(force: true));
    final secondChat = await _send(
      secondClient,
      'POST',
      '${second.baseUrl}/chat/completions',
      apiKey: second.apiKey,
      body: {
        'model': second.model,
        'messages': [
          {'role': 'user', 'content': '請用一句話介紹台北市。'},
        ],
        'max_tokens': 64,
        'temperature': 0,
      },
    );
    expect(secondChat.status, 200);
    final secondChoice =
        (jsonDecode(secondChat.body)['choices'] as List).first
            as Map<String, dynamic>;
    final secondMessage = secondChoice['message'] as Map<String, dynamic>;
    expect((secondMessage['content'] as String).trim(), isNotEmpty);
    await LlmService.stop();
  }, timeout: const Timeout(Duration(minutes: 20)));
}

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
  if (body != null) request.write(jsonEncode(body));
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
