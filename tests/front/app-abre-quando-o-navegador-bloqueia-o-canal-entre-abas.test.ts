// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { initSentinel } from "@/pwa-sentinel";

const canalRemoto = vi.hoisted(() => ({
  on: vi.fn(),
  subscribe: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    channel: () => canalRemoto,
    removeChannel: () => Promise.resolve(),
  },
}));

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "BroadcastChannel",
    class {
      constructor() {
        throw new DOMException("x", "SecurityError");
      }
    },
  );
  vi.resetModules();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.doUnmock("@/hooks/useLeaderElection");
  vi.useRealTimers();
});

async function abrirTela(Tela: () => ReturnType<typeof createElement>) {
  const host = document.createElement("div");
  const raiz = createRoot(host);
  try {
    await act(async () => raiz.render(createElement(Tela)));
    return host.textContent;
  } finally {
    await act(async () => raiz.unmount());
  }
}

it("a loja abre e esta aba pode manter sua própria conexão", async () => {
  const { useLeaderElection } = await import("@/hooks/useLeaderElection");

  const tela = await abrirTela(function Tela() {
    const { isLeader } = useLeaderElection();
    return createElement(
      "p",
      null,
      isLeader ? "Loja aberta" : "Aguardando aba",
    );
  });

  expect(tela).toBe("Loja aberta");
});

it("o monitoramento da loja instalada inicia e consulta o service worker direto", () => {
  const postMessage = vi.fn();
  const serviceWorker = Object.assign(new EventTarget(), {
    controller: { postMessage },
  });
  vi.stubGlobal("navigator", { serviceWorker });
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");

  expect(() => initSentinel()).not.toThrow();
  vi.advanceTimersByTime(30_000);

  expect(postMessage).toHaveBeenCalledWith("HEARTBEAT_PING");
});

it("o painel já conectado abre e continua ouvindo atualizações", async () => {
  // Isola a abertura deste canal da abertura da eleição, provada acima.
  vi.doMock("@/hooks/useLeaderElection", () => ({
    useLeaderElection: () => ({ isLeader: true }),
  }));
  const { useRealtimeUpdate } = await import("@/hooks/useRealtimeUpdate");
  const avisar = vi.fn();
  canalRemoto.on.mockImplementation(() => canalRemoto);
  const host = document.createElement("div");
  const raiz = createRoot(host);
  try {
    await act(async () => {
      raiz.render(
        createElement(function Painel() {
          useRealtimeUpdate(avisar, "conta-de-teste");
          return createElement("p", null, "Painel aberto");
        }),
      );
    });
    expect(host.textContent).toBe("Painel aberto");

    vi.advanceTimersByTime(400);
    expect(canalRemoto.on).toHaveBeenCalledWith(
      "broadcast",
      { event: "deploy-ping" },
      expect.any(Function),
    );
    const receberPing = canalRemoto.on.mock.lastCall?.[2];
    receberPing({ payload: { version: "1.5.220" } });
    expect(avisar).toHaveBeenCalledWith("1.5.220");
  } finally {
    await act(async () => raiz.unmount());
  }
});
