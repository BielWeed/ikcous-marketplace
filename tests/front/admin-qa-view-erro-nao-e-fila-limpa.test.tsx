// @vitest-environment jsdom
//
// Buraco de cobertura apontado pela revisão do conserto da "Fila Limpa":
// o teste de hook (qa-stats-erro-nao-e-fila-vazia.test.tsx) prova que
// getQAStats devolve { status: "error" } — mas NADA provava que a tela
// obedece. O revisor reverteu as cinco condicionais de `statsUnavailable`
// em AdminQAView.tsx e a suíte inteira continuou com o mesmo placar
// (501 passando, 1 falha preexistente): a metade do conserto que a pessoa
// VÊ podia ser desfeita sem nenhum teste reclamar. E o defeito original foi
// descrito em termos de tela — "o cartão passa a dizer Fila Limpa".
//
// POR QUE RENDER DE VERDADE (createRoot + act, sem @testing-library — mesmo
// padrão de admin-products-esgotado.test.tsx e checkout-view-flag-off.test.tsx):
// quem tinha o pedaço restante do defeito é a ÁRVORE RENDERIZADA — as
// condicionais dentro do useMemo `kpiCards` de AdminQAView. Um teste da
// função pura ou de outro componente continuaria verde com elas desfeitas.
// Aqui quem é montado é a própria view, com o hook useQuestions dublado
// logo abaixo (o comportamento do hook já tem prova própria no arquivo
// citado acima).
//
// Os três estados que precisam chegar DIFERENTES à tela:
//   1. consulta que falha     -> filtro, resumo e cartões mostram "—", a linha
//                                diz "Erro ao atualizar", o rodapé "Não foi
//                                possível carregar agora"; JAMAIS "0", "0%"
//                                nem "Fila de perguntas limpa"
//   2. loja legitimamente vazia -> "Fila de perguntas limpa" TEM de aparecer
//                                (controle positivo: sem isto, um teste que só
//                                checa ausência passaria até com tela em branco)
//   3. loja com pendências    -> números na tela, nenhum sinal de erro
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Estado trocado por cada teste antes de montar — é o que os dublês de
// useQuestions devolvem. Identidades dos callbacks são ESTÁVEIS de propósito:
// se mudassem a cada render, os useEffect de AdminQAView que dependem delas
// (fetchStats, loadQuestions) disparariam em cascata infinita.
const h = vi.hoisted(() => {
  const estado = {
    // Resultado que o getQAStats dublê resolve — um QAStatsResult por teste.
    stats: { status: "error", error: { message: "HTTP 500" } } as unknown,
    // Perguntas da lista (o caminho separado das estatísticas).
    perguntas: [] as unknown[],
  };

  async function getQAStats(): Promise<unknown> {
    return estado.stats;
  }

  function getAllQuestions() {
    return Promise.resolve({
      questions: estado.perguntas,
      total: estado.perguntas.length,
    });
  }

  function subscribeToQuestions() {
    return () => {};
  }

  return { estado, getQAStats, getAllQuestions, subscribeToQuestions };
});

vi.mock("@/hooks/useQuestions", () => ({
  useQuestions: () => ({
    questions: h.estado.perguntas,
    loading: false,
    getQuestionsByProduct: vi.fn(),
    getAllQuestions: h.getAllQuestions,
    addQuestion: vi.fn(),
    addAnswer: vi.fn(),
    deleteQuestion: vi.fn(),
    subscribeToQuestions: h.subscribeToQuestions,
    getQAStats: h.getQAStats,
  }),
}));

vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => false,
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    loading: vi.fn(),
  },
}));

// jsdom não implementa IntersectionObserver -- LazyImage cria um a cada
// montagem quando há pergunta na lista.
class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// jsdom não implementa ResizeObserver -- embla-carousel-react (usado pelo
// AdminKpiCarousel, que renderiza os cartões de verdade) cria um a cada
// montagem.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão de
// checkout-view-flag-off.test.tsx.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function montarPerguntaPendente() {
  h.estado.perguntas = [
    {
      id: "q-1",
      userId: "cliente-1",
      productId: "prod-1",
      productName: "Produto de Teste",
      customerName: "Maria Teste",
      question: "Vocês enviam para o interior?",
      createdAt: new Date("2026-08-20T10:00:00Z").toISOString(),
      answers: [],
    },
  ];
}

describe("AdminQAView na tela — erro de estatística nunca vira 'Fila Limpa'", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    h.estado.stats = { status: "error", error: { message: "HTTP 500" } };
    h.estado.perguntas = [];

    vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    // O jsdom desta versão não expõe `window.localStorage` como Storage de
    // verdade (`getItem is not a function`) — a view usa para filtro, página,
    // busca e modo de visualização. Dublê em memória, como nos demais testes.
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
    vi.restoreAllMocks();
  });

  async function montar() {
    const { AdminQAView } = await import("@/views/admin/AdminQAView");

    await act(async () => {
      raiz.render(<AdminQAView onNavigate={() => {}} active={true} />);
    });
    // Deixa fetchStats (promessa assíncrona do dublê) resolver e o React
    // commitar o estado resultante.
    await act(async () => {
      await esperarMicrotarefas();
    });
  }

  /** Texto integral da tela montada — mesma leitura de DOM de
   * checkout-view-flag-off.test.tsx, com os espaços normalizados. */
  function texto(): string {
    return (hospedeiro.textContent ?? "").replace(/\s+/g, " ");
  }

  async function expandirResumo() {
    const botao = Array.from(hospedeiro.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Expandir",
    );
    expect(botao).toBeTruthy();
    await act(async () => {
      botao!.click();
    });
  }

  it("CASO 1 — consulta que falha: '—', 'Erro ao atualizar', nunca zero nem fila limpa", async () => {
    h.estado.stats = { status: "error", error: { message: "HTTP 500" } };

    await montar();

    const tela = texto();

    // A mentira proibida: erro apresentado como fila vazia. O filtro
    // ("Pendentes N / Todas N"), a linha do resumo e o estado vazio da lista
    // têm, cada um, a sua condicional: com QUALQUER uma desfeita, "0", "0%"
    // ou "Fila de perguntas limpa" reaparecem aqui e este teste cai.
    expect(tela).not.toMatch(/Pendentes 0/);
    expect(tela).not.toMatch(/Todas 0/);
    expect(tela).not.toContain("0%");
    expect(tela).not.toContain("0 de 0");
    expect(tela).not.toContain("Fila de perguntas limpa");

    // A marcação honesta que LUGAR ALGUM mais garante: sem estas, uma tela
    // toda em branco passaria neste caso.
    expect(tela).toContain("Pendentes —");
    expect(tela).toContain("Todas —");
    expect(tela).toContain("— respondidas");
    expect(tela).toContain("Erro ao atualizar");
    // Fechado: filtro (2) + linha do resumo (1).
    expect((tela.match(/—/g) ?? []).length).toBe(3);

    // Aberto, os TRÊS cartões numéricos mostram o traço de indisponível —
    // nem dois, nem quatro. Desfazer a condicional de valor de QUALQUER um
    // derruba a contagem e este teste cai, mesmo sem o rótulo mudar.
    await expandirResumo();
    const aberta = texto();
    expect(aberta).toContain("Não foi possível carregar agora");
    expect(aberta).not.toContain("0%");
    expect(aberta).not.toContain("0 de 0");
    expect((aberta.match(/—/g) ?? []).length).toBe(5);
  });

  it("CASO 2 — controle positivo: fila legitimamente vazia MOSTRA 'Fila de perguntas limpa'", async () => {
    h.estado.stats = {
      status: "ok",
      total: 0,
      pending: 0,
      answered: 0,
      rate: 0,
    };

    await montar();

    const tela = texto();

    // Zero de verdade tem direito ao selo — é ele que distingue este estado
    // do de erro. Se alguém "consertar" escondendo o rótulo também aqui,
    // este teste cai junto.
    expect(tela).toContain("Fila de perguntas limpa");

    // E os zeros legítimos aparecem SEM cara de erro: "0%" e "0 de 0" são a
    // verdade aqui — é exatamente o que NÃO pode vazar no CASO 1.
    expect(tela).toContain("Pendentes 0");
    expect(tela).toContain("Todas 0");
    expect(tela).toContain("0% respondidas");
    expect(tela).toContain("0 de 0");
    expect(tela).not.toContain("Erro ao atualizar");
    expect(tela).not.toContain("—");
  });

  it("CASO 3 — loja com pendências: números na tela, nenhum sinal de erro", async () => {
    h.estado.stats = {
      status: "ok",
      total: 12,
      pending: 5,
      answered: 7,
      rate: 58,
    };
    montarPerguntaPendente();

    await montar();

    const tela = texto();

    // Os números chegam: 5 pendentes, 12 no total, taxa 58%, 7 de 12.
    expect(tela).toContain("Pendentes 5");
    expect(tela).toContain("Todas 12");
    expect(tela).toContain("58% respondidas");
    expect(tela).toContain("7 de 12");

    // E nenhuma marcação de erro vaza para um estado que não é de erro.
    expect(tela).not.toContain("Erro ao atualizar");
    expect(tela).not.toContain("Não foi possível carregar agora");

    // A lista em si também renderiza de verdade (caminho separado do stats).
    expect(tela).toContain("Maria Teste");
    expect(tela).toContain("Vocês enviam para o interior?");
    expect(tela).toContain("Pendente");
  });
});
