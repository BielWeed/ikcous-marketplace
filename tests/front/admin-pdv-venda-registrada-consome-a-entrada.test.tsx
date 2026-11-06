// @vitest-environment jsdom
//
// Balcão (PDV): a cada venda registrada sobrava UMA entrada de histórico (o
// efeito da virada para o recibo só apagava a marca `{modal: "pdv"}` com
// `replaceState`, não a consumia). Resultado no celular: depois de N vendas, o
// Voltar "não fazia nada" N vezes — o App via "mesma tela" e ignorava.
//
// A correção consome a entrada de verdade (`history.back()`), mas SEM
// reintroduzir o diálogo "alterações não salvas" que o `replaceState` evitou
// (relato do dono, 19/09): o popstate desse `back()` corre antes de o painel
// saber que o cupom ficou limpo. Por isso o `back()` vai com um desvio de uso
// único que engole o popstate (mesmo desenho do Financeiro).
//
// O histórico e o popstate aqui são os do jsdom. O "App" é um dublê que copia o
// contrato do `handlePopState` real (src/App.tsx): se há desvio registrado, ele
// é chamado ANTES do gate de dirty; sem desvio e com dirty, abre o diálogo. O
// dirty do dublê atrasa de propósito (como o render do painel): é a corrida
// que o desvio de uso único existe para vencer.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { rpcMock, codigoBipadoRef } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  codigoBipadoRef: { atual: "" },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: rpcMock },
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { storeName: "Loja Teste" } }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
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

const PRODUTO_SIMPLES = {
  encontrado: true,
  origem: "produto" as const,
  codigo: "78912345",
  produto: {
    id: "produto-1",
    nome: "Camiseta Lisa",
    ativo: true,
    preco_venda: 39.9,
    estoque: 10,
    imagem: null,
    codigo_barras: "78912345",
    tem_variantes: false,
  },
  variante: null,
  preco: 39.9,
  estoque: 10,
  variacoes: [],
};

/** O estado que a tela do balcão deixou como "página" antes de qualquer camada. */
const ESTADO_BASE = { view: "admin-pdv" };

function localizarBotaoPorTexto(
  raizDom: ParentNode,
  texto: string,
): HTMLButtonElement | undefined {
  return [...raizDom.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
}

describe("AdminPdvView — a venda registrada consome a entrada de histórico (Voltar do celular)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;

  // Dublê do painel (App.tsx): desvio imediato; o dirty LIGA na hora, mas só
  // CAI quando o teste manda (`painelAssenta`) — é a corrida do relato de
  // 19/09: o popstate chega antes de o painel saber que o cupom ficou limpo.
  let desvioDoApp: (() => void) | null;
  let dirtyDoApp: boolean;
  let dirtyQueVaiCair: boolean;
  let dialogosDeNaoSalvo: number;
  let popstatesVistos: number;

  const onSetBackOverride = vi.fn((fn: unknown) => {
    desvioDoApp =
      typeof fn === "function"
        ? (fn as () => (() => void) | null)()
        : (fn as (() => void) | null);
  });
  const onSetDirty = vi.fn((valor: boolean) => {
    if (valor) dirtyDoApp = true;
    else dirtyQueVaiCair = true;
  });
  const painelAssenta = () => {
    if (dirtyQueVaiCair) dirtyDoApp = false;
    dirtyQueVaiCair = false;
  };

  // Mesma ordem do `handlePopState` do App: desvio primeiro, depois o dirty.
  const aoPopstate = () => {
    popstatesVistos += 1;
    if (desvioDoApp) {
      desvioDoApp();
      return;
    }
    if (dirtyDoApp) dialogosDeNaoSalvo += 1;
  };

  async function avancar(ms = 0): Promise<void> {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(0);
    });
  }

  /** Deixa o jsdom entregar o popstate (macrotarefa real) até o n-ésimo. */
  async function esperarPopstate(total: number): Promise<void> {
    for (let i = 0; i < 100 && popstatesVistos < total; i++) await avancar(5);
    expect(popstatesVistos).toBe(total);
  }

  async function clicarNoBotao(texto: string): Promise<void> {
    const botao = localizarBotaoPorTexto(hospedeiro, texto);
    expect(botao, `botão "${texto}" não está na tela`).toBeDefined();
    await act(async () => {
      botao?.click();
    });
    await avancar();
  }

  async function bipar(codigo: string): Promise<void> {
    codigoBipadoRef.atual = codigo;
    const botao = localizarBotaoPorTexto(document.body, "bipar");
    await act(async () => {
      botao?.click();
    });
    await avancar();
  }

  /** Uma venda inteira, do primeiro bipe até o recibo na tela. */
  async function venderUmaPeca(): Promise<void> {
    const popstatesAntes = popstatesVistos;
    await bipar(PRODUTO_SIMPLES.codigo);
    await clicarNoBotao("Fechar venda");
    await clicarNoBotao("Dinheiro");
    await clicarNoBotao("Registrar venda");
    await avancar(100);
    expect(hospedeiro.textContent).toContain("Compra na loja");
    // O popstate da devolução chega ANTES de o painel assentar o dirty…
    await esperarPopstate(popstatesAntes + 1);
    // …e só então o painel recebe o "ficou limpo".
    painelAssenta();
  }

  beforeEach(() => {
    armazem = new Map();
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
    desvioDoApp = null;
    dirtyDoApp = false;
    dirtyQueVaiCair = false;
    dialogosDeNaoSalvo = 0;
    popstatesVistos = 0;
    onSetBackOverride.mockClear();
    onSetDirty.mockClear();

    rpcMock.mockReset();
    rpcMock.mockImplementation(async (nome: string, params: any) => {
      if (nome === "buscar_por_codigo_barras") {
        return { data: PRODUTO_SIMPLES, error: null };
      }
      if (nome === "get_admin_customers_paged") {
        return { data: { data: [] }, error: null };
      }
      if (nome === "get_admin_products_paged") {
        return { data: { data: [] }, error: null };
      }
      if (nome === "registrar_venda_presencial") {
        return {
          data: {
            ja_existia: false,
            order: {
              id: `pedido-${params.p_chave_idempotencia ?? "x"}`,
              created_at: new Date().toISOString(),
              total: 39.9,
              subtotal: 39.9,
              discount: 0,
              payment_method: params.p_pagamento ?? "cash",
              user_id: null,
              customer_name: "Venda no balcão",
              customer_data: { whatsapp: null, canal: "presencial" },
            },
            items: [
              {
                product_id: "produto-1",
                variant_id: null,
                quantity: 1,
                price: 39.9,
                product_name: "Camiseta Lisa",
              },
            ],
          },
          error: null,
        };
      }
      throw new Error(`RPC não mockada neste teste: ${nome}`);
    });

    window.history.replaceState(ESTADO_BASE, "", "/admin-pdv");
    window.addEventListener("popstate", aoPopstate);

    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    window.removeEventListener("popstate", aoPopstate);
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
      raiz.render(
        <AdminPdvView
          onNavigate={vi.fn()}
          active
          onSetBackOverride={onSetBackOverride}
          onSetDirty={onSetDirty}
        />,
      );
    });
    await avancar();
  }

  it("uma venda registrada devolve a entrada: o histórico volta ao estado de antes da camada", async () => {
    await montar();
    await venderUmaPeca();

    // Entrada consumida de verdade — com `replaceState({})` o estado aqui
    // seria `{}` (a marca some, a entrada fica).
    expect(window.history.state).toEqual(ESTADO_BASE);
    expect(window.location.pathname).toBe("/admin-pdv");
  });

  it("o popstate dessa devolução é engolido: o diálogo 'alterações não salvas' NÃO abre sobre o recibo", async () => {
    await montar();
    await venderUmaPeca();

    // O popstate chegou (a entrada foi consumida)…
    expect(popstatesVistos).toBe(1);
    // …antes de o dirty do painel cair (a corrida do relato de 19/09), e
    // mesmo assim não abriu diálogo nenhum.
    expect(dialogosDeNaoSalvo).toBe(0);
    // O desvio de uso único se soltou sozinho.
    expect(desvioDoApp).toBeNull();
  });

  it("três vendas na mesma sessão não acumulam entradas: nenhum Voltar fica 'sem fazer nada'", async () => {
    await montar();
    const pushSpy = vi.spyOn(window.history, "pushState");
    const backSpy = vi.spyOn(window.history, "back");

    for (let venda = 1; venda <= 3; venda++) {
      await venderUmaPeca();
      // Fim de cada venda: a mesma posição do histórico de antes dela.
      expect(window.history.state).toEqual(ESTADO_BASE);
      await clicarNoBotao("Nova venda");
      painelAssenta();
      expect(window.history.state).toEqual(ESTADO_BASE);
    }

    // Cada camada empurrada foi devolvida: pushes == backs (abrir "Fechar
    // venda" é o único push de cada venda, e o recibo a devolve).
    expect(pushSpy).toHaveBeenCalledTimes(3);
    expect(backSpy).toHaveBeenCalledTimes(3);
    expect(popstatesVistos).toBe(3);
    expect(dialogosDeNaoSalvo).toBe(0);
  });

  it("o Voltar do celular no recibo sai da tela: nada na pilha segura o lojista no Balcão", async () => {
    await montar();
    // Uma página ANTES do balcão (de onde o lojista veio).
    window.history.replaceState({ view: "admin-orders" }, "", "/admin-orders");
    window.history.pushState(ESTADO_BASE, "", "/admin-pdv");
    await venderUmaPeca();
    popstatesVistos = 0;

    // Um único Voltar físico: vai direto para a página anterior.
    await act(async () => {
      window.history.back();
    });
    await avancar(10);

    expect(window.history.state).toEqual({ view: "admin-orders" });
    expect(window.location.pathname).toBe("/admin-orders");
  });

  it("se a entrada já não é a nossa quando a devolução sai (Voltar físico já a consumiu), não há segundo back()", async () => {
    await montar();
    window.history.replaceState({ view: "admin-orders" }, "", "/admin-orders");
    window.history.pushState(ESTADO_BASE, "", "/admin-pdv");
    const backSpy = vi.spyOn(window.history, "back");

    await bipar(PRODUTO_SIMPLES.codigo);
    await clicarNoBotao("Fechar venda");
    await clicarNoBotao("Dinheiro");
    const registrar = localizarBotaoPorTexto(hospedeiro, "Registrar venda");
    // O recibo aparece SEM deixar o relógio andar: a devolução agendada ainda
    // não saiu e a entrada continua a nossa.
    await act(async () => {
      registrar?.click();
      for (let i = 0; i < 20; i++) await Promise.resolve();
    });
    expect(hospedeiro.textContent).toContain("Compra na loja");
    expect(window.history.state?.modal).toBe("pdv");
    expect(backSpy).not.toHaveBeenCalled();

    // Nesse intervalo a entrada deixa de ser a nossa (o navegador já a
    // consumiu): simulado trocando o estado, que é o que o pop deixa.
    window.history.replaceState(ESTADO_BASE, "", "/admin-pdv");
    await avancar(100);

    // A devolução agendada percebeu e não voltou mais nada.
    expect(backSpy).not.toHaveBeenCalled();
    expect(window.history.state).toEqual(ESTADO_BASE);
    expect(dialogosDeNaoSalvo).toBe(0);
  });

  it("se o popstate nunca chegar, o desvio de uso único solta o Voltar depois da rede de segurança", async () => {
    await montar();
    // Um `history.back()` que não faz nada (aparelho que não entrega o popstate).
    vi.spyOn(window.history, "back").mockImplementation(() => {});
    await bipar(PRODUTO_SIMPLES.codigo);
    await clicarNoBotao("Fechar venda");
    await clicarNoBotao("Dinheiro");
    await clicarNoBotao("Registrar venda");
    await avancar(100);
    expect(hospedeiro.textContent).toContain("Compra na loja");

    // Desvio de uso único armado, esperando um popstate que não vem…
    expect(desvioDoApp).toBeInstanceOf(Function);
    // …e solto pela rede de segurança, para não engolir o Voltar de verdade.
    await avancar(1600);
    expect(desvioDoApp).toBeNull();
  });
});
