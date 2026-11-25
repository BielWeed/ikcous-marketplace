// Cor do dinheiro no painel: verde entrou, vermelho saiu, cinza no zero — e o
// zero é DECIDIDO em centavos (uma sobra de 0,0000001 não pode pintar de verde).
// Também a cor de cada tipo de conta financeira (ícone/gráfico). `corDoResultado`,
// `valorNaCor` e `matizDoTipoDeConta` não tinham teste próprio.
import { matizDoTipoDeConta } from "@/components/admin/financeiro/icones";
import { corDoResultado } from "@/components/admin/financeiro/partesDoResultado";
import { valorNaCor } from "@/components/admin/inicio/visualDoInicio";
import { describe, expect, it } from "vitest";

const VERDE = "text-emerald-400";
const VERMELHO = "text-red-400";
const CINZA = "text-zinc-400";

describe("corDoResultado", () => {
  it("positivo é verde, negativo é vermelho, zero é cinza", () => {
    expect(corDoResultado(10)).toBe(VERDE);
    expect(corDoResultado(-10)).toBe(VERMELHO);
    expect(corDoResultado(0)).toBe(CINZA);
  });

  it("zero negativo (-0) é cinza, não vermelho", () => {
    expect(corDoResultado(-0)).toBe(CINZA);
  });

  it("menos de meio centavo, para cima ou para baixo, é cinza (arredonda em centavos)", () => {
    expect(corDoResultado(0.0000001)).toBe(CINZA);
    expect(corDoResultado(-0.0000001)).toBe(CINZA);
    expect(corDoResultado(0.004)).toBe(CINZA);
    expect(corDoResultado(-0.004)).toBe(CINZA);
  });

  it("de meio centavo para cima já é um centavo: verde/vermelho", () => {
    expect(corDoResultado(0.01)).toBe(VERDE);
    expect(corDoResultado(-0.01)).toBe(VERMELHO);
    expect(corDoResultado(0.006)).toBe(VERDE);
    expect(corDoResultado(-0.006)).toBe(VERMELHO);
  });

  it("valor grande de cada sinal", () => {
    expect(corDoResultado(1_234_567.89)).toBe(VERDE);
    expect(corDoResultado(-1_234_567.89)).toBe(VERMELHO);
  });

  it("valor que não é número (NaN) cai no cinza, sem quebrar", () => {
    expect(corDoResultado(Number.NaN)).toBe(CINZA);
  });
});

describe("valorNaCor", () => {
  const BASE =
    "break-words font-bold tabular-nums tracking-tight [overflow-wrap:anywhere]";

  it("junta a base do número com a cor do tom", () => {
    expect(valorNaCor("positivo")).toBe(`${BASE} ${VERDE}`);
    expect(valorNaCor("negativo")).toBe(`${BASE} ${VERMELHO}`);
    expect(valorNaCor("neutro")).toBe(`${BASE} ${CINZA}`);
  });

  it("atenção e informação também têm a sua cor", () => {
    expect(valorNaCor("atencao")).toBe(`${BASE} text-amber-400`);
    expect(valorNaCor("info")).toBe(`${BASE} text-sky-400`);
  });

  it("nunca quebra o número no meio da linha por espaço (tem a base inteira)", () => {
    for (const tom of [
      "positivo",
      "negativo",
      "atencao",
      "info",
      "neutro",
    ] as const) {
      expect(valorNaCor(tom)).toContain("tabular-nums");
      expect(valorNaCor(tom)).toContain("[overflow-wrap:anywhere]");
    }
  });
});

describe("matizDoTipoDeConta", () => {
  it("cada tipo conhecido tem a sua cor", () => {
    expect(matizDoTipoDeConta("caixa")).toBe("#2DD4BF");
    expect(matizDoTipoDeConta("banco")).toBe("#7AA2FF");
    expect(matizDoTipoDeConta("mercado_pago")).toBe("#BA9AFF");
  });

  it("tipo desconhecido, vazio ou com outra caixa cai na cor das outras contas", () => {
    expect(matizDoTipoDeConta("outro")).toBe("#FF8BB2");
    expect(matizDoTipoDeConta("")).toBe("#FF8BB2");
    expect(matizDoTipoDeConta("Caixa")).toBe("#FF8BB2");
    expect(matizDoTipoDeConta("mercadopago")).toBe("#FF8BB2");
  });

  it("os quatro matizes são diferentes entre si (a conta não se confunde no gráfico)", () => {
    const cores = ["caixa", "banco", "mercado_pago", "x"].map(
      matizDoTipoDeConta,
    );
    expect(new Set(cores).size).toBe(4);
  });
});
