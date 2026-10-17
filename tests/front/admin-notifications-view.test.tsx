// @vitest-environment jsdom
//
// A tela de Notificacoes do lojista — a que o sino da barra de cima entrega.
//
// O que ela e: uma lista do que esta ESPERANDO o lojista. Nao envia nada
// para cliente nenhum (isso e a "Avisar clientes", outra tela) e nao tem
// regra de negocio: quem decide o que vira aviso, em que ordem e o que
// conta no cracha e o `montarAvisos`, ja testado a parte.
//
// As duas coisas que este arquivo existe para prender:
//
// 1. O CLIQUE LEVA AO ITEM, com o ID. Um aviso que leva para a lista certa
//    mas sem o id obriga o lojista a procurar de novo o pedido que ele
//    acabou de ver na tela anterior — que e exatamente o defeito que esta
//    tela nasceu para consertar. Por isso os casos assertam o SEGUNDO
//    argumento de `onNavigate`, nao so o primeiro.
// 2. OS DOIS BLOCOS SAO DIFERENTES. "Precisa de voce" e o que conta no
//    cracha; "De olho" e o estoque, que nao conta. Os casos contam os itens
//    de cada bloco em vez de procurar um texto — texto de titulo muda com o
//    dado, e a asserção passaria a medir a fixture em vez da separacao.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type Aviso, montarAvisos } from "@/utils/avisos-do-lojista";

// Reatribuiveis e lidos no momento da renderizacao: e assim que cada caso
// troca o retorno do hook sem remontar o dible inteiro.
let AVISOS: Aviso[] = [];
let FONTES_COM_FALHA: string[] = [];
let CARREGANDO = false;

const { recarregarFalso } = vi.hoisted(() => ({ recarregarFalso: vi.fn() }));

vi.mock("@/hooks/useAvisosDoLojista", () => ({
  useAvisosDoLojista: () => ({
    avisos: AVISOS,
    quantidadeNoCracha: AVISOS.filter((aviso) => aviso.contaNoCracha).length,
    carregando: CARREGANDO,
    fontesComFalha: FONTES_COM_FALHA,
    recarregar: recarregarFalso,
  }),
}));

// @ts-expect-error flag interna do React, sem tipo publico — mesmo padrao
// dos vizinhos deste diretorio.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const AVISO_DE_PEDIDO: Aviso = {
  id: "pedido-ped-1",
  tipo: "pedido",
  titulo: "Pedido de Maria esperando você",
  detalhe: "R$ 90,00",
  quando: "2026-08-24T10:00:00.000Z",
  destino: { view: "admin-orders", id: "ped-1" },
  contaNoCracha: true,
};

const AVISO_DE_PERGUNTA: Aviso = {
  id: "perguntas",
  tipo: "pergunta",
  titulo: "3 perguntas sem resposta",
  detalhe: "Clientes perguntaram sobre seus produtos",
  quando: "",
  destino: { view: "admin-qa" },
  contaNoCracha: true,
};

const AVISO_DE_AVALIACAO: Aviso = {
  id: "avaliacao-av-1",
  tipo: "avaliacao",
  titulo: "Avaliação de 2 estrelas sem resposta",
  detalhe: "Caneta 3D",
  quando: "2026-08-24T09:00:00.000Z",
  destino: { view: "admin-reviews" },
  contaNoCracha: true,
};

const AVISO_DE_ESTOQUE: Aviso = {
  id: "estoque-prod-1",
  tipo: "estoque",
  titulo: "Caneta 3D está acabando",
  detalhe: "Resta 1 unidade",
  quando: "2026-08-20T10:00:00.000Z",
  destino: { view: "admin-product-form", id: "prod-1" },
  contaNoCracha: false,
};

let raiz: Root | null = null;
let container: HTMLDivElement | null = null;
const onNavigate = vi.fn();

async function montar() {
  const { AdminNotificationsView } = await import(
    "@/views/admin/AdminNotificationsView"
  );
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);

  await act(async () => {
    raiz?.render(<AdminNotificationsView onNavigate={onNavigate} />);
  });

  return container;
}

function avisosDoBloco(bloco: string) {
  return Array.from(
    container?.querySelectorAll(`[data-bloco="${bloco}"] [data-aviso]`) ?? [],
  );
}

function todosOsAvisos() {
  return Array.from(container?.querySelectorAll("[data-aviso]") ?? []);
}

function clicarNoAvisoDoTipo(tipo: string) {
  const alvo = container?.querySelector(`[data-aviso="${tipo}"]`);
  if (!alvo) throw new Error(`nao achei um aviso do tipo "${tipo}" na tela`);
  act(() => {
    (alvo as HTMLElement).click();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  AVISOS = [
    AVISO_DE_PEDIDO,
    AVISO_DE_PERGUNTA,
    AVISO_DE_AVALIACAO,
    AVISO_DE_ESTOQUE,
  ];
  FONTES_COM_FALHA = [];
  CARREGANDO = false;
});

afterEach(() => {
  if (raiz) {
    const aFechar = raiz;
    act(() => {
      aFechar.unmount();
    });
  }
  raiz = null;
  container = null;
  document.body.innerHTML = "";
});

describe("AdminNotificationsView", () => {
  it("com um aviso de cada tipo, mostra quatro linhas clicaveis", async () => {
    await montar();

    expect(todosOsAvisos()).toHaveLength(4);
    expect(todosOsAvisos().map((no) => no.getAttribute("data-aviso"))).toEqual(
      expect.arrayContaining(["pedido", "pergunta", "avaliacao", "estoque"]),
    );
  });

  it("clicar no aviso de pedido leva ao PEDIDO, com o id", async () => {
    await montar();

    clicarNoAvisoDoTipo("pedido");

    // O id e o que separa "abre a lista de pedidos" de "abre ESTE pedido".
    // Sem ele o lojista volta a procurar na mao o que acabou de ver.
    expect(onNavigate).toHaveBeenCalledWith("admin-orders", "ped-1");
  });

  it("clicar no aviso de estoque leva ao PRODUTO, com o id", async () => {
    await montar();

    clicarNoAvisoDoTipo("estoque");

    expect(onNavigate).toHaveBeenCalledWith("admin-product-form", "prod-1");
  });

  it("aviso sem id chama onNavigate sem segundo argumento", async () => {
    await montar();

    clicarNoAvisoDoTipo("pergunta");

    // `montarAvisos` nao poe id no aviso de pergunta: a tela de Q&A nao abre
    // uma pergunta so. Passar `undefined` de proposito e diferente de passar
    // um id errado — e esta asserção separa os dois.
    expect(onNavigate).toHaveBeenCalledWith("admin-qa", undefined);
  });

  it("sem nenhum aviso, mostra a tela vazia e ZERO linha clicavel", async () => {
    AVISOS = [];

    const raizDom = await montar();

    expect(todosOsAvisos()).toHaveLength(0);
    expect(raizDom.textContent).toContain("Tudo em dia");
    // O sino acende por devolucao solicitada; a frase que afirma "nada esperando"
    // tem de listar a devolucao junto com as outras fontes.
    expect(raizDom.textContent).toContain("devolução");
  });

  it("o estoque fica no bloco De olho e os outros tres no Precisa de voce", async () => {
    await montar();

    // Contagem por bloco, nao presenca de texto: se a separacao cair, um dos
    // dois numeros muda, e nenhum titulo de fixture entra na conta.
    expect(avisosDoBloco("precisa-de-voce")).toHaveLength(3);
    expect(avisosDoBloco("de-olho")).toHaveLength(1);
    expect(
      avisosDoBloco("de-olho").map((no) => no.getAttribute("data-aviso")),
    ).toEqual(["estoque"]);
  });

  it("bloco sem item nenhum some inteiro", async () => {
    AVISOS = [AVISO_DE_ESTOQUE];

    await montar();

    expect(container?.querySelector('[data-bloco="precisa-de-voce"]')).toBe(
      null,
    );
    expect(avisosDoBloco("de-olho")).toHaveLength(1);
  });

  it("com uma fonte com falha, avisa E continua listando o resto", async () => {
    FONTES_COM_FALHA = ["avaliacao"];
    AVISOS = [AVISO_DE_PEDIDO, AVISO_DE_PERGUNTA, AVISO_DE_ESTOQUE];

    const raizDom = await montar();

    // As duas pontas na mesma rodada: o recado aparece E a lista sobrevive.
    // Tela em branco com um recado de erro seria pior que o defeito.
    expect(raizDom.textContent).toContain("avaliações");
    expect(todosOsAvisos()).toHaveLength(3);
  });

  it("com fonte com falha e lista vazia, NAO diz 'Tudo em dia'", async () => {
    FONTES_COM_FALHA = ["avaliacao"];
    AVISOS = [];

    const raizDom = await montar();

    // "Tudo em dia" afirma que nada esta esperando — e a tela nao conferiu
    // nada. O proprio hook ja escolheu dizer a verdade ("nao consegui
    // conferir X"), e a tela nao pode desmentir a fonte dela na linha de
    // baixo. As duas pontas na mesma rodada: o recado fica E a mentira sai.
    expect(raizDom.textContent).not.toContain("Tudo em dia");
    expect(raizDom.textContent).toContain("avaliações");
  });

  it("durante a carga, NAO pisca 'Tudo em dia' antes da lista chegar", async () => {
    CARREGANDO = true;
    AVISOS = [];

    const raizDom = await montar();

    // A guarda `!carregando` da tela existe para isto. Sem este caso ela e
    // mutante sobrevivente: quem apagar o `!carregando` faz "Tudo em dia"
    // piscar em TODA primeira carga e a suite inteira continua verde.
    expect(raizDom.textContent).not.toContain("Tudo em dia");
    expect(todosOsAvisos()).toHaveLength(0);
  });

  it("o botao de atualizar chama recarregar do hook", async () => {
    await montar();

    const botao = container?.querySelector('[data-acao="recarregar"]');
    if (!botao) throw new Error("nao achei o botao de atualizar");
    act(() => {
      (botao as HTMLElement).click();
    });

    expect(recarregarFalso).toHaveBeenCalledTimes(1);
  });
});

describe("AvisoCard — desenho aprovado v5", () => {
  it("o cartão é um botão com borda, superfície escura e alvo mínimo de 44px", async () => {
    await montar();
    const cartao = container?.querySelector('[data-aviso="pedido"]');
    expect(cartao).not.toBeNull();
    for (const classe of ["rounded-2xl", "min-h-11", "bg-[#101013]"]) {
      expect(cartao?.classList.contains(classe)).toBe(true);
    }
    expect(cartao?.className).toContain("border-white/10");
    // Seta no padrão novo: ChevronRight de 20px.
    expect(
      cartao?.querySelector("svg.lucide-chevron-right.size-5"),
    ).not.toBeNull();
  });

  it("o rótulo do tipo é legível (nada de cinza 500) e o nome do aviso é 15px", async () => {
    await montar();
    const cartao = container?.querySelector('[data-aviso="pedido"]');
    const rotulo = cartao?.querySelector("span.uppercase");
    expect(rotulo?.className).not.toMatch(/text-zinc-[567]00/);
    expect((cartao as HTMLElement).style.color).toBe("rgb(52, 211, 153)");
    expect(rotulo?.className).not.toContain("text-zinc-");
    expect(cartao?.querySelector("h3")?.className).toContain("text-[15px]");
  });

  it("a legenda do bloco também passa do cinza 500", async () => {
    await montar();
    const legenda = container?.querySelector('[data-bloco="de-olho"] p');
    expect(legenda).not.toBeNull();
    expect(legenda?.className).not.toMatch(/text-zinc-[567]00/);
  });

  it("o texto da tela vazia também passa do cinza 500", async () => {
    AVISOS = [];
    const raizDom = await montar();
    const texto = Array.from(raizDom.querySelectorAll("p")).find((p) =>
      p.textContent?.includes("Nenhum pedido"),
    );
    expect(texto).toBeTruthy();
    expect(texto?.className).not.toMatch(/text-zinc-[567]00/);
  });
});

// Usa o montador real: não inventa campos que o hook não entrega à tela.
function oitoTipos() {
  return montarAvisos({
    pedidos: [
      {
        id: "pedido-1",
        customer_name: "Maria Cecília de Albuquerque Vasconcelos",
        total: 128949.9,
        created_at: "2026-10-17T12:38:00Z",
      },
    ],
    cancelamentosDoCliente: [
      {
        id: "cancelamento-1",
        order_id: "cancelado-1",
        customer_name: "Nina Duarte",
        total: 179.9,
        created_at: "2026-10-17T08:40:00Z",
        situacao: "reembolso_automatico",
      },
    ],
    devolucoesSolicitadas: 27,
    pedidosDePrivacidadeAbertos: 12,
    recebimentosPorMarcar: [
      {
        id: "pedido-2DC8F4",
        customer_name: "Ana Beatriz Castelo Branco de Oliveira",
        total: 999999.99,
        updated_at: "2026-10-16T15:20:00Z",
      },
    ],
    perguntasPendentes: 38,
    avaliacoes: [
      {
        id: "av-1",
        product_id: "prod-1",
        nomeDoProduto:
          "Kit de organização para escritório com 24 divisórias e acabamento em madeira natural",
        rating: 1,
        created_at: "2026-10-15T17:45:00Z",
      },
    ],
    produtos: [
      {
        id: "prod-1",
        name: "Conjunto de lençóis de algodão egípcio queen com quatro peças e fronha bordada",
        stock: 0,
        estoqueMinimo: 5,
        created_at: "2026-10-17T12:40:00Z",
      },
    ],
  });
}

describe("Notificações v5 — funções preservadas", () => {
  it("renderiza os oito tipos, sem mudar nenhum destino nem somar agregados ao sino", async () => {
    AVISOS = oitoTipos();
    const antes = JSON.stringify(AVISOS);
    Object.freeze(AVISOS);
    await montar();
    expect(todosOsAvisos().map((no) => no.getAttribute("data-aviso"))).toEqual([
      "privacidade",
      "pedido",
      "devolucao",
      "recebimento",
      "pergunta",
      "avaliacao",
      "cancelamento",
      "estoque",
    ]);
    expect(avisosDoBloco("precisa-de-voce")).toHaveLength(6);
    expect(avisosDoBloco("de-olho")).toHaveLength(2);
    expect(
      container?.querySelector('[data-bloco="precisa-de-voce"]')?.textContent,
    ).toContain("6 itens");
    for (const aviso of AVISOS) {
      clicarNoAvisoDoTipo(aviso.tipo);
      expect(onNavigate).toHaveBeenLastCalledWith(
        aviso.destino.view,
        aviso.destino.id,
      );
    }
    expect(onNavigate).toHaveBeenCalledTimes(8);
    expect(JSON.stringify(AVISOS)).toBe(antes);
  });

  it("prioriza privacidade com uma ação de 56px sem inventar prazo vencido", async () => {
    AVISOS = oitoTipos();
    await montar();
    const primeiro = avisosDoBloco("precisa-de-voce")[0];
    expect(primeiro?.getAttribute("data-aviso")).toBe("privacidade");
    expect(primeiro?.tagName).toBe("BUTTON");
    expect(primeiro?.querySelector(".min-h-14")?.textContent).toContain(
      "Revisar privacidade",
    );
    expect(primeiro?.textContent).toContain(
      "Responder em Ajustes > Minha loja",
    );
    expect(primeiro?.textContent).toContain("Prazo: 15 dias");
    expect(primeiro?.textContent).not.toContain("prazo vencido");
    act(() => (primeiro?.querySelector(".min-h-14") as HTMLElement).click());
    expect(onNavigate).toHaveBeenCalledWith("admin-settings", undefined);
  });

  it("mostra a pergunta inteira do pagamento, cliente, valor e consequência", async () => {
    AVISOS = oitoTipos();
    await montar();
    const pagamento = container?.querySelector('[data-aviso="recebimento"]');
    expect(pagamento?.textContent).toContain("Você já recebeu o pagamento?");
    expect(pagamento?.textContent).toContain(
      "Ana Beatriz Castelo Branco de Oliveira",
    );
    expect(pagamento?.textContent).toMatch(/R\$\s999\.999,99/);
    expect(pagamento?.textContent).toContain(
      "marque para a cliente poder pedir devolução",
    );
    expect(pagamento?.textContent).toContain("Entregue");
  });

  it("mantém nomes e detalhes longos inteiros, sem truncar títulos ou ancestrais", async () => {
    AVISOS = oitoTipos();
    await montar();
    expect(container?.textContent).toContain(
      "Maria Cecília de Albuquerque Vasconcelos",
    );
    expect(container?.textContent).toContain(
      "Conjunto de lençóis de algodão egípcio queen com quatro peças e fronha bordada acabou",
    );
    for (const aviso of todosOsAvisos()) {
      expect(aviso.querySelector("h3")).not.toBeNull();
      expect(
        aviso.querySelector(
          '[class*="truncate"], [class*="line-clamp"], [class*="whitespace-nowrap"]',
        ),
      ).toBeNull();
      expect(aviso.className).toContain("break-words");
    }
  });

  it.each([
    ["pago, o produto já saiu: avise o transporte", "Avise o transporte"],
    ["pago depois do cancelamento: confira o pedido", "Confira o pedido"],
  ])("destaca cancelamento pago: %s", async (frase, acao) => {
    AVISOS = [
      {
        ...oitoTipos().find((aviso) => aviso.tipo === "cancelamento")!,
        detalhe: `R$ 1.249,00 — ${frase}`,
      },
    ];
    await montar();
    const cancelamento = todosOsAvisos()[0];
    expect(cancelamento.textContent).toContain(frase);
    expect(cancelamento.textContent).toContain("R$ 1.249,00");
    // O hook entrega a mesma frase para pedido pago e para pedido já estornado:
    // a tela não pode afirmar "Pago" num selo.
    expect(
      cancelamento.querySelector("span.rounded-full")?.textContent,
    ).not.toBe("Pago");
    expect(cancelamento.innerHTML).not.toContain(">Pago<");
    expect(
      cancelamento.querySelector("[data-orientacao]")?.textContent,
    ).toContain(acao);
    clicarNoAvisoDoTipo("cancelamento");
    expect(onNavigate).toHaveBeenCalledWith("admin-orders", "cancelado-1");
  });

  it("preserva a orientação do cancelamento sem pagamento online", async () => {
    AVISOS = [
      {
        ...oitoTipos().find((aviso) => aviso.tipo === "cancelamento")!,
        titulo: "Pedido #61AC7D cancelado pela cliente",
        detalhe: "Não precisa separar nem enviar.",
      },
    ];
    await montar();
    const aviso = todosOsAvisos()[0];
    expect(aviso.textContent).toContain("Não precisa separar nem enviar.");
    expect(aviso.textContent).not.toContain("R$");
    expect(avisosDoBloco("de-olho")).toHaveLength(1);
    clicarNoAvisoDoTipo("cancelamento");
    expect(onNavigate).toHaveBeenCalledWith("admin-orders", "cancelado-1");
  });

  it("mantém os avisos durante a atualização, anuncia a carga e gira o ícone", async () => {
    CARREGANDO = true;
    await montar();
    expect(todosOsAvisos()).toHaveLength(4);
    expect(container?.querySelector('[role="status"]')?.textContent).toContain(
      "Atualizando os avisos...",
    );
    expect(
      container?.querySelector(
        '[aria-label="Atualizar os avisos"] .animate-spin',
      ),
    ).not.toBeNull();
  });

  it("oferece nova tentativa junto da falha parcial", async () => {
    FONTES_COM_FALHA = ["estoque", "recebimento"];
    await montar();
    const alerta = container?.querySelector('[role="alert"]');
    expect(alerta?.textContent).toContain("2 fontes sem atualização");
    expect(alerta?.textContent).toContain(
      "Não consegui conferir produtos, pagamentos por marcar agora.",
    );
    const botao = alerta?.querySelector("button");
    expect(botao?.textContent).toContain("Atualizar os avisos");
    act(() => botao?.click());
    expect(recarregarFalso).toHaveBeenCalledTimes(1);
    expect(todosOsAvisos()).toHaveLength(4);
  });
});

// O lojista fica sabendo quando o CLIENTE cancela (14/10/2026): o tipo novo
// no sino. Antes, o `Record<TipoDeAviso, ...>` da tela nem compilava com ele.
describe("AdminNotificationsView — cancelamento do cliente", () => {
  const PEDIDO = "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
  const AVISO_DE_CANCELAMENTO: Aviso = {
    id: "cancelamento:h1",
    tipo: "cancelamento",
    titulo: "Maria Silva cancelou o pedido #4F5A6B",
    detalhe: "R$ 149,90 — pago, o reembolso é automático",
    quando: "2026-10-14T11:57:00.000Z",
    destino: { view: "admin-orders", id: PEDIDO },
    contaNoCracha: false,
  };

  it("o cancelamento aparece no sino com o rotulo 'Cancelado', o titulo e a frase do dinheiro", async () => {
    AVISOS = [AVISO_DE_CANCELAMENTO];

    await montar();

    const linhas = todosOsAvisos();
    expect(linhas).toHaveLength(1);
    expect(linhas[0].getAttribute("data-aviso")).toBe("cancelamento");
    expect(linhas[0].textContent).toContain("Cancelado");
    expect(linhas[0].textContent).toContain(
      "Maria Silva cancelou o pedido #4F5A6B",
    );
    expect(linhas[0].textContent).toContain("pago, o reembolso é automático");
  });

  it("clicar leva ao PEDIDO cancelado, com o id", async () => {
    AVISOS = [AVISO_DE_CANCELAMENTO];

    await montar();
    clicarNoAvisoDoTipo("cancelamento");

    expect(onNavigate).toHaveBeenCalledWith("admin-orders", PEDIDO);
  });

  it("fica no bloco 'De olho' (nao conta no sino), nao em 'Precisa de voce'", async () => {
    AVISOS = [AVISO_DE_PEDIDO, AVISO_DE_CANCELAMENTO];

    await montar();

    expect(
      avisosDoBloco("precisa-de-voce").map((no) =>
        no.getAttribute("data-aviso"),
      ),
    ).toEqual(["pedido"]);
    expect(
      avisosDoBloco("de-olho").map((no) => no.getAttribute("data-aviso")),
    ).toEqual(["cancelamento"]);
  });

  it("fonte de cancelamento fora do ar: o recado cita 'cancelamentos de clientes' e a tela nao diz 'Tudo em dia'", async () => {
    FONTES_COM_FALHA = ["cancelamento"];
    AVISOS = [];

    const raizDom = await montar();

    expect(raizDom.textContent).toContain("cancelamentos de clientes");
    expect(raizDom.textContent).not.toContain("Tudo em dia");
  });
});
