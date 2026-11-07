import { describe, expect, it } from 'vitest';
import { AgentRunner, followUpPlace } from '../src/agent/runner';
import { initialState, type ModelAdapter, type ToolCall } from '../src/agent/types';
import { DemoToolClient, type ToolClient } from '../src/agent/tool-client';
import { domainTools } from '../src/agent/tools';
import { detectEmergency } from '../src/agent/skills/emergency';
import { destinationFor } from '../src/agent/skills/navigation';
import { landmarkDistrict } from '../src/agent/skills/landmarks';

/** A model that routes to `domain` and then proposes `call` (what a small model might do). */
function scripted(domain: string, call?: ToolCall): ModelAdapter {
  return {
    mode: 'local',
    async complete({ tools }) {
      if (tools[0]?.function.name === 'select_agent')
        return { calls: [{ id: 'r', name: 'select_agent', arguments: { domain } }] };
      return { calls: call ? [call] : [] };
    },
  };
}

const PLACE_SCHEMA = {
  type: 'object',
  properties: {
    keyword: { type: 'string' },
    area: { type: 'string' },
    near_me: { type: 'boolean' },
    accessible: { type: 'boolean' },
  },
  additionalProperties: false,
};

/** Place tools that record their arguments instead of looking anything up. */
function placeTools(calls: ToolCall[]): ToolClient {
  const names = ['find_nearby_toilets', 'find_nearby_parking', 'find_nearby_youbike'];
  const base = new DemoToolClient([...domainTools('services')]);
  return {
    async listTools(options) {
      const listed = await base.listTools(options);
      return {
        tools: [
          ...listed.tools,
          ...names.map((name) => ({ name, description: name, inputSchema: PLACE_SCHEMA })),
        ],
      };
    },
    async callTool(params, options) {
      calls.push({
        id: String(calls.length),
        name: params.name,
        arguments: { ...params.arguments },
      });
      // Only the arguments matter here; the lookup itself is not part of this test.
      if (names.includes(params.name)) throw new Error('RECORDED');
      return base.callTool(params, options);
    },
  };
}

async function placeCall(
  request: string,
  proposed: Record<string, unknown>,
  tool = 'find_nearby_toilets',
) {
  const calls: ToolCall[] = [];
  await new AgentRunner(
    scripted('places', { id: 'p', name: tool, arguments: proposed }),
    initialState(),
    placeTools(calls),
  )
    .run(request)
    .catch(() => {});
  return calls.find((call) => call.name.startsWith('find_nearby'));
}

describe('nearby places', () => {
  it('uses the phone position when no place is named, and drops a guessed district', async () => {
    const call = await placeCall('我要找無障礙廁所', { area: '中正區' });
    expect(call?.arguments).toMatchObject({ near_me: true, accessible: true });
    expect(call?.arguments.area).toBeUndefined();
  });

  it('searches a landmark’s district instead of the phone position', async () => {
    const call = await placeCall(
      '士林夜市附近的停車場',
      { area: '士林夜市', near_me: true },
      'find_nearby_parking',
    );
    expect(call?.arguments).toMatchObject({ area: '士林區' });
    expect(call?.arguments.near_me).toBeUndefined();
  });

  it('keeps a named district and only adds accessibility when it was asked for', async () => {
    const call = await placeCall('大安區的親子廁所', { area: '大安區', accessible: true });
    expect(call?.arguments.area).toBe('大安區');
    expect(call?.arguments.accessible).toBeUndefined();
  });

  it('knows well-known places', () => {
    expect(landmarkDistrict('台大醫院附近')).toBe('中正區');
    expect(landmarkDistrict('國父紀念館那邊')).toBe('信義區');
    expect(landmarkDistrict('我家附近')).toBe('');
  });

  it('does not treat bus or MRT times as a place search', async () => {
    const state = initialState();
    await new AgentRunner(
      scripted('places', { id: 'p', name: 'find_nearby_parking', arguments: { near_me: true } }),
      state,
      placeTools([]),
    ).run('捷運淡水線末班車幾點');
    expect(state.notice).toBe('unsupported');
  });
});

describe('emergencies', () => {
  it.each([
    ['我爸剛剛跌倒叫不醒', 'medical'],
    ['廚房一直冒黑煙', 'fire'],
    ['我老公一直打我', 'violence'],
    ['有人一直跟著我到家門口', 'police'],
    ['我不想活了', 'mental'],
    ['我想拿刀割自己', 'mental'],
  ])('%s → %s', (text, kind) => {
    expect(detectEmergency(text)).toBe(kind);
  });

  it.each([
    '我想看火災宣導影片',
    '上個月我家著火，已經處理完了，想問火災證明怎麼申請',
    '我媽前年中風，現在已經恢復，想問長照課程',
    '今天熱死了',
    '我爸中風以後要坐輪椅，找無障礙廁所',
  ])('not an emergency: %s', (text) => {
    expect(detectEmergency(text)).toBeNull();
  });

  it('lets the router catch what the rules miss, but not over a plain service request', async () => {
    const missed = initialState();
    await new AgentRunner(scripted('emergency'), missed, placeTools([])).run(
      '他整個人臉色發白一直發抖，叫他也不太理我',
    );
    expect(missed).toMatchObject({ notice: 'emergency', emergency: 'general' });

    const service = initialState();
    await new AgentRunner(scripted('emergency'), service, placeTools([]))
      .run('路燈壞了要陳情')
      .catch(() => {});
    expect(service.emergency).toBeNull();

    const joke = initialState();
    await new AgentRunner(scripted('emergency'), joke, placeTools([]))
      .run('熱死了')
      .catch(() => {});
    expect(joke.emergency).toBeNull();
  });
});

describe('routing words people use', () => {
  it.each([
    ['我媽的看病錢要怎麼付', 'fee_medical'],
    ['戶政那邊現在排到幾號', 'townpass_counter'],
    ['我想跟真人講話', 'call_1999'],
    ['家門口一直淹水', 'townpass_disaster'],
    ['我上個月的費用有沒有繳成功', 'fee_history'],
  ])('%s → %s', (text, id) => {
    expect(destinationFor(text)).toBe(id);
  });
});

describe('place follow-ups', () => {
  const parking = { tool: 'find_nearby_parking', area: '中正區', accessible: false };
  it.each([
    ['那廁所呢', parking, '中正區的廁所'],
    ['換成大安區', parking, '大安區的停車場'],
    ['要有無障礙的', parking, '中正區的無障礙停車場'],
    ['那我現在這邊呢', parking, '附近的停車場'],
    ['What about YouBike there?', parking, '中正區的YouBike 站'],
  ])('%s → %s', (text, last, expected) => {
    expect(followUpPlace(text, last)).toBe(expected);
  });

  it('leaves full new requests alone', () => {
    expect(followUpPlace('我想繳上個月的停車費，帳單在這裡', parking)).toBeNull();
    expect(followUpPlace('台北車站附近的無障礙廁所在哪裡', parking)).toBeNull();
  });
});

describe('pointing back at the last page', () => {
  it('opens the page offered in the previous turn', async () => {
    const state = initialState();
    const calls: ToolCall[] = [];
    const tools = placeTools(calls);
    const model: ModelAdapter = {
      mode: 'local',
      async complete({ tools: offered }) {
        if (offered[0]?.function.name === 'select_agent')
          return { calls: [{ id: 'r', name: 'select_agent', arguments: { domain: 'services' } }] };
        return {
          calls: [
            {
              id: 'n',
              name: 'open_official_service',
              arguments: { destination: 'services_maternity' },
            },
          ],
        };
      },
    };
    const runner = new AgentRunner(model, state, tools);
    state.lastDestination = 'services_maternity';
    await runner.run('那幫我打開那個').catch(() => {});
    expect(calls.at(-1)?.arguments.destination).toBe('services_maternity');
  });
});
