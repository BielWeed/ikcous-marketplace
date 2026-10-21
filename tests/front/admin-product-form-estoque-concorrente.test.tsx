// @vitest-environment jsdom
import { useProducts } from "@/hooks/useProducts";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const banco = vi.hoisted(() => ({
  produto: {} as Record<string, any>,
  variacoes: [] as Record<string, any>[],
  filtros: [] as Array<Array<[string, unknown]>>,
  gravacoes: 0,
  gravacoesDeVariacoes: 0,
  versao: 0,
  falharVariacoes: false,
  toastError: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ isAdmin: true, user: { id: "lojista-1" } }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    products: [],
    loadingProducts: false,
    fetchProducts: banco.refresh,
    config: { shippingCoverage: "national" },
  }),
}));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({
    categories: [{ id: "cat-1", name: "Geral", slug: "geral" }],
    addCategory: vi.fn(),
  }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/hooks/useAnalytics", () => ({ clearAnalyticsCache: vi.fn() }));
vi.mock("sonner", () => ({
  toast: {
    error: banco.toastError,
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  },
}));

function avancarVersao() {
  banco.produto.ultima_atualizacao = `2026-10-21T13:00:0${++banco.versao}.123456+00:00`;
}

// O dublê só grava quando TODOS os filtros do UPDATE casam, como no banco.
// Venda externa muda tanto o estoque quanto a versão; não há erro programado.
vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: null } }),
    },
    from: (tabela: string) => {
      if (tabela === "product_variants") {
        return {
          select: () => ({
            eq: async () => ({
              data: structuredClone(banco.variacoes),
              error: null,
            }),
          }),
          upsert: async (linhas: Record<string, any>[]) => {
            banco.gravacoesDeVariacoes++;
            if (banco.falharVariacoes) return { error: { code: "42501" } };
            for (const linha of linhas) {
              Object.assign(
                banco.variacoes.find((v) => v.id === linha.id)!,
                linha,
              );
            }
            avancarVersao();
            return { error: null };
          },
        };
      }
      if (tabela !== "vw_produtos_admin")
        throw new Error(`Tabela inesperada: ${tabela}`);
      return {
        select: () => {
          const consulta = {
            eq: () => consulta,
            is: () => consulta,
            single: async () => ({
              data: structuredClone(banco.produto),
              error: null,
            }),
            maybeSingle: async () => ({
              data: structuredClone(banco.produto),
              error: null,
            }),
          };
          return consulta;
        },
        update: (patch: Record<string, unknown>) => {
          const filtros: Array<[string, unknown]> = [];
          banco.filtros.push(filtros);
          const executar = async () => {
            const valoresAtuais = new Map(Object.entries(banco.produto));
            if (
              !filtros.every(
                ([campo, valor]) => valoresAtuais.get(campo) === valor,
              )
            ) {
              return { data: null, error: null };
            }
            banco.gravacoes++;
            Object.assign(banco.produto, patch);
            avancarVersao();
            return {
              data: structuredClone({
                ...banco.produto,
                product_variants: banco.variacoes,
              }),
              error: null,
            };
          };
          const consulta = {
            eq: (campo: string, valor: unknown) => {
              filtros.push([campo, valor]);
              return consulta;
            },
            select: () => consulta,
            single: executar,
            maybeSingle: executar,
          };
          return consulta;
        },
      };
    },
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let api: ReturnType<typeof useProducts>;
function SondaDoHook() {
  const produtos = useProducts({ autoFetch: false });
  useEffect(() => {
    api = produtos;
  });
  return null;
}

const navegar = vi.fn();
const marcarSujo = vi.fn();
let raiz: Root;
let host: HTMLDivElement;

async function digitar(id: string, valor: string) {
  const campo = document.getElementById(id) as HTMLInputElement;
  expect(campo).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(campo, valor);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 300));
  });
}
async function salvar() {
  await act(async () => {
    const botao = [...host.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Salvar",
    );
    expect(botao?.disabled).toBe(false);
    botao!.click();
    await new Promise((r) => setTimeout(r, 30));
  });
}
async function montar() {
  const { AdminProductFormView } = await import(
    "@/views/admin/AdminProductFormView"
  );
  await act(async () => {
    raiz.render(
      <AdminProductFormView
        productId="p-1"
        onNavigate={navegar}
        onSetDirty={marcarSujo}
      />,
    );
  });
}
async function editarVariacao() {
  await act(async () => {
    const linha = host.querySelector('[data-testid="variante-cadastrada"]');
    (
      linha?.closest("div.group")?.querySelector("button") as HTMLButtonElement
    ).click();
  });
  await digitar("variant-stock", "8");
  await act(async () => {
    const botao = [...document.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Salvar variação",
    );
    botao!.click();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  banco.produto = {
    id: "p-1",
    nome: "Camiseta",
    descricao: "Algodão",
    preco_venda: 50,
    estoque: 10,
    categoria: "Geral",
    ativo: true,
    imagem_urls: [],
    ultima_atualizacao: "2026-10-21T13:00:00.123456+00:00",
  };
  banco.variacoes = [];
  banco.filtros = [];
  banco.gravacoes = 0;
  banco.gravacoesDeVariacoes = 0;
  banco.versao = 0;
  banco.falharVariacoes = false;
  banco.refresh.mockResolvedValue(undefined);
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  vi.spyOn(console, "error").mockImplementation(() => {});
  localStorage.clear();
  host = document.createElement("div");
  document.body.appendChild(host);
  raiz = createRoot(host);
});
afterEach(() => {
  act(() => raiz.unmount());
  host.remove();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("salvar estoque confere a versão lida na abertura", () => {
  it("recusa estoque mexido após venda e avisa sem gravar produto nem variações", async () => {
    banco.variacoes = [
      {
        id: "v-1",
        product_id: "p-1",
        name: "Cor",
        value: "Rosa",
        stock_increment: 10,
        active: true,
      },
    ];
    await montar();
    await editarVariacao();
    banco.produto.estoque = 9;
    banco.variacoes[0].stock_increment = 9;
    avancarVersao();

    await salvar();

    expect(banco.gravacoes).toBe(0);
    expect(banco.gravacoesDeVariacoes).toBe(0);
    expect(banco.produto.estoque).toBe(9);
    expect(banco.toastError).toHaveBeenCalledWith(
      "O estoque deste produto mudou enquanto você editava (agora está 9). Confira e salve de novo.",
    );
  });

  it("duas gravações seguidas aceitam a versão devolvida pelo primeiro salvar", async () => {
    await act(async () => raiz.render(<SondaDoHook />));
    let primeira: Awaited<ReturnType<typeof api.updateProduct>>;
    await act(async () => {
      primeira = await api.updateProduct(
        "p-1",
        { stock: 8 },
        {
          baseUpdatedAt: banco.produto.ultima_atualizacao,
        },
      );
    });
    expect(primeira!.stock).toBe(8);
    const versao = primeira!.updatedAt;
    expect(versao).toBe(banco.produto.ultima_atualizacao);

    await act(async () => {
      const segunda = await api.updateProduct(
        "p-1",
        { stock: 7 },
        {
          baseUpdatedAt: versao,
        },
      );
      expect(segunda!.stock).toBe(7);
    });
    expect(banco.gravacoes).toBe(2);
    expect(banco.filtros[1]).toContainEqual(["ultima_atualizacao", versao]);
    expect(banco.toastError).not.toHaveBeenCalled();
  });

  it("produto sem variação também recusa a contagem que ficou velha", async () => {
    await montar();
    await digitar("product-stock", "8");
    banco.produto.estoque = 9;
    avancarVersao();
    await salvar();
    expect(banco.gravacoes).toBe(0);
    expect(banco.produto.estoque).toBe(9);
    expect(banco.toastError).toHaveBeenCalledWith(
      "O estoque deste produto mudou enquanto você editava (agora está 9). Confira e salve de novo.",
    );
  });

  it("atualiza a versão após gravar o produto, mesmo quando precisa tentar a grade de novo", async () => {
    banco.variacoes = [
      {
        id: "v-1",
        product_id: "p-1",
        name: "Cor",
        value: "Rosa",
        stock_increment: 10,
        active: true,
      },
    ];
    await montar();
    await editarVariacao();
    banco.falharVariacoes = true;
    await salvar();
    expect(banco.gravacoes).toBe(1);
    const versaoDoPrimeiroSalvar = banco.produto.ultima_atualizacao;

    banco.falharVariacoes = false;
    await salvar();

    expect(banco.gravacoes).toBe(2);
    expect(banco.filtros[1]).toContainEqual([
      "ultima_atualizacao",
      versaoDoPrimeiroSalvar,
    ]);
    expect(banco.variacoes[0].stock_increment).toBe(8);
  });

  it("grava estoque mexido se a versão ainda é a da abertura, sem perder microssegundos", async () => {
    await montar();
    await digitar("product-stock", "8");
    await salvar();
    expect(banco.produto.estoque).toBe(8);
    expect(banco.gravacoes).toBe(1);
    expect(banco.filtros[0]).toContainEqual([
      "ultima_atualizacao",
      "2026-10-21T13:00:00.123456+00:00",
    ]);
  });

  it("só preço continua salvando mesmo com venda externa, sem conferir versão", async () => {
    await montar();
    await digitar("product-sale-price", "60,00");
    banco.produto.estoque = 9;
    avancarVersao();
    await salvar();
    expect(banco.produto.preco_venda).toBe(60);
    expect(banco.produto.estoque).toBe(9);
    expect(banco.filtros[0]).toEqual([["id", "p-1"]]);
    expect(banco.toastError).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    "também recusa estoque da variação quando ela está ligada=%s",
    async (active) => {
      banco.variacoes = [
        {
          id: "v-1",
          product_id: "p-1",
          name: "Cor",
          value: "Rosa",
          stock_increment: 10,
          active,
        },
      ];
      await montar();
      await editarVariacao();
      avancarVersao();
      await salvar();
      expect(banco.gravacoes).toBe(0);
      expect(banco.gravacoesDeVariacoes).toBe(0);
      expect(banco.toastError).toHaveBeenCalled();
    },
  );
});
