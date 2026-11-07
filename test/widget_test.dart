import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:get/get.dart';
import 'package:town_pass/util/tp_agent_entry.dart';
import 'package:town_pass/util/tp_route.dart';
import 'package:town_pass/util/tp_web_view.dart';

void main() {
  tearDown(() => Get.reset());

  testWidgets(
    'Assistant entry opens the existing WebView route with the configured URL',
    (tester) async {
      final semantics = tester.ensureSemantics();
      WebViewArgument? received;
      await tester.pumpWidget(
        GetMaterialApp(
          home: const Scaffold(body: TPAgentEntry()),
          getPages: [
            GetPage(
              name: TPRoute.webView,
              page: () {
                received = Get.arguments as WebViewArgument;
                return const Scaffold(body: Text('WebView route'));
              },
            ),
          ],
        ),
      );
      expect(find.bySemanticsLabel(RegExp('安心助手')), findsOneWidget);
      expect(
        tester.getSemantics(find.bySemanticsLabel(RegExp('安心助手'))),
        matchesSemantics(
          label: '安心助手，找服務、查圖書，一步一步完成，示範體驗・送出前由你確認',
          isButton: true,
          hasTapAction: true,
        ),
      );
      await tester.tap(find.byType(FilledButton));
      await tester.pumpAndSettle();
      expect(received?.url, TPAgentConfig.url);
      expect(received?.forceTitle, '安心助手');
      expect(find.text('WebView route'), findsOneWidget);
      semantics.dispose();
    },
  );

  testWidgets(
    'Assistant entry fits a narrow viewport at 200 percent text size',
    (tester) async {
      tester.view.physicalSize = const Size(360, 800);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await tester.pumpWidget(
        const MaterialApp(
          home: MediaQuery(
            data: MediaQueryData(textScaler: TextScaler.linear(2)),
            child: Scaffold(body: SingleChildScrollView(child: TPAgentEntry())),
          ),
        ),
      );
      expect(tester.takeException(), isNull);
      expect(
        tester.getSize(find.byType(FilledButton)).height,
        greaterThanOrEqualTo(48),
      );
    },
  );
}
