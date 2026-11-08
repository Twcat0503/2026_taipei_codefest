import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:get/get.dart';
import 'package:sensors_plus/sensors_plus.dart';
import 'package:town_pass/util/tp_agent_entry.dart';
import 'package:town_pass/util/tp_route.dart';
import 'package:town_pass/util/tp_shake_detector.dart';
import 'package:town_pass/util/tp_shake_to_agent.dart';
import 'package:town_pass/util/tp_web_view.dart';

void main() {
  tearDown(() => Get.reset());
  group('deliberate shake recognition', () {
    test(
      'ignores walking, one bump and repeated acceleration in one direction',
      () {
        final detector = TPShakeDetector();
        for (var i = 0; i < 20; i++) {
          expect(
            detector.add(
              i.isEven ? 4 : -4,
              0,
              0,
              Duration(milliseconds: i * 150),
            ),
            isFalse,
          );
        }
        for (var i = 0; i < 5; i++) {
          expect(
            detector.add(20, 0, 0, Duration(seconds: 4, milliseconds: i * 150)),
            isFalse,
          );
        }
      },
    );
    test('requires opposing peaks and enforces a cooldown', () {
      final detector = TPShakeDetector();
      expect(detector.add(18, 0, 0, Duration.zero), isFalse);
      expect(
        detector.add(-18, 0, 0, const Duration(milliseconds: 150)),
        isFalse,
      );
      expect(detector.add(18, 0, 0, const Duration(milliseconds: 300)), isTrue);
      for (var i = 0; i < 10; i++) {
        expect(
          detector.add(
            i.isEven ? 18 : -18,
            0,
            0,
            Duration(milliseconds: 450 + i * 150),
          ),
          isFalse,
        );
      }
      expect(detector.add(0, 18, 0, const Duration(seconds: 3)), isFalse);
      expect(
        detector.add(0, -18, 0, const Duration(milliseconds: 3150)),
        isFalse,
      );
      expect(
        detector.add(0, 18, 0, const Duration(milliseconds: 3300)),
        isTrue,
      );
    });
    test(
      'does not combine separate shakes or samples less than 100ms apart',
      () {
        final detector = TPShakeDetector();
        expect(detector.add(18, 0, 0, Duration.zero), isFalse);
        expect(
          detector.add(-18, 0, 0, const Duration(milliseconds: 20)),
          isFalse,
        );
        expect(
          detector.add(18, 0, 0, const Duration(milliseconds: 40)),
          isFalse,
        );
        expect(detector.add(-18, 0, 0, const Duration(seconds: 2)), isFalse);
        expect(
          detector.add(18, 0, 0, const Duration(milliseconds: 2150)),
          isFalse,
        );
        detector.reset();
        expect(
          detector.add(-18, 0, 0, const Duration(milliseconds: 2300)),
          isFalse,
        );
        expect(
          detector.add(double.nan, 0, 0, const Duration(seconds: 3)),
          isFalse,
        );
      },
    );
  });

  testWidgets(
    'a home shake opens the existing assistant route once and stops listening behind it',
    (tester) async {
      final events = StreamController<UserAccelerometerEvent>.broadcast(
        sync: true,
      );
      addTearDown(events.close);
      var time = Duration.zero;
      WebViewArgument? received;
      var opened = 0;
      final order = <String>[];
      final messenger =
          TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
      const feedbackChannel = MethodChannel('town_pass/feedback');
      messenger.setMockMethodCallHandler(feedbackChannel, (call) async {
        expect(call.method, 'shake');
        order.add('vibrate');
        return true;
      });
      addTearDown(
        () => messenger.setMockMethodCallHandler(feedbackChannel, null),
      );
      messenger.setMockMethodCallHandler(SystemChannels.platform, (call) async {
        if (call.method == 'HapticFeedback.vibrate') {
          fail(
            'Native shake acknowledgement must not also send key-click haptics.',
          );
        }
        return null;
      });
      addTearDown(
        () => messenger.setMockMethodCallHandler(SystemChannels.platform, null),
      );
      await tester.pumpWidget(
        GetMaterialApp(
          home: TPShakeToAgent(
            enabled: true,
            events: () => events.stream,
            elapsed: () => time,
            child: const Scaffold(body: Text('Home')),
          ),
          getPages: [
            GetPage(
              name: TPRoute.webView,
              page: () {
                opened++;
                order.add('open');
                received = Get.arguments as WebViewArgument;
                return const Scaffold(body: Text('Assistant'));
              },
            ),
          ],
        ),
      );
      expect(events.hasListener, isTrue);
      for (final x in [18.0, -18.0, 18.0]) {
        events.add(UserAccelerometerEvent(x, 0, 0, DateTime(2026)));
        time += const Duration(milliseconds: 150);
        await tester.pump();
      }
      await tester.pumpAndSettle();
      expect(opened, 1);
      expect(order, ['vibrate', 'open']);
      expect(received?.url, TPAgentConfig.url);
      expect(received?.forceTitle, '安心助手');
      expect(events.hasListener, isFalse);
      time += const Duration(seconds: 3);
      for (final x in [18.0, -18.0, 18.0]) {
        events.add(UserAccelerometerEvent(x, 0, 0, DateTime(2026)));
      }
      expect(opened, 1);
      expect(order, ['vibrate', 'open']);
      Get.back();
      await tester.pumpAndSettle();
      expect(events.hasListener, isTrue);
      await tester.pumpWidget(const SizedBox());
      expect(events.hasListener, isFalse);
    },
  );

  for (final timeout in [false, true]) {
    testWidgets(
      'opens even when vibration ${timeout ? 'does not reply' : 'fails'}',
      (tester) async {
        final events = StreamController<UserAccelerometerEvent>.broadcast(
          sync: true,
        );
        addTearDown(events.close);
        final messenger =
            TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
        const nativeFeedback = MethodChannel('town_pass/feedback');
        messenger.setMockMethodCallHandler(nativeFeedback, (_) async => false);
        addTearDown(
          () => messenger.setMockMethodCallHandler(nativeFeedback, null),
        );
        messenger.setMockMethodCallHandler(SystemChannels.platform, (
          call,
        ) async {
          if (call.method == 'HapticFeedback.vibrate') {
            if (timeout) return Completer<Object?>().future;
            throw PlatformException(code: 'VIBRATION_UNAVAILABLE');
          }
          return null;
        });
        addTearDown(
          () =>
              messenger.setMockMethodCallHandler(SystemChannels.platform, null),
        );
        var time = Duration.zero;
        var opened = 0;
        await tester.pumpWidget(
          MaterialApp(
            home: TPShakeToAgent(
              enabled: true,
              events: () => events.stream,
              elapsed: () => time,
              openAgent: () async {
                opened++;
              },
              child: const Scaffold(body: Text('Home')),
            ),
          ),
        );
        for (final x in [18.0, -18.0, 18.0]) {
          events.add(UserAccelerometerEvent(x, 0, 0, DateTime(2026)));
          time += const Duration(milliseconds: 150);
          await tester.pump();
        }
        if (timeout) {
          expect(opened, 0);
          await tester.pump(const Duration(milliseconds: 201));
        }
        expect(opened, 1);
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox());
      },
    );
  }

  testWidgets(
    'switching off, covering the home route and backgrounding all release the sensor',
    (tester) async {
      final events = StreamController<UserAccelerometerEvent>.broadcast(
        sync: true,
      );
      addTearDown(events.close);
      final enabled = ValueNotifier(true);
      addTearDown(enabled.dispose);
      final navigator = GlobalKey<NavigatorState>();
      await tester.pumpWidget(
        MaterialApp(
          navigatorKey: navigator,
          home: ValueListenableBuilder<bool>(
            valueListenable: enabled,
            builder: (_, value, child) => TPShakeToAgent(
              enabled: value,
              events: () => events.stream,
              child: const Scaffold(body: Text('Home')),
            ),
          ),
        ),
      );
      expect(events.hasListener, isTrue);
      enabled.value = false;
      await tester.pump();
      expect(events.hasListener, isFalse);
      enabled.value = true;
      await tester.pump();
      expect(events.hasListener, isTrue);
      navigator.currentState!.push(
        MaterialPageRoute<void>(
          builder: (_) => const Scaffold(body: Text('Other page')),
        ),
      );
      await tester.pumpAndSettle();
      expect(events.hasListener, isFalse);
      navigator.currentState!.pop();
      await tester.pumpAndSettle();
      expect(events.hasListener, isTrue);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
      await tester.pump();
      expect(events.hasListener, isFalse);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pump();
      expect(events.hasListener, isTrue);
      await tester.pumpWidget(const SizedBox());
    },
  );

  testWidgets('sensor failure leaves the visible assistant entry usable', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: TPShakeToAgent(
          enabled: true,
          events: () => Stream.error(StateError('No sensor')),
          child: const Scaffold(body: TPAgentEntry()),
        ),
      ),
    );
    await tester.pump();
    expect(tester.takeException(), isNull);
    expect(find.byType(FilledButton), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
  });
}
