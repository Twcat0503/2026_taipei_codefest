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
import {
  billIntentTool,
  billSkill,
  isBillSelection,
  parseBillOutcome,
  type BillSelection,
} from './skills/bills';
import type { Domain, Message, ModelAdapter, TaskState, ToolCall } from './types';

const ACCESSIBLE_PLACE = /無障礙|身障|身心障礙|輪椅|孕婦|愛心|accessible|wheelchair|disab|pregnan/i;

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

export class AgentRunner {
  private controller: AbortController | null = null;
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

  run(request: string, onProgress: (stage: 'routing' | 'searching') => void = () => {}) {
    const pending = this.state.pendingLocation;
    // A short district reply fills the pending location slot; unrelated requests start fresh.
    if (pending && /^(?:我在|在)?[一-鿿]{2,3}區[。！!]?$/u.test(request.trim())) {
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
    try {
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
          !['library', 'services', 'perks', 'places', 'bills', 'unsupported'].includes(
            call.arguments.domain,
          )
        )
          throw new Error('INVALID_ROUTE');
        domain = call.arguments.domain as Domain;
        // Small on-device models can confuse explicit place lookups with book search.
        // Keep book/report/application requests with the router; only correct short place lookups.
        const explicitPlace =
          request.length <= 80 &&
          /YouBike|Ubike|停車場|公廁|廁所|toilets?|restrooms?|parking lot/i.test(request) &&
          !/書|book|圖書|通報|陳情|報修|修繕|故障|申請|申辦|補助|report|application|[「『“"]/i.test(
            request,
          );
        if (explicitPlace && domain !== 'places') {
          trace('router', 'corrected', 'Explicit place lookup must use the places tools.');
          domain = 'places';
        }
        // Opening Town Pass's own map is an in-app service, not another place lookup.
        if (domain !== 'services' && destinationFor(request) === 'townpass_places') {
          trace('router', 'corrected', 'Opening the Town Pass map is an in-app service.');
          domain = 'services';
        }
        // Queue numbers are a service lookup, never a personal bill.
        if (domain === 'bills' && /叫號|臨櫃|號碼牌|櫃檯|queue|counter/i.test(request)) {
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
        destinationFor(request) &&
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
      // A library request with no matching word (e.g. a quoted title) still means the catalog.
      const ruled = destinationFor(request) ?? (domain === 'library' ? 'townpass_library' : null);
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
        const districts = [
          ...new Set(
            request.match(/(?:松山|信義|大安|中山|中正|大同|萬華|文山|南港|內湖|士林|北投)區/g) ??
              [],
          ),
        ];
        if (districts.length === 1) {
          call.arguments.area = districts[0]!;
          if (!/附近|最近|nearby|nearest|near me/i.test(request)) delete call.arguments.near_me;
        }
        // Accessibility is a structured filter, not free text: names rarely contain it.
        if (call.name !== 'find_nearby_youbike') {
          const keyword = typeof call.arguments.keyword === 'string' ? call.arguments.keyword : '';
          if (ACCESSIBLE_PLACE.test(keyword)) delete call.arguments.keyword;
          if (ACCESSIBLE_PLACE.test(request)) call.arguments.accessible = true;
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
