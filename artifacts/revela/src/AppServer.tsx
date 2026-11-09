import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type InputHTMLAttributes } from 'react';
import { AlertCircle, ArrowLeft, Check, ChevronRight, Clock3, Grid2X2, LockKeyhole } from 'lucide-react';
import type {
  CellState,
  ChancePlan,
  RedeemCellInputKeyType,
  RedemptionResult,
  RevelaStateResponse,
} from '@workspace/api-client-react';
import { CellGrid } from './components/CellGrid';
import { Modal } from './components/Modal';
import { TopBar } from './components/TopBar';
import {
  changePassword,
  cancelCellRedemption,
  cancelOrderPayment,
  createOrder,
  getRevelaState,
  loginAccount,
  logoutAccount,
  redeemCell,
  registerAccount,
  refreshOrderPayment,
  revealCell,
  ApiRequestError,
} from './lib/api';
import { brl, digits, formatTime, maskCpf, maskPhone, plural, redemptionStatusLabels } from './domain/revela';

type View = 'all' | 'mine';
type Dialog = 'none' | 'auth' | 'packs' | 'pix' | 'account' | 'redeem';
type KeyOption = { id: RedeemCellInputKeyType; label: string; ph: string; mode: string };
const KEY_OPTIONS: KeyOption[] = [
  { id: 'cpf', label: 'CPF', ph: '000.000.000-00', mode: 'numeric' },
  { id: 'phone', label: 'Celular', ph: '(11) 91234-5678', mode: 'tel' },
  { id: 'email', label: 'E-mail', ph: 'voce@email.com', mode: 'email' },
  { id: 'evp', label: 'Aleatória', ph: '123e4567-e89b-12d3-a456-426614174000', mode: 'text' },
];

function ErrorMessage({ children, testId }: { children: string; testId: string }) {
  return <p className="err" role="alert" data-testid={testId}><AlertCircle className="icon"/><span>{children}</span></p>;
}

function QRCode({ value, fallback = 'Código Pix indisponível no momento.' }: { value: string; fallback?: string }) {
  const data = useMemo<{ count: number; path: string } | null>(() => {
    const factory = (window as Window & { qrcode?: (version: number, level: string) => { addData: (data: string) => void; make: () => void; getModuleCount: () => number; isDark: (row: number, column: number) => boolean } }).qrcode;
    if (typeof factory !== 'function') return null;
    const code = factory(0, 'M');
    code.addData(value); code.make();
    const count = code.getModuleCount();
    let path = '';
    for (let row = 0; row < count; row++) for (let column = 0; column < count; column++) {
      if (code.isDark(row, column)) path += `M${column},${row}h1v1h-1z`;
    }
    return { count, path };
  }, [value]);
  return <div className="qr" data-testid="pix-qr">
    {!value ? <p className="qr-fallback">{fallback}</p> :
      data ? <svg viewBox={`0 0 ${data.count} ${data.count}`} shapeRendering="crispEdges" role="img" aria-label="Código QR do Pix"><path d={data.path}/></svg> :
      <p className="qr-fallback">QR indisponível. Use o código copia e cola.</p>}
  </div>;
}

function messageFrom(error: unknown): string {
  return error instanceof ApiRequestError
    ? error.message
    : 'Não foi possível concluir esta ação. Tente novamente em instantes.';
}

function AppServer() {
  const [snapshot, setSnapshot] = useState<RevelaStateResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [serverOffset, setServerOffset] = useState(0);
  const [view, setView] = useState<View>('all');
  const [dialog, setDialog] = useState<Dialog>('none');
  const [authMode, setAuthMode] = useState<'in' | 'up'>('in');
  const [authContext, setAuthContext] = useState('');
  const [authName, setAuthName] = useState('');
  const [authEmail, setAuthEmail] = useState('');
  const [authPass, setAuthPass] = useState('');
  const [authError, setAuthError] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [pendingCell, setPendingCell] = useState<number | null>(null);
  const [selectedPackId, setSelectedPackId] = useState<string | null>(null);
  const [packError, setPackError] = useState('');
  const [creatingOrder, setCreatingOrder] = useState(false);
  const [cancelingOrder, setCancelingOrder] = useState(false);
  const [tick, setTick] = useState(Date.now());
  const [copyLabel, setCopyLabel] = useState('Copiar código Pix');
  const [paymentStatusError, setPaymentStatusError] = useState('');
  const [redeemCellId, setRedeemCellId] = useState<number | null>(null);
  const [redeemType, setRedeemType] = useState<RedeemCellInputKeyType>('cpf');
  const [redeemKey, setRedeemKey] = useState('');
  const [redeemCpf, setRedeemCpf] = useState('');
  const [redeemError, setRedeemError] = useState('');
  const [redeemDone, setRedeemDone] = useState<RedemptionResult | null>(null);
  const [redeemBusy, setRedeemBusy] = useState(false);
  const [accountPage, setAccountPage] = useState<'home' | 'password'>('home');
  const [accountMessage, setAccountMessage] = useState('');
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
  const [sparkId, setSparkId] = useState<number | null>(null);
  const [revealingCellId, setRevealingCellId] = useState<number | null>(null);
  const lastExpiryRefresh = useRef<string | null>(null);
  const lastPaidOrderClose = useRef<string | null>(null);
  const revealInFlight = useRef(false);
  const serverOffsetRef = useRef(serverOffset);
  serverOffsetRef.current = serverOffset;

  const user = snapshot?.user ?? null;
  const cells = snapshot?.cells ?? [];
  const order = snapshot?.order ?? null;
  const serverNow = tick + serverOffset;
  const left = order ? Math.max(0, Date.parse(order.expiresAt) - serverNow) : 0;
  const cellCount = cells.filter(cell => cell.isMine).length;
  const selectedRedeemCell = cells.find(cell => cell.id === redeemCellId);
  const statusLabel = order?.status === 'paid'
    ? 'Pagamento confirmado'
    : order?.status === 'expired'
      ? 'Pix expirado'
      : left === 0
        ? 'Prazo encerrado · verificando pagamento'
        : 'Aguardando pagamento';
  const pendingPixNeedsRecovery = order?.status === 'pending' && !order.payload.trim();
  const progress = order
    ? Math.max(0, Math.min(100, left / Math.max(1, Date.parse(order.expiresAt) - Date.parse(order.createdAt)) * 100))
    : 0;
  const packs = snapshot?.packs ?? [];
  const selectedChancePack = packs.find(pack => pack.id === selectedPackId);
  const singleChancePrice = packs.find(pack => pack.n === 1)?.priceCents;
  const lowestUnitPrice = packs.length
    ? Math.min(...packs.map(pack => pack.priceCents / pack.n))
    : null;
  const bestValuePack = packs.find(pack => pack.n > 1 && pack.priceCents / pack.n === lowestUnitPrice)
    ?? packs.find(pack => pack.priceCents / pack.n === lowestUnitPrice);

  const acceptSnapshot = (next: RevelaStateResponse) => {
    setSnapshot(next);
    setServerOffset(Date.parse(next.serverTime) - Date.now());
    setLoadError('');
    setLoading(false);
  };

  const refreshState = useCallback(async () => {
    const next = await getRevelaState();
    setSnapshot(next);
    setServerOffset(Date.parse(next.serverTime) - Date.now());
    setLoadError('');
    setLoading(false);
    return next;
  }, []);

  useEffect(() => {
    let active = true;
    getRevelaState().then(next => {
      if (active) acceptSnapshot(next);
    }).catch(error => {
      if (active) {
        setLoadError(messageFrom(error));
        setLoading(false);
      }
    });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    const id = window.setInterval(() => setTick(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible' && (!order || order.status !== 'pending')) {
        refreshState().catch(error => setLoadError(messageFrom(error)));
      }
    };
    const id = window.setInterval(refresh, 15000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [order, refreshState]);
  useEffect(() => {
    if (!order || order.status !== 'pending' || cancelingOrder) {
      setPaymentStatusError('');
      return;
    }

    let active = true;
    const checkPayment = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const next = await refreshOrderPayment(order.id);
        if (!active) return;
        setPaymentStatusError('');
        acceptSnapshot(next);
      } catch {
        if (active) {
          const deadlinePassed = Date.parse(order.expiresAt) <= Date.now() + serverOffsetRef.current;
          setPaymentStatusError(deadlinePassed
            ? 'O prazo terminou, mas não foi possível confirmar a situação do pagamento. Continuaremos verificando; não faça outro pagamento enquanto isso.'
            : 'Não foi possível verificar agora. A confirmação será tentada novamente.');
        }
      }
    };
    const interval = window.setInterval(() => { void checkPayment(); }, 8_000);
    window.addEventListener('focus', checkPayment);
    document.addEventListener('visibilitychange', checkPayment);
    void checkPayment();

    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener('focus', checkPayment);
      document.removeEventListener('visibilitychange', checkPayment);
    };
  }, [order?.id, order?.status, cancelingOrder]);
  useEffect(() => {
    if (!order || order.status !== 'paid' || lastPaidOrderClose.current === order.id) return;
    lastPaidOrderClose.current = order.id;
    const timeout = window.setTimeout(() => {
      setDialog(current => current === 'pix' ? 'none' : current);
      refreshState().catch(error => setLoadError(messageFrom(error)));
    }, 900);
    return () => window.clearTimeout(timeout);
  }, [order?.id, order?.status, refreshState]);
  useEffect(() => {
    if (!order || order.status !== 'expired' || dialog !== 'pix') return;
    const timeout = window.setTimeout(() => {
      setDialog(current => current === 'pix' ? 'none' : current);
      refreshState().catch(error => setLoadError(messageFrom(error)));
    }, 900);
    return () => window.clearTimeout(timeout);
  }, [order?.id, order?.status, dialog, refreshState]);
  useEffect(() => {
    if (dialog === 'packs' && order?.status === 'pending' && order.payload.trim()) {
      setPackError('');
      setDialog('pix');
    }
  }, [dialog, order?.id, order?.status, order?.payload]);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(media.matches);
    media.addEventListener?.('change', update);
    return () => media.removeEventListener?.('change', update);
  }, []);
  useEffect(() => {
    if (!order || order.status !== 'pending' || left > 0 || lastExpiryRefresh.current === order.id) return;
    lastExpiryRefresh.current = order.id;
    refreshState().catch(error => setLoadError(messageFrom(error)));
  }, [left, order, refreshState]);
  useEffect(() => {
    const route = () => setView(window.location.hash === '#minhas-celulas' && user ? 'mine' : 'all');
    window.addEventListener('hashchange', route);
    route();
    return () => window.removeEventListener('hashchange', route);
  }, [user]);

  const closeDialog = useCallback(() => {
    setRedeemType('cpf');
    setRedeemKey('');
    setRedeemCpf('');
    setRedeemDone(null);
    setDialog('none');
  }, []);
  const openAuth = (mode: 'in' | 'up', context = '') => {
    setAuthMode(mode);
    setAuthContext(context);
    setAuthError('');
    setDialog('auth');
  };
  const routeTo = (next: View) => {
    setView(next);
    window.location.hash = next === 'mine' ? 'minhas-celulas' : 'todas';
    const scroller = document.querySelector('.scroll');
    if (scroller) scroller.scrollTop = 0;
  };
  const openPacks = (cellId: number | null) => {
    setPendingCell(cellId);
    setSelectedPackId(bestValuePack?.id ?? null);
    setPackError('');
    setDialog('packs');
  };
  const openPendingOrder = () => {
    setPendingCell(null);
    setPackError('');
    if (pendingPixNeedsRecovery) {
      setPackError('O código Pix deste pedido ainda não chegou. Tente verificar o pedido antes de iniciar outro pagamento.');
      setDialog('packs');
    } else {
      setDialog('pix');
    }
  };
  const showReveal = (cellId: number) => {
    if (reducedMotion) return;
    setSparkId(cellId);
    window.setTimeout(() => setSparkId(current => current === cellId ? null : current), 650);
  };

  const onCell = async (cell: CellState) => {
    if (revealInFlight.current) return;
    if (cell.phase === 'reserved') {
      if (order?.status === 'pending' && order.cellId === cell.id) openPendingOrder();
      return;
    }
    if (cell.phase !== 'closed') return;
    if (!user) {
      openAuth('in', 'Entre na sua conta para revelar células.');
      return;
    }
    revealInFlight.current = true;
    setRevealingCellId(cell.id);
    try {
      acceptSnapshot(await revealCell(cell.id));
      showReveal(cell.id);
    } catch (error) {
      if (error instanceof ApiRequestError && error.code === 'INSUFFICIENT_CHANCES') {
        openPacks(cell.id);
        return;
      }
      setLoadError(messageFrom(error));
    } finally {
      revealInFlight.current = false;
      setRevealingCellId(null);
    }
  };

  const continueWithPack = async () => {
    if (selectedPackId === null || creatingOrder) return;
    setCreatingOrder(true);
    setPackError('');
    try {
      setPaymentStatusError('');
      acceptSnapshot(await createOrder({ packId: selectedPackId, cellId: pendingCell }));
      setDialog('pix');
    } catch (error) {
      try {
        const current = await refreshState();
        if (current.order?.status === 'pending') {
          if (current.order.payload.trim()) {
            setDialog('pix');
          } else {
            setPackError('O pedido foi iniciado, mas o código Pix ainda não chegou. Tente verificar o pedido antes de iniciar outro pagamento.');
          }
          return;
        }
      } catch {
        // Keep the original order-creation error visible when recovery also fails.
      }
      setPackError(messageFrom(error));
    } finally {
      setCreatingOrder(false);
    }
  };

  const recoverPendingOrder = async () => {
    const pendingOrder = snapshot?.order;
    if (!pendingOrder || pendingOrder.status !== 'pending' || creatingOrder) return;
    setCreatingOrder(true);
    setPackError('');
    try {
      const next = await refreshOrderPayment(pendingOrder.id);
      acceptSnapshot(next);
      if (next.order?.status === 'pending' && next.order.payload.trim()) {
        setDialog('pix');
      } else if (next.order?.status === 'paid') {
        setDialog('none');
      } else if (next.order?.status === 'expired') {
        setPackError('Este pedido Pix expirou. Você já pode selecionar um pacote e iniciar outro pagamento.');
      } else {
        setPackError('A Efí ainda não disponibilizou o código Pix. Tente verificar novamente antes de iniciar outro pagamento.');
      }
    } catch (error) {
      setPackError(messageFrom(error));
    } finally {
      setCreatingOrder(false);
    }
  };

  const cancelAndChooseOtherPack = async () => {
    const pendingOrder = snapshot?.order;
    if (!pendingOrder || pendingOrder.status !== 'pending' || cancelingOrder) return;
    if (!window.confirm('Cancelar este Pix e escolher outra opção? O código atual deixará de funcionar.')) return;

    setCancelingOrder(true);
    setPaymentStatusError('');
    try {
      const next = await cancelOrderPayment(pendingOrder.id);
      acceptSnapshot(next);
      if (next.order?.status === 'paid') {
        setDialog('pix');
        return;
      }
      if (next.order?.status === 'expired' || !next.order) {
        setPendingCell(pendingOrder.cellId);
        setSelectedPackId(null);
        setPackError('');
        setDialog('packs');
        return;
      }
      setPaymentStatusError('O Pix ainda não foi cancelado. Aguarde a verificação antes de iniciar outro pagamento.');
    } catch (error) {
      setPaymentStatusError(messageFrom(error));
    } finally {
      setCancelingOrder(false);
    }
  };

  const signOut = async () => {
    try {
      await logoutAccount();
      acceptSnapshot(await getRevelaState());
      setDialog('none');
      setPendingCell(null);
      setRedeemDone(null);
      setRedeemType('cpf');
      setRedeemKey('');
      setRedeemCpf('');
      routeTo('all');
    } catch (error) {
      setLoadError(messageFrom(error));
    }
  };

  const submitAuth = async (event: FormEvent) => {
    event.preventDefault();
    setAuthBusy(true);
    setAuthError('');
    try {
      const next = authMode === 'up'
        ? await registerAccount({ name: authName, email: authEmail, password: authPass })
        : await loginAccount({ email: authEmail, password: authPass });
      acceptSnapshot(next);
      setDialog('none');
      setAuthPass('');
    } catch (error) {
      setAuthError(messageFrom(error));
    } finally {
      setAuthBusy(false);
    }
  };

  const openAccount = () => {
    setAccountPage('home');
    setAccountMessage('');
    setDialog('account');
  };
  const submitPassword = async (event: FormEvent) => {
    event.preventDefault();
    setPasswordBusy(true);
    setPasswordError('');
    try {
      await changePassword({
        ...(user?.hasPassword ? { currentPassword: oldPassword } : {}),
        newPassword,
      });
      setAccountPage('home');
      setAccountMessage('Senha alterada.');
      setOldPassword('');
      setNewPassword('');
      acceptSnapshot(await getRevelaState());
    } catch (error) {
      setPasswordError(messageFrom(error));
    } finally {
      setPasswordBusy(false);
    }
  };

  const openRedeem = (cell: CellState) => {
    if (!user) {
      openAuth('in', 'Entre na sua conta para resgatar o saldo.');
      return;
    }
    setRedeemCellId(cell.id);
    setRedeemType('cpf');
    setRedeemKey('');
    setRedeemCpf('');
    setRedeemError('');
    setRedeemDone(null);
    setRedeemBusy(false);
    setDialog('redeem');
  };
  const submitRedeem = async (event: FormEvent) => {
    event.preventDefault();
    if (redeemCellId === null) return;
    setRedeemBusy(true);
    setRedeemError('');
    try {
      const result = await redeemCell({
        cellId: redeemCellId,
        keyType: redeemType,
        pixKey: redeemKey,
        holderCpf: redeemCpf,
      });
      setRedeemKey('');
      setRedeemCpf('');
      setRedeemDone(result);
      await refreshState();
    } catch (error) {
      setRedeemError(messageFrom(error));
    } finally {
      setRedeemBusy(false);
    }
  };

  const onCancelRedemption = async (cellId: number) => {
    if (!window.confirm('Cancelar esta solicitação de resgate?')) return;
    try {
      await cancelCellRedemption(cellId);
      await refreshState();
    } catch (error) {
      setLoadError(messageFrom(error));
    }
  };

  const copyPix = async () => {
    if (!order) return;
    if (!order.payload) return;
    try { await navigator.clipboard.writeText(order.payload); }
    catch {
      const area = document.createElement('textarea');
      area.value = order.payload;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      try { document.execCommand('copy'); } catch { /* clipboard unavailable */ }
      area.remove();
    }
    setCopyLabel('Código copiado');
    window.setTimeout(() => setCopyLabel('Copiar código Pix'), 1500);
  };

  return <div className="app-shell">
    <TopBar
      user={user}
      onEnter={() => openAuth('in')}
      onBuy={() => {
        if (order?.status === 'pending') {
          openPendingOrder();
        } else {
          openPacks(null);
        }
      }}
      onAccount={openAccount}
    />
    {loadError && <div role="alert" className="err" style={{ margin: '12px auto', maxWidth: 720 }}><AlertCircle className="icon"/><span>{loadError}</span></div>}
    {view === 'mine' && <div className="viewbar"><div className="viewbar-in">
      <button className="back" type="button" aria-label="Voltar para todas as células" onClick={() => routeTo('all')} data-testid="button-back-all"><ArrowLeft className="icon"/></button>
      <h1>Minhas células</h1><span className="vcount" data-testid="count-my-cells">{cellCount === 1 ? '1 célula' : `${cellCount} células`}</span>
    </div></div>}
    <main className="scroll">
      {loading && <div className="empty" role="status"><p className="sub">Carregando…</p></div>}
      {!loading && !snapshot && <div className="empty"><p className="sub">Não foi possível carregar as células.</p><button className="btn" type="button" onClick={() => refreshState().catch(error => setLoadError(messageFrom(error)))}>Tentar novamente</button></div>}
      {!loading && snapshot && view === 'mine' && cellCount === 0 && <div className="empty" data-testid="empty-my-cells">
        <p className="sub">Você ainda não revelou nenhuma célula.</p>
        <button className="btn" type="button" onClick={() => routeTo('all')} data-testid="button-see-all">Ver todas as células</button>
      </div>}
      {!loading && snapshot && <CellGrid cells={cells} view={view} reducedMotion={reducedMotion} sparkId={sparkId} revealingCellId={revealingCellId} onCell={onCell} onRedeem={openRedeem} onCancelRedemption={onCancelRedemption}/>}
    </main>

    <Modal open={dialog === 'auth'} title={authMode === 'up' ? 'Criar conta' : 'Entrar'} onClose={closeDialog} testId="dialog-auth">
      <p className="sub">{authContext || (authMode === 'up' ? 'Crie sua conta para ganhar chances e revelar células.' : 'Entre para ver suas chances e revelar células.')}</p>
      <form className="form" onSubmit={submitAuth} noValidate>
        {authMode === 'up' && <label className="field">Nome<input className="input" autoComplete="name" value={authName} onChange={e => setAuthName(e.target.value)} data-testid="input-name"/></label>}
        <label className="field">E-mail<input className="input" type="email" autoComplete="email" inputMode="email" value={authEmail} onChange={e => setAuthEmail(e.target.value)} data-testid="input-email"/></label>
        <label className="field">Senha<input className="input" type="password" autoComplete={authMode === 'up' ? 'new-password' : 'current-password'} value={authPass} onChange={e => setAuthPass(e.target.value)} data-testid="input-password"/></label>
        {authError && <ErrorMessage testId="error-auth">{authError}</ErrorMessage>}
        <button className="btn full" type="submit" disabled={authBusy} data-testid="button-submit-auth">{authBusy ? 'Aguarde…' : authMode === 'up' ? 'Criar conta' : 'Entrar'}</button>
      </form>
      <button className="link" type="button" onClick={() => { setAuthMode(authMode === 'in' ? 'up' : 'in'); setAuthError(''); }} data-testid="button-switch-auth">{authMode === 'up' ? 'Já tem conta? Entrar' : 'Não tem conta? Criar conta'}</button>
    </Modal>

    <Modal open={dialog === 'packs'} title="Comprar chances" onClose={closeDialog} testId="dialog-packs">
      <p className="sub">{pendingCell !== null
        ? 'Você está sem chances. Escolha um pacote para adicionar mais chances e revelar a célula escolhida.'
        : 'Cada chance revela uma célula.'}</p>
      <fieldset className="pack-grid" data-testid="list-packs">
        <legend className="sr-only">Selecione um pacote de chances</legend>
        {packs.length === 0
          ? <p className="sub">Nenhum pacote está disponível no momento.</p>
          : packs.map((pack: ChancePlan) => {
            const unitPrice = pack.priceCents / pack.n;
            const savings = singleChancePrice && pack.n > 1
              ? Math.round((1 - unitPrice / singleChancePrice) * 100)
              : 0;
            const bestValue = pack.n > 1 && lowestUnitPrice !== null && unitPrice === lowestUnitPrice;
            const selected = selectedPackId === pack.id;
            return <label
              className={`pack-option${selected ? ' selected' : ''}${bestValue ? ' is-best' : ''}`}
              key={pack.id}
              data-testid={`button-pack-${pack.n}`}
            >
              <input
                className="pack-radio-input"
                type="radio"
                name="chance-pack"
                value={pack.id}
                checked={selected}
                onChange={() => { setSelectedPackId(pack.id); setPackError(''); }}
              />
              <span className="pack-radio" aria-hidden="true"/>
              <span className="pack-main">
                <span className="pack-name">{plural(pack.n)}</span>
                <span className="pack-unit">
                  {savings > 0 && singleChancePrice !== undefined && <s>{brl.format(singleChancePrice / 100)}</s>}
                  {brl.format(unitPrice / 100)} por chance
                </span>
              </span>
              <span className="pack-end">
                <span className="pack-total">{brl.format(pack.priceCents / 100)}</span>
                {savings > 0 && <span className="pack-badge">−{savings}%</span>}
              </span>
              {bestValue && <span className="pack-best">Recomendado</span>}
            </label>;
          })}
      </fieldset>
      {packError && <ErrorMessage testId="error-pack-order">{packError}</ErrorMessage>}
      <div className="pack-confirm">
        <button
          className="btn full pack-continue"
          type="button"
          disabled={(!pendingPixNeedsRecovery && !selectedChancePack) || creatingOrder}
          onClick={pendingPixNeedsRecovery ? recoverPendingOrder : continueWithPack}
          data-testid="button-continue-pack"
        >
          {creatingOrder
            ? pendingPixNeedsRecovery ? 'Verificando Pix…' : 'Preparando Pix…'
            : pendingPixNeedsRecovery
              ? 'Verificar pedido Pix'
              : selectedChancePack
              ? `Pagar ${brl.format(selectedChancePack.priceCents / 100)} com Pix`
              : 'Selecione um pacote'}
        </button>
      </div>
    </Modal>

    <Modal open={dialog === 'pix'} title="Pagar com Pix" onClose={closeDialog} wide testId="dialog-pix">
      {order && <>
        <p className="sub">{plural(order.pack.n)} · {brl.format(order.pack.priceCents / 100)}</p>
        <div className="pix">
          <div className={`status ${order.status}`} data-testid="status-payment">{statusLabel}</div>
          <QRCode
            value={order.status === 'pending' && left > 0 ? order.payload : ''}
            fallback={left === 0 && order.status === 'pending'
              ? 'Prazo encerrado. Verificando o pagamento…'
              : 'Código Pix indisponível. Tente verificar o pedido novamente.'}
          />
          <div className="clock"><Clock3 className="icon"/><span data-testid="value-pix-timer">{order.status === 'paid' ? 'pago' : order.status === 'expired' ? '00:00' : formatTime(left)}</span><div className="bar"><i style={{ width: `${order.status === 'pending' ? progress : 0}%` }}/></div></div>
          <button className="btn full" id="copy" type="button" disabled={order.status !== 'pending' || left === 0 || !order.payload.trim()} onClick={copyPix} data-testid="button-copy-pix">{left === 0 && order.status === 'pending' ? 'Prazo do Pix encerrado' : copyLabel}</button>
          {paymentStatusError && <p className="hint" role="status" data-testid="text-payment-check-error">{paymentStatusError}</p>}
          <p className="hint" id="hint" data-testid="text-payment-hint">
            {order.status === 'pending' ? left === 0
              ? 'O prazo do Pix terminou, mas ainda não foi possível confirmar o resultado junto à Efí. Não faça outro pagamento até a confirmação.'
              : `${order.cellId !== null ? 'A célula escolhida está reservada enquanto o pagamento estiver pendente e será revelada após a confirmação. ' : ''}Fechar esta janela não cancela o pedido. O pagamento será confirmado automaticamente.` :
              order.status === 'paid' ? (order.cellId !== null ? 'Abrindo sua célula…' : 'Chances adicionadas.') :
              `O Pix expirou${order.cellId !== null ? ' e a célula foi liberada.' : '.'}`}
          </p>
          {order.status === 'pending' && order.payload.trim() && <button
            className="link pix-cancel"
            type="button"
            disabled={cancelingOrder}
            onClick={cancelAndChooseOtherPack}
            data-testid="button-choose-other-pack"
          >
            {cancelingOrder ? 'Cancelando Pix…' : 'Escolher outra opção'}
          </button>}
        </div>
      </>}
    </Modal>

    <Modal open={dialog === 'account'} title={accountPage === 'home' ? 'Minha conta' : user?.hasPassword ? 'Alterar senha' : 'Criar senha'} onClose={closeDialog} testId="dialog-account">
      {user && accountPage === 'home' ? <div className="form">
        <div className="info"><div><small>Nome</small><span data-testid="text-account-name">{user.name}</span></div><div><small>E-mail</small><span data-testid="text-account-email">{user.email}</span></div></div>
        {accountMessage && <p className="hint" data-testid="status-account-message">{accountMessage}</p>}
        <nav className="menu" aria-label="Minha conta">
          <button className="item" type="button" onClick={() => { setDialog('none'); routeTo('mine'); }} data-testid="button-account-cells"><Grid2X2 className="icon"/><span className="lbl">Minhas células</span><span className="meta">{cellCount || ''}</span><ChevronRight className="icon chev"/></button>
          <button className="item" type="button" onClick={() => { setAccountPage('password'); setPasswordError(''); setOldPassword(''); setNewPassword(''); }} data-testid="button-account-password"><LockKeyhole className="icon"/><span className="lbl">{user.hasPassword ? 'Alterar senha' : 'Criar senha'}</span><ChevronRight className="icon chev"/></button>
        </nav>
        <button className="btn full" type="button" onClick={signOut} data-testid="button-sign-out">Sair</button>
      </div> : <form className="form" onSubmit={submitPassword} noValidate>
        {user?.hasPassword && <label className="field">Senha atual<input className="input" type="password" autoComplete="current-password" value={oldPassword} onChange={e => setOldPassword(e.target.value)} data-testid="input-old-password"/></label>}
        <label className="field">Nova senha<input className="input" type="password" autoComplete="new-password" value={newPassword} onChange={e => setNewPassword(e.target.value)} data-testid="input-new-password"/></label>
        {passwordError && <ErrorMessage testId="error-password">{passwordError}</ErrorMessage>}
        <button className="btn full" type="submit" disabled={passwordBusy} data-testid="button-save-password">{passwordBusy ? 'Salvando…' : 'Salvar senha'}</button>
        <button className="link" type="button" onClick={() => setAccountPage('home')} data-testid="button-back-account">Voltar</button>
      </form>}
    </Modal>

    <Modal open={dialog === 'redeem'} title={redeemDone ? 'Resgate solicitado' : 'Resgatar saldo'} onClose={closeDialog} testId="dialog-redeem">
      {!redeemDone && <p className="hint">Informe a chave Pix e o CPF para solicitar o resgate.</p>}
      {redeemDone ? <div className="done">
        <div className="ok"><Check className="icon"/></div>
        <p className="sub">Sua solicitação de {brl.format(redeemDone.amountCents / 100)} para a chave Pix {redeemDone.maskedPixKey} foi registrada. Status: {redemptionStatusLabels[redeemDone.status]}.</p>
        <button className="btn full" type="button" onClick={closeDialog} data-testid="button-finish-redeem">Concluir</button>
      </div> : <form className="form" onSubmit={submitRedeem} noValidate>
        <div className="info"><div><small>Valor do resgate</small><span data-testid="value-redemption">{selectedRedeemCell?.item?.valueCents != null ? brl.format(selectedRedeemCell.item.valueCents / 100) : ''}</span></div></div>
        <div className="types" role="group" aria-label="Tipo de chave Pix">
          {KEY_OPTIONS.map(option => <button key={option.id} type="button" className="chip" aria-pressed={redeemType === option.id} onClick={() => { setRedeemType(option.id); setRedeemKey(''); setRedeemError(''); }} data-testid={`button-key-type-${option.id}`}>{option.label}</button>)}
        </div>
        <label className="field">Chave Pix<input className="input" value={redeemKey} onChange={e => setRedeemKey(redeemType === 'cpf' ? maskCpf(e.target.value) : redeemType === 'phone' ? maskPhone(e.target.value) : e.target.value)} placeholder={KEY_OPTIONS.find(x => x.id === redeemType)?.ph} inputMode={KEY_OPTIONS.find(x => x.id === redeemType)?.mode as InputHTMLAttributes<HTMLInputElement>['inputMode']} autoComplete="off" autoCapitalize="off" spellCheck={false} data-testid="input-pix-key"/></label>
        <label className="field">CPF do titular da chave<input className="input" inputMode="numeric" autoComplete="off" placeholder="000.000.000-00" maxLength={14} value={redeemCpf} onChange={e => setRedeemCpf(maskCpf(e.target.value))} data-testid="input-holder-cpf"/></label>
        {redeemError && <ErrorMessage testId="error-redeem">{redeemError}</ErrorMessage>}
        <button className="btn full" type="submit" disabled={redeemBusy} data-testid="button-submit-redeem">{redeemBusy ? 'Enviando solicitação…' : 'Solicitar resgate'}</button>
      </form>}
    </Modal>

  </div>;
}

export default AppServer;
