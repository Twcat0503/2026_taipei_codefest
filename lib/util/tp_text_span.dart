import 'package:flutter/material.dart';

class TPTextSpan extends TextSpan {
  /// The text contained in this span.
  ///
  /// If both [text] and [children] are non-null, the text will precede the
  /// children.
  ///
  /// This getter does not include the contents of its children.
  final String? _sourceText;

  @override
  String? get text => _sourceText;

  /// Additional spans to include as children.
  ///
  /// If both [text] and [children] are non-null, the text will precede the
  /// children.
  ///
  /// Modifying the list after the [TextSpan] has been created is not supported
  /// and may have unexpected results.
  ///
  /// The list must not contain any nulls.
  final List<InlineSpan>? _sourceChildren;

  @override
  List<InlineSpan>? get children => _sourceChildren;

  /// split text with words(english characters, digits and "_")
  static final RegExp _splitRegExp = RegExp(r'(?<=\W)(?=\w)|(?<=\w)(?=\W)');

  /// english characters, digits and "_"
  static final RegExp _wordCharacter = RegExp(r'\w');

  TPTextSpan({
    String? text,
    List<InlineSpan>? children,
    super.style,
    super.recognizer,
    super.mouseCursor,
    super.onEnter,
    super.onExit,
    super.semanticsLabel,
    super.locale,
    super.spellOut,
  }) : _sourceText = text,
        _sourceChildren = children,
        super(
          text: null,
          children: [
            ...?text?.split(_splitRegExp).map(
                  (text) => switch (text.contains(_wordCharacter)) {
                    true => TextSpan(
                        text: text,
                        style: switch (style) {
                          TextStyle style => style.copyWith(fontFamily: 'Roboto'),
                          null => const TextStyle(fontFamily: 'Roboto'),
                        },
                      ),
                    false => TextSpan(
                        text: text,
                        style: switch (style) {
                          TextStyle style => style.copyWith(fontFamily: 'PingFangTC'),
                          null => const TextStyle(fontFamily: 'PingFangTC'),
                        },
                      ),
                  },
                ),
            ...?children,
          ],
        );
}
