import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets('native shake acknowledgement reaches the device vibrator', (
    tester,
  ) async {
    await tester.pumpWidget(const SizedBox.shrink());
    const channel = MethodChannel('town_pass/feedback');
    expect(await channel.invokeMethod<bool>('shake'), isTrue);
    await Future<void>.delayed(const Duration(milliseconds: 250));
  });
}
