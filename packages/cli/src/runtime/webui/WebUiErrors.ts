export type WebUiRequestErrorCode =
  | "invalid_json"
  | "request_body_too_large"
  | "attachment_too_large";

/** A deliberately browser-safe failure raised at the local HTTP boundary. */
export class WebUiRequestError extends Error {
  public readonly name = "WebUiRequestError";

  public constructor(
    public readonly code: WebUiRequestErrorCode,
    public readonly statusCode: 400 | 413,
    message: string,
  ) {
    super(message);
  }
}
