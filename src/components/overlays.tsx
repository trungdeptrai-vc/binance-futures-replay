import { useEffect, useMemo, useRef, useState } from "react";
import { POPULAR_SYMBOLS, baseAsset, normalizeSymbol } from "@/lib/market";
import { useTerminal } from "@/lib/store";

export function Overlays() {
  const symbolOpen = useTerminal((s) => s.symbolOpen);
  const helpOpen = useTerminal((s) => s.helpOpen);
  const setSymbolOpen = useTerminal((s) => s.setSymbolOpen);
  const setHelpOpen = useTerminal((s) => s.setHelpOpen);
  return (
    <>
      {symbolOpen ? <SymbolDialog onClose={() => setSymbolOpen(false)} /> : null}
      {helpOpen ? <HelpDialog onClose={() => setHelpOpen(false)} /> : null}
    </>
  );
}

function SymbolDialog({ onClose }: { onClose: () => void }) {
  const symbols = useTerminal((s) => s.symbols);
  const current = useTerminal((s) => s.symbol);
  const setSymbol = useTerminal((s) => s.setSymbol);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const choices = useMemo(() => {
    const q = query.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    const pool = symbols.length > POPULAR_SYMBOLS.length ? symbols : [...new Set([...POPULAR_SYMBOLS, ...symbols])];
    const filtered = q ? pool.filter((symbol) => symbol.includes(q)) : pool;
    const ordered = q
      ? filtered
      : [
          ...POPULAR_SYMBOLS.filter((symbol) => filtered.includes(symbol)),
          ...filtered.filter((symbol) => !POPULAR_SYMBOLS.includes(symbol)),
        ];
    const custom = normalizeSymbol(q);
    if (custom && !ordered.includes(custom)) ordered.unshift(custom);
    return ordered.slice(0, 80);
  }, [query, symbols]);

  useEffect(() => {
    inputRef.current?.focus();
    setActive(0);
  }, [query]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label="Chọn symbol">
      <button type="button" aria-label="Đóng" className="absolute inset-0 bg-bg/80" onClick={onClose} />
      <div className="relative z-10 flex max-h-dvh w-full max-w-md flex-col rounded-t-md border border-border bg-surface sm:rounded-md">
        <div className="border-b border-border p-3">
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActive((value) => Math.min(choices.length - 1, value + 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActive((value) => Math.max(0, value - 1));
              } else if (event.key === "Enter" && choices[active]) {
                event.preventDefault();
                setSymbol(choices[active]);
              }
            }}
            placeholder="Tìm BTC, ETH, SOL…"
            aria-label="Tìm symbol futures"
            className="h-11 w-full rounded-sm border border-border bg-bg px-3 font-mono text-sm text-fg outline-none placeholder:text-muted"
          />
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto py-1">
          {choices.length === 0 ? (
            <li className="px-4 py-6 text-sm text-muted">Không có symbol khớp.</li>
          ) : (
            choices.map((symbol, index) => (
              <li key={symbol}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(index)}
                  onClick={() => setSymbol(symbol)}
                  className={`flex h-11 w-full items-center justify-between px-4 text-left ${index === active ? "bg-surface-2" : ""}`}
                >
                  <span className="font-sans font-semibold text-fg">{baseAsset(symbol)}</span>
                  <span className="font-mono text-xs text-muted">{symbol === current ? "đang mở" : "USDT-M"}</span>
                </button>
              </li>
            ))
          )}
        </ul>
        <p className="border-t border-border px-4 py-2 text-xs text-muted">
          {symbols.length > 80
            ? `${symbols.length.toLocaleString("vi-VN")} cặp USDT-M. Gõ tên để lọc.`
            : "Perpetual USDT-M"}
        </p>
      </div>
    </div>
  );
}

function HelpDialog({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label="Hướng dẫn">
      <button type="button" aria-label="Đóng" className="absolute inset-0 bg-bg/80" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md rounded-t-md border border-border bg-surface p-5 sm:rounded-md">
        <h2 className="font-sans text-lg font-semibold text-fg">Cách replay</h2>
        <ul className="mt-3 space-y-2 text-sm text-pretty text-muted">
          <li>Kéo thanh thời gian hoặc bấm chọn nến. Mọi nến phía sau bị giấu — giống Bar Replay.</li>
          <li>Phát để mở từng nến. Tốc độ 1× đến 10×. Ngẫu nhiên chọn một điểm không thiên lệch.</li>
          <li>EMA 34 và EMA 89 chỉ tính trên các nến đã mở, không dùng dữ liệu tương lai.</li>
          <li>Trendline nối đúng hai điểm, không phải tia. Hình chữ nhật lấy hai góc đối nhau. Nam châm bật thì con trỏ hút vào O/H/L/C; tắt thì soi giá tự do.</li>
          <li>Nguồn là Binance USDT-M. Nếu API trực tiếp bị chặn theo vùng, app dùng kho công khai data.binance.vision, thường đến hết hôm qua. Khung 1W được ghép từ nến ngày, mở cửa thứ Hai UTC.</li>
        </ul>
        <button
          type="button"
          onClick={onClose}
          className="mt-5 inline-flex h-11 items-center rounded-sm bg-accent px-4 font-semibold text-accent-fg"
        >
          Đã hiểu
        </button>
      </div>
    </div>
  );
}
