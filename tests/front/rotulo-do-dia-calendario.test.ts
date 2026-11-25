// Eixo e dica do gráfico do painel: o rótulo vem da própria data "AAAA-MM-DD",
// sem passar por Date (que no fuso do Brasil escorregaria um dia). A série só
// mostra o ano quando cruza a virada. Sem teste próprio, o corte do ano, a
// ordem dia/mês e a comparação do ano podiam mudar sem nada reprovar.
import {
  rotuloDoDia,
  serieCobreMaisDeUmAno,
} from "@/components/admin/dashboard/rotulo-do-dia";
import { describe, expect, it } from "vitest";

describe("rotuloDoDia", () => {
  it("escreve dia/mês, nessa ordem, sem ano", () => {
    expect(rotuloDoDia("2026-11-05", false)).toBe("05/11");
    expect(rotuloDoDia("2026-01-31", false)).toBe("31/01");
  });

  it("com ano mostra só os dois últimos dígitos", () => {
    expect(rotuloDoDia("2026-11-05", true)).toBe("05/11/26");
    expect(rotuloDoDia("2099-12-31", true)).toBe("31/12/99");
    expect(rotuloDoDia("2100-01-01", true)).toBe("01/01/00");
  });

  it("não escorrega de dia por fuso: 1º de janeiro e 31 de dezembro ficam como estão", () => {
    expect(rotuloDoDia("2027-01-01", true)).toBe("01/01/27");
    expect(rotuloDoDia("2026-12-31", true)).toBe("31/12/26");
  });

  it("data sem os três pedaços volta como veio, com ou sem ano", () => {
    expect(rotuloDoDia("2026-11", true)).toBe("2026-11");
    expect(rotuloDoDia("2026", false)).toBe("2026");
    expect(rotuloDoDia("", true)).toBe("");
  });

  it("exatamente três pedaços já formata (a fronteira do corte)", () => {
    expect(rotuloDoDia("2026-1-2", false)).toBe("2/1");
  });
});

describe("serieCobreMaisDeUmAno", () => {
  const dias = (...datas: string[]) => datas.map((date) => ({ date }));

  it("série vazia não cobre mais de um ano (e não lê o primeiro dia)", () => {
    expect(serieCobreMaisDeUmAno([])).toBe(false);
  });

  it("um dia só, ou todos no mesmo ano: não", () => {
    expect(serieCobreMaisDeUmAno(dias("2026-11-05"))).toBe(false);
    expect(
      serieCobreMaisDeUmAno(dias("2026-01-01", "2026-06-15", "2026-12-31")),
    ).toBe(false);
  });

  it("cruzou a virada do ano: sim", () => {
    expect(serieCobreMaisDeUmAno(dias("2026-12-31", "2027-01-01"))).toBe(true);
  });

  it("só o último dia é de outro ano: sim (olha todos, não só o segundo)", () => {
    expect(
      serieCobreMaisDeUmAno(
        dias("2026-11-01", "2026-11-02", "2026-11-03", "2027-01-01"),
      ),
    ).toBe(true);
  });

  it("compara o ano inteiro de quatro dígitos, não só o último dígito", () => {
    expect(serieCobreMaisDeUmAno(dias("2026-05-01", "2126-05-01"))).toBe(true);
  });

  it("o mês igual com ano diferente não engana", () => {
    expect(serieCobreMaisDeUmAno(dias("2026-11-05", "2025-11-05"))).toBe(true);
  });
});
