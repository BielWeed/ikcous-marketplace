// @vitest-environment jsdom
import { useProducts } from "@/hooks/useProducts";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Resposta = { data: Record<string, unknown> | null; error: Error | null };
const banco = vi.hoisted(() => ({
  gravar: vi.fn<() => Promise<Resposta>>(),
  usuario: "lojista-1",
}));
const produto = {
  id: "p1",
  nome: "Camiseta",
  descricao: "",
  preco_venda: 50,
  custo: null,
  estoque: 3,
  ativo: true,
  categoria: "Geral",
  imagem_urls: [],
  ultima_atualizacao: "2026-11-10T10:00:00+00:00",
};
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ isAdmin: true, user: { id: banco.usuario } }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    products: [],
    loadingProducts: false,
    fetchProducts: vi.fn().mockResolvedValue(undefined),
  }),
}));
vi.mock("@/hooks/useAnalytics", () => ({ clearAnalyticsCache: vi.fn() }));
vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  },
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: null } }) },
    rpc: () => ({
      abortSignal: async () => ({
        data: { data: [produto], total_count: 1 },
        error: null,
      }),
    }),
    from: () => ({
      update: () => {
        const consulta = {
          eq: () => consulta,
          is: () => consulta,
          select: () => consulta,
          single: () => banco.gravar(),
        };
        return consulta;
      },
    }),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let api: ReturnType<typeof useProducts>;
function Sonda() {
  const hook = useProducts({ autoFetch: false });
  useEffect(() => {
    api = hook;
  });
  return null;
}

function pendente() {
  let resolver!: (resposta: Resposta) => void;
  const promessa = new Promise<Resposta>((resolve) => {
    resolver = resolve;
  });
  return { promessa, resolver };
}
const ativo = () => api.products.find((p) => p.id === "p1")?.isActive;

describe("pausar produto: toque duplo não desincroniza", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  beforeEach(async () => {
    vi.clearAllMocks();
    banco.gravar.mockReset();
    banco.usuario = "lojista-1";
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("navigator", { onLine: true });
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    await act(async () => raiz.render(<Sonda />));
    await act(async () => {
      await api.loadProducts(0, 10);
    });
    expect(ativo()).toBe(true);
  });
  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each([true, false])(
    "ignora segundo toque (status recebido: %s) e mantém ativo quando a gravação falha",
    async (statusDoSegundoToque) => {
      const primeira = pendente();
      const segunda = pendente();
      banco.gravar
        .mockReturnValueOnce(primeira.promessa)
        .mockReturnValueOnce(segunda.promessa);
      let resultadoPrimeiro!: Promise<unknown>;
      let resultadoSegundo!: Promise<unknown>;
      act(() => {
        resultadoPrimeiro = api.toggleProductStatus("p1", true).catch((e) => e);
      });
      expect(ativo()).toBe(false);
      act(() => {
        resultadoSegundo = api
          .toggleProductStatus("p1", statusDoSegundoToque)
          .catch((e) => e);
      });
      let segundo: unknown;
      await act(async () => {
        primeira.resolver({ data: null, error: new Error("primeira falha") });
        await resultadoPrimeiro;
        segunda.resolver({ data: null, error: new Error("segunda falha") });
        segundo = await resultadoSegundo;
      });
      expect(ativo()).toBe(true);
      expect(segundo).toBe(false);
      expect(banco.gravar).toHaveBeenCalledTimes(1);
      expect(toast.error).toHaveBeenCalledTimes(1);
    },
  );

  it("libera após sucesso e aceita novo toque normalmente", async () => {
    banco.gravar
      .mockResolvedValueOnce({
        data: { ...produto, ativo: false },
        error: null,
      })
      .mockResolvedValueOnce({ data: produto, error: null });
    await act(async () => {
      expect(await api.toggleProductStatus("p1", true)).toBeTruthy();
    });
    expect(ativo()).toBe(false);
    await act(async () => {
      expect(await api.toggleProductStatus("p1", false)).toBeTruthy();
    });
    expect(ativo()).toBe(true);
    expect(banco.gravar).toHaveBeenCalledTimes(2);
  });

  it("preserva a exceção e libera a trava após falha", async () => {
    const erro = new Error("sem conexão com o servidor");
    banco.gravar.mockRejectedValueOnce(erro).mockResolvedValueOnce({
      data: { ...produto, ativo: false },
      error: null,
    });
    await act(async () => {
      await expect(api.toggleProductStatus("p1", true)).rejects.toBe(erro);
    });
    expect(ativo()).toBe(true);
    await act(async () => {
      expect(await api.toggleProductStatus("p1", true)).toBeTruthy();
    });
    expect(ativo()).toBe(false);
    expect(banco.gravar).toHaveBeenCalledTimes(2);
  });

  it("libera após retorno falsy sem perder o rollback", async () => {
    banco.usuario = "";
    vi.stubGlobal("navigator", { onLine: false });
    await act(async () => raiz.render(<Sonda />));
    await act(async () => {
      expect(await api.toggleProductStatus("p1", true)).toBeFalsy();
    });
    expect(ativo()).toBe(true);
    vi.stubGlobal("navigator", { onLine: true });
    banco.gravar.mockResolvedValue({
      data: { ...produto, ativo: false },
      error: null,
    });
    await act(async () => {
      expect(await api.toggleProductStatus("p1", true)).toBeTruthy();
    });
    expect(ativo()).toBe(false);
    expect(banco.gravar).toHaveBeenCalledTimes(1);
  });
});
