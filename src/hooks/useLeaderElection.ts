import { useEffect, useRef, useCallback } from 'react';

const LEADER_KEY = 'pwa_leader_tab';
const LEADER_TTL = 5000; // 5s heartbeat
const TAB_ID = Math.random().toString(36).slice(2, 8);

/**
 * useLeaderElection v16.0
 * Prevents N tabs from all triggering SW updates simultaneously.
 * Only the "leader" tab performs SW update/reload operations.
 *
 * Uses localStorage + BroadcastChannel for coordination.
 * Leader expires after LEADER_TTL without heartbeat.
 */
export function useLeaderElection() {
    const isLeaderRef = useRef(false);
    const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const claimLeadership = useCallback(() => {
        try {
            const existing = JSON.parse(localStorage.getItem(LEADER_KEY) || 'null');
            const now = Date.now();
            // Claim if no leader or TTL expired
            if (!existing || (now - existing.ts) > LEADER_TTL) {
                localStorage.setItem(LEADER_KEY, JSON.stringify({ tabId: TAB_ID, ts: now }));
                isLeaderRef.current = true;
                return true;
            }
            isLeaderRef.current = existing.tabId === TAB_ID;
            return isLeaderRef.current;
        } catch {
            return false;
        }
    }, []);

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
            isLeaderRef.current = false;
        } catch { /* silent */ }
    }, []);

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
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') resignLeadership();
            else claimLeadership();
        });

        return () => {
            if (heartbeatRef.current) clearInterval(heartbeatRef.current);
            window.removeEventListener('beforeunload', onUnload);
            resignLeadership();
        };
    }, [claimLeadership, refreshLeadership, resignLeadership]);

    return {
        isLeader: () => isLeaderRef.current,
        tabId: TAB_ID,
    };
}
