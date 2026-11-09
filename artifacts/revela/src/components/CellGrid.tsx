import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Check, Clock, Gift } from "lucide-react";
import type { CellState } from "@workspace/api-client-react";
import { brl, formatTime, redemptionStatusLabels } from "../domain/revela";
import { getRevelaCells } from "../lib/api";

type Props = {
  totalCount: number;
  refreshVersion: number;
  view: "all" | "mine";
  reducedMotion: boolean;
  sparkId: number | null;
  revealingCellId: number | null;
  onCell: (cell: CellState) => void;
  onRedeem: (cell: CellState, button: HTMLButtonElement) => void;
  onCancelRedemption: (cellId: number) => void;
};

type GridMetrics = {
  columns: number;
  rowHeight: number;
  windowSize: number;
  shiftCells: number;
};

const MAX_WINDOW_CELLS = 500;

function measureGrid(grid: HTMLDivElement): GridMetrics {
  const root = grid.closest<HTMLElement>(".scroll");
  const styles = window.getComputedStyle(grid);
  const tracks = styles.gridTemplateColumns
    .split(/\s+/)
    .filter(track => track && track !== "none");
  const columns = Math.max(1, tracks.length);
  const firstTrackSize = Number.parseFloat(tracks[0] ?? "") || 140;
  const firstCell = grid.querySelector<HTMLElement>(".cell");
  const cellSize = firstCell?.getBoundingClientRect().height || firstTrackSize;
  const rowGap = Number.parseFloat(styles.rowGap) || 12;
  const rowHeight = cellSize + rowGap;
  const viewportHeight = root?.clientHeight || 760;
  const visibleCells = Math.max(
    columns,
    Math.ceil(viewportHeight / Math.max(1, rowHeight)) * columns,
  );
  const alignToRow = (count: number) => Math.ceil(count / columns) * columns;
  const maxWindow = Math.max(columns, Math.floor(MAX_WINDOW_CELLS / columns) * columns);
  const windowSize = Math.min(maxWindow, Math.max(columns, alignToRow(visibleCells * 5)));
  const shiftCells = Math.min(
    Math.max(columns, windowSize - columns),
    Math.max(columns, alignToRow(Math.ceil(visibleCells * 1.5))),
  );

  return { columns, rowHeight, windowSize, shiftCells };
}

export function CellGrid({
  totalCount,
  refreshVersion,
  view,
  reducedMotion,
  sparkId,
  revealingCellId,
  onCell,
  onRedeem,
  onCancelRedemption,
}: Props) {
  const [cells, setCells] = useState<CellState[]>([]);
  const [windowStart, setWindowStart] = useState(0);
  const [windowLimit, setWindowLimit] = useState(120);
  const [windowLoading, setWindowLoading] = useState(true);
  const [windowError, setWindowError] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [pressedId, setPressedId] = useState<number | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const cellsRef = useRef<CellState[]>([]);
  const windowStartRef = useRef(0);
  const windowLimitRef = useRef(120);
  const loadingRef = useRef(false);
  const requestIdRef = useRef(0);
  const previousViewRef = useRef(view);
  const pendingScrollAdjustmentRef = useRef<number | null>(null);
  const pressTimer = useRef<number | null>(null);
  const pulseTimer = useRef<number | null>(null);
  const activeCell = useRef<number | null>(null);

  const loadWindow = useCallback(async (start: number, limit: number, scrollAdjustment = 0) => {
    const requestId = ++requestIdRef.current;
    if (totalCount <= 0) {
      cellsRef.current = [];
      setCells([]);
      setWindowStart(0);
      windowStartRef.current = 0;
      setWindowError(false);
      setWindowLoading(false);
      loadingRef.current = false;
      return;
    }

    const safeStart = Math.min(start, totalCount - 1);
    const safeLimit = Math.min(MAX_WINDOW_CELLS, Math.max(1, limit), totalCount - safeStart);
    loadingRef.current = true;
    setWindowLoading(true);
    setWindowError(false);
    try {
      const result = await getRevelaCells({ view, start: safeStart, limit: safeLimit });
      if (requestId !== requestIdRef.current) return;
      cellsRef.current = result.cells;
      windowStartRef.current = result.start;
      windowLimitRef.current = safeLimit;
      pendingScrollAdjustmentRef.current = scrollAdjustment;
      setCells(result.cells);
      setWindowStart(result.start);
      setWindowLoading(false);
      loadingRef.current = false;
    } catch {
      if (requestId !== requestIdRef.current) return;
      setWindowError(true);
      setWindowLoading(false);
      loadingRef.current = false;
    }
  }, [totalCount, view]);

  useLayoutEffect(() => {
    if (!gridRef.current) return;
    const metrics = measureGrid(gridRef.current);
    setWindowLimit(metrics.windowSize);
    windowLimitRef.current = metrics.windowSize;
  }, []);

  useEffect(() => {
    const grid = gridRef.current;
    const root = grid?.closest<HTMLElement>(".scroll");
    if (!grid || !root) return;
    const updateSize = () => {
      const metrics = measureGrid(grid);
      setWindowLimit(current => current === metrics.windowSize ? current : metrics.windowSize);
    };
    const observer = new ResizeObserver(updateSize);
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const changedView = previousViewRef.current !== view;
    previousViewRef.current = view;
    const start = changedView ? 0 : windowStartRef.current;
    if (changedView) {
      windowStartRef.current = 0;
      cellsRef.current = [];
      setCells([]);
      setWindowStart(0);
    }
    const columns = Math.max(1, gridRef.current ? measureGrid(gridRef.current).columns : 1);
    const alignedStart = Math.floor(start / columns) * columns;
    const effectiveLimit = totalCount <= windowLimit + columns
      ? Math.min(MAX_WINDOW_CELLS, Math.ceil(totalCount / columns) * columns)
      : windowLimit;
    void loadWindow(alignedStart, effectiveLimit);
  }, [view, totalCount, refreshVersion, windowLimit, loadWindow]);

  useEffect(() => {
    const grid = gridRef.current;
    const root = grid?.closest<HTMLElement>(".scroll");
    if (!grid || !root) return;

    const handleScroll = () => {
      const currentCells = cellsRef.current;
      if (loadingRef.current || currentCells.length === 0) return;
      const metrics = measureGrid(grid);
      const gridTop = grid.getBoundingClientRect().top
        - root.getBoundingClientRect().top
        + root.scrollTop;
      const localScrollTop = root.scrollTop - gridTop;
      const maxScrollTop = Math.max(0, grid.scrollHeight - root.clientHeight);
      if (maxScrollTop <= 0) return;

      const start = windowStartRef.current;
      const limit = windowLimitRef.current;
      if (
        localScrollTop > maxScrollTop * 0.68
        && start + currentCells.length < totalCount
      ) {
        const maxStart = Math.min(
          Math.ceil(Math.max(0, totalCount - limit) / metrics.columns) * metrics.columns,
          totalCount - 1,
        );
        const nextStart = Math.min(maxStart, start + metrics.shiftCells);
        if (nextStart > start) {
          const movedRows = (nextStart - start) / metrics.columns;
          void loadWindow(nextStart, limit, -movedRows * metrics.rowHeight);
        }
      } else if (localScrollTop < maxScrollTop * 0.32 && start > 0) {
        const nextStart = Math.max(0, start - metrics.shiftCells);
        const alignedStart = Math.floor(nextStart / metrics.columns) * metrics.columns;
        if (alignedStart < start) {
          const movedRows = (start - alignedStart) / metrics.columns;
          void loadWindow(alignedStart, limit, movedRows * metrics.rowHeight);
        }
      }
    };

    root.addEventListener("scroll", handleScroll, { passive: true });
    return () => root.removeEventListener("scroll", handleScroll);
  }, [cells, totalCount, windowStart, loadWindow]);

  useLayoutEffect(() => {
    const adjustment = pendingScrollAdjustmentRef.current;
    if (adjustment === null) return;
    pendingScrollAdjustmentRef.current = null;
    const root = gridRef.current?.closest<HTMLElement>(".scroll");
    if (root && adjustment !== 0) root.scrollTop += adjustment;
  }, [cells]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => () => {
    if (pressTimer.current !== null) window.clearTimeout(pressTimer.current);
    if (pulseTimer.current !== null) window.clearTimeout(pulseTimer.current);
  }, []);

  useEffect(() => {
    document.querySelectorAll<HTMLElement>(".cell").forEach(cell => {
      cell.tabIndex = cell.dataset.testid === `cell-${(cells[0]?.id ?? -1) + 1}` ? 0 : -1;
    });
  }, [view, windowStart, cells]);

  const startPress = (
    cellId: number,
    phase: CellState["phase"],
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    if (phase === "open" || revealingCellId !== null || !event.isPrimary || event.button !== 0) return;
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

  const keyHandler = (event: KeyboardEvent<HTMLDivElement>) => {
    const el = (event.target as HTMLElement).closest<HTMLElement>(".cell");
    if (!el) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      el.click();
      return;
    }
    const visible = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(".cell"))
      .filter(cell => cell.offsetParent !== null);
    const index = visible.indexOf(el);
    const firstTop = visible[0]?.offsetTop ?? 0;
    let columns = 0;
    while (columns < visible.length && visible[columns]?.offsetTop === firstTop) columns++;
    const target = event.key === "ArrowRight" ? index + 1
      : event.key === "ArrowLeft" ? index - 1
        : event.key === "ArrowDown" ? index + columns
          : event.key === "ArrowUp" ? index - columns
            : event.key === "Home" ? 0
              : event.key === "End" ? visible.length - 1
                : -1;
    if (target >= 0) {
      event.preventDefault();
      visible[target]?.focus();
    }
  };

  return <>
    {windowLoading && cells.length === 0 && <div className="empty" role="status">
      <p className="sub">Carregando células…</p>
    </div>}
    {windowError && <div className="empty" role="alert">
      <p className="sub">Não foi possível carregar as células.</p>
      <button
        className="btn"
        type="button"
        onClick={() => void loadWindow(windowStartRef.current, windowLimitRef.current)}
        data-testid="button-retry-cells"
      >
        Tentar novamente
      </button>
    </div>}
    <div
      ref={gridRef}
      className={`grid${view === "mine" ? " only-mine" : ""}`}
      role="grid"
      aria-label="Grade de células"
      onKeyDown={keyHandler}
      data-testid="grid-cells"
      data-window-start={windowStart}
    >
      {cells.map(cell => {
        const isMine = cell.isMine;
        const isRevealing = cell.phase === "closed" && revealingCellId === cell.id;
        const revealPending = revealingCellId !== null;
        const left = cell.reservedUntil ? Date.parse(cell.reservedUntil) - now : 0;
        const item = cell.item;
        const redemptionStatus = isMine && cell.redemptionStatus
          ? redemptionStatusLabels[cell.redemptionStatus]
          : null;
        const redemptionPending = cell.redemptionStatus === "requested"
          || cell.redemptionStatus === "under_review"
          || cell.redemptionStatus === "approved"
          || cell.redemptionStatus === "processing";
        const canCancel = isMine && (cell.redemptionStatus === "requested" || cell.redemptionStatus === "under_review");
        const cannotRedeem = cell.redeemed || redemptionPending || cell.redemptionStatus === "redeemed";
        const statusShownOnPixButton = item?.type === "pix" && item.valueCents !== null && cannotRedeem;
        const accessibleRedemptionStatus = statusShownOnPixButton ? null : redemptionStatus;
        return <div
          key={cell.id}
          className={`cell${pressedId === cell.id ? " down" : ""}${cell.phase === "open" ? " open" : ""}${cell.phase === "reserved" ? " reserved" : ""}${isRevealing ? " revealing" : ""}${isMine ? " mine" : ""}`}
          role={cell.phase === "open" ? "group" : "button"}
          aria-label={isRevealing
            ? `Revelando célula ${cell.id + 1}`
            : cell.phase === "open"
              ? `Célula ${cell.id + 1} revelada${accessibleRedemptionStatus ? `. ${accessibleRedemptionStatus}` : ""}`
              : cell.phase === "reserved"
                ? `Célula ${cell.id + 1} reservada, abrir o Pix`
                : `Revelar célula ${cell.id + 1}`}
          aria-disabled={cell.phase !== "open" && revealPending}
          aria-busy={isRevealing}
          tabIndex={cell.id === (cells[0]?.id ?? 0) ? 0 : -1}
          onFocus={event => event.currentTarget.parentElement?.querySelectorAll<HTMLElement>(".cell").forEach(item => {
            item.tabIndex = item === event.currentTarget ? 0 : -1;
          })}
          onPointerDown={event => startPress(cell.id, cell.phase, event)}
          onPointerUp={() => finishPress(cell.id)}
          onPointerCancel={() => cancelPress(cell.id)}
          onPointerLeave={event => { if (event.buttons) cancelPress(cell.id); }}
          onClick={() => onCell(cell)}
          data-testid={`cell-${cell.id + 1}`}
        >
          {cell.phase === "closed" && <div className="box">{isRevealing ? <>
            <span className="reveal-spinner" aria-hidden="true"><Gift className="icon"/></span>
            <span className="reveal-message">Revelando…</span>
          </> : <Gift className="icon"/>}</div>}
          {cell.phase === "reserved" && <div className="hold">
            <Clock className="icon"/>
            <span className="t">{formatTime(Math.max(0, left))}</span>
          </div>}
          {cell.phase === "open" && <>
            <div className="prize">
              {item?.type === "image" ? <img
                className={item.imageUrl ? undefined : "brand-placeholder"}
                src={item.imageUrl ?? "/favicon.svg"}
                alt={item.name}
                draggable={false}
              /> : <div className="inner">
                {item?.type === "pix" && item.valueCents !== null ? <>
                  <div className="stat-value">{brl.format(item.valueCents / 100)}</div>
                  <div className="stat-label">Pix</div>
                  <button
                    type="button"
                    className="btn"
                    disabled={!isMine || cannotRedeem}
                    onClick={event => { event.stopPropagation(); onRedeem(cell, event.currentTarget); }}
                    data-testid={`button-redeem-${cell.id + 1}`}
                  >
                    {cannotRedeem ? redemptionStatusLabels[cell.redemptionStatus ?? "redeemed"] : cell.redemptionStatus ? "Solicitar novamente" : "Resgatar"}
                  </button>
                  {canCancel && <button
                    type="button"
                    className="link cancel-redemption"
                    onClick={event => { event.stopPropagation(); onCancelRedemption(cell.id); }}
                    data-testid={`button-cancel-redemption-${cell.id + 1}`}
                  >
                    Cancelar
                  </button>}
                </> : null}
              </div>}
            </div>
            {!reducedMotion && sparkId === cell.id && Array.from({ length: 8 }, (_, index) =>
              <span key={index} className="spark" style={{ "--a": `${index * 45}deg` } as CSSProperties}/>,
            )}
          </>}
        </div>;
      })}
    </div>
  </>;
}
