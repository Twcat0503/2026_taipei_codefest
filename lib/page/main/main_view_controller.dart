import 'package:get/get.dart';
import 'package:town_pass/service/shared_preferences_service.dart';
import 'package:town_pass/util/tp_bottom_navigation_factory.dart';

class MainViewController extends GetxController {
  final RxInt currentIndex = RxInt(switch (SharedPreferencesService().instance
      .getInt(SharedPreferencesService.keyHomeIndex)) {
    int sharedPreferencesIndex => sharedPreferencesIndex,
    null => TPBottomNavigationFactory.defaultIndex,
  });
  final shakeToAgentEnabled =
      (SharedPreferencesService().instance.getBool(
                SharedPreferencesService.keyShakeToAgent,
              ) ??
              true)
          .obs;

  Future<void> setShakeToAgent(bool enabled) async {
    final previous = shakeToAgentEnabled.value;
    shakeToAgentEnabled.value = enabled;
    try {
      final saved = await SharedPreferencesService().instance.setBool(
        SharedPreferencesService.keyShakeToAgent,
        enabled,
      );
      if (!saved) shakeToAgentEnabled.value = previous;
    } catch (_) {
      shakeToAgentEnabled.value = previous;
    }
  }
}
