import { useSyncExternalStore } from "react";

type Session = { user: { id: string }; access_token: string };
let current = {
  active: true,
  user: { id: "" },
  session: null as Session | null,
  isAdmin: true,
  adminStatus: "admin",
  config: { businessHours: "Fixture inicial", shippingFee: 1 },
  refreshes: 0,
  dirty: false,
};
const listeners = new Set<() => void>();
function publish() { for (const listener of listeners) listener(); }
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function setFixtureContext(patch: Partial<typeof current>) {
  current = { ...current, ...patch };
  publish();
}
export function useFixtureContext() {
  return useSyncExternalStore(subscribe, () => current);
}
export function useAuth() { return useFixtureContext(); }
const refresh = async () => {
  setFixtureContext({ refreshes: current.refreshes + 1 });
};
export function useStore() {
  const state = useFixtureContext();
  return { config: state.config, refresh, isLoaded: true };
}
export function recordDirty(dirty: boolean) {
  if (current.dirty !== dirty) setFixtureContext({ dirty });
}
