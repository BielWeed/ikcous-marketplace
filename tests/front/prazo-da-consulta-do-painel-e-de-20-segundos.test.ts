// r206-a: a promessa ao lojista é que o botão preso e a faixa "carregando" do
// painel se soltam em 20 s com rede que conecta e não responde. Os testes de
// `admin-push-leitura-dos-aparelhos-sem-resposta-solta-o-botao` e
// `categorias-consulta-pendurada-solta-a-faixa` avançam o relógio PELA
// constante importada: se alguém a subisse para 120_000 os dois seguiriam
// verdes (a régua mudaria junto com o código). Esta é a régua de fora.
import { PRAZO_DA_CONSULTA_DO_PAINEL_MS } from "@/lib/prazo-da-requisicao";
import { describe, expect, it } from "vitest";

describe("prazo das consultas do painel", () => {
  it("é de 20 segundos: o botão e a faixa se soltam em 20 s, nunca mais que isso", () => {
    expect(PRAZO_DA_CONSULTA_DO_PAINEL_MS).toBe(20_000);
  });
});
