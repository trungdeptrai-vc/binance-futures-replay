import { HelpCircle } from "lucide-react";
import { INTERVALS, INTERVAL_LABEL, baseAsset, formatBarTime } from "@/lib/market";
import { useTerminal } from "@/lib/store";

export function TopBar() {
  const symbol = useTerminal((s) => s.symbol);
  const interval = useTerminal((s) => s.interval);
  const setInterval = useTerminal((s) => s.setInterval);
  const showEma34 = useTerminal((s) => s.showEma34);
  const showEma89 = useTerminal((s) => s.showEma89);
  const toggleEma = useTerminal((s) => s.toggleEma);
  const source = useTerminal((s) => s.source);
  const status = useTerminal((s) => s.status);
  const asOf = useTerminal((s) => (s.candles.length ? s.candles[s.candles.length - 1].time : null));
  const loadedInterval = useTerminal((s) => s.loadedInterval);
  const openSymbols = useTerminal((s) => s.setSymbolOpen);
  const openHelp = useTerminal((s) => s.setHelpOpen);

  const sourceLabel =
    status === "loading"
      ? "Đang tải"
      : source === "live"
        ? "Binance trực tiếp"
        : source === "vision"
          ? "Kho công khai"
          : "Binance Futures";

  return (
    <header className="shrink-0 border-b border-border bg-surface">
      <div className="h-0.5 bg-accent" />
      <div className="flex items-center gap-1.5 px-2 py-1">
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="size-2 shrink-0 bg-accent" aria-hidden />
          <span className="font-sans text-xs font-semibold tracking-widest text-fg">REPLAY</span>
        </div>
        <button
          type="button"
          onClick={() => openSymbols(true)}
          className="inline-flex h-8 shrink-0 items-center justify-center gap-1 rounded-sm border border-border bg-bg px-2 hover:bg-surface-2"
        >
          <span className="font-sans text-sm font-semibold text-fg">{baseAsset(symbol)}</span>
          <span className="font-mono text-[10px] text-muted">USDT</span>
        </button>
        <div className="scroll-x flex min-w-0 flex-1 items-center gap-1">
          {INTERVALS.map((item) => {
            const active = item === interval;
            return (
              <button
                key={item}
                type="button"
                aria-pressed={active}
                onClick={() => setInterval(item)}
                className={`inline-flex h-8 shrink-0 items-center rounded-sm px-2 font-mono text-xs ${
                  active ? "bg-accent font-semibold text-accent-fg" : "text-muted hover:bg-surface-2 hover:text-fg"
                }`}
              >
                {INTERVAL_LABEL[item]}
              </button>
            );
          })}
          <span className="mx-0.5 h-4 w-px shrink-0 bg-border" />
          <button
            type="button"
            aria-pressed={showEma34}
            onClick={() => toggleEma(34)}
            className={`inline-flex h-8 shrink-0 items-center rounded-sm border px-2 font-mono text-xs ${
              showEma34 ? "border-accent text-accent" : "border-border text-muted"
            }`}
          >
            EMA 34
          </button>
          <button
            type="button"
            aria-pressed={showEma89}
            onClick={() => toggleEma(89)}
            className={`inline-flex h-8 shrink-0 items-center rounded-sm border px-2 font-mono text-xs ${
              showEma89 ? "border-slow text-slow" : "border-border text-muted"
            }`}
          >
            EMA 89
          </button>
        </div>
        <span className="hidden max-w-48 shrink-0 truncate font-mono text-[10px] text-muted sm:inline">
          {sourceLabel}
          {asOf && loadedInterval ? ` · ${formatBarTime(asOf, loadedInterval)}` : ""}
        </span>
        <button
          type="button"
          aria-label="Hướng dẫn"
          onClick={() => openHelp(true)}
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-sm border border-border text-muted hover:bg-surface-2 hover:text-fg"
        >
          <HelpCircle className="size-4" />
        </button>
      </div>
    </header>
  );
}
