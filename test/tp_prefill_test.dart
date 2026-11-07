import 'package:flutter_test/flutter_test.dart';
import 'package:town_pass/util/tp_prefill.dart';

void main() {
  test('keeps only allowlisted fields with safe values', () {
    expect(
      sanitizePrefill({
        'water_number': '1234567890',
        'tax_id': 'A123456789',
        'password': 'secret',
        'office': '仁愛',
      }),
      {'water_number': '1234567890', 'tax_id': 'A123456789'},
    );
    expect(sanitizePrefill({'water_number': "1');alert(1);//"}), isNull);
    expect(sanitizePrefill({'water_number': 1234567890}), isNull);
    expect(sanitizePrefill('water_number=1'), isNull);
    expect(sanitizePrefill(null), isNull);
  });

  test('fills only Town Pass in-app service pages', () {
    expect(
      canPrefill(
        Uri.parse(
          'https://taipei-pass-service.vercel.app/fee-payment/detail/fee-6/',
        ),
      ),
      isTrue,
    );
    expect(canPrefill(Uri.parse('https://pay.taipei/')), isFalse);
    expect(
      canPrefill(
        Uri.parse('https://taipei-pass-service.vercel.app.evil.test/'),
      ),
      isFalse,
    );
    expect(
      canPrefill(Uri.parse('http://taipei-pass-service.vercel.app/')),
      isFalse,
    );
    expect(canPrefill(null), isFalse);
  });

  test('embeds values as JSON data, not code', () {
    final String script = prefillScript({'water_number': '1234567890'});
    expect(script, contains('{"water_number":"1234567890"}'));
    expect(script, contains("dispatchEvent(new Event('input'"));
  });
}
