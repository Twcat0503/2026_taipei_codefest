/// WebView 無法自己載入的連結（例如 Google 地圖導向的 `intent://`）改交給系統處理。
///
/// Google 地圖偵測到 WebView 時，會把 https 網址轉成
/// `intent://www.google.com/maps/...#Intent;scheme=https;package=...;end;`，
/// 要求系統打開地圖 App；WebView 不認得 intent，只會顯示 ERR_UNKNOWN_URL_SCHEME。
library;

const Set<String> _webSchemes = {
  'http',
  'https',
  'about',
  'data',
  'blob',
  'javascript',
  'file',
};

/// WebView 可以自己載入的協定。
bool isWebScheme(String scheme) => _webSchemes.contains(scheme.toLowerCase());

/// 回傳要交給系統開啟的網址；不允許的協定回傳 null（只取消載入，不開任何東西）。
///
/// 只放行撥號、郵件、地圖座標，以及 intent 所代表的 http(s) 網址，
/// 不直接執行 intent 指定的 App 或其他協定，避免網頁任意叫起手機上的 App。
Uri? externalTarget(Uri uri) {
  switch (uri.scheme.toLowerCase()) {
    case 'tel':
    case 'mailto':
    case 'geo':
      return uri;
    case 'intent':
      return _intentWebTarget(uri.toString());
    default:
      return null;
  }
}

Uri? _intentWebTarget(String raw) {
  final int marker = raw.indexOf('#Intent;');
  if (marker < 0 || !raw.toLowerCase().startsWith('intent://')) return null;
  final String path = raw.substring('intent://'.length, marker);
  String? scheme;
  String? fallback;
  for (final String part
      in raw.substring(marker + '#Intent;'.length).split(';')) {
    if (part.startsWith('scheme=')) scheme = part.substring('scheme='.length);
    if (part.startsWith('S.browser_fallback_url=')) {
      fallback = Uri.decodeComponent(
        part.substring('S.browser_fallback_url='.length),
      );
    }
  }
  if ((scheme == 'https' || scheme == 'http') && path.isNotEmpty) {
    return Uri.tryParse('$scheme://$path');
  }
  final Uri? fallbackUri = fallback == null ? null : Uri.tryParse(fallback);
  if (fallbackUri != null &&
      (fallbackUri.scheme == 'https' || fallbackUri.scheme == 'http')) {
    return fallbackUri;
  }
  return null;
}
