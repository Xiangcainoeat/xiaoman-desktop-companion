import { ControlCenter } from "./components/ControlCenter";
import { QuickActionsView, parseQuickViewMode } from "./components/QuickActionsView";
import { Overlay } from "./components/Overlay";

export function QuickRouteError() {
  return (
    <main className="quick-root quick-route-error">
      <span className="eyebrow">小满 · 快捷窗口</span>
      <h1>暂时无法打开</h1>
      <p>请从桌宠侧边栏重新选择一个快捷功能。</p>
    </main>
  );
}

export function App() {
  const params = new URLSearchParams(window.location.search);
  const view = params.get("view") ?? "center";
  if (view === "overlay") return <Overlay />;
  if (view === "quick") {
    const mode = parseQuickViewMode(params.get("mode"));
    return mode ? <QuickActionsView mode={mode} /> : <QuickRouteError />;
  }
  return <ControlCenter />;
}
