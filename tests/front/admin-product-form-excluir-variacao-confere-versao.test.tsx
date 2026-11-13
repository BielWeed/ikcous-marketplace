// @vitest-environment jsdom
//
// Excluir uma variação confere a versão do produto, como mexer no estoque.
//
// O defeito: dois aparelhos abrem o mesmo produto com a variação M desligada
// (sem estoque). No aparelho 1 a lojista EXCLUI M e ainda não salva. No
// aparelho 2 ela liga M, põe 10 unidades e salva (o gatilho do banco avança a
// versão do produto). Quando o aparelho 1 salvava, a tela só mandava a versão
// de abertura se o estoque, as fotos ou a grade existente tivessem mexido;
// excluir não contava. A RPC recebia a base nula, não comparava nada e M sumia
// com as 10 unidades, sem aviso.
//
// Formulário e hook reais; só o banco é dublê, e a recusa depende da versão
// (como no banco), não de erro programado.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const banco = vi.hoisted(() => ({
  produto: {} as Record<string, any>,
  variacoes: [] as Record<string, any>[],
  chamadasRpc: [] as any[],
  recusas: 0,
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

const versaoDeAbertura = "2026-11-13T09:00:00.123456+00:00";
const versaoDoOutroAparelho = "2026-11-13T09:00:05.654321+00:00";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: null } }) },
    rpc: async (nome: string, parametros: any) => {
      expect(nome).toBe("salvar_produto_com_grade");
      banco.chamadasRpc.push(structuredClone(parametros));
      if (
        parametros.p_base_atualizado_em !== null &&
        parametros.p_base_atualizado_em !== banco.produto.ultima_atualizacao
      ) {
        banco.recusas++;
        return { data: null, error: { code: "PRD01" } };
      }
      banco.variacoes = banco.variacoes.filter(
        (v) => !parametros.p_apagar.includes(v.id),
      );
      // O gatilho do banco avança a versão a cada mudança de variação.
      banco.produto.ultima_atualizacao = "2026-11-13T09:00:09.000001+00:00";
      return {
        data: {
          ultima_atualizacao: banco.produto.ultima_atualizacao,
          apagadas: parametros.p_apagar,
          recusadas: [],
        },
        error: null,
      };
    },
    from: (tabela: string) => {
      if (tabela === "product_variants") {
        return {
          select: () => ({
            eq: () =>
              Object.assign(
                Promise.resolve({
                  data: structuredClone(banco.variacoes),
                  error: null,
                }),
                {
                  in: async (_: string, ids: string[]) => ({
                    data: structuredClone(
                      banco.variacoes.filter((v) => ids.includes(v.id)),
                    ),
                    error: null,
                  }),
                },
              ),
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

async function clicarTexto(texto: string) {
  await act(async () => {
    const botao = [...document.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === texto,
    );
    expect(botao).toBeDefined();
    expect(botao!.disabled).toBe(false);
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
        onSetDirty={vi.fn()}
        userId="lojista-1"
      />,
    );
  });
}
async function excluirDaTela(valor: string) {
  await act(async () => {
    const lixeira = host.querySelector<HTMLButtonElement>(
      `[aria-label="Excluir variação ${valor}"]`,
    );
    expect(lixeira).not.toBeNull();
    lixeira!.click();
  });
  await clicarTexto("Excluir Variante");
}
const gradeNaTela = () =>
  [...host.querySelectorAll('[data-testid="variante-cadastrada"]')].map(
    (linha) => linha.textContent?.trim(),
  );

beforeEach(() => {
  vi.clearAllMocks();
  banco.produto = {
    id: "p-1",
    nome: "Camiseta",
    descricao: "Algodão",
    preco_venda: 50,
    estoque: 5,
    categoria: "Geral",
    ativo: true,
    imagem_urls: [],
    ultima_atualizacao: versaoDeAbertura,
  };
  banco.variacoes = [
    {
      id: "v-p",
      product_id: "p-1",
      name: "Tamanho",
      value: "P",
      stock_increment: 5,
      active: true,
    },
    {
      id: "v-m",
      product_id: "p-1",
      name: "Tamanho",
      value: "M",
      stock_increment: 0,
      active: false,
    },
  ];
  banco.chamadasRpc = [];
  banco.recusas = 0;
  banco.refresh.mockResolvedValue(undefined);
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
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

describe("excluir variação confere a versão da abertura", () => {
  it("aparelho velho exclui M depois que o outro ligou M com estoque: recusa e nada é apagado", async () => {
    await montar();
    await excluirDaTela("M");
    expect(gradeNaTela()).toEqual(["Tamanho: P"]);

    // Aparelho 2: liga M, põe 10 unidades e salva (versão do produto avança).
    banco.variacoes[1] = {
      ...banco.variacoes[1],
      stock_increment: 10,
      active: true,
    };
    banco.produto.ultima_atualizacao = versaoDoOutroAparelho;

    await clicarTexto("Salvar alterações");

    expect(banco.chamadasRpc).toHaveLength(1);
    expect(banco.chamadasRpc[0].p_base_atualizado_em).toBe(versaoDeAbertura);
    expect(banco.chamadasRpc[0].p_apagar).toEqual(["v-m"]);
    expect(banco.recusas).toBe(1);
    // Nada foi apagado: M segue no banco com as 10 unidades.
    expect(banco.variacoes.map((v) => v.id)).toEqual(["v-p", "v-m"]);
    expect(banco.variacoes[1]).toMatchObject({
      stock_increment: 10,
      active: true,
    });
    // A mesma recusa de versão de sempre: aviso, sem sucesso, sem sair da tela.
    expect(banco.toastError).toHaveBeenCalledWith(
      "O produto mudou enquanto você editava. Recarregue a página e confira antes de salvar de novo.",
    );
    expect(banco.toastSuccess).not.toHaveBeenCalled();
    expect(navegar).not.toHaveBeenCalled();
  });

  it("com a versão em dia a exclusão continua funcionando e manda a versão", async () => {
    await montar();
    await excluirDaTela("M");

    await clicarTexto("Salvar alterações");

    expect(banco.chamadasRpc).toHaveLength(1);
    expect(banco.chamadasRpc[0].p_base_atualizado_em).toBe(versaoDeAbertura);
    expect(banco.chamadasRpc[0].p_apagar).toEqual(["v-m"]);
    expect(banco.recusas).toBe(0);
    expect(banco.variacoes.map((v) => v.id)).toEqual(["v-p"]);
    expect(banco.toastSuccess).toHaveBeenCalledWith("Produto atualizado!");
  });

  it("salvar sem excluir nada continua sem exigir a versão (só o nome do produto)", async () => {
    await montar();
    await act(async () => {
      const campo = document.getElementById("product-name") as HTMLInputElement;
      expect(campo).not.toBeNull();
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(campo, "Camiseta Lisa");
      campo.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 300));
    });

    await clicarTexto("Salvar alterações");

    expect(banco.chamadasRpc).toHaveLength(1);
    expect(banco.chamadasRpc[0].p_apagar).toEqual([]);
    expect(banco.chamadasRpc[0].p_base_atualizado_em).toBeNull();
  });
});
