import 'dart:convert';

import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:get/get.dart';
import 'package:town_pass/bean/account.dart';
import 'package:town_pass/service/account_service.dart';
import 'package:town_pass/util/web_message_handler/tp_web_message_handler.dart';
import 'package:town_pass/util/web_message_handler/userinfo_access.dart';

// 測試用的虛構會員資料。
const _account = Account(
  id: 'fictional-id',
  account: 'fictional-account',
  username: 'tester',
  realName: '測試者',
  idNumber: 'A123456789',
  email: 'tester@example.com',
  phoneNumber: '0900000000',
  birthday: '1990/01/01',
  memberType: 'personal',
  verifyLevel: '3',
  addressList: [
    Address(
      zip3: 104,
      city: '臺北市',
      town: '中山區',
      village: '測試里',
      street: '測試路',
      usageType: '0',
      seq: 1,
      priority: true,
    ),
  ],
  residentAddress: '臺北市中山區測試路 1 號',
  citizen: true,
  nativePeople: false,
  cityInternetUid: 'fictional-uid',
);

void main() {
  setUp(() => Get.put(AccountService()..updateAccount(_account)));
  tearDown(Get.reset);

  Future<Object?> request(String? origin, {bool isMainFrame = true}) async {
    Map? reply;
    await UserinfoWebMessageHandler().handle(
      message: null,
      sourceOrigin: origin == null ? null : WebUri(origin),
      isMainFrame: isMainFrame,
      onReply: (message) => reply = jsonDecode(message.data),
    );
    expect(reply!['name'], 'userinfo');
    return reply!['data'];
  }

  test('白名單來源的主 frame 取得會員資料，且只含需要的欄位', () async {
    for (final origin in [
      'http://localhost:5173',
      'https://taipei-pass-service.vercel.app',
    ]) {
      final data = await request('$origin/some/page?x=1') as Map;
      expect(data['idNo'], 'A123456789');
      expect(data['realName'], '測試者');
      expect(data.keys, isNot(contains('id')));
      expect(data.keys, isNot(contains('account')));
      expect(data.keys, isNot(contains('nativePeople')));
      expect(data.keys, isNot(contains('cityInternetUid')));
      final address = (data['addresses'] as List).single as Map;
      expect(address['town'], '中山區');
      expect(address['priority'], isTrue);
      expect(address.keys, isNot(contains('seq')));
    }
  });

  test('非白名單來源拿不到會員資料', () async {
    for (final origin in [
      'https://evil.example.com',
      'https://dashboard.gov.taipei',
      'http://taipei-pass-service.vercel.app',
      'https://taipei-pass-service.vercel.app.evil.example',
      'http://localhost:8080',
    ]) {
      expect(await request(origin), isNull, reason: origin);
    }
  });

  test('白名單來源的子 frame 拿不到會員資料', () async {
    expect(await request('http://localhost:5173', isMainFrame: false), isNull);
  });

  test('來源不明時拿不到會員資料', () async {
    expect(await request(null), isNull);
  });

  test('沒有會員資料時回傳 null', () {
    expect(userinfoPayload(null), isNull);
  });
}
