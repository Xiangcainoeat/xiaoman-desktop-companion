import { ControlCenter } from "./components/ControlCenter";
import { Overlay } from "./components/Overlay";

export function App() {
  const view = new URLSearchParams(window.location.search).get("view") ?? "center";
  return view === "overlay" ? <Overlay /> : <ControlCenter />;
}
