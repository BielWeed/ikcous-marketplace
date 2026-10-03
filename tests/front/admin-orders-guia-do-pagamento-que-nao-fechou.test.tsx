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
    "/src/lib/valor-devolver-agora.ts",
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
    // B2 (D2): com a janela do cartão em 14 dias, a cobrança que o app "não
    // reconheceu" pode ser reconhecida DEPOIS (vira "Pago fora do fluxo") —
    // "ainda", e "pode não aparecer", são verdade antes e depois do D2.
    expect(texto).toContain("o app ainda não reconheceu essa cobrança");
    expect(texto).toContain(
      "aqui pode não aparecer aviso nem botão de devolução",
    );
    expect(texto).toContain(
      "ou o pedido pode virar “Pago fora do fluxo” mais tarde, quando o app reconhecer",
    );
    expect(texto).toContain("devolva direto no painel do Mercado Pago");
    expect(texto).toContain("não cancela nada no Mercado Pago");
    // A ponte para o caso 2, sem espaço sobrando dentro das aspas (o rótulo
    // vem numa expressão JSX quebrada de linha).
    expect(texto).toContain(
      // B2b (revisão financeira): "PODE virar" — cobrança de valor
      // diferente do pedido nunca é adotada.
      "o pedido pode virar “Pago fora do fluxo — precisa de atenção” (veja abaixo)",
    );
  });

  // B2 (PLANO-LACUNAS item 5, mesmo lançamento do D2): o passo 2 do caso 1
  // ganha o MESMO aviso do caso 2. Depois do D2 (janela de 14 dias para o
  // cartão), a cobrança aprovada depois de cancelar/expirar chega como "Pago
  // fora do fluxo" — e o pedido aparece em "Estorno devido" com "Devolver R$
  // …". Quem já ENVIOU o produto por causa do passo 2 tem de saber que não é
  // para tocar ali; e o registro tem de estar na ficha.
  it("B2: caso 1, passo 2 — mesmo aviso do caso 2 (Anotações internas; não devolver depois de enviar; já devolvido = “Já estornei”)", async () => {
    await textoDoGuia();
    const listas = hospedeiro.querySelectorAll("ol");
    expect(listas.length).toBe(2);
    // B2b: o que era UM item de ~8 frases virou um item com sub-lista —
    // leigo lê uma coisa por linha.
    const subLista = listas.item(0).querySelector("ul");
    expect(
      subLista,
      "sub-lista do cancelado com pagamento aprovado",
    ).toBeTruthy();
    const itens = Array.from(subLista!.querySelectorAll("li")).map((li) =>
      (li.textContent ?? "").replace(/\s+/g, " ").trim(),
    );
    const passo2 = itens.join(" ");
    expect(passo2).toContain("escreva em “Anotações internas” da ficha");
    // B2b rodada 3 (revisão do front): "Nos dois casos" logo depois de "Só
    // nesse caso" confundia — os dois casos são devolver ou enviar.
    expect(passo2).not.toContain("Nos dois casos");
    expect(passo2).toContain(
      "Tanto se você devolveu quanto se enviou, escreva em “Anotações internas” da ficha",
    );
    expect(passo2).toContain(
      "produto enviado em [data], combinado com o cliente, não devolver",
    );
    // B2b (revisão do front): o “Devolver R$ …” mora na FICHA do pedido
    // (quadro “Devolução de dinheiro”), não na lista “Estorno devido” — que
    // só tem “Já estornei no Mercado Pago”.
    expect(passo2).toContain(
      "a ficha do pedido passar a mostrar “Devolver R$ …”, no quadro “Devolução de dinheiro”, não toque nele: depois de enviar, devolver é perder o produto e o dinheiro",
    );
    expect(passo2).not.toMatch(/“Estorno devido” com o botão “Devolver/);
    expect(passo2).toContain(
      "toque em “Já estornei no Mercado Pago”, na lista “Devolver agora”",
    );
    // B2b (revisão financeira): a corrida — cancelou no instante em que o
    // webhook confirmou, e o servidor já criou a devolução automática.
    expect(itens.at(0)).toContain(
      "Se o pedido aparecer em “Estorno devido” com o aviso “Devolução em andamento”, o Mercado Pago já está devolvendo o dinheiro ao cliente (ou analisando uma disputa): não envie o produto nem devolva por outro meio",
    );
    // B2b rodada 2 (revisão financeira): a FALTA do aviso não prova que o
    // app não reconheceu a cobrança. Com a leitura pendente ou falha, a
    // devolução automática pode estar andando sem aviso nenhum na tela.
    expect(itens.at(1)).toContain(
      "Se o aviso for “Conferindo se o Mercado Pago já está devolvendo…” ou “Não deu para conferir…”, a devolução pode já estar a caminho: não envie o produto nem devolva por outro meio até o aviso mudar — ou abra o pedido e veja o quadro “Devolução de dinheiro”",
    );
    // A devolução automática que CONCLUIU tira o pedido de "Estorno devido"
    // (nada mais a devolver) e o selo vira "Estornado" — sem isto, "não
    // aparece em Estorno devido" voltaria a mandar combinar o envio.
    // B2b rodada 3 (revisão financeira): o MP transforma TODO chargeback em
    // `estornado` (_shared/mercadopago.ts, charged_back e
    // charged_back:in_process/settled/reimbursed) — em `reimbursed` a loja
    // ganhou a disputa e o dinheiro ficou com ELA. "Estornado" não prova que
    // o dinheiro voltou ao cliente: manda conferir no painel do MP.
    const linhaEstornado = itens.at(2) ?? "";
    expect(linhaEstornado).toContain(
      "Se o selo de pagamento do pedido mostrar “Estornado”, o Mercado Pago registrou uma devolução ou uma contestação (chargeback) desse pagamento: não envie o produto antes de conferir no painel do Mercado Pago se o dinheiro voltou ao cliente",
    );
    expect(linhaEstornado).not.toContain("já voltou ao cliente");
    expect(passo2).not.toContain("já voltou ao cliente");
    // O ramo "não reconheceu" depende do pedido FORA de "Estorno devido" e do
    // selo — nunca da ausência do aviso.
    expect(passo2).not.toContain("Sem esse aviso");
    const naoReconheceu = itens.findIndex((i) =>
      i.includes("o app ainda não reconheceu essa cobrança"),
    );
    expect(itens.at(naoReconheceu)).toContain(
      "Se o pedido não aparecer em “Estorno devido” e o selo de pagamento dele não começar com “Pago” nem com “Estornado”, o app ainda não reconheceu essa cobrança",
    );
    // "combine o envio" só existe na linha logo abaixo, presa a ESSE caso.
    const combine = itens.filter((i) => i.includes("combine o envio"));
    expect(combine).toHaveLength(1);
    expect(itens.at(naoReconheceu + 1)).toMatch(
      /^Só nesse caso, devolva direto no painel do Mercado Pago, ou combine o envio com o cliente\./,
    );
    expect(promessasDeDevolucaoSozinha(passo2)).toEqual([]);
    // Uma coisa por linha: nenhum item da sub-lista passa de 2 frases.
    for (const item of itens) {
      const frases = item.split(/[.!?](?:\s|$)/).filter((f) => f.trim());
      expect(frases.length, item).toBeLessThanOrEqual(2);
    }
  });

  // B1 × guia: cancelar pedido PAGO e não enviado faz o app pedir a
  // devolução ao MP sozinho. O caso 1 é um pedido AGUARDANDO (não pago), e
  // o "Nada é devolvido sozinho" só pode estar no caso 2 (pago_apos_expirar:
  // o cancelamento aconteceu ANTES do dinheiro, então nenhuma linha
  // automática nasce — update_order_status_atomic só a grava na transição
  // para cancelled com pago).
  it("B1 × guia: 'Nada é devolvido sozinho' só aparece no caso 2, nunca no caso 1 (pedido aguardando)", async () => {
    await textoDoGuia();
    const cartoes = hospedeiro.querySelectorAll("div.rounded-2xl");
    expect(cartoes.length).toBe(2);
    const caso1 = cartoes.item(0).textContent ?? "";
    const caso2 = cartoes.item(1).textContent ?? "";
    expect(caso1).toContain("“Aguardando pagamento”");
    expect(caso1).not.toMatch(/Nada é devolvido sozinho/i);
    expect(caso2).toContain("Nada é devolvido sozinho");
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
      // B2b: o termo do aviso por pedido na lista "Devolver agora" — o guia
      // e a lista importam a MESMA constante, e a lista a desenha.
      {
        rotulo: 'TERMO_EM_ANDAMENTO = "Devolução em andamento"',
        arquivo: "src/lib/valor-devolver-agora.ts",
      },
      {
        rotulo: "{TERMO_EM_ANDAMENTO}",
        arquivo: "src/views/admin/AlertasCancelados.tsx",
      },
      {
        rotulo: "{TERMO_EM_ANDAMENTO} sem confirmação",
        arquivo: "src/views/admin/AlertasCancelados.tsx",
      },
      // B2b rodada 2: os dois avisos do estado desconhecido da lista.
      {
        rotulo: "Conferindo se o Mercado Pago já está devolvendo…",
        arquivo: "src/views/admin/AlertasCancelados.tsx",
      },
      {
        rotulo: "Não deu para conferir se o Mercado Pago já está",
        arquivo: "src/views/admin/AlertasCancelados.tsx",
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
    expect(texto).toContain("“Devolução em andamento”");
    expect(texto).toContain(
      "“Conferindo se o Mercado Pago já está devolvendo…”",
    );
    expect(texto).toContain("“Não deu para conferir…”");
    // Rótulos de selo vêm do config do selo (não de cópia).
    expect(texto).toContain("“Estornado”");
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
