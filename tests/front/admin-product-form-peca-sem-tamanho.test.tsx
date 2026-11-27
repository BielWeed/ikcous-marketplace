// @vitest-environment jsdom
//
// A peca que volta sem tamanho (20261642000000) na tela do produto: o aviso no
// topo pergunta o tamanho, e o Salvar da tela que ficou aberta NAO sobrescreve
// o estoque do tamanho que acabou de receber a peca -- a conferencia de versao
// que ja existe (PRD01) recusa, porque a decisao avancou a versao do produto
// (o gatilho do banco avanca `ultima_atualizacao` a cada mudanca de variacao).
// Formulario e hooks reais; so o banco e' duble. Nomes e ids inventados.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PEDIDO = "00000000-0000-4000-8000-00000000a1b2";
const VERSAO_DA_ABERTURA = "2026-11-27T13:00:00.123456+00:00";
const VERSAO_DA_DECISAO = "2026-11-27T13:00:05.654321+00:00";

const banco = vi.hoisted(() => ({
  produto: {} as Record<string, any>,
  variacoes: [] as Record<string, any>[],
  pendentes: [] as Record<string, any>[],
  salvamentos: [] as any[],
  decisoes: [] as any[],
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

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: async () => ({
        data: { session: { user: { id: "lojista-1" } } },
      }),
    },
    rpc: async (nome: string, parametros: any) => {
      if (nome === "buscar_por_codigo_barras") return { data: [], error: null };
      if (nome === "pecas_sem_tamanho_pendentes")
        return { data: structuredClone(banco.pendentes), error: null };
      if (nome === "resolver_peca_sem_tamanho") {
        banco.decisoes.push(structuredClone(parametros));
        const v = banco.variacoes.find((x) => x.id === parametros.p_variant_id);
        v!.stock_increment += 1;
        // o gatilho sync_produto_ultima_atualizacao
        banco.produto.ultima_atualizacao = VERSAO_DA_DECISAO;
        banco.pendentes = [];
        return {
          data: {
            id: parametros.p_peca_id,
            resolucao: "reposta",
            variant_id: parametros.p_variant_id,
            ja_resolvida: false,
            estoque_da_variacao: v!.stock_increment,
            pendentes: 0,
          },
          error: null,
        };
      }
      expect(nome).toBe("salvar_produto_com_grade");
      banco.salvamentos.push(structuredClone(parametros));
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
      }
      banco.produto.ultima_atualizacao = "2026-11-27T13:00:09.000001+00:00";
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

// @ts-expect-error flag interna do React, sem tipo publico.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let raiz: Root;
let host: HTMLDivElement;
const navegar = vi.fn();

async function esperar() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}
async function digitar(id: string, valor: string) {
  const campo = document.getElementById(id) as HTMLInputElement;
  expect(campo, id).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(campo, valor);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 300));
  });
}
const botao = (texto: string) =>
  [...document.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === texto,
  );
async function clicar(texto: string) {
  const b = botao(texto);
  expect(b, texto).toBeDefined();
  expect(b!.disabled).toBe(false);
  await act(async () => {
    b!.click();
  });
  await esperar();
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
  await esperar();
}
async function editarEstoqueDaVariacao(valor: string) {
  await act(async () => {
    const linha = host.querySelector('[data-testid="variante-cadastrada"]');
    (
      linha?.closest("div.group")?.querySelector("button") as HTMLButtonElement
    ).click();
  });
  await digitar("variant-stock", valor);
  await clicar("Salvar variação");
}
const aviso = () =>
  host.querySelector('section[aria-label="Peças que voltaram sem tamanho"]');

beforeEach(() => {
  // A loja tem banco configurado (o hook nem importa o cliente sem URL e chave).
  vi.stubEnv("VITE_SUPABASE_URL", "https://exemplo.supabase.co");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "chave-de-teste");
  vi.clearAllMocks();
  banco.produto = {
    id: "p-1",
    nome: "Blusa de teste",
    descricao: "Malha",
    preco_venda: 50,
    estoque: 3,
    categoria: "Geral",
    ativo: true,
    imagem_urls: [],
    ultima_atualizacao: VERSAO_DA_ABERTURA,
  };
  banco.variacoes = [
    {
      id: "v-m",
      product_id: "p-1",
      name: "Tamanho",
      value: "M",
      stock_increment: 3,
      active: true,
    },
  ];
  banco.pendentes = [
    {
      id: "peca-1",
      produto_id: "p-1",
      order_id: PEDIDO,
      origem: "pedido_desfeito",
      criada_em: "2026-11-27T12:00:00+00:00",
    },
  ];
  banco.salvamentos = [];
  banco.decisoes = [];
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

describe("a peca que voltou sem tamanho, na tela do produto", () => {
  it("o aviso fica no topo do formulario com os tamanhos ligados ja gravados", async () => {
    await montar();
    const a = aviso();
    expect(a).not.toBeNull();
    expect(a!.textContent).toContain(
      "1 peça deste produto voltou sem tamanho (pedido #00A1B2, vendido antes de você criar os tamanhos). Ela não está à venda.",
    );
    // um tamanho so: vem marcado, mas nada foi somado
    expect(botao("M")?.getAttribute("aria-pressed")).toBe("true");
    expect(banco.decisoes).toEqual([]);
    // os botoes do aviso nao enviam o formulario
    for (const b of a!.querySelectorAll("button"))
      expect(b.getAttribute("type")).toBe("button");
  });

  it("depois de somar ao M, o Salvar com o estoque velho do M e' recusado (PRD01) e o M fica com a peca", async () => {
    await montar();
    await clicar("Somar ao tamanho M");
    expect(banco.decisoes).toEqual([
      { p_peca_id: "peca-1", p_variant_id: "v-m" },
    ]);
    expect(banco.variacoes[0].stock_increment).toBe(4);
    expect(host.textContent).toContain(
      "Peça somada ao tamanho M. Já está à venda.",
    );

    // A tela continua com o numero de antes da peca (3) e a lojista muda para 5.
    await editarEstoqueDaVariacao("5");
    await clicar("Salvar alterações");

    expect(banco.salvamentos).toHaveLength(1);
    expect(banco.salvamentos[0].p_base_atualizado_em).toBe(VERSAO_DA_ABERTURA);
    expect(banco.recusas).toEqual(["PRD01"]);
    expect(banco.variacoes[0].stock_increment).toBe(4);
    expect(banco.toastError).toHaveBeenCalledWith(
      "O produto mudou enquanto você editava. Recarregue a página e confira antes de salvar de novo.",
    );
    expect(banco.toastSuccess).not.toHaveBeenCalledWith("Produto atualizado!");
  });

  it("depois de somar ao M, salvar so o nome nao reenvia o estoque do M", async () => {
    await montar();
    await clicar("Somar ao tamanho M");
    await digitar("product-name", "Blusa de teste azul");
    await clicar("Salvar alterações");

    expect(banco.salvamentos).toHaveLength(1);
    expect(banco.salvamentos[0].p_variantes).toEqual([]);
    expect(banco.produto.nome).toBe("Blusa de teste azul");
    expect(banco.variacoes[0].stock_increment).toBe(4);
  });
});
