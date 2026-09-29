// Funções puras do Início e do Dashboard CRM (src/lib/crm.ts): os parsers
// defensivos das RPCs `painel_inicio`, `assinatura_da_loja_ler`, `crm_visao`
// e `crm_clientes` (todas devolvem jsonb — "não sei" vira null, nunca zero
// inventado), a matemática de período no fuso de São Paulo, os formatadores
// e o link de WhatsApp com texto pronto por segmento RFM.
import {
  FAIXAS_DE_SEGMENTOS_DO_CRM,
  SEGMENTOS_DO_CRM,
  completarSerieDe14Dias,
  faixaApareceNaGrade,
  formatarData,
  formatarMoeda,
  formatarMoedaCompacta,
  formatarPercentual,
  formatarVariacao,
  infoDoSegmento,
  intervaloDoPeriodo,
  lerAssinaturaDaLoja,
  lerClientesDoCrm,
  lerPainelInicio,
  lerVisaoDoCrm,
  linkWhatsappDoCrm,
  mensagemDeErroDoPainel,
  mensagemDoSegmento,
  rotuloCurtoDoSegmento,
  rotuloDaReceita,
  rotuloDeUltimaAtividade,
  rotuloDoCanal,
  rotuloDoStatusDoPedido,
  textoDaReceitaDoCliente,
  textoDeUltimaAtividade,
  textoDoValorDoBlocoDeSegmento,
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
        taxa_recompra: 0.285,
        receita_recorrente_pct: 0.61,
        ltv_medio: 420,
        receita_em_risco: 1800,
        taxa_devolucao: 0.032,
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

  it("lê valor_em_aberto quando a RPC manda (grupo pediu_nao_pagou); vira null quando ausente (RPC antiga, banco na 78)", () => {
    const lista = lerClientesDoCrm({
      clientes: [
        {
          user_id: "u-2",
          nome: "Bia",
          pedidos: 2,
          receita: 0,
          segmento: "pediu_nao_pagou",
          valor_em_aberto: 80,
        },
        { user_id: "u-1", nome: "Ana", pedidos: 3, receita: 300 },
      ],
    });
    expect(lista?.clientes[0].valorEmAberto).toBe(80);
    expect(lista?.clientes[1].valorEmAberto).toBeNull();
  });

  it("lê cadastrado_em quando a RPC manda (grupo nunca_comprou); vira null quando ausente", () => {
    const lista = lerClientesDoCrm({
      clientes: [
        {
          user_id: "u-3",
          nome: "Gustavo",
          pedidos: 0,
          receita: 0,
          segmento: "nunca_comprou",
          cadastrado_em: "2026-08-15",
        },
        { user_id: "u-1", nome: "Ana", pedidos: 3, receita: 300 },
      ],
    });
    expect(lista?.clientes[0].cadastradoEm).toBe("2026-08-15");
    expect(lista?.clientes[1].cadastradoEm).toBeNull();
  });

  it("lê os segmentos novos em crm_clientes e em crm_visao (RPC nova, migration 83)", () => {
    const lista = lerClientesDoCrm({
      clientes: [
        { user_id: "u-1", segmento: "nunca_comprou", pedidos: 0, receita: 0 },
      ],
    });
    expect(lista?.clientes[0].segmento).toBe("nunca_comprou");

    const visao = lerVisaoDoCrm({
      kpis: {},
      canais: [],
      formas: [],
      funil: {},
      pipeline: [],
      segmentos: [
        { segmento: "pediu_nao_pagou", clientes: 3, receita: 80 },
        { segmento: "nunca_comprou", clientes: 5, receita: 0 },
      ],
    });
    expect(visao?.segmentos).toEqual([
      { segmento: "pediu_nao_pagou", clientes: 3, receita: 80 },
      { segmento: "nunca_comprou", clientes: 5, receita: 0 },
    ]);
  });
});

describe("linha do cliente dos grupos novos: receita, e rótulo/texto da última atividade", () => {
  it("comprador de sempre: receita normal, rótulo 'Receita'/'Última compra'", () => {
    expect(
      semNbsp(
        textoDaReceitaDoCliente({
          segmento: "campeoes",
          receita: 300,
          valorEmAberto: null,
        }),
      ),
    ).toBe(semNbsp(formatarMoeda(300)));
    expect(rotuloDaReceita("campeoes")).toBe("Receita");
    expect(rotuloDeUltimaAtividade("campeoes")).toBe("Última compra");
    expect(
      textoDeUltimaAtividade({
        segmento: "campeoes",
        ultimaCompra: "2026-09-20",
      }),
    ).toBe("20/09/2026");
  });

  it("pediu_nao_pagou: rótulo 'Em aberto'/'Último pedido'; valor é SÓ o dinheiro (o rótulo já diz 'em aberto', sem repetir no valor)", () => {
    expect(rotuloDaReceita("pediu_nao_pagou")).toBe("Em aberto");
    expect(rotuloDeUltimaAtividade("pediu_nao_pagou")).toBe("Último pedido");
    expect(
      semNbsp(
        textoDaReceitaDoCliente({
          segmento: "pediu_nao_pagou",
          receita: 0,
          valorEmAberto: 80,
        }),
      ),
    ).toBe(semNbsp(formatarMoeda(80)));
    expect(
      textoDeUltimaAtividade({
        segmento: "pediu_nao_pagou",
        ultimaCompra: "2026-09-24",
      }),
    ).toBe("24/09/2026");
  });

  it("pediu_nao_pagou sem valor_em_aberto (RPC antiga, banco na 78): '—', nunca 'R$ 0,00'", () => {
    expect(
      textoDaReceitaDoCliente({
        segmento: "pediu_nao_pagou",
        receita: 0,
        valorEmAberto: null,
      }),
    ).toBe("—");
  });

  it("pediu_nao_pagou com valor_em_aberto MEDIDO zero (ex.: PIX expirou, nada mais em aberto): texto discreto, nunca 'R$ 0,00' em destaque", () => {
    const texto = textoDaReceitaDoCliente({
      segmento: "pediu_nao_pagou",
      receita: 0,
      valorEmAberto: 0,
    });
    expect(texto).not.toMatch(/R\$\s?0,00/);
    expect(texto.length).toBeGreaterThan(0);
  });

  it("nunca_comprou: receita '—', 'Última compra: Nunca' mesmo se o campo vier preenchido por engano", () => {
    expect(
      textoDaReceitaDoCliente({
        segmento: "nunca_comprou",
        receita: 0,
        valorEmAberto: null,
      }),
    ).toBe("—");
    expect(rotuloDaReceita("nunca_comprou")).toBe("Receita");
    expect(rotuloDeUltimaAtividade("nunca_comprou")).toBe("Última compra");
    expect(
      textoDeUltimaAtividade({ segmento: "nunca_comprou", ultimaCompra: null }),
    ).toBe("Nunca");
    expect(
      textoDeUltimaAtividade({
        segmento: "nunca_comprou",
        ultimaCompra: "2026-09-24",
      }),
    ).toBe("Nunca");
  });

  it("compacto=true usa formatarMoedaCompacta (célula estreita do desktop, achado B da revisão de front): valor grande não transborda a coluna", () => {
    // R$ 12.345,67 por extenso (~96px) não cabe na coluna "Receita / Em
    // aberto" (~85px a 1024px) e encosta em "Última compra" — a partir de
    // R$ 10 mil, formatarMoedaCompacta já abrevia ("R$ 12,3 mil").
    const cheio = textoDaReceitaDoCliente({
      segmento: "campeoes",
      receita: 12345.67,
      valorEmAberto: null,
    });
    const compacto = textoDaReceitaDoCliente(
      { segmento: "campeoes", receita: 12345.67, valorEmAberto: null },
      { compacto: true },
    );
    expect(semNbsp(cheio)).toBe(semNbsp(formatarMoeda(12345.67)));
    expect(semNbsp(compacto)).toBe(semNbsp(formatarMoedaCompacta(12345.67)));
    expect(compacto.length).toBeLessThan(cheio.length);
  });

  it("compacto=true não muda os textos especiais ('—' e 'Sem valor em aberto') nem o pediu_nao_pagou pequeno", () => {
    expect(
      textoDaReceitaDoCliente(
        { segmento: "nunca_comprou", receita: 0, valorEmAberto: null },
        { compacto: true },
      ),
    ).toBe("—");
    expect(
      textoDaReceitaDoCliente(
        { segmento: "pediu_nao_pagou", receita: 0, valorEmAberto: 0 },
        { compacto: true },
      ),
    ).toBe("Sem valor em aberto");
    expect(
      semNbsp(
        textoDaReceitaDoCliente(
          { segmento: "pediu_nao_pagou", receita: 0, valorEmAberto: 80 },
          { compacto: true },
        ),
      ),
    ).toBe(semNbsp(formatarMoedaCompacta(80)));
  });
});

describe("crachá curto do segmento (não espreme o nome na linha do cliente)", () => {
  it("nunca_comprou usa 'Nunca comprou' — a faixa já dá o contexto de 'Cadastrado'", () => {
    expect(rotuloCurtoDoSegmento("nunca_comprou")).toBe("Nunca comprou");
  });

  it("os demais segmentos continuam com o rótulo de sempre (nada de encolher o que já cabia)", () => {
    expect(rotuloCurtoDoSegmento("pediu_nao_pagou")).toBe(
      infoDoSegmento("pediu_nao_pagou").rotulo,
    );
    expect(rotuloCurtoDoSegmento("campeoes")).toBe(
      infoDoSegmento("campeoes").rotulo,
    );
  });
});

describe("textoDoValorDoBlocoDeSegmento — a linha de dinheiro do bloco na grade", () => {
  it("nunca_comprou não tem valor possível: null (o bloco não desenha a linha)", () => {
    expect(textoDoValorDoBlocoDeSegmento("nunca_comprou", 0)).toBeNull();
    // Mesmo que algum dia venha receita > 0 por engano, o grupo nunca teve
    // pedido — não desenha valor nenhum de qualquer forma.
    expect(textoDoValorDoBlocoDeSegmento("nunca_comprou", 500)).toBeNull();
  });

  it("pediu_nao_pagou qualifica o número como 'em aberto' — é dinheiro em risco, não reconhecido", () => {
    expect(
      semNbsp(textoDoValorDoBlocoDeSegmento("pediu_nao_pagou", 612.3) ?? ""),
    ).toBe(`${semNbsp(formatarMoedaCompacta(612.3))} em aberto`);
  });

  it("os demais segmentos mostram a receita compacta de sempre", () => {
    expect(textoDoValorDoBlocoDeSegmento("campeoes", 9800)).toBe(
      formatarMoedaCompacta(9800),
    );
  });
});

describe("faixaApareceNaGrade — RPC antiga (78) não inventa '0' para os 2 grupos novos", () => {
  const faixaNova = FAIXAS_DE_SEGMENTOS_DO_CRM.find(
    (f) => f.titulo === "Ainda não compraram",
  )!;
  const faixaAntiga = FAIXAS_DE_SEGMENTOS_DO_CRM.find(
    (f) => f.titulo === "Melhores",
  )!;

  it("a faixa nova NÃO aparece sem nenhum dos 2 segmentos presentes e sem estar carregando (RPC ainda na 78)", () => {
    expect(faixaApareceNaGrade(faixaNova, new Set(["ativos"]), false)).toBe(
      false,
    );
  });

  it("a faixa nova aparece enquanto carrega (esqueleto), mesmo sem dado nenhum ainda", () => {
    expect(faixaApareceNaGrade(faixaNova, new Set(), true)).toBe(true);
  });

  it("a faixa nova aparece quando a RPC (83) manda pelo menos um dos 2 segmentos", () => {
    expect(
      faixaApareceNaGrade(faixaNova, new Set(["pediu_nao_pagou"]), false),
    ).toBe(true);
    expect(
      faixaApareceNaGrade(faixaNova, new Set(["nunca_comprou"]), false),
    ).toBe(true);
  });

  it("as faixas RFM de sempre continuam aparecendo mesmo com 0 clientes (sempre puderam ser 0 legitimamente)", () => {
    expect(faixaApareceNaGrade(faixaAntiga, new Set(), false)).toBe(true);
  });
});

describe("completarSerieDe14Dias — o minigráfico do Início nunca perde coluna", () => {
  it("série vazia continua vazia (a tela já lê isso como 'sem venda')", () => {
    expect(completarSerieDe14Dias([])).toEqual([]);
  });

  it("1 ponto vira 14 dias: 13 completados com zero, o dia recebido preserva a receita", () => {
    const completa = completarSerieDe14Dias([
      { dia: "2026-09-26", receita: 350 },
    ]);
    expect(completa).toHaveLength(14);
    expect(completa[0].dia).toBe("2026-09-13");
    expect(completa.at(-1)).toEqual({ dia: "2026-09-26", receita: 350 });
    // Os outros 13 dias são zero, não "não sei" — dia sem venda é zero medido.
    expect(completa.slice(0, -1).every((p) => p.receita === 0)).toBe(true);
    expect(completa.map((p) => p.dia)).toEqual([
      "2026-09-13",
      "2026-09-14",
      "2026-09-15",
      "2026-09-16",
      "2026-09-17",
      "2026-09-18",
      "2026-09-19",
      "2026-09-20",
      "2026-09-21",
      "2026-09-22",
      "2026-09-23",
      "2026-09-24",
      "2026-09-25",
      "2026-09-26",
    ]);
  });

  it("ancora no ÚLTIMO dia recebido, não em 'hoje' do cliente", () => {
    // O último ponto é de ontem (ex.: o servidor ainda não fechou o dia de
    // hoje) — os 14 dias terminam nele, não em "hoje".
    const completa = completarSerieDe14Dias([
      { dia: "2026-09-10", receita: 40 },
      { dia: "2026-09-25", receita: 200 },
    ]);
    expect(completa.at(-1)?.dia).toBe("2026-09-25");
    expect(completa[0].dia).toBe("2026-09-12");
    // O dia 10 caiu fora da janela de 14 dias (12 a 25) e não aparece mais.
    expect(completa.find((p) => p.dia === "2026-09-10")).toBeUndefined();
  });

  it("um buraco no meio da série vira zero, sem mexer nos dias já preenchidos", () => {
    const completa = completarSerieDe14Dias([
      { dia: "2026-09-13", receita: 10 },
      { dia: "2026-09-20", receita: 80 },
      { dia: "2026-09-26", receita: 350 },
    ]);
    expect(completa).toHaveLength(14);
    expect(completa.find((p) => p.dia === "2026-09-20")?.receita).toBe(80);
    expect(completa.find((p) => p.dia === "2026-09-15")?.receita).toBe(0);
  });

  it("série já com 14 dias sai igual (idempotente)", () => {
    const original = Array.from({ length: 14 }, (_, i) => ({
      dia: `2026-09-${String(13 + i).padStart(2, "0")}`,
      receita: i,
    }));
    expect(completarSerieDe14Dias(original)).toEqual(original);
  });

  it("ancora no MAIOR dia, mesmo com a entrada fora de ordem", () => {
    // Fora de ordem de propósito: o dia mais recente (26) vem no meio, não
    // no fim do array — a função não pode confiar em posição, só no valor.
    const completa = completarSerieDe14Dias([
      { dia: "2026-09-20", receita: 80 },
      { dia: "2026-09-26", receita: 350 },
      { dia: "2026-09-10", receita: 40 },
    ]);
    expect(completa.at(-1)?.dia).toBe("2026-09-26");
    expect(completa[0].dia).toBe("2026-09-13");
    expect(completa.find((p) => p.dia === "2026-09-20")?.receita).toBe(80);
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

  it("datas", () => {
    expect(formatarData("2026-09-26")).toBe("26/09/2026");
    expect(formatarData("2026-09-26T01:00:00Z")).toBe("25/09/2026");
    expect(formatarData(null)).toBe("—");
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
  it("os 10 segmentos RFM + os 2 grupos novos (pediu_nao_pagou, nunca_comprou) têm rótulo e descrição", () => {
    expect(new Set(SEGMENTOS_DO_CRM).size).toBe(12);
    for (const segmento of SEGMENTOS_DO_CRM) {
      const info = infoDoSegmento(segmento);
      expect(info.rotulo.length).toBeGreaterThan(0);
      expect(info.descricao.length).toBeGreaterThan(0);
    }
    expect(infoDoSegmento("nao_pode_perder").rotulo).toBe("Não pode perder");
    expect(infoDoSegmento("pediu_nao_pagou").rotulo).toBe("Pediu e não pagou");
    expect(infoDoSegmento("nunca_comprou").rotulo).toBe(
      "Cadastrado, nunca comprou",
    );
    // A descrição não pode afirmar "nenhum pagamento foi confirmado": o
    // grupo também inclui quem pagou e teve o pedido cancelado/estornado/
    // devolvido depois — "nunca_pagou" seria falso para essa gente.
    expect(infoDoSegmento("pediu_nao_pagou").descricao).not.toMatch(
      /nenhum pagamento|não pagou|nunca pagou/i,
    );
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

  it("pediu_nao_pagou: a mensagem não afirma nada sobre pagamento (o pedido pode ter sido pago e cancelado/estornado depois)", () => {
    const texto = mensagemDoSegmento("pediu_nao_pagou", {
      nome: "Ana",
      loja: "Loja X",
    });
    expect(texto).not.toMatch(/pagamento|pagou|pago/i);
    expect(texto).toMatch(/pedido/i);
  });
});
