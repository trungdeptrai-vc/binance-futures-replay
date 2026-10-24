import { memo, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Minus, Plus } from "lucide-react";
import {
  autoscale,
  barStep,
  linePixels,
  logicalOf,
  logicalToTime,
  magnetPrice,
  makePlot,
  maxVolume,
  niceTicks,
  panView,
  pinView,
  priceOf,
  segmentDistance,
  tickDigits,
  timeToLogical,
  xOf,
  yOf,
  zoomView,
  type View,
} from "@/lib/chart-math";
import {
  emaSeries,
  formatAxisTime,
  formatBarTime,
  formatPct,
  formatPrice,
  formatVolume,
  INTERVAL_LABEL,
  type Candle,
  type Interval,
  type Point,
  type Trendline,
} from "@/lib/market";
import { useActiveLines, useTerminal, type Tool } from "@/lib/store";

type Drag =
  | { kind: "pan"; startX: number; startY: number; orig: View }
  | { kind: "click"; startX: number; startY: number }
  | {
      kind: "line";
      startX: number;
      startY: number;
      part: "a" | "b" | "body";
      origin: Trendline;
      startLogical: number;
      startPrice: number;
    };

const CandleLayer = memo(function CandleLayer({
  bars,
  view,
  plotW,
  priceH,
  volH,
  lo,
  hi,
  volMax,
  emaFast,
  emaSlow,
  showFast,
  showSlow,
  head,
}: {
  bars: Candle[];
  view: View;
  plotW: number;
  priceH: number;
  volH: number;
  lo: number;
  hi: number;
  volMax: number;
  emaFast: (number | null)[];
  emaSlow: (number | null)[];
  showFast: boolean;
  showSlow: boolean;
  head: number;
}) {
  const i0 = Math.max(0, Math.floor(view.from));
  const i1 = Math.min(bars.length - 1, Math.ceil(view.to));
  const slot = plotW / Math.max(1, view.to - view.from);
  const bodyW = Math.max(1.4, Math.min(14, slot * 0.66));
  const wick = Math.max(1, Math.min(1.5, slot * 0.12));
  const nodes = [];
  for (let i = i0; i <= i1; i++) {
    const bar = bars[i];
    if (!bar) continue;
    const x = xOf(i, view, plotW);
    const up = bar.close >= bar.open;
    const color = up ? "var(--color-up)" : "var(--color-down)";
    const yHigh = yOf(bar.high, lo, hi, priceH);
    const yLow = yOf(bar.low, lo, hi, priceH);
    const top = Math.min(yOf(bar.open, lo, hi, priceH), yOf(bar.close, lo, hi, priceH));
    const bodyH = Math.max(1, Math.abs(yOf(bar.close, lo, hi, priceH) - yOf(bar.open, lo, hi, priceH)));
    const volHpx = (bar.volume / volMax) * (volH - 2);
    nodes.push(
      <g key={bar.time}>
        <line x1={x} x2={x} y1={yHigh} y2={yLow} stroke={color} strokeWidth={wick} />
        <rect x={x - bodyW / 2} y={top} width={bodyW} height={bodyH} fill={color} />
        <rect
          x={x - bodyW / 2}
          y={priceH + volH - volHpx}
          width={bodyW}
          height={volHpx}
          fill={color}
          opacity={0.45}
        />
      </g>,
    );
  }
  const fast = showFast ? linePath(emaFast, i0, i1, view, plotW, lo, hi, priceH) : "";
  const slow = showSlow ? linePath(emaSlow, i0, i1, view, plotW, lo, hi, priceH) : "";
  const headX = xOf(head, view, plotW);
  return (
    <g>
      {nodes}
      {fast ? <path d={fast} fill="none" stroke="var(--color-accent)" strokeWidth={1.6} /> : null}
      {slow ? <path d={slow} fill="none" stroke="var(--color-slow)" strokeWidth={1.6} /> : null}
      <line
        x1={headX}
        x2={headX}
        y1={0}
        y2={priceH + volH}
        stroke="var(--color-accent)"
        strokeOpacity={0.4}
        strokeDasharray="3 4"
      />
    </g>
  );
});

function linePath(
  values: (number | null)[],
  i0: number,
  i1: number,
  view: View,
  plotW: number,
  lo: number,
  hi: number,
  priceH: number,
): string {
  let path = "";
  let open = false;
  for (let i = i0; i <= i1; i++) {
    const value = values[i];
    if (value == null) {
      open = false;
      continue;
    }
    const x = xOf(i, view, plotW).toFixed(1);
    const y = yOf(value, lo, hi, priceH).toFixed(1);
    path += `${open ? "L" : "M"}${x},${y}`;
    open = true;
  }
  return path;
}

export function ChartStage() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [draft, setDraft] = useState<Point | null>(null);
  const [preview, setPreview] = useState<Point | null>(null);
  const [ghost, setGhost] = useState<Trendline | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const uid = useId().replace(/:/g, "");

  const symbol = useTerminal((s) => s.symbol);
  const interval = useTerminal((s) => s.interval);
  const candles = useTerminal((s) => s.candles);
  const cursor = useTerminal((s) => s.cursor);
  const status = useTerminal((s) => s.status);
  const error = useTerminal((s) => s.error);
  const tool = useTerminal((s) => s.tool);
  const magnet = useTerminal((s) => s.magnet);
  const precision = useTerminal((s) => s.precision);
  const showEma34 = useTerminal((s) => s.showEma34);
  const showEma89 = useTerminal((s) => s.showEma89);
  const loadedSymbol = useTerminal((s) => s.loadedSymbol);
  const loadedInterval = useTerminal((s) => s.loadedInterval);
  const selectedId = useTerminal((s) => s.selectedId);
  const playing = useTerminal((s) => s.playing);
  const follow = useTerminal((s) => s.follow);
  const lines = useActiveLines();
  const setCursor = useTerminal((s) => s.setCursor);
  const setTool = useTerminal((s) => s.setTool);
  const pause = useTerminal((s) => s.pause);
  const addLine = useTerminal((s) => s.addLine);
  const updateLine = useTerminal((s) => s.updateLine);
  const selectLine = useTerminal((s) => s.selectLine);
  const reload = useTerminal((s) => s.reload);
  const setFollow = useTerminal((s) => s.setFollow);

  const synced = loadedSymbol === symbol && loadedInterval === interval && candles.length > 1;
  const bars = useMemo(
    () => (tool === "pick" ? candles : candles.slice(0, Math.max(0, cursor) + 1)),
    [candles, cursor, tool],
  );
  const seriesKey = `${symbol}|${interval}|${candles[0]?.time ?? 0}|${candles.length}|${loadedSymbol ?? ""}`;

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      setSize({ w: Math.max(0, Math.floor(rect.width)), h: Math.max(0, Math.floor(rect.height)) });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (!synced) return;
    const n = tool === "pick" ? candles.length : cursor + 1;
    setView(pinView(null, Math.min(cursor, n - 1), n));
    setDraft(null);
    setPreview(null);
    setGhost(null);
    // Recenters only when a new series arrives, not on every replay step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seriesKey]);

  useLayoutEffect(() => {
    if (!synced || tool === "pick" || !follow) return;
    setView((prev) => pinView(prev, cursor, cursor + 1));
  }, [cursor, follow, synced, tool]);

  useEffect(() => {
    if (tool !== "trend") {
      setDraft(null);
      setPreview(null);
    }
  }, [tool]);

  const plot = makePlot(size.w, size.h);
  const step = barStep(bars, interval);
  const emaFast = useMemo(() => (showEma34 ? emaSeries(bars, 34) : []), [bars, showEma34]);
  const emaSlow = useMemo(() => (showEma89 ? emaSeries(bars, 89) : []), [bars, showEma89]);
  const scale = useMemo(() => {
    if (!view || bars.length === 0) return null;
    return autoscale(bars, view, emaFast, emaSlow, showEma34, showEma89);
  }, [bars, view, emaFast, emaSlow, showEma34, showEma89]);

  const placePoint = (x: number, y: number): Point | null => {
    if (!view || !scale || y < 0 || y > plot.priceH || x < 0 || x > plot.plotW) return null;
    const logical = logicalOf(x, view, plot.plotW);
    if (magnet) {
      const snapped = magnetPrice(logical, y, bars, scale.lo, scale.hi, plot.priceH);
      if (!snapped) return null;
      return { time: bars[snapped.index].time, price: snapped.price };
    }
    return {
      time: logicalToTime(logical, bars, step),
      price: priceOf(y, scale.lo, scale.hi, plot.priceH),
    };
  };

  const hitLine = (x: number, y: number): { id: string; part: "a" | "b" | "body" } | null => {
    if (!view || !scale) return null;
    let handle: { id: string; part: "a" | "b"; dist: number } | null = null;
    let body: { id: string; dist: number } | null = null;
    for (const line of lines) {
      const drawn = ghost?.id === line.id ? ghost : line;
      const px = linePixels(drawn, bars, step, view, plot.plotW, scale.lo, scale.hi, plot.priceH);
      if (!px) continue;
      const ax = xOf(timeToLogical(drawn.a.time, bars, step), view, plot.plotW);
      const ay = yOf(drawn.a.price, scale.lo, scale.hi, plot.priceH);
      const bx = xOf(timeToLogical(drawn.b.time, bars, step), view, plot.plotW);
      const by = yOf(drawn.b.price, scale.lo, scale.hi, plot.priceH);
      const handleA = Math.hypot(x - ax, y - ay);
      const handleB = Math.hypot(x - bx, y - by);
      if (handleA <= 14 && (!handle || handleA < handle.dist)) handle = { id: line.id, part: "a", dist: handleA };
      if (handleB <= 14 && (!handle || handleB < handle.dist)) handle = { id: line.id, part: "b", dist: handleB };
      const along = segmentDistance(x, y, px.x1, px.y1, px.x2, px.y2);
      if (along <= 8 && (!body || along < body.dist)) body = { id: line.id, dist: along };
    }
    if (handle) return { id: handle.id, part: handle.part };
    return body ? { id: body.id, part: "body" } : null;
  };

  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button !== 0 || !view || !scale) return;
    const point = eventPoint(event);
    if (!point) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    if (tool === "trend" || tool === "pick") {
      dragRef.current = { kind: "click", startX: point.x, startY: point.y };
      return;
    }
    const hit = hitLine(point.x, point.y);
    if (hit) {
      const origin = lines.find((line) => line.id === hit.id);
      if (!origin) return;
      selectLine(hit.id);
      const logical = logicalOf(point.x, view, plot.plotW);
      dragRef.current = {
        kind: "line",
        startX: point.x,
        startY: point.y,
        part: hit.part,
        origin,
        startLogical: logical,
        startPrice: priceOf(point.y, scale.lo, scale.hi, plot.priceH),
      };
      return;
    }
    selectLine(null);
    setFollow(false);
    if (playing) pause();
    dragRef.current = { kind: "pan", startX: point.x, startY: point.y, orig: view };
  };

  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!view || !scale) return;
    const point = eventPoint(event);
    if (!point) return;
    if (point.x >= 0 && point.x <= plot.plotW && point.y >= 0 && point.y <= plot.plotH) {
      const logical = logicalOf(point.x, view, plot.plotW);
      const index = Math.max(0, Math.min(bars.length - 1, Math.round(logical)));
      setHover(index);
    } else {
      setHover(null);
    }
    const drag = dragRef.current;
    if (!drag) {
      if (tool === "trend" && draft) setPreview(placePoint(point.x, point.y));
      return;
    }
    if (drag.kind === "pan") {
      setView(panView(drag.orig, point.x - drag.startX, plot.plotW, bars.length));
      return;
    }
    if (drag.kind === "line") {
      const logical = logicalOf(point.x, view, plot.plotW);
      const rawPrice = priceOf(point.y, scale.lo, scale.hi, plot.priceH);
      if (drag.part === "body") {
        const dLog = logical - drag.startLogical;
        const dPrice = rawPrice - drag.startPrice;
        setGhost({
          ...drag.origin,
          a: {
            time: logicalToTime(timeToLogical(drag.origin.a.time, bars, step) + dLog, bars, step),
            price: drag.origin.a.price + dPrice,
          },
          b: {
            time: logicalToTime(timeToLogical(drag.origin.b.time, bars, step) + dLog, bars, step),
            price: drag.origin.b.price + dPrice,
          },
        });
        return;
      }
      const snapped = magnet ? magnetPrice(logical, point.y, bars, scale.lo, scale.hi, plot.priceH) : null;
      const next = snapped
        ? { time: bars[snapped.index].time, price: snapped.price }
        : { time: logicalToTime(logical, bars, step), price: rawPrice };
      setGhost({ ...drag.origin, [drag.part]: next });
      return;
    }
    if (tool === "trend" && draft) setPreview(placePoint(point.x, point.y));
  };

  const onPointerUp = (event: ReactPointerEvent<SVGSVGElement>) => {
    const point = eventPoint(event);
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag || !point || !view || !scale) return;
    const moved = Math.hypot(point.x - drag.startX, point.y - drag.startY) > 5;
    if (drag.kind === "line") {
      if (ghost) updateLine(ghost.id, { a: ghost.a, b: ghost.b, extend: ghost.extend });
      setGhost(null);
      return;
    }
    if (drag.kind === "pan" || moved) return;
    const logical = logicalOf(point.x, view, plot.plotW);
    if (tool === "pick") {
      const index = Math.max(0, Math.min(candles.length - 1, Math.round(logical)));
      setCursor(index);
      setTool("cursor");
      setFollow(true);
      return;
    }
    if (tool === "trend") {
      const placed = placePoint(point.x, point.y);
      if (!placed) return;
      if (!draft) {
        setDraft(placed);
        setPreview(placed);
        return;
      }
      if (Math.abs(placed.time - draft.time) < step / 2 && Math.abs(placed.price - draft.price) <= Math.abs(draft.price) * 1e-6) {
        return;
      }
      addLine(draft, placed);
      setDraft(null);
      setPreview(null);
    }
  };

  const onPointerLeave = () => setHover(null);

  const zoomAt = (factor: number) => {
    if (!view) return;
    setFollow(false);
    if (playing) pause();
    setView(zoomView(view, plot.plotW / 2, plot.plotW, factor, bars.length));
  };

  const focusIndex = hover ?? (tool === "pick" ? cursor : bars.length - 1);
  const focus = bars[focusIndex] ?? null;
  const prev = focusIndex > 0 ? bars[focusIndex - 1] : null;
  const change = focus && prev ? ((focus.close - prev.close) / prev.close) * 100 : 0;

  return (
    <div ref={wrapRef} className="relative h-full min-h-0 w-full">
      {synced && view && scale && size.w > 0 && size.h > 0 ? (
        <>
          <svg
            width={size.w}
            height={size.h}
            className="touch-none select-none"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerLeave}
            onDoubleClick={() => {
              setFollow(true);
              const n = tool === "pick" ? candles.length : cursor + 1;
              setView(pinView(null, Math.min(cursor, n - 1), n));
            }}
            onContextMenu={(event) => event.preventDefault()}
            onWheel={(event) => {
              if (!view) return;
              event.preventDefault();
              setFollow(false);
              if (playing) pause();
              const rect = event.currentTarget.getBoundingClientRect();
              const x = event.clientX - rect.left;
              const factor = event.deltaY > 0 ? 1.12 : 0.88;
              setView(zoomView(view, x, plot.plotW, factor, bars.length));
            }}
            role="img"
            aria-label={`Biểu đồ ${symbol} ${interval}`}
          >
            <defs>
              <clipPath id={`${uid}-price`}>
                <rect width={plot.plotW} height={plot.priceH} />
              </clipPath>
              <clipPath id={`${uid}-plot`}>
                <rect width={plot.plotW} height={plot.plotH} />
              </clipPath>
            </defs>
            <Axis
              plot={plot}
              view={view}
              bars={bars}
              interval={interval}
              lo={scale.lo}
              hi={scale.hi}
              precision={precision}
              last={bars[bars.length - 1]}
            />
            <g clipPath={`url(#${uid}-plot)`}>
              <CandleLayer
                bars={bars}
                view={view}
                plotW={plot.plotW}
                priceH={plot.priceH}
                volH={plot.volH}
                lo={scale.lo}
                hi={scale.hi}
                volMax={maxVolume(bars, view)}
                emaFast={emaFast}
                emaSlow={emaSlow}
                showFast={showEma34}
                showSlow={showEma89}
                head={tool === "pick" ? Math.min(cursor, bars.length - 1) : bars.length - 1}
              />
            </g>
            <g clipPath={`url(#${uid}-price)`}>
              {lines.map((line) => {
                const drawn = ghost?.id === line.id ? ghost : line;
                const px = linePixels(drawn, bars, step, view, plot.plotW, scale.lo, scale.hi, plot.priceH);
                if (!px) return null;
                const selected = line.id === selectedId;
                return (
                  <g key={line.id}>
                    <line
                      x1={px.x1}
                      y1={px.y1}
                      x2={px.x2}
                      y2={px.y2}
                      stroke="var(--color-accent)"
                      strokeWidth={selected ? 2.25 : 1.5}
                      strokeOpacity={selected ? 1 : 0.8}
                    />
                    {selected ? (
                      <>
                        <circle cx={xOf(timeToLogical(drawn.a.time, bars, step), view, plot.plotW)} cy={yOf(drawn.a.price, scale.lo, scale.hi, plot.priceH)} r={4.5} fill="var(--color-accent)" stroke="var(--color-bg)" strokeWidth={1.5} />
                        <circle cx={xOf(timeToLogical(drawn.b.time, bars, step), view, plot.plotW)} cy={yOf(drawn.b.price, scale.lo, scale.hi, plot.priceH)} r={4.5} fill="var(--color-accent)" stroke="var(--color-bg)" strokeWidth={1.5} />
                      </>
                    ) : null}
                  </g>
                );
              })}
              {draft && preview ? (
                <line
                  x1={xOf(timeToLogical(draft.time, bars, step), view, plot.plotW)}
                  y1={yOf(draft.price, scale.lo, scale.hi, plot.priceH)}
                  x2={xOf(timeToLogical(preview.time, bars, step), view, plot.plotW)}
                  y2={yOf(preview.price, scale.lo, scale.hi, plot.priceH)}
                  stroke="var(--color-accent)"
                  strokeDasharray="4 4"
                  strokeWidth={1.5}
                />
              ) : null}
            </g>
            {hover != null && bars[hover] ? (
              <g pointerEvents="none">
                <line
                  x1={xOf(hover, view, plot.plotW)}
                  x2={xOf(hover, view, plot.plotW)}
                  y1={0}
                  y2={plot.plotH}
                  stroke="var(--color-muted)"
                  strokeDasharray="2 3"
                  strokeOpacity={0.7}
                />
                <line
                  x1={0}
                  x2={plot.plotW}
                  y1={yOf(bars[hover].close, scale.lo, scale.hi, plot.priceH)}
                  y2={yOf(bars[hover].close, scale.lo, scale.hi, plot.priceH)}
                  stroke="var(--color-muted)"
                  strokeDasharray="2 3"
                  strokeOpacity={0.7}
                />
              </g>
            ) : null}
          </svg>
          <Legend
            symbol={symbol}
            interval={interval}
            candle={focus}
            change={change}
            precision={precision}
            ema34={showEma34 ? (emaFast[focusIndex] ?? null) : null}
            ema89={showEma89 ? (emaSlow[focusIndex] ?? null) : null}
            hovering={hover != null}
          />
          <ToolHint tool={tool} />
          <div className="absolute right-2 bottom-7 flex flex-col gap-1">
            <ZoomButton label="Phóng to" onClick={() => zoomAt(0.8)}>
            <Plus className="size-3.5" />
            </ZoomButton>
            <ZoomButton label="Thu nhỏ" onClick={() => zoomAt(1.25)}>
              <Minus className="size-3.5" />
            </ZoomButton>
          </div>
          {status === "loading" ? (
            <div className="absolute inset-x-0 top-0 h-0.5 overflow-hidden bg-surface-2">
              <div className="loading-bar h-full w-1/3 bg-accent" />
            </div>
          ) : null}
        </>
      ) : (
        <StatusPanel
          status={status}
          error={error}
          symbol={symbol}
          interval={interval}
          onRetry={() => void reload()}
        />
      )}
    </div>
  );
}

function eventPoint(event: ReactPointerEvent<SVGSVGElement>): { x: number; y: number } | null {
  const rect = event.currentTarget.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function Axis({
  plot,
  view,
  bars,
  interval,
  lo,
  hi,
  precision,
  last,
}: {
  plot: ReturnType<typeof makePlot>;
  view: View;
  bars: Candle[];
  interval: Interval;
  lo: number;
  hi: number;
  precision: number;
  last: Candle | undefined;
}) {
  const ticks = niceTicks(lo, hi, 5);
  const gap = ticks.length >= 2 ? Math.abs(ticks[1] - ticks[0]) : hi - lo;
  const digits = tickDigits(gap);
  const i0 = Math.max(0, Math.floor(view.from));
  const i1 = Math.min(bars.length - 1, Math.ceil(view.to));
  const timeTicks: number[] = [];
  const slots = Math.max(2, Math.floor(plot.plotW / 130));
  for (let slot = 0; slot < slots; slot++) {
    const x = ((slot + 0.5) / slots) * plot.plotW;
    const index = Math.round(logicalOf(x, view, plot.plotW));
    if (index < i0 || index > i1 || !bars[index]) continue;
    const prev = timeTicks[timeTicks.length - 1];
    if (prev != null && Math.abs(xOf(index, view, plot.plotW) - xOf(prev, view, plot.plotW)) < 72) continue;
    timeTicks.push(index);
  }
  const lastY = last ? yOf(last.close, lo, hi, plot.priceH) : null;
  return (
    <g className="font-mono text-xs" pointerEvents="none">
      {ticks.map((tick) => {
        const y = yOf(tick, lo, hi, plot.priceH);
        if (lastY != null && Math.abs(y - lastY) < 14) return null;
        return (
          <g key={tick}>
            <line x1={0} x2={plot.plotW} y1={y} y2={y} stroke="var(--color-border)" />
            <text x={plot.plotW + 8} y={y} dominantBaseline="middle" className="fill-muted">
              {formatPrice(tick, digits)}
            </text>
          </g>
        );
      })}
      <line x1={0} x2={plot.plotW} y1={plot.priceH} y2={plot.priceH} stroke="var(--color-border)" />
      {timeTicks.map((index) => {
        const bar = bars[index];
        if (!bar) return null;
        const x = xOf(index, view, plot.plotW);
        return (
          <g key={bar.time}>
            <line x1={x} x2={x} y1={0} y2={plot.plotH} stroke="var(--color-border)" strokeOpacity={0.55} />
            <text x={x} y={plot.height - 8} textAnchor="middle" className="fill-muted">
              {formatAxisTime(bar.time, interval)}
            </text>
          </g>
        );
      })}
      {last && lastY != null && lastY > -8 && lastY < plot.priceH + 8 ? (
        <g>
          <rect
            x={plot.plotW}
            y={Math.min(plot.priceH - 16, Math.max(0, lastY - 8))}
            width={plot.axisW}
            height={16}
            fill={last.close >= last.open ? "var(--color-up)" : "var(--color-down)"}
          />
          <text
            x={plot.plotW + 8}
            y={Math.min(plot.priceH - 8, Math.max(8, lastY))}
            dominantBaseline="middle"
            className="fill-bg"
          >
            {formatPrice(last.close, precision)}
          </text>
        </g>
      ) : null}
    </g>
  );
}

function Legend({
  symbol,
  interval,
  candle,
  change,
  precision,
  ema34,
  ema89,
  hovering,
}: {
  symbol: string;
  interval: Interval;
  candle: Candle | null;
  change: number;
  precision: number;
  ema34: number | null;
  ema89: number | null;
  hovering: boolean;
}) {
  if (!candle) return null;
  const up = change >= 0;
  return (
    <div className="pointer-events-none absolute top-2 left-2 max-w-xl rounded-sm bg-bg/80 px-2 py-1.5 font-mono text-xs leading-5">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-sans text-sm font-semibold tracking-wide text-fg">{symbol}</span>
        <span className="text-muted">{INTERVAL_LABEL[interval]}</span>
        <span className={up ? "text-up" : "text-down"}>{formatPct(change)}</span>
        {hovering ? <span className="text-muted">đang trỏ</span> : null}
      </div>
      <div className="flex flex-wrap gap-x-3 text-fg">
        <span><span className="text-muted">O </span>{formatPrice(candle.open, precision)}</span>
        <span><span className="text-muted">H </span>{formatPrice(candle.high, precision)}</span>
        <span><span className="text-muted">L </span>{formatPrice(candle.low, precision)}</span>
        <span className={candle.close >= candle.open ? "text-up" : "text-down"}>
          <span className="text-muted">C </span>
          {formatPrice(candle.close, precision)}
        </span>
      </div>
      <div className="flex flex-wrap gap-x-3">
        {ema34 != null ? <span className="text-accent">EMA34 {formatPrice(ema34, precision)}</span> : null}
        {ema89 != null ? <span className="text-slow">EMA89 {formatPrice(ema89, precision)}</span> : null}
        <span className="text-muted">Vol {formatVolume(candle.volume)}</span>
        <span className="text-muted">{formatBarTime(candle.time, interval)}</span>
      </div>
    </div>
  );
}

function ToolHint({ tool }: { tool: Tool }) {
  if (tool === "cursor") return null;
  const text =
    tool === "pick"
      ? "Nhấp một nến để cắt tương lai và bắt đầu replay từ đó."
      : "Nhấp điểm đầu, rồi điểm cuối. Bật nam châm để hút về giá O/H/L/C.";
  return (
    <div className="pointer-events-none absolute inset-x-2 bottom-24 flex justify-center">
      <p className="max-w-md rounded-sm bg-surface/95 px-3 py-2 text-center text-sm text-fg shadow-sm">{text}</p>
    </div>
  );
}

function ZoomButton({
  children,
  label,
  onClick,
}: {
  children: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="inline-flex size-8 items-center justify-center rounded-sm border border-border bg-surface/95 text-fg hover:bg-surface-2"
    >
      {children}
    </button>
  );
}

function StatusPanel({
  status,
  error,
  symbol,
  interval,
  onRetry,
}: {
  status: string;
  error: string | null;
  symbol: string;
  interval: Interval;
  onRetry: () => void;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      {status === "error" ? (
        <>
          <p className="max-w-md text-sm text-down">{error ?? "Không tải được dữ liệu"}</p>
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex h-11 items-center rounded-sm bg-accent px-4 font-semibold text-accent-fg"
          >
            Thử lại
          </button>
        </>
      ) : (
        <>
          <p className="font-sans text-lg font-semibold tracking-wide">Đang tải {symbol}</p>
          <p className="max-w-sm text-sm text-muted">
            Nến {INTERVAL_LABEL[interval]} từ kho công khai Binance Futures. Lịch sử dài có thể mất vài giây.
          </p>
          <div className="mt-2 h-0.5 w-40 overflow-hidden rounded-sm bg-surface-2">
            <div className="loading-bar h-full w-1/3 bg-accent" />
          </div>
        </>
      )}
    </div>
  );
}
