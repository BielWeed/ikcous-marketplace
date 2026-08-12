// @ts-nocheck
/**
 * Testes da criar-pagamento (CHECKOUT-010, #109).
 *
 * Prova a parte que decide SE pode cobrar e DE QUEM — que é onde erro custa
 * caro: cobrar duas vezes o mesmo pedido, cobrar pedido já expirado, ou deixar
 * um estranho disparar cobrança do pedido de outra pessoa.
 *
 * A chamada ao MP em si já é coberta pelos testes de _shared/mercadopago.ts.
 */
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  descricaoDoPedido,
  donoConfere,
  handler,
  pareceUuid,
  podeCobrar,
  subDoToken,
} from "./index.ts";

const UUID = "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
const AGORA = new Date("2026-08-06T12:00:00.000Z");

// Payload {"sub":"3f2a1b8c-...","nome":"José Ítalo Ução","cidade":"Zoé Núñez"}
// codificado em base64url. Escolhido porque nomes brasileiros acentuados
// empurram bytes >= 0x80 para os índices 62/63 do alfabeto base64, que em
// base64url viram '-' e '_' — o caractere que o `atob` puro rejeita. Gerado e
// conferido com round-trip por script, não escrito à mão.
const PAYLOAD_COM_TRACO_E_SUBLINHADO_B64URL =
  "eyJzdWIiOiIzZjJhMWI4Yy00ZDVlLTRmNjAtOWE3Yi0xYzJkM2U0ZjVhNmIiLCJub21lIjoiSm9z6SDNdGFsbyBV5-NvIiwiY2lkYWRlIjoiWm_pIE768WV6In0";

/**
 * Monta um JWT falso só com o campo que `subDoToken` lê. Não assina — a
 * function também não valida assinatura (o gateway do Supabase já validou).
 */
function montarToken(sub: string | null): string {
  const payload = sub === null ? {} : { sub };
  const base64 = btoa(JSON.stringify(payload))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `cabecalho.${base64}.assinatura`;
}

/**
 * Cliente Supabase falso que reproduz só as duas cadeias de chamada que
 * `index.ts` realmente usa:
 *   - leitura do pedido:        .from().select().eq().maybeSingle()
 *   - gravação da cobrança:     .from().update().eq().eq().is().select().maybeSingle()
 * A primeira `select()` devolve `pedido`; qualquer `select()` seguinte (a
 * releitura pós-UPDATE-falho) devolve `releitura` — se não for informado, cai
 * de volta em `pedido`, o que já basta para os testes que não mexem no
 * caminho de corrida.
 */
function clienteFalso(opts: {
  pedido: Record<string, unknown> | null;
  gravado: Record<string, unknown> | null;
  releitura?: Record<string, unknown> | null;
  // Simula falha de LEITURA (statement timeout, pool esgotado, fetch
  // caindo) na PRIMEIRA select — a releitura pós-UPDATE-falho nunca usa
  // isto. Só entra em `error`; `data` some junto, como o postgrest-js real.
  erroLeitura?: Record<string, unknown> | null;
  // Conta chamadas a .update() e registra os filtros (par coluna/valor) na
  // ORDEM em que o encadeamento real os aplica: .eq("id",...),
  // .eq("payment_status",...), .is("gateway_payment_id",...). Sem registrar
  // o CONTEÚDO — só manter a forma do encadeamento — arrancar uma condição
  // (ex.: trocar "aguardando" por "pago") deixa a suíte verde, porque nada
  // além do nome do método (.eq/.is) estava sendo provado.
  registro?: { chamadasUpdate: number; filtrosUpdate?: Array<[string, unknown]> };
}) {
  let chamadasSelect = 0;
  return {
    from(_tabela: string) {
      return {
        select(_cols: string) {
          chamadasSelect++;
          const primeiraLeitura = chamadasSelect === 1;
          const erro = primeiraLeitura ? opts.erroLeitura ?? null : null;
          const dados = erro
            ? null
            : primeiraLeitura
              ? opts.pedido
              : opts.releitura ?? opts.pedido;
          return {
            eq(_col: string, _val: unknown) {
              return { maybeSingle: async () => ({ data: dados, error: erro }) };
            },
          };
        },
        update(_valores: Record<string, unknown>) {
          if (opts.registro) {
            opts.registro.chamadasUpdate++;
            opts.registro.filtrosUpdate = [];
          }
          const registrarFiltro = (coluna: string, valor: unknown) => {
            opts.registro?.filtrosUpdate?.push([coluna, valor]);
          };
          return {
            eq(c1: string, v1: unknown) {
              registrarFiltro(c1, v1);
              return {
                eq(c2: string, v2: unknown) {
                  registrarFiltro(c2, v2);
                  return {
                    is(c3: string, v3: unknown) {
                      registrarFiltro(c3, v3);
                      return {
                        select(_cols: string) {
                          return {
                            maybeSingle: async () => ({ data: opts.gravado, error: null }),
                          };
                        },
                      };
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  };
}

/** `fetch` falso que nunca toca rede: devolve um pagamento 2xx válido e
 * guarda o corpo que a function mandou, para o teste conferir
 * `external_reference` sem depender dos testes da Task 1. */
function fetchFalsoMP(capturado: { corpo?: Record<string, unknown> }) {
  return async (_url: string, init?: RequestInit) => {
    capturado.corpo = JSON.parse(String(init?.body ?? "{}"));
    return new Response(JSON.stringify({ id: 999, status: "pending" }), { status: 201 });
  };
}

function pedidoBase(overrides: Record<string, unknown> = {}) {
  return {
    id: UUID,
    user_id: null,
    total: 100,
    payment_status: "aguardando",
    expires_at: "2099-01-01T00:00:00.000Z",
    gateway_payment_id: null,
    customer_data: { email: "cliente@exemplo.com" },
    ...overrides,
  };
}

function requisicao(corpo: Record<string, unknown>, authorization?: string): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authorization) headers.Authorization = authorization;
  return new Request("http://localhost/criar-pagamento", {
    method: "POST",
    headers,
    body: JSON.stringify(corpo),
  });
}

Deno.test("aceita UUID e recusa o que não é", () => {
  assertEquals(pareceUuid(UUID), true);
  assertEquals(pareceUuid(UUID.toUpperCase()), true);
  for (const ruim of ["", null, undefined, 42, "1; DROP TABLE marketplace_orders", `${UUID} `]) {
    assertEquals(pareceUuid(ruim), false, `deveria recusar: ${String(ruim)}`);
  }
});

Deno.test("podeCobrar cria quando o pedido está aguardando, no prazo, e sem cobrança", () => {
  const r = podeCobrar(
    {
      payment_status: "aguardando",
      expires_at: "2026-08-06T12:20:00.000Z",
      gateway_payment_id: null,
    },
    AGORA,
  );
  assertEquals(r.acao, "criar");
});

Deno.test("podeCobrar reconsulta quando o pedido já tem cobrança, em vez de recusar", () => {
  // Rodada 2: o QR do PIX só existe na resposta da CRIAÇÃO. O navegador
  // mobile descarta a aba enquanto o cliente paga pelo app do banco; ao
  // voltar, a tela remonta e chamava esta function de novo — recusar aqui
  // (como a rodada 1 fazia) matava um pedido que ainda dava para pagar. Com
  // 63 dos 64 pedidos da loja em PIX, esse é o caminho principal.
  const r = podeCobrar(
    {
      payment_status: "aguardando",
      expires_at: "2026-08-06T12:20:00.000Z",
      gateway_payment_id: "1234567890",
    },
    AGORA,
  );
  assertEquals(r.acao, "reconsultar");
});

Deno.test("podeCobrar recusa pedido expirado mesmo que já tenha cobrança — a ordem importa", () => {
  // Se a checagem de gateway_payment_id viesse ANTES da de prazo, um pedido
  // expirado com cobrança reconsultaria em vez de recusar.
  const r = podeCobrar(
    {
      payment_status: "aguardando",
      expires_at: "2026-08-06T11:59:00.000Z",
      gateway_payment_id: "1234567890",
    },
    AGORA,
  );
  assertEquals(r.acao, "recusar");
});

Deno.test("podeCobrar recusa pedido fora do prazo", () => {
  const r = podeCobrar(
    {
      payment_status: "aguardando",
      expires_at: "2026-08-06T11:59:00.000Z",
      gateway_payment_id: null,
    },
    AGORA,
  );
  assertEquals(r.acao, "recusar");
});

Deno.test("podeCobrar recusa qualquer payment_status que não seja aguardando", () => {
  for (const st of ["pago", "recusado", "expirado", "estornado", "pago_apos_expirar", null]) {
    const r = podeCobrar(
      { payment_status: st, expires_at: "2026-08-06T12:20:00.000Z", gateway_payment_id: null },
      AGORA,
    );
    assertEquals(r.acao, "recusar", `deveria recusar payment_status=${String(st)}`);
  }
});

Deno.test("podeCobrar recusa pedido sem prazo carimbado", () => {
  // Pedido criado pela v23 (flag desligada) não tem expires_at. Cobrar um
  // desses criaria cobrança que a expiração nunca varre.
  const r = podeCobrar(
    { payment_status: "aguardando", expires_at: null, gateway_payment_id: null },
    AGORA,
  );
  assertEquals(r.acao, "recusar");
});

Deno.test("donoConfere: pedido de usuário logado exige o mesmo usuário", () => {
  assertEquals(donoConfere({ user_id: UUID }, UUID), true);
  assertEquals(donoConfere({ user_id: UUID }, "outro-sub"), false);
  assertEquals(donoConfere({ user_id: UUID }, null), false);
});

Deno.test("donoConfere: pedido de convidado passa sem sessão", () => {
  // Checkout de convidado é suportado (v24 grava user_id NULL). A proteção
  // dele não é a sessão — é a janela de 30 min do expires_at, checada em
  // podeCobrar.
  assertEquals(donoConfere({ user_id: null }, null), true);
  assertEquals(donoConfere({ user_id: null }, UUID), true);
});

Deno.test("descricaoDoPedido não vaza o id inteiro", () => {
  const d = descricaoDoPedido(UUID);
  assertEquals(d.includes(UUID), false);
  assertEquals(d.includes("3f2a1b8c"), true);
});

// --- subDoToken: JWT usa base64url, não base64 puro -------------------

Deno.test("subDoToken decodifica payload em base64url, com '-' e '_' no meio", () => {
  // Achado da revisão: 0,18% dos tokens do GoTrue com nome acentuado batem
  // '-'/'_' na posição certa para o `atob` puro rejeitar com DOMException.
  const token = `cabecalho.${PAYLOAD_COM_TRACO_E_SUBLINHADO_B64URL}.assinatura`;
  assertEquals(subDoToken(token), UUID);
});

Deno.test("subDoToken: lixo devolve null, não estoura", () => {
  assertEquals(subDoToken("lixo-nao-jwt"), null);
  assertEquals(subDoToken(null), null);
  assertEquals(subDoToken(""), null);
});

// --- handler: a fiação onde autorização e dinheiro de fato acontecem --

Deno.test("handler: pedido de outro usuário devolve 404, não o pedido de ninguém", async () => {
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const donoDoPedido = "9f9f9f9f-1111-2222-3333-444455556666";
  const pedido = pedidoBase({ user_id: donoDoPedido });
  const supabase = clienteFalso({ pedido, gravado: null });

  const resposta = await handler(
    requisicao({ orderId: UUID, metodo: "pix" }, montarToken("outro-sub-qualquer")),
    { supabase },
  );
  const corpo = await resposta.json();

  assertEquals(resposta.status, 404);
  // CHECKOUT-050 (#194): permanente PARA ESTE PEDIDO — se a sessão do
  // cliente cair no meio dos 30 minutos de reserva, `subDoToken` volta a
  // devolver `null` e o mesmo 404 se repete para sempre.
  assertEquals(corpo.terminal, true);
});

Deno.test("handler: falha de LEITURA do pedido (erro do banco) não é terminal — não confunde com 'pedido não encontrado'", async () => {
  // Achado da revisão (CHECKOUT-050, #194): `error` truthy é sempre falha
  // real de infraestrutura (statement timeout, pool esgotado, fetch caindo)
  // — zero linhas devolve `{data: null, error: null}` no postgrest-js
  // instalado. Antes deste teste, `clienteFalso` sempre devolvia
  // `error: null`, e nenhum teste alcançava este caminho: um soluço de
  // banco de 2s recebia o MESMO 404 terminal de "pedido não encontrado",
  // sem "Tentar de novo", e o pedido morria no pg_cron 20 minutos depois.
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const supabase = clienteFalso({
    pedido: null,
    gravado: null,
    erroLeitura: { message: "canceling statement due to statement timeout" },
  });

  const resposta = await handler(requisicao({ orderId: UUID, metodo: "pix" }), {
    supabase,
  });
  const corpo = await resposta.json();

  // Status próprio, mensagem própria — não reaproveita "Pedido não
  // encontrado.": essa string está na lista de recuperáveis indexada por
  // mensagem, e é usada pelos dois 404 abaixo, que PRECISAM continuar
  // terminais.
  assertEquals(resposta.status, 503);
  assertEquals(corpo.error, "Não foi possível verificar o pedido.");
  assertEquals(corpo.terminal, undefined);
});

Deno.test("handler: pedido inexistente devolve 404 terminal, não erro genérico", async () => {
  // Contraste com o teste acima: aqui o pedido nem existe na tabela (`select`
  // devolve null), então o 404 nasce ANTES da checagem de dono — outro ponto
  // de retorno do MESMO texto "Pedido não encontrado.", e também permanente:
  // nenhum retry inventa um pedido que não existe.
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const supabase = clienteFalso({ pedido: null, gravado: null });

  const resposta = await handler(requisicao({ orderId: UUID, metodo: "pix" }), {
    supabase,
  });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 404);
  assertEquals(corpo.error, "Pedido não encontrado.");
  assertEquals(corpo.terminal, true);
});

Deno.test("handler: pedido de convidado passa sem sessão e devolve 200", async () => {
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const pedido = pedidoBase();
  const supabase = clienteFalso({ pedido, gravado: { id: UUID } });
  const fetchImpl = fetchFalsoMP({});

  const resposta = await handler(requisicao({ orderId: UUID, metodo: "pix" }), {
    supabase,
    fetchImpl,
  });

  assertEquals(resposta.status, 200);
});

Deno.test("handler: o corpo enviado ao Mercado Pago leva external_reference", async () => {
  // Garantido pelo caminho REAL do handler, não só pelos testes da Task 1.
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const pedido = pedidoBase();
  const supabase = clienteFalso({ pedido, gravado: { id: UUID } });
  const capturado: { corpo?: Record<string, unknown> } = {};
  const fetchImpl = fetchFalsoMP(capturado);

  await handler(requisicao({ orderId: UUID, metodo: "pix" }), { supabase, fetchImpl });

  assertEquals(capturado.corpo?.external_reference, UUID);
});

Deno.test("handler: PIX leva o documento do pagador quando o front manda — A-2 da revisão final", async () => {
  // O documento atravessava front → criar-pagamento e sumia na chamada a
  // montarCorpoPix (a que faltava o parâmetro). Este teste prova a fiação
  // INTEIRA, não só montarCorpoPix isolado (coberto em mercadopago_test.ts).
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const pedido = pedidoBase();
  const supabase = clienteFalso({ pedido, gravado: { id: UUID } });
  const capturado: { corpo?: Record<string, unknown> } = {};
  const fetchImpl = fetchFalsoMP(capturado);

  await handler(
    requisicao({
      orderId: UUID,
      metodo: "pix",
      documento: { type: "CPF", number: "12345678909" },
    }),
    { supabase, fetchImpl },
  );

  assertEquals(
    (capturado.corpo?.payer as Record<string, unknown>)?.identification,
    { type: "CPF", number: "12345678909" },
  );
});

Deno.test("handler: o corpo enviado ao MP leva o notification_url MONTADO — URL inteira", async () => {
  // Achado da revisão: os testes de mercadopago_test.ts provam montarCorpoPix
  // como função pura (recebem a URL pronta), o que não prova que o handler
  // MONTA e LIGA essa URL. Sem este teste, apagar a linha de notificationUrl
  // em index.ts (ou trocar o caminho) deixava a suíte inteira verde — o MP
  // fica sem para onde notificar, e o pedido pago some no 'aguardando' até o
  // pg_cron expirar (mesmo padrão do achado A-2, já fechado para o documento).
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  Deno.env.set("SUPABASE_URL", "https://xyz.supabase.co");
  const pedido = pedidoBase();
  const supabase = clienteFalso({ pedido, gravado: { id: UUID } });
  const capturado: { corpo?: Record<string, unknown> } = {};
  const fetchImpl = fetchFalsoMP(capturado);

  await handler(requisicao({ orderId: UUID, metodo: "pix" }), { supabase, fetchImpl });

  assertEquals(
    capturado.corpo?.notification_url,
    "https://xyz.supabase.co/functions/v1/webhook-mercadopago",
  );
});

Deno.test("handler: pedido expirado pelo pg_cron no meio da corrida NÃO devolve 200, e a mensagem é a de prazo", async () => {
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const pedido = pedidoBase();
  // A releitura pós-UPDATE-falho mostra o que o pg_cron já gravou: 'expirado'.
  const releitura = { payment_status: "expirado", gateway_payment_id: null };
  const supabase = clienteFalso({ pedido, gravado: null, releitura });
  const fetchImpl = fetchFalsoMP({});

  const resposta = await handler(requisicao({ orderId: UUID, metodo: "pix" }), {
    supabase,
    fetchImpl,
  });
  const corpo = await resposta.json();

  assertEquals(resposta.status !== 200, true);
  assertEquals(corpo.error, "O prazo para pagar este pedido acabou.");
  // Correção pós-revisão (mensagem do coordenador): esta recusa é a MESMA
  // categoria dos três ramos de podeCobrar — o pedido já está 'expirado',
  // qualquer nova tentativa cai no ramo 1 de podeCobrar e é recusada para
  // sempre. O escopo original ("só os três ramos de podeCobrar") deixava
  // este ramo de fora por imprecisão do brief, não por ele ser diferente.
  assertEquals(corpo.terminal, true);
});

// Par que impede alguém de marcar o BLOCO INTEIRO (releitura pós-UPDATE-
// falho) como terminal de uma vez: dos três ramos deste bloco, só o
// 'expirado' é definitivo — os outros dois continuam recuperáveis, e por
// isso SEM o campo `terminal`.
Deno.test("handler: corrida sem causa gravada (releitura não explica) devolve terminal ausente — continua recuperável", async () => {
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const pedido = pedidoBase();
  // Nem 'expirado', nem gateway_payment_id gravado: a releitura não explica
  // por que o UPDATE não achou linha (ex.: ela também falhou).
  const releitura = { payment_status: "aguardando", gateway_payment_id: null };
  const supabase = clienteFalso({ pedido, gravado: null, releitura });
  const fetchImpl = fetchFalsoMP({});

  const resposta = await handler(requisicao({ orderId: UUID, metodo: "pix" }), {
    supabase,
    fetchImpl,
  });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 409);
  assertEquals(corpo.error, "Não foi possível confirmar a cobrança.");
  assertEquals(corpo.terminal, undefined);
});

Deno.test("handler: duas chamadas concorrentes — a que perde o UPDATE NÃO devolve 200, e a mensagem é a de cobrança já gerada", async () => {
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const pedido = pedidoBase();
  // A releitura mostra que a OUTRA chamada já gravou gateway_payment_id
  // enquanto esta ainda estava esperando o Mercado Pago responder.
  const releitura = { payment_status: "aguardando", gateway_payment_id: "outro-pagamento" };
  const supabase = clienteFalso({ pedido, gravado: null, releitura });
  const fetchImpl = fetchFalsoMP({});

  const resposta = await handler(requisicao({ orderId: UUID, metodo: "pix" }), {
    supabase,
    fetchImpl,
  });
  const corpo = await resposta.json();

  assertEquals(resposta.status !== 200, true);
  assertEquals(corpo.error, "Este pedido já tem uma cobrança gerada.");
  // CHECKOUT-050: esta recusa NÃO é dos três ramos de podeCobrar — é a
  // corrida do UPDATE, e converge sozinha pelo caminho `reconsultar` na
  // PRÓXIMA chamada (o pedido segue 'aguardando', só ganhou
  // gateway_payment_id enquanto esta chamada esperava o MP responder).
  // Continua recuperável: não pode carregar o campo de recusa definitiva.
  assertEquals(corpo.terminal, undefined);
});

// --- handler: CHECKOUT-050 (#194) — os três ramos de podeCobrar/"recusar"
// carregam um campo que diz que a recusa é DEFINITIVA para este pedido,
// além da mensagem em `error`. Achado da revisão: o front classificava
// "terminal" comparando a MENSAGEM por igualdade exata (só a de prazo
// vencido) — assim que o pg_cron marca o pedido 'expirado' (a cada 5 min),
// a mesma reserva vencida passa a cair no ramo 1 (payment_status !==
// 'aguardando'), com uma mensagem que o front nunca soube reconhecer, e
// ganhava "Tentar de novo" para sempre. A categoria agora é DADO, não texto
// — e nasce aqui, no único ponto que os três ramos de recusar atravessam.
Deno.test("handler: recusa por payment_status diferente de 'aguardando' devolve terminal:true", async () => {
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  // É exatamente o estado que o pg_cron grava depois de expirar um pedido —
  // o caso que motivou o achado.
  const pedido = pedidoBase({ payment_status: "expirado" });
  const supabase = clienteFalso({ pedido, gravado: null });

  const resposta = await handler(requisicao({ orderId: UUID, metodo: "pix" }), {
    supabase,
  });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 409);
  assertEquals(corpo.error, "Este pedido não está aguardando pagamento.");
  assertEquals(corpo.terminal, true);
});

Deno.test("handler: recusa por pedido sem prazo carimbado (expires_at null) devolve terminal:true", async () => {
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const pedido = pedidoBase({ expires_at: null });
  const supabase = clienteFalso({ pedido, gravado: null });

  const resposta = await handler(requisicao({ orderId: UUID, metodo: "pix" }), {
    supabase,
  });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 409);
  assertEquals(corpo.error, "Este pedido não tem prazo de pagamento.");
  assertEquals(corpo.terminal, true);
});

Deno.test("handler: recusa por prazo vencido (expires_at no passado) devolve terminal:true", async () => {
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const pedido = pedidoBase({ expires_at: "2000-01-01T00:00:00.000Z" });
  const supabase = clienteFalso({ pedido, gravado: null });

  const resposta = await handler(requisicao({ orderId: UUID, metodo: "pix" }), {
    supabase,
  });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 409);
  assertEquals(corpo.error, "O prazo para pagar este pedido acabou.");
  assertEquals(corpo.terminal, true);
});

// --- handler: rodada 2 — reconsultar em vez de recusar quando já tem cobrança

/** `fetch` falso da reconsulta: devolve exatamente o corpo que o teste
 * passar, e GUARDA método e corpo da requisição que recebeu — mesmo padrão
 * de `mercadopago_test.ts:277-281` uma camada abaixo. Sem isso, trocar
 * `consultarPagamento` por `criarPagamento` dentro do ramo `reconsultar`
 * (um POST de verdade, com corpo, no Mercado Pago) passava batido: o
 * cliente falso aqui não olhava método nem body, só o que a resposta
 * continha. */
function fetchFalsoConsulta(
  corpoDaResposta: Record<string, unknown>,
  capturado?: { method?: string; body?: BodyInit | null | undefined },
) {
  return async (_url: string, init?: RequestInit) => {
    if (capturado) {
      capturado.method = init?.method;
      capturado.body = init?.body;
    }
    return new Response(JSON.stringify(corpoDaResposta), { status: 200 });
  };
}

Deno.test("handler: pedido com cobrança existente reconsulta no MP, devolve o MESMO QR, e NÃO faz UPDATE", async () => {
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const pedido = pedidoBase({ gateway_payment_id: "789" });
  const registro = { chamadasUpdate: 0 };
  const supabase = clienteFalso({ pedido, gravado: { id: UUID }, registro });
  const capturado: { method?: string; body?: BodyInit | null | undefined } = {};
  const fetchImpl = fetchFalsoConsulta(
    {
      id: 789,
      status: "pending",
      point_of_interaction: { transaction_data: { qr_code: "QRCODE-DA-RECONSULTA" } },
    },
    capturado,
  );

  const resposta = await handler(requisicao({ orderId: UUID, metodo: "pix" }), {
    supabase,
    fetchImpl,
  });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  assertEquals(corpo.paymentId, "789");
  assertEquals(corpo.qrCode, "QRCODE-DA-RECONSULTA");
  assertEquals(registro.chamadasUpdate, 0);
  // A metade que faltava provar: reconsulta é GET, sem body. Trocar
  // consultarPagamento por criarPagamento aqui viraria um POST com corpo —
  // e cada F5 do cliente geraria uma tentativa de cobrança nova no MP.
  assertEquals(capturado.method, "GET");
  assertEquals(capturado.body, undefined);
});

Deno.test("handler: pedido sem cobrança existente cria uma nova e grava gateway_payment_id", async () => {
  // Contraste com o teste acima: prova que o ramo "criar" continua fazendo
  // UPDATE — se um bug fizesse TODO pedido cair no ramo "reconsultar", este
  // teste (chamadasUpdate === 1) cairia, mesmo que o teste de status 200
  // sozinho não pegasse isso.
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const pedido = pedidoBase();
  const registro: { chamadasUpdate: number; filtrosUpdate?: Array<[string, unknown]> } = {
    chamadasUpdate: 0,
  };
  const supabase = clienteFalso({ pedido, gravado: { id: UUID }, registro });
  const fetchImpl = fetchFalsoMP({});

  const resposta = await handler(requisicao({ orderId: UUID, metodo: "pix" }), {
    supabase,
    fetchImpl,
  });

  assertEquals(resposta.status, 200);
  assertEquals(registro.chamadasUpdate, 1);
  // Não basta encadear .eq().eq().is() — o CONTEÚDO é o que impede o UPDATE
  // de casar a linha errada (ou nenhuma). Sem esta asserção, trocar
  // "aguardando" por "pago", ou "gateway_payment_id" por outra coluna,
  // deixava a suíte verde: a mutação só quebra o encadeamento se o nome do
  // MÉTODO sumir (.is deixa de existir), não se o valor mudar.
  assertEquals(registro.filtrosUpdate, [
    ["id", UUID],
    ["payment_status", "aguardando"],
    ["gateway_payment_id", null],
  ]);
});

Deno.test("handler: pedido expirado com cobrança existente recusa, não reconsulta", async () => {
  // A ordem de podeCobrar importa: prazo vencido é checado ANTES de
  // gateway_payment_id, então isto tem que recusar, não chamar o MP.
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const pedido = pedidoBase({
    gateway_payment_id: "789",
    expires_at: "2000-01-01T00:00:00.000Z",
  });
  const registro = { chamadasUpdate: 0 };
  const supabase = clienteFalso({ pedido, gravado: null, registro });
  let chamouFetch = false;
  const fetchImpl = async (_url: string, _init?: RequestInit) => {
    chamouFetch = true;
    return new Response(JSON.stringify({ id: 789, status: "pending" }), { status: 200 });
  };

  const resposta = await handler(requisicao({ orderId: UUID, metodo: "pix" }), {
    supabase,
    fetchImpl,
  });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 409);
  assertEquals(corpo.error, "O prazo para pagar este pedido acabou.");
  assertEquals(chamouFetch, false);
  assertEquals(registro.chamadasUpdate, 0);
});

// --- handler: Task 7 da Fase 3 — cartão fica recusado desde a edge function

Deno.test("handler: metodo 'cartao' devolve 400 e NÃO chama o Mercado Pago", async () => {
  // A Fase 3 entrega só PIX. O caminho de cartão tem defeito conhecido
  // (herança nº 2 da Fase 2): depois da primeira recusa o pedido fica
  // impagável até expirar. A recusa tem que acontecer aqui, antes de
  // qualquer chamada ao gateway — não só no Brick (Task 8).
  const pedido = pedidoBase();
  const supabase = clienteFalso({ pedido, gravado: { id: UUID } });
  let chamadasFetch = 0;
  const fetchImpl = async (_url: string, _init?: RequestInit) => {
    chamadasFetch++;
    return new Response(JSON.stringify({ id: 1, status: "pending" }), { status: 201 });
  };

  const resposta = await handler(requisicao({ orderId: UUID, metodo: "cartao" }), {
    supabase,
    fetchImpl,
  });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 400);
  assertEquals(corpo.error, "No momento aceitamos apenas PIX.");
  // A prova que importa: não é só o código HTTP, é o contador do MP em zero.
  assertEquals(chamadasFetch, 0);
  // CHECKOUT-050 (#194), correção da revisão: NÃO é terminal. "Tentar de
  // novo" remonta o Brick, e é justamente lá que o cliente escolhe PIX — o
  // próprio retry troca de método e destrava. Marcar terminal prendia o
  // cliente numa caixa que já tinha desmontado o formulário onde ele faria
  // essa troca.
  assertEquals(corpo.terminal, undefined);
});

Deno.test("handler: consulta ao Mercado Pago falhando devolve 502, sem confirmar nada com 200", async () => {
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const pedido = pedidoBase({ gateway_payment_id: "789" });
  const supabase = clienteFalso({ pedido, gravado: null });
  const fetchImpl = async (_url: string, _init?: RequestInit) =>
    new Response(JSON.stringify({ message: "Payment not found" }), { status: 404 });

  const resposta = await handler(requisicao({ orderId: UUID, metodo: "pix" }), {
    supabase,
    fetchImpl,
  });

  assertEquals(resposta.status, 502);
});

// --- handler: a regra fechada PELA RAIZ, não ponto a ponto ----------------
//
// CHECKOUT-050 (#194), achado da revisão final: cada teste acima cobre UM
// ponto de retorno específico. Isso prova que os pontos conhecidos hoje estão
// certos, mas não impede alguém de acrescentar um ramo de recusa NOVO — outro
// 400, outro 404, outro 409 — sem o campo `terminal`, e a suíte inteira
// continuaria verde, porque nenhum teste específico existe ainda para esse
// ramo que nem nasceu. Foi assim que o defeito original nasceu (a recusa de
// cartão e os dois "Pedido não encontrado." ficaram de fora da primeira
// rodada, sem nenhum teste denunciando a ausência).
//
// Este teste não chama o handler — ele lê o CÓDIGO-FONTE de index.ts e
// enumera todo retorno `json({ error: ... }, status)` com status >= 400. Para
// cada um: ou o objeto leva `terminal: true`, ou a mensagem está na lista de
// recuperáveis CONHECIDAS abaixo — cada uma com o motivo escrito de por que
// repetir a chamada pode dar resultado diferente. Uma recusa nova que caia
// fora dos dois casos reprova aqui na hora, sem esperar que alguém lembre de
// escrever um teste dedicado para ela.
Deno.test("toda recusa (status >= 400) da criar-pagamento leva 'terminal' ou está na lista de recuperáveis conhecidas", async () => {
  const fonte = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

  const recuperaveisConhecidas = new Map<string, string>([
    ["Corpo inválido.", "reenviar com JSON válido resolve; nada do pedido mudou"],
    ["Pedido inválido.", "reenviar com um orderId em formato de UUID resolve"],
    [
      "Pagamento indisponível.",
      "falta de env var no servidor; nada do pedido está errado",
    ],
    [
      "Não foi possível verificar o pedido.",
      "falha de LEITURA (statement timeout, pool esgotado, fetch caindo), " +
        "não 'pedido não existe' — zero linhas devolve error:null no " +
        "postgrest-js; retry é seguro assim que o banco responder",
    ],
    [
      "No momento aceitamos apenas PIX.",
      "'Tentar de novo' remonta o Brick, e é lá que o cliente escolhe PIX " +
        "— o próprio retry troca de método e destrava",
    ],
    [
      "r.erro",
      "o Mercado Pago não respondeu (consulta ou criação); nada foi gravado " +
        "no pedido, retry é seguro",
    ],
    [
      "Este pedido já tem uma cobrança gerada.",
      "a corrida do UPDATE já resolveu; a PRÓXIMA chamada converge sozinha " +
        "pelo caminho 'reconsultar'",
    ],
    [
      "Não foi possível confirmar a cobrança.",
      "causa não gravada pela releitura; a chave de idempotência protege " +
        "contra cobrança duplicada num novo retry",
    ],
  ]);

  // Casa `json({ ...objeto... }, status)` — objetos de erro E de sucesso
  // (200), porque só depois de capturar dá para filtrar pelo conteúdo. Sem
  // chaves aninhadas dentro do objeto capturado em nenhum ponto de index.ts
  // hoje, então `[^{}]*` (que casa quebra de linha) basta.
  // A vírgula final antes do `)` é opcional DE PROPÓSITO: sem o `,?` o
  // padrão não casa a forma multi-linha com trailing comma — que é
  // exatamente o estilo dos dois `json(..., 200,)` deste arquivo. Uma recusa
  // nova escrita assim escaparia da enumeração em silêncio, com a suíte
  // verde, que é o furo que este teste existe para não ter.
  const regexJson = /json\(\s*\{([^{}]*)\}\s*,\s*(\d{3})\s*,?\s*\)/g;
  let achados = 0;

  for (const m of fonte.matchAll(regexJson)) {
    const objeto = m[1];
    const status = Number(m[2]);
    if (status < 400 || !objeto.includes("error:")) continue; // sucesso, fora do escopo
    achados++;

    if (/terminal:\s*true/.test(objeto)) continue;

    const literal = objeto.match(/error:\s*"([^"]*)"/);
    const identificador =
      literal?.[1] ?? objeto.match(/error:\s*([\w.]+)/)?.[1];

    if (identificador && recuperaveisConhecidas.has(identificador)) continue;

    throw new Error(
      `recusa (status ${status}) sem 'terminal' e fora da lista de ` +
        `recuperáveis conhecidas: "${objeto.trim()}". Se é permanente para ` +
        `o pedido, acrescente terminal: true. Se é recuperável, documente o ` +
        `motivo e acrescente à lista deste teste.`,
    );
  }

  // Trava contra o regex quebrar silenciosamente — se um dia alguém
  // reformatar os json() de erro de um jeito que o padrão pare de casar,
  // "achados" cai para 0 e o teste passaria vazio, sem provar nada. O número
  // muda só quando um ponto de retorno é acrescentado ou removido de
  // propósito — o que É a enumeração pedida, não um acidente de estilo.
  //
  // 13, não mais 12: o antigo `if (error || !pedido) ...` (um só ponto de
  // retorno) virou dois — falha de LEITURA (503) e "não existe" (404) —
  // porque as duas causas eram opostas e tinham que responder diferente
  // (achado da revisão do CHECKOUT-050, #194).
  assertEquals(achados, 13);
});

// CHECKOUT-050 (#194), achado por mutação: o teste acima só casa o helper
// `json(`. Uma recusa escrita como `new Response(JSON.stringify({error:
// ...}), {status: 409})` — por fora do helper — passa por baixo do radar
// dele e a suíte fica verde sem provar nada sobre essa recusa nova. Fecha a
// porta lateral contando TODA chamada a `new Response(` no arquivo: hoje só
// duas são legítimas (o "ok" do OPTIONS/CORS, e a definição do próprio
// helper `json`). Uma terceira ocorrência é sinal de erro fugindo do helper.
Deno.test("nenhuma resposta escapa do helper json() por fora (new Response direto)", async () => {
  const fonte = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  const ocorrencias = fonte.match(/new Response\(/g) ?? [];
  assertEquals(
    ocorrencias.length,
    2,
    "só o OPTIONS (CORS) e a definição do helper json() podem chamar " +
      "`new Response` diretamente; um `new Response` a mais é uma recusa " +
      "escapando do teste de enumeração acima, que só casa `json(`.",
  );
});
