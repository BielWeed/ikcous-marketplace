// A frase de apoio do aviso "O horário previsto para pagar já passou."
// (`TEXTOS_DO_CARTAO.horarioPassouDetalhe`, em
// `src/components/checkout/mensagens-do-cartao.ts`). Achado por mutação: trocar
// o texto inteiro por outro não derrubava teste nenhum — e é ESTA frase que
// segura quem já pagou na tela até a confirmação chegar (o relógio do aparelho
// não decide o prazo; quem decide é o servidor). Sem ela, a cliente que pagou
// a tempo poderia fechar a tela ou pagar de novo.
import { describe, expect, it } from "vitest";

import { TEXTOS_DO_CARTAO } from "@/components/checkout/mensagens-do-cartao";

describe("aviso de horário passado — o que a cliente lê", () => {
  it("a frase de apoio diz a quem já pagou para continuar na tela e que a confirmação aparece ali", () => {
    expect(TEXTOS_DO_CARTAO.horarioPassouDetalhe).toBe(
      "Se você já pagou, continue nesta tela: a confirmação aparece aqui.",
    );
  });

  it("o aviso fala de horário previsto — nunca afirma que o pedido expirou ou que o pagamento foi perdido", () => {
    const aviso =
      `${TEXTOS_DO_CARTAO.horarioPassou} ${TEXTOS_DO_CARTAO.horarioPassouDetalhe}`.toLowerCase();
    expect(TEXTOS_DO_CARTAO.horarioPassou).toBe(
      "O horário previsto para pagar já passou.",
    );
    for (const palavra of ["expirou", "expirado", "cancelado", "perdeu"]) {
      expect(aviso).not.toContain(palavra);
    }
  });
});
