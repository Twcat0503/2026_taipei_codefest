import type { Locale, ToolRecord } from './types';
import { messages } from '../i18n';

export type ParkingSpace = 'disabled' | 'pregnancy';

/** Project verified fields into a short summary; keep every other field in details. */
export function parkingPresentation(
  record: ToolRecord,
  space: ParkingSpace | null,
  locale: Locale,
) {
  const t = messages[locale];
  const fields = record.fields ?? [];
  const find = (label: string) => fields.find((field) => field.label['zh-Hant-TW'] === label);
  const distance = find('距離');
  const address = find('地址');
  const counts = [
    ...(space !== 'pregnancy'
      ? [{ field: find('身障車位'), template: t.parkingDisabledCount }]
      : []),
    ...(space !== 'disabled'
      ? [{ field: find('孕婦優先車位'), template: t.parkingPregnancyCount }]
      : []),
  ];
  const summary = [
    distance?.value[locale].replace(/\s*公尺$/u, locale === 'en' ? ' m' : ' 公尺'),
    ...counts.map(({ field, template }) =>
      field
        ? template.replace(
            '{value}',
            locale === 'en' ? field.value[locale].replace(/\s*格$/u, '') : field.value[locale],
          )
        : '',
    ),
  ]
    .filter(Boolean)
    .join(' · ');
  const primary = new Set([distance, address, ...counts.map(({ field }) => field)]);
  return {
    summary,
    hasDistance: !!distance?.value[locale],
    address: address?.value[locale] ?? '',
    details: fields.filter((field) => !primary.has(field)),
  };
}

/** Speak only the first result, without reading fees, addresses, sources or follow-up menus. */
export function parkingReadout(
  records: ToolRecord[],
  space: ParkingSpace | null,
  locale: Locale,
  byDistance: boolean,
): string {
  const first = records[0];
  if (!first) return '';
  const view = parkingPresentation(first, space, locale);
  const template =
    byDistance && view.hasDistance
      ? messages[locale].parkingReadNearest
      : messages[locale].parkingReadFirst;
  const summary = view.hasDistance
    ? messages[locale].parkingReadDistance.replace('{summary}', () => view.summary)
    : view.summary;
  return template
    .replace('{name}', () => first.title[locale])
    .replace('{summary}', () =>
      summary
        ? `${locale === 'en' ? ', ' : '，'}${summary.replaceAll(' · ', locale === 'en' ? ', ' : '，')}`
        : '',
    );
}
