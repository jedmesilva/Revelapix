import type {
  ChangePasswordInput,
  CancelRedemptionResponse,
  CreateOrderInput,
  GetRevelaCellsParams,
  LoginInput,
  RedeemCellInput,
  RedemptionResult,
  RegisterInput,
  RevelaCellsResponse,
  RevelaStateResponse,
} from "@workspace/api-client-react";

export class ApiRequestError extends Error {
  code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = "ApiRequestError";
    this.code = code;
  }
}

const GENERIC_API_ERROR = "Não foi possível concluir esta ação. Tente novamente em instantes.";
const INTERNAL_ERROR_DETAILS =
  /\b(?:EFI(?:_[A-Z0-9_]+)?|SUPABASE(?:_[A-Z0-9_]+)?|DATABASE_URL|P12|secrets?|credentials?|credenciais?|certificados?|backend|servidor|server|database|banco\s+de\s+dados|stack(?:\s+trace)?|internal\s+server(?:\s+error)?|exception|typeerror|api|oauth|postgres(?:ql)?|express|node(?:\.js)?)\b/i;

function publicErrorMessage(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return GENERIC_API_ERROR;
  const message = value.trim();
  return INTERNAL_ERROR_DETAILS.test(message) ? GENERIC_API_ERROR : message;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });

  if (response.status === 204) return undefined as T;
  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json")
    ? await response.json() as { error?: string; code?: string }
    : null;
  if (!response.ok) {
    throw new ApiRequestError(publicErrorMessage(body?.error), body?.code);
  }
  return body as T;
}

export function getRevelaState(): Promise<RevelaStateResponse> {
  return request<RevelaStateResponse>("/api/revela/state");
}

export function getRevelaCells(params: GetRevelaCellsParams): Promise<RevelaCellsResponse> {
  const query = new URLSearchParams({
    view: params.view ?? "all",
    start: String(params.start ?? 0),
    limit: String(params.limit ?? 120),
  });
  return request<RevelaCellsResponse>(`/api/revela/cells?${query.toString()}`);
}

export function registerAccount(data: RegisterInput): Promise<RevelaStateResponse> {
  return request<RevelaStateResponse>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function loginAccount(data: LoginInput): Promise<RevelaStateResponse> {
  return request<RevelaStateResponse>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function logoutAccount(): Promise<void> {
  return request<void>("/api/auth/logout", { method: "POST" });
}

export function changePassword(data: ChangePasswordInput): Promise<void> {
  return request<void>("/api/auth/change-password", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function revealCell(cellId: number): Promise<RevelaStateResponse> {
  return request<RevelaStateResponse>(`/api/cells/${cellId}/reveal`, { method: "POST" });
}

export function createOrder(data: CreateOrderInput): Promise<RevelaStateResponse> {
  return request<RevelaStateResponse>("/api/orders", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function refreshOrderPayment(orderId: string): Promise<RevelaStateResponse> {
  return request<RevelaStateResponse>(`/api/orders/${encodeURIComponent(orderId)}/refresh`, {
    method: "POST",
  });
}

export function cancelOrderPayment(orderId: string): Promise<RevelaStateResponse> {
  return request<RevelaStateResponse>(`/api/orders/${encodeURIComponent(orderId)}/cancel`, {
    method: "POST",
  });
}

export function simulateOrderPayment(orderId: string): Promise<RevelaStateResponse> {
  return request<RevelaStateResponse>(`/api/orders/${encodeURIComponent(orderId)}/simulate-payment`, {
    method: "POST",
  });
}

export function redeemCell(data: RedeemCellInput): Promise<RedemptionResult> {
  return request<RedemptionResult>("/api/redemptions", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function cancelCellRedemption(cellId: number): Promise<CancelRedemptionResponse> {
  return request<CancelRedemptionResponse>(`/api/cells/${cellId}/redemptions/cancel`, { method: "POST" });
}

