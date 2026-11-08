import 'package:get/get.dart';
import 'package:town_pass/service/shared_preferences_service.dart';

/// 跨助手、服務網頁與原生 WebView 工具列共用的操作偏好，不記錄障礙資訊。
class ButtonGuidanceService extends GetxService {
  static const enabledKey = 'button_guidance_enabled';
  static const languageKey = 'button_guidance_language';
  final enabled = true.obs;
  final language = 'zh-Hant-TW'.obs;
  bool _configured = false;
  Object? _armedControl;
  DateTime? _armedAt;
  void clearArmed() {
    _armedControl = null;
    _armedAt = null;
  }

  bool activateTap(Object control) {
    final now = DateTime.now();
    if (_armedControl == control &&
        _armedAt != null &&
        now.difference(_armedAt!).inMilliseconds <= 1200) {
      _armedControl = null;
      _armedAt = null;
      return true;
    }
    _armedControl = control;
    _armedAt = now;
    return false;
  }

  ButtonGuidanceService init() {
    final prefs = Get.find<SharedPreferencesService>().instance;
    _configured = prefs.containsKey(enabledKey);
    enabled.value = prefs.getBool(enabledKey) ?? true;
    language.value = prefs.getString(languageKey) == 'en' ? 'en' : 'zh-Hant-TW';
    return this;
  }

  Future<void> update({bool? on, String? lang}) async {
    final prefs = Get.find<SharedPreferencesService>().instance;
    if (on != null) {
      _configured = true;
      _armedControl = null;
      _armedAt = null;
      enabled.value = on;
      await prefs.setBool(enabledKey, on);
    }
    if (lang != null) {
      language.value = lang == 'en' ? 'en' : 'zh-Hant-TW';
      await prefs.setString(languageKey, language.value);
    }
  }

  Map<String, Object> get state => {
    'configured': _configured,
    'enabled': enabled.value,
    'lang': language.value,
  };
}
