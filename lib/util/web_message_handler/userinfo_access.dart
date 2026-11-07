import 'package:town_pass/bean/account.dart';
import 'package:town_pass/service/llm_service.dart';
import 'package:town_pass/util/tp_agent_entry.dart';

/// 可以讀取會員資料（`userinfo`）的網頁來源。
///
/// 開發用的 loopback 來源沿用本機 AI 白名單；另外只允許 App 城市服務列表
/// 直接開啟、且會呼叫 `userinfo` 的服務網站。新增正式網域須經團隊審查，
/// 因為這裡回傳的是身分證字號等個資。
const Set<String> kUserinfoAllowedOrigins = {
  ...kLlmAllowedOrigins,
  'https://taipei-pass-service.vercel.app',
};

/// 安心助手（`AGENT_WEB_URL`）的 origin；設定無效時為 null。
String? get _agentOrigin {
  if (!TPAgentConfig.enabled) return null;
  try {
    return Uri.parse(TPAgentConfig.url).origin;
  } catch (_) {
    return null;
  }
}

/// [origin] 是否可以讀取會員資料；null（無法判斷來源）一律不允許。
bool isUserinfoOriginAllowed(String? origin) =>
    origin != null &&
    (kUserinfoAllowedOrigins.contains(origin) || origin == _agentOrigin);

/// 只回傳網頁實際用到的欄位（帶入表單與顯示姓名），
/// 不提供內部 id、帳號、會員等級、原住民身分等用不到的資料。
Map<String, Object?>? userinfoPayload(Account? account) {
  if (account == null) return null;
  return {
    'realName': account.realName,
    'idNo': account.idNumber,
    'email': account.email,
    'phoneNo': account.phoneNumber,
    'birthday': account.birthday,
    'residentAddress': account.residentAddress,
    'addresses': [
      for (final address in account.addressList)
        {
          'zip3': address.zip3,
          'city': address.city,
          'town': address.town,
          'village': address.village,
          'street': address.street,
          'priority': address.priority,
        },
    ],
  };
}
