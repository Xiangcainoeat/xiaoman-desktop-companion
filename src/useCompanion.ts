import { useEffect, useRef, useState } from "react";
import { playPetSound } from "./audio";
import { getBridge } from "./bridge";
import { createBundledPetPackRuntime } from "./pet-pack/runtime";
import type { AppSnapshot, PetPackRuntime } from "./shared/types";

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

/** Subscribe once per sprite host to the active pack and keep a built-in fallback. */
export function usePetPackRuntime(): PetPackRuntime {
  const [runtime, setRuntime] = useState<PetPackRuntime>(() => createBundledPetPackRuntime());

  useEffect(() => {
    let active = true;
    void bridge.getPetPackRuntime().then((next) => {
      if (active) setRuntime(next);
    }).catch(() => undefined);
    const stop = bridge.onPetPackChanged((next) => {
      if (active) setRuntime(next);
    });
    return () => {
      active = false;
      stop();
    };
  }, []);

  return runtime;
}
