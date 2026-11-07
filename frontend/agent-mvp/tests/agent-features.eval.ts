/**
 * Beyond forms: routing to the right service, emergency detection, and nearby-place lookups.
 *
 *   FEATURE_EVAL_SET=routing|emergency|places pnpm test:model tests/agent-features.eval.ts
 *   FORM_EVAL_FILE=tests/agent-features.eval.ts FEATURE_EVAL_SET=places node scripts/form-fill-phone.js
 *
 * Conditions:
 * - rule: the deterministic code only (destinationFor / detectEmergency), no model.
 * - model: the model alone (a plain select over the choices; for places, the specialist's raw
 *   tool call before the runner's corrections).
 * - runner: the app's real pipeline (AgentRunner: router → specialist → rule corrections → tool),
 *   with tool calls recorded at the tool boundary.
 * Cases come from separate authors who did not see the code (tests/*-cases.ts).
 */
import { afterAll, expect, test } from 'vitest';
import { writeFileSync } from 'node:fs';
import { LocalModel } from '../src/agent/model';
import { AgentRunner } from '../src/agent/runner';
import { initialState } from '../src/agent/types';
import type { ModelAdapter, ToolCall } from '../src/agent/types';
import type { ToolClient } from '../src/agent/tool-client';
import { destinationFor } from '../src/agent/skills/navigation';
import { detectEmergency } from '../src/agent/skills/emergency';
import { fillForm, type FormSpec } from '../src/agent/skills/form-fill';
import { createAgentToolClient } from '../../../tools/townpass/src/agent-client';
import { ROUTING_CASES } from './routing-cases';
import { ROUTING_CASES_2 } from './routing-cases-2';
import { EMERGENCY_CASES } from './emergency-cases';
import { EMERGENCY_CASES_2 } from './emergency-cases-2';
import { PLACES_CASES } from './places-cases';
import { PLACES_CASES_2 } from './places-cases-2';

const SET = process.env.FEATURE_EVAL_SET || 'routing';
const MODEL_NAME = process.env.MODEL_NAME || 'qwen3:1.7b';
const API_KEY = process.env.MODEL_API_KEY;
const base = new LocalModel(
  process.env.MODEL_ENDPOINT || 'http://127.0.0.1:11434/v1/chat/completions',
  MODEL_NAME,
  Number(process.env.MODEL_TIMEOUT_MS || 60000),
  'json-schema',
  { getApiKey: () => API_KEY, ollamaHints: process.env.MODEL_OLLAMA_HINTS !== '0' },
);
// The runner caps each inference at the adapter's own limit; the phone app uses 90 s.
(base as ModelAdapter).requestTimeoutMs = Number(process.env.MODEL_TIMEOUT_MS || 60000);
const CONDITIONS = (process.env.FEATURE_EVAL_CONDITIONS || 'rule,model,runner').split(',');

/** 台北車站, standing in for the phone's GPS position. */
const HERE = { lat: 25.0478, lng: 121.517 };

/** The real tool client, with every call recorded before it runs. */
function recordingTools(calls: ToolCall[]): ToolClient {
  const real = createAgentToolClient({ includeDemo: false, getLocation: async () => HERE });
  return {
    listTools: (options) => real.listTools(options),
    async callTool(params, options) {
      calls.push({
        id: String(calls.length),
        name: params.name,
        arguments: { ...params.arguments },
      });
      return real.callTool(params, options);
    },
  };
}

/** The model, with every tool call it proposes recorded (before the runner corrects it). */
function recordingModel(proposed: ToolCall[]): ModelAdapter {
  return {
    mode: base.mode,
    async complete(input) {
      const result = await base.complete(input);
      proposed.push(...result.calls);
      return result;
    },
  };
}

type Row = Record<string, unknown> & { condition: string; request: string; correct: boolean };
const rows: Row[] = [];

// ---------- routing ----------

const DESTINATIONS: [string, string][] = [
  ['townpass_report', '有話要說'],
  ['townpass_disaster', '災情通報'],
  ['townpass_apply', '申辦服務'],
  ['townpass_counter', '臨櫃叫號'],
  ['townpass_library', '圖書借閱'],
  ['townpass_subscription', '市政訊息訂閱'],
  ['townpass_police', '警政服務（線上報案）'],
  ['townpass_coupon', '優惠與票券'],
  ['townpass_ticket_wallet', '票券錢包'],
  ['townpass_places', '找地點（YouBike、停車場、公廁）'],
  ['townpass_faq', '常見問題'],
  ['fee', '繳費'],
  ['fee_parking', '繳停車費'],
  ['fee_water', '繳水費'],
  ['fee_tax', '繳地方稅'],
  ['fee_tuition', '繳學雜費'],
  ['fee_housing', '繳國／社宅租金維管費'],
  ['fee_medical', '繳聯合醫院醫療費'],
  ['fee_maintenance', '繳平價住宅維護費'],
  ['fee_course', '繳公訓處自費課程'],
  ['fee_other', '其他繳費'],
  ['fee_scan', '掃碼繳費'],
  ['fee_history', '繳費紀錄'],
  ['services_disabled', '身障者相關服務與補助'],
  ['services_maternity', '孕婦相關服務與補助'],
  ['services_elderly', '長者相關服務與補助'],
  ['call_1999', '撥打 1999 市民熱線'],
  ['unsupported', '以上都不是'],
];
const ROUTE_FORM: FormSpec = {
  id: 'route',
  title: '台北通服務',
  fields: [
    {
      id: 'destination',
      label: '要帶民眾去的服務',
      type: 'select',
      options: DESTINATIONS.map(([, title]) => title),
    },
  ],
};
/** A read tool that answers in the chat counts as reaching that service. */
const TOOL_DESTINATION: Record<string, string> = {
  search_service_counters: 'townpass_counter',
  search_library_books: 'townpass_library',
  get_library_ranking: 'townpass_library',
  list_library_branches: 'townpass_library',
  list_library_notices: 'townpass_library',
  get_library_book: 'townpass_library',
  list_subscription_topics: 'townpass_subscription',
  search_faq: 'townpass_faq',
  search_perks: 'townpass_coupon',
  search_application_services: 'townpass_apply',
  find_nearby_youbike: 'townpass_places',
  find_nearby_toilets: 'townpass_places',
  find_nearby_parking: 'townpass_places',
  search_fee_types: 'fee',
  list_bills: 'fee',
};

async function route(
  condition: string,
  request: string,
): Promise<{ outcome: string; detail?: unknown }> {
  if (condition === 'rule') return { outcome: destinationFor(request) ?? '' };
  if (condition === 'model') {
    const { values } = await fillForm(base, ROUTE_FORM, request);
    const title = values.destination ?? '';
    return { outcome: DESTINATIONS.find(([, t]) => t === title)?.[0] ?? '' };
  }
  const calls: ToolCall[] = [];
  const state = initialState();
  await new AgentRunner(base, state, recordingTools(calls)).run(request).catch(() => {});
  const read = calls.find((call) => call.name !== 'open_official_service');
  const kind = read?.name === 'list_report_categories' ? read.arguments.kind : undefined;
  const outcome =
    state.navigation?.id ??
    (read
      ? read.name === 'list_report_categories'
        ? kind === 'disaster'
          ? 'townpass_disaster'
          : 'townpass_report'
        : (TOOL_DESTINATION[read.name] ?? read.name)
      : state.domain === 'unsupported' || state.notice === 'unsupported'
        ? 'unsupported'
        : '');
  return { outcome, detail: { domain: state.domain, notice: state.notice, calls } };
}

// ---------- emergency ----------

const KINDS: [string, string][] = [
  ['fire', '火災、濃煙或瓦斯外洩'],
  ['medical', '有人需要救護車（昏倒、呼吸困難、胸痛、大量流血、跌倒起不來）'],
  ['violence', '家暴或被照顧者施暴'],
  ['police', '正在發生的犯罪（搶劫、攻擊、闖入、跟蹤）'],
  ['mental', '想自殺或傷害自己'],
  ['none', '不是緊急情況'],
];
const EMERGENCY_FORM: FormSpec = {
  id: 'emergency',
  title: '緊急情況判斷',
  fields: [
    { id: 'kind', label: '這是哪一種緊急情況', type: 'select', options: KINDS.map(([, t]) => t) },
  ],
};

async function emergency(condition: string, request: string): Promise<string | null> {
  if (condition === 'rule') return detectEmergency(request);
  if (condition === 'runner') {
    // The app: rules first, then the router's emergency option as a backstop.
    const state = initialState();
    await new AgentRunner(base, state, recordingTools([])).run(request).catch(() => {});
    return state.emergency;
  }
  const { values } = await fillForm(base, EMERGENCY_FORM, request);
  const kind = KINDS.find(([, t]) => t === values.kind)?.[0];
  if (condition === 'model') return kind && kind !== 'none' ? kind : null;
  // rule+model: the rule first (instant), the model only as a backstop when the rule says no.
  return detectEmergency(request) ?? (kind && kind !== 'none' ? kind : null);
}

// ---------- places ----------

const PLACE_TOOLS = ['find_nearby_youbike', 'find_nearby_toilets', 'find_nearby_parking'];
async function place(request: string) {
  const calls: ToolCall[] = [];
  const proposed: ToolCall[] = [];
  const state = initialState();
  await new AgentRunner(recordingModel(proposed), state, recordingTools(calls))
    .run(request)
    .catch(() => {});
  const summarize = (list: ToolCall[]) => {
    const call = list.filter((c) => PLACE_TOOLS.includes(c.name)).at(-1);
    return {
      tool: call?.name ?? 'none',
      area: typeof call?.arguments.area === 'string' ? call.arguments.area : '',
      near_me: call?.arguments.near_me === true,
      accessible: call?.arguments.accessible === true,
    };
  };
  return { model: summarize(proposed), runner: summarize(calls), domain: state.domain };
}

// ---------- suites ----------

// routing2: a second set written after the destination wording was broadened.
if (SET === 'routing' || SET === 'routing2')
  for (const condition of CONDITIONS)
    for (const item of SET === 'routing' ? ROUTING_CASES : ROUTING_CASES_2)
      test(`routing · ${condition} · ${item.request}`, async () => {
        const start = performance.now();
        let outcome = '';
        let detail: unknown;
        let error: string | undefined;
        try {
          ({ outcome, detail } = await route(condition, item.request));
        } catch (cause) {
          error = String(cause);
        }
        rows.push({
          condition,
          request: item.request,
          tag: item.tag,
          expected: item.expected,
          outcome,
          detail,
          error,
          correct: item.expected.includes(outcome),
          elapsedMs: Math.round(performance.now() - start),
        });
        expect(error === undefined || !error.includes('TypeError')).toBe(true);
      });

// emergency2: a second set written after the rules were revised, to check them fairly.
if (SET === 'emergency' || SET === 'emergency2')
  for (const condition of CONDITIONS)
    for (const item of SET === 'emergency' ? EMERGENCY_CASES : EMERGENCY_CASES_2)
      test(`emergency · ${condition} · ${item.request}`, async () => {
        const start = performance.now();
        let outcome: string | null = null;
        let error: string | undefined;
        try {
          outcome = await emergency(condition, item.request);
        } catch (cause) {
          error = String(cause);
        }
        rows.push({
          condition,
          request: item.request,
          tag: item.tag,
          expected: item.expected,
          outcome,
          error,
          correct: outcome === item.expected || (outcome === 'general' && item.expected !== null),
          flagged: outcome !== null,
          elapsedMs: Math.round(performance.now() - start),
        });
      });

// places2: a second set written after the landmark/area/accessibility fixes.
if (SET === 'places' || SET === 'places2')
  // One run per case: the model's own call and the runner's corrected call are both recorded.
  // FEATURE_EVAL_FROM=n: start at case n, to finish a run the phone cut short.
  for (const item of (SET === 'places' ? PLACES_CASES : PLACES_CASES_2).slice(
    Number(process.env.FEATURE_EVAL_FROM || 0),
  ))
    test(`places · ${item.request}`, async () => {
      const start = performance.now();
      let got: Awaited<ReturnType<typeof place>> | undefined;
      let error: string | undefined;
      try {
        got = await place(item.request);
      } catch (cause) {
        error = String(cause);
      }
      const elapsedMs = Math.round(performance.now() - start);
      const e = item.expected;
      const none = e.tool === 'none';
      for (const condition of ['model', 'runner'] as const) {
        const call = got?.[condition];
        const fields = {
          tool: call?.tool === e.tool,
          area: none || e.area.includes(call?.area ?? ''),
          near_me: none || call?.near_me === e.near_me,
          accessible: none || call?.accessible === e.accessible,
        };
        rows.push({
          condition,
          request: item.request,
          tag: item.tag,
          expected: e,
          got: call,
          fields,
          error,
          correct: Object.values(fields).every(Boolean),
          elapsedMs,
        });
      }
    });

afterAll(() => {
  const by = new Map<string, Row[]>();
  for (const row of rows) by.set(row.condition, [...(by.get(row.condition) ?? []), row]);
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0);
  const summary = [...by].map(([condition, group]) => {
    const out: Record<string, unknown> = {
      condition,
      cases: group.length,
      correct: pct(group.filter((row) => row.correct).length, group.length),
      medianMs: group.map((row) => Number(row.elapsedMs)).sort((a, b) => a - b)[
        Math.floor(group.length / 2)
      ],
    };
    if (SET.startsWith('emergency')) {
      const real = group.filter((row) => row.expected !== null);
      const calm = group.filter((row) => row.expected === null);
      out.caught = `${real.filter((row) => row.flagged).length}/${real.length}`;
      out.falseAlarms = `${calm.filter((row) => row.flagged).length}/${calm.length}`;
    }
    if (SET.startsWith('places'))
      for (const field of ['tool', 'area', 'near_me', 'accessible'])
        out[field] = pct(
          group.filter((row) => (row.fields as Record<string, boolean>)[field]).length,
          group.length,
        );
    return out;
  });
  console.table(summary);
  writeFileSync(
    process.env.FORM_EVAL_OUT || `feature-eval.${SET}.json`,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        set: SET,
        model: MODEL_NAME,
        host: process.env.MODEL_HOST || 'Mac',
        summary,
        rows,
      },
      null,
      2,
    ) + '\n',
  );
});
