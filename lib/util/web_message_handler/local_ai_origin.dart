import 'package:town_pass/service/llm_service.dart';

/// ASR 與 LLM 共用既有的來源白名單，避免新增服務時漏掉已允許的來源。
/// 正式網域仍須經團隊審查，因為啟動回覆會提供 API key。
const Set<String> kLocalAiAllowedOrigins = kLlmAllowedOrigins;

bool isLocalAiOriginAllowed(String? origin) => isLlmOriginAllowed(origin);
