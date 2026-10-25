import { create } from "zustand";
import { getKlines, getSymbols } from "@/lib/binance.functions";
import {
  type Candle,
  type Interval,
  type Point,
  type Speed,
  type Drawing,
  type RectDrawing,
  type Trendline,
  POPULAR_SYMBOLS,
  isInterval,
  isRect,
  nearestIndex,
  newId,
  normalizeSymbol,
  pairKey,
  toCandle,
} from "@/lib/market";
import type { MarketSource } from "@/lib/vision-load";

const STORAGE_KEY = "replay-terminal-v1";
const EMPTY_LINES: Drawing[] = [];

export type Tool = "cursor" | "trend" | "rect" | "pick";
export type LoadStatus = "idle" | "loading" | "ready" | "error";

type Persisted = {
  symbol: string;
  interval: Interval;
  speed: Speed;
  showEma34: boolean;
  showEma89: boolean;
  magnet: boolean;
  drawings: Record<string, Drawing[]>;
};

type State = Persisted & {
  hydrated: boolean;
  candles: Candle[];
  cursor: number;
  status: LoadStatus;
  error: string | null;
  source: MarketSource | null;
  precision: number;
  playing: boolean;
  tool: Tool;
  selectedId: string | null;
  symbols: string[];
  symbolOpen: boolean;
  helpOpen: boolean;
  loadedSymbol: string | null;
  loadedInterval: Interval | null;
  follow: boolean;
};

type Actions = {
  hydrate: () => void;
  reload: () => Promise<void>;
  setSymbol: (symbol: string) => void;
  setInterval: (interval: Interval) => void;
  setCursor: (index: number) => void;
  step: (delta: number, keepPlaying?: boolean) => void;
  togglePlay: () => void;
  pause: () => void;
  randomStart: () => void;
  goLive: () => void;
  setSpeed: (speed: Speed) => void;
  setTool: (tool: Tool) => void;
  toggleEma: (which: 34 | 89) => void;
  toggleMagnet: () => void;
  selectLine: (id: string | null) => void;
  addLine: (a: Point, b: Point) => void;
  addRect: (a: Point, b: Point) => void;
  updateLine: (id: string, patch: Partial<Trendline>) => void;
  deleteSelected: () => void;
  undoLine: () => void;
  setSymbolOpen: (open: boolean) => void;
  setHelpOpen: (open: boolean) => void;
  setFollow: (follow: boolean) => void;
  toggleExtendSelected: () => void;
};

let requestId = 0;
let persistBound = false;

function isSpeed(value: unknown): value is Speed {
  return value === 1 || value === 2 || value === 3 || value === 5 || value === 10;
}

function isPoint(value: unknown): value is Point {
  if (!value || typeof value !== "object") return false;
  const point = value as Point;
  return Number.isFinite(point.time) && Number.isFinite(point.price);
}

function sanitizeDrawings(value: unknown): Record<string, Drawing[]> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, Drawing[]> = {};
  for (const [key, lines] of Object.entries(value as Record<string, unknown>)) {
    if (!Array.isArray(lines)) continue;
    const clean: Drawing[] = [];
    for (const line of lines) {
      if (!line || typeof line !== "object") continue;
      const item = line as Drawing;
      if (!isPoint(item.a) || !isPoint(item.b) || typeof item.id !== "string") continue;
      if (isRect(item)) clean.push({ id: item.id, kind: "rect", a: item.a, b: item.b });
      else clean.push({ id: item.id, a: item.a, b: item.b, extend: Boolean((item as Trendline).extend) });
    }
    if (clean.length) out[key] = clean.slice(-80);
  }
  return out;
}

function readPersisted(): Partial<Persisted> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<Persisted>;
    const symbol = typeof parsed.symbol === "string" ? normalizeSymbol(parsed.symbol) : null;
    return {
      symbol: symbol ?? undefined,
      interval: typeof parsed.interval === "string" && isInterval(parsed.interval) ? parsed.interval : undefined,
      speed: isSpeed(parsed.speed) ? parsed.speed : undefined,
      showEma34: typeof parsed.showEma34 === "boolean" ? parsed.showEma34 : undefined,
      showEma89: typeof parsed.showEma89 === "boolean" ? parsed.showEma89 : undefined,
      magnet: typeof parsed.magnet === "boolean" ? parsed.magnet : undefined,
      drawings: sanitizeDrawings(parsed.drawings),
    };
  } catch {
    return {};
  }
}

function writePersisted(state: State) {
  const data: Persisted = {
    symbol: state.symbol,
    interval: state.interval,
    speed: state.speed,
    showEma34: state.showEma34,
    showEma89: state.showEma89,
    magnet: state.magnet,
    drawings: state.drawings,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export const useTerminal = create<State & Actions>((set, get) => ({
  hydrated: false,
  symbol: "BTCUSDT",
  interval: "4h",
  speed: 3,
  showEma34: true,
  showEma89: true,
  magnet: true,
  drawings: {},
  candles: [],
  cursor: 0,
  status: "idle",
  error: null,
  source: null,
  precision: 2,
  playing: false,
  tool: "cursor",
  selectedId: null,
  symbols: POPULAR_SYMBOLS,
  symbolOpen: false,
  helpOpen: false,
  loadedSymbol: null,
  loadedInterval: null,
  follow: true,

  hydrate: () => {
    if (get().hydrated) return;
    set({ ...readPersisted(), hydrated: true });
    if (!persistBound) {
      persistBound = true;
      useTerminal.subscribe((state, prev) => {
        if (!state.hydrated) return;
        if (
          state.symbol !== prev.symbol ||
          state.interval !== prev.interval ||
          state.speed !== prev.speed ||
          state.showEma34 !== prev.showEma34 ||
          state.showEma89 !== prev.showEma89 ||
          state.magnet !== prev.magnet ||
          state.drawings !== prev.drawings
        ) {
          writePersisted(state);
        }
      });
    }
    void get().reload();
    void getSymbols()
      .then(({ symbols }) => {
        if (symbols.length > 0) set({ symbols });
      })
      .catch(() => undefined);
  },

  reload: async () => {
    const { symbol, interval, candles, cursor } = get();
    const anchor = candles[cursor]?.time ?? null;
    const wasLive = candles.length > 0 && cursor >= candles.length - 1;
    const id = ++requestId;
    set({ status: "loading", error: null, playing: false, selectedId: null });
    try {
      const payload = await getKlines({ data: { symbol, interval } });
      if (id !== requestId) return;
      const next = payload.candles.map(toCandle);
      let nextCursor = next.length - 1;
      if (!wasLive && anchor != null && anchor >= next[0].time) {
        nextCursor = nearestIndex(next, anchor);
      }
      set({
        candles: next,
        cursor: nextCursor,
        status: "ready",
        source: payload.source,
        precision: payload.precision,
        error: null,
        loadedSymbol: symbol,
        loadedInterval: interval,
        follow: true,
      });
    } catch (error) {
      if (id !== requestId) return;
      const message = error instanceof Error ? error.message : "Không tải được dữ liệu";
      set({ status: "error", error: message, playing: false });
    }
  },

  setSymbol: (symbol) => {
    const next = normalizeSymbol(symbol);
    if (!next || next === get().symbol) {
      set({ symbolOpen: false });
      return;
    }
    set({ symbol: next, symbolOpen: false, tool: "cursor", playing: false });
    void get().reload();
  },

  setInterval: (interval) => {
    if (interval === get().interval) return;
    set({ interval, tool: "cursor", playing: false });
    void get().reload();
  },

  setCursor: (index) => {
    const { candles } = get();
    if (candles.length === 0) return;
    const cursor = Math.max(0, Math.min(candles.length - 1, Math.round(index)));
    set({ cursor, playing: false, follow: true });
  },

  step: (delta, keepPlaying = false) => {
    const { candles, cursor, playing } = get();
    if (candles.length === 0) return;
    const next = Math.max(0, Math.min(candles.length - 1, cursor + delta));
    const atEnd = next >= candles.length - 1;
    set({ cursor: next, playing: keepPlaying && playing && !atEnd, follow: true });
  },

  togglePlay: () => {
    const { playing, candles, cursor } = get();
    if (playing) {
      set({ playing: false });
      return;
    }
    if (candles.length < 2 || cursor >= candles.length - 1) return;
    set({ playing: true, tool: "cursor", follow: true });
  },

  pause: () => set({ playing: false }),

  randomStart: () => {
    const { candles } = get();
    if (candles.length < 40) return;
    const lo = Math.min(candles.length - 2, Math.max(30, Math.floor(candles.length * 0.12)));
    const hi = Math.max(lo + 1, Math.floor(candles.length * 0.8));
    const cursor = lo + Math.floor(Math.random() * (hi - lo));
    set({ cursor, playing: false, tool: "cursor", follow: true });
  },

  goLive: () => {
    const { candles, tool } = get();
    if (candles.length === 0) return;
    set({ cursor: candles.length - 1, playing: false, follow: true, tool: tool === "pick" ? "cursor" : tool });
  },

  setSpeed: (speed) => set({ speed }),
  setTool: (tool) => set({ tool, playing: tool === "cursor" ? get().playing : false }),
  toggleEma: (which) => {
    if (which === 34) set({ showEma34: !get().showEma34 });
    else set({ showEma89: !get().showEma89 });
  },
  toggleMagnet: () => set({ magnet: !get().magnet }),
  selectLine: (id) => set({ selectedId: id }),

  addLine: (a, b) => {
    const state = get();
    const key = pairKey(state.symbol, state.interval);
    const line: Trendline = { id: newId(), a, b, extend: false };
    const prev = state.drawings[key] ?? EMPTY_LINES;
    set({
      drawings: { ...state.drawings, [key]: [...prev, line].slice(-80) },
      selectedId: line.id,
      tool: "cursor",
    });
  },

  addRect: (a, b) => {
    const state = get();
    const key = pairKey(state.symbol, state.interval);
    const rect: RectDrawing = { id: newId(), kind: "rect", a, b };
    const prev = state.drawings[key] ?? EMPTY_LINES;
    set({
      drawings: { ...state.drawings, [key]: [...prev, rect].slice(-80) },
      selectedId: rect.id,
      tool: "cursor",
    });
  },

  updateLine: (id, patch) => {
    const state = get();
    const key = pairKey(state.symbol, state.interval);
    const prev = state.drawings[key] ?? EMPTY_LINES;
    set({
      drawings: {
        ...state.drawings,
        [key]: prev.map((line) => {
          if (line.id !== id) return line;
          if (isRect(line)) return { ...line, a: patch.a ?? line.a, b: patch.b ?? line.b };
          return { ...line, ...patch, id: line.id };
        }),
      },
    });
  },

  deleteSelected: () => {
    const state = get();
    if (!state.selectedId) return;
    const key = pairKey(state.symbol, state.interval);
    const prev = state.drawings[key] ?? EMPTY_LINES;
    set({
      drawings: { ...state.drawings, [key]: prev.filter((line) => line.id !== state.selectedId) },
      selectedId: null,
    });
  },

  undoLine: () => {
    const state = get();
    const key = pairKey(state.symbol, state.interval);
    const prev = state.drawings[key] ?? EMPTY_LINES;
    if (prev.length === 0) return;
    const removed = prev[prev.length - 1];
    set({
      drawings: { ...state.drawings, [key]: prev.slice(0, -1) },
      selectedId: state.selectedId === removed.id ? null : state.selectedId,
    });
  },

  setSymbolOpen: (symbolOpen) => set({ symbolOpen }),
  setHelpOpen: (helpOpen) => set({ helpOpen }),
  setFollow: (follow) => set({ follow }),
  toggleExtendSelected: () => {
    const state = get();
    if (!state.selectedId) return;
    const key = pairKey(state.symbol, state.interval);
    const line = (state.drawings[key] ?? EMPTY_LINES).find((item) => item.id === state.selectedId);
    if (!line || isRect(line)) return;
    get().updateLine(line.id, { extend: !line.extend });
  },
}));

export function useActiveLines(): Drawing[] {
  return useTerminal((state) => state.drawings[pairKey(state.symbol, state.interval)] ?? EMPTY_LINES);
}
