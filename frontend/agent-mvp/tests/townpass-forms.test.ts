import { describe, expect, it } from 'vitest';
import { validateValues, type FormSpec } from '../src/agent/skills/form-fill';
import {
  emailsIn,
  findAddress,
  guardValues,
  numbersIn,
  numbersNear,
  resolveDates,
  splitAddress,
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

  it('splits an address over county / district / street, from home or said in full', () => {
    expect(splitAddress('中山區民生東路二段50號')).toEqual({
      county: '臺北市',
      town: '中山區',
      street: '民生東路二段50號',
    });
    expect(findAddress('我住在新北市板橋區文化路一段100號三樓')).toBe(
      '新北市板橋區文化路一段100號三樓',
    );
    expect(findAddress('住在大安區復興南路一段390號')).toBe('大安區復興南路一段390號');
    expect(findAddress('寄到我家')).toBe('');
    const contact = form('police_contact');
    const home = validateValues(
      contact,
      guardValues(
        contact,
        { city: '中山區民生東路二段50號' },
        {
          request: '地址就寄到我住的地方',
          context: { memberAddress: '中山區民生東路二段50號' },
        },
      ),
    );
    expect(home).toMatchObject({ county: '臺北市', city: '中山區', address: '民生東路二段50號' });
    expect(run(contact, { county: '臺北市' }, '地址是台中市西屯區台灣大道三段99號')).toMatchObject({
      county: '臺中市',
      city: '西屯區',
      address: '台灣大道三段99號',
    });
  });

  it('reads dates without a year as past for when something happened', () => {
    const ctx = { today: '2026-11-12 (Thursday)' };
    expect(resolveDates('十月三十日', ctx, 'past')).toEqual(['2026-10-30']);
    expect(resolveDates('十二月一日', ctx, 'past')).toEqual(['2025-12-01']);
    expect(resolveDates('星期一', ctx, 'past')).toEqual(['2026-11-09']);
    expect(resolveDates('星期一', ctx)).toEqual(['2026-11-16']);
    expect(run(form('police_case'), {}, '我十一月三號在中山路被搶').date_of_incident).toBe(
      '2026-11-03',
    );
  });

  it('reads the number next to its cue, and the last one after a correction', () => {
    expect(numbersNear('倒了兩支，還有一支不會亮', '亮').map((m) => m.value)).toEqual(['1']);
    const lamp = form('disaster_streetlamp');
    expect(
      run(lamp, { street_lamp_fall: '3', street_lamp_lost: '' }, '三盞路燈不亮，一盞倒了'),
    ).toMatchObject({ street_lamp_fall: '1', street_lamp_lost: '3' });
    const ticket = form('buy_ticket');
    expect(run(ticket, { adult: '3' }, '買三張全票，不對，兩張全票').adult).toBe('2');
    expect(run(ticket, { adult: '2' }, '全票兩張').adult).toBe('2');
  });

  it('keeps a location description only when it says where exactly', () => {
    const disaster = form('disaster_report');
    expect(
      run(
        disaster,
        { location: '基隆路一段', location_desc: '在7-11對面' },
        '基隆路一段失火了，在7-11對面',
      ).location_desc,
    ).toBe('在7-11對面');
    expect(
      run(
        disaster,
        { location: '基隆路一段', location_desc: '有一棟房子在冒火' },
        '基隆路一段有一棟房子在冒火',
      ).location_desc,
    ).toBe('');
  });

  it('picks the disaster category from what people call it', () => {
    const disaster = form('disaster_report');
    expect(run(disaster, { category: '' }, '我家樓下的房子失火了').category).toBe('建築物火災');
    expect(run(disaster, { category: '土石流' }, '山上有坍方，石頭滑下來').category).toBe(
      '土石崩落',
    );
    expect(run(disaster, { category: '' }, '整條巷子都停電了').category).toBe('電力停電');
  });
});
