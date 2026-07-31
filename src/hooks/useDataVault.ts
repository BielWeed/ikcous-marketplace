/**
 * React hook utilities for subscribing to RealtimeSyncEngine sync events.
 */

import type { StoreName } from "@/lib/dataVault";
import { RealtimeSyncEngine, type SyncEvent } from "@/lib/realtimeSyncEngine";
import { useEffect, useRef } from "react";

// ─── Utility: Subscribe to sync events from React ────────────────────────────

/**
 * React hook to listen for realtime sync events on specific stores.
 * Re-renders the component when a matching event occurs.
 *
 * @param stores - Store names to listen for
 * @param callback - Called with the sync event
 */
export function useSyncListener(
  stores: StoreName[],
  callback: (event: SyncEvent) => void,
): void {
  const callbackRef = useRef(callback);
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    const unsubscribe = RealtimeSyncEngine.onSync((event) => {
      if (stores.includes(event.store)) {
        callbackRef.current(event);
      }
    });

    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stores.join(",")]);
}
