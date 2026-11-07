import { DemoToolClient, type ToolClient } from './tool-client';
import { routerPrompt, specialistPrompt } from './prompts';
import {
  NAVIGATION_TOOL,
  ToolCallError,
  allowedTools,
  domainTools,
  executeReadTool,
  routingTool,
} from './tools';
import { CATALOG_TOOL, catalogKeyword, destinationFor } from './skills/navigation';
import { EMERGENCY_NUMBERS, JOKE, detectEmergency } from './skills/emergency';

/** Words that make an exaggeration real again: 救命、快叫救護車. */
const NOW_DANGER = /救命|快叫|救護車|報警|help/i;
import { normalizeRequest } from './skills/normalize';
import { landmarkDistrict } from './skills/landmarks';

const TAIPEI_DISTRICTS = [
  '中正區',
  '大同區',
  '中山區',
  '松山區',
  '大安區',
  '萬華區',
  '信義區',
  '士林區',
  '北投區',
  '內湖區',
  '南港區',
  '文山區',
];
import {
  billIntentTool,
  billSkill,
  isBillSelection,
  parseBillOutcome,
  type BillSelection,
} from './skills/bills';
import {
  parseReportVision,
  visionInstruction,
  visionSystemPrompt,
  type ReportVision,
} from './skills/report-vision';
import type { Domain, Locale, Message, ModelAdapter, TaskState, ToolCall } from './types';

const ACCESSIBLE_PLACE =
  /無障礙|身障|身心障礙|輪椅|孕婦|懷孕|愛心|accessible|wheelchair|disab|pregnan/i;
/** Wording that makes a short request an explicit place lookup. */
const PLACE_WORDS =
  /YouBike|Ubike|微笑單車|單車|腳踏車|自行車|停車場|停車位|車位|公廁|廁所|洗手間|化妝室|toilets?|restrooms?|parking lot|bike/i;
/** "Around me": search from the phone's position. */
const NEAR_ME = /附近|最近|這裡|這邊|我在的|我現在的位置|nearby|nearest|near me|around here/i;
/** A place the person named (a station, road, park, landmark), so not "around me" by default. */
const NAMED_PLACE =
  /[一-鿿]{1,8}(?:站|路|街|大道|公園|夜市|醫院|大學|學校|廣場|商圈|市場|百貨|中心|館|寺|宮|山|橋|河濱)|101|\b(?:station|road|street|park|market|hospital)\b/i;
/** When the request names the kind of place, that kind wins over the model's pick. */
const PLACE_TOOL: [RegExp, string][] = [
  [/廁所|洗手間|化妝室|toilets?|restrooms?/i, 'find_nearby_toilets'],
  [/停車|車位|parking/i, 'find_nearby_parking'],
  [/youbike|ubike|單車|腳踏車|自行車|\bbikes?\b/i, 'find_nearby_youbike'],
];
/** Taipei districts: the Chinese short name, then its English spelling as people type it. */
const DISTRICTS: readonly (readonly [zh: string, en: RegExp])[] = [
  ['松山', /Songshan/i],
  ['信義', /Xinyi/i],
  ['大安', /Da['’]?an/i],
  ['中山', /Zhongshan/i],
  ['中正', /Zhongzheng/i],
  ['大同', /Datong/i],
  ['萬華', /Wanhua/i],
  ['文山', /Wenshan/i],
  ['南港', /Nangang/i],
  ['內湖', /Neihu/i],
  ['士林', /Shilin/i],
  ['北投', /Beitou/i],
];

/** Whether the user said the district the model picked: as 大安(區) or in English (Daan). */
function saidDistrict(request: string, area: unknown) {
  const name = typeof area === 'string' ? area.replace(/區$/, '') : '';
  return DISTRICTS.some(([zh, en]) => zh === name && (request.includes(zh) || en.test(request)));
}

/** Bound even adapters that ignore AbortSignal. Late responses never mutate state. */
async function bounded<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  parent: AbortSignal,
  timeoutMs: number,
): Promise<T> {
  parent.throwIfAborted();
  const child = new AbortController();
  const cancel = () => child.abort(parent.reason);
  parent.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => child.abort(new Error('OPERATION_TIMEOUT')), timeoutMs);
  let rejectAbort: (() => void) | undefined;
  try {
    return await Promise.race([
      operation(child.signal),
      new Promise<never>((_, reject) => {
        rejectAbort = () => reject(child.signal.reason);
        child.signal.addEventListener('abort', rejectAbort, { once: true });
        if (child.signal.aborted) rejectAbort();
      }),
    ]);
  } finally {
    clearTimeout(timer);
    parent.removeEventListener('abort', cancel);
    if (rejectAbort) child.signal.removeEventListener('abort', rejectAbort);
  }
}

/** Questions about what the assistant knows about the person; answered on the phone, no model. */
const PROFILE_QUESTION =
  /我的(基本)?(資料|個資|地址|電話|手機|信箱|email|生日|水號)|我住(在)?(哪|那)|你(知道|記得|有)(我|什麼).{0,6}(資料|事)|what do you know about me|my (profile|address|phone)/i;

/** True when `request` is a short district reply that answers the pending location question. */
export function fillsPendingLocation(state: TaskState, request: string) {
  return !!state.pendingLocation && /^(?:我在|在)?[一-鿿]{2,3}區[。！!]?$/u.test(request.trim());
}

export class AgentRunner {
  private controller: AbortController | null = null;
  /** A separate channel so a photo lookup can run (and be cancelled) from the draft card. */
  private visionController: AbortController | null = null;
  /** The person's own settings (from the on-phone profile); applied to place lookups. */
  preferences = { accessible: false };
  constructor(
    private model: ModelAdapter,
    private state: TaskState,
    private tools: ToolClient = new DemoToolClient([
      ...domainTools('library'),
      ...domainTools('services'),
      ...domainTools('bills'),
    ]),
    private toolTimeoutMs = 45000,
  ) {}

  cancel() {
    this.controller?.abort();
  }

  cancelVision() {
    this.visionController?.abort();
  }

  /**
   * Look at a report photo and return an editable draft (subject + description). Throws
   * VISION_UNAVAILABLE when the model is not multimodal, and VISION_NO_RESULT when the model
   * finds nothing reportable. The caller always shows the result for the person to confirm.
   */
  async describePhoto(image: string, locale: Locale): Promise<ReportVision> {
    if (!this.model.vision) throw new Error('VISION_UNAVAILABLE');
    if (this.visionController) throw new Error('VISION_RUNNING');
    const controller = new AbortController();
    this.visionController = controller;
    try {
      const raw = await bounded(
        (child) =>
          this.model.vision!({
            image,
            system: visionSystemPrompt(locale),
            instruction: visionInstruction(locale),
            signal: child,
          }),
        controller.signal,
        Math.min(120000, Math.max(45000, this.model.requestTimeoutMs ?? 45000)),
      );
      const draft = parseReportVision(raw);
      if (!draft) throw new Error('VISION_NO_RESULT');
      return draft;
    } finally {
      if (this.visionController === controller) this.visionController = null;
    }
  }

  run(request: string, onProgress: (stage: 'routing' | 'searching') => void = () => {}) {
    const pending = this.state.pendingLocation;
    // A short district reply fills the pending location slot; unrelated requests start fresh.
    if (pending && fillsPendingLocation(this.state, request)) {
      request = `${pending.request.replace(/附近|最近的?|nearby|nearest/gi, '')} ${request.trim()}`;
    }
    return this.execute(request, onProgress);
  }

  chooseBillCategory(
    category: BillSelection,
    onProgress: (stage: 'routing' | 'searching') => void = () => {},
  ) {
    if (!this.state.pendingBillCategory || !isBillSelection(category))
      throw new Error('NO_PENDING_CATEGORY');
    return this.execute('Selected bill category', onProgress, category);
  }

  retryBills(onProgress: (stage: 'routing' | 'searching') => void = () => {}) {
    if (
      !this.state.billQuery ||
      !['billAuth', 'billUnavailable', 'error', 'cancelled'].includes(this.state.notice)
    )
      throw new Error('NO_RETRY');
    return this.execute('Retry bill lookup', onProgress, this.state.billQuery.category);
  }

  async runTool(domain: Domain, name: string, args: Record<string, unknown>) {
    if (this.controller) throw new Error('TASK_RUNNING');
    if (this.state.draft) throw new Error('DRAFT_PENDING');
    const controller = new AbortController();
    this.controller = controller;
    this.state.records = [];
    this.state.bookIds = [];
    this.state.bookResults = [];
    this.state.source = null;
    this.state.failure = null;
    this.state.pendingLocation = null;
    this.state.navigation = null;
    this.state.lastTool = null;
    this.state.emergency = null;
    this.state.billResult = null;
    this.state.billQuery = null;
    this.state.pendingBillCategory = false;
    this.state.receipt = null;
    this.state.traces = [];
    this.state.domain = domain;
    const started = performance.now();
    const client: ToolClient = {
      listTools: (options) => this.tools.listTools(options),
      callTool: (params) =>
        bounded(
          (signal) => this.tools.callTool(params, { signal }),
          controller.signal,
          this.toolTimeoutMs,
        ),
    };
    try {
      const result = await executeReadTool(
        client,
        domain,
        { id: 'ui-action', name, arguments: args },
        this.state,
        controller.signal,
      );
      this.state.traces.push({
        id: 0,
        actor: 'executor',
        event: 'completed',
        detail: `${name}: ${result.total} ${result.source} records`,
        elapsedMs: Math.round(performance.now() - started),
      });
    } catch (error) {
      this.state.records = [];
      this.state.bookResults = [];
      this.state.bookIds = [];
      this.state.source = null;
      this.state.failure = error instanceof ToolCallError ? error.failure : null;
      this.state.notice = controller.signal.aborted ? 'cancelled' : 'error';
      throw error;
    } finally {
      this.controller = null;
    }
  }

  private async execute(
    request: string,
    onProgress: (stage: 'routing' | 'searching') => void,
    selectedCategory?: BillSelection,
  ) {
    if (this.controller) throw new Error('TASK_RUNNING');
    if (!request.trim() || request.length > 600) throw new Error('INVALID_INPUT');
    if (this.state.draft) throw new Error('DRAFT_PENDING');
    const pendingCategory = this.state.pendingBillCategory;
    const controller = new AbortController();
    this.controller = controller;
    const signal = controller.signal;
    const start = performance.now();
    this.state.traces = [];
    this.state.records = [];
    this.state.source = null;
    this.state.failure = null;
    this.state.pendingLocation = null;
    this.state.navigation = null;
    this.state.lastTool = null;
    this.state.emergency = null;
    this.state.domain = null;
    this.state.receipt = null;
    this.state.bookIds = [];
    this.state.bookResults = [];
    this.state.billResult = null;
    this.state.billQuery = null;
    this.state.pendingBillCategory = false;
    const trace = (actor: string, event: string, detail: string) => {
      this.state.traces.push({
        id: this.state.traces.length,
        actor,
        event,
        detail,
        elapsedMs: Math.round(performance.now() - start),
      });
    };
    const userMessage: Message = {
      role: 'user',
      content: JSON.stringify({
        original_request: request,
        ...(pendingCategory
          ? { task_context: 'Awaiting bill category. A new unrelated request may switch domains.' }
          : {}),
      }),
    };
    const complete = (
      messages: Message[],
      tools: Parameters<ModelAdapter['complete']>[0]['tools'],
    ) =>
      bounded(
        (child) => this.model.complete({ messages, tools, signal: child }),
        signal,
        Math.min(120000, Math.max(1000, this.model.requestTimeoutMs ?? 20000)),
      );
    // Rules read a normalized copy (Simplified characters, common typos); the model gets the original.
    const ruleText = normalizeRequest(request);
    try {
      // Emergencies are answered before any inference: call buttons, nothing else.
      const emergency = selectedCategory ? null : detectEmergency(ruleText);
      if (emergency) {
        this.state.emergency = emergency;
        this.state.notice = 'emergency';
        trace(
          'safety',
          'emergency',
          `${emergency}: offer ${EMERGENCY_NUMBERS[emergency].join(', ')}`,
        );
        return;
      }
      if (!selectedCategory && PROFILE_QUESTION.test(ruleText)) {
        this.state.notice = 'profile';
        trace('profile', 'local', 'Answered from data on this phone; nothing sent to the model.');
        return;
      }
      onProgress('routing');
      let domain: Domain = 'bills';
      if (!selectedCategory) {
        trace('router', 'started', 'Select one domain; original text retained.');
        const route = await complete(
          [{ role: 'system', content: routerPrompt }, userMessage],
          [routingTool],
        );
        signal.throwIfAborted();
        const call = route.calls[0];
        if (
          route.calls.length !== 1 ||
          call?.name !== 'select_agent' ||
          Object.keys(call.arguments).length !== 1 ||
          typeof call.arguments.domain !== 'string' ||
          !['library', 'services', 'perks', 'places', 'bills', 'emergency', 'unsupported'].includes(
            call.arguments.domain,
          )
        )
          throw new Error('INVALID_ROUTE');
        // The rules missed it but the router hears danger: offer the call buttons, nothing else.
        // A request that plainly names a city service (路燈壞了、樹倒了、繳費) is handled as that
        // service; the rules above already caught fires, collapses and violence.
        // Exaggeration (熱死了、嚇死我了) is not danger either.
        if (
          call.arguments.domain === 'emergency' &&
          !destinationFor(ruleText) &&
          !(JOKE.test(ruleText) && !NOW_DANGER.test(ruleText))
        ) {
          this.state.emergency = 'general';
          this.state.notice = 'emergency';
          trace('safety', 'emergency', `router: offer ${EMERGENCY_NUMBERS.general.join(', ')}`);
          return;
        }
        domain = (
          call.arguments.domain === 'emergency' ? 'services' : call.arguments.domain
        ) as Domain;
        // Small on-device models can confuse explicit place lookups with book search.
        // Keep book/report/application requests with the router; only correct short place lookups.
        const explicitPlace =
          ruleText.length <= 80 &&
          PLACE_WORDS.test(ruleText) &&
          // How to register, use or pay is a question about the service, not a place search.
          !/書|book|圖書|通報|陳情|報修|修繕|故障|申請|申辦|補助|怎麼|如何|註冊|會員|收費|繳|偷|搶|報案|遺失|report|application|how (do|to|can)|register|stolen|[「『“"]/i.test(
            ruleText,
          );
        if (explicitPlace && domain !== 'places') {
          trace('router', 'corrected', 'Explicit place lookup must use the places tools.');
          domain = 'places';
        }
        // The same models send a quoted book title to places.
        // A quote with no place, service or bill wording is a catalog lookup.
        if (
          domain === 'places' &&
          /[「『“"][^」』”"]+[」』”"]/u.test(ruleText) &&
          !PLACE_WORDS.test(ruleText) &&
          !/通報|陳情|報修|修繕|故障|申請|申辦|補助|繳|帳單|叫號|臨櫃|report|application|bill/i.test(
            ruleText,
          )
        ) {
          trace('router', 'corrected', 'Quoted titles without place words are book lookups.');
          domain = 'library';
        }
        // Bus and MRT times are not served; without a place kind they are not a place lookup.
        if (
          domain === 'places' &&
          !PLACE_TOOL.some(([pattern]) => pattern.test(ruleText)) &&
          /捷運|公車|末班|班次|到站|幾點|\b(bus|mrt|metro|train)\b/i.test(ruleText)
        ) {
          trace('router', 'corrected', 'Transit schedules are not a place lookup.');
          domain = 'unsupported';
        }
        // Opening Town Pass's own map is an in-app service, not another place lookup.
        if (domain !== 'services' && destinationFor(ruleText) === 'townpass_places') {
          trace('router', 'corrected', 'Opening the Town Pass map is an in-app service.');
          domain = 'services';
        }
        // Queue numbers are a service lookup, never a personal bill.
        if (domain === 'bills' && /叫號|臨櫃|號碼牌|櫃檯|queue|counter/i.test(ruleText)) {
          trace('router', 'corrected', 'Counter and queue requests belong to services.');
          domain = 'services';
        }
      }
      let available: Awaited<ReturnType<ToolClient['listTools']>> | null = null;
      const listAvailable = async () => {
        available ??= await bounded(
          (child) => this.tools.listTools({ signal: child }),
          signal,
          this.toolTimeoutMs,
        );
        signal.throwIfAborted();
        return available;
      };
      // A small router may give up on wording that clearly names an official service.
      if (
        domain === 'unsupported' &&
        destinationFor(ruleText) &&
        (await listAvailable()).tools.some((tool) => tool.name === NAVIGATION_TOOL)
      ) {
        trace('router', 'corrected', 'Explicit official-service wording belongs to services.');
        domain = 'services';
      }
      this.state.domain = domain;
      trace('router', 'selected', domain);
      if (domain === 'unsupported') {
        this.state.notice = 'unsupported';
        return;
      }
      // Without a bill tool (real mode) personal bills are only reachable on the official site.
      const billsViaOfficialSite =
        domain === 'bills' &&
        !selectedCategory &&
        !(await listAvailable()).tools.some((tool) => tool.name === 'list_bills');
      if (domain === 'bills' && !billsViaOfficialSite) {
        trace('skill', 'loaded', `${billSkill.id}@${billSkill.version}`);
        if (!selectedCategory) {
          const result = await complete(
            [{ role: 'system', content: billSkill.prompt }, userMessage],
            [billIntentTool],
          );
          signal.throwIfAborted();
          const decision = result.calls[0];
          const args = decision?.arguments;
          if (
            result.calls.length !== 1 ||
            decision?.name !== 'select_bill_query' ||
            !args ||
            Object.keys(args).length !== 3 ||
            !(
              isBillSelection(args.category) ||
              args.category === 'unknown' ||
              args.category === 'unsupported'
            ) ||
            typeof args.period !== 'string' ||
            !['current', 'unsupported'].includes(args.period) ||
            typeof args.action !== 'string' ||
            !['read', 'unsupported'].includes(args.action)
          )
            throw new Error('INVALID_BILL_INTENT');
          if (
            args.action === 'unsupported' ||
            args.period === 'unsupported' ||
            args.category === 'unsupported'
          ) {
            this.state.notice = 'billUnsupported';
            return;
          }
          // Small models may default to all; absence of a category must ask, not broaden scope.
          const broadLookupExplicit = /全部|所有|各種|\ball\b|\bevery\b/i.test(request);
          if (args.category === 'unknown' || (args.category === 'all' && !broadLookupExplicit)) {
            this.state.pendingBillCategory = true;
            this.state.notice = 'billCategory';
            return;
          }
          selectedCategory = args.category as BillSelection;
        }
        this.state.billQuery = { category: selectedCategory, period: 'current' };
      }
      onProgress('searching');
      const offeredTools = allowedTools(domain, (await listAvailable()).tools);
      if (!offeredTools.length) {
        if (domain === 'bills') {
          this.state.notice = 'billUnavailable';
          return;
        }
        // e.g. perks in real mode: no verified source, so say so instead of failing.
        trace('tools', 'none_available', `${domain}: no verified tool`);
        this.state.notice = 'unsupported';
        return;
      }
      trace('tools', 'tools_listed', offeredTools.map((tool) => tool.function.name).join(', '));
      if (domain === 'bills' && !billsViaOfficialSite) {
        const query = this.state.billQuery!;
        trace('bills', 'tool_requested', 'list_bills');
        const result = await bounded(
          (child) =>
            this.tools.callTool({ name: 'list_bills', arguments: { ...query } }, { signal: child }),
          signal,
          this.toolTimeoutMs,
        );
        signal.throwIfAborted();
        if (
          result.isError ||
          result.content.length !== 1 ||
          result.content[0]?.type !== 'text' ||
          result.content[0].text.length > 30000
        )
          throw new Error('TOOL_ERROR');
        const outcome = parseBillOutcome(JSON.parse(result.content[0].text), query);
        if ('error' in outcome) {
          this.state.notice = outcome.error === 'AUTH_REQUIRED' ? 'billAuth' : 'billUnavailable';
          trace('executor', 'needs_attention', outcome.error);
        } else {
          this.state.billResult = outcome;
          this.state.notice = outcome.records.length ? 'bills' : 'billsEmpty';
          trace(
            'executor',
            'completed',
            `${outcome.records.length} demo bills; no payment performed.`,
          );
        }
        return;
      }
      const offeredNames = offeredTools.map((tool) => tool.function.name);
      // Real mode: the only tools here open Town Pass services or official sites.
      const linksOnly = offeredNames.every((n) => n === NAVIGATION_TOOL || n === CATALOG_TOOL);
      const navigable = offeredNames.includes(NAVIGATION_TOOL);
      // Only a quoted title counts as a library request without book words; otherwise a small
      // router's "library" guess (e.g. for "read my ID number to me") must not open anything.
      const ruled =
        destinationFor(ruleText) ??
        (domain === 'library' && /[「『“"]/.test(request) ? 'townpass_library' : null);
      if (linksOnly && !ruled) {
        // Never send someone to an unrelated page because a small model had to pick one.
        trace('skill', 'no_destination', 'No service destination matches the request.');
        this.state.notice = 'unsupported';
        return;
      }
      let call: ToolCall;
      if (linksOnly && ruled === 'catalog' && offeredNames.includes(CATALOG_TOOL)) {
        call = { id: 'rule', name: CATALOG_TOOL, arguments: {} };
        trace('skill', 'navigation', 'Listing Town Pass in-app services.');
      } else if (linksOnly && navigable && ruled && ruled !== 'townpass_library') {
        // The destination is explicit; a second inference would only add latency.
        call = { id: 'rule', name: NAVIGATION_TOOL, arguments: { destination: ruled } };
        trace('skill', 'navigation', `Destination from explicit wording: ${ruled}`);
      } else {
        const response = await complete(
          [{ role: 'system', content: specialistPrompt(domain) }, userMessage],
          offeredTools,
        );
        signal.throwIfAborted();
        if (!response.calls.length) {
          if (!linksOnly || !navigable || !ruled) throw new Error('NO_TOOL_RESULT');
          response.calls = [{ id: 'rule', name: NAVIGATION_TOOL, arguments: {} }];
        }
        if (response.calls.length !== 1) throw new Error('ONE_TOOL_AT_A_TIME');
        call = response.calls[0]!;
      }
      if (call.name === NAVIGATION_TOOL) {
        if (ruled && ruled !== 'catalog' && call.arguments.destination !== ruled) {
          trace('skill', 'corrected', `Explicit wording selects ${ruled}.`);
          call.arguments.destination = ruled;
        }
        const keyword =
          call.arguments.destination === 'townpass_library'
            ? catalogKeyword(request, call.arguments.keyword)
            : undefined;
        if (keyword) call.arguments.keyword = keyword;
        else delete call.arguments.keyword;
      }
      // Explicit geographic/accessibility slots are user constraints, not model guesses.
      if (
        domain === 'places' &&
        ['find_nearby_youbike', 'find_nearby_parking', 'find_nearby_toilets'].includes(call.name)
      ) {
        const named = PLACE_TOOL.find(([pattern]) => pattern.test(ruleText))?.[1];
        if (named && named !== call.name) {
          trace('places', 'corrected', `The request names ${named}.`);
          call.name = named;
        }
        const districts = DISTRICTS.map(([zh]) => `${zh}區`).filter((name) =>
          ruleText.includes(name),
        );
        const nearby = NEAR_ME.test(ruleText);
        // 「Daan District」「大安」: a district said by its short or English name.
        const spoken = !districts.length && saidDistrict(ruleText, call.arguments.area);
        if (districts.length === 1) {
          call.arguments.area = districts[0]!;
          if (!nearby) delete call.arguments.near_me;
        } else if (!districts.length) {
          if (saidDistrict(ruleText, call.arguments.area)) {
            // Said by short or English name only: treat it like a named district.
            if (!nearby) delete call.arguments.near_me;
          } else {
            // The model may only keep a district the user said; few-shot examples leak into area.
            delete call.arguments.area;
            if (nearby) call.arguments.near_me = true;
          }
        }
        // No place named at all (「我要找無障礙廁所」): search around the phone (GPS). A district
        // the model guessed without the person naming any place is dropped, so a guess never
        // replaces their real location. Without a location the runner asks for a district.
        // A well-known place (士林夜市、台大醫院) searches its district, not the phone's position.
        const landmark = districts.length || spoken ? '' : landmarkDistrict(ruleText);
        if (landmark) {
          call.arguments.area = landmark;
          delete call.arguments.near_me;
        }
        // area only takes a Taipei district; a landmark name or a guess (台北車站、士林) is fixed or dropped.
        if (typeof call.arguments.area === 'string' && !districts.length && !landmark && !spoken) {
          const area = call.arguments.area;
          const district = TAIPEI_DISTRICTS.find(
            (name) => area === name || area === name.slice(0, 2),
          );
          if (district && ruleText.includes(district.slice(0, 2))) call.arguments.area = district;
          else delete call.arguments.area;
        }
        // Any district mention counts as a place, also 「信義的」 or 「Xinyi」 without 區.
        const mentionsDistrict = DISTRICTS.some(
          ([zh, en]) => ruleText.includes(zh) || en.test(ruleText),
        );
        const namesPlace =
          districts.length > 0 ||
          spoken ||
          mentionsDistrict ||
          !!landmark ||
          NAMED_PLACE.test(ruleText);
        if (!namesPlace && typeof call.arguments.area === 'string') delete call.arguments.area;
        if ((NEAR_ME.test(ruleText) && !landmark) || (!namesPlace && !call.arguments.area))
          call.arguments.near_me = true;
        // Accessibility is a structured filter, not free text: names rarely contain it.
        if (call.name !== 'find_nearby_youbike') {
          const keyword = typeof call.arguments.keyword === 'string' ? call.arguments.keyword : '';
          if (ACCESSIBLE_PLACE.test(keyword)) delete call.arguments.keyword;
          // Only when they asked (or set it in their profile); never a model guess.
          if (ACCESSIBLE_PLACE.test(ruleText) || this.preferences.accessible)
            call.arguments.accessible = true;
          else delete call.arguments.accessible;
        }
        if (call.name === 'find_nearby_parking') {
          if (/身障|身心障礙|輪椅|disabled|wheelchair/i.test(ruleText))
            call.arguments.parking_space = 'disabled';
          else if (/孕婦|懷孕|pregnan/i.test(ruleText)) call.arguments.parking_space = 'pregnancy';
          else delete call.arguments.parking_space;
        }
      }
      trace(domain, 'tool_requested', `${call.name} ${JSON.stringify(call.arguments)}`);
      // Only the bounded transport can finish the lookup; no final LLM completion pass.
      const client: ToolClient = {
        listTools: (options) => this.tools.listTools(options),
        callTool: (params) =>
          bounded(
            (child) => this.tools.callTool(params, { signal: child }),
            signal,
            this.toolTimeoutMs,
          ),
      };
      const result = await executeReadTool(client, domain, call, this.state, signal);
      trace('executor', 'completed', `${call.name}: ${result.total} ${result.source} records`);
    } catch (error) {
      this.state.records = [];
      this.state.source = null;
      const failure = error instanceof ToolCallError ? error.failure : null;
      this.state.failure = failure;
      if (!signal.aborted && failure?.code === 'LOCATION_UNAVAILABLE')
        this.state.pendingLocation = { request };
      this.state.bookIds = [];
      this.state.bookResults = [];
      this.state.billResult = null;
      this.state.notice = signal.aborted
        ? 'cancelled'
        : failure?.code === 'LOCATION_UNAVAILABLE'
          ? 'needLocation'
          : this.state.domain === 'bills'
            ? 'billUnavailable'
            : 'error';
      trace(
        'runtime',
        signal.aborted ? 'cancelled' : 'failed',
        signal.aborted
          ? 'USER_CANCELLED'
          : (failure?.code ?? (error instanceof Error ? error.message : 'MODEL_OR_TOOL_ERROR')),
      );
      throw error;
    } finally {
      this.controller = null;
    }
  }
}
