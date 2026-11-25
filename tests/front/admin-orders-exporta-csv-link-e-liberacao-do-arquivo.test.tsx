// @vitest-environment jsdom
// A tela real de pedidos, no instante do download do CSV: o link escondido
// precisa estar NA PÁGINA quando recebe o clique (Firefox ignora link solto),
// precisa sair dela depois, mesmo se o clique falhar, e o endereço do arquivo
// só é liberado depois de um respiro (1 s) para o navegador iniciar o
// download. Também protege o tipo do arquivo e que um segundo clique durante
// a geração não baixa duas planilhas, enquanto um clique depois do fim baixa.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  erro: vi.fn(),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: mocks.rpc,
    auth: {
      getSession: async () => ({
        data: { session: { user: { id: "admin-teste" } } },
      }),
    },
    from: mocks.from,
    channel: vi.fn(),
    removeChannel: vi.fn(),
    functions: { invoke: vi.fn() },
  },
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: "admin-teste" },
    isAdmin: true,
    contaAindaTemAcessoAdmin: (id: string) => id === "admin-teste",
  }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: {}, isLoaded: true, updateConfig: vi.fn() }),
}));
vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({ stats: null, fetchExecutiveSummary: vi.fn() }),
  clearAnalyticsCache: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: { error: mocks.erro, success: vi.fn(), info: vi.fn() },
}));

import { AdminOrdersView } from "@/views/admin/AdminOrdersView";

// @ts-expect-error flag interna do React, sem tipo público
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

interface Clique {
  link: HTMLAnchorElement;
  ligadoNaPaginaNoClique: boolean;
}

function pedidoDoBanco(numero: number) {
  return {
    id: `pedido-${String(numero).padStart(6, "0")}`,
    customer_name: `Cliente ${numero}`,
    customer_data: { whatsapp: "11999999999" },
    items: [
      {
        product_id: "produto-1",
        product_name: "Camiseta Básica",
        quantity: 1,
        price: 49.9,
      },
    ],
    total: 49.9,
    status: "pending",
    payment_status: "aguardando",
    payment_method: "pix",
    created_at: "2026-09-01T12:00:00.000Z",
    updated_at: "2026-09-01T12:00:00.000Z",
  };
}

function consulta<T>(resultado: Promise<T>) {
  return Object.assign(resultado, { abortSignal: () => resultado });
}

describe("CSV de pedidos: link escondido e liberação do arquivo", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let cliques: Clique[];
  let tiposDosArquivos: string[];
  // Os pedidos de "espere 1 s" feitos depois do clique (a liberação do
  // arquivo) NÃO rodam sozinhos: ficam aqui e o teste os dispara. Assim um
  // temporizador de um teste anterior nunca libera o endereço de outro teste.
  let liberacoes: (() => void)[];
  let capturarLiberacoes: boolean;

  function botao() {
    const encontrado = Array.from(
      document.body.querySelectorAll("button"),
    ).find((item) =>
      /Exportar CSV|Gerando CSV/.test(item.getAttribute("aria-label") || ""),
    );
    expect(encontrado).toBeDefined();
    return encontrado!;
  }

  async function montarTela() {
    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={true} />);
    });
    await act(async () =>
      hospedeiro
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Filtros e ferramentas"]',
        )!
        .click(),
    );
    const limite = Date.now() + 5000;
    for (;;) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      const pronto = Array.from(document.body.querySelectorAll("button")).find(
        (item) =>
          /Exportar CSV/.test(item.getAttribute("aria-label") || "") &&
          !item.disabled,
      );
      if (pronto || Date.now() > limite) break;
    }
    capturarLiberacoes = true;
  }

  beforeEach(() => {
    mocks.rpc.mockReset();
    mocks.from.mockReset();
    mocks.erro.mockClear();
    const armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => armazem.set(chave, valor),
      removeItem: (chave: string) => armazem.delete(chave),
    });
    vi.stubGlobal("ResizeObserver", ObserverStub);
    vi.stubGlobal("IntersectionObserver", ObserverStub);
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
    }));
    tiposDosArquivos = [];
    liberacoes = [];
    capturarLiberacoes = false;
    const setTimeoutReal = globalThis.setTimeout;
    vi.spyOn(globalThis, "setTimeout").mockImplementation(
      (...args: Parameters<typeof setTimeout>) => {
        const [funcao, atraso] = args;
        if (
          capturarLiberacoes &&
          atraso === 1000 &&
          typeof funcao === "function"
        ) {
          liberacoes.push(funcao as () => void);
          return 0 as unknown as ReturnType<typeof setTimeout>;
        }
        return setTimeoutReal(...args);
      },
    );
    const BlobOriginal = globalThis.Blob;
    vi.stubGlobal(
      "Blob",
      class extends BlobOriginal {
        constructor(partes: BlobPart[], opcoes?: BlobPropertyBag) {
          super(partes, opcoes);
          tiposDosArquivos.push(opcoes?.type ?? "");
        }
      },
    );
    vi.stubGlobal(
      "URL",
      Object.assign(class extends URL {}, {
        createObjectURL: vi.fn(() => "blob:csv"),
        revokeObjectURL: vi.fn(),
      }),
    );
    cliques = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      cliques.push({ link: this, ligadoNaPaginaNoClique: this.isConnected });
    });
    const pedidos = [pedidoDoBanco(1), pedidoDoBanco(2)];
    mocks.rpc.mockImplementation((nome: string, args: Record<string, number>) =>
      consulta(
        Promise.resolve({
          data:
            nome === "get_admin_orders_paged" && args.p_page_size !== 200
              ? { data: pedidos, total_count: pedidos.length }
              : { data: [], total_count: 0 },
          error: null,
        }),
      ),
    );
    mocks.from.mockImplementation(() => ({
      select: () => ({
        in: () => Promise.resolve({ data: [], error: null }),
      }),
    }));
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("o link já está na página quando recebe o clique, sai dela depois, e o arquivo é CSV em UTF-8", async () => {
    await montarTela();
    await act(async () => {
      botao().click();
    });
    expect(cliques).toHaveLength(1);
    expect(cliques[0].ligadoNaPaginaNoClique).toBe(true);
    expect(cliques[0].link.isConnected).toBe(false);
    expect(cliques[0].link.href).toBe("blob:csv");
    expect(tiposDosArquivos).toContain("text/csv;charset=utf-8;");
  });

  it("o endereço do arquivo não é liberado na hora: só quando o respiro de 1 s acaba", async () => {
    await montarTela();
    await act(async () => {
      botao().click();
    });
    expect(cliques).toHaveLength(1);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    expect(liberacoes).toHaveLength(1);
    liberacoes[0]();
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:csv");
  });

  it("clique que o navegador recusa ainda tira o link da página e agenda a liberação", async () => {
    await montarTela();
    vi.mocked(HTMLAnchorElement.prototype.click).mockImplementationOnce(
      function (this: HTMLAnchorElement) {
        cliques.push({ link: this, ligadoNaPaginaNoClique: this.isConnected });
        throw new Error("o navegador recusou o clique");
      },
    );
    await act(async () => {
      botao().click();
    });
    expect(cliques).toHaveLength(1);
    expect(cliques[0].link.isConnected).toBe(false);
    // O erro do clique cai no aviso genérico, sem baixar nada.
    expect(mocks.erro).toHaveBeenCalledWith(
      "Não foi possível gerar o CSV. Tente de novo.",
    );
    expect(liberacoes).toHaveLength(1);
    liberacoes[0]();
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:csv");
  });

  it("depois que o CSV termina, um novo clique baixa de novo (o trinco solta)", async () => {
    await montarTela();
    await act(async () => {
      botao().click();
    });
    expect(cliques).toHaveLength(1);
    await act(async () => {
      botao().click();
    });
    expect(cliques).toHaveLength(2);
  });
});
