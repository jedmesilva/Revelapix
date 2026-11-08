import { useEffect, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { Check, Clock, Gift } from 'lucide-react';
import { art, brl, formatTime, iconPaths, prizeKind, prizeValue, type Cell, type PixOrder } from '../domain/revela';

type Props = { cells: Cell[]; user: string | null; order: PixOrder | null; view: 'all' | 'mine'; reducedMotion: boolean; sparkId: number | null; revealId: number | null; onCell: (cell: Cell) => void; onRedeem: (cell: Cell, button: HTMLButtonElement) => void };
export function CellGrid({ cells, user, order, view, reducedMotion, sparkId, revealId, onCell, onRedeem }: Props) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);
  const mine = cells.filter(cell => cell.phase === 'open' && cell.owner === user).length;
  const shown = view === 'all' ? cells : cells.filter(cell => cell.phase === 'open' && cell.owner === user);
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
        const isMine = cell.phase === 'open' && cell.owner === user;
        const left = order?.k === cell.id ? order.end - now : 0;
        const kind = prizeKind(cell.id);
        return <div key={cell.id} className={`cell${cell.phase === 'open' ? ' open' : ''}${cell.phase === 'reserved' ? ' reserved' : ''}${isMine ? ' mine' : ''}`}
          role={cell.phase === 'open' ? 'group' : 'button'} aria-label={cell.phase === 'open' ? `Célula ${cell.id + 1} revelada` : cell.phase === 'reserved' ? `Célula ${cell.id + 1} reservada, abrir o Pix` : `Revelar célula ${cell.id + 1}`}
          tabIndex={cell.id === (shown[0]?.id ?? 0) ? 0 : -1}
          onFocus={event => event.currentTarget.parentElement?.querySelectorAll<HTMLElement>('.cell').forEach(item => { item.tabIndex = item === event.currentTarget ? 0 : -1; })}
          onClick={() => onCell(cell)} data-testid={`cell-${cell.id + 1}`}>
          {cell.phase === 'closed' && <div className="box"><Gift className="icon"/></div>}
          {cell.phase === 'reserved' && <div className="hold"><Clock className="icon"/><span className="t">{formatTime(Math.max(0, left))}</span></div>}
          {cell.phase === 'open' && (revealId === cell.id && !reducedMotion ? <div className="box shake"><Gift className="icon"/></div> : <>
            <div className="prize">
              {kind === 'image' ? <img src={art(cell.id)} alt="" draggable={false}/> :
                <div className="inner">{kind === 'icon' ? <svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d={iconPaths[cell.id % iconPaths.length]}/></svg> :
                  <><div className="stat-value">{brl.format(prizeValue(cell.id))}</div><div className="stat-label">saldo</div><button type="button" className="btn" disabled={cell.redeemed} onClick={e => { e.stopPropagation(); onRedeem(cell, e.currentTarget); }} data-testid={`button-redeem-${cell.id + 1}`}>{cell.redeemed ? 'Resgatado' : 'Resgatar'}</button></>}
                </div>}
            </div>
            {!reducedMotion && sparkId === cell.id && Array.from({ length: 8 }, (_, i) => <span key={i} className="spark" style={{ '--a': `${i * 45}deg` } as CSSProperties}/>)}
          </>)}
        </div>;
      })}
    </div>
  </>;
}
