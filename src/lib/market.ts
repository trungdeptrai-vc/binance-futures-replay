export const INTERVALS = ["15m", "1h", "4h", "1d", "1w"] as const;

export type Interval = (typeof INTERVALS)[number];

export type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type CandleTuple = [number, number, number, number, number, number];

export type Point = { time: number; price: number };

export type Trendline = {
  id: string;
  a: Point;
  b: Point;
  extend: boolean;
};

export const SPEEDS = [1, 2, 3, 5, 10] as const;
export type Speed = (typeof SPEEDS)[number];

export const INTERVAL_SEC: Record<Interval, number> = {
  "15m": 15 * 60,
  "1h": 60 * 60,
  "4h": 4 * 60 * 60,
  "1d": 24 * 60 * 60,
  "1w": 7 * 24 * 60 * 60,
};

export const INTERVAL_LABEL: Record<Interval, string> = {
  "15m": "15m",
  "1h": "1H",
  "4h": "4H",
  "1d": "1D",
  "1w": "1W",
};

export const POPULAR_SYMBOLS = [
  "BTCUSDT",
  "ETHUSDT",
  "SOLUSDT",
  "BNBUSDT",
  "XRPUSDT",
  "DOGEUSDT",
  "1000PEPEUSDT",
  "SUIUSDT",
  "ADAUSDT",
  "AVAXUSDT",
  "LINKUSDT",
  "TONUSDT",
  "WIFUSDT",
  "NEARUSDT",
  "APTUSDT",
  "ARBUSDT",
  "OPUSDT",
  "LTCUSDT",
  "BCHUSDT",
  "DOTUSDT",
  "TIAUSDT",
  "SEIUSDT",
  "INJUSDT",
  "AAVEUSDT",
  "UNIUSDT",
  "TRXUSDT",
  "FILUSDT",
  "ATOMUSDT",
  "ETCUSDT",
  "WLDUSDT",
];

const SYMBOL_RE = /^[A-Z0-9]{2,20}$/;

export function isInterval(value: string): value is Interval {
  return (INTERVALS as readonly string[]).includes(value);
}

export function normalizeSymbol(value: string): string | null {
  const symbol = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!SYMBOL_RE.test(symbol)) return null;
  return symbol;
}

export function pairKey(symbol: string, interval: Interval): string {
  return `${symbol}|${interval}`;
}

export function baseAsset(symbol: string): string {
  return symbol.endsWith("USDT") ? symbol.slice(0, -4) : symbol;
}

export function toCandle(tuple: CandleTuple): Candle {
  return {
    time: tuple[0],
    open: tuple[1],
    high: tuple[2],
    low: tuple[3],
    close: tuple[4],
    volume: tuple[5],
  };
}

export function emaSeries(candles: Candle[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(candles.length).fill(null);
  if (candles.length < period || period < 1) return out;
  const k = 2 / (period + 1);
  let sum = 0;
  for (let i = 0; i < period; i++) sum += candles[i].close;
  let prev = sum / period;
  out[period - 1] = prev;
  for (let i = period; i < candles.length; i++) {
    prev = candles[i].close * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

export function emaAt(candles: Candle[], period: number, index: number): number | null {
  if (index < period - 1 || candles.length < period) return null;
  const k = 2 / (period + 1);
  let sum = 0;
  for (let i = 0; i < period; i++) sum += candles[i].close;
  let prev = sum / period;
  for (let i = period; i <= index; i++) prev = candles[i].close * k + prev * (1 - k);
  return prev;
}

export function nearestIndex(candles: Candle[], time: number): number {
  if (candles.length === 0) return 0;
  let lo = 0;
  let hi = candles.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (candles[mid].time < time) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(candles[lo - 1].time - time) < Math.abs(candles[lo].time - time)) {
    return lo - 1;
  }
  return lo;
}

export function formatPrice(value: number, precision: number): string {
  if (!Number.isFinite(value)) return "—";
  const digits = Math.max(0, Math.min(8, precision));
  return value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function formatVolume(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(2)}K`;
  return value.toFixed(abs >= 100 ? 0 : 2);
}

export function formatPct(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function zone(interval: Interval): "UTC" | "Asia/Ho_Chi_Minh" {
  return interval === "1d" || interval === "1w" ? "UTC" : "Asia/Ho_Chi_Minh";
}

export function formatBarTime(sec: number, interval: Interval): string {
  const timeZone = zone(interval);
  const date = new Intl.DateTimeFormat("vi-VN", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(sec * 1000));
  if (interval === "1d" || interval === "1w") return `${date} UTC`;
  const clock = new Intl.DateTimeFormat("vi-VN", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(sec * 1000));
  return `${date} ${clock}`;
}

export function formatAxisTime(sec: number, interval: Interval): string {
  const timeZone = zone(interval);
  const date = new Date(sec * 1000);
  if (interval === "1d" || interval === "1w") {
    return new Intl.DateTimeFormat("vi-VN", {
      timeZone,
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
    }).format(date);
  }
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

export function speedMs(speed: Speed): number {
  return Math.max(48, Math.round(520 / speed));
}

export function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `ln-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
