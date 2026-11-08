import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter/services.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:get/get.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:town_pass/service/button_guidance_service.dart';
import 'package:town_pass/service/shared_preferences_service.dart';
import 'package:town_pass/util/tp_guided_icon_button.dart';
import 'package:town_pass/util/web_message_handler/tp_web_message_handler.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    await Get.putAsync<SharedPreferencesService>(
      () => SharedPreferencesService().init(),
    );
    Get.put<ButtonGuidanceService>(ButtonGuidanceService().init());
  });
  tearDown(() => Get.reset());
  test(
    'guidance defaults on and preserves an explicit opt-out after reloading',
    () async {
      final service = Get.find<ButtonGuidanceService>();
      expect(service.enabled.value, isTrue);
      await service.update(on: false);
      expect(ButtonGuidanceService().init().enabled.value, isFalse);
      await service.update(on: true);
      expect(ButtonGuidanceService().init().enabled.value, isTrue);
    },
  );
  test(
    'trusted pages share preference; wrong origins and frames cannot change it',
    () async {
      final handler = ButtonGuidanceMessageHandler();
      Map? reply;
      Future<void> call(String origin, bool main, Object data) async =>
          handler.handle(
            message: data,
            sourceOrigin: WebUri(origin),
            isMainFrame: main,
            onReply: (message) {
              reply = jsonDecode(message.data)['data'] as Map;
            },
          );
      await call('https://taipei-pass-service.vercel.app', true, {
        'requestId': 'pref',
        'enabled': true,
        'lang': 'en',
      });
      expect(reply, containsPair('requestId', 'pref'));
      expect(reply, containsPair('enabled', true));
      expect(
        Get.find<SharedPreferencesService>().instance.getBool(
          ButtonGuidanceService.enabledKey,
        ),
        isTrue,
      );
      await call('https://evil.example', true, {'enabled': false});
      expect(reply, containsPair('ok', false));
      await call('https://taipei-pass-service.vercel.app', false, {
        'enabled': false,
      });
      expect(Get.find<ButtonGuidanceService>().enabled.value, isTrue);
    },
  );
  testWidgets(
    'native close explains on the first tap and closes on the second',
    (tester) async {
      final spoken = <String>[];
      var actions = 0;
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: TPGuidedIconButton(
              close: true,
              onPressed: () => actions++,
              speak: (text, _) async {
                spoken.add(text);
              },
            ),
          ),
        ),
      );
      await tester.tap(find.byType(TPGuidedIconButton));
      await tester.pump();
      expect(actions, 0);
      expect(spoken.single, contains('關閉'));
      await tester.tap(find.byType(TPGuidedIconButton));
      await tester.pump();
      expect(actions, 1);
    },
  );
  testWidgets('native screen-reader semantic activation needs no extra tap', (
    tester,
  ) async {
    await Get.find<ButtonGuidanceService>().update(on: true);
    var actions = 0;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: TPGuidedIconButton(
            close: true,
            onPressed: () => actions++,
            speak: (_, _) async {},
          ),
        ),
      ),
    );
    final semantics = tester.ensureSemantics();
    final node = tester.getSemantics(find.byType(TPGuidedIconButton));
    tester.binding.renderViews.first.owner!.semanticsOwner!.performAction(
      node.id,
      SemanticsAction.tap,
    );
    await tester.pump();
    expect(actions, 1);
    semantics.dispose();
  });
  testWidgets(
    'native keyboard activation bypasses the pointer double-tap gate',
    (tester) async {
      await Get.find<ButtonGuidanceService>().update(on: true);
      final focus = FocusNode();
      var actions = 0;
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: TPGuidedIconButton(
              close: false,
              focusNode: focus,
              onPressed: () => actions++,
              speak: (_, _) async {},
            ),
          ),
        ),
      );
      focus.requestFocus();
      await tester.pump();
      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.pump();
      expect(actions, 1);
      await tester.pumpWidget(const SizedBox());
      focus.dispose();
    },
  );
}
