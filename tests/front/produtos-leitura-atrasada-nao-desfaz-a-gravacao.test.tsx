// @vitest-environment jsdom
//
// A lojista pausa um produto e vê "Produto atualizado!", mas o cartão volta a
// "Ativo": uma leitura da lista que saiu ANTES da gravação chegou DEPOIS dela
// e foi aplicada por cima. O banco está certo; a lista na tela, errada. A
// guarda antiga só descartava leitura ultrapassada por OUTRA leitura; pausar
// não dispara leitura nova, então nada ultrapassava a antiga.
import { useProducts } from "@/hooks/useProducts";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Linha = Record<string, unknown>;
type Resposta = { data: Linha | Linha[] | null; error: Error | null };
const banco = vi.hoisted(() => ({
  ler: vi.fn<() => Promise<Resposta>>(),
  gravar: vi.fn<() => Promise<Resposta>>(),
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
  useAuth: () => ({ isAdmin: true, user: { id: "lojista-1" } }),
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
    rpc: () => ({ abortSignal: () => banco.ler() }),
    from: () => ({
      update: () => {
        const consulta = {
          eq: () => consulta,
          is: () => consulta,
          // `select("id")` (exclusão) já espera as linhas afetadas.
          select: (colunas: string) =>
            colunas === "id" ? banco.gravar() : consulta,
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
const lista = (...linhas: Linha[]): Resposta => ({
  data: { data: linhas, total_count: linhas.length },
  error: null,
});
const ativo = () => api.products.find((p) => p.id === "p1")?.isActive;
const ids = () => api.products.map((p) => p.id);

describe("lista de produtos: leitura atrasada não desfaz o que a gravação fez", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  beforeEach(async () => {
    vi.clearAllMocks();
    banco.ler.mockReset();
    banco.gravar.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("navigator", { onLine: true });
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    banco.ler.mockResolvedValue(lista(produto));
    await act(async () => raiz.render(<Sonda />));
    await act(async () => {
      await api.loadProducts(0, 10);
    });
    expect(ativo()).toBe(true);
    banco.ler.mockClear();
  });
  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("pausar: a leitura que saiu antes e chega depois não devolve 'Ativo'", async () => {
    const velha = pendente();
    banco.ler.mockReturnValueOnce(velha.promessa);
    let leitura!: Promise<unknown>;
    act(() => {
      leitura = api.loadProducts(0, 10);
    });
    banco.gravar.mockResolvedValue({
      data: { ...produto, ativo: false },
      error: null,
    });
    await act(async () => {
      expect(await api.toggleProductStatus("p1", true)).toBeTruthy();
    });
    expect(ativo()).toBe(false);

    // O banco já está pausado: a leitura nova (a releitura) devolve isso.
    banco.ler.mockResolvedValue(lista({ ...produto, ativo: false }));
    await act(async () => {
      velha.resolver(lista(produto));
      await leitura;
    });

    expect(ativo()).toBe(false);
    // A resposta antiga foi descartada e a lista foi relida uma vez.
    expect(banco.ler).toHaveBeenCalledTimes(2);
  });

  it("leitura que começou DURANTE a gravação e chega depois do fim também é descartada", async () => {
    const gravacao = pendente();
    banco.gravar.mockReturnValueOnce(gravacao.promessa);
    let resultado!: Promise<unknown>;
    act(() => {
      resultado = api.toggleProductStatus("p1", true);
    });
    const velha = pendente();
    banco.ler.mockReturnValueOnce(velha.promessa);
    let leitura!: Promise<unknown>;
    act(() => {
      leitura = api.loadProducts(0, 10);
    });
    await act(async () => {
      gravacao.resolver({ data: { ...produto, ativo: false }, error: null });
      await resultado;
    });
    expect(ativo()).toBe(false);

    banco.ler.mockResolvedValue(lista({ ...produto, ativo: false }));
    await act(async () => {
      velha.resolver(lista(produto));
      await leitura;
    });

    expect(ativo()).toBe(false);
    expect(banco.ler).toHaveBeenCalledTimes(2);
  });

  it("excluir: a leitura antiga não traz de volta o produto excluído", async () => {
    const velha = pendente();
    banco.ler.mockReturnValueOnce(velha.promessa);
    let leitura!: Promise<unknown>;
    act(() => {
      leitura = api.loadProducts(0, 10);
    });
    banco.gravar.mockResolvedValue({ data: [{ id: "p1" }], error: null });
    await act(async () => {
      expect(await api.deleteProduct("p1")).toBe(true);
    });
    expect(ids()).toEqual([]);

    banco.ler.mockResolvedValue(lista());
    await act(async () => {
      velha.resolver(lista(produto));
      await leitura;
    });

    expect(ids()).toEqual([]);
  });

  it("controle: sem gravação no meio, a leitura é aplicada e não há releitura", async () => {
    banco.ler.mockResolvedValue(
      lista({ ...produto, nome: "Camiseta nova" }, { ...produto, id: "p2" }),
    );
    await act(async () => {
      await api.loadProducts(0, 10);
    });
    expect(ids()).toEqual(["p1", "p2"]);
    expect(api.products[0].name).toBe("Camiseta nova");
    expect(banco.ler).toHaveBeenCalledTimes(1);
  });

  it("controle: leitura que começa depois da gravação terminar é aplicada sem releitura", async () => {
    banco.gravar.mockResolvedValue({
      data: { ...produto, ativo: false },
      error: null,
    });
    await act(async () => {
      await api.toggleProductStatus("p1", true);
    });
    banco.ler.mockResolvedValue(lista({ ...produto, ativo: false }));
    await act(async () => {
      await api.loadProducts(0, 10);
    });
    expect(ativo()).toBe(false);
    expect(banco.ler).toHaveBeenCalledTimes(1);
  });
});
