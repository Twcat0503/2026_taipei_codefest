import { DemoMcpClient, type McpClient } from './mcp';
import { routerPrompt, specialistPrompt } from './prompts';
import { assistantMessage } from './model';
import { domainTools, executeReadTool, routingTool } from './tools';
import type { Domain, Message, ModelAdapter, TaskState } from './types';

export class AgentRunner {
  private controller: AbortController | null = null;
  constructor(
    private model: ModelAdapter,
    private state: TaskState,
    private mcp: McpClient = new DemoMcpClient([
      ...domainTools('library'),
      ...domainTools('services'),
    ]),
  ) {}

  cancel() {
    this.controller?.abort();
  }

  async run(request: string, onProgress: (stage: 'routing' | 'searching') => void = () => {}) {
    if (this.controller) throw new Error('TASK_RUNNING');
    if (!request.trim() || request.length > 600) throw new Error('INVALID_INPUT');
    if (this.state.draft) throw new Error('DRAFT_PENDING');
    const controller = new AbortController();
    this.controller = controller;
    const signal = controller.signal;
    const start = performance.now();
    this.state.traces = [];
    this.state.receipt = null;
    this.state.bookIds = [];
    this.state.bookResults = [];
    this.state.serviceResults = [];
    this.state.serviceIds = [];
    const trace = (actor: string, event: string, detail: string) => {
      this.state.traces.push({
        id: this.state.traces.length,
        actor,
        event,
        detail,
        elapsedMs: Math.round(performance.now() - start),
      });
    };
    const ensureActive = () => {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    };
    // Fresh, bounded context per specialist; no shared unbounded conversation history.
    const userMessage: Message = {
      role: 'user',
      content: JSON.stringify({ original_request: request }),
    };
    try {
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
        !['library', 'services', 'unsupported'].includes(String(call.arguments.domain))
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
      const available = await this.mcp.listTools({ signal });
      ensureActive();
      const allowedTools = domainTools(domain).filter((tool) =>
        available.tools.some((item) => item.name === tool.function.name),
      );
      if (!allowedTools.length) throw new Error('MCP_TOOL_UNAVAILABLE');
      trace('mcp', 'tools_listed', allowedTools.map((tool) => tool.function.name).join(', '));
      const messages: Message[] = [
        { role: 'system', content: specialistPrompt(domain) },
        userMessage,
      ];
      let executed = false;
      for (let step = 0; step < 3; step++) {
        ensureActive();
        const response = await this.model.complete({ messages, tools: allowedTools, signal });
        ensureActive();
        if (!response.calls.length) {
          // 畫面只呈現驗證過的工具結果，所以工具成功後，模型回什麼文字都視為完成。
          if (!executed) throw new Error('NO_TOOL_RESULT');
          trace(domain, 'completed', 'Render verified tool records in the selected UI language.');
          return;
        }
        if (response.calls.length !== 1) throw new Error('ONE_TOOL_AT_A_TIME');
        const toolCall = response.calls[0]!;
        trace(domain, 'tool_requested', toolCall.name); // No raw user input in logs.
        const result = await executeReadTool(this.mcp, domain, toolCall, this.state, signal);
        executed = true;
        trace(
          'executor',
          'tool_completed',
          `${toolCall.name}: ${result.records.length} demo records`,
        );
        messages.push(assistantMessage(response.calls), {
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(result),
        });
      }
      throw new Error('STEP_LIMIT');
    } catch (error) {
      this.state.bookIds = [];
      this.state.bookResults = [];
      this.state.serviceResults = [];
      this.state.serviceIds = [];
      this.state.notice = signal.aborted ? 'cancelled' : 'error';
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
