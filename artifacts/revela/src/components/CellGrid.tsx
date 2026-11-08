import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { Check, Clock, Gift } from 'lucide-react';
import type { CellState } from '@workspace/api-client-react';
import { art, brl, formatTime, iconPaths, redemptionStatusLabels } from '../domain/revela';

type Props = { cells: CellState[]; view: 'all' | 'mine'; reducedMotion: boolean; sparkId: number | null; revealId: number | null; onCell: (cell: CellState) => void; onRedeem: (cell: CellState, button: HTMLButtonElement) => void };
export function CellGrid({ cells, view, reducedMotion, sparkId, revealId, onCell, onRedeem }: Props) {
  const [now, setNow] = useState(Date.now());
  const [pressedId, setPressedId] = useState<number | null>(null);
  const pressTimer = useRef<number | null>(null);
  const pulseTimer = useRef<number | null>(null);
  const activeCell = useRef<number | null>(null);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);
  useEffect(() => () => {
    if (pressTimer.current !== null) window.clearTimeout(pressTimer.current);
    if (pulseTimer.current !== null) window.clearTimeout(pulseTimer.current);
  }, []);
  const mine = cells.filter(cell => cell.isMine).length;
  const shown = view === 'all' ? cells : cells.filter(cell => cell.isMine);
  const startPress = (cellId: number, phase: CellState['phase'], event: ReactPointerEvent<HTMLDivElement>) => {
    if (phase === 'open' || !event.isPrimary || event.button !== 0) return;
    if (pressTimer.current !== null) window.clearTimeout(pressTimer.current);
    if (pulseTimer.current !== null) window.clearTimeout(pulseTimer.current);
    setPressedId(null);
    activeCell.current = cellId;
    pressTimer.current = window.setTimeout(() => {
      pressTimer.current = null;
      setPressedId(cellId);
    }, 70);
  };
  const finishPress = (cellId: number) => {
    if (activeCell.current !== cellId) return;
    if (pressTimer.current !== null) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
      setPressedId(cellId);
      pulseTimer.current = window.setTimeout(() => {
        setPressedId(current => current === cellId ? null : current);
        pulseTimer.current = null;
      }, 90);
    } else {
      setPressedId(current => current === cellId ? null : current);
    }
    activeCell.current = null;
  };
  const cancelPress = (cellId: number) => {
    if (activeCell.current !== cellId) return;
    if (pressTimer.current !== null) window.clearTimeout(pressTimer.current);
    if (pulseTimer.current !== null) window.clearTimeout(pulseTimer.current);
    pressTimer.current = null;
    pulseTimer.current = null;
    activeCell.current = null;
    setPressedId(current => current === cellId ? null : current);
  };
  useEffect(() => {
    const firstId = shown[0]?.id;
    document.querySelectorAll<HTMLElement>('.cell').forEach(cell => {
      cell.tabIndex = cell.dataset.testid === `cell-${(firstId ?? -1) + 1}` ? 0 : -1;
    });
  }, [view, mine]);
  const keyHandler = (event: KeyboardEvent<HTMLDivElement>) => {
    const el = (event.target as HTMLElement).closest<HTMLElement>('.cell');
    if (!el) return;
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); el.click(); return; }
    const visible = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('.cell')).filter(c => c.offsetParent !== null);
    const i = visible.indexOf(el), firstTop = visible[0]?.offsetTop ?? 0;
    let cols = 0;
    while (cols < visible.length && visible[cols].offsetTop === firstTop) cols++;
    const target = event.key === 'ArrowRight' ? i + 1 : event.key === 'ArrowLeft' ? i - 1 :
      event.key === 'ArrowDown' ? i + cols : event.key === 'ArrowUp' ? i - cols :
      event.key === 'Home' ? 0 : event.key === 'End' ? visible.length - 1 : -1;
    if (target >= 0) { event.preventDefault(); visible[target]?.focus(); }
  };
  return <>
    <div className={`grid${view === 'mine' ? ' only-mine' : ''}`} role="grid" aria-label="Grade de células" onKeyDown={keyHandler} data-testid="grid-cells">
      {cells.map(cell => {
        const isMine = cell.isMine;
        const left = cell.reservedUntil ? Date.parse(cell.reservedUntil) - now : 0;
        const kind = cell.prizeKind;
        const redemptionStatus = isMine && cell.redemptionStatus
          ? redemptionStatusLabels[cell.redemptionStatus]
          : null;
        const redemptionPending = cell.redemptionStatus === 'requested' || cell.redemptionStatus === 'under_review';
        const cannotRedeem = cell.redeemed || redemptionPending || cell.redemptionStatus === 'redeemed';
        return <div key={cell.id} className={`cell${pressedId === cell.id ? ' down' : ''}${cell.phase === 'open' ? ' open' : ''}${cell.phase === 'reserved' ? ' reserved' : ''}${isMine ? ' mine' : ''}`}
          role={cell.phase === 'open' ? 'group' : 'button'} aria-label={cell.phase === 'open' ? `Célula ${cell.id + 1} revelada${redemptionStatus ? `. ${redemptionStatus}` : ''}` : cell.phase === 'reserved' ? `Célula ${cell.id + 1} reservada, abrir o Pix` : `Revelar célula ${cell.id + 1}`}
          tabIndex={cell.id === (shown[0]?.id ?? 0) ? 0 : -1}
          onFocus={event => event.currentTarget.parentElement?.querySelectorAll<HTMLElement>('.cell').forEach(item => { item.tabIndex = item === event.currentTarget ? 0 : -1; })}
          onPointerDown={event => startPress(cell.id, cell.phase, event)}
          onPointerUp={() => finishPress(cell.id)}
          onPointerCancel={() => cancelPress(cell.id)}
          onPointerLeave={event => { if (event.buttons) cancelPress(cell.id); }}
          onClick={() => onCell(cell)} data-testid={`cell-${cell.id + 1}`}>
          {cell.phase === 'closed' && <div className="box"><Gift className="icon"/></div>}
          {cell.phase === 'reserved' && <div className="hold"><Clock className="icon"/><span className="t">{formatTime(Math.max(0, left))}</span></div>}
          {cell.phase === 'open' && (revealId === cell.id && !reducedMotion ? <div className="box shake"><Gift className="icon"/></div> : <>
            <div className={`prize${redemptionStatus ? ' has-redemption-status' : ''}`}>
              {kind === 'image' ? <img src={art(cell.id)} alt="" draggable={false}/> :
                <div className="inner">{kind === 'icon' ? <svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d={iconPaths[cell.id % iconPaths.length]}/></svg> :
                  kind === 'stat' && cell.prizeValueCents !== null ? <><div className="stat-value">{brl.format(cell.prizeValueCents / 100)}</div><div className="stat-label">Pix</div><button type="button" className="btn" disabled={!isMine || cannotRedeem} onClick={e => { e.stopPropagation(); onRedeem(cell, e.currentTarget); }} data-testid={`button-redeem-${cell.id + 1}`}>{cannotRedeem ? redemptionStatusLabels[cell.redemptionStatus ?? 'redeemed'] : cell.redemptionStatus ? 'Solicitar novamente' : 'Resgatar'}</button></> : null}
                </div>}
              {redemptionStatus && <span className="redemption-status">{redemptionStatus}</span>}
            </div>
            {!reducedMotion && sparkId === cell.id && Array.from({ length: 8 }, (_, i) => <span key={i} className="spark" style={{ '--a': `${i * 45}deg` } as CSSProperties}/>)}
          </>)}
        </div>;
      })}
    </div>
  </>;
}
