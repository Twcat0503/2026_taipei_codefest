import { describe, expect, it } from 'vitest';
import {
  CITIZEN_REPORT_FORM,
  REHAB_BUS_FORM,
  fillForm,
  formRequest,
  validateValues,
} from '../src/agent/skills/form-fill';
import type { ModelAdapter } from '../src/agent/types';

const fakeModel = (fields: unknown): ModelAdapter & { seen: unknown[] } => {
  const seen: unknown[] = [];
  return {
    mode: 'local',
    seen,
    async complete(input) {
      seen.push(input);
      return { calls: [{ id: '1', name: 'fill_form', arguments: { fields } }] };
    },
  };
};

describe('generic form filling', () => {
  it('drops values that do not fit the field type', () => {
    expect(
      validateValues(REHAB_BUS_FORM, {
        pickup: ' 台北車站 ',
        date: '2026/11/8',
        time: '15:00:00',
        wheelchair: '需要',
        companions: '兩',
        dropoff: '',
      }),
    ).toEqual({
      pickup: '台北車站',
      dropoff: '',
      date: '2026-11-08',
      time: '15:00',
      wheelchair: 'yes',
      companions: '2',
    });
    expect(
      validateValues(REHAB_BUS_FORM, {
        date: '明天',
        time: '下午',
        wheelchair: 'maybe',
        companions: 'many',
      }),
    ).toMatchObject({ date: '', time: '', wheelchair: '', companions: '' });
    expect(validateValues(CITIZEN_REPORT_FORM, { district: '板橋區' }).district).toBe('');
    expect(validateValues(CITIZEN_REPORT_FORM, { district: '大安' }).district).toBe('大安區');
  });

  it('keeps the first value per field, ignores unknown ids and fills missing ones with empty', async () => {
    const model = fakeModel([
      { id: 'title', value: '路燈故障' },
      { id: 'title', value: '第二個' },
      { id: 'secret', value: 'x' },
    ]);
    const { values } = await fillForm(model, CITIZEN_REPORT_FORM, '路燈壞了');
    expect(values).toEqual({ title: '路燈故障', description: '', location: '', district: '' });
  });

  it('sends the form as data with district options and the known context', async () => {
    const model = fakeModel([]);
    await fillForm(model, CITIZEN_REPORT_FORM, '我家門口很髒', {
      context: { memberAddress: '大安區復興南路一段390號' },
    });
    const body = JSON.parse(
      formRequest(CITIZEN_REPORT_FORM, '我家門口很髒', { memberAddress: 'x' }),
    );
    expect(
      body.form.fields.find((field: { id: string }) => field.id === 'district').options,
    ).toContain('大安區');
    expect(body.original_request).toBe('我家門口很髒');
    const input = model.seen[0] as {
      messages: { content: string }[];
      tools: { function: { name: string } }[];
    };
    expect(input.tools[0]!.function.name).toBe('fill_form');
    expect(input.messages.at(-1)!.content).toContain('member_address');
  });

  it('fails loudly when the model does not call fill_form', async () => {
    const model: ModelAdapter = { mode: 'local', complete: async () => ({ calls: [] }) };
    await expect(fillForm(model, REHAB_BUS_FORM, '明天')).rejects.toThrow('FILL_FORM_MISSING');
  });
});
