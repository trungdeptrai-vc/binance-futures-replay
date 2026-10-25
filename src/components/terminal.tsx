import { useEffect } from "react";
import { ChartStage } from "@/components/chart-stage";
import { Overlays } from "@/components/overlays";
import { ReplayDock } from "@/components/replay-dock";
import { TopBar } from "@/components/top-bar";
import { useTerminal } from "@/lib/store";

export function Terminal() {
  const hydrate = useTerminal((s) => s.hydrate);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA";
      if (typing) return;
      const state = useTerminal.getState();
      if (event.key === " " || event.code === "Space") {
        event.preventDefault();
        state.togglePlay();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        state.step(event.shiftKey ? 10 : 1);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        state.step(event.shiftKey ? -10 : -1);
      } else if (event.key === "Escape") {
        state.setTool("cursor");
        state.selectLine(null);
      } else if ((event.key === "Delete" || event.key === "Backspace") && state.selectedId) {
        event.preventDefault();
        state.deleteSelected();
      } else if ((event.key === "z" || event.key === "Z") && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        state.undoLine();
      } else if (event.key === "t" || event.key === "T") {
        state.setTool(state.tool === "trend" ? "cursor" : "trend");
      } else if (event.key === "r" || event.key === "R") {
        state.setTool(state.tool === "rect" ? "cursor" : "rect");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <main className="flex h-dvh flex-col overflow-hidden bg-bg text-fg">
      <TopBar />
      <div className="chart-slot">
        <div className="chart-frame">
          <ChartStage />
        </div>
      </div>
      <ReplayDock />
      <Overlays />
    </main>
  );
}
