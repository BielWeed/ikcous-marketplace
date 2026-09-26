// Funções puras do Início e do Dashboard CRM (src/lib/crm.ts): os parsers
// defensivos das RPCs `painel_inicio`, `assinatura_da_loja_ler`, `crm_visao`
// e `crm_clientes` (todas devolvem jsonb — "não sei" vira null, nunca zero
// inventado), a matemática de período no fuso de São Paulo, os formatadores
// e o link de WhatsApp com texto pronto por segmento RFM.
import {
  SEGMENTOS_DO_CRM,
  formatarData,
  formatarMoeda,
  formatarMoedaCompacta,
  formatarPercentual,
  formatarVariacao,
  idadeCurta,
  infoDoSegmento,
  intervaloDoPeriodo,
  lerAssinaturaDaLoja,
  lerClientesDoCrm,
  lerPainelInicio,
  lerVisaoDoCrm,
  linkWhatsappDoCrm,
  mensagemDeErroDoPainel,
  mensagemDoSegmento,
  rotuloDoCanal,
  rotuloDoStatusDoPedido,
  variacaoPercentual,
} from "@/lib/crm";
import { describe, expect, it } from "vitest";

// Intl separa "R$" do número com espaço inseparável (U+00A0).
const semNbsp = (texto: string) => texto.replace(/\u00a0/g, " ");

describe("lerPainelInicio", () => {
  it("lê o contrato inteiro de painel_inicio()", () => {
    const painel = lerPainelInicio({
      hoje: {
        receita: 350.5,
        online: 200,
        presencial: 150.5,
        pedidos: 4,
        receita_semana_passada: 300,
      },
      mes: {
        receita: 9000,
        receita_mes_anterior: 7500,
        pedidos: 60,
        ticket_medio: 150,
        lucro_estimado: 3100,
      },
      saldo_total: 12500.9,
      a_receber_7d: 800,
      a_pagar_7d: 450,
      contas_vencidas: 2,
      pendencias: {
        pedidos_para_preparar: 5,
        devolucoes_abertas: 1,
        caixa_aberto: true,
        estoque_baixo: 3,
      },
      serie_14d: [
        { dia: "2026-09-26", receita: 350.5 },
        { dia: "2026-09-25", receita: 120 },
      ],
    });

    expect(painel).not.toBeNull();
    expect(painel?.hoje).toEqual({
      receita: 350.5,
      online: 200,
      presencial: 150.5,
      pedidos: 4,
      receitaSemanaPassada: 300,
    });
    expect(painel?.mes.lucroEstimado).toBe(3100);
    expect(painel?.saldoTotal).toBe(12500.9);
    expect(painel?.contasVencidas).toBe(2);
    expect(painel?.pendencias).toEqual({
      pedidosParaPreparar: 5,
      devolucoesAbertas: 1,
      caixaAberto: true,
      estoqueBaixo: 3,
    });
    // Série sai em ordem de dia, do mais antigo para hoje.
    expect(painel?.serie14d.map((p) => p.dia)).toEqual([
      "2026-09-25",
      "2026-09-26",
    ]);
  });

  it("campo ausente é 'não sei' (null), nunca zero inventado", () => {
    const painel = lerPainelInicio({ hoje: { receita: 10 } });
    expect(painel?.hoje.receita).toBe(10);
    expect(painel?.hoje.online).toBeNull();
    expect(painel?.mes.receita).toBeNull();
    expect(painel?.saldoTotal).toBeNull();
    expect(painel?.pendencias.estoqueBaixo).toBeNull();
    expect(painel?.pendencias.caixaAberto).toBe(false);
    expect(painel?.serie14d).toEqual([]);
  });

  it("aceita número em string, caixa como sessão e contas vencidas como objeto", () => {
    const painel = lerPainelInicio({
      saldo_total: "1500.25",
      contas_vencidas: { quantidade: 4, valor: 900 },
      pendencias: { caixa_aberto: { id: "c1", aberto_em: "2026-09-26" } },
      serie_14d: [{ dia: "ontem", receita: 1 }, { receita: 2 }, "lixo"],
    });
    expect(painel?.saldoTotal).toBe(1500.25);
    expect(painel?.contasVencidas).toBe(4);
    expect(painel?.pendencias.caixaAberto).toBe(true);
    expect(painel?.serie14d).toEqual([]);
  });

  it("resposta que não é objeto vira null", () => {
    expect(lerPainelInicio(null)).toBeNull();
    expect(lerPainelInicio([])).toBeNull();
    expect(lerPainelInicio("x")).toBeNull();
  });
});

describe("lerAssinaturaDaLoja", () => {
  it("sem linha (null) continua null — o card diz 'não sincronizado'", () => {
    expect(lerAssinaturaDaLoja(null)).toBeNull();
  });

  it("lê o contrato e só aceita link https para 'Gerenciar'", () => {
    const assinatura = lerAssinaturaDaLoja({
      plano: "Loja Pro",
      status: "teste",
      valor_mensal: 99.9,
      ciclo: "mensal",
      inicio_em: "2026-09-01",
      proxima_cobranca_em: "2026-10-01",
      teste_ate: "2026-09-30",
      recursos: ["PDV", "CRM", 3, ""],
      gerenciar_url: "https://cobranca.exemplo.com/minha-loja",
      suporte_whatsapp: "11987654321",
      atualizado_em: "2026-09-26T10:00:00Z",
    });
    expect(assinatura).toMatchObject({
      plano: "Loja Pro",
      status: "teste",
      valorMensal: 99.9,
      recursos: ["PDV", "CRM"],
      gerenciarUrl: "https://cobranca.exemplo.com/minha-loja",
    });

    const perigosa = lerAssinaturaDaLoja({
      status: "vip",
      gerenciar_url: "javascript:alert(1)",
    });
    expect(perigosa?.status).toBeNull();
    expect(perigosa?.gerenciarUrl).toBeNull();
    expect(
      lerAssinaturaDaLoja({ gerenciar_url: "http://sem-tls.com" })
        ?.gerenciarUrl,
    ).toBeNull();
  });
});

describe("lerVisaoDoCrm e lerClientesDoCrm", () => {
  it("lê KPIs, canais, formas (maior primeiro), funil, pipeline e segmentos conhecidos", () => {
    const visao = lerVisaoDoCrm({
      kpis: {
        receita: 1000,
        receita_anterior: 800,
        pedidos: 10,
        pedidos_anterior: 8,
        ticket_medio: 100,
        ticket_medio_anterior: 100,
        clientes_compradores: 7,
        clientes_novos: 2,
        taxa_recompra: 28.5,
        receita_recorrente_pct: 61,
        ltv_medio: 420,
        receita_em_risco: 1800,
        taxa_devolucao: 3.2,
      },
      canais: [{ canal: "online", receita: 600, pedidos: 4 }],
      formas: [
        { forma: "cash", receita: 100, pedidos: 2 },
        { forma: "online", receita: 600, pedidos: 4 },
      ],
      funil: { visitas: 500, pedidos_pagos: 10 },
      pipeline: [{ status: "pending", quantidade: 2, mais_antigo_em: null }],
      segmentos: [
        { segmento: "campeoes", clientes: 3, receita: 900 },
        { segmento: "inventado", clientes: 1, receita: 1 },
      ],
    });
    expect(visao?.kpis.receitaAnterior).toBe(800);
    expect(visao?.kpis.taxaDevolucao).toBe(3.2);
    // Ticket do canal calculado quando a RPC não manda.
    expect(visao?.canais[0].ticketMedio).toBe(150);
    expect(visao?.formas.map((f) => f.forma)).toEqual(["online", "cash"]);
    expect(visao?.funil.visitas).toBe(500);
    expect(visao?.funil.carrinhos).toBeNull();
    expect(visao?.segmentos).toEqual([
      { segmento: "campeoes", clientes: 3, receita: 900 },
    ]);
  });

  it("cliente sem chave usa user_id/whatsapp; total ausente vira o tamanho da lista", () => {
    const lista = lerClientesDoCrm({
      clientes: [
        { user_id: "u-1", nome: "Ana", pedidos: 3, receita: 300 },
        { whatsapp: "11999990000", pedidos: 1, receita: 50 },
        "lixo",
      ],
    });
    expect(lista?.total).toBe(2);
    expect(lista?.clientes.map((c) => c.chave)).toEqual(["u-1", "11999990000"]);
    expect(lista?.clientes[0].ticketMedio).toBe(100);
    expect(lista?.clientes[1].segmento).toBeNull();
  });
});

describe("intervaloDoPeriodo — datas no fuso de São Paulo", () => {
  // 02:00 UTC do dia 26 ainda é 23:00 do dia 25 em São Paulo.
  const agora = new Date("2026-09-26T02:00:00Z");

  it.each([
    ["hoje", "2026-09-25", "2026-09-25"],
    ["7d", "2026-09-19", "2026-09-25"],
    ["30d", "2026-08-27", "2026-09-25"],
    ["90d", "2026-06-28", "2026-09-25"],
    ["mes", "2026-09-01", "2026-09-25"],
    ["ano", "2026-01-01", "2026-09-25"],
  ] as const)("%s → %s a %s", (periodo, inicio, fim) => {
    expect(intervaloDoPeriodo(periodo, agora)).toEqual({ inicio, fim });
  });

  it("virada de mês: 'Mês' começa no dia 1 do mês de São Paulo", () => {
    expect(intervaloDoPeriodo("mes", new Date("2026-03-01T01:00:00Z"))).toEqual(
      { inicio: "2026-02-01", fim: "2026-02-28" },
    );
  });
});

describe("formatadores", () => {
  it("dinheiro: '—' é não sei; zero medido aparece", () => {
    expect(formatarMoeda(null)).toBe("—");
    expect(semNbsp(formatarMoeda(0))).toBe("R$ 0,00");
    expect(semNbsp(formatarMoeda(1234.5))).toBe("R$ 1.234,50");
    // Compacta só a partir de R$ 10 mil.
    expect(semNbsp(formatarMoedaCompacta(9999.99))).toBe("R$ 9.999,99");
    expect(semNbsp(formatarMoedaCompacta(12345))).toContain("mil");
  });

  it("variação: sem base honesta não inventa percentual", () => {
    expect(variacaoPercentual(120, 100)).toBe(20);
    expect(variacaoPercentual(80, 100)).toBe(-20);
    expect(variacaoPercentual(50, 0)).toBeNull();
    expect(variacaoPercentual(null, 100)).toBeNull();
    expect(formatarVariacao(20)).toBe("+20%");
    expect(formatarVariacao(-4.04)).toBe("−4%");
    expect(formatarVariacao(0.01)).toBe("0%");
    expect(formatarPercentual(28.46)).toBe("28,5%");
    expect(formatarPercentual(null)).toBe("—");
  });

  it("datas e idades curtas", () => {
    expect(formatarData("2026-09-26")).toBe("26/09/2026");
    expect(formatarData("2026-09-26T01:00:00Z")).toBe("25/09/2026");
    expect(formatarData(null)).toBe("—");
    const agora = Date.parse("2026-09-26T12:00:00Z");
    expect(idadeCurta("2026-09-26T11:48:00Z", agora)).toBe("12 min");
    expect(idadeCurta("2026-09-26T07:00:00Z", agora)).toBe("5 h");
    expect(idadeCurta("2026-09-23T12:00:00Z", agora)).toBe("3 d");
    expect(idadeCurta("não é data", agora)).toBeNull();
  });

  it("rótulos de canal e status", () => {
    expect(rotuloDoCanal("online")).toBe("App (online)");
    expect(rotuloDoCanal("presencial")).toBe("Loja física");
    expect(rotuloDoStatusDoPedido("processing")).toBe("Em separação");
    expect(rotuloDoStatusDoPedido("desconhecido")).toBe("desconhecido");
  });

  it("erro de função inexistente diz que o painel ainda não foi ativado", () => {
    expect(
      mensagemDeErroDoPainel({ code: "PGRST202", message: "x" }, "carregar"),
    ).toMatch(/ainda não foram ativados/);
    expect(
      mensagemDeErroDoPainel({ code: "42501", message: "denied" }, "carregar"),
    ).toMatch(/Sem permissão/);
    expect(mensagemDeErroDoPainel(new Error("boom"), "carregar o CRM")).toBe(
      "Não foi possível carregar o CRM agora. Tente de novo em instantes.",
    );
  });
});

describe("segmentos RFM e WhatsApp", () => {
  it("os 10 segmentos do contrato têm rótulo e descrição", () => {
    expect(new Set(SEGMENTOS_DO_CRM).size).toBe(10);
    for (const segmento of SEGMENTOS_DO_CRM) {
      const info = infoDoSegmento(segmento);
      expect(info.rotulo.length).toBeGreaterThan(0);
      expect(info.descricao.length).toBeGreaterThan(0);
    }
    expect(infoDoSegmento("nao_pode_perder").rotulo).toBe("Não pode perder");
  });

  it("wa.me com DDI 55 e o texto codificado; número curto não vira link", () => {
    expect(linkWhatsappDoCrm("(11) 98765-4321", "Oi, Ana! Tudo bem?")).toBe(
      "https://wa.me/5511987654321?text=Oi%2C%20Ana!%20Tudo%20bem%3F",
    );
    expect(linkWhatsappDoCrm("5511987654321", "Oi")).toBe(
      "https://wa.me/5511987654321?text=Oi",
    );
    expect(linkWhatsappDoCrm("98765", "Oi")).toBeNull();
    expect(linkWhatsappDoCrm(null, "Oi")).toBeNull();
  });

  it("o texto usa o primeiro nome e a loja, e nunca promete desconto que não existe", () => {
    expect(
      mensagemDoSegmento("novos", { nome: "Ana Maria Souza", loja: "Loja X" }),
    ).toMatch(/^Oi, Ana! Aqui é da Loja X\. Obrigado pela sua primeira compra/);
    expect(
      mensagemDoSegmento("em_risco", { nome: null, loja: "Loja X" }),
    ).toMatch(/^Oi! Aqui é da Loja X\./);
    for (const segmento of [...SEGMENTOS_DO_CRM, null]) {
      const texto = mensagemDoSegmento(segmento, { nome: "Ana", loja: "L" });
      expect(texto).not.toMatch(/cupom|desconto|% off|grátis/i);
    }
  });
});
