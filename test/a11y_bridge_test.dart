import 'dart:async';
import 'dart:convert';

import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:town_pass/util/tp_web_view.dart';
import 'package:town_pass/util/web_message_handler/tp_web_message_handler.dart';
import 'package:town_pass/util/web_message_handler/tp_web_message_listener.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  final messenger =
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;

  test('tts, haptic and a11y_state are registered with the listener', () {
    final names = TPWebMessageListener.messageHandler.map((h) => h.name);

    expect(names, containsAll(['tts', 'haptic', 'a11y_state']));
    expect(TtsMessageHandler().name, 'tts');
    expect(HapticMessageHandler().name, 'haptic');
    expect(A11yStateMessageHandler().name, 'a11y_state');
  });

  group('haptic bridge', () {
    final platformCalls = <MethodCall>[];
    final handler = HapticMessageHandler();

    setUp(() {
      platformCalls.clear();
      messenger.setMockMethodCallHandler(SystemChannels.platform, (call) async {
        platformCalls.add(call);
        return null;
      });
    });
    tearDown(
      () => messenger.setMockMethodCallHandler(SystemChannels.platform, null),
    );

    const expectedArguments = {
      'selection': 'HapticFeedbackType.selectionClick',
      'light': 'HapticFeedbackType.lightImpact',
      'medium': 'HapticFeedbackType.mediumImpact',
      'heavy': 'HapticFeedbackType.heavyImpact',
      'success': 'HapticFeedbackType.successNotification',
      'warning': 'HapticFeedbackType.warningNotification',
      'error': 'HapticFeedbackType.errorNotification',
    };

    for (final entry in expectedArguments.entries) {
      test(
        'type ${entry.key} triggers ${entry.value} and echoes requestId',
        () async {
          final replies = await _send(handler, {
            'requestId': 'h-${entry.key}',
            'type': entry.key,
          });

          expect(replies, [
            {'requestId': 'h-${entry.key}', 'ok': true},
          ]);
          expect(platformCalls, hasLength(1));
          expect(platformCalls.single.method, 'HapticFeedback.vibrate');
          expect(platformCalls.single.arguments, entry.value);
        },
      );
    }

    test('reply omits requestId when the request has none', () async {
      expect(await _send(handler, {'type': 'light'}), [
        {'ok': true},
      ]);
    });

    test('requestId longer than 64 characters is not echoed', () async {
      expect(await _send(handler, {'requestId': 'x' * 65, 'type': 'light'}), [
        {'ok': true},
      ]);
      expect(await _send(handler, {'requestId': 'x' * 64, 'type': 'light'}), [
        {'requestId': 'x' * 64, 'ok': true},
      ]);
    });

    test(
      'unknown or missing type replies unknown_type without vibrating',
      () async {
        final messages = <Object?>[
          {'requestId': 'u1', 'type': 'vibrate'},
          {'requestId': 'u1', 'type': 'Light'},
          {'requestId': 'u1', 'type': 42},
          {'requestId': 'u1'},
          {'requestId': 'u1', 'type': null},
          'light',
          null,
        ];
        for (final message in messages) {
          final replies = await _send(handler, message);
          expect(replies, [
            {
              if (message is Map) 'requestId': 'u1',
              'ok': false,
              'error': 'unknown_type',
            },
          ], reason: 'message: $message');
        }
        expect(platformCalls, isEmpty);
      },
    );
  });

  group('a11y_state bridge', () {
    final handler = A11yStateMessageHandler();

    testWidgets('reports system preferences to an allowed main frame', (
      tester,
    ) async {
      addTearDown(tester.platformDispatcher.clearAllTestValues);
      tester.platformDispatcher.accessibilityFeaturesTestValue =
          const FakeAccessibilityFeatures(
            accessibleNavigation: true,
            boldText: true,
            highContrast: true,
            disableAnimations: true,
            invertColors: true,
          );
      tester.platformDispatcher.textScaleFactorTestValue = 1.5;

      final replies = await _send(handler, {'requestId': 'a1'});

      expect(replies, [
        {
          'requestId': 'a1',
          'screenReader': true,
          'boldText': true,
          'highContrast': true,
          'reduceMotion': true,
          'invertColors': true,
          'textScale': 1.5,
        },
      ]);
    });

    testWidgets('reports everything off at the default settings', (
      tester,
    ) async {
      addTearDown(tester.platformDispatcher.clearAllTestValues);
      tester.platformDispatcher.accessibilityFeaturesTestValue =
          const FakeAccessibilityFeatures();
      tester.platformDispatcher.textScaleFactorTestValue = 1.0;

      expect(await _send(handler, null), [
        {
          'screenReader': false,
          'boldText': false,
          'highContrast': false,
          'reduceMotion': false,
          'invertColors': false,
          'textScale': 1.0,
        },
      ]);
    });

    testWidgets('reduceMotion is true when either motion flag is set', (
      tester,
    ) async {
      addTearDown(tester.platformDispatcher.clearAllTestValues);
      for (final features in const [
        FakeAccessibilityFeatures(disableAnimations: true),
        FakeAccessibilityFeatures(reduceMotion: true),
      ]) {
        tester.platformDispatcher.accessibilityFeaturesTestValue = features;
        final replies = await _send(handler, {'requestId': 'm'});
        expect((replies.single as Map)['reduceMotion'], isTrue);
      }
    });

    testWidgets('screenReader is null for other origins and child frames', (
      tester,
    ) async {
      addTearDown(tester.platformDispatcher.clearAllTestValues);
      tester.platformDispatcher.accessibilityFeaturesTestValue =
          const FakeAccessibilityFeatures(
            accessibleNavigation: true,
            boldText: true,
            highContrast: true,
            disableAnimations: true,
            invertColors: true,
          );
      tester.platformDispatcher.textScaleFactorTestValue = 2.0;

      final cases = {
        'other origin': (origin: 'https://example.com', isMainFrame: true),
        'child frame': (origin: 'http://localhost:5173', isMainFrame: false),
      };
      for (final MapEntry(:key, :value) in cases.entries) {
        final replies = await _send(
          handler,
          {'requestId': 'p1'},
          origin: value.origin,
          isMainFrame: value.isMainFrame,
        );

        expect(replies, [
          {
            'requestId': 'p1',
            // The key stays in the payload (as null) so pages can tell
            // "unknown" apart from "off".
            'screenReader': null,
            'boldText': true,
            'highContrast': true,
            'reduceMotion': true,
            'invertColors': true,
            'textScale': 2.0,
          },
        ], reason: key);
      }
    });
  });

  group('tts bridge', () {
    final handler = TtsMessageHandler();
    late _FakeTtsEngine engine;

    setUp(() {
      TtsMessageHandler.resetForTesting();
      engine = _FakeTtsEngine(messenger);
    });
    tearDown(() {
      engine.dispose();
      messenger.setMockMethodCallHandler(_FakeTtsEngine.channel, null);
    });

    Map<String, Object?> event(
      String requestId,
      String type, [
      String? error,
    ]) => {'requestId': requestId, 'event': type, 'error': ?error};

    test('request speaks short text and replies start then done', () async {
      final replies = await _send(handler, {
        'requestId': 't1',
        'action': 'speak',
        'text': '  你好，歡迎使用。  ',
        'lang': 'zh-TW',
      });

      expect(replies, [event('t1', 'start'), event('t1', 'done')]);
      expect(engine.spoken, ['你好，歡迎使用。']);
      expect(engine.callsTo('awaitSpeakCompletion').single.arguments, true);
      expect(engine.callsTo('setLanguage').single.arguments, 'zh-TW');
      expect(
        engine.callsTo('setSpeechRate').single.arguments as double,
        closeTo(0.5, 1e-9),
      );
    });

    test('action defaults to speak and lang defaults to zh-TW', () async {
      final replies = await _send(handler, {'requestId': 't2', 'text': '你好'});

      expect(replies, [event('t2', 'start'), event('t2', 'done')]);
      expect(engine.callsTo('isLanguageAvailable').single.arguments, 'zh-TW');
    });

    test('configures the engine once across requests', () async {
      await _send(handler, {'requestId': 'c1', 'text': '一'});
      await _send(handler, {'requestId': 'c2', 'text': '二'});

      expect(engine.callsTo('awaitSpeakCompletion'), hasLength(1));
      expect(engine.callsTo('setVolume'), hasLength(1));
      expect(engine.callsTo('setPitch'), hasLength(1));
    });

    test('maps Web Speech rate to the flutter_tts speech rate', () async {
      // (rate sent by the page, speech rate expected by flutter_tts)
      const List<(Object?, double)> expectedRates = [
        (0.9, 0.45),
        (1.0, 0.5),
        (2, 1.0),
        (0.5, 0.25),
        // Clamped to what the engine accepts (0.5x to 2x of normal speed).
        (0.1, 0.25),
        (10, 1.0),
        (-3, 0.25),
        // Not a number: falls back to normal speed.
        ('1.5', 0.5),
        (null, 0.5),
        (true, 0.5),
      ];
      for (final (rate, expected) in expectedRates) {
        await _send(handler, {'requestId': 'rate', 'text': '你好', 'rate': rate});
        expect(
          engine.callsTo('setSpeechRate').last.arguments as double,
          closeTo(expected, 1e-9),
          reason: 'rate: $rate',
        );
      }
      // A request without rate behaves like normal speed.
      await _send(handler, {'requestId': 'rate', 'text': '你好'});
      expect(
        engine.callsTo('setSpeechRate').last.arguments as double,
        closeTo(0.5, 1e-9),
      );
    });

    test('setLanguage is only called when the language changes', () async {
      for (final lang in ['zh-TW', 'zh-TW', 'en-US', 'en-US', 'zh-TW']) {
        await _send(handler, {'requestId': 'l', 'text': 'hi', 'lang': lang});
      }

      expect(engine.callsTo('setLanguage').map((c) => c.arguments), [
        'zh-TW',
        'en-US',
        'zh-TW',
      ]);
    });

    test('language_unavailable when the engine lacks the language', () async {
      engine.languageAvailable = false;

      final replies = await _send(handler, {
        'requestId': 'u1',
        'text': '你好',
        'lang': 'xx-YY',
      });

      expect(replies, [event('u1', 'error', 'language_unavailable')]);
      expect(engine.callsTo('isLanguageAvailable').single.arguments, 'xx-YY');
      expect(engine.callsTo('setLanguage'), isEmpty);
      expect(engine.spoken, isEmpty);
    });

    test('empty_text for blank or missing text', () async {
      for (final message in [
        {'requestId': 'e1', 'text': ''},
        {'requestId': 'e1', 'text': ' \n\t '},
        {'requestId': 'e1'},
      ]) {
        expect(await _send(handler, message), [
          event('e1', 'error', 'empty_text'),
        ]);
      }
      expect(engine.spoken, isEmpty);
    });

    test('unknown action is rejected', () async {
      final replies = await _send(handler, {
        'requestId': 'k1',
        'action': 'pause',
      });

      expect(replies, [
        {'requestId': 'k1', 'ok': false, 'error': 'unknown_action'},
      ]);
      expect(engine.spoken, isEmpty);
    });

    test('engine_error when speak fails without being interrupted', () async {
      engine.speakResult = 0;

      final replies = await _send(handler, {'requestId': 'f1', 'text': '你好'});

      expect(replies, [
        event('f1', 'start'),
        event('f1', 'error', 'engine_error'),
      ]);
    });

    test('engine_error when the platform call throws', () async {
      engine.speakError = PlatformException(code: 'TtsError');

      final replies = await _send(handler, {'requestId': 'f2', 'text': '你好'});

      expect(replies, [
        event('f2', 'start'),
        event('f2', 'error', 'engine_error'),
      ]);
    });

    test(
      'engine_error when the engine reports an error mid-utterance',
      () async {
        engine.holdSpeech = true;
        final request = _Request(handler, {'requestId': 'f3', 'text': '你好'});
        await _untilTrue(() => engine.spoken.isNotEmpty);

        // flutter_tts 4.2.5 on Android never resolves speak() after onError,
        // so the handler has to rely on the error callback.
        await engine.deliverError('Error from TextToSpeech (speak) - -4');
        await request.done;

        expect(request.replies, [
          event('f3', 'start'),
          event('f3', 'error', 'engine_error'),
        ]);

        // The next request still works.
        engine.holdSpeech = false;
        expect(await _send(handler, {'requestId': 'f4', 'text': '再試一次'}), [
          event('f4', 'start'),
          event('f4', 'done'),
        ]);
      },
    );

    test('stop interrupts the speech in flight', () async {
      engine.holdSpeech = true;
      final speak = _Request(handler, {'requestId': 's1', 'text': '你好'});
      await _untilTrue(() => engine.spoken.isNotEmpty);

      final stop = _Request(handler, {'requestId': 's2', 'action': 'stop'});
      await Future.wait([speak.done, stop.done]);

      expect(speak.replies, [event('s1', 'start'), event('s1', 'stopped')]);
      expect(stop.replies, [
        {'requestId': 's2', 'ok': true},
      ]);
    });

    test('stop without any speech still replies ok', () async {
      expect(await _send(handler, {'requestId': 's3', 'action': 'stop'}), [
        {'requestId': 's3', 'ok': true},
      ]);
      expect(engine.callsTo('stop'), hasLength(1));
    });

    test('a newer speak request interrupts the previous one', () async {
      engine.holdSpeech = true;
      final first = _Request(handler, {'requestId': 'n1', 'text': '第一句'});
      await _untilTrue(() => engine.spoken.isNotEmpty);

      engine.holdSpeech = false;
      final second = _Request(handler, {'requestId': 'n2', 'text': '第二句'});
      await Future.wait([first.done, second.done]);

      expect(first.replies, [event('n1', 'start'), event('n1', 'stopped')]);
      expect(second.replies, [event('n2', 'start'), event('n2', 'done')]);
      expect(engine.spoken, ['第一句', '第二句']);
    });

    test('a newer request that fails validation still interrupts', () async {
      engine.holdSpeech = true;
      final first = _Request(handler, {'requestId': 'v1', 'text': '第一句'});
      await _untilTrue(() => engine.spoken.isNotEmpty);

      final second = _Request(handler, {'requestId': 'v2', 'text': ''});
      await Future.wait([first.done, second.done]);

      expect(first.replies, [event('v1', 'start'), event('v1', 'stopped')]);
      expect(second.replies, [event('v2', 'error', 'empty_text')]);
    });

    test('long text is spoken in order, one chunk at a time', () async {
      final text = '這是一個測試句子。' * 400; // 3600 characters
      final replies = await _send(handler, {'requestId': 'g1', 'text': text});

      expect(replies, [event('g1', 'start'), event('g1', 'done')]);
      expect(engine.spoken, hasLength(2));
      expect(engine.spoken.every((chunk) => chunk.length <= 3000), isTrue);
      expect(engine.spoken.join(), text);
    });

    test('stop between chunks prevents the remaining chunks', () async {
      final text = '${'甲' * 2999}。${'乙' * 100}。'; // two chunks
      engine.holdSpeech = true;
      final speak = _Request(handler, {'requestId': 'g2', 'text': text});
      await _untilTrue(() => engine.spoken.isNotEmpty);

      // The first chunk ends naturally in the same turn as the stop request.
      engine.finishSpeech();
      final stop = _Request(handler, {'requestId': 'g3', 'action': 'stop'});
      await Future.wait([speak.done, stop.done]);

      expect(engine.spoken, hasLength(1));
      expect(speak.replies, [event('g2', 'start'), event('g2', 'stopped')]);
      expect(stop.replies, [
        {'requestId': 'g3', 'ok': true},
      ]);
    });

    group('legacy contract (no requestId)', () {
      test('text replies true once speaking starts', () async {
        final replies = await _send(handler, {'text': '你好', 'lang': 'zh-TW'});

        expect(replies, [true]);
        expect(engine.spoken, ['你好']);
        expect(engine.callsTo('setLanguage').single.arguments, 'zh-TW');
        expect(
          engine.callsTo('setSpeechRate').single.arguments as double,
          closeTo(0.5, 1e-9),
        );
      });

      test('text without lang defaults to zh-TW', () async {
        expect(await _send(handler, {'text': '你好'}), [true]);
        expect(engine.callsTo('isLanguageAvailable').single.arguments, 'zh-TW');
      });

      test('stop replies true', () async {
        expect(await _send(handler, {'stop': true}), [true]);
        expect(engine.callsTo('stop'), hasLength(1));
        expect(engine.spoken, isEmpty);
      });

      test('empty text replies false without speaking', () async {
        for (final message in [
          {'text': ''},
          {'text': '   '},
          <String, Object?>{},
          null,
        ]) {
          expect(await _send(handler, message), [false]);
        }
        expect(engine.spoken, isEmpty);
      });

      test('unavailable language replies false without speaking', () async {
        engine.languageAvailable = false;

        expect(await _send(handler, {'text': '你好', 'lang': 'xx-YY'}), [false]);
        expect(engine.spoken, isEmpty);
      });

      test(
        'stop still interrupts a request that uses the new contract',
        () async {
          engine.holdSpeech = true;
          final speak = _Request(handler, {'requestId': 'm1', 'text': '你好'});
          await _untilTrue(() => engine.spoken.isNotEmpty);

          expect(await _send(handler, {'stop': true}), [true]);
          await speak.done;

          expect(speak.replies, [event('m1', 'start'), event('m1', 'stopped')]);
        },
      );
    });
  });

  group('splitTextForTts', () {
    test('keeps short text in one chunk', () {
      expect(splitTextForTts('你好。'), ['你好。']);
    });

    test('returns nothing for blank text', () {
      expect(splitTextForTts(''), isEmpty);
      expect(splitTextForTts(' \n\t '), isEmpty);
    });

    test('splits long text at the last sentence boundary within maxLength', () {
      const sentence = '這是一個測試句子。'; // 9 characters
      final text = sentence * 20; // 180 characters

      final chunks = splitTextForTts(text, maxLength: 100);

      // 11 whole sentences are 99 characters; the 12th would exceed 100.
      expect(chunks.first, sentence * 11);
      expect(chunks, hasLength(2));
      expect(chunks.every((chunk) => chunk.length <= 100), isTrue);
      expect(chunks.every((chunk) => chunk.endsWith('。')), isTrue);
      expect(chunks.join(), text);
    });

    for (final boundary in '。！？；.!?;\n'.split('')) {
      test(
        'treats ${boundary == '\n' ? r'\n' : boundary} as a sentence boundary',
        () {
          final text = 'aaaaa$boundary${'c' * 10}';

          expect(splitTextForTts(text, maxLength: 8), [
            'aaaaa$boundary'.trim(),
            'cccccccc',
            'cc',
          ]);
        },
      );
    }

    test('hard cuts when there is no sentence boundary', () {
      final chunks = splitTextForTts('a' * 250, maxLength: 100);

      expect(chunks.map((chunk) => chunk.length), [100, 100, 50]);
    });

    test('does not cut a surrogate pair in half', () {
      final text = '𠮷' * 7; // each character is two UTF-16 code units

      final chunks = splitTextForTts(text, maxLength: 5);

      expect(chunks.every((chunk) => chunk.length <= 5), isTrue);
      expect(
        chunks.every((chunk) => chunk.runes.length * 2 == chunk.length),
        isTrue,
      );
      expect(chunks.join(), text);
    });

    test('trims chunks and drops empty ones', () {
      expect(splitTextForTts('ab。\n\n\ncd。', maxLength: 3), ['ab。', 'cd。']);
      expect(splitTextForTts('  hello  '), ['hello']);
    });

    test('default maxLength keeps chunks under the 4000 character limit', () {
      final text = '短句子。' * 5000;

      final chunks = splitTextForTts(text);

      expect(chunks.length, greaterThan(1));
      expect(chunks.every((chunk) => chunk.length <= 3000), isTrue);
      expect(chunks.every((chunk) => chunk.isNotEmpty), isTrue);
      expect(chunks.join(), text);
    });
  });

  group('webViewTextZoom', () {
    test('follows a linear scaler', () {
      expect(webViewTextZoom(const TextScaler.linear(1.0)), 100);
      expect(webViewTextZoom(const TextScaler.linear(1.15)), 115);
      expect(webViewTextZoom(const TextScaler.linear(2.0)), 200);
    });

    test('never goes below 100 or above 300', () {
      expect(webViewTextZoom(const TextScaler.linear(0.8)), 100);
      expect(webViewTextZoom(const TextScaler.linear(0)), 100);
      expect(webViewTextZoom(const TextScaler.linear(4.0)), 300);
    });

    test('follows a nonlinear scaler that leaves 100sp unscaled', () {
      // Android 14+ font scaling maps 100sp to 100dp at every scale, which is
      // why measuring at 100 would always give 100%.
      const scaler = _NonlinearTextScaler();
      expect(scaler.scale(100), 100);

      expect(webViewTextZoom(scaler), 175);
    });
  });
}

/// Sends [message] to [handler] and returns every reply once it has finished.
Future<List<Object?>> _send(
  TPWebMessageHandler handler,
  Object? message, {
  String origin = 'http://localhost:5173',
  bool isMainFrame = true,
}) async {
  final request = _Request(
    handler,
    message,
    origin: origin,
    isMainFrame: isMainFrame,
  );
  await request.done;
  return request.replies;
}

/// A request that may still be in flight; collects the `data` of every reply.
class _Request {
  _Request(
    TPWebMessageHandler handler,
    Object? message, {
    String origin = 'http://localhost:5173',
    bool isMainFrame = true,
  }) {
    done = handler.handle(
      message: message,
      sourceOrigin: WebUri(origin),
      isMainFrame: isMainFrame,
      onReply: (reply) {
        final decoded = jsonDecode(reply.data) as Map;
        expect(decoded['name'], handler.name);
        replies.add(decoded['data']);
      },
    );
  }

  final List<Object?> replies = [];
  late final Future<void> done;
}

Future<void> _untilTrue(bool Function() condition) async {
  for (var i = 0; i < 200 && !condition(); i++) {
    await Future<void>.delayed(Duration.zero);
  }
  expect(condition(), isTrue, reason: 'condition was not met in time');
}

/// Stands in for the flutter_tts platform side, modelled on its Android
/// implementation: with `awaitSpeakCompletion(true)`, `speak` resolves with 1
/// when the utterance ends and with 0 when `stop` interrupts it.
class _FakeTtsEngine {
  _FakeTtsEngine(this._messenger) {
    _messenger.setMockMethodCallHandler(channel, _onCall);
  }

  static const MethodChannel channel = MethodChannel('flutter_tts');

  final TestDefaultBinaryMessenger _messenger;
  final List<MethodCall> calls = [];
  final List<String> spoken = [];

  bool languageAvailable = true;

  /// What `speak` resolves with when the utterance is not held.
  Object? speakResult = 1;

  /// Makes `speak` throw instead of resolving.
  PlatformException? speakError;

  /// Keeps utterances running until [finishSpeech] or a `stop` call.
  bool holdSpeech = false;

  Completer<int>? _speaking;

  Iterable<MethodCall> callsTo(String method) =>
      calls.where((call) => call.method == method);

  /// The utterance in flight ends by itself.
  void finishSpeech() {
    _speaking?.complete(1);
    _speaking = null;
  }

  /// Delivers a `speak.onError` callback from the platform side.
  Future<void> deliverError(String message) => _messenger.handlePlatformMessage(
    channel.name,
    channel.codec.encodeMethodCall(MethodCall('speak.onError', message)),
    (_) {},
  );

  void dispose() {
    _speaking?.complete(0);
    _speaking = null;
  }

  Future<Object?> _onCall(MethodCall call) async {
    calls.add(call);
    switch (call.method) {
      case 'isLanguageAvailable':
        return languageAvailable;
      case 'speak':
        // flutter_tts sends a map on Android and the bare text elsewhere
        // (including the host running these tests).
        final arguments = call.arguments;
        spoken.add(
          arguments is Map ? arguments['text'] as String : arguments as String,
        );
        if (speakError != null) throw speakError!;
        if (!holdSpeech) return speakResult;
        return (_speaking = Completer<int>()).future;
      case 'stop':
        _speaking?.complete(0);
        _speaking = null;
        return 1;
      default:
        return 1;
    }
  }
}

/// Maps 16 to 28 (a 1.75x scale) but leaves 100 untouched, like the Android 14
/// font scaling table does at large sizes.
class _NonlinearTextScaler extends TextScaler {
  const _NonlinearTextScaler();

  @override
  double scale(double fontSize) {
    const points = [(0.0, 0.0), (16.0, 28.0), (100.0, 100.0)];
    if (fontSize >= points.last.$1) return fontSize;
    for (var i = 1; i < points.length; i++) {
      final (x0, y0) = points[i - 1];
      final (x1, y1) = points[i];
      if (fontSize <= x1) return y0 + (y1 - y0) * (fontSize - x0) / (x1 - x0);
    }
    return fontSize;
  }

  @override
  double get textScaleFactor => scale(16) / 16;
}
