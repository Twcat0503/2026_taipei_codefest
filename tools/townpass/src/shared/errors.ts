/** 工具入口把 AppError 轉成 { code, message, hint }；其他例外對外泛化，細節不外露。 */

export type ErrorCode = "INVALID_INPUT" | "UPSTREAM_ERROR" | "UPSTREAM_FORMAT_CHANGED" | "LOCATION_UNAVAILABLE" | "INTERNAL";

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly hint?: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class InputError extends AppError {
  constructor(message: string, hint?: string) {
    super("INVALID_INPUT", message, hint);
  }
}

export class UpstreamError extends AppError {
  constructor(message: string) {
    super("UPSTREAM_ERROR", message, "服務暫時無法回應，請稍後再試；這不代表查無資料。");
  }
}

/** 收到非預期內容時回報失敗，不能安靜地回空結果，否則會被誤認為查無資料。 */
export class UpstreamFormatError extends AppError {
  constructor(what: string) {
    super("UPSTREAM_FORMAT_CHANGED", `${what}的內容不符合預期`, "網站可能已改版；這不代表查無資料。");
  }
}

/** 拿不到定位時不猜位置，請使用者改說行政區。 */
export class LocationError extends AppError {
  constructor() {
    super("LOCATION_UNAVAILABLE", "無法取得目前位置", "請告訴我行政區或地名，例如「大安區的 YouBike」。");
  }
}

export interface PublicError {
  code: ErrorCode;
  message: string;
  hint?: string;
}

export function toPublicError(err: unknown): PublicError {
  if (err instanceof AppError) {
    return err.hint ? { code: err.code, message: err.message, hint: err.hint } : { code: err.code, message: err.message };
  }
  return { code: "INTERNAL", message: "內部錯誤", hint: "請稍後再試。" };
}
