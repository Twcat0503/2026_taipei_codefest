import { DemoMcpClient, type McpClient } from './mcp';
import { routerPrompt, specialistPrompt } from './prompts';
import { domainTools, executeReadTool, routingTool } from './tools';
import {
  billIntentTool,
  billSkill,
  isBillSelection,
  parseBillOutcome,
  type BillSelection,
} from './skills/bills';
import type { Domain, Message, ModelAdapter, TaskState } from './types';

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
    private mcp: McpClient = new DemoMcpClient([
      ...domainTools('library'),
      ...domainTools('services'),
      ...domainTools('bills'),
    ]),
    private toolTimeoutMs = 10000,
  ) {}

  cancel() {
    this.controller?.abort();
  }

  run(request: string, onProgress: (stage: 'routing' | 'searching') => void = () => {}) {
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
    this.state.domain = null;
    this.state.receipt = null;
    this.state.bookIds = [];
    this.state.bookResults = [];
    this.state.serviceResults = [];
    this.state.serviceIds = [];
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
    ) => bounded((child) => this.model.complete({ messages, tools, signal: child }), signal, 20000);
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
          !['library', 'services', 'bills', 'unsupported'].includes(call.arguments.domain)
        )
          throw new Error('INVALID_ROUTE');
        domain = call.arguments.domain as Domain;
      }
      this.state.domain = domain;
      trace('router', 'selected', domain);
      if (domain === 'unsupported') {
        this.state.notice = 'unsupported';
        return;
      }
      if (domain === 'bills') {
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
          if (args.category === 'unknown') {
            this.state.pendingBillCategory = true;
            this.state.notice = 'billCategory';
            return;
          }
          selectedCategory = args.category as BillSelection;
        }
        this.state.billQuery = { category: selectedCategory, period: 'current' };
      }
      onProgress('searching');
      const available = await bounded(
        (child) => this.mcp.listTools({ signal: child }),
        signal,
        this.toolTimeoutMs,
      );
      signal.throwIfAborted();
      const allowedTools = domainTools(domain).filter((tool) =>
        available.tools.some((item) => item.name === tool.function.name),
      );
      if (!allowedTools.length) {
        if (domain === 'bills') {
          this.state.notice = 'billUnavailable';
          return;
        }
        throw new Error('MCP_TOOL_UNAVAILABLE');
      }
      trace('mcp', 'tools_listed', allowedTools.map((tool) => tool.function.name).join(', '));
      if (domain === 'bills') {
        const query = this.state.billQuery!;
        trace('bills', 'tool_requested', 'list_bills');
        const result = await bounded(
          (child) =>
            this.mcp.callTool({ name: 'list_bills', arguments: { ...query } }, { signal: child }),
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
          throw new Error('MCP_TOOL_ERROR');
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
      const response = await complete(
        [{ role: 'system', content: specialistPrompt(domain) }, userMessage],
        allowedTools,
      );
      signal.throwIfAborted();
      if (response.calls.length !== 1) throw new Error('ONE_TOOL_AT_A_TIME');
      const call = response.calls[0]!;
      trace(domain, 'tool_requested', call.name);
      // Only the bounded transport can finish the lookup; no final LLM completion pass.
      const client: McpClient = {
        listTools: (options) => this.mcp.listTools(options),
        callTool: (params) =>
          bounded(
            (child) => this.mcp.callTool(params, { signal: child }),
            signal,
            this.toolTimeoutMs,
          ),
      };
      const result = await executeReadTool(client, domain, call, this.state, signal);
      trace('executor', 'completed', `${call.name}: ${result.records.length} demo records`);
    } catch (error) {
      this.state.bookIds = [];
      this.state.bookResults = [];
      this.state.serviceResults = [];
      this.state.serviceIds = [];
      this.state.billResult = null;
      this.state.notice = signal.aborted
        ? 'cancelled'
        : this.state.domain === 'bills'
          ? 'billUnavailable'
          : 'error';
      trace(
        'runtime',
        signal.aborted ? 'cancelled' : 'failed',
        signal.aborted ? 'USER_CANCELLED' : 'MODEL_OR_TOOL_ERROR',
      );
      throw error;
    } finally {
      this.controller = null;
    }
  }
}
