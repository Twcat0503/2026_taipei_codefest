import 'dart:convert';

import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:get/get.dart';
import 'package:town_pass/util/web_message_handler/tp_web_message_handler.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  // 沒有 GetMaterialApp；只驗證回覆，不驗證開頁。
  setUp(() => Get.testMode = true);
  tearDown(() => Get.testMode = false);

  Future<Object?> open(Object? message) async {
    Object? data;
    await OpenLinkMessageHandler().handle(
      message: message,
      sourceOrigin: WebUri('http://localhost:5173'),
      isMainFrame: true,
      onReply: (reply) => data = (jsonDecode(reply.data) as Map)['data'],
    );
    return data;
  }

  test('帶入資料時先回覆通過白名單的欄位，助手才知道哪些要請民眾自填', () async {
    expect(
      await open({
        'url': 'https://taipei-pass-service.vercel.app/fee-payment/',
        'prefill': {
          'water_number': '1234567890',
          'unknown': 'x',
          'tax_id': '<>',
        },
      }),
      {
        'accepted': ['water_number'],
      },
    );
  });

  test('沒有可帶入的欄位時回覆空清單', () async {
    expect(
      await open({
        'url': 'https://taipei-pass-service.vercel.app/fee-payment/',
        'prefill': {'unknown': 'x'},
      }),
      {'accepted': <String>[]},
    );
  });

  test('格式不對時回覆 false', () async {
    expect(await open(42), false);
  });
}
