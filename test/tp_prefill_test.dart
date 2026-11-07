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

  test('accepts disaster report details with their own limits', () {
    expect(
      sanitizePrefill({
        'location': '仁愛路四段',
        'desc': '靠近敦化南路口',
        'additional_disc': '路樹倒下擋住機車道',
      }),
      {'location': '仁愛路四段', 'desc': '靠近敦化南路口', 'additional_disc': '路樹倒下擋住機車道'},
    );
    expect(sanitizePrefill({'desc': '一' * 201}), isNull);
    expect(sanitizePrefill({'additional_disc': '一' * 501}), isNull);
  });

  test('embeds report text as JSON data, including quotes and script tags', () {
    final String script = prefillScript({
      'description': '他說"</script><script>alert(1)</script>',
    });
    expect(script, contains(r'\"</script><script>alert(1)</script>'));
    expect(script, contains('HTMLTextAreaElement'));
  });

  test('accepts contact details only in strict formats', () {
    expect(
      sanitizePrefill({
        'mobile_number': '0932166777',
        'mail': 'ist83903@bcaoo.com',
      }),
      {'mobile_number': '0932166777', 'mail': 'ist83903@bcaoo.com'},
    );
    expect(sanitizePrefill({'mobile_number': '02-27208889'}), isNull);
    expect(sanitizePrefill({'mail': 'not an email'}), isNull);
    expect(sanitizePrefill({'mail': '"><script>@x.io'}), isNull);
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

  test('is an async function body that reports fields it could not fill', () {
    final String script = prefillScript({'water_number': '1234567890'});
    expect(script.trimLeft(), startsWith('return new Promise('));
    expect(script, contains('resolve([])'));
    expect(script, contains('resolve(Object.keys(values).filter('));
  });

  test('names the fields that were not filled, never their values', () {
    expect(prefillFailureMessage(const []), isNull);
    expect(
      prefillFailureMessage(const ['water_number', 'tax_id']),
      '有些資料沒能自動帶入，請自行填寫：水號、身分證字號',
    );
    for (final String field in kPrefillFields) {
      expect(kPrefillFieldLabels, contains(field));
    }
  });
}
