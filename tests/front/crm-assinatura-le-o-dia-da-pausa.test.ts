// O leitor do cartão "Sua assinatura" lê `pausa_em` (26/11/2026): o dia em que
// os pedidos pela loja pausam quando o teste grátis acabou sem pagamento. A
// coluna é nova; banco sem a migration não manda a chave e o cartão continua o
// de hoje. Dados inventados.
import { lerAssinaturaDaLoja } from "@/lib/crm";
import { describe, expect, it } from "vitest";

const CONTRATO = {
  plano: "Plano Inventado",
  status: "atrasada",
  valor_mensal: 250,
  ciclo: "mensal",
  inicio_em: "2026-11-26",
  proxima_cobranca_em: "2026-12-03",
  teste_ate: "2026-12-03",
  recursos: ["PDV", "CRM"],
  gerenciar_url: "https://cobranca.exemplo.com/minha-loja",
  suporte_whatsapp: "11987654321",
  atualizado_em: "2026-12-04T10:00:00Z",
};

const OS_OUTROS_ONZE = {
  plano: "Plano Inventado",
  status: "atrasada",
  valorMensal: 250,
  ciclo: "mensal",
  inicioEm: "2026-11-26",
  proximaCobrancaEm: "2026-12-03",
  testeAte: "2026-12-03",
  recursos: ["PDV", "CRM"],
  gerenciarUrl: "https://cobranca.exemplo.com/minha-loja",
  suporteWhatsapp: "11987654321",
  atualizadoEm: "2026-12-04T10:00:00Z",
};

describe("lerAssinaturaDaLoja lê pausa_em", () => {
  it("o dia da pausa vira pausaEm, e os outros 11 campos ficam iguais", () => {
    expect(
      lerAssinaturaDaLoja({ ...CONTRATO, pausa_em: "2026-12-07" }),
    ).toEqual({ ...OS_OUTROS_ONZE, pausaEm: "2026-12-07" });
  });

  it("banco velho (sem a chave) vira null, sem mexer nos outros campos", () => {
    expect(lerAssinaturaDaLoja(CONTRATO)).toEqual({
      ...OS_OUTROS_ONZE,
      pausaEm: null,
    });
  });

  it("null explícito, número, objeto e texto vazio viram null", () => {
    for (const torto of [null, 20261207, { dia: "2026-12-07" }, "", "   "]) {
      expect(
        lerAssinaturaDaLoja({ ...CONTRATO, pausa_em: torto })?.pausaEm,
      ).toBeNull();
    }
  });
});
