// @vitest-environment jsdom
//
// Balcão — repor o estoque em outro aparelho libera a quantidade na BUSCA
// MANUAL do caixa que já tinha a peça no cupom. Tela real (AdminPdvView) com a
// máquina de estados real e a aba Buscar de verdade.
//
// Caixa A: 1 caneca bipada (estoque 1). Em B a lojista repõe para 5. A faz uma
// busca NOVA (a lista mostra 5) e adiciona outra caneca: antes o teto ficava em
// 1 e a venda de 2 canecas (R$ 60) não saía. Contraprova: uma lista lida ANTES
// do bipe e deixada na tela continua sem subir o teto.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const {
  rpcMock,
  codigoBipadoRef,
  estoqueNoBancoRef,
  listaPendenteRef,
  comVariacaoRef,
} = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  codigoBipadoRef: { atual: "" },
  // O que o servidor diz AGORA sobre a caneca (muda quando "outro aparelho"
  // repõe o estoque).
  estoqueNoBancoRef: { atual: 1 },
  // Quando preenchida, a consulta da LISTA não responde até o teste soltar.
  listaPendenteRef: {
    atual: null as Promise<unknown> | null,
  },
  // `true`: a lista traz a caneca como produto COM uma variação ativa.
  comVariacaoRef: { atual: false },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: rpcMock, functions: { invoke: vi.fn() } },
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { storeName: "Loja Teste" } }),
}));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "lojista-1" }, isAdmin: true }),
}));
vi.mock("@/components/admin/pdv/LeitorDeCodigo", () => ({
  LeitorDeCodigo: ({
    aberto,
    aoLer,
  }: {
    aberto: boolean;
    aoLer: (leitura: { codigo: string; formato: string }) => void;
  }) =>
    aberto ? (
      <button
        type="button"
        onClick={() =>
          aoLer({ codigo: codigoBipadoRef.atual, formato: "ean_13" })
        }
      >
        bipar
      </button>
    ) : null,
}));

import { AdminPdvView } from "@/views/admin/AdminPdvView";

function respostaDoBipe() {
  return {
    encontrado: true,
    origem: "produto" as const,
    codigo: "78912345",
    produto: {
      id: "produto-1",
      nome: "Caneca Azul",
      ativo: true,
      preco_venda: 30,
      estoque: estoqueNoBancoRef.atual,
      imagem: null,
      codigo_barras: "78912345",
      tem_variantes: false,
    },
    variante: null,
    preco: 30,
    estoque: estoqueNoBancoRef.atual,
    variacoes: [],
  };
}

/** Produto COM variação ativa (a lista mostra o estoque da variação). */
function paginaDaBuscaComVariacao() {
  return {
    data: {
      data: [
        {
          id: "produto-1",
          nome: "Caneca Azul",
          preco_venda: 30,
          estoque: 0,
          imagem_url: null,
          imagem_urls: null,
          product_variants: [
            {
              id: "var-azul",
              name: "Cor",
              value: "Azul",
              price_override: null,
              stock_increment: estoqueNoBancoRef.atual,
              active: true,
              image_url: null,
            },
          ],
        },
      ],
      total_count: 1,
    },
    error: null,
  };
}

function paginaDaBusca() {
  return {
    data: {
      data: [
        {
          id: "produto-1",
          nome: "Caneca Azul",
          preco_venda: 30,
          estoque: estoqueNoBancoRef.atual,
          imagem_url: null,
          imagem_urls: null,
          product_variants: [],
        },
      ],
      total_count: 1,
    },
    error: null,
  };
}

function digitarInput(id: string, valor: string): void {
  const el = document.getElementById(id) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

async function avancar(ms = 0): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
  });
}

describe("Balcão — busca nova depois da reposição sobe o teto do estoque", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    const armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        armazem.set(chave, valor);
      },
      removeItem: (chave: string) => {
        armazem.delete(chave);
      },
    });
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-13T15:00:00-03:00"));
    estoqueNoBancoRef.atual = 1;
    listaPendenteRef.atual = null;
    comVariacaoRef.atual = false;
    codigoBipadoRef.atual = "78912345";
    rpcMock.mockReset();
    rpcMock.mockImplementation(async (nome: string) => {
      if (nome === "buscar_por_codigo_barras") {
        return { data: respostaDoBipe(), error: null };
      }
      if (nome === "get_admin_products_paged") {
        if (listaPendenteRef.atual) return listaPendenteRef.atual;
        return comVariacaoRef.atual
          ? paginaDaBuscaComVariacao()
          : paginaDaBusca();
      }
      throw new Error(`RPC inesperada: ${nome}`);
    });
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function montar(): Promise<void> {
    await act(async () => {
      raiz.render(<AdminPdvView onNavigate={vi.fn()} active />);
    });
    await avancar();
  }

  async function clicarNaAba(id: string): Promise<void> {
    await act(async () => {
      document.getElementById(id)!.click();
    });
    await avancar();
  }

  async function bipar(): Promise<void> {
    const alvo = [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("bipar"),
    );
    expect(alvo, "botão de bipar ausente").toBeTruthy();
    await act(async () => {
      alvo!.click();
    });
    await avancar();
  }

  async function adicionarCanecaDaBusca(): Promise<void> {
    const linha = hospedeiro.querySelector<HTMLButtonElement>(
      'section[aria-label="Busca manual de produtos"] button.pdv-result',
    );
    expect(linha, "caneca não apareceu na lista da busca").toBeTruthy();
    await act(async () => {
      linha!.click();
    });
    await avancar();
  }

  it("(d) busca NOVA depois da reposição: a 2ª caneca entra e a venda fecha em R$ 60,00", async () => {
    await montar();
    await bipar(); // caixa A: 1 caneca, o servidor diz estoque 1
    expect(hospedeiro.textContent).toContain("R$ 30,00");

    estoqueNoBancoRef.atual = 5; // outro aparelho repõe o estoque
    await avancar(5_000);
    await clicarNaAba("modo-buscar-produto"); // 1ª leitura da lista: já mostra 5
    expect(hospedeiro.textContent).toContain("5 em estoque");

    await adicionarCanecaDaBusca();

    expect(hospedeiro.textContent).not.toContain("Estoque no limite");
    expect(hospedeiro.textContent).toContain("R$ 60,00");
    // 2 de 5: sobra folga, o selo de limite não acende
    expect(hospedeiro.textContent).not.toContain("Limite do estoque");
  });

  it("(d) contraprova: lista lida ANTES do bipe e deixada na tela NÃO sobe o teto", async () => {
    estoqueNoBancoRef.atual = 3; // a lista velha mostrava 3
    await montar();
    await clicarNaAba("modo-buscar-produto"); // lê a lista (estoque 3)
    expect(hospedeiro.textContent).toContain("3 em estoque");

    await avancar(5_000);
    estoqueNoBancoRef.atual = 1; // outro aparelho vendeu: só resta 1
    await clicarNaAba("modo-bipar-produto");
    await bipar(); // o bipe lê 1, DEPOIS da lista
    await clicarNaAba("modo-buscar-produto"); // a lista velha continua na tela

    await adicionarCanecaDaBusca();

    expect(hospedeiro.textContent).toContain("Estoque no limite");
    expect(hospedeiro.textContent).not.toContain("R$ 60,00");
    expect(hospedeiro.textContent).toContain("Limite do estoque · 1 un.");
  });

  it("(d) lista LENTA: consultada antes do bipe mas que só chega depois dele NÃO sobe o teto", async () => {
    // A leitura da lista começou ANTES de o estoque cair para 1 (ela viu 5), mas
    // a resposta só chega depois do bipe. A idade dela é a de quando a consulta
    // PARTIU, não a de quando a resposta chegou.
    let soltarLista: (valor: unknown) => void = () => {};
    listaPendenteRef.atual = new Promise((resolver) => {
      soltarLista = resolver;
    });
    estoqueNoBancoRef.atual = 5;
    const listaComEstoqueVelho = paginaDaBusca(); // o que o servidor mostrou
    await montar();
    await clicarNaAba("modo-buscar-produto"); // a consulta parte e fica no ar

    await avancar(1_000);
    estoqueNoBancoRef.atual = 1; // outro aparelho vendeu
    await clicarNaAba("modo-bipar-produto");
    await bipar(); // o bipe lê 1 e chega primeiro
    await avancar(1_000);

    await act(async () => {
      soltarLista(listaComEstoqueVelho); // chega tarde, com o 5 de antes
    });
    await avancar();
    await clicarNaAba("modo-buscar-produto");
    expect(hospedeiro.textContent).toContain("5 em estoque");

    await adicionarCanecaDaBusca();

    expect(hospedeiro.textContent).toContain("Estoque no limite");
    expect(hospedeiro.textContent).not.toContain("R$ 60,00");
  });

  it("(d) produto COM variação: busca nova depois da reposição também sobe o teto", async () => {
    comVariacaoRef.atual = true;
    await montar();
    await clicarNaAba("modo-buscar-produto");
    const linha = () =>
      hospedeiro.querySelector<HTMLButtonElement>(
        'section[aria-label="Busca manual de produtos"] button.pdv-result',
      );
    const variacao = () =>
      hospedeiro.querySelector<HTMLButtonElement>(
        'section[aria-label="Busca manual de produtos"] .pdv-result-variants button',
      );
    await act(async () => {
      linha()!.click(); // abre as variações
    });
    await avancar();
    await act(async () => {
      variacao()!.click(); // 1 caneca azul (estoque 1)
    });
    await avancar();
    expect(hospedeiro.textContent).toContain("Limite do estoque · 1 un.");

    estoqueNoBancoRef.atual = 5; // outro aparelho repõe
    await avancar(5_000);
    await act(async () => {
      digitarInput("busca-manual-de-produto", "caneca"); // busca NOVA
    });
    await avancar(400);
    expect(hospedeiro.textContent).toContain("5 em estoque");

    await act(async () => {
      variacao()!.click();
    });
    await avancar();

    expect(hospedeiro.textContent).not.toContain("Estoque no limite");
    expect(hospedeiro.textContent).toContain("R$ 60,00");
  });
});
