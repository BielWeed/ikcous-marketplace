// Follow-up obrigatório da revisão do PR #349 (item 6 do laudo de 29/08):
// o horário de funcionamento passou a ser exibido na vitrine, e o DEFAULT DE
// FÁBRICA ("Seg-Sáb: 9h às 18h", coluna business_hours no baseline + seed do
// runtime + COALESCE da RPC) publicaria esse expediente INVENTADO para loja
// que nunca o configurou — o cliente não distingue default de fábrica de
// texto digitado.
//
// O conserto segue o molde da cor (20260980000000_sentinela_de_cor_vira_
// ausencia): a sentinela morre no BANCO (migration 20261029000000) e o
// runtime deixa de ter reserva. Este teste crava a metade do runtime: o
// default do app é "" — sem valor = a loja não disse.
import { describe, expect, it } from "vitest";
import { defaultStoreConfig } from "@/config/cor-da-loja";

describe("defaultStoreConfig — o horário de fábrica não tem reserva", () => {
  it("businessHours nasce vazio, não com o expediente inventado", () => {
    expect(defaultStoreConfig.businessHours).toBe("");
  });

  it("não é só o default: nenhum lugar do config traz o literal de fábrica", () => {
    const valores = Object.values(defaultStoreConfig);
    expect(
      valores.filter((v) => v === "Seg-Sáb: 9h às 18h"),
    ).toHaveLength(0);
  });
});
