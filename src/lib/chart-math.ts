import type { Candle, Interval, Point } from "@/lib/market";
import { INTERVAL_SEC } from "@/lib/market";

export type View = { from: number; to: number };

export type Plot = {
  width: number;
  height: number;
  plotW: number;
  plotH: number;
  priceH: number;
  volH: number;
  axisW: number;
  timeH: number;
};

export function makePlot(width: number, height: number): Plot {
  const axisW = width < 520 ? 72 : 88;
  const timeH = 26;
  const plotW = Math.max(10, width - axisW);
  const plotH = Math.max(10, height - timeH);
  const volH = Math.max(28, Math.round(plotH * 0.18));
  const priceH = Math.max(10, plotH - volH);
  return { width, height, plotW, plotH, priceH, volH, axisW, timeH };
}

export function xOf(logical: number, view: View, plotW: number): number {
  const span = view.to - view.from || 1;
  return ((logical - view.from) / span) * plotW;
}

export function logicalOf(x: number, view: View, plotW: number): number {
  const span = view.to - view.from || 1;
  return view.from + (x / Math.max(1, plotW)) * span;
}

export function yOf(price: number, lo: number, hi: number, priceH: number): number {
  const span = hi - lo || 1;
  return ((hi - price) / span) * priceH;
}

export function priceOf(y: number, lo: number, hi: number, priceH: number): number {
  const span = hi - lo || 1;
  return hi - (y / Math.max(1, priceH)) * span;
}

export function barStep(bars: Candle[], interval: Interval): number {
  if (bars.length >= 2) {
    const delta = bars[bars.length - 1].time - bars[bars.length - 2].time;
    if (delta > 0) return delta;
  }
  return INTERVAL_SEC[interval];
}

export function timeToLogical(time: number, bars: Candle[], step: number): number {
  const n = bars.length;
  if (n === 0) return 0;
  if (n === 1) return (time - bars[0].time) / (step || 1);
  if (time <= bars[0].time) {
    const s = bars[1].time - bars[0].time || step;
    return (time - bars[0].time) / s;
  }
  const last = n - 1;
  if (time >= bars[last].time) {
    const s = bars[last].time - bars[last - 1].time || step;
    return last + (time - bars[last].time) / s;
  }
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].time <= time) lo = mid;
    else hi = mid;
  }
  const s = bars[hi].time - bars[lo].time || step;
  return lo + (time - bars[lo].time) / s;
}

export function logicalToTime(logical: number, bars: Candle[], step: number): number {
  const n = bars.length;
  if (n === 0) return 0;
  if (n === 1) return bars[0].time + logical * step;
  if (logical <= 0) {
    const s = bars[1].time - bars[0].time || step;
    return bars[0].time + logical * s;
  }
  const last = n - 1;
  if (logical >= last) {
    const s = bars[last].time - bars[last - 1].time || step;
    return bars[last].time + (logical - last) * s;
  }
  const i = Math.floor(logical);
  const frac = logical - i;
  return bars[i].time + frac * (bars[i + 1].time - bars[i].time);
}

export function clampView(view: View, n: number): View {
  let span = view.to - view.from;
  const minSpan = 12;
  const maxSpan = Math.max(minSpan, (n > 0 ? n : 1) + 48);
  if (!Number.isFinite(span) || span <= 0) span = Math.min(170, maxSpan);
  span = Math.min(maxSpan, Math.max(minSpan, span));
  let to = view.to;
  let from = to - span;
  if (n <= 1) return { from: -1, to: -1 + span };
  const maxTo = n - 1 + span * 0.5;
  if (to > maxTo) {
    to = maxTo;
    from = to - span;
  }
  if (from < -4) {
    from = -4;
    to = from + span;
  }
  return { from, to };
}

export function pinView(prev: View | null, cursor: number, n: number): View {
  const fallback = Math.min(170, Math.max(36, n + 8));
  let span = prev && prev.to > prev.from ? prev.to - prev.from : fallback;
  if (cursor + 18 < span) span = Math.max(36, cursor + 18);
  const rightPad = Math.min(12, Math.max(4, span * 0.07));
  return clampView({ from: cursor + rightPad - span, to: cursor + rightPad }, n);
}

export function panView(view: View, dx: number, plotW: number, n: number): View {
  const span = view.to - view.from || 1;
  const shift = (dx / Math.max(1, plotW)) * span;
  return clampView({ from: view.from - shift, to: view.to - shift }, n);
}

export function zoomView(view: View, x: number, plotW: number, factor: number, n: number): View {
  const span = view.to - view.from || 1;
  const nextSpan = span * factor;
  const anchor = logicalOf(x, view, plotW);
  const ratio = (anchor - view.from) / span;
  const from = anchor - ratio * nextSpan;
  return clampView({ from, to: from + nextSpan }, n);
}

export function autoscale(
  bars: Candle[],
  view: View,
  emaFast: (number | null)[],
  emaSlow: (number | null)[],
  showFast: boolean,
  showSlow: boolean,
): { lo: number; hi: number } {
  const i0 = Math.max(0, Math.floor(view.from));
  const i1 = Math.min(bars.length - 1, Math.ceil(view.to));
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = i0; i <= i1; i++) {
    const bar = bars[i];
    if (!bar) continue;
    if (bar.low < lo) lo = bar.low;
    if (bar.high > hi) hi = bar.high;
    if (showFast && emaFast[i] != null) {
      lo = Math.min(lo, emaFast[i] as number);
      hi = Math.max(hi, emaFast[i] as number);
    }
    if (showSlow && emaSlow[i] != null) {
      lo = Math.min(lo, emaSlow[i] as number);
      hi = Math.max(hi, emaSlow[i] as number);
    }
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { lo: 0, hi: 1 };
  let pad = (hi - lo) * 0.12;
  if (pad <= 0) pad = Math.max(Math.abs(hi) * 0.004, 1e-8);
  return { lo: lo - pad, hi: hi + pad };
}

export function niceTicks(lo: number, hi: number, count = 5): number[] {
  if (!(hi > lo)) return [];
  const span = hi - lo;
  const raw = span / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  if (!(step > 0)) return [];
  const start = Math.ceil(lo / step) * step;
  const ticks: number[] = [];
  for (let i = 0; i < 10; i++) {
    const value = start + i * step;
    if (value >= hi) break;
    if (value > lo) ticks.push(value);
  }
  return ticks;
}

export function tickDigits(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 2;
  if (step >= 1 && Math.abs(step - Math.round(step)) < step * 1e-6) return 0;
  return Math.max(0, Math.min(8, Math.ceil(-Math.log10(step))));
}

export function maxVolume(bars: Candle[], view: View): number {
  const i0 = Math.max(0, Math.floor(view.from));
  const i1 = Math.min(bars.length - 1, Math.ceil(view.to));
  let max = 0;
  for (let i = i0; i <= i1; i++) {
    const volume = bars[i]?.volume ?? 0;
    if (volume > max) max = volume;
  }
  return max || 1;
}

export function magnetPrice(
  logical: number,
  y: number,
  bars: Candle[],
  lo: number,
  hi: number,
  priceH: number,
): { index: number; price: number } | null {
  if (bars.length === 0) return null;
  const index = Math.max(0, Math.min(bars.length - 1, Math.round(logical)));
  const bar = bars[index];
  const targets = [bar.open, bar.high, bar.low, bar.close];
  let best = targets[0];
  let bestD = Infinity;
  for (const price of targets) {
    const py = yOf(price, lo, hi, priceH);
    const dist = Math.abs(py - y);
    if (dist < bestD) {
      bestD = dist;
      best = price;
    }
  }
  const price = bestD <= 22 ? best : priceOf(y, lo, hi, priceH);
  return { index, price };
}

export function segmentDistance(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = dx * dx + dy * dy;
  if (len === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / len;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

export function extendEnd(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  plotW: number,
): { x: number; y: number } {
  const dx = x2 - x1;
  if (Math.abs(dx) < 0.01) return { x: x2, y: y2 };
  const dir = x2 >= x1 ? 1 : -1;
  const target = dir > 0 ? plotW : 0;
  const y = y1 + ((y2 - y1) * (target - x1)) / dx;
  return { x: target, y };
}

export function linePixels(
  line: { a: Point; b: Point; extend: boolean },
  bars: Candle[],
  step: number,
  view: View,
  plotW: number,
  lo: number,
  hi: number,
  priceH: number,
): { x1: number; y1: number; x2: number; y2: number } | null {
  if (bars.length === 0) return null;
  const la = timeToLogical(line.a.time, bars, step);
  const lb = timeToLogical(line.b.time, bars, step);
  let x1 = xOf(la, view, plotW);
  let y1 = yOf(line.a.price, lo, hi, priceH);
  let x2 = xOf(lb, view, plotW);
  let y2 = yOf(line.b.price, lo, hi, priceH);
  if (line.extend) {
    const end = extendEnd(x1, y1, x2, y2, plotW);
    x2 = end.x;
    y2 = end.y;
  }
  return { x1, y1, x2, y2 };
}
