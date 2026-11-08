import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:town_pass/service/button_guidance_service.dart';
import 'package:town_pass/util/web_message_handler/tp_web_message_handler.dart';

/// 指標單點說明、第二點執行；鍵盤與 TalkBack 的語意啟用仍直接執行。
class TPGuidedIconButton extends StatefulWidget {
  final bool close;
  final VoidCallback onPressed;
  final Color? color;
  final FocusNode? focusNode;
  final Future<void> Function(String text, String language)? speak;
  const TPGuidedIconButton({
    super.key,
    required this.close,
    required this.onPressed,
    this.color,
    this.focusNode,
    this.speak,
  });
  @override
  State<TPGuidedIconButton> createState() => _TPGuidedIconButtonState();
}

class _TPGuidedIconButtonState extends State<TPGuidedIconButton> {
  Future<void> _read(String text, String lang) async {
    if (widget.speak != null) {
      await widget.speak!(text, lang);
      return;
    }
    await TtsMessageHandler().handle(
      message: {'text': text, 'lang': lang == 'en' ? 'en-US' : 'zh-TW'},
      sourceOrigin: null,
      isMainFrame: true,
      onReply: null,
    );
  }

  void _activate(ButtonGuidanceService? service, String text) {
    if (service?.enabled.value != true ||
        MediaQuery.accessibleNavigationOf(context)) {
      widget.onPressed();
      return;
    }
    if (service!.activateTap(this)) {
      TtsMessageHandler()
          .handle(
            message: {'stop': true},
            sourceOrigin: null,
            isMainFrame: true,
            onReply: null,
          )
          .catchError((_) {});
      widget.onPressed();
    } else {
      _read(text, service.language.value).catchError((_) {});
    }
  }

  Widget _button(ButtonGuidanceService? service) {
    final english = service?.language.value == 'en';
    final label = widget.close
        ? (english ? 'Close' : '關閉')
        : (english ? 'Back' : '返回');
    final description = widget.close
        ? (english
              ? 'Closes this page and returns to Town Pass.'
              : '關閉網頁，回到城市通。')
        : (english
              ? 'Goes back, or leaves if there is no previous page.'
              : '返回上一頁，沒有上一頁則離開。');
    return Semantics(
      button: true,
      label: label,
      hint: service?.enabled.value == true ? description : null,
      onTap: widget.onPressed,
      excludeSemantics: true,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: () => _activate(service, description),
        child: IgnorePointer(
          child: IconButton(
            focusNode: widget.focusNode,
            tooltip: label,
            constraints: const BoxConstraints(minWidth: 48, minHeight: 48),
            color: widget.color,
            icon: Icon(widget.close ? Icons.close : Icons.arrow_back, size: 24),
            onPressed: widget.onPressed,
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (!Get.isRegistered<ButtonGuidanceService>()) return _button(null);
    final service = Get.find<ButtonGuidanceService>();
    return Obx(() => _button(service));
  }
}
