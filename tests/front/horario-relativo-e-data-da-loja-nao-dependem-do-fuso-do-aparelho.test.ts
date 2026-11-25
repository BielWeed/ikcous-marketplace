import { dataNoFusoDaLoja, formatarDataHoraBrasilia } from "@/lib/data-da-loja";
// Achado por mutação, 25/11/2026: tirar o `timeZone` de uma das chamadas de
// `horarioRelativo` (a hora "hoje HH:MM", o dia usado para decidir hoje/ontem,
// ou o "DD/MM" das datas antigas) e de `formatarDataHoraBrasilia` (a hora do
// formato curto) deixava a suíte verde NESTA máquina, porque o PC do dono já
// está em Brasília: o fuso do aparelho e o da loja dão a mesma resposta. Na
// loja de quem abre o painel num celular em outro fuso (ou no CI, em UTC) o
// pedido das 10h aparecia como "hoje 13:00", e o de 23h30 como do dia seguinte.
// Aqui o fuso do processo é trocado de verdade (`TZ`, que o Node relê na hora)
// e cada teste confere antes que a troca pegou: sem isso ele passaria de
// graça em qualquer máquina.
import { horarioRelativo } from "@/lib/horario-relativo";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
});

const FUSOS_DO_APARELHO = ["UTC", "Asia/Tokyo"] as const;

describe.each(FUSOS_DO_APARELHO)(
  "com o aparelho em %s, a loja continua no relógio e no calendário de Brasília",
  (fusoDoAparelho) => {
    function aparelhoEm(iso: string, horaLocalEsperada: number) {
      vi.stubEnv("TZ", fusoDoAparelho);
      // Prova de que o fuso trocou: a hora do aparelho NÃO é a de Brasília.
      expect(new Date(iso).getHours()).toBe(horaLocalEsperada);
    }

    it("'hoje' mostra a HORA de Brasília (10:00), não a do aparelho", () => {
      const pedido = "2026-09-02T13:00:00.000Z"; // 10:00 em Brasília
      aparelhoEm(pedido, fusoDoAparelho === "UTC" ? 13 : 22);
      const agora = new Date("2026-09-02T20:00:00.000Z"); // 17:00 em Brasília
      expect(horarioRelativo(pedido, agora)).toBe("hoje 10:00");
    });

    it("o mesmo dia de Brasília é 'hoje' mesmo quando o aparelho já virou o dia", () => {
      // Brasília: os dois no dia 02. Tóquio: pedido dia 02 às 22h, agora dia 03 às 05h.
      const pedido = "2026-09-02T13:00:00.000Z";
      aparelhoEm(pedido, fusoDoAparelho === "UTC" ? 13 : 22);
      const agora = new Date("2026-09-02T20:00:00.000Z");
      expect(horarioRelativo(pedido, agora)).not.toMatch(/^ontem/);
      expect(horarioRelativo(pedido, agora)).toMatch(/^hoje /);
    });

    it("a data antiga é o DD/MM de Brasília: 23h30 do dia 30 não vira dia 31", () => {
      const pedido = "2026-08-31T02:30:00.000Z"; // 30/08 23:30 em Brasília
      aparelhoEm(pedido, fusoDoAparelho === "UTC" ? 2 : 11);
      const agora = new Date("2026-09-10T15:00:00.000Z");
      expect(horarioRelativo(pedido, agora)).toBe("30/08");
    });

    it("o formato curto da data da compra mostra a hora de Brasília", () => {
      const compra = "2026-11-13T02:30:00.000Z"; // 12/11 23:30 em Brasília
      aparelhoEm(compra, fusoDoAparelho === "UTC" ? 2 : 11);
      expect(formatarDataHoraBrasilia(compra, "curto")).toBe("12/11 às 23:30");
      expect(formatarDataHoraBrasilia(compra)).toBe("12/11/2026, 23:30");
    });
  },
);

describe("dataNoFusoDaLoja — o fuso da loja vence qualquer fuso pedido nas opções", () => {
  it("quem passa `timeZone: 'UTC'` ainda lê o dia de Brasília", () => {
    const compra = new Date("2026-11-13T02:30:00.000Z"); // 12/11 em Brasília, 13/11 em UTC
    expect(dataNoFusoDaLoja(compra, { timeZone: "UTC" })).toBe("12/11/2026");
    expect(
      dataNoFusoDaLoja(compra, {
        timeZone: "Asia/Tokyo",
        day: "2-digit",
        month: "2-digit",
      }),
    ).toBe("12/11");
  });
});
