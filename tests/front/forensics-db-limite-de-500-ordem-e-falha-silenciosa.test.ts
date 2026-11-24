// @vitest-environment jsdom
//
// Log forense em IndexedDB (src/lib/forensicsDB.ts) — nenhum teste olhava o
// módulo por dentro (só dublês dele nos testes de web vitals). O que protege:
//   · o limite de 500 entradas é EXATO: 500 não poda nada, 501 poda 1, e uma
//     fila que já passou do teto (505 + 1) poda só o excesso, as MAIS VELHAS;
//   · a leitura devolve as mais novas primeiro e respeita o `limit` sem
//     passar dele;
//   · `t` fornecido é mantido; sem `t`, entra a hora de agora;
//   · "forense nunca lança": sem IndexedDB nada estoura (escrita, leitura e
//     contagem) e uma abertura que falhou NÃO fica grudada — a próxima
//     chamada tenta de novo.
// IndexedDB falso e mínimo, em memória: só o que o módulo usa.
import { afterEach, describe, expect, it, vi } from "vitest";

interface Registro extends Record<string, unknown> {
  id: number;
  t: string;
}

interface PedidoSimples<T> {
  result: T;
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
}

interface CursorFalso {
  value: Registro;
  delete: () => void;
  continue: () => void;
}

const MAX_ENTRADAS = 500;

function criarIndexedDBFalso(semente: Array<{ t: string; m: string }> = []) {
  const registros: Registro[] = [];
  let proximoId = 1;
  for (const item of semente) registros.push({ ...item, id: proximoId++ });

  const agendar = (fn: () => void) => {
    queueMicrotask(fn);
  };

  function pedido<T>(valor: () => T): PedidoSimples<T> {
    const p: PedidoSimples<T> = {
      result: undefined as T,
      onsuccess: null,
      onerror: null,
    };
    agendar(() => {
      p.result = valor();
      p.onsuccess?.();
    });
    return p;
  }

  function cursorSobre(lista: Registro[]) {
    let posicao = 0;
    const p: PedidoSimples<CursorFalso | null> = {
      result: null,
      onsuccess: null,
      onerror: null,
    };
    const emitir = () => {
      const atual = lista.at(posicao);
      p.result = atual
        ? {
            value: atual,
            delete: () => {
              const indice = registros.findIndex((r) => r.id === atual.id);
              if (indice >= 0) registros.splice(indice, 1);
            },
            continue: () => {
              posicao += 1;
              agendar(emitir);
            },
          }
        : null;
      p.onsuccess?.();
    };
    agendar(emitir);
    return p;
  }

  const store = {
    add: (valor: Record<string, unknown>) => {
      registros.push({ ...valor, id: proximoId++ } as Registro);
      return {};
    },
    count: () => pedido(() => registros.length),
    openCursor: () => cursorSobre([...registros].sort((a, b) => a.id - b.id)),
    index: () => ({
      openCursor: (_faixa: unknown, direcao: string) => {
        const ordenados = [...registros].sort((a, b) =>
          a.t < b.t ? -1 : a.t > b.t ? 1 : 0,
        );
        return cursorSobre(
          direcao === "prev" ? ordenados.reverse() : ordenados,
        );
      },
    }),
    clear: () => {
      registros.length = 0;
    },
  };

  const banco = {
    objectStoreNames: { contains: () => false },
    createObjectStore: () => ({ createIndex: () => undefined }),
    transaction: () => ({ objectStore: () => store }),
  };

  const abrir = vi.fn(() => {
    const req: {
      result: typeof banco;
      onupgradeneeded: (() => void) | null;
      onsuccess: (() => void) | null;
      onerror: (() => void) | null;
      error: unknown;
    } = {
      result: banco,
      onupgradeneeded: null,
      onsuccess: null,
      onerror: null,
      error: null,
    };
    agendar(() => {
      req.onupgradeneeded?.();
      req.onsuccess?.();
    });
    return req;
  });

  vi.stubGlobal("indexedDB", { open: abrir });
  return { registros, abrir };
}

async function drenar() {
  for (let i = 0; i < 3; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function carregarModulo() {
  vi.resetModules();
  return import("@/lib/forensicsDB");
}

function semente(quantidade: number) {
  return Array.from({ length: quantidade }, (_, i) => ({
    t: `2026-01-01T00:00:00.${String(i).padStart(3, "0")}Z`,
    m: `ENTRADA_${i}`,
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("logForensic — limite de 500 entradas", () => {
  it("com 499 + 1 = 500 nada é podado", async () => {
    const { registros } = criarIndexedDBFalso(semente(MAX_ENTRADAS - 1));
    const { logForensic } = await carregarModulo();

    await logForensic({ t: "2026-02-01T00:00:00.000Z", m: "NOVA" });
    await drenar();

    expect(registros).toHaveLength(MAX_ENTRADAS);
    expect(registros.some((r) => r.m === "ENTRADA_0")).toBe(true);
  });

  it("com 500 + 1 = 501 poda exatamente a mais velha", async () => {
    const { registros } = criarIndexedDBFalso(semente(MAX_ENTRADAS));
    const { logForensic } = await carregarModulo();

    await logForensic({ t: "2026-02-01T00:00:00.000Z", m: "NOVA" });
    await drenar();

    expect(registros).toHaveLength(MAX_ENTRADAS);
    expect(registros.some((r) => r.m === "ENTRADA_0")).toBe(false);
    expect(registros.some((r) => r.m === "ENTRADA_1")).toBe(true);
    expect(registros.some((r) => r.m === "NOVA")).toBe(true);
  });

  it("fila que já passou do teto (505 + 1) poda só o excesso, das mais velhas", async () => {
    const { registros } = criarIndexedDBFalso(semente(MAX_ENTRADAS + 5));
    const { logForensic } = await carregarModulo();

    await logForensic({ t: "2026-02-01T00:00:00.000Z", m: "NOVA" });
    await drenar();

    expect(registros).toHaveLength(MAX_ENTRADAS);
    expect(registros.some((r) => r.m === "ENTRADA_5")).toBe(false);
    expect(registros.some((r) => r.m === "ENTRADA_6")).toBe(true);
    expect(registros.some((r) => r.m === "NOVA")).toBe(true);
  });

  it("`t` fornecido é mantido; sem `t` entra a hora de agora", async () => {
    const { registros } = criarIndexedDBFalso();
    const { logForensic } = await carregarModulo();

    await logForensic({ t: "2020-05-05T05:05:05.000Z", m: "COM_T" });
    await logForensic({ t: "", m: "SEM_T" });
    await drenar();

    expect(registros.find((r) => r.m === "COM_T")?.t).toBe(
      "2020-05-05T05:05:05.000Z",
    );
    const semT = registros.find((r) => r.m === "SEM_T")?.t ?? "";
    expect(Number.isNaN(Date.parse(semT))).toBe(false);
    expect(semT).not.toBe("");
  });
});

describe("getForensicLogs, countForensicLogs e clearForensicLogs", () => {
  it("devolve as mais novas primeiro e nunca passa do limit", async () => {
    criarIndexedDBFalso(semente(5));
    const { getForensicLogs } = await carregarModulo();

    const duas = await getForensicLogs(2);

    expect(duas.map((e) => e.m)).toEqual(["ENTRADA_4", "ENTRADA_3"]);
  });

  it("limit maior que o acervo devolve tudo, e sem limit vale 50", async () => {
    criarIndexedDBFalso(semente(60));
    const { getForensicLogs } = await carregarModulo();

    expect(await getForensicLogs(100)).toHaveLength(60);
    expect(await getForensicLogs()).toHaveLength(50);
  });

  it("countForensicLogs conta e clearForensicLogs zera", async () => {
    criarIndexedDBFalso(semente(7));
    const { clearForensicLogs, countForensicLogs } = await carregarModulo();

    expect(await countForensicLogs()).toBe(7);
    await clearForensicLogs();
    expect(await countForensicLogs()).toBe(0);
  });
});

describe("forense nunca lança", () => {
  it("sem IndexedDB, escrever, ler e contar não estouram", async () => {
    vi.stubGlobal("indexedDB", {
      open: () => {
        throw new Error("IndexedDB bloqueado neste navegador");
      },
    });
    const {
      clearForensicLogs,
      countForensicLogs,
      getForensicLogs,
      logForensic,
    } = await carregarModulo();

    await expect(logForensic({ t: "", m: "X" })).resolves.toBeUndefined();
    await expect(getForensicLogs()).resolves.toEqual([]);
    await expect(countForensicLogs()).resolves.toBe(0);
    await expect(clearForensicLogs()).resolves.toBeUndefined();
  });

  it("abertura que falhou não fica grudada: a chamada seguinte tenta de novo", async () => {
    const { registros, abrir } = criarIndexedDBFalso(semente(3));
    const abrirBom = abrir.getMockImplementation();
    abrir.mockImplementationOnce(() => {
      const req: {
        onsuccess: (() => void) | null;
        onerror: (() => void) | null;
        onupgradeneeded: (() => void) | null;
        error: unknown;
      } = {
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
        error: new Error("abertura recusada"),
      };
      setTimeout(() => req.onerror?.(), 0);
      return req as never;
    });
    const { countForensicLogs } = await carregarModulo();

    expect(await countForensicLogs()).toBe(0);
    expect(abrirBom).toBeDefined();
    expect(await countForensicLogs()).toBe(registros.length);
  });
});
