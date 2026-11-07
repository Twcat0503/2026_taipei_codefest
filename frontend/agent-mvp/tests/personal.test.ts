import { describe, expect, it, vi } from 'vitest';
import { createAgentToolClient } from '../../../tools/townpass/src/agent-client';
import { AgentRunner } from '../src/agent/runner';
import { DemoModel } from '../src/agent/model';
import { followUps } from '../src/agent/follow-ups';
import { draftReport } from '../src/agent/skills/report-draft';
import { maskPhone, parseMember } from '../src/platform/member';
import { initialState, type ModelAdapter } from '../src/agent/types';

// The Town Pass account fixture shape (assets/mock_data/account.json).
const account = {
  realName: '金大森',
  idNo: 'A123456789',
  email: 'ist83903@bcaoo.com',
  phoneNo: '0932166777',
  birthday: '1988/12/12',
  residentAddress: '臺北市中山區吉林路 69 號 4 樓',
  addresses: [{ city: '臺北市', town: '中山區', priority: true }],
};
const realClient = () =>
  createAgentToolClient({ includeDemo: false, getLocation: async () => null });

describe('personal data the assistant can use', () => {
  it('reads every useful member field and checks formats', () => {
    expect(parseMember(account)).toEqual({
      idNo: 'A123456789',
      realName: '金大森',
      phone: '0932166777',
      email: 'ist83903@bcaoo.com',
      birthday: '1988-12-12',
      address: '臺北市中山區吉林路 69 號 4 樓',
      district: '中山區',
    });
    expect(parseMember({ ...account, idNo: 'bad' })).toBeNull();
    expect(parseMember({ ...account, phoneNo: '12345', email: 'nope' })).toMatchObject({
      phone: undefined,
      email: undefined,
    });
    expect(maskPhone('0932166777')).toBe('0932***777');
  });

  it('offers the home district first when location is unavailable', async () => {
    const state = initialState();
    await new AgentRunner(new DemoModel(), state, realClient())
      .run('附近的無障礙廁所')
      .catch(() => {});
    const choices = followUps(state, { homeDistrict: '中山區' })!;
    expect(choices.options[0]).toMatchObject({ request: '中山區' });
    expect(choices.options[0]!.label['zh-Hant-TW']).toBe('我家附近（中山區）');
    expect(choices.options.filter((o) => o.request === '中山區')).toHaveLength(1);
  });

  it('uses the home address when a report says "my front door"', () => {
    expect(draftReport('我家門口的路燈壞了', '臺北市中山區吉林路 69 號 4 樓').location).toBe(
      '臺北市中山區吉林路 69 號 4 樓',
    );
    // An explicit place still wins, and no home address means no guess.
    expect(draftReport('我家附近和平東路的路燈壞了', '某地址').location).toBe('和平東路');
    expect(draftReport('我家門口的路燈壞了').location).toBe('');
  });

  it('answers "my data" on the phone without asking the model', async () => {
    const complete = vi.fn<ModelAdapter['complete']>();
    const state = initialState();
    await new AgentRunner({ mode: 'local', complete }, state, realClient()).run('我的資料有哪些');
    expect(state.notice).toBe('profile');
    expect(complete).not.toHaveBeenCalled();
  });

  it('applies the accessibility preference to place lookups', async () => {
    const state = initialState();
    const runner = new AgentRunner(new DemoModel(), state, realClient());
    runner.preferences.accessible = true;
    await runner.run('大安區的廁所');
    const requested = state.traces.find((t) => t.event === 'tool_requested')?.detail ?? '';
    expect(requested).toContain('"accessible":true');
  });
});
