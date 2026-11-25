// Caça por mutação em `src/config/textos-de-privacidade.ts` (25/11/2026).
//
// Os testes vizinhos usam `PRAZO_DE_RESPOSTA_EM_DIAS` e `TEXTOS_*` como ORÁCULO
// DE SI MESMOS (`esperado = PRAZO * UM_DIA`, `getByText(TEXTOS.titulo)`): trocar
// os 15 dias por 16, trocar o "—" por "-", inverter `atendido`/`recusado` ou
// reescrever uma frase passava em todos, porque os dois lados da comparação
// mudavam juntos. Aqui os valores são ESCRITOS À MÃO, do que a cliente e a
// lojista leem de verdade.
//
// Os 15 dias são a promessa que a loja faz à cliente (a LGPD dá 15 dias para a
// resposta completa). Se o dono mudar o prazo DE PROPÓSITO, este arquivo é o
// lugar onde a mudança precisa ser confirmada: a constante, a frase do pedido
// enviado e os textos que repetem o número têm de mudar juntos.
//
// Fora daqui, de propósito: os parágrafos longos de explicação jurídica
// (`guarda`, `abertura`, `explicacao` além da frase do prazo). Quem os revisa é
// o dono com quem entende de LGPD, e `fica` e `apaga` já são amarrados ao
// roteiro da loja por `privacidade-tela-bate-com-roteiro.test.ts`.
import {
  NOME_DO_PEDIDO,
  PRAZO_DE_RESPOSTA_EM_DIAS,
  TEXTOS_DA_CLIENTE,
  TEXTOS_DA_LOJA,
  fraseDeItens,
  fraseDecisaoDaLoja,
  frasePedidoEnviado,
} from "@/config/textos-de-privacidade";
import { describe, expect, it } from "vitest";

describe("o prazo prometido à cliente", () => {
  it("são 15 dias, e todo texto que cita o número diz 15", () => {
    expect(PRAZO_DE_RESPOSTA_EM_DIAS).toBe(15);
    expect(TEXTOS_DA_CLIENTE.prazo).toBe("A loja responde em até 15 dias.");
    expect(TEXTOS_DA_CLIENTE.confirmaExcluirTexto).toContain(
      "A loja vai analisar o seu pedido e responder em até 15 dias. Quando a exclusão for feita,",
    );
    expect(TEXTOS_DA_CLIENTE.confirmaEmailTexto).toContain(
      "A loja responde em até 15 dias. Até lá, continue entrando com o e-mail de hoje.",
    );
    expect(TEXTOS_DA_LOJA.explicacao).toContain(
      "A loja tem até 15 dias para responder.",
    );
  });

  it("a frase do pedido enviado leva a data recebida, o travessão e o prazo", () => {
    expect(frasePedidoEnviado("14/10/2026")).toBe(
      "Pedido enviado em 14/10/2026 — a loja responde em até 15 dias.",
    );
    expect(frasePedidoEnviado("01/02/2027")).toBe(
      "Pedido enviado em 01/02/2027 — a loja responde em até 15 dias.",
    );
  });
});

describe("fraseDecisaoDaLoja — o que a cliente lê depois que a loja decide", () => {
  it("pedido atendido diz que foi atendido, com a data", () => {
    expect(fraseDecisaoDaLoja("atendido", "20/10/2026")).toBe(
      "Pedido atendido pela loja em 20/10/2026.",
    );
  });

  it("pedido recusado diz que a loja respondeu e NÃO pôde atender, com a data", () => {
    expect(fraseDecisaoDaLoja("recusado", "21/10/2026")).toBe(
      "A loja respondeu ao seu pedido em 21/10/2026 e não pôde atendê-lo.",
    );
  });

  it("as duas decisões nunca saem iguais (inverter a condição trocaria as frases)", () => {
    expect(fraseDecisaoDaLoja("atendido", "20/10/2026")).not.toBe(
      fraseDecisaoDaLoja("recusado", "20/10/2026"),
    );
  });
});

describe("fraseDeItens — singular só no um", () => {
  it.each([
    [0, "0 itens"],
    [1, "1 item"],
    [2, "2 itens"],
    [7, "7 itens"],
  ])("%i → %s", (quantidade, esperado) => {
    expect(fraseDeItens(quantidade)).toBe(esperado);
  });
});

describe("NOME_DO_PEDIDO — como cada tipo de pedido aparece na tela", () => {
  it("exclusão e correção têm cada uma o seu nome (e não trocados)", () => {
    expect(NOME_DO_PEDIDO).toEqual({
      excluir_conta: "Exclusão da conta",
      corrigir_email: "Correção de e-mail",
    });
  });
});

describe("textos curtos que a cliente e a lojista leem na tela", () => {
  it("cliente: título, rótulos, botões e avisos de e-mail", () => {
    expect(TEXTOS_DA_CLIENTE).toMatchObject({
      titulo: "Privacidade e meus dados",
      rotuloDaTela: "Conta · Privacidade",
      rotuloDoPrazo: "Prazo",
      botaoExcluir: "Pedir exclusão da minha conta",
      botaoCorrigirEmail: "Corrigir meu e-mail",
      emailVazio: "Digite o e-mail novo.",
      emailInvalido: "Esse e-mail não parece certo. Confira e tente de novo.",
      emailIgual: "Esse já é o e-mail da sua conta. Digite o e-mail novo.",
      falhaJaExiste:
        "Você já tem um pedido igual esperando resposta da loja. Não precisa pedir de novo.",
      falhaSemSessao:
        "Sua sessão acabou. Entre na conta de novo e tente outra vez.",
    });
  });

  it("lojista: prazo, decisão e o recado de que não há botão de apagar", () => {
    expect(TEXTOS_DA_LOJA).toMatchObject({
      titulo: "Pedidos de privacidade dos clientes",
      vazio: "Nenhum pedido de privacidade por enquanto.",
      clienteSemNome: "Cliente",
      prazoAte: "Responder até",
      prazoVencido: "Prazo vencido — responda hoje",
      marcarAtendido: "Marcar como atendido",
      marcarRecusado: "Não posso atender",
      semBotaoDeApagar:
        "Os pedidos ficam guardados como registro. Não há botão de apagar de propósito.",
    });
  });
});
