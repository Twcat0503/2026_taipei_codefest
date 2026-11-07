/// 安心助手帶民眾前往台北通站內服務時，替他填好已知的欄位（例如水號、身分證字號），
/// 不用重新輸入。
///
/// 安全界線：只填台北通站內微服務的頁面、只填白名單內的欄位，值只接受英數與連字號，
/// 並以 JSON 字串嵌入腳本，網頁或助手都無法藉此執行任意程式。
library;

import 'dart:convert';

/// 台北通站內微服務（TownPass-Services）的來源；與服務頁、帳務頁開的網址相同。
const String kPrefillOrigin = 'https://taipei-pass-service.vercel.app';

/// 號碼類欄位：只接受英數與連字號。
const Set<String> kCodeFields = {'water_number', 'tax_id'};

/// 文字類欄位與長度上限（有話要說的地點、主旨、描述；災情通報的地點描述、補充描述）。
const Map<String, int> kTextFields = {
  'location': 100,
  'title': 40,
  'description': 500,
  'desc': 200,
  'additional_disc': 500,
};

/// 聯絡資料（線上報案）：各自有嚴格格式。
final Map<String, RegExp> kContactFields = {
  'mobile_number': RegExp(r'^09\d{8}$'),
  'mail': RegExp(r'^[^\s@<>"]{1,64}@[^\s@<>"]{1,63}\.[A-Za-z]{2,24}$'),
};

/// 可帶入的欄位：表單輸入框的 id。
final Set<String> kPrefillFields = {
  ...kCodeFields,
  ...kTextFields.keys,
  ...kContactFields.keys,
};

final RegExp _code = RegExp(r'^[A-Za-z0-9-]{1,20}$');
// 除了換行以外的控制字元都不接受。
final RegExp _control = RegExp(r'[\x00-\x09\x0B-\x1F\x7F]');

bool _validValue(String field, String value) {
  if (kCodeFields.contains(field)) return _code.hasMatch(value);
  final RegExp? contact = kContactFields[field];
  if (contact != null) return contact.hasMatch(value);
  final int? max = kTextFields[field];
  return max != null &&
      value.trim().isNotEmpty &&
      value.length <= max &&
      !_control.hasMatch(value);
}

/// 只留下白名單欄位與合格的值；沒有可用欄位時回傳 null。
Map<String, String>? sanitizePrefill(Object? raw) {
  if (raw is! Map) return null;
  final Map<String, String> clean = {
    for (final MapEntry<Object?, Object?> entry in raw.entries)
      if (entry.key is String &&
          kPrefillFields.contains(entry.key) &&
          entry.value is String &&
          _validValue(entry.key as String, entry.value as String))
        entry.key as String: entry.value as String,
  };
  return clean.isEmpty ? null : clean;
}

/// 只在台北通站內微服務的頁面填寫。
bool canPrefill(Uri? page) =>
    page != null &&
    page.scheme == 'https' &&
    '${page.scheme}://${page.host}' == kPrefillOrigin;

/// 帶入失敗時告訴民眾是哪些欄位（不顯示值）。
const Map<String, String> kPrefillFieldLabels = {
  'water_number': '水號',
  'tax_id': '身分證字號',
  'location': '地點',
  'title': '主旨',
  'description': '描述',
  'mobile_number': '手機',
  'mail': 'Email',
};

/// 有欄位沒能帶入時的提示；[fields] 為空時回傳 null。
String? prefillFailureMessage(Iterable<String> fields) {
  final List<String> labels = [
    for (final String field in fields) kPrefillFieldLabels[field] ?? field,
  ];
  if (labels.isEmpty) return null;
  return '有些資料沒能自動帶入，請自行填寫：${labels.join('、')}';
}

/// 等表單出現後填入空白欄位，並觸發 input 事件讓 Vue 的 v-model 更新；最多等 8 秒。
///
/// 這是 `callAsyncJavaScript` 的函式本體：回傳一個 Promise，結果是找不到欄位
/// （例如表單改版、欄位 id 對不上）而沒填上的欄位名稱。原本就有值的欄位不覆寫，也不算失敗。
String prefillScript(Map<String, String> values) =>
    '''
return new Promise((resolve) => {
  const values = ${jsonEncode(values)};
  const setters = new Map([
    [HTMLInputElement, Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set],
    [HTMLTextAreaElement, Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set],
  ]);
  let tries = 0;
  const fill = () => {
    let pending = 0;
    for (const [id, value] of Object.entries(values)) {
      const input = document.getElementById(id);
      const setter = input && setters.get(input.constructor);
      if (!setter) { pending++; continue; }
      if (input.value) continue;
      setter.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      // 範本的驗證在 v-model 更新前執行，會先顯示「不能為空」；值更新後再觸發一次。
      setTimeout(() => input.dispatchEvent(new Event('input', { bubbles: true })), 100);
    }
    if (!pending) return resolve([]);
    if (++tries < 40) return setTimeout(fill, 200);
    resolve(Object.keys(values).filter((id) => {
      const input = document.getElementById(id);
      return !(input && setters.get(input.constructor));
    }));
  };
  fill();
});
''';
