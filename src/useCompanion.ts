import { useEffect, useRef, useState } from "react";
import { playPetSound } from "./audio";
import { getBridge } from "./bridge";
import type { AppSnapshot } from "./shared/types";

export const bridge = getBridge();

export function useCompanion(): AppSnapshot | null {
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null);
  const settingsRef = useRef<AppSnapshot["settings"] | null>(null);

  useEffect(() => {
    let active = true;
    void bridge.getSnapshot().then((next) => {
      if (!active) return;
      settingsRef.current = next.settings;
      setSnapshot(next);
    });
    const stopSnapshot = bridge.onSnapshot((next) => {
      settingsRef.current = next.settings;
      setSnapshot(next);
    });
    const stopSound = bridge.onSound((sound) => {
      const settings = settingsRef.current;
      if (settings?.soundEnabled) playPetSound(sound, settings.volume);
    });
    return () => {
      active = false;
      stopSnapshot();
      stopSound();
    };
  }, []);

  return snapshot;
}
