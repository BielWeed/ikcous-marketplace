// @ts-nocheck
/**
 * Corrida da vaga do CARTÃO (caça "só testes", 26/11/2026): os ramos de
 * dinheiro que a cobertura achou sem nenhum teste (DA=0 em `index_test.ts` e
 * em `index_verificar_parcelas_e_retentativa_test.ts`).
 *
 *  1. O cartão desta chamada perdeu a vaga e ficou ÓRFÃO num desafio 3DS
 *     (`action_required`, nada capturado): pede o cancelamento ao MP.
 *     Cancelado -> resposta de sempre, sem `cartaoEmAnalise`. NÃO cancelado
 *     -> avisa o admin, e os 409 "prazo acabou" e "Não foi possível confirmar
 *     a cobrança" saem com `cartaoEmAnalise: true` (a order ainda pode
 *     aprovar, e o front não pode oferecer PIX nem "Cancelar pedido").
 *  2. O cartão APROVADO perdeu a vaga para o SENTINELA da MESMA tentativa:
 *     adota a vaga por compare-and-set sobre o sentinela (sem aviso falso de
 *     órfão). Sentinela de OUTRA tentativa: a vaga não é sobrescrita.
 *  3. Depois de liberar a vaga morta, a releitura acha a vaga ocupada de novo
 *     por CARTÃO (crédito/débito) ou por SENTINELA: 409 com `cartaoEmAnalise`.
 *  4. Depois de perder a corrida, a RELEITURA do pedido falha: não dá para
 *     saber o que está na vaga, e a resposta sai com `cartaoEmAnalise`.
 *
 * Banco e Mercado Pago são locais e falsos (o mesmo jeito do banco COM ESTADO
 * de `index_test.ts`: o UPDATE só grava se TODO filtro do WHERE bate contra a
 * linha no instante da chamada). A corrida entra pelo `aoCriar` do MP falso:
 * a outra aba/o pg_cron mexe na linha ENQUANTO o POST do cartão está no ar,
 * depois que a reserva desta chamada já gravou o sentinela dela. Nenhuma
 * cobrança real nasce.
 */
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { montarSentinela, sentinelaDaChave } from "../_shared/mercadopago.ts";
import { handler } from "./index.ts";

const UUID = "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
const DONO = "5f5f5f5f-6666-7777-8888-999900001111";
const PRAZO = "2099-01-01T00:00:00.000Z";
const ORDER_CARTAO = "ORDTST09CORRIDACARTAO0000000";
const OUTRA_COBRANCA = "ORDTST09OUTRACOBRANCA0000000";
const ORDER_MORTA_NA_VAGA = "ORDTST09MORTANAVAGA000000000";
const URL_DESAFIO = "https://www.mercadopago.com.br/3ds/challenge/ORDTST09";
const CHAVE_C0 = `${UUID}:c0`;
// Sentinela que OUTRA aba gravou: a MESMA tentativa (c0) com outro carimbo, e
// a tentativa SEGUINTE (c1). Formato de `montarSentinela`, como a reserva grava.
const SENTINELA_C0_DE_OUTRA_ABA = montarSentinela(`${CHAVE_C0}:outraaba`, 1);
const SENTINELA_C1 = montarSentinela(`${UUID}:c1:outraaba`, 1);
const CREDENCIAIS = {
  origem: "lojista",
  token: "TOKEN-FALSO-DE-TESTE",
  segredoWebhook: "WEBHOOK-FALSO-DE-TESTE",
  publicKey: "PUBLICA-FALSA-DE-TESTE",
};
const COLUNAS_DA_RELEITURA_APOS_CORRIDA =
  "payment_status, gateway_payment_id, metodo_online, status, tentativas_de_pagamento";
const FRASE_PODE_TER_SIDO_COBRADO = "Seu cartão pode ter sido cobrado; a loja vai conferir e confirmar o pedido em breve.";

function montarToken(sub: string): string {
  const base64 = btoa(JSON.stringify({ sub })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `cabecalho.${base64}.assinatura`;
}

function pedidoDe(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: UUID,
    user_id: DONO,
    total: 100,
    payment_status: "aguardando",
    status: "pending",
    payment_method: "online",
    gateway_payment_id: null,
    metodo_online: null,
    tentativas_de_pagamento: 0,
    expires_at: PRAZO,
    created_at: "2026-11-26T10:00:00.000Z",
    updated_at: "2026-11-26T10:00:00.000Z",
    customer_data: { email: "cliente@exemplo.com" },
    ...extra,
  };
}

const corpoCartao = {
  orderId: UUID,
  metodo: "cartao",
  token: "ff8080814c11e237014c1ff593b57b4d",
  paymentMethodId: "master",
  paymentTypeId: "credit_card",
  parcelas: 3,
  documento: { type: "CPF", number: "12345678909" },
};

/** Uma order de CARTÃO no formato da Orders API (o mesmo de `index_test.ts`). */
function orderDeCartao(
  status: string,
  statusDetail: string,
  extra: { id?: string; url3ds?: string } = {},
): Record<string, unknown> {
  return {
    id: extra.id ?? ORDER_CARTAO,
    status,
    status_detail: statusDetail,
    external_reference: UUID,
    total_amount: "100.00",
    transactions: {
      payments: [
        {
          id: "PAY09CARTAO",
          status,
          status_detail: statusDetail,
          amount: "100.00",
          payment_method: {
            id: "master",
            type: "credit_card",
            installments: 3,
            ...(extra.url3ds ? { transaction_security: { url: extra.url3ds, type: "challenge" } } : {}),
          },
        },
      ],
    },
  };
}

/**
 * Banco COM ESTADO de uma linha só. Toda cadeia (`select`/`update` + `eq`/
 * `neq`/`is`) vira um filtro que precisa bater contra a linha REAL quando a
 * chamada termina — a reserva, a gravação final e os compare-and-set da
 * adoção disputam a vaga de verdade. As leituras de melhor esforço (itens,
 * endereço, nome da loja) devolvem vazio; a soma do teto por cliente devolve
 * só esta linha. `falharLeitura` devolve ERRO de banco para a leitura com
 * aquela lista de colunas; `aoLiberar` roda depois de a RPC soltar a vaga
 * (a outra aba que ocupa a vaga livre antes da releitura).
 */
function bancoComEstado(
  linha: Record<string, unknown>,
  o: { falharLeitura?: string; aoLiberar?: (l: Record<string, unknown>) => void } = {},
) {
  const escritas: Array<{ valores: Record<string, unknown>; filtros: Array<[string, unknown]>; gravou: boolean }> = [];
  const rpcs: Array<{ nome: string; args: Record<string, unknown> }> = [];
  const leiturasFalhadas: string[] = [];
  const projetar = (colunas: string) => {
    const pedidas = new Set(colunas.split(",").map((c) => c.trim()));
    return Object.fromEntries(Object.entries(linha).filter(([c]) => pedidas.has(c)));
  };
  return {
    linha,
    escritas,
    rpcs,
    leiturasFalhadas,
    rpc: async (nome: string, args: Record<string, unknown>) => {
      rpcs.push({ nome, args });
      if (nome !== "liberar_cobranca_do_pedido") throw new Error(`rpc inesperada: ${nome}`);
      // A regra da RPC real: solta só a vaga com a string EXATA, num pedido
      // 'aguardando', e soma a tentativa.
      if (linha.gateway_payment_id === args.p_gateway_payment_id && linha.payment_status === "aguardando") {
        linha.gateway_payment_id = null;
        linha.metodo_online = null;
        linha.tentativas_de_pagamento = Number(linha.tentativas_de_pagamento ?? 0) + 1;
        o.aoLiberar?.(linha);
        return { data: true, error: null };
      }
      return { data: false, error: null };
    },
    from(tabela: string) {
      const filtros: Array<[string, unknown, boolean]> = [];
      let colunas = "";
      let valores: Record<string, unknown> | undefined;
      const bate = () =>
        filtros.every(([c, v, negado]) => (negado ? Reflect.get(linha, c) !== v : Reflect.get(linha, c) === v));
      const unico = async () => {
        if (tabela === "config_pagamento_cartao") {
          return { data: { credito: true, debito: true, parcelas_max: 12 }, error: null };
        }
        if (tabela !== "marketplace_orders") return { data: null, error: null };
        if (valores) {
          const gravou = bate();
          escritas.push({ valores, filtros: filtros.map(([c, v, n]) => [n ? `${c}<>` : c, v]), gravou });
          if (!gravou) return { data: null, error: null };
          Object.assign(linha, valores);
          return { data: projetar(colunas), error: null };
        }
        if (o.falharLeitura !== undefined && colunas === o.falharLeitura) {
          leiturasFalhadas.push(colunas);
          return { data: null, error: { message: "statement timeout" } };
        }
        return { data: bate() ? projetar(colunas) : null, error: null };
      };
      const lista = async () => {
        if (tabela === "marketplace_orders") {
          return { data: [{ tentativas_de_pagamento: linha.tentativas_de_pagamento ?? 0 }], error: null };
        }
        return { data: [], error: null };
      };
      const cadeia = {
        select(s: string) {
          colunas = s;
          return cadeia;
        },
        update(v: Record<string, unknown>) {
          valores = v;
          return cadeia;
        },
        eq(c: string, v: unknown) {
          if (colunas !== "tentativas_de_pagamento") filtros.push([c, v, false]);
          return cadeia;
        },
        neq(c: string, v: unknown) {
          filtros.push([c, v, true]);
          return cadeia;
        },
        is(c: string, v: unknown) {
          filtros.push([c, v, false]);
          return cadeia;
        },
        gte: () => cadeia,
        gt: () => cadeia,
        limit: () => cadeia,
        order: () => cadeia,
        maybeSingle: () => unico(),
        then: (ok: (v: unknown) => unknown, nok?: (e: unknown) => unknown) => lista().then(ok, nok),
      };
      return cadeia;
    },
  };
}

/**
 * Mercado Pago falso: POST /v1/orders cria (`criada`) e roda `aoCriar` ANTES
 * de responder (a corrida acontece com o POST no ar); POST .../cancel devolve
 * `cancelamento`; GET /v1/orders/{id} devolve `consultas[id]` ou 404. Rota não
 * prevista (uma segunda cobrança, uma busca) derruba o teste.
 */
function mercadoPago(o: {
  criada?: Record<string, unknown>;
  aoCriar?: () => void;
  cancelamento?: { status: number; corpo: unknown };
  consultas?: Record<string, Record<string, unknown>>;
}) {
  const chamadas: Array<{ verbo: string; url: string; chave?: string }> = [];
  const fn = async (url: string, init?: RequestInit): Promise<Response> => {
    const verbo = (init?.method ?? "GET").toUpperCase();
    const chave = (init?.headers as Record<string, string> | undefined)?.["X-Idempotency-Key"];
    chamadas.push({ verbo, url, chave });
    if (verbo === "POST" && url.endsWith("/cancel")) {
      if (!o.cancelamento) throw new Error(`cancelamento inesperado: ${url}`);
      return new Response(JSON.stringify(o.cancelamento.corpo), { status: o.cancelamento.status });
    }
    if (verbo === "POST" && url.endsWith("/v1/orders")) {
      if (!o.criada) throw new Error("criação inesperada");
      o.aoCriar?.();
      return new Response(JSON.stringify(o.criada), { status: 201 });
    }
    if (verbo === "GET" && url.includes("/v1/orders/")) {
      const id = url.split("/v1/orders/")[1]?.split("?")[0] ?? "";
      // `Map`, não indexação por variável (`security/detect-object-injection`).
      const alvo = new Map(Object.entries(o.consultas ?? {})).get(id);
      return alvo
        ? new Response(JSON.stringify(alvo), { status: 200 })
        : new Response(JSON.stringify({ message: "not_found" }), { status: 404 });
    }
    throw new Error(`fetch inesperado: ${verbo} ${url}`);
  };
  const criacoes = () => chamadas.filter((c) => c.verbo === "POST" && c.url.endsWith("/v1/orders"));
  const cancelamentos = () => chamadas.filter((c) => c.verbo === "POST" && c.url.endsWith("/cancel"));
  return { fn, chamadas, criacoes, cancelamentos };
}

/** Chama o handler com o cartão do dono, logs capturados (não impressos). */
async function pagarComCartao(
  db: ReturnType<typeof bancoComEstado>,
  mp: ReturnType<typeof mercadoPago>,
) {
  const logs: string[] = [];
  const avisosAoAdmin: Array<{ orderId: string; idOrderOrfa: string }> = [];
  const anteriores = { error: console.error, warn: console.warn, log: console.log };
  console.error = (...a: unknown[]) => logs.push(a.map(String).join(" "));
  console.warn = (...a: unknown[]) => logs.push(a.map(String).join(" "));
  console.log = () => {};
  const sandboxAntes = Deno.env.get("MP_SANDBOX_PAYER_EMAIL");
  Deno.env.delete("MP_SANDBOX_PAYER_EMAIL");
  try {
    const resposta = await handler(
      new Request("http://localhost/criar-pagamento", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: montarToken(DONO) },
        body: JSON.stringify(corpoCartao),
      }),
      {
        supabase: db as never,
        fetchImpl: mp.fn as typeof fetch,
        credenciaisMp: CREDENCIAIS,
        statusesCartaoDesconhecidosAvisados: new Set<string>(),
        enviarPush: async () => {},
        enviarComprovante: async () => {},
        enviarAvisoAtrasado: async () => {},
        alertarAdminCartaoOrfao: async (a: { orderId: string; idOrderOrfa: string }) => {
          avisosAoAdmin.push({ orderId: a.orderId, idOrderOrfa: a.idOrderOrfa });
        },
      },
    );
    return { status: resposta.status, corpo: await resposta.json(), logs, avisosAoAdmin };
  } finally {
    if (sandboxAntes !== undefined) Deno.env.set("MP_SANDBOX_PAYER_EMAIL", sandboxAntes);
    console.error = anteriores.error;
    console.warn = anteriores.warn;
    console.log = anteriores.log;
  }
}

const desafio3ds = () => orderDeCartao("action_required", "pending_challenge", { url3ds: URL_DESAFIO });
const cancelada = { status: 200, corpo: orderDeCartao("canceled", "canceled") };
const cancelamentoNegado = { status: 500, corpo: { message: "internal_error" } };

// ── Lacuna 1: o desafio 3DS que perdeu a vaga ficou órfão ───────────────────
//
// As duas saídas 409 que dependem do cancelamento. (i) "prazo acabou": a vaga
// foi para OUTRA cobrança e o pg_cron expirou o pedido com o POST no ar. (ii)
// "Não foi possível confirmar": a vaga ficou VAZIA num pedido que saiu de
// 'aguardando' sem explicação (a releitura não explica a perda).

const corridasDoOrfao = [
  {
    nome: "vaga com OUTRA cobrança e pedido expirado",
    mexer: (l: Record<string, unknown>) => {
      l.gateway_payment_id = OUTRA_COBRANCA;
      l.payment_status = "expirado";
      l.status = "cancelled";
    },
    erro: "O prazo para pagar este pedido acabou.",
    terminal: true,
    vagaNoFim: OUTRA_COBRANCA,
  },
  {
    nome: "vaga VAZIA num pedido fora de 'aguardando' (a releitura não explica)",
    mexer: (l: Record<string, unknown>) => {
      l.gateway_payment_id = null;
      l.payment_status = "recusado";
    },
    erro: "Não foi possível confirmar a cobrança.",
    terminal: undefined,
    vagaNoFim: null,
  },
];

for (const caso of corridasDoOrfao) {
  Deno.test(`órfão 3DS (${caso.nome}), MP CANCELA -> '${caso.erro}' SEM cartaoEmAnalise, admin não é acordado`, async () => {
    const db = bancoComEstado(pedidoDe());
    const mp = mercadoPago({ criada: desafio3ds(), aoCriar: () => caso.mexer(db.linha), cancelamento: cancelada });

    const r = await pagarComCartao(db, mp);

    assertEquals(r.status, 409);
    assertEquals(r.corpo.error, caso.erro);
    assertEquals(r.corpo.terminal, caso.terminal);
    assertEquals("cartaoEmAnalise" in r.corpo, false, "cancelado no MP: não há cartão desta chamada sem desfecho");
    // O cancelamento é desta order, com a chave idempotente do cancelamento.
    assertEquals(mp.cancelamentos().length, 1);
    assertStringIncludes(mp.cancelamentos()[0].url, `/v1/orders/${ORDER_CARTAO}/cancel`);
    assertEquals(mp.cancelamentos()[0].chave, `cancelar:${ORDER_CARTAO}`);
    assertEquals(r.avisosAoAdmin, []);
    assertEquals(r.logs.some((l) => l.includes("cartao_orfao evitado")), true);
    // Uma cobrança só, e a vaga da outra cobrança intacta (nada adotado).
    assertEquals(mp.criacoes().length, 1);
    assertEquals(db.linha.gateway_payment_id, caso.vagaNoFim);
    assertEquals(db.escritas.length, 2, "a reserva e a gravação final que perdeu — nenhuma adoção");
    assertEquals(db.escritas[1].gravou, false);
  });

  Deno.test(`órfão 3DS (${caso.nome}), MP NÃO cancela -> admin avisado e '${caso.erro}' COM cartaoEmAnalise`, async () => {
    const db = bancoComEstado(pedidoDe());
    const mp = mercadoPago({
      criada: desafio3ds(),
      aoCriar: () => caso.mexer(db.linha),
      cancelamento: cancelamentoNegado,
    });

    const r = await pagarComCartao(db, mp);

    assertEquals(r.status, 409);
    assertEquals(r.corpo.error, caso.erro);
    assertEquals(r.corpo.terminal, caso.terminal);
    assertEquals(r.corpo.cartaoEmAnalise, true, "o desafio ainda pode aprovar: o front não oferece PIX nem cancelar");
    assertEquals(mp.cancelamentos().length >= 1, true);
    assertEquals(r.avisosAoAdmin, [{ orderId: UUID, idOrderOrfa: ORDER_CARTAO }]);
    assertEquals(r.logs.some((l) => l.includes("o MP não cancelou a cobrança")), true);
    assertEquals(mp.criacoes().length, 1);
    assertEquals(db.linha.gateway_payment_id, caso.vagaNoFim);
  });
}

// ── Lacuna 2: o cartão APROVADO contra o sentinela ──────────────────────────
//
// A outra aba da MESMA tentativa regravou o sentinela (outro carimbo, mesma
// chave c0) e o pg_cron expirou o pedido com o POST no ar — a blindagem de
// 02/10 só adota em pedido 'aguardando', então quem decide é o ramo do
// cartão aprovado (Política P1: dinheiro que já entrou é honrado).

Deno.test("cartão APROVADO perde a vaga para o sentinela da MESMA tentativa -> adota a vaga por CAS sobre o sentinela, 200 'pago', sem aviso de órfão", async () => {
  const db = bancoComEstado(pedidoDe());
  const mp = mercadoPago({
    criada: orderDeCartao("processed", "accredited"),
    aoCriar: () => {
      db.linha.gateway_payment_id = SENTINELA_C0_DE_OUTRA_ABA;
      db.linha.payment_status = "expirado";
      db.linha.status = "cancelled";
    },
  });

  const r = await pagarComCartao(db, mp);

  assertEquals(r.status, 200);
  assertEquals(r.corpo.paymentId, ORDER_CARTAO);
  assertEquals(r.corpo.statusPagamento, "pago");
  assertEquals(r.corpo.expiraEm, PRAZO);
  assertEquals(r.corpo.error, undefined);
  assertEquals(r.corpo.cartaoEmAnalise, undefined);
  // O pedido passa a apontar para o id REAL, com a forma do cartão.
  assertEquals(db.linha.gateway_payment_id, ORDER_CARTAO);
  assertEquals(db.linha.metodo_online, "credito");
  assertEquals(db.linha.parcelas, 3);
  // Nenhum aviso falso de órfão, nada cancelado (aprovado não se cancela).
  assertEquals(r.avisosAoAdmin, []);
  assertEquals(mp.cancelamentos().length, 0);
  assertEquals(r.logs.some((l) => l.includes("o sentinela desta mesma tentativa foi trocado")), true);
  // A adoção é um compare-and-set sobre o SENTINELA que estava lá — nunca
  // sobre a vaga livre nem sem filtro de vaga.
  assertEquals(sentinelaDaChave(SENTINELA_C0_DE_OUTRA_ABA, CHAVE_C0), true);
  const adocao = db.escritas[db.escritas.length - 1];
  assertEquals(adocao.gravou, true);
  assertEquals(adocao.filtros, [
    ["id", UUID],
    ["gateway_payment_id", SENTINELA_C0_DE_OUTRA_ABA],
  ]);
  assertEquals(db.escritas.length, 3, "reserva, gravação final que perdeu, adoção");
  assertEquals(mp.criacoes().length, 1);
});

Deno.test("cartão APROVADO perde a vaga para o sentinela de OUTRA tentativa (c1) -> a vaga NÃO é sobrescrita; 409 terminal cartaoEmAnalise + admin avisado", async () => {
  const db = bancoComEstado(pedidoDe());
  const mp = mercadoPago({
    criada: orderDeCartao("processed", "accredited"),
    aoCriar: () => {
      // Outra aba soltou a vaga (a tentativa avançou) e reservou a c1.
      db.linha.tentativas_de_pagamento = 1;
      db.linha.gateway_payment_id = SENTINELA_C1;
    },
  });

  const r = await pagarComCartao(db, mp);

  assertEquals(sentinelaDaChave(SENTINELA_C1, CHAVE_C0), false);
  assertEquals(r.status, 409);
  assertEquals(r.corpo.error, FRASE_PODE_TER_SIDO_COBRADO);
  assertEquals(r.corpo.terminal, true);
  assertEquals(r.corpo.cartaoEmAnalise, true);
  assertEquals(db.linha.gateway_payment_id, SENTINELA_C1, "o sentinela da c1 continua na vaga");
  assertEquals(db.linha.metodo_online, null);
  assertEquals(db.escritas.length, 2, "nenhuma tentativa de adoção sobre o sentinela de outra tentativa");
  assertEquals(r.avisosAoAdmin, [{ orderId: UUID, idOrderOrfa: ORDER_CARTAO }]);
  assertEquals(mp.cancelamentos().length, 0);
  assertEquals(mp.criacoes().length, 1);
});

// ── Lacuna 3: a releitura depois de liberar a vaga morta ────────────────────
//
// A vaga guardava um cartão RECUSADO (morto). Esta chamada libera; entre a
// liberação e a releitura, outra aba ocupa a vaga de novo. Cartão vivo ou
// sentinela: 409 com `cartaoEmAnalise`, e nada é cobrado. (A variante com PIX
// na vaga, sem a marca, já tem teste em `index_test.ts`; aqui fica como
// controle do mesmo dublê.)

const ocupantesDepoisDeLiberar = [
  { nome: "cartão de CRÉDITO de outra aba", vaga: OUTRA_COBRANCA, metodo: "credito", marca: true },
  { nome: "cartão de DÉBITO de outra aba", vaga: OUTRA_COBRANCA, metodo: "debito", marca: true },
  { nome: "SENTINELA de outra aba (c1)", vaga: SENTINELA_C1, metodo: null, marca: true },
  { nome: "PIX de outra aba (controle)", vaga: OUTRA_COBRANCA, metodo: "pix", marca: false },
];

for (const ocupante of ocupantesDepoisDeLiberar) {
  Deno.test(`liberou a vaga morta e a releitura acha ${ocupante.nome} -> 409 'já tem uma cobrança' ${ocupante.marca ? "COM" : "SEM"} cartaoEmAnalise, sem cobrar`, async () => {
    const db = bancoComEstado(
      pedidoDe({ gateway_payment_id: ORDER_MORTA_NA_VAGA, metodo_online: "credito" }),
      {
        aoLiberar: (l) => {
          l.gateway_payment_id = ocupante.vaga;
          l.metodo_online = ocupante.metodo;
        },
      },
    );
    const mp = mercadoPago({
      consultas: { [ORDER_MORTA_NA_VAGA]: orderDeCartao("failed", "failed", { id: ORDER_MORTA_NA_VAGA }) },
    });

    const r = await pagarComCartao(db, mp);

    assertEquals(r.status, 409);
    assertEquals(r.corpo.error, "Este pedido já tem uma cobrança gerada.");
    assertEquals(r.corpo.terminal, undefined);
    assertEquals(r.corpo.cartaoEmAnalise, ocupante.marca ? true : undefined);
    // Liberou a vaga morta pela string EXATA, e parou: nada criado no MP.
    assertEquals(db.rpcs.map((c) => c.args.p_gateway_payment_id), [ORDER_MORTA_NA_VAGA]);
    assertEquals(mp.criacoes().length, 0);
    assertEquals(db.escritas.length, 0);
    assertEquals(db.linha.gateway_payment_id, ocupante.vaga);
  });
}

// ── Lacuna 4: a releitura depois de perder a corrida FALHA ──────────────────

Deno.test("perdeu a corrida e a RELEITURA falha (erro de banco) -> cartaoEmAnalise mesmo com o desafio 3DS cancelado no MP", async () => {
  const db = bancoComEstado(pedidoDe(), { falharLeitura: COLUNAS_DA_RELEITURA_APOS_CORRIDA });
  const mp = mercadoPago({
    criada: desafio3ds(),
    aoCriar: () => {
      db.linha.gateway_payment_id = OUTRA_COBRANCA;
    },
    cancelamento: cancelada,
  });

  const r = await pagarComCartao(db, mp);

  assertEquals(db.leiturasFalhadas, [COLUNAS_DA_RELEITURA_APOS_CORRIDA]);
  assertEquals(r.status, 409);
  assertEquals(r.corpo.error, "Não foi possível confirmar a cobrança.");
  assertEquals(r.corpo.terminal, undefined);
  assertEquals(r.corpo.cartaoEmAnalise, true, "sem saber o que está na vaga, o front não oferece PIX nem cancelar");
  assertEquals(r.logs.some((l) => l.includes("falha ao reler o pedido depois de perder a corrida da vaga")), true);
  // O desafio desta chamada foi cancelado (nada capturado), sem acordar o admin.
  assertEquals(mp.cancelamentos().length, 1);
  assertEquals(r.avisosAoAdmin, []);
  // Releitura falhou: nada adotado por cima do que quer que esteja na vaga.
  assertEquals(db.escritas.length, 2);
  assertEquals(db.linha.gateway_payment_id, OUTRA_COBRANCA);
  assertEquals(mp.criacoes().length, 1);
});
