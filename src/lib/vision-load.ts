import { unzipSync } from "fflate";
import type { Candle, CandleTuple, Interval } from "@/lib/market";
import { INTERVALS, isInterval } from "@/lib/market";

export type MarketSource = "live" | "vision";

export type MarketPayload = {
  symbol: string;
  interval: Interval;
  candles: CandleTuple[];
  precision: number;
  source: MarketSource;
  asOf: number;
};

const VISION = "https://data.binance.vision/data/futures/um";
const FAPI = "https://fapi.binance.com/fapi/v1/klines";
const S3 = "https://s3-ap-northeast-1.amazonaws.com/data.binance.vision";
const LOOKBACK_DAYS: Record<Interval, number> = {
  "15m": 75,
  "1h": 400,
  "4h": 820,
  "1d": 1700,
  "1w": 1700,
};
const FAPI_PAGES: Record<Interval, number> = {
  "15m": 4,
  "1h": 3,
  "4h": 2,
  "1d": 2,
  "1w": 2,
};

type CacheBox = {
  fapi: "unknown" | "ok" | "blocked";
  klines: Map<string, { at: number; payload: MarketPayload }>;
  symbols?: { at: number; list: string[] };
};

const box: CacheBox = ((globalThis as unknown as { __replayCache?: CacheBox }).__replayCache ??=
  {
    fapi: "unknown",
    klines: new Map(),
  });

function utcMidnight(date = new Date()): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function stampMonth(year: number, month: number): string {
  return `${year}-${pad(month)}`;
}

function stampDay(date: Date): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function decimals(token: string): number {
  const dot = token.indexOf(".");
  return dot < 0 ? 0 : token.length - dot - 1;
}

function parseCsv(text: string): { candles: Candle[]; precision: number } {
  const candles: Candle[] = [];
  let precision = 0;
  const lines = text.split("\n");
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("open_time")) continue;
    const parts = line.split(",");
    if (parts.length < 6) continue;
    const timeMs = Number(parts[0]);
    const open = Number(parts[1]);
    const high = Number(parts[2]);
    const low = Number(parts[3]);
    const close = Number(parts[4]);
    const volume = Number(parts[5]);
    if (![timeMs, open, high, low, close, volume].every(Number.isFinite)) continue;
    if (high < low) continue;
    precision = Math.max(precision, decimals(parts[1]), decimals(parts[2]), decimals(parts[3]), decimals(parts[4]));
    candles.push({
      time: Math.floor(timeMs / 1000),
      open,
      high,
      low,
      close,
      volume,
    });
  }
  return { candles, precision };
}

function finalize(candles: Candle[], precision: number): { candles: Candle[]; precision: number } {
  candles.sort((a, b) => a.time - b.time);
  const out: Candle[] = [];
  for (const candle of candles) {
    const prev = out[out.length - 1];
    if (prev && prev.time === candle.time) out[out.length - 1] = candle;
    else out.push(candle);
  }
  if (out.length > 20_000) return { candles: out.slice(out.length - 20_000), precision };
  return { candles: out, precision: precision || 2 };
}

function mondayOpen(timeSec: number): number {
  const date = new Date(timeSec * 1000);
  const sinceMonday = (date.getUTCDay() + 6) % 7;
  const monday = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - sinceMonday);
  return Math.floor(monday / 1000);
}

function toWeekly(daily: Candle[]): Candle[] {
  const weeks = new Map<number, Candle>();
  for (const candle of daily) {
    const week = mondayOpen(candle.time);
    const prev = weeks.get(week);
    if (!prev) {
      weeks.set(week, { ...candle, time: week });
      continue;
    }
    prev.high = Math.max(prev.high, candle.high);
    prev.low = Math.min(prev.low, candle.low);
    prev.close = candle.close;
    prev.volume += candle.volume;
  }
  return [...weeks.values()].sort((a, b) => a.time - b.time);
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = index++;
      out[current] = await fn(items[current]);
    }
  });
  await Promise.all(workers);
  return out;
}

async function readZip(url: string): Promise<{ candles: Candle[]; precision: number } | null> {
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Không tải được dữ liệu Binance (${response.status})`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const files = unzipSync(bytes);
  const name = Object.keys(files)[0];
  if (!name) return null;
  return parseCsv(new TextDecoder().decode(files[name]));
}

type ArchiveFile = { url: string };

function archivePlan(symbol: string, interval: "15m" | "1h" | "4h" | "1d", from: Date, to: Date): ArchiveFile[] {
  const files: ArchiveFile[] = [];
  let year = from.getUTCFullYear();
  let month = from.getUTCMonth() + 1;
  const endYear = to.getUTCFullYear();
  const endMonth = to.getUTCMonth() + 1;
  while (year < endYear || (year === endYear && month <= endMonth)) {
    const start = new Date(Date.UTC(year, month - 1, 1));
    const end = new Date(Date.UTC(year, month, 0));
    const full = start.getTime() >= from.getTime() && end.getTime() <= to.getTime();
    if (full) {
      const stamp = stampMonth(year, month);
      files.push({
        url: `${VISION}/monthly/klines/${symbol}/${interval}/${symbol}-${interval}-${stamp}.zip`,
      });
    } else {
      const segStart = start.getTime() < from.getTime() ? from : start;
      const segEnd = end.getTime() > to.getTime() ? to : end;
      for (let time = segStart.getTime(); time <= segEnd.getTime(); time += 86_400_000) {
        const day = stampDay(new Date(time));
        files.push({
          url: `${VISION}/daily/klines/${symbol}/${interval}/${symbol}-${interval}-${day}.zip`,
        });
      }
    }
    month += 1;
    if (month === 13) {
      month = 1;
      year += 1;
    }
  }
  return files;
}

async function fetchVision(symbol: string, interval: Interval): Promise<MarketPayload> {
  const archiveInterval = interval === "1w" ? "1d" : interval;
  const end = addDays(utcMidnight(), -1);
  const from = addDays(end, -(LOOKBACK_DAYS[interval] - 1));
  const files = archivePlan(symbol, archiveInterval, from, end);
  const parts = await mapPool(files, 12, async (file) => readZip(file.url));
  let precision = 0;
  const candles: Candle[] = [];
  for (const part of parts) {
    if (!part) continue;
    precision = Math.max(precision, part.precision);
    candles.push(...part.candles);
  }
  const merged = finalize(candles, precision);
  const series = interval === "1w" ? toWeekly(merged.candles) : merged.candles;
  if (series.length < 2) {
    throw new Error(`Không có dữ liệu futures USDT-M cho ${symbol}. Thử BTCUSDT hoặc một cặp perpetual khác.`);
  }
  return {
    symbol,
    interval,
    candles: series.map(toTuple),
    precision: merged.precision || 2,
    source: "vision",
    asOf: series[series.length - 1].time,
  };
}

function toTuple(candle: Candle): CandleTuple {
  return [candle.time, candle.open, candle.high, candle.low, candle.close, candle.volume];
}

function fromKlineRow(row: unknown[], precision: { value: number }): Candle | null {
  if (!Array.isArray(row) || row.length < 6) return null;
  const timeMs = Number(row[0]);
  const open = Number(row[1]);
  const high = Number(row[2]);
  const low = Number(row[3]);
  const close = Number(row[4]);
  const volume = Number(row[5]);
  if (![timeMs, open, high, low, close, volume].every(Number.isFinite)) return null;
  for (const token of [row[1], row[2], row[3], row[4]]) {
    if (typeof token === "string") precision.value = Math.max(precision.value, decimals(token));
  }
  return { time: Math.floor(timeMs / 1000), open, high, low, close, volume };
}

async function fapiAvailable(): Promise<boolean> {
  if (box.fapi === "ok") return true;
  if (box.fapi === "blocked") return false;
  try {
    const response = await fetch(`${FAPI}?symbol=BTCUSDT&interval=1h&limit=1`, {
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) {
      box.fapi = "blocked";
      return false;
    }
    const body = await response.json();
    if (!Array.isArray(body)) {
      box.fapi = "blocked";
      return false;
    }
    box.fapi = "ok";
    return true;
  } catch {
    box.fapi = "blocked";
    return false;
  }
}

async function fetchFapi(symbol: string, interval: Interval): Promise<MarketPayload | null> {
  const pages = FAPI_PAGES[interval];
  const rows: Candle[] = [];
  const precision = { value: 2 };
  let endTime: number | undefined;
  for (let page = 0; page < pages; page++) {
    const url = new URL(FAPI);
    url.searchParams.set("symbol", symbol);
    url.searchParams.set("interval", interval);
    url.searchParams.set("limit", "1500");
    if (endTime != null) url.searchParams.set("endTime", String(endTime));
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (!response.ok) return page === 0 ? null : packLive(symbol, interval, rows, precision.value);
    const body = (await response.json()) as unknown;
    if (!Array.isArray(body) || body.length === 0) break;
    const batch: Candle[] = [];
    for (const row of body) {
      const candle = fromKlineRow(row as unknown[], precision);
      if (candle) batch.push(candle);
    }
    rows.unshift(...batch);
    const first = body[0] as unknown[];
    endTime = Number(first[0]) - 1;
    if (body.length < 1500) break;
  }
  if (rows.length < 2) return null;
  return packLive(symbol, interval, rows, precision.value);
}

function packLive(symbol: string, interval: Interval, rows: Candle[], precision: number): MarketPayload {
  const merged = finalize(rows, precision);
  return {
    symbol,
    interval,
    candles: merged.candles.map(toTuple),
    precision: merged.precision,
    source: "live",
    asOf: merged.candles[merged.candles.length - 1]?.time ?? 0,
  };
}

export async function loadMarket(symbol: string, interval: Interval): Promise<MarketPayload> {
  const end = stampDay(addDays(utcMidnight(), -1));
  const key = `${symbol}|${interval}|${end}|v1`;
  const hit = box.klines.get(key);
  if (hit && Date.now() - hit.at < 6 * 60 * 60 * 1000) return hit.payload;

  let payload: MarketPayload | null = null;
  if (await fapiAvailable()) {
    try {
      payload = await fetchFapi(symbol, interval);
    } catch {
      payload = null;
    }
  }
  if (!payload) payload = await fetchVision(symbol, interval);
  box.klines.set(key, { at: Date.now(), payload });
  return payload;
}

export async function loadSymbols(): Promise<string[]> {
  if (box.symbols && Date.now() - box.symbols.at < 24 * 60 * 60 * 1000) return box.symbols.list;
  const symbols: string[] = [];
  let marker = "";
  try {
    for (let page = 0; page < 8; page++) {
      const url = new URL(S3);
      url.searchParams.set("delimiter", "/");
      url.searchParams.set("prefix", "data/futures/um/monthly/klines/");
      url.searchParams.set("max-keys", "1000");
      if (marker) url.searchParams.set("marker", marker);
      const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(12_000) });
      if (!response.ok) break;
      const xml = await response.text();
      const pattern = /<Prefix>data\/futures\/um\/monthly\/klines\/([A-Z0-9]+)\/<\/Prefix>/g;
      for (const match of xml.matchAll(pattern)) {
        if (match[1].endsWith("USDT")) symbols.push(match[1]);
      }
      if (!xml.includes("<IsTruncated>true</IsTruncated>")) break;
      const next = xml.match(/<NextMarker>([^<]+)<\/NextMarker>/);
      if (!next) break;
      marker = next[1];
    }
  } catch {
    return box.symbols?.list ?? [];
  }
  const list = [...new Set(symbols)].sort();
  if (list.length > 0) box.symbols = { at: Date.now(), list };
  return list;
}

export function assertMarketRequest(input: unknown): { symbol: string; interval: Interval } {
  const raw = input as { symbol?: unknown; interval?: unknown } | null;
  const symbol = String(raw?.symbol ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  const interval = String(raw?.interval ?? "");
  if (!/^[A-Z0-9]{2,20}$/.test(symbol)) throw new Error("Symbol không hợp lệ");
  if (!isInterval(interval) || !INTERVALS.includes(interval)) throw new Error("Khung thời gian không hợp lệ");
  return { symbol, interval };
}
