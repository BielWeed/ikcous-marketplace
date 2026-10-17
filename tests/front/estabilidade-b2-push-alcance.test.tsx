// @vitest-environment jsdom
import { AdminPushView } from "@/views/admin/AdminPushView";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "admin-1" } }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { realTimeSalesAlerts: false },
    isLoaded: true,
    updateConfig: vi.fn(),
  }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/hooks/usePushNotifications", () => ({
  usePushNotifications: () => ({ isSupported: false, subscribe: vi.fn() }),
}));
vi.mock("@/hooks/useVOR", () => ({
  useVOR: () => ({ recordAction: vi.fn() }),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: h.rpc,
    from: (tabela: string) =>
      tabela === "push_subscriptions"
        ? { select: () => Promise.resolve({ count: 8, error: null }) }
        : {
            select: () => ({
              order: () => ({
                limit: () => Promise.resolve({ data: [], error: null }),
              }),
              eq: () => ({
                order: () => Promise.resolve({ data: [], error: null }),
              }),
            }),
          },
    functions: { invoke: vi.fn() },
  },
}));
// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
class Observador {
  observe() {}
  unobserve() {}
  disconnect() {}
}
let raiz: Root;
let hospedeiro: HTMLDivElement;
function pendente() {
  let resolver!: (r: { data: number | null; error: unknown }) => void;
  let rejeitar!: (e: Error) => void;
  const promessa = new Promise((resolve, reject) => {
    resolver = resolve;
    rejeitar = reject;
  });
  return { promessa, resolver, rejeitar };
}
beforeEach(async () => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  h.rpc.mockResolvedValue({ data: 2, error: null });
  const armazem = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => armazem.get(k) ?? null,
    setItem: (k: string, v: string) => {
      armazem.set(k, v);
    },
    removeItem: (k: string) => {
      armazem.delete(k);
    },
  });
  vi.stubGlobal("ResizeObserver", Observador);
  vi.stubGlobal("IntersectionObserver", Observador);
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  }));
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
  await act(async () => {
    raiz.render(<AdminPushView onNavigate={vi.fn()} />);
  });
});
afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function publico(rotulo: string) {
  const botao = Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
    b.textContent?.includes(rotulo),
  );
  expect(botao).toBeTruthy();
  await act(async () => {
    botao!.click();
  });
}

it("uma contagem antiga não aparece durante a medição do público atual", async () => {
  const vip = pendente();
  const novos = pendente();
  h.rpc.mockReturnValueOnce(vip.promessa).mockReturnValueOnce(novos.promessa);
  await publico("Gastaram R$ 150+");
  await publico("Novos em 7 dias");
  expect(hospedeiro.textContent).toContain("Receberão: — aparelhos");
  await act(async () => {
    vip.resolver({ data: 31, error: null });
  });
  expect(hospedeiro.textContent).toContain("Receberão: — aparelhos");
  expect(hospedeiro.textContent).not.toContain("Receberão: 31 aparelhos");
  await act(async () => {
    novos.resolver({ data: 5, error: null });
  });
  expect(hospedeiro.textContent).toContain("Receberão: 5 aparelhos");
});

it.each([false, true])(
  "uma consulta superada não sobrescreve o número atual (erro=%s)",
  async (falhar) => {
    const vip = pendente();
    h.rpc
      .mockReturnValueOnce(vip.promessa)
      .mockResolvedValueOnce({ data: 5, error: null });
    await publico("Gastaram R$ 150+");
    await publico("Novos em 7 dias");
    expect(hospedeiro.textContent).toContain("Receberão: 5 aparelhos");
    await act(async () => {
      if (falhar) vip.rejeitar(new Error("rede"));
      else vip.resolver({ data: 31, error: null });
    });
    expect(hospedeiro.textContent).toContain("Receberão: 5 aparelhos");
  },
);

it("voltar para Todos invalida a consulta anterior mesmo voltando depois ao mesmo segmento", async () => {
  const vip = pendente();
  h.rpc.mockReturnValueOnce(vip.promessa);
  await publico("Gastaram R$ 150+");
  await publico("Todos os clientes");
  const atual = pendente();
  h.rpc.mockReturnValueOnce(atual.promessa);
  await publico("Gastaram R$ 150+");
  await act(async () => {
    vip.resolver({ data: 31, error: null });
  });
  expect(hospedeiro.textContent).toContain("Receberão: — aparelhos");
  await act(async () => {
    atual.resolver({ data: 2, error: null });
  });
  expect(hospedeiro.textContent).toContain("Receberão: 2 aparelhos");
});
