import { useEffect, useRef, useCallback, useState } from 'react';

const LEADER_KEY = 'pwa_leader_tab';
const LEADER_TTL = 5000; // 5s heartbeat
const TAB_ID = Math.random().toString(36).slice(2, 8);

/**
 * useLeaderElection v17.0
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

    const updateLeadership = useCallback((val: boolean) => {
        if (isLeaderRef.current !== val) {
            isLeaderRef.current = val;
            setIsLeader(val);
            console.log(`[LeaderElection] Tab ${TAB_ID} leadership state changed to:`, val);
        }
    }, []);

    const claimLeadership = useCallback(() => {
        try {
            const existing = JSON.parse(localStorage.getItem(LEADER_KEY) || 'null');
            const now = Date.now();
            // Claim if no leader or TTL expired
            if (!existing || (now - existing.ts) > LEADER_TTL) {
                localStorage.setItem(LEADER_KEY, JSON.stringify({ tabId: TAB_ID, ts: now }));
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
            localStorage.setItem(LEADER_KEY, JSON.stringify({ tabId: TAB_ID, ts: Date.now() }));
        } catch { /* silent */ }
    }, []);

    const resignLeadership = useCallback(() => {
        if (!isLeaderRef.current) return;
        try {
            localStorage.removeItem(LEADER_KEY);
            updateLeadership(false);
        } catch { /* silent */ }
    }, [updateLeadership]);

    useEffect(() => {
        // Try to claim leadership on mount
        claimLeadership();

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
        const onUnload = () => resignLeadership();
        window.addEventListener('beforeunload', onUnload);
        
        const handleVisibility = () => {
            if (document.visibilityState === 'hidden') {
                resignLeadership();
            } else {
                claimLeadership();
            }
        };
        document.addEventListener('visibilitychange', handleVisibility);

        return () => {
            if (heartbeatRef.current) clearInterval(heartbeatRef.current);
            window.removeEventListener('beforeunload', onUnload);
            document.removeEventListener('visibilitychange', handleVisibility);
            resignLeadership();
        };
    }, [claimLeadership, refreshLeadership, resignLeadership]);

    return {
        isLeader,
        tabId: TAB_ID,
    };
}
