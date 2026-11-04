// "Como pedir" na página Trocas e devoluções diz "entre na sua conta, abra o
// pedido em Meus pedidos e toque em Solicitar devolução ou troca". Mas quem
// comprou SEM criar conta (convidado) não tem conta, e o botão só aparece para
// quem está logado (OrderDetailsView: `podeUsarDevolucao = delivered && !!user`).
// A política nunca dizia ao convidado o que fazer. Este arquivo prende que a
// seção "Como pedir" ganhe o caminho dele: falar com a loja pelo contato do
// fim da página e informar o número do pedido.
import { describe, expect, it } from "vitest";

import { montarPolitica } from "@/lib/textos-das-politicas";
import type { PoliticaDevolucao } from "@/types/devolucao";

const LOJA = { nome: "Loja da Ana" };

const POLITICA: PoliticaDevolucao = {
  prazo_arrependimento_dias: 7,
  prazo_troca_dias: 30,
  prazo_vicio_dias: 90,
  aceita_troca: true,
  aceita_vale: true,
  exige_fotos_vicio: true,
  metodos_locais: ["entrega_na_loja", "coleta"],
  metodos_nacionais: ["etiqueta_reversa", "envio_proprio"],
  reembolso_momento: "ao_receber",
  frete_troca_pago_por: "cliente",
  categorias_sem_troca: [],
  texto_politica: null,
  endereco_devolucao: null,
  updated_at: null,
};

function comoPedir(politica: PoliticaDevolucao | null): readonly string[] {
  const secao = montarPolitica("trocas", LOJA, politica).secoes.find(
    (s) => s.id === "como-pedir",
  );
  expect(secao).toBeDefined();
  return secao?.paragrafos ?? [];
}

describe("Trocas e devoluções — como pedir para quem comprou sem conta", () => {
  it.each([
    ["com política carregada", POLITICA],
    ["sem política carregada", null],
  ])("%s: o caminho de quem tem conta continua o mesmo", (_nome, politica) => {
    const texto = comoPedir(politica).join("\n");
    expect(texto).toMatch(/entre na sua conta/i);
    expect(texto).toMatch(/Meus pedidos/);
    expect(texto).toMatch(/Solicitar devolução ou troca/);
  });

  it.each([
    ["com política carregada", POLITICA],
    ["sem política carregada", null],
  ])(
    "%s: um parágrafo à parte manda o convidado falar com a loja, com o número do pedido",
    (_nome, politica) => {
      const paragrafos = comoPedir(politica);
      expect(paragrafos.length).toBeGreaterThanOrEqual(2);
      const doConvidado = paragrafos.find((p) => /sem criar conta/i.test(p));
      expect(doConvidado).toBeDefined();
      expect(doConvidado).toMatch(/fale com a loja/i);
      expect(doConvidado).toMatch(/contato/i);
      expect(doConvidado).toMatch(/número do pedido/i);
    },
  );
});
