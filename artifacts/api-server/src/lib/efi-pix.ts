import https, { type Agent } from "node:https";

const HOMOLOGATION_URL = "https://pix-h.api.efipay.com.br";
const PRODUCTION_URL = "https://pix.api.efipay.com.br";
const REQUEST_TIMEOUT_MS = 12_000;

type EfiEnvironment = "homologation" | "production";

type EfiConfig = {
  environment: EfiEnvironment;
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  certificate: Buffer;
  certificatePassword: string;
  pixKey: string;
};

type EfiPixPayment = {
  txid: string | null;
  amountCents: number | null;
  paidAt: Date | null;
};

export type EfiCharge = {
  txid: string;
  status: string;
  amountCents: number;
  pixCopyPaste: string | null;
  payments: EfiPixPayment[];
};

export class EfiApiError extends Error {
  constructor(
    message: string,
    readonly statusCode?: number,
  ) {
    super(message);
    this.name = "EfiApiError";
  }
}

let cachedToken: { value: string; expiresAt: number } | null = null;
let tokenRequest: Promise<string> | null = null;
let cachedAgent: { config: EfiConfig; agent: Agent } | null = null;

function readEnvironment(): EfiEnvironment | null {
  const configured = (process.env.EFI_ENVIRONMENT ?? "homologation").trim().toLowerCase();
  if (configured === "homologation" || configured === "production") return configured;
  return null;
}

function readConfig(): EfiConfig | null {
  const environment = readEnvironment();
  const clientId = process.env.EFI_CLIENT_ID?.trim();
  const clientSecret = process.env.EFI_CLIENT_SECRET?.trim();
  const certificateBase64 = process.env.EFI_CERTIFICATE_BASE64?.replace(/\s/g, "");
  const pixKey = process.env.EFI_PIX_KEY?.trim();

  if (!environment || !clientId || !clientSecret || !certificateBase64 || !pixKey) return null;
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(certificateBase64)) {
    return null;
  }
  const certificate = Buffer.from(certificateBase64, "base64");
  if (certificate.length === 0) return null;

  return {
    environment,
    baseUrl: environment === "production" ? PRODUCTION_URL : HOMOLOGATION_URL,
    clientId,
    clientSecret,
    certificate,
    certificatePassword: process.env.EFI_CERTIFICATE_PASSWORD ?? "",
    pixKey,
  };
}

function hasProductionApproval(): boolean {
  return readEnvironment() !== "production" || process.env.EFI_LIVE_PAYMENTS_ENABLED === "true";
}

export function getEfiPaymentSetupError(): string | null {
  if (!readEnvironment()) {
    return "EFI_ENVIRONMENT deve ser homologation ou production.";
  }
  if (!readConfig()) {
    return "Configure as credenciais, o certificado P12 e a chave Pix da Efí nos Secrets do projeto.";
  }
  if (!hasProductionApproval()) {
    return "Pagamentos reais estão desativados. Habilite EFI_LIVE_PAYMENTS_ENABLED somente após aprovar a operação com a Efí.";
  }
  return null;
}

export function isEfiConfigured(): boolean {
  return readConfig() !== null;
}

export function getEfiEnvironment(): EfiEnvironment {
  const environment = readEnvironment();
  if (!environment) throw new EfiApiError("EFI_ENVIRONMENT must be homologation or production.");
  return environment;
}

function getAgent(config: EfiConfig): Agent {
  if (
    cachedAgent
    && cachedAgent.config.environment === config.environment
    && cachedAgent.config.clientId === config.clientId
    && cachedAgent.config.clientSecret === config.clientSecret
    && cachedAgent.config.pixKey === config.pixKey
    && cachedAgent.config.certificate.equals(config.certificate)
    && cachedAgent.config.certificatePassword === config.certificatePassword
  ) {
    return cachedAgent.agent;
  }

  cachedAgent?.agent.destroy();
  const agent = new https.Agent({
    pfx: config.certificate,
    passphrase: config.certificatePassword,
    minVersion: "TLSv1.2",
    keepAlive: true,
  });
  cachedAgent = { config, agent };
  cachedToken = null;
  return agent;
}

function requestJson<T>(
  config: EfiConfig,
  agent: Agent,
  path: string,
  method: string,
  headers: Record<string, string>,
  body?: unknown,
): Promise<T> {
  const url = new URL(path, config.baseUrl);
  const encodedBody = body === undefined ? undefined : JSON.stringify(body);

  return new Promise<T>((resolve, reject) => {
    const request = https.request(url, {
      method,
      agent,
      headers: {
        Accept: "application/json",
        ...(encodedBody ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
    }, (response) => {
      let responseBody = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => {
        responseBody += chunk;
        if (responseBody.length > 1_000_000) {
          response.destroy(new Error("Efí response exceeded the allowed size."));
        }
      });
      response.on("error", () => reject(new EfiApiError("Could not read the Efí response.")));
      response.on("end", () => {
        const statusCode = response.statusCode ?? 0;
        if (statusCode < 200 || statusCode >= 300) {
          reject(new EfiApiError(`Efí API returned HTTP ${statusCode}.`, statusCode));
          return;
        }
        try {
          resolve(JSON.parse(responseBody) as T);
        } catch {
          reject(new EfiApiError("Efí returned an invalid response."));
        }
      });
    });

    request.setTimeout(REQUEST_TIMEOUT_MS, () => {
      request.destroy(new Error("Efí request timed out."));
    });
    request.on("error", () => reject(new EfiApiError("Could not reach Efí Pix API.")));
    if (encodedBody) request.write(encodedBody);
    request.end();
  });
}

async function getAccessToken(config: EfiConfig, agent: Agent): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) return cachedToken.value;
  if (tokenRequest) return tokenRequest;

  tokenRequest = (async () => {
    const basicAuth = Buffer
      .from(`${config.clientId}:${config.clientSecret}`)
      .toString("base64");
    const response = await requestJson<{ access_token?: unknown; expires_in?: unknown }>(
      config,
      agent,
      "/oauth/token",
      "POST",
      { Authorization: `Basic ${basicAuth}` },
      { grant_type: "client_credentials" },
    );
    if (typeof response.access_token !== "string" || !response.access_token) {
      throw new EfiApiError("Efí did not return an access token.");
    }
    const expiresIn = typeof response.expires_in === "number" ? response.expires_in : 3600;
    cachedToken = {
      value: response.access_token,
      expiresAt: Date.now() + Math.max(60, expiresIn - 60) * 1000,
    };
    return response.access_token;
  })();

  try {
    return await tokenRequest;
  } finally {
    tokenRequest = null;
  }
}

async function authorizedRequest<T>(
  config: EfiConfig,
  path: string,
  method: string,
  body?: unknown,
): Promise<T> {
  const agent = getAgent(config);
  const accessToken = await getAccessToken(config, agent);
  return requestJson<T>(
    config,
    agent,
    path,
    method,
    { Authorization: `Bearer ${accessToken}` },
    body,
  );
}

function parseAmountCents(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d+(?:\.\d{1,2})?$/.test(value)) return null;
  const [reais, cents = ""] = value.split(".");
  return Number(reais) * 100 + Number(cents.padEnd(2, "0"));
}

function parseCharge(value: unknown): EfiCharge {
  if (typeof value !== "object" || value === null) {
    throw new EfiApiError("Efí returned an invalid charge.");
  }
  const record = value as Record<string, unknown>;
  const amount = typeof record.valor === "object" && record.valor !== null
    ? (record.valor as Record<string, unknown>).original
    : null;
  const txid = typeof record.txid === "string" ? record.txid : "";
  const status = typeof record.status === "string" ? record.status : "";
  const amountCents = parseAmountCents(amount);
  if (!txid || !status || amountCents === null) {
    throw new EfiApiError("Efí returned an incomplete charge.");
  }

  const payments = Array.isArray(record.pix)
    ? record.pix.map((payment): EfiPixPayment => {
        if (typeof payment !== "object" || payment === null) {
          return { txid: null, amountCents: null, paidAt: null };
        }
        const pix = payment as Record<string, unknown>;
        const paidAt = typeof pix.horario === "string" ? new Date(pix.horario) : null;
        return {
          txid: typeof pix.txid === "string" ? pix.txid : null,
          amountCents: parseAmountCents(pix.valor),
          paidAt: paidAt && !Number.isNaN(paidAt.getTime()) ? paidAt : null,
        };
      })
    : [];

  return {
    txid,
    status,
    amountCents,
    pixCopyPaste: typeof record.pixCopiaECola === "string" ? record.pixCopiaECola : null,
    payments,
  };
}

export async function createEfiPixCharge(
  txid: string,
  amountCents: number,
  expiresAt: Date,
): Promise<EfiCharge> {
  const setupError = getEfiPaymentSetupError();
  if (setupError) throw new EfiApiError(setupError);
  const config = readConfig();
  if (!config) throw new EfiApiError("Efí Pix is not configured.");

  const expiresInSeconds = Math.floor((expiresAt.getTime() - Date.now()) / 1000);
  if (expiresInSeconds < 15) {
    throw new EfiApiError("Order reservation expired before the Efí charge could be created.");
  }

  const expectedCents = amountCents;
  let charge: EfiCharge;
  try {
    charge = parseCharge(await authorizedRequest<unknown>(
      config,
      `/v2/cob/${encodeURIComponent(txid)}`,
      "PUT",
      {
        calendario: { expiracao: expiresInSeconds },
        valor: { original: (amountCents / 100).toFixed(2) },
        chave: config.pixKey,
        solicitacaoPagador: `Pedido Revela ${txid.slice(0, 8)}`,
      },
    ));
  } catch (createError) {
    try {
      // A stable txid lets us recover if Efí created the charge but its response was lost.
      charge = await getEfiPixCharge(txid);
    } catch {
      throw createError;
    }
  }

  if (charge.txid !== txid || charge.amountCents !== expectedCents || !charge.pixCopyPaste) {
    throw new EfiApiError("Efí charge did not match the requested order.");
  }
  return charge;
}

export async function getEfiPixCharge(txid: string): Promise<EfiCharge> {
  const config = readConfig();
  if (!config) throw new EfiApiError("Efí Pix is not configured.");
  return parseCharge(await authorizedRequest<unknown>(
    config,
    `/v2/cob/${encodeURIComponent(txid)}`,
    "GET",
  ));
}

export async function cancelEfiPixCharge(txid: string): Promise<void> {
  const config = readConfig();
  if (!config) throw new EfiApiError("Efí Pix is not configured.");
  await authorizedRequest<unknown>(
    config,
    `/v2/cob/${encodeURIComponent(txid)}`,
    "PATCH",
    { status: "REMOVIDA_PELO_USUARIO_RECEBEDOR" },
  );
}
