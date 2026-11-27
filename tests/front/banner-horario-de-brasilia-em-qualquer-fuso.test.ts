// A programação do banner (início e fim) é o horário de BRASÍLIA, nunca o do
// aparelho de quem abre o painel. Antes (27/11/2026) o campo `datetime-local`
// era lido com `new Date(valor)`, no fuso do aparelho: num computador em UTC, o
// banner marcado para 28/11 00:00 entrava às 21:00 do dia 27 em Brasília, e a
// tela devolvia o mesmo "28/11 00:00" que a lojista digitou, então ela não
// percebia. Mesmo padrão da validade do cupom (`validade-do-cupom.ts`).
//
// As provas trocam o fuso do processo (`process.env.TZ`, que o Node relê na
// hora) e afirmam INSTANTES LITERAIS em UTC escritos à mão. O fuso volta ao que
// era depois de cada teste (no Windows, apagar `TZ` não devolve o da máquina).
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  campoDoBannerDoInstante,
  fimDoBannerEmTexto,
  instanteDoCampoDoBanner,
  periodoDoAtalhoDoBanner,
} from "@/lib/datas-do-banner";

const fusoDaMaquina =
  process.env.TZ ?? new Intl.DateTimeFormat().resolvedOptions().timeZone;
afterEach(() => {
  process.env.TZ = fusoDaMaquina;
});

const FUSOS_DO_APARELHO = [
  "America/Sao_Paulo", // controle: a loja
  "UTC", // o CI, e computador com fuso de fábrica
  "America/Manaus", // -04:00
  "America/Noronha", // -02:00
  "Asia/Tokyo", // +09:00
  "Pacific/Auckland", // +13:00 em novembro (horário de verão)
] as const;

describe.each(FUSOS_DO_APARELHO)("banner, aparelho em %s", (fuso) => {
  beforeEach(() => {
    process.env.TZ = fuso;
  });

  it("o que a lojista digita no campo é horário de Brasília", () => {
    // 28/11 00:00 de Brasília = 03:00 UTC.
    expect(instanteDoCampoDoBanner("2026-11-28T00:00")).toBe(
      "2026-11-28T03:00:00.000Z",
    );
    // 31/12 23:30 de Brasília já é 01/01 em UTC.
    expect(instanteDoCampoDoBanner("2026-12-31T23:30")).toBe(
      "2027-01-01T02:30:00.000Z",
    );
    // Com segundos (campo com `step` menor que 60).
    expect(instanteDoCampoDoBanner("2026-11-29T23:59:59")).toBe(
      "2026-11-30T02:59:59.000Z",
    );
  });

  it("o campo mostra o instante gravado em horário de Brasília", () => {
    expect(campoDoBannerDoInstante("2026-11-28T03:00:00.000Z")).toBe(
      "2026-11-28T00:00",
    );
    // 02:30 UTC de 01/01 ainda é 31/12 em Brasília.
    expect(campoDoBannerDoInstante("2027-01-01T02:30:00.000Z")).toBe(
      "2026-12-31T23:30",
    );
  });

  it("ida e volta pelo campo devolve o que a lojista digitou", () => {
    for (const valor of [
      "2026-11-28T00:00",
      "2028-02-29T12:05",
      "2026-01-01T00:00",
    ]) {
      expect(campoDoBannerDoInstante(instanteDoCampoDoBanner(valor))).toBe(
        valor,
      );
    }
  });

  it("campo vazio ou impossível não vira data", () => {
    expect(instanteDoCampoDoBanner("")).toBeNull();
    expect(instanteDoCampoDoBanner("2026-13-01T10:00")).toBeNull();
    expect(instanteDoCampoDoBanner("2026-02-30T10:00")).toBeNull();
    expect(instanteDoCampoDoBanner("2026-11-28T24:00")).toBeNull();
    expect(instanteDoCampoDoBanner("2026-11-28T10:60")).toBeNull();
    expect(instanteDoCampoDoBanner("2026-11-28")).toBeNull();
    expect(instanteDoCampoDoBanner("isto-nao-e-data")).toBeNull();
    expect(campoDoBannerDoInstante(null)).toBe("");
    expect(campoDoBannerDoInstante("xx")).toBe("");
  });

  it("o fim em palavras usa a hora e o dia de Brasília", () => {
    // Agora: 27/11 22:00 de Brasília (28/11 01:00 UTC).
    const agora = new Date("2026-11-28T01:00:00.000Z");
    // Fim: 28/11 00:00 de Brasília = amanhã, não "hoje às 03:00".
    expect(fimDoBannerEmTexto("2026-11-28T03:00:00.000Z", agora)).toBe(
      "Termina amanhã às 00:00.",
    );
    // Fim: 27/11 23:59 de Brasília = hoje.
    expect(fimDoBannerEmTexto("2026-11-28T02:59:00.000Z", agora)).toBe(
      "Termina hoje às 23:59.",
    );
    expect(fimDoBannerEmTexto("2026-11-27T12:00:00.000Z", agora)).toBe(
      "Já terminou em 27/11 às 09:00.",
    );
  });

  it("'Fim de Semana' vai de sábado 00:00 a domingo 23:59:59 de Brasília", () => {
    // Sexta 27/11 22:00 de Brasília (já é sábado 28/11 em UTC).
    const periodo = periodoDoAtalhoDoBanner(
      "weekend",
      new Date("2026-11-28T01:00:00.000Z"),
    );
    expect(periodo.inicio.toISOString()).toBe("2026-11-28T03:00:00.000Z");
    expect(periodo.fim.toISOString()).toBe("2026-11-30T02:59:59.000Z");
  });

  it("'Fim de Semana' no domingo à noite de Brasília começa agora e termina no mesmo domingo", () => {
    // Domingo 29/11 22:00 de Brasília (segunda 30/11 em UTC).
    const agora = new Date("2026-11-30T01:00:00.000Z");
    const periodo = periodoDoAtalhoDoBanner("weekend", agora);
    expect(periodo.inicio.toISOString()).toBe(agora.toISOString());
    expect(periodo.fim.toISOString()).toBe("2026-11-30T02:59:59.000Z");
  });

  it("os atalhos de duração são agora + N x 24 h, em qualquer fuso", () => {
    const agora = new Date("2026-11-27T18:30:20.123Z");
    const dia = 24 * 60 * 60 * 1000;
    for (const [atalho, dias] of [
      ["24h", 1],
      ["7d", 7],
      ["30d", 30],
    ] as const) {
      const periodo = periodoDoAtalhoDoBanner(atalho, agora);
      expect(periodo.inicio.getTime()).toBe(agora.getTime());
      expect(periodo.fim.getTime()).toBe(agora.getTime() + dias * dia);
    }
  });
});
