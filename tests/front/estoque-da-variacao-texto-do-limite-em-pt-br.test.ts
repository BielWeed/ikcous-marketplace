// O texto do limite de estoque é lido pela lojista em português: 10.000 (ponto
// de milhar), nunca "10,000" (formato americano, que em pt-BR lê-se "dez").
// Os testes de função só comparavam a mensagem com a CONSTANTE exportada pelo
// próprio módulo — trocar o `pt-BR` do `toLocaleString` mudava as duas pontas
// juntas e nenhum teste puro reclamava (só um teste de tela, longe dali).
import { describe, expect, it } from "vitest";

import {
  ESTOQUE_MAXIMO_DA_VARIACAO_EM_TEXTO,
  MENSAGEM_ESTOQUE_MAXIMO_DA_VARIACAO,
  erroDoEstoqueDaVariacao,
} from "@/utils/estoque-da-variacao";

describe("texto do limite de estoque da variação", () => {
  it("o limite aparece com ponto de milhar", () => {
    expect(ESTOQUE_MAXIMO_DA_VARIACAO_EM_TEXTO).toBe("10.000");
    expect(MENSAGEM_ESTOQUE_MAXIMO_DA_VARIACAO).toBe(
      "O estoque máximo é 10.000",
    );
  });

  it("um a mais que o limite devolve essa mensagem escrita por extenso", () => {
    expect(erroDoEstoqueDaVariacao("10001")).toBe("O estoque máximo é 10.000");
  });

  it("o próprio limite ainda é aceito", () => {
    expect(erroDoEstoqueDaVariacao("10000")).toBeNull();
  });
});
