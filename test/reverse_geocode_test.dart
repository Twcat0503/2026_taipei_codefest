import 'dart:convert';

import 'package:flutter/services.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:town_pass/util/web_message_handler/tp_web_message_handler.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const channel = MethodChannel('town_pass/geocoding');
  var calls = 0;
  setUp(() {
    calls = 0;
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (call) async {
          calls++;
          expect(call.method, 'reverse');
          return '臺北市大安區和平東路100號';
        });
  });
  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, null);
  });

  test('only trusted main frames receive a correlated address', () async {
    final handler = ReverseGeocodeMessageHandler();
    Future<Map> invoke(String origin, bool main, Map data) async {
      Map? reply;
      await handler.handle(
        message: data,
        sourceOrigin: WebUri(origin),
        isMainFrame: main,
        onReply: (message) => reply = jsonDecode(message.data)['data'] as Map,
      );
      return reply!;
    }

    final data = {'requestId': 'test-id', 'latitude': 25.03, 'longitude': 121.54};
    final allowed = await invoke('http://127.0.0.1:5173', true, data);
    expect(allowed['requestId'], 'test-id');
    expect(allowed['address'], '臺北市大安區和平東路100號');
    expect(calls, 1);
    expect((await invoke('https://example.com', true, data))['error'], 'origin_not_allowed');
    expect((await invoke('http://127.0.0.1:5173', false, data))['error'], 'origin_not_allowed');
    expect((await invoke('http://127.0.0.1:5173', true, {'latitude': 91, 'longitude': 0}))['error'], 'invalid_coordinates');
    expect(calls, 1);
  });
}
