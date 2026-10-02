// @vitest-environment jsdom
//
// C7 do ciclo de recuperação do cartão (02/10/2026): orientação ao LOJISTA
// para os dois casos de cartão que o servidor deixa para uma pessoa resolver
// (VEREDITO-A2, itens 2 e 6):
//   1. cartão em dúvida ("sem_registro"): o pedido segue aguardando, e
//      cancelar pelo painel devolve o estoque SEM cancelar nada no Mercado
//      Pago (update_order_status_atomic, 20261180000000, guarda só para
//      não-admin);
//   2. cobrança que chega depois do cancelamento: o webhook adota a vaga e
//      `confirmar_pagamento` grava `pago_apos_expirar` — nada é devolvido
//      sozinho.
//
// O guia mora no modal "Guia de Controle de Pedidos" (o "?" ao lado do
// título Pedidos), que é para onde o push "Pagamento fora do fluxo" leva
// (`url: "/admin-orders"`). Este teste prende três coisas:
//   - o guia está LIGADO ao modal da tela de Pedidos (montagem real da view);
//   - ele diz os fatos que o código sustenta e não promete devolução sozinha;
//   - todo rótulo de tela que ele manda o lojista procurar EXISTE no arquivo
//     que o desenha (contrato de não-invenção: renomear o botão sem atualizar
//     o guia quebra aqui, em vez de mandar o lojista atrás de um botão que
//     sumiu).
//
// Mesmo harness de admin-orders-acoes-pendentes-subtitulo-honesto.test.tsx
// (createRoot + act do React puro; sem @testing-library/react).
import type { Order } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn(),
    functions: { invoke: vi.fn() },
    channel: vi.fn(),
    removeChannel: vi.fn(),
  },
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {},
    isLoaded: true,
    updateConfig: vi.fn(),
  }),
}));

const mockOrders: Order[] = [];

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({
    orders: mockOrders,
    loadOrders: vi.fn(),
    updateOrderStatus: vi.fn(),
    totalOrders: 0,
    isLoaded: true,
    loading: false,
  }),
}));

vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({
    stats: null,
    fetchExecutiveSummary: vi.fn(),
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros testes de componente deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const TITULO_DO_GUIA = "Pagamento que não fechou sozinho";

// Fonte lida pelo Vite (`?raw`), mesmo padrão de
// acess-b6-skip-link-contrato.test.tsx — em jsdom o `import.meta.url` não é
// `file:` e `readFileSync` não serve.
const FONTES = import.meta.glob<string>(
  [
    "/src/components/admin/orders/EstornoCard.tsx",
    "/src/views/admin/AlertasCancelados.tsx",
    "/supabase/functions/webhook-mercadopago/index.ts",
    "/src/views/admin/AdminProductFormView.tsx",
    "/src/components/admin/orders/OrderDetail.tsx",
  ],
  { query: "?raw", import: "default", eager: true },
);

// `Map` em vez de `FONTES[caminho]`: indexação dinâmica acende
// security/detect-object-injection (e a catraca de lint conta warning).
const FONTES_POR_CAMINHO = new Map(Object.entries(FONTES));

function lerFonte(caminhoRelativoAoRepo: string): string {
  const caminho = `/${caminhoRelativoAoRepo}`;
  const fonte = FONTES_POR_CAMINHO.get(caminho);
  expect(fonte, `falta o fonte de ${caminho}`).toBeTypeOf("string");
  return fonte ?? "";
}

// Trava de "nada é devolvido sozinho" (revisão de front do C7, 02/10/2026):
// a 1ª versão só pegava termos COLADOS ("devolução autom…", "devolvido
// sozinho") e deixava passar "O estorno é automático: o app devolve…" e
// "Se você cancelar, o app devolve o dinheiro ao cliente." As regras abaixo
// não dependem de os termos estarem lado a lado. A ÚNICA exceção é a frase
// negada "Nada é devolvido sozinho", tirada do texto antes da busca.
const EXCECAO_NEGADA = /Nada é devolvido sozinho/g;
const REGRAS_DE_PROMESSA: readonly RegExp[] = [
  /autom[aá]tic\w*/gi,
  /(?:app|mercado pago)\s+devolve\w*/gi,
  /devolv\w*[^.]{0,40}sozinh\w*/gi,
];

function promessasDeDevolucaoSozinha(texto: string): string[] {
  const semExcecao = texto.replace(EXCECAO_NEGADA, "");
  return REGRAS_DE_PROMESSA.flatMap((regra) => semExcecao.match(regra) ?? []);
}

describe("Trava de promessa de devolução — pega as frases que a 1ª versão deixava passar", () => {
  it.each([
    ["g1", "O estorno é automático: o app devolve o dinheiro e avisa."],
    ["g2", "Se você cancelar, o app devolve o dinheiro ao cliente."],
    ["g3", "O Mercado Pago devolve sozinho em 7 dias."],
  ])("%s é recusada", (_nome, frase) => {
    expect(promessasDeDevolucaoSozinha(frase)).not.toEqual([]);
  });

  it("a frase negada sozinha não acende a trava", () => {
    expect(
      promessasDeDevolucaoSozinha("Nada é devolvido sozinho: a decisão é sua."),
    ).toEqual([]);
  });
});

describe("Guia do pagamento que não fechou — o que ele diz", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  async function textoDoGuia(): Promise<string> {
    const { GuiaDoPagamentoQueNaoFechou } = await import(
      "@/components/admin/orders/GuiaDoPagamentoQueNaoFechou"
    );
    await act(async () => {
      raiz.render(<GuiaDoPagamentoQueNaoFechou />);
    });
    return (hospedeiro.textContent ?? "").replace(/\s+/g, " ");
  }

  it("caso 1 (cartão em dúvida): mandar conferir o Mercado Pago ANTES de cancelar, e dizer que cancelar no painel não cancela a cobrança", async () => {
    const texto = await textoDoGuia();
    expect(texto).toContain(TITULO_DO_GUIA);
    // O rótulo que o lojista vê no selo do pedido — vem do MESMO config do
    // selo, não de uma cópia (OrderStatusBadge.tsx, `aguardando.label`).
    expect(texto).toContain("“Aguardando pagamento”");
    expect(texto).toContain("Antes de cancelar");
    expect(texto).toContain("painel do Mercado Pago");
    // Revisão financeira do C7: procurar pelo CLIENTE, não pelo valor (com
    // juros de parcelamento o valor do MP pode não ser o do pedido).
    expect(texto).toContain(
      "pelo nome ou e-mail do cliente, na data do pedido",
    );
    expect(texto).not.toContain("do mesmo valor");
    // Aprovado no MP pode virar "Pago" OU "Pago fora do fluxo" — e pode não
    // virar nada (valor divergente não é adotado, fora da janela ninguém
    // olha): aí a devolução é direto no MP.
    expect(texto).toContain(
      "o pedido vira “Pago”, ou “Pago fora do fluxo” se a confirmação chegar depois do prazo",
    );
    expect(texto).toContain("ele não reconheceu essa cobrança");
    expect(texto).toContain("Devolva direto no painel do Mercado Pago");
    expect(texto).toContain("não cancela nada no Mercado Pago");
    // A ponte para o caso 2, sem espaço sobrando dentro das aspas (o rótulo
    // vem numa expressão JSX quebrada de linha).
    expect(texto).toContain(
      "vira “Pago fora do fluxo — precisa de atenção” (veja abaixo)",
    );
  });

  it("caso 2 (pago fora do fluxo): usa o rótulo REAL do selo e diz que nada é devolvido sozinho", async () => {
    const texto = await textoDoGuia();
    expect(texto).toContain("“Pago fora do fluxo — precisa de atenção”");
    expect(texto).toContain("Nada é devolvido sozinho");
    expect(texto).toContain("o painel não reabre pedido cancelado");
    // Revisão financeira do C7: depois de ENVIAR, o pedido segue em "Estorno
    // devido" com o botão de devolver na ficha — o guia tem de mandar NÃO
    // tocar e deixar o registro em Anotações internas.
    expect(texto).toContain(
      "Esse pedido vai continuar no aviso de pedidos cancelados como “Estorno devido”, e a ficha dele vai continuar mostrando o botão “Devolver R$ …”.",
    );
    expect(texto).toContain(
      "Não toque nele: depois de enviar, devolver é perder o produto e o dinheiro.",
    );
    expect(texto).toContain(
      "escreva em “Anotações internas” da ficha: produto enviado em [data], combinado com o cliente, não devolver.",
    );
  });

  it("não promete devolução automática em lugar nenhum", async () => {
    const texto = await textoDoGuia();
    expect(promessasDeDevolucaoSozinha(texto)).toEqual([]);
    // A única frase sobre devolver sozinho é a NEGADA — e ela tem de estar lá.
    expect(texto).toContain("Nada é devolvido sozinho");
  });

  it("todo rótulo de tela citado pelo guia existe no arquivo que o desenha (nada inventado)", async () => {
    const texto = await textoDoGuia();
    const citacoes: Array<{ rotulo: string; arquivo: string }> = [
      // quadro da ficha do pedido + o botão "Devolver R$ …"
      {
        rotulo: "Devolução de dinheiro",
        arquivo: "src/components/admin/orders/EstornoCard.tsx",
      },
      {
        rotulo: "`Devolver ${formatCurrency",
        arquivo: "src/components/admin/orders/EstornoCard.tsx",
      },
      // a lista do aviso de cancelados e o registro do estorno feito fora
      {
        rotulo: "Devolver agora",
        arquivo: "src/views/admin/AlertasCancelados.tsx",
      },
      {
        rotulo: "Já estornei no Mercado Pago",
        arquivo: "src/views/admin/AlertasCancelados.tsx",
      },
      {
        rotulo: "Estorno devido",
        arquivo: "src/views/admin/AlertasCancelados.tsx",
      },
      // o campo de anotação da ficha do pedido
      {
        rotulo: "Anotações internas",
        arquivo: "src/components/admin/orders/OrderDetail.tsx",
      },
      // o push ao admin quando confirmar_pagamento devolve pago_apos_expirar
      {
        rotulo: 'title: "Pagamento fora do fluxo"',
        arquivo: "supabase/functions/webhook-mercadopago/index.ts",
      },
      // o campo de estoque do cadastro do produto
      {
        rotulo: "Quantidade em Estoque",
        arquivo: "src/views/admin/AdminProductFormView.tsx",
      },
    ];
    for (const { rotulo, arquivo } of citacoes) {
      expect(lerFonte(arquivo), `${rotulo} em ${arquivo}`).toContain(rotulo);
    }
    // ...e o guia cita cada um desses rótulos (na forma que o lojista lê).
    expect(texto).toContain("“Devolução de dinheiro”");
    expect(texto).toContain("“Devolver R$ …”");
    expect(texto).toContain("“Devolver agora”");
    expect(texto).toContain("“Já estornei no Mercado Pago”");
    expect(texto).toContain("“Estorno devido”");
    expect(texto).toContain("“Anotações internas”");
    expect(texto).toContain("“Pagamento fora do fluxo”");
    expect(texto).toContain("“Quantidade em Estoque”");
  });
});

describe("Guia do pagamento que não fechou — ligado ao modal de ajuda da tela de Pedidos", () => {
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
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
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
    vi.unstubAllGlobals();
  });

  it("o '?' ao lado do título Pedidos abre o guia com a seção nova", async () => {
    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");
    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={true} />);
    });

    // Fechado, o modal não renderiza nada (AdminHelpModal: `if (!isOpen)`).
    expect(document.body.textContent).not.toContain(TITULO_DO_GUIA);

    const botaoDeAjuda = hospedeiro.querySelector<HTMLButtonElement>(
      'button[title="Guia de Ajuda e Explicações"]',
    );
    expect(botaoDeAjuda).toBeTruthy();
    await act(async () => {
      botaoDeAjuda!.click();
    });

    // O modal é portal para document.body, não para o hospedeiro.
    const corpo = (document.body.textContent ?? "").replace(/\s+/g, " ");
    expect(corpo).toContain("Guia de Controle de Pedidos");
    expect(corpo).toContain(TITULO_DO_GUIA);
  });
});
