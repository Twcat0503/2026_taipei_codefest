import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:town_pass/util/tp_colors.dart';
import 'package:town_pass/util/tp_route.dart';
import 'package:town_pass/util/tp_web_view.dart';

/// The hosted Vue app stays separate from Flutter assets. Release builds must
/// explicitly configure an HTTPS deployment; loopback is only a debug default.
abstract final class TPAgentConfig {
  static const url = String.fromEnvironment(
    'AGENT_WEB_URL',
    defaultValue: kDebugMode ? 'http://127.0.0.1:5173' : '',
  );

  static bool get enabled {
    final uri = Uri.tryParse(url);
    return uri != null &&
        uri.host.isNotEmpty &&
        uri.userInfo.isEmpty &&
        (uri.scheme == 'https' || (kDebugMode && uri.scheme == 'http'));
  }

  static Future<void> open() async {
    if (!enabled) return;
    final copy = _copy[Get.locale?.languageCode == 'en' ? 'en' : 'zh']!;
    await Get.toNamed<void>(
      TPRoute.webView,
      arguments: WebViewArgument(url: url, forceTitle: copy.$1),
    );
  }
}

const _copy = {
  'zh': ('安心助手', '找無障礙廁所與車位，帶你到官方服務', '官方資料・離開前由你確認'),
  'en': (
    'Care Assistant',
    'Accessible toilets, parking and official services',
    'Official data · You confirm before leaving',
  ),
};

class TPAgentEntry extends StatelessWidget {
  const TPAgentEntry({super.key});

  @override
  Widget build(BuildContext context) {
    if (!TPAgentConfig.enabled) return const SizedBox.shrink();
    final copy = _copy[Get.locale?.languageCode == 'en' ? 'en' : 'zh']!;

    return Padding(
      padding: const EdgeInsets.all(16),
      child: Semantics(
        button: true,
        onTap: TPAgentConfig.open,
        label: '${copy.$1}，${copy.$2}，${copy.$3}',
        excludeSemantics: true,
        child: FilledButton(
          onPressed: TPAgentConfig.open,
          style: FilledButton.styleFrom(
            backgroundColor: TPColors.primary800,
            foregroundColor: TPColors.white,
            minimumSize: const Size.fromHeight(96),
            padding: const EdgeInsets.all(20),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(16),
            ),
            alignment: Alignment.centerLeft,
          ),
          child: Row(
            children: [
              const Icon(Icons.assistant_outlined, size: 30),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      copy.$1,
                      style: const TextStyle(
                        fontSize: 22,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text(copy.$2, style: const TextStyle(fontSize: 16)),
                    const SizedBox(height: 8),
                    Text(copy.$3, style: const TextStyle(fontSize: 14)),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              const Icon(Icons.arrow_forward, size: 24),
            ],
          ),
        ),
      ),
    );
  }
}
