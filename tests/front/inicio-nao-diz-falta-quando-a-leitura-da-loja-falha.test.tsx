// @vitest-environment jsdom
//
// O catalogo ou a configuracao da loja FALHARAM ao carregar (rede, servidor):
// a lista de produtos fica vazia e a configuracao fica a de fabrica. O cartao
// "Loja pronta" do Inicio lia isso como "a lojista nao fez nada" e mandava
// "Cadastrar um produto ativo" para quem ja tem produtos (ou "Cadastrar nome e
// logo" para quem ja tem). Aqui ele diz a verdade: nao deu para conferir, e
// oferece tentar de novo -- nunca afirma que falta.
//
// Tela de verdade (AdminDashboardView) com o StoreContext dublado, no molde de
// dashboard-estoque-carregando-fiacao.test.tsx.
import { montarEnderecoDaLoja } from "@/lib/endereco-da-loja";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  store: {} as Record<string, unknown>,
  fetchProducts: vi.fn(),
  refresh: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: (nome: string) => {
      h.rpc(nome);
      return Promise.resolve({
        data:
          nome === "painel_inicio"
            ? {
                hoje: { receita: 0, online: 0, presencial: 0, pedidos: 0 },
                mes: { receita: 0, receita_mes_anterior: 0, pedidos: 0 },
                pendencias: {
                  pedidos_para_preparar: 0,
                  devolucoes_abertas: 0,
                  caixa_aberto: false,
                  estoque_baixo: 0,
                },
                serie_14d: [],
              }
            : null,
        error: null,
      });
    },
    channel: () => {
      const canal: Record<string, unknown> = {
        on: () => canal,
        subscribe: () => canal,
      };
      return canal;
    },
    removeChannel: vi.fn(),
    // Os passos recomendados leem a edge de frete; aqui nao ha resposta.
    functions: {
      invoke: () => Promise.resolve({ data: null, error: null }),
    },
  },
}));
vi.mock("@/contexts/StoreContext", () => ({ useStore: () => h.store }));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ session: { user: { id: "adm-1" } }, profile: null }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/hooks/useScrollRestoration", () => ({
  useScrollRestoration: () => ({ ref: { current: null } }),
}));
vi.mock("@/hooks/usePrefetchOnHover", () => ({
  usePrefetchOnHover: () => ({ prefetchView: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// @ts-expect-error flag interna do React, sem tipo publico.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ENDERECO_PRONTO = montarEnderecoDaLoja({
  cep: "01310100",
  rua: "Avenida Paulista",
  numero: "1578",
  complemento: "",
  bairro: "Bela Vista",
  cidade: "Sao Paulo",
  uf: "SP",
});

// Loja de verdade, com os cinco primeiros passos em dia (nao ha horario aqui:
// ele nao conta). So falta o que cada teste quiser provar.
const CONFIG_PRONTA = {
  storeName: "Atelie da Serra",
  logoUrl: "https://exemplo.test/logo.png",
  originCep: ENDERECO_PRONTO.originCep,
  storeAddress: ENDERECO_PRONTO.storeAddress,
  whatsappNumber: "(34) 99999-9999",
  localCepRange: "01000-000, 05999-999",
};

// A configuracao de FABRICA que o contexto deixa quando a leitura falha.
const CONFIG_DE_FABRICA = { storeName: undefined, logoUrl: undefined };

function definirLoja(parcial: Record<string, unknown>) {
  h.store = {
    config: CONFIG_PRONTA,
    isLoaded: true,
    products: [{ isActive: true }],
    loadingProducts: false,
    catalogoErro: false,
    configIndisponivel: false,
    fetchProducts: h.fetchProducts,
    refresh: h.refresh,
    ...parcial,
  };
}

const texto = (el: Element | null) =>
  (el?.textContent ?? "").replace(/\u00a0/g, " ");

async function esperarAte(condicao: () => boolean, timeoutMs = 3000) {
  const inicio = Date.now();
  while (!condicao()) {
    if (Date.now() - inicio > timeoutMs) {
      throw new Error(
        `esperarAte: nao aconteceu em ${timeoutMs}ms -- corpo: ${texto(document.body).slice(0, 500)}`,
      );
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }
}

describe("Inicio -- cartao 'Loja pronta' quando a leitura da loja falha", () => {
  let hospedeiro: HTMLDivElement;
  let raiz: Root;

  beforeEach(() => {
    // O cache do Inicio e de modulo: cada teste parte de um modulo novo.
    vi.resetModules();
    vi.clearAllMocks();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  async function montar() {
    const { AdminDashboardView } = await import(
      "@/views/admin/AdminDashboardView"
    );
    await act(async () => {
      raiz.render(<AdminDashboardView active={true} onNavigate={vi.fn()} />);
    });
    // O painel sem vendas e o que faz as boas-vindas aparecerem.
    await esperarAte(() => h.rpc.mock.calls.length >= 1);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
  }

  const botao = (trecho: string) =>
    Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
      texto(b).includes(trecho),
    );

  describe("catalogo", () => {
    it("CONTROLE: catalogo respondeu vazio de verdade -- o Inicio manda cadastrar o primeiro produto", async () => {
      definirLoja({ products: [], catalogoErro: false });
      await montar();

      expect(texto(hospedeiro)).toContain("Cadastrar um produto ativo");
      expect(texto(hospedeiro)).toContain("Sua loja começa por aqui");
    });

    it("catalogo FALHOU e a lista esta vazia: nao diz que falta cadastrar produto, nem nas boas-vindas", async () => {
      definirLoja({ products: [], catalogoErro: true });
      await montar();

      expect(texto(hospedeiro)).not.toContain("Cadastrar um produto");
      expect(texto(hospedeiro)).not.toContain("Sua loja começa por aqui");
      expect(texto(hospedeiro)).toContain("Conferindo sua loja");
    });

    it("catalogo FALHOU e a lista esta vazia: oferece tentar de novo, ligado a busca de produtos do contexto", async () => {
      definirLoja({ products: [], catalogoErro: true });
      await montar();

      const tentar = botao("Tentar de novo");
      expect(tentar).toBeDefined();
      expect(texto(hospedeiro)).toMatch(/lista de produtos/i);
      await act(async () => {
        tentar?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      expect(h.fetchProducts).toHaveBeenCalledTimes(1);
      expect(h.refresh).not.toHaveBeenCalled();
    });

    it("catalogo falhou mas ha copia local dos produtos: o cartao segue valendo, sem aviso de falha", async () => {
      definirLoja({ products: [{ isActive: true }], catalogoErro: true });
      await montar();

      expect(texto(hospedeiro)).not.toContain("Conferindo sua loja");
      expect(texto(hospedeiro)).not.toMatch(/lista de produtos/i);
      expect(h.fetchProducts).not.toHaveBeenCalled();
    });

    it("so tem produto DESATIVADO na copia local e o catalogo falhou: segue pelo que ha na tela (a lista nao esta vazia)", async () => {
      definirLoja({ products: [{ isActive: false }], catalogoErro: true });
      await montar();

      expect(texto(hospedeiro)).toContain("Cadastrar um produto ativo");
    });
  });

  describe("configuracao", () => {
    it("CONTROLE: configuracao respondeu de fabrica de verdade -- o Inicio manda cadastrar nome e logo", async () => {
      definirLoja({
        config: CONFIG_DE_FABRICA,
        configIndisponivel: false,
      });
      await montar();

      expect(texto(hospedeiro)).toContain("Cadastrar nome e logo da loja");
    });

    it("leitura da configuracao FALHOU sem copia: nenhum passo diz que falta, e o cartao fica em 'Conferindo'", async () => {
      definirLoja({
        config: CONFIG_DE_FABRICA,
        configIndisponivel: true,
      });
      await montar();

      const t = texto(hospedeiro);
      expect(t).not.toContain("Cadastrar nome e logo");
      expect(t).not.toContain("Cadastrar o endereço");
      expect(t).not.toContain("Cadastrar WhatsApp");
      expect(t).not.toContain("Configurar a entrega");
      expect(t).not.toContain("Sua loja começa por aqui");
      expect(t).toContain("Conferindo sua loja");
    });

    it("leitura da configuracao FALHOU sem copia: avisa e o tentar de novo recarrega SO a configuracao", async () => {
      definirLoja({
        config: CONFIG_DE_FABRICA,
        configIndisponivel: true,
      });
      await montar();

      expect(texto(hospedeiro)).toMatch(/dados da loja/i);
      const tentar = botao("Tentar de novo");
      expect(tentar).toBeDefined();
      await act(async () => {
        tentar?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      expect(h.refresh).toHaveBeenCalledWith({ onlyConfig: true });
      expect(h.fetchProducts).not.toHaveBeenCalled();
    });

    it("as duas leituras falharam: o tentar de novo recarrega as duas", async () => {
      definirLoja({
        config: CONFIG_DE_FABRICA,
        configIndisponivel: true,
        products: [],
        catalogoErro: true,
      });
      await montar();

      const tentar = botao("Tentar de novo");
      await act(async () => {
        tentar?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      expect(h.refresh).toHaveBeenCalledWith({ onlyConfig: true });
      expect(h.fetchProducts).toHaveBeenCalledTimes(1);
    });

    it("CONTROLE: configuracao de verdade e PIX desligado -- o Inicio recomenda ligar o pagamento pelo app", async () => {
      definirLoja({ configIndisponivel: false });
      await montar();

      expect(texto(hospedeiro)).toContain("Recomendado para vender");
      expect(texto(hospedeiro)).toContain("Ligar o pagamento pelo app (PIX)");
    });

    it("leitura da configuracao FALHOU: os passos RECOMENDADOS tambem nao afirmam que falta (nem 'Ligar o pagamento pelo app')", async () => {
      definirLoja({ configIndisponivel: true });
      await montar();

      expect(texto(hospedeiro)).not.toContain("Recomendado para vender");
      expect(texto(hospedeiro)).not.toContain("Ligar o pagamento pelo app");
    });

    it("StoreContext antigo, sem o campo novo (undefined): le como 'nao falhou' e nada muda", async () => {
      definirLoja({ configIndisponivel: undefined, catalogoErro: undefined });
      await montar();

      expect(texto(hospedeiro)).not.toContain("Conferindo sua loja");
      expect(texto(hospedeiro)).not.toMatch(/dados da loja/i);
    });
  });
});
