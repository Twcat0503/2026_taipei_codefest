import 'package:flutter_test/flutter_test.dart';
import 'package:town_pass/util/tp_external_link.dart';

void main() {
  test('Google Maps intent link becomes its https URL for the map app', () {
    // Captured on a Pixel: what Google Maps redirects to inside a WebView.
    final Uri intent = Uri.parse(
      'intent://www.google.com/maps/search/?api=1&query=25.03617122545939,121.54293548955357'
      '&entry=ml&utm_campaign=ml-ardl-wv&coh=230964#Intent;scheme=https;'
      'package=com.google.android.apps.maps;S.browser_fallback_url='
      'https%3A%2F%2Fwww.google.com%2Fmaps%2Fsearch%2F%3Fapi%3D1;end;',
    );
    expect(
      externalTarget(intent).toString(),
      'https://www.google.com/maps/search/?api=1&query=25.03617122545939,121.54293548955357'
      '&entry=ml&utm_campaign=ml-ardl-wv&coh=230964',
    );
  });

  test('intent without a web scheme falls back to its browser URL', () {
    final Uri intent = Uri.parse(
      'intent://scan/#Intent;scheme=zxing;package=com.example;'
      'S.browser_fallback_url=https%3A%2F%2Fexample.org%2Fscan;end;',
    );
    expect(externalTarget(intent).toString(), 'https://example.org/scan');
  });

  test('only dial, mail and map schemes are handed to the system', () {
    expect(externalTarget(Uri.parse('tel:1999')).toString(), 'tel:1999');
    expect(externalTarget(Uri.parse('geo:25.03,121.54')), isNotNull);
    expect(externalTarget(Uri.parse('market://details?id=x')), isNull);
    expect(
      externalTarget(Uri.parse('intent://x#Intent;scheme=zxing;end;')),
      isNull,
    );
  });

  test('web schemes stay inside the WebView', () {
    expect(isWebScheme('https'), isTrue);
    expect(isWebScheme('about'), isTrue);
    expect(isWebScheme('intent'), isFalse);
    expect(isWebScheme('tel'), isFalse);
  });
}
