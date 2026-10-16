// @vitest-environment jsdom
import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

const rede = vi.hoisted(() => ({
  canal: vi.fn(),
  remover: vi.fn(async () => {}),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: { channel: rede.canal, removeChannel: rede.remover },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => {
  vi.useRealTimers();
  window.localStorage.removeItem("pwa_leader_tab");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("sem BroadcastChannel importa, lidera e recebe o ping remoto sem broadcast local", async () => {
  vi.stubGlobal("BroadcastChannel", undefined);
  vi.useFakeTimers();
  vi.spyOn(console, "log").mockImplementation(() => {});
  // Um líder antigo no storage não pode deixar esta aba sem conexão própria.
  localStorage.setItem(
    "pwa_leader_tab",
    JSON.stringify({ tabId: "outra", ts: Date.now() }),
  );
  const { useLeaderElection } = await import("@/hooks/useLeaderElection");
  const { useRealtimeUpdate } = await import("@/hooks/useRealtimeUpdate");
  const retorno = vi.fn();
  let receber!: (dados: { payload: { version: string } }) => void;
  const canal = {
    on: vi.fn((_tipo: string, _filtro: unknown, callback: typeof receber) => {
      receber = callback;
      return canal;
    }),
    subscribe: vi.fn(() => canal),
  };
  rede.canal.mockReturnValue(canal);
  let lider = false;
  function Sonda() {
    const { isLeader } = useLeaderElection();
    useEffect(() => {
      lider = isLeader;
    });
    useRealtimeUpdate(retorno);
    return null;
  }
  const host = document.createElement("div");
  document.body.appendChild(host);
  const raiz = createRoot(host);
  try {
    act(() => raiz.render(<Sonda />));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(lider).toBe(true);
    expect(rede.canal).toHaveBeenCalledWith("pwa-system-signals");
    act(() => receber({ payload: { version: "1.5.32" } }));
    expect(retorno).toHaveBeenCalledWith("1.5.32");
  } finally {
    act(() => raiz.unmount());
    host.remove();
  }
  expect(rede.remover).toHaveBeenCalledWith(canal);
});
