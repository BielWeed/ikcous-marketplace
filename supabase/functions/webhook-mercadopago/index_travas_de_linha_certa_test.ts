/**
 * Travas de "só atualiza a linha certa" do webhook-mercadopago (r122-a).
 *
 * Três UPDATEs condicionais do handler protegem dinheiro, e a suíte vizinha
 * (`index_test.ts`) nunca derrubava um mutante que apagasse o filtro:
 *
 *  1. A ADOÇÃO da vaga do cartão aprovado (`.eq("id", orderId)`): o dublê do
 *     vizinho só enxerga UM pedido, então apagar o filtro de id não mudava nada.
 *  2. O ramo SENTINELA do mesmo compare-and-set (`.eq("gateway_payment_id",
 *     <sentinela lido>)`): a única corrida testada partia de vaga NULL.
 *  3. O CAS da identidade tardia do estorno (`order_refunds`: `.eq status`,
 *     `.eq amount`, `.eq concluido_em`, `.is mp_chargeback_id null`): a única
 *     corrida testada mexia só em `mp_refund_id`.
 *
 * O dublê de banco daqui é PRÓPRIO (o `clienteFalso` do vizinho não é exportado
 * e o arquivo dele não foi tocado): guarda VÁRIAS linhas por tabela e HONRA
 * `.eq`/`.is` de verdade — um UPDATE sem filtro de id atinge todas as linhas
 * que sobrarem no WHERE, como o Postgres faria. De propósito ele é indulgente
 * com `.maybeSingle()` (o PostgREST real recusaria mais de uma linha): assim o
 * mutante cai na asserção de DADO ("o outro pedido foi alterado"), não num 500
 * que mascara o motivo.
 *
 * Nada aqui toca rede nem banco; dados todos inventados.
 */
import { assert, assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { handler } from "./index.ts";

const SEGREDO = "segredo-webhook-teste";
const UUID_PEDIDO = "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
const UUID_OUTRO_PEDIDO = "9c8d7e6f-5a4b-4c3d-8e2f-0a1b2c3d4e5f";
// `data.id` da notificação (forjável; a verdade vem da resposta do MP).
const ID_ORDER_TESTE = "ORDTST01KZZ4D94WC79335A68CZ5NZ7X";
// A order de cartão que o MP devolve como aprovada.
const ID_ORDER_CARTAO_MP = "ORDCARTAO1KZZ4D94WC79335A68CZ5N";
const VAGA_CONCORRENTE = "ORDTST01PIXCONCORRENTE000000";
const SENTINELA = `verificando:${UUID_PEDIDO}:c0`;
const TITULO_DUPLICADA = "Cobrança de cartão duplicada?";

function ambienteDoWebhook() {
  Deno.env.set("MP_WEBHOOK_SECRET", SEGREDO);
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
}

// ── assinatura (regra do manifesto do MP, escrita independente da produção) ──

async function assinar(dataId: string, ts: number, xRequestId: string): Promise<string> {
  const manifesto = `id:${dataId};request-id:${xRequestId};ts:${ts};`;
  const chave = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SEGREDO),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const assinado = await crypto.subtle.sign("HMAC", chave, new TextEncoder().encode(manifesto));
  return Array.from(new Uint8Array(assinado))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function notificacao(dataId: string, tipo: "order" | "payment"): Promise<Request> {
  const ts = Math.floor(Date.now() / 1000);
  const requestId = "req-r122a";
  const v1 = await assinar(dataId, ts, requestId);
  return new Request("http://localhost/webhook-mercadopago", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-signature": `ts=${ts},v1=${v1}`,
      "x-request-id": requestId,
    },
    body: JSON.stringify({ type: tipo, data: { id: dataId } }),
  });
}

function fetchConsulta(corpo: Record<string, unknown>) {
  return (_url: string, _init?: RequestInit) =>
    Promise.resolve(new Response(JSON.stringify(corpo), { status: 200 }));
}

// ── dublê de banco: várias linhas por tabela, filtros honrados de verdade ────

type Linha = Record<string, unknown>;
type Filtro = { tipo: "eq" | "is"; coluna: string; valor: unknown };
type TentativaDeUpdate = {
  tabela: string;
  valores: Linha;
  filtros: Filtro[];
  linhasAtingidas: number;
};

function casa(linha: Linha, filtros: Filtro[]): boolean {
  return filtros.every((f) => {
    const atual = Reflect.get(linha, f.coluna);
    return f.tipo === "is" ? (atual ?? null) === f.valor : atual === f.valor;
  });
}

function projetar(linha: Linha, colunas: string): Linha {
  if (colunas.trim() === "*") return { ...linha };
  const pedidas = new Set(colunas.split(",").map((c) => c.trim()).filter((c) => c.length > 0));
  return Object.fromEntries(Object.entries(linha).filter(([chave]) => pedidas.has(chave)));
}

function bancoFalso(opts: {
  pedidos: Linha[];
  ledger?: Linha[];
  resultadoConfirmar?: string;
  // Dispara logo DEPOIS da leitura única do pedido que decide a adoção
  // (a que pede `total_amount` e `gateway_payment_id`): a corrida.
  aposLeituraDoPedido?: (pedido: Linha) => void;
  // Dispara logo DEPOIS de cada leitura do ledger do pedido (com a fila viva).
  aposLerLedger?: (fila: Linha[]) => void;
}) {
  const ledger = opts.ledger ?? [];
  const tentativasDeUpdate: TentativaDeUpdate[] = [];
  const chamadasRpc: Array<{ nome: string; args: Record<string, unknown> }> = [];
  const avisos = new Map<string, { enviado: boolean }>();

  const tabelaDe = (nome: string): Linha[] => {
    if (nome === "marketplace_orders") return opts.pedidos;
    if (nome === "order_refunds") return ledger;
    throw new Error(`tabela inesperada nos testes: ${nome}`);
  };

  const rpc = (nome: string, args: Record<string, unknown>) => {
    chamadasRpc.push({ nome, args });
    if (nome === "confirmar_pagamento") {
      return Promise.resolve({ data: opts.resultadoConfirmar ?? "pago", error: null });
    }
    if (nome === "liberar_cobranca_do_pedido") return Promise.resolve({ data: true, error: null });
    if (nome === "registrar_estorno_externo_do_mp") {
      return Promise.resolve({
        data: { resultado: "inserido", aviso: null, valor_estornado: 60, em_voo: 0, disponivel: 0 },
        error: null,
      });
    }
    // Avisos ao lojista (uma vez por chave): espelho simples da reserva real.
    if (nome === "reservar_aviso_ao_lojista") {
      const chave = String(args.p_chave);
      const existente = avisos.get(chave);
      if (existente) {
        return Promise.resolve({ data: existente.enviado ? "enviado" : "em_envio", error: null });
      }
      avisos.set(chave, { enviado: false });
      return Promise.resolve({ data: "reservado", error: null });
    }
    if (nome === "confirmar_aviso_ao_lojista") {
      const existente = avisos.get(String(args.p_chave));
      if (existente) existente.enviado = true;
      return Promise.resolve({ data: Boolean(existente), error: null });
    }
    if (nome === "liberar_aviso_ao_lojista") {
      return Promise.resolve({ data: avisos.delete(String(args.p_chave)), error: null });
    }
    throw new Error(`rpc inesperada nos testes: ${nome}`);
  };

  const from = (tabela: string) => {
    if (tabela === "app_settings") {
      // Sem registro de credenciais do lojista: cai nas chaves da plataforma.
      return {
        select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
      };
    }
    const linhas = tabelaDe(tabela);
    return {
      select(colunas: string) {
        const filtros: Filtro[] = [];
        const cadeia = {
          eq(coluna: string, valor: unknown) {
            filtros.push({ tipo: "eq", coluna, valor });
            return cadeia;
          },
          is(coluna: string, valor: null) {
            filtros.push({ tipo: "is", coluna, valor });
            return cadeia;
          },
          maybeSingle() {
            const achada = linhas.find((l) => casa(l, filtros)) ?? null;
            const resultado = { data: achada ? projetar(achada, colunas) : null, error: null };
            // A corrida acontece DEPOIS de esta leitura devolver o retrato:
            // muda o que a PRÓXIMA leitura/escrita vê, nunca o que esta já viu.
            if (
              tabela === "marketplace_orders" && achada && opts.aposLeituraDoPedido &&
              colunas.includes("total_amount") && colunas.includes("gateway_payment_id")
            ) {
              opts.aposLeituraDoPedido(achada);
            }
            return Promise.resolve(resultado);
          },
          // `await` direto (lista), como o supabase-js permite.
          then(resolveu: (v: unknown) => unknown, rejeitou: (e: unknown) => unknown) {
            // Cópias rasas, como o PostgREST: mutar o retorno não muta a fila.
            const copia = linhas.filter((l) => casa(l, filtros)).map((l) => projetar(l, colunas));
            if (tabela === "order_refunds") opts.aposLerLedger?.(ledger);
            return Promise.resolve({ data: copia, error: null }).then(resolveu, rejeitou);
          },
        };
        return cadeia;
      },
      update(valores: Linha) {
        const filtros: Filtro[] = [];
        const cadeia = {
          eq(coluna: string, valor: unknown) {
            filtros.push({ tipo: "eq", coluna, valor });
            return cadeia;
          },
          is(coluna: string, valor: null) {
            filtros.push({ tipo: "is", coluna, valor });
            return cadeia;
          },
          select(_colunas: string) {
            return {
              maybeSingle() {
                // O UPDATE do Postgres atinge TODA linha que passa no WHERE.
                const alvos = linhas.filter((l) => casa(l, filtros));
                for (const alvo of alvos) Object.assign(alvo, valores);
                tentativasDeUpdate.push({
                  tabela,
                  valores,
                  filtros: [...filtros],
                  linhasAtingidas: alvos.length,
                });
                return Promise.resolve({ data: alvos[0] ? { id: alvos[0].id } : null, error: null });
              },
            };
          },
        };
        return cadeia;
      },
    };
  };

  return {
    supabase: { rpc, from },
    ledger,
    pedidos: opts.pedidos,
    tentativasDeUpdate,
    chamadasRpc,
    atingidas: (tabela: string) => tentativasDeUpdate.filter((t) => t.tabela === tabela && t.linhasAtingidas > 0),
    rpcsDe: (nome: string) => chamadasRpc.filter((c) => c.nome === nome),
  };
}

/** Roda `fn` com console mudo e devolve também o que foi logado (texto). */
async function capturandoLogs<T>(fn: () => Promise<T>): Promise<{ valor: T; logs: string[] }> {
  const logs: string[] = [];
  const reais = { log: console.log, warn: console.warn, error: console.error };
  const anota = (...a: unknown[]) => void logs.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "));
  console.log = anota;
  console.warn = anota;
  console.error = anota;
  try {
    return { valor: await fn(), logs };
  } finally {
    console.log = reais.log;
    console.warn = reais.warn;
    console.error = reais.error;
  }
}

// ═══ Cartão: a ADOÇÃO da vaga (index.ts, "Achado B2") ═════════════════════════

function orderDeCartaoAprovada(parcelas: number): Record<string, unknown> {
  return {
    id: ID_ORDER_CARTAO_MP,
    external_reference: UUID_PEDIDO,
    status: "processed",
    status_detail: "accredited",
    total_amount: "149.90",
    transactions: {
      payments: [{
        id: "PAY01CARTAO",
        status: "processed",
        status_detail: "accredited",
        payment_method: { id: "master", type: "credit_card", installments: parcelas },
      }],
    },
  };
}

function pedidoDeCartao(extra: Linha): Linha {
  return {
    id: UUID_PEDIDO,
    customer_name: "Cliente Fixture",
    total: 149.9,
    total_amount: null,
    gateway_payment_id: null,
    metodo_online: null,
    parcelas: null,
    updated_at: "2026-11-01T00:00:00.000Z",
    ...extra,
  };
}

async function entregarOrderDeCartao(banco: ReturnType<typeof bancoFalso>) {
  ambienteDoWebhook();
  const titulosAvisados: string[] = [];
  const { valor: resposta, logs } = await capturandoLogs(async () =>
    handler(await notificacao(ID_ORDER_TESTE, "order"), {
      supabase: banco.supabase,
      fetchImpl: fetchConsulta(orderDeCartaoAprovada(3)),
      enviarPush: async () => {},
      enviarComprovante: async () => {},
      enviarPushContado: ({ aviso }: { aviso: { title: string } }) => {
        titulosAvisados.push(aviso.title);
        return Promise.resolve(1);
      },
      dormir: () => Promise.resolve(),
    } as never)
  );
  return { resposta, logs, titulosAvisados };
}

Deno.test("adoção do cartão (vaga NULL): grava SÓ o pedido da notificação — outro pedido também com vaga vazia fica intacto", async () => {
  const outro = pedidoDeCartao({ id: UUID_OUTRO_PEDIDO });
  const banco = bancoFalso({ pedidos: [pedidoDeCartao({}), outro] });

  const { resposta } = await entregarOrderDeCartao(banco);

  const doPedido = banco.pedidos[0];
  assertEquals(resposta.status, 200);
  // O pedido da notificação foi adotado, com a forma lida da order reconsultada.
  assertEquals(doPedido.gateway_payment_id, ID_ORDER_CARTAO_MP);
  assertEquals(doPedido.metodo_online, "credito");
  assertEquals(doPedido.parcelas, 3);
  // A prova que importa: o OUTRO pedido (mesma vaga NULL, mesmo WHERE restante)
  // não recebeu a cobrança de cartão de um cliente que não é o dele.
  assertEquals(outro.gateway_payment_id, null, "outro pedido ganhou a cobrança de cartão alheia");
  assertEquals(outro.metodo_online, null);
  assertEquals(outro.parcelas, null);
  assertEquals(outro.updated_at, "2026-11-01T00:00:00.000Z");
  // E a chamada de update carrega o filtro de id do pedido certo + a vaga vazia.
  const aplicados = banco.atingidas("marketplace_orders");
  assertEquals(aplicados.length, 1);
  assertEquals(aplicados[0].linhasAtingidas, 1);
  assert(
    aplicados[0].filtros.some((f) => f.tipo === "eq" && f.coluna === "id" && f.valor === UUID_PEDIDO),
    "o UPDATE da adoção tem de filtrar por id do pedido",
  );
  assert(
    aplicados[0].filtros.some((f) => f.tipo === "is" && f.coluna === "gateway_payment_id" && f.valor === null),
    "o UPDATE da adoção tem de exigir a vaga vazia",
  );
  // Segue para a confirmação do pedido CERTO.
  assertEquals(banco.rpcsDe("confirmar_pagamento").length, 1);
  assertEquals(banco.rpcsDe("confirmar_pagamento")[0].args.p_order_id, UUID_PEDIDO);
});

// ═══ Cartão: o ramo SENTINELA do compare-and-set ══════════════════════════════

Deno.test("adoção sob SENTINELA, CONTROLE sem corrida: adota e o UPDATE exige o sentinela lido (e o id)", async () => {
  const outro = pedidoDeCartao({ id: UUID_OUTRO_PEDIDO, gateway_payment_id: SENTINELA });
  const banco = bancoFalso({ pedidos: [pedidoDeCartao({ gateway_payment_id: SENTINELA }), outro] });

  const { resposta, titulosAvisados } = await entregarOrderDeCartao(banco);

  assertEquals(resposta.status, 200);
  assertEquals(banco.pedidos[0].gateway_payment_id, ID_ORDER_CARTAO_MP);
  assertEquals(banco.pedidos[0].metodo_online, "credito");
  assertEquals(banco.pedidos[0].parcelas, 3);
  // Mesmo valor de sentinela em outra linha (inventado, o valor real leva o id
  // do pedido): o filtro de id continua segurando.
  assertEquals(outro.gateway_payment_id, SENTINELA, "outro pedido com a mesma vaga foi adotado junto");
  const aplicados = banco.atingidas("marketplace_orders");
  assertEquals(aplicados.length, 1);
  assert(aplicados[0].filtros.some((f) => f.tipo === "eq" && f.coluna === "id" && f.valor === UUID_PEDIDO));
  assert(
    aplicados[0].filtros.some((f) => f.tipo === "eq" && f.coluna === "gateway_payment_id" && f.valor === SENTINELA),
    "o ramo sentinela tem de exigir o sentinela que leu",
  );
  assertEquals(titulosAvisados.length, 0, "adoção que deu certo não avisa cobrança duplicada");
});

Deno.test("adoção sob SENTINELA, corrida: a vaga troca para uma cobrança REAL depois da leitura -> NÃO sobrescreve, 0 updates, avisa cobrança duplicada UMA vez", async () => {
  const banco = bancoFalso({
    pedidos: [pedidoDeCartao({ gateway_payment_id: SENTINELA })],
    resultadoConfirmar: "divergente",
    // A MESMA leitura que decide "vaga adotável" dispara a corrida: quando a
    // adoção tenta o UPDATE, a vaga já é uma cobrança de verdade.
    aposLeituraDoPedido: (p) => {
      p.gateway_payment_id = VAGA_CONCORRENTE;
    },
  });

  const { resposta, titulosAvisados, logs } = await entregarOrderDeCartao(banco);

  const doPedido = banco.pedidos[0];
  assertEquals(resposta.status, 200);
  // A prova que importa: a cobrança real que `criar-pagamento` gravou entre a
  // leitura e o UPDATE continua na vaga (sem o `.eq` do sentinela, o `.eq("id")`
  // sozinho casa e a adoção a SOBRESCREVE).
  assertEquals(doPedido.gateway_payment_id, VAGA_CONCORRENTE, "a adoção sobrescreveu a cobrança real");
  assertEquals(doPedido.metodo_online, null, "forma de pagamento gravada por cima da cobrança real");
  assertEquals(banco.atingidas("marketplace_orders").length, 0);
  // A tentativa existiu (a adoção foi tentada e não casou), com o sentinela no WHERE.
  const tentativas = banco.tentativasDeUpdate.filter((t) => t.tabela === "marketplace_orders");
  assertEquals(tentativas.length, 1);
  assert(
    tentativas[0].filtros.some((f) => f.tipo === "eq" && f.coluna === "gateway_payment_id" && f.valor === SENTINELA),
  );
  // Sem adoção, o ramo da corrida perdida relê a vaga e avisa o admin, uma vez.
  assertEquals(titulosAvisados, [TITULO_DUPLICADA]);
  assert(logs.some((l) => l.includes("cartao_divergente")), "falta o log cartao_divergente");
  assertEquals(banco.rpcsDe("reservar_aviso_ao_lojista").length, 1);
  assertEquals(banco.rpcsDe("confirmar_aviso_ao_lojista").length, 1);
  // E a RPC decide com o estado REAL, levando o id da order do MP.
  assertEquals(banco.rpcsDe("confirmar_pagamento").length, 1);
  assertEquals(banco.rpcsDe("confirmar_pagamento")[0].args.p_payment_id, ID_ORDER_CARTAO_MP);
});

// ═══ Estorno: o CAS da identidade tardia (index.ts, "adotada") ════════════════

const ID_REFUND = "refund-30";

function linhaLegada(extra: Linha = {}): Linha {
  return {
    id: "legado-30",
    order_id: UUID_PEDIDO,
    amount: 30,
    status: "concluido",
    solicitado_por: "lojista",
    mp_refund_id: null,
    mp_chargeback_id: null,
    tentativas: 1,
    mp_status: "approved",
    concluido_em: "2026-10-01T00:00:00.000Z",
    created_at: "2026-10-01T00:00:00.000Z",
    ...extra,
  };
}

/** Pedido PAGO de R$ 100, com R$ 30 já estornados (a linha legada concluída sem id). */
function pedidoJaEstornado(): Linha {
  return {
    id: UUID_PEDIDO,
    gateway_payment_id: "999",
    total: 100,
    valor_estornado: 30,
    payment_status: "pago",
    paid_at: "2026-10-01T00:00:00.000Z",
    status: "delivered",
  };
}

function cenarioDeEstorno(aposLerLedger?: (fila: Linha[]) => void) {
  const banco = bancoFalso({
    pedidos: [pedidoJaEstornado()],
    ledger: [linhaLegada()],
    aposLerLedger,
  });
  const entregar = async () => {
    ambienteDoWebhook();
    const { valor: resposta, logs } = await capturandoLogs(async () =>
      handler(await notificacao("999", "payment"), {
        supabase: banco.supabase,
        // O ID do refund aparece AGORA (antes o MP só mandava o acumulado): é a
        // adoção tardia da identidade na linha que o app já tinha concluído.
        fetchImpl: fetchConsulta({
          id: 999,
          external_reference: UUID_PEDIDO,
          status: "approved",
          status_detail: "partially_refunded",
          transaction_amount: 100,
          transaction_amount_refunded: 30,
          refunds: [{ id: ID_REFUND, amount: 30, status: "approved" }],
        }),
        enviarPushContado: () => Promise.resolve(1),
        dormir: () => Promise.resolve(),
      } as never)
    );
    return { resposta, logs };
  };
  return { banco, entregar, linha: banco.ledger[0] };
}

Deno.test("identidade tardia do estorno, CONTROLE sem corrida: adota o id na linha antiga, sem RPC externa, e o UPDATE leva todas as guardas", async () => {
  const c = cenarioDeEstorno();

  const { resposta } = await c.entregar();

  assertEquals(resposta.status, 200);
  assertEquals(c.linha.mp_refund_id, ID_REFUND);
  assertEquals(c.banco.rpcsDe("registrar_estorno_externo_do_mp").length, 0);
  assertEquals(c.banco.pedidos[0].valor_estornado, 30);
  const adocao = c.banco.atingidas("order_refunds");
  assertEquals(adocao.length, 1);
  assertEquals(adocao[0].valores, { mp_refund_id: ID_REFUND });
  const tem = (tipo: string, coluna: string, valor: unknown) =>
    adocao[0].filtros.some((f) => f.tipo === tipo && f.coluna === coluna && f.valor === valor);
  assert(tem("eq", "id", "legado-30"));
  assert(tem("eq", "order_id", UUID_PEDIDO));
  assert(tem("eq", "status", "concluido"));
  assert(tem("eq", "amount", 30));
  assert(tem("eq", "concluido_em", "2026-10-01T00:00:00.000Z"));
  assert(tem("is", "mp_refund_id", null));
  assert(tem("is", "mp_chargeback_id", null));
});

// Cada corrida muda UMA coluna da linha DEPOIS da leitura do ledger e ANTES do
// UPDATE da adoção. O CAS tem de enxergar a mudança: 500 (o MP reenvia), a linha
// sem identidade, nenhuma RPC externa e nenhum dinheiro a mais.
for (
  const caso of [
    {
      nome: "uma contestação (mp_chargeback_id) cai na linha",
      mutar: (l: Linha) => {
        l.mp_chargeback_id = "CBK-concorrente";
      },
      guarda: "is mp_chargeback_id null",
    },
    {
      nome: "a conclusão da linha é refeita (concluido_em muda)",
      mutar: (l: Linha) => {
        l.concluido_em = "2026-10-02T00:00:00.000Z";
      },
      guarda: "eq concluido_em",
    },
    {
      nome: "a linha deixa de estar concluída (status muda)",
      mutar: (l: Linha) => {
        l.status = "em_processamento";
      },
      guarda: "eq status",
    },
    {
      nome: "o valor da linha muda (amount)",
      mutar: (l: Linha) => {
        l.amount = 31;
      },
      guarda: "eq amount",
    },
  ]
) {
  Deno.test(`identidade tardia do estorno — corrida: ${caso.nome} depois da leitura -> 500, id NÃO gravado, 0 RPC externa, valor_estornado intacto [guarda: ${caso.guarda}]`, async () => {
    let disputar = true;
    const c = cenarioDeEstorno((fila) => {
      if (!disputar) return;
      disputar = false;
      caso.mutar(fila[0]);
    });

    const { resposta } = await c.entregar();

    // A linha NÃO recebeu a identidade do refund regular (sem a guarda, o UPDATE
    // casa e carimba `refund-30` numa linha que já não é a que foi lida).
    assertEquals(c.linha.mp_refund_id, null, `UPDATE gravou o id apesar da corrida (${caso.guarda})`);
    assertEquals(resposta.status, 500, "a adoção tem de falhar e o MP reenviar");
    assertEquals(c.banco.rpcsDe("registrar_estorno_externo_do_mp").length, 0, "0 chamadas externas ao MP");
    assertEquals(c.banco.rpcsDe("concluir_estorno").length, 0);
    assertEquals(c.banco.pedidos[0].valor_estornado, 30, "o dinheiro estornado não pode mudar");
    // O UPDATE foi TENTADO (e não casou): a falha vem do WHERE, não de curto-circuito.
    const tentativas = c.banco.tentativasDeUpdate.filter((t) => t.tabela === "order_refunds");
    assertEquals(tentativas.length, 1);
    assertEquals(tentativas[0].linhasAtingidas, 0);
  });
}

Deno.test("identidade tardia do estorno — contestação caiu na linha: na REENTREGA a linha contestada não vira candidata (refund regular vai pela RPC externa)", async () => {
  let disputar = true;
  const c = cenarioDeEstorno((fila) => {
    if (!disputar) return;
    disputar = false;
    fila[0].mp_chargeback_id = "CBK-concorrente";
  });

  assertEquals((await c.entregar()).resposta.status, 500);
  assertEquals(c.banco.rpcsDe("registrar_estorno_externo_do_mp").length, 0);

  // Reentrega do MP: agora a linha já nasce contestada na leitura.
  const reentrega = await c.entregar();
  assertEquals(reentrega.resposta.status, 200);
  assertEquals(c.linha.mp_refund_id, null, "a linha de contestação nunca recebe a identidade do refund");
  assertEquals(c.linha.mp_chargeback_id, "CBK-concorrente");
  const externas = c.banco.rpcsDe("registrar_estorno_externo_do_mp");
  assertEquals(externas.length, 1);
  assertEquals(externas[0].args.p_mp_refund_id, ID_REFUND);
  // Nenhum UPDATE novo na linha: só a tentativa que falhou na primeira entrega.
  assertEquals(c.banco.tentativasDeUpdate.filter((t) => t.tabela === "order_refunds").length, 1);
});
