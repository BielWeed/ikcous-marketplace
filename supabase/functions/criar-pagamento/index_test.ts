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
  expiracaoParaDesafio3ds,
  expiracaoRealinhavel,
  handler,
  MENSAGEM_CREDENCIAL_RECUSADA,
  MINUTOS_DESAFIO_3DS,
  pareceUuid,
  podeCobrar,
  subDoToken,
  validarCorpoDoCartao,
} from "./index.ts";
// BLOQUEIO (7ª revisão de risco, 26/09/2026): os testes de relógio REALISTA
// (B1, Q3) precisam do limite inferior de VERDADE gravado no sentinela, não
// de um valor calculado antes da chamada que o escreve — a MESMA técnica
// que o harness do 6º/7º revisor usa (`limiteInferiorDoSentinela` do
// sentinela lido do banco, nunca um timestamp adivinhado). `resolverSentinela`
// (achado #1, 8ª rodada de risco, 26/09/2026): prova, num nível abaixo do
// handler, que o limite PRESERVADO ainda libera quando a order que ele
// protege aparece morta.
import { limiteInferiorDoSentinela, resolverSentinela, sentinelaDaChave, vagaEmVerificacao } from "../_shared/mercadopago.ts";
import { COLUNAS_DO_PEDIDO_PARA_O_ANTIFRAUDE } from "../_shared/dados-antifraude.ts";
// Tarefa mp-2: as MESMAS primitivas de cifra da produção montam o registro
// do lojista nos testes do fim deste arquivo — fixture escrito à mão não
// provaria que a function decifra de verdade. Desde a tarefa mp-6 o fixture
// vem PRONTO de `_shared/credenciais-mp_fixtures.ts`: era a mesma montagem
// copiada em cinco suítes, e cópia de fixture envelhece calada.
import {
  CHAVE_CIFRA_TESTE,
  PUBLIC_KEY_LOJISTA_FALSA,
  registroMpDeTeste,
  TOKEN_AMBIENTE_FALSO as TOKEN_PLATAFORMA_FALSO,
  TOKEN_LOJISTA_FALSO,
  WEBHOOK_AMBIENTE_FALSO,
  WEBHOOK_LOJISTA_FALSO,
} from "../_shared/credenciais-mp_fixtures.ts";
import type { CredenciaisMp } from "../_shared/credenciais-mp.ts";

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
  // Achado R2 (2ª revisão de risco, 26/09/2026) — o que o SEGUNDO `.update()`
  // (a adoção da vaga, quando a primeira gravação perdeu para um PIX
  // concorrente que deu para cancelar) devolve. `undefined` (default): usa
  // `gravado` também na segunda chamada — o comportamento de sempre, para
  // não afetar nenhum teste que não conhece este achado.
  gravadoAdocao?: Record<string, unknown> | null;
  // Blindagem do cartão (02/10/2026): desde a RESERVA da vaga antes do POST,
  // o cartão faz uma gravação A MAIS (a reserva) antes da gravação final.
  // Quando definido, o N-ésimo `.update()` devolve `gravadosPorChamada[N-1]`
  // (e cai em `gravado`/`gravadoAdocao` depois do fim da lista) — é o que
  // permite simular "a reserva gravou, a gravação final perdeu".
  gravadosPorChamada?: Array<Record<string, unknown> | null>;
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
    // Todas as gravações, na ordem (a reserva e a final são DUAS desde a
    // blindagem de 02/10/2026; `valoresUpdate`/`filtrosUpdate` guardam só a
    // última).
    historico?: Array<{ valores: Record<string, unknown>; filtros: Array<[string, unknown]> }>;
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
  // Dados do comprador no cartão (03/10/2026): as três leituras de MELHOR
  // ESFORÇO que a edge faz para o antifraude. Ficam em ramos PRÓPRIOS do
  // dublê — nunca contam na `chamadasSelect` do pedido (senão a releitura
  // pós-UPDATE-falho andaria uma casa e todo teste de corrida mediria outra
  // coisa). Default: nada a ler (itens vazios, sem colunas extras, sem
  // endereço salvo).
  itensDoPedido?: unknown;
  colunasExtrasDoPedido?: Record<string, unknown> | null;
  enderecoSalvo?: Record<string, unknown> | null;
  // "erro" -> `{data:null,error}`; "lanca" -> exceção — para TODAS as leituras.
  falhaNaLeituraDoAntifraude?: "erro" | "lanca";
  leiturasDoAntifraude?: Array<{ tabela: string; colunas: string; filtros: Array<[string, unknown]> }>;
}) {
  let chamadasSelect = 0;
  const leituraDoAntifraude = (tabela: string, colunas: string, resposta: unknown) => {
    const leitura = { tabela, colunas, filtros: [] as Array<[string, unknown]> };
    opts.leiturasDoAntifraude?.push(leitura);
    const entregar = () => {
      if (opts.falhaNaLeituraDoAntifraude === "lanca") {
        throw new Error("banco caiu — telefone 11987654321 e Rua Secreta 99");
      }
      if (opts.falhaNaLeituraDoAntifraude === "erro") {
        return Promise.resolve({ data: null, error: { message: "falha 11987654321 Rua Secreta 99" } });
      }
      return Promise.resolve({ data: resposta, error: null });
    };
    const cadeia = {
      eq(coluna: string, valor: unknown) {
        leitura.filtros.push([coluna, valor]);
        return cadeia;
      },
      maybeSingle: () => entregar(),
      then: (ok: (v: unknown) => unknown, nok?: (e: unknown) => unknown) => {
        try {
          return entregar().then(ok, nok);
        } catch (e) {
          return Promise.reject(e).then(ok, nok);
        }
      },
    };
    return cadeia;
  };
  // Blindagem do cartão (02/10/2026): o que as gravações BEM-SUCEDIDAS (as
  // que devolveram linha) escreveram. Uma releitura SEM `releitura` explícita
  // passa a ver o pedido com essas escritas — antes ela devolvia o fixture
  // original, e a reserva da vaga (que grava ANTES do POST) ficava invisível
  // para a própria chamada: o dublê dizia "vaga livre" com o sentinela já
  // gravado. `releitura` explícita continua mandando (é o retrato que o teste
  // quer de outra aba/escritor).
  const estadoGravado: Record<string, unknown> = {};
  return {
    rpc: async (nome: string, args: Record<string, unknown>) => {
      opts.chamadasRpc?.push({ nome, args });
      if (nome !== "liberar_cobranca_do_pedido") {
        throw new Error(`rpc inesperada nos testes da criar-pagamento: ${nome}`);
      }
      if (opts.erroLiberar) return { data: null, error: opts.erroLiberar };
      const liberou = opts.resultadoLiberar ?? true;
      // Mesma regra da RPC real (casamento EXATO da vaga): quando a vaga que o
      // dublê conhece é a que está sendo liberada, ela volta livre e a
      // tentativa avança — senão a releitura seguinte veria a reserva viva.
      if (
        liberou && "gateway_payment_id" in estadoGravado &&
        estadoGravado.gateway_payment_id === args.p_gateway_payment_id
      ) {
        estadoGravado.gateway_payment_id = null;
        estadoGravado.metodo_online = null;
        estadoGravado.tentativas_de_pagamento = Number(opts.pedido?.tentativas_de_pagamento ?? 0) + 1;
      }
      return { data: liberou, error: null };
    },
    from(tabela: string) {
      if (tabela === "marketplace_order_items") {
        return {
          select: (colunas: string) => leituraDoAntifraude(tabela, colunas, opts.itensDoPedido ?? []),
        };
      }
      if (tabela === "user_addresses") {
        return {
          select: (colunas: string) => leituraDoAntifraude(tabela, colunas, opts.enderecoSalvo ?? null),
        };
      }
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
      //
      // ⚠️ POLÍTICA DO PIX (Gabriel, 29/09/2026): `registroMp` AUSENTE agora
      // significa o registro do lojista COM chave de assinatura do webhook —
      // a única configuração em que o PIX é criado desde a política. Para os
      // casos da plataforma passe `registroMp: null` EXPLICITAMENTE (cartão
      // segue funcionando; PIX recusado 409 `pixSemChaveDeAssinatura`); para
      // lojista sem a chave, `registroMp: await registroMpDeTeste({
      // webhookSecret: null })`. Os quatro casos da matriz estão provados em
      // testes próprios no fim deste arquivo.
      if (tabela === "app_settings") {
        return {
          select(_cols: string) {
            return {
              eq(_col: string, _val: unknown) {
                return {
                  maybeSingle: async () => {
                    // O cofre precisa existir NO MOMENTO DA LEITURA: testes de
                    // credencial mais antigos apagam MP_CHAVES_ENCRYPTION_KEY
                    // no `finally` deles (a baseline antiga era "sem cofre").
                    // Só para o caminho default: quem passa `registroMp`
                    // explícito gerencia o próprio ambiente (ex.: o teste do
                    // cofre ausente continua dono do delete dele). A string é
                    // PRÉ-SERIALIZADA (top-level await no fim do arquivo) —
                    // zero await interno, para não mudar o interleaving das
                    // corridas reais (bancoComEstado).
                    if (opts.registroMp === undefined) {
                      Deno.env.set("MP_CHAVES_ENCRYPTION_KEY", CHAVE_CIFRA_TESTE);
                    }
                    const registro = opts.registroMp === undefined
                      ? REGISTRO_LOJISTA_JSON
                      : opts.registroMp === null
                      ? null
                      : JSON.stringify(opts.registroMp);
                    return {
                      data: registro ? { value: registro } : null,
                      error: null,
                    };
                  },
                };
              },
            };
          },
        };
      }
      return {
        select(_cols: string) {
          if (_cols === COLUNAS_DO_PEDIDO_PARA_O_ANTIFRAUDE) {
            return leituraDoAntifraude(tabela, _cols, opts.colunasExtrasDoPedido ?? {});
          }
          chamadasSelect++;
          const primeiraLeitura = chamadasSelect === 1;
          const erro = primeiraLeitura ? opts.erroLeitura ?? null : null;
          const dadosBrutos = erro
            ? null
            : primeiraLeitura
              ? opts.pedido
              : opts.releitura ?? (opts.pedido === null ? null : { ...opts.pedido, ...estadoGravado });
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
            opts.registro.historico?.push({ valores: _valores, filtros: opts.registro.filtrosUpdate });
          }
          // Achado R2 (2ª revisão de risco, 26/09/2026): a "adoção" da vaga
          // (cancela o PIX concorrente e grava o cartão já aprovado) faz um
          // SEGUNDO `.update()` na MESMA requisição — depois de a gravação
          // original ter perdido a corrida (`opts.gravado`, o PRIMEIRO
          // `.update()`, devolvendo null). `gravadoAdocao`, quando definido,
          // é o que ESTE segundo `.update()` devolve — sem isto os dois
          // usariam o MESMO fixture (`opts.gravado`), e não daria para
          // simular "a primeira falhou, a segunda teve sucesso".
          const numeroDestaChamada = opts.registro?.chamadasUpdate ?? 1;
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
            neq(coluna: string, valor: unknown) {
              registrarFiltro(`${coluna}<>`, valor);
              return encadeador;
            },
            is(coluna: string, valor: unknown) {
              registrarFiltro(coluna, valor);
              return encadeador;
            },
            select(_cols: string) {
              return {
                maybeSingle: async () => {
                  const linha = opts.gravadosPorChamada !== undefined &&
                      numeroDestaChamada <= opts.gravadosPorChamada.length
                    ? opts.gravadosPorChamada[numeroDestaChamada - 1]
                    : numeroDestaChamada >= 2 && opts.gravadoAdocao !== undefined
                    ? opts.gravadoAdocao
                    : opts.gravado;
                  if (linha !== null) Object.assign(estadoGravado, _valores);
                  return { data: projetarColunas(linha, _cols), error: null };
                },
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

// --- expiracaoParaDesafio3ds: Achado R4 (2ª revisão de risco, 26/09/2026) —
// a extensão do 3DS tem que ter um TETO ABSOLUTO a partir da CRIAÇÃO do
// pedido, não só de "agora" (cada tentativa nova recontava os 40 min do
// zero). `AGORA` (topo do arquivo) é usado como o instante da TENTATIVA;
// `pedidoCriadoEm` varia por teste.

Deno.test("expiracaoParaDesafio3ds: primeira tentativa, pedido criado agora mesmo -> estende os MINUTOS_DESAFIO_3DS de sempre", () => {
  const r = expiracaoParaDesafio3ds(null, AGORA, AGORA.toISOString());
  assertEquals(r?.toISOString(), new Date(AGORA.getTime() + MINUTOS_DESAFIO_3DS * 60_000).toISOString());
});

Deno.test("expiracaoParaDesafio3ds: tentativa TARDIA (35 min depois da criação) -> o teto NÃO soma mais 40 min a partir de agora (Achado R4)", () => {
  // Sem o teto absoluto, isto devolveria `AGORA + 40min` (12:35 + 40min =
  // 13:15) — 75 min depois da CRIAÇÃO do pedido, quase o dobro do orçamento
  // que `MINUTOS_DESAFIO_3DS` documenta ("o banco promete ~40 min"). Com o
  // teto, o resultado nunca passa de `pedidoCriadoEm + 40min`.
  const criadoEm = AGORA; // pedido nasceu às 12:00
  const tentativaTardia = new Date(AGORA.getTime() + 35 * 60_000); // 12:35
  const r = expiracaoParaDesafio3ds(null, tentativaTardia, criadoEm.toISOString());
  assertEquals(r?.toISOString(), new Date(criadoEm.getTime() + MINUTOS_DESAFIO_3DS * 60_000).toISOString());
});

Deno.test("expiracaoParaDesafio3ds: tentativa depois que o teto absoluto já passou -> null se o expires_at atual já está além dele", () => {
  const criadoEm = AGORA;
  const tentativaBemTardia = new Date(AGORA.getTime() + 50 * 60_000); // 12:50, já além do teto (12:40)
  const expiresAtAtual = new Date(criadoEm.getTime() + MINUTOS_DESAFIO_3DS * 60_000).toISOString(); // 12:40
  const r = expiracaoParaDesafio3ds(expiresAtAtual, tentativaBemTardia, criadoEm.toISOString());
  assertEquals(r, null);
});

Deno.test("expiracaoParaDesafio3ds: sem pedidoCriadoEm (defensivo) -> cai no comportamento de antes, sem teto absoluto", () => {
  const r = expiracaoParaDesafio3ds(null, AGORA);
  assertEquals(r?.toISOString(), new Date(AGORA.getTime() + MINUTOS_DESAFIO_3DS * 60_000).toISOString());
});

// --- sentinelaExpirado/MINUTOS_SENTINELA_PRESO: REMOVIDOS no Ponto 1 da 4ª
// revisão de risco (26/09/2026) — o teto fixo de relógio abria uma janela de
// DUAS cobranças capturadas (cartão em `processing` pode levar dias em
// análise antifraude). No lugar, `resolverVagaEmVerificacao`/`buscarOrders
// DoPedido`/`resolverSentinela` resolvem por FATO (busca na Orders API) — os
// testes de unidade de `resolverSentinela` moram em
// `_shared/mercadopago_test.ts`; o comportamento do HANDLER com um sentinela
// na vaga está nos testes "Ponto 1" mais abaixo (busca falha/encontra viva/
// encontra morta) e nos Q1/Q2/Q2b portados da 4ª revisão de risco.

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
  // POLÍTICA DO PIX (29/09/2026): `registroMp: null` EXPLÍCITO — este teste
  // prova o caminho da PLATAFORMA sem MP_ACCESS_TOKEN no ambiente. O default
  // do dublê agora é o registro do lojista COM chave (que tem token próprio,
  // e deixaria de provar o 503 terminal do laudo 0109/D1).
  const supabase = clienteFalso({ pedido, gravado: { id: UUID }, registroMp: null });

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
  // Frente B (02/10/2026): o WHERE do PIX passou a ser o CAS completo —
  // não cancelado e a MESMA tentativa da chave (`pedidoBase` sem a coluna
  // vale 0, a mesma normalização da chave de idempotência).
  assertEquals(registro.filtrosUpdate, [
    ["id", UUID],
    ["payment_status", "aguardando"],
    ["status<>", "cancelled"],
    ["tentativas_de_pagamento", 0],
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

Deno.test("SANDBOX-OFICIAL (FIXTURE LOCAL da doc — NÃO é chamada à API do MP): payload byte a byte da doc oficial atravessa o handler; prova de CONTRATO apenas", async () => {
  // RÓTULO EXATO (decisão do dono, 29/09): este teste usa uma FIXTURE
  // copiada da documentação oficial do sandbox PIX — NÃO é chamada à API
  // sandbox do Mercado Pago, NÃO é ponta a ponta e NÃO valida o MP vivo,
  // a edge em ambiente real ou o webhook. O que prova: o CONTRATO local
  // de mapeamento contra o shape oficial documentado (APRO ->
  // action_required/waiting_transfer com QR completo e auto-aprovação
  // documentada). Chamada viva = item 2b do gate §6.4: exige token de
  // TESTE (APP_USR) entregue por secret — que não existe hoje.
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const pedido = pedidoBase({ user_id: DONO_LOGADO });
  const registro: { valoresUpdate?: Record<string, unknown> } = {};
  const supabase = clienteFalso({ pedido, gravado: { id: UUID }, registro });
  const corpoOficialDaDoc = {
    id: "ORD01JP84C939T20S0P1DN382FQ6K",
    type: "online",
    processing_mode: "automatic",
    external_reference: "ext_ref_1234",
    total_amount: "50.00",
    payer: { email: "test_user_br@testuser.com", first_name: "APRO" },
    country_code: "BRA",
    user_id: "123456",
    status: "action_required",
    status_detail: "waiting_transfer",
    capture_mode: "automatic",
    created_date: "2025-03-13T16:11:10.826Z",
    last_updated_date: "2025-03-13T16:11:11.736Z",
    integration_data: { application_id: "123456789" },
    transactions: {
      payments: [
        {
          id: "PAY01JP84C939T20S0P1DN6FCMWQC",
          amount: "50.00",
          reference_id: "0002gw9x2v",
          status: "action_required",
          status_detail: "waiting_transfer",
          payment_method: {
            id: "pix",
            type: "bank_transfer",
            ticket_url:
              "https://www.mercadopago.com.br/sandbox/payments/104669748043/ticket?caller_id=1985141462&hash=1eff4445-4454-4308-a6b0-d2a1651ca44f",
            qr_code:
              "00020126580014br.gov.bcb.pix0136b76aa9c2-2ec4-4110-954e-ebfe34f05b615204000053039865406200.005802BR5918TESTUSER20543760926009Sao Paulo62250521mpqrinter1046697480436304B70B",
            qr_code_base64: "",
          },
        },
      ],
    },
  };
  const fetchImpl = async () =>
    new Response(JSON.stringify(corpoOficialDaDoc), { status: 201 });

  const resposta = await handler(
    requisicao({ orderId: UUID, metodo: "pix" }, montarToken(DONO_LOGADO)),
    { supabase, fetchImpl },
  );
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  // Id adotado é o da ORDER (prefixo ORD) — reconsulta e webhook casam.
  assertEquals(corpo.paymentId, "ORD01JP84C939T20S0P1DN382FQ6K");
  assertEquals(
    registro.valoresUpdate?.gateway_payment_id,
    "ORD01JP84C939T20S0P1DN382FQ6K",
  );
  // QR EMV completo chega inteiro ao cliente (copiar e colar).
  assertEquals(
    corpo.qrCode,
    "00020126580014br.gov.bcb.pix0136b76aa9c2-2ec4-4110-954e-ebfe34f05b615204000053039865406200.005802BR5918TESTUSER20543760926009Sao Paulo62250521mpqrinter1046697480436304B70B",
  );
  // A doc traz qr_code_base64 VAZIO no sandbox — o contrato do front
  // suporta ausência de imagem sem quebrar (string vazia surfaced).
  assertEquals(corpo.qrCodeBase64, "");
  assertEquals(
    corpo.ticketUrl,
    "https://www.mercadopago.com.br/sandbox/payments/104669748043/ticket?caller_id=1985141462&hash=1eff4445-4454-4308-a6b0-d2a1651ca44f",
  );
  assertEquals(corpo.statusPagamento, "aguardando");
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
      // Blindagem do cartão (02/10/2026): a RESERVA da vaga antes do POST do
      // cartão (ou o carimbo do retry sobre o sentinela) falhou no BANCO.
      // Nenhum POST saiu, nada foi cobrado e a vaga ficou como estava; o
      // retry relê o pedido e reserva de novo.
      "Não foi possível iniciar o pagamento. Tente de novo em instantes.",
      "falha de BANCO ao reservar a vaga antes do POST do cartão; nenhuma " +
        "cobrança foi criada e a vaga ficou intacta, retry é seguro",
    ],
    [
      // Blindagem (02/10/2026): a reserva perdeu só pela FOTO velha — outra
      // aba avançou a tentativa entre a leitura e a reserva, e a vaga segue
      // livre. Nenhuma cobrança existe; o retry relê e reserva com a chave
      // nova.
      "O pagamento deste pedido mudou em outra aba. Tente de novo.",
      "a reserva perdeu pela tentativa avançada em outra aba; nada foi " +
        "cobrado e a vaga está livre, retry é seguro",
    ],
    [
      // C3 (veredito A2, achado H1d, 02/10/2026): o cartão pedido sobre um
      // sentinela não faz POST nenhum; a BUSCA da chave no MP falhou, então
      // nada foi decidido nem gravado. Contrato `verificacao: "indisponivel"`
      // do desenho A1 (4.2): o "Verificar de novo" repete só a consulta.
      "Não foi possível consultar o pagamento agora.",
      "a busca das orders do pedido no MP falhou (rede/5xx/corpo ilegível); " +
        "nenhum POST, nada gravado, sentinela intacto — consultar de novo é seguro",
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
      // Achado da 6ª rodada de risco (26/09/2026): a criação em rede/timeout/
      // 5xx passou a OCUPAR a vaga com um sentinela (`respostaCartaoAmbiguo
      // NaCriacao`) em vez de deixá-la vazia — mas a MENSAGEM devolvida ao
      // cliente continua sendo `r.erro`, só que passado como parâmetro
      // (`erroOriginal`) para não repetir o corpo do `ocuparVagaComSentinela`
      // duas vezes. Categoria idêntica a "r.erro": o MP não confirmou, e o
      // sentinela protege contra cobrança dupla (não é mais "nada foi
      // gravado", mas o retry do MESMO cartão continua seguro pela chave de
      // idempotência — o que muda é que agora um PIX/outro cartão pedidos
      // NESTA reserva ficam bloqueados até a busca resolver, em vez de
      // criarem uma segunda cobrança).
      "erroOriginal",
      "a criação terminou em rede/timeout/5xx sem confirmar se a order foi " +
        "processada; a vaga foi ocupada por um sentinela (não mais vazia), " +
        "e cartaoEmAnalise: true impede o front de oferecer PIX/cancelar",
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
      // Achado N4 (3ª revisão de risco, 26/09/2026): a gravação do sentinela
      // (`respostaCartaoEmVerificacao`) passou a checar `error` do UPDATE —
      // falha de banco (timeout, deadlock) não pode virar "já tem cobrança"
      // com a vaga ainda NULL de verdade.
      "Não foi possível confirmar a cobrança. Tente de novo em instantes.",
      "falha de BANCO ao gravar o sentinela; nada foi gravado, e o retry " +
        "repete a MESMA chave de idempotência (o MP ainda devolve o mesmo " +
        "409, mas desta vez a gravação tem chance de funcionar)",
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
  //
  // 34, não mais 33: Achado R1 (2ª revisão de risco, 26/09/2026) — um desafio
  // 3DS gravado num pedido que já não estava 'aguardando' cancela a order
  // (nada foi capturado) e devolve `json({ error: "...", terminal: true },
  // 409)` — já leva `terminal: true` no literal, não precisou de entrada na
  // lista.
  //
  // 36, não mais 34: Achado B2 (2ª revisão de risco, 26/09/2026) —
  // `respostaCartaoEmVerificacao` ganhou dois pontos de retorno próprios
  // quando a vaga do SENTINELA já não está livre: "O prazo para pagar este
  // pedido acabou." (já leva `terminal: true`) e "Este pedido já tem uma
  // cobrança gerada." (MESMO identificador já conhecido — mais uma
  // ocorrência, não uma entrada nova).
  //
  // 37, não mais 36: Achado R2 (2ª revisão de risco, 26/09/2026) — perder a
  // vaga para um PIX concorrente que não dá para cancelar (já pago, ou o
  // cancelamento falha) com um cartão JÁ APROVADO na mão ganhou um ponto de
  // retorno próprio, "Seu cartão pode ter sido cobrado; a loja vai conferir e
  // confirmar o pedido em breve." — já leva `terminal: true` (um retry não
  // pode criar uma segunda cobrança), não precisou de entrada na lista.
  //
  // 39, não mais 37: Achado S1 (3ª revisão de risco, 26/09/2026) — o
  // sentinela PRESO DEMAIS (antigo `sentinelaExpirado`, removido no Ponto 1
  // da 4ª revisão — ver abaixo) caía na liberação comum, mas enquanto ele
  // estava fresco um PIX pedido sobre ele ganhou um ponto de retorno próprio
  // com "Há um pagamento com cartão em análise para este pedido." (MESMO
  // identificador do ramo (f), já conhecido — mais uma ocorrência, não uma
  // entrada nova). Achado N4, no mesmo commit — a gravação do sentinela
  // ganhou um ponto de retorno NOVO para erro de banco, "Não foi possível
  // confirmar a cobrança. Tente de novo em instantes." (entrada nova na
  // lista, acima). +1 +1 = 39.
  //
  // 40, não mais 39: Ponto 1 (4ª revisão de risco, 26/09/2026) — substituiu
  // o teto de relógio (`sentinelaExpirado`/`MINUTOS_SENTINELA_PRESO`) por
  // `resolverVagaEmVerificacao` (busca as orders de cartão na Orders API).
  // Quando a busca resolve o sentinela para um id REAL mas a GRAVAÇÃO desse
  // id na vaga falha por erro de banco, o ponto de retorno é NOVO: "Não foi
  // possível verificar o pedido." (MESMO identificador da releitura pós-
  // liberação, já conhecido — mais uma ocorrência). Os dois "Há um
  // pagamento com cartão em análise para este pedido." continuam sendo
  // EXATAMENTE dois pontos de retorno (só ganharam o campo `cartaoEmAnalise`
  // — achado B3 da revisão do checkout front, mesmo commit — que este regex
  // não conta, porque só olha `error:`/status). 39 + 1 = 40.
  //
  // 45, não mais 40: achado da 7ª rodada de risco (26/09/2026, flag scoping,
  // item 3). O escopo da `cartaoEmAnalise` na reconsulta da vaga que falha
  // virou condicional (`pedido.metodo_online` credito/debito) — sem chave
  // aninhada no literal (o regex não entende objeto aninhado), então virou
  // DOIS `json({error: r.erro}, 502)` em vez de um: +1. A corrida perdida
  // depois do UPDATE final (`cartaoAmbiguoAposCorrida`) ganhou a MESMA
  // duplicação nos três pontos de retorno já existentes (prazo acabou, já
  // tem cobrança, não foi possível confirmar) — cada um virou dois: +3.
  // MESMOS identificadores de sempre (`recuperaveisConhecidas` já os
  // conhece, ou já levam `terminal: true`), nenhuma entrada nova na lista.
  // 40 + 1 + 3 = 44 — mas o item 2a (definite 4xx nunca é ambíguo) também
  // separou o antigo `respostaCartaoAmbiguoNaCriacao` único num `if
  // (status === 0 || status >= 500)` + um `json({error: r.erro}, 502)` NOVO
  // para o 4xx definitivo que sobra (429/404/422/...): +1. 44 + 1 = 45.
  //
  // 46, não mais 45: achado #4b (8ª rodada de risco, 26/09/2026, flag
  // scoping). O 409 "Este pedido já tem uma cobrança gerada." da RELEITURA
  // depois de liberar (`decisaoDepoisDeLiberar.acao === "reconsultar"`)
  // virou condicional (sentinela OU cartão vivo no `pedidoRelido`) — mesma
  // duplicação sem chave aninhada de sempre: +1. O par equivalente da
  // corrida na gravação final (`atual?.gateway_payment_id`) só GANHOU mais
  // condições no MESMO `if` que já disparava um dos dois `json(...)`
  // existentes (`cartaoAmbiguoAposCorrida`) — nenhum ponto de retorno novo
  // ali. Os achados #1/#2a-408-409/#3/#4a não tocam `json(...)` novo (o #1
  // só faz `ocuparVagaComSentinela` devolver mais cedo; o #2a-408-409 só
  // alarga a CONDIÇÃO que já levava ao mesmo par de chamadas de sempre; o #3
  // só condiciona um `await liberarCobranca(...)` já existente, sem trocar o
  // `json(...)` que vem depois; o #4a só sincroniza uma variável em
  // memória). 45 + 1 = 46.
  //
  // 47, não mais 46: achado A da revisão de risco da migration 80 (26/09/
  // 2026, adendo à 8ª rodada, prova W). O cancelamento do cliente
  // (`update_order_status_atomic`) grava `status = 'cancelled'` sem tocar
  // `payment_status` — a gravação da cobrança de cartão ganhou um ponto de
  // retorno NOVO para quando a Orders API já aprovou/está processando
  // (`processed`/`processing`) e a corrida encontra a vaga cancelada: avisa
  // o admin e devolve "Seu cartão pode ter sido cobrado…" (MESMO
  // identificador do N7, já conhecido — mais uma ocorrência, não uma entrada
  // nova). O ramo irmão (`action_required`/`created`) reaproveita o `json(...)`
  // já existente de "O prazo para pagar este pedido acabou." (só ganhou mais
  // uma condição no `if`) — nenhum ponto de retorno novo ali. 46 + 1 = 47.
  //
  // 48, não mais 47: achado #4 (nit, revisão de risco da 9ª rodada, 26/09/
  // 2026, prova R8-3b). O ramo `action_required`/`created` de `pedidoJaMorto`
  // passou a distinguir cancelamento de expiração na MENSAGEM — "Este pedido
  // foi cancelado." é um literal NOVO (já leva `terminal: true`, não precisa
  // de entrada em `recuperaveisConhecidas`); "O prazo para pagar este pedido
  // acabou." continua a mesma ocorrência de sempre para a expiração pelo
  // relógio. 47 + 1 = 48.
  //
  // 49, não mais 48: POLÍTICA DO PIX (Gabriel, 29/09/2026). O gate da chave
  // de assinatura do webhook DA LOJA acrescentou um ponto de retorno NOVO —
  // o 409 "Para pagar com Pix, a loja precisa cadastrar a chave de assinatura
  // do webhook do Mercado Pago." (leva `terminal: true` e a flag
  // `pixSemChaveDeAssinatura`: cadastrar a chave é conserto de DIAS no painel
  // do MP/tela Ajustes, e o retry do cliente não muda nada enquanto isso —
  // mesmo contrato do "Pagamento indisponível." terminal do laudo 0109/D1).
  // 48 + 1 = 49.
  //
  // 52, não mais 49: BLINDAGEM DO CARTÃO (02/10/2026) — a vaga é reservada
  // com o sentinela ANTES do POST. Saem 3 pontos do antigo
  // `ocuparVagaComSentinela` (503 de banco, 409 de prazo terminal, 409
  // "já tem cobrança" com `cartaoEmAnalise`); entram 6: o 503 de banco da
  // reserva e o do carimbo do retry ("Não foi possível iniciar o
  // pagamento…", entrada nova na lista acima), o 409 terminal com o motivo
  // de `podeCobrar` quando a reserva perde para um pedido já morto, os dois
  // 409 "Este pedido já tem uma cobrança gerada." da reserva perdida (com e
  // sem `cartaoEmAnalise`) e o 409 "Há um pagamento com cartão em análise…"
  // do carimbo perdido (identificadores já conhecidos). 49 - 3 + 6 = 52.
  //
  // 53, não mais 52: a reserva perdida com a vaga AINDA livre (tentativa
  // avançada em outra aba) responde "O pagamento deste pedido mudou em
  // outra aba. Tente de novo." — entrada nova na lista acima.
  //
  // 55, não mais 53: Frente B (02/10/2026, auditoria "estados A") — o PIX
  // que perde a gravação final porque o pedido foi CANCELADO durante o POST
  // responde o 409 terminal "Este pedido foi cancelado." (leva `terminal:
  // true`), e o que perde porque a tentativa AVANÇOU responde o 409
  // recuperável "O pagamento deste pedido mudou em outra aba. Tente de
  // novo." (identificador já conhecido). 53 + 2 = 55.
  //
  // 56, não mais 55: A3.2 (02/10/2026, auditoria "estados B") — o cartão
  // que perde a gravação porque a notificação soltou a vaga e AVANÇOU a
  // tentativa durante o POST, com o GET dizendo que a order ainda está viva,
  // responde o 409 "Seu cartão pode ter sido cobrado…" (identificador já
  // conhecido, com `terminal: true`). 55 + 1 = 56.
  //
  // 58, não mais 56: veredito A2 (revisor financeiro, 02/10/2026) — o
  // pedido CANCELADO com a tentativa avançada e a order morta responde o 409
  // terminal "Este pedido foi cancelado." (8b), e o desafio 3DS que perde a
  // vaga e é cancelado no MP responde o 409 recuperável "Não foi possível
  // confirmar a cobrança." (8c) — os dois identificadores já conhecidos. O
  // "pode ter sido cobrado" do A3.2 continua UM ponto de retorno (agora
  // dentro de `respostaSemRegistro`). 56 + 2 = 58.
  //
  // 60, não mais 58: C2 (02/10/2026) — o modo `verificar` ganhou os dois
  // 409 terminais de `motivoParaNaoVerificar` (antes de agir e depois de
  // reler a vaga; levam `terminal: true`). O 503 "Não foi possível consultar
  // o pagamento agora." do C3 mudou de lugar para `respostaIndisponivel`
  // (continua UM ponto de retorno, usado pelo C3 e pelo C2). 58 + 2 = 60.
  assertEquals(achados, 60);
});

// Achado B3 (revisão do checkout front, 26/09/2026), ampliado na 6ª, na 7ª e
// na 8ª rodada (revisão do checkout front, 26/09/2026): a tela do checkout
// (outro agente) decide se pode oferecer "Cancelar pedido"/PIX olhando o
// campo `cartaoEmAnalise` — o contrato é "um cartão pode existir, num estado
// que esta function não comprovou morto; nunca ofereça PIX, nunca ofereça
// cancelar". Onze pontos de retorno cumprem essa condição hoje:
//   1-2. os dois 409 de "cartão em análise" originais (sentinela não
//        resolvido; cartão `processing`/cancelamento negado);
//   3. a reconsulta da vaga (`consultarOrder`) que falha (502) — SÓ quando
//      `pedido.metodo_online` já é credito/debito (achado R6-P5b da 7ª
//      rodada: sem isto, um PIX-only também herdava a flag);
//   4. a criação ambígua — rede/timeout/5xx, 408, ou um 409 sem o código de
//      idempotência (502, achado #5 da 8ª rodada) — o MP pode ter processado
//      a order antes de a resposta se perder;
//   5. o N7 terminal, "Seu cartão pode ter sido cobrado…" (409) — perdeu a
//      corrida da vaga com uma cobrança aprovada (ou irreversível) na mão;
//   6-7. `ocuparVagaComSentinela` perdeu a corrida ao gravar o sentinela —
//        "prazo acabou" e "já tem uma cobrança gerada" (achado da 7ª rodada:
//        esta chamada SEMPRE tem um cartão ambíguo por trás);
//   8-9. a mesma corrida perdida no UPDATE final (`cartaoAmbiguoAposCorrida`,
//        achado da 7ª rodada) — SÓ quando o cancelamento da NOSSA order
//        falhou, ou a releitura falhou; se o cancelamento teve sucesso e a
//        vaga segura um PIX de outra aba, a flag fica de fora de propósito.
//        Achado #4b (8ª rodada): "já tem uma cobrança gerada" TAMBÉM leva a
//        flag quando o OCUPANTE (`atual`, lido com `metodo_online`) é
//        sentinela ou cartão vivo, mesmo sem `cartaoAmbiguoAposCorrida`
//        (metodo desta chamada podia ser PIX) — MESMO ponto de retorno, não
//        um novo.
//   10. a releitura depois de LIBERAR a vaga (`decisaoDepoisDeLiberar.acao
//       === "reconsultar"`) — achado #4b (8ª rodada): SÓ quando o
//       `pedidoRelido` mostra sentinela ou cartão vivo (`metodo_online`
//       credito/debito).
//   11. a gravação da cobrança encontra o pedido CANCELADO pelo cliente
//       (`gravado.status === "cancelled"`, achado A da revisão de risco da
//       migration 80, adendo à 8ª rodada) com a order `processed`/
//       `processing` — MESMA mensagem do N7 (ponto 5), ponto de retorno
//       diferente.
//   12. A3.2 (02/10/2026): a gravação perdeu porque a notificação soltou a
//       vaga e avançou a tentativa durante o POST, e o GET diz que a order
//       desta chamada ainda está VIVA — sem registro no pedido, MESMA
//       mensagem do N7 (ponto 5), ponto de retorno diferente.
// Este teste prova as DUAS metades por RASTREAMENTO DE FONTE (mesmo
// mecanismo do teste "achados", acima), não por cenário a cenário, para
// pegar um json(...) novo com a flag fora do contrato, ou um dos onze que
// perca a flag.
Deno.test("cartaoEmAnalise: true aparece SÓ nos pontos de retorno onde um cartão pode existir num estado não comprovadamente morto", async () => {
  const fonte = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  const regexJson = /json\(\s*\{([^{}]*)\}\s*,\s*(\d{3})\s*,?\s*\)/g;
  let comOFlag = 0;

  // identificador do `error:` (literal ou variável) -> status esperado,
  // para cada um dos pontos de retorno que TEM que levar a flag.
  const comFlagEsperada = new Map<string, number>([
    ["Há um pagamento com cartão em análise para este pedido.", 409], // 1 e 2
    ["r.erro", 502], // 3 — reconsulta da vaga (`consultarOrder`) falhou
    ["erroOriginal", 502], // 4 — criação ambígua (respostaCartaoAmbiguoNaCriacao)
    ["Seu cartão pode ter sido cobrado; a loja vai conferir e confirmar o pedido em breve.", 409], // 5, 11 e 12 — N7, achado A (migration 80) e A3.2
    ["O prazo para pagar este pedido acabou.", 409], // 6 e 8 — sempre 409, com terminal:true junto
    ["Este pedido já tem uma cobrança gerada.", 409], // 7, 9 e 10 (achado #4b, 8ª rodada, acrescenta o 10)
    ["Não foi possível confirmar a cobrança.", 409], // 9 (releitura sem causa conhecida)
  ]);

  for (const m of fonte.matchAll(regexJson)) {
    const objeto = m[1];
    const status = Number(m[2]);
    const temFlag = /cartaoEmAnalise:\s*true/.test(objeto);
    const literal = objeto.match(/error:\s*"([^"]*)"/);
    const identificador = literal?.[1] ?? objeto.match(/error:\s*([\w.]+)/)?.[1];

    if (identificador === "Há um pagamento com cartão em análise para este pedido.") {
      assertEquals(status, 409, `"${objeto.trim()}" deveria ser 409`);
      assertEquals(temFlag, true, `"${objeto.trim()}" é cartão em análise mas não leva cartaoEmAnalise: true`);
    }

    if (!temFlag) continue;
    comOFlag++;
    assertEquals(
      identificador ? comFlagEsperada.get(identificador) : undefined,
      status,
      `"${objeto.trim()}" leva cartaoEmAnalise: true fora dos pontos de retorno esperados (ou com status errado)`,
    );
  }

  assertEquals(
    comOFlag,
    13,
    "o campo tem que aparecer em exatamente treze pontos de retorno (12 lugares; 'Há um pagamento...' aparece em 2) — ver a lista no comentário acima",
  );
});

// R6-P5b (6º revisor, achado da 7ª rodada de risco, 26/09/2026): a reconsulta
// da vaga que falha só leva `cartaoEmAnalise` quando a vaga JÁ é cartão
// (`metodo_online` credito/debito) — um cliente SÓ-PIX (cartão desligado, ou
// que nunca escolheu cartão) não pode ver "Seu cartão está em análise" nem
// perder "Cancelar pedido" para uma reconsulta de um PIX que nem tem cartão
// nenhum.
Deno.test("R6-P5b: reconsulta de uma vaga de PIX que falha (500) -> 502 SEM cartaoEmAnalise (fluxo só-PIX, cartão desligado)", async () => {
  const idOrderPix = "ORDTST0PIXDAVAGA0000000000001";
  const { supabase } = cenarioCartao({
    pedido: pedidoBase({
      user_id: DONO_LOGADO,
      gateway_payment_id: idOrderPix,
      metodo_online: "pix",
    }),
    gravado: null,
  });
  const fn = async (url: string) => {
    if (url.endsWith(`/v1/orders/${idOrderPix}`)) {
      return new Response(JSON.stringify({ errors: [{ code: "internal_error" }] }), { status: 500 });
    }
    throw new Error(`fetch inesperado no teste R6-P5b: ${url}`);
  };

  const resposta = await handler(requisicao({ orderId: UUID, metodo: "pix" }, montarToken(DONO_LOGADO)), {
    supabase,
    fetchImpl: fn,
  });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 502);
  assertEquals(corpo.cartaoEmAnalise, undefined, "sem cartão nenhum na vaga, a flag não pode aparecer");
});

// Contraprova do R6-P5b: a MESMA reconsulta falhando, mas a vaga JÁ é cartão
// — a flag continua aparecendo (o contrato não regrediu para o caso real).
Deno.test("reconsulta de uma vaga de CARTÃO que falha (500) -> 502 COM cartaoEmAnalise (contraprova do R6-P5b)", async () => {
  const idOrderCartao = "ORDTST0CARTAONAVAGA000000001";
  const { supabase } = cenarioCartao({
    pedido: pedidoBase({
      user_id: DONO_LOGADO,
      gateway_payment_id: idOrderCartao,
      metodo_online: "credito",
    }),
    gravado: null,
  });
  const fn = async (url: string) => {
    if (url.endsWith(`/v1/orders/${idOrderCartao}`)) {
      return new Response(JSON.stringify({ errors: [{ code: "internal_error" }] }), { status: 500 });
    }
    throw new Error(`fetch inesperado no teste (contraprova R6-P5b): ${url}`);
  };

  const resposta = await handler(requisicao({ orderId: UUID, metodo: "pix" }, montarToken(DONO_LOGADO)), {
    supabase,
    fetchImpl: fn,
  });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 502);
  assertEquals(corpo.cartaoEmAnalise, true);
});

// R6-P5 (6º revisor, achado da 7ª rodada de risco, 26/09/2026), item 2a: um
// 4xx DEFINITIVO (429, aqui) não é ambíguo — a Orders API respondeu e
// recusou a REQUISIÇÃO, nunca criou nada. Tratá-lo como "cartão em análise"
// prendia um retry legítimo (e o PIX) atrás do sentinela até `expires_at`,
// mesmo com ZERO orders no MP.
Deno.test("R6-P5 (item 2a): POST /v1/orders recusado com 429 (definitivo) -> 502 SEM sentinela; PIX seguinte cria normalmente", async () => {
  const { supabase, registro, chamadasRpc } = cenarioCartao();
  const fetchPix = fetchFalsoMP({});
  let primeiraChamada = true;
  const fn = async (url: string, init?: RequestInit) => {
    if (primeiraChamada && init?.method === "POST" && url.endsWith("/v1/orders")) {
      primeiraChamada = false;
      return new Response(JSON.stringify({ errors: [{ code: "too_many_requests" }] }), { status: 429 });
    }
    return fetchPix(url, init);
  };

  const r1 = await handler(requisicao(corpoCartao({ token: TOKEN_CARTAO }), montarToken(DONO_LOGADO)), {
    supabase,
    fetchImpl: fn,
  });
  const c1 = await r1.json();
  assertEquals(r1.status, 502);
  assertEquals(c1.cartaoEmAnalise, undefined, "429 é definitivo — nunca ocupa a vaga com sentinela");
  // Blindagem (02/10/2026): a reserva grava o sentinela ANTES do POST; o 429
  // definitivo SOLTA a própria reserva — a vaga volta livre, nada fica preso.
  assertEquals(registro.chamadasUpdate, 1, "só a reserva — o 429 não grava cobrança nenhuma");
  assertEquals(liberacoes(chamadasRpc), [{ p_order_id: UUID, p_gateway_payment_id: sentinelaDaReserva(registro) }]);

  const rPix = await handler(requisicao({ orderId: UUID, metodo: "pix" }, montarToken(DONO_LOGADO)), {
    supabase,
    fetchImpl: fn,
  });
  const cPix = await rPix.json();
  assertEquals(rPix.status, 200, "a reserva do 429 foi solta — o PIX cria normalmente");
  assertEquals(typeof cPix.qrCode, "string");
});

// R6-P5 (6º revisor, achado da 7ª rodada de risco, 26/09/2026), item 2b: a
// resposta se perde ANTES de a chamada sequer chegar ao MP (rede) — ZERO
// orders existem no MP. O 311f69b7 repetia a criação com a MESMA chave e o
// token novo. C3 (veredito A2 do revisor financeiro, achado H1d, 02/10/2026):
// INVERTIDO. "Nunca chegou" e "chegou, criou, e o MP já esqueceu a chave" são
// indistinguíveis daqui (status 0), e no segundo caso o re-POST era uma
// SEGUNDA captura. Custo aceito: o pedido fica sem registro (sem POST) até o
// admin agir ou o cancelamento automático da 20261186.
Deno.test("R6-P5 (item 2b) + C3: rede falha ANTES de chegar ao MP (zero orders) -> o retry de cartão sobre o sentinela NÃO faz POST; sentinela e tentativa intactos", async () => {
  const db = bancoComEstado(pedidoBase({ user_id: DONO_LOGADO, tentativas_de_pagamento: 0 }));
  const mp = mpComEstado({ cartaoStatus: "processed" });
  let primeiraChamada = true;
  const fn = async (url: string, init?: RequestInit) => {
    if (primeiraChamada && init?.method === "POST" && url.endsWith("/v1/orders")) {
      primeiraChamada = false;
      // A MESMA classe de erro do R6-P5 do 6º revisor — nunca chega a`m.fn`,
      // então NENHUMA order é criada/cacheada no MP por esta chamada.
      throw new TypeError("error sending request: connection reset");
    }
    return mp.fn(url, init);
  };

  const r1 = await handler(requisicao(corpoCartao({ token: TOKEN_CARTAO }), montarToken(DONO_LOGADO)), {
    supabase: db,
    fetchImpl: fn,
  });
  const c1 = await r1.json();
  assertEquals(r1.status, 502);
  assertEquals(c1.cartaoEmAnalise, true, "ambíguo (rede) — ocupa a vaga com sentinela");
  assertEquals(db.linha.gateway_payment_id?.startsWith("verificando:"), true);
  assertEquals(mp.orders.length, 0, "a 1ª chamada nunca chegou ao MP — zero orders existem");

  const sentinela = db.linha.gateway_payment_id;

  // Retry (token novo): nenhum POST. A busca falha contra este dublê (não
  // responde `GET /v1/orders?`) -> contrato `indisponivel`.
  const r2 = await handler(requisicao(corpoCartao({ token: OUTRO_TOKEN_CARTAO }), montarToken(DONO_LOGADO)), {
    supabase: db,
    fetchImpl: fn,
  });
  const c2 = await r2.json();
  assertEquals(mp.orders.length, 0, "o retry fez POST sobre o sentinela");
  assertEquals(r2.status, 503);
  assertEquals(c2.verificacao, "indisponivel");
  assertEquals(db.linha.gateway_payment_id, sentinela);
  assertEquals(db.linha.tentativas_de_pagamento, 0);
});

// R7-R (8º revisor, achado #1 da 8ª rodada de risco, 26/09/2026): um retry
// com TOKEN NOVO sobre um sentinela JÁ existente batia 409 de idempotência de
// novo (a c0 existe no MP, só a resposta se perdeu) — e `ocuparVagaComSentinela`
// REGRAVAVA o sentinela com um limite inferior NOVO (`limiteInferiorDaTentativa
// (pedido)` lê `pedido.updated_at`, que agora É o instante da gravação
// ANTERIOR). Cada retry empurrava o limite pra mais perto da c0, até ela
// nunca mais bater `criadaEm > limiteInferior + margem` — o sentinela nunca
// liberava sozinho mesmo com a c0 MORTA de verdade, e cada retry ainda
// avisava o admin de novo à toa.
Deno.test("R7-R (achado #1, 8ª rodada) + C3: retry com TOKEN NOVO sobre o sentinela NÃO faz POST, NÃO regrava o limite nem avisa o admin de novo — a c0 morta ainda libera com o limite original", async () => {
  const db = bancoComEstado(pedidoBase({ user_id: DONO_LOGADO, tentativas_de_pagamento: 0 }));
  const mp = mpComEstado({ cartaoStatus: "processing", perderResposta: 1 });
  let avisos = 0;
  const deps = {
    supabase: db,
    fetchImpl: mp.fn,
    alertarAdminCartaoOrfao: async () => {
      avisos++;
    },
  };

  const r1 = await handler(requisicao(corpoCartao({ token: TOKEN_CARTAO }), montarToken(DONO_LOGADO)), deps);
  const c1 = await r1.json();
  assertEquals(r1.status, 502);
  assertEquals(c1.cartaoEmAnalise, true);
  assertEquals(mp.orders.length, 1, "a c0 FOI criada no MP — só a resposta se perdeu");
  const s1 = db.linha.gateway_payment_id as string;
  assertEquals(avisos, 1);

  // Retry: token novo, MESMA chave (tentativas não avançou). C3 (02/10/2026,
  // achado H1d): nenhum POST sobre o sentinela; a busca falha contra este
  // dublê -> `indisponivel`. O sentinela fica byte a byte o mesmo.
  const r2 = await handler(requisicao(corpoCartao({ token: OUTRO_TOKEN_CARTAO }), montarToken(DONO_LOGADO)), deps);
  const c2 = await r2.json();
  const s2 = db.linha.gateway_payment_id as string;

  assertEquals(r2.status, 503);
  assertEquals(c2.verificacao, "indisponivel");
  assertEquals(mp.orders.length, 1, "nenhum POST sobre o sentinela");
  assertEquals(s2, s1, "o sentinela não foi regravado nem carimbado");
  assertEquals(limiteInferiorDoSentinela(s2), limiteInferiorDoSentinela(s1), "o limite inferior NÃO foi regravado");
  assertEquals(sentinelaDaChave(s2, `${UUID}:c0`), true, "mesma chave c0");
  assertEquals(avisos, 1, "nenhum aviso NOVO ao admin — nada mudou desde a 1ª vez");

  // Prova que o limite PRESERVADO ainda libera quando a ÚNICA order de
  // verdade (a c0) aparece morta — construída à mão porque `mpComEstado`
  // (o MP falso) não grava `date_created` (nenhum outro teste dele precisa
  // disso; o valor real viria da Orders API).
  const limite = limiteInferiorDoSentinela(s2)!;
  const c0Morta = {
    id: mp.orders[0].id,
    status: "failed",
    status_detail: "cc_rejected_other_reason",
    external_reference: UUID,
    date_created: new Date(limite + 20_000).toISOString(),
    transactions: { payments: [{ payment_method: { type: "credit_card" } }] },
  };
  assertEquals(
    resolverSentinela([c0Morta], limite)?.acao,
    "liberar",
    "com o limite intacto, a c0 morta ainda libera",
  );
});

// R7-V (8º revisor, achado #3 da 8ª rodada de risco, 26/09/2026): um retry
// sobre o sentinela recebendo 400 (hipótese: o MP valida o CORPO antes da
// idempotência) NÃO prova nada sobre a c0 ambígua por baixo — soltar a vaga
// aqui abria espaço para uma SEGUNDA cobrança quando a c0 aprovasse depois.
Deno.test("R7-V (achado #3, 8ª rodada) + C3: retry sobre o sentinela (que antes recebia 400) não chega ao MP -> NÃO libera a vaga; PIX continua bloqueado, sem dobrar quando a c0 aprovar", async () => {
  const db = bancoComEstado(pedidoBase({ user_id: DONO_LOGADO, tentativas_de_pagamento: 0 }));
  const mp = mpComEstado({ cartaoStatus: "processing", perderResposta: 1 });
  const deps = { supabase: db, fetchImpl: mp.fn, alertarAdminCartaoOrfao: async () => {} };

  const r1 = await handler(requisicao(corpoCartao({ token: TOKEN_CARTAO }), montarToken(DONO_LOGADO)), deps);
  const c1 = await r1.json();
  assertEquals(r1.status, 502);
  assertEquals(c1.cartaoEmAnalise, true);
  assertEquals(mp.orders.length, 1, "a c0 FOI criada — só a resposta se perdeu");

  // Retry (token novo): a Orders API, NESTA hipótese, valida o CORPO antes da
  // idempotência — o token novo é "inválido" e ela recusa com 400 sem sequer
  // olhar a chave repetida (por isso a c0 não aparece em lugar nenhum desta
  // resposta).
  let postsNoRetry = 0;
  const fnValidaAntesDaIdempotencia = async (url: string, init?: RequestInit) => {
    if (init?.method === "POST" && url.endsWith("/v1/orders")) {
      postsNoRetry++;
      const corpo = JSON.parse(String(init.body));
      if (corpo.transactions.payments[0].payment_method.token === OUTRO_TOKEN_CARTAO) {
        return new Response(JSON.stringify({ errors: [{ code: "invalid_card_token" }] }), { status: 400 });
      }
    }
    return mp.fn(url, init);
  };
  const r2 = await handler(requisicao(corpoCartao({ token: OUTRO_TOKEN_CARTAO }), montarToken(DONO_LOGADO)), {
    ...deps,
    fetchImpl: fnValidaAntesDaIdempotencia,
  });
  const c2 = await r2.json();
  // C3 (02/10/2026, achado H1d): o retry nem chega ao MP — o 400 hipotético
  // nunca acontece. A busca falha contra este dublê -> `indisponivel`.
  assertEquals(postsNoRetry, 0, "POST sobre o sentinela");
  assertEquals(r2.status, 503);
  assertEquals(c2.verificacao, "indisponivel");
  assertEquals(
    db.linha.gateway_payment_id?.startsWith("verificando:"),
    true,
    "a vaga NÃO foi liberada — o 400 desta chamada não prova nada sobre a c0",
  );

  // PIX na mesma reserva continua bloqueado — nunca cria uma SEGUNDA
  // cobrança enquanto a c0 pode cair aprovada por baixo.
  const rPix = await handler(requisicao({ orderId: UUID, metodo: "pix" }, montarToken(DONO_LOGADO)), {
    ...deps,
    fetchImpl: fnValidaAntesDaIdempotencia,
  });
  const cPix = await rPix.json();
  assertEquals(rPix.status, 409);
  assertEquals(cPix.cartaoEmAnalise, true);
  assertEquals(
    mp.orders.some((o) => (o.transactions as { payments: { payment_method: { type: string } }[] }).payments[0].payment_method.type === "bank_transfer"),
    false,
    "nenhuma SEGUNDA cobrança foi criada",
  );
});

// R7-F (8º revisor, achado #4 da 8ª rodada de risco, 26/09/2026): um PIX
// sobre um sentinela que a busca RESOLVE para um cartão vivo grava o id real
// e `metodo_online` no banco — mas `pedido.metodo_online`, em MEMÓRIA,
// continuava `null` até a correção. Se a reconsulta POR ID desse cartão (o
// passo seguinte, para decidir se ele está mesmo vivo) falhar, a flag saía
// de fora — mesmo já sabendo, momentos antes, que a vaga é cartão.
Deno.test("R7-F (achado #4, 8ª rodada): PIX sobre sentinela resolvido para cartão VIVO, com o GET por id falhando -> 502 COM cartaoEmAnalise", async () => {
  const db = bancoComEstado(pedidoBase({ user_id: DONO_LOGADO, tentativas_de_pagamento: 0 }));
  const mp = mpComEstado({ cartaoStatus: "processing", perderResposta: 1 });
  const deps = { supabase: db, fetchImpl: mp.fn, alertarAdminCartaoOrfao: async () => {} };

  await handler(requisicao(corpoCartao({ token: TOKEN_CARTAO }), montarToken(DONO_LOGADO)), deps);
  const idC0 = mp.orders[0].id as string;
  assertEquals(db.linha.gateway_payment_id?.startsWith("verificando:"), true);

  // A busca (Ponto 1/B1) acha a c0 VIVA (`processing`) e resolve o sentinela
  // para o id real — mas a reconsulta POR ID que vem em seguida (para
  // decidir se ainda está viva) FALHA (500).
  const fnBuscaAchaVivaGetFalha = async (url: string, init?: RequestInit) => {
    if ((init?.method ?? "GET") === "GET" && /\/v1\/orders\?/.test(url)) {
      return new Response(JSON.stringify({ results: [mp.orders[0]] }), { status: 200 });
    }
    if (url.endsWith(`/v1/orders/${idC0}`)) {
      return new Response(JSON.stringify({ errors: [{ code: "internal_error" }] }), { status: 500 });
    }
    return mp.fn(url, init);
  };
  const rp = await handler(requisicao({ orderId: UUID, metodo: "pix" }, montarToken(DONO_LOGADO)), {
    ...deps,
    fetchImpl: fnBuscaAchaVivaGetFalha,
  });
  const cp = await rp.json();

  assertEquals(rp.status, 502);
  assertEquals(cp.cartaoEmAnalise, true, "a vaga JÁ resolveu para um cartão — a flag não pode depender da reconsulta seguinte");
  assertEquals(db.linha.gateway_payment_id, idC0, "a vaga trocou o sentinela pelo id real antes da reconsulta falhar");
});

// Achado A (revisão de risco da migration 80, 26/09/2026, adendo à 8ª rodada
// — prova W): o cliente CANCELA (`update_order_status_atomic`, que grava
// `status = 'cancelled'` SEM tocar `payment_status`, que fica 'aguardando')
// enquanto o MP ainda processa o cartão. O WHERE da gravação da vaga
// (`id` + `gateway_payment_id IS NULL`) não olha `status`/`payment_status` —
// a gravação acontece do mesmo jeito, numa reserva cujo estoque já voltou.
Deno.test("handler cartão (achado A, migration 80, prova W): cliente CANCELA enquanto o cartão está em voo -> aprovado/em análise avisa o admin; desafio 3DS é cancelado no MP", async () => {
  for (
    const [statusMp, esperado] of [
      ["processed", "avisa"],
      ["processing", "avisa"],
      ["action_required", "cancela"],
    ] as const
  ) {
    const db = bancoComEstado(pedidoBase({ user_id: DONO_LOGADO, tentativas_de_pagamento: 0 }));
    const mp = mpComEstado({ cartaoStatus: statusMp });
    let avisos = 0;
    const deps = {
      supabase: db,
      fetchImpl: async (url: string, init?: RequestInit) => {
        if (init?.method === "POST" && url.endsWith("/v1/orders")) {
          // O cancelamento do cliente resolve ENQUANTO o MP processa esta
          // chamada — simulado aqui, antes da resposta do MP voltar.
          db.linha.status = "cancelled";
          return await mp.fn(url, init);
        }
        const mCancel = url.match(/\/v1\/orders\/([^/]+)\/cancel$/);
        if (init?.method === "POST" && mCancel) {
          const ordem = mp.orders.find((o) => o.id === decodeURIComponent(mCancel[1])) as
            | { status: string; status_detail: string }
            | undefined;
          if (ordem) {
            ordem.status = "canceled";
            ordem.status_detail = "canceled";
            return new Response(JSON.stringify(ordem), { status: 200 });
          }
          return new Response(JSON.stringify({ errors: [{ code: "cannot_cancel" }] }), { status: 409 });
        }
        return await mp.fn(url, init);
      },
      alertarAdminCartaoOrfao: async () => {
        avisos++;
      },
    };

    const r = await handler(requisicao(corpoCartao({ token: TOKEN_CARTAO }), montarToken(DONO_LOGADO)), deps);
    const c = await r.json();

    if (esperado === "avisa") {
      assertEquals(r.status, 409, `[${statusMp}] dinheiro capturado/podendo capturar numa reserva cancelada -> 409`);
      assertEquals(c.cartaoEmAnalise, true, `[${statusMp}] flag presente`);
      assertEquals(avisos, 1, `[${statusMp}] admin avisado — sem como desfazer por aqui`);
      assertEquals(
        db.linha.gateway_payment_id,
        mp.orders[0].id,
        `[${statusMp}] a gravação ACONTECEU (o dinheiro foi capturado/pode capturar, não some do registro)`,
      );
    } else {
      assertEquals(r.status, 409, `[${statusMp}] 3DS num pedido já cancelado -> 409 terminal`);
      assertEquals(c.terminal, true, `[${statusMp}] terminal`);
      // R8-3b / achado #4 (nit, revisão de risco da 9ª rodada, 26/09/2026):
      // é um CANCELAMENTO do cliente, não uma expiração pelo relógio — a
      // mensagem certa é "Este pedido foi cancelado.", nunca "O prazo para
      // pagar este pedido acabou." (essa fica só para quem realmente
      // expirou).
      assertEquals(c.error, "Este pedido foi cancelado.", `[${statusMp}] mensagem certa para cancelamento, não expiração`);
      assertEquals(
        (mp.orders[0] as { status: string }).status,
        "canceled",
        `[${statusMp}] a order REVERSÍVEL foi cancelada no MP — nada foi capturado`,
      );
    }
  }
});

// Adendo 2 à 8ª rodada de risco (26/09/2026, revisão do front): branch (d)
// (pedido de cartão com um cartão já em análise/3DS na vaga) devolvia o par
// cru para sempre quando `mapearStatusOrder` não reconhece o par — o front,
// corretamente, trata isso como "em análise", e o cliente ficava esperando
// até a reserva expirar (30-40 min), sem PIX. Sem afirmar "morto": só loga
// (status + orderId, nunca dado do pagador) e avisa o admin UMA VEZ por par
// (dedup, `deps.statusesCartaoDesconhecidosAvisados`) — nunca a cada poll.
Deno.test("handler cartão (adendo 2 à 8ª rodada): status DESCONHECIDO na vaga -> loga e avisa o admin UMA VEZ por par (dedup); NUNCA assume morto", async () => {
  const idOrderCartao = "ORDTST0STATUSDESCONHECIDO01";
  let statusAtual = "on_hold";
  let statusDetailAtual = "um_motivo_que_o_mp_inventar_amanha";
  const { supabase } = cenarioCartao({
    pedido: pedidoBase({ user_id: DONO_LOGADO, gateway_payment_id: idOrderCartao, metodo_online: "credito" }),
    gravado: null,
  });
  const fn = async (url: string) => {
    if (url.endsWith(`/v1/orders/${idOrderCartao}`)) {
      return new Response(
        JSON.stringify({
          id: idOrderCartao,
          status: statusAtual,
          status_detail: statusDetailAtual,
          transactions: { payments: [{ payment_method: { type: "credit_card" } }] },
        }),
        { status: 200 },
      );
    }
    throw new Error(`fetch inesperado no teste do adendo 2: ${url}`);
  };
  let avisos = 0;
  const dedup = new Set<string>();
  const deps = {
    supabase,
    fetchImpl: fn,
    alertarAdminCartaoOrfao: async () => {
      avisos++;
    },
    statusesCartaoDesconhecidosAvisados: dedup,
  };

  const r1 = await handler(requisicao(corpoCartao({ token: TOKEN_CARTAO }), montarToken(DONO_LOGADO)), deps);
  const c1 = await r1.json();
  assertEquals(r1.status, 200, "par desconhecido não é erro — devolve o estado atual, como sempre");
  assertEquals(c1.statusPagamento, "on_hold:um_motivo_que_o_mp_inventar_amanha", "par cru, igual a antes — o front trata como 'em análise'");
  assertEquals(avisos, 1, "1º poll com este par -> avisa o admin");

  // MESMO par, segundo poll (o cliente esperando, "Tentar de novo"): NENHUM
  // aviso novo.
  const r2 = await handler(requisicao(corpoCartao({ token: TOKEN_CARTAO }), montarToken(DONO_LOGADO)), deps);
  assertEquals(r2.status, 200);
  assertEquals(avisos, 1, "dedup: o MESMO par não avisa de novo");

  // O status MUDA para outro par, também desconhecido: avisa de novo — o
  // dedup é por PAR, não um bloqueio geral para o pedido inteiro.
  statusAtual = "on_hold";
  statusDetailAtual = "outro_motivo_novo";
  const r3 = await handler(requisicao(corpoCartao({ token: TOKEN_CARTAO }), montarToken(DONO_LOGADO)), deps);
  assertEquals(r3.status, 200);
  assertEquals(avisos, 2, "par NOVO -> avisa de novo");
});

// Achado B (revisão de risco da migration 80, 26/09/2026, adendo à 8ª rodada
// — prova X): `podeCobrar` só olhava `payment_status`/`expires_at`/
// `gateway_payment_id` — um PIX CANCELADO pelo cliente (`status = 'cancelled'`,
// `payment_status` continua 'aguardando') seguia "cobrável": uma aba aberta
// trocando para cartão cancelava o PIX (ramo (c) da reconsulta) e criava a
// cobrança nova numa reserva morta.
Deno.test("handler (achado B, migration 80, prova X): PIX cancelado pelo cliente -> 409 TERMINAL, nunca 'reconsultar' (troca pra cartão não cancela o PIX e cria um novo)", async () => {
  const idOrderPix = "ORDTST0PIXCANCELADOX000001";
  const { supabase } = cenarioCartao({
    pedido: pedidoBase({
      user_id: DONO_LOGADO,
      gateway_payment_id: idOrderPix,
      metodo_online: "pix",
      status: "cancelled",
    }),
    gravado: null,
  });
  const fn = async () => {
    throw new Error("fetch inesperado no teste do achado B: o pedido CANCELADO tem que recusar antes de tocar o MP");
  };

  const resposta = await handler(requisicao(corpoCartao({ token: TOKEN_CARTAO }), montarToken(DONO_LOGADO)), {
    supabase,
    fetchImpl: fn,
  });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 409);
  assertEquals(corpo.error, "Este pedido foi cancelado.");
  assertEquals(corpo.terminal, true);
});

// R8-4 (resto do achado #4, revisão de risco da 9ª rodada, 26/09/2026): a
// resolução do sentinela PERDE a corrida para a adoção do webhook (o
// `.update()` que grava o id real não bate — outra chamada já mudou a vaga)
// — a releitura que segue só lia `gateway_payment_id`, nunca `metodo_online`.
// Um PIX cuja reconsulta por id (do cartão que o webhook ACABOU de adotar)
// falha saía sem `cartaoEmAnalise`, mesmo com o banco já mostrando
// `metodo_online: 'credito'` e a order `processing`.
Deno.test("R8-4: sentinela perde a corrida para a adoção do webhook -> a releitura sincroniza metodo_online, e a flag aparece mesmo assim", async () => {
  const limiteMs = Date.now() - 60_000;
  const sentinela = `verificando:${UUID}:c0:${limiteMs}`;
  const idOrderCartao = "ORDTST0R84CARTAOVIVO0000001";
  const { supabase } = cenarioCartao({
    pedido: pedidoBase({
      user_id: DONO_LOGADO,
      gateway_payment_id: sentinela,
      metodo_online: null,
      created_at: new Date(Date.now() - 5 * 60_000).toISOString(),
    }),
    // A gravação que tentaria resolver o sentinela para o id real PERDE a
    // corrida — devolve null, como se outra chamada (o webhook) já tivesse
    // mudado a vaga.
    gravado: null,
    // A releitura que segue: o webhook JÁ adotou o cartão (id real +
    // metodo_online), pouco antes desta chamada tentar gravar o mesmo.
    releitura: { gateway_payment_id: idOrderCartao, metodo_online: "credito" },
  });
  const fn = async (url: string, init?: RequestInit) => {
    if ((init?.method ?? "GET") === "GET" && /\/v1\/orders\?/.test(url)) {
      return new Response(
        JSON.stringify({
          results: [
            {
              id: idOrderCartao,
              status: "processing",
              status_detail: "in_review",
              external_reference: UUID,
              date_created: new Date().toISOString(),
              transactions: { payments: [{ payment_method: { type: "credit_card" } }] },
            },
          ],
        }),
        { status: 200 },
      );
    }
    if (url.endsWith(`/v1/orders/${idOrderCartao}`)) {
      return new Response(JSON.stringify({ errors: [{ code: "internal_error" }] }), { status: 500 });
    }
    throw new Error(`fetch inesperado no teste R8-4: ${url}`);
  };

  const resposta = await handler(requisicao({ orderId: UUID, metodo: "pix" }, montarToken(DONO_LOGADO)), {
    supabase,
    fetchImpl: fn,
  });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 502);
  assertEquals(
    corpo.cartaoEmAnalise,
    true,
    "a releitura sincronizou metodo_online='credito' — a flag não pode depender do valor ANTIGO em memória",
  );
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
  gravadoAdocao?: Record<string, unknown> | null;
  gravadosPorChamada?: Array<Record<string, unknown> | null>;
  configCartao?: Record<string, unknown> | null;
  erroConfigCartao?: Record<string, unknown> | null;
  resultadoLiberar?: boolean;
  erroLiberar?: Record<string, unknown> | null;
  // POLÍTICA DO PIX (29/09/2026): repasse do registro do lojista para provar
  // a delimitação — o gate da chave de assinatura NÃO pode tocar o cartão.
  registroMp?: Record<string, unknown> | null;
  // Dados do comprador (03/10/2026) — ver `clienteFalso`.
  itensDoPedido?: unknown;
  colunasExtrasDoPedido?: Record<string, unknown> | null;
  enderecoSalvo?: Record<string, unknown> | null;
  falhaNaLeituraDoAntifraude?: "erro" | "lanca";
} = {}) {
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  // Baseline do cofre para o registro default/repassado desta política —
  // testes de credencial antigos apagam a chave no finally deles.
  Deno.env.set("MP_CHAVES_ENCRYPTION_KEY", CHAVE_CIFRA_TESTE);
  Deno.env.delete("MP_SANDBOX_PAYER_EMAIL");
  const registro: {
    chamadasUpdate: number;
    filtrosUpdate?: Array<[string, unknown]>;
    valoresUpdate?: Record<string, unknown>;
    historico: Array<{ valores: Record<string, unknown>; filtros: Array<[string, unknown]> }>;
  } = { chamadasUpdate: 0, historico: [] };
  const chamadasRpc: Array<{ nome: string; args: Record<string, unknown> }> = [];
  const leiturasConfigCartao: Array<{ colunas: string; filtro: [string, unknown] }> = [];
  const leiturasDoAntifraude: Array<{ tabela: string; colunas: string; filtros: Array<[string, unknown]> }> = [];
  const supabase = clienteFalso({
    itensDoPedido: opts.itensDoPedido,
    colunasExtrasDoPedido: opts.colunasExtrasDoPedido,
    enderecoSalvo: opts.enderecoSalvo,
    falhaNaLeituraDoAntifraude: opts.falhaNaLeituraDoAntifraude,
    leiturasDoAntifraude,
    pedido: opts.pedido ?? pedidoBase({ user_id: DONO_LOGADO }),
    releitura: opts.releitura,
    registroMp: opts.registroMp,
    // `payment_status: "aguardando"` no default (Achado R1, 2ª revisão de
    // risco): a gravação da vaga passou a SELECIONAR essa coluna também
    // (para decidir se um desafio 3DS reversível pousou num pedido já
    // morto) — sem o default aqui, todo teste de cartão que NÃO passa
    // `gravado` explícito leria `payment_status: undefined`, e o código
    // novo trataria `undefined !== "aguardando"` como "pedido morto",
    // cancelando desafios 3DS que deveriam só suceder normalmente.
    gravado: opts.gravado === undefined
      ? { id: UUID, expires_at: "2099-01-01T00:00:00.000Z", payment_status: "aguardando" }
      : opts.gravado,
    gravadoAdocao: opts.gravadoAdocao,
    gravadosPorChamada: opts.gravadosPorChamada,
    registro,
    configCartao: opts.configCartao === undefined ? CONFIG_CARTAO_LIGADO : opts.configCartao,
    erroConfigCartao: opts.erroConfigCartao,
    chamadasRpc,
    leiturasConfigCartao,
    resultadoLiberar: opts.resultadoLiberar,
    erroLiberar: opts.erroLiberar,
  });
  return { supabase, registro, chamadasRpc, leiturasConfigCartao, leiturasDoAntifraude };
}

const liberacoes = (chamadasRpc: Array<{ nome: string; args: Record<string, unknown> }>) =>
  chamadasRpc.filter((c) => c.nome === "liberar_cobranca_do_pedido").map((c) => c.args);

// Blindagem do cartão (02/10/2026): a 1ª gravação de todo cartão com a vaga
// livre é a RESERVA — o sentinela da tentativa, gravado ANTES do POST com o
// WHERE inteiro abaixo (pedido aguardando, não cancelado, tentativa lida,
// vaga livre). A gravação final troca ESSE sentinela pelo id real.
const sentinelaDaReserva = (registro: { historico: Array<{ valores: Record<string, unknown> }> }) =>
  registro.historico[0]?.valores.gateway_payment_id as string;
const FILTROS_DA_RESERVA_C0: Array<[string, unknown]> = [
  ["id", UUID],
  ["payment_status", "aguardando"],
  ["status<>", "cancelled"],
  ["tentativas_de_pagamento", 0],
  ["gateway_payment_id", null],
];

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
    assertEquals(corpo.codigo, "CARTAO_FORMA_DESLIGADA");
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

// --- contrato "forma de cartão desligada" (01/10/2026) ------------------------
//
// O 409 do portão ganha `codigo: "CARTAO_FORMA_DESLIGADA"` para a tela trocar
// a configuração e oferecer PIX pela guarda da vaga — SEM afirmar ausência de
// cobrança: o portão roda ANTES do ramo "reconsultar", então ele só garante
// que ESTA chamada não tocou o MP nem a vaga. Por isso nada de `semCobranca`,
// `terminal` ou `cartaoEmAnalise` no corpo.

const CODIGO_FORMA_DESLIGADA = "CARTAO_FORMA_DESLIGADA";

/** O corpo do 409 do portão: código exato e NENHUMA afirmação sobre cobrança. */
function exigirCorpoDeFormaDesligada(corpo: Record<string, unknown>) {
  assertEquals(corpo.error, "Esta forma de pagamento não está disponível nesta loja.");
  assertEquals(corpo.codigo, CODIGO_FORMA_DESLIGADA);
  assertEquals("semCobranca" in corpo, false, "o portão não sabe se o pedido tem cobrança");
  assertEquals("terminal" in corpo, false, "forma desligada é recuperável (o cliente paga com PIX)");
  assertEquals("cartaoEmAnalise" in corpo, false, "o portão não consultou a vaga");
}

for (
  const caso of [
    { nome: "crédito desligado", cenario: { configCartao: { credito: false, debito: true, parcelas_max: 12 } }, tipo: "credit_card" },
    { nome: "débito desligado", cenario: { configCartao: { credito: true, debito: false, parcelas_max: 12 } }, tipo: "debit_card" },
    { nome: "linha de config ausente", cenario: { configCartao: null }, tipo: "credit_card" },
    { nome: "falha ao LER a config", cenario: { erroConfigCartao: { message: "timeout" } }, tipo: "credit_card" },
  ]
) {
  Deno.test(`contrato forma desligada: ${caso.nome} -> 409 com codigo ${CODIGO_FORMA_DESLIGADA}, sem afirmar cobrança, zero MP e zero UPDATE`, async () => {
    const { supabase, registro, chamadasRpc } = cenarioCartao(caso.cenario);
    const mp = fetchMP({});

    const resposta = await handler(
      requisicao(corpoCartao({ paymentTypeId: caso.tipo }), montarToken(DONO_LOGADO)),
      { supabase, fetchImpl: mp.fn },
    );

    assertEquals(resposta.status, 409);
    exigirCorpoDeFormaDesligada(await resposta.json());
    assertEquals(mp.chamadas.length, 0);
    assertEquals(registro.chamadasUpdate, 0);
    assertEquals(chamadasRpc.length, 0);
  });
}

Deno.test("contrato forma desligada: pedido com cartão ANTERIOR em análise (processing) na vaga -> o mesmo 409 com código, sem consultar o MP e com a cobrança intacta; o PIX seguinte continua barrado pela guarda da vaga", async () => {
  // Cobrança anterior registrada: a vaga tem a order de cartão viva.
  const pedidoComCartaoVivo = pedidoBase({
    user_id: DONO_LOGADO,
    gateway_payment_id: ORDER_CARTAO_NA_VAGA,
    metodo_online: "credito",
    parcelas: 3,
  });
  const configDesligada = { credito: false, debito: false, parcelas_max: 12 };

  const cartao = cenarioCartao({ pedido: pedidoComCartaoVivo, configCartao: configDesligada });
  const mpCartao = fetchMP({});
  const respostaCartao = await handler(
    requisicao(corpoCartao(), montarToken(DONO_LOGADO)),
    { supabase: cartao.supabase, fetchImpl: mpCartao.fn },
  );

  assertEquals(respostaCartao.status, 409);
  exigirCorpoDeFormaDesligada(await respostaCartao.json());
  // O portão vem ANTES do ramo "reconsultar": nem a consulta da vaga sai.
  assertEquals(mpCartao.chamadas.length, 0);
  assertEquals(cartao.registro.chamadasUpdate, 0, "a cobrança registrada fica intacta");
  assertEquals(cartao.chamadasRpc.length, 0, "nenhuma liberação da vaga");

  // CONTROLE (guarda existente): o PIX pedido para ESTE pedido consulta a
  // vaga, vê o cartão em análise e recusa — nunca cria uma segunda cobrança.
  const pix = cenarioCartao({ pedido: pedidoComCartaoVivo, configCartao: configDesligada });
  const mpPix = fetchMP({
    consultar: { status: 200, corpo: orderDeCartao("processing", "in_process", { id: ORDER_CARTAO_NA_VAGA }) },
  });
  const respostaPix = await handler(
    requisicao({ orderId: UUID, metodo: "pix" }, montarToken(DONO_LOGADO)),
    { supabase: pix.supabase, fetchImpl: mpPix.fn },
  );
  const corpoPix = await respostaPix.json();

  assertEquals(respostaPix.status, 409);
  assertEquals(corpoPix.error, "Há um pagamento com cartão em análise para este pedido.");
  assertEquals(corpoPix.cartaoEmAnalise, true);
  assertEquals(corpoPix.codigo, undefined, "a guarda da vaga não é o portão da forma");
  assertEquals(mpPix.criacoes().length, 0);
  assertEquals(mpPix.cancelamentos().length, 0);
  assertEquals(pix.registro.chamadasUpdate, 0);
  assertEquals(pix.chamadasRpc.length, 0);
});

Deno.test("contrato forma desligada, CONTROLE: o 400 de parcelamento acima do teto NÃO leva o código", async () => {
  const { supabase, registro } = cenarioCartao({ configCartao: { credito: true, debito: true, parcelas_max: 3 } });
  const mp = fetchMP({});

  const resposta = await handler(
    requisicao(corpoCartao({ parcelas: 4 }), montarToken(DONO_LOGADO)),
    { supabase, fetchImpl: mp.fn },
  );
  const corpo = await resposta.json();

  assertEquals(resposta.status, 400);
  assertEquals(corpo.error, "Esse parcelamento não está disponível nesta loja.");
  assertEquals(corpo.codigo, undefined);
  assertEquals(mp.chamadas.length, 0);
  assertEquals(registro.chamadasUpdate, 0);
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

  // A vaga: a RESERVA (sentinela, antes do POST) e depois a gravação final
  // com o id da order e a forma.
  assertEquals(registro.chamadasUpdate, 2);
  assertEquals(registro.historico[0].filtros, FILTROS_DA_RESERVA_C0);
  assertEquals(sentinelaDaChave(sentinelaDaReserva(registro), `${UUID}:c0`), true);
  assertEquals("metodo_online" in registro.historico[0].valores, false, "a reserva não carimba forma (Achado S3)");
  assertEquals(registro.valoresUpdate?.gateway_payment_id, ORDER_CARTAO);
  assertEquals(registro.valoresUpdate?.metodo_online, "credito");
  assertEquals(registro.valoresUpdate?.parcelas, 3);
  assertEquals("expires_at" in (registro.valoresUpdate ?? {}), false);
  // Achado A1 (2), revisão de risco 26/09/2026: o WHERE do cartão NÃO repete
  // `payment_status = 'aguardando'` — só `id` + vaga livre (Política P1: a
  // vaga grava mesmo que o pg_cron tenha expirado o pedido no meio da
  // chamada ao MP). PIX continua com os três filtros, byte a byte (ver o
  // teste "pedido sem cobrança existente...", mais acima). Desde a reserva
  // (02/10/2026) a vaga que ela espera é o SENTINELA desta chamada.
  assertEquals(registro.filtrosUpdate, [
    ["id", UUID],
    ["gateway_payment_id", sentinelaDaReserva(registro)],
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
  assertEquals(registro.chamadasUpdate, 2, "a reserva e a gravação final");
  assertEquals(registro.valoresUpdate?.gateway_payment_id, ORDER_CARTAO);
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
  // gravação. A vaga esperada é a RESERVA desta chamada (02/10/2026).
  assertEquals(registro.filtrosUpdate, [
    ["id", UUID],
    ["gateway_payment_id", sentinelaDaReserva(registro)],
  ]);
});

Deno.test("handler cartão: perdeu a corrida da vaga de VERDADE, occupante ilegível (rede falhou na reconsulta) -> 409 TERMINAL explícito + admin avisado (Achado R2)", async () => {
  // Diferente do teste acima: aqui `atual.gateway_payment_id` (a releitura)
  // é uma cobrança DIFERENTE da que esta chamada criou — a vaga foi perdida
  // para valer (duas abas com tentativas diferentes, por exemplo), não
  // "gravou mesmo assim". O cartão desta chamada saiu `processing` (em
  // análise, o MP não cancela mais) — dinheiro pode já estar a caminho.
  //
  // Achado R2 (2ª revisão de risco, 26/09/2026): ANTES desta correção a
  // resposta era o 409 recuperável de sempre ("Este pedido já tem uma
  // cobrança gerada.") — e um "Tentar de novo" reconsultava a vaga, via o
  // ramo (c), e podia CRIAR UM SEGUNDO CARTÃO por cima de um primeiro já
  // aprovado. Este teste não fornece a rota `consultar` do `fetchMP` DE
  // PROPÓSITO — a reconsulta do occupante falha (rede), e sem confirmar que
  // dá para cancelar um PIX ainda aberto, a resposta certa é TERMINAL (nunca
  // convida um retry que pode dobrar a cobrança) e explícita sobre o que
  // aconteceu, com o admin avisado.
  // Blindagem (02/10/2026): a vaga é RESERVADA antes do POST, então a
  // corrida só se perde DEPOIS dele — a notificação soltou o sentinela no
  // meio do caminho e outra cobrança ocupou a vaga livre. `gravadosPorChamada`
  // reproduz isso: a reserva grava, a gravação final perde.
  const { supabase, chamadasRpc } = cenarioCartao({
    gravado: null,
    gravadosPorChamada: [{ id: UUID }],
    releitura: { payment_status: "aguardando", gateway_payment_id: "ORDTST01OUTRACOBRANCA000000" },
  });
  const mp = fetchMP({ criar: { status: 201, corpo: orderDeCartao("processing", "in_process") } });
  let avisouAdmin = 0;

  const resposta = await handler(requisicao(corpoCartao(), montarToken(DONO_LOGADO)), {
    supabase,
    fetchImpl: mp.fn,
    alertarAdminCartaoOrfao: async () => {
      avisouAdmin++;
    },
  });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 409);
  assertEquals(corpo.error, "Seu cartão pode ter sido cobrado; a loja vai conferir e confirmar o pedido em breve.");
  assertEquals(corpo.terminal, true);
  assertEquals(avisouAdmin, 1);
  assertEquals(chamadasRpc.length, 0);
  assertEquals(mp.cancelamentos().length, 0, "sem confirmar que é um PIX ainda aberto, nada é cancelado às cegas");
});

Deno.test("handler cartão: perdeu a vaga para um PIX concorrente AINDA ABERTO, cartão saiu APROVADO -> cancela o PIX e ADOTA o cartão na vaga, sem criar cobrança nova (Achado R2)", async () => {
  // O cartão desta chamada saiu `processed:accredited` — aprovado, dinheiro
  // JÁ CAPTURADO, irreversível — mas perdeu a corrida do UPDATE porque um
  // PIX concorrente gravou a vaga primeiro. Sem a correção, isto caía na
  // resposta genérica "Este pedido já tem uma cobrança gerada." e um retry
  // cancelava o PIX para abrir um cartão NOVO — dobrando a cobrança de quem
  // já pagou. Com a correção, a PRÓPRIA chamada que descobre o PIX ainda
  // aberto cancela e adota — o cartão já aprovado, nunca um segundo.
  //
  // Achado S2 (3ª revisão de risco, 26/09/2026, R3-H1): o fixture do PIX
  // ocupante usava `created:waiting_transfer` — par que NUNCA acontece no MP
  // real (`MAPA_STATUS_ORDER` não o conhece). O PIX recém-criado real vem
  // `action_required:waiting_transfer` (doc do MP e `_shared/mercadopago.ts:
  // 242-243`) — com o par antigo, esta adoção nunca rodava de verdade contra
  // o MP: `statusBrutoOcupante === "created"` era sempre falso, e todo PIX
  // concorrente caía no `else` (409 terminal + aviso ao admin), mesmo com o
  // PIX ainda pagável. Trocado pelo par real; a decisão agora é por
  // `mapearStatusOrder(...) === "aguardando"`.
  const idPix = "ORDTST01PIXCONCORRENTE000000";
  // Blindagem (02/10/2026): a vaga é RESERVADA antes do POST, então a
  // corrida só se perde DEPOIS dele — a notificação soltou o sentinela no
  // meio do caminho e outra cobrança ocupou a vaga livre. `gravadosPorChamada`
  // reproduz isso: a reserva grava, a gravação final perde.
  const { supabase, chamadasRpc, registro } = cenarioCartao({
    gravado: null,
    gravadosPorChamada: [{ id: UUID }, null],
    releitura: { payment_status: "aguardando", gateway_payment_id: idPix },
    gravadoAdocao: { id: UUID, expires_at: "2099-01-01T00:00:00.000Z" },
  });
  const mp = fetchMP({
    criar: { status: 201, corpo: orderDeCartao("processed", "accredited") },
    consultar: { status: 200, corpo: orderDePix("action_required", "waiting_transfer", idPix) },
    cancelar: { status: 200, corpo: orderDePix("canceled", "canceled", idPix) },
  });
  let avisouAdmin = 0;

  const resposta = await handler(requisicao(corpoCartao(), montarToken(DONO_LOGADO)), {
    supabase,
    fetchImpl: mp.fn,
    alertarAdminCartaoOrfao: async () => {
      avisouAdmin++;
    },
  });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  assertEquals(corpo.paymentId, ORDER_CARTAO);
  assertEquals(corpo.statusPagamento, "pago");
  assertEquals(corpo.error, undefined);
  assertEquals(mp.cancelamentos().length, 1, "o PIX concorrente, ainda aberto, é cancelado");
  assertEquals(avisouAdmin, 0, "adoção resolvida sozinha — não é caso para acordar o admin");
  assertEquals(chamadasRpc.length, 0, "guarded UPDATE, não RPC — mesma primitiva de sempre");
  // A prova que importa: a SEGUNDA gravação troca a vaga do PIX cancelado
  // pelo cartão aprovado — nunca `.is("gateway_payment_id", null)` (que
  // criaria uma cobrança nova do zero). Três gravações desde a blindagem: a
  // reserva, a final que perdeu e a adoção.
  assertEquals(registro.chamadasUpdate, 3);
  assertEquals(registro.filtrosUpdate, [
    ["id", UUID],
    ["gateway_payment_id", idPix],
  ]);
  assertEquals(registro.valoresUpdate?.gateway_payment_id, ORDER_CARTAO);
});

Deno.test("handler cartão: perdeu a vaga para um PIX concorrente, mas o MP não cancelou (pago no meio do caminho) -> 409 TERMINAL + admin avisado, NADA de segunda cobrança (Achado R2)", async () => {
  const idPix = "ORDTST01PIXCONCORRENTE000000";
  // Blindagem (02/10/2026): a vaga é RESERVADA antes do POST, então a
  // corrida só se perde DEPOIS dele — a notificação soltou o sentinela no
  // meio do caminho e outra cobrança ocupou a vaga livre. `gravadosPorChamada`
  // reproduz isso: a reserva grava, a gravação final perde.
  const { supabase, chamadasRpc, registro } = cenarioCartao({
    gravado: null,
    gravadosPorChamada: [{ id: UUID }],
    releitura: { payment_status: "aguardando", gateway_payment_id: idPix },
  });
  const mp = fetchMP({
    criar: { status: 201, corpo: orderDeCartao("processed", "accredited") },
    consultar: { status: 200, corpo: orderDePix("action_required", "waiting_transfer", idPix) },
    // O MP recusa o cancelamento (o PIX foi pago no instante entre a
    // reconsulta e o cancelamento, por exemplo) — a resposta não confirma
    // "cancelada".
    cancelar: { status: 200, corpo: orderDePix("action_required", "waiting_transfer", idPix) },
  });
  let avisouAdmin = 0;

  const resposta = await handler(requisicao(corpoCartao(), montarToken(DONO_LOGADO)), {
    supabase,
    fetchImpl: mp.fn,
    alertarAdminCartaoOrfao: async () => {
      avisouAdmin++;
    },
  });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 409);
  assertEquals(corpo.error, "Seu cartão pode ter sido cobrado; a loja vai conferir e confirmar o pedido em breve.");
  assertEquals(corpo.terminal, true);
  assertEquals(avisouAdmin, 1);
  assertEquals(chamadasRpc.length, 0);
  // A reserva e a gravação final que perdeu — a adoção nunca roda sem
  // cancelamento confirmado.
  assertEquals(registro.chamadasUpdate, 2);
});

// Achado R1 (2ª revisão de risco, 26/09/2026) — o gêmeo do teste P1 acima,
// mas para um desafio 3DS: nenhum dinheiro foi CAPTURADO ainda (diferente de
// uma order `processed`), então gravar e "honrar" não faz sentido — o
// cliente já saiu da tela, o desafio nunca vai ser respondido, e a order
// fica presa viva no MP à toa. O H4 do harness da 2ª revisão mediu isto como
// bug: 200 com desafio3ds + expires_at estendido num pedido já 'expirado'/
// 'cancelled', e a order (cancelável) nunca cancelada.
Deno.test("handler cartão: desafio 3DS gravado, mas o pedido JÁ NÃO estava 'aguardando' -> cancela a order (nada capturado) e devolve 409 terminal de prazo (Achado R1)", async () => {
  const { supabase, chamadasRpc } = cenarioCartao({
    pedido: pedidoBase({ user_id: DONO_LOGADO, expires_at: new Date(Date.now() + 60_000).toISOString() }),
    // A gravação do UPDATE (Achado A1 (2)) devolve a linha REAL — aqui ela já
    // não está 'aguardando' quando o UPDATE roda (pg_cron expirou no meio da
    // chamada ao MP).
    gravado: { id: UUID, expires_at: "2099-01-01T00:00:00.000Z", payment_status: "expirado" },
  });
  const mp = fetchMP({
    criar: {
      status: 201,
      corpo: orderDeCartao("action_required", "pending_challenge", { url3ds: URL_DESAFIO }),
    },
    cancelar: { status: 200, corpo: orderDeCartao("canceled", "canceled") },
  });

  const resposta = await handler(requisicao(corpoCartao(), montarToken(DONO_LOGADO)), {
    supabase,
    fetchImpl: mp.fn,
  });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 409);
  assertEquals(corpo.error, "O prazo para pagar este pedido acabou.");
  assertEquals(corpo.terminal, true);
  assertEquals(mp.cancelamentos().length, 1, "a order cancelável (action_required) tem que ser cancelada — nada foi capturado");
  assertEquals(chamadasRpc.length, 0);
});

Deno.test("handler cartão: order APROVADA (processed) gravada num pedido que já não estava 'aguardando' -> HONRA (P1) — NUNCA cancela dinheiro já capturado (controle negativo do Achado R1)", async () => {
  const { supabase } = cenarioCartao({
    // `status: "cancelled"` (achado #1, revisão de risco da 9ª rodada,
    // 26/09/2026): o `expirar_pedidos_vencidos` REAL grava os DOIS —
    // `payment_status = 'expirado'` E `status = 'cancelled'` — não só o
    // primeiro. Sem isto, este teste nunca provava a distinção entre
    // "expirou pelo relógio" (P1 honra em silêncio) e "o cliente cancelou"
    // (achado A, 8ª rodada: avisa o admin) — os dois cenários pareciam
    // idênticos aqui.
    gravado: { id: UUID, expires_at: "2099-01-01T00:00:00.000Z", payment_status: "expirado", status: "cancelled" },
  });
  const mp = fetchMP({ criar: { status: 201, corpo: orderDeCartao("processed", "accredited") } });

  const resposta = await handler(requisicao(corpoCartao(), montarToken(DONO_LOGADO)), {
    supabase,
    fetchImpl: mp.fn,
  });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  assertEquals(corpo.statusPagamento, "pago");
  assertEquals(mp.cancelamentos().length, 0, "aprovado é IRREVERSÍVEL — cancelarOrder nem existe para isso, e P1 honra");
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
  // Blindagem (02/10/2026): solta a PRÓPRIA reserva (casamento exato da vaga
  // na RPC), nunca a vaga às cegas.
  assertEquals(liberacoes(chamadasRpc), [{ p_order_id: UUID, p_gateway_payment_id: sentinelaDaReserva(registro) }]);
  // A prova que importa: a recusa não chega a confirmar_pagamento (que
  // cancelaria o pedido) — a ÚNICA rpc é a de liberar.
  assertEquals(chamadasRpc.map((c) => c.nome), ["liberar_cobranca_do_pedido"]);
  assertEquals(registro.chamadasUpdate, 1, "só a reserva — a recusa não grava cobrança");
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
  assertEquals(liberacoes(chamadasRpc), [{ p_order_id: UUID, p_gateway_payment_id: sentinelaDaReserva(registro) }]);
  assertEquals(registro.chamadasUpdate, 1, "só a reserva");
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
  assertEquals(liberacoes(chamadasRpc), [{ p_order_id: UUID, p_gateway_payment_id: sentinelaDaReserva(registro) }]);
  assertEquals(registro.chamadasUpdate, 1, "só a reserva");
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
    { status: 401, esperado: 503, terminal: true, ocupaVaga: false },
    { status: 403, esperado: 503, terminal: true, ocupaVaga: false },
    // Achado da 6ª rodada de risco (26/09/2026): rede/timeout (status 0) e
    // 5xx passaram a OCUPAR a vaga com um sentinela em vez de deixá-la vazia
    // — o MP pode ter processado a order antes de a resposta se perder. A
    // credencial recusada (401/403) NÃO passa por aqui: `respostaCredencial
    // Recusada` responde ANTES de qualquer chamada à Orders API acontecer de
    // verdade ter cobrado algo (a credencial nem autenticou).
    { status: 500, esperado: 502, terminal: undefined, ocupaVaga: true },
    { status: 0, esperado: 502, terminal: undefined, ocupaVaga: true },
    // Blindagem (02/10/2026): 423 `resource_locked` = OUTRA requisição com a
    // MESMA chave em andamento (referência create-order da Orders API) —
    // resultado desconhecido, nunca recusa: a reserva fica.
    { status: 423, esperado: 502, terminal: undefined, ocupaVaga: true },
  ]
) {
  Deno.test(`handler cartão: POST /v1/orders com status ${caso.status} -> ${caso.esperado} ${caso.terminal ? "TERMINAL (credencial)" : "recuperável"}${caso.ocupaVaga ? ", OCUPA a vaga com sentinela (cartaoEmAnalise: true)" : ", sem liberar nem ocupar a vaga"}`, async () => {
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
    // Blindagem (02/10/2026): todo cartão com a vaga livre RESERVA antes do
    // POST (1 gravação). Ambíguo: a reserva FICA (é o sentinela). Credencial
    // recusada: a credencial nem autenticou, nada foi criado — a própria
    // reserva é solta (casamento exato), e o pedido não fica preso.
    assertEquals(registro.chamadasUpdate, 1, "a reserva");
    assertEquals(sentinelaDaChave(sentinelaDaReserva(registro), `${UUID}:c0`), true);
    if (caso.ocupaVaga) {
      assertEquals(corpo.cartaoEmAnalise, true);
      assertEquals(chamadasRpc.length, 0, "a reserva fica: é o sentinela da ambiguidade");
    } else {
      assertEquals(corpo.cartaoEmAnalise, undefined);
      assertEquals(liberacoes(chamadasRpc), [{ p_order_id: UUID, p_gateway_payment_id: sentinelaDaReserva(registro) }]);
    }
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

// ═══ Achado A1 — corridas REAIS (revisão de risco, 26/09/2026) ═════════════
//
// `clienteFalso`/`fetchMP`, acima, são FIXOS: cada `.select()` devolve sempre
// o MESMO fixture, então não provam duas chamadas concorrentes disputando a
// MESMA vaga de verdade. Esta seção adapta o harness do revisor-risco
// (banco e MP COM ESTADO, UPDATE condicional atômico, idempotência real por
// chave) para os quatro cenários que a revisão mediu contra o handler ANTES
// da correção — e que agora provam o desfecho CERTO, com asserções reais em
// vez do `console.log` original do harness.

/**
 * Banco COM ESTADO — o UPDATE só grava se os filtros (`.eq()`/`.is()`, em
 * QUALQUER quantidade e ordem) baterem contra a linha REAL no momento da
 * chamada. Só assim duas chamadas concorrentes podem de fato disputar a
 * MESMA vaga: uma "ganha" (os filtros batem, `Object.assign` grava), a outra
 * "perde" (a mesma checagem falha porque a primeira já mudou a linha).
 */
function bancoComEstado(
  linha: Record<string, unknown>,
  configCartao: Record<string, unknown> | null = CONFIG_CARTAO_LIGADO,
  // Achado R3 (2ª revisão de risco, 26/09/2026) — H3 do harness do 2º
  // revisor: simula `liberar_cobranca_do_pedido` falhando (erro de banco)
  // TODAS as vezes, mesmo com o retry de `liberarCobranca` (index.ts) — a
  // "chave presa" (tentativas_de_pagamento nunca avança) acontece quando a
  // RPC falha de forma PERSISTENTE, não só uma vez.
  opts: { liberarSempreFalha?: boolean } = {},
) {
  const chamadasRpc: Array<{ nome: string; args: Record<string, unknown> }> = [];
  return {
    linha,
    chamadasRpc,
    rpc: async (nome: string, a: Record<string, unknown>) => {
      chamadasRpc.push({ nome, args: a });
      if (nome !== "liberar_cobranca_do_pedido") throw new Error(`rpc inesperada nas corridas: ${nome}`);
      if (opts.liberarSempreFalha) return { data: null, error: { message: "deadlock" } };
      if (a.p_gateway_payment_id === null) {
        if (linha.payment_status === "aguardando" && linha.gateway_payment_id === null) {
          linha.tentativas_de_pagamento = Number(linha.tentativas_de_pagamento ?? 0) + 1;
          return { data: true, error: null };
        }
        return { data: null, error: null };
      }
      if (linha.gateway_payment_id === a.p_gateway_payment_id && linha.payment_status === "aguardando") {
        linha.gateway_payment_id = null;
        linha.tentativas_de_pagamento = Number(linha.tentativas_de_pagamento ?? 0) + 1;
        return { data: true, error: null };
      }
      return { data: null, error: null };
    },
    from(tabela: string) {
      if (tabela === "app_settings") {
        // POLÍTICA DO PIX (Gabriel, 29/09/2026): o banco COM ESTADO também
        // serve o registro do lojista COM chave de assinatura do webhook —
        // sem ele, todo PIX destas corridas morreria no gate da política (ou
        // no 503 de credencial de ambiente sem token). String PRÉ-SERIALIZADA
        // e SEM await interno: qualquer await extra aqui muda o interleaving
        // das corridas (o perdedor leria a vaga já ocupada e cairia numa
        // reconsulta que este stub não serve — artefato, não comportamento).
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => {
                Deno.env.set("MP_CHAVES_ENCRYPTION_KEY", CHAVE_CIFRA_TESTE);
                return {
                  data: { value: REGISTRO_LOJISTA_JSON },
                  error: null,
                };
              },
            }),
          }),
        };
      }
      if (tabela === "config_pagamento_cartao") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: configCartao, error: null }) }) }) };
      }
      return {
        select: (_cols: string) => ({
          eq: (_c: string, _v: unknown) => ({
            maybeSingle: async () => ({ data: { ...linha }, error: null }),
          }),
        }),
        update(valores: Record<string, unknown>) {
          // `bateFiltro` compara por NOME FIXO, nunca `linha[coluna]` — o
          // dublê só conhece três colunas no WHERE de verdade, e indexar um
          // objeto por uma variável é o `security/detect-object-injection`
          // que a catraca reprova (mesma regra que `_shared/mercadopago.ts`
          // já documenta para o MOTIVOS_DE_RECUSA, um `Map` pelo mesmo
          // motivo).
          // Blindagem (02/10/2026): TODO filtro do WHERE é respeitado — inclusive
          // `status`, `tentativas_de_pagamento` e `.neq()` da reserva antes do
          // POST. Coluna desconhecida continua reprovando (falha FECHADA: um
          // WHERE novo que o dublê não entende nunca grava por engano).
          const filtros: Array<{ coluna: string; valor: unknown; negado?: boolean }> = [];
          const valorDaColuna = (coluna: string): unknown => {
            if (coluna === "id") return linha.id;
            if (coluna === "payment_status") return linha.payment_status;
            if (coluna === "gateway_payment_id") return linha.gateway_payment_id ?? null;
            if (coluna === "status") return linha.status ?? "pending";
            if (coluna === "tentativas_de_pagamento") return linha.tentativas_de_pagamento ?? 0;
            return Symbol.for("coluna-desconhecida");
          };
          const bateFiltro = (coluna: string, valor: unknown, negado = false): boolean => {
            const atual = valorDaColuna(coluna);
            if (atual === Symbol.for("coluna-desconhecida")) return false;
            return negado ? atual !== valor : atual === valor;
          };
          const encadeador = {
            eq(coluna: string, valor: unknown) {
              filtros.push({ coluna, valor });
              return encadeador;
            },
            neq(coluna: string, valor: unknown) {
              filtros.push({ coluna, valor, negado: true });
              return encadeador;
            },
            is(coluna: string, valor: unknown) {
              filtros.push({ coluna, valor });
              return encadeador;
            },
            select(cols: string) {
              return {
                maybeSingle: async () => {
                  if (filtros.every((f) => bateFiltro(f.coluna, f.valor, f.negado))) {
                    Object.assign(linha, valores);
                    // Achado N5 (3ª revisão de risco, 26/09/2026): devolvia
                    // só `{id, expires_at}`, FIXO — qualquer coluna nova que
                    // a produção passasse a pedir no `.select(...)` do UPDATE
                    // (ex.: `payment_status`, que o Achado R1 já lê) chegava
                    // `undefined` aqui, e um teste de corrida com esse campo
                    // caía no ramo errado por engano, sem avisar ninguém.
                    // Projeta pelas colunas REALMENTE pedidas, como o
                    // PostgREST real devolve. `Object.entries` + `filter`
                    // (não indexação por variável, `security/detect-object-
                    // injection` da catraca) — mesmo padrão de
                    // `projetarColunas`, no topo deste arquivo.
                    const colunasPedidas = new Set(cols.split(",").map((c) => c.trim()));
                    const projetado = Object.fromEntries(
                      Object.entries(linha).filter(([chave]) => colunasPedidas.has(chave)),
                    );
                    return { data: projetado, error: null };
                  }
                  return { data: null, error: null };
                },
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
 * MP COM ESTADO — semântica DOCUMENTADA de idempotência da Orders API
 * (Achado B2, 2ª revisão de risco, 26/09/2026; a suíte original assumia, sem
 * citar fonte, que a MESMA chave sempre devolvia a cobrança em cache —
 * `corpo qualquer`. A doc promete isso só para o MESMO corpo):
 *
 *  - Chave NOVA: cria a order (aprovada na hora para cartão, salvo
 *    `cartaoStatus: "action_required"`; sempre `action_required` para PIX,
 *    `payment_method.type === "bank_transfer"`).
 *  - MESMA chave, MESMO corpo: devolve a order em CACHE (replay de verdade).
 *  - MESMA chave, corpo DIFERENTE: 409 `idempotency_key_already_used` — o
 *    caso comum de cartão (o Brick nunca reusa token).
 *
 * `aoCriar` simula uma corrida externa (o pg_cron) mudando o banco NO MEIO
 * da chamada ao MP. `perderResposta` (N) faz as N primeiras chamadas bem-
 * sucedidas ainda assim LANÇAREM (a cobrança FOI criada/cacheada por baixo,
 * mas esta function nunca viu a resposta — timeout/rede).
 */
function mpComEstado(
  opts: {
    aoCriar?: (order: Record<string, unknown>) => void;
    cartaoStatus?: "processed" | "action_required";
    perderResposta?: number;
  } = {},
) {
  const porChave = new Map<string, { corpo: string; order: Record<string, unknown> }>();
  const orders: Array<Record<string, unknown>> = [];
  let perder = opts.perderResposta ?? 0;
  const fn = async (url: string, init?: RequestInit) => {
    if (init?.method === "POST" && url.endsWith("/v1/orders")) {
      const chave = (init.headers as Record<string, string>)["X-Idempotency-Key"];
      const corpoTexto = String(init.body);
      const jaExistente = porChave.get(chave);
      if (jaExistente && jaExistente.corpo !== corpoTexto) {
        return new Response(
          JSON.stringify({
            errors: [{
              code: "idempotency_key_already_used",
              message: "The value sent as the idempotency header has already been used with a different request within the last 24 hours",
            }],
          }),
          { status: 409 },
        );
      }
      if (!jaExistente) {
        const corpo = JSON.parse(corpoTexto);
        const tipo = (corpo.transactions.payments[0].payment_method as Record<string, unknown>).type;
        const pix = tipo === "bank_transfer";
        const status = pix ? "action_required" : (opts.cartaoStatus ?? "processed");
        const o = {
          id: `ORDTST${String(orders.length + 1).padStart(22, "0")}`,
          status,
          status_detail: pix ? "waiting_transfer" : (status === "processed" ? "accredited" : "pending_challenge"),
          external_reference: corpo.external_reference,
          total_amount: corpo.total_amount,
          transactions: {
            payments: [{
              id: "PAY",
              payment_method: {
                id: "x",
                type: tipo,
                ...(status === "action_required" && !pix
                  ? { transaction_security: { url: URL_DESAFIO } }
                  : {}),
              },
            }],
          },
        };
        orders.push(o);
        porChave.set(chave, { corpo: corpoTexto, order: o });
        opts.aoCriar?.(o);
      }
      if (perder > 0) {
        perder--;
        throw new DOMException("abortado", "AbortError");
      }
      return new Response(JSON.stringify(porChave.get(chave)!.order), { status: 201 });
    }
    throw new Error(`fetch inesperado nas corridas: ${init?.method} ${url}`);
  };
  return { fn, orders };
}

Deno.test("CARTÃO (corrida real, Achado A1a): duas abas com TOKENS DIFERENTES no mesmo pedido -> UMA ÚNICA order aprovada (chave sem hash do token converge)", async () => {
  const db = bancoComEstado(pedidoBase({ user_id: DONO_LOGADO, tentativas_de_pagamento: 0 }));
  const mp = mpComEstado();

  const [r1, r2] = await Promise.all([
    handler(requisicao(corpoCartao({ token: TOKEN_CARTAO }), montarToken(DONO_LOGADO)), { supabase: db, fetchImpl: mp.fn, credenciaisMp: CREDENCIAIS_LOJISTA_FIXAS }),
    handler(requisicao(corpoCartao({ token: OUTRO_TOKEN_CARTAO }), montarToken(DONO_LOGADO)), { supabase: db, fetchImpl: mp.fn, credenciaisMp: CREDENCIAIS_LOJISTA_FIXAS }),
  ]);
  const corpos = await Promise.all([r1, r2].map((r) => r.json()));

  // A prova que importa: NUNCA duas orders aprovadas para o mesmo pedido.
  assertEquals(mp.orders.filter((o) => o.status === "processed").length, 1);
  assertEquals([r1.status, r2.status].sort(), [200, 409]);
  assertEquals(corpos.filter((c) => c.statusPagamento === "pago").length, 1);
  assertEquals(db.linha.gateway_payment_id, mp.orders[0].id);
});

// Achado B2 (2ª revisão de risco, 26/09/2026) — H1 do harness do 2º revisor:
// a suíte original (Achado A1b) assumia, SEM citar fonte, que o retry
// convergia na cobrança JÁ aprovada — a semântica DOCUMENTADA da Orders API
// (`idempotency_key_already_used`, `mpComEstado`, acima) diz o oposto: MESMA
// chave + corpo DIFERENTE (o Brick nunca reusa token) é 409, não replay. Este
// teste substitui o antigo, com o desfecho CERTO.
Deno.test("CARTÃO (corrida real, Achado B2/H1 + 6ª rodada): MP aprova mas a resposta se perde (timeout) -> a 1ª chamada JÁ ocupa a vaga com sentinela (cartaoEmAnalise: true); o retry fica bloqueado sem tentar o MP de novo (nunca 'pago' sem confirmação); PIX bloqueado", async () => {
  const db = bancoComEstado(pedidoBase({ user_id: DONO_LOGADO, tentativas_de_pagamento: 0 }));
  const mp = mpComEstado({ perderResposta: 1 });

  const r1 = await handler(requisicao(corpoCartao({ token: TOKEN_CARTAO }), montarToken(DONO_LOGADO)), {
    supabase: db,
    fetchImpl: mp.fn,
  });
  const corpo1 = await r1.json();
  assertEquals(r1.status, 502, "1ª chamada: a resposta se perde (timeout) mesmo com o MP tendo aprovado por baixo");
  // Achado da 6ª rodada de risco (26/09/2026, revisão do checkout front): a
  // 1ª chamada NÃO deixa mais a vaga vazia — o MP pode ter processado a
  // order antes de a resposta se perder, e uma vaga vazia deixava um PIX
  // pedido em seguida virar uma SEGUNDA cobrança viva (o cenário que o
  // revisor reproduziu). `cartaoEmAnalise: true` avisa o front.
  assertEquals(corpo1.cartaoEmAnalise, true);
  assertEquals(
    db.linha.gateway_payment_id?.startsWith("verificando:"),
    true,
    "a 1ª chamada já ocupa a vaga com um sentinela — nunca mais fica vazia",
  );

  // Achado da 6ª rodada: o RETRY (token novo) nem chega a chamar o MP de
  // novo — a vaga já está em verificação DESDE a 1ª chamada, e a busca
  // (Ponto 1) FALHA contra este `fetchImpl` (não sabe responder `GET /v1/
  // orders?...`), então o sentinela não é resolvido e o retry recebe a
  // MESMA resposta segura de sempre para um cartão ainda em verificação —
  // sem gastar uma segunda chamada de criação (que bateria 409
  // `idempotency_key_already_used` no MP real, o cenário original do Achado
  // B2, agora fechado uma etapa antes).
  const r2 = await handler(requisicao(corpoCartao({ token: OUTRO_TOKEN_CARTAO }), montarToken(DONO_LOGADO)), {
    supabase: db,
    fetchImpl: mp.fn,
  });
  const corpo2 = await r2.json();

  // A prova que importa: a cobrança da 1ª chamada FOI aprovada no MP (é
  // real, não some), mas NUNCA vira 'pago' sem confirmação — nem uma
  // SEGUNDA cobrança é criada.
  assertEquals(mp.orders.filter((o) => o.status === "processed").length, 1);
  // C3 (02/10/2026): a busca falhou — o contrato `indisponivel` do desenho
  // A1, nunca "aguardando" sem paymentId (que prometia análise sem order).
  assertEquals(r2.status, 503);
  assertEquals(corpo2, { error: "Não foi possível consultar o pagamento agora.", verificacao: "indisponivel" });
  assertEquals(mp.orders.length, 1, "nenhum POST sobre o sentinela");
  assertEquals(
    db.linha.gateway_payment_id === mp.orders[0].id,
    false,
    "a vaga NUNCA é o id da order aprovada sem confirmação do webhook",
  );
  assertEquals(db.linha.gateway_payment_id?.startsWith("verificando:"), true);

  // O cliente desiste do cartão e tenta PIX na MESMA reserva — Achado B2:
  // não pode proceder enquanto o cartão ambíguo ainda pode cair aprovado
  // (dobraria a cobrança quando o webhook adotar depois).
  //
  // Achado S1 (3ª revisão de risco, 26/09/2026): ANTES desta correção a
  // resposta era 200 "aguardando" sem QR — o front (PagamentoOnline.tsx)
  // trataria isso como "Não foi possível gerar o QR code do PIX", categoria
  // RECUPERÁVEL, e o cliente entraria num loop de "Tentar de novo" que
  // nunca funciona (a vaga nunca é reconsultada de verdade para um
  // sentinela). O 409 explícito, com a MESMA mensagem do ramo (f) de cartão
  // em análise, é o desfecho certo — a busca do Ponto 1 (4ª revisão de
  // risco) FALHA contra este `fetchImpl` (não sabe responder `GET /v1/
  // orders?...`), então o sentinela não é resolvido e continua bloqueando.
  const rPix = await handler(requisicao({ orderId: UUID, metodo: "pix" }, montarToken(DONO_LOGADO)), {
    supabase: db,
    fetchImpl: mp.fn,
  });
  const corpoPix = await rPix.json();
  assertEquals(rPix.status, 409);
  assertEquals(corpoPix.error, "Há um pagamento com cartão em análise para este pedido.");
  assertEquals(mp.orders.some((o) => o.transactions.payments[0].payment_method.type === "bank_transfer"), false, "nenhum PIX chega a ser criado no MP");
});

Deno.test("CARTÃO (corrida real, Achado A1-P1): pg_cron expira o pedido ENQUANTO o MP aprova -> a vaga é gravada mesmo assim, nunca 'prazo acabou'", async () => {
  const db = bancoComEstado(pedidoBase({ user_id: DONO_LOGADO, tentativas_de_pagamento: 0 }));
  const mp = mpComEstado({
    aoCriar: () => {
      // `status: "cancelled"` (achado #1, revisão de risco da 9ª rodada,
      // 26/09/2026): `expirar_pedidos_vencidos` REAL grava os DOIS —
      // `payment_status = 'expirado'` E `status = 'cancelled'`, não só o
      // primeiro. Sem isto o teste nunca provava a distinção do achado A
      // (8ª rodada): expiração pelo relógio HONRA em silêncio (P1);
      // cancelamento EXPLÍCITO do cliente avisa o admin.
      db.linha.payment_status = "expirado";
      db.linha.status = "cancelled";
    },
  });

  const resposta = await handler(requisicao(corpoCartao({ token: TOKEN_CARTAO }), montarToken(DONO_LOGADO)), {
    supabase: db,
    fetchImpl: mp.fn,
  });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  assertEquals(corpo.statusPagamento, "pago");
  assertEquals(corpo.error, undefined);
  // A vaga foi gravada MESMO com o pedido já 'expirado' — é essa gravação
  // que faz `confirmar_pagamento` devolver 'pago_apos_expirar' (P1) quando o
  // webhook confirmar, em vez de 'divergente' com o slot ainda vazio.
  assertEquals(db.linha.gateway_payment_id, mp.orders[0].id);
  assertEquals(db.linha.payment_status, "expirado");
});

// Achado R3 (2ª revisão de risco, 26/09/2026) — H3 do harness do 2º revisor:
// cartão RECUSADO (402) e `liberar_cobranca_do_pedido` falhando de forma
// PERSISTENTE (mesmo com o retry de `liberarCobranca`, index.ts) —
// `tentativas_de_pagamento` nunca avança, e a PRÓXIMA tentativa (token novo)
// calcula a MESMA chave `<pedido>:c0`. Sob a semântica DOCUMENTADA da Orders
// API, isso não é mais "502 para sempre" (o bug que o harness do revisor
// mediu contra a suíte ANTIGA, que assumia replay) — é 409
// `idempotency_key_already_used`, e o Achado B2 já trata esse 409 como
// "em verificação": ocupa a vaga com o SENTINELA, devolve 'aguardando'. A
// prova que importa aqui: NUNCA um 502 sem saída, NUNCA uma segunda cobrança,
// e o cliente sempre recebe uma resposta que a tela sabe desenhar — mesmo
// com o defeito de fundo (a RPC de liberar fora do ar) sem solução aqui.
Deno.test("handler cartão: recusa (402) + liberar_cobranca falhando PERSISTENTE -> a chave presa vira 'em verificação' (Achado B2), nunca 502 sem saída (Achado R3/H3)", async () => {
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const db = bancoComEstado(
    pedidoBase({ user_id: DONO_LOGADO, tentativas_de_pagamento: 0 }),
    CONFIG_CARTAO_LIGADO,
    { liberarSempreFalha: true },
  );
  // Fetch simples (não `mpComEstado`: aquele nunca devolve um 402 de cartão)
  // — replica a semântica DOCUMENTADA de idempotência da Orders API (mesma
  // chave, corpo diferente -> 409) por cima de uma PRIMEIRA resposta de
  // recusa (402).
  const porChave = new Map<string, string>();
  let postsDeCriacao = 0;
  const fn = async (url: string, init?: RequestInit) => {
    if (init?.method === "POST" && url.endsWith("/v1/orders")) postsDeCriacao++;
    const chave = (init?.headers as Record<string, string>)["X-Idempotency-Key"];
    const corpo = String(init?.body);
    const jaExistente = porChave.get(chave);
    if (jaExistente !== undefined && jaExistente !== corpo) {
      return new Response(
        JSON.stringify({ errors: [{ code: "idempotency_key_already_used", message: "reused" }] }),
        { status: 409 },
      );
    }
    porChave.set(chave, corpo);
    return new Response(
      JSON.stringify({ errors: [{ code: "failed", details: ["PAY:cc_rejected_other_reason"] }] }),
      { status: 402 },
    );
  };

  const r1 = await handler(requisicao(corpoCartao({ token: TOKEN_CARTAO }), montarToken(DONO_LOGADO)), {
    supabase: db,
    fetchImpl: fn,
  });
  const c1 = await r1.json();
  assertEquals(r1.status, 200);
  assertEquals(c1.statusPagamento, "recusado");
  // A prova do defeito de fundo (fora do escopo consertar aqui): sem a RPC
  // funcionando, a tentativa NÃO avança.
  assertEquals(db.linha.tentativas_de_pagamento, 0);

  const r2 = await handler(requisicao(corpoCartao({ token: OUTRO_TOKEN_CARTAO }), montarToken(DONO_LOGADO)), {
    supabase: db,
    fetchImpl: fn,
  });
  const c2 = await r2.json();

  // A prova que importa (Achado R3): NUNCA 502 sem saída e NUNCA uma
  // segunda cobrança. C3 (02/10/2026, achado H1d): a RPC que falhou deixou o
  // sentinela da reserva na vaga, e sobre sentinela não há POST nenhum — a
  // busca (que este fetch não sabe responder) falha e o cliente recebe o
  // contrato `indisponivel` ("Verificar de novo"), não um erro sem saída.
  assertEquals(r2.status, 503);
  assertEquals(c2.verificacao, "indisponivel");
  assertEquals(db.linha.gateway_payment_id?.startsWith("verificando:"), true);

  // Uma TERCEIRA tentativa (outro token): a mesma consulta, nenhum POST.
  const r3 = await handler(requisicao(corpoCartao({ token: "tkn-terceiro-abcdef123456" }), montarToken(DONO_LOGADO)), {
    supabase: db,
    fetchImpl: fn,
  });
  const c3 = await r3.json();
  assertEquals(r3.status, 503);
  assertEquals(c3.verificacao, "indisponivel");
  assertEquals(postsDeCriacao, 1, "só a 1ª chamada chegou a criar — nenhum POST sobre o sentinela");
});

// Achado S1 (3ª revisão de risco, 26/09/2026, R3-H2 do harness do 3º
// revisor): antes desta correção o sentinela só saía pela mão do webhook
// (uma cobrança aprovada aparecer e ser ADOTADA) — uma recusa cuja resposta
// se perdeu (nenhuma cobrança aprovada existe em lugar NENHUM) deixava o
// pedido preso no sentinela até a reserva morrer, e um PIX pedido sobre essa
// vaga voltava 200 sem QR (o front mostraria "Não foi possível gerar o QR
// code do PIX" em loop de "Tentar de novo", nunca "em análise").
//
// Ponto 1 (4ª revisão de risco, 26/09/2026) substituiu a 2ª metade original
// deste teste (que provava a liberação por um TETO FIXO de relógio,
// `MINUTOS_SENTINELA_PRESO` — o próprio buraco que o 4º revisor mediu: um
// cartão em `processing` pode levar DIAS em análise, e 3 minutos soltava a
// vaga bem antes de a cobrança anterior estar morta de verdade, abrindo
// espaço para o PIX virar uma SEGUNDA cobrança). Agora prova o oposto: o
// TEMPO sozinho NUNCA solta — o `fetchImpl` deste teste não sabe responder
// `GET /v1/orders?...` (a busca do Ponto 1), então a busca FALHA (mesma
// classe de erro que uma indisponibilidade real do MP), e mesmo um sentinela
// bem velho continua bloqueando o PIX.
Deno.test("handler cartão (Achado S1 + Ponto 1): recusa com resposta perdida vira sentinela; PIX sobre o sentinela FRESCO recebe 409 explícito (nunca 200 sem QR); sentinela VELHO com busca que FALHA continua bloqueando (nunca libera só pelo relógio)", async () => {
  const db = bancoComEstado(pedidoBase({ user_id: DONO_LOGADO, tentativas_de_pagamento: 0 }));
  const porChave = new Map<string, { corpo: string; order: Record<string, unknown> | null }>();
  let perderPrimeira = true;
  const fn = async (_url: string, init?: RequestInit) => {
    const chave = (init?.headers as Record<string, string>)["X-Idempotency-Key"];
    const corpoTexto = String(init?.body);
    const corpo = JSON.parse(corpoTexto);
    const tipo = (corpo.transactions.payments[0].payment_method as Record<string, unknown>).type;
    const pix = tipo === "bank_transfer";
    const jaExistente = porChave.get(chave);
    if (jaExistente && jaExistente.corpo !== corpoTexto) {
      return new Response(
        JSON.stringify({ errors: [{ code: "idempotency_key_already_used", message: "reused" }] }),
        { status: 409 },
      );
    }
    if (!jaExistente) {
      const o = pix
        ? {
            id: `ORDTSTPIXR3H2${String(porChave.size + 1).padStart(15, "0")}`,
            status: "action_required",
            status_detail: "waiting_transfer",
            external_reference: corpo.external_reference,
            total_amount: corpo.total_amount,
            transactions: {
              payments: [{
                id: "PAYPIX",
                payment_method: { id: "pix", type: "bank_transfer", qr_code: "QR", qr_code_base64: "QRB64" },
              }],
            },
          }
        : null;
      porChave.set(chave, { corpo: corpoTexto, order: o });
    }
    if (!pix) {
      if (perderPrimeira) {
        perderPrimeira = false;
        throw new DOMException("aborted", "AbortError");
      }
      return new Response(
        JSON.stringify({ errors: [{ code: "failed", details: ["PAY:cc_rejected_other_reason"] }] }),
        { status: 402 },
      );
    }
    return new Response(JSON.stringify(porChave.get(chave)!.order), { status: 201 });
  };

  // 1ª tentativa: a resposta (402) se perde antes de chegar (rede/timeout)
  // -> 502 recuperável, tentativa não avança. Achado da 6ª rodada de risco
  // (26/09/2026): a vaga NÃO fica mais vazia — a criação ambígua já ocupa a
  // vaga com um sentinela nesta MESMA chamada, com `cartaoEmAnalise: true`.
  const r1 = await handler(requisicao(corpoCartao({ token: TOKEN_CARTAO }), montarToken(DONO_LOGADO)), {
    supabase: db,
    fetchImpl: fn,
  });
  const c1 = await r1.json();
  assertEquals(r1.status, 502);
  assertEquals(c1.cartaoEmAnalise, true);
  assertEquals(db.linha.gateway_payment_id?.startsWith("verificando:"), true);

  // 2ª tentativa (token novo do Brick): a vaga JÁ está em verificação desde
  // a 1ª chamada — bloqueada no topo do handler, sem sequer tentar o MP de
  // novo (a busca do Ponto 1 falha contra este `fetchImpl`, que não sabe
  // responder GET, então o sentinela não é resolvido).
  const r2 = await handler(requisicao(corpoCartao({ token: OUTRO_TOKEN_CARTAO }), montarToken(DONO_LOGADO)), {
    supabase: db,
    fetchImpl: fn,
  });
  const c2 = await r2.json();
  // C3 (02/10/2026): sobre o sentinela não há POST; a busca falhou ->
  // contrato `indisponivel`, nunca "aguardando" sem order.
  assertEquals(r2.status, 503);
  assertEquals(c2.verificacao, "indisponivel");
  assertEquals(db.linha.gateway_payment_id?.startsWith("verificando:"), true);
  assertEquals(
    (Date.now() - new Date(db.linha.updated_at as string).getTime()) < 1000,
    true,
    "sentinela recém-gravado — o carimbo é de agora",
  );

  // (S1, metade 1) PIX sobre o sentinela FRESCO: 409 explícito, nunca 200
  // sem QR. A busca do Ponto 1 FALHA contra este `fetchImpl` (não sabe
  // responder `GET /v1/orders?...`) — "não resolvido" cai na MESMA resposta
  // de segurança de sempre. `cartaoEmAnalise: true` (achado B3 da revisão do
  // checkout front) diz ao front para NÃO oferecer "Cancelar pedido" aqui.
  const rPix1 = await handler(requisicao({ orderId: UUID, metodo: "pix" }, montarToken(DONO_LOGADO)), {
    supabase: db,
    fetchImpl: fn,
  });
  const cPix1 = await rPix1.json();
  assertEquals(rPix1.status, 409);
  assertEquals(cPix1.error, "Há um pagamento com cartão em análise para este pedido.");
  assertEquals(cPix1.cartaoEmAnalise, true);
  assertEquals(cPix1.qrCode, undefined);
  assertEquals(db.linha.gateway_payment_id?.startsWith("verificando:"), true, "vaga intacta — nada foi liberado");

  // (Ponto 1, 4ª revisão de risco, 26/09/2026) Sentinela VELHO — envelhecer
  // `updated_at` não muda MAIS nada: o relógio deixou de ser o critério.
  // Como a busca continua FALHANDO (mesmo `fetchImpl`), o sentinela continua
  // bloqueando o PIX — a prova exata de "search failure -> no time-based
  // release" pedida pela 4ª revisão de risco.
  db.linha.updated_at = new Date(Date.now() - 60 * 60_000).toISOString();
  const rPix2 = await handler(requisicao({ orderId: UUID, metodo: "pix" }, montarToken(DONO_LOGADO)), {
    supabase: db,
    fetchImpl: fn,
  });
  const cPix2 = await rPix2.json();
  assertEquals(rPix2.status, 409);
  assertEquals(cPix2.error, "Há um pagamento com cartão em análise para este pedido.");
  assertEquals(cPix2.cartaoEmAnalise, true);
  assertEquals(db.linha.gateway_payment_id?.startsWith("verificando:"), true, "o relógio sozinho NUNCA libera — só a busca (ou a expiração da reserva) resolve o sentinela");
  assertEquals(db.linha.tentativas_de_pagamento, 0, "nada foi liberado, então a tentativa não avança");
});

// Ponto 1 (4ª revisão de risco, 26/09/2026): a busca (`buscarOrdersDoPedido`)
// encontra a MESMA cobrança de cartão ainda VIVA (`processing`) — grava o id
// REAL na vaga (troca o sentinela) em vez de liberar. Testes escopados de
// `resolverSentinela` (puro) moram em `_shared/mercadopago_test.ts`; este
// prova o HANDLER de ponta a ponta com a busca no meio.
Deno.test("handler cartão (Ponto 1): sentinela + busca encontra a cobrança AINDA VIVA (processing) -> grava o id real na vaga, NUNCA libera; PIX continua bloqueado", async () => {
  const db = bancoComEstado(pedidoBase({ user_id: DONO_LOGADO, tentativas_de_pagamento: 0 }));
  const idOrderViva = "ORDTST0PONTO1VIVA000000000001";
  const ordemViva = orderDeCartao("processing", "in_process", { id: idOrderViva });
  let perdeuPrimeira = true;
  // Achado da 6ª rodada de risco (26/09/2026): a 1ª chamada (rede/timeout) já
  // ocupa a vaga com um sentinela — a busca (`/v1/orders?...`) SÓ passa a
  // achar a order viva a partir do ponto em que o teste liga
  // `buscaHabilitada`, para manter a mesma sequência narrativa de antes
  // (sentinela intacto no retry; resolvido só no PIX seguinte).
  let buscaHabilitada = false;
  const fn = async (url: string, init?: RequestInit) => {
    if (init?.method === "POST" && url.endsWith("/v1/orders")) {
      if (perdeuPrimeira) {
        perdeuPrimeira = false;
        throw new DOMException("abortado", "AbortError");
      }
      return new Response(
        JSON.stringify({ errors: [{ code: "idempotency_key_already_used", message: "reused" }] }),
        { status: 409 },
      );
    }
    if (url.includes("/v1/orders?")) {
      return new Response(JSON.stringify({ results: buscaHabilitada ? [ordemViva] : [] }), { status: 200 });
    }
    if (url.endsWith(`/v1/orders/${idOrderViva}`)) {
      return new Response(JSON.stringify(ordemViva), { status: 200 });
    }
    throw new Error(`fetch inesperado no teste Ponto 1 (viva): ${init?.method} ${url}`);
  };

  const r1 = await handler(requisicao(corpoCartao({ token: TOKEN_CARTAO }), montarToken(DONO_LOGADO)), {
    supabase: db,
    fetchImpl: fn,
  });
  const c1 = await r1.json();
  assertEquals(r1.status, 502, "resposta perdida -> 502 recuperável");
  assertEquals(c1.cartaoEmAnalise, true, "achado da 6ª rodada: a criação ambígua já avisa o front");
  assertEquals(db.linha.gateway_payment_id?.startsWith("verificando:"), true, "achado da 6ª rodada: a 1ª chamada já ocupa a vaga com um sentinela");

  // 2ª chamada: a vaga já está em verificação desde a 1ª — a busca ainda não
  // acha nada (`buscaHabilitada` false), então o sentinela não é resolvido e
  // o retry recebe a mesma resposta segura de sempre, sem gastar uma segunda
  // chamada de criação.
  const r2 = await handler(requisicao(corpoCartao({ token: OUTRO_TOKEN_CARTAO }), montarToken(DONO_LOGADO)), {
    supabase: db,
    fetchImpl: fn,
  });
  const c2 = await r2.json();
  // C3 (02/10/2026): busca OK e vazia -> `sem_registro`, zero POST.
  assertEquals(r2.status, 200);
  assertEquals(c2.verificacao, "sem_registro");
  assertEquals(c2.statusPagamento, undefined, "nunca promete 'em análise' sem order");
  assertEquals(db.linha.gateway_payment_id?.startsWith("verificando:"), true, "sentinela intacto — a busca ainda não achou nada");

  // PIX sobre o sentinela: a busca (agora habilitada) encontra a MESMA
  // cobrança ainda viva -> grava o id REAL na vaga (Achado S3: junto de
  // metodo_online/parcelas, lidos da order ENCONTRADA) e cai no ramo (f) de
  // sempre: 409 explícito, `cartaoEmAnalise: true`, NUNCA libera — a prova
  // exata que fecha Q1 (o cartão em análise nunca perde a vaga para um PIX
  // enquanto está vivo, mesmo que o relógio tenha passado do antigo teto
  // fixo).
  buscaHabilitada = true;
  const rPix = await handler(requisicao({ orderId: UUID, metodo: "pix" }, montarToken(DONO_LOGADO)), {
    supabase: db,
    fetchImpl: fn,
  });
  const cPix = await rPix.json();
  assertEquals(rPix.status, 409);
  assertEquals(cPix.error, "Há um pagamento com cartão em análise para este pedido.");
  assertEquals(cPix.cartaoEmAnalise, true);
  assertEquals(db.linha.gateway_payment_id, idOrderViva, "sentinela TROCADO pelo id real encontrado na busca");
  assertEquals(db.linha.metodo_online, "credito", "Achado S3: grava a forma junto do id real");
  assertEquals(db.linha.parcelas, 3);
});

// Ponto 1 (4ª revisão de risco, 26/09/2026): a busca encontra a ÚNICA order
// de cartão do pedido já MORTA (recusada) — libera a vaga por FATO, e a
// PRÓXIMA cobrança (PIX, neste teste) segue normalmente.
Deno.test("handler cartão (Ponto 1): sentinela + busca encontra a cobrança MORTA (recusada) -> libera a vaga; PIX cria normalmente", async () => {
  const db = bancoComEstado(pedidoBase({ user_id: DONO_LOGADO, tentativas_de_pagamento: 0 }));
  const idOrderMorta = "ORDTST0PONTO1MORTA00000000001";
  // BLOQUEIO (7ª revisão de risco, 26/09/2026): a margem de liberação é PARA
  // A FRENTE (`MARGEM_LIBERAR_APOS_LIMITE_MS`) — a order MORTA só conta se
  // foi criada BEM depois do limite inferior gravado no sentinela. `agora`
  // computado NA CHAMADA da busca (bem depois da 1ª chamada, que grava o
  // sentinela) + 60s simula um retry humano realista (reabrir o formulário,
  // digitar o cartão de novo) — nunca um valor fixo de antes de a 1ª chamada
  // sequer rodar, que cairia ANTES do limite (o bug que o BLOQUEIO fecha).
  const ordemMorta = () => ({
    ...orderDeCartao("failed", "cc_rejected_other_reason", { id: idOrderMorta }),
    date_created: new Date(Date.now() + 60_000).toISOString(),
  });
  let perdeuPrimeira = true;
  // Achado da 6ª rodada de risco (26/09/2026): a 1ª chamada (rede/timeout) já
  // ocupa a vaga com um sentinela — a busca (`/v1/orders?...`) SÓ passa a
  // achar a order morta a partir do ponto em que o teste liga
  // `buscaHabilitada`, para manter a MESMA sequência narrativa de antes
  // (sentinela intacto no retry; liberado só no PIX seguinte).
  let buscaHabilitada = false;
  const fn = async (url: string, init?: RequestInit) => {
    if (init?.method === "POST" && url.endsWith("/v1/orders")) {
      const corpo = JSON.parse(String(init.body));
      const tipo = (corpo.transactions.payments[0].payment_method as Record<string, unknown>).type;
      if (tipo === "bank_transfer") {
        return new Response(
          JSON.stringify(orderDePix("action_required", "waiting_transfer")),
          { status: 201 },
        );
      }
      if (perdeuPrimeira) {
        perdeuPrimeira = false;
        throw new DOMException("abortado", "AbortError");
      }
      return new Response(
        JSON.stringify({ errors: [{ code: "idempotency_key_already_used", message: "reused" }] }),
        { status: 409 },
      );
    }
    if (url.includes("/v1/orders?")) {
      return new Response(JSON.stringify({ results: buscaHabilitada ? [ordemMorta()] : [] }), { status: 200 });
    }
    throw new Error(`fetch inesperado no teste Ponto 1 (morta): ${init?.method} ${url}`);
  };

  // Achado da 6ª rodada de risco (26/09/2026): a 1ª chamada (resposta
  // perdida — rede/timeout) já ocupa a vaga com um sentinela, em vez de
  // deixá-la vazia.
  const r1 = await handler(requisicao(corpoCartao({ token: TOKEN_CARTAO }), montarToken(DONO_LOGADO)), {
    supabase: db,
    fetchImpl: fn,
  });
  const c1 = await r1.json();
  assertEquals(r1.status, 502);
  assertEquals(c1.cartaoEmAnalise, true);
  assertEquals(db.linha.gateway_payment_id?.startsWith("verificando:"), true);

  // 2ª tentativa: a vaga já está em verificação desde a 1ª chamada — a
  // busca ainda não acha nada (`buscaHabilitada` false), então o sentinela
  // não é resolvido e o retry recebe a mesma resposta segura de sempre.
  const r2 = await handler(requisicao(corpoCartao({ token: OUTRO_TOKEN_CARTAO }), montarToken(DONO_LOGADO)), {
    supabase: db,
    fetchImpl: fn,
  });
  const c2 = await r2.json();
  // C3 (02/10/2026): busca OK e vazia -> `sem_registro`, zero POST.
  assertEquals(r2.status, 200);
  assertEquals(c2.verificacao, "sem_registro");
  assertEquals(db.linha.gateway_payment_id?.startsWith("verificando:"), true);

  // PIX: a busca (agora habilitada) confirma que a ÚNICA order de cartão do
  // pedido está morta E dentro da janela (B1) -> libera a vaga por FATO
  // (nunca por relógio) e cria o PIX pedido.
  buscaHabilitada = true;
  const rPix = await handler(requisicao({ orderId: UUID, metodo: "pix" }, montarToken(DONO_LOGADO)), {
    supabase: db,
    fetchImpl: fn,
  });
  const cPix = await rPix.json();
  assertEquals(rPix.status, 200);
  assertEquals(cPix.statusPagamento, "aguardando");
  assertEquals(typeof cPix.qrCode, "string", "sentinela liberado -> PIX cria e devolve QR de verdade");
  assertEquals(db.linha.gateway_payment_id?.startsWith("verificando:"), false);
  assertEquals(db.linha.tentativas_de_pagamento, 1, "a liberação do sentinela soma a tentativa, igual a uma recusa comum");
});

// B1 (5ª revisão de risco, 26/09/2026), cenário Q3 do 5º revisor: atraso de
// indexação PARCIAL — a order MORTA de uma tentativa ANTERIOR (c0) já está
// indexada, mas a order da tentativa ATUAL (c1, ainda em análise no MP,
// resposta perdida por esta function) ainda NÃO apareceu na busca. Antes de
// B1, "todas as orders ENCONTRADAS estão mortas" bastava para liberar — com
// essa lista incompleta, a vaga soltava, o PIX era criado, e quando c1
// aprovava depois (ela é REAL, só não indexada ainda) o pedido ficava com
// DUAS cobranças vivas. B1 exige que pelo menos uma order MORTA encontrada
// tenha sido criada DENTRO da janela do limite inferior do sentinela — c0,
// de uma tentativa anterior, nunca bate essa condição para a tentativa c1.
Deno.test("handler cartão (B1, Q3, relógio REALISTA — BLOQUEIO da 7ª rodada): c0 criada ~1s ANTES do limite de VERDADE (o caso comum: é ELA que causa a liberação) -> NUNCA libera; PIX continua bloqueado, nenhuma segunda cobrança", async () => {
  const db = bancoComEstado(pedidoBase({ user_id: DONO_LOGADO, tentativas_de_pagamento: 0 }));
  const idOrderC0 = "ORDTST0Q3C0MORTA0000000000001";
  // `dataC0` só é calculada DEPOIS de r1 escrever o sentinela — relativa ao
  // limite inferior de VERDADE (lido de volta do sentinela, `limiteInferior
  // DoSentinela`), nunca a um timestamp adivinhado ANTES da escrita (que
  // cairia do lado errado do relógio). MESMA técnica do harness do 6º/7º
  // revisor (`recuarDatas`).
  let dataC0: string | null = null;
  let chamadasCriacao = 0;
  const fn = async (url: string, init?: RequestInit) => {
    if (init?.method === "POST" && url.endsWith("/v1/orders")) {
      chamadasCriacao++;
      const corpo = JSON.parse(String(init.body));
      const tipo = (corpo.transactions.payments[0].payment_method as Record<string, unknown>).type;
      if (tipo === "bank_transfer") {
        throw new Error("Q3: nenhum PIX deveria chegar a ser criado — a vaga nunca deveria liberar");
      }
      // A tentativa c1 (a única de cartão desta chamada): resposta perdida
      // (rede/timeout) — a MESMA ambiguidade que a 6ª rodada fecha
      // ocupando a vaga em vez de deixá-la vazia.
      throw new DOMException("abortado", "AbortError");
    }
    if (url.includes("/v1/orders?")) {
      // Q3: a busca só vê c0 (indexada); c1 (a tentativa ATUAL) ainda NÃO
      // apareceu — atraso de indexação parcial.
      const ordemC0 = {
        ...orderDeCartao("failed", "cc_rejected_other_reason", { id: idOrderC0 }),
        date_created: dataC0,
      };
      return new Response(JSON.stringify({ results: [ordemC0] }), { status: 200 });
    }
    throw new Error(`fetch inesperado no teste Q3: ${init?.method} ${url}`);
  };

  // c1: rede/timeout -> a 1ª chamada já ocupa a vaga com um sentinela.
  const r1 = await handler(requisicao(corpoCartao({ token: TOKEN_CARTAO }), montarToken(DONO_LOGADO)), {
    supabase: db,
    fetchImpl: fn,
  });
  assertEquals(r1.status, 502);
  assertEquals(db.linha.gateway_payment_id?.startsWith("verificando:"), true);
  // c0: já morta, indexada — criada só ~1s ANTES do limite de VERDADE que a
  // própria 1ª chamada acabou de gravar. É o caso REAL (R6-Q3 do 6º
  // revisor): a margem de liberação era PARA TRÁS antes do BLOQUEIO da 7ª
  // rodada, e uma order criada 1s antes do limite caía quase sempre dentro
  // dela — o buraco que este teste prova fechado.
  const limiteInferiorMs = limiteInferiorDoSentinela(db.linha.gateway_payment_id);
  dataC0 = new Date((limiteInferiorMs as number) - 1_000).toISOString();

  // O cliente pede PIX: SEM o BLOQUEIO, c0 (1s antes do limite) caía dentro
  // da margem PARA TRÁS -> "todas mortas" -> liberava -> criava o PIX ->
  // duas cobranças quando c1 aprovasse depois. COM o BLOQUEIO (margem PARA A
  // FRENTE), c0 nunca conta -> a lista incompleta NUNCA libera.
  const rPix = await handler(requisicao({ orderId: UUID, metodo: "pix" }, montarToken(DONO_LOGADO)), {
    supabase: db,
    fetchImpl: fn,
  });
  const cPix = await rPix.json();
  assertEquals(rPix.status, 409, "B1 fecha Q3: a lista parcial (só c0, criada ANTES do limite) NUNCA libera");
  assertEquals(cPix.cartaoEmAnalise, true);
  assertEquals(db.linha.gateway_payment_id?.startsWith("verificando:"), true, "vaga intacta");
  assertEquals(chamadasCriacao, 1, "nenhuma segunda cobrança (PIX) chegou a ser criada no MP");
});

// PAGINAÇÃO (02/10/2026): a busca (`buscarOrdersDoPedido`) não pedia `page_size`
// e devolvia a 1ª página (20) como se fosse a lista completa. Aqui o MP é
// PAGINADO de verdade (devolve 20 por página e diz `paging.total = "21"`): a
// cobrança CAPTURADA da tentativa anterior só existe na página 2. A página 1
// traz 19 mortas antigas + a morta da tentativa atual (DENTRO da janela) —
// exatamente o que fazia `resolverSentinela` dizer "liberar". Lista parcial
// NUNCA libera: nada de `liberar_cobranca_do_pedido`, nada de POST de cobrança
// nova (seria a segunda captura para o mesmo pedido).
Deno.test("handler cartão (paginação): sentinela + busca PAGINADA (total 21, a capturada só na página 2) -> 503 'indisponivel': NÃO libera a vaga, NÃO chama liberar_cobranca_do_pedido, NÃO faz POST de cobrança nova (cartão nem PIX)", async () => {
  const db = bancoComEstado(pedidoBase({ user_id: DONO_LOGADO, tentativas_de_pagamento: 0 }));
  const idCapturadaNaPagina2 = "ORDTST0PAGINA2CAPTURADA0001";
  const posts: string[] = [];
  const paginasPedidas: Array<string | null> = [];
  const fn = async (url: string, init?: RequestInit) => {
    if (init?.method === "POST" && url.endsWith("/v1/orders")) {
      posts.push(url);
      // O 1º POST (cartão da tentativa c0) perde a resposta e ocupa a vaga com
      // o sentinela; qualquer POST DEPOIS dele é uma cobrança nova — se
      // acontecer, a resposta de sucesso deixa o defeito visível nas asserções
      // abaixo em vez de estourar aqui.
      if (posts.length === 1) throw new DOMException("abortado", "AbortError");
      return new Response(
        JSON.stringify(orderDeCartao("processed", "accredited", { id: "ORDTST0SEGUNDACOBRANCA0001" })),
        { status: 201 },
      );
    }
    if (url.includes("/v1/orders?")) {
      const q = new URL(url).searchParams;
      paginasPedidas.push(q.get("page"));
      if (q.get("page") === "2") {
        return new Response(
          JSON.stringify({
            data: [{
              ...orderDeCartao("processed", "accredited", { id: idCapturadaNaPagina2 }),
              date_created: new Date(Date.now() - 50 * 60_000).toISOString(),
            }],
            paging: { total: "21", total_pages: "2", offset: "20", limit: "20" },
          }),
          { status: 200 },
        );
      }
      const mortas = Array.from({ length: 19 }, (_, i) => ({
        ...orderDeCartao("failed", "cc_rejected_other_reason", { id: `ORDTST0PAGINA1MORTA${String(i).padStart(8, "0")}` }),
        date_created: new Date(Date.now() - 40 * 60_000 + i * 60_000).toISOString(),
      }));
      const atualMorta = {
        ...orderDeCartao("failed", "cc_rejected_other_reason", { id: "ORDTST0PAGINA1ATUALMORTA001" }),
        date_created: new Date(Date.now() + 60_000).toISOString(),
      };
      return new Response(
        JSON.stringify({
          data: [atualMorta, ...mortas],
          paging: { total: "21", total_pages: "2", offset: "0", limit: "20" },
        }),
        { status: 200 },
      );
    }
    throw new Error(`fetch inesperado no teste de paginação: ${init?.method} ${url}`);
  };

  // 1ª chamada: resposta perdida -> a vaga fica com o sentinela.
  const r1 = await handler(requisicao(corpoCartao({ token: TOKEN_CARTAO }), montarToken(DONO_LOGADO)), {
    supabase: db,
    fetchImpl: fn,
  });
  assertEquals(r1.status, 502);
  assertEquals(db.linha.gateway_payment_id?.startsWith("verificando:"), true);

  // Retry do cartão (token novo): a busca devolve lista PARCIAL -> sem decisão.
  const r2 = await handler(requisicao(corpoCartao({ token: OUTRO_TOKEN_CARTAO }), montarToken(DONO_LOGADO)), {
    supabase: db,
    fetchImpl: fn,
  });
  const c2 = await r2.json();
  assertEquals(r2.status, 503, "lista parcial = o MP não respondeu o bastante: indisponível, nunca 'sem registro' nem liberação");
  assertEquals(c2.verificacao, "indisponivel");
  assertEquals(liberacoes(db.chamadasRpc), [], "NÃO chama liberar_cobranca_do_pedido");
  assertEquals(posts.length, 1, "NÃO faz POST de cobrança nova — só o 1º POST (o que perdeu a resposta)");
  assertEquals(db.linha.gateway_payment_id?.startsWith("verificando:"), true, "a vaga continua com o sentinela");
  assertEquals(db.linha.tentativas_de_pagamento, 0, "a tentativa não avança");

  // PIX sobre o mesmo sentinela: o mesmo bloqueio (409, cartão em análise).
  const rPix = await handler(requisicao({ orderId: UUID, metodo: "pix" }, montarToken(DONO_LOGADO)), {
    supabase: db,
    fetchImpl: fn,
  });
  assertEquals(rPix.status, 409);
  assertEquals((await rPix.json()).cartaoEmAnalise, true);
  assertEquals(liberacoes(db.chamadasRpc), []);
  assertEquals(posts.length, 1, "nem o PIX cria cobrança nova");
  assertEquals(db.linha.gateway_payment_id?.startsWith("verificando:"), true);
  assertEquals(
    paginasPedidas.filter((p) => p === "2").length,
    0,
    "decisão do desenho: não paginamos — a página 2 nunca é pedida",
  );
});

// B2 (5ª revisão de risco, 26/09/2026), cenário Q4 do 5º revisor: a busca do
// MP devolve, por engano (o filtro do lado do servidor não é verificado),
// uma order APROVADA de OUTRO pedido — sem o filtro por `external_reference`
// em `buscarOrdersDoPedido`, essa order órfã seria adotada, e a RECONSULTA
// por id (ramo (a)) responderia 'pago' para ESTE cliente com a cobrança de
// OUTRO pedido.
Deno.test("handler cartão (B2, Q4): a busca devolve a order APROVADA de OUTRO pedido -> filtrada por external_reference, NUNCA adotada; vaga continua bloqueada", async () => {
  const db = bancoComEstado(pedidoBase({ user_id: DONO_LOGADO, tentativas_de_pagamento: 0 }));
  const OUTRO_PEDIDO = "9e8d7c6b-5a49-4382-9716-a5b4c3d2e1f0";
  const idOrderOrfaDeOutroPedido = "ORDTST0OUTROPEDIDOORFA0000001";
  const ordemDeOutroPedido = {
    ...orderDeCartao("processed", "accredited", { id: idOrderOrfaDeOutroPedido }),
    external_reference: OUTRO_PEDIDO, // NÃO é o pedido desta requisição (UUID)
    date_created: new Date().toISOString(),
  };
  const fn = async (url: string, init?: RequestInit) => {
    if (init?.method === "POST" && url.endsWith("/v1/orders")) {
      throw new DOMException("abortado", "AbortError"); // c1 sempre ambígua
    }
    if (url.includes("/v1/orders?")) {
      // O SERVIDOR do MP, aqui, devolve também a order de OUTRO pedido
      // (achado B2: o filtro do lado dele não é verificado) —
      // `buscarOrdersDoPedido` tem que filtrar de novo, no cliente.
      return new Response(JSON.stringify({ results: [ordemDeOutroPedido] }), { status: 200 });
    }
    throw new Error(`fetch inesperado no teste Q4: ${init?.method} ${url}`);
  };

  const r1 = await handler(requisicao(corpoCartao({ token: TOKEN_CARTAO }), montarToken(DONO_LOGADO)), {
    supabase: db,
    fetchImpl: fn,
  });
  assertEquals(r1.status, 502);
  assertEquals(db.linha.gateway_payment_id?.startsWith("verificando:"), true);

  const rPix = await handler(requisicao({ orderId: UUID, metodo: "pix" }, montarToken(DONO_LOGADO)), {
    supabase: db,
    fetchImpl: fn,
  });
  const cPix = await rPix.json();
  // B2 fecha Q4: sem o filtro, isto seria 200 "pago" com o id da order ÓRFÃ
  // de OUTRO pedido. Com o filtro, a lista chega VAZIA a `resolverSentinela`
  // (nenhuma order É deste pedido) -> null -> sentinela mantido -> 409.
  assertEquals(rPix.status, 409, "B2 fecha Q4: a order de OUTRO pedido nunca é adotada");
  assertEquals(cPix.cartaoEmAnalise, true);
  assertEquals(db.linha.gateway_payment_id?.startsWith("verificando:"), true);
  assertEquals(db.linha.gateway_payment_id === idOrderOrfaDeOutroPedido, false);
});

// Q1 (4ª revisão de risco, 26/09/2026, harness ponta a ponta do 4º revisor):
// cartão fica em ANÁLISE (`processing`, pode levar dias) com a resposta
// perdida -> sentinela; o cliente insiste em PIX várias vezes, inclusive
// bem depois do antigo teto de 3 min -> NUNCA cria um PIX novo enquanto o
// cartão segue vivo; quando o cartão finalmente é APROVADO, o PRÓXIMO PIX
// pedido ADOTA o cartão (200 'pago') em vez de criar uma segunda cobrança —
// a prova de que os dois nunca ficam vivos ao mesmo tempo.
Deno.test("Q1 — cartão em análise (processing) + sentinela: PIX repetido NUNCA cria cobrança nova enquanto o cartão está vivo; quando o cartão aprova, o PIX seguinte ADOTA em vez de dobrar a cobrança", async () => {
  const db = bancoComEstado(pedidoBase({ user_id: DONO_LOGADO, tentativas_de_pagamento: 0 }));
  const idOrderCartao = "ORDTST0Q1CARTAOPROCESSING0001";
  let statusAtual: [string, string] = ["processing", "in_process"];
  const ordemCartao = () => orderDeCartao(statusAtual[0], statusAtual[1], { id: idOrderCartao });
  let perdeuPrimeira = true;
  const chamadasDeCriacao: string[] = [];
  // Achado da 6ª rodada de risco (26/09/2026): a 1ª chamada (rede/timeout) já
  // ocupa a vaga com um sentinela — a busca (`/v1/orders?...`) SÓ passa a
  // achar a order viva a partir do início do loop de PIX, para manter a
  // MESMA sequência narrativa de antes (sentinela intacto no retry;
  // resolvido só quando o cliente insiste em PIX).
  let buscaHabilitada = false;
  const fn = async (url: string, init?: RequestInit) => {
    if (init?.method === "POST" && url.endsWith("/v1/orders")) {
      const corpo = JSON.parse(String(init.body));
      const tipo = (corpo.transactions.payments[0].payment_method as Record<string, unknown>).type;
      chamadasDeCriacao.push(tipo);
      if (perdeuPrimeira) {
        perdeuPrimeira = false;
        throw new DOMException("abortado", "AbortError");
      }
      return new Response(
        JSON.stringify({ errors: [{ code: "idempotency_key_already_used", message: "reused" }] }),
        { status: 409 },
      );
    }
    if (url.includes("/v1/orders?")) {
      return new Response(JSON.stringify({ results: buscaHabilitada ? [ordemCartao()] : [] }), { status: 200 });
    }
    if (url.endsWith(`/v1/orders/${idOrderCartao}`)) {
      return new Response(JSON.stringify(ordemCartao()), { status: 200 });
    }
    throw new Error(`fetch inesperado no teste Q1: ${init?.method} ${url}`);
  };

  const r1 = await handler(requisicao(corpoCartao({ token: TOKEN_CARTAO }), montarToken(DONO_LOGADO)), {
    supabase: db,
    fetchImpl: fn,
  });
  const c1 = await r1.json();
  assertEquals(r1.status, 502);
  assertEquals(c1.cartaoEmAnalise, true);
  assertEquals(db.linha.gateway_payment_id?.startsWith("verificando:"), true);

  // 2ª chamada: a vaga já está em verificação desde a 1ª — a busca ainda não
  // acha nada, então o retry recebe a mesma resposta segura de sempre, sem
  // gastar uma segunda chamada de criação.
  const r2 = await handler(requisicao(corpoCartao({ token: OUTRO_TOKEN_CARTAO }), montarToken(DONO_LOGADO)), {
    supabase: db,
    fetchImpl: fn,
  });
  // C3 (02/10/2026): busca OK e vazia -> `sem_registro`, zero POST.
  assertEquals((await r2.json()).verificacao, "sem_registro");
  assertEquals(chamadasDeCriacao.length, 1, "nenhum POST sobre o sentinela");
  assertEquals(db.linha.gateway_payment_id?.startsWith("verificando:"), true);

  // O cliente insiste em PIX três vezes (simulando o tempo passando, inútil
  // agora) enquanto o cartão segue `processing` — NUNCA cria um PIX novo.
  buscaHabilitada = true;
  for (let i = 0; i < 3; i++) {
    db.linha.updated_at = new Date(Date.now() - (i + 1) * 60 * 60_000).toISOString();
    const rPix = await handler(requisicao({ orderId: UUID, metodo: "pix" }, montarToken(DONO_LOGADO)), {
      supabase: db,
      fetchImpl: fn,
    });
    const cPix = await rPix.json();
    assertEquals(rPix.status, 409, `tentativa ${i}: PIX continua bloqueado`);
    assertEquals(cPix.cartaoEmAnalise, true);
  }
  assertEquals(chamadasDeCriacao.includes("bank_transfer"), false, "NENHUM PIX foi criado no MP enquanto o cartão está vivo");

  // O banco emissor finalmente aprova o cartão.
  statusAtual = ["processed", "accredited"];

  // O cliente pede PIX de novo: a busca agora encontra a cobrança APROVADA
  // -> grava o id real e ADOTA (ramo (a): 200 'pago'), SEM criar PIX nenhum.
  const rPixFinal = await handler(requisicao({ orderId: UUID, metodo: "pix" }, montarToken(DONO_LOGADO)), {
    supabase: db,
    fetchImpl: fn,
  });
  const cPixFinal = await rPixFinal.json();
  assertEquals(rPixFinal.status, 200);
  assertEquals(cPixFinal.statusPagamento, "pago");
  assertEquals(db.linha.gateway_payment_id, idOrderCartao);
  assertEquals(chamadasDeCriacao.includes("bank_transfer"), false, "nenhum PIX foi criado — nunca duas cobranças vivas");
});

// Achado S3 (3ª revisão de risco, 26/09/2026, R3-H6 do harness do 3º
// revisor): o SENTINELA não pode gravar `metodo_online`/`parcelas` a partir
// do corpo do RETRY — a cobrança da tentativa ANTERIOR (que pode estar
// aprovada por baixo) pode ter sido uma forma/parcelamento DIFERENTE do
// retry que gravou o sentinela.
Deno.test("handler cartão (Achado S3, R3-H6): a cobrança aprovada foi crédito 6x, o retry que virou sentinela foi débito -> sentinela NÃO grava metodo_online/parcelas do retry", async () => {
  const db = bancoComEstado(pedidoBase({ user_id: DONO_LOGADO, tentativas_de_pagamento: 0 }));
  const mp = mpComEstado({ perderResposta: 1 });

  // 1ª chamada (crédito 6x): aprovada no MP, mas a resposta se perde.
  const r1 = await handler(requisicao(corpoCartao({ token: TOKEN_CARTAO, parcelas: 6 }), montarToken(DONO_LOGADO)), {
    supabase: db,
    fetchImpl: mp.fn,
  });
  assertEquals(r1.status, 502);

  // 2ª chamada (débito, token novo) sobre o sentinela. Antes da correção, o
  // sentinela gravava metodo_online:'debito' e parcelas:1 — a forma do RETRY,
  // não da cobrança aprovada (crédito 6x). C3 (02/10/2026): o retry nem chega
  // ao MP (zero POST sobre sentinela); a busca falha contra este dublê ->
  // `indisponivel`.
  const r2 = await handler(
    requisicao(corpoCartao({ token: OUTRO_TOKEN_CARTAO, paymentTypeId: "debit_card", paymentMethodId: "debelo" }), montarToken(DONO_LOGADO)),
    { supabase: db, fetchImpl: mp.fn, credenciaisMp: CREDENCIAIS_LOJISTA_FIXAS },
  );
  const c2 = await r2.json();
  assertEquals(r2.status, 503);
  assertEquals(c2.verificacao, "indisponivel");
  assertEquals(mp.orders.length, 1, "nenhum POST sobre o sentinela");
  assertEquals(db.linha.gateway_payment_id?.startsWith("verificando:"), true);
  assertEquals(mp.orders.filter((o) => o.status === "processed").length, 1, "a cobrança de crédito 6x FOI aprovada no MP");
  // A prova que importa: o sentinela não inventa a forma do pagamento a
  // partir do retry — quem grava a forma de verdade é a ADOÇÃO do webhook,
  // quando ele reconsultar a cobrança aprovada.
  assertEquals(db.linha.metodo_online, undefined);
  assertEquals(db.linha.parcelas, undefined);
});

// Achado S3 (3ª revisão de risco, 26/09/2026, R3-H7 do harness do 3º
// revisor): o webhook pode ADOTAR a vaga NULL (e confirmar 'pago') ANTES do
// UPDATE da PRÓPRIA `criar-pagamento` — a Orders API pode notificar em
// milissegundos. A resposta a quem PAGOU não pode ser "Este pedido já tem
// uma cobrança gerada." (409 recuperável, mentira) nem, no retry seguinte,
// "Este pedido não está aguardando pagamento." (409 terminal) — as duas
// escondem que o pagamento foi um SUCESSO.
Deno.test("handler cartão (Achado S3, R3-H7): o webhook adota a vaga NULL e confirma 'pago' ANTES do UPDATE da própria chamada -> 200 com o status da MESMA order, não 409", async () => {
  const db = bancoComEstado(pedidoBase({ user_id: DONO_LOGADO, tentativas_de_pagamento: 0 }));
  // `aoCriar` simula o webhook correndo EM PARALELO: assim que o MP cria a
  // order (a resposta ainda não voltou para `criar-pagamento`), o "webhook"
  // já adotou a vaga e confirmou 'pago' — o UPDATE desta própria chamada,
  // mais abaixo, vai perder a corrida (`.is("gateway_payment_id", null)` não
  // bate mais).
  const mp = mpComEstado({
    aoCriar: (o) => {
      db.linha.gateway_payment_id = o.id;
      db.linha.payment_status = "pago";
    },
  });

  const resposta = await handler(requisicao(corpoCartao({ token: TOKEN_CARTAO, parcelas: 6 }), montarToken(DONO_LOGADO)), {
    supabase: db,
    fetchImpl: mp.fn,
  });
  const corpo = await resposta.json();

  // A prova que importa: quem PAGOU recebe 200 com o status desta MESMA
  // order — nunca o 409 recuperável que a corrida perdida produzia antes.
  assertEquals(resposta.status, 200);
  assertEquals(corpo.statusPagamento, "pago");
  assertEquals(corpo.paymentId, mp.orders[0].id);
  assertEquals(db.linha.payment_status, "pago");
  assertEquals(db.linha.gateway_payment_id, mp.orders[0].id);
});

Deno.test("PIX (corrida real, controle): duas abas no mesmo pedido -> UMA única order (comportamento de sempre — PIX já convergia, sem mudança nesta tarefa)", async () => {
  const db = bancoComEstado(pedidoBase({ user_id: DONO_LOGADO, tentativas_de_pagamento: 0 }));
  const mp = mpComEstado();
  const corpoPix = { orderId: UUID, metodo: "pix" };

  const [r1, r2] = await Promise.all([
    handler(requisicao(corpoPix, montarToken(DONO_LOGADO)), { supabase: db, fetchImpl: mp.fn, credenciaisMp: CREDENCIAIS_LOJISTA_FIXAS }),
    handler(requisicao(corpoPix, montarToken(DONO_LOGADO)), { supabase: db, fetchImpl: mp.fn, credenciaisMp: CREDENCIAIS_LOJISTA_FIXAS }),
  ]);

  assertEquals(mp.orders.length, 1);
  assertEquals([r1.status, r2.status].sort(), [200, 409]);
});

// =============================================================================
// MATRIZ DA POLÍTICA DO PIX (Gabriel, 29/09/2026) — o PIX só existe para a
// loja com a CHAVE DE ASSINATURA DO WEBHOOK do Mercado Pago cadastrada POR
// ELA (registro cifrado em app_settings); a chave global do ambiente NÃO
// substitui (app de assinatura, uma loja por banco); o CARTÃO não é afetado
// — deliberação explícita do dono. Reprodução com fixtures (nenhum segredo
// real: os dublês vêm de _shared/credenciais-mp_fixtures.ts), exigida pela
// supervisão antes de a política valer.
// =============================================================================

// Registro padrão do dublê de app_settings: lojista COM chave de assinatura.
// Resolvido com TOP-LEVEL AWAIT e pré-serializado: os dublês servem a string
// PRONTA, sem `await` interno no `maybeSingle` — qualquer await extra no
// caminho das credenciais muda o interleaving das corridas reais
// (bancoComEstado) e o perdedor passa a ler a vaga já ocupada (artefato de
// timing, não comportamento). O cofre de teste precisa estar no Deno.env
// REAL (é de lá que `chaveDeCifra` lê): sem isto, a resolução fecha com
// `cofre_ausente` e todo teste com o registro padrão viraria 503.
Deno.env.set("MP_CHAVES_ENCRYPTION_KEY", CHAVE_CIFRA_TESTE);
const REGISTRO_LOJISTA_PADRAO = await registroMpDeTeste();
const REGISTRO_LOJISTA_JSON = JSON.stringify(REGISTRO_LOJISTA_PADRAO);

// Credenciais lojista-com-chave PRONTAS (mesma semântica do registro padrão,
// SEM a crypto do resolver no caminho) — para os TESTES DE CORRIDA: a ordem
// das tarefas de crypto.subtle ENTRE dois handlers paralelos não é
// determinística e nenhum dublê congela código de produção (achado da
// revisão independente da política do PIX, 29/09/2026). Injetadas via
// `deps.credenciaisMp`, as corridas da vaga ficam determinísticas.
const CREDENCIAIS_LOJISTA_FIXAS: CredenciaisMp = {
  origem: "lojista",
  token: TOKEN_LOJISTA_FALSO,
  segredoWebhook: WEBHOOK_LOJISTA_FALSO,
  publicKey: PUBLIC_KEY_LOJISTA_FALSA,
};

Deno.test("POLÍTICA PIX — loja nas chaves da PLATAFORMA (sem registro): PIX recusado 409 terminal pixSemChaveDeAssinatura, ZERO chamadas ao MP", async () => {
  const { supabase } = cenarioCartao({ registroMp: null });
  const mp = fetchMP({}); // qualquer chamada ao MP lança e derruba o teste

  const resposta = await handler(
    requisicao({ orderId: UUID, metodo: "pix" }, montarToken(DONO_LOGADO)),
    { supabase, fetchImpl: mp.fn },
  );
  const corpo = await resposta.json();

  assertEquals(resposta.status, 409);
  assertEquals(corpo.terminal, true);
  assertEquals(corpo.pixSemChaveDeAssinatura, true);
  assertEquals(mp.chamadas.length, 0);
});

Deno.test("POLÍTICA PIX — lojista com token mas SEM chave de assinatura: PIX recusado 409, ZERO chamadas ao MP", async () => {
  const { supabase } = cenarioCartao({
    registroMp: await registroMpDeTeste({ webhookSecret: null }),
  });
  const mp = fetchMP({});

  const resposta = await handler(
    requisicao({ orderId: UUID, metodo: "pix" }, montarToken(DONO_LOGADO)),
    { supabase, fetchImpl: mp.fn },
  );
  const corpo = await resposta.json();

  assertEquals(resposta.status, 409);
  assertEquals(corpo.pixSemChaveDeAssinatura, true);
  assertEquals(corpo.terminal, true);
  assertEquals(mp.chamadas.length, 0);
});

Deno.test("POLÍTICA PIX — o CORAÇÃO da regra: MP_WEBHOOK_SECRET GLOBAL setado no ambiente NÃO substitui a chave da loja (lojista sem chave própria continua RECUSADO)", async () => {
  // Lacuna apontada pela revisão independente: o caso "a chave global do
  // ambiente não conta como configurada" precisa ser provado COM a env
  // global PRESENTE — senão o teste anterior prova só "sem segredo nenhum".
  // Só o SEGREDO DE WEBHOOK global importa aqui: o MP_ACCESS_TOKEN é
  // irrelevante para o gate (e o cenarioCartao o re-seta em seguida — nota
  // BAIXA da re-revisão: não vamos setar o que não está em jogo).
  Deno.env.set("MP_WEBHOOK_SECRET", WEBHOOK_AMBIENTE_FALSO);
  try {
    const { supabase } = cenarioCartao({
      registroMp: await registroMpDeTeste({ webhookSecret: null }),
    });
    const mp = fetchMP({});

    const resposta = await handler(
      requisicao({ orderId: UUID, metodo: "pix" }, montarToken(DONO_LOGADO)),
      { supabase, fetchImpl: mp.fn },
    );
    const corpo = await resposta.json();

    assertEquals(resposta.status, 409);
    assertEquals(corpo.pixSemChaveDeAssinatura, true);
    assertEquals(corpo.terminal, true);
    assertEquals(mp.chamadas.length, 0);
  } finally {
    Deno.env.delete("MP_WEBHOOK_SECRET");
    Deno.env.delete("MP_ACCESS_TOKEN");
  }
});

Deno.test("POLÍTICA PIX — lojista COM chave de assinatura: PIX criado normalmente (200, UMA order no MP)", async () => {
  const { supabase } = cenarioCartao(); // registro default: lojista COM chave
  const mp = fetchMP({
    criar: {
      status: 201,
      corpo: {
        id: "ORD777",
        status: "action_required",
        status_detail: "waiting_transfer",
        transactions: {
          payments: [
            {
              id: "PAY777",
              payment_method: {
                qr_code: "QRCODE-777",
                qr_code_base64: "QR777",
                ticket_url: "https://www.mercadopago.com.br/sandbox/payments/777/ticket",
              },
            },
          ],
        },
      },
    },
  });

  const resposta = await handler(
    requisicao({ orderId: UUID, metodo: "pix" }, montarToken(DONO_LOGADO)),
    { supabase, fetchImpl: mp.fn },
  );

  assertEquals(resposta.status, 200);
  assertEquals(mp.criacoes().length, 1);
});

Deno.test("POLÍTICA PIX — delimitação: CARTÃO com lojista SEM chave de assinatura NÃO é tocado pelo gate do PIX (atravessa para o portão PRÓPRIO do cartão)", async () => {
  // Prova pela diferença: sem a chave, o pedido de CARTÃO não pode morrer no
  // 409 do PIX — ele atravessa o gate novo e bate no portão do CARTÃO (config
  // ausente -> a mensagem PRÓPRIA do cartão, sem flag do PIX). Se um dia o
  // gate do PIX engolir o cartão, este teste cai na mensagem errada.
  const { supabase } = cenarioCartao({
    configCartao: null,
    registroMp: await registroMpDeTeste({ webhookSecret: null }),
  });
  const mp = fetchMP({});

  const resposta = await handler(
    requisicao(corpoCartao(), montarToken(DONO_LOGADO)),
    { supabase, fetchImpl: mp.fn },
  );
  const corpo = await resposta.json();

  assertEquals(resposta.status, 409);
  assertEquals(corpo.error, "Esta forma de pagamento não está disponível nesta loja.");
  assertEquals(corpo.pixSemChaveDeAssinatura, undefined);
  assertEquals(corpo.terminal, undefined);
  assertEquals(mp.chamadas.length, 0);
});

// =============================================================================
// PIX 409 idempotency_key_already_used (frente 7, 29/09/2026) — o retry com
// corpo DIVERGENTE em 1 byte (cliente edita o CPF/documento entre tentativas,
// ou a resposta da 1ª criação se perdeu e o front reenvia outro corpo) bate
// na MESMA chave `<pedido>` e o MP devolve 409: a order PIX da 1ª chamada
// EXISTE e está viva, mas o ramo PIX não tratava o 409 — 502 genérico em
// loop até expires_at, cliente sem QR (o cartão já tratava via sentinela).
// A correção certa NÃO é liberar a tentativa (criaria SEGUNDA order viva):
// é RECUPERAR a order existente pela busca (funcional desde o fix do campo
// `data`) e devolver o MESMO QR.
// =============================================================================
Deno.test("PIX 409 idempotency (retry com corpo divergente) -> busca recupera a ORDER PIX viva, devolve o MESMO QR e grava a vaga (UMA order no MP, zero criação nova)", async () => {
  const { supabase, registro } = cenarioCartao();
  const orderPixViva = {
    id: "ORD777",
    status: "action_required",
    status_detail: "waiting_transfer",
    external_reference: UUID,
    transactions: {
      payments: [
        {
          id: "PAY777",
          payment_method: {
            type: "bank_transfer",
            qr_code: "QRCODE-777",
            qr_code_base64: "QR777",
            ticket_url: "https://www.mercadopago.com.br/sandbox/payments/777/ticket",
          },
        },
      ],
    },
  };
  const mp = fetchMP({
    criar: {
      status: 409,
      corpo: { errors: [{ code: "idempotency_key_already_used" }] },
    },
    consultar: { status: 200, corpo: { data: [orderPixViva] } },
  });

  const resposta = await handler(
    requisicao({ orderId: UUID, metodo: "pix" }, montarToken(DONO_LOGADO)),
    { supabase, fetchImpl: mp.fn },
  );
  const corpo = await resposta.json();

  // A order da 1ª chamada (que o MP já tem) volta como resposta — com o QR dela.
  assertEquals(resposta.status, 200);
  assertEquals(JSON.stringify(corpo).includes("QRCODE-777"), true);
  assertEquals(JSON.stringify(corpo).includes("ORD777"), true);
  // Tentou criar UMA vez (o 409), recuperou pela busca, não criou segunda.
  assertEquals(mp.criacoes().length, 1);
  // A vaga foi gravada com a order recuperada — o pedido não fica órfão da cobrança.
  assertEquals(registro.valoresUpdate?.gateway_payment_id, "ORD777");
});

Deno.test("PIX 409 idempotency com busca que NÃO acha order PIX viva -> 502 recuperável de sempre (nunca inventa QR, nunca libera a tentativa)", async () => {
  const { supabase, registro, chamadasRpc } = cenarioCartao();
  const mp = fetchMP({
    criar: {
      status: 409,
      corpo: { errors: [{ code: "idempotency_key_already_used" }] },
    },
    // Busca vazia (ou com order de outro pedido — o refiltro derruba): nada
    // de onde recuperar.
    consultar: { status: 200, corpo: { data: [] } },
  });

  const resposta = await handler(
    requisicao({ orderId: UUID, metodo: "pix" }, montarToken(DONO_LOGADO)),
    { supabase, fetchImpl: mp.fn },
  );

  assertEquals(resposta.status, 502);
  // Nada gravado, nada liberado — a chave permanece <pedido> e um retry com o
  // corpo ORIGINAL da 1ª chamada ainda devolve o replay em cache do MP.
  assertEquals(registro.valoresUpdate?.gateway_payment_id, undefined);
  assertEquals(chamadasRpc.length, 0);
});

Deno.test("PIX 409 idempotency — order recuperada SEM QR legível (busca com detalhe incompleto): reconsulta POR ID entrega o QR antes de responder (achado MÉDIO da revisão)", async () => {
  // O nível de detalhe da BUSCA é UNVERIFIED (ver comentário do helper): a
  // order pode vir sem o qr_code do payment_method. Sem a reconsulta, a
  // resposta seria 200 SEM QR — cliente com nada a pagar. Com ela, o GET por
  // id (corpo completo) entrega o QR da MESMA order.
  const { supabase, registro } = cenarioCartao();
  const orderSemQr = {
    id: "ORD777",
    status: "action_required",
    status_detail: "waiting_transfer",
    external_reference: UUID,
    transactions: {
      payments: [{ id: "PAY777", payment_method: { type: "bank_transfer" } }],
    },
  };
  const orderCompleta = {
    ...orderSemQr,
    transactions: {
      payments: [
        {
          id: "PAY777",
          payment_method: {
            type: "bank_transfer",
            qr_code: "QRCODE-DA-RECONSULTA",
            qr_code_base64: "QR-RECONSULTA",
          },
        },
      ],
    },
  };
  const gets: string[] = [];
  let posts = 0;
  const fn = async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      posts++;
      return new Response(
        JSON.stringify({ errors: [{ code: "idempotency_key_already_used" }] }),
        { status: 409 },
      );
    }
    gets.push(url);
    // GET com query = BUSCA (devolve a order magra); GET /orders/{id} =
    // reconsulta (devolve o corpo completo).
    return new Response(
      JSON.stringify(url.includes("?") ? { data: [orderSemQr] } : orderCompleta),
      { status: 200 },
    );
  };

  const resposta = await handler(
    requisicao({ orderId: UUID, metodo: "pix" }, montarToken(DONO_LOGADO)),
    { supabase, fetchImpl: fn },
  );
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  assertEquals(JSON.stringify(corpo).includes("QRCODE-DA-RECONSULTA"), true);
  assertEquals(posts, 1);
  // A busca ACHOU a order (1º GET) e a reconsulta por id entregou o QR (2º GET).
  assertEquals(gets.length, 2);
  assertEquals(registro.valoresUpdate?.gateway_payment_id, "ORD777");
});

Deno.test("PIX 409 idempotency — busca devolve order de CARTÃO viva (3DS em action_required): NÃO recupera, 502 (nunca adota cobrança de outro meio)", async () => {
  const { supabase } = cenarioCartao();
  const mp = fetchMP({
    criar: { status: 409, corpo: { errors: [{ code: "idempotency_key_already_used" }] } },
    consultar: {
      status: 200,
      corpo: {
        data: [
          {
            id: "ORD-CARTAO-3DS",
            status: "action_required",
            status_detail: "tag_3ds_challenge",
            external_reference: UUID,
            transactions: {
              payments: [{ id: "PAY3DS", payment_method: { type: "credit_card" } }],
            },
          },
        ],
      },
    },
  });

  const resposta = await handler(
    requisicao({ orderId: UUID, metodo: "pix" }, montarToken(DONO_LOGADO)),
    { supabase, fetchImpl: mp.fn },
  );

  assertEquals(resposta.status, 502);
});

Deno.test("PIX 409 idempotency — busca devolve order PIX MORTA (expired): NÃO recupera, 502 (order morta não tem QR a entregar)", async () => {
  const { supabase } = cenarioCartao();
  const mp = fetchMP({
    criar: { status: 409, corpo: { errors: [{ code: "idempotency_key_already_used" }] } },
    consultar: {
      status: 200,
      corpo: {
        data: [
          {
            id: "ORD777-MORTA",
            status: "expired",
            status_detail: "expired",
            external_reference: UUID,
            transactions: {
              payments: [
                {
                  id: "PAY777-MORTA",
                  payment_method: {
                    type: "bank_transfer",
                    qr_code: "QRCODE-MORTO",
                  },
                },
              ],
            },
          },
        ],
      },
    },
  });

  const resposta = await handler(
    requisicao({ orderId: UUID, metodo: "pix" }, montarToken(DONO_LOGADO)),
    { supabase, fetchImpl: mp.fn },
  );

  assertEquals(resposta.status, 502);
});

// --- Auditoria de 30/09/2026 do cartão (item 1), reescrita na blindagem -----
//
// Até 01/10 o PIX de outra aba podia ocupar a vaga DURANTE o POST do cartão
// (a vaga ficava livre até a gravação final), e estes testes injetavam esse
// PIX à mão para provar o remendo pós-POST (`trocarPixAbertoPeloSentinela`).
// Desde a blindagem de 02/10/2026 a vaga é RESERVADA antes do POST e o PIX só
// grava vaga livre — essa injeção virou um estado impossível. As intenções
// continuam, nas duas janelas que ainda existem:
//   (1) o ocupante chega ENTRE a leitura e a reserva -> nenhum POST de cartão;
//   (2) a notificação de uma order morta SOLTA o sentinela durante o POST
//       ambíguo -> a rede de segurança (`registrarCartaoEmVerificacao`)
//       reocupa a vaga livre ou avisa o admin, nunca assume.

function orderAvulsa(
  id: string,
  tipo: string,
  status: string,
  detalhe: string,
  externalReference: string = UUID,
): Record<string, unknown> {
  return {
    id,
    status,
    status_detail: detalhe,
    external_reference: externalReference,
    total_amount: "100.00",
    date_created: new Date().toISOString(),
    transactions: {
      payments: [{ id: `PAY-${id}`, payment_method: { id: tipo === "bank_transfer" ? "pix" : "master", type: tipo } }],
    },
  };
}

const titulosDosAvisos = (avisos: unknown[]) =>
  avisos.map((a) => String(((a as Record<string, unknown>).aviso as Record<string, unknown> | undefined)?.title ?? ""));

Deno.test("auditoria item 1 (blindagem 02/10): cartão ambíguo + outra aba pede PIX DURANTE o POST -> nenhum PIX nasce, nada a cancelar, e o retry adota o cartão capturado sem criar outro", async () => {
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const db = bancoComEstado(pedidoBase({ user_id: DONO_LOGADO, tentativas_de_pagamento: 0 }));
  let pix: { status: number; corpo: Record<string, unknown> } | null = null;
  let outraAba = true;
  const mp: MpVivo = mpVivo({
    perderRespostaCartao: true,
    aoPostarCartao: async () => {
      if (!outraAba) return;
      outraAba = false;
      pix = await chamar(db, mp, PEDIDO_PIX);
    },
  });
  const avisos: unknown[] = [];
  const r1 = await emSilencio(() => chamar(db, mp, corpoCartao(), avisos));
  assertEquals(r1.corpo.cartaoEmAnalise, true);

  // A outra aba chegou a pedir o PIX (a corrida é real)...
  const respostaPix = pix as unknown as { status: number; corpo: Record<string, unknown> };
  assertEquals(typeof respostaPix?.status, "number");
  // ...mas ele nunca nasceu: a vaga já estava reservada pelo cartão.
  assertEquals(respostaPix.corpo.qrCode, undefined, "nenhum QR entregue");
  assertEquals(mp.posts.filter((x) => x.tipo === "bank_transfer").length, 0, "o PIX nem chegou ao MP");
  assertEquals(mp.cancelamentos.length, 0, "nada a cancelar");
  const vaga = String(db.linha.gateway_payment_id);
  assertEquals(
    sentinelaDaChave(vaga, `${UUID}:c0`) || vaga === cartoes(mp)[0].id,
    true,
    `a vaga perdeu o registro do cartão: ${vaga}`,
  );
  // Revisão de 30/09 (MENOR 3): a vaga nunca herda forma de PIX.
  assertEquals(db.linha.metodo_online === "pix", false);

  // "Tentar de novo" com o cartão (token novo): resolve pela busca/reconsulta,
  // acha o cartão JÁ capturado e o adota — nunca cria outro.
  const postsAntes = mp.posts.length;
  const r2 = await emSilencio(() => chamar(db, mp, corpoCartao({ token: OUTRO_TOKEN_CARTAO }), avisos));
  assertEquals(mp.posts.length, postsAntes, "o retry NÃO chama o POST");
  assertEquals(cartoes(mp).length, 1);
  assertEquals(db.linha.gateway_payment_id, cartoes(mp)[0].id);
  assertEquals(r2.corpo.statusPagamento, "pago");
});

for (
  const caso of [
    {
      nome: "PIX aberto",
      ocupante: orderAvulsa("ORDTST01OCUPANTEPIXABERTO0000", "bank_transfer", "action_required", "waiting_transfer"),
      converge: false,
    },
    {
      nome: "PIX já pago",
      ocupante: orderAvulsa("ORDTST01OCUPANTEPIXPAGO000000", "bank_transfer", "processed", "accredited"),
      converge: false,
    },
    {
      nome: "PIX já morto (expirado)",
      ocupante: orderAvulsa("ORDTST01OCUPANTEPIXMORTO00000", "bank_transfer", "expired", "expired"),
      converge: true,
    },
  ]
) {
  Deno.test(`blindagem 02/10 (antes: auditoria item 1 / MENOR 2 / MENOR 4): ${caso.nome} ocupa a vaga ENTRE a leitura e a reserva -> 409, NENHUM POST de cartão, nada cancelado, ocupante intacto, sem alarme`, async () => {
    Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
    const db = bancoComEstado(pedidoBase({ user_id: DONO_LOGADO, tentativas_de_pagamento: 0 }));
    const mp = mpVivo();
    mp.orders.push(caso.ocupante);
    const avisos: unknown[] = [];
    const comCorrida = comReservaInterceptada(db, "ocupada", { id: String(caso.ocupante.id), metodo: "pix" });
    const r = await emSilencio(() => chamar(comCorrida, mp, corpoCartao(), avisos));

    assertEquals(r.status, 409);
    assertEquals(r.corpo.qrCode, undefined);
    assertEquals(mp.posts.length, 0, "nenhum POST: a reserva perdeu ANTES de qualquer cobrança");
    assertEquals(mp.cancelamentos.length, 0);
    assertEquals(db.linha.gateway_payment_id, caso.ocupante.id);
    assertEquals(avisos.length, 0, "nada foi cobrado — não é caso para acordar o admin");

    if (caso.converge) {
      // O "Tentar de novo" relê a vaga: o PIX morto é liberado e o cartão sai,
      // com a chave da tentativa SEGUINTE (a liberação soma a tentativa).
      const r2 = await emSilencio(() => chamar(db, mp, corpoCartao({ token: OUTRO_TOKEN_CARTAO }), avisos));
      assertEquals(r2.status, 200);
      assertEquals(cartoes(mp).length, 1);
      assertEquals(db.linha.gateway_payment_id, cartoes(mp)[0].id);
      assertEquals(mp.cancelamentos.length, 0);
    }
  });
}

const ID_OCUPANTE_DURANTE_O_POST = "ORDTST01OCUPANTEDURANTEPOST00";

function cenarioSentinelaSoltoDuranteOPost(
  ocupante:
    | "nenhum"
    | "anuladaSemRpc"
    | "pix"
    | "pixIlegivel"
    | "cartaoDoPedido"
    | "cartaoOutraTentativa"
    | "cartaoDeOutroPedido",
) {
  const db = bancoComEstado(pedidoBase({ user_id: DONO_LOGADO, tentativas_de_pagamento: 0 }));
  const base: MpVivo = mpVivo({
    perderRespostaCartao: true,
    aoPostarCartao: async () => {
      // Vaga anulada por uma escrita que NÃO avançou a tentativa (não é a
      // RPC): a rede de segurança pode reocupar com a mesma chave.
      if (ocupante === "anuladaSemRpc") {
        db.linha.gateway_payment_id = null;
        return;
      }
      // A notificação de uma order morta solta o sentinela no meio do POST
      // (`liberar_cobranca_do_pedido`: vaga NULL, forma NULL, tentativa + 1)...
      db.linha.gateway_payment_id = null;
      db.linha.metodo_online = null;
      db.linha.tentativas_de_pagamento = 1;
      if (ocupante === "nenhum") return;
      // ...e, nos outros casos, alguém ocupa a vaga livre antes de a resposta
      // do cartão (perdida) voltar.
      if (ocupante === "cartaoDoPedido") {
        db.linha.gateway_payment_id = base.orders[0].id;
        db.linha.metodo_online = "credito";
        return;
      }
      // `cartaoOutraTentativa`: um cartão `c1` do MESMO pedido, criado depois
      // de o sentinela `c0` ter sido solto — esconde a `c0` ambígua.
      const o = ocupante === "cartaoDeOutroPedido"
        ? orderAvulsa(ID_OCUPANTE_DURANTE_O_POST, "credit_card", "processed", "accredited", "outro-pedido")
        : ocupante === "cartaoOutraTentativa"
        ? orderAvulsa(ID_OCUPANTE_DURANTE_O_POST, "credit_card", "processed", "accredited")
        : orderAvulsa(ID_OCUPANTE_DURANTE_O_POST, "bank_transfer", "action_required", "waiting_transfer");
      base.orders.push(o);
      db.linha.gateway_payment_id = o.id;
      db.linha.metodo_online = ocupante === "pix" || ocupante === "pixIlegivel" ? "pix" : "credito";
    },
  });
  const fn = async (url: string, init?: RequestInit): Promise<Response> => {
    if (
      ocupante === "pixIlegivel" && (init?.method ?? "GET") === "GET" &&
      url.includes(`/v1/orders/${ID_OCUPANTE_DURANTE_O_POST}`)
    ) {
      return new Response(JSON.stringify({ message: "internal_error" }), { status: 500 });
    }
    return base.fn(url, init);
  };
  return { db, mp: { ...base, fn } as MpVivo };
}

Deno.test("blindagem 02/10 + revisão financeira (achado 1): a notificação SOLTA o sentinela pela RPC (tentativa -> 1) durante o POST ambíguo -> a rede de segurança NÃO ressuscita a chave velha: avisa o admin, e o PIX segue", async () => {
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const { db, mp } = cenarioSentinelaSoltoDuranteOPost("nenhum");
  const avisos: unknown[] = [];
  const r = await emSilencio(() => chamar(db, mp, corpoCartao(), avisos));

  assertEquals(r.corpo.cartaoEmAnalise, true);
  assertEquals(db.linha.gateway_payment_id, null, `a vaga ressuscitou a chave c0: ${db.linha.gateway_payment_id}`);
  assertEquals(db.linha.tentativas_de_pagamento, 1);
  assertEquals(titulosDosAvisos(avisos).filter((t) => t.includes("sem registro no pedido")).length, 1);

  // O pedido não fica preso até a expiração: o PIX segue (a liberação foi
  // por prova da busca; o admin confere o cartão pelo alerta).
  const pix = await emSilencio(() => chamar(db, mp, PEDIDO_PIX));
  assertEquals(pix.status, 200);
  assertEquals(typeof pix.corpo.qrCode, "string");
});

Deno.test("blindagem 02/10: a vaga é anulada SEM a tentativa avançar durante o POST ambíguo -> a rede de segurança reocupa com o sentinela da MESMA chave, sem alerta de 'sem registro'", async () => {
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const { db, mp } = cenarioSentinelaSoltoDuranteOPost("anuladaSemRpc");
  const avisos: unknown[] = [];
  const r = await emSilencio(() => chamar(db, mp, corpoCartao(), avisos));

  assertEquals(r.corpo.cartaoEmAnalise, true);
  assertEquals(sentinelaDaChave(db.linha.gateway_payment_id, `${UUID}:c0`), true);
  assertEquals(db.linha.tentativas_de_pagamento, 0);
  assertEquals(titulosDosAvisos(avisos).some((t) => t.includes("sem registro")), false);
});

for (
  const caso of [
    {
      ocupante: "pix" as const,
      descricao: "PIX REAL aberto",
      alerta: "sem registro no pedido",
    },
    {
      ocupante: "pixIlegivel" as const,
      descricao: "id que o MP não deixou conferir (consulta 500)",
      alerta: "sem registro no pedido",
    },
    {
      ocupante: "cartaoDeOutroPedido" as const,
      descricao: "order de cartão de OUTRO pedido",
      alerta: "sem registro no pedido",
    },
    // A order do MP não carrega a chave de idempotência: "cartão do mesmo
    // pedido" não prova que é ESTA tentativa. Os dois casos abaixo são
    // indistinguíveis para o servidor e saem com o MESMO alerta conservador.
    {
      ocupante: "cartaoDoPedido" as const,
      descricao: "o PRÓPRIO cartão (adotado pela notificação)",
      alerta: "conferir cobrança em dobro",
    },
    {
      ocupante: "cartaoOutraTentativa" as const,
      descricao: "cartão REAL do mesmo pedido de OUTRA tentativa (c1)",
      alerta: "conferir cobrança em dobro",
    },
  ]
) {
  Deno.test(`blindagem 02/10 (revisões do coordenador): sentinela solto durante o POST ambíguo e ${caso.descricao} na vaga -> alerta conservador '${caso.alerta}', nunca assume registro`, async () => {
    Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
    const { db, mp } = cenarioSentinelaSoltoDuranteOPost(caso.ocupante);
    const avisos: unknown[] = [];
    const r = await emSilencio(() => chamar(db, mp, corpoCartao(), avisos));

    assertEquals(r.corpo.cartaoEmAnalise, true, "o cliente nunca recebe convite a pagar de novo");
    const titulos = titulosDosAvisos(avisos);
    assertEquals(titulos.filter((t) => t.includes(caso.alerta)).length, 1, titulos.join(" | "));
    assertEquals(titulos.some((t) => t.includes("pode se resolver sozinho")), false, "id real nunca é 'registro garantido'");
    // A vaga nunca é sobrescrita às cegas e nada é cancelado: o QR do PIX
    // pode já estar na mão do cliente na outra aba.
    assertEquals(String(db.linha.gateway_payment_id).startsWith("verificando:"), false);
    assertEquals(mp.cancelamentos.length, 0);
  });
}

// Revisão de 30/09/2026 (MENOR 4): enquanto o POST do cartão pende, outra
// aba grava o SENTINELA desta MESMA tentativa (chave `<pedido>:c0`). O POST
// volta aprovado: é a cobrança que o sentinela guarda — troca o sentinela
// pelo id real e responde 200, sem o falso "Cobrança de cartão sem registro".
function cenarioSentinelaNaVagaDuranteOPost(sentinelaGravadoPelaOutraAba: string) {
  const db = bancoComEstado(pedidoBase({ user_id: DONO_LOGADO, tentativas_de_pagamento: 0 }));
  const aprovada = {
    id: "ORDTST0000000000000000000006",
    status: "processed",
    status_detail: "accredited",
    external_reference: UUID,
    total_amount: "100.00",
    transactions: { payments: [{ id: "PAY", payment_method: { id: "master", type: "credit_card", installments: 3 } }] },
  };
  const fn = async (url: string, init?: RequestInit): Promise<Response> => {
    if (init?.method === "POST" && url.endsWith("/v1/orders")) {
      db.linha.gateway_payment_id = sentinelaGravadoPelaOutraAba;
      return new Response(JSON.stringify(aprovada), { status: 201 });
    }
    if ((init?.method ?? "GET") === "GET" && url.endsWith(`/v1/orders/${aprovada.id}`)) {
      return new Response(JSON.stringify(aprovada), { status: 200 });
    }
    throw new Error(`fetch inesperado: ${init?.method} ${url}`);
  };
  return { db, fn, aprovada };
}

Deno.test("revisão 30/09 (MENOR 4): POST aprovado com o sentinela DESTA tentativa na vaga -> adota o cartão (200), sem aviso de órfão", async () => {
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const { db, fn, aprovada } = cenarioSentinelaNaVagaDuranteOPost(`verificando:${UUID}:c0:1790000000000`);
  const avisos: unknown[] = [];
  const console_error = console.error;
  const console_warn = console.warn;
  console.error = () => {};
  console.warn = () => {};
  let status = 0;
  let corpo: Record<string, unknown> = {};
  try {
    const r = await handler(requisicao(corpoCartao(), montarToken(DONO_LOGADO)), {
      supabase: db,
      fetchImpl: fn,
      alertarAdminCartaoOrfao: async (a) => {
        avisos.push(a);
      },
    });
    status = r.status;
    corpo = await r.json();
  } finally {
    console.error = console_error;
    console.warn = console_warn;
  }
  assertEquals(status, 200);
  assertEquals(corpo.paymentId, aprovada.id);
  assertEquals(db.linha.gateway_payment_id, aprovada.id);
  assertEquals(db.linha.metodo_online, "credito");
  assertEquals(db.linha.parcelas, 3);
  assertEquals(avisos.length, 0);
});

Deno.test("revisão 30/09 (MENOR 4): sentinela de OUTRA tentativa na vaga -> nunca adota por cima (resposta terminal e aviso, como antes)", async () => {
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  // `c01` começa com `c0` — o prefixo exige o `:` logo depois da chave.
  const outro = `verificando:${UUID}:c01:1790000000000`;
  const { db, fn } = cenarioSentinelaNaVagaDuranteOPost(outro);
  const avisos: unknown[] = [];
  const console_error = console.error;
  const console_warn = console.warn;
  console.error = () => {};
  console.warn = () => {};
  let status = 0;
  try {
    const r = await handler(requisicao(corpoCartao(), montarToken(DONO_LOGADO)), {
      supabase: db,
      fetchImpl: fn,
      alertarAdminCartaoOrfao: async (a) => {
        avisos.push(a);
      },
    });
    status = r.status;
    await r.json();
  } finally {
    console.error = console_error;
    console.warn = console_warn;
  }
  assertEquals(status, 409);
  assertEquals(db.linha.gateway_payment_id, outro);
  assertEquals(avisos.length, 1);
});

// Revisão de risco de 30/09/2026 (3ª rodada, MENOR 2): a fronteira da chave
// do sentinela — formato novo (`:<ms>`) e antigo (sem sufixo), e o `:` separa
// `c1` de `c10`. Busca sem nenhuma order: nada se resolve por ela. C3
// (veredito A2, achado H1d, 02/10/2026): a re-criação com a chave ATUAL foi
// removida — agora NENHUM caso faz POST, com chave atual ou anterior.
Deno.test("revisão de risco 30/09 + C3: sobre o sentinela NUNCA há re-criação — chave atual ou anterior, formato novo e antigo (c1 ≠ c10); sem_registro, vaga e tentativa intactas", async () => {
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const casos: Array<[string, number]> = [
    [`verificando:${UUID}:c0`, 0],
    [`verificando:${UUID}:c0`, 1],
    [`verificando:${UUID}:c3:1790000000000`, 3],
    [`verificando:${UUID}:c10:1790000000000`, 1],
    [`verificando:${UUID}:c1:1790000000000`, 10],
  ];
  for (const [sentinela, tentativas] of casos) {
    const nome = `${sentinela} com tentativas=${tentativas}`;
    const db = bancoComEstado(
      pedidoBase({ user_id: DONO_LOGADO, tentativas_de_pagamento: tentativas, gateway_payment_id: sentinela }),
    );
    const chaves: string[] = [];
    const fn = async (url: string, init?: RequestInit): Promise<Response> => {
      if (init?.method === "POST" && url.endsWith("/v1/orders")) {
        chaves.push((init.headers as Record<string, string>)["X-Idempotency-Key"]);
        throw new TypeError("error sending request: connection reset");
      }
      if (url.includes("/v1/orders?")) return new Response(JSON.stringify({ results: [] }), { status: 200 });
      throw new Error(`fetch inesperado: ${init?.method} ${url}`);
    };
    const console_error = console.error;
    const console_warn = console.warn;
    console.error = () => {};
    console.warn = () => {};
    let corpo: Record<string, unknown> = {};
    try {
      const r = await handler(requisicao(corpoCartao({ token: OUTRO_TOKEN_CARTAO }), montarToken(DONO_LOGADO)), {
        supabase: db,
        fetchImpl: fn,
        alertarAdminCartaoOrfao: async () => {},
      });
      corpo = await r.json();
    } finally {
      console.error = console_error;
      console.warn = console_warn;
    }
    assertEquals(chaves, [], nome);
    assertEquals(corpo.verificacao, "sem_registro", nome);
    assertEquals(db.linha.gateway_payment_id, sentinela, nome);
    assertEquals(db.linha.tentativas_de_pagamento, tentativas, nome);
    assertEquals(db.chamadasRpc.length, 0, nome);
  }
});

// Revisão de risco de 30/09/2026 (3ª rodada, MENOR 1): sentinela de chave
// ANTERIOR (`c0`, tentativa já em 2) e a busca devolve só a order MORTA de
// uma tentativa POSTERIOR (a `c0` ambígua ainda não indexada). Liberar aqui
// levaria a um POST com `c3` ao lado de uma `c0` que ainda pode aprovar.
Deno.test("revisão de risco 30/09: busca com só uma order morta NUNCA libera sentinela de chave anterior (nenhum POST, vaga intacta)", async () => {
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const t0 = Date.now() - 10 * 60 * 1000;
  const sentinela = `verificando:${UUID}:c0:${t0}`;
  const db = bancoComEstado(
    pedidoBase({ user_id: DONO_LOGADO, tentativas_de_pagamento: 2, gateway_payment_id: sentinela }),
  );
  const mortaPosterior = {
    id: "ORDTST0000000000000000000004",
    status: "failed",
    status_detail: "failed",
    external_reference: UUID,
    total_amount: "100.00",
    date_created: new Date(t0 + 5 * 60 * 1000).toISOString(),
    transactions: { payments: [{ id: "PAY", payment_method: { id: "master", type: "credit_card" } }] },
  };
  const posts: string[] = [];
  const fn = async (url: string, init?: RequestInit): Promise<Response> => {
    if (init?.method === "POST") {
      posts.push(url);
      throw new Error(`nenhum POST esperado: ${url}`);
    }
    if (url.includes("/v1/orders?")) return new Response(JSON.stringify({ results: [mortaPosterior] }), { status: 200 });
    throw new Error(`fetch inesperado: ${init?.method} ${url}`);
  };
  const console_error = console.error;
  const console_warn = console.warn;
  console.error = () => {};
  console.warn = () => {};
  let status = 0;
  let corpo: Record<string, unknown> = {};
  try {
    const r = await handler(requisicao(corpoCartao({ token: OUTRO_TOKEN_CARTAO }), montarToken(DONO_LOGADO)), {
      supabase: db,
      fetchImpl: fn,
      alertarAdminCartaoOrfao: async () => {},
    });
    status = r.status;
    corpo = await r.json();
  } finally {
    console.error = console_error;
    console.warn = console_warn;
  }
  assertEquals(posts.length, 0);
  assertEquals(status, 200);
  // C3 (02/10/2026): o contrato `sem_registro`, nunca "aguardando" sem order.
  assertEquals(corpo.verificacao, "sem_registro");
  assertEquals(corpo.statusPagamento, undefined);
  assertEquals(db.linha.gateway_payment_id, sentinela);
  assertEquals(db.linha.tentativas_de_pagamento, 2);
});

// ═══ Blindagem do cartão (02/10/2026): reserva durável ANTES do POST ═══════
//
// A lacuna registrada em `index.ts` ("PIX concorrente cancelado, mas a vaga
// não passou para o sentinela — cartão ambíguo sem registro no pedido"):
// o POST do cartão saía com a vaga LIVRE e só depois tentava gravar. Uma
// outra aba que pedisse PIX nesse intervalo via a vaga vazia, criava o PIX e
// entregava o QR — e o cartão podia estar aprovado no MP ao mesmo tempo.
// Estes testes usam o handler DE VERDADE nas duas abas (sem escrever na vaga
// por fora), um banco com estado e um MP com estado (idempotência, busca e
// cancelamento), e provam o invariante de dinheiro: enquanto há cartão
// incerto, nenhuma outra cobrança nasce viva; o registro da cobrança do
// cartão nunca se perde; desfecho sem cobrança não trava a vaga.

type MpVivo = {
  fn: (url: string, init?: RequestInit) => Promise<Response>;
  orders: Array<Record<string, unknown>>;
  posts: Array<{ tipo: string; chave: string }>;
  cancelamentos: string[];
};

function mpVivo(opts: {
  cartaoStatus?: "processed" | "action_required";
  antesDeCriarCartao?: () => Promise<void>;
  aoPostarCartao?: () => Promise<void>;
  aoPostarPix?: () => Promise<void>;
  perderRespostaCartao?: boolean;
  cancelamentoFalha?: boolean;
  falhaCartao?: { status: number; corpo: Record<string, unknown>; criaOrderRecusada?: boolean };
} = {}): MpVivo {
  const orders: Array<Record<string, unknown>> = [];
  const porChave = new Map<string, { corpo: string; order: Record<string, unknown> }>();
  const posts: Array<{ tipo: string; chave: string }> = [];
  const cancelamentos: string[] = [];
  const criar = (corpo: Record<string, unknown>, tipo: string, status: string, detalhe: string) => {
    const pix = tipo === "bank_transfer";
    const o: Record<string, unknown> = {
      id: `ORDTST${String(orders.length + 1).padStart(22, "0")}`,
      status,
      status_detail: detalhe,
      external_reference: corpo.external_reference,
      total_amount: corpo.total_amount,
      date_created: new Date().toISOString(),
      transactions: {
        payments: [{
          id: `PAY${orders.length + 1}`,
          payment_method: {
            id: pix ? "pix" : "master",
            type: tipo,
            ...(pix ? { qr_code: "00020126-copia-e-cola", qr_code_base64: "iVBORw0KGgo=" } : {}),
            ...(!pix && status === "action_required" ? { transaction_security: { url: URL_DESAFIO } } : {}),
          },
        }],
      },
    };
    orders.push(o);
    return o;
  };
  const fn = async (url: string, init?: RequestInit): Promise<Response> => {
    const verbo = init?.method ?? "GET";
    if (verbo === "POST" && url.endsWith("/v1/orders")) {
      const chave = (init?.headers as Record<string, string>)["X-Idempotency-Key"];
      const corpoTexto = String(init?.body);
      const corpo = JSON.parse(corpoTexto);
      const tipo = String(
        ((corpo.transactions?.payments?.[0]?.payment_method ?? {}) as Record<string, unknown>).type ?? "",
      );
      const pix = tipo === "bank_transfer";
      posts.push({ tipo, chave });
      if (!pix && opts.antesDeCriarCartao) await opts.antesDeCriarCartao();
      const jaExistente = porChave.get(chave);
      if (jaExistente && jaExistente.corpo !== corpoTexto) {
        return new Response(
          JSON.stringify({ errors: [{ code: "idempotency_key_already_used", message: "used" }] }),
          { status: 409 },
        );
      }
      if (!pix && opts.falhaCartao && !jaExistente) {
        if (opts.falhaCartao.criaOrderRecusada) {
          const recusada = criar(corpo, tipo, "failed", "rejected_by_issuer");
          porChave.set(chave, { corpo: corpoTexto, order: recusada });
          return new Response(JSON.stringify({ ...opts.falhaCartao.corpo, data: recusada }), {
            status: opts.falhaCartao.status,
          });
        }
        return new Response(JSON.stringify(opts.falhaCartao.corpo), { status: opts.falhaCartao.status });
      }
      if (!jaExistente) {
        const status = pix ? "action_required" : (opts.cartaoStatus ?? "processed");
        const detalhe = pix ? "waiting_transfer" : (status === "processed" ? "accredited" : "pending_challenge");
        porChave.set(chave, { corpo: corpoTexto, order: criar(corpo, tipo, status, detalhe) });
      }
      if (!pix && opts.aoPostarCartao) await opts.aoPostarCartao();
      if (pix && opts.aoPostarPix) await opts.aoPostarPix();
      if (!pix && opts.perderRespostaCartao) throw new DOMException("abortado", "AbortError");
      return new Response(JSON.stringify(porChave.get(chave)!.order), { status: 201 });
    }
    if (verbo === "POST" && url.includes("/cancel")) {
      const id = url.split("/v1/orders/")[1].split("/")[0];
      cancelamentos.push(id);
      if (opts.cancelamentoFalha) return new Response(JSON.stringify({ message: "internal_error" }), { status: 500 });
      const alvo = orders.find((o) => o.id === id);
      if (!alvo) return new Response("{}", { status: 404 });
      alvo.status = "canceled";
      alvo.status_detail = "canceled";
      return new Response(JSON.stringify(alvo), { status: 200 });
    }
    if (verbo === "GET" && url.includes("/v1/orders?")) {
      return new Response(JSON.stringify({ data: orders.filter((o) => o.external_reference === UUID) }), { status: 200 });
    }
    if (verbo === "GET" && url.includes("/v1/orders/")) {
      const id = url.split("/v1/orders/")[1].split("?")[0];
      const alvo = orders.find((o) => o.id === id);
      return alvo
        ? new Response(JSON.stringify(alvo), { status: 200 })
        : new Response(JSON.stringify({ message: "not_found" }), { status: 404 });
    }
    throw new Error(`fetch inesperado na blindagem: ${verbo} ${url}`);
  };
  return { fn, orders, posts, cancelamentos };
}

async function emSilencio<T>(f: () => Promise<T>): Promise<T> {
  const erro = console.error;
  const aviso = console.warn;
  console.error = () => {};
  console.warn = () => {};
  try {
    return await f();
  } finally {
    console.error = erro;
    console.warn = aviso;
  }
}

async function chamar(
  db: unknown,
  mp: MpVivo,
  corpo: Record<string, unknown>,
  avisos: unknown[] = [],
): Promise<{ status: number; corpo: Record<string, unknown> }> {
  const r = await handler(requisicao(corpo, montarToken(DONO_LOGADO)), {
    supabase: db as never,
    fetchImpl: mp.fn as typeof fetch,
    alertarAdminCartaoOrfao: async (a) => {
      avisos.push(a);
    },
  });
  return { status: r.status, corpo: await r.json() };
}

const PEDIDO_PIX = { orderId: UUID, metodo: "pix" };

function pixVivos(mp: MpVivo): Array<Record<string, unknown>> {
  return mp.orders.filter((o) => {
    const pm = ((o.transactions as Record<string, unknown>)?.payments as Array<Record<string, unknown>>)?.[0]
      ?.payment_method as Record<string, unknown> | undefined;
    return pm?.type === "bank_transfer" && o.status !== "canceled";
  });
}

function cartoes(mp: MpVivo): Array<Record<string, unknown>> {
  return mp.orders.filter((o) => {
    const pm = ((o.transactions as Record<string, unknown>)?.payments as Array<Record<string, unknown>>)?.[0]
      ?.payment_method as Record<string, unknown> | undefined;
    return pm?.type === "credit_card" || pm?.type === "debit_card";
  });
}

Deno.test("BLINDAGEM: cartão AMBÍGUO (resposta perdida) + PIX de outra aba DURANTE o POST -> nenhum PIX vivo, nenhum QR entregue, a vaga guarda o cartão", async () => {
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const db = bancoComEstado(pedidoBase({ user_id: DONO_LOGADO, tentativas_de_pagamento: 0 }));
  let pix: { status: number; corpo: Record<string, unknown> } | null = null;
  const mp: MpVivo = mpVivo({
    perderRespostaCartao: true,
    cancelamentoFalha: true,
    aoPostarCartao: async () => {
      pix = await chamar(db, mp, PEDIDO_PIX);
    },
  });
  const cartao = await emSilencio(() => chamar(db, mp, corpoCartao()));

  assertEquals(cartoes(mp).length, 1);
  assertEquals(pixVivos(mp).length, 0, "PIX vivo ao lado de um cartão possivelmente aprovado = cobrança em dobro");
  assertEquals((pix as unknown as { corpo: Record<string, unknown> }).corpo.qrCode, undefined, "nenhum QR pode ser entregue");
  const vaga = String(db.linha.gateway_payment_id);
  assertEquals(vaga === cartoes(mp)[0].id || vaga.startsWith("verificando:"), true, `a vaga perdeu o registro do cartão: ${vaga}`);
  assertEquals(cartao.corpo.cartaoEmAnalise, true);
});

Deno.test("BLINDAGEM: cartão APROVADO + PIX de outra aba DURANTE o POST -> o PIX nunca nasce; o cartão fica gravado e responde 200", async () => {
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const db = bancoComEstado(pedidoBase({ user_id: DONO_LOGADO, tentativas_de_pagamento: 0 }));
  let pix: { status: number; corpo: Record<string, unknown> } | null = null;
  const mp: MpVivo = mpVivo({
    cancelamentoFalha: true,
    aoPostarCartao: async () => {
      pix = await chamar(db, mp, PEDIDO_PIX);
    },
  });
  const cartao = await emSilencio(() => chamar(db, mp, corpoCartao()));

  assertEquals(pixVivos(mp).length, 0);
  assertEquals((pix as unknown as { corpo: Record<string, unknown> }).corpo.qrCode, undefined);
  assertEquals(db.linha.gateway_payment_id, cartoes(mp)[0].id);
  assertEquals(cartao.status, 200);
  assertEquals(cartao.corpo.paymentId, cartoes(mp)[0].id);
});

Deno.test("BLINDAGEM: PIX de outra aba ANTES de o MP criar o cartão (POST em voo) -> PIX recebe 409 cartaoEmAnalise, nenhum PIX criado", async () => {
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const db = bancoComEstado(pedidoBase({ user_id: DONO_LOGADO, tentativas_de_pagamento: 0 }));
  let pix: { status: number; corpo: Record<string, unknown> } | null = null;
  const mp: MpVivo = mpVivo({
    cancelamentoFalha: true,
    antesDeCriarCartao: async () => {
      pix = await chamar(db, mp, PEDIDO_PIX);
    },
  });
  await emSilencio(() => chamar(db, mp, corpoCartao()));

  const respostaPix = pix as unknown as { status: number; corpo: Record<string, unknown> };
  assertEquals(mp.posts.filter((p) => p.tipo === "bank_transfer").length, 0, "o PIX não pode nem chegar ao MP");
  assertEquals(respostaPix.status, 409);
  assertEquals(respostaPix.corpo.cartaoEmAnalise, true);
  assertEquals(db.linha.gateway_payment_id, cartoes(mp)[0].id);
});

Deno.test("BLINDAGEM: falha de BANCO ao reservar a vaga -> 503 recuperável e NENHUM POST de cartão", async () => {
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const db = bancoComEstado(pedidoBase({ user_id: DONO_LOGADO, tentativas_de_pagamento: 0 }));
  const comFalha = comReservaInterceptada(db, "erro");
  const mp = mpVivo();
  const cartao = await emSilencio(() => chamar(comFalha, mp, corpoCartao()));

  assertEquals(mp.posts.length, 0, "sem reserva durável, o cartão não pode ir ao MP");
  assertEquals(cartao.status, 503);
  assertEquals(cartao.corpo.terminal, undefined);
  assertEquals(db.linha.gateway_payment_id, null);
});

Deno.test("BLINDAGEM: a vaga é ocupada por PIX de outra aba entre a leitura e a reserva -> 409 recuperável e NENHUM POST de cartão", async () => {
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const db = bancoComEstado(pedidoBase({ user_id: DONO_LOGADO, tentativas_de_pagamento: 0 }));
  const comCorrida = comReservaInterceptada(db, "ocupada");
  const mp = mpVivo();
  const cartao = await emSilencio(() => chamar(comCorrida, mp, corpoCartao()));

  assertEquals(mp.posts.length, 0);
  assertEquals(cartao.status, 409);
  assertEquals(cartao.corpo.terminal, undefined);
  assertEquals(db.linha.gateway_payment_id, "ORDTST01PIXOUTRAABA000000000");
});

Deno.test("BLINDAGEM: PIX que PERDE a corrida da vaga para o cartão de outra aba -> o PIX recém-criado é CANCELADO no MP (QR nunca entregue)", async () => {
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const db = bancoComEstado(pedidoBase({ user_id: DONO_LOGADO, tentativas_de_pagamento: 0 }));
  let cartao: { status: number; corpo: Record<string, unknown> } | null = null;
  const mp: MpVivo = mpVivo({
    aoPostarPix: async () => {
      cartao = await chamar(db, mp, corpoCartao());
    },
  });
  const pix = await emSilencio(() => chamar(db, mp, PEDIDO_PIX));

  assertEquals((cartao as unknown as { status: number }).status, 200);
  assertEquals(db.linha.gateway_payment_id, cartoes(mp)[0].id);
  assertEquals(pix.status, 409);
  assertEquals(pix.corpo.qrCode, undefined);
  assertEquals(pix.corpo.cartaoEmAnalise, true);
  assertEquals(pixVivos(mp).length, 0, "o PIX que perdeu a vaga ficou vivo no MP ao lado do cartão");
});

Deno.test("BLINDAGEM (guarda): desfechos SEM cobrança soltam a vaga — 402 recusa, 400 de dado do cartão, 400 de integração, 429 — e o PIX seguinte funciona", async () => {
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const casos: Array<{ nome: string; falha: { status: number; corpo: Record<string, unknown>; criaOrderRecusada?: boolean } }> = [
    { nome: "402", falha: { status: 402, corpo: { errors: [{ code: "failed", message: "rejected" }] }, criaOrderRecusada: true } },
    { nome: "400 dado do cartão", falha: { status: 400, corpo: { errors: [{ code: "invalid_card_token", message: "x" }] } } },
    { nome: "400 integração", falha: { status: 400, corpo: { errors: [{ code: "invalid_total_amount", message: "x" }] } } },
    { nome: "429", falha: { status: 429, corpo: { errors: [{ code: "too_many_requests", message: "x" }] } } },
  ];
  for (const caso of casos) {
    const db = bancoComEstado(pedidoBase({ user_id: DONO_LOGADO, tentativas_de_pagamento: 0 }));
    const mp = mpVivo({ falhaCartao: caso.falha });
    await emSilencio(() => chamar(db, mp, corpoCartao()));
    assertEquals(db.linha.gateway_payment_id, null, `${caso.nome}: a vaga ficou presa`);
    const pix = await emSilencio(() => chamar(db, mp, PEDIDO_PIX));
    assertEquals(pix.status, 200, `${caso.nome}: PIX seguinte não foi criado`);
    assertEquals(typeof pix.corpo.qrCode, "string", caso.nome);
  }
});

Deno.test("BLINDAGEM (guarda): cartão ambíguo -> PIX depois é bloqueado até a busca achar o cartão; achado APROVADO, converge na MESMA order (pago), sem PIX", async () => {
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const db = bancoComEstado(pedidoBase({ user_id: DONO_LOGADO, tentativas_de_pagamento: 0 }));
  const mp = mpVivo({ perderRespostaCartao: true });
  const cartao = await emSilencio(() => chamar(db, mp, corpoCartao()));
  assertEquals(cartao.status, 502);
  assertEquals(cartao.corpo.cartaoEmAnalise, true);
  assertEquals(String(db.linha.gateway_payment_id).startsWith(`verificando:${UUID}:c0:`), true);

  const pix = await emSilencio(() => chamar(db, mp, PEDIDO_PIX));
  assertEquals(mp.posts.filter((p) => p.tipo === "bank_transfer").length, 0);
  assertEquals(pix.corpo.qrCode, undefined);
  assertEquals(db.linha.gateway_payment_id, cartoes(mp)[0].id);
  assertEquals(pix.corpo.statusPagamento, "pago");
});

/**
 * Intercepta a RESERVA (o primeiro UPDATE que grava um sentinela) do banco
 * com estado: "erro" devolve erro de banco; "ocupada" faz outra aba gravar
 * um PIX na vaga um instante ANTES (o WHERE `.is(null)` da reserva perde).
 */
function comReservaInterceptada(
  db: ReturnType<typeof bancoComEstado>,
  modo: "erro" | "ocupada",
  ocupante: { id: string; metodo: string } = { id: "ORDTST01PIXOUTRAABA000000000", metodo: "pix" },
) {
  let jaInterceptou = false;
  return {
    ...db,
    from(tabela: string) {
      const original = db.from(tabela) as Record<string, unknown>;
      if (tabela !== "marketplace_orders") return original;
      return {
        ...original,
        update(valores: Record<string, unknown>) {
          const reserva = !jaInterceptou &&
            typeof valores.gateway_payment_id === "string" &&
            valores.gateway_payment_id.startsWith("verificando:");
          if (reserva && modo === "erro") {
            jaInterceptou = true;
            const encadeador: Record<string, unknown> = {
              eq: () => encadeador,
              neq: () => encadeador,
              is: () => encadeador,
              select: () => ({
                maybeSingle: async () => ({ data: null, error: { message: "statement timeout" } }),
              }),
            };
            return encadeador;
          }
          if (reserva && modo === "ocupada") {
            jaInterceptou = true;
            db.linha.gateway_payment_id = ocupante.id;
            db.linha.metodo_online = ocupante.metodo;
          }
          return (original.update as (v: Record<string, unknown>) => unknown)(valores);
        },
      };
    },
  };
}

// --- Critérios do coordenador (02/10/2026) sobre a reserva -------------------
//
// Todos com `bancoComEstado`, que respeita TODOS os filtros do WHERE (id,
// payment_status, `.neq` de status, tentativa, vaga) e falha fechado em coluna
// desconhecida — o dublê que só olhava id/vaga deixaria a reserva passar com
// o pedido já morto ou com a tentativa de outra aba.

/**
 * Roda `mudar` (a escrita de OUTRO ator) imediatamente antes da RESERVA desta
 * chamada — a janela entre a leitura do pedido e o UPDATE condicional.
 */
function comMudancaAntesDaReserva(
  db: ReturnType<typeof bancoComEstado>,
  mudar: () => void,
  // Qual gravação de sentinela intercepta: 1 = a reserva; 2 = a seguinte (a
  // reocupação da rede de segurança, por exemplo).
  qual = 1,
) {
  let jaMudou = false;
  let gravacoesDeSentinela = 0;
  return {
    ...db,
    from(tabela: string) {
      const original = db.from(tabela) as Record<string, unknown>;
      if (tabela !== "marketplace_orders") return original;
      return {
        ...original,
        update(valores: Record<string, unknown>) {
          if (
            !jaMudou && typeof valores.gateway_payment_id === "string" &&
            valores.gateway_payment_id.startsWith("verificando:") &&
            ++gravacoesDeSentinela === qual &&
            valores.gateway_payment_id.startsWith("verificando:")
          ) {
            jaMudou = true;
            mudar();
          }
          return (original.update as (v: Record<string, unknown>) => unknown)(valores);
        },
      };
    },
  };
}

for (
  const caso of [
    { nome: "cancelado", mudar: (l: Record<string, unknown>) => (l.status = "cancelled") },
    { nome: "expirado pelo relógio", mudar: (l: Record<string, unknown>) => (l.payment_status = "expirado") },
    { nome: "pago por outro caminho", mudar: (l: Record<string, unknown>) => (l.payment_status = "pago") },
  ]
) {
  Deno.test(`critério do coordenador: pedido ${caso.nome} ENTRE a leitura e a reserva -> a reserva não grava, NENHUM POST de cartão, vaga intacta`, async () => {
    Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
    const db = bancoComEstado(pedidoBase({ user_id: DONO_LOGADO, tentativas_de_pagamento: 0 }));
    const mp = mpVivo();
    const avisos: unknown[] = [];
    const comCorrida = comMudancaAntesDaReserva(db, () => caso.mudar(db.linha as Record<string, unknown>));
    const r = await emSilencio(() => chamar(comCorrida, mp, corpoCartao(), avisos));

    assertEquals(mp.posts.length, 0, "a foto velha do pedido nunca vira POST");
    assertEquals(r.status, 409, JSON.stringify(r.corpo));
    assertEquals(r.corpo.qrCode, undefined);
    assertEquals(db.linha.gateway_payment_id, null, "a reserva perdeu pelo WHERE — nada gravado");
    assertEquals(avisos.length, 0);
  });
}

Deno.test("critério do coordenador: outra aba AVANÇOU a tentativa entre a leitura e a reserva -> nenhum POST com a chave da foto velha (c0), 409 honesto e recuperável; o retry cobra com c1", async () => {
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const db = bancoComEstado(pedidoBase({ user_id: DONO_LOGADO, tentativas_de_pagamento: 0 }));
  const mp = mpVivo();
  // A outra aba teve o cartão recusado e soltou a vaga: tentativa 0 -> 1,
  // vaga livre. Só o filtro da TENTATIVA segura a reserva desta chamada.
  const comCorrida = comMudancaAntesDaReserva(db, () => {
    db.linha.tentativas_de_pagamento = 1;
  });
  const r = await emSilencio(() => chamar(comCorrida, mp, corpoCartao()));

  assertEquals(mp.posts.length, 0, "nenhum POST com a chave c0 da foto velha");
  assertEquals(r.status, 409);
  assertEquals(r.corpo.error, "O pagamento deste pedido mudou em outra aba. Tente de novo.");
  assertEquals(r.corpo.terminal, undefined);
  assertEquals(db.linha.gateway_payment_id, null);

  const r2 = await emSilencio(() => chamar(db, mp, corpoCartao({ token: OUTRO_TOKEN_CARTAO })));
  assertEquals(r2.status, 200);
  assertEquals(mp.posts.map((x) => x.chave), [`${UUID}:c1`]);
  assertEquals(db.linha.gateway_payment_id, cartoes(mp)[0].id);
});

Deno.test("critério do coordenador: PIX que perde a vaga e o MP NÃO cancela (5xx) -> o QR nunca é entregue, o cartão fica gravado e a falha fica no log", async () => {
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const db = bancoComEstado(pedidoBase({ user_id: DONO_LOGADO, tentativas_de_pagamento: 0 }));
  let cartao: { status: number; corpo: Record<string, unknown> } | null = null;
  const mp: MpVivo = mpVivo({
    cancelamentoFalha: true,
    aoPostarPix: async () => {
      cartao = await chamar(db, mp, corpoCartao());
    },
  });
  const logs: unknown[][] = [];
  const erro = console.error;
  const aviso = console.warn;
  console.error = (...a: unknown[]) => logs.push(a);
  console.warn = () => {};
  let pix: { status: number; corpo: Record<string, unknown> };
  try {
    pix = await chamar(db, mp, PEDIDO_PIX);
  } finally {
    console.error = erro;
    console.warn = aviso;
  }

  assertEquals((cartao as unknown as { status: number }).status, 200);
  assertEquals(db.linha.gateway_payment_id, cartoes(mp)[0].id);
  assertEquals(pix.status, 409);
  assertEquals(pix.corpo.qrCode, undefined, "o QR do PIX perdedor nunca sai");
  assertEquals(mp.cancelamentos.length, 1, "o cancelamento foi tentado");
  assertEquals(
    logs.some((a) => String(a[0]).includes("PIX que perdeu a vaga NÃO foi cancelado")),
    true,
    "a falha do cancelamento fica registrada",
  );
});

/**
 * Intercalação DETERMINÍSTICA de duas abas na MESMA chave (achado 1 da
 * crítica de desenho): a aba A reserva e fica SUSPENSA no POST; a aba B
 * (retry, token novo) chega com o sentinela da A na vaga. Desde o C3
 * (veredito A2, achado H1d, 02/10/2026) a B nunca faz POST sobre o
 * sentinela: responde `sem_registro`/`indisponivel` e termina. Se um POST da
 * B voltar a existir, ele fica SUSPENSO até o teste soltar (e
 * `postsDeCartao` acusa). Só então a resposta da A volta (`respostaDaA`).
 */
function duasAbasNaMesmaChave(
  db: ReturnType<typeof bancoComEstado>,
  opts: {
    respostaDaA: (criarDeVerdade: () => Promise<Response>) => Promise<Response>;
    desfechoDaB: "ok" | "ambiguo";
    base?: MpVivo;
  },
) {
  const base = opts.base ?? mpVivo();
  let liberarPostDaB: () => void = () => {};
  const postDaBLiberado = new Promise<void>((resolve) => {
    liberarPostDaB = resolve;
  });
  let avisarQueBPostou: () => void = () => {};
  const bPostou = new Promise<void>((resolve) => {
    avisarQueBPostou = resolve;
  });
  let postsDeCartao = 0;
  let abaB: Promise<{ status: number; corpo: Record<string, unknown> }> | null = null;
  const mp: MpVivo = {
    ...base,
    fn: async (url: string, init?: RequestInit): Promise<Response> => {
      const postDeCartao = init?.method === "POST" && url.endsWith("/v1/orders") &&
        !String(init?.body).includes("bank_transfer");
      if (!postDeCartao) return base.fn(url, init);
      postsDeCartao++;
      if (postsDeCartao === 1) {
        abaB = chamar(db, mp, corpoCartao({ token: OUTRO_TOKEN_CARTAO }));
        await Promise.race([bPostou, abaB.then(() => {})]);
        return await opts.respostaDaA(() => base.fn(url, init));
      }
      avisarQueBPostou();
      await postDaBLiberado;
      const resposta = await base.fn(url, init);
      if (opts.desfechoDaB === "ambiguo") throw new DOMException("abortado", "AbortError");
      return resposta;
    },
  };
  return {
    mp,
    base,
    postsDeCartao: () => postsDeCartao,
    liberarPostDaB: () => liberarPostDaB(),
    abaB: () => abaB as unknown as Promise<{ status: number; corpo: Record<string, unknown> }>,
  };
}

const respostaDefinitivaSemProva = (status: number, codigo: string) => async () =>
  new Response(JSON.stringify({ errors: [{ code: codigo, message: "x" }] }), { status });

for (
  const desfechoDaA of [
    { nome: "429", resposta: respostaDefinitivaSemProva(429, "too_many_requests") },
    { nome: "400 de integração", resposta: respostaDefinitivaSemProva(400, "invalid_total_amount") },
    { nome: "400 de dado do cartão", resposta: respostaDefinitivaSemProva(400, "invalid_card_token") },
  ]
) {
  // C3 (02/10/2026): antes a B carimbava e POSTava (e a A não podia soltar o
  // carimbo dela). Agora a B nunca chega ao MP — só a A postou, então o
  // desfecho definitivo da A prova que a chave não criou nada: ela solta a
  // PRÓPRIA reserva, e o pedido segue.
  Deno.test(`critério do coordenador (intercalado) + C3: A reserva e suspende no POST -> B (retry sobre o sentinela da A) NÃO faz POST e recebe 'sem_registro' -> A recebe ${desfechoDaA.nome} e solta a PRÓPRIA reserva; zero orders, PIX segue`, async () => {
    Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
    const db = bancoComEstado(pedidoBase({ user_id: DONO_LOGADO, tentativas_de_pagamento: 0 }));
    const cena = duasAbasNaMesmaChave(db, { respostaDaA: desfechoDaA.resposta, desfechoDaB: "ok" });
    const erro = console.error;
    const aviso = console.warn;
    console.error = () => {};
    console.warn = () => {};
    try {
      await chamar(db, cena.mp, corpoCartao());
      const rB = await cena.abaB();
      assertEquals(cena.postsDeCartao(), 1, "a B fez POST sobre o sentinela da A");
      assertEquals(rB.status, 200, JSON.stringify(rB.corpo));
      assertEquals(rB.corpo.verificacao, "sem_registro");
      assertEquals(cartoes(cena.base).length, 0, "nenhuma order foi criada");
      assertEquals(db.linha.gateway_payment_id, null, `a reserva da A ficou presa: ${db.linha.gateway_payment_id}`);
      assertEquals(db.linha.tentativas_de_pagamento, 1, "a A soltou a própria reserva pela RPC");

      const pix = await chamar(db, cena.mp, PEDIDO_PIX);
      assertEquals(pix.status, 200, JSON.stringify(pix.corpo));
      assertEquals(typeof pix.corpo.qrCode, "string");
    } finally {
      cena.liberarPostDaB();
      console.error = erro;
      console.warn = aviso;
    }
  });
}

Deno.test("critério do coordenador (intercalado) + C3: A reserva e suspende no POST -> B (retry) NÃO faz POST -> A recebe 201 com desafio 3DS -> A grava a order e entrega o desafio, sem cancelar nada e sem order nova", async () => {
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const db = bancoComEstado(pedidoBase({ user_id: DONO_LOGADO, tentativas_de_pagamento: 0 }));
  const base = mpVivo({ cartaoStatus: "action_required" });
  const cena = duasAbasNaMesmaChave(db, {
    base,
    desfechoDaB: "ok",
    respostaDaA: (criarDeVerdade) => criarDeVerdade(),
  });
  const erro = console.error;
  const aviso = console.warn;
  console.error = () => {};
  console.warn = () => {};
  try {
    const rA = await chamar(db, cena.mp, corpoCartao());
    const rB = await cena.abaB();
    assertEquals(cena.postsDeCartao(), 1, "a B fez POST sobre o sentinela da A");
    assertEquals(rB.corpo.verificacao, "sem_registro");
    assertEquals(rA.status, 200, JSON.stringify(rA.corpo));
    assertEquals(rA.corpo.desafio3ds, { url: URL_DESAFIO });
    assertEquals(cartoes(base).length, 1);
    assertEquals(rA.corpo.paymentId, cartoes(base)[0].id);
    assertEquals(db.linha.gateway_payment_id, cartoes(base)[0].id, "a A gravou a order sobre a própria reserva");
    assertEquals(base.cancelamentos.length, 0, "a order do desafio nunca é cancelada");
  } finally {
    cena.liberarPostDaB();
    console.error = erro;
    console.warn = aviso;
  }
});

Deno.test("critério do coordenador (intercalado): leitura com tentativa 0, e a RPC de OUTRA aba libera a vaga (tentativa -> 1) antes do CAS -> ZERO POST com a chave velha", async () => {
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const db = bancoComEstado(pedidoBase({ user_id: DONO_LOGADO, tentativas_de_pagamento: 0 }));
  const mp = mpVivo();
  const sentinelaDaOutraAba = `verificando:${UUID}:c0:poutraaba0001:${Date.now()}`;
  const comCorrida = comMudancaAntesDaReserva(db, () => {
    // A outra aba tinha reservado e foi recusada: a RPC real solta a vaga dela.
    db.linha.gateway_payment_id = sentinelaDaOutraAba;
  });
  let liberouAntesDoCas = false;
  const comRpcAntesDoCas = {
    ...comCorrida,
    from(tabela: string) {
      const original = comCorrida.from(tabela) as Record<string, unknown>;
      if (tabela !== "marketplace_orders") return original;
      return {
        ...original,
        update(valores: Record<string, unknown>) {
          const encadeado = (original.update as (v: Record<string, unknown>) => Record<string, unknown>)(valores);
          if (!liberouAntesDoCas && db.linha.gateway_payment_id === sentinelaDaOutraAba) {
            liberouAntesDoCas = true;
            // Chama a MESMA RPC do banco com estado (casamento exato da vaga).
            void db.rpc("liberar_cobranca_do_pedido", {
              p_order_id: UUID,
              p_gateway_payment_id: sentinelaDaOutraAba,
            });
          }
          return encadeado;
        },
      };
    },
  };
  const r = await emSilencio(() => chamar(comRpcAntesDoCas, mp, corpoCartao()));

  assertEquals(liberouAntesDoCas, true, "o cenário tem de ter rodado a RPC antes do CAS");
  assertEquals(db.linha.tentativas_de_pagamento, 1, "a RPC real avançou a tentativa");
  assertEquals(mp.posts.length, 0, "nenhum POST com a chave c0 da foto velha");
  assertEquals(r.status, 409);
  assertEquals(db.linha.gateway_payment_id, null);
});

Deno.test("blindagem 02/10 (mutante M1b) + C3: a 1ª tentativa nunca chega ao MP (sentinela, zero orders) -> o retry NÃO faz POST: 'sem_registro', sentinela e tentativa intactos, PIX bloqueado (custo H1c aceito pelo revisor)", async () => {
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const db = bancoComEstado(pedidoBase({ user_id: DONO_LOGADO, tentativas_de_pagamento: 0 }));
  const base = mpVivo({
    falhaCartao: {
      status: 402,
      corpo: { errors: [{ code: "failed", message: "rejected" }] },
      criaOrderRecusada: true,
    },
  });
  let primeiroPostDeCartao = true;
  let postsDeCartao = 0;
  const mp: MpVivo = {
    ...base,
    fn: async (url: string, init?: RequestInit): Promise<Response> => {
      const postDeCartao = init?.method === "POST" && url.endsWith("/v1/orders") &&
        !String(init?.body).includes("bank_transfer");
      if (postDeCartao) postsDeCartao++;
      if (postDeCartao && primeiroPostDeCartao) {
        primeiroPostDeCartao = false;
        throw new TypeError("error sending request: connection reset");
      }
      return base.fn(url, init);
    },
  };

  const r1 = await emSilencio(() => chamar(db, mp, corpoCartao()));
  assertEquals(r1.corpo.cartaoEmAnalise, true);
  assertEquals(base.orders.length, 0, "a 1ª chamada nunca chegou ao MP");
  const sentinelaDaReservaOriginal = db.linha.gateway_payment_id;

  const r2 = await emSilencio(() => chamar(db, mp, corpoCartao({ token: OUTRO_TOKEN_CARTAO })));
  assertEquals(postsDeCartao, 1, "o retry fez POST sobre o sentinela");
  assertEquals(r2.status, 200, JSON.stringify(r2.corpo));
  assertEquals(r2.corpo.verificacao, "sem_registro");
  assertEquals(base.orders.length, 0);
  assertEquals(db.linha.gateway_payment_id, sentinelaDaReservaOriginal);
  assertEquals(db.linha.tentativas_de_pagamento, 0);
  assertEquals(db.chamadasRpc.length, 0, "busca vazia nunca libera");

  const pix = await emSilencio(() => chamar(db, mp, PEDIDO_PIX));
  assertEquals(pix.status, 409);
  assertEquals(pix.corpo.cartaoEmAnalise, true);
  assertEquals(base.posts.filter((x) => x.tipo === "bank_transfer").length, 0);
});

// --- Revisão financeira independente (02/10/2026): achado 1 + sobreviventes --

Deno.test("revisão financeira (achado 1) + C3: o retry sobre o sentinela NÃO faz POST; a notificação de recusa solta o sentinela DEPOIS (tentativa -> 1) -> nada ressuscita a chave velha e o PIX segue", async () => {
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const db = bancoComEstado(pedidoBase({ user_id: DONO_LOGADO, tentativas_de_pagamento: 0 }));
  const base = mpVivo({
    falhaCartao: { status: 402, corpo: { errors: [{ code: "failed", message: "rejected" }] }, criaOrderRecusada: true },
  });
  let postsDeCartao = 0;
  const mp: MpVivo = {
    ...base,
    fn: async (url: string, init?: RequestInit): Promise<Response> => {
      const verbo = init?.method ?? "GET";
      // Atraso de indexação: a busca não enxerga a O1 recusada.
      if (verbo === "GET" && url.includes("/v1/orders?")) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      const postDeCartao = verbo === "POST" && url.endsWith("/v1/orders") && !String(init?.body).includes("bank_transfer");
      if (!postDeCartao) return base.fn(url, init);
      postsDeCartao++;
      await base.fn(url, init);
      // 1º POST c0: o MP cria e RECUSA a O1, mas a resposta se perde.
      throw new DOMException("abortado", "AbortError");
    },
  };
  const avisos: unknown[] = [];
  const r1 = await emSilencio(() => chamar(db, mp, corpoCartao(), avisos));
  assertEquals(r1.corpo.cartaoEmAnalise, true);
  const avisosDaPrimeira = avisos.length;
  const r2 = await emSilencio(() => chamar(db, mp, corpoCartao({ token: OUTRO_TOKEN_CARTAO }), avisos));

  assertEquals(postsDeCartao, 1, "o retry fez POST sobre o sentinela");
  assertEquals(r2.status, 200);
  assertEquals(r2.corpo.verificacao, "sem_registro");
  assertEquals(avisos.length, avisosDaPrimeira, "o retry sem POST não acorda o admin de novo — nada mudou");

  // A notificação da recusa da O1 chega: o webhook prova a morte e a RPC
  // real solta o sentinela (tentativa 0 -> 1).
  await db.rpc("liberar_cobranca_do_pedido", { p_order_id: UUID, p_gateway_payment_id: db.linha.gateway_payment_id });
  assertEquals(db.linha.tentativas_de_pagamento, 1);
  assertEquals(db.linha.gateway_payment_id, null);
  assertEquals(cartoes(base).every((o) => o.status === "failed"), true, "nenhum cartão vivo");

  // O pedido não fica preso: o PIX segue normalmente, com a chave nova.
  const pix = await emSilencio(() => chamar(db, mp, PEDIDO_PIX));
  assertEquals(pix.status, 200);
  assertEquals(typeof pix.corpo.qrCode, "string");
});

Deno.test("revisão financeira (sobrevivente M2) + C3: c0 VIVA ainda fora da busca -> o retry sobre o sentinela NÃO faz POST: sentinela intacto, tentativa intacta, PIX bloqueado", async () => {
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const db = bancoComEstado(pedidoBase({ user_id: DONO_LOGADO, tentativas_de_pagamento: 0 }));
  const base = mpVivo({ cartaoStatus: "action_required" });
  let postsDeCartao = 0;
  const mp: MpVivo = {
    ...base,
    fn: async (url: string, init?: RequestInit): Promise<Response> => {
      const verbo = init?.method ?? "GET";
      // A busca ainda não indexou a c0 (viva).
      if (verbo === "GET" && url.includes("/v1/orders?")) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      const postDeCartao = verbo === "POST" && url.endsWith("/v1/orders") &&
        !String(init?.body).includes("bank_transfer");
      if (!postDeCartao) return base.fn(url, init);
      postsDeCartao++;
      await base.fn(url, init);
      throw new DOMException("abortado", "AbortError");
    },
  };
  const r1 = await emSilencio(() => chamar(db, mp, corpoCartao()));
  assertEquals(r1.corpo.cartaoEmAnalise, true);
  const sentinela = db.linha.gateway_payment_id;
  const r2 = await emSilencio(() => chamar(db, mp, corpoCartao({ token: OUTRO_TOKEN_CARTAO })));

  assertEquals(postsDeCartao, 1, "o retry chegou a POSTar sobre o sentinela");
  assertEquals(r2.corpo.verificacao, "sem_registro");
  assertEquals(db.linha.gateway_payment_id, sentinela, "o sentinela da c0 viva foi trocado ou solto");
  assertEquals(db.linha.tentativas_de_pagamento, 0);
  assertEquals(db.chamadasRpc.length, 0);
  const pix = await emSilencio(() => chamar(db, mp, PEDIDO_PIX));
  assertEquals(pix.corpo.qrCode, undefined, "PIX ao lado de uma c0 viva = cobrança em dobro");
  assertEquals(base.posts.filter((x) => x.tipo === "bank_transfer").length, 0);
});

Deno.test("revisão financeira (sobrevivente M11) + C3: o webhook ADOTA a order enquanto o retry consulta a busca -> ZERO POST novo, e a vaga mantém o id real", async () => {
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const db = bancoComEstado(pedidoBase({ user_id: DONO_LOGADO, tentativas_de_pagamento: 0 }));
  const base = mpVivo({ cartaoStatus: "action_required", perderRespostaCartao: true });
  const r1 = await emSilencio(() => chamar(db, base, corpoCartao()));
  assertEquals(r1.corpo.cartaoEmAnalise, true);
  const idDaOrder = String(cartoes(base)[0].id);
  const postsAntes = base.posts.length;

  const mp: MpVivo = {
    ...base,
    fn: async (url: string, init?: RequestInit): Promise<Response> => {
      if ((init?.method ?? "GET") === "GET" && url.includes("/v1/orders?")) {
        // Enquanto o retry consulta a busca (ainda sem indexar), a
        // notificação da order chega e o webhook troca o sentinela pelo id.
        db.linha.gateway_payment_id = idDaOrder;
        db.linha.metodo_online = "credito";
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      return base.fn(url, init);
    },
  };
  const r2 = await emSilencio(() => chamar(db, mp, corpoCartao({ token: OUTRO_TOKEN_CARTAO })));

  assertEquals(base.posts.length, postsAntes, "POST sobre o sentinela");
  assertEquals(db.linha.gateway_payment_id, idDaOrder, "o carimbo apagou o id real adotado pelo webhook");
  assertEquals(r2.corpo.qrCode, undefined);
});

Deno.test("revisão financeira (sobrevivente M4): duas abas PIX convergem na MESMA order -> nenhum cancelamento, as duas recebem o QR da mesma cobrança", async () => {
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const db = bancoComEstado(pedidoBase({ user_id: DONO_LOGADO, tentativas_de_pagamento: 0 }));
  let abaB: { status: number; corpo: Record<string, unknown> } | null = null;
  let primeira = true;
  const mp: MpVivo = mpVivo({
    aoPostarPix: async () => {
      if (!primeira) return;
      primeira = false;
      // Enquanto o POST da aba A está no ar, a aba B pede o MESMO PIX.
      abaB = await chamar(db, mp, PEDIDO_PIX);
    },
  });
  const abaA = await emSilencio(() => chamar(db, mp, PEDIDO_PIX));
  const respostaB = abaB as unknown as { status: number; corpo: Record<string, unknown> };

  assertEquals(mp.orders.length, 1, "a mesma chave nunca vira duas orders");
  assertEquals(mp.cancelamentos.length, 0, "cancelar aqui mataria o QR já entregue na outra aba");
  // A aba B gravou primeiro e recebeu o QR. A aba A perdeu a gravação para a
  // MESMA order: 409 recuperável (contrato de sempre da corrida perdida) — e
  // o "tentar de novo" dela reconsulta e devolve o QR da mesma cobrança.
  assertEquals(respostaB.status, 200);
  assertEquals(typeof respostaB.corpo.qrCode, "string");
  assertEquals(abaA.status, 409);
  assertEquals(abaA.corpo.terminal, undefined);
  assertEquals(db.linha.gateway_payment_id, mp.orders[0].id);
  assertEquals(pixVivos(mp).length, 1);
  const abaADeNovo = await emSilencio(() => chamar(db, mp, PEDIDO_PIX));
  assertEquals(abaADeNovo.status, 200);
  assertEquals(abaADeNovo.corpo.qrCode, respostaB.corpo.qrCode, "o mesmo QR nas duas abas");
  assertEquals(mp.orders.length, 1);
  assertEquals(mp.cancelamentos.length, 0);
});

Deno.test("revisão financeira (sobrevivente M12): um PIX ocupa a vaga ENTRE a leitura e a reocupação da rede de segurança -> a reocupação perde (vaga livre exigida), o PIX nunca é sobrescrito e o admin é avisado", async () => {
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const { db, mp } = cenarioSentinelaSoltoDuranteOPost("anuladaSemRpc");
  const idPix = "ORDTST01PIXNAJANELADAREOCUPA";
  const comCorrida = comMudancaAntesDaReserva(db, () => {
    db.linha.gateway_payment_id = idPix;
    db.linha.metodo_online = "pix";
  }, 2);
  const avisos: unknown[] = [];
  const r = await emSilencio(() => chamar(comCorrida, mp, corpoCartao(), avisos));

  assertEquals(r.corpo.cartaoEmAnalise, true);
  assertEquals(db.linha.gateway_payment_id, idPix, "a reocupação sobrescreveu um PIX cujo QR já saiu");
  assertEquals(titulosDosAvisos(avisos).filter((t) => t.includes("sem registro no pedido")).length, 1);
});

// --- Frente B (02/10/2026): PIX entregue para pedido cancelado durante o POST
//
// Auditoria "estados A": o cliente (ou o admin) cancela o pedido ENQUANTO o
// POST do PIX está no ar. `update_order_status_atomic` grava só `status =
// 'cancelled'` (payment_status segue 'aguardando'), e a gravação final do PIX
// não filtrava `status` — o handler gravava o PIX e devolvia 200 com QR
// pagável de um pedido cancelado. Intercalação DETERMINÍSTICA: a escrita do
// outro ator roda dentro do POST mockado (`aoPostarPix`), depois de o MP criar
// a order e antes de a resposta voltar.

function pixComEscritaDuranteOPost(
  tentativas: number,
  escrever: (db: ReturnType<typeof bancoComEstado>) => void | Promise<void>,
  opts: { cancelamentoFalha?: boolean } = {},
) {
  const db = bancoComEstado(pedidoBase({ user_id: DONO_LOGADO, tentativas_de_pagamento: tentativas }));
  let jaEscreveu = false;
  const mp = mpVivo({
    cancelamentoFalha: opts.cancelamentoFalha,
    aoPostarPix: async () => {
      if (jaEscreveu) return;
      jaEscreveu = true;
      await escrever(db);
    },
  });
  return { db, mp };
}

for (
  const ator of [
    {
      nome: "CLIENTE",
      // RPC do cliente: só `status` (e nada de payment_status/vaga).
      cancelar: (l: Record<string, unknown>) => {
        l.status = "cancelled";
      },
    },
    {
      nome: "ADMIN",
      // RPC do admin: a MESMA escrita (`SET status, updated_at`), pelo ramo
      // `v_is_admin` — payment_status continua 'aguardando'.
      cancelar: (l: Record<string, unknown>) => {
        l.status = "cancelled";
        l.updated_at = "2026-10-02T10:05:00.000Z";
      },
    },
  ]
) {
  Deno.test(`Frente B: pedido cancelado pelo ${ator.nome} DURANTE o POST do PIX -> 409 terminal 'Este pedido foi cancelado.', QR nunca sai, o PIX criado é cancelado no MP e a vaga fica livre`, async () => {
    Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
    const { db, mp } = pixComEscritaDuranteOPost(0, (d) => ator.cancelar(d.linha));
    const r = await emSilencio(() => chamar(db, mp, PEDIDO_PIX));

    assertEquals(mp.orders.length, 1, "o POST chegou a criar a order");
    assertEquals(r.status, 409, JSON.stringify(r.corpo));
    assertEquals(r.corpo, { error: "Este pedido foi cancelado.", terminal: true });
    assertEquals(r.corpo.qrCode, undefined, "QR pagável de pedido cancelado");
    assertEquals(db.linha.status, "cancelled");
    assertEquals(db.linha.gateway_payment_id, null, "o PIX foi gravado num pedido cancelado");
    assertEquals(db.linha.metodo_online, undefined, "a forma foi carimbada num pedido cancelado");
    assertEquals(mp.cancelamentos, [mp.orders[0].id], "o PIX recém-criado tem de ser cancelado no MP");
    assertEquals(pixVivos(mp).length, 0, "PIX vivo e pagável de um pedido cancelado");
  });
}

Deno.test("Frente B: pedido cancelado DURANTE o POST e o MP NÃO cancela o PIX (5xx) -> o QR continua sem sair, 409 terminal, e a falha fica no log", async () => {
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const { db, mp } = pixComEscritaDuranteOPost(0, (d) => {
    d.linha.status = "cancelled";
  }, { cancelamentoFalha: true });
  const logs: unknown[][] = [];
  const erro = console.error;
  const aviso = console.warn;
  console.error = (...a: unknown[]) => logs.push(a);
  console.warn = () => {};
  let r: { status: number; corpo: Record<string, unknown> };
  try {
    r = await chamar(db, mp, PEDIDO_PIX);
  } finally {
    console.error = erro;
    console.warn = aviso;
  }

  assertEquals(r.status, 409, JSON.stringify(r.corpo));
  assertEquals(r.corpo, { error: "Este pedido foi cancelado.", terminal: true });
  assertEquals(r.corpo.qrCode, undefined);
  assertEquals(db.linha.gateway_payment_id, null);
  assertEquals(mp.cancelamentos, [mp.orders[0].id], "o cancelamento foi tentado");
  assertEquals(
    logs.some((a) => String(a[0]).includes("PIX que perdeu a vaga NÃO foi cancelado")),
    true,
    "a falha do cancelamento fica registrada",
  );
});

Deno.test("Frente B: a tentativa AVANÇOU durante o POST do PIX (outra aba soltou a vaga) -> não grava, QR desta chamada não sai, o PIX da chave velha é cancelado, 409 recuperável; o retry sai com a chave nova", async () => {
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const { db, mp } = pixComEscritaDuranteOPost(0, async (d) => {
    // A RPC REAL do banco com estado: recusa de cartão de outra aba contada
    // com a vaga livre (`p_gateway_payment_id: null`) -> tentativa 0 -> 1.
    await d.rpc("liberar_cobranca_do_pedido", { p_order_id: UUID, p_gateway_payment_id: null });
  });
  const r = await emSilencio(() => chamar(db, mp, PEDIDO_PIX));

  assertEquals(db.linha.tentativas_de_pagamento, 1, "o cenário tem de ter avançado a tentativa");
  assertEquals(r.status, 409, JSON.stringify(r.corpo));
  assertEquals(r.corpo.error, "O pagamento deste pedido mudou em outra aba. Tente de novo.");
  assertEquals(r.corpo.terminal, undefined, "é recuperável: o retry relê a tentativa nova");
  assertEquals(r.corpo.qrCode, undefined, "QR de uma chave que o pedido já abandonou");
  assertEquals(db.linha.gateway_payment_id, null, "a chave velha não pode ocupar a vaga da tentativa nova");
  assertEquals(mp.cancelamentos, [mp.orders[0].id], "o PIX da chave velha ficaria vivo e sem registro");

  const retry = await emSilencio(() => chamar(db, mp, PEDIDO_PIX));
  assertEquals(retry.status, 200, JSON.stringify(retry.corpo));
  assertEquals(typeof retry.corpo.qrCode, "string");
  assertEquals(mp.posts.map((p) => p.chave), [UUID, `${UUID}:1`]);
  assertEquals(db.linha.gateway_payment_id, mp.orders[1].id);
  assertEquals(retry.corpo.paymentId, mp.orders[1].id);
  assertEquals(pixVivos(mp).length, 1, "só o PIX da tentativa nova fica vivo");
});

for (const tentativas of [0, 3]) {
  Deno.test(`Frente B (controle): nada muda durante o POST do PIX (tentativa ${tentativas}) -> 200 com QR, MESMA chave de sempre, gravado, nada cancelado`, async () => {
    Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
    const { db, mp } = pixComEscritaDuranteOPost(tentativas, () => {});
    const r = await emSilencio(() => chamar(db, mp, PEDIDO_PIX));

    assertEquals(r.status, 200, JSON.stringify(r.corpo));
    assertEquals(typeof r.corpo.qrCode, "string");
    assertEquals(r.corpo.paymentId, mp.orders[0].id);
    assertEquals(mp.posts.map((p) => p.chave), [tentativas === 0 ? UUID : `${UUID}:${tentativas}`]);
    assertEquals(db.linha.gateway_payment_id, mp.orders[0].id);
    assertEquals(db.linha.metodo_online, "pix");
    assertEquals(mp.cancelamentos.length, 0);
  });
}

Deno.test("Frente B: outra aba gravou o MESMO PIX e o pedido foi cancelado durante o POST -> 409 terminal sem QR; a order registrada na vaga não é cancelada por esta chamada", async () => {
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const db = bancoComEstado(pedidoBase({ user_id: DONO_LOGADO, tentativas_de_pagamento: 0 }));
  let abaB: { status: number; corpo: Record<string, unknown> } | null = null;
  let primeira = true;
  const mp: MpVivo = mpVivo({
    aoPostarPix: async () => {
      if (!primeira) return;
      primeira = false;
      abaB = await chamar(db, mp, PEDIDO_PIX);
      db.linha.status = "cancelled";
    },
  });
  const abaA = await emSilencio(() => chamar(db, mp, PEDIDO_PIX));

  assertEquals((abaB as unknown as { status: number }).status, 200, "a aba B gravou antes do cancelamento");
  assertEquals(mp.orders.length, 1);
  assertEquals(abaA.status, 409, JSON.stringify(abaA.corpo));
  assertEquals(abaA.corpo, { error: "Este pedido foi cancelado.", terminal: true });
  assertEquals(db.linha.gateway_payment_id, mp.orders[0].id, "o registro da cobrança na vaga continua");
  assertEquals(mp.cancelamentos.length, 0, "a cobrança REGISTRADA não é desta chamada desfazer");
});

for (
  const caso of [
    {
      nome: "cancelado ANTES",
      linha: { status: "cancelled" },
      auth: DONO_LOGADO,
      esperado: { status: 409, corpo: { error: "Este pedido foi cancelado.", terminal: true } },
    },
    {
      nome: "já pago",
      linha: { payment_status: "pago" },
      auth: DONO_LOGADO,
      esperado: { status: 409, corpo: { error: "Este pedido não está aguardando pagamento.", terminal: true } },
    },
    {
      nome: "de outro dono",
      linha: {},
      auth: "9f9f9f9f-1111-2222-3333-444455556666",
      esperado: { status: 404, corpo: { error: "Pedido não encontrado.", terminal: true } },
    },
  ]
) {
  Deno.test(`Frente B (inalterado): PIX de pedido ${caso.nome} -> ${caso.esperado.status} sem nenhum POST, vaga intacta`, async () => {
    Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
    const db = bancoComEstado(pedidoBase({ user_id: DONO_LOGADO, tentativas_de_pagamento: 0, ...caso.linha }));
    const mp = mpVivo();
    const r = await emSilencio(() =>
      handler(requisicao(PEDIDO_PIX, montarToken(caso.auth)), { supabase: db as never, fetchImpl: mp.fn as typeof fetch })
    );

    assertEquals(r.status, caso.esperado.status);
    assertEquals(await r.json(), caso.esperado.corpo);
    assertEquals(mp.posts.length, 0);
    assertEquals(mp.cancelamentos.length, 0);
    assertEquals(db.linha.gateway_payment_id, null);
  });
}

// A3.2 (auditoria "estados B", 02/10/2026): o cartão reserva o sentinela c0,
// o MP responde 201 `processing`, e ANTES da gravação final a notificação de
// recusa solta o sentinela pela RPC (vaga NULL, tentativa 0 -> 1). A gravação
// final `.eq(sentinela)` não acha linha e a releitura vê a vaga livre — a
// adoção não pode gravar ali a order de uma tentativa que o pedido já
// abandonou. O 201 desta chamada é a FOTO do instante da criação; o que vale
// depois é o GET da order.
const ID_CARTAO_DO_POST = "ORDTST02CARTAODOPOSTA32000000";

function cartaoComEscritaDuranteOPost(
  durante: (db: ReturnType<typeof bancoComEstado>, order: Record<string, unknown>) => void | Promise<void>,
  opts: {
    criadaComo?: [string, string];
    consultaFalha?: boolean;
    // Escrita no banco no instante do GET da order (entre o GET e o CAS).
    aoConsultar?: (db: ReturnType<typeof bancoComEstado>) => void;
  } = {},
) {
  const db = bancoComEstado(pedidoBase({ user_id: DONO_LOGADO, tentativas_de_pagamento: 0 }));
  const base = mpVivo();
  const consultas: string[] = [];
  let primeiroCartao = true;
  const fn = async (url: string, init?: RequestInit): Promise<Response> => {
    const verbo = init?.method ?? "GET";
    if (verbo === "POST" && url.endsWith("/v1/orders") && primeiroCartao) {
      const corpo = JSON.parse(String(init?.body));
      const tipo = String(
        ((corpo.transactions?.payments?.[0]?.payment_method ?? {}) as Record<string, unknown>).type ?? "",
      );
      if (tipo !== "bank_transfer") {
        primeiroCartao = false;
        const [status, detalhe] = opts.criadaComo ?? ["processing", "in_process"];
        const o = orderAvulsa(ID_CARTAO_DO_POST, tipo, status, detalhe);
        if (status === "action_required") {
          const pm = ((o.transactions as Record<string, unknown>).payments as Array<Record<string, unknown>>)[0]
            .payment_method as Record<string, unknown>;
          pm.transaction_security = { url: URL_DESAFIO };
        }
        base.orders.push(o);
        base.posts.push({ tipo, chave: (init?.headers as Record<string, string>)["X-Idempotency-Key"] });
        // A resposta é a foto do instante da criação; o que muda depois
        // (recusa, liberação) só aparece no GET.
        const resposta = JSON.stringify(o);
        await durante(db, o);
        return new Response(resposta, { status: 201 });
      }
    }
    if (verbo === "GET" && url.includes(`/v1/orders/${ID_CARTAO_DO_POST}`)) {
      consultas.push(ID_CARTAO_DO_POST);
      opts.aoConsultar?.(db);
      if (opts.consultaFalha) return new Response(JSON.stringify({ message: "internal_error" }), { status: 500 });
    }
    return base.fn(url, init);
  };
  return { db, mp: { ...base, fn } as MpVivo, consultas };
}

// A notificação de recusa: a order morre no MP e a RPC REAL do banco com
// estado solta o sentinela por casamento exato (vaga NULL, tentativa + 1).
const recusaSoltaPelaRpc =
  (morte: [string, string] | null) => async (db: ReturnType<typeof bancoComEstado>, o: Record<string, unknown>) => {
    if (morte) {
      o.status = morte[0];
      o.status_detail = morte[1];
    }
    await db.rpc("liberar_cobranca_do_pedido", { p_order_id: UUID, p_gateway_payment_id: db.linha.gateway_payment_id });
  };

for (
  const caso of [
    { morte: ["failed", "rejected_by_issuer"] as [string, string], motivo: "O banco emissor recusou o pagamento." },
    { morte: ["expired", "expired"] as [string, string], motivo: "Pagamento recusado. Tente outro cartão ou pague com PIX." },
    { morte: ["canceled", "canceled"] as [string, string], motivo: "Pagamento recusado. Tente outro cartão ou pague com PIX." },
  ]
) {
  Deno.test(`A3.2: a recusa (${caso.morte.join(":")}) solta o sentinela pela RPC entre o 201 'processing' e a gravação -> NÃO adota a order morta; recusa recuperável, sem 'em análise'; o PIX seguinte funciona`, async () => {
    Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
    const { db, mp, consultas } = cartaoComEscritaDuranteOPost(recusaSoltaPelaRpc(caso.morte));
    const avisos: unknown[] = [];
    const r = await emSilencio(() => chamar(db, mp, corpoCartao(), avisos));

    assertEquals(db.linha.tentativas_de_pagamento, 1, "o cenário tem de ter avançado a tentativa");
    assertEquals(db.linha.gateway_payment_id, null, "a vaga foi ocupada pela order JÁ RECUSADA");
    assertEquals(db.linha.metodo_online === "credito", false, "a forma de uma order morta foi carimbada");
    assertEquals(r.status, 200, JSON.stringify(r.corpo));
    assertEquals(r.corpo, {
      paymentId: null,
      statusPagamento: "recusado",
      motivoRecusa: caso.motivo,
      podeTentarDeNovo: true,
      expiraEm: "2099-01-01T00:00:00.000Z",
    });
    assertEquals(consultas.length, 1, "a verdade da order sai do GET, não da foto do 201");
    assertEquals(db.chamadasRpc.length, 1, "só a notificação mexeu na tentativa — nada por inferência");
    assertEquals(mp.posts.length, 1, "nenhum POST novo");
    assertEquals(mp.cancelamentos.length, 0);
    assertEquals(avisos.length, 0, "recusa confirmada não é caso para acordar o admin");

    const pix = await emSilencio(() => chamar(db, mp, PEDIDO_PIX));
    assertEquals(pix.status, 200, JSON.stringify(pix.corpo));
    assertEquals(typeof pix.corpo.qrCode, "string");
    assertEquals(db.linha.gateway_payment_id, pixVivos(mp)[0].id);
  });
}

// Veredito A2 (revisor financeiro, 02/10/2026, itens 8 e 8a): o GET provou
// vida — ou não provou nada, mas o 201 já provou que a order EXISTE. Nos dois
// casos o registro é recuperável: adota por CAS (vaga livre, 'aguardando',
// não cancelado, SEM o filtro de tentativa) e responde com o `paymentId`.
for (
  const caso of [
    {
      nome: "VIVA (processing:in_process)",
      criadaComo: ["processing", "in_process"] as [string, string],
      morte: null as [string, string] | null,
      consultaFalha: false,
      status: "aguardando",
      desafio: undefined as unknown,
    },
    {
      nome: "VIVA no desafio 3DS (action_required:pending_challenge)",
      criadaComo: ["action_required", "pending_challenge"] as [string, string],
      morte: null as [string, string] | null,
      consultaFalha: false,
      status: "aguardando",
      desafio: { url: URL_DESAFIO } as unknown,
    },
    {
      nome: "já CAPTURADA (processed:accredited)",
      criadaComo: ["processing", "in_process"] as [string, string],
      morte: ["processed", "accredited"] as [string, string] | null,
      consultaFalha: false,
      status: "pago",
      desafio: undefined as unknown,
    },
    {
      nome: "GET que FALHA (500) — 8a",
      criadaComo: ["processing", "in_process"] as [string, string],
      morte: ["failed", "rejected_by_issuer"] as [string, string] | null,
      consultaFalha: true,
      status: "aguardando",
      desafio: undefined as unknown,
    },
    {
      nome: "par que o servidor não conhece — 8a",
      criadaComo: ["processing", "in_process"] as [string, string],
      morte: ["processing", "detalhe_novo_desconhecido"] as [string, string] | null,
      consultaFalha: false,
      status: "aguardando",
      desafio: undefined as unknown,
    },
  ]
) {
  Deno.test(`A3.2 (veredito A2): tentativa avançou e o GET dá ${caso.nome} -> ADOTA na vaga livre (sem o filtro de tentativa) e responde 200 com o paymentId; nada cancelado, sem alerta`, async () => {
    Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
    const { db, mp, consultas } = cartaoComEscritaDuranteOPost(recusaSoltaPelaRpc(caso.morte), {
      criadaComo: caso.criadaComo,
      consultaFalha: caso.consultaFalha,
    });
    const avisos: unknown[] = [];
    const r = await emSilencio(() => chamar(db, mp, corpoCartao(), avisos));

    assertEquals(db.linha.tentativas_de_pagamento, 1, "o cenário tem de ter avançado a tentativa");
    assertEquals(r.status, 200, JSON.stringify(r.corpo));
    assertEquals(r.corpo, {
      paymentId: ID_CARTAO_DO_POST,
      statusPagamento: caso.status,
      expiraEm: "2099-01-01T00:00:00.000Z",
      ...(caso.desafio ? { desafio3ds: caso.desafio } : {}),
    });
    assertEquals(db.linha.gateway_payment_id, ID_CARTAO_DO_POST, "a cobrança viva ficou sem registro no pedido");
    assertEquals(db.linha.metodo_online, "credito");
    assertEquals(db.linha.parcelas, 3);
    assertEquals(consultas.length, 1);
    assertEquals(avisos.length, 0, "com registro, quem fecha é o webhook — não o admin");
    assertEquals(mp.cancelamentos.length, 0);
    assertEquals(mp.posts.length, 1, "nenhum POST novo");
    assertEquals(db.chamadasRpc.length, 1, "a tentativa só andou pela notificação");
  });
}

// Veredito A2 (itens 8 e 8c): o CAS da adoção do ramo "viva" PERDE — outra
// aba ocupou a vaga, ou o pedido foi cancelado, entre o GET e o CAS.
for (
  const caso of [
    {
      nome: "um PIX de outra aba ocupa a vaga",
      escrita: (d: ReturnType<typeof bancoComEstado>) => {
        d.linha.gateway_payment_id = "ORDTST02PIXDEOUTRAABA00000000";
        d.linha.metodo_online = "pix";
      },
      vagaFinal: "ORDTST02PIXDEOUTRAABA00000000" as string | null,
    },
    {
      nome: "o pedido é CANCELADO",
      escrita: (d: ReturnType<typeof bancoComEstado>) => {
        d.linha.status = "cancelled";
      },
      vagaFinal: null as string | null,
    },
  ]
) {
  Deno.test(`A3.2 (veredito A2, 8): order VIVA em análise e ${caso.nome} entre o GET e o CAS -> não grava por cima, NÃO cancela (processing não cancela), alerta + 409 terminal 'pode ter sido cobrado'`, async () => {
    Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
    const { db, mp } = cartaoComEscritaDuranteOPost(recusaSoltaPelaRpc(null), { aoConsultar: caso.escrita });
    const avisos: unknown[] = [];
    const r = await emSilencio(() => chamar(db, mp, corpoCartao(), avisos));

    assertEquals(db.linha.gateway_payment_id, caso.vagaFinal, "o CAS gravou por cima");
    assertEquals(db.linha.metodo_online === "credito", false);
    assertEquals(r.status, 409, JSON.stringify(r.corpo));
    assertEquals(r.corpo, {
      error: "Seu cartão pode ter sido cobrado; a loja vai conferir e confirmar o pedido em breve.",
      terminal: true,
      cartaoEmAnalise: true,
    });
    assertEquals(titulosDosAvisos(avisos).filter((t) => t.includes("sem registro no pedido")).length, 1);
    assertEquals(mp.cancelamentos.length, 0, "processing não se cancela");
    assertEquals(mp.posts.length, 1);
  });

  Deno.test(`A3.2 (veredito A2, 8c): order VIVA no desafio 3DS e ${caso.nome} entre o GET e o CAS -> o desafio confirmado pelo GET é CANCELADO (ramo cancelavel); sem alerta, 409 recuperável`, async () => {
    Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
    const { db, mp } = cartaoComEscritaDuranteOPost(recusaSoltaPelaRpc(null), {
      criadaComo: ["action_required", "pending_challenge"],
      aoConsultar: caso.escrita,
    });
    const avisos: unknown[] = [];
    const r = await emSilencio(() => chamar(db, mp, corpoCartao(), avisos));

    assertEquals(db.linha.gateway_payment_id, caso.vagaFinal, "o CAS gravou por cima");
    assertEquals(mp.cancelamentos, [ID_CARTAO_DO_POST], "o desafio sem registro ficaria vivo no MP");
    assertEquals(r.status, 409, JSON.stringify(r.corpo));
    assertEquals(r.corpo, { error: "Não foi possível confirmar a cobrança." });
    assertEquals(avisos.length, 0, "cancelado no MP: nada a conferir");
    assertEquals(mp.posts.length, 1);
  });
}

Deno.test("A3.2 (veredito A2, 8c): desafio 3DS vivo, CAS perdido e o MP NÃO cancela -> alerta + 409 terminal 'pode ter sido cobrado'", async () => {
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const { db, mp: base } = cartaoComEscritaDuranteOPost(recusaSoltaPelaRpc(null), {
    criadaComo: ["action_required", "pending_challenge"],
    aoConsultar: (d) => {
      d.linha.gateway_payment_id = "ORDTST02PIXDEOUTRAABA00000000";
    },
  });
  const cancelamentos: string[] = [];
  const fn = async (url: string, init?: RequestInit): Promise<Response> => {
    if (init?.method === "POST" && url.includes("/cancel")) {
      cancelamentos.push(url);
      return new Response(JSON.stringify({ message: "internal_error" }), { status: 500 });
    }
    return base.fn(url, init);
  };
  const avisos: unknown[] = [];
  const r = await emSilencio(() => chamar(db, { ...base, fn } as MpVivo, corpoCartao(), avisos));

  assertEquals(cancelamentos.length, 1);
  assertEquals(r.status, 409, JSON.stringify(r.corpo));
  assertEquals(r.corpo, {
    error: "Seu cartão pode ter sido cobrado; a loja vai conferir e confirmar o pedido em breve.",
    terminal: true,
    cartaoEmAnalise: true,
  });
  assertEquals(titulosDosAvisos(avisos).filter((t) => t.includes("sem registro no pedido")).length, 1);
  assertEquals(db.linha.gateway_payment_id, "ORDTST02PIXDEOUTRAABA00000000");
});

// Veredito A2 (item 8b): pedido CANCELADO com a tentativa avançada — o GET
// decide; nunca adota em pedido cancelado.
for (
  const caso of [
    {
      nome: "MORTA",
      morte: ["failed", "rejected_by_issuer"] as [string, string] | null,
      consultaFalha: false,
      corpo: { error: "Este pedido foi cancelado.", terminal: true } as Record<string, unknown>,
      avisos: 0,
    },
    {
      nome: "VIVA",
      morte: null as [string, string] | null,
      consultaFalha: false,
      corpo: {
        error: "Seu cartão pode ter sido cobrado; a loja vai conferir e confirmar o pedido em breve.",
        terminal: true,
        cartaoEmAnalise: true,
      } as Record<string, unknown>,
      avisos: 1,
    },
    {
      nome: "DESCONHECIDA (GET 500)",
      morte: ["failed", "rejected_by_issuer"] as [string, string] | null,
      consultaFalha: true,
      corpo: {
        error: "Seu cartão pode ter sido cobrado; a loja vai conferir e confirmar o pedido em breve.",
        terminal: true,
        cartaoEmAnalise: true,
      } as Record<string, unknown>,
      avisos: 1,
    },
  ]
) {
  Deno.test(`A3.2 (veredito A2, 8b): pedido CANCELADO e a tentativa avançou durante o POST, order ${caso.nome} -> nunca adota; ${caso.corpo.error}`, async () => {
    Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
    const { db, mp, consultas } = cartaoComEscritaDuranteOPost(async (d, o) => {
      d.linha.status = "cancelled";
      await recusaSoltaPelaRpc(caso.morte)(d, o);
    }, { consultaFalha: caso.consultaFalha });
    const avisos: unknown[] = [];
    const r = await emSilencio(() => chamar(db, mp, corpoCartao(), avisos));

    assertEquals(db.linha.tentativas_de_pagamento, 1);
    assertEquals(db.linha.gateway_payment_id, null, "adotou num pedido cancelado");
    assertEquals(db.linha.metodo_online === "credito", false);
    assertEquals(r.status, 409, JSON.stringify(r.corpo));
    assertEquals(r.corpo, caso.corpo);
    assertEquals(consultas.length, 1);
    assertEquals(titulosDosAvisos(avisos).filter((t) => t.includes("sem registro no pedido")).length, caso.avisos);
    assertEquals(avisos.length, caso.avisos);
    assertEquals(mp.cancelamentos.length, 0);
    assertEquals(mp.posts.length, 1);
  });
}

Deno.test("A3.2 (veredito A2, mutante B1x): tentativa IGUAL, vaga anulada e o pedido CANCELADO durante o POST -> a adoção NUNCA grava num pedido cancelado; resposta terminal", async () => {
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const { db, mp } = cartaoComEscritaDuranteOPost((d) => {
    d.linha.gateway_payment_id = null;
    d.linha.status = "cancelled";
  });
  const r = await emSilencio(() => chamar(db, mp, corpoCartao()));

  assertEquals(db.linha.tentativas_de_pagamento, 0);
  assertEquals(db.linha.gateway_payment_id, null, "a adoção gravou num pedido cancelado");
  assertEquals(db.linha.metodo_online === "credito", false);
  assertEquals(r.status, 409, JSON.stringify(r.corpo));
  assertEquals(r.corpo.terminal, true);
  assertEquals(r.corpo.paymentId, undefined);
  assertEquals(mp.posts.length, 1);
});

Deno.test("A3.2 (controle): a vaga é anulada SEM a tentativa avançar entre o 201 e a gravação -> a adoção continua como hoje (200, id real na vaga, crédito), sem GET e sem aviso", async () => {
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const { db, mp, consultas } = cartaoComEscritaDuranteOPost((d) => {
    d.linha.gateway_payment_id = null;
  });
  const avisos: unknown[] = [];
  const r = await emSilencio(() => chamar(db, mp, corpoCartao(), avisos));

  assertEquals(r.status, 200, JSON.stringify(r.corpo));
  assertEquals(r.corpo.paymentId, ID_CARTAO_DO_POST);
  assertEquals(r.corpo.statusPagamento, "aguardando");
  assertEquals(db.linha.gateway_payment_id, ID_CARTAO_DO_POST);
  assertEquals(db.linha.metodo_online, "credito");
  assertEquals(db.linha.parcelas, 3);
  assertEquals(db.linha.tentativas_de_pagamento, 0);
  assertEquals(consultas.length, 0, "a adoção normal não precisa consultar o MP");
  assertEquals(avisos.length, 0);
  assertEquals(mp.cancelamentos.length, 0);
  assertEquals(db.chamadasRpc.length, 0);
});

Deno.test("A3.2 (concorrência): a releitura vê a vaga livre na MESMA tentativa, e a notificação de recusa avança a tentativa ENTRE a releitura e o CAS da adoção -> o CAS perde, nada é gravado, e a resposta é a recusa que o GET confirma", async () => {
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  let postou = false;
  const { db, mp, consultas } = cartaoComEscritaDuranteOPost((d, o) => {
    // Vaga anulada sem a RPC (a tentativa continua 0) — a releitura verá a
    // vaga livre na mesma tentativa, e a order já morreu no MP.
    d.linha.gateway_payment_id = null;
    o.status = "failed";
    o.status_detail = "rejected_by_issuer";
    postou = true;
  });
  type Leitura = { eq: (c: string, v: unknown) => { maybeSingle: () => Promise<unknown> } };
  let liberouEntreReleituraECas = false;
  const comNotificacaoNoMeio = {
    ...db,
    from(tabela: string) {
      const original = db.from(tabela) as Record<string, unknown>;
      if (tabela !== "marketplace_orders") return original;
      return {
        ...original,
        select(cols: string) {
          const leitura = (original.select as (c: string) => Leitura)(cols);
          return {
            eq(c: string, v: unknown) {
              const filtrada = leitura.eq(c, v);
              return {
                async maybeSingle() {
                  const foto = await filtrada.maybeSingle();
                  if (postou && !liberouEntreReleituraECas) {
                    liberouEntreReleituraECas = true;
                    // A RPC REAL do banco com estado: recusa contada com a
                    // vaga livre -> tentativa 0 -> 1, DEPOIS da foto lida.
                    await db.rpc("liberar_cobranca_do_pedido", { p_order_id: UUID, p_gateway_payment_id: null });
                  }
                  return foto;
                },
              };
            },
          };
        },
      };
    },
  };
  const avisos: unknown[] = [];
  const r = await emSilencio(() => chamar(comNotificacaoNoMeio, mp, corpoCartao(), avisos));

  assertEquals(liberouEntreReleituraECas, true, "o cenário tem de ter rodado a notificação depois da releitura");
  assertEquals(db.linha.tentativas_de_pagamento, 1);
  assertEquals(db.linha.gateway_payment_id, null, "o CAS da adoção gravou por cima da tentativa nova");
  assertEquals(db.linha.metodo_online === "credito", false);
  assertEquals(r.status, 200, JSON.stringify(r.corpo));
  assertEquals(r.corpo.statusPagamento, "recusado");
  assertEquals(r.corpo.podeTentarDeNovo, true);
  assertEquals(r.corpo.cartaoEmAnalise, undefined);
  assertEquals(consultas.length, 1);
  assertEquals(mp.cancelamentos.length, 0);
  assertEquals(mp.posts.length, 1);
  assertEquals(avisos.length, 0);
});

// Veredito A2 (revisor financeiro, 02/10/2026, lacunas anotadas no C1).
// C8: o pedido EXPIRA (só `payment_status`, para isolar o filtro) entre a
// leitura que decide adotar e o CAS — as duas adoções exigem 'aguardando'.
Deno.test("A3.2 (C8): a vaga é anulada na MESMA tentativa e o pedido EXPIRA entre a releitura e o CAS da adoção -> não adota", async () => {
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  let postou = false;
  const { db, mp } = cartaoComEscritaDuranteOPost((d) => {
    d.linha.gateway_payment_id = null;
    postou = true;
  });
  type Leitura = { eq: (c: string, v: unknown) => { maybeSingle: () => Promise<unknown> } };
  let expirouEntreReleituraECas = false;
  const comExpiracaoNoMeio = {
    ...db,
    from(tabela: string) {
      const original = db.from(tabela) as Record<string, unknown>;
      if (tabela !== "marketplace_orders") return original;
      return {
        ...original,
        select(cols: string) {
          const leitura = (original.select as (c: string) => Leitura)(cols);
          return {
            eq(c: string, v: unknown) {
              const filtrada = leitura.eq(c, v);
              return {
                async maybeSingle() {
                  const foto = await filtrada.maybeSingle();
                  if (postou && !expirouEntreReleituraECas) {
                    expirouEntreReleituraECas = true;
                    db.linha.payment_status = "expirado";
                  }
                  return foto;
                },
              };
            },
          };
        },
      };
    },
  };
  const r = await emSilencio(() => chamar(comExpiracaoNoMeio, mp, corpoCartao()));

  assertEquals(expirouEntreReleituraECas, true, "o cenário tem de ter expirado o pedido depois da releitura");
  assertEquals(db.linha.gateway_payment_id, null, "adotou num pedido que já não estava 'aguardando'");
  assertEquals(db.linha.metodo_online === "credito", false);
  assertEquals(r.corpo.paymentId, undefined, JSON.stringify(r.corpo));
  assertEquals(mp.posts.length, 1);
});

Deno.test("A3.2 (C8): a tentativa avançou, o GET diz VIVA e o pedido EXPIRA entre o GET e o CAS da adoção verificada -> não adota; alerta + 409 terminal", async () => {
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const { db, mp } = cartaoComEscritaDuranteOPost(recusaSoltaPelaRpc(null), {
    aoConsultar: (d) => {
      d.linha.payment_status = "expirado";
    },
  });
  const avisos: unknown[] = [];
  const r = await emSilencio(() => chamar(db, mp, corpoCartao(), avisos));

  assertEquals(db.linha.gateway_payment_id, null, "adotou num pedido que já não estava 'aguardando'");
  assertEquals(db.linha.metodo_online === "credito", false);
  assertEquals(r.status, 409, JSON.stringify(r.corpo));
  assertEquals(r.corpo.terminal, true);
  assertEquals(r.corpo.paymentId, undefined);
  assertEquals(titulosDosAvisos(avisos).filter((t) => t.includes("sem registro no pedido")).length, 1);
  assertEquals(mp.posts.length, 1);
});

// C9: o 201 é a foto de antes; o desafio que vale é o que o GET mostra agora.
Deno.test("A3.2 (C9): o 201 vem SEM desafio (processing) e o GET traz pending_challenge -> a adoção entrega o desafio do GET", async () => {
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const { db, mp } = cartaoComEscritaDuranteOPost(async (d, o) => {
    o.status = "action_required";
    o.status_detail = "pending_challenge";
    const pm = ((o.transactions as Record<string, unknown>).payments as Array<Record<string, unknown>>)[0]
      .payment_method as Record<string, unknown>;
    pm.transaction_security = { url: URL_DESAFIO };
    await d.rpc("liberar_cobranca_do_pedido", { p_order_id: UUID, p_gateway_payment_id: d.linha.gateway_payment_id });
  });
  const r = await emSilencio(() => chamar(db, mp, corpoCartao()));

  assertEquals(r.status, 200, JSON.stringify(r.corpo));
  assertEquals(r.corpo.paymentId, ID_CARTAO_DO_POST);
  assertEquals(r.corpo.statusPagamento, "aguardando");
  assertEquals(r.corpo.desafio3ds, { url: URL_DESAFIO }, "o desafio que o banco pede agora não chegou ao cliente");
  assertEquals(db.linha.gateway_payment_id, ID_CARTAO_DO_POST);
});

// ═══ C3 (veredito A2, item 1 — achado H1d, 02/10/2026): ZERO POST sobre o
// sentinela. O re-POST "carimbado" do 311f69b7 contava com o MP reter a chave
// (corpo diferente -> 409); a doc online não promete janela nenhuma. Se o MP
// esqueceu a chave, o token novo virava uma SEGUNDA cobrança válida (duas
// capturas). Agora: busca da chave -> adota por CAS o que achar; solta só por
// PROVA de morte; sem desfecho, responde o contrato `verificacao` do desenho
// A1 (4.2) — nunca POST, nunca chave/token/tentativa nova.
const SEM_REGISTRO_DO_PEDIDO_BASE = {
  verificacao: "sem_registro",
  paymentId: null,
  expiraEm: "2099-01-01T00:00:00.000Z",
  // `expires_at + 24 h` — a janela da 20261186 (o pedido com cartão em
  // verificação só é cancelado pelo relógio depois dela).
  canceladoAutomaticamenteAte: "2099-01-02T00:00:00.000Z",
};

function sentinelaSemOrderNoMp(opts: { buscaFalha?: boolean } = {}) {
  const db = bancoComEstado(pedidoBase({ user_id: DONO_LOGADO, tentativas_de_pagamento: 0 }));
  // A 1ª chamada morre em 5xx SEM criar order: o sentinela fica, e o MP não
  // tem nada com esta chave.
  const base = mpVivo({ falhaCartao: { status: 500, corpo: { message: "internal_error" } } });
  const buscas: string[] = [];
  const fn = async (url: string, init?: RequestInit): Promise<Response> => {
    if ((init?.method ?? "GET") === "GET" && url.includes("/v1/orders?")) {
      buscas.push(url);
      if (opts.buscaFalha) return new Response(JSON.stringify({ message: "internal_error" }), { status: 500 });
    }
    return base.fn(url, init);
  };
  return { db, mp: { ...base, fn } as MpVivo, buscas };
}

Deno.test("C3: cartão sobre o sentinela com a busca OK e VAZIA -> ZERO POST, sentinela/tentativa intactos, nenhuma RPC; responde 'sem_registro' (sem prometer análise); PIX bloqueado", async () => {
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const { db, mp, buscas } = sentinelaSemOrderNoMp();
  const r1 = await emSilencio(() => chamar(db, mp, corpoCartao()));
  assertEquals(r1.corpo.cartaoEmAnalise, true, "a 1ª chamada ambígua deixa o sentinela");
  const sentinela = String(db.linha.gateway_payment_id);
  assertEquals(sentinela.startsWith("verificando:"), true);
  const postsAntes = mp.posts.length;

  const r2 = await emSilencio(() => chamar(db, mp, corpoCartao({ token: OUTRO_TOKEN_CARTAO })));
  assertEquals(mp.posts.length, postsAntes, "POST de cartão sobre o sentinela (o re-POST carimbado voltou)");
  assertEquals(buscas.length, 1, "a busca da chave continua sendo feita");
  assertEquals(r2.status, 200, JSON.stringify(r2.corpo));
  assertEquals(r2.corpo, SEM_REGISTRO_DO_PEDIDO_BASE);
  assertEquals(db.linha.gateway_payment_id, sentinela, "o sentinela foi trocado (busca vazia nunca solta nem recarimba)");
  assertEquals(db.linha.tentativas_de_pagamento, 0);
  assertEquals(db.chamadasRpc.length, 0, "busca vazia nunca libera");

  const pix = await emSilencio(() => chamar(db, mp, PEDIDO_PIX));
  assertEquals(pix.status, 409, JSON.stringify(pix.corpo));
  assertEquals(pix.corpo.cartaoEmAnalise, true);
  assertEquals(mp.posts.length, postsAntes, "o PIX nunca chega ao MP");
});

Deno.test("C3: cartão sobre o sentinela com a BUSCA FALHANDO -> ZERO POST, sentinela intacto; 503 'indisponivel' (contrato do desenho A1)", async () => {
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const { db, mp } = sentinelaSemOrderNoMp({ buscaFalha: true });
  await emSilencio(() => chamar(db, mp, corpoCartao()));
  const sentinela = String(db.linha.gateway_payment_id);
  const postsAntes = mp.posts.length;

  const r = await emSilencio(() => chamar(db, mp, corpoCartao({ token: OUTRO_TOKEN_CARTAO })));
  assertEquals(mp.posts.length, postsAntes, "POST de cartão sobre o sentinela");
  assertEquals(r.status, 503, JSON.stringify(r.corpo));
  assertEquals(r.corpo, { error: "Não foi possível consultar o pagamento agora.", verificacao: "indisponivel" });
  assertEquals(db.linha.gateway_payment_id, sentinela);
  assertEquals(db.linha.tentativas_de_pagamento, 0);
  assertEquals(db.chamadasRpc.length, 0);
});

Deno.test("C3 (H1d invertido): a 1ª chamada CRIOU e capturou a order A, a resposta se perdeu e a busca ainda não a indexou -> o retry de cartão NÃO cria B; quando A aparece, a próxima chamada a adota (1 order só)", async () => {
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const db = bancoComEstado(pedidoBase({ user_id: DONO_LOGADO, tentativas_de_pagamento: 0 }));
  const base = mpVivo({ perderRespostaCartao: true });
  let indexada = false;
  const fn = async (url: string, init?: RequestInit): Promise<Response> => {
    if ((init?.method ?? "GET") === "GET" && url.includes("/v1/orders?") && !indexada) {
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    }
    return base.fn(url, init);
  };
  const mp = { ...base, fn } as MpVivo;
  await emSilencio(() => chamar(db, mp, corpoCartao()));
  assertEquals(cartoes(base).length, 1, "a order A existe e está capturada");
  assertEquals(base.orders[0].status, "processed");
  const sentinela = String(db.linha.gateway_payment_id);

  const r2 = await emSilencio(() => chamar(db, mp, corpoCartao({ token: OUTRO_TOKEN_CARTAO })));
  assertEquals(base.posts.length, 1, "o retry fez POST com token novo — se o MP esqueceu a chave, são DUAS capturas");
  assertEquals(cartoes(base).length, 1);
  assertEquals(r2.corpo, SEM_REGISTRO_DO_PEDIDO_BASE);
  assertEquals(db.linha.gateway_payment_id, sentinela);

  indexada = true;
  const r3 = await emSilencio(() => chamar(db, mp, corpoCartao({ token: OUTRO_TOKEN_CARTAO })));
  assertEquals(base.posts.length, 1);
  assertEquals(cartoes(base).length, 1, "exatamente 1 order capturada");
  assertEquals(db.linha.gateway_payment_id, base.orders[0].id, "a order A foi adotada");
  assertEquals(r3.corpo.statusPagamento, "pago");
});

Deno.test("C3: sentinela de chave ANTERIOR (tentativa já avançou) e busca inconclusiva -> ZERO POST, 'sem_registro', nunca 'aguardando' sem paymentId", async () => {
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const sentinela = `verificando:${UUID}:c0:${Date.now() - 10 * 60 * 1000}`;
  const db = bancoComEstado(pedidoBase({ user_id: DONO_LOGADO, tentativas_de_pagamento: 1, gateway_payment_id: sentinela }));
  const mp = mpVivo();
  const r = await emSilencio(() => chamar(db, mp, corpoCartao()));

  assertEquals(mp.posts.length, 0);
  assertEquals(r.status, 200, JSON.stringify(r.corpo));
  assertEquals(r.corpo, SEM_REGISTRO_DO_PEDIDO_BASE);
  assertEquals(db.linha.gateway_payment_id, sentinela);
  assertEquals(db.linha.tentativas_de_pagamento, 1);
  assertEquals(db.chamadasRpc.length, 0);
});

// ═══ C2 (desenho A1 §3/§4, corrigido pelo veredito A2, 02/10/2026): modo
// `metodo: "verificar"` — consulta SEM cobrança. Só GET no MP (busca da chave
// ou order por id), CAS sentinela -> id real, e `liberar_cobranca_do_pedido`
// com o valor EXATO da vaga quando há PROVA de morte. Nunca POST, nunca
// cancelamento, nunca escrita por cima de PIX, nunca chave/tentativa mudadas
// fora da RPC. Responde sobre a vaga ATUAL (relida no fim).
const PEDIDO_VERIFICAR = { orderId: UUID, metodo: "verificar" };
const PRAZO_BASE = "2099-01-01T00:00:00.000Z";
const CANCELAMENTO_AUTOMATICO_BASE = "2099-01-02T00:00:00.000Z";
const ID_CARTAO_NA_VAGA_C2 = "ORDTST03CARTAONAVAGAC20000000";
const ID_PIX_NA_VAGA_C2 = "ORDTST03PIXNAVAGAC2000000000";

function sentinelaDeTeste(chave: string, limiteMs: number): string {
  return `verificando:${chave}:${limiteMs}`;
}

/** Banco com estado + contador de escritas (UPDATE) na tabela de pedidos. */
function bancoContandoEscritas(linha: Record<string, unknown>) {
  const db = bancoComEstado(linha);
  const escritas: Array<Record<string, unknown>> = [];
  const contado = {
    ...db,
    from(tabela: string) {
      const original = db.from(tabela) as Record<string, unknown>;
      if (tabela !== "marketplace_orders") return original;
      return {
        ...original,
        update(valores: Record<string, unknown>) {
          escritas.push(valores);
          return (original.update as (v: Record<string, unknown>) => unknown)(valores);
        },
      };
    },
  };
  return { db, contado, escritas };
}

/**
 * MP falso da consulta: GET por id e busca; QUALQUER POST (criação ou
 * cancelamento) é registrado e falha — o `verificar` nunca pode chegar lá.
 */
function mpDaConsulta(opts: {
  orders?: Array<Record<string, unknown>>;
  buscaFalha?: boolean;
  getFalha?: boolean;
  aoBuscar?: () => void | Promise<void>;
  aoConsultar?: () => void | Promise<void>;
} = {}) {
  const orders = opts.orders ?? [];
  const chamadas: string[] = [];
  const posts: string[] = [];
  const fn = async (url: string, init?: RequestInit): Promise<Response> => {
    const verbo = init?.method ?? "GET";
    chamadas.push(`${verbo} ${url}`);
    if (verbo !== "GET") {
      posts.push(url);
      throw new Error(`o verificar nunca faz ${verbo}: ${url}`);
    }
    if (url.includes("/v1/orders?")) {
      await opts.aoBuscar?.();
      if (opts.buscaFalha) return new Response(JSON.stringify({ message: "internal_error" }), { status: 500 });
      return new Response(JSON.stringify({ data: orders.filter((o) => o.external_reference === UUID) }), { status: 200 });
    }
    if (url.includes("/v1/orders/")) {
      await opts.aoConsultar?.();
      if (opts.getFalha) return new Response(JSON.stringify({ message: "internal_error" }), { status: 500 });
      const id = url.split("/v1/orders/")[1].split("?")[0];
      const alvo = orders.find((o) => o.id === id);
      return alvo
        ? new Response(JSON.stringify(alvo), { status: 200 })
        : new Response(JSON.stringify({ message: "not_found" }), { status: 404 });
    }
    throw new Error(`fetch inesperado no verificar: ${verbo} ${url}`);
  };
  return { fn, orders, chamadas, posts };
}

async function verificar(
  db: unknown,
  mp: { fn: (url: string, init?: RequestInit) => Promise<Response> },
  opts: { auth?: string; credenciaisMp?: CredenciaisMp } = {},
): Promise<{ status: number; corpo: Record<string, unknown> }> {
  const r = await emSilencio(() =>
    handler(requisicao(PEDIDO_VERIFICAR, montarToken(opts.auth ?? DONO_LOGADO)), {
      supabase: db as never,
      fetchImpl: mp.fn as typeof fetch,
      alertarAdminCartaoOrfao: async () => {},
      ...(opts.credenciaisMp ? { credenciaisMp: opts.credenciaisMp } : {}),
    })
  );
  return { status: r.status, corpo: await r.json() };
}

function cartaoC2(id: string, status: string, detalhe: string, extra: Record<string, unknown> = {}) {
  const o = orderAvulsa(id, "credit_card", status, detalhe);
  if (status === "action_required" && detalhe === "pending_challenge") {
    const pm = ((o.transactions as Record<string, unknown>).payments as Array<Record<string, unknown>>)[0]
      .payment_method as Record<string, unknown>;
    pm.transaction_security = { url: URL_DESAFIO };
  }
  return { ...o, ...extra };
}

// ── Portões: dono, conta, estado do pedido, janela de 24 h ────────────────

for (
  const caso of [
    {
      nome: "de OUTRO dono",
      linha: {},
      auth: "9f9f9f9f-1111-2222-3333-444455556666",
      esperado: { status: 404, corpo: { error: "Pedido não encontrado.", terminal: true } },
    },
    {
      nome: "de CONVIDADO (sem conta)",
      linha: { user_id: null },
      auth: DONO_LOGADO,
      esperado: {
        status: 403,
        corpo: {
          error: "Pagar pelo site exige conta. Entre ou crie uma conta para continuar.",
          code: "PAGAMENTO_ONLINE_EXIGE_CONTA",
          terminal: true,
        },
      },
    },
    {
      nome: "EXPIRADO pelo relógio (payment_status 'expirado')",
      linha: { payment_status: "expirado", status: "cancelled" },
      auth: DONO_LOGADO,
      esperado: { status: 409, corpo: { error: "Este pedido não está aguardando pagamento.", terminal: true } },
    },
    {
      nome: "CANCELADO",
      linha: { status: "cancelled" },
      auth: DONO_LOGADO,
      esperado: { status: 409, corpo: { error: "Este pedido foi cancelado.", terminal: true } },
    },
    {
      nome: "com o prazo vencido há MAIS de 24 h (fora da janela da 20261186)",
      linha: { expires_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString() },
      auth: DONO_LOGADO,
      esperado: { status: 409, corpo: { error: "O prazo para pagar este pedido acabou.", terminal: true } },
    },
  ]
) {
  Deno.test(`C2 verificar: pedido ${caso.nome} -> ${caso.esperado.status} terminal, ZERO chamada ao MP, nada gravado`, async () => {
    Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
    const sentinela = sentinelaDeTeste(`${UUID}:c0`, Date.now() - 60_000);
    const { db, contado, escritas } = bancoContandoEscritas(
      pedidoBase({ user_id: DONO_LOGADO, tentativas_de_pagamento: 0, gateway_payment_id: sentinela, ...caso.linha }),
    );
    const mp = mpDaConsulta({ orders: [cartaoC2("ORDTST03QUALQUER00000000000001", "processed", "accredited")] });
    const r = await verificar(contado, mp, { auth: caso.auth });

    assertEquals(r.status, caso.esperado.status, JSON.stringify(r.corpo));
    assertEquals(r.corpo, caso.esperado.corpo);
    assertEquals(mp.chamadas, []);
    assertEquals(escritas.length, 0);
    assertEquals(db.chamadasRpc.length, 0);
    assertEquals(db.linha.gateway_payment_id, sentinela);
  });
}

// Decisão do coordenador (revisão do C2, 02/10/2026) — MUDANÇA DE CONTRATO:
// o pedido que já CHEGA pago responde 'pago' (antes: 409 terminal "não está
// aguardando"), a mesma regra da releitura — o cliente que pagou não lê
// erro, e duas chamadas seguidas respondem a mesma coisa. Sem consultar o
// MP: a confirmação é do banco.
for (const confirmado of ["pago", "pago_apos_expirar"]) {
  for (
    const vaga of [
      { nome: "id real", valor: ID_CARTAO_NA_VAGA_C2, paymentId: ID_CARTAO_NA_VAGA_C2 },
      { nome: "sentinela", valor: sentinelaDeTeste(`${UUID}:c0`, Date.now() - 60_000), paymentId: null },
    ]
  ) {
    Deno.test(`C2 verificar: pedido que já CHEGA '${confirmado}' (${vaga.nome} na vaga) -> 'pago' com o paymentId ${vaga.paymentId === null ? "null" : "da vaga"}, ZERO chamada ao MP, nada gravado`, async () => {
      Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
      const { db, contado, escritas } = bancoContandoEscritas(
        pedidoBase({ user_id: DONO_LOGADO, tentativas_de_pagamento: 0, gateway_payment_id: vaga.valor, payment_status: confirmado }),
      );
      const mp = mpDaConsulta({ orders: [cartaoC2(ID_CARTAO_NA_VAGA_C2, "processing", "in_process")] });
      const r = await verificar(contado, mp);

      assertEquals(r.status, 200, JSON.stringify(r.corpo));
      assertEquals(r.corpo, { verificacao: "pago", paymentId: vaga.paymentId, expiraEm: PRAZO_BASE });
      assertEquals(mp.chamadas, []);
      assertEquals(escritas.length, 0);
      assertEquals(db.chamadasRpc.length, 0);
      assertEquals(db.linha.gateway_payment_id, vaga.valor);
    });
  }
}

Deno.test("C2 verificar: a loja SEM chave de assinatura do webhook (portão do PIX) não bloqueia a consulta", async () => {
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const { contado } = bancoContandoEscritas(pedidoBase({ user_id: DONO_LOGADO, tentativas_de_pagamento: 0 }));
  const r = await verificar(contado, mpDaConsulta(), {
    credenciaisMp: { origem: "lojista", token: TOKEN_LOJISTA_FALSO, segredoWebhook: null, publicKey: null },
  });
  assertEquals(r.status, 200, JSON.stringify(r.corpo));
  assertEquals(r.corpo.verificacao, "livre");
});

// ── Vaga livre e PIX ───────────────────────────────────────────────────────

Deno.test("C2 verificar: vaga LIVRE -> 'livre', sem consultar o MP, nada gravado", async () => {
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const { db, contado, escritas } = bancoContandoEscritas(pedidoBase({ user_id: DONO_LOGADO, tentativas_de_pagamento: 0 }));
  const mp = mpDaConsulta();
  const r = await verificar(contado, mp);

  assertEquals(r.status, 200);
  assertEquals(r.corpo, { verificacao: "livre", paymentId: null, expiraEm: PRAZO_BASE });
  assertEquals(mp.chamadas, []);
  assertEquals(escritas.length, 0);
  assertEquals(db.chamadasRpc.length, 0);
});

for (
  const caso of [
    { nome: "aberto (action_required)", status: "action_required", detalhe: "waiting_transfer" },
    { nome: "MORTO (expired)", status: "expired", detalhe: "expired" },
  ]
) {
  Deno.test(`C2 verificar: PIX ${caso.nome} na vaga -> 'pix' com o id, ZERO escrita e nenhuma RPC (nunca grava por cima de PIX)`, async () => {
    Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
    const { db, contado, escritas } = bancoContandoEscritas(
      pedidoBase({ user_id: DONO_LOGADO, tentativas_de_pagamento: 0, gateway_payment_id: ID_PIX_NA_VAGA_C2, metodo_online: "pix" }),
    );
    const mp = mpDaConsulta({ orders: [orderAvulsa(ID_PIX_NA_VAGA_C2, "bank_transfer", caso.status, caso.detalhe)] });
    const r = await verificar(contado, mp);

    assertEquals(r.status, 200, JSON.stringify(r.corpo));
    assertEquals(r.corpo, { verificacao: "pix", paymentId: ID_PIX_NA_VAGA_C2, expiraEm: PRAZO_BASE });
    assertEquals(escritas.length, 0, "escreveu por cima de um PIX");
    assertEquals(db.chamadasRpc.length, 0, "soltou a vaga de um PIX");
    assertEquals(db.linha.gateway_payment_id, ID_PIX_NA_VAGA_C2);
    assertEquals(mp.posts, []);
  });
}

// ── Vaga com id REAL de cartão: GET por id ────────────────────────────────

for (
  const caso of [
    { nome: "APROVADO", order: ["processed", "accredited"], esperado: { verificacao: "pago" } },
    { nome: "em ANÁLISE", order: ["processing", "in_process"], esperado: { verificacao: "em_analise" } },
    {
      nome: "3DS VIVO",
      order: ["action_required", "pending_challenge"],
      esperado: { verificacao: "desafio3ds", desafio3ds: { url: URL_DESAFIO } },
    },
    { nome: "par DESCONHECIDO", order: ["processing", "detalhe_novo"], esperado: { verificacao: "em_analise" } },
  ]
) {
  Deno.test(`C2 verificar: id real de cartão ${caso.nome} na vaga -> ${caso.esperado.verificacao}, nada a adotar (zero escrita)`, async () => {
    Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
    const { db, contado, escritas } = bancoContandoEscritas(
      pedidoBase({ user_id: DONO_LOGADO, tentativas_de_pagamento: 0, gateway_payment_id: ID_CARTAO_NA_VAGA_C2, metodo_online: "credito" }),
    );
    const mp = mpDaConsulta({ orders: [cartaoC2(ID_CARTAO_NA_VAGA_C2, caso.order[0], caso.order[1])] });
    const r = await verificar(contado, mp);

    assertEquals(r.status, 200, JSON.stringify(r.corpo));
    assertEquals(r.corpo, { ...caso.esperado, paymentId: ID_CARTAO_NA_VAGA_C2, expiraEm: PRAZO_BASE });
    assertEquals(escritas.length, 0);
    assertEquals(db.chamadasRpc.length, 0);
    assertEquals(mp.posts, []);
  });
}

Deno.test("C2 verificar: 3DS VENCIDO (canceled:expired) com id real na vaga -> morto por PROVA: libera pela RPC com o id EXATO e responde 'recusado'", async () => {
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const { db, contado } = bancoContandoEscritas(
    pedidoBase({ user_id: DONO_LOGADO, tentativas_de_pagamento: 0, gateway_payment_id: ID_CARTAO_NA_VAGA_C2, metodo_online: "credito" }),
  );
  const mp = mpDaConsulta({ orders: [cartaoC2(ID_CARTAO_NA_VAGA_C2, "canceled", "expired")] });
  const r = await verificar(contado, mp);

  assertEquals(r.status, 200, JSON.stringify(r.corpo));
  assertEquals(r.corpo, { verificacao: "recusado", paymentId: null, expiraEm: PRAZO_BASE });
  assertEquals(db.chamadasRpc, [
    { nome: "liberar_cobranca_do_pedido", args: { p_order_id: UUID, p_gateway_payment_id: ID_CARTAO_NA_VAGA_C2 } },
  ]);
  assertEquals(db.linha.gateway_payment_id, null);
  assertEquals(db.linha.tentativas_de_pagamento, 1);
  assertEquals(mp.posts, [], "nunca cancela nem cria nada");
});

Deno.test("C2 verificar: o GET da order da vaga FALHA -> 503 'indisponivel', nada gravado", async () => {
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const { db, contado, escritas } = bancoContandoEscritas(
    pedidoBase({ user_id: DONO_LOGADO, tentativas_de_pagamento: 0, gateway_payment_id: ID_CARTAO_NA_VAGA_C2, metodo_online: "credito" }),
  );
  const mp = mpDaConsulta({ getFalha: true, orders: [cartaoC2(ID_CARTAO_NA_VAGA_C2, "canceled", "expired")] });
  const r = await verificar(contado, mp);

  assertEquals(r.status, 503, JSON.stringify(r.corpo));
  assertEquals(r.corpo, { error: "Não foi possível consultar o pagamento agora.", verificacao: "indisponivel" });
  assertEquals(escritas.length, 0);
  assertEquals(db.chamadasRpc.length, 0, "GET que falhou nunca prova morte");
});

Deno.test("C2 verificar: morto por PROVA mas a RPC de liberar FALHA (2 vezes) -> 503 'indisponivel', a vaga e a tentativa ficam como estavam", async () => {
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const { db, contado, escritas } = bancoContandoEscritas(
    pedidoBase({ user_id: DONO_LOGADO, tentativas_de_pagamento: 0, gateway_payment_id: ID_CARTAO_NA_VAGA_C2, metodo_online: "credito" }),
  );
  const chamadasRpc: string[] = [];
  const rpcFalhando = {
    ...contado,
    rpc: async (nome: string) => {
      chamadasRpc.push(nome);
      return { data: null, error: { message: "deadlock" } };
    },
  };
  const mp = mpDaConsulta({ orders: [cartaoC2(ID_CARTAO_NA_VAGA_C2, "canceled", "expired")] });
  const r = await verificar(rpcFalhando, mp);

  assertEquals(r.status, 503, JSON.stringify(r.corpo));
  assertEquals(r.corpo, { error: "Não foi possível consultar o pagamento agora.", verificacao: "indisponivel" });
  assertEquals(chamadasRpc, ["liberar_cobranca_do_pedido", "liberar_cobranca_do_pedido"]);
  assertEquals(db.linha.gateway_payment_id, ID_CARTAO_NA_VAGA_C2, "nada fora da RPC zera a vaga");
  assertEquals(db.linha.tentativas_de_pagamento, 0);
  assertEquals(escritas.length, 0);
  assertEquals(mp.posts, []);
});

// Revisão do C2 (recomendação 1): o pagamento confirmado NO MEIO do
// `verificar` responde 'pago' com o id — o cliente que pagou não lê erro.
for (const confirmado of ["pago", "pago_apos_expirar"]) {
  Deno.test(`C2 verificar (corrida): a notificação CONFIRMA o pagamento ('${confirmado}') durante o GET -> 'pago' com o paymentId da vaga relida, nada gravado`, async () => {
    Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
    const { db, contado, escritas } = bancoContandoEscritas(
      pedidoBase({ user_id: DONO_LOGADO, tentativas_de_pagamento: 0, gateway_payment_id: ID_CARTAO_NA_VAGA_C2, metodo_online: "credito" }),
    );
    const mp = mpDaConsulta({
      // A order ainda em análise no GET: só a RELEITURA sabe que pagou.
      orders: [cartaoC2(ID_CARTAO_NA_VAGA_C2, "processing", "in_process")],
      aoConsultar: () => {
        db.linha.payment_status = confirmado;
      },
    });
    const r = await verificar(contado, mp);

    assertEquals(r.status, 200, JSON.stringify(r.corpo));
    assertEquals(r.corpo, { verificacao: "pago", paymentId: ID_CARTAO_NA_VAGA_C2, expiraEm: PRAZO_BASE });
    assertEquals(escritas.length, 0);
    assertEquals(db.chamadasRpc.length, 0);
    assertEquals(mp.posts, []);
  });
}

// Revisão do C2 (recomendação 2): 'pago' é o PAR `processed:accredited`, nunca
// a raiz `processed` sozinha — `partially_refunded` não é dinheiro limpo, e um
// par processed desconhecido é "par desconhecido" (em análise), não aprovação.
for (const detalhe of ["partially_refunded", "detalhe_novo_xyz"]) {
  Deno.test(`C2 verificar: id real com 'processed:${detalhe}' -> NUNCA 'pago' ('em_analise'), nada gravado`, async () => {
    Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
    const { db, contado, escritas } = bancoContandoEscritas(
      pedidoBase({ user_id: DONO_LOGADO, tentativas_de_pagamento: 0, gateway_payment_id: ID_CARTAO_NA_VAGA_C2, metodo_online: "credito" }),
    );
    const mp = mpDaConsulta({ orders: [cartaoC2(ID_CARTAO_NA_VAGA_C2, "processed", detalhe)] });
    const r = await verificar(contado, mp);

    assertEquals(r.status, 200, JSON.stringify(r.corpo));
    assertEquals(r.corpo, { verificacao: "em_analise", paymentId: ID_CARTAO_NA_VAGA_C2, expiraEm: PRAZO_BASE });
    assertEquals(escritas.length, 0);
    assertEquals(db.chamadasRpc.length, 0);
    assertEquals(mp.posts, []);
  });
}

for (
  const caso of [
    {
      nome: "o pedido é CANCELADO",
      mudar: (l: Record<string, unknown>) => {
        l.status = "cancelled";
      },
      erro: "Este pedido foi cancelado.",
    },
  ]
) {
  Deno.test(`C2 verificar (corrida): ${caso.nome} durante o GET -> a resposta é a do pedido RELIDO (409 terminal), nada gravado`, async () => {
    Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
    const { db, contado, escritas } = bancoContandoEscritas(
      pedidoBase({ user_id: DONO_LOGADO, tentativas_de_pagamento: 0, gateway_payment_id: ID_CARTAO_NA_VAGA_C2, metodo_online: "credito" }),
    );
    const mp = mpDaConsulta({
      orders: [cartaoC2(ID_CARTAO_NA_VAGA_C2, "processed", "accredited")],
      aoConsultar: () => caso.mudar(db.linha),
    });
    const r = await verificar(contado, mp);

    assertEquals(r.status, 409, JSON.stringify(r.corpo));
    assertEquals(r.corpo, { error: caso.erro, terminal: true });
    assertEquals(escritas.length, 0);
    assertEquals(db.chamadasRpc.length, 0);
    assertEquals(mp.posts, []);
  });
}

// ── Vaga com SENTINELA: a busca da chave (Ponto 1/B1) ──────────────────────

function cenarioSentinelaC2(opts: {
  tentativas?: number;
  chaveDoSentinela?: string;
  orders?: (limite: number) => Array<Record<string, unknown>>;
  expiresAt?: string;
  buscaFalha?: boolean;
  aoBuscar?: (db: ReturnType<typeof bancoComEstado>) => void | Promise<void>;
}) {
  const limite = Date.now() - 10 * 60 * 1000;
  const sentinela = sentinelaDeTeste(opts.chaveDoSentinela ?? `${UUID}:c0`, limite);
  const { db, contado, escritas } = bancoContandoEscritas(
    pedidoBase({
      user_id: DONO_LOGADO,
      tentativas_de_pagamento: opts.tentativas ?? 0,
      gateway_payment_id: sentinela,
      ...(opts.expiresAt ? { expires_at: opts.expiresAt } : {}),
    }),
  );
  const mp = mpDaConsulta({
    orders: opts.orders?.(limite) ?? [],
    buscaFalha: opts.buscaFalha,
    aoBuscar: opts.aoBuscar ? () => opts.aoBuscar!(db) : undefined,
  });
  return { db, contado, escritas, mp, sentinela, limite };
}

Deno.test("C2 verificar: sentinela + busca OK e VAZIA -> 'sem_registro' com a data do cancelamento automático; nada muda (vaga, tentativa, RPC)", async () => {
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const { db, contado, escritas, mp, sentinela } = cenarioSentinelaC2({});
  const r = await verificar(contado, mp);

  assertEquals(r.status, 200, JSON.stringify(r.corpo));
  assertEquals(r.corpo, {
    verificacao: "sem_registro",
    paymentId: null,
    expiraEm: PRAZO_BASE,
    canceladoAutomaticamenteAte: CANCELAMENTO_AUTOMATICO_BASE,
  });
  assertEquals(db.linha.gateway_payment_id, sentinela);
  assertEquals(db.linha.tentativas_de_pagamento, 0);
  assertEquals(db.chamadasRpc.length, 0, "busca vazia nunca libera");
  assertEquals(escritas.length, 0);
  assertEquals(mp.posts, []);
});

Deno.test("C2 verificar: sentinela + a BUSCA FALHA -> 503 'indisponivel', nada muda", async () => {
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const { db, contado, escritas, mp, sentinela } = cenarioSentinelaC2({ buscaFalha: true });
  const r = await verificar(contado, mp);

  assertEquals(r.status, 503, JSON.stringify(r.corpo));
  assertEquals(r.corpo.verificacao, "indisponivel");
  assertEquals(db.linha.gateway_payment_id, sentinela);
  assertEquals(escritas.length, 0);
  assertEquals(db.chamadasRpc.length, 0);
});

for (
  const caso of [
    { nome: "APROVADA", order: ["processed", "accredited"], esperado: { verificacao: "pago" } },
    { nome: "em ANÁLISE", order: ["processing", "in_process"], esperado: { verificacao: "em_analise" } },
    {
      nome: "3DS VIVO",
      order: ["action_required", "pending_challenge"],
      esperado: { verificacao: "desafio3ds", desafio3ds: { url: URL_DESAFIO } },
    },
  ]
) {
  Deno.test(`C2 verificar: sentinela + a busca acha a order ${caso.nome} -> CAS sentinela -> id real (com a forma), responde ${caso.esperado.verificacao} com o paymentId`, async () => {
    Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
    const { db, contado, escritas, mp } = cenarioSentinelaC2({
      orders: () => [cartaoC2(ID_CARTAO_NA_VAGA_C2, caso.order[0], caso.order[1])],
    });
    const r = await verificar(contado, mp);

    assertEquals(r.status, 200, JSON.stringify(r.corpo));
    assertEquals(r.corpo, { ...caso.esperado, paymentId: ID_CARTAO_NA_VAGA_C2, expiraEm: PRAZO_BASE });
    assertEquals(db.linha.gateway_payment_id, ID_CARTAO_NA_VAGA_C2);
    assertEquals(db.linha.metodo_online, "credito");
    assertEquals(escritas.length, 1, "uma única escrita: o CAS do sentinela");
    assertEquals(db.chamadasRpc.length, 0);
    assertEquals(db.linha.tentativas_de_pagamento, 0);
    assertEquals(mp.posts, []);
  });
}

Deno.test("C2 verificar: DEPOIS de expires_at (dentro das 24 h) — sentinela + 3DS vivo -> ainda adota e devolve o desafio", async () => {
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const vencido = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { db, contado, mp } = cenarioSentinelaC2({
    expiresAt: vencido,
    orders: () => [cartaoC2(ID_CARTAO_NA_VAGA_C2, "action_required", "pending_challenge")],
  });
  const r = await verificar(contado, mp);

  assertEquals(r.status, 200, JSON.stringify(r.corpo));
  assertEquals(r.corpo.verificacao, "desafio3ds");
  assertEquals(r.corpo.desafio3ds, { url: URL_DESAFIO });
  assertEquals(r.corpo.expiraEm, vencido);
  assertEquals(db.linha.gateway_payment_id, ID_CARTAO_NA_VAGA_C2);
  assertEquals(db.linha.expires_at, vencido, "a consulta nunca mexe no prazo");
  assertEquals(mp.posts, []);
});

Deno.test("C2 verificar: sentinela da chave ATUAL + só order MORTA dentro da janela -> libera pela RPC com a string EXATA do sentinela, 'recusado'", async () => {
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const { db, contado, mp, sentinela } = cenarioSentinelaC2({
    orders: (limite) => [
      { ...cartaoC2(ID_CARTAO_NA_VAGA_C2, "failed", "rejected_by_issuer"), date_created: new Date(limite + 60_000).toISOString() },
    ],
  });
  const r = await verificar(contado, mp);

  assertEquals(r.status, 200, JSON.stringify(r.corpo));
  assertEquals(r.corpo, { verificacao: "recusado", paymentId: null, expiraEm: PRAZO_BASE });
  assertEquals(db.chamadasRpc, [
    { nome: "liberar_cobranca_do_pedido", args: { p_order_id: UUID, p_gateway_payment_id: sentinela } },
  ]);
  assertEquals(db.linha.gateway_payment_id, null);
  assertEquals(db.linha.tentativas_de_pagamento, 1);
  assertEquals(mp.posts, []);
});

// Revisão do C2 (revisor financeiro, 02/10/2026, bloqueio): quando nem todas
// as orders da busca estão mortas e nenhuma é viva CONHECIDA,
// `resolverSentinela` (_shared, publicado — não se toca) devolve
// `cartao[0]`, que pode ser a MORTA. Adotá-la levava a 'recusado', e a
// próxima chamada soltava a vaga e fazia POST com chave nova enquanto a
// order de status desconhecido podia estar viva. Status não mapeado jamais
// vira recusa: a order morta devolvida assim não é adotada nem liberada.
const BUSCA_MORTA_COM_DESCONHECIDA = [
  { nome: "[c0 failed, c1 'authorized']", mortaEm: ["failed", "rejected_by_issuer"], desconhecida: ["authorized", "authorized"] },
  { nome: "[c0 canceled:expired, c1 'em_fila_xyz']", mortaEm: ["canceled", "expired"], desconhecida: ["em_fila_xyz", "qualquer"] },
];
const ID_C0_MORTA = "ORDTST03C0MORTANABUSCA000000";
const ID_C1_DESCONHECIDA = "ORDTST03C1DESCONHECIDA0000000";

function ordersMortaEDesconhecida(
  caso: (typeof BUSCA_MORTA_COM_DESCONHECIDA)[number],
  limite: number,
): Array<Record<string, unknown>> {
  return [
    { ...cartaoC2(ID_C0_MORTA, caso.mortaEm[0], caso.mortaEm[1]), date_created: new Date(limite + 60_000).toISOString() },
    {
      ...cartaoC2(ID_C1_DESCONHECIDA, caso.desconhecida[0], caso.desconhecida[1]),
      date_created: new Date(limite + 120_000).toISOString(),
    },
  ];
}

for (const caso of BUSCA_MORTA_COM_DESCONHECIDA) {
  Deno.test(`C2 verificar (revisão): busca ${caso.nome} -> NÃO adota a morta, NÃO libera, nenhum POST; 'sem_registro'`, async () => {
    Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
    const { db, contado, escritas, mp, sentinela } = cenarioSentinelaC2({
      orders: (limite) => ordersMortaEDesconhecida(caso, limite),
    });
    const r = await verificar(contado, mp);

    assertEquals(r.status, 200, JSON.stringify(r.corpo));
    assertEquals(r.corpo, {
      verificacao: "sem_registro",
      paymentId: null,
      expiraEm: PRAZO_BASE,
      canceladoAutomaticamenteAte: CANCELAMENTO_AUTOMATICO_BASE,
    });
    assertEquals(db.linha.gateway_payment_id, sentinela, "a morta foi adotada no lugar do sentinela");
    assertEquals(escritas.length, 0);
    assertEquals(db.chamadasRpc.length, 0, "status desconhecido ao lado nunca deixa liberar");
    assertEquals(db.linha.tentativas_de_pagamento, 0);
    assertEquals(mp.posts, []);
  });

  Deno.test(`C3 + revisão do C2: cartão sobre o sentinela com a busca ${caso.nome} -> a reconsulta NÃO adota a morta, ZERO POST, 'sem_registro'; PIX bloqueado`, async () => {
    Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
    const { db, contado, escritas, mp, sentinela } = cenarioSentinelaC2({
      orders: (limite) => ordersMortaEDesconhecida(caso, limite),
    });
    const r = await emSilencio(() => chamar(contado, mp as unknown as MpVivo, corpoCartao()));

    assertEquals(mp.posts, [], "POST sobre o sentinela com uma order de status desconhecido na busca");
    assertEquals(r.status, 200, JSON.stringify(r.corpo));
    assertEquals(r.corpo, SEM_REGISTRO_DO_PEDIDO_BASE);
    assertEquals(db.linha.gateway_payment_id, sentinela, "a morta foi adotada no lugar do sentinela");
    assertEquals(escritas.length, 0);
    assertEquals(db.chamadasRpc.length, 0);
    assertEquals(db.linha.tentativas_de_pagamento, 0);

    const pix = await emSilencio(() => chamar(contado, mp as unknown as MpVivo, PEDIDO_PIX));
    assertEquals(pix.status, 409, JSON.stringify(pix.corpo));
    assertEquals(pix.corpo.cartaoEmAnalise, true);
    assertEquals(mp.posts, []);
    assertEquals(db.linha.gateway_payment_id, sentinela);
  });
}

Deno.test("C2 verificar: sentinela de chave ANTERIOR + só order morta -> NUNCA libera; 'sem_registro'", async () => {
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const { db, contado, mp, sentinela } = cenarioSentinelaC2({
    tentativas: 2,
    orders: (limite) => [
      { ...cartaoC2(ID_CARTAO_NA_VAGA_C2, "failed", "rejected_by_issuer"), date_created: new Date(limite + 60_000).toISOString() },
    ],
  });
  const r = await verificar(contado, mp);

  assertEquals(r.corpo.verificacao, "sem_registro");
  assertEquals(db.chamadasRpc.length, 0);
  assertEquals(db.linha.gateway_payment_id, sentinela);
  assertEquals(db.linha.tentativas_de_pagamento, 2);
});

// ── Sentinela + busca PAGINADA: lista PARCIAL nunca decide ────────────────
//
// Condição (2) da composição C2 + paginação (02/10/2026): o `verificar` tem de
// herdar a regra de completude de `buscarOrdersDoPedido` pelo ramo
// `buscaFalhou`. O cenário perigoso: a cobrança da tentativa anterior (c0,
// APROVADA ou em ANÁLISE) só existe FORA da lista que chegou, e a lista traz
// só mortas — a atual DENTRO da janela. Lida como completa, `resolverSentinela`
// diz "liberar" e o `verificar` responde 'recusado' e solta a vaga (a próxima
// tentativa seria a segunda cobrança). O MP com paging honesto que honra o
// `page_size` pedido já é coberto pelo teste de ponta a ponta do cartão
// (acima); aqui, as três formas em que a lista que CHEGA é parcial mesmo com
// `page_size=100` pedido:
//   A) o MP IGNORA `page_size` (serve 20) e diz `paging.total = "21"`;
//   B) o MP honra `page_size`, mas há 102 orders: a c0 fica na página 2;
//   C) o MP ignora `page_size` E não manda `paging` — 20 itens sem total.

/**
 * MP falso da consulta que PAGINA como a referência oficial documenta
 * (`sort_order` desc por data de criação, `page_size` default 20, `paging` com
 * STRINGS). `ignoraPageSize` serve sempre 20; `semPaging` tira o `paging` da
 * resposta. Qualquer verbo que não seja GET é registrado e falha.
 */
function mpDaBuscaPaginada(
  todas: Array<Record<string, unknown>>,
  opts: { ignoraPageSize?: boolean; semPaging?: boolean } = {},
) {
  const chamadas: string[] = [];
  const posts: string[] = [];
  const fn = async (url: string, init?: RequestInit): Promise<Response> => {
    const verbo = init?.method ?? "GET";
    chamadas.push(`${verbo} ${url}`);
    if (verbo !== "GET") {
      posts.push(url);
      throw new Error(`o verificar nunca faz ${verbo}: ${url}`);
    }
    if (url.includes("/v1/orders?")) {
      const q = new URL(url).searchParams;
      const pagina = Number(q.get("page") ?? "1");
      const tamanho = opts.ignoraPageSize ? 20 : Number(q.get("page_size") ?? "20");
      const ref = q.get("external_reference");
      const lista = todas
        .filter((o) => ref === null || o.external_reference === ref)
        .sort((a, b) => Date.parse(String(b.date_created)) - Date.parse(String(a.date_created)));
      const inicio = (pagina - 1) * tamanho;
      const corpo: Record<string, unknown> = { data: lista.slice(inicio, inicio + tamanho) };
      if (!opts.semPaging) {
        corpo.paging = {
          total: String(lista.length),
          total_pages: String(Math.ceil(lista.length / tamanho)),
          offset: String(inicio),
          limit: String(tamanho),
        };
      }
      return new Response(JSON.stringify(corpo), { status: 200 });
    }
    if (url.includes("/v1/orders/")) {
      const id = url.split("/v1/orders/")[1].split("?")[0];
      const alvo = todas.find((o) => o.id === id);
      return alvo
        ? new Response(JSON.stringify(alvo), { status: 200 })
        : new Response(JSON.stringify({ message: "not_found" }), { status: 404 });
    }
    throw new Error(`fetch inesperado no verificar paginado: ${verbo} ${url}`);
  };
  return { fn, chamadas, posts };
}

/**
 * A c0 (tentativa anterior, `c0`) bem antes do limite do sentinela, `mortas`
 * orders mortas antigas entre ela e o limite, e a morta da tentativa ATUAL
 * dentro da janela. Em ordem desc, a c0 é sempre a ÚLTIMA.
 */
function ordensComC0Escondida(limite: number, c0: [string, string], mortas: number): Array<Record<string, unknown>> {
  return [
    { ...cartaoC2("ORDTST03C0FORADALISTA000000", c0[0], c0[1]), date_created: new Date(limite - 50 * 60_000).toISOString() },
    ...Array.from({ length: mortas }, (_, i) => ({
      ...cartaoC2(`ORDTST03MORTAANTIGA${String(i).padStart(8, "0")}`, "failed", "rejected_by_issuer"),
      date_created: new Date(limite - 40 * 60_000 + i * 20_000).toISOString(),
    })),
    { ...cartaoC2("ORDTST03ATUALMORTA000000000", "failed", "rejected_by_issuer"), date_created: new Date(limite + 60_000).toISOString() },
  ];
}

const BUSCA_PARCIAL: Array<{ nome: string; mp: (limite: number, c0: [string, string]) => ReturnType<typeof mpDaBuscaPaginada> }> = [
  {
    nome: "A (MP ignora page_size, paging.total=21)",
    mp: (limite, c0) => mpDaBuscaPaginada(ordensComC0Escondida(limite, c0, 19), { ignoraPageSize: true }),
  },
  {
    nome: "B (MP honra page_size=100, 102 orders, c0 na página 2)",
    mp: (limite, c0) => mpDaBuscaPaginada(ordensComC0Escondida(limite, c0, 100)),
  },
  {
    nome: "C (MP ignora page_size e não manda paging, 20 itens)",
    mp: (limite, c0) => mpDaBuscaPaginada(ordensComC0Escondida(limite, c0, 19), { ignoraPageSize: true, semPaging: true }),
  },
];

for (const variante of BUSCA_PARCIAL) {
  for (const c0 of [["processed", "accredited"], ["processing", "in_process"]] as Array<[string, string]>) {
    Deno.test(`C2 verificar (paginação) ${variante.nome}: c0 ${c0.join(":")} fora da lista recebida -> 503 'indisponivel', NUNCA 'recusado', zero RPC, zero POST, vaga = sentinela`, async () => {
      Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
      const { db, contado, escritas, sentinela, limite } = cenarioSentinelaC2({
        tentativas: 20,
        chaveDoSentinela: `${UUID}:c20`,
      });
      const mp = variante.mp(limite, c0);
      const r = await verificar(contado, mp);

      assertEquals(r.status, 503, JSON.stringify(r.corpo));
      assertEquals(r.corpo, { error: "Não foi possível consultar o pagamento agora.", verificacao: "indisponivel" });
      assertEquals(r.corpo.verificacao !== "recusado", true, "lista parcial virou recusa");
      assertEquals(liberacoes(db.chamadasRpc), [], "NÃO chama liberar_cobranca_do_pedido");
      assertEquals(db.chamadasRpc.length, 0);
      assertEquals(mp.posts, []);
      assertEquals(db.linha.gateway_payment_id, sentinela, "lista parcial soltou ou trocou a vaga");
      assertEquals(db.linha.tentativas_de_pagamento, 20, "a tentativa não avança");
      assertEquals(escritas.length, 0);
      assertEquals(
        mp.chamadas.filter((c) => c.includes("/v1/orders?")).length,
        1,
        "uma busca só: a página 2 nunca é pedida",
      );
    });
  }
}

// CONTROLE das variantes acima: os MESMOS 21 dados com o MP que honra o
// `page_size=100` pedido -> a lista chega COMPLETA (`paging.total` 21 <= 21) e
// a c0 viva é adotada. Prova que o 503 das variantes vem da lista parcial, e
// não do MP falso.
for (
  const caso of [
    { c0: ["processed", "accredited"] as [string, string], verificacao: "pago" },
    { c0: ["processing", "in_process"] as [string, string], verificacao: "em_analise" },
  ]
) {
  Deno.test(`C2 verificar (paginação) CONTROLE: os mesmos 21 dados com lista COMPLETA -> adota a c0 ${caso.c0.join(":")} ('${caso.verificacao}'), nunca 'recusado', zero RPC, zero POST`, async () => {
    Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
    const { db, contado, limite } = cenarioSentinelaC2({ tentativas: 20, chaveDoSentinela: `${UUID}:c20` });
    const mp = mpDaBuscaPaginada(ordensComC0Escondida(limite, caso.c0, 19));
    const r = await verificar(contado, mp);

    assertEquals(r.status, 200, JSON.stringify(r.corpo));
    assertEquals(r.corpo.verificacao, caso.verificacao);
    assertEquals(r.corpo.paymentId, "ORDTST03C0FORADALISTA000000");
    assertEquals(db.linha.gateway_payment_id, "ORDTST03C0FORADALISTA000000");
    assertEquals(db.chamadasRpc.length, 0);
    assertEquals(db.linha.tentativas_de_pagamento, 20);
    assertEquals(mp.posts, []);
  });
}

// ── Corrida: responde sobre a vaga ATUAL ──────────────────────────────────

Deno.test("C2 verificar (corrida): o webhook ADOTA a order enquanto a busca ainda não a indexou -> responde pelo id REAL da vaga atual, sem escrever", async () => {
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const viva = cartaoC2(ID_CARTAO_NA_VAGA_C2, "processing", "in_process");
  const { db, contado, escritas, mp } = cenarioSentinelaC2({
    aoBuscar: (d) => {
      d.linha.gateway_payment_id = ID_CARTAO_NA_VAGA_C2;
      d.linha.metodo_online = "credito";
    },
  });
  // A busca ainda não indexou a order (vazia), mas o GET por id a enxerga.
  const fn = async (url: string, init?: RequestInit) => {
    if ((init?.method ?? "GET") === "GET" && url.endsWith(`/v1/orders/${ID_CARTAO_NA_VAGA_C2}`)) {
      return new Response(JSON.stringify(viva), { status: 200 });
    }
    return mp.fn(url, init);
  };
  const r = await verificar(contado, { fn });

  assertEquals(r.status, 200, JSON.stringify(r.corpo));
  assertEquals(r.corpo, { verificacao: "em_analise", paymentId: ID_CARTAO_NA_VAGA_C2, expiraEm: PRAZO_BASE });
  assertEquals(escritas.length, 0);
  assertEquals(db.linha.gateway_payment_id, ID_CARTAO_NA_VAGA_C2);
});

Deno.test("C2 verificar (corrida): a RPC SOLTA o sentinela enquanto a busca roda -> responde o estado novo ('livre'), sem soltar de novo", async () => {
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const { db, contado, mp } = cenarioSentinelaC2({
    aoBuscar: async (d) => {
      await d.rpc("liberar_cobranca_do_pedido", { p_order_id: UUID, p_gateway_payment_id: d.linha.gateway_payment_id });
    },
  });
  const r = await verificar(contado, mp);

  assertEquals(r.status, 200, JSON.stringify(r.corpo));
  assertEquals(r.corpo, { verificacao: "livre", paymentId: null, expiraEm: PRAZO_BASE });
  assertEquals(db.chamadasRpc.length, 1, "só a RPC da notificação");
  assertEquals(db.linha.tentativas_de_pagamento, 1);
});

Deno.test("C2 verificar (corrida): a order do id real morre e a notificação SOLTA a vaga durante o GET -> a RPC do verificar não acha a vaga, e a resposta é a do estado novo ('recusado' pela prova)", async () => {
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const { db, contado } = bancoContandoEscritas(
    pedidoBase({ user_id: DONO_LOGADO, tentativas_de_pagamento: 0, gateway_payment_id: ID_CARTAO_NA_VAGA_C2, metodo_online: "credito" }),
  );
  const mp = mpDaConsulta({
    orders: [cartaoC2(ID_CARTAO_NA_VAGA_C2, "failed", "rejected_by_issuer")],
    aoConsultar: async () => {
      if (db.linha.gateway_payment_id !== ID_CARTAO_NA_VAGA_C2) return;
      await db.rpc("liberar_cobranca_do_pedido", { p_order_id: UUID, p_gateway_payment_id: ID_CARTAO_NA_VAGA_C2 });
    },
  });
  const r = await verificar(contado, mp);

  assertEquals(r.status, 200, JSON.stringify(r.corpo));
  assertEquals(r.corpo, { verificacao: "recusado", paymentId: null, expiraEm: PRAZO_BASE });
  assertEquals(db.linha.tentativas_de_pagamento, 1, "a tentativa avançou uma vez só");
  assertEquals(db.linha.gateway_payment_id, null);
});

// ── Repetição ──────────────────────────────────────────────────────────────

Deno.test("C2 verificar (repetição): duas chamadas seguidas com 3DS vivo -> a mesma resposta, UMA escrita só, nenhuma RPC", async () => {
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const { db, contado, escritas, mp } = cenarioSentinelaC2({
    orders: () => [cartaoC2(ID_CARTAO_NA_VAGA_C2, "action_required", "pending_challenge")],
  });
  const r1 = await verificar(contado, mp);
  const r2 = await verificar(contado, mp);

  assertEquals(r1.corpo, r2.corpo);
  assertEquals(r2.corpo.verificacao, "desafio3ds");
  assertEquals(r2.corpo.paymentId, ID_CARTAO_NA_VAGA_C2);
  assertEquals(escritas.length, 1);
  assertEquals(db.chamadasRpc.length, 0);
  assertEquals(mp.posts, []);
});

Deno.test("C2 verificar (repetição): duas chamadas seguidas com a order morta por prova -> a RPC roda UMA vez, a tentativa avança UMA vez; a 2ª responde a vaga livre", async () => {
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const { db, contado, mp } = cenarioSentinelaC2({
    orders: (limite) => [
      { ...cartaoC2(ID_CARTAO_NA_VAGA_C2, "failed", "rejected_by_issuer"), date_created: new Date(limite + 60_000).toISOString() },
    ],
  });
  const r1 = await verificar(contado, mp);
  const r2 = await verificar(contado, mp);

  assertEquals(r1.corpo.verificacao, "recusado");
  assertEquals(r2.corpo, { verificacao: "livre", paymentId: null, expiraEm: PRAZO_BASE });
  assertEquals(db.chamadasRpc.length, 1);
  assertEquals(db.linha.tentativas_de_pagamento, 1);
});

// ═══ P7 (scratch, 02/10/2026) — order ESTORNADA/CONTESTADA na busca do sentinela ═══
// Defeito (revisor Opus, SCR/revisor-opus-int-real/sonda-p7.txt; P4 em
// SCR/composicao-c2-paginacao/depois-sondas*.txt): `resolverSentinela`
// (_shared) devolve a order morta por estorno/contestação quando ela é
// `processed` (`processed:partially_refunded` — "aprovada" vence) ou quando é
// `cartao[0]` ao lado de uma de status desconhecido. Adotá-la no sentinela
// tira a vaga da irmã viva: quando a irmã aprova, o webhook não adota mais
// (`cartao_divergente`) e o pedido não se confirma sozinho.
// Regra: a order morta por estorno/contestação NUNCA é adotada quando a busca
// traz uma irmã de cartão não-morta — a resposta é a inconclusiva
// (`sem_registro`), sentinela mantido, zero RPC, zero POST.

const ID_C0_ESTORNADA_P7 = "ORDTST04C0ESTORNADAP70000000";
const ID_C1_IRMA_P7 = "ORDTST04C1IRMAP7000000000000";

type ParP7 = readonly [string, string];

const PARCIAL_P7: ParP7 = ["processed", "partially_refunded"];
const ESTORNO_TOTAL_P7: ParP7 = ["refunded", "refunded"];
const CONTESTADA_P7: ParP7 = ["charged_back", "settled"];
const VIVA_P7: ParP7 = ["processing", "in_process"];
const DESCONHECIDA_P7: ParP7 = ["authorized", "authorized"];
const APROVADA_P7: ParP7 = ["processed", "accredited"];

function buscaP7(c0: ParP7, c1: ParP7 | null, opts: { c1Primeiro?: boolean; c0ForaDaJanela?: boolean } = {}) {
  return (limite: number): Array<Record<string, unknown>> => {
    const criadaC0 = opts.c0ForaDaJanela ? limite - 30 * 60_000 : limite + 60_000;
    const a = { ...cartaoC2(ID_C0_ESTORNADA_P7, c0[0], c0[1]), date_created: new Date(criadaC0).toISOString() };
    if (c1 === null) return [a];
    const b = { ...cartaoC2(ID_C1_IRMA_P7, c1[0], c1[1]), date_created: new Date(limite + 120_000).toISOString() };
    return opts.c1Primeiro ? [b, a] : [a, b];
  };
}

const SEM_REGISTRO_P7 = {
  verificacao: "sem_registro",
  paymentId: null,
  expiraEm: PRAZO_BASE,
  canceladoAutomaticamenteAte: CANCELAMENTO_AUTOMATICO_BASE,
};

/**
 * O webhook (webhook-mercadopago/index.ts ~2031) quando a IRMÃ aprova: adota
 * só se a vaga estiver vazia ou com sentinela; senão é `cartao_divergente`.
 * Dublê fiel ao CAS de lá (mesma condição), escrevendo direto na linha.
 */
function webhookAprovaIrmaP7(db: { linha: Record<string, unknown> }): "adotou" | "ja_era" | "divergente" {
  const vaga = db.linha.gateway_payment_id;
  if (vaga === null || vaga === undefined || (typeof vaga === "string" && vagaEmVerificacao(vaga))) {
    db.linha.gateway_payment_id = ID_C1_IRMA_P7;
    db.linha.metodo_online = "credito";
    return "adotou";
  }
  return vaga === ID_C1_IRMA_P7 ? "ja_era" : "divergente";
}

const ESCRITAS_DA_ESTORNADA = (escritas: Array<Record<string, unknown>>) =>
  escritas.filter((e) => e.gateway_payment_id === ID_C0_ESTORNADA_P7).length;

// Os estados em que `resolverSentinela` devolve a ESTORNADA com uma irmã
// não-morta ao lado — o defeito.
const DEFEITO_P7: Array<{ nome: string; c0: ParP7; c1: ParP7; c1Primeiro?: boolean }> = [
  { nome: "(b) [c0 processed:partially_refunded, c1 processing:in_process]", c0: PARCIAL_P7, c1: VIVA_P7 },
  { nome: "(b) [c1 processing:in_process, c0 processed:partially_refunded] (ordem invertida)", c0: PARCIAL_P7, c1: VIVA_P7, c1Primeiro: true },
  { nome: "(c) [c0 refunded:refunded, c1 'authorized']", c0: ESTORNO_TOTAL_P7, c1: DESCONHECIDA_P7 },
  { nome: "(c) [c0 charged_back:settled, c1 'authorized']", c0: CONTESTADA_P7, c1: DESCONHECIDA_P7 },
  { nome: "(c) [c0 processed:partially_refunded, c1 'authorized']", c0: PARCIAL_P7, c1: DESCONHECIDA_P7 },
  { nome: "(c) [c0 processed:partially_refunded, c1 'em_fila_xyz:qualquer']", c0: PARCIAL_P7, c1: ["em_fila_xyz", "qualquer"] },
  { nome: "(h) [c0 processed:partially_refunded, c1 processed:accredited] (irmã PAGA)", c0: PARCIAL_P7, c1: APROVADA_P7 },
];

for (const caso of DEFEITO_P7) {
  Deno.test(`P7 verificar ${caso.nome} -> NÃO adota a estornada: 'sem_registro', sentinela mantido, 0 RPC, 0 POST`, async () => {
    Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
    const { db, contado, escritas, mp, sentinela } = cenarioSentinelaC2({
      orders: buscaP7(caso.c0, caso.c1, { c1Primeiro: caso.c1Primeiro }),
    });
    const r = await verificar(contado, mp);

    assertEquals(db.linha.gateway_payment_id, sentinela, "a estornada foi adotada no lugar do sentinela");
    assertEquals(r.status, 200, JSON.stringify(r.corpo));
    assertEquals(r.corpo, SEM_REGISTRO_P7);
    assertEquals(escritas.length, 0);
    assertEquals(db.chamadasRpc.length, 0);
    assertEquals(db.linha.tentativas_de_pagamento, 0);
    assertEquals(mp.posts, []);

    // A irmã aprova depois: o webhook ainda consegue adotá-la.
    assertEquals(webhookAprovaIrmaP7(db), "adotou");
  });
}

// (d) O caminho de COBRANÇA: o cliente reenvia o cartão (e depois pede PIX)
// no mesmo estado.
for (const caso of DEFEITO_P7) {
  Deno.test(`P7 cobrança (d) ${caso.nome}: cartão reenviado -> 0 POST, 0 RPC, sentinela mantido, 'sem_registro'; PIX -> 409 cartaoEmAnalise`, async () => {
    Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
    const { db, contado, escritas, mp, sentinela } = cenarioSentinelaC2({
      orders: buscaP7(caso.c0, caso.c1, { c1Primeiro: caso.c1Primeiro }),
    });
    const r = await emSilencio(() => chamar(contado, mp as unknown as MpVivo, corpoCartao()));

    assertEquals(mp.posts, [], "POST sobre o sentinela com a estornada na busca");
    assertEquals(db.linha.gateway_payment_id, sentinela, "a estornada foi adotada no lugar do sentinela");
    assertEquals(r.status, 200, JSON.stringify(r.corpo));
    assertEquals(r.corpo, SEM_REGISTRO_DO_PEDIDO_BASE);
    assertEquals(escritas.length, 0);
    assertEquals(db.chamadasRpc.length, 0);
    assertEquals(db.linha.tentativas_de_pagamento, 0);

    const pix = await emSilencio(() => chamar(contado, mp as unknown as MpVivo, PEDIDO_PIX));
    assertEquals(pix.status, 409, JSON.stringify(pix.corpo));
    assertEquals(pix.corpo.cartaoEmAnalise, true);
    assertEquals(mp.posts, []);
    assertEquals(db.chamadasRpc.length, 0);
    assertEquals(db.linha.gateway_payment_id, sentinela);
    assertEquals(webhookAprovaIrmaP7(db), "adotou");
  });
}

// (a)/(b) como escritos no brief, com a irmã VIVA CONHECIDA (`processing`) e
// a estornada com `status` raiz `refunded`/`charged_back`: `resolverSentinela`
// (_shared/mercadopago.ts ~1630) escolhe a VIVA, nunca a estornada — a regra
// ("nunca adotar a estornada") não dispara, e adotar a viva é o que deixa o
// webhook confirmar quando ela aprovar. Trava: nunca a estornada, nunca RPC,
// nunca POST.
for (const c0 of [ESTORNO_TOTAL_P7, CONTESTADA_P7]) {
  for (const verbo of ["verificar", "cobrança"] as const) {
    Deno.test(`P7 (a)/(b) ${verbo} [c0 ${c0.join(":")}, c1 processing:in_process] -> adota a VIVA (c1), nunca a estornada; 0 RPC, 0 POST`, async () => {
      Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
      const { db, contado, escritas, mp } = cenarioSentinelaC2({ orders: buscaP7(c0, VIVA_P7) });
      const r = verbo === "verificar"
        ? await verificar(contado, mp)
        : await emSilencio(() => chamar(contado, mp as unknown as MpVivo, corpoCartao()));

      assertEquals(ESCRITAS_DA_ESTORNADA(escritas), 0, "tentou gravar a estornada");
      assertEquals(db.linha.gateway_payment_id, ID_C1_IRMA_P7);
      assertEquals(r.status, 200, JSON.stringify(r.corpo));
      if (verbo === "verificar") {
        assertEquals(r.corpo, { verificacao: "em_analise", paymentId: ID_C1_IRMA_P7, expiraEm: PRAZO_BASE });
      } else {
        assertEquals(r.corpo.paymentId, ID_C1_IRMA_P7);
        assertEquals(r.corpo.statusPagamento, "aguardando");
      }
      assertEquals(db.chamadasRpc.length, 0);
      assertEquals(mp.posts, []);
      assertEquals(webhookAprovaIrmaP7(db), "ja_era");
    });
  }
}

// (e) CONTROLES — a estornada SOZINHA (sem irmã): o comportamento de hoje.
Deno.test("P7 controle (e): [c0 refunded:refunded] SOZINHA, dentro da janela, chave atual -> todas mortas: libera pela RPC com o sentinela EXATO, 'recusado', 0 POST", async () => {
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const { db, contado, escritas, mp, sentinela } = cenarioSentinelaC2({ orders: buscaP7(ESTORNO_TOTAL_P7, null) });
  const r = await verificar(contado, mp);

  assertEquals(r.status, 200, JSON.stringify(r.corpo));
  assertEquals(r.corpo, { verificacao: "recusado", paymentId: null, expiraEm: PRAZO_BASE });
  assertEquals(db.chamadasRpc, [
    { nome: "liberar_cobranca_do_pedido", args: { p_order_id: UUID, p_gateway_payment_id: sentinela } },
  ]);
  assertEquals(db.linha.gateway_payment_id, null);
  assertEquals(db.linha.tentativas_de_pagamento, 1);
  assertEquals(escritas.length, 0);
  assertEquals(mp.posts, []);
});

Deno.test("P7 controle (e): [c0 refunded:refunded] SOZINHA, FORA da janela -> não libera; 'sem_registro'", async () => {
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const { db, contado, escritas, mp, sentinela } = cenarioSentinelaC2({
    orders: buscaP7(ESTORNO_TOTAL_P7, null, { c0ForaDaJanela: true }),
  });
  const r = await verificar(contado, mp);

  assertEquals(r.corpo, SEM_REGISTRO_P7);
  assertEquals(db.chamadasRpc.length, 0);
  assertEquals(db.linha.gateway_payment_id, sentinela);
  assertEquals(escritas.length, 0);
  assertEquals(mp.posts, []);
});

Deno.test("P7 controle (e'): [c0 processed:partially_refunded] SOZINHA -> INALTERADO por este patch (adota; par não mapeado responde 'em_analise')", async () => {
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const { db, contado, mp } = cenarioSentinelaC2({ orders: buscaP7(PARCIAL_P7, null) });
  const r = await verificar(contado, mp);

  assertEquals(db.linha.gateway_payment_id, ID_C0_ESTORNADA_P7);
  assertEquals(r.corpo, { verificacao: "em_analise", paymentId: ID_C0_ESTORNADA_P7, expiraEm: PRAZO_BASE });
  assertEquals(db.chamadasRpc.length, 0);
  assertEquals(mp.posts, []);
});

// (f) CONTROLE — order PAGA é fato: continua adotada, com qualquer irmã.
for (const irma of [VIVA_P7, ESTORNO_TOTAL_P7, PARCIAL_P7]) {
  Deno.test(`P7 controle (f): [c0 processed:accredited, c1 ${irma.join(":")}] -> adota a PAGA, 'pago'`, async () => {
    Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
    const ID_PAGA = "ORDTST04C0PAGAP7000000000000";
    const { db, contado, escritas, mp } = cenarioSentinelaC2({
      orders: (limite) => [
        { ...cartaoC2(ID_PAGA, APROVADA_P7[0], APROVADA_P7[1]), date_created: new Date(limite + 60_000).toISOString() },
        { ...cartaoC2(ID_C1_IRMA_P7, irma[0], irma[1]), date_created: new Date(limite + 120_000).toISOString() },
      ],
    });
    const r = await verificar(contado, mp);

    assertEquals(r.status, 200, JSON.stringify(r.corpo));
    assertEquals(r.corpo, { verificacao: "pago", paymentId: ID_PAGA, expiraEm: PRAZO_BASE });
    assertEquals(db.linha.gateway_payment_id, ID_PAGA);
    assertEquals(escritas.length, 1);
    assertEquals(db.chamadasRpc.length, 0);
    assertEquals(mp.posts, []);
  });
}

// (g) CONCORRÊNCIA.
Deno.test("P7 concorrência (g): dois 'verificar' SIMULTÂNEOS no estado do defeito -> nenhum adota, nenhum libera, nenhum POST; o webhook ainda adota a irmã", async () => {
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const { db, contado, escritas, mp, sentinela } = cenarioSentinelaC2({ orders: buscaP7(PARCIAL_P7, VIVA_P7) });
  const [r1, r2] = await Promise.all([verificar(contado, mp), verificar(contado, mp)]);

  assertEquals(r1.corpo, SEM_REGISTRO_P7);
  assertEquals(r2.corpo, SEM_REGISTRO_P7);
  assertEquals(escritas.length, 0, "adoção (ou tentativa de adoção) da estornada");
  assertEquals(db.chamadasRpc.length, 0);
  assertEquals(mp.posts, []);
  assertEquals(db.linha.gateway_payment_id, sentinela);
  assertEquals(webhookAprovaIrmaP7(db), "adotou");
});

Deno.test("P7 concorrência (g): o webhook ADOTA a irmã aprovada ENTRE a busca e a decisão do 'verificar' -> nunca tenta gravar a estornada; responde pela vaga atual ('pago' da irmã)", async () => {
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const { db, contado, escritas, mp } = cenarioSentinelaC2({ orders: buscaP7(PARCIAL_P7, VIVA_P7) });
  const fn = async (url: string, init?: RequestInit) => {
    const resposta = await mp.fn(url, init);
    if ((init?.method ?? "GET") === "GET" && url.includes("/v1/orders?")) {
      // A busca já respondeu com a irmã VIVA; ela aprova e o webhook adota.
      const irma = mp.orders.find((o) => o.id === ID_C1_IRMA_P7)!;
      irma.status = APROVADA_P7[0];
      irma.status_detail = APROVADA_P7[1];
      assertEquals(webhookAprovaIrmaP7(db), "adotou");
    }
    return resposta;
  };
  const r = await verificar(contado, { fn });

  assertEquals(ESCRITAS_DA_ESTORNADA(escritas), 0, "tentou gravar a estornada");
  assertEquals(r.status, 200, JSON.stringify(r.corpo));
  assertEquals(r.corpo, { verificacao: "pago", paymentId: ID_C1_IRMA_P7, expiraEm: PRAZO_BASE });
  assertEquals(db.linha.gateway_payment_id, ID_C1_IRMA_P7);
  assertEquals(db.chamadasRpc.length, 0);
  assertEquals(mp.posts, []);
});

Deno.test("P7 concorrência (g): 'verificar' e o webhook da irmã em Promise.all -> vaga termina na irmã, sem divergência, nunca a estornada, 0 RPC, 0 POST", async () => {
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const { db, contado, escritas, mp } = cenarioSentinelaC2({ orders: buscaP7(PARCIAL_P7, VIVA_P7) });
  const webhook = async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    const irma = mp.orders.find((o) => o.id === ID_C1_IRMA_P7)!;
    irma.status = APROVADA_P7[0];
    irma.status_detail = APROVADA_P7[1];
    return webhookAprovaIrmaP7(db);
  };
  const [r, desfechoDoWebhook] = await Promise.all([verificar(contado, mp), webhook()]);

  assertEquals(desfechoDoWebhook, "adotou");
  assertEquals(ESCRITAS_DA_ESTORNADA(escritas), 0, "tentou gravar a estornada");
  assertEquals(db.linha.gateway_payment_id, ID_C1_IRMA_P7);
  assertEquals(r.corpo.verificacao !== "recusado", true);
  assertEquals(db.chamadasRpc.length, 0);
  assertEquals(mp.posts, []);
});

// ── P7: sondas do revisor Opus (R1-R3), viradas teste com asserção ─────────

// R1 — a metade `!orderMortaPorEstorno(irma)`: a estornada escolhida tem uma
// irmã TAMBÉM estornada/contestada. Irmã estornada é irmã MORTA (a régua de
// `STATUS_ORDER_MORTOS`): a regra P7 não dispara e a adoção de hoje fica.
for (const irma of [ESTORNO_TOTAL_P7, CONTESTADA_P7, PARCIAL_P7]) {
  Deno.test(`P7 R1 verificar [c0 processed:partially_refunded, c1 ${irma.join(":")}] -> irmã também estornada não conta: adota c0 (como hoje), 'em_analise'`, async () => {
    Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
    const { db, contado, mp } = cenarioSentinelaC2({ orders: buscaP7(PARCIAL_P7, irma) });
    const r = await verificar(contado, mp);

    assertEquals(db.linha.gateway_payment_id, ID_C0_ESTORNADA_P7);
    assertEquals(r.corpo, { verificacao: "em_analise", paymentId: ID_C0_ESTORNADA_P7, expiraEm: PRAZO_BASE });
    assertEquals(db.chamadasRpc.length, 0);
    assertEquals(mp.posts, []);
  });
}

// R2 — `verificar`, dois cartões reenviados e um PIX SIMULTÂNEOS no estado do
// defeito: nenhum caminho adota, libera ou cobra.
for (const caso of DEFEITO_P7) {
  Deno.test(`P7 R2 concorrência: verificar || cartão || cartão || PIX ${caso.nome} -> 0 POST, 0 RPC, 0 escrita, sentinela mantido`, async () => {
    Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
    const { db, contado, escritas, mp, sentinela } = cenarioSentinelaC2({
      orders: buscaP7(caso.c0, caso.c1, { c1Primeiro: caso.c1Primeiro }),
    });
    const [rv, rc, rc2, rp] = await Promise.all([
      verificar(contado, mp),
      emSilencio(() => chamar(contado, mp as unknown as MpVivo, corpoCartao())),
      emSilencio(() => chamar(contado, mp as unknown as MpVivo, corpoCartao())),
      emSilencio(() => chamar(contado, mp as unknown as MpVivo, PEDIDO_PIX)),
    ]);

    assertEquals(mp.posts, []);
    assertEquals(db.chamadasRpc.length, 0);
    assertEquals(escritas.length, 0);
    assertEquals(db.linha.gateway_payment_id, sentinela);
    assertEquals(db.linha.tentativas_de_pagamento, 0);
    assertEquals(rv.corpo, SEM_REGISTRO_P7);
    assertEquals(rc.corpo, SEM_REGISTRO_DO_PEDIDO_BASE);
    assertEquals(rc2.corpo, SEM_REGISTRO_DO_PEDIDO_BASE);
    assertEquals(rp.status, 409, JSON.stringify(rp.corpo));
    assertEquals(rp.corpo.cartaoEmAnalise, true);

    const r3 = await emSilencio(() => chamar(contado, mp as unknown as MpVivo, corpoCartao()));
    assertEquals(r3.corpo, SEM_REGISTRO_DO_PEDIDO_BASE);
    assertEquals(mp.posts, []);
    assertEquals(webhookAprovaIrmaP7(db), "adotou");
  });
}

// R3 — caminho de COBRANÇA x webhook: a irmã aprova e o webhook a ADOTA entre
// a busca e a decisão da cobrança. A cobrança nunca grava a estornada nem faz
// POST; a resposta desta chamada é a inconclusiva (decidida sobre o sentinela
// LIDO — não relê a vaga, só deixa de agir), e a chamada SEGUINTE já vê a
// irmã adotada e paga.
Deno.test("P7 R3 concorrência (cobrança): o webhook adota a irmã aprovada entre a busca e a decisão -> 0 POST, 0 RPC, nunca grava a estornada; a próxima chamada responde 'pago' pela irmã", async () => {
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const { db, contado, escritas, mp } = cenarioSentinelaC2({ orders: buscaP7(PARCIAL_P7, VIVA_P7) });
  const fn = async (url: string, init?: RequestInit) => {
    const resposta = await mp.fn(url, init);
    if ((init?.method ?? "GET") === "GET" && url.includes("/v1/orders?")) {
      const irma = mp.orders.find((o) => o.id === ID_C1_IRMA_P7)!;
      irma.status = APROVADA_P7[0];
      irma.status_detail = APROVADA_P7[1];
      assertEquals(webhookAprovaIrmaP7(db), "adotou");
    }
    return resposta;
  };
  const r = await emSilencio(() => chamar(contado, { ...mp, fn } as unknown as MpVivo, corpoCartao()));

  assertEquals(ESCRITAS_DA_ESTORNADA(escritas), 0, "tentou gravar a estornada");
  assertEquals(mp.posts, []);
  assertEquals(db.chamadasRpc.length, 0);
  assertEquals(db.linha.gateway_payment_id, ID_C1_IRMA_P7);
  assertEquals(r.status, 200, JSON.stringify(r.corpo));
  assertEquals(r.corpo, SEM_REGISTRO_DO_PEDIDO_BASE);

  const r2 = await emSilencio(() => chamar(contado, mp as unknown as MpVivo, corpoCartao()));
  assertEquals(mp.posts, []);
  assertEquals(db.chamadasRpc.length, 0);
  assertEquals(r2.status, 200, JSON.stringify(r2.corpo));
  assertEquals(r2.corpo.statusPagamento, "pago");
  assertEquals(r2.corpo.paymentId, ID_C1_IRMA_P7);
});

// ── P7: PIX VIVO ao lado da estornada de cartão ────────────────────────────
// Decisão (rodada 2 da revisão do P7, 02/10/2026): um PIX VIVO NÃO é "irmã
// não-morta" para a adoção do CARTÃO. Motivo: o defeito P7 é a estornada
// tirar a vaga de um CARTÃO que o webhook precisa adotar depois — e a adoção
// do webhook sobre o sentinela só existe para order de CARTÃO
// (`rota === "order" && ordemDeCartaoNaNotificacao && statusMapeado ===
// "pago"`, webhook-mercadopago/index.ts ~2027). Segurar o sentinela por causa
// de um PIX não salvaria esse PIX (o webhook nunca o adotaria na vaga), e a
// própria `resolverSentinela` já descarta PIX (filtra `orderEhDeCartao`):
// contar PIX aqui seria uma régua diferente da que escolheu a order. O que
// acontece com um PIX pago fora da vaga é assunto do PIX, não do P7.
// Comportamento de hoje, fixado de propósito (mata o mutante
// `orderEhDeCartao(irma) -> true`): a estornada parcial é adotada como se
// estivesse sozinha (o mesmo do controle (e')).
const ID_PIX_VIVO_P7 = "ORDTST04PIXVIVOP700000000000";

Deno.test("P7 PIX vivo ao lado: [c0 cartão processed:partially_refunded, PIX action_required:waiting_transfer] -> o PIX não é irmã: adota c0 como se estivesse sozinha ('em_analise'), 0 RPC, 0 POST", async () => {
  Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");
  const { db, contado, escritas, mp } = cenarioSentinelaC2({
    orders: (limite) => [
      { ...cartaoC2(ID_C0_ESTORNADA_P7, PARCIAL_P7[0], PARCIAL_P7[1]), date_created: new Date(limite + 60_000).toISOString() },
      {
        ...orderAvulsa(ID_PIX_VIVO_P7, "bank_transfer", "action_required", "waiting_transfer"),
        date_created: new Date(limite + 120_000).toISOString(),
      },
    ],
  });
  const r = await verificar(contado, mp);

  assertEquals(db.linha.gateway_payment_id, ID_C0_ESTORNADA_P7);
  assertEquals(r.corpo, { verificacao: "em_analise", paymentId: ID_C0_ESTORNADA_P7, expiraEm: PRAZO_BASE });
  assertEquals(escritas.length, 1);
  assertEquals(db.chamadasRpc.length, 0);
  assertEquals(mp.posts, []);
});

// ─── Device ID + nome do pagador no cartão (03/10/2026) ──────────────────────
//
// Um cartão real foi recusado com `high_risk`: o antifraude do Mercado Pago não
// recebia o Device ID do comprador. O front agora manda `device_id` no corpo do
// cartão; a edge o valida (formato fechado), repassa como `X-meli-session-id`
// no POST /v1/orders do CARTÃO e IGNORA — nunca recusa — o que vier fora do
// formato, para front novo e edge velha/nova conviverem em qualquer ordem.

const DEVICE_ID_TESTE = "armor.8c1f0e2b9d7a4c35b6e1f0a9d8c7b6a5.XyZ123abc.9f8e7d6c5b4a";

Deno.test("validarCorpoDoCartao: device_id válido entra em dados.deviceId; ausente, nulo ou fora do formato vira null SEM recusar o cartão", () => {
  const com = validarCorpoDoCartao(corpoCartao({ device_id: DEVICE_ID_TESTE }));
  assertEquals(com.ok, true);
  if (com.ok) assertEquals(com.dados.deviceId, DEVICE_ID_TESTE);

  for (
    const device_id of [
      undefined,
      null,
      "",
      42,
      { a: 1 },
      ["x"],
      "abc\r\nX-Evil: 1",
      "com espaço",
      "x".repeat(513),
    ]
  ) {
    const r = validarCorpoDoCartao(corpoCartao({ device_id }));
    assertEquals(r.ok, true, JSON.stringify(device_id));
    if (r.ok) assertEquals(r.dados.deviceId, null, JSON.stringify(device_id));
  }
});

Deno.test("handler cartão: device_id válido vira o cabeçalho X-meli-session-id do POST /v1/orders — e NÃO vai para dentro do corpo da order", async () => {
  const { supabase } = cenarioCartao();
  const mp = fetchMP({ criar: { status: 201, corpo: orderDeCartao("processed", "accredited") } });

  const resposta = await handler(
    requisicao(corpoCartao({ device_id: DEVICE_ID_TESTE }), montarToken(DONO_LOGADO)),
    { supabase, fetchImpl: mp.fn },
  );

  assertEquals(resposta.status, 200);
  assertEquals(mp.criacoes().length, 1);
  const enviado = mp.criacoes()[0];
  assertEquals(enviado.headers?.["X-meli-session-id"], DEVICE_ID_TESTE);
  // O cabeçalho só se soma: a chave de idempotência por tentativa segue igual.
  assertEquals(enviado.headers?.["X-Idempotency-Key"], `${UUID}:c0`);
  assertEquals(JSON.stringify(enviado.corpo).includes(DEVICE_ID_TESTE), false);
});

Deno.test("handler cartão: SEM device_id (front antigo, script bloqueado, coleta atrasada) a cobrança segue igual — sem o cabeçalho", async () => {
  const { supabase } = cenarioCartao();
  const mp = fetchMP({ criar: { status: 201, corpo: orderDeCartao("processed", "accredited") } });

  const resposta = await handler(requisicao(corpoCartao(), montarToken(DONO_LOGADO)), {
    supabase,
    fetchImpl: mp.fn,
  });

  assertEquals(resposta.status, 200);
  assertEquals("X-meli-session-id" in (mp.criacoes()[0].headers ?? {}), false);
});

Deno.test("handler cartão: device_id FORA DO FORMATO é ignorado (200, sem o cabeçalho, sem cabeçalho forjado) — nunca 400", async () => {
  for (const device_id of ["abc\r\nX-Evil: 1", "com espaço", "x".repeat(513), 42, ""]) {
    const { supabase } = cenarioCartao();
    const mp = fetchMP({ criar: { status: 201, corpo: orderDeCartao("processed", "accredited") } });

    const resposta = await handler(
      requisicao(corpoCartao({ device_id }), montarToken(DONO_LOGADO)),
      { supabase, fetchImpl: mp.fn },
    );

    assertEquals(resposta.status, 200, JSON.stringify(device_id));
    const headers = mp.criacoes()[0].headers ?? {};
    assertEquals("X-meli-session-id" in headers, false, JSON.stringify(device_id));
    assertEquals("X-Evil" in headers, false);
  }
});

Deno.test("handler cartão: campo DESCONHECIDO no corpo não é recusado (a validação lê só os campos que conhece) — front novo contra edge velha não quebra", async () => {
  const { supabase } = cenarioCartao();
  const mp = fetchMP({ criar: { status: 201, corpo: orderDeCartao("processed", "accredited") } });

  const resposta = await handler(
    requisicao(corpoCartao({ campo_do_futuro: "x", device_id: DEVICE_ID_TESTE }), montarToken(DONO_LOGADO)),
    { supabase, fetchImpl: mp.fn },
  );

  assertEquals(resposta.status, 200);
  assertEquals(JSON.stringify(mp.criacoes()[0].corpo).includes("campo_do_futuro"), false);
});

Deno.test("handler PIX: device_id no corpo é ignorado — o PIX NÃO manda X-meli-session-id (escopo é só o cartão)", async () => {
  const { supabase } = cenarioCartao({ pedido: pedidoBase({ user_id: DONO_LOGADO }) });
  let headersDoPost: Record<string, string> | undefined;
  const base = fetchFalsoMP({});
  const fetchImpl = async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") headersDoPost = init.headers as Record<string, string>;
    return base(url, init);
  };

  const resposta = await handler(
    requisicao({ orderId: UUID, metodo: "pix", device_id: DEVICE_ID_TESTE }, montarToken(DONO_LOGADO)),
    { supabase, fetchImpl },
  );

  assertEquals(resposta.status, 200);
  assertEquals(typeof headersDoPost?.["X-Idempotency-Key"], "string");
  assertEquals("X-meli-session-id" in (headersDoPost ?? {}), false);
});

Deno.test("handler cartão: o nome do pedido (customer_name) vira payer.first_name + payer.last_name", async () => {
  const { supabase } = cenarioCartao({
    pedido: pedidoBase({ user_id: DONO_LOGADO, customer_name: "Maria da Silva Souza" }),
  });
  const mp = fetchMP({ criar: { status: 201, corpo: orderDeCartao("processed", "accredited") } });

  const resposta = await handler(requisicao(corpoCartao(), montarToken(DONO_LOGADO)), {
    supabase,
    fetchImpl: mp.fn,
  });

  assertEquals(resposta.status, 200);
  const payer = mp.criacoes()[0].corpo?.payer as Record<string, unknown>;
  assertEquals(payer.first_name, "Maria");
  assertEquals(payer.last_name, "da Silva Souza");
  assertEquals(payer.identification, { type: "CPF", number: CPF_TITULAR });
});

Deno.test("handler cartão: pedido SEM nome, ou com nome imprestável, cobra do mesmo jeito e não manda nome (nunca inventa)", async () => {
  for (const customer_name of [undefined, null, "", "   ", "Cliente 123", "joao@exemplo.com"]) {
    const { supabase } = cenarioCartao({
      pedido: pedidoBase({ user_id: DONO_LOGADO, customer_name }),
    });
    const mp = fetchMP({ criar: { status: 201, corpo: orderDeCartao("processed", "accredited") } });

    const resposta = await handler(requisicao(corpoCartao(), montarToken(DONO_LOGADO)), {
      supabase,
      fetchImpl: mp.fn,
    });

    assertEquals(resposta.status, 200, JSON.stringify(customer_name));
    const payer = mp.criacoes()[0].corpo?.payer as Record<string, unknown>;
    assertEquals("first_name" in payer, false, JSON.stringify(customer_name));
    assertEquals("last_name" in payer, false, JSON.stringify(customer_name));
  }
});

Deno.test("handler cartão em SANDBOX: nome do pedido NÃO é mandado (o desfecho de teste é o nome do titular no Brick, não o pagador)", async () => {
  const { supabase } = cenarioCartao({
    pedido: pedidoBase({ user_id: DONO_LOGADO, customer_name: "Maria da Silva" }),
  });
  Deno.env.set("MP_SANDBOX_PAYER_EMAIL", "test_user_1@testuser.com");
  try {
    const mp = fetchMP({ criar: { status: 201, corpo: orderDeCartao("processed", "accredited") } });
    const resposta = await handler(requisicao(corpoCartao(), montarToken(DONO_LOGADO)), {
      supabase,
      fetchImpl: mp.fn,
    });
    assertEquals(resposta.status, 200);
    const payer = mp.criacoes()[0].corpo?.payer as Record<string, unknown>;
    assertEquals("first_name" in payer, false);
    assertEquals("last_name" in payer, false);
  } finally {
    Deno.env.delete("MP_SANDBOX_PAYER_EMAIL");
  }
});

// ─── Dados do comprador e do produto no cartão (03/10/2026) ──────────────────
//
// Duas compras reais de teste foram recusadas pelo antifraude do MP, e o painel
// mostrava "Produto sem nome": a order de cartão não levava itens, telefone nem
// endereço. A edge agora lê esses dados (melhor esforço, 3 leituras) e os soma
// ao corpo. O que erra caro e se prova aqui: dado ausente/torto NUNCA derruba a
// cobrança nem vira campo torto, a soma dos itens NUNCA diverge do total, e o
// PIX segue sem tocar nada disto.

const ENDERECO_DO_PEDIDO = {
  cep: "06233-903",
  street: "Rua Teste",
  number: "3003",
  neighborhood: "Bonfim",
  city: "Osasco",
  state: "SP",
  complement: "Apto 303",
};
const ENDERECO_NO_CORPO = {
  zip_code: "06233903",
  street_name: "Rua Teste",
  street_number: "3003",
  neighborhood: "Bonfim",
  city: "Osasco",
  state: "SP",
  complement: "Apto 303",
};
const LINHAS_DO_PEDIDO = [
  { product_id: "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b", product_name: "Camiseta Azul", quantity: 2, price: 50 },
];

function pedidoDeEntrega(extra: Record<string, unknown> = {}) {
  return pedidoBase({
    user_id: DONO_LOGADO,
    total: 112.5,
    customer_data: {
      email: "cliente@exemplo.com",
      whatsapp: "(11) 98765-4321",
      address: ENDERECO_DO_PEDIDO,
      shipping_option_id: "local-delivery",
    },
    ...extra,
  });
}

Deno.test("handler cartão: itens, telefone, endereço e frete do pedido vão no corpo da order no formato da doc", async () => {
  const { supabase, leiturasDoAntifraude } = cenarioCartao({
    pedido: pedidoDeEntrega(),
    itensDoPedido: LINHAS_DO_PEDIDO,
    colunasExtrasDoPedido: { customer_phone: null, address_id: null, shipping: 12.5 },
  });
  const mp = fetchMP({ criar: { status: 201, corpo: orderDeCartao("processed", "accredited") } });

  const resposta = await handler(requisicao(corpoCartao(), montarToken(DONO_LOGADO)), {
    supabase,
    fetchImpl: mp.fn,
  });

  assertEquals(resposta.status, 200);
  const enviado = mp.criacoes()[0].corpo as Record<string, unknown>;
  assertEquals(enviado.total_amount, "112.50");
  // 2 x 50,00 + 12,50 de frete = 112,50: a soma fecha com o total, ao centavo.
  assertEquals(enviado.items, [
    {
      title: "Camiseta Azul",
      unit_price: "50.00",
      quantity: 2,
      description: "Camiseta Azul",
      external_code: "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b",
    },
    { title: "Frete", unit_price: "12.50", quantity: 1, description: "Frete" },
  ]);
  const payer = enviado.payer as Record<string, unknown>;
  assertEquals(payer.phone, { area_code: "11", number: "987654321" });
  assertEquals(payer.address, ENDERECO_NO_CORPO);
  assertEquals(enviado.shipment, { address: ENDERECO_NO_CORPO });
  assertEquals("additional_info" in enviado, false);
  // O que já era mandado segue igual.
  assertEquals(payer.identification, { type: "CPF", number: CPF_TITULAR });
  assertEquals(mp.criacoes().length, 1);
  // Leituras: itens por order_id; a leitura extra do pedido por id.
  assertEquals(
    leiturasDoAntifraude.map((l) => [l.tabela, l.filtros]).sort(),
    [["marketplace_order_items", [["order_id", UUID]]], ["marketplace_orders", [["id", UUID]]]].sort(),
  );
});

Deno.test("handler cartão: cliente logado SEM snapshot de endereço usa o endereço SALVO, lido por id E dono", async () => {
  const { supabase, leiturasDoAntifraude } = cenarioCartao({
    pedido: pedidoBase({
      user_id: DONO_LOGADO,
      total: 100,
      customer_data: { email: "cliente@exemplo.com", whatsapp: "11987654321", address: { cpf: "12345678909" } },
    }),
    itensDoPedido: LINHAS_DO_PEDIDO,
    colunasExtrasDoPedido: { address_id: "end-77", shipping: 0 },
    enderecoSalvo: ENDERECO_DO_PEDIDO,
  });
  const mp = fetchMP({ criar: { status: 201, corpo: orderDeCartao("processed", "accredited") } });

  const resposta = await handler(requisicao(corpoCartao(), montarToken(DONO_LOGADO)), {
    supabase,
    fetchImpl: mp.fn,
  });

  assertEquals(resposta.status, 200);
  const enviado = mp.criacoes()[0].corpo as Record<string, unknown>;
  assertEquals((enviado.payer as Record<string, unknown>).address, ENDERECO_NO_CORPO);
  assertEquals((enviado.items as unknown[]).length, 1);
  const leituraEndereco = leiturasDoAntifraude.find((l) => l.tabela === "user_addresses");
  assertEquals(leituraEndereco?.filtros, [["id", "end-77"], ["user_id", DONO_LOGADO]]);
  // O CPF que já esteve nesse jsonb nunca vai para endereço, entrega nem item.
  assertEquals(JSON.stringify(enviado.shipment).includes("12345678909"), false);
  assertEquals(JSON.stringify((enviado.payer as Record<string, unknown>).address).includes("12345678909"), false);
  assertEquals(JSON.stringify(enviado.items).includes("12345678909"), false);
});

Deno.test("handler cartão: RETIRADA na loja manda itens e telefone, mas NÃO shipment (não há entrega)", async () => {
  const { supabase } = cenarioCartao({
    pedido: pedidoDeEntrega({
      total: 100,
      customer_data: {
        email: "cliente@exemplo.com",
        whatsapp: "11987654321",
        address: ENDERECO_DO_PEDIDO,
        shipping_option_id: "store-pickup",
        pickup_address: "Rua da Loja, 10",
      },
    }),
    itensDoPedido: LINHAS_DO_PEDIDO,
    colunasExtrasDoPedido: { shipping: 0 },
  });
  const mp = fetchMP({ criar: { status: 201, corpo: orderDeCartao("processed", "accredited") } });

  const resposta = await handler(requisicao(corpoCartao(), montarToken(DONO_LOGADO)), {
    supabase,
    fetchImpl: mp.fn,
  });

  assertEquals(resposta.status, 200);
  const enviado = mp.criacoes()[0].corpo as Record<string, unknown>;
  assertEquals("shipment" in enviado, false);
  assertEquals((enviado.items as unknown[]).length, 1);
  assertEquals((enviado.payer as Record<string, unknown>).phone, { area_code: "11", number: "987654321" });
});

Deno.test("handler cartão: pedido com DESCONTO (soma dos itens diferente do total) NÃO manda items — um 400 por soma derrubaria o cartão — e cobra normalmente", async () => {
  const { supabase } = cenarioCartao({
    pedido: pedidoDeEntrega({ total: 90 }), // 100 de itens + 0 de frete - 10 de cupom
    itensDoPedido: LINHAS_DO_PEDIDO,
    colunasExtrasDoPedido: { shipping: 0 },
  });
  const mp = fetchMP({ criar: { status: 201, corpo: orderDeCartao("processed", "accredited") } });

  const resposta = await handler(requisicao(corpoCartao(), montarToken(DONO_LOGADO)), {
    supabase,
    fetchImpl: mp.fn,
  });

  assertEquals(resposta.status, 200);
  const enviado = mp.criacoes()[0].corpo as Record<string, unknown>;
  assertEquals(enviado.total_amount, "90.00");
  assertEquals("items" in enviado, false);
  // O resto do que se sabe do comprador continua indo.
  assertEquals((enviado.payer as Record<string, unknown>).phone, { area_code: "11", number: "987654321" });
  assertEquals(enviado.shipment, { address: ENDERECO_NO_CORPO });
});

Deno.test("handler cartão: leitura dos dados FALHANDO (erro de banco OU exceção) não bloqueia a cobrança, o corpo é o de antes e nada do dado vai para o log", async () => {
  const logs: string[] = [];
  const originais = { log: console.log, error: console.error, warn: console.warn };
  console.log = (...a: unknown[]) => void logs.push(a.map(String).join(" "));
  console.error = (...a: unknown[]) => void logs.push(a.map(String).join(" "));
  console.warn = (...a: unknown[]) => void logs.push(a.map(String).join(" "));
  try {
    for (const falha of ["erro", "lanca"] as const) {
      const { supabase } = cenarioCartao({
        pedido: pedidoBase({ user_id: DONO_LOGADO }),
        falhaNaLeituraDoAntifraude: falha,
      });
      const mp = fetchMP({ criar: { status: 201, corpo: orderDeCartao("processed", "accredited") } });
      const resposta = await handler(requisicao(corpoCartao(), montarToken(DONO_LOGADO)), {
        supabase,
        fetchImpl: mp.fn,
      });
      assertEquals(resposta.status, 200, falha);
      assertEquals(mp.criacoes().length, 1, falha);
      const enviado = mp.criacoes()[0].corpo as Record<string, unknown>;
      for (const campo of ["items", "shipment"]) assertEquals(campo in enviado, false, `${falha} ${campo}`);
      for (const campo of ["phone", "address"]) {
        assertEquals(campo in (enviado.payer as Record<string, unknown>), false, `${falha} ${campo}`);
      }
    }
  } finally {
    console.log = originais.log;
    console.error = originais.error;
    console.warn = originais.warn;
  }
  assertEquals(logs.some((l) => l.includes("11987654321") || l.includes("Rua Secreta")), false);
});

Deno.test("handler cartão: dado TORTO no pedido (telefone, endereço, itens) é omitido campo a campo — o corpo continua válido e a cobrança segue", async () => {
  const { supabase } = cenarioCartao({
    pedido: pedidoBase({
      user_id: DONO_LOGADO,
      customer_data: { email: "cliente@exemplo.com", whatsapp: "ligue-me", address: { cep: "x", street: 7 } },
    }),
    itensDoPedido: [{ product_name: "X", quantity: -1, price: "abc" }, null],
    colunasExtrasDoPedido: { customer_phone: "123", shipping: "lixo", address_id: null },
  });
  const mp = fetchMP({ criar: { status: 201, corpo: orderDeCartao("processed", "accredited") } });

  const resposta = await handler(requisicao(corpoCartao(), montarToken(DONO_LOGADO)), {
    supabase,
    fetchImpl: mp.fn,
  });

  assertEquals(resposta.status, 200);
  const enviado = mp.criacoes()[0].corpo as Record<string, unknown>;
  for (const campo of ["items", "shipment"]) assertEquals(campo in enviado, false, campo);
  for (const campo of ["phone", "address"]) {
    assertEquals(campo in (enviado.payer as Record<string, unknown>), false, campo);
  }
});

Deno.test("handler PIX: NÃO lê itens, telefone nem endereço e o corpo não ganha nenhum campo novo — o escopo é só o cartão", async () => {
  const { supabase, leiturasDoAntifraude } = cenarioCartao({
    pedido: pedidoDeEntrega(),
    itensDoPedido: LINHAS_DO_PEDIDO,
    colunasExtrasDoPedido: { shipping: 12.5 },
  });
  let corpoDoPost: Record<string, unknown> | undefined;
  const base = fetchFalsoMP({});
  const fetchImpl = async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") corpoDoPost = JSON.parse(String(init.body));
    return base(url, init);
  };

  const resposta = await handler(requisicao({ orderId: UUID, metodo: "pix" }, montarToken(DONO_LOGADO)), {
    supabase,
    fetchImpl,
  });

  assertEquals(resposta.status, 200);
  assertEquals(leiturasDoAntifraude, []);
  for (const campo of ["items", "shipment", "additional_info"]) {
    assertEquals(campo in (corpoDoPost ?? {}), false, campo);
  }
  for (const campo of ["phone", "address"]) {
    assertEquals(campo in ((corpoDoPost?.payer as Record<string, unknown>) ?? {}), false, campo);
  }
});
