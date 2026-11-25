// Achado por mutação, 25/11/2026: trocar a tolerância de `arredondarParaCentavos`
// (`Number.EPSILON * max(1, centavos) * 2`) por 1x ou por 0,5x deixava a suíte
// verde. Os testes só tinham decimais "limpos" (1.005, 2.675) e uma subtração
// com ruído de UM ulp; mas total de pedido é conta de preço menos desconto, e
// essas diferenças chegam com até dois ulps de erro. Exemplos reais da forma
// "R$ 0,18 menos R$ 0,135": o valor exato é 4,5 centavos e tem de dar 5 (o
// banco `numeric` arredonda a metade para longe do zero), mas em ponto flutuante
// vira 0.044999999999999984 e, com tolerância curta, sai 4 centavos: a cliente
// via no checkout um total 1 centavo menor que o que o servidor cobra.
// Os valores foram achados por busca exaustiva (preço em centavos menos desconto
// em milésimos, resultado exato terminando em 5 milésimos).
import { arredondarParaCentavos } from "@/lib/utils";
import { describe, expect, it } from "vitest";

describe("arredondarParaCentavos — diferença de dois decimais que cai em meio centavo", () => {
  it.each([
    [0.18 - 0.135, 0.05],
    [0.29 - 0.195, 0.1],
    [0.21 - 0.165, 0.05],
    [0.03 - 0.025, 0.01],
    [0.04 - 0.035, 0.01],
    [0.12 - 0.085, 0.04],
  ])("%s reais resulta em %s reais", (valor, esperado) => {
    expect(arredondarParaCentavos(valor)).toBe(esperado);
  });

  it("o negativo espelha o positivo (metade para longe do zero)", () => {
    expect(arredondarParaCentavos(-(0.18 - 0.135))).toBe(-0.05);
    expect(arredondarParaCentavos(-(0.03 - 0.025))).toBe(-0.01);
  });
});
