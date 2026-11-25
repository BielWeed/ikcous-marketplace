// PRAZO DA RESERVA NA TELA DO CARTÃO — o que `lerPrazoEmMs` entrega ao
// `Date.parse` (`src/components/checkout/mensagens-do-cartao.ts`).
//
// O Postgres devolve de 1 a 6 dígitos de fração, e os motores mais antigos
// (os iPhones antigos que a loja ainda atende) só aceitam EXATAMENTE 3: com
// 6 dígitos o `Date.parse` deles devolve `NaN` e a tela perderia o horário do
// prazo ("Prazo informado: até ..."). O Node aceita qualquer quantidade, então
// um teste que só compara o resultado NÃO enxerga essa regra: achado por
// mutação — trocar `.slice(0, 3)` por `.slice(0, 4)`, ou deixar a expressão
// regular sem pegar o fuso `+hh:mm`, ou limitar a fração a 3 dígitos, não
// derrubava teste nenhum. Aqui se espia a texto que chega ao `Date.parse`.
import { afterEach, describe, expect, it, vi } from "vitest";

import { lerPrazoEmMs } from "@/components/checkout/mensagens-do-cartao";

afterEach(() => {
  vi.restoreAllMocks();
});

function textoEnviadoAoParse(entrada: string): string | undefined {
  const espiao = vi.spyOn(Date, "parse");
  lerPrazoEmMs(entrada);
  const chamada = espiao.mock.calls.at(0);
  espiao.mockRestore();
  return chamada?.[0];
}

describe("lerPrazoEmMs — o Date.parse recebe a fração com exatamente 3 dígitos", () => {
  it("6 dígitos com Z: corta para 3 (sem arredondar)", () => {
    expect(textoEnviadoAoParse("2026-11-24T12:00:00.123456Z")).toBe(
      "2026-11-24T12:00:00.123Z",
    );
    expect(textoEnviadoAoParse("2026-11-24T12:00:00.999999Z")).toBe(
      "2026-11-24T12:00:00.999Z",
    );
  });

  it("4 e 5 dígitos também são cortados para 3", () => {
    expect(textoEnviadoAoParse("2026-11-24T12:00:00.1234Z")).toBe(
      "2026-11-24T12:00:00.123Z",
    );
    expect(textoEnviadoAoParse("2026-11-24T12:00:00.98765Z")).toBe(
      "2026-11-24T12:00:00.987Z",
    );
  });

  it("1 e 2 dígitos são completados com zeros à direita", () => {
    expect(textoEnviadoAoParse("2026-11-24T12:00:00.5Z")).toBe(
      "2026-11-24T12:00:00.500Z",
    );
    expect(textoEnviadoAoParse("2026-11-24T12:00:00.42Z")).toBe(
      "2026-11-24T12:00:00.420Z",
    );
  });

  it("fuso com deslocamento, negativo ou positivo, também chega com 3 dígitos e o mesmo fuso", () => {
    expect(textoEnviadoAoParse("2026-11-24T09:00:00.123456-03:00")).toBe(
      "2026-11-24T09:00:00.123-03:00",
    );
    expect(textoEnviadoAoParse("2026-11-24T17:30:00.987654+05:30")).toBe(
      "2026-11-24T17:30:00.987+05:30",
    );
    expect(textoEnviadoAoParse("2026-11-24T09:00:00.5-03:00")).toBe(
      "2026-11-24T09:00:00.500-03:00",
    );
  });

  it("Z minúsculo também é normalizado", () => {
    expect(textoEnviadoAoParse("2026-11-24T12:00:00.123456z")).toBe(
      "2026-11-24T12:00:00.123z",
    );
  });

  it("sem fração, ou com exatamente 3 dígitos, o texto segue como veio", () => {
    expect(textoEnviadoAoParse("2026-11-24T12:00:00Z")).toBe(
      "2026-11-24T12:00:00Z",
    );
    expect(textoEnviadoAoParse("2026-11-24T12:00:00.123Z")).toBe(
      "2026-11-24T12:00:00.123Z",
    );
  });
});
