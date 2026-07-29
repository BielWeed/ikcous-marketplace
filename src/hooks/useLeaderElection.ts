import { useCallback, useEffect, useRef, useState } from "react";

const LEADER_KEY = "pwa_leader_tab";
const LEADER_TTL = 5000; // 5s heartbeat
const TAB_ID = Math.random().toString(36).slice(2, 8);

// Shared BroadcastChannel singleton to prevent multiple instances and closure errors on HMR/re-renders
const bc =
  typeof window !== "undefined"
    ? new BroadcastChannel("ikcous_leader_coordination")
    : null;

/**
 * useLeaderElection v17.1
 * Prevents N tabs from all triggering SW updates or Supabase connections simultaneously.
 * Only the "leader" tab performs SW update/reload operations and holds database sockets.
 *
 * Uses localStorage + BroadcastChannel for coordination.
 * Leader expires after LEADER_TTL without heartbeat.
 */
export function useLeaderElection() {
  const [isLeader, setIsLeader] = useState(false);
  const isLeaderRef = useRef(false);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const resignTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updateLeadership = useCallback((val: boolean) => {
    if (isLeaderRef.current !== val) {
      isLeaderRef.current = val;
      setIsLeader(val);
      console.log(
        "[LeaderElection] Tab %s leadership state changed to:",
        TAB_ID,
        val,
      );
    }
  }, []);

  const claimLeadership = useCallback(() => {
    if (
      typeof document !== "undefined" &&
      document.visibilityState === "hidden"
    ) {
      if (!isLeaderRef.current) {
        updateLeadership(false);
        return false;
      }
    }
    try {
      const existing = JSON.parse(localStorage.getItem(LEADER_KEY) || "null");
      const now = Date.now();
      // Claim if no leader or TTL expired
      if (!existing || now - existing.ts > LEADER_TTL) {
        localStorage.setItem(
          LEADER_KEY,
          JSON.stringify({ tabId: TAB_ID, ts: now }),
        );
        updateLeadership(true);
        return true;
      }
      const active = existing.tabId === TAB_ID;
      updateLeadership(active);
      return active;
    } catch {
      updateLeadership(false);
      return false;
    }
  }, [updateLeadership]);

  const refreshLeadership = useCallback(() => {
    if (!isLeaderRef.current) return;
    try {
      const existing = JSON.parse(localStorage.getItem(LEADER_KEY) || "null");
      if (existing && existing.tabId === TAB_ID) {
        localStorage.setItem(
          LEADER_KEY,
          JSON.stringify({ tabId: TAB_ID, ts: Date.now() }),
        );
      } else {
        updateLeadership(false);
      }
    } catch {
      updateLeadership(false);
    }
  }, [updateLeadership]);

  const resignLeadership = useCallback(() => {
    if (!isLeaderRef.current) return;
    try {
      localStorage.removeItem(LEADER_KEY);
      updateLeadership(false);
    } catch {
      /* silent */
    }
  }, [updateLeadership]);

  useEffect(() => {
    if (!bc) return;
    let leaderAliveReceived = false;

    const handleMessage = (e: MessageEvent) => {
      const { type, tabId } = e.data || {};
      if (type === "LEADER_PING") {
        if (isLeaderRef.current) {
          bc.postMessage({ type: "LEADER_ALIVE", tabId: TAB_ID });
        }
      } else if (type === "LEADER_ALIVE") {
        if (tabId !== TAB_ID) {
          leaderAliveReceived = true;
          updateLeadership(false);
        }
      } else if (type === "LEADER_RESIGNED") {
        if (tabId !== TAB_ID) {
          // Try to claim immediately
          claimLeadership();
        }
      }
    };

    bc.addEventListener("message", handleMessage);

    // Ping on mount
    bc.postMessage({ type: "LEADER_PING", tabId: TAB_ID });

    // Wait 120ms to see if an active leader responds
    const pingTimeout = setTimeout(() => {
      if (!leaderAliveReceived) {
        claimLeadership();
      }
    }, 120);

    // Heartbeat: refresh leadership every 2.5s if leader
    heartbeatRef.current = setInterval(() => {
      if (isLeaderRef.current) {
        refreshLeadership();
      } else {
        // Try to claim leadership if it expired
        claimLeadership();
      }
    }, LEADER_TTL / 2);

    // Release on tab unload
    const onUnload = () => {
      if (isLeaderRef.current) {
        bc.postMessage({ type: "LEADER_RESIGNED", tabId: TAB_ID });
      }
      resignLeadership();
    };
    window.addEventListener("beforeunload", onUnload);

    let visibilityDebounceTimeout: ReturnType<typeof setTimeout> | null = null;

    const handleVisibility = () => {
      if (visibilityDebounceTimeout) {
        clearTimeout(visibilityDebounceTimeout);
      }
      visibilityDebounceTimeout = setTimeout(() => {
        if (document.visibilityState === "hidden") {
          if (resignTimeoutRef.current) clearTimeout(resignTimeoutRef.current);
          resignTimeoutRef.current = setTimeout(() => {
            if (isLeaderRef.current) {
              bc.postMessage({ type: "LEADER_RESIGNED", tabId: TAB_ID });
            }
            resignLeadership();
          }, 3000);
        } else {
          if (resignTimeoutRef.current) {
            clearTimeout(resignTimeoutRef.current);
            resignTimeoutRef.current = null;
          }
          bc.postMessage({ type: "LEADER_PING", tabId: TAB_ID });
          leaderAliveReceived = false;
          setTimeout(() => {
            if (!leaderAliveReceived) {
              claimLeadership();
            }
          }, 120);
        }
      }, 300);
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      bc.removeEventListener("message", handleMessage);
      clearTimeout(pingTimeout);
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
      if (resignTimeoutRef.current) {
        clearTimeout(resignTimeoutRef.current);
        resignTimeoutRef.current = null;
      }
      if (visibilityDebounceTimeout) {
        clearTimeout(visibilityDebounceTimeout);
      }
      window.removeEventListener("beforeunload", onUnload);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [claimLeadership, refreshLeadership, resignLeadership, updateLeadership]);

  return {
    isLeader,
    tabId: TAB_ID,
  };
}
