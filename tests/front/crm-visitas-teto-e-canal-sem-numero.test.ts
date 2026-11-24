// Duas fronteiras do funil de visitas que nenhum teste segurava (achadas por
// mutação em 24/11/2026):
//  - dia no teto do contador (visita contada demais) avisa "não confiável"
//    em TODOS os estados que mostram um número, não só no "completo": se o
//    aviso some no "Contando desde ..." a lojista lê um número inflado como
//    se fosse bom;
//  - canal conhecido sem o número de visitas é descartado, em vez de entrar
//    na lista com "undefined" ou zero inventado.
import { estadoDasVisitas, lerVisitasDoCrm } from "@/lib/crm";
import { describe, expect, it } from "vitest";

const TETO = { dia: "2026-10-20", canal: "direto" };
const BASE = {
  contando_desde: "2026-09-01",
  visitas: 42,
  canais: [{ canal: "direto", visitas: 42 }],
  previas: 0,
  no_teto: [TETO],
};

describe("dia no teto do contador de visitas", () => {
  it("período que começa antes do contador (parcial): aviso de data e não confiável", () => {
    const lida = lerVisitasDoCrm({ ...BASE, contando_desde: "2026-11-02" });

    expect(
      estadoDasVisitas(lida, { inicio: "2026-10-01", fim: "2026-11-03" }),
    ).toEqual({
      tipo: "parcial",
      aviso: "Contando desde 02/11/2026",
      naoConfiavel: true,
    });
  });

  it("visitas ainda não contadas (a-contar): aviso de data e não confiável", () => {
    const lida = lerVisitasDoCrm({
      ...BASE,
      contando_desde: "2026-11-02",
      visitas: null,
    });

    expect(
      estadoDasVisitas(lida, { inicio: "2026-10-01", fim: "2026-10-31" }),
    ).toEqual({
      tipo: "a-contar",
      aviso: "A contar a partir de 02/11/2026",
      naoConfiavel: true,
    });
  });
});

describe("canal de visitas sem número", () => {
  it("canal conhecido sem visitas (ou com texto no lugar) não entra na lista", () => {
    const lida = lerVisitasDoCrm({
      ...BASE,
      no_teto: [],
      canais: [
        { canal: "direto", visitas: 10 },
        { canal: "instagram" },
        { canal: "whatsapp", visitas: "muitas" },
        { canal: "outros_sites", visitas: 0 },
      ],
    });

    // Zero medido continua na lista; o que não tem número sai.
    expect(lida?.canais).toEqual([
      { rotulo: "Direto", visitas: 10 },
      { rotulo: "Outros sites", visitas: 0 },
    ]);
  });
});
