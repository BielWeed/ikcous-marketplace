// @vitest-environment node
// OLD é o blob real congelado, não uma reimplementação. Só decisões síncronas:
// storage em Map; nenhuma rede, navegação, SW, cache ou banco de verdade.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const A = "0.0.0-compat-a";
const B = "0.0.0-compat-b";
const LEGADO = "pwa_chunk_recovery";
const NOVO_A = `${LEGADO}:${A}`;
const NOVO_B = `${LEGADO}:${B}`;
type Modulo = typeof import("@/lib/recuperacao-chunk");
type Canal = "R" | "S";
let mapa: Map<string, string>;
let falhaGet: string | undefined;
let falhaSet: string | undefined;
let storage: {
  getItem: ReturnType<typeof vi.fn>;
  setItem: ReturnType<typeof vi.fn>;
};
let bordas: Record<string, unknown>;
let proibido: ReturnType<typeof vi.fn>;

function conferirBordas() {
  for (const [nome, valor] of Object.entries(bordas)) {
    expect(Reflect.get(globalThis, nome), nome).toBe(valor);
  }
}
async function carregar(versao: string, antigo = false): Promise<Modulo> {
  conferirBordas();
  vi.resetModules();
  vi.stubGlobal("__APP_VERSION__", versao);
  return antigo
    ? await import("../fixtures/recuperacao-chunk-legado-195")
    : await import("@/lib/recuperacao-chunk");
}
function registro(chave = NOVO_A) {
  const cru = mapa.get(chave);
  return cru === undefined ? null : JSON.parse(cru);
}
function chamar(modulo: Modulo, canal: Canal, agora: number) {
  conferirBordas();
  return canal === "R"
    ? modulo.reportarErroChunk(agora, true)
    : modulo.pedirRecargaSubordinada(agora);
}
function recusa(modulo: Modulo, canal: Canal, agora: number) {
  expect(chamar(modulo, canal, agora)).toEqual(
    canal === "R" ? { dono: false, acao: "recusar" } : false,
  );
}
function autoriza(
  modulo: Modulo,
  canal: Canal,
  agora: number,
  segunda = false,
) {
  expect(chamar(modulo, canal, agora)).toEqual(
    canal === "R" ? { dono: true, acao: segunda ? "purge" : "ciclo-sw" } : true,
  );
}

beforeEach(() => {
  mapa = new Map();
  falhaGet = undefined;
  falhaSet = undefined;
  storage = {
    getItem: vi.fn((chave: string) => {
      if (chave === falhaGet) throw new Error("leitura sintética indisponível");
      return mapa.get(chave) ?? null;
    }),
    setItem: vi.fn((chave: string, valor: string) => {
      if (chave === falhaSet)
        throw new Error("gravação sintética indisponível");
      mapa.set(chave, String(valor));
    }),
  };
  proibido = vi.fn(() => {
    throw new Error("borda fora da prova de decisão");
  });
  bordas = {
    localStorage: storage,
    sessionStorage: { getItem: proibido, setItem: proibido },
    fetch: proibido,
    navigator: {
      onLine: true,
      serviceWorker: {
        getRegistration: proibido,
        getRegistrations: proibido,
        addEventListener: proibido,
        removeEventListener: proibido,
      },
    },
    caches: { keys: proibido, delete: proibido },
    indexedDB: { deleteDatabase: proibido },
    window: { location: { reload: proibido, replace: proibido } },
  };
  for (const [nome, valor] of Object.entries(bordas))
    vi.stubGlobal(nome, valor);
});
afterEach(() => {
  conferirBordas();
  expect(proibido).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("compatibilidade entre escritor congelado e orçamento por versão", () => {
  for (const canal of ["R", "S"] as const) {
    it(`1: ${canal} relê legado e persiste mesmo ao recusar por janela/teto`, async () => {
      const o = await carregar(A, true);
      const n = await carregar(A);
      autoriza(o, "R", 1000);
      const primeiroLegado = mapa.get(LEGADO);
      recusa(n, canal, 1001);
      expect(registro()).toEqual({ versao: A, count: 1, lastAt: 1000 });
      expect(mapa.get(LEGADO)).toBe(primeiroLegado);
      autoriza(o, "R", 17000, true);
      const legado = mapa.get(LEGADO);
      recusa(n, canal, 17001);
      recusa(n, canal, 32000);
      expect(registro()).toEqual({ versao: A, count: 2, lastAt: 17000 });
      expect(mapa.get(LEGADO)).toBe(legado);
    });

    it(`2: ${canal} combina máximos de fontes diferentes após reimportação`, async () => {
      const oa = await carregar(A, true);
      const ob = await carregar(B, true);
      let n = await carregar(A);
      autoriza(oa, "R", 1000);
      autoriza(n, "R", 17000, true);
      autoriza(ob, "R", 18000);
      autoriza(oa, "R", 19000);
      const legado = mapa.get(LEGADO);
      n = await carregar(A);
      recusa(n, canal, 19001);
      expect(registro()).toEqual({ versao: A, count: 2, lastAt: 19000 });
      expect(mapa.get(LEGADO)).toBe(legado);
    });
  }

  for (const canais of [
    ["R", "S", "S", "R"],
    ["S", "R", "R", "S"],
  ] as const) {
    it(`3: canais ${canais.join("→")} compartilham dois degraus`, async () => {
      const n = await carregar(A);
      autoriza(n, canais[0], 1000);
      recusa(n, canais[1], 1001);
      autoriza(n, canais[2], 17000, true);
      recusa(n, canais[3], 33000);
      expect(registro()).toEqual({ versao: A, count: 2, lastAt: 17000 });
      expect(mapa.has(LEGADO)).toBe(false);
    });
  }

  it("4: legado esgotado de B não bloqueia A nem é sobrescrito", async () => {
    const ob = await carregar(B, true);
    const na = await carregar(A);
    const nb = await carregar(B);
    autoriza(ob, "R", 1000);
    autoriza(ob, "R", 17000, true);
    const legado = mapa.get(LEGADO);
    autoriza(na, "R", 18000);
    recusa(nb, "R", 18000);
    expect(registro()).toEqual({ versao: A, count: 1, lastAt: 18000 });
    expect(registro(NOVO_B)).toEqual({ versao: B, count: 2, lastAt: 17000 });
    expect(mapa.get(LEGADO)).toBe(legado);
  });

  const invalidos = [
    ["vazio", ""],
    ["JSON incompleto", "{"],
    ["null", "null"],
    ["array", "[]"],
    ["string", '"texto"'],
    ["outra versão", JSON.stringify({ versao: B, count: 1, lastAt: 1000 })],
    ["count negativo", JSON.stringify({ versao: A, count: -1, lastAt: 1000 })],
    [
      "count fracionário",
      JSON.stringify({ versao: A, count: 1.5, lastAt: 1000 }),
    ],
    ["count string", JSON.stringify({ versao: A, count: "1", lastAt: 1000 })],
    ["count ausente", JSON.stringify({ versao: A, lastAt: 1000 })],
    ["count infinito", `{"versao":"${A}","count":1e309,"lastAt":1000}`],
    ["lastAt string", JSON.stringify({ versao: A, count: 1, lastAt: "1000" })],
    ["lastAt ausente", JSON.stringify({ versao: A, count: 1 })],
    ["lastAt infinito", `{"versao":"${A}","count":1,"lastAt":1e309}`],
  ];
  for (const [nome, cru] of invalidos) {
    it(`5: registro novo presente ${nome} recusa R/S sem sobrescrever`, async () => {
      const n = await carregar(A);
      autoriza(n, "R", 1000);
      mapa.set(NOVO_A, cru);
      const antes = [...mapa];
      recusa(n, "R", 17000);
      recusa(n, "S", 17000);
      expect([...mapa]).toEqual(antes);
    });
  }

  it("5 controle: ausência real inicia e prefixo válido autoriza segunda", async () => {
    const n = await carregar(A);
    expect(mapa.size).toBe(0);
    autoriza(n, "R", 1000);
    expect(registro()).toEqual({ versao: A, count: 1, lastAt: 1000 });
    autoriza(n, "S", 17000, true);
    expect(registro()).toEqual({ versao: A, count: 2, lastAt: 17000 });
  });

  for (const canal of ["R", "S"] as const) {
    it(`6: ${canal} mantém tolerância do leitor legado a JSON inválido`, async () => {
      const o = await carregar(A, true);
      const n = await carregar(A);
      mapa.set(LEGADO, "{");
      autoriza(o, canal, 1000);
      mapa.clear();
      mapa.set(LEGADO, "{");
      autoriza(n, canal, 1000);
      expect(mapa.get(LEGADO)).toBe("{");
      expect(registro()).toEqual({ versao: A, count: 1, lastAt: 1000 });
    });
    for (const chave of [NOVO_A, LEGADO]) {
      it(`7: getItem ${chave} falha fechado em ${canal}`, async () => {
        const n = await carregar(A);
        autoriza(n, "R", 1000);
        const antes = [...mapa];
        falhaGet = chave;
        storage.getItem.mockClear();
        storage.setItem.mockClear();
        recusa(n, canal, 17000);
        expect(storage.getItem).toHaveBeenCalledWith(chave);
        expect(storage.setItem).not.toHaveBeenCalled();
        expect([...mapa]).toEqual(antes);
        falhaGet = undefined;
        autoriza(n, canal, 17000, true);
      });
    }

    it(`8: setItem novo falha antes de autorizar ${canal}`, async () => {
      const n = await carregar(A);
      autoriza(n, "R", 1000);
      const antes = [...mapa];
      falhaSet = NOVO_A;
      storage.setItem.mockClear();
      recusa(n, canal, 17000);
      expect(storage.setItem).toHaveBeenCalledWith(NOVO_A, expect.any(String));
      expect([...mapa]).toEqual(antes);
      falhaSet = undefined;
      autoriza(n, canal, 17000, true);
    });

    it(`8: setItem falha ao recombinar antes da recusa ${canal}`, async () => {
      const o = await carregar(A, true);
      const n = await carregar(A);
      autoriza(o, "R", 1000);
      recusa(n, "R", 1001);
      autoriza(o, "R", 17000, true);
      const antes = [...mapa];
      falhaSet = NOVO_A;
      storage.setItem.mockClear();
      recusa(n, canal, 17001);
      expect(storage.setItem).toHaveBeenCalledWith(
        NOVO_A,
        JSON.stringify({ versao: A, count: 2, lastAt: 17000 }),
      );
      expect([...mapa]).toEqual(antes);
      falhaSet = undefined;
      recusa(n, canal, 17001);
      expect(registro()).toEqual({ versao: A, count: 2, lastAt: 17000 });
      expect(mapa.get(LEGADO)).toBe(
        antes.find(([chave]) => chave === LEGADO)?.[1],
      );
    });
  }

  for (const modo of ["inválido", "get lança"] as const) {
    it(`9: offline com storage ${modo} não lê nem escreve`, async () => {
      const n = await carregar(A);
      autoriza(n, "R", 1000);
      mapa.set(NOVO_A, "{");
      if (modo === "get lança") falhaGet = NOVO_A;
      const antes = [...mapa];
      storage.getItem.mockClear();
      storage.setItem.mockClear();
      expect(n.reportarErroChunk(17000, false)).toEqual({
        dono: true,
        acao: "offline",
      });
      expect(storage.getItem).not.toHaveBeenCalled();
      expect(storage.setItem).not.toHaveBeenCalled();
      expect([...mapa]).toEqual(antes);
    });
  }
});
