import { randomUUID } from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import {
  ChangePasswordBody,
  CreateOrderBody,
  GetRevelaStateResponse,
  LoginAccountBody,
  RedeemCellBody,
  RedeemCellResponse,
  RegisterAccountBody,
  RegisterAccountResponse,
  RevealCellParams,
  RevealCellResponse,
  SimulateOrderPaymentParams,
  SimulateOrderPaymentResponse,
} from "@workspace/api-zod";
import {
  cellsTable,
  chancePlansTable,
  db,
  ordersTable,
  redemptionRequestsTable,
  sessionsTable,
  usersTable,
} from "@workspace/db";
import { createSession, deleteSession, getSessionUser, hashPassword, verifyPassword } from "../lib/auth";
import {
  clearGoogleOAuthCookies,
  createGoogleSupabaseClient,
  getGoogleAuthConfig,
  getPublicAppOrigin,
} from "../lib/google-auth";
import {
  ensureBoard,
  expireReservations,
  getRevelaState,
  makeDemonstrationPixPayload,
  RESERVATION_MS,
} from "../lib/revela";

const router: IRouter = Router();

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

router.post("/auth/register", async (req, res): Promise<void> => {
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

router.post("/auth/login", async (req, res): Promise<void> => {
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

router.get("/auth/google", async (req, res): Promise<void> => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  const config = getGoogleAuthConfig();
  if (!config.enabled) {
    res.redirect(303, "/?googleAuthError=unavailable");
    return;
  }

  const appOrigin = getPublicAppOrigin();
  if (!appOrigin) {
    req.log.error("Could not determine a trusted Replit app domain for Google OAuth");
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

router.get("/auth/google/callback", async (req, res): Promise<void> => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  const config = getGoogleAuthConfig();
  const code = typeof req.query.code === "string" ? req.query.code : "";
  const providerError = typeof req.query.error === "string" ? req.query.error : "";
  if (!config.enabled || !code || providerError) {
    clearGoogleOAuthCookies(req, res);
    res.redirect(303, `/?googleAuthError=${config.enabled ? "failed" : "unavailable"}`);
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

router.post("/auth/change-password", async (req, res): Promise<void> => {
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

router.post("/cells/:cellId/reveal", async (req, res): Promise<void> => {
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

    await tx.update(usersTable)
      .set({ chances: currentUser.chances - 1 })
      .where(eq(usersTable.id, user.id));
    await tx.update(cellsTable)
      .set({
        phase: "open",
        ownerUserId: user.id,
        redeemed: false,
        reservedByUserId: null,
        reservedUntil: null,
      })
      .where(eq(cellsTable.id, cell.id));
    return { error: null, code: null };
  });

  if (result.error) {
    sendError(res, 409, result.error, result.code ?? undefined);
    return;
  }
  const currentUser = await getSessionUser(req);
  res.json(RevealCellResponse.parse(await getRevelaState(currentUser)));
});

router.post("/orders", async (req, res): Promise<void> => {
  const user = await requireUser(req, res);
  if (!user) return;
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
  const result = await db.transaction(async (tx) => {
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
        gt(ordersTable.expiresAt, createdAt),
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
        reservedUntil: expiresAt,
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
      pixPayload: makeDemonstrationPixPayload(pack.chances, pack.priceCents),
      expiresAt,
      createdAt,
    });
    return { error: null, code: null };
  });

  if (result.error) {
    sendError(res, result.status ?? 409, result.error, result.code ?? undefined);
    return;
  }
  const currentUser = await getSessionUser(req);
  res.status(201).json(GetRevelaStateResponse.parse(await getRevelaState(currentUser)));
});

router.post("/orders/:orderId/simulate-payment", async (req, res): Promise<void> => {
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
    const [order] = await tx.select().from(ordersTable)
      .where(and(eq(ordersTable.id, params.data.orderId), eq(ordersTable.userId, user.id)))
      .for("update");
    if (!order || order.status !== "pending") {
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
    await tx.update(usersTable)
      .set({ chances: sql`${usersTable.chances} + ${addedChances}` })
      .where(eq(usersTable.id, user.id));
    if (cell && order.cellId !== null) {
      await tx.update(cellsTable).set({
        phase: "open",
        ownerUserId: user.id,
        redeemed: false,
        reservedByUserId: null,
        reservedUntil: null,
      }).where(eq(cellsTable.id, cell.id));
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

router.post("/redemptions", async (req, res): Promise<void> => {
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

  const redemption = await db.transaction(async (tx) => {
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
      || currentCell.redemptionStatus === "redeemed"
    ) {
      return null;
    }
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
        amountCents: currentCell.prizeValueCents,
        status: "requested",
      })
      .returning();

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

export default router;
