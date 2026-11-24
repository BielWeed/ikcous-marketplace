import { interpretarRetrato } from "@/lib/retrato-do-convidado";
import { describe, expect, it } from "vitest";

// O horário da consulta vem do sessionStorage, que qualquer aba ou extensão
// pode ter mexido. Só um número finito e positivo é horário de verdade; o resto
// vira "horário desconhecido" (o retrato então é descartado na leitura) e os
// pedidos gravados continuam intactos. Sem o filtro de número finito, `1e999`
// (que o JSON lê como Infinity) passava por horário válido.
const pedido = { id: "ped-1", status: "shipping" } as never;
const lerComInstante = (consultadoEm: string) =>
  interpretarRetrato(
    `{"pedidos":[{"id":"ped-1","status":"shipping"}],"consultadoEm":${consultadoEm}}`,
  );

describe("interpretarRetrato — horário da consulta que não serve", () => {
  it.each([
    ["infinito (1e999 no JSON)", "1e999"],
    ["infinito negativo", "-1e999"],
    ["zero", "0"],
    ["negativo", "-5"],
    ["nulo", "null"],
    ["texto com cara de número", '"1700000000000"'],
    ["booleano", "true"],
  ])("%s vira horário desconhecido e mantém os pedidos", (_nome, bruto) => {
    expect(lerComInstante(bruto)).toEqual({
      pedidos: [pedido],
      consultadoEm: null,
    });
  });

  it("número finito e positivo é guardado como veio", () => {
    expect(lerComInstante("1700000000000")).toEqual({
      pedidos: [pedido],
      consultadoEm: 1_700_000_000_000,
    });
  });
});
