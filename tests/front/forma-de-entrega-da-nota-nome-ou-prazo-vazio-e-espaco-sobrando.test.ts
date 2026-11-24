// A linha "Como vai: <nome> (<prazo>)" da ficha do pedido sai de
// `formaDeEntregaDaNota`. Os testes vizinhos cobrem a frase completa, a última
// ocorrência e o "1 dias". Aqui ficam os limites que decidem se a linha
// aparece ou some:
//  - nome em branco ou prazo em branco NÃO viram linha ("Como vai:  ()" é pior
//    que linha nenhuma): o resultado é null;
//  - espaço sobrando dentro do parêntese não vaza para o texto da ficha;
//  - "1 dia útil" (transportadora) segue como está — só "1 dias" é corrigido.
import { formaDeEntregaDaNota } from "@/lib/forma-de-entrega-da-nota";
import { describe, expect, it } from "vitest";

describe("formaDeEntregaDaNota — vazio e espaço sobrando", () => {
  it("nome só com espaço não vira linha", () => {
    expect(
      formaDeEntregaDaNota("Frete Escolhido:  (Prazo: 3 dias)"),
    ).toBeNull();
  });

  it.each([
    "Frete Escolhido: PAC (Prazo: )",
    "Frete Escolhido: PAC (Prazo:    )",
    "Frete Escolhido: PAC (Prazo:)",
  ])("prazo em branco não vira linha: %j", (nota) => {
    expect(formaDeEntregaDaNota(nota)).toBeNull();
  });

  it("espaço antes do parêntese de fechamento não entra no prazo", () => {
    expect(
      formaDeEntregaDaNota("Frete Escolhido: PAC (Prazo: 3 dias úteis   )"),
    ).toEqual({ nome: "PAC", prazo: "3 dias úteis" });
  });

  it("'1 dia útil' e '1 dia' ficam como o checkout gravou", () => {
    expect(
      formaDeEntregaDaNota("Frete Escolhido: PAC (Prazo: 1 dia útil)"),
    ).toEqual({ nome: "PAC", prazo: "1 dia útil" });
    expect(
      formaDeEntregaDaNota("Frete Escolhido: Entrega Local (Prazo: 1 dia)"),
    ).toEqual({ nome: "Entrega Local", prazo: "1 dia" });
  });

  it.each(["(Prazo: )", "(Prazo:)"])(
    "a ÚLTIMA frase manda, mesmo em branco (%s): não cai para a anterior",
    (prazoEmBranco) => {
      // A regra é "a última ocorrência vence" — se a última está em branco, o
      // resultado é null, e não a anterior (que a cliente ou a loja pode ter
      // digitado na observação).
      const nota = `Frete Escolhido: SEDEX (Prazo: 2 dias úteis)\nFrete Escolhido: PAC ${prazoEmBranco}`;
      expect(formaDeEntregaDaNota(nota)).toBeNull();
    },
  );

  it("aceita a frase sem espaço depois dos dois-pontos", () => {
    expect(formaDeEntregaDaNota("Frete Escolhido:PAC (Prazo: 3 dias)")).toEqual(
      { nome: "PAC", prazo: "3 dias" },
    );
  });
});
