import { horarioRelativo } from "@/lib/horario-relativo";
import { describe, expect, it } from "vitest";

// Âncora fixa: 02/09/2026 15:00 local. Os casos passam ISO com o MESMO fuso
// local via construtor de Date local (new Date(ano, mês, dia, h, min)).
const AGORA = new Date(2026, 8, 2, 15, 0, 0);
const iso = (d: Date) => d.toISOString();
const haMinutos = (min: number) => iso(new Date(AGORA.getTime() - min * 60000));

describe("horarioRelativo", () => {
  it("menos de 2 min é agora mesmo", () => {
    expect(horarioRelativo(haMinutos(0), AGORA)).toBe("agora mesmo");
    expect(horarioRelativo(haMinutos(1), AGORA)).toBe("agora mesmo");
  });

  it("menos de 1 hora usa há N min", () => {
    expect(horarioRelativo(haMinutos(5), AGORA)).toBe("há 5 min");
    expect(horarioRelativo(haMinutos(59), AGORA)).toBe("há 59 min");
  });

  it("hoje mostra a hora", () => {
    const d = new Date(2026, 8, 2, 8, 5, 0);
    expect(horarioRelativo(iso(d), AGORA)).toMatch(/^hoje 08:05/);
  });

  it("ontem mostra ontem e a hora", () => {
    const d = new Date(2026, 8, 1, 23, 10, 0);
    expect(horarioRelativo(iso(d), AGORA)).toMatch(/^ontem 23:10/);
  });

  it('"ontem" cruzando o mês (agora 01/09, pedido 31/08)', () => {
    const agora = new Date(2026, 8, 1, 0, 30, 0);
    const d = new Date(2026, 7, 31, 22, 15, 0);
    expect(horarioRelativo(iso(d), agora)).toMatch(/^ontem 22:15/);
  });

  it("antigo no mesmo ano mostra DD/MM", () => {
    const d = new Date(2026, 7, 16, 10, 0, 0);
    expect(horarioRelativo(iso(d), AGORA)).toBe("16/08");
  });

  it("antigo em outro ano acrescenta o ano", () => {
    const d = new Date(2024, 7, 16, 10, 0, 0);
    expect(horarioRelativo(iso(d), AGORA)).toBe("16/08/24");
  });

  it("data inválida devolve vazio", () => {
    expect(horarioRelativo("não é data", AGORA)).toBe("");
  });
});
