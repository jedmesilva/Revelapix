import type {
  ChangePasswordInput,
  CreateOrderInput,
  GoogleAuthConfig,
  GoogleAuthInput,
  LoginInput,
  RedeemCellInput,
  RedemptionResult,
  RegisterInput,
  RevelaStateResponse,
  SavedRedemptionDetailsResponse,
} from "@workspace/api-client-react";

export class ApiRequestError extends Error {
  code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = "ApiRequestError";
    this.code = code;
  }
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
    throw new ApiRequestError(body?.error ?? "Não foi possível concluir a solicitação.", body?.code);
  }
  return body as T;
}

export function getRevelaState(): Promise<RevelaStateResponse> {
  return request<RevelaStateResponse>("/api/revela/state");
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

export function getGoogleAuthConfig(): Promise<GoogleAuthConfig> {
  return request<GoogleAuthConfig>("/api/auth/google/config");
}

export function loginWithGoogle(data: GoogleAuthInput): Promise<RevelaStateResponse> {
  return request<RevelaStateResponse>("/api/auth/google", {
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

export function getSavedRedemptionDetails(): Promise<SavedRedemptionDetailsResponse> {
  return request<SavedRedemptionDetailsResponse>("/api/account/redemption-details");
}
