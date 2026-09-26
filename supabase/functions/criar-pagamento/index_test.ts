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
  chaveDeIdempotencia,
  descricaoDoPedido,
  donoConfere,
  emailDoToken,
  expiracaoRealinhavel,
  handler,
  MENSAGEM_CREDENCIAL_RECUSADA,
  pareceUuid,
  podeCobrar,
  subDoToken,
  validarCorpoDoCartao,
} from "./index.ts";
// Tarefa mp-2: as MESMAS primitivas de cifra da produção montam o registro
// do lojista nos testes do fim deste arquivo — fixture escrito à mão não
// provaria que a function decifra de verdade. Desde a tarefa mp-6 o fixture
// vem PRONTO de `_shared/credenciais-mp_fixtures.ts`: era a mesma montagem
// copiada em cinco suítes, e cópia de fixture envelhece calada.
import {
  CHAVE_CIFRA_TESTE,
  registroMpDeTeste,
  TOKEN_AMBIENTE_FALSO as TOKEN_PLATAFORMA_FALSO,
  TOKEN_LOJISTA_FALSO,
} from "../_shared/credenciais-mp_fixtures.ts";

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
  // Tarefa mp-2: o registro CIFRADO do lojista, como ele dorme em
  // app_settings (`_shared/credenciais-mp.ts`). Default ausente — a loja
  // que ainda roda pelas chaves da plataforma, que é o que todos os testes
  // anteriores a esta tarefa exercitam.
  registroMp?: Record<string, unknown> | null;
  // Fase 3.5 (cartão): a linha `id = 1` de `config_pagamento_cartao`.
  // Default AUSENTE — a loja que nunca ligou o cartão, que é como a linha
  // nasce. `erroConfigCartao` simula falha de leitura dessa tabela.
  configCartao?: Record<string, unknown> | null;
  erroConfigCartao?: Record<string, unknown> | null;
  leiturasConfigCartao?: Array<{ colunas: string; filtro: [string, unknown] }>;
  // `rpc("liberar_cobranca_do_pedido")`: registra nome + argumentos de TODA
  // rpc chamada (uma rpc inesperada — `confirmar_pagamento`, por exemplo —
  // aparece aqui e a asserção do teste acusa). `resultadoLiberar` é o
  // boolean que a RPC devolve (default true); `erroLiberar` simula falha.
  chamadasRpc?: Array<{ nome: string; args: Record<string, unknown> }>;
  resultadoLiberar?: boolean;
  erroLiberar?: Record<string, unknown> | null;
}) {
  let chamadasSelect = 0;
  return {
    rpc: async (nome: string, args: Record<string, unknown>) => {
      opts.chamadasRpc?.push({ nome, args });
      if (nome !== "liberar_cobranca_do_pedido") {
        throw new Error(`rpc inesperada nos testes da criar-pagamento: ${nome}`);
      }
      if (opts.erroLiberar) return { data: null, error: opts.erroLiberar };
      return { data: opts.resultadoLiberar ?? true, error: null };
    },
    from(tabela: string) {
      if (tabela === "config_pagamento_cartao") {
        return {
          select(colunas: string) {
            return {
              eq(coluna: string, valor: unknown) {
                opts.leiturasConfigCartao?.push({ colunas, filtro: [coluna, valor] });
                return {
                  maybeSingle: async () =>
                    opts.erroConfigCartao
                      ? { data: null, error: opts.erroConfigCartao }
                      : { data: projetarColunas(opts.configCartao ?? null, colunas), error: null },
                };
              },
            };
          },
        };
      }
      // Tabela PRÓPRIA no dublê, e não a cadeia de marketplace_orders
      // abaixo: a leitura das credenciais gastaria a PRIMEIRA `select()`
      // (a que carrega `erroLeitura` e o fixture do pedido), e todo teste
      // de leitura de pedido passaria a medir outra coisa em silêncio.
      if (tabela === "app_settings") {
        return {
          select(_cols: string) {
            return {
              eq(_col: string, _val: unknown) {
                return {
                  maybeSingle: async () => ({
                    data: opts.registroMp
                      ? { value: JSON.stringify(opts.registroMp) }
                      : null,
                    error: null,
                  }),
                };
              },
            };
          },
        };
      }
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
          // Encadeador GENÉRICO (Achado A1 (2), revisão de risco 26/09/2026):
          // `.eq()`/`.is()` em qualquer QUANTIDADE, na ordem em que o
          // produção chamar — desde que o cartão parou de repetir o filtro
          // `payment_status = 'aguardando'` do PIX (ver o comentário grande
          // da gravação da vaga em index.ts), o WHERE real passou a ter DOIS
          // filtros para cartão e TRÊS para PIX. Um objeto FIXO
          // `.eq().eq().is()` (a forma de antes) só sabia reproduzir a forma
          // do PIX. `registro.filtrosUpdate` continua provando o WHERE do
          // jeito que já provava (achado da revisão de 14/08/2026, comentário
          // no teste que usa isto): a lista registrada, não a FORMA do
          // encadeamento.
          const encadeador = {
            eq(coluna: string, valor: unknown) {
              registrarFiltro(coluna, valor);
              return encadeador;
            },
            is(coluna: string, valor: unknown) {
              registrarFiltro(coluna, valor);
              return encadeador;
            },
            select(_cols: string) {
              return {
                maybeSingle: async () => ({
                  data: projetarColunas(opts.gravado, _cols),
                  error: null,
                }),
              };
            },
          };
          return encadeador;
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

Deno.test("handler: MP_ACCESS_TOKEN ausente vira 503 TERMINAL (laudo 0109, D1) — configuração de longa duração não prende o cliente no 'Tentar de novo'", async () => {
  // D1: a chave do Mercado Pago numa loja nova é cadastro na aplicação MP
  // do lojista — DIAS, não minutos. Diferente da chave de service role
  // (ajuste de operador em minutos, que segue recuperável DE PROPÓSITO),
  // retentar dentro da janela de 30 min do PIX não resolve nada: o cliente
  // sai do loop pelo contrato do CHECKOUT-050 (a categoria viaja no corpo,
  // nunca por comparação de mensagem no front).
  Deno.env.delete("MP_ACCESS_TOKEN");
  Deno.env.set("SUPABASE_URL", "https://xyz.supabase.co");
  const pedido = pedidoBase({ user_id: DONO_LOGADO });
  const supabase = clienteFalso({ pedido, gravado: { id: UUID } });

  const resposta = await handler(
    requisicao({ orderId: UUID, metodo: "pix" }, montarToken(DONO_LOGADO)),
    { supabase },
  );
  const corpo = await resposta.json();

  assertEquals(resposta.status, 503);
  assertEquals(corpo.error, "Pagamento indisponível.");
  assertEquals(corpo.terminal, true);
});

// Incidente 25/09/2026: o POST /v1/orders respondeu 401 "invalid access
// token" e a tela ficou em "Tentar de novo" — cada toque batia na mesma
// recusa, porque credencial recusada não se conserta dentro dos 30 min do
// PIX. A mesma tabela prova as duas metades: credencial recusada (401/403)
// vira terminal com frase fixa, e falha transitória (rede, 5xx, 4xx de
// corpo) continua recuperável — o conserto não pode engolir o retry que já
// funcionava.
const SEGREDO_NO_CORPO_DO_MP = "APP_USR-token-que-nao-pode-vazar";
const CONTA_NO_CORPO_DO_MP = "conta-1234567";

function fetchMPRecusando(status: number) {
  return async (_url: string, _init?: RequestInit) => {
    // status 0 = nem houve resposta HTTP (rede caiu); criarOrder trata o throw.
    if (status === 0) throw new TypeError("network error");
    return new Response(
      JSON.stringify({
        code: "unauthorized",
        message: `invalid access token ${SEGREDO_NO_CORPO_DO_MP}`,
        collector_id: CONTA_NO_CORPO_DO_MP,
      }),
      { status },
    );
  };
}

for (
  const caso of [
    { status: 401, esperado: 503, terminal: true },
    { status: 403, esperado: 503, terminal: true },
    { status: 500, esperado: 502, terminal: undefined },
    { status: 503, esperado: 502, terminal: undefined },
    { status: 400, esperado: 502, terminal: undefined },
    { status: 0, esperado: 502, terminal: undefined },
  ]
) {
  Deno.test(`handler: POST /v1/orders com status ${caso.status} devolve ${caso.esperado} ${caso.terminal ? "TERMINAL" : "recuperável"}, sem vazar o corpo do MP`, async () => {
    Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
    const pedido = pedidoBase({ user_id: DONO_LOGADO });
    const registro = { chamadasUpdate: 0 };
    const supabase = clienteFalso({ pedido, gravado: { id: UUID }, registro });

    const resposta = await handler(
      requisicao({ orderId: UUID, metodo: "pix" }, montarToken(DONO_LOGADO)),
      { supabase, fetchImpl: fetchMPRecusando(caso.status) },
    );
    const texto = await resposta.text();
    const corpo = JSON.parse(texto);

    assertEquals(resposta.status, caso.esperado);
    assertEquals(corpo.terminal, caso.terminal);
    if (caso.terminal) {
      assertEquals(corpo.error, MENSAGEM_CREDENCIAL_RECUSADA);
    } else {
      assertEquals(corpo.error === MENSAGEM_CREDENCIAL_RECUSADA, false);
    }
    // Nada do corpo cru do MP chega ao cliente — nem token, nem conta, nem
    // o texto da recusa.
    assertEquals(texto.includes(SEGREDO_NO_CORPO_DO_MP), false);
    assertEquals(texto.includes(CONTA_NO_CORPO_DO_MP), false);
    assertEquals(texto.includes("invalid access token"), false);
    assertEquals(texto.includes("token-de-teste"), false);
    // Recusa não grava cobrança no pedido.
    assertEquals(registro.chamadasUpdate, 0);
  });
}

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

// --- handler: forma de pagamento (Fase 3.5 religou o cartão) ---------------
//
// Até a Fase 3.5 o cartão era recusado aqui ("No momento aceitamos apenas
// PIX.") por causa da herança nº 2 da Fase 2. Os testes do cartão de verdade
// estão no fim deste arquivo; aqui fica o que sobrou da trava: forma que não
// é PIX nem cartão continua recusada ANTES de tocar banco ou gateway, e
// continua RECUPERÁVEL (CHECKOUT-050, #194: "Tentar de novo" remonta a
// escolha de forma, e o próprio retry troca de método).

/** Supabase que ESTOURA em qualquer uso — prova que um caminho nem chegou a
 * tocar o banco (nem para resolver credenciais). */
const supabaseIntocavel = {
  from(tabela: string) {
    throw new Error(`o banco não devia ser tocado (from ${tabela})`);
  },
  rpc(nome: string) {
    throw new Error(`o banco não devia ser tocado (rpc ${nome})`);
  },
};

Deno.test("handler: forma de pagamento desconhecida devolve 400 recuperável, sem tocar banco nem Mercado Pago", async () => {
  let chamadasFetch = 0;
  const fetchImpl = async (_url: string, _init?: RequestInit) => {
    chamadasFetch++;
    return new Response(JSON.stringify({ id: "ORD1" }), { status: 201 });
  };

  for (const metodo of ["boleto", "", undefined, "CARTAO", "Pix"]) {
    const resposta = await handler(requisicao({ orderId: UUID, metodo }), {
      supabase: supabaseIntocavel,
      fetchImpl,
    });
    const corpo = await resposta.json();
    assertEquals(resposta.status, 400, String(metodo));
    assertEquals(corpo.error, "Forma de pagamento inválida.");
    assertEquals(corpo.terminal, undefined);
  }
  assertEquals(chamadasFetch, 0);
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
      // Laudo 0109 (D1): a entrada cobre hoje SÓ o 503 de service role
      // ausente — o de MP_ACCESS_TOKEN ausente virou terminal: true
      // (cadastro de chaves MP numa loja nova leva dias; o cliente não
      // fica no loop). Ajuste de service role é de operador, em minutos:
      // retentar dentro da janela do PIX é o comportamento certo.
      "falta de env var no servidor; nada do pedido está errado",
    ],
    [
      "Não foi possível verificar o pedido.",
      "falha de LEITURA (statement timeout, pool esgotado, fetch caindo), " +
        "não 'pedido não existe' — zero linhas devolve error:null no " +
        "postgrest-js; retry é seguro assim que o banco responder",
    ],
    [
      // Fase 3.5: substitui "No momento aceitamos apenas PIX." (o cartão foi
      // religado); a categoria é a mesma de antes.
      "Forma de pagamento inválida.",
      "'Tentar de novo' remonta a escolha de forma — o próprio retry troca " +
        "de método e destrava; nada do pedido foi tocado",
    ],
    [
      "validacaoCartao.erro",
      "dado do cartão malformado (token, bandeira, tipo, parcelas, CPF/CNPJ, " +
        "e-mail): o cliente corrige ou o Brick gera um token novo; recusado " +
        "antes de tocar banco ou gateway",
    ],
    [
      "Esta forma de pagamento não está disponível nesta loja.",
      "a loja não ligou crédito/débito (ou a config não pôde ser lida): o " +
        "cliente paga com PIX, que continua disponível; nada foi tocado",
    ],
    [
      "Esse parcelamento não está disponível nesta loja.",
      "parcelas acima do teto da loja: o cliente escolhe menos parcelas; " +
        "nada foi tocado",
    ],
    [
      "Não foi possível trocar para cartão agora. Tente de novo em instantes.",
      "o MP não cancelou o PIX aberto (pago no meio do caminho, rede, 5xx) " +
        "ou a vaga tem cobrança que não se reconhece; a vaga fica intacta e " +
        "o próximo retry relê o estado real (se o PIX foi pago, vira 'pago')",
    ],
    [
      "Há um pagamento com cartão em análise para este pedido.",
      "o desfecho do cartão chega em minutos pelo webhook: aprovado, o " +
        "retry devolve 'pago'; recusado, a vaga é liberada e o PIX sai",
    ],
    [
      "Não foi possível liberar a cobrança anterior. Tente de novo em instantes.",
      "falha de banco na RPC liberar_cobranca_do_pedido; nada foi cobrado, " +
        "e o retry reencontra a cobrança morta e tenta liberar de novo",
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
  // usa (mesmo literal, categorias DIVERGENTES desde a D1 — laudo 0109: o
  // de MP token é terminal, o de service role segue recuperável; ver a
  // justificativa da entrada na lista acima) — por isso não precisou de
  // entrada NOVA em recuperaveisConhecidas, só mais uma ocorrência do
  // mesmo identificador.
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
  //
  // 20, não mais 19: incidente 25/09/2026 — o POST /v1/orders recusado com
  // 401/403 (credencial da loja) ganhou retorno próprio, `json({ error:
  // MENSAGEM_CREDENCIAL_RECUSADA, terminal: true }, 503)`, antes do
  // `r.erro` recuperável do ramo PIX. Já leva `terminal: true` no literal.
  //
  // 32, não mais 20: Fase 3.5 (cartão pela Orders API, 26/09/2026).
  // Saíram "No momento aceitamos apenas PIX." e o `r.erro` do ramo clássico
  // morto de cartão; entraram "Forma de pagamento inválida." e o `r.erro` do
  // ramo NOVO de cartão (as duas trocas empatam), e doze pontos novos: a
  // validação do corpo do cartão (`validacaoCartao.erro`), forma desligada,
  // parcelamento acima do teto, os três "Não foi possível trocar para
  // cartão agora…" (vaga clássica, tipo desconhecido, cancelamento negado),
  // cartão em análise num pedido de PIX, falha ao liberar a vaga, e os três
  // da releitura depois de liberar ("Não foi possível verificar o pedido.",
  // `decisaoDepoisDeLiberar.motivo` terminal, "Este pedido já tem uma
  // cobrança gerada."), mais o catch do construtor do corpo do cartão ("Não
  // foi possível gerar a cobrança."). A 403 de conta e a 503 de credencial
  // viraram UMA chamada cada (`respostaExigeConta`/
  // `respostaCredencialRecusada`), usadas por PIX e cartão — mesma contagem.
  // 12 + 20 = 32.
  //
  // 33, não mais 32: Achado A4 (revisão de risco, 26/09/2026) — o 400 do
  // cartão deixou de ser SEMPRE "confira os dados do cartão"
  // (`respostaRecusaDoCartao`) e ganhou um segundo ponto de retorno,
  // `if (!erro400EhDeDadoDoCartao(...)) return json({ error: r.erro }, 502);`,
  // para o 400 que NÃO é sobre o cartão (bug de integração deste servidor).
  // Mesmo identificador "r.erro" de sempre — não precisou de entrada nova em
  // `recuperaveisConhecidas`, só mais uma ocorrência dele.
  assertEquals(achados, 33);
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
  const soArroba = btoa(JSON.stringify({ email: "a@" }))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  assertEquals(emailDoToken(`cabecalho.${soArroba}.assinatura`), null);
  const semArroba = btoa(JSON.stringify({ email: "nao-e-email" }))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  assertEquals(emailDoToken(`cabecalho.${semArroba}.assinatura`), null);
});

// ── Tarefa mp-2 (15/09/2026): de QUEM é o token que cobra o cliente ───────
//
// A chave do lojista (Ajustes > Pagamentos > Mercado Pago) passou a valer de
// verdade: `resolverCredenciaisMp` (`_shared/credenciais-mp.ts`) decide entre
// a chave do LOJISTA (registro cifrado em app_settings) e a da PLATAFORMA
// (MP_ACCESS_TOKEN), e fecha quando existe registro que não dá para decifrar.
// Os dois testes abaixo são o que prende essa decisão AQUI, no lugar onde o
// dinheiro é cobrado: o primeiro prova que o Bearer que sai para o MP é o
// token DECIFRADO do lojista (com o da plataforma presente no ambiente, e
// diferente, de propósito — sem isso a asserção passaria por coincidência);
// o segundo prova a falha FECHADA, que é a regra de dinheiro desta frente:
// registro cadastrado + cofre fora do ar NÃO pode cair no token da
// plataforma, porque cobrar na conta errada é pior do que não cobrar.

/** Igual ao `fetchFalsoMP`, mas guardando TAMBÉM os headers — é no
 * `Authorization` que mora a resposta de "quem está cobrando". */
function fetchFalsoMpComHeaders(capturado: { autorizacao?: string; chamadas: number }) {
  const base = fetchFalsoMP({});
  return async (url: string, init?: RequestInit) => {
    capturado.chamadas++;
    capturado.autorizacao = (init?.headers as Record<string, string> | undefined)?.Authorization;
    return base(url, init);
  };
}

Deno.test("handler: com chave do LOJISTA cadastrada, o Bearer que vai ao MP é o token DECIFRADO dele — nunca o MP_ACCESS_TOKEN da plataforma", async () => {
  Deno.env.set("MP_ACCESS_TOKEN", TOKEN_PLATAFORMA_FALSO);
  Deno.env.set("MP_CHAVES_ENCRYPTION_KEY", CHAVE_CIFRA_TESTE);
  try {
    const pedido = pedidoBase({ user_id: DONO_LOGADO });
    const supabase = clienteFalso({
      pedido,
      gravado: { id: UUID },
      registroMp: await registroMpDeTeste(),
    });
    const capturado = { chamadas: 0 } as { autorizacao?: string; chamadas: number };

    const resposta = await handler(
      requisicao({ orderId: UUID, metodo: "pix" }, montarToken(DONO_LOGADO)),
      { supabase, fetchImpl: fetchFalsoMpComHeaders(capturado) },
    );

    assertEquals(resposta.status, 200);
    assertEquals(capturado.autorizacao, `Bearer ${TOKEN_LOJISTA_FALSO}`);
  } finally {
    Deno.env.delete("MP_CHAVES_ENCRYPTION_KEY");
  }
});

Deno.test("handler: chave do lojista cadastrada + cofre (MP_CHAVES_ENCRYPTION_KEY) ausente -> 503 terminal e NENHUMA chamada ao MP (falha fechada: não cai no token da plataforma)", async () => {
  Deno.env.set("MP_ACCESS_TOKEN", TOKEN_PLATAFORMA_FALSO);
  Deno.env.delete("MP_CHAVES_ENCRYPTION_KEY");
  const pedido = pedidoBase({ user_id: DONO_LOGADO });
  const supabase = clienteFalso({
    pedido,
    gravado: { id: UUID },
    registroMp: await (async () => {
      // O registro é montado COM o cofre; só a leitura é que acontece sem
      // ele — é exatamente o dia em que a env sumiu do deploy.
      Deno.env.set("MP_CHAVES_ENCRYPTION_KEY", CHAVE_CIFRA_TESTE);
      const r = await registroMpDeTeste();
      Deno.env.delete("MP_CHAVES_ENCRYPTION_KEY");
      return r;
    })(),
  });
  const capturado = { chamadas: 0 } as { autorizacao?: string; chamadas: number };

  const resposta = await handler(
    requisicao({ orderId: UUID, metodo: "pix" }, montarToken(DONO_LOGADO)),
    { supabase, fetchImpl: fetchFalsoMpComHeaders(capturado) },
  );
  const corpo = await resposta.json();

  // Mesma resposta do "sem token" de sempre (laudo 0109, D1): configuração
  // de longa duração não prende o cliente no "Tentar de novo".
  assertEquals(resposta.status, 503);
  assertEquals(corpo.error, "Pagamento indisponível.");
  assertEquals(corpo.terminal, true);
  assertEquals(capturado.chamadas, 0);
});

// ═══ Fase 3.5 (26/09/2026): CARTÃO pela Orders API ══════════════════════════
//
// Contrato: docs/superpowers/plans/2026-09-26-painel-cartao-e-devolucoes.md,
// seção "Cartão online". O que erra caro, e o que cada bloco abaixo prende:
//   - cobrar duas vezes o mesmo pedido (vaga ocupada por cartão em análise,
//     PIX aberto na troca para cartão, chave de idempotência reusada);
//   - matar o pedido numa recusa de cartão (a recusa NUNCA pode chegar a
//     `confirmar_pagamento`, cujo ramo 'recusado' cancela e devolve estoque);
//   - cobrar com a forma desligada pela loja;
//   - vazar token, CPF ou e-mail em log ou resposta.

const TOKEN_CARTAO = "ff8080814c11e237014c1ff593b57b4d";
const OUTRO_TOKEN_CARTAO = "aa8080814c11e237014c1ff593b57b99";
const CPF_TITULAR = "12345678909";
const ORDER_CARTAO = "ORDTST01CARTAO0000000000000A";
const ORDER_PIX_NA_VAGA = "ORDTST01PIXNAVAGA00000000000";
const ORDER_CARTAO_NA_VAGA = "ORDTST01CARTAONAVAGA0000000";
const CONFIG_CARTAO_LIGADO = { credito: true, debito: true, parcelas_max: 12 };
const URL_DESAFIO = "https://www.mercadopago.com.br/3ds/challenge/ORDTST01";

function corpoCartao(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    orderId: UUID,
    metodo: "cartao",
    token: TOKEN_CARTAO,
    paymentMethodId: "master",
    paymentTypeId: "credit_card",
    parcelas: 3,
    documento: { type: "CPF", number: CPF_TITULAR },
    ...extra,
  };
}

/** Uma order de CARTÃO no formato da Orders API (payment_method.type). */
function orderDeCartao(
  status: string,
  statusDetail: string,
  extra: { id?: string; tipo?: string; detalhePagamento?: string; url3ds?: string } = {},
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
          id: "PAY01CARTAO",
          status,
          status_detail: extra.detalhePagamento ?? statusDetail,
          amount: "100.00",
          payment_method: {
            id: "master",
            type: extra.tipo ?? "credit_card",
            installments: 3,
            ...(extra.url3ds ? { transaction_security: { url: extra.url3ds, type: "challenge" } } : {}),
          },
        },
      ],
    },
  };
}

/** Uma order de PIX (bank_transfer) no formato da Orders API. */
function orderDePix(status: string, statusDetail: string, id = ORDER_PIX_NA_VAGA): Record<string, unknown> {
  return {
    id,
    status,
    status_detail: statusDetail,
    external_reference: UUID,
    transactions: {
      payments: [
        {
          id: "PAY01PIX",
          payment_method: {
            id: "pix",
            type: "bank_transfer",
            qr_code: "QRCODE-DA-VAGA",
            qr_code_base64: "QRBASE64-DA-VAGA",
          },
        },
      ],
    },
  };
}

type ChamadaMP = {
  url: string;
  method?: string;
  corpo?: Record<string, unknown>;
  headers?: Record<string, string>;
};

/** `fetch` do MP roteado pelo que a function faz: POST /v1/orders (criar),
 * GET /v1/orders/{id} (consultar), POST /v1/orders/{id}/cancel (cancelar).
 * Rota sem resposta configurada ESTOURA — um teste nunca passa por uma
 * chamada que não previu (ex.: uma segunda cobrança). */
function fetchMP(rotas: {
  criar?: { status: number; corpo: unknown };
  consultar?: { status: number; corpo: unknown };
  cancelar?: { status: number; corpo: unknown };
}) {
  const chamadas: ChamadaMP[] = [];
  const fn = async (url: string, init?: RequestInit) => {
    chamadas.push({
      url,
      method: init?.method,
      corpo: init?.body ? JSON.parse(String(init.body)) : undefined,
      headers: init?.headers as Record<string, string> | undefined,
    });
    const rota = url.endsWith("/cancel")
      ? rotas.cancelar
      : init?.method === "POST"
        ? rotas.criar
        : rotas.consultar;
    if (!rota) throw new Error(`fetch inesperado nos testes do cartão: ${init?.method} ${url}`);
    return new Response(JSON.stringify(rota.corpo), { status: rota.status });
  };
  const criacoes = () => chamadas.filter((c) => c.method === "POST" && !c.url.endsWith("/cancel"));
  const cancelamentos = () => chamadas.filter((c) => c.url.endsWith("/cancel"));
  return { fn, chamadas, criacoes, cancelamentos };
}

/** Cenário pronto: pedido do dono logado, cartão ligado, gravação da vaga
 * bem-sucedida — cada teste sobrescreve só o que prova. */
function cenarioCartao(opts: {
  pedido?: Record<string, unknown>;
  releitura?: Record<string, unknown> | null;
  gravado?: Record<string, unknown> | null;
  configCartao?: Record<string, unknown> | null;
  erroConfigCartao?: Record<string, unknown> | null;
  resultadoLiberar?: boolean;
  erroLiberar?: Record<string, unknown> | null;
} = {}) {
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  Deno.env.delete("MP_SANDBOX_PAYER_EMAIL");
  const registro: {
    chamadasUpdate: number;
    filtrosUpdate?: Array<[string, unknown]>;
    valoresUpdate?: Record<string, unknown>;
  } = { chamadasUpdate: 0 };
  const chamadasRpc: Array<{ nome: string; args: Record<string, unknown> }> = [];
  const leiturasConfigCartao: Array<{ colunas: string; filtro: [string, unknown] }> = [];
  const supabase = clienteFalso({
    pedido: opts.pedido ?? pedidoBase({ user_id: DONO_LOGADO }),
    releitura: opts.releitura,
    gravado: opts.gravado === undefined ? { id: UUID, expires_at: "2099-01-01T00:00:00.000Z" } : opts.gravado,
    registro,
    configCartao: opts.configCartao === undefined ? CONFIG_CARTAO_LIGADO : opts.configCartao,
    erroConfigCartao: opts.erroConfigCartao,
    chamadasRpc,
    leiturasConfigCartao,
    resultadoLiberar: opts.resultadoLiberar,
    erroLiberar: opts.erroLiberar,
  });
  return { supabase, registro, chamadasRpc, leiturasConfigCartao };
}

const liberacoes = (chamadasRpc: Array<{ nome: string; args: Record<string, unknown> }>) =>
  chamadasRpc.filter((c) => c.nome === "liberar_cobranca_do_pedido").map((c) => c.args);

// --- chaveDeIdempotencia -----------------------------------------------------

Deno.test("chaveDeIdempotencia (PIX): tentativa 0 é o id do pedido BYTE A BYTE — a chave de antes do cartão; depois, <pedido>:<n>", async () => {
  assertEquals(await chaveDeIdempotencia({ id: UUID, tentativas_de_pagamento: 0 }, "pix"), UUID);
  // Coluna ausente/lixo vale 0 — nunca um erro que trave o PIX.
  assertEquals(await chaveDeIdempotencia({ id: UUID }, "pix"), UUID);
  assertEquals(await chaveDeIdempotencia({ id: UUID, tentativas_de_pagamento: null }, "pix"), UUID);
  assertEquals(await chaveDeIdempotencia({ id: UUID, tentativas_de_pagamento: -1 }, "pix"), UUID);
  assertEquals(await chaveDeIdempotencia({ id: UUID, tentativas_de_pagamento: 1.5 }, "pix"), UUID);
  assertEquals(await chaveDeIdempotencia({ id: UUID, tentativas_de_pagamento: 1 }, "pix"), `${UUID}:1`);
  assertEquals(await chaveDeIdempotencia({ id: UUID, tentativas_de_pagamento: 7 }, "pix"), `${UUID}:7`);
});

Deno.test("chaveDeIdempotencia (cartão): <pedido>:c<n>, SEM o token — Achado A1, revisão de risco 26/09/2026", async () => {
  const chave0 = await chaveDeIdempotencia({ id: UUID, tentativas_de_pagamento: 0 }, "cartao", TOKEN_CARTAO);
  assertEquals(chave0, `${UUID}:c0`);
  assertEquals(/^[0-9a-f-]{36}:c\d+$/.test(chave0), true);
  assertEquals(chave0.length <= 64, true);
  assertEquals(chave0.includes(TOKEN_CARTAO), false);

  // Mesmo token, mesma tentativa: MESMA chave (o retry converge) — como
  // sempre foi.
  assertEquals(
    await chaveDeIdempotencia({ id: UUID, tentativas_de_pagamento: 0 }, "cartao", TOKEN_CARTAO),
    chave0,
  );
  // Achado A1a: OUTRO cartão na MESMA tentativa agora converge na MESMA
  // chave — é essa convergência que faz duas abas com tokens diferentes
  // caírem na MESMA order do MP, em vez de duas cobranças vivas para o
  // mesmo pedido (ver o comentário grande de `chaveDeIdempotencia`, index.ts,
  // para o porquê o hash do token foi o que abriu esse buraco).
  const outroToken = await chaveDeIdempotencia({ id: UUID, tentativas_de_pagamento: 0 }, "cartao", OUTRO_TOKEN_CARTAO);
  assertEquals(outroToken, chave0);
  // Mesma tentativa, SEM token nenhum (parâmetro omitido): também converge —
  // a chave nunca dependeu do token para nada além do formato antigo.
  assertEquals(await chaveDeIdempotencia({ id: UUID, tentativas_de_pagamento: 0 }, "cartao"), chave0);
  // Tentativa DIFERENTE: chave NOVA (a vaga liberada muda a chave).
  const tentativa12 = await chaveDeIdempotencia({ id: UUID, tentativas_de_pagamento: 12 }, "cartao", TOKEN_CARTAO);
  assertEquals(tentativa12, `${UUID}:c12`);
  assertEquals(tentativa12.length <= 64, true);
  // Nunca colide com a chave do PIX do mesmo pedido/tentativa.
  assertEquals(chave0 === (await chaveDeIdempotencia({ id: UUID, tentativas_de_pagamento: 0 }, "pix")), false);
});

Deno.test("handler PIX: tentativa 0 manda X-Idempotency-Key = id do pedido (igual a antes); tentativa 2 manda <id>:2, e a vaga grava metodo_online 'pix' e parcelas null", async () => {
  for (const [tentativas, esperada] of [[0, UUID], [2, `${UUID}:2`]] as const) {
    const { supabase, registro } = cenarioCartao({
      pedido: pedidoBase({ user_id: DONO_LOGADO, tentativas_de_pagamento: tentativas }),
    });
    let chave: string | undefined;
    const base = fetchFalsoMP({});
    const fetchImpl = async (url: string, init?: RequestInit) => {
      chave = (init?.headers as Record<string, string>)["X-Idempotency-Key"];
      return base(url, init);
    };

    const resposta = await handler(
      requisicao({ orderId: UUID, metodo: "pix" }, montarToken(DONO_LOGADO)),
      { supabase, fetchImpl },
    );

    assertEquals(resposta.status, 200);
    assertEquals(chave, esperada);
    assertEquals(registro.valoresUpdate?.metodo_online, "pix");
    assertEquals(registro.valoresUpdate?.parcelas, null);
  }
});

// --- validação do corpo do cartão -------------------------------------------

for (
  const caso of [
    { nome: "sem token", extra: { token: undefined }, erro: "Dados do cartão incompletos. Digite o cartão de novo." },
    { nome: "token com caractere estranho", extra: { token: "ff8080814c11e237;drop table" }, erro: "Dados do cartão incompletos. Digite o cartão de novo." },
    { nome: "paymentMethodId inválido", extra: { paymentMethodId: "Master Card" }, erro: "Dados do cartão incompletos. Digite o cartão de novo." },
    { nome: "paymentTypeId que não é cartão", extra: { paymentTypeId: "bank_transfer" }, erro: "Escolha crédito ou débito para pagar com cartão." },
    { nome: "crédito sem parcelas", extra: { parcelas: undefined }, erro: "Número de parcelas inválido." },
    { nome: "parcelas 0", extra: { parcelas: 0 }, erro: "Número de parcelas inválido." },
    { nome: "parcelas 13", extra: { parcelas: 13 }, erro: "Número de parcelas inválido." },
    { nome: "parcelas fracionária", extra: { parcelas: 2.5 }, erro: "Número de parcelas inválido." },
    { nome: "sem documento", extra: { documento: undefined }, erro: "Informe um CPF ou CNPJ válido do titular do cartão." },
    { nome: "CPF curto", extra: { documento: { type: "CPF", number: "123" } }, erro: "Informe um CPF ou CNPJ válido do titular do cartão." },
    { nome: "e-mail torto", extra: { email: "nao-e-email" }, erro: "E-mail inválido." },
  ]
) {
  Deno.test(`handler cartão: ${caso.nome} -> 400 recuperável com mensagem clara, sem tocar banco nem Mercado Pago`, async () => {
    let chamadasFetch = 0;
    const fetchImpl = async () => {
      chamadasFetch++;
      return new Response("{}", { status: 201 });
    };
    const resposta = await handler(
      requisicao(corpoCartao(caso.extra), montarToken(DONO_LOGADO)),
      { supabase: supabaseIntocavel, fetchImpl },
    );
    const texto = await resposta.text();
    const corpo = JSON.parse(texto);

    assertEquals(resposta.status, 400);
    assertEquals(corpo.error, caso.erro);
    assertEquals(corpo.terminal, undefined);
    assertEquals(chamadasFetch, 0);
    // A mensagem nunca ecoa o valor recebido.
    assertEquals(texto.includes(TOKEN_CARTAO), false);
    assertEquals(texto.includes(CPF_TITULAR), false);
  });
}

Deno.test("validarCorpoDoCartao: débito sem parcelas vale 1; débito com 6 vale 1; parcelas em string de dígitos é aceita; CPF mascarado vira dígitos", () => {
  const debitoSem = validarCorpoDoCartao(corpoCartao({ paymentTypeId: "debit_card", parcelas: undefined }));
  assertEquals(debitoSem.ok && debitoSem.dados.parcelas, 1);
  const debitoSeis = validarCorpoDoCartao(corpoCartao({ paymentTypeId: "debit_card", parcelas: 6 }));
  assertEquals(debitoSeis.ok && debitoSeis.dados.parcelas, 1);
  const textual = validarCorpoDoCartao(corpoCartao({ parcelas: "4" }));
  assertEquals(textual.ok && textual.dados.parcelas, 4);
  const mascarado = validarCorpoDoCartao(corpoCartao({ documento: { type: "CPF", number: "123.456.789-09" } }));
  assertEquals(mascarado.ok && mascarado.dados.documento, { type: "CPF", number: CPF_TITULAR });
  const semEmail = validarCorpoDoCartao(corpoCartao());
  assertEquals(semEmail.ok && semEmail.dados.email, null);
});

// --- portão: conta, forma ligada, teto de parcelas ---------------------------

Deno.test("handler cartão: convidado (user_id null) -> 403 terminal ANTES de ler a config e sem tocar o MP", async () => {
  const { supabase, leiturasConfigCartao, chamadasRpc } = cenarioCartao({ pedido: pedidoBase() });
  const mp = fetchMP({});

  const resposta = await handler(requisicao(corpoCartao()), { supabase, fetchImpl: mp.fn });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 403);
  assertEquals(corpo.code, "PAGAMENTO_ONLINE_EXIGE_CONTA");
  assertEquals(corpo.terminal, true);
  assertEquals(leiturasConfigCartao.length, 0);
  assertEquals(mp.chamadas.length, 0);
  assertEquals(chamadasRpc.length, 0);
});

for (
  const caso of [
    { nome: "crédito desligado", config: { credito: false, debito: true, parcelas_max: 12 }, tipo: "credit_card" },
    { nome: "débito desligado", config: { credito: true, debito: false, parcelas_max: 12 }, tipo: "debit_card" },
    { nome: "linha de config ausente", config: null, tipo: "credit_card" },
  ]
) {
  Deno.test(`handler cartão: ${caso.nome} -> 409 recuperável 'Esta forma de pagamento não está disponível nesta loja.', sem tocar o MP nem a vaga`, async () => {
    const { supabase, registro, chamadasRpc, leiturasConfigCartao } = cenarioCartao({ configCartao: caso.config });
    const mp = fetchMP({});

    const resposta = await handler(
      requisicao(corpoCartao({ paymentTypeId: caso.tipo }), montarToken(DONO_LOGADO)),
      { supabase, fetchImpl: mp.fn },
    );
    const corpo = await resposta.json();

    assertEquals(resposta.status, 409);
    assertEquals(corpo.error, "Esta forma de pagamento não está disponível nesta loja.");
    assertEquals(corpo.terminal, undefined);
    assertEquals(mp.chamadas.length, 0);
    assertEquals(registro.chamadasUpdate, 0);
    assertEquals(chamadasRpc.length, 0);
    // A leitura aponta para a linha certa, com as colunas do contrato.
    assertEquals(leiturasConfigCartao, [{ colunas: "credito, debito, parcelas_max", filtro: ["id", 1] }]);
  });
}

Deno.test("handler cartão: falha ao LER a config -> fechado (409 indisponível), nunca 'liga por padrão'", async () => {
  const { supabase } = cenarioCartao({ erroConfigCartao: { message: "timeout" } });
  const mp = fetchMP({});
  const resposta = await handler(requisicao(corpoCartao(), montarToken(DONO_LOGADO)), {
    supabase,
    fetchImpl: mp.fn,
  });
  assertEquals(resposta.status, 409);
  assertEquals((await resposta.json()).error, "Esta forma de pagamento não está disponível nesta loja.");
  assertEquals(mp.chamadas.length, 0);
});

Deno.test("handler cartão: parcelas acima do teto da loja -> 400 recuperável; no teto exato passa", async () => {
  const acima = cenarioCartao({ configCartao: { credito: true, debito: true, parcelas_max: 3 } });
  const mpAcima = fetchMP({});
  const respostaAcima = await handler(
    requisicao(corpoCartao({ parcelas: 4 }), montarToken(DONO_LOGADO)),
    { supabase: acima.supabase, fetchImpl: mpAcima.fn },
  );
  const corpoAcima = await respostaAcima.json();
  assertEquals(respostaAcima.status, 400);
  assertEquals(corpoAcima.error, "Esse parcelamento não está disponível nesta loja.");
  assertEquals(corpoAcima.terminal, undefined);
  assertEquals(mpAcima.chamadas.length, 0);

  // Controle positivo: 3 parcelas com teto 3 cobra normalmente.
  const noTeto = cenarioCartao({ configCartao: { credito: true, debito: true, parcelas_max: 3 } });
  const mpNoTeto = fetchMP({ criar: { status: 201, corpo: orderDeCartao("processing", "in_process") } });
  const respostaNoTeto = await handler(
    requisicao(corpoCartao({ parcelas: 3 }), montarToken(DONO_LOGADO)),
    { supabase: noTeto.supabase, fetchImpl: mpNoTeto.fn },
  );
  assertEquals(respostaNoTeto.status, 200);
  assertEquals(mpNoTeto.criacoes().length, 1);
});

Deno.test("handler cartão: débito com loja de teto 1 e 6 parcelas pedidas passa (débito não parcela) e vai com installments 1", async () => {
  const { supabase, registro } = cenarioCartao({ configCartao: { credito: false, debito: true, parcelas_max: 1 } });
  const mp = fetchMP({ criar: { status: 201, corpo: orderDeCartao("processing", "in_process", { tipo: "debit_card" }) } });

  const resposta = await handler(
    requisicao(
      corpoCartao({ paymentTypeId: "debit_card", paymentMethodId: "debelo", parcelas: 6 }),
      montarToken(DONO_LOGADO),
    ),
    { supabase, fetchImpl: mp.fn },
  );

  assertEquals(resposta.status, 200);
  const pagamento = (mp.criacoes()[0].corpo?.transactions as { payments: Array<Record<string, unknown>> })
    .payments[0];
  assertEquals((pagamento.payment_method as Record<string, unknown>).installments, 1);
  assertEquals((pagamento.payment_method as Record<string, unknown>).type, "debit_card");
  assertEquals(registro.valoresUpdate?.metodo_online, "debito");
  assertEquals(registro.valoresUpdate?.parcelas, 1);
});

// --- criação: aprovado, 3DS, em análise --------------------------------------

Deno.test("handler cartão: aprovado na hora (processed:accredited) -> 200 'pago', ocupa a vaga com o id da ORDER + metodo_online/parcelas, e NÃO chama confirmar_pagamento", async () => {
  const { supabase, registro, chamadasRpc } = cenarioCartao();
  const mp = fetchMP({ criar: { status: 201, corpo: orderDeCartao("processed", "accredited") } });

  const resposta = await handler(requisicao(corpoCartao(), montarToken(DONO_LOGADO)), {
    supabase,
    fetchImpl: mp.fn,
  });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  assertEquals(corpo.paymentId, ORDER_CARTAO);
  assertEquals(corpo.statusPagamento, "pago");
  assertEquals(corpo.expiraEm, "2099-01-01T00:00:00.000Z");
  assertEquals(corpo.desafio3ds, undefined);
  assertEquals(corpo.qrCode, undefined);

  // A vaga: mesma gravação condicional do PIX, agora com a forma.
  assertEquals(registro.chamadasUpdate, 1);
  assertEquals(registro.valoresUpdate?.gateway_payment_id, ORDER_CARTAO);
  assertEquals(registro.valoresUpdate?.metodo_online, "credito");
  assertEquals(registro.valoresUpdate?.parcelas, 3);
  assertEquals("expires_at" in (registro.valoresUpdate ?? {}), false);
  // Achado A1 (2), revisão de risco 26/09/2026: o WHERE do cartão NÃO repete
  // `payment_status = 'aguardando'` — só `id` + vaga livre (Política P1: a
  // vaga grava mesmo que o pg_cron tenha expirado o pedido no meio da
  // chamada ao MP). PIX continua com os três filtros, byte a byte (ver o
  // teste "pedido sem cobrança existente...", mais acima).
  assertEquals(registro.filtrosUpdate, [
    ["id", UUID],
    ["gateway_payment_id", null],
  ]);
  // Confirmação é do webhook/reconciliação — nenhuma rpc aqui.
  assertEquals(chamadasRpc.length, 0);

  // O corpo mandado ao MP: Orders de cartão, com a chave POR TENTATIVA.
  assertEquals(mp.criacoes().length, 1);
  const enviado = mp.criacoes()[0];
  assertEquals(enviado.url.endsWith("/v1/orders"), true);
  assertEquals(enviado.corpo?.external_reference, UUID);
  assertEquals(enviado.corpo?.total_amount, "100.00");
  assertEquals(enviado.corpo?.capture_mode, "automatic_async");
  assertEquals(enviado.corpo?.config, {
    online: { transaction_security: { validation: "on_fraud_risk", liability_shift: "required" } },
  });
  assertEquals((enviado.corpo?.payer as Record<string, unknown>).identification, {
    type: "CPF",
    number: CPF_TITULAR,
  });
  assertEquals(enviado.headers?.["X-Idempotency-Key"], `${UUID}:c0`);
});

Deno.test("handler cartão: desafio 3DS (action_required:pending_challenge) -> 200 'aguardando' + desafio3ds.url, com a vaga ocupada", async () => {
  const { supabase, registro } = cenarioCartao();
  const mp = fetchMP({
    criar: {
      status: 201,
      corpo: orderDeCartao("action_required", "pending_challenge", { url3ds: URL_DESAFIO }),
    },
  });

  const resposta = await handler(requisicao(corpoCartao(), montarToken(DONO_LOGADO)), {
    supabase,
    fetchImpl: mp.fn,
  });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  assertEquals(corpo.statusPagamento, "aguardando");
  assertEquals(corpo.desafio3ds, { url: URL_DESAFIO });
  assertEquals(corpo.paymentId, ORDER_CARTAO);
  assertEquals(registro.valoresUpdate?.gateway_payment_id, ORDER_CARTAO);
});

Deno.test("handler cartão: em análise (processing:in_review) -> 200 'aguardando' SEM desafio3ds, com a vaga ocupada", async () => {
  const { supabase, registro } = cenarioCartao();
  const mp = fetchMP({ criar: { status: 201, corpo: orderDeCartao("processing", "in_review") } });

  const resposta = await handler(requisicao(corpoCartao(), montarToken(DONO_LOGADO)), {
    supabase,
    fetchImpl: mp.fn,
  });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  assertEquals(corpo.statusPagamento, "aguardando");
  assertEquals("desafio3ds" in corpo, false);
  assertEquals(registro.chamadasUpdate, 1);
});

// Achado A1 (2) — revisão de risco, 26/09/2026, Política P1 ("pago após
// expirar": HONRAR). ANTES desta correção, este teste pinava o desfecho
// ERRADO: `gravado: null` simulava o UPDATE do cartão perdendo a corrida
// contra o pg_cron do MESMO jeito que o PIX — porque o WHERE do cartão
// repetia `payment_status = 'aguardando'`. O cliente via "o prazo para pagar
// este pedido acabou" (terminal) para um CARTÃO QUE O MP JÁ APROVOU — e sem
// `gateway_payment_id` gravado, `confirmar_pagamento` reprovaria a guarda (d)
// e devolveria 'divergente' quando o webhook confirmasse, nunca
// 'pago_apos_expirar'. Agora o WHERE do cartão não filtra por
// `payment_status` — só `id` + vaga livre — então este UPDATE GRAVA mesmo
// com o pedido já 'expirado' (pg_cron nunca toca `gateway_payment_id`, só
// `payment_status`/`status`), e o cliente vê a resposta normal do cartão
// aprovado. O comentário grande da gravação da vaga (index.ts) e o próprio
// `chaveDeIdempotencia` explicam a política; este teste prende o
// COMPORTAMENTO observável dela.
Deno.test("handler cartão: pg_cron expira o pedido DURANTE a chamada ao MP -> a vaga É GRAVADA mesmo assim (P1), NUNCA 'prazo acabou'", async () => {
  const { supabase, registro, chamadasRpc } = cenarioCartao();
  // `gravado` continua não-null (default do cenarioCartao): é exatamente
  // isso que a correção prova — o UPDATE do cartão NÃO exige mais
  // `payment_status = 'aguardando'`, então ele grava mesmo que a LINHA REAL
  // já esteja 'expirado' nesse instante (o dublê não simula o WHERE em si,
  // mas a asserção de `filtrosUpdate` abaixo prova que o filtro que faria
  // essa corrida perder NÃO está mais na chamada).
  const mp = fetchMP({ criar: { status: 201, corpo: orderDeCartao("processing", "in_process") } });

  const resposta = await handler(requisicao(corpoCartao(), montarToken(DONO_LOGADO)), {
    supabase,
    fetchImpl: mp.fn,
  });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  assertEquals(corpo.statusPagamento, "aguardando");
  assertEquals(corpo.error, undefined);
  assertEquals(chamadasRpc.length, 0);
  // A prova que importa: SEM `payment_status` no WHERE — um pedido que o
  // pg_cron tenha expirado ENTRE a leitura e este UPDATE não derruba a
  // gravação.
  assertEquals(registro.filtrosUpdate, [
    ["id", UUID],
    ["gateway_payment_id", null],
  ]);
});

Deno.test("handler cartão: perdeu a corrida da vaga de VERDADE (outra cobrança já ocupa) -> 409 recuperável de sempre; a Política P1 não muda essa resposta", async () => {
  // Diferente do teste acima: aqui `atual.gateway_payment_id` (a releitura)
  // é uma cobrança DIFERENTE da que esta chamada criou — a vaga foi perdida
  // para valer (duas abas com tentativas diferentes, por exemplo), não
  // "gravou mesmo assim". A resposta ao cliente continua a mesma de sempre.
  const { supabase, chamadasRpc } = cenarioCartao({
    gravado: null,
    releitura: { payment_status: "aguardando", gateway_payment_id: "ORDTST01OUTRACOBRANCA000000" },
  });
  const mp = fetchMP({ criar: { status: 201, corpo: orderDeCartao("processing", "in_process") } });

  const resposta = await handler(requisicao(corpoCartao(), montarToken(DONO_LOGADO)), {
    supabase,
    fetchImpl: mp.fn,
    alertarAdminCartaoOrfao: async () => {},
  });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 409);
  assertEquals(corpo.error, "Este pedido já tem uma cobrança gerada.");
  assertEquals(corpo.terminal, undefined);
  assertEquals(chamadasRpc.length, 0);
});

// --- criação: recusas ----------------------------------------------------------

Deno.test("handler cartão: HTTP 402 (recusado pelo banco) -> 200 'recusado' com o motivo, CONTA a tentativa (liberar sem id) e NÃO ocupa a vaga", async () => {
  const { supabase, registro, chamadasRpc } = cenarioCartao();
  const mp = fetchMP({
    criar: {
      status: 402,
      corpo: {
        errors: [{ code: "failed", message: "The following transactions failed" }],
        data: orderDeCartao("failed", "failed", { detalhePagamento: "rejected_by_issuer" }),
      },
    },
  });

  const resposta = await handler(requisicao(corpoCartao(), montarToken(DONO_LOGADO)), {
    supabase,
    fetchImpl: mp.fn,
  });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  assertEquals(corpo, {
    paymentId: null,
    statusPagamento: "recusado",
    motivoRecusa: "O banco emissor recusou o pagamento.",
    podeTentarDeNovo: true,
    expiraEm: "2099-01-01T00:00:00.000Z",
  });
  assertEquals(liberacoes(chamadasRpc), [{ p_order_id: UUID, p_gateway_payment_id: null }]);
  // A prova que importa: a recusa não chega a confirmar_pagamento (que
  // cancelaria o pedido) — a ÚNICA rpc é a de liberar.
  assertEquals(chamadasRpc.map((c) => c.nome), ["liberar_cobranca_do_pedido"]);
  assertEquals(registro.chamadasUpdate, 0);
});

Deno.test("handler cartão: order criada já 'failed' (201) -> 200 'recusado' com o motivo do pagamento, conta a tentativa, não ocupa a vaga", async () => {
  const { supabase, registro, chamadasRpc } = cenarioCartao();
  const mp = fetchMP({
    criar: { status: 201, corpo: orderDeCartao("failed", "failed", { detalhePagamento: "high_risk" }) },
  });

  const resposta = await handler(requisicao(corpoCartao(), montarToken(DONO_LOGADO)), {
    supabase,
    fetchImpl: mp.fn,
  });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  assertEquals(corpo.statusPagamento, "recusado");
  assertEquals(corpo.motivoRecusa, "Pagamento recusado por segurança. Tente outro cartão ou pague com PIX.");
  assertEquals(corpo.podeTentarDeNovo, true);
  assertEquals(corpo.paymentId, null);
  assertEquals(liberacoes(chamadasRpc), [{ p_order_id: UUID, p_gateway_payment_id: null }]);
  assertEquals(registro.chamadasUpdate, 0);
});

Deno.test("handler cartão: HTTP 400 do MP (dado do cartão) -> 200 'recusado' com 'Confira os dados do cartão e tente de novo.'", async () => {
  const { supabase, registro, chamadasRpc } = cenarioCartao();
  const mp = fetchMP({ criar: { status: 400, corpo: { errors: [{ code: "invalid_card_token" }] } } });

  const resposta = await handler(requisicao(corpoCartao(), montarToken(DONO_LOGADO)), {
    supabase,
    fetchImpl: mp.fn,
  });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  assertEquals(corpo.statusPagamento, "recusado");
  assertEquals(corpo.motivoRecusa, "Confira os dados do cartão e tente de novo.");
  assertEquals(corpo.podeTentarDeNovo, true);
  assertEquals(liberacoes(chamadasRpc).length, 1);
  assertEquals(registro.chamadasUpdate, 0);
});

Deno.test("handler cartão: recusa com a RPC de liberar FALHANDO -> a resposta continua 200 'recusado' (a recusa é verdade de qualquer jeito)", async () => {
  const { supabase } = cenarioCartao({ erroLiberar: { message: "deadlock" } });
  const mp = fetchMP({ criar: { status: 402, corpo: { errors: [{ code: "failed" }] } } });

  const resposta = await handler(requisicao(corpoCartao(), montarToken(DONO_LOGADO)), {
    supabase,
    fetchImpl: mp.fn,
  });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  assertEquals(corpo.statusPagamento, "recusado");
  // Motivo desconhecido no corpo: a frase padrão, sempre com saída.
  assertEquals(corpo.motivoRecusa, "Pagamento recusado. Tente outro cartão ou pague com PIX.");
});

for (
  const caso of [
    { status: 401, esperado: 503, terminal: true },
    { status: 403, esperado: 503, terminal: true },
    { status: 500, esperado: 502, terminal: undefined },
    { status: 0, esperado: 502, terminal: undefined },
  ]
) {
  Deno.test(`handler cartão: POST /v1/orders com status ${caso.status} -> ${caso.esperado} ${caso.terminal ? "TERMINAL (credencial)" : "recuperável"}, sem liberar nem ocupar a vaga`, async () => {
    const { supabase, registro, chamadasRpc } = cenarioCartao();
    const fetchImpl = caso.status === 0
      ? async () => {
        throw new TypeError("network error");
      }
      : fetchMP({ criar: { status: caso.status, corpo: { message: "detalhe do MP" } } }).fn;

    const resposta = await handler(requisicao(corpoCartao(), montarToken(DONO_LOGADO)), {
      supabase,
      fetchImpl,
    });
    const corpo = await resposta.json();

    assertEquals(resposta.status, caso.esperado);
    assertEquals(corpo.terminal, caso.terminal);
    if (caso.terminal) assertEquals(corpo.error, MENSAGEM_CREDENCIAL_RECUSADA);
    assertEquals(chamadasRpc.length, 0);
    assertEquals(registro.chamadasUpdate, 0);
  });
}

Deno.test("handler cartão: token, CPF e e-mail NUNCA aparecem em log nem na resposta — nem na recusa 402 cujo corpo traz o pagador", async () => {
  const { supabase } = cenarioCartao({
    pedido: pedidoBase({ user_id: DONO_LOGADO, customer_data: { email: "titular@exemplo.com" } }),
  });
  const mp = fetchMP({
    criar: {
      status: 402,
      corpo: {
        errors: [{ code: "failed" }],
        data: {
          ...orderDeCartao("failed", "failed", { detalhePagamento: "card_disabled" }),
          payer: { email: "titular@exemplo.com", identification: { type: "CPF", number: CPF_TITULAR } },
        },
      },
    },
  });
  const logados: unknown[] = [];
  const originais = { error: console.error, warn: console.warn, log: console.log };
  console.error = (...a: unknown[]) => logados.push(a);
  console.warn = (...a: unknown[]) => logados.push(a);
  console.log = (...a: unknown[]) => logados.push(a);
  let texto: string;
  try {
    const resposta = await handler(requisicao(corpoCartao(), montarToken(DONO_LOGADO)), {
      supabase,
      fetchImpl: mp.fn,
    });
    texto = await resposta.text();
  } finally {
    console.error = originais.error;
    console.warn = originais.warn;
    console.log = originais.log;
  }

  const tudo = JSON.stringify(logados) + texto;
  assertEquals(tudo.includes(TOKEN_CARTAO), false);
  assertEquals(tudo.includes(CPF_TITULAR), false);
  assertEquals(tudo.includes("titular@exemplo.com"), false);
  assertEquals(JSON.parse(texto).motivoRecusa, "Cartão desabilitado. Fale com o seu banco.");
});

Deno.test("handler cartão: e-mail do pagador — o do corpo vence; customer_data torto é pulado; sandbox troca pelo de teste SEM 'APRO' em first_name", async () => {
  // O do corpo vence o do pedido.
  const a = cenarioCartao({
    pedido: pedidoBase({ user_id: DONO_LOGADO, customer_data: { email: "pedido@exemplo.com" } }),
  });
  const mpA = fetchMP({ criar: { status: 201, corpo: orderDeCartao("processing", "in_process") } });
  await handler(requisicao(corpoCartao({ email: "corpo@exemplo.com" }), montarToken(DONO_LOGADO)), {
    supabase: a.supabase,
    fetchImpl: mpA.fn,
  });
  assertEquals((mpA.criacoes()[0].corpo?.payer as Record<string, unknown>).email, "corpo@exemplo.com");

  // customer_data com e-mail torto não trava o cartão: cai no próximo.
  const b = cenarioCartao({ pedido: pedidoBase({ user_id: DONO_LOGADO, customer_data: { email: "torto" } }) });
  const mpB = fetchMP({ criar: { status: 201, corpo: orderDeCartao("processing", "in_process") } });
  const respostaB = await handler(requisicao(corpoCartao(), montarToken(DONO_LOGADO)), {
    supabase: b.supabase,
    fetchImpl: mpB.fn,
  });
  assertEquals(respostaB.status, 200);
  assertEquals((mpB.criacoes()[0].corpo?.payer as Record<string, unknown>).email, "sem-email@ikcous.com.br");

  // Sandbox: e-mail de teste, sem forçar first_name.
  const c = cenarioCartao();
  Deno.env.set("MP_SANDBOX_PAYER_EMAIL", "comprador@testuser.com");
  const aviso = console.warn;
  console.warn = () => {};
  try {
    const mpC = fetchMP({ criar: { status: 201, corpo: orderDeCartao("processing", "in_process") } });
    await handler(requisicao(corpoCartao(), montarToken(DONO_LOGADO)), { supabase: c.supabase, fetchImpl: mpC.fn });
    const payer = mpC.criacoes()[0].corpo?.payer as Record<string, unknown>;
    assertEquals(payer.email, "comprador@testuser.com");
    assertEquals("first_name" in payer, false);
  } finally {
    console.warn = aviso;
    Deno.env.delete("MP_SANDBOX_PAYER_EMAIL");
  }
});

Deno.test("handler cartão: tentativa 2 no pedido -> chave <pedido>:c2; OUTRO token na MESMA tentativa -> a MESMA chave (Achado A1, converge como o PIX)", async () => {
  const chaves: string[] = [];
  for (const token of [TOKEN_CARTAO, OUTRO_TOKEN_CARTAO]) {
    const { supabase } = cenarioCartao({
      pedido: pedidoBase({ user_id: DONO_LOGADO, tentativas_de_pagamento: 2 }),
    });
    const mp = fetchMP({ criar: { status: 201, corpo: orderDeCartao("processing", "in_process") } });
    await handler(requisicao(corpoCartao({ token }), montarToken(DONO_LOGADO)), { supabase, fetchImpl: mp.fn });
    chaves.push(String(mp.criacoes()[0].headers?.["X-Idempotency-Key"]));
  }
  assertEquals(chaves[0], `${UUID}:c2`);
  assertEquals(chaves[1], `${UUID}:c2`);
  // A prova que importa (Achado A1a): dois tokens na MESMA tentativa
  // convergem na MESMA chave — é essa convergência que faz o MP devolver a
  // MESMA order para as duas chamadas em vez de criar duas cobranças vivas.
  assertEquals(chaves[0] === chaves[1], true);
});

// --- vaga ocupada: (a) a (f) --------------------------------------------------

Deno.test("vaga (a): cartão JÁ PAGO na vaga + novo pedido de cartão -> 200 'pago', sem cobrança nova, sem liberar, sem UPDATE", async () => {
  const { supabase, registro, chamadasRpc } = cenarioCartao({
    pedido: pedidoBase({ user_id: DONO_LOGADO, gateway_payment_id: ORDER_CARTAO_NA_VAGA }),
  });
  const mp = fetchMP({
    consultar: { status: 200, corpo: orderDeCartao("processed", "accredited", { id: ORDER_CARTAO_NA_VAGA }) },
  });

  const resposta = await handler(requisicao(corpoCartao({ token: OUTRO_TOKEN_CARTAO }), montarToken(DONO_LOGADO)), {
    supabase,
    fetchImpl: mp.fn,
  });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  assertEquals(corpo, {
    paymentId: ORDER_CARTAO_NA_VAGA,
    statusPagamento: "pago",
    expiraEm: "2099-01-01T00:00:00.000Z",
  });
  assertEquals(mp.criacoes().length, 0);
  assertEquals(mp.cancelamentos().length, 0);
  assertEquals(chamadasRpc.length, 0);
  assertEquals(registro.chamadasUpdate, 0);
});

Deno.test("vaga (a): PIX JÁ PAGO na vaga + pedido de CARTÃO -> 200 'pago' (resposta do PIX de sempre), sem cancelar nem cobrar", async () => {
  const { supabase, chamadasRpc } = cenarioCartao({
    pedido: pedidoBase({ user_id: DONO_LOGADO, gateway_payment_id: ORDER_PIX_NA_VAGA }),
  });
  const mp = fetchMP({ consultar: { status: 200, corpo: orderDePix("processed", "accredited") } });

  const resposta = await handler(requisicao(corpoCartao(), montarToken(DONO_LOGADO)), {
    supabase,
    fetchImpl: mp.fn,
  });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  assertEquals(corpo.statusPagamento, "pago");
  assertEquals(corpo.paymentId, ORDER_PIX_NA_VAGA);
  assertEquals(mp.cancelamentos().length, 0);
  assertEquals(mp.criacoes().length, 0);
  assertEquals(chamadasRpc.length, 0);
});

for (
  const morta of [
    { nome: "recusado (failed)", status: "failed", detalhe: "rejected_by_issuer" },
    { nome: "cancelado", status: "canceled", detalhe: "canceled" },
    { nome: "expirado (3DS abandonado)", status: "expired", detalhe: "expired" },
  ]
) {
  Deno.test(`vaga (b): cartão ${morta.nome} na vaga + novo cartão -> libera a vaga DAQUELA cobrança, relê, e cobra com a chave da tentativa NOVA`, async () => {
    const { supabase, registro, chamadasRpc } = cenarioCartao({
      pedido: pedidoBase({ user_id: DONO_LOGADO, gateway_payment_id: ORDER_CARTAO_NA_VAGA, tentativas_de_pagamento: 0 }),
      releitura: pedidoBase({ user_id: DONO_LOGADO, gateway_payment_id: null, tentativas_de_pagamento: 1 }),
    });
    const mp = fetchMP({
      consultar: { status: 200, corpo: orderDeCartao(morta.status, morta.detalhe, { id: ORDER_CARTAO_NA_VAGA }) },
      criar: { status: 201, corpo: orderDeCartao("processed", "accredited") },
    });

    const resposta = await handler(
      requisicao(corpoCartao({ token: OUTRO_TOKEN_CARTAO }), montarToken(DONO_LOGADO)),
      { supabase, fetchImpl: mp.fn },
    );
    const corpo = await resposta.json();

    assertEquals(resposta.status, 200);
    assertEquals(corpo.statusPagamento, "pago");
    assertEquals(liberacoes(chamadasRpc), [{ p_order_id: UUID, p_gateway_payment_id: ORDER_CARTAO_NA_VAGA }]);
    assertEquals(chamadasRpc.some((c) => c.nome === "confirmar_pagamento"), false);
    assertEquals(mp.cancelamentos().length, 0);
    assertEquals(mp.criacoes().length, 1);
    // A chave vem da RELEITURA (tentativa 1), não do pedido lido antes —
    // e não carrega o token (Achado A1).
    assertEquals(mp.criacoes()[0].headers?.["X-Idempotency-Key"], `${UUID}:c1`);
    assertEquals(registro.valoresUpdate?.gateway_payment_id, ORDER_CARTAO);
  });
}

Deno.test("vaga (b): cartão recusado na vaga + pedido de PIX -> libera, relê e cria o PIX com a chave <pedido>:1 (nunca a chave morta)", async () => {
  const { supabase, registro, chamadasRpc } = cenarioCartao({
    pedido: pedidoBase({ user_id: DONO_LOGADO, gateway_payment_id: ORDER_CARTAO_NA_VAGA }),
    releitura: pedidoBase({ user_id: DONO_LOGADO, gateway_payment_id: null, tentativas_de_pagamento: 1 }),
  });
  let chavePix: string | undefined;
  const consulta = orderDeCartao("failed", "failed", { id: ORDER_CARTAO_NA_VAGA });
  const basePix = fetchFalsoMP({});
  const fetchImpl = async (url: string, init?: RequestInit) => {
    if (init?.method !== "POST") return new Response(JSON.stringify(consulta), { status: 200 });
    chavePix = (init?.headers as Record<string, string>)["X-Idempotency-Key"];
    return basePix(url, init);
  };

  const resposta = await handler(requisicao({ orderId: UUID, metodo: "pix" }, montarToken(DONO_LOGADO)), {
    supabase,
    fetchImpl,
  });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  assertEquals(corpo.qrCode, "QRCODE-PADRAO");
  assertEquals(liberacoes(chamadasRpc), [{ p_order_id: UUID, p_gateway_payment_id: ORDER_CARTAO_NA_VAGA }]);
  assertEquals(chavePix, `${UUID}:1`);
  assertEquals(registro.valoresUpdate?.metodo_online, "pix");
});

Deno.test("vaga (c): PIX ABERTO na vaga + pedido de cartão -> CANCELA o PIX no MP, libera a vaga DELE e cobra o cartão", async () => {
  const { supabase, registro, chamadasRpc } = cenarioCartao({
    pedido: pedidoBase({ user_id: DONO_LOGADO, gateway_payment_id: ORDER_PIX_NA_VAGA }),
    releitura: pedidoBase({ user_id: DONO_LOGADO, gateway_payment_id: null, tentativas_de_pagamento: 1 }),
  });
  const mp = fetchMP({
    consultar: { status: 200, corpo: orderDePix("action_required", "waiting_transfer") },
    cancelar: { status: 200, corpo: orderDePix("canceled", "canceled") },
    criar: { status: 201, corpo: orderDeCartao("action_required", "pending_challenge", { url3ds: URL_DESAFIO }) },
  });

  const resposta = await handler(requisicao(corpoCartao(), montarToken(DONO_LOGADO)), {
    supabase,
    fetchImpl: mp.fn,
  });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  assertEquals(corpo.statusPagamento, "aguardando");
  assertEquals(corpo.desafio3ds, { url: URL_DESAFIO });
  // Ordem que importa: consulta -> cancela -> cria.
  assertEquals(mp.chamadas.map((c) => `${c.method} ${c.url.replace("https://api.mercadopago.com", "")}`), [
    `GET /v1/orders/${ORDER_PIX_NA_VAGA}`,
    `POST /v1/orders/${ORDER_PIX_NA_VAGA}/cancel`,
    "POST /v1/orders",
  ]);
  assertEquals(mp.cancelamentos()[0].headers?.["X-Idempotency-Key"], `cancelar:${ORDER_PIX_NA_VAGA}`);
  assertEquals(liberacoes(chamadasRpc), [{ p_order_id: UUID, p_gateway_payment_id: ORDER_PIX_NA_VAGA }]);
  assertEquals(registro.valoresUpdate?.gateway_payment_id, ORDER_CARTAO);
  assertEquals(registro.valoresUpdate?.metodo_online, "credito");
});

for (
  const falha of [
    { nome: "MP recusa o cancelamento (PIX pago no meio do caminho)", cancelar: { status: 409, corpo: { errors: [{ code: "cannot_cancel" }] } } },
    { nome: "MP responde 200 mas a order NÃO está cancelada", cancelar: { status: 200, corpo: orderDePix("action_required", "waiting_transfer") } },
    { nome: "MP fora do ar (500)", cancelar: { status: 500, corpo: {} } },
  ]
) {
  Deno.test(`vaga (c): ${falha.nome} -> 409 recuperável 'Não foi possível trocar para cartão agora…', sem liberar e sem cobrar o cartão`, async () => {
    const { supabase, registro, chamadasRpc } = cenarioCartao({
      pedido: pedidoBase({ user_id: DONO_LOGADO, gateway_payment_id: ORDER_PIX_NA_VAGA }),
    });
    const mp = fetchMP({
      consultar: { status: 200, corpo: orderDePix("action_required", "waiting_transfer") },
      cancelar: falha.cancelar,
    });

    const resposta = await handler(requisicao(corpoCartao(), montarToken(DONO_LOGADO)), {
      supabase,
      fetchImpl: mp.fn,
    });
    const corpo = await resposta.json();

    assertEquals(resposta.status, 409);
    assertEquals(corpo.error, "Não foi possível trocar para cartão agora. Tente de novo em instantes.");
    assertEquals(corpo.terminal, undefined);
    assertEquals(chamadasRpc.length, 0);
    assertEquals(mp.criacoes().length, 0);
    assertEquals(registro.chamadasUpdate, 0);
  });
}

Deno.test("vaga (c): PIX já EXPIRADO na vaga + pedido de cartão -> não precisa cancelar: só libera e cobra", async () => {
  const { supabase, chamadasRpc } = cenarioCartao({
    pedido: pedidoBase({ user_id: DONO_LOGADO, gateway_payment_id: ORDER_PIX_NA_VAGA }),
    releitura: pedidoBase({ user_id: DONO_LOGADO, gateway_payment_id: null, tentativas_de_pagamento: 1 }),
  });
  const mp = fetchMP({
    consultar: { status: 200, corpo: orderDePix("expired", "expired") },
    criar: { status: 201, corpo: orderDeCartao("processing", "in_process") },
  });

  const resposta = await handler(requisicao(corpoCartao(), montarToken(DONO_LOGADO)), {
    supabase,
    fetchImpl: mp.fn,
  });

  assertEquals(resposta.status, 200);
  assertEquals(mp.cancelamentos().length, 0);
  assertEquals(liberacoes(chamadasRpc), [{ p_order_id: UUID, p_gateway_payment_id: ORDER_PIX_NA_VAGA }]);
  assertEquals(mp.criacoes().length, 1);
});

Deno.test("vaga (c): cobrança de TIPO DESCONHECIDO na vaga + pedido de cartão -> 409 recuperável, e ela NUNCA é cancelada às cegas", async () => {
  const { supabase, chamadasRpc } = cenarioCartao({
    pedido: pedidoBase({ user_id: DONO_LOGADO, gateway_payment_id: "ORDTST01SEMTIPO" }),
  });
  const mp = fetchMP({
    consultar: { status: 200, corpo: { id: "ORDTST01SEMTIPO", status: "action_required", status_detail: "waiting_payment" } },
  });

  const resposta = await handler(requisicao(corpoCartao(), montarToken(DONO_LOGADO)), {
    supabase,
    fetchImpl: mp.fn,
  });

  assertEquals(resposta.status, 409);
  assertEquals((await resposta.json()).error, "Não foi possível trocar para cartão agora. Tente de novo em instantes.");
  assertEquals(mp.cancelamentos().length, 0);
  assertEquals(chamadasRpc.length, 0);
});

Deno.test("vaga (d): cartão em 3DS na vaga + NOVO cartão (token novo) -> devolve o estado atual com o MESMO desafio, NUNCA uma segunda cobrança", async () => {
  const { supabase, registro, chamadasRpc } = cenarioCartao({
    pedido: pedidoBase({ user_id: DONO_LOGADO, gateway_payment_id: ORDER_CARTAO_NA_VAGA }),
  });
  const mp = fetchMP({
    consultar: {
      status: 200,
      corpo: orderDeCartao("action_required", "pending_challenge", { id: ORDER_CARTAO_NA_VAGA, url3ds: URL_DESAFIO }),
    },
  });

  const resposta = await handler(
    requisicao(corpoCartao({ token: OUTRO_TOKEN_CARTAO }), montarToken(DONO_LOGADO)),
    { supabase, fetchImpl: mp.fn },
  );
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  assertEquals(corpo, {
    paymentId: ORDER_CARTAO_NA_VAGA,
    statusPagamento: "aguardando",
    expiraEm: "2099-01-01T00:00:00.000Z",
    desafio3ds: { url: URL_DESAFIO },
  });
  assertEquals(mp.criacoes().length, 0);
  assertEquals(chamadasRpc.length, 0);
  assertEquals(registro.chamadasUpdate, 0);
});

Deno.test("vaga (d): cartão em análise (processing:in_process) na vaga + novo cartão -> 'aguardando' sem desafio; par desconhecido devolve o par cru", async () => {
  const analise = cenarioCartao({
    pedido: pedidoBase({ user_id: DONO_LOGADO, gateway_payment_id: ORDER_CARTAO_NA_VAGA }),
  });
  const mpAnalise = fetchMP({
    consultar: { status: 200, corpo: orderDeCartao("processing", "in_process", { id: ORDER_CARTAO_NA_VAGA }) },
  });
  const r1 = await handler(requisicao(corpoCartao(), montarToken(DONO_LOGADO)), {
    supabase: analise.supabase,
    fetchImpl: mpAnalise.fn,
  });
  const c1 = await r1.json();
  assertEquals(c1.statusPagamento, "aguardando");
  assertEquals("desafio3ds" in c1, false);
  assertEquals(mpAnalise.criacoes().length, 0);

  const novo = cenarioCartao({
    pedido: pedidoBase({ user_id: DONO_LOGADO, gateway_payment_id: ORDER_CARTAO_NA_VAGA }),
  });
  const mpNovo = fetchMP({
    consultar: { status: 200, corpo: orderDeCartao("um_status_novo", "um_detalhe", { id: ORDER_CARTAO_NA_VAGA }) },
  });
  const r2 = await handler(requisicao(corpoCartao(), montarToken(DONO_LOGADO)), {
    supabase: novo.supabase,
    fetchImpl: mpNovo.fn,
  });
  assertEquals((await r2.json()).statusPagamento, "um_status_novo:um_detalhe");
  assertEquals(mpNovo.criacoes().length, 0);
});

Deno.test("vaga (e): PIX aberto na vaga + pedido de PIX -> o MESMO QR de sempre, sem cancelar, sem liberar, sem UPDATE", async () => {
  const { supabase, registro, chamadasRpc } = cenarioCartao({
    pedido: pedidoBase({ user_id: DONO_LOGADO, gateway_payment_id: ORDER_PIX_NA_VAGA }),
  });
  const mp = fetchMP({ consultar: { status: 200, corpo: orderDePix("action_required", "waiting_transfer") } });

  const resposta = await handler(requisicao({ orderId: UUID, metodo: "pix" }, montarToken(DONO_LOGADO)), {
    supabase,
    fetchImpl: mp.fn,
  });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  assertEquals(corpo.statusPagamento, "aguardando");
  assertEquals(corpo.qrCode, "QRCODE-DA-VAGA");
  assertEquals(mp.chamadas.length, 1);
  assertEquals(chamadasRpc.length, 0);
  assertEquals(registro.chamadasUpdate, 0);
});

Deno.test("vaga (e): PIX RECUSADO na vaga + pedido de PIX -> continua como antes ('recusado', sem liberar) — a regra nova é só do cartão", async () => {
  const { supabase, chamadasRpc } = cenarioCartao({
    pedido: pedidoBase({ user_id: DONO_LOGADO, gateway_payment_id: ORDER_PIX_NA_VAGA }),
  });
  const mp = fetchMP({ consultar: { status: 200, corpo: orderDePix("failed", "failed") } });

  const resposta = await handler(requisicao({ orderId: UUID, metodo: "pix" }, montarToken(DONO_LOGADO)), {
    supabase,
    fetchImpl: mp.fn,
  });

  assertEquals((await resposta.json()).statusPagamento, "recusado");
  assertEquals(chamadasRpc.length, 0);
});

Deno.test("vaga (f): cartão EM ANÁLISE (processing:in_process, sem desafio) na vaga + pedido de PIX -> 409 recuperável, NUNCA tenta cancelar (MP não cancela processing)", async () => {
  const { supabase, registro, chamadasRpc } = cenarioCartao({
    pedido: pedidoBase({ user_id: DONO_LOGADO, gateway_payment_id: ORDER_CARTAO_NA_VAGA }),
  });
  const mp = fetchMP({
    consultar: { status: 200, corpo: orderDeCartao("processing", "in_process", { id: ORDER_CARTAO_NA_VAGA }) },
  });

  const resposta = await handler(requisicao({ orderId: UUID, metodo: "pix" }, montarToken(DONO_LOGADO)), {
    supabase,
    fetchImpl: mp.fn,
  });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 409);
  assertEquals(corpo.error, "Há um pagamento com cartão em análise para este pedido.");
  assertEquals(corpo.terminal, undefined);
  // A prova do Achado A2: `processing` nunca gasta uma chamada de cancelamento
  // que se sabe de antemão que o MP recusaria (só `action_required`/`created`
  // são canceláveis) — só a consulta, nenhum POST /cancel.
  assertEquals(mp.chamadas.length, 1);
  assertEquals(mp.cancelamentos().length, 0);
  assertEquals(mp.criacoes().length, 0);
  assertEquals(chamadasRpc.length, 0);
  assertEquals(registro.chamadasUpdate, 0);
});

// Achado A2 (revisão de risco, 26/09/2026): o cartão em DESAFIO 3DS
// (`action_required`) é CANCELÁVEL — ao contrário de `processing`, acima.
// Sem isto, o cliente que abandona o desafio (~40 min no banco emissor,
// contra 30 min de reserva) ficava preso: sem cartão (o desafio nunca
// resolve) e sem PIX (409 para sempre, até o pg_cron matar a reserva).

Deno.test("vaga (f): cartão no DESAFIO 3DS na vaga + pedido de PIX -> CANCELA o cartão no MP, libera a vaga e cria o PIX", async () => {
  const { supabase, registro, chamadasRpc } = cenarioCartao({
    pedido: pedidoBase({ user_id: DONO_LOGADO, gateway_payment_id: ORDER_CARTAO_NA_VAGA }),
    releitura: pedidoBase({ user_id: DONO_LOGADO, gateway_payment_id: null, tentativas_de_pagamento: 1 }),
  });
  const mp = fetchMP({
    consultar: {
      status: 200,
      corpo: orderDeCartao("action_required", "pending_challenge", { id: ORDER_CARTAO_NA_VAGA, url3ds: URL_DESAFIO }),
    },
    cancelar: { status: 200, corpo: orderDeCartao("canceled", "canceled", { id: ORDER_CARTAO_NA_VAGA }) },
    criar: { status: 201, corpo: orderDePix("action_required", "waiting_transfer") },
  });

  const resposta = await handler(requisicao({ orderId: UUID, metodo: "pix" }, montarToken(DONO_LOGADO)), {
    supabase,
    fetchImpl: mp.fn,
  });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  assertEquals(corpo.qrCode, "QRCODE-DA-VAGA");
  // Ordem que importa: consulta -> cancela o cartão -> cria o PIX.
  assertEquals(mp.chamadas.map((c) => `${c.method} ${c.url.replace("https://api.mercadopago.com", "")}`), [
    `GET /v1/orders/${ORDER_CARTAO_NA_VAGA}`,
    `POST /v1/orders/${ORDER_CARTAO_NA_VAGA}/cancel`,
    "POST /v1/orders",
  ]);
  assertEquals(mp.cancelamentos()[0].headers?.["X-Idempotency-Key"], `cancelar:${ORDER_CARTAO_NA_VAGA}`);
  assertEquals(liberacoes(chamadasRpc), [{ p_order_id: UUID, p_gateway_payment_id: ORDER_CARTAO_NA_VAGA }]);
  assertEquals(registro.valoresUpdate?.metodo_online, "pix");
});

for (
  const falha of [
    { nome: "MP recusa o cancelamento (desafio resolvido no meio do caminho)", cancelar: { status: 409, corpo: { errors: [{ code: "cannot_cancel" }] } } },
    { nome: "MP responde 200 mas a order NÃO está cancelada", cancelar: { status: 200, corpo: orderDeCartao("action_required", "pending_challenge", { id: ORDER_CARTAO_NA_VAGA }) } },
    { nome: "MP fora do ar (500)", cancelar: { status: 500, corpo: {} } },
  ]
) {
  Deno.test(`vaga (f): cartão no DESAFIO 3DS + ${falha.nome} -> 409 recuperável de sempre, vaga intacta, sem criar PIX`, async () => {
    const { supabase, registro, chamadasRpc } = cenarioCartao({
      pedido: pedidoBase({ user_id: DONO_LOGADO, gateway_payment_id: ORDER_CARTAO_NA_VAGA }),
    });
    const mp = fetchMP({
      consultar: {
        status: 200,
        corpo: orderDeCartao("action_required", "pending_challenge", { id: ORDER_CARTAO_NA_VAGA, url3ds: URL_DESAFIO }),
      },
      cancelar: falha.cancelar,
    });

    const resposta = await handler(requisicao({ orderId: UUID, metodo: "pix" }, montarToken(DONO_LOGADO)), {
      supabase,
      fetchImpl: mp.fn,
    });
    const corpo = await resposta.json();

    assertEquals(resposta.status, 409);
    assertEquals(corpo.error, "Há um pagamento com cartão em análise para este pedido.");
    assertEquals(corpo.terminal, undefined);
    assertEquals(mp.criacoes().length, 0);
    assertEquals(chamadasRpc.length, 0);
    assertEquals(registro.chamadasUpdate, 0);
  });
}

Deno.test("vaga (f): cartão JÁ PAGO na vaga + pedido de PIX -> 200 'pago', nunca um PIX por cima", async () => {
  const { supabase } = cenarioCartao({
    pedido: pedidoBase({ user_id: DONO_LOGADO, gateway_payment_id: ORDER_CARTAO_NA_VAGA }),
  });
  const mp = fetchMP({
    consultar: { status: 200, corpo: orderDeCartao("processed", "accredited", { id: ORDER_CARTAO_NA_VAGA }) },
  });

  const resposta = await handler(requisicao({ orderId: UUID, metodo: "pix" }, montarToken(DONO_LOGADO)), {
    supabase,
    fetchImpl: mp.fn,
  });

  assertEquals((await resposta.json()).statusPagamento, "pago");
  assertEquals(mp.criacoes().length, 0);
});

// --- liberar a vaga: falhas e corridas --------------------------------------

Deno.test("liberar a vaga FALHA (erro de banco) -> 503 recuperável, sem cobrar nada", async () => {
  const { supabase, registro } = cenarioCartao({
    pedido: pedidoBase({ user_id: DONO_LOGADO, gateway_payment_id: ORDER_CARTAO_NA_VAGA }),
    erroLiberar: { message: "connection reset" },
  });
  const mp = fetchMP({
    consultar: { status: 200, corpo: orderDeCartao("failed", "failed", { id: ORDER_CARTAO_NA_VAGA }) },
  });

  const resposta = await handler(requisicao(corpoCartao(), montarToken(DONO_LOGADO)), {
    supabase,
    fetchImpl: mp.fn,
  });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 503);
  assertEquals(corpo.error, "Não foi possível liberar a cobrança anterior. Tente de novo em instantes.");
  assertEquals(corpo.terminal, undefined);
  assertEquals(mp.criacoes().length, 0);
  assertEquals(registro.chamadasUpdate, 0);
});

Deno.test("liberar devolve false e a RELEITURA mostra a vaga ocupada por outra cobrança (corrida) -> 409 recuperável, sem cobrar", async () => {
  const { supabase } = cenarioCartao({
    pedido: pedidoBase({ user_id: DONO_LOGADO, gateway_payment_id: ORDER_CARTAO_NA_VAGA }),
    releitura: pedidoBase({ user_id: DONO_LOGADO, gateway_payment_id: "ORDTST01OUTRAABA", tentativas_de_pagamento: 1 }),
    resultadoLiberar: false,
  });
  const mp = fetchMP({
    consultar: { status: 200, corpo: orderDeCartao("failed", "failed", { id: ORDER_CARTAO_NA_VAGA }) },
  });

  const resposta = await handler(requisicao(corpoCartao(), montarToken(DONO_LOGADO)), {
    supabase,
    fetchImpl: mp.fn,
  });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 409);
  assertEquals(corpo.error, "Este pedido já tem uma cobrança gerada.");
  assertEquals(corpo.terminal, undefined);
  assertEquals(mp.criacoes().length, 0);
});

Deno.test("RELEITURA depois de liberar mostra o pedido 'expirado' -> 409 TERMINAL, sem cobrar", async () => {
  const { supabase } = cenarioCartao({
    pedido: pedidoBase({ user_id: DONO_LOGADO, gateway_payment_id: ORDER_CARTAO_NA_VAGA }),
    releitura: pedidoBase({ user_id: DONO_LOGADO, payment_status: "expirado", gateway_payment_id: null }),
  });
  const mp = fetchMP({
    consultar: { status: 200, corpo: orderDeCartao("expired", "expired", { id: ORDER_CARTAO_NA_VAGA }) },
  });

  const resposta = await handler(requisicao(corpoCartao(), montarToken(DONO_LOGADO)), {
    supabase,
    fetchImpl: mp.fn,
  });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 409);
  assertEquals(corpo.error, "Este pedido não está aguardando pagamento.");
  assertEquals(corpo.terminal, true);
  assertEquals(mp.criacoes().length, 0);
});

Deno.test("RELEITURA depois de liberar FALHA (erro de banco) -> 503 recuperável 'Não foi possível verificar o pedido.'", async () => {
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const chamadasRpc: Array<{ nome: string; args: Record<string, unknown> }> = [];
  const base = clienteFalso({
    pedido: pedidoBase({ user_id: DONO_LOGADO, gateway_payment_id: ORDER_CARTAO_NA_VAGA }),
    gravado: { id: UUID },
    configCartao: CONFIG_CARTAO_LIGADO,
    chamadasRpc,
  });
  // A 2ª leitura de marketplace_orders (a releitura) falha.
  let leiturasPedido = 0;
  const supabase = {
    rpc: base.rpc,
    from(tabela: string) {
      const alvo = base.from(tabela);
      if (tabela !== "marketplace_orders") return alvo;
      return {
        ...alvo,
        select(colunas: string) {
          leiturasPedido++;
          if (leiturasPedido === 2) {
            return {
              eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: "timeout" } }) }),
            };
          }
          return alvo.select(colunas);
        },
      };
    },
  };
  const mp = fetchMP({
    consultar: { status: 200, corpo: orderDeCartao("failed", "failed", { id: ORDER_CARTAO_NA_VAGA }) },
  });

  const resposta = await handler(requisicao(corpoCartao(), montarToken(DONO_LOGADO)), {
    supabase,
    fetchImpl: mp.fn,
  });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 503);
  assertEquals(corpo.error, "Não foi possível verificar o pedido.");
  assertEquals(liberacoes(chamadasRpc).length, 1);
  assertEquals(mp.criacoes().length, 0);
});

Deno.test("vaga com id CLÁSSICO (PIX legado) + pedido de cartão: não pago -> 409 recuperável sem tocar a Orders API; pago -> 200 'pago'", async () => {
  const pendente = cenarioCartao({
    pedido: pedidoBase({ user_id: DONO_LOGADO, gateway_payment_id: "112233445566" }),
  });
  const urls: string[] = [];
  const respostaPendente = await handler(requisicao(corpoCartao(), montarToken(DONO_LOGADO)), {
    supabase: pendente.supabase,
    fetchImpl: async (url: string) => {
      urls.push(url);
      return new Response(JSON.stringify({ id: 112233445566, status: "pending" }), { status: 200 });
    },
  });
  assertEquals(respostaPendente.status, 409);
  assertEquals(
    (await respostaPendente.json()).error,
    "Não foi possível trocar para cartão agora. Tente de novo em instantes.",
  );
  assertEquals(urls.length, 1);
  assertEquals(urls[0].includes("/v1/payments/112233445566"), true);
  assertEquals(pendente.chamadasRpc.length, 0);

  const pago = cenarioCartao({
    pedido: pedidoBase({ user_id: DONO_LOGADO, gateway_payment_id: "112233445566" }),
  });
  const respostaPaga = await handler(requisicao(corpoCartao(), montarToken(DONO_LOGADO)), {
    supabase: pago.supabase,
    fetchImpl: async () => new Response(JSON.stringify({ id: 112233445566, status: "approved" }), { status: 200 }),
  });
  assertEquals(respostaPaga.status, 200);
  assertEquals((await respostaPaga.json()).statusPagamento, "pago");
});
