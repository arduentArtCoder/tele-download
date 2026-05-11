export class UserVisibleError extends Error {
  public readonly code: string;

  public constructor(message: string, code = "USER_VISIBLE_ERROR") {
    super(message);
    this.name = "UserVisibleError";
    this.code = code;
  }
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof UserVisibleError) {
    return error.message;
  }

  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return "Unexpected error while processing this link.";
}

export function getErrorStack(error: unknown): string | undefined {
  if (error instanceof Error) {
    return error.stack;
  }

  return undefined;
}
