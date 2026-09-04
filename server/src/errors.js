export class AppError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
  }
}

export function asAppError(error) {
  if (error instanceof AppError) return error;
  if (error instanceof SyntaxError && error.status === 400) {
    return new AppError("INVALID_INPUT", "请求格式无效", 400);
  }
  return new AppError("INTERNAL", "服务器暂时不可用", 500);
}
