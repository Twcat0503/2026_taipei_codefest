import 'package:flutter/services.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:town_pass/service/asr_service.dart';
import 'package:town_pass/util/tp_web_view.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const channel = MethodChannel('town_pass/asr');
  final messenger =
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
  tearDown(() => messenger.setMockMethodCallHandler(channel, null));

  test(
    'only the same approved assistant origin may request microphone capture',
    () {
      final page = WebUri('http://127.0.0.1:5173/');
      final microphone = PermissionRequest(
        origin: WebUri('http://127.0.0.1:5173'),
        resources: [PermissionResourceType.MICROPHONE],
      );
      expect(canRequestAssistantMicrophone(microphone, page), isTrue);
      expect(
        canRequestAssistantMicrophone(
          microphone,
          WebUri('https://other.example'),
        ),
        isFalse,
      );
      expect(canRequestAssistantMicrophone(microphone, null), isFalse);
      expect(
        canRequestAssistantMicrophone(
          PermissionRequest(
            origin: WebUri('https://other.example'),
            resources: [PermissionResourceType.MICROPHONE],
          ),
          page,
        ),
        isFalse,
      );
      expect(
        canRequestAssistantMicrophone(
          PermissionRequest(
            origin: page,
            resources: [PermissionResourceType.CAMERA],
          ),
          page,
        ),
        isFalse,
      );
      expect(
        canRequestAssistantMicrophone(
          PermissionRequest(
            origin: page,
            resources: [
              PermissionResourceType.MICROPHONE,
              PermissionResourceType.CAMERA,
            ],
          ),
          page,
        ),
        isFalse,
      );
    },
  );
  test(
    'asks Android for microphone permission and propagates a denial',
    () async {
      String? method;
      messenger.setMockMethodCallHandler(channel, (call) async {
        method = call.method;
        return false;
      });
      expect(await AsrService.requestMicrophonePermission(), isFalse);
      expect(method, 'microphonePermission');
      messenger.setMockMethodCallHandler(channel, (_) async => true);
      expect(await AsrService.requestMicrophonePermission(), isTrue);
    },
  );
  test('a missing native method reports permission unavailable', () async {
    expect(await AsrService.requestMicrophonePermission(), isFalse);
  });
}
