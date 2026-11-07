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

  test('accepts report text with limits, rejects control characters', () {
    expect(
      sanitizePrefill({
        'title': '路燈故障',
        'description': '大安區和平東路二段100號前的路燈不亮\n好幾天了',
        'location': '大安區和平東路二段100號前',
      }),
      {
        'title': '路燈故障',
        'description': '大安區和平東路二段100號前的路燈不亮\n好幾天了',
        'location': '大安區和平東路二段100號前',
      },
    );
    expect(sanitizePrefill({'title': '一' * 41}), isNull);
    expect(sanitizePrefill({'description': '一' * 501}), isNull);
    expect(sanitizePrefill({'title': 'bad\u0000title'}), isNull);
    expect(sanitizePrefill({'title': '   '}), isNull);
  });

  test('embeds report text as JSON data, including quotes and script tags', () {
    final String script = prefillScript({
      'description': '他說"</script><script>alert(1)</script>',
    });
    expect(script, contains(r'\"</script><script>alert(1)</script>'));
    expect(script, contains('HTMLTextAreaElement'));
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
