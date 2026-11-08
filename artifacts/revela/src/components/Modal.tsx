import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

type Props = { open: boolean; title: string; onClose: () => void; children: ReactNode; wide?: boolean; testId?: string };
export function Modal({ open, title, onClose, children, wide = false, testId = 'dialog' }: Props) {
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement as HTMLElement;
    const node = panel.current;
    node?.focus({ preventScroll: true });
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); }
      if (event.key === 'Tab' && node) {
        const items = node.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),[tabindex="0"]');
        if (!items.length) { event.preventDefault(); return; }
        const first = items[0], last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', keydown);
    return () => {
      document.removeEventListener('keydown', keydown);
      opener.current?.focus?.({ preventScroll: true });
    };
  }, [open]);
  if (!open) return null;
  return <div className="overlay" data-testid={`${testId}-scrim`} onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <section className={`sheet${wide ? ' wide' : ''}`} ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={`${testId}-title`} data-testid={testId}>
      <div className="sheet-head">
        <h2 id={`${testId}-title`}>{title}</h2>
        <button className="x" type="button" aria-label="Fechar" onClick={onClose} data-testid={`button-close-${testId}`}><X className="icon" /></button>
      </div>
      {children}
    </section>
  </div>;
}
