// @vitest-environment jsdom
import { quandoFoiAberta } from "@/components/admin/pdv/AvisoDeVendaAntiga";
import { describe, expect, it } from "vitest";

// Caça por mutação em `quandoFoiAberta` (a frase "desde ontem, às 17:42" do
// aviso de venda antiga no balcão). O teste vizinho
// (`balcao-cupom-de-ontem-pede-decisao.test.tsx`) olha sempre "agora" ao
// meio-dia de Brasília, e três coisas passavam em branco:
//   - o "ontem" é o dia de Brasília de (agora - 24 h). Com 23 h, quando o balcão
//     abre a partir das 23h de Brasília o "ontem" vira o próprio hoje e a venda
//     da véspera dizia "desde 05/11"; com 25 h, abrindo logo depois da
//     meia-noite, o "ontem" pulava para anteontem e dizia o mesmo;
//   - a data de uma venda mais velha ("desde 02/11") era escrita no dia em UTC,
//     não no dia de Brasília: venda de 21h30 do dia 02 saía "desde 03/11".
// Instantes literais em UTC (Brasília = UTC-3), sem depender do fuso da máquina.

const em = (iso: string) => Date.parse(iso);

describe("quandoFoiAberta — 'ontem' nas pontas do dia de Brasília", () => {
  // 10:00 de 05/11/2026 em Brasília.
  const VENDA_DA_VESPERA = em("2026-11-05T13:00:00Z");

  it("às 23h30 de 06/11, a venda das 10h de 05/11 é 'desde ontem'", () => {
    const agora = em("2026-11-07T02:30:00Z");
    expect(quandoFoiAberta(VENDA_DA_VESPERA, agora)).toBe(
      "desde ontem, às 10:00",
    );
  });

  it("às 00h30 de 06/11, a venda das 10h de 05/11 é 'desde ontem'", () => {
    const agora = em("2026-11-06T03:30:00Z");
    expect(quandoFoiAberta(VENDA_DA_VESPERA, agora)).toBe(
      "desde ontem, às 10:00",
    );
  });

  it("às 23h30 de 06/11, a venda de anteontem já diz só a data", () => {
    const agora = em("2026-11-07T02:30:00Z");
    expect(quandoFoiAberta(em("2026-11-04T13:00:00Z"), agora)).toBe(
      "desde 04/11, às 10:00",
    );
  });
});

describe("quandoFoiAberta — a data de venda mais velha é a do calendário de Brasília", () => {
  it("venda de 21h30 de 02/11 (já 03/11 em UTC) diz 'desde 02/11'", () => {
    const agora = em("2026-11-06T15:00:00Z");
    expect(quandoFoiAberta(em("2026-11-03T00:30:00Z"), agora)).toBe(
      "desde 02/11, às 21:30",
    );
  });
});
