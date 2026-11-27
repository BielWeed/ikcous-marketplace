// O cartão "Sua assinatura" só diz que as vendas pela loja ESTÃO pausadas
// quando o BANCO diz (27/11/2026). A pausa de verdade exige, além de
// `suspensa` + `pausa_em`, a chave `pausa_de_vendas.vale_pela_assinatura`
// (migration 20261600000000), que o front não enxerga: quem diz a verdade é
// `situacao_das_vendas_da_loja()` → `{aceita, motivo, pausada_desde}`. Sem a
// resposta (loja antiga sem a função, rede, forma torta) o cartão não afirma
// pausa nenhuma. Dados inventados.
import { avisoDasVendasPausadas } from "@/lib/crm";
import {
  avisoDaSuspensa as avisoComOSinal,
  lerSituacaoDasVendas,
} from "@/lib/situacao-das-vendas";
import type { AssinaturaDaLoja, SituacaoDasVendas } from "@/types/painel";
import { describe, expect, it } from "vitest";

const SINAL: AssinaturaDaLoja = {
  plano: "Plano Inventado",
  status: "suspensa",
  valorMensal: 250,
  ciclo: "mensal",
  inicioEm: "2026-12-02",
  proximaCobrancaEm: "2027-01-02",
  testeAte: null,
  pausaEm: "2027-01-13",
  recursos: [],
  gerenciarUrl: null,
  suporteWhatsapp: null,
  atualizadoEm: null,
};

const PAUSADAS: SituacaoDasVendas = {
  aceita: false,
  motivo: "vendas_pausadas",
  pausadaDesde: "2027-01-13",
};
const ACEITA: SituacaoDasVendas = {
  aceita: true,
  motivo: null,
  pausadaDesde: null,
};

/** Meio-dia em Brasília (15h UTC) do dia pedido. */
const meioDia = (dia: string) => new Date(`${dia}T15:00:00Z`);
const DIA_DA_PAUSA = meioDia("2027-01-13");

/** Como o cartão chama: o sinal da gestão de agora vai pronto. */
const avisoDaSuspensa = (
  assinatura: AssinaturaDaLoja,
  situacao: SituacaoDasVendas | null | undefined,
  agora: Date,
) =>
  avisoComOSinal(
    assinatura,
    situacao,
    avisoDasVendasPausadas(assinatura, agora),
  );

describe("lerSituacaoDasVendas: a resposta do banco, ou 'não sei'", () => {
  it("lê as três chaves da RPC", () => {
    expect(
      lerSituacaoDasVendas({
        aceita: false,
        motivo: "vendas_pausadas",
        pausada_desde: "2027-01-13",
      }),
    ).toEqual(PAUSADAS);
    expect(
      lerSituacaoDasVendas({ aceita: true, motivo: null, pausada_desde: null }),
    ).toEqual(ACEITA);
    expect(
      lerSituacaoDasVendas({
        aceita: false,
        motivo: "manutencao",
        pausada_desde: null,
      }),
    ).toEqual({ aceita: false, motivo: "manutencao", pausadaDesde: null });
  });

  it("sem resposta, ou fora da forma: null (não sei)", () => {
    for (const torta of [
      null,
      undefined,
      "aceita",
      [],
      {},
      { aceita: "false", motivo: "vendas_pausadas" },
      { aceita: 0, motivo: null },
    ]) {
      expect(lerSituacaoDasVendas(torta)).toBeNull();
    }
  });

  it("aceita e motivo que se contradizem: null (o banco nunca manda isso)", () => {
    expect(
      lerSituacaoDasVendas({
        aceita: false,
        motivo: null,
        pausada_desde: null,
      }),
    ).toBeNull();
    expect(
      lerSituacaoDasVendas({
        aceita: true,
        motivo: "vendas_pausadas",
        pausada_desde: "2027-01-13",
      }),
    ).toBeNull();
  });

  it("pausada_desde fora da forma vira null, sem derrubar o resto", () => {
    expect(
      lerSituacaoDasVendas({
        aceita: false,
        motivo: "vendas_pausadas",
        pausada_desde: 20270113,
      }),
    ).toEqual({ ...PAUSADAS, pausadaDesde: null });
  });
});

describe("avisoDaSuspensa: quem decide 'pausadas' é o banco", () => {
  it("o defeito: suspensa + pausa vencida mas o banco ACEITA → mensalidade em aberto, nunca 'pausadas'", () => {
    expect(avisoDaSuspensa(SINAL, ACEITA, DIA_DA_PAUSA)).toEqual({
      tipo: "em-aberto",
      vencimento: { venceuEm: "2027-01-02", valorMensal: 250, doTeste: false },
    });
  });

  it("o banco diz vendas_pausadas → pausadas, com o dia que o BANCO diz", () => {
    expect(
      avisoDaSuspensa(
        SINAL,
        { ...PAUSADAS, pausadaDesde: "2027-01-18" },
        DIA_DA_PAUSA,
      ),
    ).toEqual({
      tipo: "pausadas",
      pausadasDesde: "2027-01-18",
      vencimento: { venceuEm: "2027-01-02", valorMensal: 250, doTeste: false },
    });
  });

  it("o inverso: chave ligada SEM pausa_em (gestão antiga) → o banco pausa, e o cartão também", () => {
    expect(
      avisoDaSuspensa({ ...SINAL, pausaEm: null }, PAUSADAS, DIA_DA_PAUSA),
    ).toEqual({
      tipo: "pausadas",
      pausadasDesde: "2027-01-13",
      vencimento: { venceuEm: "2027-01-02", valorMensal: 250, doTeste: false },
    });
  });

  it("sem a resposta do banco (RPC falhou ou não existe): null, nada de pausa", () => {
    expect(avisoDaSuspensa(SINAL, null, DIA_DA_PAUSA)).toBeNull();
    expect(avisoDaSuspensa(SINAL, undefined, DIA_DA_PAUSA)).toBeNull();
  });

  it("manutenção não é pausa por assinatura: null", () => {
    expect(
      avisoDaSuspensa(
        SINAL,
        { aceita: false, motivo: "manutencao", pausadaDesde: null },
        DIA_DA_PAUSA,
      ),
    ).toBeNull();
  });

  it("aceita, mas sem o sinal completo da gestão (Savy, antes da pausa, valor zero): null, cartão de hoje", () => {
    expect(
      avisoDaSuspensa({ ...SINAL, pausaEm: null }, ACEITA, DIA_DA_PAUSA),
    ).toBeNull();
    expect(avisoDaSuspensa(SINAL, ACEITA, meioDia("2027-01-12"))).toBeNull();
    expect(
      avisoDaSuspensa({ ...SINAL, valorMensal: 0 }, ACEITA, DIA_DA_PAUSA),
    ).toBeNull();
  });

  it("aceita com status que não é suspensa: null (os outros avisos cuidam)", () => {
    expect(
      avisoDaSuspensa({ ...SINAL, status: "atrasada" }, ACEITA, DIA_DA_PAUSA),
    ).toBeNull();
  });

  it("pausadas com o vencimento torto: afirma a pausa, mas sem frase de vencimento inventada", () => {
    for (const torta of [
      { valorMensal: 0 },
      { valorMensal: null },
      { proximaCobrancaEm: null },
      { proximaCobrancaEm: "2027-02-30" },
      // teste_ate que não bate com o vencimento: nem "teste acabou", nem "mensalidade".
      { testeAte: "2026-12-20" },
    ] satisfies Partial<AssinaturaDaLoja>[]) {
      expect(
        avisoDaSuspensa({ ...SINAL, ...torta }, PAUSADAS, DIA_DA_PAUSA),
      ).toEqual({
        tipo: "pausadas",
        pausadasDesde: "2027-01-13",
        vencimento: null,
      });
    }
  });

  it("pausadas do teste encerrado: doTeste", () => {
    expect(
      avisoDaSuspensa(
        { ...SINAL, testeAte: "2027-01-02" },
        PAUSADAS,
        DIA_DA_PAUSA,
      ),
    ).toEqual({
      tipo: "pausadas",
      pausadasDesde: "2027-01-13",
      vencimento: { venceuEm: "2027-01-02", valorMensal: 250, doTeste: true },
    });
  });

  it("pausada_desde ausente ou inválida: pausadas sem dia", () => {
    for (const pausadaDesde of [null, "2027-13-01", "13/01/2027"]) {
      const aviso = avisoDaSuspensa(
        SINAL,
        { ...PAUSADAS, pausadaDesde },
        DIA_DA_PAUSA,
      );
      expect(aviso).toMatchObject({ tipo: "pausadas", pausadasDesde: null });
    }
  });
});
