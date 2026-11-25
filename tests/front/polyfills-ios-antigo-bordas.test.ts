/**
 * Bordas do polyfill do iPhone antigo (src/polyfills-ios-antigo.ts) que o
 * `polyfills-ios-antigo.test.ts` não derruba: o teto de comprimento do
 * `Array.prototype.at` (ToLength, 2^53 - 1) e a conversão de `ms` do
 * `AbortSignal.timeout` (fração e texto numérico, como o navegador de verdade).
 *
 * Cada caso é DIFERENCIAL: a resposta esperada é a do método NATIVO do Node,
 * capturado antes de o teste retirar a API. Assim o polyfill é cobrado pelo
 * comportamento do navegador, não pelo que o autor imaginou.
 *
 * Mutante equivalente (sem teste possível, anotado de propósito): trocar
 * `Math.max(0, inteiro(objeto.length))` por `inteiro(objeto.length)`. Com
 * tamanho negativo, `posicao < tamanho` é falso para qualquer índice (o
 * relativo positivo fica acima e o negativo vira ainda mais negativo), então a
 * resposta é `undefined` nos dois casos.
 * Outro equivalente: `Math.trunc(+ms)` por `Math.trunc(ms)` em
 * `AbortSignal.timeout` — o `Math.trunc` já aplica ToNumber, o `+` é redundante.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nativoAt = Array.prototype.at;
const apis = [
  [Array.prototype, "at"],
  [AbortSignal, "timeout"],
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

async function carregarComoIosAntigo() {
  for (const [alvo, chave] of apis) retirarApi(alvo, chave);
  await import("@/polyfills-ios-antigo");
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  for (const restauracao of restaurar.splice(0).reverse()) restauracao();
  vi.useRealTimers();
});

describe("Array.prototype.at — comprimento gigante (ToLength)", () => {
  const MAX = Number.MAX_SAFE_INTEGER;
  // Objetos "tipo array" com comprimento além do teto seguro.
  const casos: Array<[string, () => ArrayLike<unknown>, number]> = [
    [
      "length acima do teto, último elemento (-1)",
      () => ({ length: MAX + 10, [MAX - 1]: "fim" }),
      -1,
    ],
    [
      "length infinito, último elemento (-1)",
      () => ({ length: Number.POSITIVE_INFINITY, [MAX - 1]: "fim" }),
      -1,
    ],
    [
      "length acima do teto, índice 0",
      () => ({ length: MAX + 10, 0: "inicio" }),
      0,
    ],
    [
      "length acima do teto, índice acima do teto",
      () => ({ length: MAX + 10, [MAX]: "alem" }),
      MAX,
    ],
  ];

  it.each(casos)(
    "%s dá o mesmo que o nativo",
    async (_nome, fabrica, indice) => {
      const esperado = Reflect.apply(nativoAt, fabrica(), [indice]);
      await carregarComoIosAntigo();
      expect(Array.prototype.at).not.toBe(nativoAt);
      expect(Reflect.apply(Array.prototype.at, fabrica(), [indice])).toBe(
        esperado,
      );
    },
  );

  it("o caso do último elemento de fato acha o elemento (o teste não é vazio)", async () => {
    await carregarComoIosAntigo();
    expect(
      Reflect.apply(
        Array.prototype.at,
        { length: MAX + 10, [MAX - 1]: "fim" },
        [-1],
      ),
    ).toBe("fim");
  });
});

describe("AbortSignal.timeout — conversão de ms como no navegador", () => {
  it("aceita fração (trunca) em vez de recusar: 1,9 ms vira 1 ms", async () => {
    vi.useFakeTimers();
    await carregarComoIosAntigo();

    let sinal: AbortSignal | undefined;
    expect(() => {
      sinal = AbortSignal.timeout(1.9);
    }).not.toThrow();
    vi.advanceTimersByTime(0);
    expect(sinal?.aborted).toBe(false);
    vi.advanceTimersByTime(1);
    expect(sinal?.aborted).toBe(true);
  });

  it("aceita texto numérico, como a conversão do navegador", async () => {
    vi.useFakeTimers();
    await carregarComoIosAntigo();

    const sinal = AbortSignal.timeout("20" as unknown as number);
    vi.advanceTimersByTime(19);
    expect(sinal.aborted).toBe(false);
    vi.advanceTimersByTime(1);
    expect(sinal.aborted).toBe(true);
  });

  it("recusa o que não é número finito (NaN, Infinity, texto solto)", async () => {
    await carregarComoIosAntigo();

    expect(() => AbortSignal.timeout(Number.NaN)).toThrow(TypeError);
    expect(() => AbortSignal.timeout(Number.POSITIVE_INFINITY)).toThrow(
      TypeError,
    );
    expect(() => AbortSignal.timeout("breve" as unknown as number)).toThrow(
      TypeError,
    );
  });

  it("zero é prazo válido e já estoura no próximo tick", async () => {
    vi.useFakeTimers();
    await carregarComoIosAntigo();

    const sinal = AbortSignal.timeout(0);
    expect(sinal.aborted).toBe(false);
    vi.advanceTimersByTime(0);
    expect(sinal.aborted).toBe(true);
  });
});
