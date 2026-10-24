import { useEffect, useState, type ReactNode } from "react";
import { ChevronsRight, Magnet, MousePointer2, Pause, PenLine, Play, Shuffle, SkipBack, SkipForward, Target, Trash2 } from "lucide-react";
import { SPEEDS, formatBarTime, speedMs, type Speed } from "@/lib/market";
import { useActiveLines, useTerminal } from "@/lib/store";

export function ReplayDock() {
  const total = useTerminal((s) => s.candles.length);
  const cursor = useTerminal((s) => s.cursor);
  const interval = useTerminal((s) => s.interval);
  const barTime = useTerminal((s) => s.candles[s.cursor]?.time ?? null);
  const playing = useTerminal((s) => s.playing);
  const speed = useTerminal((s) => s.speed);
  const tool = useTerminal((s) => s.tool);
  const magnet = useTerminal((s) => s.magnet);
  const selectedId = useTerminal((s) => s.selectedId);
  const status = useTerminal((s) => s.status);
  const lines = useActiveLines();
  const setCursor = useTerminal((s) => s.setCursor);
  const step = useTerminal((s) => s.step);
  const togglePlay = useTerminal((s) => s.togglePlay);
  const randomStart = useTerminal((s) => s.randomStart);
  const goLive = useTerminal((s) => s.goLive);
  const setSpeed = useTerminal((s) => s.setSpeed);
  const setTool = useTerminal((s) => s.setTool);
  const toggleMagnet = useTerminal((s) => s.toggleMagnet);
  const deleteSelected = useTerminal((s) => s.deleteSelected);
  const toggleExtend = useTerminal((s) => s.toggleExtendSelected);
  const [scrubReady, setScrubReady] = useState(false);

  useEffect(() => {
    setScrubReady(true);
  }, []);

  const selected = lines.find((line) => line.id === selectedId) ?? null;
  const atEnd = total === 0 || cursor >= total - 1;
  const left = Math.max(0, total - 1 - cursor);
  const ready = status === "ready" && total > 1;

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      useTerminal.getState().step(1, true);
    }, speedMs(speed));
    return () => window.clearInterval(timer);
  }, [playing, speed]);

  return (
    <footer className="shrink-0 border-t border-border bg-surface">
      <div className="flex items-center gap-2 px-2 pt-1">
        {scrubReady ? (
          <input
            className="scrub min-w-0 flex-1"
            type="range"
            min={0}
            max={Math.max(0, total - 1)}
            step={1}
            value={total === 0 ? 0 : Math.min(cursor, total - 1)}
            disabled={!ready}
            aria-label="Vị trí replay"
            onChange={(event) => setCursor(Number(event.target.value))}
          />
        ) : (
          <div className="h-6 min-w-0 flex-1" />
        )}
        <span className="shrink-0 truncate font-mono text-[10px] text-muted tabular-nums">
          {barTime ? formatBarTime(barTime, interval) : "—"}
          {total > 0 ? ` · ${(cursor + 1).toLocaleString("vi-VN")}/${total.toLocaleString("vi-VN")}` : ""}
          {left > 0 ? ` · còn ${left.toLocaleString("vi-VN")}` : ""}
        </span>
      </div>
      <div className="scroll-x flex items-center gap-1 px-1.5 py-1">
        <DockButton label="Con trỏ" pressed={tool === "cursor"} onClick={() => setTool("cursor")}>
          <MousePointer2 className="size-4" />
        </DockButton>
        <DockButton label="Trendline" pressed={tool === "trend"} onClick={() => setTool("trend")}>
          <PenLine className="size-4" />
        </DockButton>
        <DockButton label="Chọn nến bắt đầu" pressed={tool === "pick"} onClick={() => setTool("pick")}>
          <Target className="size-4" />
        </DockButton>
        <DockButton label={magnet ? "Nam châm đang bật" : "Bật nam châm"} pressed={magnet} onClick={toggleMagnet}>
          <Magnet className="size-4" />
        </DockButton>
        <span className="mx-1 h-6 w-px shrink-0 bg-border" />
        <DockButton label="Lùi một nến" disabled={!ready || cursor <= 0} onClick={() => step(-1)}>
          <SkipBack className="size-4" />
        </DockButton>
        <button
          type="button"
          aria-label={playing ? "Tạm dừng" : "Phát"}
          disabled={!ready || (!playing && atEnd)}
          onClick={togglePlay}
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-sm bg-accent text-accent-fg disabled:opacity-40"
        >
          {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
        </button>
        <DockButton label="Tiến một nến" disabled={!ready || atEnd} onClick={() => step(1)}>
          <SkipForward className="size-4" />
        </DockButton>
        <DockButton label="Điểm ngẫu nhiên" disabled={!ready} onClick={randomStart}>
          <Shuffle className="size-4" />
        </DockButton>
        <DockButton label="Về nến cuối" disabled={!ready || atEnd} onClick={goLive}>
          <ChevronsRight className="size-4" />
        </DockButton>
        <span className="mx-1 h-6 w-px shrink-0 bg-border" />
        {SPEEDS.map((item) => (
          <SpeedButton key={item} speed={item} active={speed === item} onClick={() => setSpeed(item)} />
        ))}
        {selected ? (
          <>
            <span className="mx-1 h-6 w-px shrink-0 bg-border" />
            <button
              type="button"
              aria-pressed={selected.extend}
              onClick={toggleExtend}
              className={`inline-flex h-8 shrink-0 items-center rounded-sm border px-2 text-xs ${
                selected.extend ? "border-accent text-accent" : "border-border text-muted"
              }`}
            >
              Kéo dài
            </button>
            <DockButton label="Xóa trendline" onClick={deleteSelected}>
              <Trash2 className="size-4" />
            </DockButton>
          </>
        ) : null}
      </div>
      <p className="truncate px-2 pb-1 text-[11px] leading-4 text-muted">
        {atEnd && ready
          ? "Kéo về quá khứ để ẩn nến sau con trỏ, rồi bấm phát."
          : playing
            ? `Đang phát ${speed}×. Space tạm dừng, mũi tên bước từng nến.`
            : "Space phát hoặc dừng · mũi tên bước nến · bản vẽ lưu trên máy này."}
      </p>
    </footer>
  );
}

function DockButton({
  children,
  label,
  pressed,
  disabled,
  onClick,
}: {
  children: ReactNode;
  label: string;
  pressed?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex size-8 shrink-0 items-center justify-center rounded-sm border disabled:opacity-40 ${
        pressed ? "border-accent bg-accent text-accent-fg" : "border-border text-fg hover:bg-surface-2"
      }`}
    >
      {children}
    </button>
  );
}

function SpeedButton({ speed, active, onClick }: { speed: Speed; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`inline-flex h-8 shrink-0 items-center rounded-sm px-2 font-mono text-xs tabular-nums ${
        active ? "bg-surface-2 text-accent" : "text-muted hover:text-fg"
      }`}
    >
      {speed}×
    </button>
  );
}
