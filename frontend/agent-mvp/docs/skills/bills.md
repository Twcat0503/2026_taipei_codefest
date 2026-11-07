# Bill lookup skill and MCP handoff

This is an application skill for the Town Pass accessibility agent, not an IDE/Codex skill. The executable definition, schemas, category registry and result validator live in `src/agent/skills/bills.ts`.

## Goal and ownership

User intent: 「我想看到我這期的帳單與繳費狀態」 / “Show my current bills and payment status.”

- Agent: route intent, load only bill instructions, collect a missing category, validate tools/results, render localized status, provide registered page links and retry/cancel.
- MCP teammate: implement the `McpClient` adapter, transport/session lifecycle, service authentication, actual billing API calls and normalized results.
- LLM teammate: implement `ModelAdapter` or the supported local inference endpoint; maintain cancellation and structured-output support.
- UI teammate: edit `BillPanel.vue` and `i18n.ts`; keep the state and tool contract intact.

## Execution and completion

1. Router selects `bills`.
2. Bill specialist emits the internal `select_bill_query` decision. This is not an MCP tool.
3. Missing category → ask the user. Button choices call `chooseBillCategory` with no further inference. Typed answers use only the current request and a bounded pending-category marker. A new unrelated request can switch domains.
4. Past periods, unrecognized bill types and payment instructions are unsupported. Payment-status questions are read requests.
5. Discover `list_bills`, intersect with the local allowlist, send validated arguments.
6. Validate and project returned fields; render directly. No third model call to say “done”.
7. Query complete means validated data is displayed, not that a payment happened or a government page loaded.

Read requests take at most two model calls and one service call; there is also one tool discovery call. Each model call is bounded to 20 seconds and each MCP call/discovery to 10 seconds. Cancellation rejects even if an adapter ignores its signal; a late response cannot populate the UI. Adapters should still honor cancellation to stop actual computation/network work. There are no automatic transaction retries or payment tools.

## Proposed tool contract v1

The name/schema is executable as `billReadTool`. Confirm this contract with the MCP owner before connecting a live provider.

```json
{
  "name": "list_bills",
  "arguments": { "category": "water", "period": "current" }
}
```

Categories: `parking`, `water`, `tax`, `tuition`, `housing`, `medical`, `maintenance`, `course`, `other`, `all`. Exactly these two arguments are accepted. `current` is resolved by the service's billing rules; the LLM must not guess dates. The user's account comes from the authenticated session, not a model-supplied user ID, token or account number.

The current `McpClient` boundary returns a single text content block containing JSON:

```json
{
  "content": [
    {
      "type": "text",
      "text": "{\"source\":\"demo\",\"asOf\":\"2026-11-07T09:00:00+08:00\",\"records\":[{\"id\":\"demo-water-1\",\"category\":\"water\",\"periodLabel\":\"DEMO 2026-11\",\"amount\":360,\"currency\":\"TWD\",\"dueDate\":\"2026-11-30\",\"status\":\"unpaid\"}]}"
    }
  ]
}
```

- `status`: exactly `paid`, `unpaid`, `processing`, or `unknown`. Missing/invalid status is rejected, never converted to unpaid.
- `amount`: nonnegative safe integer in TWD; `dueDate`: valid ISO calendar date; IDs unique and bounded; at most 20 records and 30,000 text characters.
- `asOf`: provider's data timestamp, displayed in the UI. Fixtures use a fixed timestamp and an explicit DEMO period; the demo must not pretend to refresh real accounts.
- No matching bills: `records: []`. UI does not infer absence of actual debt from demo data.
- Recoverable service outcomes: `{ "source": "demo", "error": "AUTH_REQUIRED" }` or `SERVICE_UNAVAILABLE` in the text block. Other MCP `isError`/transport failures become unavailable.
- Retry reuses the last validated category/current-period query without another model call. No credentials, results or prompts are persisted. New tasks clear bill state; refresh does not restore account data.
- Returned URLs, account fields and free-form instructions are discarded.

**Only `source: demo` is accepted today.** Do not label live data as demo. Live integration must add a separately reviewed source contract and source-aware UI, verify authenticated ownership server-side, agree on pagination/partial results and freshness, and provide integration tests. This MVP has no real sign-in flow; `AUTH_REQUIRED` exposes a message and links, not a fabricated login success.

## Navigation capability

The registry follows `lib/page/bill/bill_view.dart` for nine categories and `bill_app_bar.dart` for history. The fixed host is the existing development template `https://taipei-pass-service.vercel.app`.

- Pure browser: normal same-tab anchor, allowing Back. No arbitrary model/MCP URL navigation.
- App: `flutterObject.postMessage(JSON.stringify({name: 'open_link', data: registeredUrl}))`; the existing Flutter handler opens TPWebView.
- That handler does not acknowledge successful navigation. UI says “requested”, never “page loaded”. Synchronous bridge failure is visible and can be retried.
- Links open category/search or history templates, not an individual bill or current-period result. No inferred query parameters, sample IDs or credentials are appended. Authentication continuity is not verified.
- Live detail navigation requires a separately agreed route/ID contract, trusted origins, valid user session and end-to-end verification. Do not turn the existing template host into an assumed official billing API.

## Acceptance matrix

| Scenario                               | Expected behavior                               | Coverage                                            |
| -------------------------------------- | ----------------------------------------------- | --------------------------------------------------- |
| General current-bill request           | Ask category without invoking billing tool      | Unit, E2E, model evaluation                         |
| Choose category / type 水費            | Read selected current bills                     | Unit, E2E, model evaluation                         |
| Explicit all bills                     | Preserve paid/unpaid/processing/unknown         | Unit, E2E, model evaluation                         |
| Empty category                         | Explain no demo records, no debt claim          | Unit                                                |
| Login required / service unavailable   | Distinct notice and bounded retry               | Unit                                                |
| Payment instruction / past period      | No MCP call or payment                          | Unit, model evaluation                              |
| Malformed result / unexpected source   | Reject, never invent status                     | Unit                                                |
| Timeout / cancellation / late response | No stale results; task can end                  | Unit                                                |
| Browser / native navigation            | Registered URL, honest acknowledgement limits   | E2E with intercepted destination / simulated bridge |
| Privacy                                | Bills and conversation absent from localStorage | Unit, E2E                                           |
| Mobile accessibility                   | axe, bilingual 200% without horizontal overflow | E2E Chromium mobile viewport                        |

Physical Android rerun and TalkBack remain pending when a device is available. Simulated bridge tests are not evidence of native page-load success.
