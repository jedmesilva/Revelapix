import { Gift, Plus } from 'lucide-react';
import type { UserSummary } from '@workspace/api-client-react';

type Props = { user: UserSummary | null; onEnter: () => void; onBuy: () => void; onAccount: () => void };
export function TopBar({ user, onEnter, onBuy, onAccount }: Props) {
  return <header className="top">
    <div className="top-in">
      <svg className="logo" viewBox="0 0 64 64" aria-hidden="true"><path d="M18 3H46A15 15 0 0 1 56.607 7.393L7.393 56.607A15 15 0 0 1 3 46V18A15 15 0 0 1 18 3Z"/><rect x="3" y="3" width="58" height="58" rx="15"/></svg>
      <span className="brand">Revela</span>
      {user ? <>
        <div className="chances" aria-label={`${user.chances} ${user.chances === 1 ? 'chance' : 'chances'}`} data-testid="display-chances">
          <Gift className="icon" aria-hidden="true"/><b data-testid="value-chances">{user.chances}</b><span className="chip-lbl">{user.chances === 1 ? 'chance' : 'chances'}</span>
          <button className="add" type="button" aria-label="Adicionar chances" onClick={onBuy} data-testid="button-buy-chances"><Plus className="icon"/><span className="add-lbl">Adicionar</span></button>
        </div>
        <button className="avatar" type="button" aria-label="Minha conta" onClick={onAccount} data-testid="button-account">{user.name.trim().charAt(0).toUpperCase()}</button>
      </> : <button className="btn enter" type="button" onClick={onEnter} data-testid="button-enter">Entrar</button>}
    </div>
  </header>;
}
