import { readFileSync } from "node:fs";
import { FICHA_DA_LOJA_ID } from "@/config/fichaDaLojaContract";
import { parseStoreIdentity } from "@/lib/storeIdentity";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { pacoteDeMarca } from "./fixtures/branding-assets";
import { criarBuildIdentity } from "./fixtures/build-identity";

const importPolyfill = 'import "./polyfills-ios-antigo";';
const importsDoMain =
  readFileSync("src/main.tsx", "utf8").match(/^import\s+(?!\().+$/gm) ?? [];
const apis = [
  [Object, "hasOwn"],
  [Array.prototype, "at"],
  [Object.getPrototypeOf(Uint8Array.prototype), "at"],
  [AbortSignal, "timeout"],
  [AbortSignal.prototype, "throwIfAborted"],
  [Object.getPrototypeOf(crypto), "randomUUID"],
] as const;

const restaurar: (() => void)[] = [];

function retirarApi(alvo: object, chave: string) {
  const descritor = Object.getOwnPropertyDescriptor(alvo, chave);
  Reflect.deleteProperty(alvo, chave);
  restaurar.push(() => {
    if (descritor) Object.defineProperty(alvo, chave, descritor);
    else Reflect.deleteProperty(alvo, chave);
  });
}

function prepararIosAntigo() {
  vi.stubGlobal("isSecureContext", true);
  for (const [alvo, chave] of apis) retirarApi(alvo, chave);
}

async function carregarPrimeiroImport() {
  if (importsDoMain[0] === importPolyfill) {
    const caminho = "../../src/polyfills-ios-antigo.ts";
    await import(/* @vite-ignore */ caminho);
  }
}

function restaurarApis() {
  for (const restauracao of restaurar.splice(0).reverse()) restauracao();
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  restaurarApis();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

class Elemento {
  textContent = "";
  innerHTML = "";
  style = { cssText: "" };
  filhos: Elemento[] = [];

  append(...filhos: Elemento[]) {
    this.filhos.push(...filhos);
  }
}

function injetarFichaValida() {
  const host = "loja.exemplo.com";
  const supabaseUrl = "https://abcdefghijklmnopqrst.supabase.co";
  const assets = pacoteDeMarca();
  const identity = parseStoreIdentity(
    {
      store_name: "Loja da ficha",
      store_city: null,
      store_state: null,
      primary_color: "#123456",
      secondary_color: "#abcdef",
      accent_color: "#fedcba",
      logo_url: `${supabaseUrl}/storage/v1/object/public/branding/${assets.header.path}`,
      branding_assets: assets,
    },
    supabaseUrl,
  );
  const ficha = new Elemento();
  ficha.textContent = JSON.stringify({
    schemaVersion: 2,
    host,
    identidade: {
      identity,
      localUrls: identity.urls,
      publicUrl: `https://${host}`,
      identityRevision: "b".repeat(64),
    },
    conexao: { supabaseUrl, publishableKey: "sb_publishable_teste" },
    configuracao: {
      mpPublicKey: null,
      vapidPublicKey: null,
      pagamentoOnline: false,
      manutencao: false,
    },
  });
  // O DOM falso só fornece a ficha e registra o aviso. O jsdom usa
  // Object.hasOwn por dentro e falharia antes de o app ler a ficha.
  const root = new Elemento();
  const elementos = new Map([
    [FICHA_DA_LOJA_ID, ficha],
    ["root", root],
  ]);
  vi.stubGlobal("document", {
    getElementById: (id: string) => elementos.get(id) ?? null,
    createElement: () => new Elemento(),
  });
  vi.stubGlobal("location", { hostname: host, pathname: "/" });
  vi.stubGlobal("__STORE_IDENTITY__", criarBuildIdentity("Outra loja"));
  vi.stubEnv("DEV", false);
  return root;
}

it("executa o polyfill como primeiro import, antes de conferir a identidade", () => {
  expect(importsDoMain[0]).toBe(importPolyfill);
  expect(
    importsDoMain.indexOf('import "@/config/buildIdentity";'),
  ).toBeGreaterThan(0);
});

async function prepararAbertura() {
  const root = injetarFichaValida();
  // O carregador do Vitest usa Array.at ao avaliar dependências aninhadas.
  // Aquece só os módulos puros; buildIdentity ainda vai ler a ficha do zero.
  await import("@/config/fichaDaLoja");
  await import("@/config/guardaDoIndexCru");
  prepararIosAntigo();
  return root;
}

it("sem o polyfill, o mesmo iPhone vê manutenção mesmo com ficha válida", async () => {
  const root = await prepararAbertura();

  // Restaura antes das asserções: o formatador do próprio Vitest usa hasOwn.
  const erro: unknown = await import("@/config/buildIdentity").catch(
    (falha: unknown) => falha,
  );
  restaurarApis();
  expect(erro).toMatchObject({ message: "IDENTITY_FICHA_INVALID" });
  expect(root.filhos[0]?.filhos[0]?.textContent).toBe("Loja em manutenção");
});

it("abre com a identidade da ficha, sem cair em manutenção, nas APIs do iPhone antigo", async () => {
  const root = await prepararAbertura();
  await carregarPrimeiroImport();

  const { buildIdentity } = await import("@/config/buildIdentity");

  expect(buildIdentity.source).toBe("porteiro");
  expect(buildIdentity.identity.storeName).toBe("Loja da ficha");
  expect(root.filhos).toHaveLength(0);
});

it("mantém a identidade de todas as funções já nativas", async () => {
  vi.stubGlobal("isSecureContext", true);
  const funcoes = apis.map(([alvo, chave]) => ({
    nativa: Reflect.get(alvo, chave),
    atual: () => Reflect.get(alvo, chave),
  }));
  await carregarPrimeiroImport();

  for (const { nativa, atual } of funcoes) {
    expect(typeof nativa).toBe("function");
    expect(atual()).toBe(nativa);
  }
});

it("hasOwn distingue propriedade própria de herdada, inclusive sem protótipo", async () => {
  prepararIosAntigo();
  await carregarPrimeiroImport();

  const chave = Symbol("chave");
  const semPrototipo = { __proto__: null, [chave]: undefined };
  expect(Object.hasOwn(semPrototipo, chave)).toBe(true);
  expect(Object.hasOwn({}, "toString")).toBe(false);
  expect(Reflect.apply(Object.hasOwn, undefined, ["oi", 1])).toBe(true);
  expect(() => Reflect.apply(Object.hasOwn, undefined, [null, "x"])).toThrow(
    TypeError,
  );
  expect(() =>
    Reflect.apply(Object.hasOwn, undefined, [undefined, "x"]),
  ).toThrow(TypeError);
});

it("Array.at é genérico e usa índices negativos, coerção e limites", async () => {
  prepararIosAntigo();
  await carregarPrimeiroImport();

  expect(["a", "b"].at(-1.9)).toBe("b");
  expect(["a", "b"].at(Number.NaN)).toBe("a");
  expect(["a", "b"].at(Number.POSITIVE_INFINITY)).toBeUndefined();
  expect(["a", "b"].at(-3)).toBeUndefined();
  expect(Reflect.apply(Array.prototype.at, "abc", ["-2"])).toBe("b");
  expect(
    Reflect.apply(Array.prototype.at, { length: -1, 0: "a" }, [0]),
  ).toBeUndefined();
  expect(() => Reflect.apply(Array.prototype.at, null, [0])).toThrow(TypeError);
  expect(() => Reflect.apply(Array.prototype.at, [], [1n])).toThrow(TypeError);
});

it("TypedArray.at lê bytes, aceita índice negativo e rejeita receptor comum", async () => {
  prepararIosAntigo();
  await carregarPrimeiroImport();

  const bytes = new Uint8Array([255, 216]);
  expect(bytes.at(-1)).toBe(216);
  expect(bytes.at(2)).toBeUndefined();
  expect(() => Reflect.apply(Uint8Array.prototype.at, [1], [0])).toThrow(
    TypeError,
  );
});

it.each([true, false])(
  "AbortSignal.timeout dá TimeoutError com reason nativo: %s",
  async (reasonNativo) => {
    vi.useFakeTimers();
    prepararIosAntigo();
    if (!reasonNativo) retirarApi(AbortSignal.prototype, "reason");
    await carregarPrimeiroImport();

    const sinal = AbortSignal.timeout(30);
    vi.advanceTimersByTime(29);
    expect(sinal.aborted).toBe(false);
    vi.advanceTimersByTime(1);
    expect(sinal.aborted).toBe(true);
    expect(sinal.reason).toMatchObject({ name: "TimeoutError" });
    expect(() => AbortSignal.timeout(-1)).toThrow(TypeError);
    expect(() => AbortSignal.timeout(Number.MAX_SAFE_INTEGER + 1)).toThrow(
      TypeError,
    );
  },
);

it("AbortSignal.timeout aguarda o último trecho além do limite do timer", async () => {
  vi.useFakeTimers();
  prepararIosAntigo();
  await carregarPrimeiroImport();

  const limite = 0x7fffffff;
  const sinal = AbortSignal.timeout(limite + 1);
  vi.advanceTimersByTime(limite);
  expect(sinal.aborted).toBe(false);
  vi.advanceTimersByTime(1);
  expect(sinal.aborted).toBe(true);
  expect(sinal.reason).toMatchObject({ name: "TimeoutError" });
});

it("throwIfAborted preserva o motivo nativo e funciona no Safari sem reason", async () => {
  prepararIosAntigo();
  await carregarPrimeiroImport();

  const controller = new AbortController();
  expect(() => controller.signal.throwIfAborted()).not.toThrow();
  const motivo = new Error("cancelado");
  controller.abort(motivo);
  expect(() => controller.signal.throwIfAborted()).toThrow(motivo);

  retirarApi(AbortSignal.prototype, "reason");
  expect(() => controller.signal.throwIfAborted()).toThrow(
    expect.objectContaining({ name: "AbortError" }),
  );
});

it("randomUUID usa bytes do gerador seguro e marca versão e variante RFC", async () => {
  prepararIosAntigo();
  const aleatorio = vi
    .spyOn(crypto, "getRandomValues")
    .mockImplementationOnce((bytes) => {
      if (bytes instanceof Uint8Array) bytes.fill(255);
      return bytes;
    })
    .mockImplementationOnce((bytes) => {
      if (bytes instanceof Uint8Array) {
        bytes.set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
      }
      return bytes;
    });
  try {
    await carregarPrimeiroImport();

    expect(crypto.randomUUID()).toBe("ffffffff-ffff-4fff-bfff-ffffffffffff");
    expect(crypto.randomUUID()).toBe("00010203-0405-4607-8809-0a0b0c0d0e0f");
  } finally {
    aleatorio.mockRestore();
  }
});

it("não habilita randomUUID fora de contexto seguro", async () => {
  prepararIosAntigo();
  vi.stubGlobal("isSecureContext", false);
  await carregarPrimeiroImport();

  expect(crypto.randomUUID).toBeUndefined();
});
