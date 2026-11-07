import { describe, expect, it } from 'vitest';
import { validateValues, type FormSpec } from '../src/agent/skills/form-fill';
import {
  emailsIn,
  guardValues,
  numbersIn,
  resolveDates,
  spokenDigits,
} from '../src/agent/skills/form-guard';
import { TOWNPASS_FORMS } from '../src/agent/skills/townpass-forms';

const form = (id: string) => TOWNPASS_FORMS.find((spec) => spec.id === id)!;
const run = (spec: FormSpec, values: Record<string, string>, request: string) =>
  validateValues(spec, guardValues(spec, values, { request, context: { today: '2026-11-12' } }));

describe('Town Pass forms', () => {
  it('has a spec for every form with unique field ids and options for choices', () => {
    expect(TOWNPASS_FORMS.length).toBeGreaterThanOrEqual(18);
    for (const spec of TOWNPASS_FORMS) {
      const ids = spec.fields.map((field) => field.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const field of spec.fields)
        if (field.type === 'select' || field.type === 'multiselect')
          expect(field.options?.length).toBeGreaterThan(1);
    }
  });

  it('reads spoken digits, e-mail, numbers and 民國 dates', () => {
    expect(spokenDigits('零九一二 三四五 六七八').replace(/\s/g, '')).toBe('0912345678');
    expect(spokenDigits('一個人')).toBe('一個人');
    expect(emailsIn('信箱是 wang 點 ming 小老鼠 gmail 點 com')).toEqual(['wang.ming@gmail.com']);
    expect(emailsIn('mail me at amy.lin at yahoo dot com dot tw')).toEqual([
      'amy.lin@yahoo.com.tw',
    ]);
    expect(numbersIn('倒了三盞，兩百公尺，2.5 米')).toEqual(expect.arrayContaining([3, 200, 2.5]));
    expect(resolveDates('我是民國五十年三月二日生的')).toEqual(['1961-03-02']);
    const ctx = { today: '2026-11-12 (Thursday)' };
    expect(resolveDates('前天', ctx)).toEqual(['2026-11-10']);
    expect(resolveDates('上週三', ctx)).toEqual(['2026-11-04']);
    expect(resolveDates('last Monday', ctx)).toEqual(['2026-11-02']);
    expect(resolveDates('我七十二年次、十月一號生日', ctx)).toEqual(['1983-10-01']);
  });

  it('keeps a choice the words back, maps synonyms, and drops guesses', () => {
    const police = form('police_case');
    expect(run(police, { your_role: '被害人' }, '我昨天被詐騙集團騙了五萬').your_role).toBe(
      '被害人',
    );
    expect(run(police, { your_role: '當事人' }, '我昨天被騙了五萬').your_role).toBe('被害人');
    expect(run(police, { your_role: '檢舉人' }, '昨天晚上在中山路').your_role).toBe('');
    const library = form('library_search');
    expect(run(library, { searchType: '著者' }, '找作者是張愛玲的書').searchType).toBe('著者');
    expect(run(library, { searchType: '全部' }, '幫我找張愛玲').searchType).toBe('');
    const counter = form('counter_calling');
    expect(run(counter, {}, '我要去萬華區戶政事務所抽號碼').location).toBe('萬華區戶政事務所');
  });

  it('reads several choices and respects 不是/沒有', () => {
    const disaster = form('disaster_report');
    expect(run(disaster, { casualties: '受困、失蹤' }, '有兩個人受困，一個人失蹤').casualties).toBe(
      '受困、失蹤',
    );
    expect(run(disaster, { casualties: '傷亡' }, '還好不是傷亡，只是有人受困').casualties).toBe(
      '受困',
    );
  });

  it('takes phone numbers, e-mail and reference numbers only from the words', () => {
    const contact = form('police_contact');
    const values = run(
      contact,
      { mobile_number: '0912345678', contact_number: '0912345678', mail: 'x@y.com' },
      '手機零九一二三四五六七八，家裡電話 02-2720-8889，信箱 lee 小老鼠 gmail 點 com',
    );
    expect(values).toMatchObject({
      mobile_number: '0912345678',
      contact_number: '0227208889',
      mail: 'lee@gmail.com',
    });
    const water = form('fee_water');
    expect(run(water, { water_number: '' }, '我的水號是 1-23-456789-0').water_number).toBe(
      '12345678900'.slice(0, 10),
    );
    expect(run(water, { water_number: '9876543210' }, '幫我繳水費').water_number).toBe('');
    const parking = form('fee_parking');
    expect(
      run(parking, { vehicle_type: '機車', plate_number: 'abc-1234' }, '我的摩托車 ABC-1234'),
    ).toEqual({
      vehicle_type: '機車',
      plate_number: 'ABC-1234',
    });
  });

  it('keeps a measured number only when it was said', () => {
    const lamp = form('disaster_streetlamp');
    expect(
      run(lamp, { street_lamp_fall: '3', street_lamp_lost: '5' }, '颱風吹倒了三盞路燈')
        .street_lamp_fall,
    ).toBe('3');
    expect(
      run(lamp, { street_lamp_fall: '3', street_lamp_lost: '5' }, '颱風吹倒了三盞路燈')
        .street_lamp_lost,
    ).toBe('');
  });
});
