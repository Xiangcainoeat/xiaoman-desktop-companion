import { useEffect, useState } from "react";
import { getDefaultSocialClient, type SocialClient, type SocialClientSnapshot } from "./client";

export interface SocialClientHookResult {
  client: SocialClient;
  snapshot: SocialClientSnapshot;
}

export function useSocialClient(client: SocialClient = getDefaultSocialClient()): SocialClientHookResult {
  const [snapshot, setSnapshot] = useState<SocialClientSnapshot>(() => client.getSnapshot());

  useEffect(() => {
    let active = true;
    setSnapshot(client.getSnapshot());
    const stop = client.subscribe((next) => {
      if (active) setSnapshot(next);
    });
    void client.initialize();
    return () => {
      active = false;
      stop();
    };
  }, [client]);

  return { client, snapshot };
}
