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
          label: '安心助手，找無障礙廁所與車位，帶你到官方服務，官方資料・離開前由你確認',
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
    'A link opened from inside a WebView stacks a new WebView instead of being dropped',
    (tester) async {
      final opened = <String?>[];
      await tester.pumpWidget(
        GetMaterialApp(
          home: const SizedBox.shrink(),
          getPages: [
            GetPage(
              name: TPRoute.webView,
              page: () {
                opened.add((Get.arguments as WebViewArgument?)?.url);
                return Scaffold(body: Text('page ${opened.length}'));
              },
            ),
          ],
        ),
      );
      TPRoute.openUri(uri: 'http://127.0.0.1:5173/');
      await tester.pumpAndSettle();
      // The assistant page asks the app to open an official site (open_link).
      TPRoute.openUri(uri: 'https://pay.taipei/');
      await tester.pumpAndSettle();
      expect(opened, ['http://127.0.0.1:5173/', 'https://pay.taipei/']);
      expect(find.text('page 2'), findsOneWidget);
      Get.back();
      await tester.pumpAndSettle();
      expect(find.text('page 1'), findsOneWidget);
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
