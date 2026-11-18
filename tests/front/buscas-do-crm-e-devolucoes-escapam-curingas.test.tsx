// @vitest-environment jsdom
import { useCrmClientes } from "@/hooks/useCrm";
import { useDevolucoesAdmin } from "@/hooks/useDevolucoesAdmin";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc } }));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ session: { user: { id: "admin-teste" } } }),
}));
vi.mock("@/hooks/useAnalytics", () => ({ useAnalytics: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

function Clientes({ busca }: { busca: string }) {
  useCrmClientes({
    segmento: null,
    busca,
    pagina: 0,
    porPagina: 20,
    active: true,
  });
  return null;
}

function Devolucoes({ busca }: { busca: string }) {
  useDevolucoesAdmin({ status: null, busca });
  return null;
}

describe.each([
  ["crm_clientes", Clientes],
  ["admin_devolucoes_listar", Devolucoes],
] as const)("%s — texto literal enviado à RPC", (nome, Sonda) => {
  let host: HTMLDivElement;
  let raiz: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    rpc.mockReset();
    rpc.mockResolvedValue({
      data: { total: 0, clientes: [], itens: [], contagem: {} },
      error: null,
    });
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    host.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it.each([
    ["50%", "50\\%"],
    ["a_b", "a\\_b"],
    ["  Maria  Silva  ", "Maria Silva"],
    ["", null],
    ["   ", null],
  ])(
    "prepara %j sem transformar a busca em curinga",
    async (busca, esperado) => {
      await act(async () => raiz.render(<Sonda busca={busca} />));
      await act(async () => vi.advanceTimersByTimeAsync(150));
      expect(rpc).toHaveBeenCalledExactlyOnceWith(
        nome,
        expect.objectContaining({ p_busca: esperado }),
      );
    },
  );
});
