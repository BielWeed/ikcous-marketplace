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
  emailDoToken,
  expiracaoRealinhavel,
  handler,
  pareceUuid,
  podeCobrar,
  subDoToken,
} from "./index.ts";

const UUID = "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
const AGORA = new Date("2026-08-06T12:00:00.000Z");
// Dono padrão dos pedidos usados pelos testes do ramo de CRIAÇÃO — desde a
// regra "pagamento online exige conta" (16/08/2026, ver o guard novo em
// index.ts), `user_id: null` (convidado) é RECUSADO antes de chegar no MP, e
// os testes que verificam o comportamento do ramo "criar" (corpo mandado ao
// MP, gravação de gateway_payment_id, tradução de status etc.) precisam de
// um pedido com dono para não bater nesse guard por acidente. `pedidoBase()`
// continua com `user_id: null` por padrão — só estes testes passam o
// override, junto de `montarToken(DONO_LOGADO)` na requisição.
const DONO_LOGADO = "5f5f5f5f-6666-7777-8888-999900001111";

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
  //
  // `valoresUpdate` (Tarefa 2, CHECKOUT-070) grava o SET de .update(...) em
  // si — sem isso não dava para provar que gateway_payment_id é gravado com
  // o id da ORDER (prefixo ORD), não o do pagamento (prefixo PAY): os testes
  // antigos só conferiam o WHERE, nunca o valor gravado.
  registro?: {
    chamadasUpdate: number;
    filtrosUpdate?: Array<[string, unknown]>;
    valoresUpdate?: Record<string, unknown>;
  };
}) {
  let chamadasSelect = 0;
  return {
    from(_tabela: string) {
      return {
        select(_cols: string) {
          chamadasSelect++;
          const primeiraLeitura = chamadasSelect === 1;
          const erro = primeiraLeitura ? opts.erroLeitura ?? null : null;
          const dadosBrutos = erro
            ? null
            : primeiraLeitura
              ? opts.pedido
              : opts.releitura ?? opts.pedido;
          // Achado 2 da revisão (14/08/2026): antes, `_cols` era recebido e
          // DESCARTADO — este select sempre devolvia o fixture inteiro,
          // qualquer que fosse a string pedida. Provado pela revisão: trocar
          // `.select("id, expires_at")` (index.ts) de volta para `.select("id")`
          // deixava a suíte inteira verde. `projetarColunas` reduz o fixture
          // às colunas realmente pedidas — coluna pedida que o fixture não
          // tem simplesmente não entra no objeto projetado, igual a nunca ter
          // sido selecionada.
          const dados = erro ? null : projetarColunas(dadosBrutos, _cols);
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
            opts.registro.valoresUpdate = _valores;
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
                            maybeSingle: async () => ({
                              data: projetarColunas(opts.gravado, _cols),
                              error: null,
                            }),
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

/**
 * Reduz um fixture às colunas que `.select("a, b, c")` pediu de verdade —
 * Achado 2 da revisão (14/08/2026). Coluna pedida que não existe no fixture
 * simplesmente não entra no objeto devolvido (equivalente a `undefined` na
 * leitura), sem lançar: o postgrest real sempre devolve TODAS as colunas de
 * uma linha existente, então um fixture incompleto para as colunas
 * REALMENTE pedidas pela produção é bug do teste, não algo para mascarar
 * aqui — mas nenhum teste desta suíte depende de uma coluna ausente do
 * fixture continuar presente por acidente, então falhar alto não era
 * necessário para provar o achado.
 */
function projetarColunas(
  dados: Record<string, unknown> | null,
  cols: string,
): Record<string, unknown> | null {
  if (dados === null) return null;
  const colunas = new Set(cols.split(",").map((c) => c.trim()));
  return Object.fromEntries(
    Object.entries(dados).filter(([coluna]) => colunas.has(coluna)),
  );
}

/** `fetch` falso que nunca toca rede: devolve uma ORDER 2xx válida (formato
 * de `POST /v1/orders`, Tarefa 2 — CHECKOUT-070) e guarda o corpo que a
 * function mandou, para o teste conferir `external_reference` sem depender
 * dos testes da Task 1. O `id` "ORD999" (prefixo de order, não de pagamento)
 * é de propósito: um teste que confundisse orderId com paymentId não
 * distinguiria os dois se o stub usasse um id genérico. */
function fetchFalsoMP(capturado: { corpo?: Record<string, unknown> }) {
  return async (_url: string, init?: RequestInit) => {
    capturado.corpo = JSON.parse(String(init?.body ?? "{}"));
    return new Response(
      JSON.stringify({
        id: "ORD999",
        status: "action_required",
        status_detail: "waiting_transfer",
        transactions: {
          payments: [
            {
              id: "PAY999",
              payment_method: {
                qr_code: "QRCODE-PADRAO",
                qr_code_base64: "QRBASE64-PADRAO",
                ticket_url: "https://www.mercadopago.com.br/sandbox/payments/999/ticket",
              },
            },
          ],
        },
      }),
      { status: 201 },
    );
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
  // Rodada 2: o navegador mobile descarta a aba enquanto o cliente paga pelo
  // app do banco; ao voltar, a tela remonta e chamava esta function de novo
  // — recusar aqui
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

// --- expiracaoRealinhavel: janela sã do date_of_expiration do MP, para
// realinhar expires_at com o vencimento real do QR (decisão do dono,
// 14/08/2026). Injeta `agora` como parâmetro — mesmo padrão de `podeCobrar`
// acima — para o teste não depender do relógio real. Injeta também
// `expiracaoPix` (o MESMO valor mandado ao MP) — todos os testes abaixo que
// só exercitam a checagem de DATA usam "PT30M", igual ao default de
// produção; os testes que exercitam a DERIVAÇÃO em si (mais abaixo) variam
// esse parâmetro.

Deno.test("expiracaoRealinhavel aceita um vencimento dentro da janela sã (20 min à frente)", () => {
  const r = expiracaoRealinhavel("2026-08-06T12:20:00.000Z", AGORA, "PT30M");
  assertEquals(r?.toISOString(), "2026-08-06T12:20:00.000Z");
});

Deno.test("expiracaoRealinhavel aceita o limite superior da margem de latência (35 min à frente)", () => {
  // 30 min pedidos + 5 min de margem para latência de rede/gateway.
  const r = expiracaoRealinhavel("2026-08-06T12:35:00.000Z", AGORA, "PT30M");
  assertEquals(r?.toISOString(), "2026-08-06T12:35:00.000Z");
});

Deno.test("expiracaoRealinhavel recusa um vencimento além da margem de latência (36 min à frente)", () => {
  const r = expiracaoRealinhavel("2026-08-06T12:36:00.000Z", AGORA, "PT30M");
  assertEquals(r, null);
});

Deno.test("expiracaoRealinhavel recusa o default de 24h do MP (o teto de segurança que existe para barrar isto)", () => {
  const r = expiracaoRealinhavel("2026-08-07T12:00:00.000Z", AGORA, "PT30M");
  assertEquals(r, null);
});

Deno.test("expiracaoRealinhavel recusa um vencimento no passado", () => {
  const r = expiracaoRealinhavel("2026-08-06T11:59:00.000Z", AGORA, "PT30M");
  assertEquals(r, null);
});

Deno.test("expiracaoRealinhavel recusa um vencimento igual a agora — tem que ser estritamente futuro", () => {
  const r = expiracaoRealinhavel("2026-08-06T12:00:00.000Z", AGORA, "PT30M");
  assertEquals(r, null);
});

Deno.test("expiracaoRealinhavel recusa string não-parseável, sem estourar", () => {
  const r = expiracaoRealinhavel("não é uma data", AGORA, "PT30M");
  assertEquals(r, null);
});

Deno.test("expiracaoRealinhavel recusa ausência (null) — o caso mais comum antes de qualquer chamada ao MP falhar", () => {
  const r = expiracaoRealinhavel(null, AGORA, "PT30M");
  assertEquals(r, null);
});

// --- expiracaoRealinhavel: a janela sã DERIVA de `expiracaoPix`, não de um
// "30" congelado na função (Achado 1 da revisão, 14/08/2026). Prova direta
// da causa que o achado apontou: antes desta correção, a janela era sempre
// (agora, agora+35min], hardcoded — estes dois testes reprovam se alguém
// remover o parâmetro e voltar a fixar 30 aqui dentro, porque "PT45M"
// produziria a MESMA janela de 35 min que "PT30M" produz.

Deno.test("expiracaoRealinhavel: com expiracaoPix='PT45M', aceita um vencimento que 'PT30M' teria recusado (40 min à frente)", () => {
  // Com "PT30M" (hardcoded do jeito antigo) o teto seria 35 min — 40 min à
  // frente cairia fora e devolveria null. Com "PT45M" o teto é 50 min, e o
  // mesmo vencimento é aceito. Se a janela voltar a ser fixa em 30, este
  // teste reprova.
  const r = expiracaoRealinhavel("2026-08-06T12:40:00.000Z", AGORA, "PT45M");
  assertEquals(r?.toISOString(), "2026-08-06T12:40:00.000Z");
});

Deno.test("expiracaoRealinhavel: com expiracaoPix='PT45M', o teto acompanha (50 min aceita, 51 min recusa)", () => {
  // 45 min pedidos + 5 min de margem = 50 min, não 35.
  const dentro = expiracaoRealinhavel("2026-08-06T12:50:00.000Z", AGORA, "PT45M");
  assertEquals(dentro?.toISOString(), "2026-08-06T12:50:00.000Z");

  const fora = expiracaoRealinhavel("2026-08-06T12:51:00.000Z", AGORA, "PT45M");
  assertEquals(fora, null);
});

Deno.test("expiracaoRealinhavel: expiracaoPix num formato que minutosDaExpiracaoPix não reconhece recusa, sem estourar", () => {
  // Defensivo: em produção isto nunca acontece porque montarCorpoPixOrders já
  // teria lançado antes — mas expiracaoRealinhavel não pode adivinhar uma
  // janela para um valor que não sabe interpretar.
  const r = expiracaoRealinhavel("2026-08-06T12:20:00.000Z", AGORA, "30 minutos");
  assertEquals(r, null);
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

// PEDIDO-07 (auditoria de 26/08/2026): no dia em que as chaves LEGADAS do
// Supabase forem desligadas, `Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")`
// volta undefined e `createClient(url, undefined!)` lança "supabaseKey is
// required." — ANTES desta correção, essa chamada ficava FORA de qualquer
// try/catch (linha 277-282 da auditoria), e o throw escapava o handler
// inteiro: 500 cru, sem `terminal`, sem mensagem que o front reconheça — o
// cliente clica "Tentar de novo" e repete a mesma falha até o pedido
// expirar em 30 min. Nenhum teste anterior desta suíte exercitava este
// caminho: todos os outros testes passam `deps.supabase` já pronto, então
// nenhum chegava a `deps.supabase ?? createClient(...)`.
Deno.test("handler: nenhuma chave de service role no ambiente (nem a nova SUPABASE_SECRET_KEYS, nem a legada SUPABASE_SERVICE_ROLE_KEY) vira resposta tratada 503, não um throw que escapa do handler", async () => {
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  Deno.env.set("SUPABASE_URL", "https://xyz.supabase.co");
  Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
  Deno.env.delete("SUPABASE_SECRET_KEYS");

  try {
    // Sem `supabase` em deps: força o handler a montar o client real a
    // partir do ambiente, em vez do cliente falso que o resto da suíte usa.
    const resposta = await handler(
      requisicao({ orderId: UUID, metodo: "pix" }, montarToken(DONO_LOGADO)),
      {},
    );
    const corpo = await resposta.json();

    // Mesmo par (status, mensagem) que a checagem de MP_ACCESS_TOKEN ausente
    // já usa, poucas linhas acima no arquivo real — falha de CONFIGURAÇÃO
    // deste servidor, não do cliente, tratada da mesma forma.
    assertEquals(resposta.status, 503);
    assertEquals(corpo.error, "Pagamento indisponível.");
  } finally {
    Deno.env.delete("SUPABASE_URL");
  }
});

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

Deno.test("handler: pedido de convidado SEM cobrança existente é RECUSADO — pagamento online exige conta (decisão do Gabriel, 16/08/2026)", async () => {
  // Antes desta regra este teste chamava "...devolve 200" — o convidado
  // criava a cobrança normalmente. Agora ele nunca chega no Mercado Pago: a
  // RLS de marketplace_orders é `TO authenticated` com `auth.uid() =
  // user_id`, e um pedido com user_id NULL nunca aparece pro próprio
  // comprador, nem depois de pago. `código` distinto de qualquer outra
  // recusa 4xx desta function — quem depurar um 403 sabe, sem abrir o
  // código, que foi esta regra, não outra.
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const pedido = pedidoBase(); // user_id: null (convidado)
  const supabase = clienteFalso({ pedido, gravado: { id: UUID } });
  const fetchImpl = fetchFalsoMP({});
  let chamouFetch = false;
  const fetchEspiao: typeof fetchImpl = async (...args) => {
    chamouFetch = true;
    return fetchImpl(...args);
  };

  const resposta = await handler(requisicao({ orderId: UUID, metodo: "pix" }), {
    supabase,
    fetchImpl: fetchEspiao,
  });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 403);
  assertEquals(corpo.code, "PAGAMENTO_ONLINE_EXIGE_CONTA");
  assertEquals(corpo.terminal, true);
  // A prova que importa além do status: nada foi cobrado. Sem isto, uma
  // versão do guard que checasse DEPOIS de chamar o MP passaria batida —
  // cobraria de verdade e só recusaria a resposta.
  assertEquals(chamouFetch, false);
});

Deno.test("handler: pedido de convidado COM cobrança existente continua reconsultando normalmente — o guard só bloqueia CRIAÇÃO", async () => {
  // Janela de atualização (obrigatória pela tarefa): um convidado que já
  // tinha o QR na tela ANTES desta regra entrar não pode perder acesso a um
  // PIX que ele pode já ter pago só porque a página recarregou DEPOIS da
  // atualização. O guard novo fica ATRÁS do `if (decisao.acao ===
  // "reconsultar")` em index.ts — nunca na frente dele.
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const pedido = pedidoBase({ gateway_payment_id: "ORD789" }); // user_id: null
  const registro = { chamadasUpdate: 0 };
  const supabase = clienteFalso({ pedido, gravado: { id: UUID }, registro });
  const fetchImpl = fetchFalsoConsulta({
    id: "ORD789",
    status: "action_required",
    status_detail: "waiting_transfer",
    transactions: {
      payments: [
        {
          id: "PAY789",
          payment_method: { qr_code: "QRCODE-DA-RECONSULTA-CONVIDADO" },
        },
      ],
    },
  });

  const resposta = await handler(requisicao({ orderId: UUID, metodo: "pix" }), {
    supabase,
    fetchImpl,
  });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  assertEquals(corpo.qrCode, "QRCODE-DA-RECONSULTA-CONVIDADO");
  // Nenhum UPDATE: reconsulta nunca grava, igual ao ramo de dono logado.
  assertEquals(registro.chamadasUpdate, 0);
});

Deno.test("handler: o corpo enviado ao Mercado Pago leva external_reference", async () => {
  // Garantido pelo caminho REAL do handler, não só pelos testes da Task 1.
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const pedido = pedidoBase({ user_id: DONO_LOGADO });
  const supabase = clienteFalso({ pedido, gravado: { id: UUID } });
  const capturado: { corpo?: Record<string, unknown> } = {};
  const fetchImpl = fetchFalsoMP(capturado);

  await handler(requisicao({ orderId: UUID, metodo: "pix" }, montarToken(DONO_LOGADO)), {
    supabase,
    fetchImpl,
  });

  assertEquals(capturado.corpo?.external_reference, UUID);
});

Deno.test("handler: PIX leva o documento do pagador quando o front manda — A-2 da revisão final", async () => {
  // O documento atravessava front → criar-pagamento e sumia na chamada a
  // montarCorpoPix (a que faltava o parâmetro). Este teste prova a fiação
  // INTEIRA, não só montarCorpoPix isolado (coberto em mercadopago_test.ts).
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const pedido = pedidoBase({ user_id: DONO_LOGADO });
  const supabase = clienteFalso({ pedido, gravado: { id: UUID } });
  const capturado: { corpo?: Record<string, unknown> } = {};
  const fetchImpl = fetchFalsoMP(capturado);

  await handler(
    requisicao(
      {
        orderId: UUID,
        metodo: "pix",
        documento: { type: "CPF", number: "12345678909" },
      },
      montarToken(DONO_LOGADO),
    ),
    { supabase, fetchImpl },
  );

  assertEquals(
    (capturado.corpo?.payer as Record<string, unknown>)?.identification,
    { type: "CPF", number: "12345678909" },
  );
});

Deno.test("handler: o corpo Orders enviado ao MP NÃO leva notification_url — a Orders API não tem esse campo (issue #212, operacional)", async () => {
  // Tarefa 2 (CHECKOUT-070), migração para a Orders API: este teste cobria
  // o caminho clássico (montarCorpoPix aceita notificationUrl e o handler
  // montava a URL). montarCorpoPixOrders NÃO tem esse parâmetro — a Orders
  // API não documenta um campo equivalente (ver o comentário grande da
  // função em _shared/mercadopago.ts). Resolver isso é a issue #212,
  // operacional, explicitamente FORA do escopo desta tarefa — este teste
  // agora prova que o corpo simplesmente não carrega o campo, para não
  // deixar a suíte com uma expectativa que a migração já tornou falsa.
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  Deno.env.set("SUPABASE_URL", "https://xyz.supabase.co");
  const pedido = pedidoBase({ user_id: DONO_LOGADO });
  const supabase = clienteFalso({ pedido, gravado: { id: UUID } });
  const capturado: { corpo?: Record<string, unknown> } = {};
  const fetchImpl = fetchFalsoMP(capturado);

  await handler(requisicao({ orderId: UUID, metodo: "pix" }, montarToken(DONO_LOGADO)), {
    supabase,
    fetchImpl,
  });

  assertEquals(capturado.corpo?.notification_url, undefined);
});

Deno.test("handler: pedido expirado pelo pg_cron no meio da corrida NÃO devolve 200, e a mensagem é a de prazo", async () => {
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const pedido = pedidoBase({ user_id: DONO_LOGADO });
  // A releitura pós-UPDATE-falho mostra o que o pg_cron já gravou: 'expirado'.
  const releitura = { payment_status: "expirado", gateway_payment_id: null };
  const supabase = clienteFalso({ pedido, gravado: null, releitura });
  const fetchImpl = fetchFalsoMP({});

  const resposta = await handler(
    requisicao({ orderId: UUID, metodo: "pix" }, montarToken(DONO_LOGADO)),
    { supabase, fetchImpl },
  );
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
  const pedido = pedidoBase({ user_id: DONO_LOGADO });
  // Nem 'expirado', nem gateway_payment_id gravado: a releitura não explica
  // por que o UPDATE não achou linha (ex.: ela também falhou).
  const releitura = { payment_status: "aguardando", gateway_payment_id: null };
  const supabase = clienteFalso({ pedido, gravado: null, releitura });
  const fetchImpl = fetchFalsoMP({});

  const resposta = await handler(
    requisicao({ orderId: UUID, metodo: "pix" }, montarToken(DONO_LOGADO)),
    { supabase, fetchImpl },
  );
  const corpo = await resposta.json();

  assertEquals(resposta.status, 409);
  assertEquals(corpo.error, "Não foi possível confirmar a cobrança.");
  assertEquals(corpo.terminal, undefined);
});

Deno.test("handler: duas chamadas concorrentes — a que perde o UPDATE NÃO devolve 200, e a mensagem é a de cobrança já gerada", async () => {
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const pedido = pedidoBase({ user_id: DONO_LOGADO });
  // A releitura mostra que a OUTRA chamada já gravou gateway_payment_id
  // enquanto esta ainda estava esperando o Mercado Pago responder.
  const releitura = { payment_status: "aguardando", gateway_payment_id: "outro-pagamento" };
  const supabase = clienteFalso({ pedido, gravado: null, releitura });
  const fetchImpl = fetchFalsoMP({});

  const resposta = await handler(
    requisicao({ orderId: UUID, metodo: "pix" }, montarToken(DONO_LOGADO)),
    { supabase, fetchImpl },
  );
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
 * passar, e GUARDA método, URL e corpo da requisição que recebeu — mesmo
 * padrão de `mercadopago_test.ts:277-281` uma camada abaixo. Sem isso, trocar
 * `consultarOrder` por outra chamada dentro do ramo `reconsultar` (um POST de
 * verdade, com corpo, no Mercado Pago, OU o endpoint clássico errado —
 * `/v1/payments/{id}` com um id de order) passava batido: o cliente falso
 * aqui não olhava método, URL nem body, só o que a resposta continha.
 */
function fetchFalsoConsulta(
  corpoDaResposta: Record<string, unknown>,
  capturado?: { method?: string; body?: BodyInit | null | undefined; url?: string },
) {
  return async (url: string, init?: RequestInit) => {
    if (capturado) {
      capturado.method = init?.method;
      capturado.body = init?.body;
      capturado.url = url;
    }
    return new Response(JSON.stringify(corpoDaResposta), { status: 200 });
  };
}

Deno.test("handler: pedido com cobrança existente reconsulta a ORDER no MP (GET /v1/orders/{id}, não /v1/payments/{id}), devolve o MESMO QR, e NÃO faz UPDATE", async () => {
  // Tarefa 2 (CHECKOUT-070): gateway_payment_id passa a guardar o id da
  // ORDER (prefixo ORD) — reconsultar com o endpoint clássico chamaria
  // /v1/payments/ORD789, que o MP nem reconhece como id de pagamento (404
  // garantido para TODO pedido PIX criado depois desta migração).
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const pedido = pedidoBase({ gateway_payment_id: "ORD789" });
  const registro = { chamadasUpdate: 0 };
  const supabase = clienteFalso({ pedido, gravado: { id: UUID }, registro });
  const capturado: { method?: string; body?: BodyInit | null | undefined; url?: string } = {};
  const fetchImpl = fetchFalsoConsulta(
    {
      id: "ORD789",
      status: "action_required",
      status_detail: "waiting_transfer",
      transactions: {
        payments: [
          {
            id: "PAY789",
            payment_method: {
              qr_code: "QRCODE-DA-RECONSULTA",
              qr_code_base64: "QRBASE64-DA-RECONSULTA",
              ticket_url: "https://www.mercadopago.com.br/sandbox/payments/789/ticket",
            },
          },
        ],
      },
    },
    capturado,
  );

  const resposta = await handler(requisicao({ orderId: UUID, metodo: "pix" }), {
    supabase,
    fetchImpl,
  });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  assertEquals(corpo.paymentId, "ORD789");
  // BLOQUEIO 2 da revisão original: a revisão mutou a fiação (trocou as duas
  // chamadas de tradução pelo status cru) e a suíte ficou 108 passed | 0
  // failed — nenhum teste do handler afirmava o campo de status. Sem isto,
  // "action_required:waiting_transfer" cru chega ao front, que não reconhece
  // nenhum valor do conjunto fechado e trata como terminal. CHECKOUT-080
  // (#213): o campo é `statusPagamento`, e o valor é o `payment_status` que
  // este banco já usa ('aguardando'), não mais o vocabulário clássico do MP.
  assertEquals(corpo.statusPagamento, "aguardando");
  assertEquals(corpo.qrCode, "QRCODE-DA-RECONSULTA");
  assertEquals(corpo.qrCodeBase64, "QRBASE64-DA-RECONSULTA");
  assertEquals(corpo.ticketUrl, "https://www.mercadopago.com.br/sandbox/payments/789/ticket");
  assertEquals(registro.chamadasUpdate, 0);
  // A metade que faltava provar: reconsulta é GET, sem body, no endpoint de
  // ORDER — trocar consultarOrder por criarPagamento/criarOrder aqui viraria
  // um POST com corpo (nova cobrança a cada F5), e trocar por
  // consultarPagamento bateria no endpoint clássico errado.
  assertEquals(capturado.method, "GET");
  assertEquals(capturado.body, undefined);
  assertEquals(capturado.url?.includes("/v1/orders/ORD789"), true);
});

// --- handler: BLOQUEIO 3 da revisão — pedido em voo no momento do deploy --
//
// Pedido criado ANTES da migração para a Orders API tem gateway_payment_id no
// formato CLÁSSICO (numérico). Reconsultar com consultarOrder (GET
// /v1/orders/{id}) devolve 404 para esse id — o endpoint novo nunca vai
// reconhecer um id que nasceu no clássico. Sem fallback, o cliente que perde
// a aba e volta recebe 404 pra sempre, até o pg_cron expirar e devolver o
// estoque: a venda se perde mesmo o cliente nunca tendo pagado.

Deno.test("handler: reconsulta com id NOVO (order) resolve pelo Orders sem tocar o endpoint clássico", async () => {
  // Contraste com o teste de fallback abaixo: aqui o id é de order, a
  // primeira chamada já responde 200, e o endpoint clássico nunca é tocado.
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const pedido = pedidoBase({ gateway_payment_id: "ORD789" });
  const supabase = clienteFalso({ pedido, gravado: { id: UUID } });
  const urlsChamadas: string[] = [];
  const fetchImpl = async (url: string, _init?: RequestInit) => {
    urlsChamadas.push(url);
    return new Response(
      JSON.stringify({
        id: "ORD789",
        status: "action_required",
        status_detail: "waiting_transfer",
        transactions: {
          payments: [{ id: "PAY789", payment_method: { qr_code: "QRCODE-ORDER" } }],
        },
      }),
      { status: 200 },
    );
  };

  const resposta = await handler(requisicao({ orderId: UUID, metodo: "pix" }), {
    supabase,
    fetchImpl,
  });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  assertEquals(corpo.qrCode, "QRCODE-ORDER");
  assertEquals(urlsChamadas.length, 1);
  assertEquals(urlsChamadas[0].includes("/v1/orders/ORD789"), true);
});

Deno.test("handler: reconsulta com id LEGADO (clássico, numérico) vai DIRETO para /v1/payments — nunca toca a Orders API — e devolve o MESMO QR", async () => {
  // Correção pós-revisão (CHECKOUT-070): a versão anterior deste teste
  // codificava a suposição errada de que o MP devolve 404 para um id
  // clássico na Orders API — o MP devolve 400 `invalid_path_param` (id sem
  // forma de order), e o fallback por CÓDIGO DE ERRO nunca disparava de
  // verdade. Este teste prova a discriminação pela FORMA do id: um id
  // legado nunca gasta uma chamada na Orders API antes de ir para o clássico.
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  // Formato do id clássico: numérico, sem o prefixo ORD que a Orders API usa.
  const pedido = pedidoBase({ gateway_payment_id: "112233445566" });
  const supabase = clienteFalso({ pedido, gravado: { id: UUID } });
  const urlsChamadas: string[] = [];
  const fetchImpl = async (url: string, _init?: RequestInit) => {
    urlsChamadas.push(url);
    if (url.includes("/v1/orders/")) {
      throw new Error(`fetch inesperado nos testes: ${url} — id legado não pode tocar a Orders API`);
    }
    // /v1/payments/{id} — o endpoint clássico, formato clássico de resposta.
    return new Response(
      JSON.stringify({
        id: 112233445566,
        status: "pending",
        point_of_interaction: {
          transaction_data: {
            qr_code: "QRCODE-CLASSICO",
            qr_code_base64: "QRBASE64-CLASSICO",
            ticket_url: "https://www.mercadopago.com.br/payments/112233445566/ticket",
          },
        },
      }),
      { status: 200 },
    );
  };

  const resposta = await handler(requisicao({ orderId: UUID, metodo: "pix" }), {
    supabase,
    fetchImpl,
  });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  assertEquals(corpo.paymentId, "112233445566");
  // CHECKOUT-080 (#213): antes desta tarefa isto era `corpo.status` CRU
  // ("pending"), sem tradução — o mesmo texto que o MP mandou. Agora o
  // ramo clássico também emite o conjunto fechado do banco: `mapearStatus`
  // ("pending" → "aguardando"), o MESMO tradutor que webhook-mercadopago e
  // reconciliar-pagamentos já usam para este vocabulário. Sem isto, um
  // cliente com cobrança LEGADA (criada antes da migração para a Orders
  // API) veria um valor que PagamentoOnline.tsx não reconhece e cairia em
  // terminal, mesmo com um QR válido na mão.
  assertEquals(corpo.statusPagamento, "aguardando");
  assertEquals(corpo.qrCode, "QRCODE-CLASSICO");
  assertEquals(corpo.qrCodeBase64, "QRBASE64-CLASSICO");
  assertEquals(corpo.ticketUrl, "https://www.mercadopago.com.br/payments/112233445566/ticket");
  // A prova que importa: UMA chamada só, direto ao clássico — nunca à
  // Orders API antes.
  assertEquals(urlsChamadas.length, 1);
  assertEquals(urlsChamadas[0].includes("/v1/payments/112233445566"), true);
});

Deno.test("handler: reconsulta LEGADA traduz 'approved' para 'pago' — prova que o ramo clássico usa mapearStatus, não devolve o status cru", async () => {
  // CHECKOUT-080 (#213), teste novo: o teste acima já prova que 'pending'
  // vira 'aguardando'; este prova um segundo valor conhecido (o caminho mais
  // importante — cobrança JÁ PAGA) para não deixar a tradução do ramo
  // clássico coberta por coincidência (mapearStatus poderia, em tese, ter
  // sido escrito para devolver 'pending' cru sem que o teste anterior
  // acusasse).
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const pedido = pedidoBase({ gateway_payment_id: "998877665544" });
  const supabase = clienteFalso({ pedido, gravado: { id: UUID } });
  const fetchImpl = async (_url: string, _init?: RequestInit) =>
    new Response(
      JSON.stringify({ id: 998877665544, status: "approved" }),
      { status: 200 },
    );

  const resposta = await handler(requisicao({ orderId: UUID, metodo: "pix" }), {
    supabase,
    fetchImpl,
  });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  assertEquals(corpo.statusPagamento, "pago");
});

Deno.test("handler: reconsulta LEGADA com status que mapearStatus não conhece devolve o valor CRU — nunca um palpite", async () => {
  // CHECKOUT-080 (#213), teste novo: `mapearStatus` devolve `null` para
  // status que não conhece (ver _shared/mercadopago.ts) — o ramo clássico
  // usa `?? classico.status` como rede de segurança, igual ao comportamento
  // de hoje para esse caso. O front trata como desconhecido e recusa
  // fechado (PagamentoOnline.tsx), então devolver o valor cru aqui não é
  // regressão: é o mesmo "nunca um palpite" que o resto deste arquivo já
  // segue.
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const pedido = pedidoBase({ gateway_payment_id: "998877665544" });
  const supabase = clienteFalso({ pedido, gravado: { id: UUID } });
  const fetchImpl = async (_url: string, _init?: RequestInit) =>
    new Response(
      JSON.stringify({ id: 998877665544, status: "um_status_classico_novo" }),
      { status: 200 },
    );

  const resposta = await handler(requisicao({ orderId: UUID, metodo: "pix" }), {
    supabase,
    fetchImpl,
  });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  assertEquals(corpo.statusPagamento, "um_status_classico_novo");
});

Deno.test("handler: pedido sem cobrança existente cria uma nova e grava gateway_payment_id", async () => {
  // Contraste com o teste acima: prova que o ramo "criar" continua fazendo
  // UPDATE — se um bug fizesse TODO pedido cair no ramo "reconsultar", este
  // teste (chamadasUpdate === 1) cairia, mesmo que o teste de status 200
  // sozinho não pegasse isso.
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const pedido = pedidoBase({ user_id: DONO_LOGADO });
  const registro: { chamadasUpdate: number; filtrosUpdate?: Array<[string, unknown]> } = {
    chamadasUpdate: 0,
  };
  const supabase = clienteFalso({ pedido, gravado: { id: UUID }, registro });
  const fetchImpl = fetchFalsoMP({});

  const resposta = await handler(
    requisicao({ orderId: UUID, metodo: "pix" }, montarToken(DONO_LOGADO)),
    { supabase, fetchImpl },
  );

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

// --- handler: Tarefa 2 (CHECKOUT-070) — migração de PIX para a Orders API -

Deno.test("handler: PIX monta o corpo Orders — total_amount string, expiração PT30M e processing_mode automatic", async () => {
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const pedido = pedidoBase({ total: 149.9, user_id: DONO_LOGADO });
  const supabase = clienteFalso({ pedido, gravado: { id: UUID } });
  const capturado: { corpo?: Record<string, unknown> } = {};
  const fetchImpl = fetchFalsoMP(capturado);

  await handler(requisicao({ orderId: UUID, metodo: "pix" }, montarToken(DONO_LOGADO)), {
    supabase,
    fetchImpl,
  });

  assertEquals(capturado.corpo?.type, "online");
  assertEquals(capturado.corpo?.processing_mode, "automatic");
  assertEquals(capturado.corpo?.total_amount, "149.90");
  assertEquals(capturado.corpo?.external_reference, UUID);
  const transacoes = capturado.corpo?.transactions as Record<string, unknown>;
  const pagamentos = transacoes?.payments as Record<string, unknown>[];
  assertEquals(pagamentos[0].expiration_time, "PT30M");
  assertEquals(pagamentos[0].payment_method, { id: "pix", type: "bank_transfer" });
});

Deno.test("handler: PIX grava gateway_payment_id com o id da ORDER (prefixo ORD), não o do pagamento (prefixo PAY)", async () => {
  // Achado da Task 1 (CHECKOUT-070): a Orders API não tem endpoint de
  // reconsulta por id de pagamento — quem sobrevive e se reconsulta é a
  // order (GET /v1/orders/{id}). Gravar o paymentId aqui faria
  // confirmar_pagamento nunca casar o id que o webhook manda.
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const pedido = pedidoBase({ user_id: DONO_LOGADO });
  const registro: {
    chamadasUpdate: number;
    filtrosUpdate?: Array<[string, unknown]>;
    valoresUpdate?: Record<string, unknown>;
  } = { chamadasUpdate: 0 };
  const supabase = clienteFalso({ pedido, gravado: { id: UUID }, registro });
  const fetchImpl = fetchFalsoMP({});

  await handler(requisicao({ orderId: UUID, metodo: "pix" }, montarToken(DONO_LOGADO)), {
    supabase,
    fetchImpl,
  });

  assertEquals(registro.valoresUpdate?.gateway_payment_id, "ORD999");
});

Deno.test("handler: PIX devolve QR, imagem e ticket_url no formato que o front já espera (qrCode, qrCodeBase64, ticketUrl)", async () => {
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const pedido = pedidoBase({ user_id: DONO_LOGADO });
  const supabase = clienteFalso({ pedido, gravado: { id: UUID } });
  const fetchImpl = fetchFalsoMP({});

  const resposta = await handler(
    requisicao({ orderId: UUID, metodo: "pix" }, montarToken(DONO_LOGADO)),
    { supabase, fetchImpl },
  );
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  assertEquals(corpo.paymentId, "ORD999");
  // BLOQUEIO 2 da revisão: mesmo motivo do teste de reconsulta acima — sem
  // esta asserção, nada prova que o ramo de CRIAÇÃO liga a tradução.
  // CHECKOUT-080 (#213): o campo é `statusPagamento`, e o valor é o
  // `payment_status` deste banco ('aguardando'), não mais o vocabulário
  // clássico do MP.
  assertEquals(corpo.statusPagamento, "aguardando");
  assertEquals(corpo.qrCode, "QRCODE-PADRAO");
  assertEquals(corpo.qrCodeBase64, "QRBASE64-PADRAO");
  assertEquals(corpo.ticketUrl, "https://www.mercadopago.com.br/sandbox/payments/999/ticket");
});

Deno.test("handler: PIX com par conhecido e recusado no ramo de CRIAÇÃO devolve 'recusado', não o default de 'aguardando'", async () => {
  // CHECKOUT-080 (#213), teste novo: o default 'aguardando' do ramo de
  // CRIAÇÃO (ver comentário grande no chamador) só se aplica ao par
  // DESCONHECIDO — um par CONHECIDO (failed:failed) tem que continuar
  // batendo em mapearStatusOrder normalmente, nunca caindo no default por
  // engano.
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const pedido = pedidoBase({ user_id: DONO_LOGADO });
  const supabase = clienteFalso({ pedido, gravado: { id: UUID } });
  const fetchImpl = async (_url: string, _init?: RequestInit) =>
    new Response(
      JSON.stringify({ id: "ORD999", status: "failed", status_detail: "failed" }),
      { status: 201 },
    );

  const resposta = await handler(
    requisicao({ orderId: UUID, metodo: "pix" }, montarToken(DONO_LOGADO)),
    { supabase, fetchImpl },
  );
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  assertEquals(corpo.statusPagamento, "recusado");
});

Deno.test("handler: PIX com status desconhecido no ramo de CRIAÇÃO vira 'aguardando', nunca o par cru — cliente não pode ficar sem 'Tentar de novo' com um QR válido na mão", async () => {
  // Achado da revisão (BLOQUEIO 2): o default cru (o par "status:status_
  // detail") faz o front tratar QUALQUER combinação que não reconheça como
  // terminal (PagamentoOnline.tsx). No ramo de RECONSULTA isso é aceitável
  // (a cobrança já existe há um tempo, pode ter sido recusada de um jeito
  // novo). No ramo de CRIAÇÃO acabamos de receber 201 com QR — devolver
  // algo que o front trata como terminal impede o cliente de pagar uma
  // cobrança que EXISTE. CHECKOUT-080 (#213): o padrão honesto é
  // 'aguardando' — o MESMO valor que a coluna payment_status já recebe no
  // banco para este pedido — e quem decide a verdade depois é o
  // webhook/reconciliação, não a tela.
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const pedido = pedidoBase({ user_id: DONO_LOGADO });
  const supabase = clienteFalso({ pedido, gravado: { id: UUID } });
  const fetchImpl = async (_url: string, _init?: RequestInit) =>
    new Response(
      JSON.stringify({
        id: "ORD555",
        status: "um_status_que_o_mp_ainda_nao_documentou",
        status_detail: "um_detalhe_novo",
      }),
      { status: 201 },
    );

  const resposta = await handler(
    requisicao({ orderId: UUID, metodo: "pix" }, montarToken(DONO_LOGADO)),
    { supabase, fetchImpl },
  );
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  assertEquals(corpo.statusPagamento, "aguardando");
});

Deno.test("handler: PIX sem QR na resposta da Orders API devolve 200 com qrCode ausente — não vira erro genérico (ausência ≠ erro)", async () => {
  // extrairQrCode distingue AUSÊNCIA (order legível, sem QR ainda) de ERRO
  // (order ilegível). O front (PagamentoOnline.tsx) já sabe lidar com
  // qrCode/qrCodeBase64 ausentes — igual ao caminho clássico, que também
  // nunca validava a presença do QR aqui.
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const pedido = pedidoBase({ user_id: DONO_LOGADO });
  const supabase = clienteFalso({ pedido, gravado: { id: UUID } });
  const fetchImpl = async (_url: string, _init?: RequestInit) =>
    new Response(
      JSON.stringify({ id: "ORD777", status: "created", status_detail: "created" }),
      { status: 201 },
    );

  const resposta = await handler(
    requisicao({ orderId: UUID, metodo: "pix" }, montarToken(DONO_LOGADO)),
    { supabase, fetchImpl },
  );
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  assertEquals(corpo.paymentId, "ORD777");
  assertEquals(corpo.qrCode, undefined);
  assertEquals(corpo.qrCodeBase64, undefined);
});

// --- handler: realinhamento de expires_at com date_of_expiration do MP —
// decisão do dono (14/08/2026). O `date_of_expiration` vem no formato real
// medido em 14/08/2026 (ver o comentário de extrairDataExpiracaoOrder em
// _shared/mercadopago.ts), e a janela sã (`expiracaoRealinhavel`, testada
// isoladamente acima) é checada contra o RELÓGIO REAL (o handler não tem um
// hook de `agora` injetável, igual a `podeCobrar(pedido, new Date())` mais
// acima) — por isso estes testes usam `Date.now()` para montar um vencimento
// relativo ao instante em que o teste roda, em vez de uma data fixa.

/** Mesmo corpo de `fetchFalsoMP`, mas com `date_of_expiration` como
 * PARÂMETRO — usado pelos testes de CONTRASTE do realinhamento (Achado 3 da
 * revisão, 14/08/2026): a mesma function, chamada duas vezes no mesmo teste,
 * com só esse campo mudando entre as chamadas. `undefined` reproduz a
 * resposta sem o campo (comportamento de hoje, sem erro). */
function fetchFalsoComExpiracao(dataExpiracao?: string) {
  return async (_url: string, _init?: RequestInit) =>
    new Response(
      JSON.stringify({
        id: "ORD999",
        status: "action_required",
        status_detail: "waiting_transfer",
        transactions: {
          payments: [
            {
              id: "PAY999",
              ...(dataExpiracao ? { date_of_expiration: dataExpiracao } : {}),
              payment_method: {
                qr_code: "QRCODE-PADRAO",
                qr_code_base64: "QRBASE64-PADRAO",
                ticket_url: "https://www.mercadopago.com.br/sandbox/payments/999/ticket",
              },
            },
          ],
        },
      }),
      { status: 201 },
    );
}

Deno.test("handler: PIX com date_of_expiration na janela sã REALINHA expires_at no banco, e a RESPOSTA usa o prazo NOVO — não o antigo lido antes do UPDATE", async () => {
  // A armadilha do plano: `pedido` é lido ANTES do UPDATE, então
  // `pedido.expires_at` (2099, bem longe do vencimento real do QR) mentiria
  // se a resposta usasse essa variável em memória em vez do que foi gravado.
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const pedido = pedidoBase({ user_id: DONO_LOGADO }); // expires_at: "2099-01-01T00:00:00.000Z"
  const dataExpiracaoNova = new Date(Date.now() + 20 * 60 * 1000).toISOString();
  const registro: {
    chamadasUpdate: number;
    filtrosUpdate?: Array<[string, unknown]>;
    valoresUpdate?: Record<string, unknown>;
  } = { chamadasUpdate: 0 };
  const supabase = clienteFalso({
    pedido,
    // O que o postgrest devolveria de verdade: a linha JÁ com o expires_at novo.
    gravado: { id: UUID, expires_at: dataExpiracaoNova },
    registro,
  });
  const fetchImpl = async (_url: string, _init?: RequestInit) =>
    new Response(
      JSON.stringify({
        id: "ORD999",
        status: "action_required",
        status_detail: "waiting_transfer",
        transactions: {
          payments: [
            {
              id: "PAY999",
              date_of_expiration: dataExpiracaoNova,
              payment_method: { qr_code: "QRCODE-PADRAO" },
            },
          ],
        },
      }),
      { status: 201 },
    );

  const resposta = await handler(
    requisicao({ orderId: UUID, metodo: "pix" }, montarToken(DONO_LOGADO)),
    { supabase, fetchImpl },
  );
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  assertEquals(registro.valoresUpdate?.expires_at, dataExpiracaoNova);
  assertEquals(corpo.expiraEm, dataExpiracaoNova);
  // A prova de que a armadilha foi evitada: a resposta NÃO é o valor antigo.
  assertEquals(corpo.expiraEm !== pedido.expires_at, true);
});

Deno.test("handler: PIX sem date_of_expiration não mexe em expires_at — comportamento de hoje, sem erro (contraste: com o campo presente, mexe)", async () => {
  // Correção pós-revisão (Achado 3): a asserção "expires_at não é tocado"
  // sozinha é VÁCUA — nada neste teste jamais tentaria escrever a coluna de
  // qualquer jeito, então ela passaria igual mesmo com o realinhamento
  // inteiro removido do arquivo. O Bloco 2 é o CONTRASTE que dá dente: MESMO
  // pedido, MESMA function, só a resposta do MP muda para incluir
  // date_of_expiration — aí sim a coluna é escrita. Sem o Bloco 2, o Bloco 1
  // não prova nada sobre o comportamento do código, só sobre o fixture.
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const pedido = pedidoBase({ user_id: DONO_LOGADO }); // expires_at: "2099-01-01T00:00:00.000Z"

  // --- Bloco 1: SEM date_of_expiration — comportamento de hoje, sem erro.
  const registroSemCampo: {
    chamadasUpdate: number;
    valoresUpdate?: Record<string, unknown>;
  } = { chamadasUpdate: 0 };
  const supabaseSemCampo = clienteFalso({
    pedido,
    // O que o postgrest devolveria de verdade: expires_at INTOCADO, igual ao
    // que já estava no pedido — o UPDATE não tocou essa coluna.
    gravado: { id: UUID, expires_at: pedido.expires_at },
    registro: registroSemCampo,
  });
  const respostaSemCampo = await handler(
    requisicao({ orderId: UUID, metodo: "pix" }, montarToken(DONO_LOGADO)),
    {
      supabase: supabaseSemCampo,
      fetchImpl: fetchFalsoComExpiracao(), // resposta padrão, sem date_of_expiration
    },
  );
  const corpoSemCampo = await respostaSemCampo.json();

  assertEquals(respostaSemCampo.status, 200);
  assertEquals("expires_at" in (registroSemCampo.valoresUpdate ?? {}), false);
  assertEquals(corpoSemCampo.expiraEm, pedido.expires_at);

  // --- Bloco 2 (o contraste): COM date_of_expiration dentro da janela sã.
  const dataDentroDaJanela = new Date(Date.now() + 20 * 60 * 1000).toISOString();
  const registroComCampo: {
    chamadasUpdate: number;
    valoresUpdate?: Record<string, unknown>;
  } = { chamadasUpdate: 0 };
  const supabaseComCampo = clienteFalso({
    pedido,
    gravado: { id: UUID, expires_at: dataDentroDaJanela },
    registro: registroComCampo,
  });
  const respostaComCampo = await handler(
    requisicao({ orderId: UUID, metodo: "pix" }, montarToken(DONO_LOGADO)),
    {
      supabase: supabaseComCampo,
      fetchImpl: fetchFalsoComExpiracao(dataDentroDaJanela),
    },
  );
  const corpoComCampo = await respostaComCampo.json();

  assertEquals(respostaComCampo.status, 200);
  assertEquals(registroComCampo.valoresUpdate?.expires_at, dataDentroDaJanela);
  assertEquals(corpoComCampo.expiraEm, dataDentroDaJanela);
});

Deno.test("handler: PIX com date_of_expiration fora da janela sã (24h à frente, o default do MP) não mexe em expires_at e avisa por log (contraste: dentro da janela, mexe e não avisa)", async () => {
  // Correção pós-revisão (Achado 3): antes deste contraste, só a asserção do
  // `console.warn` tinha dente de verdade, e só contra a REMOÇÃO TOTAL do
  // realinhamento — "expires_at não é tocado" sozinha não distinguia "a
  // janela sã recusou este valor específico" de "esta function nunca escreve
  // a coluna". O Bloco 2 é a MESMA function, no MESMO teste, com uma data
  // DENTRO da janela sã — prova que o Bloco 1 recusa pela DATA, não porque a
  // escrita esteja quebrada ou ausente.
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const pedido = pedidoBase({ user_id: DONO_LOGADO }); // expires_at: "2099-01-01T00:00:00.000Z"
  const dataForaDaJanela = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  // --- Bloco 1: FORA da janela sã (24h à frente — o default do MP quando
  // expiration_time falha em silêncio).
  const registroFora: {
    chamadasUpdate: number;
    valoresUpdate?: Record<string, unknown>;
  } = { chamadasUpdate: 0 };
  const supabaseFora = clienteFalso({
    pedido,
    gravado: { id: UUID, expires_at: pedido.expires_at },
    registro: registroFora,
  });

  const avisos: unknown[][] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    avisos.push(args);
  };
  let respostaFora: Response;
  try {
    respostaFora = await handler(
      requisicao({ orderId: UUID, metodo: "pix" }, montarToken(DONO_LOGADO)),
      {
        supabase: supabaseFora,
        fetchImpl: fetchFalsoComExpiracao(dataForaDaJanela),
      },
    );
  } finally {
    console.warn = originalWarn;
  }
  const corpoFora = await respostaFora.json();

  assertEquals(respostaFora.status, 200);
  assertEquals("expires_at" in (registroFora.valoresUpdate ?? {}), false);
  assertEquals(corpoFora.expiraEm, pedido.expires_at);
  const juntos = avisos.map((a) => a.join(" ")).join("\n");
  assertEquals(juntos.includes(dataForaDaJanela), true);

  // --- Bloco 2 (o contraste): a MESMA function, DENTRO da janela sã.
  const dataDentroDaJanela = new Date(Date.now() + 20 * 60 * 1000).toISOString();
  const registroDentro: {
    chamadasUpdate: number;
    valoresUpdate?: Record<string, unknown>;
  } = { chamadasUpdate: 0 };
  const supabaseDentro = clienteFalso({
    pedido,
    gravado: { id: UUID, expires_at: dataDentroDaJanela },
    registro: registroDentro,
  });
  const respostaDentro = await handler(
    requisicao({ orderId: UUID, metodo: "pix" }, montarToken(DONO_LOGADO)),
    {
      supabase: supabaseDentro,
      fetchImpl: fetchFalsoComExpiracao(dataDentroDaJanela),
    },
  );
  const corpoDentro = await respostaDentro.json();

  assertEquals(respostaDentro.status, 200);
  assertEquals(registroDentro.valoresUpdate?.expires_at, dataDentroDaJanela);
  assertEquals(corpoDentro.expiraEm, dataDentroDaJanela);
});

// Achado 1 da revisão (14/08/2026): prova de ponta a ponta, pela FIAÇÃO real
// do handler — não só pela função pura expiracaoRealinhavel acima — de que a
// janela sã do realinhamento acompanha o prazo REALMENTE mandado ao MP
// (`deps.expiracaoPix`), em vez de ficar presa num "30" hardcoded em algum
// lugar do handler. Se alguém trocar só a literal de `criar-pagamento/
// index.ts` (hoje "PT30M") por outro valor sem religar a janela ao mesmo
// valor, este teste reprova: com o prazo real de 45 min, um vencimento de 40
// min à frente cai FORA da janela de 35 min (30+5) que o código hardcoded
// produzia antes da correção, e DENTRO da janela de 50 min (45+5) que a
// versão corrigida deriva do mesmo valor mandado ao MP.
Deno.test("handler: quando o prazo do PIX mandado ao MP muda (deps.expiracaoPix), a janela sã do realinhamento acompanha — não fica presa em 30 minutos", async () => {
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const pedido = pedidoBase({ user_id: DONO_LOGADO }); // expires_at: "2099-01-01T00:00:00.000Z"
  const dataExpiracaoNova = new Date(Date.now() + 40 * 60 * 1000).toISOString();
  const registro: {
    chamadasUpdate: number;
    filtrosUpdate?: Array<[string, unknown]>;
    valoresUpdate?: Record<string, unknown>;
  } = { chamadasUpdate: 0 };
  const supabase = clienteFalso({
    pedido,
    gravado: { id: UUID, expires_at: dataExpiracaoNova },
    registro,
  });
  const fetchImpl = async (_url: string, _init?: RequestInit) =>
    new Response(
      JSON.stringify({
        id: "ORD999",
        status: "action_required",
        status_detail: "waiting_transfer",
        transactions: {
          payments: [
            {
              id: "PAY999",
              date_of_expiration: dataExpiracaoNova,
              payment_method: { qr_code: "QRCODE-PADRAO" },
            },
          ],
        },
      }),
      { status: 201 },
    );

  const resposta = await handler(
    requisicao({ orderId: UUID, metodo: "pix" }, montarToken(DONO_LOGADO)),
    { supabase, fetchImpl, expiracaoPix: "PT45M" },
  );
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  assertEquals(registro.valoresUpdate?.expires_at, dataExpiracaoNova);
  assertEquals(corpo.expiraEm, dataExpiracaoNova);
});

Deno.test("handler: pedido que já tem gateway_payment_id vai para o ramo de RECONSULTA — nunca recalcula nem regrava expires_at (idempotência do realinhamento)", async () => {
  // A idempotência do UPDATE (podeCobrar recusa/reconsulta pedido com
  // gateway_payment_id preenchido, e o WHERE .is('gateway_payment_id', null)
  // protege contra corrida) já garante que este bloco de código só executa
  // NO MÁXIMO uma vez por pedido — este teste prova que o ramo de
  // reconsulta, que NÃO passa por aqui, continua sem tocar expires_at nem
  // fazer UPDATE.
  //
  // Correção pós-revisão (Achado 3): a versão anterior deste teste era
  // tautológica — a resposta mockada nunca trazia `date_of_expiration`, então
  // "reconsulta não regrava expires_at" já seria verdade mesmo que o
  // realinhamento nunca tivesse sido escrito no arquivo inteiro. Aqui a
  // resposta da reconsulta TRAZ um `date_of_expiration` dentro da janela sã
  // — exatamente o formato que, no ramo de CRIAÇÃO, dispararia o
  // realinhamento (ver o teste "REALINHA expires_at" acima). A prova real de
  // idempotência é que o ramo de RECONSULTA ignora esse mesmo sinal: nem
  // chama UPDATE, nem troca `expiraEm` pelo valor novo na resposta.
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const pedido = pedidoBase({ gateway_payment_id: "ORD789" }); // expires_at: "2099-01-01T00:00:00.000Z"
  const dataDentroDaJanela = new Date(Date.now() + 20 * 60 * 1000).toISOString();
  const registro = { chamadasUpdate: 0 };
  const supabase = clienteFalso({ pedido, gravado: { id: UUID }, registro });
  const fetchImpl = async (_url: string, _init?: RequestInit) =>
    new Response(
      JSON.stringify({
        id: "ORD789",
        status: "action_required",
        status_detail: "waiting_transfer",
        transactions: {
          payments: [
            {
              id: "PAY789",
              date_of_expiration: dataDentroDaJanela,
              payment_method: { qr_code: "QRCODE-DA-RECONSULTA" },
            },
          ],
        },
      }),
      { status: 200 },
    );

  const resposta = await handler(requisicao({ orderId: UUID, metodo: "pix" }), {
    supabase,
    fetchImpl,
  });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  assertEquals(registro.chamadasUpdate, 0);
  // A prova que dá dente ao teste: o `date_of_expiration` da resposta é
  // IGNORADO — `expiraEm` continua sendo o `expires_at` original do pedido,
  // não o valor novo que a resposta trouxe.
  assertEquals(corpo.expiraEm, pedido.expires_at);
  assertEquals(corpo.expiraEm !== dataDentroDaJanela, true);
});

Deno.test("handler: o throw de montarCorpoPixOrders (expiração fora da faixa) não vira 500 cru — devolve JSON recuperável, sem chamar o MP", async () => {
  // montarCorpoPixOrders LANÇA se a expiração faltar ou for inválida — o
  // arquivo hoje monta uma constante controlada ("PT30M"), mas o comentário
  // do handler já avisa que "nenhum caminho aqui pode rejeitar" DEIXOU DE
  // SER VERDADE. `deps.expiracaoPix` é a mesma costura de `deps.fetchImpl`
  // (ver comentário grande acima de `handler` em index.ts): sem ela não tem
  // como este teste alcançar o catch sem depender de um bug de verdade no
  // arquivo.
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const pedido = pedidoBase({ user_id: DONO_LOGADO });
  const supabase = clienteFalso({ pedido, gravado: { id: UUID } });
  let chamouFetch = false;
  const fetchImpl = async (_url: string, _init?: RequestInit) => {
    chamouFetch = true;
    return new Response(JSON.stringify({ id: "ORD1" }), { status: 201 });
  };

  const resposta = await handler(
    requisicao({ orderId: UUID, metodo: "pix" }, montarToken(DONO_LOGADO)),
    {
      supabase,
      fetchImpl,
      expiracaoPix: "PT5M", // abaixo do mínimo de 30 — força o throw
    },
  );
  const corpo = await resposta.json();

  assertEquals(resposta.status, 502);
  assertEquals(typeof corpo.error, "string");
  assertEquals(chamouFetch, false);
});

// BLOQUEIO 1 da revisão (CHECKOUT-070): a detecção de ambiente pelo PREFIXO
// do token (TEST-/APP_USR-) é NÃO-DISCRIMINANTE — medido nesta sessão que a
// aplicação "API de Orders" do MP dá um Access Token de TESTE com prefixo
// APP_USR (75 chars), igual ao de produção. Os dois testes que codificavam
// essa regra falsa (o de "sandbox troca o e-mail" e o de "produção mantém o
// e-mail", ambos usando `startsWith`) morreram com a heurística — ela nunca
// classificava certo, e em produção o ramo `true` nem chegava a nunca
// ser 'false' por acidente (ambiente vira CONFIGURAÇÃO, MP_SANDBOX_PAYER_EMAIL,
// não dedução do formato da credencial.
Deno.test("handler: MP_SANDBOX_PAYER_EMAIL presente troca o e-mail do pagador e liga payer.first_name = 'APRO'", async () => {
  // 'APRO' é o valor mágico que a doc oficial de teste de PIX exige
  // (checkout-api-orders/integration-test/pix) para a order de TESTE
  // responder como esperado — sem ele o sandbox não simula o fluxo completo.
  Deno.env.set("MP_ACCESS_TOKEN", "APP_USR-1234567890");
  Deno.env.set("MP_SANDBOX_PAYER_EMAIL", "sandbox-pix@testuser.com");
  try {
    const pedido = pedidoBase({ customer_data: { email: "cliente-real@exemplo.com" }, user_id: DONO_LOGADO });
    const supabase = clienteFalso({ pedido, gravado: { id: UUID } });
    const capturado: { corpo?: Record<string, unknown> } = {};
    const fetchImpl = fetchFalsoMP(capturado);

    await handler(requisicao({ orderId: UUID, metodo: "pix" }, montarToken(DONO_LOGADO)), {
      supabase,
      fetchImpl,
    });

    const payer = capturado.corpo?.payer as Record<string, unknown>;
    assertEquals(payer.email, "sandbox-pix@testuser.com");
    assertEquals(payer.first_name, "APRO");
  } finally {
    // try/finally: se uma asserção falhar antes deste ponto, a variável não
    // vaza para o teste seguinte (achado da revisão).
    Deno.env.delete("MP_SANDBOX_PAYER_EMAIL");
  }
});

Deno.test("handler: MP_SANDBOX_PAYER_EMAIL ausente mantém o e-mail real do cliente e não define first_name", async () => {
  Deno.env.set("MP_ACCESS_TOKEN", "APP_USR-1234567890");
  Deno.env.delete("MP_SANDBOX_PAYER_EMAIL");
  const pedido = pedidoBase({ customer_data: { email: "cliente-real@exemplo.com" }, user_id: DONO_LOGADO });
  const supabase = clienteFalso({ pedido, gravado: { id: UUID } });
  const capturado: { corpo?: Record<string, unknown> } = {};
  const fetchImpl = fetchFalsoMP(capturado);

  await handler(requisicao({ orderId: UUID, metodo: "pix" }, montarToken(DONO_LOGADO)), {
      supabase,
      fetchImpl,
    });

  const payer = capturado.corpo?.payer as Record<string, unknown>;
  assertEquals(payer.email, "cliente-real@exemplo.com");
  assertEquals("first_name" in payer, false);
});

Deno.test("handler: MP_SANDBOX_PAYER_EMAIL definida e VAZIA se comporta como ausente — mantém o e-mail real e não define first_name", async () => {
  // BLOQUEIO da revisão: a mesma variável era lida com DUAS semânticas de
  // vazio a 5 linhas de distância — truthy (:417, "" é AUSENTE, decide não
  // ligar 'APRO') vs nullish (:424, "" é PRESENTE, `?? String(email)` não
  // troca por nada). Resultado medido: `payer.email` virava "" — o e-mail
  // REAL do cliente descartado, sem first_name — e um 400 do MP para toda
  // venda PIX daquela loja. Realista porque `MP_SANDBOX_PAYER_EMAIL` não é
  // documentada em lugar nenhum do repositório: quem quiser DESLIGAR o
  // sandbox pelo painel do Supabase vai limpar o campo, não apagar o
  // secret — e limpar produz exatamente "".
  Deno.env.set("MP_ACCESS_TOKEN", "APP_USR-1234567890");
  Deno.env.set("MP_SANDBOX_PAYER_EMAIL", "");
  try {
    const pedido = pedidoBase({ customer_data: { email: "cliente-real@exemplo.com" }, user_id: DONO_LOGADO });
    const supabase = clienteFalso({ pedido, gravado: { id: UUID } });
    const capturado: { corpo?: Record<string, unknown> } = {};
    const fetchImpl = fetchFalsoMP(capturado);

    await handler(requisicao({ orderId: UUID, metodo: "pix" }, montarToken(DONO_LOGADO)), {
      supabase,
      fetchImpl,
    });

    const payer = capturado.corpo?.payer as Record<string, unknown>;
    assertEquals(payer.email, "cliente-real@exemplo.com");
    assertEquals("first_name" in payer, false);
  } finally {
    // try/finally: mesma razão do teste acima — não vazar a variável se uma
    // asserção falhar antes.
    Deno.env.delete("MP_SANDBOX_PAYER_EMAIL");
  }
});

Deno.test("handler: MP_SANDBOX_PAYER_EMAIL definida só com espaços/tab se comporta como ausente — mantém o e-mail real e não define first_name", async () => {
  // HIGIENE da revisão: mesma família do bloqueio de "" acima, gatilho mais
  // estreito. "   ", "\t" e "email@testuser.com\n" são todos truthy — o
  // `|| undefined` sozinho NÃO os trata como ausentes, então o lixo (não
  // uma string vazia) vira `payer.email`, descartando o e-mail real do
  // cliente. `?.trim() || undefined` fecha a família inteira.
  Deno.env.set("MP_ACCESS_TOKEN", "APP_USR-1234567890");
  Deno.env.set("MP_SANDBOX_PAYER_EMAIL", "   ");
  try {
    const pedido = pedidoBase({ customer_data: { email: "cliente-real@exemplo.com" }, user_id: DONO_LOGADO });
    const supabase = clienteFalso({ pedido, gravado: { id: UUID } });
    const capturado: { corpo?: Record<string, unknown> } = {};
    const fetchImpl = fetchFalsoMP(capturado);

    await handler(requisicao({ orderId: UUID, metodo: "pix" }, montarToken(DONO_LOGADO)), {
      supabase,
      fetchImpl,
    });

    const payer = capturado.corpo?.payer as Record<string, unknown>;
    assertEquals(payer.email, "cliente-real@exemplo.com");
    assertEquals("first_name" in payer, false);
  } finally {
    Deno.env.delete("MP_SANDBOX_PAYER_EMAIL");
  }
});

Deno.test("handler: MP_SANDBOX_PAYER_EMAIL presente avisa por log qual e-mail está substituindo o do cliente", async () => {
  // ANOTADO 1 da revisão: com a variável setada num deploy de PRODUÇÃO
  // (o gatilho real é o primeiro clone que copiar env de um deploy de
  // desenvolvimento), o e-mail do cliente era trocado em silêncio — zero
  // linha de log. Nada quebrava alto; só ficava errado.
  Deno.env.set("MP_ACCESS_TOKEN", "APP_USR-1234567890");
  Deno.env.set("MP_SANDBOX_PAYER_EMAIL", "qa-interno@ikcous.com.br");
  const pedido = pedidoBase({ customer_data: { email: "cliente-real@exemplo.com" }, user_id: DONO_LOGADO });
  const supabase = clienteFalso({ pedido, gravado: { id: UUID } });
  const fetchImpl = fetchFalsoMP({});

  const avisos: unknown[][] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    avisos.push(args);
  };
  try {
    await handler(requisicao({ orderId: UUID, metodo: "pix" }, montarToken(DONO_LOGADO)), {
      supabase,
      fetchImpl,
    });
  } finally {
    console.warn = originalWarn;
    Deno.env.delete("MP_SANDBOX_PAYER_EMAIL");
  }

  const juntos = avisos.map((a) => a.join(" ")).join("\n");
  assertEquals(juntos.includes("qa-interno@ikcous.com.br"), true);
  // HIGIENE da revisão: o teste só travava o e-mail de sandbox aparecendo,
  // não travava o e-mail do CLIENTE não aparecendo. Medido pela revisão em 7
  // valores diferentes: não aparece — mas sem esta asserção, um regressão
  // que vazasse o e-mail real do cliente no log (dívida de PII já conhecida
  // neste repositório) passaria despercebida.
  assertEquals(juntos.includes("cliente-real@exemplo.com"), false);
});

// --- CHECKOUT-080 (#213): `traduzirStatusOrderParaClassico` foi apagada —
// o front lia `r.status` contra o vocabulário CLÁSSICO do MP ("rejected"/
// "cancelled" terminais; "pending"/"in_process"/"approved"/"authorized"
// conhecidos), e essa tradução só existia porque migrar o front era escopo
// de outra tarefa. Agora `criar-pagamento` emite direto o `payment_status`
// que este banco já usa ('aguardando'/'pago'/'recusado'/'expirado'/
// 'estornado', o MESMO conjunto que webhook-mercadopago e
// reconciliar-pagamentos já gravam), no campo `statusPagamento`. A intenção
// dos testes que existiam aqui (waiting_transfer vira um valor que o front
// reconhece; default customizado só para quem acabou de receber 201; par
// desconhecido nunca vira um valor conhecido por engano) sobrevive, só que
// coberta em outros dois lugares agora:
//   - a tabela pura (par → payment_status), incluindo os 13 pares e o
//     `null` para desconhecido, em mercadopago_test.ts ("mapearStatusOrder");
//   - a fiação por RAMO (qual default cada um usa), nos testes de `handler`
//     logo acima ("reconsulta LEGADA traduz 'approved'...", "PIX com par
//     conhecido e recusado no ramo de CRIAÇÃO...", "PIX com status
//     desconhecido no ramo de CRIAÇÃO vira 'aguardando'...") e no teste
//     abaixo, que fecha a combinação que faltava: par DESCONHECIDO no ramo
//     de RECONSULTA.

Deno.test("handler: reconsulta (Orders) com par DESCONHECIDO devolve o par CRU 'status:status_detail' — diferente do default 'aguardando' do ramo de CRIAÇÃO", async () => {
  // Contraste deliberado com "PIX com status desconhecido no ramo de
  // CRIAÇÃO vira 'aguardando'": aqui a cobrança JÁ EXISTE (gateway_payment_id
  // preenchido) — não há QR novo em jogo, então o par cru (que o front
  // trata como terminal) é o desfecho aceitável, igual ao comportamento
  // de hoje.
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const pedido = pedidoBase({ gateway_payment_id: "ORD444" });
  const supabase = clienteFalso({ pedido, gravado: { id: UUID } });
  const fetchImpl = async (_url: string, _init?: RequestInit) =>
    new Response(
      JSON.stringify({
        id: "ORD444",
        status: "um_status_novo",
        status_detail: "um_detalhe_novo",
      }),
      { status: 200 },
    );

  const resposta = await handler(requisicao({ orderId: UUID, metodo: "pix" }), {
    supabase,
    fetchImpl,
  });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  assertEquals(corpo.statusPagamento, "um_status_novo:um_detalhe_novo");
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

// --- handler: ANOTADO 2 da revisão — três invariantes certas, sem teste ---

Deno.test("handler: id de ORDER com falha na Orders API (500) NÃO cai para o endpoint clássico — o roteamento é pela FORMA do id, não pelo erro", async () => {
  // Correção pós-revisão (CHECKOUT-070): o roteamento não olha mais o
  // código de erro HTTP — olha a FORMA do `gateway_payment_id` (`idEhClassico`,
  // `_shared/mercadopago.ts`). "ORD500" não é forma clássica (não é só
  // dígitos), então vai para consultarOrder e fica lá, mesmo se a Orders API
  // falhar com 500: um id de ORDER nunca é reconhecido pelo endpoint
  // clássico, e cair nele desperdiçaria uma chamada que sempre falha.
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const pedido = pedidoBase({ gateway_payment_id: "ORD500" });
  const supabase = clienteFalso({ pedido, gravado: null });
  const urlsChamadas: string[] = [];
  const fetchImpl = async (url: string, _init?: RequestInit) => {
    urlsChamadas.push(url);
    return new Response(JSON.stringify({ message: "Internal Server Error" }), { status: 500 });
  };

  const resposta = await handler(requisicao({ orderId: UUID, metodo: "pix" }), {
    supabase,
    fetchImpl,
  });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 502);
  assertEquals(corpo.terminal, undefined);
  // A prova que importa: só UMA chamada, ao endpoint de order — nunca tenta
  // o clássico para um erro que não é 404.
  assertEquals(urlsChamadas.length, 1);
  assertEquals(urlsChamadas[0].includes("/v1/orders/ORD500"), true);
});

Deno.test("handler: id legado com falha no clássico devolve erro SEM terminal — continua recuperável, sem tocar a Orders API", async () => {
  // Mutação da revisão: acrescentar `terminal: true` neste ponto de retorno
  // (o `if (!classico.ok) return json({ error: classico.erro }, 502)` do
  // ramo legado) passa despercebida sem este teste. Nada foi gravado no
  // pedido — o ramo é só consulta —, então um retry é seguro assim que o MP
  // responder; marcar como definitivo prenderia o cliente sem "Tentar de
  // novo" por um soluço passageiro do gateway.
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const pedido = pedidoBase({ gateway_payment_id: "112233445566" });
  const supabase = clienteFalso({ pedido, gravado: null });
  const fetchImpl = async (url: string, _init?: RequestInit) => {
    if (url.includes("/v1/orders/")) {
      throw new Error(`fetch inesperado nos testes: ${url} — id legado não pode tocar a Orders API`);
    }
    // /v1/payments/{id} — o endpoint clássico falha.
    return new Response(JSON.stringify({ message: "Internal Server Error" }), { status: 500 });
  };

  const resposta = await handler(requisicao({ orderId: UUID, metodo: "pix" }), {
    supabase,
    fetchImpl,
  });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 502);
  assertEquals(corpo.terminal, undefined);
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
      // BLOQUEIO 3 da revisão (CHECKOUT-070): o fallback para o endpoint
      // clássico (consultarPagamento) quando consultarOrder devolve 404 (id
      // legado, criado antes desta migração). Mesma categoria de "r.erro"
      // acima — o MP não respondeu (desta vez pelo caminho clássico), nada
      // foi gravado, retry é seguro.
      "classico.erro",
      "o Mercado Pago não respondeu pelo endpoint clássico (fallback de id " +
        "legado); nada foi gravado no pedido, retry é seguro",
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
    [
      // Tarefa 2 (CHECKOUT-070): montarCorpoPixOrders LANÇA se a expiração
      // faltar ou for inválida. Aqui ela nasce de uma constante controlada
      // por ESTE arquivo ("PT30M") — um throw só acontece por bug de
      // configuração deste servidor, nunca por entrada do cliente, mesma
      // categoria de "Pagamento indisponível." acima. Nada foi cobrado nem
      // gravado quando isto acontece (o catch está ANTES de chamar o MP).
      "Não foi possível gerar a cobrança.",
      "montarCorpoPixOrders rejeitou a expiração — bug de configuração " +
        "deste servidor, não do pedido; nada foi cobrado ainda",
    ],
    [
      // Defensivo: criarOrder já garante que a resposta 2xx tem `id`, então
      // extrairQrCode só devolveria orderId nulo se a ORDER em si vier
      // ilegível (null/undefined/não-objeto) — o que criarOrder também já
      // trata como falha. Praticamente inalcançável, mas sem isto um bug de
      // formato na resposta do MP gravaria gateway_payment_id = "null"
      // (String(null)) em vez de recusar.
      "Resposta inválida do gateway.",
      "a ORDER 2xx não trouxe um id utilizável; nada foi gravado, retry é seguro",
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
  // 19, não mais 18: PEDIDO-07 (auditoria de 26/08/2026) envolveu o
  // createClient() do client real (usado quando `deps.supabase` não vem, o
  // caso de produção) num try/catch — antes ele ficava fora de qualquer
  // try, e uma falha de configuração (chave ausente) escapava o handler
  // inteiro como throw, não como `json(...)`. O catch novo reusa o MESMO
  // literal "Pagamento indisponível." que a checagem de MP_ACCESS_TOKEN já
  // usa (mesma categoria: bug de configuração deste servidor, não do
  // pedido) — por isso não precisou de entrada NOVA em recuperaveisConhecidas,
  // só mais uma ocorrência do mesmo identificador.
  //
  // 18, não mais 17: pagamento online exige conta (decisão do Gabriel,
  // 16/08/2026) acrescentou um ponto de retorno novo — `if (pedido.user_id
  // === null) return json({ error: ..., code: "PAGAMENTO_ONLINE_EXIGE_
  // CONTA", terminal: true }, 403);`, entre o ramo "reconsultar" e o ramo
  // "criar". Já leva `terminal: true` no literal — não precisou entrar na
  // lista de recuperáveis conhecidas.
  //
  // 17, não mais 16: BLOQUEIO 3 da revisão (CHECKOUT-070) acrescentou o
  // fallback para o endpoint clássico dentro do ramo "reconsultar" — um
  // `if (!classico.ok) return json({ error: classico.erro }, 502);` novo,
  // que só existe para o id LEGADO (criado antes desta migração) que o
  // Orders API não reconhece.
  //
  // 16, não mais 13: a Tarefa 2 (CHECKOUT-070, migração de PIX para a Orders
  // API) split o ramo "criar" em PIX/Orders e cartão/clássico — cada um com
  // seu próprio `if (!r.ok) return json({ error: r.erro }, 502);` (mais um
  // "r.erro" do que antes, quando os dois métodos compartilhavam o mesmo
  // ponto de retorno) — e acrescentou dois pontos de retorno NOVOS,
  // exclusivos do caminho PIX: o catch do throw de montarCorpoPixOrders
  // (502, "Não foi possível gerar a cobrança.") e a defesa contra ORDER 2xx
  // sem id utilizável (502, "Resposta inválida do gateway."). Antes: 13, não
  // mais 12 — o antigo `if (error || !pedido) ...` (um só ponto de retorno)
  // virou dois — falha de LEITURA (503) e "não existe" (404) — porque as
  // duas causas eram opostas e tinham que responder diferente (achado da
  // revisão do CHECKOUT-050, #194).
  assertEquals(achados, 19);
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

// LAUDO 31/08 (menor E5): o e-mail do JWT de sessão entra na corrente do
// pagador antes do fallback `sem-email@ikcous.com.br` — o MP passa a ver
// quem de verdade paga quando o front e o pedido não trouxeram e-mail.

Deno.test("emailDoToken lê o claim de e-mail do token de sessão", () => {
  const payload = btoa(JSON.stringify({ sub: UUID, email: "joana@exemplo.com" }))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const token = `cabecalho.${payload}.assinatura`;
  assertEquals(emailDoToken(token), "joana@exemplo.com");
});

Deno.test("emailDoToken: sem claim de e-mail, lixo ou e-mail sem @ devolve null", () => {
  const payload = btoa(JSON.stringify({ sub: UUID }))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  assertEquals(emailDoToken(`cabecalho.${payload}.assinatura`), null);
  assertEquals(emailDoToken("lixo-nao-jwt"), null);
  assertEquals(emailDoToken(null), null);
  const semArroba = btoa(JSON.stringify({ email: "nao-e-email" }))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  assertEquals(emailDoToken(`cabecalho.${semArroba}.assinatura`), null);
});
