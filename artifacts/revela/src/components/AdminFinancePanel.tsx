import { useCallback, useEffect, useState } from 'react';
import type { AdminCashTransaction, AdminFinanceResponse, AdminRedemptionStatus } from '@workspace/api-client-react';
import { getAdminFinance, updateRedemptionStatus } from '../lib/api';
import { brl, redemptionStatusLabels } from '../domain/revela';

type StatusAction = { status: AdminRedemptionStatus; label: string; subtle?: boolean };

const actionsForStatus: Partial<Record<AdminRedemptionStatus, StatusAction[]>> = {
  requested: [
    { status: 'under_review', label: 'Iniciar análise' },
    { status: 'rejected', label: 'Recusar', subtle: true },
    { status: 'cancelled', label: 'Cancelar', subtle: true },
  ],
  under_review: [
    { status: 'approved', label: 'Aprovar' },
    { status: 'rejected', label: 'Recusar', subtle: true },
    { status: 'cancelled', label: 'Cancelar', subtle: true },
  ],
  approved: [
    { status: 'processing', label: 'Iniciar processamento' },
    { status: 'rejected', label: 'Recusar', subtle: true },
    { status: 'cancelled', label: 'Cancelar', subtle: true },
  ],
  processing: [{ status: 'redeemed', label: 'Marcar resgate concluído' }],
};

function dateTime(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

function transactionLabel(transaction: AdminCashTransaction): string {
  if (transaction.type === 'redemption_payout') return 'Resgate concluído';
  return transaction.isTest ? 'Compra simulada' : 'Compra de pacote';
}

export function AdminFinancePanel() {
  const [data, setData] = useState<AdminFinanceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setData(await getAdminFinance());
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível carregar o financeiro.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const intervalId = window.setInterval(() => void refresh(), 15000);
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', onFocus);
    };
  }, [refresh]);

  const changeStatus = async (requestId: string, status: AdminRedemptionStatus) => {
    if (status === 'redeemed' && !window.confirm('Confirme somente depois de enviar o Pix fora do Revela. Esta ação registra a saída no caixa.')) {
      return;
    }
    setBusyId(requestId);
    try {
      await updateRedemptionStatus(requestId, status);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível atualizar o resgate.');
    } finally {
      setBusyId(null);
    }
  };

  return <div className="admin-panel" data-testid="panel-admin-finance">
    <p className="sub">Valores em reais. Somente compras confirmadas fora do modo de teste e resgates concluídos entram no caixa real.</p>
    {error && <p className="err" role="alert" data-testid="error-admin-finance">{error}</p>}
    {loading && !data
      ? <p className="admin-empty" role="status">Carregando financeiro…</p>
      : data && <>
        <div className="cash-summary" data-testid="cash-summary">
          <div className="cash-card primary">
            <small>Caixa real</small>
            <strong data-testid="value-cash-balance">{brl.format(data.cashBalanceCents / 100)}</strong>
          </div>
          <div className="cash-card">
            <small>Reservado para resgates</small>
            <strong data-testid="value-cash-reserved">{brl.format(data.reservedCents / 100)}</strong>
          </div>
          <div className={`cash-card${data.availableCents < 0 ? ' negative' : ''}`}>
            <small>Disponível</small>
            <strong data-testid="value-cash-available">{brl.format(data.availableCents / 100)}</strong>
          </div>
        </div>
        <p className="admin-test-note" data-testid="value-test-purchases">
          Compras simuladas, fora do caixa real: {brl.format(data.testPurchaseCents / 100)}
        </p>
        <p className="admin-warning">O Revela não envia Pix. Marque um resgate como concluído somente depois de fazer a transferência por fora do app.</p>

        <section className="admin-section" aria-labelledby="admin-redemptions-heading">
          <div className="admin-section-head">
            <h3 id="admin-redemptions-heading">Solicitações de resgate</h3>
            <button className="btn ghost admin-refresh" type="button" onClick={() => void refresh()} data-testid="button-refresh-finance">Atualizar</button>
          </div>
          {data.redemptions.length === 0
            ? <p className="admin-empty">Ainda não há solicitações.</p>
            : <div className="admin-list" data-testid="list-admin-redemptions">
              {data.redemptions.map(request => {
                const actions = actionsForStatus[request.status] ?? [];
                return <article className="admin-row" key={request.requestId} data-testid={`admin-redemption-${request.requestId}`}>
                  <div className="admin-row-main">
                    <div>
                      <strong>{brl.format(request.amountCents / 100)} · célula #{request.cellId + 1}</strong>
                      <span>{request.userName} · {request.userEmail}</span>
                    </div>
                    <span className={`admin-status ${request.status}`}>{redemptionStatusLabels[request.status]}</span>
                  </div>
                  <p className="admin-date">Solicitado em {dateTime(request.createdAt)}</p>
                  {actions.length > 0 && <div className="admin-actions">
                    {actions.map(action => <button
                      key={action.status}
                      type="button"
                      className={`btn${action.subtle ? ' ghost' : ''}`}
                      disabled={busyId === request.requestId}
                      onClick={() => void changeStatus(request.requestId, action.status)}
                      data-testid={`button-redemption-${action.status}-${request.requestId}`}
                    >
                      {busyId === request.requestId ? 'Salvando…' : action.label}
                    </button>)}
                  </div>}
                </article>;
              })}
            </div>}
        </section>

        <section className="admin-section" aria-labelledby="admin-transactions-heading">
          <h3 id="admin-transactions-heading">Movimentos recentes</h3>
          {data.transactions.length === 0
            ? <p className="admin-empty">Ainda não há movimentos registrados.</p>
            : <div className="admin-list" data-testid="list-cash-transactions">
              {data.transactions.map(transaction => <article className="transaction-row" key={transaction.id}>
                <div>
                  <strong>{transactionLabel(transaction)}</strong>
                  <span>{dateTime(transaction.createdAt)}</span>
                </div>
                <b className={transaction.type === 'redemption_payout' ? 'outflow' : transaction.isTest ? 'test-flow' : 'inflow'}>
                  {transaction.type === 'redemption_payout' ? '−' : '+'}{brl.format(transaction.amountCents / 100)}
                </b>
              </article>)}
            </div>}
        </section>
      </>}
  </div>;
}
