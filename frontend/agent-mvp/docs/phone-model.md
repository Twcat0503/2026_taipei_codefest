# Phone model adapter

The Vue agent integrates the Android LFM3 runtime through the existing TPWebView bridge. The MCP client remains a demo; changing model source does not connect live municipal APIs.

## User flow

In the Android app, open Care Assistant. Phone mode is selected when the native bridge exists. Press **Start phone model** after reading the first-download notice (about 1 GB). The page displays preparing/downloading/running/error states. Requests are disabled until this page owns a valid model session. The user can cancel startup, refresh status, or stop and release the model.

In a standalone browser, use simulation or the existing computer loopback model. Phone mode reports that the Android bridge is required; it never silently falls back to another model.

## Contract

- `llm_start`, `llm_status`, `llm_stop` requests carry `data.requestId`, a UUID. Replies echo that ID inside `data`. Old, unmatched and malformed replies are ignored. The adapter supports the native object's message event API and onmessage fallback; disposal removes its listeners.
- Only approved origins and the main frame can call the LLM handlers. Development origins are `http://127.0.0.1:5173`, `http://localhost:5173`, and `http://10.0.2.2:5173`. Production origin configuration remains explicit; arbitrary web pages cannot request model credentials.
- `llm_start` returns `baseUrl`, `model`, and a random per-server `apiKey`. The adapter accepts loopback `/v1` URLs only and sends `Authorization: Bearer …` to `/chat/completions` with redirects blocked.
- Credentials are private adapter fields. They are never Vue state, localStorage, messages, traces or UI text. Status and stop replies omit keys. Stop, authorization failure, changed service endpoint, and disposal clear credentials.
- The phone adapter uses the same constrained JSON tool-decision contract as the harness, without Ollama-specific `/no_think` or `reasoning_effort` parameters. Per-inference timeout is 90 seconds, bounded by the runner's 120-second maximum. Model startup is separate, with a 20-minute first-download timeout and periodic status checks.
- Cancellation aborts fetch and requests native stop. Startup and stop use independent Android workers; a generation ticket invalidates queued/active startup. Download reads, checksum work and health polling check cancellation. Stop disconnects an active download and terminates the process. The UI reports stopping until the native idle reply arrives; a timeout is an error, not a claim of success.
- After cancellation/stop or expired authorization, the user starts a new connection explicitly. A late start reply cannot reactivate an old session.

## Files and ownership

- `src/agent/phone-model.ts`: agent-owned session lifecycle and ModelAdapter.
- `src/platform/llm-bridge.ts`: correlated request/reply boundary.
- `src/components/PhoneModelPanel.vue`, `src/i18n.ts`: UI-owned localized controls.
- `lib/service/llm_service.dart`, LLM message handlers: native bridge contract and origin policy.
- Android `LlmServer.kt` and `tools/llm-android/`: teammate-owned model runtime, integrated with cancellation support.

## Build and validation

Before a functional device APK, build the native arm64 executable using `tools/llm-android/build_llama_server.sh arm64-v8a`. Binaries and downloaded models are ignored by git. The app minSdk is 28 to match the native build. Debug manifests override the release loopback network policy with the existing development policy.

Local frontend checks: `pnpm lint`, `pnpm format:check`, `pnpm test`, `pnpm build`, `pnpm test:e2e` under `frontend/agent-mvp`, using mise/pnpm.

Flutter checks: `fvm dart format lib test integration_test`, `fvm flutter analyze`, `fvm flutter test`, and `fvm flutter build apk --debug --target-platform android-arm64`.

Device integration: `fvm flutter test integration_test/llm_server_test.dart -d <device-id>`. Covers startup cancellation, restart, unauthenticated rejection, chat, structured bill routing, repeated start, stop and alternate runtime configuration. It downloads the public model on first use. WebView end-to-end verification is separate from Dart HTTP tests.

CI runs the frontend/agent checks, agent browser tests, Flutter unit tests, and an Android APK compile/manifest check. CI does not bundle native inference binaries or download/run the model; a green build alone is not a device inference benchmark.
