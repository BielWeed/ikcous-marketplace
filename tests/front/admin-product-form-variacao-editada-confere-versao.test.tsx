// @vitest-environment jsdom
import { chaveDoRascunhoDoProduto } from "@/lib/rascunho-do-produto";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { escolherAtributo } from "./helpers/atributo-da-variacao";

const banco = vi.hoisted(() => ({
  produto: {} as Record<string, any>,
  variacoes: [] as Record<string, any>[],
  chamadasRpc: [] as any[],
  gravacoes: 0,
  recusas: [] as string[],
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
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
    success: banco.toastSuccess,
    info: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  },
}));

// Formulário e hook reais; só o banco é dublê. A recusa depende da versão,
// não de erro programado: uma edição externa muda preço e versão juntos.
vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: null } }) },
    rpc: async (nome: string, parametros: any) => {
      if (nome === "buscar_por_codigo_barras") return { data: [], error: null };
      expect(nome).toBe("salvar_produto_com_grade");
      banco.chamadasRpc.push(structuredClone(parametros));
      if (
        parametros.p_base_atualizado_em !== null &&
        parametros.p_base_atualizado_em !== banco.produto.ultima_atualizacao
      ) {
        banco.recusas.push("PRD01");
        return { data: null, error: { code: "PRD01" } };
      }
      Object.assign(banco.produto, parametros.p_produto);
      for (const linha of parametros.p_variantes) {
        const atual = banco.variacoes.find((v) => v.id === linha.id);
        if (atual) Object.assign(atual, linha);
        else
          banco.variacoes.push({ id: "v-nova", product_id: "p-1", ...linha });
      }
      banco.gravacoes++;
      banco.produto.ultima_atualizacao = "2026-11-10T13:00:01.123456+00:00";
      return {
        data: {
          ultima_atualizacao: banco.produto.ultima_atualizacao,
          apagadas: [],
          recusadas: [],
        },
        error: null,
      };
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
          };
          return consulta;
        },
      };
    },
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let raiz: Root;
let host: HTMLDivElement;
const navegar = vi.fn();
const versaoDeAbertura = "2026-11-10T13:00:00.123456+00:00";

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
async function clicar(texto: string) {
  await act(async () => {
    const botao = [...document.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === texto,
    );
    expect(botao).toBeDefined();
    expect(botao!.disabled).toBe(false);
    botao!.click();
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
        userId="lojista-1"
      />,
    );
  });
}
async function editarSoCodigoDeBarras() {
  await act(async () => {
    const linha = host.querySelector('[data-testid="variante-cadastrada"]');
    (
      linha?.closest("div.group")?.querySelector("button") as HTMLButtonElement
    ).click();
  });
  await digitar("variant-codigo-barras", "NOVA-ETIQUETA");
  await clicar("Salvar variação");
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
    ultima_atualizacao: versaoDeAbertura,
  };
  banco.variacoes = [
    {
      id: "v-1",
      product_id: "p-1",
      name: "Cor",
      value: "Rosa",
      stock_increment: 10,
      price_override: 100,
      codigo_barras: "ETIQUETA-ANTIGA",
      active: true,
    },
  ];
  banco.chamadasRpc = [];
  banco.gravacoes = 0;
  banco.recusas = [];
  banco.refresh.mockResolvedValue(undefined);
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  vi.spyOn(console, "error").mockImplementation(() => {});
  localStorage.clear();
  sessionStorage.clear();
  host = document.createElement("div");
  document.body.appendChild(host);
  raiz = createRoot(host);
});
afterEach(() => {
  act(() => raiz.unmount());
  host.remove();
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

describe("variação editada confere a versão da abertura", () => {
  it("editar só o código de barras da existente manda a versão, sem reenviar estoque", async () => {
    await montar();
    await editarSoCodigoDeBarras();
    await clicar("Salvar alterações");

    expect(banco.chamadasRpc).toHaveLength(1);
    expect(banco.chamadasRpc[0].p_base_atualizado_em).toBe(versaoDeAbertura);
    expect(banco.chamadasRpc[0].p_variantes).toMatchObject([
      { id: "v-1", codigo_barras: "NOVA-ETIQUETA", price_override: 100 },
    ]);
    expect(banco.chamadasRpc[0].p_variantes[0]).not.toHaveProperty(
      "stock_increment",
    );
    expect(banco.chamadasRpc[0].p_produto).not.toHaveProperty("estoque");
    expect(banco.gravacoes).toBe(1);
    expect(banco.toastSuccess).toHaveBeenCalledWith("Produto atualizado!");
  });

  it("variação nova continua mandando versão por causa do estoque", async () => {
    await montar();
    await act(async () => {
      [...host.querySelectorAll("button")]
        .find((b) => b.textContent?.includes("+ Novo"))!
        .click();
    });
    await escolherAtributo(0, "Cor", "variant-name", digitar);
    await digitar("variant-value", "Azul");
    await clicar("Salvar variação");
    await clicar("Salvar alterações");

    // stockIncrement das novas (temp-) já ativa mexeuNoEstoque.
    expect(banco.chamadasRpc).toHaveLength(1);
    expect(banco.chamadasRpc[0].p_base_atualizado_em).toBe(versaoDeAbertura);
    expect(banco.chamadasRpc[0].p_variantes).toHaveLength(1);
    expect(banco.chamadasRpc[0].p_variantes[0]).not.toHaveProperty("id");
    expect(banco.chamadasRpc[0].p_variantes[0]).toMatchObject({
      value: "Azul",
      stock_increment: 0,
    });
    expect(banco.gravacoes).toBe(1);
  });

  it("salvar de novo após PRD01 mantém o preço do outro aparelho e grava só a decisão local", async () => {
    await montar();
    await editarSoCodigoDeBarras();
    banco.variacoes[0].price_override = 120;
    banco.produto.ultima_atualizacao = "2026-11-10T13:00:01.123456+00:00";

    await clicar("Salvar alterações");
    expect(banco.recusas).toEqual(["PRD01"]);
    expect(banco.gravacoes).toBe(0);
    expect(banco.toastSuccess).not.toHaveBeenCalledWith("Produto atualizado!");

    await clicar("Salvar alterações");

    expect(banco.chamadasRpc).toHaveLength(2);
    expect(banco.chamadasRpc[1].p_base_atualizado_em).toBe(
      "2026-11-10T13:00:01.123456+00:00",
    );
    expect(banco.chamadasRpc[1].p_variantes).toMatchObject([
      { id: "v-1", codigo_barras: "NOVA-ETIQUETA", price_override: 120 },
    ]);
    expect(banco.variacoes[0]).toMatchObject({
      codigo_barras: "NOVA-ETIQUETA",
      price_override: 120,
    });
    expect(banco.gravacoes).toBe(1);
    expect(banco.toastSuccess).toHaveBeenCalledWith("Produto atualizado!");
  });

  it("PRD01 avisa e preserva o rascunho sem anunciar produto atualizado nem desfazer o preço", async () => {
    await montar();
    await editarSoCodigoDeBarras();
    const chave = chaveDoRascunhoDoProduto("lojista-1", "p-1")!;
    localStorage.setItem(
      chave,
      JSON.stringify({ codigoBarras: "NOVA-ETIQUETA" }),
    );
    banco.variacoes[0].price_override = 120;
    banco.produto.ultima_atualizacao = "2026-11-10T13:00:01.123456+00:00";

    await clicar("Salvar alterações");

    expect(banco.recusas).toEqual(["PRD01"]);
    expect(banco.gravacoes).toBe(0);
    expect(banco.variacoes[0].price_override).toBe(120);
    expect(banco.toastError).toHaveBeenCalledWith(
      "O produto mudou enquanto você editava. Recarregue a página e confira antes de salvar de novo.",
    );
    expect(banco.toastSuccess).not.toHaveBeenCalledWith("Produto atualizado!");
    expect(host.textContent).not.toContain("Salvo · voltando à lista");
    expect(navegar).not.toHaveBeenCalled();
    expect(localStorage.getItem(chave)).not.toBeNull();
  });
});
