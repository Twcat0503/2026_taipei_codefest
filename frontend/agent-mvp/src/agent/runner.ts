import { DemoToolClient, type ToolClient } from './tool-client';
import { routerPrompt, specialistPrompt } from './prompts';
import { assistantMessage } from './model';
import { ToolCallError, allowedTools, domainTools, executeReadTool, routingTool } from './tools';
import type { Domain, Message, ModelAdapter, TaskState } from './types';

type Trace = (actor: string, event: string, detail: string) => void;

export class AgentRunner {
  private controller: AbortController | null = null;
  constructor(
    private model: ModelAdapter,
    private state: TaskState,
    private tools: ToolClient = new DemoToolClient([
      ...domainTools('library'),
      ...domainTools('services'),
    ]),
  ) {}

  cancel() {
    this.controller?.abort();
  }

  async run(request: string, onProgress: (stage: 'routing' | 'searching') => void = () => {}) {
    if (!request.trim() || request.length > 600) throw new Error('INVALID_INPUT');
    await this.task(async (signal, trace) => {
      const ensureActive = () => {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      };
      // Fresh, bounded context per specialist; no shared unbounded conversation history.
      const userMessage: Message = {
        role: 'user',
        content: JSON.stringify({ original_request: request }),
      };
      onProgress('routing');
      trace('router', 'started', 'Select one domain; original text retained.');
      const route = await this.model.complete({
        messages: [{ role: 'system', content: routerPrompt }, userMessage],
        tools: [routingTool],
        signal,
      });
      ensureActive();
      const call = route.calls[0];
      if (
        route.calls.length !== 1 ||
        call?.name !== 'select_agent' ||
        Object.keys(call.arguments).length !== 1 ||
        !['library', 'services', 'perks', 'places', 'unsupported'].includes(
          String(call.arguments.domain),
        )
      )
        throw new Error('INVALID_ROUTE');
      const domain = call.arguments.domain as Domain;
      this.state.domain = domain;
      trace('router', 'selected', domain);
      if (domain === 'unsupported') {
        this.state.notice = 'unsupported';
        return;
      }
      onProgress('searching');
      const available = await this.tools.listTools({ signal });
      ensureActive();
      const tools = allowedTools(domain, available.tools);
      if (!tools.length) throw new Error('TOOL_UNAVAILABLE');
      trace('tools', 'tools_listed', tools.map((tool) => tool.function.name).join(', '));
      const messages: Message[] = [
        { role: 'system', content: specialistPrompt(domain) },
        userMessage,
      ];
      let executed = false;
      for (let step = 0; step < 3; step++) {
        ensureActive();
        const response = await this.model.complete({ messages, tools, signal });
        ensureActive();
        if (!response.calls.length) {
          // 畫面只呈現驗證過的工具結果，所以工具成功後，模型回什麼文字都視為完成。
          if (!executed) throw new Error('NO_TOOL_RESULT');
          trace(domain, 'completed', 'Render verified tool records in the selected UI language.');
          return;
        }
        if (response.calls.length !== 1) throw new Error('ONE_TOOL_AT_A_TIME');
        const toolCall = response.calls[0]!;
        // Traces stay in memory for the decision view and are never persisted.
        trace(domain, 'tool_requested', `${toolCall.name} ${JSON.stringify(toolCall.arguments)}`);
        const result = await executeReadTool(this.tools, domain, toolCall, this.state, signal);
        executed = true;
        trace(
          'executor',
          'tool_completed',
          `${toolCall.name}: ${result.total} ${result.source} records`,
        );
        messages.push(assistantMessage(response.calls), {
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(result),
        });
      }
      throw new Error('STEP_LIMIT');
    });
  }

  /** A deterministic UI action, such as opening book details. No model is involved. */
  async runTool(domain: Domain, name: string, args: Record<string, unknown>) {
    await this.task(async (signal, trace) => {
      trace('ui', 'tool_requested', `${name} ${JSON.stringify(args)}`);
      const result = await executeReadTool(
        this.tools,
        domain,
        { id: 'ui-action', name, arguments: args },
        this.state,
        signal,
      );
      this.state.domain = domain;
      trace('executor', 'tool_completed', `${name}: ${result.total} ${result.source} records`);
    });
  }

  private async task(work: (signal: AbortSignal, trace: Trace) => Promise<void>) {
    if (this.controller) throw new Error('TASK_RUNNING');
    if (this.state.draft) throw new Error('DRAFT_PENDING');
    const controller = new AbortController();
    this.controller = controller;
    const signal = controller.signal;
    const start = performance.now();
    const clearResults = () => {
      this.state.bookIds = [];
      this.state.bookResults = [];
      this.state.records = [];
      this.state.source = null;
    };
    this.state.traces = [];
    this.state.receipt = null;
    this.state.failure = null;
    clearResults();
    const trace: Trace = (actor, event, detail) => {
      this.state.traces.push({
        id: this.state.traces.length,
        actor,
        event,
        detail,
        elapsedMs: Math.round(performance.now() - start),
      });
    };
    try {
      await work(signal, trace);
    } catch (error) {
      clearResults();
      const failure = error instanceof ToolCallError ? error.failure : null;
      this.state.failure = failure;
      this.state.notice = signal.aborted
        ? 'cancelled'
        : failure?.code === 'LOCATION_UNAVAILABLE'
          ? 'needLocation'
          : 'error';
      trace(
        'runtime',
        signal.aborted ? 'cancelled' : 'failed',
        signal.aborted
          ? 'USER_CANCELLED'
          : (failure?.code ?? (error instanceof Error ? error.message : 'UNKNOWN_ERROR')),
      );
      throw error;
    } finally {
      this.controller = null;
    }
  }
}
