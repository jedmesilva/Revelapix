import { useCallback, useEffect, useMemo, useState, type FormEvent, type InputHTMLAttributes } from 'react';
import { AlertCircle, ArrowLeft, Check, ChevronRight, Clock3, Grid2X2, LockKeyhole } from 'lucide-react';
import { CellGrid } from './components/CellGrid';
import { Modal } from './components/Modal';
import { TopBar } from './components/TopBar';
import {
  brl, digits, formatTime, maskCpf, maskKey, maskPhone, PACKS, parseKey, passwordHash,
  pixPayload, plural, prizeValue, RESERVE_MS, validCpf,
  type Cell, type KeyType, type PixOrder, type User,
} from './domain/revela';

type View = 'all' | 'mine';
type KeyOption = { id: KeyType; label: string; ph: string; mode: string };
const KEY_OPTIONS: KeyOption[] = [
  { id: 'cpf', label: 'CPF', ph: '000.000.000-00', mode: 'numeric' },
  { id: 'phone', label: 'Celular', ph: '(11) 91234-5678', mode: 'tel' },
  { id: 'email', label: 'E-mail', ph: 'voce@email.com', mode: 'email' },
  { id: 'evp', label: 'Aleatória', ph: '123e4567-e89b-12d3-a456-426614174000', mode: 'text' },
];
const stored = <T,>(key: string, fallback: T): T => {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as T : fallback; } catch { return fallback; }
};
const save = (key: string, value: unknown) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage may be unavailable */ } };
const getInitialCells = (users: Record<string, User>): Cell[] => Array.from({ length: 84 }, (_, id) => {
  let owner: string | undefined, redeemed = false;
  for (const email of Object.keys(users)) {
    const mark = users[email].cells?.[String(id)];
    if (mark !== undefined) { owner = email; redeemed = mark === 1; }
  }
  return { id, phase: owner ? 'open' as const : 'closed' as const, owner, redeemed };
});

function ErrorMessage({ children, testId }: { children: string; testId: string }) {
  return <p className="err" role="alert" data-testid={testId}><AlertCircle className="icon"/><span>{children}</span></p>;
}

function QRCode({ value }: { value: string }) {
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
    {data ? <svg viewBox={`0 0 ${data.count} ${data.count}`} shapeRendering="crispEdges" role="img" aria-label="QR code Pix demonstrativo"><path d={data.path}/></svg> :
      <p className="qr-fallback">QR indisponível. Use o código copia e cola.</p>}
  </div>;
}

function App() {
  const [users, setUsers] = useState<Record<string, User>>(() => stored('users', {}));
  const [user, setUser] = useState<User | null>(() => {
    const db = stored<Record<string, User>>('users', {});
    return db[stored<string | null>('session', null) || ''] || null;
  });
  const [cells, setCells] = useState<Cell[]>(() => getInitialCells(stored('users', {})));
  const [sparkId, setSparkId] = useState<number | null>(null);
  const [revealId, setRevealId] = useState<number | null>(null);
  const [chances, setChances] = useState(() => {
    const db = stored<Record<string, User>>('users', {});
    const session = stored<string | null>('session', null);
    return session && db[session] ? db[session].chances : 0;
  });
  const [view, setView] = useState<View>(() => window.location.hash === '#minhas-celulas' && !!stored<string | null>('session', null) ? 'mine' : 'all');
  const [dialog, setDialog] = useState<'none' | 'auth' | 'packs' | 'pix' | 'account' | 'redeem'>('none');
  const [authMode, setAuthMode] = useState<'in' | 'up'>('in');
  const [authContext, setAuthContext] = useState('');
  const [authName, setAuthName] = useState('');
  const [authEmail, setAuthEmail] = useState('');
  const [authPass, setAuthPass] = useState('');
  const [authError, setAuthError] = useState('');
  const [order, setOrder] = useState<PixOrder | null>(null);
  const [tick, setTick] = useState(Date.now());
  const [copyLabel, setCopyLabel] = useState('Copiar código Pix');
  const [redeemCell, setRedeemCell] = useState<number | null>(null);
  const [redeemType, setRedeemType] = useState<KeyType>('cpf');
  const [redeemKey, setRedeemKey] = useState('');
  const [redeemCpf, setRedeemCpf] = useState('');
  const [redeemError, setRedeemError] = useState('');
  const [redeemDone, setRedeemDone] = useState(false);
  const [redeemBusy, setRedeemBusy] = useState(false);
  const [accountPage, setAccountPage] = useState<'home' | 'password'>('home');
  const [accountMessage, setAccountMessage] = useState('');
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);

  useEffect(() => { save('users', users); }, [users]);
  useEffect(() => { save('session', user?.email ?? null); }, [user]);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(media.matches);
    media.addEventListener?.('change', update);
    return () => media.removeEventListener?.('change', update);
  }, []);
  useEffect(() => {
    const id = window.setInterval(() => setTick(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);
  useEffect(() => {
    if (!order || order.status !== 'pending' || tick < order.end) return;
    setOrder(current => current?.status === 'pending' ? { ...current, status: 'expired' } : current);
    if (order.k !== null) setCells(prev => prev.map(c => c.id === order.k ? { ...c, phase: 'closed', owner: undefined } : c));
  }, [tick, order]);
  useEffect(() => {
    const route = () => setView(window.location.hash === '#minhas-celulas' && user ? 'mine' : 'all');
    window.addEventListener('hashchange', route);
    return () => window.removeEventListener('hashchange', route);
  }, [user]);

  const closeDialog = useCallback(() => {
    if (dialog === 'pix' && order && order.status === 'pending') { setDialog('none'); return; }
    setDialog('none');
  }, [dialog, order]);
  const openAuth = (mode: 'in' | 'up', context = '') => {
    setAuthMode(mode); setAuthContext(context); setAuthError(''); setDialog('auth');
  };
  const enterUser = (nextUser: User) => {
    setUser(nextUser);
    setChances(nextUser.chances);
    setDialog('none');
    setAuthPass('');
    if (window.location.hash === '#minhas-celulas' && !nextUser.cells) setView('all');
  };
  const persistUser = (next: User) => {
    setUsers(current => ({
      ...current,
      [next.email]: { ...current[next.email], ...next, cells: { ...current[next.email]?.cells, ...next.cells } },
    }));
    if (user?.email === next.email) setUser(current => current
      ? { ...current, ...next, cells: { ...current.cells, ...next.cells } }
      : next);
  };
  const setChanceCount = (next: number) => {
    setChances(next);
    if (user) persistUser({ ...user, chances: next });
  };
  const recordCell = (cell: Cell, redeemed = cell.redeemed) => {
    setCells(current => current.map(c => c.id === cell.id ? { ...cell, redeemed } : c));
    if (user) {
      const nextCells = { ...(user.cells || {}), [String(cell.id)]: redeemed ? 1 : 0 };
      persistUser({ ...user, cells: nextCells });
    }
  };
  const routeTo = (next: View) => {
    setView(next);
    window.location.hash = next === 'mine' ? 'minhas-celulas' : 'todas';
    const scroller = document.querySelector('.scroll');
    if (scroller) scroller.scrollTop = 0;
  };
  const onCell = (cell: Cell) => {
    if (cell.phase === 'reserved') { setDialog('pix'); return; }
    if (cell.phase !== 'closed') return;
    if (!user) { openAuth('in', 'Entre na sua conta para revelar células.'); return; }
    if (chances > 0) {
      const revealed = { ...cell, phase: 'open' as const, owner: user.email, redeemed: false };
      recordCell(revealed);
      setChanceCount(chances - 1);
      if (!reducedMotion) {
        setRevealId(cell.id);
        window.setTimeout(() => {
          setRevealId(current => current === cell.id ? null : current);
          setSparkId(cell.id);
          window.setTimeout(() => setSparkId(current => current === cell.id ? null : current), 650);
        }, 380);
      }
    } else {
      setPendingCell(cell.id);
      setDialog('packs');
    }
  };
  const [pendingCell, setPendingCell] = useState<number | null>(null);
  const selectPack = (packIndex: number) => {
    const pack = PACKS[packIndex];
    const next: PixOrder = { pack, end: Date.now() + RESERVE_MS, payload: pixPayload(pack), status: 'pending', k: pendingCell };
    setOrder(next);
    if (pendingCell !== null) setCells(current => current.map(c => c.id === pendingCell ? { ...c, phase: 'reserved' } : c));
    setDialog('pix');
  };
  const simulatePayment = () => {
    if (!order || order.status !== 'pending') return;
    const paid = order;
    setOrder({ ...paid, status: 'paid' });
    window.setTimeout(() => {
      setChanceCount(chances + paid.pack.n - (paid.k !== null ? 1 : 0));
      if (paid.k !== null && user) {
        const cell = { id: paid.k, phase: 'open' as const, owner: user.email, redeemed: false };
        recordCell(cell);
        if (!reducedMotion) {
          setRevealId(cell.id);
          window.setTimeout(() => {
            setRevealId(current => current === cell.id ? null : current);
            setSparkId(cell.id);
            window.setTimeout(() => setSparkId(current => current === cell.id ? null : current), 650);
          }, 380);
        }
      }
      setOrder(null);
      setDialog('none');
    }, 900);
  };
  const signOut = () => {
    if (order?.k !== null && order?.k !== undefined && order.status === 'pending') {
      setCells(current => current.map(c => c.id === order.k ? { ...c, phase: 'closed', owner: undefined } : c));
    }
    setOrder(null); setUser(null); setChances(0); setDialog('none'); routeTo('all');
  };
  const submitAuth = async (event: FormEvent) => {
    event.preventDefault();
    const name = authName.trim(), email = authEmail.trim().toLowerCase(), password = authPass;
    if (authMode === 'up' && !name) { setAuthError('Informe seu nome.'); return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { setAuthError('Informe um e-mail válido.'); return; }
    if (authMode === 'up' ? password.length < 6 : !password) { setAuthError(authMode === 'up' ? 'A senha precisa ter ao menos 6 caracteres.' : 'Informe sua senha.'); return; }
    const hash = await passwordHash(email, password);
    const existing = users[email];
    if (authMode === 'up') {
      if (existing) { setAuthError('Já existe uma conta com este e-mail.'); return; }
      const created: User = { name, email, hash, chances: 2, cells: {} };
      setUsers(current => ({ ...current, [email]: created }));
      enterUser(created);
    } else if (!existing || existing.hash !== hash) setAuthError('E-mail ou senha incorretos.');
    else enterUser(existing);
  };
  const openAccount = () => { setAccountPage('home'); setAccountMessage(''); setDialog('account'); };
  const submitPassword = async (event: FormEvent) => {
    event.preventDefault();
    if (!user) return;
    if (newPassword.length < 6) { setPasswordError('A nova senha precisa ter ao menos 6 caracteres.'); return; }
    if (await passwordHash(user.email, oldPassword) !== user.hash) { setPasswordError('Senha atual incorreta.'); return; }
    const changed = { ...user, hash: await passwordHash(user.email, newPassword) };
    persistUser(changed); setAccountPage('home'); setAccountMessage('Senha alterada.'); setOldPassword(''); setNewPassword('');
  };
  const openRedeem = (cell: Cell) => {
    if (!user) { openAuth('in', 'Entre na sua conta para resgatar o saldo.'); return; }
    setRedeemCell(cell.id); setRedeemType('cpf'); setRedeemKey(''); setRedeemCpf(''); setRedeemError(''); setRedeemDone(false); setRedeemBusy(false); setDialog('redeem');
  };
  const submitRedeem = async (event: FormEvent) => {
    event.preventDefault();
    if (redeemCell === null) return;
    const key = parseKey(redeemType, redeemKey);
    if (key.err || !key.val) { setRedeemError(key.err || 'Chave inválida.'); return; }
    const cpf = digits(redeemCpf);
    if (!validCpf(cpf)) { setRedeemError('Informe um CPF válido do titular da chave.'); return; }
    setRedeemError(''); setRedeemBusy(true);
    await new Promise(resolve => window.setTimeout(resolve, 900));
    if (redeemType === 'cpf' && key.val !== cpf) { setRedeemBusy(false); setRedeemError('O CPF informado não é o titular desta chave Pix.'); return; }
    const target = cells[redeemCell];
    if (target) recordCell({ ...target, redeemed: true }, true);
    setRedeemBusy(false); setRedeemDone(true);
  };
  const copyPix = async () => {
    if (!order) return;
    try { await navigator.clipboard.writeText(order.payload); }
    catch {
      const area = document.createElement('textarea'); area.value = order.payload; area.style.position = 'fixed'; area.style.opacity = '0'; document.body.appendChild(area); area.select();
      try { document.execCommand('copy'); } catch { /* clipboard unavailable */ }
      area.remove();
    }
    setCopyLabel('Código copiado');
    window.setTimeout(() => setCopyLabel('Copiar código Pix'), 1500);
  };
  const cellCount = cells.filter(c => c.phase === 'open' && c.owner === user?.email).length;
  const left = order ? Math.max(0, order.end - tick) : RESERVE_MS;
  const statusLabel = order?.status === 'paid' ? 'Pagamento confirmado' : order?.status === 'expired' ? 'Pix expirado' : 'Aguardando pagamento';

  return <div className="app-shell">
    <TopBar user={user} chances={chances} onEnter={() => openAuth('in')} onBuy={() => { setPendingCell(null); setDialog(order?.status === 'pending' ? 'pix' : 'packs'); }} onAccount={openAccount}/>
    {view === 'mine' && <div className="viewbar"><div className="viewbar-in">
      <button className="back" type="button" aria-label="Voltar para todas as células" onClick={() => routeTo('all')} data-testid="button-back-all"><ArrowLeft className="icon"/></button>
      <h1>Minhas células</h1><span className="vcount" data-testid="count-my-cells">{cellCount === 1 ? '1 célula' : `${cellCount} células`}</span>
    </div></div>}
    <main className="scroll">
      {view === 'mine' && cellCount === 0 && <div className="empty" data-testid="empty-my-cells">
        <p className="sub">Você ainda não revelou nenhuma célula.</p>
        <button className="btn" type="button" onClick={() => routeTo('all')} data-testid="button-see-all">Ver todas as células</button>
      </div>}
      <CellGrid cells={cells} user={user?.email ?? null} order={order} view={view} reducedMotion={reducedMotion} sparkId={sparkId} revealId={revealId} onCell={onCell} onRedeem={openRedeem}/>
    </main>

    <Modal open={dialog === 'auth'} title={authMode === 'up' ? 'Criar conta' : 'Entrar'} onClose={() => setDialog('none')} testId="dialog-auth">
      <p className="sub">{authContext || (authMode === 'up' ? 'Crie sua conta para ganhar chances e revelar células.' : 'Entre para ver suas chances e revelar células.')}</p>
      <form className="form" onSubmit={submitAuth} noValidate>
        {authMode === 'up' && <label className="field">Nome<input className="input" autoComplete="name" value={authName} onChange={e => setAuthName(e.target.value)} data-testid="input-name"/></label>}
        <label className="field">E-mail<input className="input" type="email" autoComplete="email" inputMode="email" value={authEmail} onChange={e => setAuthEmail(e.target.value)} data-testid="input-email"/></label>
        <label className="field">Senha<input className="input" type="password" autoComplete={authMode === 'up' ? 'new-password' : 'current-password'} value={authPass} onChange={e => setAuthPass(e.target.value)} data-testid="input-password"/></label>
        {authError && <ErrorMessage testId="error-auth">{authError}</ErrorMessage>}
        <button className="btn full" type="submit" data-testid="button-submit-auth">{authMode === 'up' ? 'Criar conta' : 'Entrar'}</button>
      </form>
      <button className="link" type="button" onClick={() => { setAuthMode(authMode === 'in' ? 'up' : 'in'); setAuthError(''); }} data-testid="button-switch-auth">{authMode === 'up' ? 'Já tem conta? Entrar' : 'Não tem conta? Criar conta'}</button>
    </Modal>

    <Modal open={dialog === 'packs'} title="Comprar chances" onClose={() => setDialog('none')} testId="dialog-packs">
      <p className="sub">{pendingCell !== null ? `Você está sem chances. Escolha um pacote para revelar a célula #${pendingCell + 1}.` : 'Cada chance revela uma célula.'}</p>
      <div className="packs" data-testid="list-packs">
        {PACKS.map((pack, i) => <button className="pack" type="button" key={pack.n} onClick={() => selectPack(i)} data-testid={`button-pack-${pack.n}`}>
          <div><b>{plural(pack.n)}</b><small>{brl.format(pack.price / pack.n)} por chance</small></div><span>{brl.format(pack.price)}</span>
        </button>)}
      </div>
    </Modal>

    <Modal open={dialog === 'pix'} title="Pagar com Pix" onClose={closeDialog} wide testId="dialog-pix">
      {order && <>
        <p className="sub">{plural(order.pack.n)} · {brl.format(order.pack.price)}</p>
        <div className="pix">
          <div className={`status ${order.status}`} data-testid="status-payment">{statusLabel}</div>
          <QRCode value={order.payload}/>
          <div className="clock"><Clock3 className="icon"/><span data-testid="value-pix-timer">{order.status === 'paid' ? 'pago' : order.status === 'expired' ? '00:00' : formatTime(left)}</span><div className="bar"><i style={{ width: `${order.status === 'pending' ? Math.max(0, left / RESERVE_MS * 100) : 0}%` }}/></div></div>
          <button className="btn full" id="copy" type="button" disabled={order.status !== 'pending'} onClick={copyPix} data-testid="button-copy-pix">{copyLabel}</button>
          <button className="btn full ghost" id="sim" type="button" disabled={order.status !== 'pending'} onClick={simulatePayment} data-testid="button-simulate-payment">Simular pagamento (teste)</button>
          <p className="hint" id="hint" data-testid="text-payment-hint">
            {order.status === 'pending' ? `${order.k !== null ? `A célula #${order.k + 1} está reservada enquanto o tempo corre e será revelada ao pagar. ` : ''}Fechar esta janela não cancela o pedido. Este Pix é apenas demonstrativo.` :
              order.status === 'paid' ? (order.k !== null ? 'Abrindo sua célula…' : 'Chances adicionadas.') :
              `O Pix expirou${order.k !== null ? ' e a célula foi liberada.' : '.'}`}
          </p>
        </div>
      </>}
    </Modal>

    <Modal open={dialog === 'account'} title={accountPage === 'home' ? 'Minha conta' : 'Alterar senha'} onClose={() => setDialog('none')} testId="dialog-account">
      {user && accountPage === 'home' ? <div className="form">
        <div className="info"><div><small>Nome</small><span data-testid="text-account-name">{user.name}</span></div><div><small>E-mail</small><span data-testid="text-account-email">{user.email}</span></div></div>
        {accountMessage && <p className="hint" data-testid="status-account-message">{accountMessage}</p>}
        <nav className="menu" aria-label="Minha conta">
          <button className="item" type="button" onClick={() => { setDialog('none'); routeTo('mine'); }} data-testid="button-account-cells"><Grid2X2 className="icon"/><span className="lbl">Minhas células</span><span className="meta">{cellCount || ''}</span><ChevronRight className="icon chev"/></button>
          <button className="item" type="button" onClick={() => { setAccountPage('password'); setPasswordError(''); }} data-testid="button-account-password"><LockKeyhole className="icon"/><span className="lbl">Alterar senha</span><ChevronRight className="icon chev"/></button>
        </nav>
        <button className="btn full" type="button" onClick={signOut} data-testid="button-sign-out">Sair</button>
      </div> : <form className="form" onSubmit={submitPassword} noValidate>
        <label className="field">Senha atual<input className="input" type="password" autoComplete="current-password" value={oldPassword} onChange={e => setOldPassword(e.target.value)} data-testid="input-old-password"/></label>
        <label className="field">Nova senha<input className="input" type="password" autoComplete="new-password" value={newPassword} onChange={e => setNewPassword(e.target.value)} data-testid="input-new-password"/></label>
        {passwordError && <ErrorMessage testId="error-password">{passwordError}</ErrorMessage>}
        <button className="btn full" type="submit" data-testid="button-save-password">Salvar senha</button>
        <button className="link" type="button" onClick={() => setAccountPage('home')} data-testid="button-back-account">Voltar</button>
      </form>}
    </Modal>

    <Modal open={dialog === 'redeem'} title={redeemDone ? 'Resgate solicitado' : 'Resgatar saldo'} onClose={() => setDialog('none')} testId="dialog-redeem">
      {redeemDone ? <div className="done">
        <div className="ok"><Check className="icon"/></div>
        <p className="sub">A simulação registrou o resgate demonstrativo de {redeemCell !== null ? brl.format(prizeValue(redeemCell)) : ''} para a chave Pix {maskKey(redeemType, parseKey(redeemType, redeemKey).val || '')}. Nenhuma transferência real foi feita.</p>
        <button className="btn full" type="button" onClick={() => setDialog('none')} data-testid="button-finish-redeem">Concluir</button>
      </div> : <form className="form" onSubmit={submitRedeem} noValidate>
        <div className="info"><div><small>Valor do resgate</small><span data-testid="value-redemption">{redeemCell !== null ? brl.format(prizeValue(redeemCell)) : ''}</span></div></div>
        <div className="types" role="group" aria-label="Tipo de chave Pix">
          {KEY_OPTIONS.map(option => <button key={option.id} type="button" className="chip" aria-pressed={redeemType === option.id} onClick={() => { setRedeemType(option.id); setRedeemKey(''); setRedeemError(''); }} data-testid={`button-key-type-${option.id}`}>{option.label}</button>)}
        </div>
        <label className="field">Chave Pix<input className="input" value={redeemKey} onChange={e => setRedeemKey(redeemType === 'cpf' ? maskCpf(e.target.value) : redeemType === 'phone' ? maskPhone(e.target.value) : e.target.value)} placeholder={KEY_OPTIONS.find(x => x.id === redeemType)?.ph} inputMode={KEY_OPTIONS.find(x => x.id === redeemType)?.mode as InputHTMLAttributes<HTMLInputElement>['inputMode']} autoComplete="off" autoCapitalize="off" spellCheck={false} data-testid="input-pix-key"/></label>
        <label className="field">CPF do titular da chave<input className="input" inputMode="numeric" autoComplete="off" placeholder="000.000.000-00" maxLength={14} value={redeemCpf} onChange={e => setRedeemCpf(maskCpf(e.target.value))} data-testid="input-holder-cpf"/></label>
        <p className="hint">O CPF serve só para confirmar que a chave Pix é sua. O valor só é enviado se o titular da chave for o dono deste CPF. Esta é uma demonstração local; nenhuma transferência real acontece.</p>
        {redeemError && <ErrorMessage testId="error-redeem">{redeemError}</ErrorMessage>}
        <button className="btn full" type="submit" disabled={redeemBusy} data-testid="button-submit-redeem">{redeemBusy ? 'Verificando titular…' : 'Confirmar resgate'}</button>
      </form>}
    </Modal>
  </div>;
}

export default App;
