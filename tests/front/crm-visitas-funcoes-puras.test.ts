// Visitas da loja no funil do CRM (src/lib/crm.ts): o leitor defensivo de
// `crm_visitas` e o estado que decide o que o funil mostra. Regra da casa:
// "não sei" nunca vira zero — antes do contador existir, o funil avisa
// "A contar a partir de ..." em vez de um "0" enganoso.
import { describe, expect, it } from "vitest";

import { estadoDasVisitas, lerVisitasDoCrm } from "@/lib/crm";

const PERIODO = { inicio: "2026-10-01", fim: "2026-11-03" };

const COMPLETO = {
  contando_desde: "2026-09-01",
  visitas: 42,
  canais: [
    { canal: "direto", visitas: 20 },
    { canal: "instagram", visitas: 12 },
    { canal: "whatsapp", visitas: 6 },
    { canal: "outros_sites", visitas: 4 },
  ],
  previas: 9,
  periodo_completo: true,
};

describe("lerVisitasDoCrm", () => {
  it("mapeia o JSON válido, com os rótulos em português", () => {
    expect(lerVisitasDoCrm(COMPLETO)).toEqual({
      contandoDesde: "2026-09-01",
      visitas: 42,
      canais: [
        { rotulo: "Direto", visitas: 20 },
        { rotulo: "Instagram", visitas: 12 },
        { rotulo: "WhatsApp", visitas: 6 },
        { rotulo: "Outros sites", visitas: 4 },
      ],
      previas: 9,
    });
  });

  it("ignora canal desconhecido e nunca põe a prévia na lista de pessoas", () => {
    const lida = lerVisitasDoCrm({
      ...COMPLETO,
      canais: [
        ...COMPLETO.canais,
        { canal: "previa", visitas: 9 },
        { canal: "tiktok", visitas: 3 },
      ],
    });
    expect(lida?.canais.map((c) => c.rotulo)).toEqual([
      "Direto",
      "Instagram",
      "WhatsApp",
      "Outros sites",
    ]);
    expect(lida?.visitas).toBe(42);
  });

  it("recusa formato estranho", () => {
    expect(lerVisitasDoCrm(null)).toBeNull();
    expect(lerVisitasDoCrm("42")).toBeNull();
    expect(lerVisitasDoCrm([])).toBeNull();
    expect(lerVisitasDoCrm({ ...COMPLETO, canais: "x" })).toBeNull();
    expect(lerVisitasDoCrm({ ...COMPLETO, visitas: "muitas" })).toBeNull();
    expect(
      lerVisitasDoCrm({ ...COMPLETO, contando_desde: "ontem" }),
    ).toBeNull();
  });

  it("visitas NULL do banco continua NULL, nunca vira zero", () => {
    const lida = lerVisitasDoCrm({ ...COMPLETO, visitas: null });
    expect(lida?.visitas).toBeNull();
  });
});

describe("estadoDasVisitas", () => {
  it("sem leitura (função ausente ou ainda não lida) = indisponível", () => {
    expect(estadoDasVisitas(null, PERIODO)).toEqual({ tipo: "indisponivel" });
  });

  it("visitas NULL com data de início: 'A contar a partir de 02/11/2026'", () => {
    const lida = lerVisitasDoCrm({
      ...COMPLETO,
      contando_desde: "2026-11-02",
      visitas: null,
    });
    expect(
      estadoDasVisitas(lida, { inicio: "2026-10-01", fim: "2026-10-31" }),
    ).toEqual({
      tipo: "a-contar",
      aviso: "A contar a partir de 02/11/2026",
    });
  });

  it("contador ainda sem nenhuma entrada: 'a partir de agora'", () => {
    const lida = lerVisitasDoCrm({
      ...COMPLETO,
      contando_desde: null,
      visitas: null,
      canais: [],
      previas: null,
    });
    expect(estadoDasVisitas(lida, PERIODO)).toEqual({
      tipo: "a-contar",
      aviso: "A contar a partir de agora",
    });
  });

  it("período que começa antes do contador: 'Contando desde 02/11'", () => {
    const lida = lerVisitasDoCrm({
      ...COMPLETO,
      contando_desde: "2026-11-02",
      periodo_completo: false,
    });
    expect(estadoDasVisitas(lida, PERIODO)).toEqual({
      tipo: "parcial",
      aviso: "Contando desde 02/11",
    });
  });

  it("período inteiro dentro do contador: completo, sem aviso", () => {
    expect(estadoDasVisitas(lerVisitasDoCrm(COMPLETO), PERIODO)).toEqual({
      tipo: "completo",
    });
  });
});
