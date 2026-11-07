// App shell smoke tests.
//
// These boot the real `MyApp` (GetMaterialApp + TPRoute + MainView) and check
// the bottom navigation shell. Whatever would normally call into a native
// plugin is replaced by the plugin's own test hook or by a small fake, so the
// tests need no device or emulator.

import 'package:carousel_slider/carousel_slider.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:get/get.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:shimmer/shimmer.dart';
import 'package:town_pass/main.dart';
import 'package:town_pass/service/account_service.dart';
import 'package:town_pass/service/device_service.dart';
import 'package:town_pass/service/geo_locator_service.dart';
import 'package:town_pass/service/notification_service.dart';
import 'package:town_pass/service/package_service.dart';
import 'package:town_pass/service/shared_preferences_service.dart';
import 'package:town_pass/service/subscription_service.dart';

/// A typical modern Android phone (412 x 915 dp) instead of the 800 x 600
/// default test surface. It is tall enough for every tab's finder to sit on
/// the first screen, even on the home page where the assistant entry is pinned
/// above the news banner. Don't go much narrower: at 360 dp the empty state of
/// `SubscriptionWidget` already overflows under the test font.
const Size _phoneViewport = Size(412, 915);

/// `NewsBannerWidgetController` and `ActivityBannerWidgetController` start
/// 3 s and 2 s timers in `onInit` that nothing cancels, and the test binding
/// fails a test that ends with a timer pending. Pumping past them also lets
/// the home page swap its shimmer placeholders for the mock data.
const Duration _startupTimers = Duration(seconds: 3);

/// One bottom navigation destination: its label (which is also the title of
/// its page's app bar) and a finder that only matches while its page is shown.
/// The finder has to target something on the page's first screen: the pages
/// are lazy lists, so a widget far below the fold may not be built at all.
typedef _Tab = ({String label, Finder body});

/// In `TPBottomNavigationFactory` order, so the list index is the tab index.
final List<_Tab> _tabs = [
  (label: '服務', body: find.text('我的服務')),
  (label: '首頁', body: find.text('活動訊息')),
  (label: '優惠', body: find.byType(InAppWebView)),
  (label: '帳務', body: find.text('熱門繳費')),
];

const int _homeTab = 1;

void main() {
  setUpAll(() {
    // Dart plugin registration only happens in a real app run, so install the
    // platform implementations the app relies on by hand.
    FlutterLocalNotificationsPlatform.instance = _FakeNotificationsPlatform();
    InAppWebViewPlatform.instance = _FakeInAppWebViewPlatform();
  });

  tearDown(() {
    Get.reset();
    // `rootBundle` caches the futures of the strings it has loaded. A future
    // cached by one test is tied to that test's fake-async zone, so awaiting it
    // from the next test never resumes and the test just hangs.
    rootBundle.clear();
  });

  group('Town Pass app shell', () {
    testWidgets('boots into the shell on the home tab', (tester) async {
      await _pumpApp(tester);

      final bar = tester.widget<BottomNavigationBar>(
        find.byType(BottomNavigationBar),
      );
      expect(
        bar.items.map((item) => item.label),
        orderedEquals(_tabs.map((tab) => tab.label)),
      );
      expect(_selectedTab(tester), _homeTab);

      expect(_appBarTitle('首頁'), findsOneWidget);
      expect(_tabs[_homeTab].body, findsOneWidget);

      // The home page has swapped its shimmer placeholders for loaded content.
      expect(find.byType(Shimmer), findsNothing);
      expect(find.byType(CarouselSlider), findsOneWidget);
    });

    testWidgets('switches pages from the bottom navigation', (tester) async {
      await _pumpApp(tester);

      // Visit every tab, finishing back on the home tab.
      for (final index in [0, 2, 3, _homeTab]) {
        final tab = _tabs[index];
        await tester.tap(_navItem(tab.label));
        // Let the bar's selection animation run its course.
        await tester.pump(const Duration(milliseconds: 300));

        expect(
          _selectedTab(tester),
          index,
          reason: 'selected tab after tapping ${tab.label}',
        );
        expect(
          _appBarTitle(tab.label),
          findsOneWidget,
          reason: 'app bar title after tapping ${tab.label}',
        );
        // Only the selected tab's page is on screen.
        for (var other = 0; other < _tabs.length; other++) {
          expect(
            _tabs[other].body,
            other == index ? findsOneWidget : findsNothing,
            reason: 'page of ${_tabs[other].label} with ${tab.label} selected',
          );
        }
      }
    });

    testWidgets('opens on the tab saved in preferences', (tester) async {
      const savedTab = 3;
      await _pumpApp(
        tester,
        preferences: {SharedPreferencesService.keyHomeIndex: savedTab},
      );

      expect(_selectedTab(tester), savedTab);
      expect(_appBarTitle(_tabs[savedTab].label), findsOneWidget);
      expect(_tabs[savedTab].body, findsOneWidget);
      expect(_appBarTitle('首頁'), findsNothing);
    });
  });
}

/// Boots [MyApp] with the services registered and the startup timers run out.
///
/// `pumpAndSettle` can't be used: the shimmer placeholders and the carousel
/// keep animating, so it would never settle.
Future<void> _pumpApp(
  WidgetTester tester, {
  Map<String, Object> preferences = const {},
}) async {
  tester.view
    ..physicalSize = _phoneViewport
    ..devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);

  SharedPreferences.setMockInitialValues(preferences);
  PackageInfo.setMockInitialValues(
    appName: 'Town Pass',
    packageName: 'tw.gov.taipei.townpass',
    version: '0.0.0',
    buildNumber: '0',
    buildSignature: '',
  );
  await _initServices();

  await tester.pumpWidget(const MyApp());
  await tester.pump(_startupTimers);
}

/// Mirrors `initServices()` in `lib/main.dart`; keep the two in sync.
///
/// That function can't run as is under `flutter test`:
/// - `DeviceService.init()` never completes. `device_info_plus` decodes the
///   reply differently per host OS and nothing answers its method channel, so
///   the call just hangs. [_FakeDeviceService] takes its place.
/// - `NotificationService.init()` needs a `FlutterLocalNotificationsPlatform`
///   instance, which `setUpAll` installs.
///
/// The other services only need `SharedPreferences` / `PackageInfo` mock
/// values (set in [_pumpApp]) and the mock JSON assets, which `flutter test`
/// serves from the real asset bundle.
Future<void> _initServices() async {
  await Get.putAsync<AccountService>(() async => await AccountService().init());
  await Get.putAsync<DeviceService>(
    () async => await _FakeDeviceService().init(),
  );
  await Get.putAsync<PackageService>(() async => await PackageService().init());
  await Get.putAsync<SharedPreferencesService>(
    () async => await SharedPreferencesService().init(),
  );
  await Get.putAsync<GeoLocatorService>(
    () async => await GeoLocatorService().init(),
  );
  await Get.putAsync<NotificationService>(
    () async => await NotificationService().init(),
  );

  Get.put<SubscriptionService>(SubscriptionService());
}

Finder _navItem(String label) {
  return find.descendant(
    of: find.byType(BottomNavigationBar),
    matching: find.text(label),
  );
}

Finder _appBarTitle(String title) {
  return find.descendant(of: find.byType(AppBar), matching: find.text(title));
}

int _selectedTab(WidgetTester tester) {
  return tester
      .widget<BottomNavigationBar>(find.byType(BottomNavigationBar))
      .currentIndex;
}

/// Skips the real device query; nothing in the app shell reads device info.
class _FakeDeviceService extends DeviceService {
  @override
  Future<DeviceService> init() async => this;
}

/// Stands in for the native plugin registration that doesn't happen under
/// `flutter test`. With no Android or iOS implementation behind it,
/// `NotificationService.init()` runs through as no-ops.
class _FakeNotificationsPlatform extends FlutterLocalNotificationsPlatform {}

/// `PerkView` embeds a native web view, which can't exist in a widget test.
/// This platform builds an empty placeholder in its place.
class _FakeInAppWebViewPlatform extends InAppWebViewPlatform {
  @override
  PlatformInAppWebViewWidget createPlatformInAppWebViewWidget(
    PlatformInAppWebViewWidgetCreationParams params,
  ) {
    return _FakeInAppWebViewWidget(params);
  }
}

class _FakeInAppWebViewWidget extends PlatformInAppWebViewWidget {
  _FakeInAppWebViewWidget(super.params) : super.implementation();

  @override
  Widget build(BuildContext context) => const SizedBox.expand();

  @override
  T controllerFromPlatform<T>(PlatformInAppWebViewController controller) {
    throw UnimplementedError('The fake web view never creates a controller.');
  }

  @override
  void dispose() {}
}
