import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  GetAdminFinanceResponse,
  UpdateRedemptionStatusBody,
  UpdateRedemptionStatusParams,
  UpdateRedemptionStatusResponse,
} from "@workspace/api-zod";
import {
  cashTransactionsTable,
  cashLedgerLockQuery,
  db,
  redemptionRequestEventsTable,
  redemptionRequestsTable,
  redemptionStatusEnum,
  usersTable,
  cellsTable,
} from "@workspace/db";
import { getSessionUser } from "../lib/auth";

const router: IRouter = Router();

type RedemptionStatus = (typeof redemptionStatusEnum.enumValues)[number];

const activeRedemptionStatuses = ["requested", "under_review", "approved", "processing"] as const;

function calculateCashCoveragePercent(
  availableCentsAtRequest: number | null,
  amountCents: number,
): number | null {
  if (availableCentsAtRequest === null) return null;
  return Math.max(0, Math.round((availableCentsAtRequest / amountCents) * 10_000) / 100);
}

const allowedTransitions: Record<RedemptionStatus, readonly RedemptionStatus[]> = {
  requested: ["under_review", "rejected", "cancelled"],
  under_review: ["approved", "rejected", "cancelled"],
  approved: ["processing", "rejected", "cancelled"],
  rejected: [],
  cancelled: [],
  processing: ["redeemed"],
  redeemed: [],
};

function sendError(res: Response, status: number, message: string, code: string): void {
  res.status(status).json({ error: message, code });
}

async function requireAdmin(req: Request, res: Response) {
  const user = await getSessionUser(req);
  if (!user) {
    sendError(res, 401, "Entre na sua conta para continuar.", "AUTH_REQUIRED");
    return null;
  }
  if (!user.isAdmin) {
    sendError(res, 403, "Acesso restrito a administradores.", "ADMIN_REQUIRED");
    return null;
  }
  return user;
}

router.get("/admin/finance", async (req, res): Promise<void> => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const [totals] = await db.select({
    incomingCents: sql<string>`coalesce(sum(case
      when ${cashTransactionsTable.type} = 'package_purchase' and ${cashTransactionsTable.isTest} = false
      then ${cashTransactionsTable.amountCents} else 0 end), 0)::text`,
    outgoingCents: sql<string>`coalesce(sum(case
      when ${cashTransactionsTable.type} = 'redemption_payout' and ${cashTransactionsTable.isTest} = false
      then ${cashTransactionsTable.amountCents} else 0 end), 0)::text`,
    testPurchaseCents: sql<string>`coalesce(sum(case
      when ${cashTransactionsTable.type} = 'package_purchase' and ${cashTransactionsTable.isTest} = true
      then ${cashTransactionsTable.amountCents} else 0 end), 0)::text`,
  }).from(cashTransactionsTable);

  const [reserved] = await db.select({
    totalCents: sql<string>`coalesce(sum(${redemptionRequestsTable.amountCents}), 0)::text`,
  })
    .from(redemptionRequestsTable)
    .where(inArray(redemptionRequestsTable.status, activeRedemptionStatuses));

  const redemptions = await db.select({
    requestId: redemptionRequestsTable.id,
    userName: usersTable.name,
    userEmail: usersTable.email,
    cellId: redemptionRequestsTable.cellId,
    amountCents: redemptionRequestsTable.amountCents,
    cashAvailableCentsAtRequest: redemptionRequestsTable.cashAvailableCentsAtRequest,
    status: redemptionRequestsTable.status,
    createdAt: redemptionRequestsTable.createdAt,
    updatedAt: redemptionRequestsTable.updatedAt,
  })
    .from(redemptionRequestsTable)
    .innerJoin(usersTable, eq(usersTable.id, redemptionRequestsTable.userId))
    .orderBy(desc(redemptionRequestsTable.createdAt))
    .limit(100);

  const transactions = await db.select({
    id: cashTransactionsTable.id,
    type: cashTransactionsTable.type,
    amountCents: cashTransactionsTable.amountCents,
    isTest: cashTransactionsTable.isTest,
    createdAt: cashTransactionsTable.createdAt,
  })
    .from(cashTransactionsTable)
    .orderBy(desc(cashTransactionsTable.createdAt))
    .limit(50);

  const cashBalanceCents = Number(totals?.incomingCents ?? 0) - Number(totals?.outgoingCents ?? 0);
  const reservedCents = Number(reserved?.totalCents ?? 0);
  res.json(GetAdminFinanceResponse.parse({
    cashBalanceCents,
    reservedCents,
    availableCents: cashBalanceCents - reservedCents,
    testPurchaseCents: Number(totals?.testPurchaseCents ?? 0),
    redemptions: redemptions.map((redemption) => ({
      ...redemption,
      cashCoveragePercent: calculateCashCoveragePercent(
        redemption.cashAvailableCentsAtRequest,
        redemption.amountCents,
      ),
    })),
    transactions,
  }));
});

router.patch("/admin/redemptions/:requestId", async (req, res): Promise<void> => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const params = UpdateRedemptionStatusParams.safeParse(req.params);
  const body = UpdateRedemptionStatusBody.safeParse(req.body);
  if (!params.success || !body.success) {
    sendError(res, 400, "Solicitação ou status inválido.", "INVALID_INPUT");
    return;
  }

  const result = await db.transaction(async (tx) => {
    await tx.execute(cashLedgerLockQuery);

    const [requestLocator] = await tx.select({
      cellId: redemptionRequestsTable.cellId,
    }).from(redemptionRequestsTable)
      .where(eq(redemptionRequestsTable.id, params.data.requestId))
      .limit(1);
    if (!requestLocator) return { kind: "not_found" as const };
    const [cell] = await tx.select().from(cellsTable)
      .where(eq(cellsTable.id, requestLocator.cellId))
      .for("update");
    if (!cell) return { kind: "not_found" as const };
    const [request] = await tx.select().from(redemptionRequestsTable)
      .where(eq(redemptionRequestsTable.id, params.data.requestId))
      .for("update");
    if (!request || request.cellId !== cell.id) return { kind: "not_found" as const };
    if (!allowedTransitions[request.status].includes(body.data.status)) return { kind: "invalid_transition" as const };
    const [owner] = await tx.select({
      name: usersTable.name,
      email: usersTable.email,
    }).from(usersTable).where(eq(usersTable.id, request.userId));
    if (!owner) return { kind: "not_found" as const };

    const nextStatus = body.data.status;
    const now = new Date();
    const [updated] = await tx.update(redemptionRequestsTable)
      .set({ status: nextStatus, updatedAt: now })
      .where(and(
        eq(redemptionRequestsTable.id, request.id),
        eq(redemptionRequestsTable.status, request.status),
      ))
      .returning();
    if (!updated) return { kind: "invalid_transition" as const };

    await tx.update(cellsTable)
      .set({ redemptionStatus: nextStatus, redeemed: nextStatus === "redeemed" })
      .where(eq(cellsTable.id, cell.id));

    await tx.insert(redemptionRequestEventsTable).values({
      requestId: request.id,
      fromStatus: request.status,
      toStatus: nextStatus,
      actorUserId: admin.id,
    });

    if (nextStatus === "redeemed") {
      await tx.insert(cashTransactionsTable).values({
        type: "redemption_payout",
        amountCents: request.amountCents,
        redemptionRequestId: request.id,
        isTest: false,
        createdByUserId: admin.id,
        createdAt: now,
      });
    }

    return {
      kind: "updated" as const,
      redemption: {
        requestId: request.id,
        userName: owner.name,
        userEmail: owner.email,
        cellId: request.cellId,
        amountCents: request.amountCents,
        cashAvailableCentsAtRequest: request.cashAvailableCentsAtRequest,
        cashCoveragePercent: calculateCashCoveragePercent(
          request.cashAvailableCentsAtRequest,
          request.amountCents,
        ),
        status: updated.status,
        createdAt: request.createdAt,
        updatedAt: updated.updatedAt,
      },
    };
  });

  if (result.kind === "not_found") {
    sendError(res, 404, "Solicitação de resgate não encontrada.", "REDEMPTION_NOT_FOUND");
    return;
  }
  if (result.kind === "invalid_transition") {
    sendError(res, 409, "Essa mudança não é permitida para o status atual.", "INVALID_STATUS_TRANSITION");
    return;
  }
  res.json(UpdateRedemptionStatusResponse.parse(result.redemption));
});

export default router;
