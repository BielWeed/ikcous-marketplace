// @vitest-environment jsdom
//
// Fronteiras da recuperação de erro de chunk (src/lib/recuperacao-chunk.ts)
// que os outros arquivos desta família não pisavam. O que protege:
//   · a janela de 15 s é MEIO-ABERTA — em 14999 ms o segundo erro ainda é
//     espectador, em 15000 ms já engaja o 2º degrau (um `<=` no lugar do `<`
//     deixaria o purge esperar 1 ms a mais e ninguém notaria);
//   · registro LEGADO com `lastAt` ou `count` ausente/de tipo errado é lixo e
//     não conta — contar viraria NaN e pularia direto para o purge;
//   · 'unhandledrejection' com `reason` em TEXTO engaja (o Vite rejeita assim
//     em alguns navegadores), `reason` nulo/vazio/estranho não derruba o
//     listener, e o desinstalador remove OS DOIS listeners;
//   · `apagarCachesDoApp` conta SÓ o que foi de fato apagado e nunca toca em
//     cache que não é `app-cache-*`;
//   · o laudo forense do onblocked mantém só os 10 mais novos.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CHAVE_RECUPERACAO_CHUNK,
  apagarCachesDoApp,
  apagarIndexedDBAguardando,
  instalarCanaisDeErroChunk,
  reportarErroChunk,
} from "@/lib/recuperacao-chunk";

// Literais duplicados de propósito (padrão da casa): se mudarem no fonte,
// este teste quebra e avisa.
const VERSAO_FALLBACK_DO_APP = "0.0.0-dev";
const CHAVE_ATIVA = `${CHAVE_RECUPERACAO_CHUNK}:${VERSAO_FALLBACK_DO_APP}`;
const JANELA_MS = 15000;
const PRAZO_DELETE_DATABASE_MS = 4000;
const T0 = 1_700_000_000_000;

const reloadEspiao = vi.fn();

beforeEach(() => {
  reloadEspiao.mockClear();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      pathname: "/loja",
      search: "?source=pwa",
      reload: reloadEspiao,
      replace: vi.fn(),
    },
  });
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
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("reportarErroChunk — a janela de 15 s é meio-aberta", () => {
  it("14999 ms depois é espectador; 15000 ms depois engaja o purge; o 3º é recusado", () => {
    expect(reportarErroChunk(T0, true)).toEqual({
      dono: true,
      acao: "ciclo-sw",
    });
    expect(reportarErroChunk(T0 + JANELA_MS - 1, true)).toEqual({
      dono: false,
      acao: "recusar",
    });
    expect(reportarErroChunk(T0 + JANELA_MS, true)).toEqual({
      dono: true,
      acao: "purge",
    });
    expect(reportarErroChunk(T0 + 10 * JANELA_MS, true)).toEqual({
      dono: false,
      acao: "recusar",
    });
  });
});

describe("registro legado corrompido não conta como tentativa", () => {
  const casos: Array<[string, Record<string, unknown>]> = [
    [
      "lastAt em texto",
      { versao: VERSAO_FALLBACK_DO_APP, count: 1, lastAt: "ontem" },
    ],
    ["lastAt ausente", { versao: VERSAO_FALLBACK_DO_APP, count: 1 }],
    [
      "count em texto",
      { versao: VERSAO_FALLBACK_DO_APP, count: "1", lastAt: 1 },
    ],
  ];

  for (const [nome, legado] of casos) {
    it(`${nome}: a próxima decisão é a PRIMEIRA (ciclo do SW), contagem 1`, () => {
      localStorage.setItem(CHAVE_RECUPERACAO_CHUNK, JSON.stringify(legado));

      expect(reportarErroChunk(T0, true)).toEqual({
        dono: true,
        acao: "ciclo-sw",
      });
      expect(
        JSON.parse(localStorage.getItem(CHAVE_ATIVA) ?? "null") as unknown,
      ).toEqual({ versao: VERSAO_FALLBACK_DO_APP, count: 1, lastAt: T0 });
    });
  }
});

describe("canais globais — o que entra e o que sai pela rejeição", () => {
  function despacharRejeicao(reason: unknown) {
    const evento = new Event("unhandledrejection") as Event & {
      reason?: unknown;
    };
    evento.reason = reason;
    window.dispatchEvent(evento);
  }

  async function drenarTarefas() {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  it("reason em TEXTO de chunk engaja a recuperação (reload seco, uma vez)", async () => {
    const desinstalar = instalarCanaisDeErroChunk();

    despacharRejeicao("Loading chunk 9 failed");
    await drenarTarefas();

    expect(reloadEspiao).toHaveBeenCalledTimes(1);
    desinstalar();
  });

  it("reason em texto que não é de chunk não consome a guarda", async () => {
    const desinstalar = instalarCanaisDeErroChunk();

    despacharRejeicao("Request failed with status 500");
    await drenarTarefas();

    expect(reloadEspiao).not.toHaveBeenCalled();
    expect(localStorage.getItem(CHAVE_ATIVA)).toBeNull();
    desinstalar();
  });

  it("reason nulo, indefinido, número ou objeto cru não lança e não engaja", async () => {
    const desinstalar = instalarCanaisDeErroChunk();

    for (const reason of [null, undefined, 42, {}]) {
      expect(() => despacharRejeicao(reason)).not.toThrow();
    }
    await drenarTarefas();

    expect(reloadEspiao).not.toHaveBeenCalled();
    expect(localStorage.getItem(CHAVE_ATIVA)).toBeNull();
    desinstalar();
  });

  it("o desinstalador também remove o listener de 'unhandledrejection'", async () => {
    const desinstalar = instalarCanaisDeErroChunk();
    desinstalar();

    despacharRejeicao(new Error("Loading chunk 1 failed"));
    await drenarTarefas();

    expect(reloadEspiao).not.toHaveBeenCalled();
    expect(localStorage.getItem(CHAVE_ATIVA)).toBeNull();
  });
});

describe("apagarCachesDoApp — conta só o que de fato foi apagado", () => {
  it("devolve 1 quando um cache app-cache-* resiste ao delete; não toca nos outros", async () => {
    const tentativas: string[] = [];
    vi.stubGlobal("caches", {
      keys: vi.fn(async () => [
        "app-cache-v1",
        "app-cache-v2",
        "ikcous-identidade",
        "supabase-images-cache",
      ]),
      delete: vi.fn(async (nome: string) => {
        tentativas.push(nome);
        return nome === "app-cache-v1";
      }),
    });

    expect(await apagarCachesDoApp()).toBe(1);
    expect(tentativas).toEqual(["app-cache-v1", "app-cache-v2"]);
  });
});

describe("laudo forense do deleteDatabase bloqueado", () => {
  it("guarda no máximo 10 entradas e as mais novas ficam na frente", async () => {
    vi.useFakeTimers();
    const antigas = Array.from({ length: 10 }, (_, i) => ({
      t: `2026-01-01T00:00:0${i}.000Z`,
      m: `ANTIGA_${i}`,
    }));
    localStorage.setItem("pwa_forensics", JSON.stringify(antigas));
    const pedido: { onblocked: (() => void) | null } = { onblocked: null };
    vi.stubGlobal("indexedDB", { deleteDatabase: vi.fn(() => pedido) });

    const promessa = apagarIndexedDBAguardando();
    pedido.onblocked?.();
    await vi.advanceTimersByTimeAsync(PRAZO_DELETE_DATABASE_MS + 1);
    await promessa;

    const laudo = JSON.parse(
      localStorage.getItem("pwa_forensics") ?? "[]",
    ) as Array<{ m: string }>;
    expect(laudo).toHaveLength(10);
    expect(laudo[0]?.m).toBe("DATAVAULT_DELETE_BLOQUEADO");
    expect(laudo[9]?.m).toBe("ANTIGA_8");
  });

  it("apaga o banco do cofre por padrão e aceita outro nome", async () => {
    const pedido: { onsuccess: (() => void) | null } = { onsuccess: null };
    const deleteDatabase = vi.fn((_nome: string) => pedido);
    vi.stubGlobal("indexedDB", { deleteDatabase });

    const padrao = apagarIndexedDBAguardando();
    pedido.onsuccess?.();
    await padrao;
    const outro = apagarIndexedDBAguardando("banco-de-teste");
    pedido.onsuccess?.();
    await outro;

    expect(deleteDatabase.mock.calls.map(([nome]) => nome)).toEqual([
      "ikcous-datavault",
      "banco-de-teste",
    ]);
  });

  it("deleteDatabase que lança resolve false na hora (sem esperar o prazo)", async () => {
    vi.stubGlobal("indexedDB", {
      deleteDatabase: vi.fn(() => {
        throw new Error("indexedDB indisponível");
      }),
    });

    expect(await apagarIndexedDBAguardando()).toBe(false);
  });
});
