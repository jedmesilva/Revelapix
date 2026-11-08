import { randomInt, randomUUID } from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq, gt, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import {
  ChangePasswordBody,
  CancelCellRedemptionParams,
  CancelCellRedemptionResponse,
  CreateOrderBody,
  GetRevelaStateResponse,
  LoginAccountBody,
  RedeemCellBody,
  RedeemCellResponse,
  RegisterAccountBody,
  RegisterAccountResponse,
  RefreshOrderPaymentParams,
  RevealCellParams,
  RevealCellResponse,
  SimulateOrderPaymentParams,
  SimulateOrderPaymentResponse,
} from "@workspace/api-zod";
import {
  cellsTable,
  cashLedgerLockQuery,
  cashTransactionsTable,
  chancePlansTable,
  db,
  itemsTable,
  ordersTable,
  prizeAwardsTable,
  redemptionRequestsTable,
  redemptionRequestEventsTable,
  sessionsTable,
  usersTable,
} from "@workspace/db";
import { createSession, deleteSession, getSessionUser, hashPassword, verifyPassword } from "../lib/auth";
import {
  cancelRedemptionRateLimiter,
  changePasswordRateLimiter,
  createOrderRateLimiter,
  googleOAuthRateLimiter,
  loginRateLimiter,
  redemptionRateLimiter,
  registerRateLimiter,
  revealRateLimiter,
  simulatePaymentRateLimiter,
} from "../middlewares/rate-limit";
import {
  drawPrizeForCell,
  getPrizeFundAccount,
  getPrizeFundSnapshot,
  prizeFundUsesTestMoney,
  recordPackagePurchaseContribution,
} from "../lib/prize-fund";
import {
  clearGoogleOAuthCookies,
  createGoogleSupabaseClient,
  getGoogleAuthConfig,
  getPublicAppOrigin,
} from "../lib/google-auth";
import {
  createEfiPixCharge,
  EfiApiError,
  getEfiPaymentSetupError,
} from "../lib/efi-pix";
import { reconcileEfiOrder } from "../lib/order-payments";
import {
  ensureBoard,
  expireReservations,
  getRevelaState,
  RESERVATION_MS,
} from "../lib/revela";

const router: IRouter = Router();
const activeRedemptionStatuses = ["requested", "under_review", "approved", "processing"] as const;

type SupabaseAuthUser = {
  id: string;
  email?: string;
  email_confirmed_at?: string | null;
  app_metadata?: { provider?: string; providers?: string[] };
  identities?: Array<{ provider?: string }>;
  user_metadata?: { full_name?: string; name?: string };
};

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

function sendError(res: Response, status: number, message: string, code?: string): void {
  res.status(status).json(code ? { error: message, code } : { error: message });
}

async function requireUser(req: Request, res: Response) {
  const user = await getSessionUser(req);
  if (!user) {
    sendError(res, 401, "Entre na sua conta para continuar.", "AUTH_REQUIRED");
    return null;
  }
  return user;
}

router.get("/revela/state", async (req, res): Promise<void> => {
  const user = await getSessionUser(req);
  const state = await getRevelaState(user);
  res.json(GetRevelaStateResponse.parse(state));
});

router.post("/auth/register", registerRateLimiter, async (req, res): Promise<void> => {
  const parsed = RegisterAccountBody.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, 400, "Confira o nome, o e-mail e a senha informados.", "INVALID_INPUT");
    return;
  }

  const name = parsed.data.name.trim();
  const email = parsed.data.email.trim().toLowerCase();
  if (!name) {
    sendError(res, 400, "Informe seu nome.", "INVALID_INPUT");
    return;
  }
  const [existing] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, email)).limit(1);
  if (existing) {
    sendError(res, 409, "Já existe uma conta com este e-mail.", "EMAIL_IN_USE");
    return;
  }

  let user;
  try {
    [user] = await db.insert(usersTable).values({
      name,
      email,
      passwordHash: hashPassword(parsed.data.password),
      chances: 2,
    }).returning();
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
      sendError(res, 409, "Já existe uma conta com este e-mail.", "EMAIL_IN_USE");
      return;
    }
    throw error;
  }

  await createSession(user.id, res);
  res.status(201).json(RegisterAccountResponse.parse(await getRevelaState(user)));
});

router.post("/auth/login", loginRateLimiter, async (req, res): Promise<void> => {
  const parsed = LoginAccountBody.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, 400, "Informe um e-mail e uma senha válidos.", "INVALID_INPUT");
    return;
  }

  const email = parsed.data.email.trim().toLowerCase();
  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
  if (!user || !user.passwordHash || !verifyPassword(parsed.data.password, user.passwordHash)) {
    sendError(res, 401, "E-mail ou senha incorretos.", "INVALID_CREDENTIALS");
    return;
  }

  await createSession(user.id, res);
  res.json(GetRevelaStateResponse.parse(await getRevelaState(user)));
});

router.get("/auth/google", googleOAuthRateLimiter, async (req, res): Promise<void> => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  const config = getGoogleAuthConfig();
  if (!config.enabled) {
    clearGoogleOAuthCookies(req, res);
    res.sendStatus(404);
    return;
  }

  const appOrigin = getPublicAppOrigin();
  if (!appOrigin) {
    req.log.error("Could not determine a trusted public app origin for Google OAuth");
    res.redirect(303, "/?googleAuthError=unavailable");
    return;
  }

  const supabase = createGoogleSupabaseClient(req, res, config);
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: new URL("/api/auth/google/callback", appOrigin).toString(),
    },
  });
  if (error || !data.url) {
    req.log.error({ err: error }, "Could not start Google OAuth");
    clearGoogleOAuthCookies(req, res);
    res.redirect(303, "/?googleAuthError=failed");
    return;
  }

  res.redirect(302, data.url);
});

router.get("/auth/google/callback", googleOAuthRateLimiter, async (req, res): Promise<void> => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  const config = getGoogleAuthConfig();
  if (!config.enabled) {
    clearGoogleOAuthCookies(req, res);
    res.sendStatus(404);
    return;
  }
  const code = typeof req.query.code === "string" ? req.query.code : "";
  const providerError = typeof req.query.error === "string" ? req.query.error : "";
  if (!code || providerError) {
    clearGoogleOAuthCookies(req, res);
    res.redirect(303, "/?googleAuthError=failed");
    return;
  }

  const supabase = createGoogleSupabaseClient(req, res, config, { clearSessionWrites: true });
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  clearGoogleOAuthCookies(req, res);
  if (error || !data.user) {
    req.log.warn({ err: error }, "Google OAuth code exchange failed");
    res.redirect(303, "/?googleAuthError=failed");
    return;
  }

  const identity = data.user as SupabaseAuthUser;
  const hasGoogleIdentity = identity.app_metadata?.provider === "google"
    || identity.app_metadata?.providers?.includes("google") === true
    || identity.identities?.some((item) => item.provider === "google") === true;
  const email = identity.email?.trim().toLowerCase();
  if (!identity.id || !email || !identity.email_confirmed_at || !hasGoogleIdentity) {
    req.log.warn("Google OAuth returned an unverified or non-Google identity");
    res.redirect(303, "/?googleAuthError=failed");
    return;
  }

  let user;
  try {
    const [linkedUser] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.googleSubject, identity.id))
      .limit(1);

    if (linkedUser) {
      user = linkedUser;
    } else {
      const [emailUser] = await db
        .select()
        .from(usersTable)
        .where(eq(usersTable.email, email))
        .limit(1);

      if (emailUser?.googleSubject && emailUser.googleSubject !== identity.id) {
        res.redirect(303, "/?googleAuthError=conflict");
        return;
      }

      if (emailUser) {
        if (!emailUser.googleSubject) {
          const [linkedByEmail] = await db
            .update(usersTable)
            .set({ googleSubject: identity.id })
            .where(and(eq(usersTable.id, emailUser.id), isNull(usersTable.googleSubject)))
            .returning();
          user = linkedByEmail;
        } else {
          user = emailUser;
        }
      } else {
        const displayName = identity.user_metadata?.full_name?.trim()
          || identity.user_metadata?.name?.trim()
          || email.split("@")[0];
        [user] = await db.insert(usersTable).values({
          name: displayName,
          email,
          googleSubject: identity.id,
          passwordHash: null,
          chances: 2,
        }).returning();
      }
    }
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.googleSubject, identity.id))
      .limit(1);
  }

  if (!user) {
    res.redirect(303, "/?googleAuthError=conflict");
    return;
  }
  await createSession(user.id, res);
  res.redirect(303, "/");
});

router.post("/auth/logout", async (req, res): Promise<void> => {
  await deleteSession(req, res);
  res.sendStatus(204);
});

router.post("/auth/change-password", changePasswordRateLimiter, async (req, res): Promise<void> => {
  const user = await requireUser(req, res);
  if (!user) return;
  const parsed = ChangePasswordBody.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, 400, "A nova senha precisa ter ao menos 6 caracteres.", "INVALID_INPUT");
    return;
  }
  if (user.passwordHash) {
    if (!parsed.data.currentPassword || !verifyPassword(parsed.data.currentPassword, user.passwordHash)) {
      sendError(res, 401, "Senha atual incorreta.", "INVALID_PASSWORD");
      return;
    }
  } else if (!user.googleSubject) {
    sendError(res, 401, "Esta conta não pode definir uma senha local.", "PASSWORD_UNAVAILABLE");
    return;
  }

  await db.transaction(async (tx) => {
    await tx.update(usersTable)
      .set({ passwordHash: hashPassword(parsed.data.newPassword) })
      .where(eq(usersTable.id, user.id));
    await tx.delete(sessionsTable).where(eq(sessionsTable.userId, user.id));
  });
  await createSession(user.id, res);
  res.sendStatus(204);
});

router.post("/cells/:cellId/reveal", revealRateLimiter, async (req, res): Promise<void> => {
  const user = await requireUser(req, res);
  if (!user) return;
  const params = RevealCellParams.safeParse(req.params);
  if (!params.success) {
    sendError(res, 400, "Célula inválida.", "INVALID_CELL");
    return;
  }

  await ensureBoard();
  await expireReservations();
  const result = await db.transaction(async (tx) => {
    await tx.execute(cashLedgerLockQuery);
    const isTest = prizeFundUsesTestMoney();
    await getPrizeFundAccount(tx, isTest);

    const [cell] = await tx.select().from(cellsTable)
      .where(eq(cellsTable.id, params.data.cellId))
      .for("update");
    const [currentUser] = await tx.select().from(usersTable)
      .where(eq(usersTable.id, user.id))
      .for("update");
    if (!cell || cell.phase !== "closed") {
      return { error: "Esta célula não está disponível.", code: "CELL_UNAVAILABLE" };
    }
    if (!currentUser || currentUser.chances < 1) {
      return { error: "Você está sem chances. Escolha um pacote.", code: "INSUFFICIENT_CHANCES" };
    }

    const draw = await drawPrizeForCell(tx, cell.id, user.id, isTest);
    if (!draw) {
      return { error: "Não há itens elegíveis para este sorteio.", code: "NO_ELIGIBLE_PRIZES" };
    }

    await tx.update(usersTable)
      .set({ chances: currentUser.chances - 1 })
      .where(eq(usersTable.id, user.id));
    return { error: null, code: null };
  });

  if (result.error) {
    sendError(res, 409, result.error, result.code ?? undefined);
    return;
  }
  const currentUser = await getSessionUser(req);
  res.json(RevealCellResponse.parse(await getRevelaState(currentUser)));
});

router.post("/orders", createOrderRateLimiter, async (req, res): Promise<void> => {
  const user = await requireUser(req, res);
  if (!user) return;
  const efiSetupError = getEfiPaymentSetupError();
  if (efiSetupError) {
    req.log.warn({ setupReason: efiSetupError }, "Pix payments are unavailable");
    sendError(
      res,
      503,
      "Não foi possível iniciar o pagamento agora. Tente novamente mais tarde.",
      "PAYMENT_UNAVAILABLE",
    );
    return;
  }
  const parsed = CreateOrderBody.strict().safeParse(req.body);
  if (!parsed.success) {
    sendError(res, 400, "Escolha um pacote válido.", "INVALID_PACK");
    return;
  }

  await ensureBoard();
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + RESERVATION_MS);
  const orderId = randomUUID();
  const cellId = parsed.data.cellId ?? null;

  await expireReservations(createdAt);
  const result = await db.transaction(async (tx): Promise<
    | { error: string; code: string; status?: number }
    | { error: null; code: null; amountCents: number }
  > => {
    const [pack] = await tx.select().from(chancePlansTable)
      .where(eq(chancePlansTable.id, parsed.data.packId))
      .for("update");
    if (!pack || !pack.isActive) {
      return { error: "Este pacote não está disponível.", code: "INVALID_PACK", status: 400 };
    }

    const [currentUser] = await tx.select().from(usersTable)
      .where(eq(usersTable.id, user.id))
      .for("update");
    if (!currentUser) return { error: "Sessão inválida.", code: "AUTH_REQUIRED" };

    const [activeOrder] = await tx.select({ id: ordersTable.id }).from(ordersTable)
      .where(and(
        eq(ordersTable.userId, user.id),
        eq(ordersTable.status, "pending"),
        or(
          gt(ordersTable.expiresAt, createdAt),
          isNotNull(ordersTable.providerTxid),
        ),
      ))
      .limit(1)
      .for("update");
    if (activeOrder) {
      return { error: "Você já tem um pedido Pix aguardando pagamento.", code: "ORDER_PENDING" };
    }

    if (cellId !== null) {
      if (currentUser.chances > 0) {
        return { error: "Use uma chance disponível para revelar uma célula.", code: "CHANCES_AVAILABLE" };
      }
      const [cell] = await tx.select().from(cellsTable).where(eq(cellsTable.id, cellId)).for("update");
      if (!cell || cell.phase !== "closed") {
        return { error: "Esta célula não está disponível.", code: "CELL_UNAVAILABLE" };
      }
      await tx.update(cellsTable).set({
        phase: "reserved",
        reservedByUserId: user.id,
        reservedUntil: null,
      }).where(eq(cellsTable.id, cellId));
    }

    await tx.insert(ordersTable).values({
      id: orderId,
      userId: user.id,
      packId: pack.id,
      packCount: pack.chances,
      amountCents: pack.priceCents,
      status: "pending",
      cellId,
      providerTxid: orderId.replaceAll("-", ""),
      pixPayload: "",
      expiresAt,
      createdAt,
    });
    return { error: null, code: null, amountCents: pack.priceCents };
  });

  if (result.error !== null) {
    sendError(res, result.status ?? 409, result.error, result.code ?? undefined);
    return;
  }
  const providerTxid = orderId.replaceAll("-", "");
  try {
    const charge = await createEfiPixCharge(providerTxid, result.amountCents, expiresAt);
    if (!charge.pixCopyPaste) throw new EfiApiError("Efí did not return the Pix copy-and-paste code.");
    await db.update(ordersTable)
      .set({ pixPayload: charge.pixCopyPaste })
      .where(and(eq(ordersTable.id, orderId), eq(ordersTable.providerTxid, providerTxid)));
  } catch (error) {
    if (error instanceof EfiApiError && [400, 401, 403, 404].includes(error.statusCode ?? 0)) {
      await db.transaction(async (tx) => {
        const [order] = await tx.select().from(ordersTable)
          .where(and(eq(ordersTable.id, orderId), eq(ordersTable.status, "pending")))
          .for("update");
        if (!order) return;
        await tx.update(ordersTable).set({ status: "expired" }).where(eq(ordersTable.id, order.id));
        if (order.cellId !== null) {
          await tx.update(cellsTable).set({
            phase: "closed",
            reservedByUserId: null,
            reservedUntil: null,
          }).where(and(
            eq(cellsTable.id, order.cellId),
            eq(cellsTable.phase, "reserved"),
            eq(cellsTable.reservedByUserId, user.id),
          ));
        }
      });
    }
    req.log.error({ err: error, orderId }, "Could not create Efí Pix charge");
    sendError(res, 502, "Não foi possível gerar o Pix agora. Tente novamente em instantes.", "EFI_CHARGE_FAILED");
    return;
  }
  const currentUser = await getSessionUser(req);
  res.status(201).json(GetRevelaStateResponse.parse(await getRevelaState(currentUser)));
});

router.post("/orders/:orderId/refresh", async (req, res): Promise<void> => {
  const user = await requireUser(req, res);
  if (!user) return;
  const params = RefreshOrderPaymentParams.safeParse(req.params);
  if (!params.success) {
    sendError(res, 400, "Pedido inválido.", "INVALID_ORDER");
    return;
  }

  const [order] = await db.select({ id: ordersTable.id, providerTxid: ordersTable.providerTxid })
    .from(ordersTable)
    .where(and(
      eq(ordersTable.id, params.data.orderId),
      eq(ordersTable.userId, user.id),
    ))
    .limit(1);
  if (!order) {
    sendError(res, 404, "Pedido não encontrado.", "ORDER_NOT_FOUND");
    return;
  }

  if (order.providerTxid) {
    try {
      await reconcileEfiOrder(order.id);
    } catch (error) {
      req.log.warn({ err: error, orderId: order.id }, "Could not refresh Efí Pix order");
      sendError(res, 503, "Não foi possível verificar o pagamento agora. Tentaremos novamente.", "EFI_STATUS_UNAVAILABLE");
      return;
    }
  }

  const currentUser = await getSessionUser(req);
  res.json(GetRevelaStateResponse.parse(await getRevelaState(currentUser)));
});

router.post("/orders/:orderId/simulate-payment", simulatePaymentRateLimiter, async (req, res): Promise<void> => {
  const user = await requireUser(req, res);
  if (!user) return;
  if (process.env.NODE_ENV === "production") {
    sendError(res, 403, "A simulação de pagamento está desativada.", "SIMULATION_DISABLED");
    return;
  }
  const params = SimulateOrderPaymentParams.safeParse(req.params);
  if (!params.success) {
    sendError(res, 400, "Pedido inválido.", "INVALID_ORDER");
    return;
  }

  const now = new Date();
  const result = await db.transaction(async (tx) => {
    await tx.execute(cashLedgerLockQuery);
    await getPrizeFundAccount(tx, true);

    const [order] = await tx.select().from(ordersTable)
      .where(and(eq(ordersTable.id, params.data.orderId), eq(ordersTable.userId, user.id)))
      .for("update");
    if (!order || order.status !== "pending" || order.providerTxid !== null) {
      return { error: "Este pedido não está aguardando pagamento.", code: "ORDER_UNAVAILABLE" };
    }
    if (order.expiresAt <= now) {
      await tx.update(ordersTable).set({ status: "expired" }).where(eq(ordersTable.id, order.id));
      if (order.cellId !== null) {
        await tx.update(cellsTable).set({
          phase: "closed",
          reservedByUserId: null,
          reservedUntil: null,
        }).where(and(eq(cellsTable.id, order.cellId), eq(cellsTable.reservedByUserId, user.id)));
      }
      return { error: "O Pix expirou. Escolha um novo pacote.", code: "ORDER_EXPIRED" };
    }

    const [cell] = order.cellId !== null
      ? await tx.select().from(cellsTable).where(eq(cellsTable.id, order.cellId)).for("update")
      : [];
    if (order.cellId !== null && (!cell || cell.phase !== "reserved" || cell.reservedByUserId !== user.id)) {
      return { error: "A reserva desta célula não está mais válida.", code: "CELL_UNAVAILABLE" };
    }

    const addedChances = order.packCount - (order.cellId !== null ? 1 : 0);
    await tx.update(ordersTable).set({ status: "paid", paidAt: now }).where(eq(ordersTable.id, order.id));
    await tx.insert(cashTransactionsTable).values({
      type: "package_purchase",
      amountCents: order.amountCents,
      orderId: order.id,
      isTest: true,
      createdByUserId: user.id,
      createdAt: now,
    });
    await recordPackagePurchaseContribution(tx, order.amountCents, true);
    await tx.update(usersTable)
      .set({ chances: sql`${usersTable.chances} + ${addedChances}` })
      .where(eq(usersTable.id, user.id));
    if (cell && order.cellId !== null) {
      const draw = await drawPrizeForCell(tx, cell.id, user.id, true);
      if (!draw) {
        throw new Error("No eligible prize items are available.");
      }
    }
    return { error: null, code: null };
  });

  if (result.error) {
    sendError(res, 409, result.error, result.code ?? undefined);
    return;
  }
  const currentUser = await getSessionUser(req);
  res.json(SimulateOrderPaymentResponse.parse(await getRevelaState(currentUser)));
});

function digits(value: string): string {
  return value.replace(/\D/g, "");
}

function validCpf(value: string): boolean {
  const cpf = digits(value);
  if (cpf.length !== 11 || /^(\d)\1+$/.test(cpf)) return false;
  for (let digit = 9; digit < 11; digit += 1) {
    let sum = 0;
    for (let i = 0; i < digit; i += 1) sum += Number(cpf[i]) * (digit + 1 - i);
    if (((sum * 10) % 11) % 10 !== Number(cpf[digit])) return false;
  }
  return true;
}

function normalizePixKey(type: string, value: string): { value?: string; error?: string } {
  const trimmed = value.trim();
  if (type === "cpf") {
    return validCpf(trimmed)
      ? { value: digits(trimmed) }
      : { error: "O CPF da chave Pix é inválido." };
  }
  if (type === "phone") {
    let phone = digits(trimmed);
    if (phone.length > 11 && phone.startsWith("55")) phone = phone.slice(2);
    return /^[1-9][1-9]9\d{8}$/.test(phone)
      ? { value: `+55${phone}` }
      : { error: "Celular inválido. Use DDD e número com 9 dígitos." };
  }
  if (type === "email") {
    const email = trimmed.toLowerCase();
    return email.length <= 77 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)
      ? { value: email }
      : { error: "O e-mail da chave Pix é inválido." };
  }
  if (type === "evp") {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)
      ? { value: trimmed }
      : { error: "Chave aleatória inválida. Ela tem 32 caracteres, separados por hífens." };
  }
  return { error: "Tipo de chave Pix inválido." };
}

function maskPixKey(type: string, value: string): string {
  if (type === "cpf") return `***.${value.slice(3, 6)}.${value.slice(6, 9)}-**`;
  if (type === "phone") return `(${value.slice(3, 5)}) *****-${value.slice(-4)}`;
  if (type === "email") {
    const [local = "", domain = ""] = value.split("@");
    return `${local.slice(0, 2)}***@${domain}`;
  }
  return `${value.slice(0, 8)}-****`;
}

router.post("/redemptions", redemptionRateLimiter, async (req, res): Promise<void> => {
  const user = await requireUser(req, res);
  if (!user) return;
  const parsed = RedeemCellBody.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, 400, "Confira os dados da chave Pix.", "INVALID_INPUT");
    return;
  }
  const holderCpf = digits(parsed.data.holderCpf);
  if (!validCpf(holderCpf)) {
    sendError(res, 400, "Informe um CPF válido do titular da chave.", "INVALID_CPF");
    return;
  }
  const key = normalizePixKey(parsed.data.keyType, parsed.data.pixKey);
  if (!key.value) {
    sendError(res, 400, key.error ?? "Chave Pix inválida.", "INVALID_PIX_KEY");
    return;
  }
  if (parsed.data.keyType === "cpf" && key.value !== holderCpf) {
    sendError(res, 400, "O CPF informado não é o titular desta chave Pix.", "CPF_MISMATCH");
    return;
  }

  await ensureBoard();
  const redemption = await db.transaction(async (tx) => {
    await tx.execute(cashLedgerLockQuery);
    const isTest = prizeFundUsesTestMoney();
    await getPrizeFundAccount(tx, isTest);

    const [currentCell] = await tx.select().from(cellsTable)
      .where(eq(cellsTable.id, parsed.data.cellId))
      .for("update");
    if (
      !currentCell
      || currentCell.phase !== "open"
      || currentCell.ownerUserId !== user.id
      || currentCell.redeemed
      || currentCell.redemptionStatus === "requested"
      || currentCell.redemptionStatus === "under_review"
      || currentCell.redemptionStatus === "approved"
      || currentCell.redemptionStatus === "processing"
      || currentCell.redemptionStatus === "redeemed"
    ) {
      return null;
    }
    if (currentCell.itemId === null) return null;
    const [item] = await tx.select().from(itemsTable)
      .where(eq(itemsTable.id, currentCell.itemId));
    if (!item || item.type !== "pix" || item.valueCents === null) return null;

    const [award] = await tx.select().from(prizeAwardsTable)
      .where(eq(prizeAwardsTable.cellId, currentCell.id))
      .for("update");
    if (!award || award.status !== "awarded" || award.amountCents !== item.valueCents) return null;
    const fundSnapshot = await getPrizeFundSnapshot(tx, award.isTest);
    const cashAvailableCentsAtRequest =
      fundSnapshot.cashBalanceCents
      - Math.max(0, fundSnapshot.pendingAwardsCents - award.amountCents);

    const [updatedCell] = await tx.update(cellsTable)
      .set({ redemptionStatus: "requested" })
      .where(eq(cellsTable.id, currentCell.id))
      .returning();
    if (!updatedCell) {
      throw new Error("Could not update cell redemption status.");
    }
    const [request] = await tx.insert(redemptionRequestsTable)
      .values({
        userId: user.id,
        cellId: currentCell.id,
        amountCents: item.valueCents,
        cashAvailableCentsAtRequest,
        status: "requested",
      })
      .returning();
    await tx.insert(redemptionRequestEventsTable).values({
      requestId: request.id,
      fromStatus: null,
      toStatus: "requested",
      actorUserId: user.id,
    });

    return { cell: updatedCell, request };
  });
  if (!redemption) {
    sendError(res, 409, "Esta célula não está disponível para resgate.", "CELL_NOT_REDEEMABLE");
    return;
  }

  const result = {
    requestId: redemption.request.id,
    amountCents: redemption.request.amountCents,
    maskedPixKey: maskPixKey(parsed.data.keyType, key.value),
    status: redemption.request.status,
  };
  res.status(201).json(RedeemCellResponse.parse(result));
});

router.post("/cells/:cellId/redemptions/cancel", cancelRedemptionRateLimiter, async (req, res): Promise<void> => {
  const user = await requireUser(req, res);
  if (!user) return;
  const params = CancelCellRedemptionParams.safeParse(req.params);
  if (!params.success) {
    sendError(res, 400, "Célula inválida.", "INVALID_CELL");
    return;
  }

  const cancelled = await db.transaction(async (tx) => {
    await tx.execute(cashLedgerLockQuery);

    const [cell] = await tx.select().from(cellsTable)
      .where(eq(cellsTable.id, params.data.cellId))
      .for("update");
    if (!cell || cell.ownerUserId !== user.id || cell.redeemed) return null;

    const [request] = await tx.select().from(redemptionRequestsTable)
      .where(and(
        eq(redemptionRequestsTable.cellId, cell.id),
        eq(redemptionRequestsTable.userId, user.id),
        inArray(redemptionRequestsTable.status, ["requested", "under_review"]),
      ))
      .orderBy(desc(redemptionRequestsTable.createdAt))
      .limit(1)
      .for("update");
    if (!request) return null;

    await tx.update(redemptionRequestsTable)
      .set({ status: "cancelled" })
      .where(eq(redemptionRequestsTable.id, request.id));
    await tx.update(cellsTable)
      .set({ redemptionStatus: "cancelled" })
      .where(eq(cellsTable.id, cell.id));
    await tx.insert(redemptionRequestEventsTable).values({
      requestId: request.id,
      fromStatus: request.status,
      toStatus: "cancelled",
      actorUserId: user.id,
    });
    return { requestId: request.id, status: "cancelled" as const };
  });

  if (!cancelled) {
    sendError(res, 409, "Este resgate já não pode ser cancelado.", "REDEMPTION_NOT_CANCELLABLE");
    return;
  }
  res.json(CancelCellRedemptionResponse.parse(cancelled));
});

export default router;
