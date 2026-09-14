// @vitest-environment jsdom
//
// A CHAVE ÚNICA da recuperação de erro de chunk (issue #92, aceite 1).
//
// Até hoje havia DOIS mecanismos concorrentes com chaves divergentes: o
// boundary com `pwa_chunk_reload_done` (booleana em sessionStorage, uma
// recarga por sessão) e o useUpdateCheck com `pwa_chunk_error_reload`
// (janela de 15s em sessionStorage) — e o purge dele decidia numa corrida
// de 1500ms contra o reload do boundary. Um mesmo erro atravessava os dois.
//
// O conserto: UMA chave (`pwa_chunk_recovery`), em localStorage com prefixo
// `pwa_` (sobrevive ao purge seletivo — ver localStoragePurgeWhitelist.ts),
// conteúdo {versao, count, lastAt}, e decisão SINCRONA por check-and-set:
// quem chega primeiro engaja e é o dono; quem chega segundo é espectador.
// O contador é POR VERSÃO do build: um deploy novo zera a contagem — a
// booleana eterna do boundary negava recuperação a um segundo deploy numa
// PWA instalada que fica aberta dias.
//
// Por que localStorage e não sessionStorage: o handleReset ("Reiniciar
// Sessão") e qualquer reabertura da PWA zeravam a guarda — o mecanismo
// esquecia que tentou e re-engajava recarga/purge a cada abertura.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CHAVE_RECUPERACAO_CHUNK,
  ehErroDeChunk,
  pedirRecargaSubordinada,
  reportarErroChunk,
} from "@/lib/recuperacao-chunk";

// Mesmos literais do módulo, DUPLICADOS de propósito (padrão da casa nos
// testes do boundary): se a chave ou a versão de fallback mudarem no fonte,
// este teste quebra e avisa.
const VERSAO_FALLBACK_DO_APP = "0.0.0-dev";

function gravarEstadoDireto(estado: {
  versao: string;
  count: number;
  lastAt: number;
}) {
  localStorage.setItem(CHAVE_RECUPERACAO_CHUNK, JSON.stringify(estado));
}

function lerEstadoGravado(): {
  versao: string;
  count: number;
  lastAt: number;
} | null {
  const cru = localStorage.getItem(CHAVE_RECUPERACAO_CHUNK);
  return cru
    ? (JSON.parse(cru) as { versao: string; count: number; lastAt: number })
    : null;
}

beforeEach(() => {
  vi.stubGlobal(
    "localStorage",
    (() => {
      const armazem = new Map<string, string>();
      return {
        getItem: (chave: string) => armazem.get(chave) ?? null,
        setItem: (chave: string, valor: string) => {
          armazem.set(chave, String(valor));
        },
        removeItem: (chave: string) => {
          armazem.delete(chave);
        },
        clear: () => {
          armazem.clear();
        },
      };
    })(),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ehErroDeChunk — as formas do erro que o mecanismo único reconhece", () => {
  it("reconhece as formas conhecidas de falha de chunk", () => {
    const formas = [
      "Failed to fetch dynamically imported module: http://x/a.js",
      "error loading dynamically imported module",
      "Loading chunk 3 failed",
      "ChunkLoadError",
      "Importing a module script failed.",
      "CSS chunk load failed",
      "Unexpected token '<' (em index.html)",
    ];
    for (const mensagem of formas) {
      expect(ehErroDeChunk(mensagem)).toBe(true);
    }
  });

  it("recusa erro comum de render, mensagem vazia e nulo", () => {
    expect(
      ehErroDeChunk("Cannot read properties of undefined (reading 'x')"),
    ).toBe(false);
    expect(ehErroDeChunk("")).toBe(false);
    expect(ehErroDeChunk(null)).toBe(false);
    expect(ehErroDeChunk(undefined)).toBe(false);
  });
});

describe("reportarErroChunk — a decisão sincrona (check-and-set) da chave única", () => {
  it("primeiro erro engaja ciclo-sw (dono) e grava count=1 com a versão do build", () => {
    const decisao = reportarErroChunk(1000);

    expect(decisao).toEqual({ dono: true, acao: "ciclo-sw" });
    expect(lerEstadoGravado()).toEqual({
      versao: VERSAO_FALLBACK_DO_APP,
      count: 1,
      lastAt: 1000,
    });
  });

  it("SEGUNDO erro no MESMO instante (dois canais concorrentes) é espectador e não re-engaja", () => {
    const primeiro = reportarErroChunk(1000);
    const segundo = reportarErroChunk(1050);

    expect(primeiro).toEqual({ dono: true, acao: "ciclo-sw" });
    expect(segundo).toEqual({ dono: false, acao: "recusar" });
    // A chave continua no engajamento do primeiro — não virou 2.
    expect(lerEstadoGravado()?.count).toBe(1);
  });

  it("erro DEPOIS da janela de 15s escala para purge (segundo degrau)", () => {
    reportarErroChunk(1000);
    const decisao = reportarErroChunk(1000 + 16000);

    expect(decisao).toEqual({ dono: true, acao: "purge" });
    expect(lerEstadoGravado()?.count).toBe(2);
  });

  it("terceiro engajamento para a MESMA versão é recusado — o purge não se repete", () => {
    reportarErroChunk(1000);
    reportarErroChunk(17000);
    const terceiro = reportarErroChunk(34000);

    expect(terceiro).toEqual({ dono: false, acao: "recusar" });
    expect(lerEstadoGravado()?.count).toBe(2);
  });

  it("DEPLOY NOVO (versão diferente na chave) zera a contagem e volta a permitir ciclo-sw", () => {
    gravarEstadoDireto({
      versao: "0.0.0-versao-velha",
      count: 2,
      lastAt: 99000,
    });
    const decisao = reportarErroChunk(100000);

    expect(decisao).toEqual({ dono: true, acao: "ciclo-sw" });
    expect(lerEstadoGravado()).toEqual({
      versao: VERSAO_FALLBACK_DO_APP,
      count: 1,
      lastAt: 100000,
    });
  });

  it("SEM internet a decisão é offline e NÃO consome a guarda", () => {
    const decisao = reportarErroChunk(1000, false);

    expect(decisao).toEqual({ dono: true, acao: "offline" });
    expect(localStorage.getItem(CHAVE_RECUPERACAO_CHUNK)).toBeNull();
  });

  it("storage indisponível falha FECHADO: recusa e não engaja recarga automática", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("storage morto");
      },
      setItem: () => {
        throw new Error("storage morto");
      },
    });

    const decisao = reportarErroChunk(1000);

    expect(decisao).toEqual({ dono: false, acao: "recusar" });
  });

  it("chave corrompida (JSON quebrado) é tratada como primeira tentativa", () => {
    localStorage.setItem(CHAVE_RECUPERACAO_CHUNK, "{quebrado");

    const decisao = reportarErroChunk(1000);

    expect(decisao).toEqual({ dono: true, acao: "ciclo-sw" });
  });
});

describe("pedirRecargaSubordinada — a mesma chave para o sentinela pedir recarga", () => {
  it("recusa quando uma recuperação engajou há menos de uma janela", () => {
    reportarErroChunk(1000);

    expect(pedirRecargaSubordinada(5000)).toBe(false);
  });

  it("aceita fora da janela e grava o carimbo sem estourar o contador de degraus", () => {
    reportarErroChunk(1000);

    const aceitou = pedirRecargaSubordinada(1000 + 16000);

    expect(aceitou).toBe(true);
    const estado = lerEstadoGravado();
    expect(estado?.count).toBe(1);
    expect(estado?.lastAt).toBe(1000 + 16000);
  });

  it("FORA da janela o sentinela é permitido mesmo com os degraus do chunk esgotados", () => {
    // Os degraus esgotados são regra da ESCADA DE CHUNK (reportarErroChunk);
    // o pulso perdido do sentinela é OUTRO problema — a chave só impõe uma
    // recuperação POR VEZ (a janela), não o monopólio da versão inteira.
    gravarEstadoDireto({
      versao: VERSAO_FALLBACK_DO_APP,
      count: 2,
      lastAt: 1000,
    });

    expect(pedirRecargaSubordinada(1000 + 60000)).toBe(true);
  });
});
