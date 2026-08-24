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

import type { Aviso } from "@/utils/avisos-do-lojista";

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
