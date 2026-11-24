// O texto que abre a conversa de WhatsApp com cada grupo de clientes do CRM
// (achado por mutação em 24/11/2026: tirar um grupo da lista de uma mensagem
// o fazia cair, em silêncio, na mensagem genérica — "Tudo bem? Posso ajudar
// com alguma coisa?" — e nenhum teste notava). Cada grupo precisa da sua
// frase: quem sumiu não pode receber "Obrigado pela sua compra!", e quem
// nunca comprou não pode receber "sentimos sua falta".
import { mensagemDoSegmento } from "@/lib/crm";
import type { SegmentoCrm } from "@/types/crm";
import { describe, expect, it } from "vitest";

const LOJA = "Loja Teste";

describe("mensagemDoSegmento: cada grupo tem a sua frase", () => {
  it.each<[SegmentoCrm, string]>([
    ["campeoes", "Obrigado por comprar sempre"],
    ["leais", "Obrigado por comprar sempre"],
    ["ativos", "Que bom ter você por perto"],
    ["promissores", "Que bom ter você por perto"],
    ["novos", "Obrigado pela sua compra"],
    ["precisam_atencao", "Faz um tempinho que você não passa por aqui"],
    ["quase_dormindo", "Faz um tempinho que você não passa por aqui"],
    ["em_risco", "Você é um cliente muito especial"],
    ["nao_pode_perder", "Você é um cliente muito especial"],
    ["hibernando", "Faz tempo!"],
    ["nunca_comprou", "Obrigado por criar sua conta"],
  ])("%s", (segmento, trecho) => {
    const texto = mensagemDoSegmento(segmento, {
      nome: "Ana Teste",
      loja: LOJA,
    });

    expect(texto.startsWith("Oi, Ana! Aqui é da Loja Teste.")).toBe(true);
    expect(texto).toContain(trecho);
    expect(texto).not.toContain("Posso ajudar com alguma coisa");
  });

  it("sem grupo (ou grupo desconhecido) cai na mensagem genérica, que não promete nada", () => {
    const texto = mensagemDoSegmento(null, { nome: null, loja: LOJA });

    expect(texto).toBe(
      "Oi! Aqui é da Loja Teste. Tudo bem? Posso ajudar com alguma coisa?",
    );
  });

  it("pediu e não pagou: com valor em aberto convida a finalizar; sem valor só oferece ajuda", () => {
    const comValor = mensagemDoSegmento("pediu_nao_pagou", {
      nome: "Ana",
      loja: LOJA,
      valorEmAberto: 80,
    });
    const semValor = mensagemDoSegmento("pediu_nao_pagou", {
      nome: "Ana",
      loja: LOJA,
      valorEmAberto: 0,
    });

    expect(comValor).toContain("finalizar a compra");
    expect(semValor).not.toContain("finalizar a compra");
    expect(semValor).toContain("ajudar com alguma compra");
  });
});

describe("mensagemDoSegmento: o nome da pessoa", () => {
  it("espaço antes do nome não apaga o nome (Oi, Ana!, não Oi!)", () => {
    const texto = mensagemDoSegmento("leais", {
      nome: "  Ana Souza ",
      loja: LOJA,
    });

    expect(texto.startsWith("Oi, Ana! Aqui é da Loja Teste.")).toBe(true);
  });

  it("nome em branco ou só espaços usa a saudação sem nome", () => {
    for (const nome of [null, "", "   "]) {
      expect(
        mensagemDoSegmento("leais", { nome, loja: LOJA }).startsWith(
          "Oi! Aqui é da Loja Teste.",
        ),
      ).toBe(true);
    }
  });
});
