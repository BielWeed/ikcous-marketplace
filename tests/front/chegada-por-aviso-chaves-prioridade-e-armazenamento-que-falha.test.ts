// @vitest-environment jsdom
// `src/utils/chegada-por-aviso.ts`, a função pura por baixo dos testes de tela
// (`aviso-leva-a-tela-sem-filtro-guardado`, `admin-reviews-filtra-o-que-esta-sem-resposta`):
// o que eles deixavam passar (caça por mutação).
//
//  - as chaves que cada tela guarda são APAGADAS uma a uma, e só as dela;
//  - o filtro de moderação só é gravado para a tela Avaliações (aviso de outra
//    tela com opções não escreve na chave das Avaliações);
//  - se vierem "só em moderação" e "só sem resposta" juntos, vale a moderação;
//  - armazenamento que falha (modo privado, cota cheia) não derruba o aviso: a
//    tela ainda é avisada da chegada e abre nos padrões.
import {
  type OpcoesDeChegada,
  aoChegarPorAviso,
  limparGuardadosAoChegarPorAviso,
} from "@/utils/chegada-por-aviso";
import { afterEach, describe, expect, it, vi } from "vitest";

const CHAVES_DE_PERGUNTAS = [
  "admin_qa_filter",
  "admin_qa_page",
  "admin_qa_search_query",
];
const CHAVES_DE_AVALIACOES = [
  "admin_reviews_page",
  "admin_reviews_search_query",
  "admin_reviews_rating_filter",
  "admin_reviews_status_filter",
];

afterEach(() => {
  window.localStorage.clear();
});

function guardar(chaves: string[]) {
  for (const chave of chaves) window.localStorage.setItem(chave, '"velho"');
}

describe("quais chaves cada tela perde", () => {
  it("Perguntas: as três dela somem; as das Avaliações e uma alheia ficam", () => {
    guardar([...CHAVES_DE_PERGUNTAS, ...CHAVES_DE_AVALIACOES, "outra_chave"]);
    limparGuardadosAoChegarPorAviso("admin-qa");
    for (const chave of CHAVES_DE_PERGUNTAS) {
      expect(window.localStorage.getItem(chave), chave).toBeNull();
    }
    for (const chave of [...CHAVES_DE_AVALIACOES, "outra_chave"]) {
      expect(window.localStorage.getItem(chave), chave).toBe('"velho"');
    }
  });

  it("Avaliações: as quatro dela somem; as das Perguntas e uma alheia ficam", () => {
    guardar([...CHAVES_DE_PERGUNTAS, ...CHAVES_DE_AVALIACOES, "outra_chave"]);
    limparGuardadosAoChegarPorAviso("admin-reviews");
    for (const chave of CHAVES_DE_AVALIACOES) {
      expect(window.localStorage.getItem(chave), chave).toBeNull();
    }
    for (const chave of [...CHAVES_DE_PERGUNTAS, "outra_chave"]) {
      expect(window.localStorage.getItem(chave), chave).toBe('"velho"');
    }
  });

  it("tela que não guarda nada (Pedidos) não apaga nada", () => {
    guardar([...CHAVES_DE_PERGUNTAS, ...CHAVES_DE_AVALIACOES]);
    limparGuardadosAoChegarPorAviso("admin-orders");
    for (const chave of [...CHAVES_DE_PERGUNTAS, ...CHAVES_DE_AVALIACOES]) {
      expect(window.localStorage.getItem(chave), chave).toBe('"velho"');
    }
  });
});

describe("o filtro de moderação das Avaliações", () => {
  it("vindo os DOIS pedidos, vale a moderação ('pendente')", () => {
    limparGuardadosAoChegarPorAviso("admin-reviews", {
      soEmModeracao: true,
      soSemResposta: true,
    });
    expect(window.localStorage.getItem("admin_reviews_status_filter")).toBe(
      JSON.stringify("pendente"),
    );
  });

  it("só 'sem resposta': grava 'sem_resposta'", () => {
    limparGuardadosAoChegarPorAviso("admin-reviews", { soSemResposta: true });
    expect(window.localStorage.getItem("admin_reviews_status_filter")).toBe(
      JSON.stringify("sem_resposta"),
    );
  });

  it("aviso de OUTRA tela com opções não escreve na chave das Avaliações", () => {
    limparGuardadosAoChegarPorAviso("admin-qa", { soEmModeracao: true });
    limparGuardadosAoChegarPorAviso("admin-orders", { soSemResposta: true });
    expect(
      window.localStorage.getItem("admin_reviews_status_filter"),
    ).toBeNull();
  });

  it("e não deixa um filtro guardado de antes sobreviver quando a chegada é comum", () => {
    window.localStorage.setItem(
      "admin_reviews_status_filter",
      JSON.stringify("pendente"),
    );
    limparGuardadosAoChegarPorAviso("admin-reviews");
    expect(
      window.localStorage.getItem("admin_reviews_status_filter"),
    ).toBeNull();
  });
});

// Um armazenamento de mentira que falha só no método pedido (o ambiente de
// teste troca o `localStorage` por um objeto simples; ver
// `setup-build-identity.ts`, então `Storage.prototype` não vale aqui).
function armazenamentoQueFalhaEm(metodo: "removeItem" | "setItem"): Storage {
  return {
    length: 0,
    clear: () => {},
    getItem: () => null,
    key: () => null,
    removeItem: () => {
      if (metodo === "removeItem") throw new Error("sem armazenamento");
    },
    setItem: () => {
      if (metodo === "setItem") throw new Error("cota cheia");
    },
  };
}

describe("armazenamento que falha não derruba o aviso", () => {
  function escutar() {
    const chegadas: OpcoesDeChegada[] = [];
    const cancelar = aoChegarPorAviso("admin-reviews", (opcoes) =>
      chegadas.push(opcoes),
    );
    return { chegadas, cancelar };
  }

  it("apagar falha: não lança e a tela ainda é avisada", () => {
    vi.stubGlobal("localStorage", armazenamentoQueFalhaEm("removeItem"));
    const { chegadas, cancelar } = escutar();
    expect(() =>
      limparGuardadosAoChegarPorAviso("admin-reviews"),
    ).not.toThrow();
    expect(chegadas).toEqual([{}]);
    cancelar();
  });

  it("gravar o filtro falha: não lança e a tela ainda é avisada com o pedido", () => {
    vi.stubGlobal("localStorage", armazenamentoQueFalhaEm("setItem"));
    const { chegadas, cancelar } = escutar();
    expect(() =>
      limparGuardadosAoChegarPorAviso("admin-reviews", { soEmModeracao: true }),
    ).not.toThrow();
    expect(chegadas).toEqual([{ soEmModeracao: true }]);
    cancelar();
  });
});
