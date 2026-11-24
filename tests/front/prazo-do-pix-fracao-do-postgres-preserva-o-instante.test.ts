// PRAZO DO PIX — a fração de segundo que o Postgres devolve.
//
// O Postgres entrega `expires_at` com 1 a 6 dígitos de fração ("...00.5Z",
// "...00.123456Z") e o `Date.parse` interoperável só aceita 3. `lerPrazoDoPixEmMs`
// normaliza sem mudar o instante nem o fuso. Mutação em
// `src/lib/prazo-do-pix.ts`: trocar o preenchimento `padEnd(3, "0")` por outro
// dígito NÃO derrubava teste algum — e um prazo que anda centenas de
// milissegundos desloca o instante em que a tela troca "Prazo informado" por
// "o horário previsto já passou" (`prazoDoPixPassou`, que compara no
// milissegundo).
import { describe, expect, it } from "vitest";

import { lerPrazoDoPixEmMs, prazoDoPixPassou } from "@/lib/prazo-do-pix";

describe("lerPrazoDoPixEmMs — fração do Postgres", () => {
  it("fração curta é completada com zeros à DIREITA: .5 vale 500 ms, .05 vale 50 ms", () => {
    expect(lerPrazoDoPixEmMs("2026-11-24T15:30:00.5Z")).toBe(
      Date.parse("2026-11-24T15:30:00.500Z"),
    );
    expect(lerPrazoDoPixEmMs("2026-11-24T15:30:00.05Z")).toBe(
      Date.parse("2026-11-24T15:30:00.050Z"),
    );
  });

  it("fração longa é TRUNCADA em milissegundos (não arredondada): .123999 vale 123 ms", () => {
    expect(lerPrazoDoPixEmMs("2026-11-24T15:30:00.123999Z")).toBe(
      Date.parse("2026-11-24T15:30:00.123Z"),
    );
  });

  it("fuso com deslocamento mantém o instante: -03:00 com fração de 6 dígitos", () => {
    expect(lerPrazoDoPixEmMs("2026-11-24T12:30:00.987654-03:00")).toBe(
      Date.parse("2026-11-24T15:30:00.987Z"),
    );
    expect(lerPrazoDoPixEmMs("2026-11-24T18:30:00.4+03:00")).toBe(
      Date.parse("2026-11-24T15:30:00.400Z"),
    );
  });

  it("sem fração nada muda", () => {
    expect(lerPrazoDoPixEmMs("2026-11-24T15:30:00Z")).toBe(
      Date.parse("2026-11-24T15:30:00.000Z"),
    );
  });

  it("a fração decide a fronteira: com .5 s, 499 ms depois do segundo cheio ainda não passou", () => {
    const vencimento = lerPrazoDoPixEmMs("2026-11-24T15:30:00.5Z");
    const segundoCheio = Date.parse("2026-11-24T15:30:00.000Z");
    expect(prazoDoPixPassou(vencimento, segundoCheio + 499)).toBe(false);
    expect(prazoDoPixPassou(vencimento, segundoCheio + 500)).toBe(true);
  });
});
