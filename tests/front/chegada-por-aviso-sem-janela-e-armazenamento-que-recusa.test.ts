// @vitest-environment jsdom
//
// A chegada por aviso (`src/utils/chegada-por-aviso.ts`) roda quando a lojista
// toca no aviso do sino. Os testes que já existiam provam o caminho feliz (a
// tela abre sem o filtro guardado). Aqui ficam as bordas em que a chegada NÃO
// pode travar a navegação, e a lista completa do que ela apaga:
//
//   - sem `window` (renderização fora do navegador): as duas funções não lançam
//     e a escuta devolve um cancelamento que também não lança;
//   - armazenamento que recusa (modo privado, cota cheia): a falha de UMA chave
//     não impede de limpar as outras, nem de gravar o filtro, nem de avisar a
//     tela pelo evento. Antes da guarda, o toque no aviso morria com a exceção
//     e a lojista ficava na tela de Avisos;
//   - cada tela apaga TODAS as chaves dela (nota, situação, busca e página) e
//     nenhuma das chaves da outra.
//
// O armazenamento é um dublê em memória (`vi.stubGlobal`), como nos outros
// testes desta área: o `localStorage` do jsdom conflita com o do Node.
import {
  aoChegarPorAviso,
  limparGuardadosAoChegarPorAviso,
} from "@/utils/chegada-por-aviso";
import { afterEach, describe, expect, it, vi } from "vitest";

const CHAVES_DE_AVALIACOES = [
  "admin_reviews_page",
  "admin_reviews_search_query",
  "admin_reviews_rating_filter",
  "admin_reviews_status_filter",
];
const CHAVES_DE_PERGUNTAS = [
  "admin_qa_filter",
  "admin_qa_page",
  "admin_qa_search_query",
];

interface Recusas {
  removeItem?: (chave: string) => void;
  setItem?: (chave: string, valor: string) => void;
}

/** Instala um armazenamento em memória; `recusas` troca um método por outro que lança. */
function instalarArmazem(recusas: Recusas = {}) {
  const armazem = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (c: string) => armazem.get(c) ?? null,
    setItem:
      recusas.setItem ??
      ((c: string, v: string) => {
        armazem.set(c, v);
      }),
    removeItem:
      recusas.removeItem ??
      ((c: string) => {
        armazem.delete(c);
      }),
  });
  return armazem;
}

function guardarTudo(armazem: Map<string, string>) {
  for (const chave of [...CHAVES_DE_AVALIACOES, ...CHAVES_DE_PERGUNTAS]) {
    armazem.set(chave, "guardado");
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sem janela do navegador", () => {
  it("limpar não lança e escutar devolve um cancelamento que não lança", () => {
    vi.stubGlobal("window", undefined);
    const ouvinte = vi.fn();

    expect(() => limparGuardadosAoChegarPorAviso("admin-qa")).not.toThrow();
    expect(() =>
      limparGuardadosAoChegarPorAviso("admin-reviews", {
        soEmModeracao: true,
      }),
    ).not.toThrow();

    let parar: (() => void) | undefined;
    expect(() => {
      parar = aoChegarPorAviso("admin-qa", ouvinte);
    }).not.toThrow();
    expect(typeof parar).toBe("function");
    expect(() => parar?.()).not.toThrow();
    expect(ouvinte).not.toHaveBeenCalled();
  });
});

describe("armazenamento que recusa", () => {
  it("remoção que lança em uma chave não impede de limpar as outras", () => {
    const armazem = instalarArmazem({
      removeItem: (chave) => {
        if (chave === "admin_reviews_page") throw new Error("cota cheia");
        armazem.delete(chave);
      },
    });
    guardarTudo(armazem);

    expect(() =>
      limparGuardadosAoChegarPorAviso("admin-reviews"),
    ).not.toThrow();

    expect(armazem.has("admin_reviews_page")).toBe(true);
    expect(armazem.has("admin_reviews_search_query")).toBe(false);
    expect(armazem.has("admin_reviews_rating_filter")).toBe(false);
    expect(armazem.has("admin_reviews_status_filter")).toBe(false);
  });

  it("remoção e gravação que lançam: não propaga e a tela ainda é avisada pelo evento", () => {
    instalarArmazem({
      removeItem: () => {
        throw new Error("modo privado");
      },
      setItem: () => {
        throw new Error("modo privado");
      },
    });
    const ouvinte = vi.fn();
    const parar = aoChegarPorAviso("admin-reviews", ouvinte);

    expect(() =>
      limparGuardadosAoChegarPorAviso("admin-reviews", {
        soSemResposta: true,
      }),
    ).not.toThrow();

    expect(ouvinte).toHaveBeenCalledTimes(1);
    expect(ouvinte).toHaveBeenCalledWith({ soSemResposta: true });
    parar();
  });

  it("só a gravação lança: a limpeza já feita fica feita e o evento sai", () => {
    const armazem = instalarArmazem({
      setItem: () => {
        throw new Error("cota cheia");
      },
    });
    armazem.set("admin_reviews_page", "3");
    const ouvinte = vi.fn();
    const parar = aoChegarPorAviso("admin-reviews", ouvinte);

    expect(() =>
      limparGuardadosAoChegarPorAviso("admin-reviews", {
        soEmModeracao: true,
      }),
    ).not.toThrow();

    expect(armazem.has("admin_reviews_page")).toBe(false);
    expect(ouvinte).toHaveBeenCalledWith({ soEmModeracao: true });
    parar();
  });
});

describe("limpa TODAS as chaves guardadas da tela, e só as dela", () => {
  it("Avaliações: nota, situação, busca e página saem; as de Perguntas ficam", () => {
    const armazem = instalarArmazem();
    guardarTudo(armazem);

    limparGuardadosAoChegarPorAviso("admin-reviews");

    for (const chave of CHAVES_DE_AVALIACOES) {
      expect(armazem.has(chave), chave).toBe(false);
    }
    for (const chave of CHAVES_DE_PERGUNTAS) {
      expect(armazem.get(chave), chave).toBe("guardado");
    }
  });

  it("Perguntas: filtro, página e busca saem; as de Avaliações ficam", () => {
    const armazem = instalarArmazem();
    guardarTudo(armazem);

    limparGuardadosAoChegarPorAviso("admin-qa");

    for (const chave of CHAVES_DE_PERGUNTAS) {
      expect(armazem.has(chave), chave).toBe(false);
    }
    for (const chave of CHAVES_DE_AVALIACOES) {
      expect(armazem.get(chave), chave).toBe("guardado");
    }
  });

  it("tela que não guarda nada (Início) não apaga chave nenhuma", () => {
    const armazem = instalarArmazem();
    guardarTudo(armazem);

    limparGuardadosAoChegarPorAviso("admin-dashboard");

    expect(armazem.size).toBe(
      CHAVES_DE_AVALIACOES.length + CHAVES_DE_PERGUNTAS.length,
    );
  });
});

describe("o que o aviso pede e onde é gravado", () => {
  it("moderação e sem resposta juntos: vale a moderação, no formato do useLocalStorage", () => {
    const armazem = instalarArmazem();
    limparGuardadosAoChegarPorAviso("admin-reviews", {
      soEmModeracao: true,
      soSemResposta: true,
    });
    expect(armazem.get("admin_reviews_status_filter")).toBe('"pendente"');
  });

  it("só sem resposta grava 'sem_resposta' também como JSON", () => {
    const armazem = instalarArmazem();
    limparGuardadosAoChegarPorAviso("admin-reviews", { soSemResposta: true });
    expect(armazem.get("admin_reviews_status_filter")).toBe('"sem_resposta"');
  });

  it("aviso comum de Avaliações não grava filtro nenhum", () => {
    const armazem = instalarArmazem();
    limparGuardadosAoChegarPorAviso("admin-reviews");
    expect(armazem.size).toBe(0);
  });

  it("o pedido de moderação só vale para Avaliações: em Perguntas não grava o filtro delas", () => {
    const armazem = instalarArmazem();
    limparGuardadosAoChegarPorAviso("admin-qa", { soEmModeracao: true });
    expect(armazem.has("admin_reviews_status_filter")).toBe(false);
  });

  it("o ouvinte de uma tela não escuta a chegada em outra, e recebe as opções pedidas", () => {
    instalarArmazem();
    const qa = vi.fn();
    const avaliacoes = vi.fn();
    const pararQa = aoChegarPorAviso("admin-qa", qa);
    const pararAvaliacoes = aoChegarPorAviso("admin-reviews", avaliacoes);

    limparGuardadosAoChegarPorAviso("admin-reviews", { soSemResposta: true });

    expect(qa).not.toHaveBeenCalled();
    expect(avaliacoes).toHaveBeenCalledTimes(1);
    expect(avaliacoes).toHaveBeenCalledWith({ soSemResposta: true });

    limparGuardadosAoChegarPorAviso("admin-qa");
    expect(qa).toHaveBeenCalledTimes(1);
    expect(qa).toHaveBeenCalledWith({});
    pararQa();
    pararAvaliacoes();
  });
});
