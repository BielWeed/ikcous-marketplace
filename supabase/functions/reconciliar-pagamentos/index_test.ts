// @ts-nocheck
/**
 * Testes da reconciliar-pagamentos (Fase 3, Task 6; migrada para a Orders API
 * na Tarefa 4, CHECKOUT-070).
 *
 * Nada aqui toca rede nem banco: `deps.supabase` e `deps.fetchImpl`
 * substituem tudo isso, na mesma costura que `webhook-mercadopago` já provou
 * (index_test.ts). A RPC `pagamentos_a_reconciliar` (Task 5) ainda não foi
 * aplicada em produção — por isso o cliente falso abaixo é a ÚNICA forma de
 * exercitar este handler antes do deploy.
 *
 * O que se prova é o que erra caro aqui: um `RECONCILIACAO_SECRET` errado (ou
 * ausente) disparando a varredura de pedidos de qualquer um que descubra a
 * URL, um candidato com falha na consulta ao MP abortando o lote inteiro — a
 * reconciliação existe justamente para pegar o que o webhook perdeu, então
 * ela não pode perder o resto do lote por causa de um candidato só — e,
 * desde a Tarefa 4, que `gateway_payment_id` agora é id de ORDER: consultar
 * pelo endpoint clássico (`GET /v1/payments/{id}`) devolveria 404 para todo
 * candidato criado depois da migração, apagando a rede de segurança
 * exatamente para os pedidos que ela existe para proteger.
 */
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { handler, htmlDoAvisoDePagamentoAtrasado } from "./index.ts";
import {
  MOTIVO_LINHA_INCERTA,
  MOTIVO_REENVIO_SEM_CONSULTA,
  MOTIVO_SALDO_MUDOU_ANTES_DO_POST,
  MOTIVO_SALDO_NAO_COBRE_MAIS,
} from "../_shared/estorno.ts";
// Tarefa mp-2: as MESMAS primitivas de cifra da produção montam o registro
// do lojista nos testes MP-1/MP-2 do fim deste arquivo. Desde a tarefa mp-6
// o fixture vem PRONTO de `_shared/credenciais-mp_fixtures.ts` — era a
// mesma montagem copiada em cinco suítes, e cópia de fixture envelhece
// calada quando a forma do registro em app_settings muda.
import {
  CHAVE_CIFRA_TESTE,
  contandoFrom,
  registroMpDeTeste,
  TOKEN_LOJISTA_FALSO,
} from "../_shared/credenciais-mp_fixtures.ts";

const SEGREDO = "segredo-reconciliacao-teste";
const UUID_PEDIDO_1 = "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
const UUID_PEDIDO_2 = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

Deno.env.set("RECONCILIACAO_SECRET", SEGREDO);
Deno.env.set("MP_ACCESS_TOKEN", "token-de-teste");

function requisicaoComSegredo(segredo: string | null): Request {
  const headers: Record<string, string> = {};
  if (segredo !== null) headers["x-reconciliacao-secret"] = segredo;
  return new Request("http://localhost/reconciliar-pagamentos", { method: "POST", headers });
}

// Fetch de UMA rota só: usado quando o candidato bate na Orders API e para
// por aí (sem cair no fallback clássico) — a mesma URL responde sempre o
// mesmo corpo, então o teste nem precisa olhar para ela.
function fetchConsulta(status: number, corpo: Record<string, unknown>) {
  return async (_url: string, _init?: RequestInit) =>
    new Response(JSON.stringify(corpo), { status });
}

/**
 * A lista de contestações presas (FASE 2, `reconsulta-de-contestacao.ts`) lê
 * `order_refunds` com `.eq().lt().order().limit()`: estes testes não têm
 * contestação nenhuma, então a cadeia devolve vazio (e a reconsulta não faz
 * nada, sem ruído de TypeError engolido).
 */
function cadeiaVazia() {
  const q = {
    eq: () => q,
    lt: () => q,
    order: () => q,
    limit: () => q,
    then: (res: (v: unknown) => void, rej?: (e: unknown) => void) =>
      Promise.resolve({ data: [], error: null }).then(res, rej),
  };
  return q;
}
const ehLeituraDeContestacao = (colunas: string) => colunas.trim() === "id" || colunas.trim() === "id, order_id, updated_at";

/**
 * Cliente Supabase falso: distingue as duas RPCs de pagamento pelo nome.
 * `rpc("pagamentos_a_reconciliar")` devolve os `candidatos` configurados;
 * `rpc("confirmar_pagamento", args)` registra os argumentos em
 * `registro.chamadasConfirmar` — o que os testes conferem — e devolve
 * `rpcConfirmarResultado`.
 *
 * Task 4 (fila de `order_refunds`) acrescenta, sem tocar o comportamento
 * acima: `rpc("concluir_estorno")`, e as tabelas `order_refunds` (fila +
 * marca + desfecho) e `marketplace_orders` roteada por NOME (a leitura do
 * "pedido fresco" só troca de forma quando `resolverPedidoFresco` é
 * passado — sem ele, `marketplace_orders` continua devolvendo exatamente o
 * que a conferência de valor da reconciliação de pagamentos sempre esperou).
 */
function clienteFalso(opts: {
  candidatos?: Array<{ order_id: string; gateway_payment_id: string }>;
  erroCandidatos?: unknown;
  rpcConfirmarResultado?: string;
  rpcConfirmarError?: unknown;
  // Conferência de valor (laudo 31/08, A3): total do pedido devolvido pela
  // leitura de `marketplace_orders` (default 149.9). Null e valores ilegíveis
  // são preservados para testar a recusa. `erroFrom` injeta falha de leitura.
  pedidoTotal?: unknown;
  avisos?: Map<string, { enviado: boolean }>;
  erroFrom?: unknown;
  // Fase 3.5 (cartão): `rpc("liberar_cobranca_do_pedido")` — o boolean
  // devolvido (default true) e a falha de banco simulada.
  liberarResultado?: boolean;
  liberarErro?: unknown;
  // Auditoria de 30/09/2026 (item 2): adoção do cartão capturado atrás do
  // sentinela. `adocaoGravou: false` = o WHERE não casou (vaga trocada).
  adocaoGravou?: boolean;
  erroAdocao?: unknown;
  registro: {
    adocoesPedido?: Array<{ valores: Record<string, unknown>; filtros: Array<[string, unknown]> }>;
    chamadasConfirmar: Array<{ args: Record<string, unknown> }>;
    chamadasAviso?: Array<{ nome: string; args: Record<string, unknown> }>;
    chamadasLiberar?: Array<{ args: Record<string, unknown> }>;
    chamouCandidatos: boolean;
    chamadasConcluirEstorno?: Array<{ args: Record<string, unknown> }>;
    chamadasAutorizarPost?: Array<{ args: Record<string, unknown> }>;
    // 14/10/2026: registrar_diagnostico_do_estorno (o porquê do POST) e a
    // ordem em que ele e o desfecho terminal foram gravados.
    chamadasDiagnostico?: Array<{ args: Record<string, unknown> }>;
    // 21/10/2026: cada `registrar_estorno_externo_do_mp` e os ids já vistos.
    chamadasExternoDoMp?: Array<{ args: Record<string, unknown> }>;
    idsExternosVistos?: Set<string>;
    ordemDeGravacao?: string[];
    atualizacoesOrderRefunds?: Array<
      {
        id: string;
        valores: Record<string, unknown>;
        statusFiltro: string[];
        // R1: `.is(coluna, valor)` encadeado depois do `.in()`.
        filtroIs?: [string, unknown];
      }
    >;
  };

  // --- Task 4: fila de order_refunds pendentes ---------------------------
  // Fila devolvida por `.from('order_refunds').select(...).in(...).lt(...)
  // .order(...).limit(20)`. O filtro `lt('updated_at', limite)` é SIMULADO
  // de verdade (não ignorado): item com `updated_at` >= limite some da
  // lista — é assim que R6 prova a janela de 2 minutos sem reimplementar a
  // query, só reagindo ao valor que o handler calculou.
  refundsPendentes?: Array<Record<string, unknown>>;
  erroRefundsPendentes?: unknown;
  // Pedido "fresco" por order_id — FUNÇÃO, não mapa estático: R7 precisa que
  // o valor mude ENTRE as duas iterações do laço (a RPC do dublê sobe
  // `valor_estornado` depois da 1ª linha concluir), e uma função é o único
  // jeito de expressar isso sem reimplementar o handler.
  resolverPedidoFresco?: (orderId: string) => Record<string, unknown> | null;
  erroPedidoFrescoPorOrderId?: ReadonlyMap<string, unknown>;
  atualizarOrderRefunds?: (
    id: string,
    valores: Record<string, unknown>,
    statusFiltro: string[],
    filtroEq?: [string, unknown],
  ) => { data: unknown; error: unknown };
  aoConcluirEstorno?: (args: Record<string, unknown>) => void;
  erroConcluirEstorno?: unknown;
  // --- item 1 do brief P0 (08/09/2026): ids já reivindicados por OUTRAS
  // linhas do mesmo pedido -------------------------------------------------
  // `.select("mp_refund_id").eq("order_id", x).neq("id", y).not("mp_refund_id",
  // "is", null)`. FUNÇÃO (não mapa estático), pelo MESMO motivo de
  // `resolverPedidoFresco`: R13 precisa que o valor mude ENTRE as duas
  // iterações do lote (a 1ª linha grava o id que a 2ª tem de ver). Default
  // `[]`: os testes que não passam esta opção preservam o comportamento de
  // antes (nenhum id excluído).
  idsJaReivindicadosPorPedido?: (orderId: string, idAtual: string) => string[];
  erroIdsJaReivindicados?: unknown;
  // --- Tarefa mp-2: o registro CIFRADO do lojista, como ele dorme em
  // app_settings (_shared/credenciais-mp.ts). Default ausente — a loja que
  // ainda roda pelas chaves da plataforma, que é o que todos os testes
  // anteriores a esta tarefa exercitam.
  registroMp?: Record<string, unknown> | null;
  // --- Lote A (04/10/2026): autorizar_post_do_estorno, a pergunta do
  // executor ao banco imediatamente antes do POST. Default: autorizado com o
  // pedido fresco ATUAL da linha (`resolverPedidoFresco`) — o banco relê o
  // mesmo estado que o handler leu, no instante da pergunta.
  autorizarPost?: (args: Record<string, unknown>) => { data: unknown; error: unknown };
  // 14/10/2026: o que a linha tem DEPOIS de gravar o diagnóstico (contador e
  // carimbo) e o erro simulado. Default: 1 falha "nada saiu", sem carimbo.
  diagnostico?: { transitorios: number; post_incerto: boolean };
  erroDiagnostico?: unknown;
  // Simulação de vários ciclos: o diagnóstico COM ESTADO (conta, carimbo e
  // último código acumulados, como a tabela de verdade).
  aoRegistrarDiagnostico?: (args: Record<string, unknown>) => Record<string, unknown>;
  // 21/10/2026: roteiro de `registrar_estorno_externo_do_mp` (P1/P2).
  estornoExternoDoMp?: (args: Record<string, unknown>) => { data: unknown; error: unknown };
}) {
  const avisos = opts.avisos ?? new Map<string, { enviado: boolean }>();
  return {
    rpc: async (nome: string, args?: Record<string, unknown>) => {
      if (nome === "pagamentos_a_reconciliar") {
        opts.registro.chamouCandidatos = true;
        if (opts.erroCandidatos) return { data: null, error: opts.erroCandidatos };
        return { data: opts.candidatos ?? [], error: null };
      }
      if (nome === "confirmar_pagamento") {
        opts.registro.chamadasConfirmar.push({ args: args ?? {} });
        if (opts.rpcConfirmarError) return { data: null, error: opts.rpcConfirmarError };
        return { data: opts.rpcConfirmarResultado ?? "pago", error: null };
      }
      if (nome === "reservar_aviso_ao_lojista") {
        opts.registro.chamadasAviso?.push({ nome, args: args ?? {} });
        const chave = String(args?.p_chave);
        const anterior = avisos.get(chave);
        if (anterior) return { data: anterior.enviado ? "enviado" : "em_envio", error: null };
        avisos.set(chave, { enviado: false });
        return { data: "reservado", error: null };
      }
      if (nome === "confirmar_aviso_ao_lojista" || nome === "liberar_aviso_ao_lojista") {
        opts.registro.chamadasAviso?.push({ nome, args: args ?? {} });
        const chave = String(args?.p_chave);
        if (nome === "confirmar_aviso_ao_lojista") avisos.set(chave, { enviado: true });
        else avisos.delete(chave);
        return { data: true, error: null };
      }
      if (nome === "liberar_cobranca_do_pedido") {
        if (!opts.registro.chamadasLiberar) {
          // Teste que não esperava liberação nenhuma: estoura, em vez de a
          // liberação passar despercebida.
          throw new Error("rpc liberar_cobranca_do_pedido inesperada neste teste");
        }
        opts.registro.chamadasLiberar.push({ args: args ?? {} });
        if (opts.liberarErro) return { data: null, error: opts.liberarErro };
        return { data: opts.liberarResultado ?? true, error: null };
      }
      if (nome === "autorizar_post_do_estorno") {
        opts.registro.chamadasAutorizarPost?.push({ args: args ?? {} });
        if (opts.autorizarPost) return opts.autorizarPost(args ?? {});
        const refund = (opts.refundsPendentes ?? []).find((r) => r.id === args?.p_refund_id);
        const pedido = refund ? opts.resolverPedidoFresco?.(String(refund.order_id)) : null;
        if (!pedido) throw new Error("autorizar_post_do_estorno sem pedido conhecido neste teste");
        return { data: { decisao: "autorizado", pedido }, error: null };
      }
      if (nome === "registrar_diagnostico_do_estorno") {
        opts.registro.chamadasDiagnostico?.push({ args: args ?? {} });
        opts.registro.ordemDeGravacao?.push("diagnostico");
        if (opts.erroDiagnostico) return { data: null, error: opts.erroDiagnostico };
        if (opts.aoRegistrarDiagnostico) return { data: opts.aoRegistrarDiagnostico(args ?? {}), error: null };
        return { data: opts.diagnostico ?? { transitorios: 1, post_incerto: false }, error: null };
      }
      if (nome === "concluir_estorno") {
        opts.registro.chamadasConcluirEstorno?.push({ args: args ?? {} });
        opts.aoConcluirEstorno?.(args ?? {});
        if (opts.erroConcluirEstorno) return { data: null, error: opts.erroConcluirEstorno };
        return { data: { payment_status: "pago" }, error: null };
      }
      // 21/10/2026 (P1/P2 da revisão adversarial do lote 1.5.47): o registro de
      // devolução feita FORA do app. O dublê guarda as chamadas e devolve o que
      // o teste roteirizar; o default espelha a RPC real para uma devolução
      // nova ('inserido') e, na repetição do MESMO id, 'ja_registrado'.
      if (nome === "registrar_estorno_externo_do_mp") {
        opts.registro.chamadasExternoDoMp?.push({ args: args ?? {} });
        if (opts.estornoExternoDoMp) return opts.estornoExternoDoMp(args ?? {});
        const jaVistos = (opts.registro.idsExternosVistos ??= new Set<string>());
        const id = String(args?.p_mp_refund_id);
        const resultado = jaVistos.has(id) ? "ja_registrado" : "inserido";
        jaVistos.add(id);
        return { data: { resultado, aviso: null }, error: null };
      }
      throw new Error(`rpc inesperada nos testes: ${nome}`);
    },
    from(tabela: string) {
      if (tabela === "order_refunds") {
        return {
          select(colunasPedidas: string) {
            if (ehLeituraDeContestacao(colunasPedidas)) return cadeiaVazia();
            // R1 (20261196000000): a fila devolve SÓ as colunas que o SELECT
            // da produção pediu (mais as que o dublê usa para filtrar e
            // ordenar já foram usadas antes da projeção) — tirar
            // `post_autorizado_em` do SELECT tira o campo da linha.
            const colunasDoSelect = colunasPedidas.split(",").map((c) => c.trim());
            const projetar = (linha: Record<string, unknown>) =>
              colunasDoSelect.includes("*")
                ? linha
                : Object.fromEntries(Object.entries(linha).filter(([k]) => colunasDoSelect.includes(k)));
            return {
              // item 1 do brief P0: `.select("mp_refund_id").eq("order_id",
              // x).neq("id", y).not("mp_refund_id", "is", null)` — chain
              // IRMÃ de `.in()` abaixo (a fila pendente), diferenciada pelo
              // método que vem em seguida.
              eq(_coluna: string, orderId: string) {
                return {
                  neq(coluna2: string, idAtual: string) {
                    return {
                      not(_coluna3: string, _op: string, _valor: unknown) {
                        if (opts.erroIdsJaReivindicados) {
                          return Promise.resolve({
                            data: null,
                            error: opts.erroIdsJaReivindicados,
                          });
                        }
                        // AC3-a (laudo Opus #447 rodada 2, 08/09/2026): o
                        // dublê tem de CONFERIR a coluna real que a produção
                        // passou a `.neq()`, não descartá-la e reimplementar
                        // a exclusão pelo `id` na mão — sem isso, trocar a
                        // coluna em produção (ex.: "id" -> "mp_refund_id",
                        // R15) passa batido porque o mock nunca olhava para
                        // ela. `assertEquals` é a prova: mutar
                        // reconciliar-pagamentos/index.ts:598 para
                        // `.neq("mp_refund_id", refund.id)` faz este assert
                        // (e R15) falharem.
                        assertEquals(coluna2, "id");
                        const ids = opts.idsJaReivindicadosPorPedido?.(
                          orderId,
                          idAtual,
                        ) ?? [];
                        return Promise.resolve({
                          data: ids.map((mp_refund_id) => ({ mp_refund_id })),
                          error: null,
                        });
                      },
                    };
                  },
                };
              },
              in(_coluna: string, _valores: string[]) {
                // R14 (T5, webhook): linha `solicitado_por = 'sistema'` é
                // dinheiro que já se moveu FORA do app — o cron nunca a
                // toca. `.neq()` é CAUSAL aqui (filtra pelos argumentos reais
                // que a produção passa, acumulados em `exclusoes`), e não é
                // estrutural: `.lt()` fica disponível tanto encadeado depois
                // de `.neq()` quanto direto em cima de `.in()` — assim, se a
                // produção deixar de chamar `.neq("solicitado_por","sistema")`,
                // o mock não quebra com TypeError (o que o `catch` externo do
                // handler engoliria e faria o teste passar por acidente); a
                // linha 'sistema' simplesmente deixa de ser excluída, e a
                // mutação aparece como uma diferença real no resultado.
                const comExclusoes = (
                  exclusoes: Array<{ coluna: string; valor: unknown }>,
                ) => ({
                  neq(coluna: string, valor: unknown) {
                    return comExclusoes([...exclusoes, { coluna, valor }]);
                  },
                  lt(_colunaData: string, valorLimite: string) {
                    // O dublê acumula todos os critérios de `.order()` antes
                    // de `.limit()` e simula a ordenação de verdade: cada
                    // `.order()` devolve `.order()` e `.limit()`. Assim R10
                    // e RODIZIO provam a fila sem reimplementar o handler.
                    const comCriterios = (
                      criterios: Array<{ coluna: string; ascendente: boolean }>,
                    ) => ({
                      order(coluna: string, o?: { ascending?: boolean }) {
                        return comCriterios([
                          ...criterios,
                          { coluna, ascendente: o?.ascending ?? true },
                        ]);
                      },
                      limit: async (n: number) => {
                        if (opts.erroRefundsPendentes) {
                          return { data: null, error: opts.erroRefundsPendentes };
                        }
                        const todos = opts.refundsPendentes ?? [];
                        const filtrados = todos.filter((r) => {
                          const registro2 = r as Record<string, unknown>;
                          const upd = registro2.updated_at;
                          const passaJanela = typeof upd !== "string" || upd < valorLimite;
                          // Causal: só exclui pelo que `.neq()` de fato
                          // recebeu — sem chamada, sem exclusão nenhuma.
                          const passaExclusoes = exclusoes.every(
                            ({ coluna, valor }) => registro2[coluna] !== valor,
                          );
                          return passaJanela && passaExclusoes;
                        });
                        const ordenados = [...filtrados].sort((a, b) => {
                          for (const { coluna, ascendente } of criterios) {
                            const va = (a as Record<string, unknown>)[coluna];
                            const vb = (b as Record<string, unknown>)[coluna];
                            if (va === vb) continue;
                            if (va === undefined || va === null) {
                              return ascendente ? -1 : 1;
                            }
                            if (vb === undefined || vb === null) {
                              return ascendente ? 1 : -1;
                            }
                            if (va < vb) return ascendente ? -1 : 1;
                            if (va > vb) return ascendente ? 1 : -1;
                          }
                          return 0;
                        });
                        return {
                          data: ordenados.slice(0, n).map((r) => projetar(r as Record<string, unknown>)),
                          error: null,
                        };
                      },
                    });
                    return comCriterios([]);
                  },
                });
                return comExclusoes([]);
              },
            };
          },
          update(valores: Record<string, unknown>) {
            return {
              eq(_coluna: string, id: string) {
                return {
                  in(_coluna2: string, statusFiltro: string[]) {
                    const executar = async (filtroIs?: [string, unknown], filtroEq?: [string, unknown]) => {
                      if (valores.status === "falhou" || valores.status === "recusado") {
                        opts.registro.ordemDeGravacao?.push("final");
                      }
                      const registroDaEscrita: Record<string, unknown> = { id, valores, statusFiltro };
                      if (filtroIs) registroDaEscrita.filtroIs = filtroIs;
                      if (filtroEq) registroDaEscrita.filtroEq = filtroEq;
                      opts.registro.atualizacoesOrderRefunds?.push(registroDaEscrita as never);
                      if (opts.atualizarOrderRefunds) {
                        return opts.atualizarOrderRefunds(id, valores, statusFiltro, filtroEq);
                      }
                      return { data: [{ id }], error: null };
                    };
                    const encadeavel = (filtroIs?: [string, unknown], filtroEq?: [string, unknown]) => ({
                      // R1: `.is("post_autorizado_em", null)` no recusado.
                      is: (coluna: string, valor: unknown) => encadeavel([coluna, valor], filtroEq),
                      // P1 do Codex no #888: `.eq("tentativas", marca)` no
                      // desfazer da tentativa de um ciclo sem envio.
                      eq: (coluna: string, valor: unknown) => encadeavel(filtroIs, [coluna, valor]),
                      select: () => executar(filtroIs, filtroEq),
                      then: (
                        res: (v: { data: unknown; error: unknown }) => void,
                        rej?: (e: unknown) => void,
                      ) => executar(filtroIs, filtroEq).then(res, rej),
                    });
                    return encadeavel();
                  },
                };
              },
            };
          },
        };
      }

      if (tabela === "marketplace_orders") {
        return {
          select(_colunas: string) {
            return {
              eq(_coluna: string, id: string) {
                return {
                  maybeSingle: async () => {
                    if (opts.resolverPedidoFresco) {
                      if (opts.erroPedidoFrescoPorOrderId?.has(id)) {
                        return { data: null, error: opts.erroPedidoFrescoPorOrderId.get(id) };
                      }
                      const pedido = opts.resolverPedidoFresco(id);
                      return pedido ? { data: pedido, error: null } : { data: null, error: null };
                    }
                    return opts.erroFrom
                      ? { data: null, error: opts.erroFrom }
                      : {
                        data: { total: opts.pedidoTotal === undefined ? 149.9 : opts.pedidoTotal, total_amount: null },
                        error: null,
                      };
                  },
                };
              },
            };
          },
          // Auditoria de 30/09/2026 (item 2): a adoção do cartão CAPTURADO
          // atrás do sentinela — `.update().eq("id").eq("gateway_payment_id",
          // sentinela).select().maybeSingle()`. Registra o SET e os filtros;
          // `adocaoGravou: false` simula outra escrita ter trocado a vaga.
          update(valores: Record<string, unknown>) {
            const filtros: Array<[string, unknown]> = [];
            return {
              eq(c1: string, v1: unknown) {
                filtros.push([c1, v1]);
                return {
                  eq(c2: string, v2: unknown) {
                    filtros.push([c2, v2]);
                    return {
                      select() {
                        return {
                          maybeSingle: async () => {
                            if (!opts.registro.adocoesPedido) {
                              throw new Error("update inesperado em marketplace_orders neste teste");
                            }
                            opts.registro.adocoesPedido.push({ valores, filtros });
                            if (opts.erroAdocao) return { data: null, error: opts.erroAdocao };
                            return { data: opts.adocaoGravou === false ? null : { id: v1 }, error: null };
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

      // Tarefa mp-2: a leitura das credenciais do lojista
      // (_shared/credenciais-mp.ts) passa pelo MESMO client de service role
      // que o cron já usa — ramo próprio, porque `from` desconhecido aqui
      // LANÇA de propósito.
      if (tabela === "app_settings") {
        return {
          select(_colunas: string) {
            return {
              eq(_coluna: string, _valor: string) {
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

      throw new Error(`from inesperado nos testes: ${tabela}`);
    },
  };
}

// --- 1. segredo incorreto ----------------------------------------------------

Deno.test("segredo incorreto -> 401, pagamentos_a_reconciliar NÃO é chamada", async () => {
  const registro = { chamadasConfirmar: [], chamouCandidatos: false };
  const supabase = clienteFalso({ candidatos: [], registro });
  const req = requisicaoComSegredo("segredo-errado");

  const resposta = await handler(req, { supabase });

  assertEquals(resposta.status, 401);
  assertEquals(registro.chamouCandidatos, false);
});

// --- segredo ausente no ambiente -> 503 (decisão do brief) -------------------

Deno.test("RECONCILIACAO_SECRET ausente no ambiente -> 503, mesmo com header correto", async () => {
  const registro = { chamadasConfirmar: [], chamouCandidatos: false };
  const supabase = clienteFalso({ candidatos: [], registro });
  Deno.env.delete("RECONCILIACAO_SECRET");
  try {
    const req = requisicaoComSegredo(SEGREDO);
    const resposta = await handler(req, { supabase });

    assertEquals(resposta.status, 503);
    assertEquals(registro.chamouCandidatos, false);
  } finally {
    Deno.env.set("RECONCILIACAO_SECRET", SEGREDO);
  }
});

// --- 2. nenhum candidato -------------------------------------------------------

Deno.test("nenhum candidato -> 200 com { ok: true, verificados: 0 }", async () => {
  const registro = { chamadasConfirmar: [], chamouCandidatos: false };
  const supabase = clienteFalso({ candidatos: [], registro });
  const req = requisicaoComSegredo(SEGREDO);

  const resposta = await handler(req, { supabase });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  assertEquals(corpo.ok, true);
  assertEquals(corpo.verificados, 0);
  assertEquals(registro.chamouCandidatos, true);
});

// --- 3. order aprovada (Orders API) ---------------------------------------------

Deno.test("order aprovada (processed:accredited) -> confirmados:1, p_payment_id é o id da ORDER", async () => {
  const registro = { chamadasConfirmar: [], chamouCandidatos: false };
  // Id de teste da Orders API — em produção começa com "ORD", em teste com
  // "ORDTST" (fato medido no brief, 14/08/2026). O ULID inteiro aqui prova
  // que nada no código depende de um prefixo curto tipo "ORD" + dígito.
  const idOrder = "ORDTST01KZZ4D94WC79335A68CZ5NZ7X";
  const candidatos = [{ order_id: UUID_PEDIDO_1, gateway_payment_id: idOrder }];
  const supabase = clienteFalso({ candidatos, rpcConfirmarResultado: "pago", registro });
  const fetchImpl = fetchConsulta(200, { id: idOrder, status: "processed", total_amount: "149.90", status_detail: "accredited" });
  const req = requisicaoComSegredo(SEGREDO);

  const resposta = await handler(req, { supabase, fetchImpl });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  assertEquals(corpo.confirmados, 1);
  assertEquals(registro.chamadasConfirmar.length, 1);
  assertEquals(registro.chamadasConfirmar[0].args.p_order_id, UUID_PEDIDO_1);
  assertEquals(registro.chamadasConfirmar[0].args.p_payment_id, idOrder);
  assertEquals(registro.chamadasConfirmar[0].args.p_status, "pago");
});

// --- 3.5 CONFERÊNCIA DE VALOR (laudo 31/08, A3; ressalva 1 da revisão do
// PR #366): a reconciliação atinge PEDIDO VIVO — sem esta porta, o que o
// webhook recusou por valor entrava aqui depois, por status. ----------------

for (const rota of ["payment", "order"] as const) {
  for (const caso of [
    { nome: "ausente", valor: undefined },
    { nome: "nulo", valor: null },
    { nome: "NaN (JSON nulo)", valor: NaN },
    { nome: "infinito (JSON nulo)", valor: Infinity },
    { nome: "string NaN", valor: "NaN" },
    { nome: "string ilegível", valor: "sem valor" },
    { nome: "string vazia", valor: "" },
    { nome: "zero", valor: 0 },
  ]) {
    Deno.test(`valor estrito — cron ${rota}: MP ${caso.nome} -> não confirma, alerta registrado`, async () => {
      const registro = { chamadasConfirmar: [], chamouCandidatos: false, chamadasAviso: [] };
      const id = rota === "payment" ? "88888" : "ORDTSTVALORESTRITO";
      const supabase = clienteFalso({ candidatos: [{ order_id: UUID_PEDIDO_1, gateway_payment_id: id }], registro });
      const corpoMp = rota === "payment"
        ? { id: 88888, status: "approved", transaction_amount: caso.valor }
        : { id, status: "processed", status_detail: "accredited", total_amount: caso.valor };
      const alertas: unknown[] = [];
      const resposta = await handler(requisicaoComSegredo(SEGREDO), {
        supabase,
        fetchImpl: fetchConsulta(200, corpoMp),
        enviarPushContado: async ({ aviso }) => { alertas.push(aviso); return 1; },
      });
      const corpo = await resposta.json();
      assertEquals(resposta.status, 200);
      assertEquals(corpo.confirmados, 0);
      assertEquals(corpo.ignorados, 1);
      assertEquals(corpo.falhas, 0);
      assertEquals(registro.chamadasConfirmar.length, 0);
      assertEquals(alertas.length, 1);
      assertEquals(registro.chamadasAviso.map((c) => c.nome), ["reservar_aviso_ao_lojista", "confirmar_aviso_ao_lojista"]);
    });
  }

  for (const total of [0, null, NaN, Infinity, -1, "ilegível", "", true, {}]) {
    Deno.test(`valor estrito — cron ${rota}: total do pedido ${String(total)} -> não confirma, alerta registrado`, async () => {
      const registro = { chamadasConfirmar: [], chamouCandidatos: false, chamadasAviso: [] };
      const id = rota === "payment" ? "88888" : "ORDTSTVALORESTRITO";
      const supabase = clienteFalso({ candidatos: [{ order_id: UUID_PEDIDO_1, gateway_payment_id: id }], pedidoTotal: total, registro });
      const corpoMp = rota === "payment"
        ? { id: 88888, status: "approved", transaction_amount: 149.9 }
        : { id, status: "processed", status_detail: "accredited", total_amount: "149.90" };
      const alertas: unknown[] = [];
      const resposta = await handler(requisicaoComSegredo(SEGREDO), {
        supabase,
        fetchImpl: fetchConsulta(200, corpoMp),
        enviarPushContado: async ({ aviso }) => { alertas.push(aviso); return 1; },
      });
      const corpo = await resposta.json();
      assertEquals(resposta.status, 200);
      assertEquals(corpo.confirmados, 0);
      assertEquals(corpo.ignorados, 1);
      assertEquals(registro.chamadasConfirmar.length, 0);
      assertEquals(alertas.length, 1);
      assertEquals(registro.chamadasAviso[0].args.p_chave, `valor_nao_conferido:${UUID_PEDIDO_1}:${id}`);
      // O mesmo número que o painel mostra no cartão do pedido (6 últimos, maiúsculas).
      assertEquals((alertas[0] as { body: string }).body.startsWith(`#${UUID_PEDIDO_1.slice(-6).toUpperCase()} · `), true);
    });
  }

  Deno.test(`valor estrito — cron ${rota}: pedido zero e MP zero nunca confirmam pagamento`, async () => {
    const registro = { chamadasConfirmar: [], chamouCandidatos: false, chamadasAviso: [] };
    const id = rota === "payment" ? "88888" : "ORDTSTVALORESTRITO";
    const supabase = clienteFalso({ candidatos: [{ order_id: UUID_PEDIDO_1, gateway_payment_id: id }], pedidoTotal: 0, registro });
    const corpoMp = rota === "payment"
      ? { id: 88888, status: "approved", transaction_amount: 0 }
      : { id, status: "processed", status_detail: "accredited", total_amount: "0.00" };
    const alertas: unknown[] = [];
    const resposta = await handler(requisicaoComSegredo(SEGREDO), {
      supabase,
      fetchImpl: fetchConsulta(200, corpoMp),
      enviarPushContado: async ({ aviso }) => { alertas.push(aviso); return 1; },
    });
    const corpo = await resposta.json();
    assertEquals(resposta.status, 200);
    assertEquals(corpo.confirmados, 0);
    assertEquals(corpo.ignorados, 1);
    assertEquals(registro.chamadasConfirmar.length, 0);
    assertEquals(alertas.length, 1);
  });

  Deno.test(`valor estrito — cron ${rota}: novo ciclo sem valor deduplica alerta; consulta corrigida confirma`, async () => {
    const registro = { chamadasConfirmar: [], chamouCandidatos: false, chamadasAviso: [] };
    const id = rota === "payment" ? "88888" : "ORDTSTVALORESTRITO";
    const avisos = new Map<string, { enviado: boolean }>();
    const supabase = clienteFalso({ candidatos: [{ order_id: UUID_PEDIDO_1, gateway_payment_id: id }], registro, avisos });
    const alertas: unknown[] = [];
    for (const valor of [undefined, undefined, 149.9]) {
      const corpoMp = rota === "payment"
        ? { id: 88888, status: "approved", transaction_amount: valor }
        : { id, status: "processed", status_detail: "accredited", total_amount: valor };
      const resposta = await handler(requisicaoComSegredo(SEGREDO), {
        supabase,
        fetchImpl: fetchConsulta(200, corpoMp),
        enviarPushContado: async ({ aviso }) => { alertas.push(aviso); return 1; },
        enviarPush: async () => {},
        enviarComprovante: async () => {},
      });
      const corpo = await resposta.json();
      assertEquals(resposta.status, 200);
      assertEquals(corpo.confirmados, valor === undefined ? 0 : 1);
      assertEquals(corpo.ignorados, valor === undefined ? 1 : 0);
    }
    assertEquals(alertas.length, 1);
    assertEquals(registro.chamadasConfirmar.length, 1);
    assertEquals(registro.chamadasConfirmar[0].args.p_status, "pago");
  });
}

Deno.test("order aprovada com total_amount '10.00' de um pedido de R$ 149,90 -> NÃO confirma, ignorados:1", async () => {
  const registro = { chamadasConfirmar: [], chamouCandidatos: false };
  const idOrder = "ORDTST04VALORDIVERGENTE";
  const candidatos = [{ order_id: UUID_PEDIDO_1, gateway_payment_id: idOrder }];
  const supabase = clienteFalso({ candidatos, rpcConfirmarResultado: "pago", registro });
  const fetchImpl = fetchConsulta(200, {
    id: idOrder,
    status: "processed",
    status_detail: "accredited",
    total_amount: "10.00",
  });
  const req = requisicaoComSegredo(SEGREDO);

  const resposta = await handler(req, { supabase, fetchImpl });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  assertEquals(corpo.confirmados, 0, "pagamento divergente NÃO pode virar pedido pago pelo cron");
  assertEquals(corpo.ignorados, 1, "o divergente fica na fila, não é falha");
  assertEquals(registro.chamadasConfirmar.length, 0);
});

Deno.test("order aprovada com total_amount STRING '149.90' batendo o total -> confirma (a conversão de string não mente)", async () => {
  const registro = { chamadasConfirmar: [], chamouCandidatos: false };
  const idOrder = "ORDTST05VALORBATE";
  const candidatos = [{ order_id: UUID_PEDIDO_1, gateway_payment_id: idOrder }];
  const supabase = clienteFalso({ candidatos, rpcConfirmarResultado: "pago", registro });
  const fetchImpl = fetchConsulta(200, {
    id: idOrder,
    status: "processed",
    status_detail: "accredited",
    total_amount: "149.90",
  });
  const req = requisicaoComSegredo(SEGREDO);

  const resposta = await handler(req, { supabase, fetchImpl });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  assertEquals(corpo.confirmados, 1);
  assertEquals(registro.chamadasConfirmar.length, 1);
});

Deno.test("candidato legado (clássico) aprovado com transaction_amount 100 de um pedido de R$ 149,90 -> NÃO confirma", async () => {
  const registro = { chamadasConfirmar: [], chamouCandidatos: false };
  const candidatos = [{ order_id: UUID_PEDIDO_1, gateway_payment_id: "88888" }];
  const supabase = clienteFalso({ candidatos, rpcConfirmarResultado: "pago", registro });
  const fetchImpl = fetchConsulta(200, {
    id: 88888,
    status: "approved",
    transaction_amount: 100,
  });
  const req = requisicaoComSegredo(SEGREDO);

  const resposta = await handler(req, { supabase, fetchImpl });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  assertEquals(corpo.confirmados, 0);
  assertEquals(corpo.ignorados, 1);
  assertEquals(registro.chamadasConfirmar.length, 0);
});

Deno.test("leitura do total falha -> falhas:1, NÃO confirma (sem a linha, nenhuma conferência tem o que comparar)", async () => {
  const registro = { chamadasConfirmar: [], chamouCandidatos: false };
  const idOrder = "ORDTST06ERROLEITURA";
  const candidatos = [{ order_id: UUID_PEDIDO_1, gateway_payment_id: idOrder }];
  const supabase = clienteFalso({
    candidatos,
    rpcConfirmarResultado: "pago",
    erroFrom: { message: "conexão recusada" },
    registro,
  });
  const fetchImpl = fetchConsulta(200, {
    id: idOrder,
    status: "processed",
    status_detail: "accredited",
    total_amount: "149.90",
  });
  const req = requisicaoComSegredo(SEGREDO);

  const resposta = await handler(req, { supabase, fetchImpl });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  assertEquals(corpo.falhas, 1);
  assertEquals(corpo.confirmados, 0);
  assertEquals(registro.chamadasConfirmar.length, 0);
});

// --- 4. order ainda aguardando o PIX ser pago -----------------------------------

Deno.test("order ainda aguardando (action_required:waiting_transfer) -> RPC chamada com 'aguardando', ignorados:1", async () => {
  const registro = { chamadasConfirmar: [], chamouCandidatos: false };
  const idOrder = "ORDTST02WAITINGTRANSFER";
  const candidatos = [{ order_id: UUID_PEDIDO_1, gateway_payment_id: idOrder }];
  // RPC devolve 'ignorado': mesmo comportamento de um PIX ainda pendente no
  // caminho clássico — status desconhecido/ainda-não-pago não é falha.
  const supabase = clienteFalso({ candidatos, rpcConfirmarResultado: "ignorado", registro });
  const fetchImpl = fetchConsulta(200, {
    id: idOrder,
    status: "action_required",
    status_detail: "waiting_transfer",
  });
  const req = requisicaoComSegredo(SEGREDO);

  const resposta = await handler(req, { supabase, fetchImpl });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  assertEquals(corpo.confirmados, 0);
  assertEquals(corpo.ignorados, 1);
  assertEquals(corpo.falhas, 0);
  assertEquals(registro.chamadasConfirmar.length, 1);
  assertEquals(registro.chamadasConfirmar[0].args.p_status, "aguardando");
});

// --- 5. order expirada: armadilha 2 do brief --------------------------------------

Deno.test("order expirada (expired:expired) -> NÃO chama confirmar_pagamento, ignorados:1 (armadilha 2)", async () => {
  const registro = { chamadasConfirmar: [], chamouCandidatos: false };
  const idOrder = "ORDTST03EXPIRED";
  const candidatos = [{ order_id: UUID_PEDIDO_1, gateway_payment_id: idOrder }];
  const supabase = clienteFalso({ candidatos, registro });
  const fetchImpl = fetchConsulta(200, { id: idOrder, status: "expired", status_detail: "expired" });
  const req = requisicaoComSegredo(SEGREDO);

  const resposta = await handler(req, { supabase, fetchImpl });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  assertEquals(corpo.confirmados, 0);
  assertEquals(corpo.ignorados, 1);
  assertEquals(corpo.falhas, 0);
  // A prova real da armadilha: confirmar_pagamento NÃO pode ser chamada com
  // 'expirado' — a RPC não conhece esse valor e cairia no RETURN 'ignorado'
  // do fim, indistinguível no log de um 'ignorado' que passou pela RPC de
  // verdade.
  assertEquals(registro.chamadasConfirmar.length, 0);
});

// --- 5b. contestação (chargeback): o mapa compartilhado diz 'estornado', mas
// a reconciliação NÃO confirma — Lote A (04/10/2026, R1/A2). `confirmar_
// pagamento('estornado')` é IRREVERSÍVEL e, no pedido 'aguardando'+'pending',
// ainda CANCELA e devolve o estoque — para uma disputa que pode estar em
// análise (in_process) ou ter sido ganha pela loja (reimbursed). O ledger da
// contestação é do webhook; aqui o candidato só é ignorado, com log.

Deno.test("Lote A — order 'charged_back' (os três detalhes) -> NÃO chama confirmar_pagamento, ignorados:1", async () => {
  for (const detalhe of ["in_process", "settled", "reimbursed"]) {
    const registro = { chamadasConfirmar: [], chamouCandidatos: false };
    const idOrder = "ORDTST03CHARGEDBACK";
    const candidatos = [{ order_id: UUID_PEDIDO_1, gateway_payment_id: idOrder }];
    const supabase = clienteFalso({ candidatos, rpcConfirmarResultado: "estornado", registro });
    const fetchImpl = fetchConsulta(200, {
      id: idOrder,
      status: "charged_back",
      status_detail: detalhe,
      total_amount: "149.90",
    });
    const avisoReal = console.warn;
    console.warn = () => {};
    let resposta: Response;
    try {
      resposta = await handler(requisicaoComSegredo(SEGREDO), { supabase, fetchImpl });
    } finally {
      console.warn = avisoReal;
    }
    const corpo = await resposta.json();

    assertEquals(resposta.status, 200, detalhe);
    assertEquals(corpo.ignorados, 1, detalhe);
    assertEquals(corpo.falhas, 0, detalhe);
    assertEquals(registro.chamadasConfirmar.length, 0, `${detalhe}: confirmar_pagamento NÃO pode rodar para contestação`);
  }
});

Deno.test("Lote A — candidato LEGADO com pagamento clássico 'charged_back' -> NÃO chama confirmar_pagamento, ignorados:1", async () => {
  const registro = { chamadasConfirmar: [], chamouCandidatos: false };
  const candidatos = [{ order_id: UUID_PEDIDO_1, gateway_payment_id: "999" }];
  const supabase = clienteFalso({ candidatos, rpcConfirmarResultado: "estornado", registro });
  const fetchImpl = async (url: string) => {
    if (url.includes("/v1/payments/999")) {
      return new Response(
        JSON.stringify({ id: 999, status: "charged_back", status_detail: "in_process" }),
        { status: 200 },
      );
    }
    throw new Error(`fetch inesperado nos testes: ${url}`);
  };
  const avisoReal = console.warn;
  console.warn = () => {};
  let resposta: Response;
  try {
    resposta = await handler(requisicaoComSegredo(SEGREDO), { supabase, fetchImpl });
  } finally {
    console.warn = avisoReal;
  }
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  assertEquals(corpo.ignorados, 1);
  assertEquals(registro.chamadasConfirmar.length, 0);
});

// --- 6. candidato legado (id clássico) -> vai DIRETO para o endpoint clássico ----
//
// O MP não devolve 404 para um id sem forma de order — devolve 400
// `invalid_path_param` ("must begin with the prefix 'ORD'..."). Um id
// clássico (numérico) nunca tem forma de order, então bateria 400, nunca
// 404: o fallback por CÓDIGO DE ERRO nunca disparava de verdade. Estes
// testes prescindem inteiramente do código de erro e provam a discriminação
// pela FORMA do id: legado nunca toca `/v1/orders/`, order nunca toca
// `/v1/payments/`, e um roteamento errado quebraria alguma das asserções de
// URL abaixo mesmo que os contadores batessem por acidente.

Deno.test("candidato legado (id numérico) nunca chama /v1/orders/ — vai direto para consultarPagamento e confirma", async () => {
  const registro = { chamadasConfirmar: [], chamouCandidatos: false };
  const candidatos = [{ order_id: UUID_PEDIDO_1, gateway_payment_id: "999" }];
  const supabase = clienteFalso({ candidatos, rpcConfirmarResultado: "pago", registro });
  const urlsChamadas: string[] = [];
  const fetchImpl = async (url: string) => {
    urlsChamadas.push(url);
    if (url.includes("/v1/payments/999")) {
      return new Response(JSON.stringify({ id: 999, status: "approved", transaction_amount: 149.9 }), { status: 200 });
    }
    throw new Error(`fetch inesperado nos testes: ${url}`);
  };
  const req = requisicaoComSegredo(SEGREDO);

  const resposta = await handler(req, { supabase, fetchImpl });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  assertEquals(corpo.confirmados, 1);
  assertEquals(corpo.falhas, 0);
  assertEquals(registro.chamadasConfirmar.length, 1);
  assertEquals(registro.chamadasConfirmar[0].args.p_payment_id, "999");
  assertEquals(registro.chamadasConfirmar[0].args.p_status, "pago");
  // A prova real da armadilha: nenhuma chamada bateu em /v1/orders/ — o
  // candidato legado nunca gasta uma consulta na Orders API antes.
  assertEquals(urlsChamadas.length, 1);
  assertEquals(urlsChamadas.every((u) => !u.includes("/v1/orders/")), true);
});

Deno.test("candidato novo (ULID de order) nunca chama /v1/payments/ — vai direto para consultarOrder", async () => {
  const registro = { chamadasConfirmar: [], chamouCandidatos: false };
  const idOrder = "ORDTST01KZZ4D94WC79335A68CZ5NZ7X";
  const candidatos = [{ order_id: UUID_PEDIDO_1, gateway_payment_id: idOrder }];
  const supabase = clienteFalso({ candidatos, rpcConfirmarResultado: "pago", registro });
  const urlsChamadas: string[] = [];
  const fetchImpl = async (url: string) => {
    urlsChamadas.push(url);
    if (url.includes(`/v1/orders/${idOrder}`)) {
      return new Response(
        JSON.stringify({ id: idOrder, status: "processed", total_amount: "149.90", status_detail: "accredited" }),
        { status: 200 },
      );
    }
    throw new Error(`fetch inesperado nos testes: ${url}`);
  };
  const req = requisicaoComSegredo(SEGREDO);

  const resposta = await handler(req, { supabase, fetchImpl });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  assertEquals(corpo.confirmados, 1);
  assertEquals(urlsChamadas.length, 1);
  assertEquals(urlsChamadas.every((u) => !u.includes("/v1/payments/")), true);
});

// SENTINELA na vaga (`verificando:...`, Achado B2). Até 30/09/2026 este
// candidato era só IGNORADO, sem chamar o MP. A auditoria de 30/09/2026 do
// cartão da proxima/base (item 2) achou o buraco: um cartão CAPTURADO atrás
// do sentinela, com a notificação do webhook perdida, expirava sem registro.
// Agora a reconciliação BUSCA as orders de cartão do pedido e adota SÓ a
// capturada; os testes abaixo provam as duas metades — adota o capturado, e
// não mexe em nada no resto.
//
// Continua valendo a 2ª metade do cenário Q4b (B2, 5ª revisão de risco):
// `buscarOrdersDoPedido` filtra por `external_reference === pedidoId` DEPOIS
// da resposta — a order aprovada de OUTRO pedido nunca é adotada (teste
// "order capturada de OUTRO pedido", abaixo).
const SENTINELA_1 = `verificando:${UUID_PEDIDO_1}:c0`;

function orderDeCartao(overrides: Record<string, unknown> = {}) {
  return {
    id: "ORDTST01CARTAOCAPTURADO",
    external_reference: UUID_PEDIDO_1,
    status: "processed",
    status_detail: "accredited",
    total_amount: "149.90",
    date_created: "2026-09-30T12:00:00.000Z",
    transactions: {
      payments: [{ status: "processed", payment_method: { id: "visa", type: "credit_card", installments: 3 } }],
    },
    ...overrides,
  };
}

/** Busca (`GET /v1/orders?...`) devolve `resultadoBusca`; reconsulta por id
 * (`GET /v1/orders/<id>`) devolve `orderReconsultada`. */
function fetchSentinela(
  resultadoBusca: { status: number; corpo: unknown },
  orderReconsultada: Record<string, unknown> | null,
  urls: string[],
) {
  return async (url: string) => {
    urls.push(String(url));
    if (String(url).includes("/v1/orders?")) {
      return new Response(JSON.stringify(resultadoBusca.corpo), { status: resultadoBusca.status });
    }
    if (orderReconsultada && String(url).includes("/v1/orders/")) {
      return new Response(JSON.stringify(orderReconsultada), { status: 200 });
    }
    throw new Error(`fetch inesperado: ${url}`);
  };
}

Deno.test("sentinela com cartão CAPTURADO no MP -> adota (grava id, forma e parcelas no lugar do sentinela) e CONFIRMA", async () => {
  const registro = { chamadasConfirmar: [], chamouCandidatos: false, adocoesPedido: [] as any[] };
  const candidatos = [{ order_id: UUID_PEDIDO_1, gateway_payment_id: SENTINELA_1 }];
  const supabase = clienteFalso({ candidatos, registro });
  const urls: string[] = [];
  const fetchImpl = fetchSentinela({ status: 200, corpo: { results: [orderDeCartao()] } }, orderDeCartao(), urls);

  const resposta = await handler(requisicaoComSegredo(SEGREDO), { supabase, fetchImpl });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  assertEquals(registro.adocoesPedido.length, 1);
  assertEquals(registro.adocoesPedido[0].valores.gateway_payment_id, "ORDTST01CARTAOCAPTURADO");
  assertEquals(registro.adocoesPedido[0].valores.metodo_online, "credito");
  assertEquals(registro.adocoesPedido[0].valores.parcelas, 3);
  // Nunca sobrescreve: o WHERE exige o MESMO sentinela.
  assertEquals(registro.adocoesPedido[0].filtros, [["id", UUID_PEDIDO_1], ["gateway_payment_id", SENTINELA_1]]);
  // Depois da adoção, o laço normal decide: reconsulta por id e confirma
  // com o id REAL, nunca com o sentinela.
  assertEquals(registro.chamadasConfirmar.length, 1);
  assertEquals(registro.chamadasConfirmar[0].args.p_payment_id, "ORDTST01CARTAOCAPTURADO");
  assertEquals(registro.chamadasConfirmar[0].args.p_status, "pago");
  assertEquals(corpo.confirmados, 1);
  assertEquals(urls.some((u) => u.includes("verificando")), false);
});

Deno.test("sentinela: cartão EM ANÁLISE, busca vazia, busca falhando ou só orders mortas -> nada adotado, nada confirmado, ignorado", async () => {
  const cenarios: Array<[string, { status: number; corpo: unknown }]> = [
    ["em análise", { status: 200, corpo: { results: [orderDeCartao({ status: "processing", status_detail: "in_process" })] } }],
    ["busca vazia", { status: 200, corpo: { results: [] } }],
    ["busca falhou", { status: 500, corpo: { message: "internal_error" } }],
    ["só morta", { status: 200, corpo: { results: [orderDeCartao({ status: "failed", status_detail: "failed" })] } }],
  ];
  for (const [nome, resultadoBusca] of cenarios) {
    const registro = { chamadasConfirmar: [], chamouCandidatos: false, adocoesPedido: [] as any[] };
    const candidatos = [{ order_id: UUID_PEDIDO_1, gateway_payment_id: SENTINELA_1 }];
    const supabase = clienteFalso({ candidatos, registro });
    const fetchImpl = fetchSentinela(resultadoBusca, null, []);
    const console_error = console.error;
    console.error = () => {};
    let corpo: Record<string, unknown>;
    try {
      const resposta = await handler(requisicaoComSegredo(SEGREDO), { supabase, fetchImpl });
      assertEquals(resposta.status, 200, nome);
      corpo = await resposta.json();
    } finally {
      console.error = console_error;
    }
    assertEquals(registro.adocoesPedido.length, 0, nome);
    assertEquals(registro.chamadasConfirmar.length, 0, nome);
    assertEquals(corpo.ignorados, 1, nome);
    assertEquals(corpo.falhas, 0, nome);
  }
});

Deno.test("sentinela: capturada na BUSCA mas a RECONSULTA diz estorno parcial ou valor divergente -> NÃO adota (vaga fica com o sentinela), não confirma", async () => {
  // Revisão de 30/09/2026 (MENOR 1): adotar uma order que o laço nunca vai
  // confirmar tirava o sentinela da vaga — e o webhook do cartão certo caía
  // em `cartao_divergente`. A régua é a MESMA da adoção do webhook.
  const cenarios: Array<[string, Record<string, unknown>]> = [
    ["estorno parcial", orderDeCartao({ status_detail: "partially_refunded" })],
    ["valor divergente", orderDeCartao({ total_amount: "10.00" })],
  ];
  for (const [nome, reconsultada] of cenarios) {
    const registro = { chamadasConfirmar: [], chamouCandidatos: false, adocoesPedido: [] as any[] };
    const candidatos = [{ order_id: UUID_PEDIDO_1, gateway_payment_id: SENTINELA_1 }];
    const supabase = clienteFalso({ candidatos, registro });
    const fetchImpl = fetchSentinela({ status: 200, corpo: { results: [orderDeCartao()] } }, reconsultada, []);
    const console_error = console.error;
    console.error = () => {};
    let corpo: Record<string, unknown>;
    try {
      const resposta = await handler(requisicaoComSegredo(SEGREDO), { supabase, fetchImpl });
      assertEquals(resposta.status, 200, nome);
      corpo = await resposta.json();
    } finally {
      console.error = console_error;
    }
    assertEquals(registro.adocoesPedido.length, 0, nome);
    assertEquals(registro.chamadasConfirmar.length, 0, nome);
    assertEquals(corpo.ignorados, 1, nome);
    assertEquals(corpo.falhas, 0, nome);
  }
});

Deno.test("sentinela: order capturada de OUTRO pedido (MP ignorou o filtro) NUNCA é adotada", async () => {
  const registro = { chamadasConfirmar: [], chamouCandidatos: false, adocoesPedido: [] as any[] };
  const candidatos = [{ order_id: UUID_PEDIDO_1, gateway_payment_id: SENTINELA_1 }];
  const supabase = clienteFalso({ candidatos, registro });
  const fetchImpl = fetchSentinela(
    { status: 200, corpo: { results: [orderDeCartao({ external_reference: "outro-pedido" })] } },
    null,
    [],
  );
  const resposta = await handler(requisicaoComSegredo(SEGREDO), { supabase, fetchImpl });
  const corpo = await resposta.json();
  assertEquals(registro.adocoesPedido.length, 0);
  assertEquals(registro.chamadasConfirmar.length, 0);
  assertEquals(corpo.ignorados, 1);
});

Deno.test("sentinela: vaga trocada entre a busca e o UPDATE (WHERE não casa) -> não confirma nada neste ciclo", async () => {
  const registro = { chamadasConfirmar: [], chamouCandidatos: false, adocoesPedido: [] as any[] };
  const candidatos = [{ order_id: UUID_PEDIDO_1, gateway_payment_id: SENTINELA_1 }];
  const supabase = clienteFalso({ candidatos, registro, adocaoGravou: false });
  const fetchImpl = fetchSentinela({ status: 200, corpo: { results: [orderDeCartao()] } }, orderDeCartao(), []);
  const resposta = await handler(requisicaoComSegredo(SEGREDO), { supabase, fetchImpl });
  const corpo = await resposta.json();
  assertEquals(registro.adocoesPedido.length, 1);
  assertEquals(registro.chamadasConfirmar.length, 0);
  assertEquals(corpo.ignorados, 1);
});

Deno.test("sentinela: falha de BANCO na adoção conta como falha (candidato volta no próximo ciclo), nunca confirma", async () => {
  const registro = { chamadasConfirmar: [], chamouCandidatos: false, adocoesPedido: [] as any[] };
  const candidatos = [{ order_id: UUID_PEDIDO_1, gateway_payment_id: SENTINELA_1 }];
  const supabase = clienteFalso({ candidatos, registro, erroAdocao: { message: "deadlock" } });
  const fetchImpl = fetchSentinela({ status: 200, corpo: { results: [orderDeCartao()] } }, orderDeCartao(), []);
  const console_error = console.error;
  console.error = () => {};
  try {
    const resposta = await handler(requisicaoComSegredo(SEGREDO), { supabase, fetchImpl });
    const corpo = await resposta.json();
    assertEquals(corpo.falhas, 1);
  } finally {
    console.error = console_error;
  }
  assertEquals(registro.chamadasConfirmar.length, 0);
});

Deno.test("candidato legado pago (approved) é confirmado como pago_apos_expirar, sem tocar a Orders API", async () => {
  const registro = { chamadasConfirmar: [], chamouCandidatos: false };
  const candidatos = [{ order_id: UUID_PEDIDO_1, gateway_payment_id: "555" }];
  const supabase = clienteFalso({ candidatos, rpcConfirmarResultado: "pago_apos_expirar", registro });
  const urlsChamadas: string[] = [];
  const fetchImpl = async (url: string) => {
    urlsChamadas.push(url);
    return new Response(JSON.stringify({ id: 555, status: "approved", transaction_amount: 149.9 }), { status: 200 });
  };
  const req = requisicaoComSegredo(SEGREDO);

  const resposta = await handler(req, { supabase, fetchImpl });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  assertEquals(corpo.confirmados, 1);
  assertEquals(registro.chamadasConfirmar.length, 1);
  // Status que a RPC RECEBE é o mapeado ('pago'), não o resultado que ela
  // devolve ('pago_apos_expirar') — a RPC decide a transição sob FOR UPDATE.
  assertEquals(registro.chamadasConfirmar[0].args.p_status, "pago");
  assertEquals(urlsChamadas.length, 1);
  assertEquals(urlsChamadas[0].includes("/v1/payments/555"), true);
});

// --- 7. candidato legado recusado pelo clássico -> falha, sem tentar Orders -----

Deno.test("candidato legado recusado pelo endpoint clássico (400 ou 404) conta falha, sem NUNCA tentar a Orders API", async () => {
  for (const statusRecusa of [400, 404]) {
    const registro = { chamadasConfirmar: [], chamouCandidatos: false };
    const candidatos = [{ order_id: UUID_PEDIDO_1, gateway_payment_id: "888" }];
    const supabase = clienteFalso({ candidatos, registro });
    const urlsChamadas: string[] = [];
    const fetchImpl = async (url: string) => {
      urlsChamadas.push(url);
      return new Response(JSON.stringify({ message: "recusado" }), { status: statusRecusa });
    };
    const req = requisicaoComSegredo(SEGREDO);

    const resposta = await handler(req, { supabase, fetchImpl });
    const corpo = await resposta.json();

    assertEquals(resposta.status, 200, `status HTTP da recusa: ${statusRecusa}`);
    assertEquals(corpo.falhas, 1, `status HTTP da recusa: ${statusRecusa}`);
    assertEquals(corpo.confirmados, 0, `status HTTP da recusa: ${statusRecusa}`);
    assertEquals(registro.chamadasConfirmar.length, 0, `status HTTP da recusa: ${statusRecusa}`);
    assertEquals(urlsChamadas.length, 1, `status HTTP da recusa: ${statusRecusa}`);
    assertEquals(
      urlsChamadas.every((u) => !u.includes("/v1/orders/")),
      true,
      `status HTTP da recusa: ${statusRecusa}`,
    );
  }
});

// --- 8. erro de rede num candidato não impede o seguinte --------------------------

Deno.test("erro de rede na consulta de um candidato não impede o seguinte", async () => {
  const registro = { chamadasConfirmar: [], chamouCandidatos: false };
  const candidatos = [
    { order_id: UUID_PEDIDO_1, gateway_payment_id: "ORDTST04NETFAIL" },
    { order_id: UUID_PEDIDO_2, gateway_payment_id: "ORDTST05NETOK" },
  ];
  const supabase = clienteFalso({ candidatos, rpcConfirmarResultado: "pago", registro });
  const fetchImpl = async (url: string, _init?: RequestInit) => {
    // consultarOrder tem try/catch próprio em volta do fetch e devolve
    // { ok: false, status: 0 } — não é um throw que escapa até o handler.
    if (url.includes("ORDTST04NETFAIL")) throw new Error("timeout de rede");
    if (url.includes("ORDTST05NETOK")) {
      return new Response(
        JSON.stringify({ id: "ORDTST05NETOK", status: "processed", total_amount: "149.90", status_detail: "accredited" }),
        { status: 200 },
      );
    }
    throw new Error(`fetch inesperado nos testes: ${url}`);
  };
  const req = requisicaoComSegredo(SEGREDO);

  const resposta = await handler(req, { supabase, fetchImpl });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  assertEquals(corpo.verificados, 2);
  assertEquals(corpo.falhas, 1);
  assertEquals(corpo.confirmados, 1);
  assertEquals(registro.chamadasConfirmar.length, 1);
});

// --- 9. confirmar_pagamento rejeita para um candidato, o outro continua ----------

Deno.test("confirmar_pagamento rejeita para um candidato e o outro é processado assim mesmo", async () => {
  const chamadasConfirmar: Array<{ args: Record<string, unknown> }> = [];
  let chamadasRpcConfirmar = 0;
  const candidatos = [
    { order_id: UUID_PEDIDO_1, gateway_payment_id: "ORDTST06A" },
    { order_id: UUID_PEDIDO_2, gateway_payment_id: "ORDTST06B" },
  ];
  const supabase = {
    rpc: async (nome: string, args?: Record<string, unknown>) => {
      if (nome === "pagamentos_a_reconciliar") return { data: candidatos, error: null };
      if (nome === "confirmar_pagamento") {
        chamadasRpcConfirmar++;
        chamadasConfirmar.push({ args: args ?? {} });
        // O primeiro candidato (ORDTST06A) rejeita (LANÇA, não devolve
        // {error}); o segundo (ORDTST06B) tem que ser processado mesmo assim
        // — prova de que o try/catch por candidato cobre a chamada de
        // confirmar_pagamento, não só a consulta ao MP.
        if (chamadasRpcConfirmar === 1) throw new Error("conexão com o banco perdida");
        return { data: "pago", error: null };
      }
      throw new Error(`rpc inesperada nos testes: ${nome}`);
    },
    // Conferência de valor (laudo 31/08): o handler lê o total do pedido
    // antes de confirmar. Total que BATE — o intent deste teste é a
    // continuidade após rejeição da RPC, não a conferência.
    from(_tabela: string) {
      return {
        select(_colunas: string) {
          return {
            eq(_coluna: string, _valor: unknown) {
              return {
                maybeSingle: async () => ({ data: { total: 149.9, total_amount: null }, error: null }),
              };
            },
          };
        },
      };
    },
  };
  const fetchImpl = async (url: string) =>
    new Response(
      JSON.stringify({
        id: url.includes("ORDTST06A") ? "ORDTST06A" : "ORDTST06B",
        status: "processed",
        total_amount: "149.90",
        status_detail: "accredited",
      }),
      { status: 200 },
    );
  const req = requisicaoComSegredo(SEGREDO);

  const resposta = await handler(req, { supabase, fetchImpl });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  assertEquals(corpo.verificados, 2);
  assertEquals(corpo.falhas, 1);
  assertEquals(corpo.confirmados, 1);
  assertEquals(chamadasConfirmar.length, 2);
});

// --- 10. par status:status_detail fora do MAPA_STATUS_ORDER ----------------------

Deno.test("par status:status_detail fora do mapa -> não some da contagem: ignorados:1, confirmar_pagamento NÃO chamada", async () => {
  const registro = { chamadasConfirmar: [], chamouCandidatos: false };
  const idOrder = "ORDTST07DESCONHECIDO";
  const candidatos = [{ order_id: UUID_PEDIDO_1, gateway_payment_id: idOrder }];
  const supabase = clienteFalso({ candidatos, registro });
  // Par real na sintaxe da Orders API, mas fora de MAPA_STATUS_ORDER —
  // mapearStatusOrder tem que devolver null, nunca um palpite.
  const fetchImpl = fetchConsulta(200, { id: idOrder, status: "processing", status_detail: "algo_novo_do_mp" });
  const req = requisicaoComSegredo(SEGREDO);

  const resposta = await handler(req, { supabase, fetchImpl });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  assertEquals(corpo.verificados, 1);
  assertEquals(corpo.confirmados, 0);
  assertEquals(corpo.ignorados, 1);
  assertEquals(corpo.falhas, 0);
  assertEquals(registro.chamadasConfirmar.length, 0);
});

// --- 11. busca de candidatos fora de qualquer try ---------------------------------

Deno.test("pagamentos_a_reconciliar devolve {error} -> 500", async () => {
  const registro = { chamadasConfirmar: [], chamouCandidatos: false };
  const supabase = clienteFalso({ erroCandidatos: { message: "erro de banco" }, registro });
  const req = requisicaoComSegredo(SEGREDO);

  const resposta = await handler(req, { supabase });

  assertEquals(resposta.status, 500);
});

Deno.test("pagamentos_a_reconciliar rejeita (erro de rede) -> 500, não escapa do handler", async () => {
  const supabase = {
    rpc: async (nome: string) => {
      if (nome === "pagamentos_a_reconciliar") throw new Error("timeout de rede");
      throw new Error(`rpc inesperada nos testes: ${nome}`);
    },
  };
  const req = requisicaoComSegredo(SEGREDO);

  const resposta = await handler(req, { supabase });

  assertEquals(resposta.status, 500);
});

// --- 12. invariante da soma, com candidatos mistos --------------------------------

Deno.test("invariante confirmados + ignorados + falhas === verificados, com candidatos mistos", async () => {
  const registro = { chamadasConfirmar: [] as Array<{ args: Record<string, unknown> }>, chamouCandidatos: false };
  const candidatos = [
    { order_id: "10000000-0000-4000-8000-000000000001", gateway_payment_id: "ORDTST08APROVADO" }, // confirmado
    { order_id: "10000000-0000-4000-8000-000000000002", gateway_payment_id: "ORDTST09WAITING" }, // ignorado (RPC 'ignorado')
    { order_id: "10000000-0000-4000-8000-000000000003", gateway_payment_id: "ORDTST10EXPIRED" }, // ignorado (armadilha 2, sem RPC)
    { order_id: "10000000-0000-4000-8000-000000000004", gateway_payment_id: "777" }, // legado -> confirmado via clássico, direto
    { order_id: "10000000-0000-4000-8000-000000000005", gateway_payment_id: "666" }, // legado recusado pelo clássico -> falha
    { order_id: "10000000-0000-4000-8000-000000000006", gateway_payment_id: "ORDTST11NET" }, // erro de rede -> falha
  ];

  const supabase = {
    rpc: async (nome: string, args?: Record<string, unknown>) => {
      if (nome === "pagamentos_a_reconciliar") return { data: candidatos, error: null };
      if (nome === "confirmar_pagamento") {
        registro.chamadasConfirmar.push({ args: args ?? {} });
        if (args?.p_payment_id === "ORDTST08APROVADO" || args?.p_payment_id === "777") {
          return { data: "pago", error: null };
        }
        return { data: "ignorado", error: null };
      }
      throw new Error(`rpc inesperada nos testes: ${nome}`);
    },
    // Conferência de valor (laudo 31/08): total que BATE para os candidatos
    // aprovados — o intent deste teste é a INVARIANTE da soma, não a
    // conferência (os MPs mockados não trazem valor, então ela nem roda,
    // exceto 777 aprovado, que bate com 149.9 e confirma).
    from(_tabela: string) {
      return {
        select(_colunas: string) {
          return {
            eq(_coluna: string, _valor: unknown) {
              return {
                maybeSingle: async () => ({ data: { total: 149.9, total_amount: null }, error: null }),
              };
            },
          };
        },
      };
    },
  };

  // Os candidatos legados (777, 666) só têm resposta cadastrada para
  // /v1/payments/ — se o roteamento por forma regredisse para o código de
  // erro antigo (e tentasse /v1/orders/ primeiro), o fetch lançaria "fetch
  // inesperado" e o teste cairia por causa raiz clara, não por um contador
  // batendo por acidente.
  const urlsChamadas: string[] = [];
  const fetchImpl = async (url: string) => {
    urlsChamadas.push(url);
    if (url.includes("/v1/orders/ORDTST08APROVADO")) {
      return new Response(
        JSON.stringify({ id: "ORDTST08APROVADO", status: "processed", total_amount: "149.90", status_detail: "accredited" }),
        { status: 200 },
      );
    }
    if (url.includes("/v1/orders/ORDTST09WAITING")) {
      return new Response(
        JSON.stringify({ id: "ORDTST09WAITING", status: "action_required", status_detail: "waiting_transfer" }),
        { status: 200 },
      );
    }
    if (url.includes("/v1/orders/ORDTST10EXPIRED")) {
      return new Response(
        JSON.stringify({ id: "ORDTST10EXPIRED", status: "expired", status_detail: "expired" }),
        { status: 200 },
      );
    }
    if (url.includes("/v1/payments/777")) {
      return new Response(JSON.stringify({ id: 777, status: "approved", transaction_amount: 149.9 }), { status: 200 });
    }
    if (url.includes("/v1/payments/666")) {
      return new Response(JSON.stringify({ message: "payment not found" }), { status: 404 });
    }
    if (url.includes("ORDTST11NET")) {
      throw new Error("timeout de rede");
    }
    throw new Error(`fetch inesperado nos testes: ${url}`);
  };

  const req = requisicaoComSegredo(SEGREDO);
  const resposta = await handler(req, { supabase, fetchImpl });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  assertEquals(corpo.verificados, 6);
  assertEquals(corpo.confirmados, 2);
  assertEquals(corpo.ignorados, 2);
  assertEquals(corpo.falhas, 2);
  assertEquals(corpo.confirmados + corpo.ignorados + corpo.falhas, corpo.verificados);

  // A prova real da armadilha 2 num lote misto: confirmar_pagamento tem que
  // ser chamada para os 3 candidatos que chegam até ela — o aprovado, o
  // aguardando (a RPC decide 'ignorado', mas É chamada) e o legado 777 —, e
  // NUNCA para ORDTST10EXPIRED (filtrado antes da RPC), nem para os dois que
  // falham na consulta ao MP (666 e ORDTST11NET, que nem chegam ao status
  // mapeado). Sem esta asserção, remover o filtro de 'expirado' faria a RPC
  // ser chamada com p_status: 'expirado' e cair no RETURN 'ignorado' do fim
  // — os contadores do corpo ficariam idênticos, e só aqui isso apareceria.
  assertEquals(registro.chamadasConfirmar.length, 3);
  assertEquals(
    registro.chamadasConfirmar.map((c) => c.args.p_payment_id).sort(),
    ["777", "ORDTST08APROVADO", "ORDTST09WAITING"],
  );

  // Roteamento por FORMA, não por código de erro: os dois candidatos legados
  // (777, 666) nunca tocam /v1/orders/ — só o roteiro correto explica as
  // seis URLs abaixo (uma por candidato, nunca duas).
  assertEquals(urlsChamadas.length, 6);
  assertEquals(
    urlsChamadas.some((u) => u.includes("/v1/orders/777") || u.includes("/v1/orders/666")),
    false,
  );
});

// =============================================================================
// R1–R7 — Task 4 da frente "estorno pelo app": a reconciliação processa a
// fila de `order_refunds` pendentes (plano 20260907-plano-estorno-pelo-app.md;
// laudo 20260907-laudo-opus-pr438-t2-executor-do-estorno-rodada2.md — I-A/I-B).
//
// Todos os candidatos de PAGAMENTO ficam vazios nestes testes: o que se prova
// aqui é só o passo NOVO, isolado do laço que já existia.
// =============================================================================

const AGORA_MS = Date.now();
const UM_DIA_MS = 24 * 60 * 60 * 1000;
const PAID_AT_FRESCO = new Date(AGORA_MS - UM_DIA_MS).toISOString();

/**
 * Dublê de fetch por ROTA (método + trecho da URL) — mesmo padrão de
 * `estorno_test.ts`. Cada chamada fica registrada (URL, método, corpo, chave
 * de idempotência) para as asserções de R3/R4 (a chave é a mesma; nenhum POST
 * quando não deveria haver).
 */
function fetchDubleReconciliacao(
  rotas: Array<{ metodo: string; trecho: string; status: number; corpo: unknown }>,
) {
  const chamadas: Array<
    { url: string; metodo: string; chave?: string; corpoEnviado?: unknown }
  > = [];
  const f = (entrada: string | URL | Request, init?: RequestInit) => {
    const url = typeof entrada === "string"
      ? entrada
      : entrada instanceof URL
      ? entrada.href
      : entrada.url;
    const metodo = (init?.method ?? "GET").toUpperCase();
    const headers = (init?.headers ?? {}) as Record<string, string>;
    chamadas.push({
      url,
      metodo,
      chave: headers["X-Idempotency-Key"],
      corpoEnviado: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    const rota = rotas.find((r) => r.metodo === metodo && url.includes(r.trecho));
    return Promise.resolve(
      new Response(JSON.stringify(rota?.corpo ?? {}), { status: rota?.status ?? 500 }),
    );
  };
  return { f, chamadas };
}

function pedidoFrescoPara(extras: Partial<Record<string, unknown>> = {}) {
  return {
    id: "20000000-0000-4000-8000-000000000001",
    gateway_payment_id: "123456789",
    total: 100,
    valor_estornado: 0,
    payment_status: "pago",
    paid_at: PAID_AT_FRESCO,
    status: "cancelled",
    ...extras,
  };
}

Deno.test("R1 - linha solicitado antiga -> marca em_processamento, chama o executor e conclui pela RPC concluir_estorno", async () => {
  const registro = {
    chamadasConfirmar: [] as Array<{ args: Record<string, unknown> }>,
    chamouCandidatos: false,
    chamadasConcluirEstorno: [] as Array<{ args: Record<string, unknown> }>,
    atualizacoesOrderRefunds: [] as Array<
      { id: string; valores: Record<string, unknown>; statusFiltro: string[] }
    >,
  };
  const pedido = pedidoFrescoPara({ total: 50 });
  const supabase = clienteFalso({
    candidatos: [],
    registro,
    refundsPendentes: [
      { id: "r1", order_id: pedido.id, amount: 50, status: "solicitado", tentativas: 0, mp_refund_id: null },
    ],
    resolverPedidoFresco: (orderId) => (orderId === pedido.id ? pedido : null),
  });
  const mp = fetchDubleReconciliacao([
    { metodo: "POST", trecho: "/v1/payments/123456789/refunds", status: 201, corpo: { id: 999, status: "approved", amount: 50 } },
  ]);

  const resposta = await handler(requisicaoComSegredo(SEGREDO), { supabase, fetchImpl: mp.f });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  assertEquals(corpo.estornos, { vistos: 1, concluidos: 1, adiados: 0, falhos: 0 });
  assertEquals(registro.chamadasConcluirEstorno.length, 1);
  assertEquals(registro.chamadasConcluirEstorno[0].args.p_refund_id, "r1");
  assertEquals(registro.chamadasConcluirEstorno[0].args.p_mp_refund_id, "999");
  // A marca: UPDATE condicional em 'solicitado' antes de chamar o MP.
  assertEquals(
    registro.atualizacoesOrderRefunds.some(
      (a) => a.id === "r1" && a.statusFiltro.includes("solicitado") && a.valores.status === "em_processamento",
    ),
    true,
  );
  assertEquals(mp.chamadas[0].chave, "r1");
});

Deno.test("R2 - linha em_processamento com consulta mostrando refund >= soma -> conclui SEM novo POST", async () => {
  const registro = {
    chamadasConfirmar: [] as Array<{ args: Record<string, unknown> }>,
    chamouCandidatos: false,
    chamadasConcluirEstorno: [] as Array<{ args: Record<string, unknown> }>,
    atualizacoesOrderRefunds: [] as Array<
      { id: string; valores: Record<string, unknown>; statusFiltro: string[] }
    >,
  };
  const pedido = pedidoFrescoPara({ total: 30, valor_estornado: 0 });
  const supabase = clienteFalso({
    candidatos: [],
    registro,
    refundsPendentes: [
      { id: "r2", order_id: pedido.id, amount: 30, status: "em_processamento", tentativas: 1, mp_refund_id: null },
    ],
    resolverPedidoFresco: (orderId) => (orderId === pedido.id ? pedido : null),
  });
  // SÓ a rota de GET existe: se o código tentasse repetir o POST, o dublê
  // devolveria 500 (rota inexistente) e o teste cairia por causa clara.
  const mp = fetchDubleReconciliacao([
    { metodo: "GET", trecho: "/v1/payments/123456789", status: 200, corpo: { id: 123456789, status: "approved", transaction_amount_refunded: 30 } },
  ]);

  const resposta = await handler(requisicaoComSegredo(SEGREDO), { supabase, fetchImpl: mp.f });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  assertEquals(corpo.estornos, { vistos: 1, concluidos: 1, adiados: 0, falhos: 0 });
  assertEquals(mp.chamadas.length, 1);
  assertEquals(mp.chamadas[0].metodo, "GET");
  assertEquals(registro.chamadasConcluirEstorno.length, 1);
});

Deno.test("R3 - consulta sem refund e tentativas=2 -> repete o POST com a MESMA chave (X-Idempotency-Key = id)", async () => {
  const registro = {
    chamadasConfirmar: [] as Array<{ args: Record<string, unknown> }>,
    chamouCandidatos: false,
    chamadasConcluirEstorno: [] as Array<{ args: Record<string, unknown> }>,
    atualizacoesOrderRefunds: [] as Array<
      { id: string; valores: Record<string, unknown>; statusFiltro: string[] }
    >,
  };
  const pedido = pedidoFrescoPara({ total: 20, valor_estornado: 0 });
  const supabase = clienteFalso({
    candidatos: [],
    registro,
    refundsPendentes: [
      { id: "r3", order_id: pedido.id, amount: 20, status: "em_processamento", tentativas: 2, mp_refund_id: null },
    ],
    resolverPedidoFresco: (orderId) => (orderId === pedido.id ? pedido : null),
  });
  const mp = fetchDubleReconciliacao([
    // GET da confirmação direta e da consulta do reenvio (A1, 15/10/2026): o
    // MP prova que NADA foi devolvido (acumulado 0, lista vazia) — só assim o
    // reenvio sai.
    {
      metodo: "GET",
      trecho: "/v1/payments/123456789",
      status: 200,
      corpo: { id: 123456789, status: "approved", transaction_amount_refunded: 0, refunds: [] },
    },
    // POST do retry: em_process (PIX em contingência) — não conclui, mas
    // prova que o retry aconteceu com a MESMA chave.
    { metodo: "POST", trecho: "/v1/payments/123456789/refunds", status: 201, corpo: { id: 555, status: "in_process" } },
  ]);

  const resposta = await handler(requisicaoComSegredo(SEGREDO), { supabase, fetchImpl: mp.f });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  // confirmação (GET), consulta do reenvio (GET) e só então o POST.
  assertEquals(mp.chamadas.map((c) => c.metodo), ["GET", "GET", "POST"]);
  assertEquals(mp.chamadas[2].chave, "r3");
  assertEquals(corpo.estornos.concluidos, 0);
  assertEquals(corpo.estornos.adiados, 1);
  // tentativas foi incrementada ANTES do retry (marca da nova tentativa).
  assertEquals(
    registro.atualizacoesOrderRefunds.some((a) => a.id === "r3" && a.valores.tentativas === 3),
    true,
  );
});

// ── A1 do crítico do reembolso A/B (15/10/2026): o robô não reenvia sem a
// consulta dizer `nao_achou`. A chave de idempotência do MP vale 24 h; depois
// dela, o reenvio de uma linha que já criou o reembolso no MP (resposta perdida)
// cria o SEGUNDO. Os dublês abaixo REPROVAM qualquer POST de reembolso: cada um
// é uma violação registrada (e respondida 201, como o MP responderia).

function mpQueReprovaPost(gets: Array<{ status: number; corpo: unknown }>) {
  const chamadas: Array<{ url: string; metodo: string; chave?: string }> = [];
  const violacoes: string[] = [];
  let i = 0;
  const f = (entrada: string | URL | Request, init?: RequestInit) => {
    const url = typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
    const metodo = (init?.method ?? "GET").toUpperCase();
    chamadas.push({ url, metodo, chave: ((init?.headers ?? {}) as Record<string, string>)["X-Idempotency-Key"] });
    if (metodo === "POST") {
      violacoes.push(url);
      return Promise.resolve(new Response(JSON.stringify({ id: 9999, status: "approved", amount: 20 }), { status: 201 }));
    }
    const r = gets[Math.min(i, gets.length - 1)];
    i++;
    return Promise.resolve(
      new Response(typeof r.corpo === "string" ? r.corpo : JSON.stringify(r.corpo), { status: r.status }),
    );
  };
  return { f, chamadas, violacoes };
}

function cenarioDeReenvio(extras: Record<string, unknown> = {}) {
  const registro = registroDoReenvio();
  const pedido = pedidoFrescoPara({ total: 200, valor_estornado: 0 });
  const supabase = clienteFalso({
    candidatos: [],
    registro,
    refundsPendentes: [{
      id: "rr1",
      order_id: pedido.id,
      amount: 20,
      status: "em_processamento",
      // Um envio anterior, carimbado (o POST do dia 1 cuja resposta se perdeu).
      tentativas: 1,
      criada_sob_autorizacao: true,
      post_autorizado_em: "2026-10-12T10:00:00.000Z",
      mp_refund_id: null,
      ...extras,
    }],
    resolverPedidoFresco: (orderId) => (orderId === pedido.id ? pedido : null),
  });
  return { registro, supabase };
}

function registroDoReenvio() {
  return {
    chamadasConfirmar: [] as Array<{ args: Record<string, unknown> }>,
    chamouCandidatos: false,
    chamadasConcluirEstorno: [] as Array<{ args: Record<string, unknown> }>,
    chamadasAutorizarPost: [] as Array<{ args: Record<string, unknown> }>,
    atualizacoesOrderRefunds: [] as Array<
      { id: string; valores: Record<string, unknown>; statusFiltro: string[] }
    >,
  };
}

const PAGAMENTO_SEM_ACUMULADO = { id: 123456789, status: "approved" };
const PAGAMENTO_SEM_REEMBOLSO = { id: 123456789, status: "approved", transaction_amount_refunded: 0, refunds: [] };
const PAGAMENTO_COM_REF1 = {
  id: 123456789,
  status: "approved",
  transaction_amount_refunded: 20,
  refunds: [{ id: 7001, status: "approved", amount: 20, date_created: "2026-10-12T10:00:05.000Z" }],
};

Deno.test("R3b (A1) - robô: consulta que NÃO sabe quanto já voltou (acumulado ausente) -> ZERO POST, linha adiada, motivo leigo", async () => {
  const { registro, supabase } = cenarioDeReenvio();
  const mp = mpQueReprovaPost([{ status: 200, corpo: PAGAMENTO_SEM_ACUMULADO }]);

  const resposta = await handler(requisicaoComSegredo(SEGREDO), { supabase, fetchImpl: mp.f });
  const corpo = await resposta.json();

  assertEquals(mp.violacoes, [], "nenhum POST de reembolso");
  assertEquals(mp.chamadas.map((c) => c.metodo), ["GET", "GET"], "confirmação + consulta do reenvio");
  assertEquals(corpo.estornos, { vistos: 1, concluidos: 0, adiados: 1, falhos: 0 });
  assertEquals(registro.chamadasAutorizarPost.length, 0, "o banco nem é perguntado: o carimbo não se renova");
  assertEquals(
    registro.atualizacoesOrderRefunds.some((a) => a.id === "rr1" && a.valores.ultimo_erro === MOTIVO_REENVIO_SEM_CONSULTA),
    true,
  );
});

for (const [nome, get] of [
  ["GET 500", { status: 500, corpo: { message: "erro" } }],
  ["corpo ilegível", { status: 200, corpo: "<html>gateway</html>" }],
] as Array<[string, { status: number; corpo: unknown }]>) {
  Deno.test(`R3c (A1) - robô: consulta indeterminada (${nome}) -> ZERO POST, adiada`, async () => {
    const { supabase } = cenarioDeReenvio();
    const mp = mpQueReprovaPost([get]);
    const corpo = await (await handler(requisicaoComSegredo(SEGREDO), { supabase, fetchImpl: mp.f })).json();
    assertEquals(mp.violacoes, []);
    assertEquals(corpo.estornos, { vistos: 1, concluidos: 0, adiados: 1, falhos: 0 });
  });
}

Deno.test("R3d (A1) - robô: a confirmação não fechou, mas a consulta do reenvio ACHA o REF1 do MP -> ZERO POST, adota o REF1 e conclui", async () => {
  const { registro, supabase } = cenarioDeReenvio();
  // 1º GET (confirmação): o MP ainda não lista nada; 2º (consulta do reenvio)
  // e 3º (confirmação da adoção): o REF1 aparece — a consistência eventual do MP.
  const mp = mpQueReprovaPost([
    { status: 200, corpo: PAGAMENTO_SEM_REEMBOLSO },
    { status: 200, corpo: PAGAMENTO_COM_REF1 },
  ]);

  const corpo = await (await handler(requisicaoComSegredo(SEGREDO), { supabase, fetchImpl: mp.f })).json();

  assertEquals(mp.violacoes, [], "nenhum POST: seria o REF2, dinheiro em dobro");
  assertEquals(corpo.estornos, { vistos: 1, concluidos: 1, adiados: 0, falhos: 0 });
  assertEquals(registro.chamadasConcluirEstorno.length, 1);
  assertEquals(registro.chamadasConcluirEstorno[0].args.p_refund_id, "rr1");
  assertEquals(registro.chamadasConcluirEstorno[0].args.p_mp_refund_id, "7001");
});

Deno.test("R3e (A1, controle) - robô: linha NOVA (solicitado, tentativas 0) envia como antes — POST direto, ZERO GET", async () => {
  const { registro, supabase } = cenarioDeReenvio({ status: "solicitado", tentativas: 0, post_autorizado_em: null });
  const mp = fetchDubleReconciliacao([
    { metodo: "POST", trecho: "/v1/payments/123456789/refunds", status: 201, corpo: { id: 999, status: "approved", amount: 20 } },
  ]);
  const corpo = await (await handler(requisicaoComSegredo(SEGREDO), { supabase, fetchImpl: mp.f })).json();
  assertEquals(mp.chamadas.map((c) => c.metodo), ["POST"]);
  assertEquals(mp.chamadas[0].chave, "rr1");
  assertEquals(corpo.estornos.concluidos, 1);
  assertEquals(registro.chamadasConcluirEstorno.length, 1);
});

// ── P1 do Codex no #888 (15/10/2026): o pré-voo inconclusivo (consulta antes do
// reenvio sem resposta clara) NÃO pode gastar tentativa. Sem isso, uma linha com
// tentativas 1 cujo 1º ciclo parou ANTES do POST chega ao teto (5) em quatro
// ciclos de MP confuso, sem nenhum envio, e fica presa para sempre — o ramo
// travado nunca reentra no executor, mesmo quando o MP volta a responder.
// Simulação COM ESTADO (a linha guarda tentativas, status e carimbo entre os
// ciclos; o UPDATE condicionado a `.eq("tentativas", n)` só pega se bater).

type CicloDoPrevoo = "inconclusivo" | "nao_achou" | "nao_achou_post_500";

async function ciclosDoPrevoo(ciclos: CicloDoPrevoo[]) {
  const pedido = pedidoFrescoPara({ total: 200, valor_estornado: 0 });
  const linha: Record<string, unknown> = {
    status: "em_processamento",
    // O 1º ciclo marcou e parou ANTES do POST (GET da transação caiu): sem carimbo.
    tentativas: 1,
    post_autorizado_em: null,
  };
  const historico: string[] = [];
  const violacoes: string[] = [];
  let posts = 0;
  for (const ciclo of ciclos) {
    if (linha.status !== "em_processamento") {
      historico.push(String(linha.status));
      continue;
    }
    const supabase = clienteFalso({
      candidatos: [],
      registro: registroDoReenvio(),
      refundsPendentes: [{
        id: "rp1",
        order_id: pedido.id,
        amount: 20,
        status: linha.status,
        tentativas: linha.tentativas,
        criada_sob_autorizacao: true,
        post_autorizado_em: linha.post_autorizado_em,
        mp_refund_id: null,
      }],
      resolverPedidoFresco: (orderId) => (orderId === pedido.id ? pedido : null),
      atualizarOrderRefunds: (_id, valores, statusFiltro, filtroEq) => {
        if (!statusFiltro.includes(String(linha.status))) return { data: [], error: null };
        if (filtroEq && linha[filtroEq[0]] !== filtroEq[1]) return { data: [], error: null };
        if (typeof valores.tentativas === "number") linha.tentativas = valores.tentativas;
        if (typeof valores.status === "string") linha.status = valores.status;
        return { data: [{ id: "rp1" }], error: null };
      },
      // O banco carimba o POST que autoriza (20261196000000).
      autorizarPost: () => {
        linha.post_autorizado_em = "2026-10-15T10:00:00.000Z";
        return { data: { decisao: "autorizado", pedido }, error: null };
      },
      aoConcluirEstorno: () => {
        linha.status = "concluido";
      },
    });
    const f = (entrada: string | URL | Request, init?: RequestInit) => {
      const url = typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
      const metodo = (init?.method ?? "GET").toUpperCase();
      if (metodo === "POST") {
        posts++;
        if (ciclo === "inconclusivo") violacoes.push(url);
        return Promise.resolve(
          ciclo === "nao_achou_post_500"
            ? new Response("{}", { status: 500 })
            : new Response(JSON.stringify({ id: 9999, status: "approved", amount: 20 }), { status: 201 }),
        );
      }
      const corpo = ciclo === "inconclusivo" ? PAGAMENTO_SEM_ACUMULADO : PAGAMENTO_SEM_REEMBOLSO;
      return Promise.resolve(new Response(JSON.stringify(corpo), { status: 200 }));
    };
    await handler(requisicaoComSegredo(SEGREDO), { supabase, fetchImpl: f });
    historico.push(`${linha.status}/t${linha.tentativas}`);
  }
  return { linha, historico, violacoes, posts: () => posts };
}

Deno.test("PREVOO-1 (P1 Codex) - linha com tentativas 1 sem carimbo, 8 ciclos de pré-voo inconclusivo: ZERO POST e o contador NÃO anda (nunca chega ao teto)", async () => {
  const r = await ciclosDoPrevoo(Array(8).fill("inconclusivo"));
  assertEquals(r.violacoes, [], "nenhum POST com a consulta sem resposta clara");
  assertEquals(r.historico, Array(8).fill("em_processamento/t1"));
});

Deno.test("PREVOO-2 (P1 Codex) - depois de 4 pré-voos inconclusivos, o MP prova que nada voltou: 1 POST sai e a devolução conclui", async () => {
  const r = await ciclosDoPrevoo(["inconclusivo", "inconclusivo", "inconclusivo", "inconclusivo", "nao_achou"]);
  assertEquals(r.violacoes, []);
  assertEquals(r.posts(), 1);
  assertEquals(r.linha.status, "concluido");
});

Deno.test("PREVOO-3 (controle) - linha cujo POST de verdade sai e falha (500) continua contando: trava em 5 e para de enviar", async () => {
  const r = await ciclosDoPrevoo(Array(7).fill("nao_achou_post_500"));
  assertEquals(r.historico, [
    "em_processamento/t2",
    "em_processamento/t3",
    "em_processamento/t4",
    "em_processamento/t5",
    "em_processamento/t5",
    "em_processamento/t5",
    "em_processamento/t5",
  ]);
  assertEquals(r.posts(), 4, "um POST por ciclo até o teto; depois só consulta");
});

Deno.test("R4 - tentativas=5 -> continua em_processamento (saldo reservado), SEM novo POST, ultimo_erro com o texto do teto (D2/BLOQUEIA-2)", async () => {
  const registro = {
    chamadasConfirmar: [] as Array<{ args: Record<string, unknown> }>,
    chamouCandidatos: false,
    chamadasConcluirEstorno: [] as Array<{ args: Record<string, unknown> }>,
    atualizacoesOrderRefunds: [] as Array<
      { id: string; valores: Record<string, unknown>; statusFiltro: string[] }
    >,
  };
  const pedido = pedidoFrescoPara({ total: 10, valor_estornado: 0 });
  const supabase = clienteFalso({
    candidatos: [],
    registro,
    refundsPendentes: [
      { id: "r4", order_id: pedido.id, amount: 10, status: "em_processamento", tentativas: 5, mp_refund_id: null },
    ],
    resolverPedidoFresco: (orderId) => (orderId === pedido.id ? pedido : null),
  });
  const mp = fetchDubleReconciliacao([
    { metodo: "GET", trecho: "/v1/payments/123456789", status: 200, corpo: { id: 123456789, status: "approved" } },
  ]);

  const resposta = await handler(requisicaoComSegredo(SEGREDO), { supabase, fetchImpl: mp.f });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  // D2/BLOQUEIA-2: `falhou` LIBERA o saldo reservado (solicitar_estorno só
  // reserva solicitado/em_processamento) — um teto sem veredito do MP nunca
  // pode terminar em `falhou` (2º POST com chave nova = pagamento em dobro).
  // Conta como adiado, nunca como falho.
  assertEquals(corpo.estornos, { vistos: 1, concluidos: 0, adiados: 1, falhos: 0 });
  // Só a consulta (GET) — nenhum POST depois do teto de 5 tentativas (m3).
  assertEquals(mp.chamadas.length, 1);
  assertEquals(mp.chamadas[0].metodo, "GET");
  const gravado = registro.atualizacoesOrderRefunds.find((a) => a.id === "r4");
  assertEquals(
    gravado?.valores.ultimo_erro,
    "não consegui confirmar a devolução no Mercado Pago depois de 5 tentativas; confira no painel do MP",
  );
  // A prova real do BLOQUEIA-2: o update NÃO grava `status` nenhum (m2) — a
  // linha continua em_processamento, o filtro condicional prova isso.
  assertEquals(gravado?.valores.status, undefined);
  assertEquals(gravado?.statusFiltro, ["em_processamento"]);
});

Deno.test("R5 - item que lança (pedido não encontrado) não impede o seguinte (falhos:1, o outro concluído)", async () => {
  const registro = {
    chamadasConfirmar: [] as Array<{ args: Record<string, unknown> }>,
    chamouCandidatos: false,
    chamadasConcluirEstorno: [] as Array<{ args: Record<string, unknown> }>,
    atualizacoesOrderRefunds: [] as Array<
      { id: string; valores: Record<string, unknown>; statusFiltro: string[] }
    >,
  };
  const pedidoBom = pedidoFrescoPara({ id: "20000000-0000-4000-8000-000000000002", total: 15 });
  const supabase = clienteFalso({
    candidatos: [],
    registro,
    refundsPendentes: [
      // 1ª linha: order_id sem pedido nenhum -> lança dentro do try do item.
      { id: "rSabotada", order_id: "20000000-0000-4000-8000-00000000dead", amount: 5, status: "solicitado", tentativas: 0, mp_refund_id: null },
      { id: "rBoa", order_id: pedidoBom.id, amount: 15, status: "solicitado", tentativas: 0, mp_refund_id: null },
    ],
    erroPedidoFrescoPorOrderId: new Map([["20000000-0000-4000-8000-00000000dead", { message: "erro de leitura" }]]),
    resolverPedidoFresco: (orderId) => (orderId === pedidoBom.id ? pedidoBom : null),
  });
  const mp = fetchDubleReconciliacao([
    { metodo: "POST", trecho: "/v1/payments/123456789/refunds", status: 201, corpo: { id: 321, status: "approved", amount: 15 } },
  ]);

  const resposta = await handler(requisicaoComSegredo(SEGREDO), { supabase, fetchImpl: mp.f });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  assertEquals(corpo.estornos, { vistos: 2, concluidos: 1, adiados: 0, falhos: 1 });
  assertEquals(registro.chamadasConcluirEstorno[0].args.p_refund_id, "rBoa");
});

Deno.test("R6 - linha atualizada há 30s NÃO é tocada (janela de 2 minutos evita disputar com a edge do clique)", async () => {
  const registro = {
    chamadasConfirmar: [] as Array<{ args: Record<string, unknown> }>,
    chamouCandidatos: false,
    chamadasConcluirEstorno: [] as Array<{ args: Record<string, unknown> }>,
    atualizacoesOrderRefunds: [] as Array<
      { id: string; valores: Record<string, unknown>; statusFiltro: string[] }
    >,
  };
  const pedido = pedidoFrescoPara();
  const trintaSegundosAtras = new Date(AGORA_MS - 30 * 1000).toISOString();
  const supabase = clienteFalso({
    candidatos: [],
    registro,
    refundsPendentes: [
      {
        id: "r6",
        order_id: pedido.id,
        amount: 10,
        status: "solicitado",
        tentativas: 0,
        mp_refund_id: null,
        updated_at: trintaSegundosAtras,
      },
    ],
    resolverPedidoFresco: (orderId) => (orderId === pedido.id ? pedido : null),
  });
  const mp = fetchDubleReconciliacao([]);

  const resposta = await handler(requisicaoComSegredo(SEGREDO), { supabase, fetchImpl: mp.f });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  assertEquals(corpo.estornos, { vistos: 0, concluidos: 0, adiados: 0, falhos: 0 });
  assertEquals(mp.chamadas.length, 0);
  assertEquals(registro.atualizacoesOrderRefunds.length, 0);
});

Deno.test("R7 - duas linhas do MESMO pedido no lote: a 1ª conclui e sobe valor_estornado; a 2ª só conclui se a consulta mostrar a SOMA das duas (I-B)", async () => {
  const registro = {
    chamadasConfirmar: [] as Array<{ args: Record<string, unknown> }>,
    chamouCandidatos: false,
    chamadasConcluirEstorno: [] as Array<{ args: Record<string, unknown> }>,
    atualizacoesOrderRefunds: [] as Array<
      { id: string; valores: Record<string, unknown>; statusFiltro: string[] }
    >,
  };
  const orderId = "20000000-0000-4000-8000-000000000099";
  // Estado do ledger SIMULADO: sobe quando a RPC concluir_estorno "grava" —
  // é o que torna a releitura FRESCA (dentro do laço, por item) observável:
  // sem ela, as duas iterações veriam sempre valor_estornado = 0.
  let valorEstornadoSimulado = 0;
  const AMOUNT_POR_LINHA: ReadonlyMap<string, number> = new Map([["rA", 30], ["rB", 20]]);

  const supabase = clienteFalso({
    candidatos: [],
    registro,
    refundsPendentes: [
      { id: "rA", order_id: orderId, amount: 30, status: "solicitado", tentativas: 0, mp_refund_id: null },
      { id: "rB", order_id: orderId, amount: 20, status: "solicitado", tentativas: 0, mp_refund_id: null },
    ],
    resolverPedidoFresco: (id) =>
      id === orderId
        ? pedidoFrescoPara({ id: orderId, total: 100, valor_estornado: valorEstornadoSimulado })
        : null,
    aoConcluirEstorno: (args) => {
      const refundId = String(args.p_refund_id);
      valorEstornadoSimulado += AMOUNT_POR_LINHA.get(refundId) ?? 0;
    },
  });

  let chamada = 0;
  const mp = { f: (_entrada: string | URL | Request, _init?: RequestInit) => {
    chamada++;
    // 1: POST de A -> aprovado direto (sem consulta).
    if (chamada === 1) {
      return Promise.resolve(new Response(JSON.stringify({ id: 111, status: "approved", amount: 30 }), { status: 201 }));
    }
    // 2: POST de B -> o MP diz "já estornado" (4296): manda confirmar.
    if (chamada === 2) {
      return Promise.resolve(new Response(JSON.stringify({ message: "erro", cause: [{ code: 4296 }] }), { status: 404 }));
    }
    // 3: GET de confirmação de B -> só os R$30 de A aparecem no MP; os R$20
    // de B nunca saíram (o cenário exato do achado I-B).
    return Promise.resolve(new Response(JSON.stringify({ id: 123456789, status: "approved", transaction_amount_refunded: 30 }), { status: 200 }));
  } };

  const resposta = await handler(requisicaoComSegredo(SEGREDO), { supabase, fetchImpl: mp.f });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  // A conclui; B NÃO conclui (o MP só confirma os R$30 de A — com a
  // releitura fresca, B exige 30+20=50 e falha; com snapshot velho B exigiria
  // só 0+20=20 e concluiria ERRADO, dobrando o ledger sem o dinheiro sair).
  assertEquals(corpo.estornos.concluidos, 1);
  assertEquals(corpo.estornos.falhos, 1);
  const desfechoB = registro.atualizacoesOrderRefunds.find((a) => a.id === "rB" && a.valores.status === "falhou");
  assertEquals(desfechoB !== undefined, true);
});

// =============================================================================
// R8 — complemento da T4 (merge com o conserto do PR #439): PIX = ORDER, e o
// cron precisa da MESMA injeção de `consultarTransacaoDaOrder` que a edge do
// clique já tem — sem ela `executarEstorno` devolve `tentar_depois` para
// sempre para toda linha de order (achado do laudo do PR #439).
// =============================================================================

Deno.test("R8 - linha solicitado de pedido PIX (gateway_payment_id de ORDER) -> consulta a transação, refunda pela order e conclui", async () => {
  const registro = {
    chamadasConfirmar: [] as Array<{ args: Record<string, unknown> }>,
    chamouCandidatos: false,
    chamadasConcluirEstorno: [] as Array<{ args: Record<string, unknown> }>,
    atualizacoesOrderRefunds: [] as Array<
      { id: string; valores: Record<string, unknown>; statusFiltro: string[] }
    >,
  };
  const pedido = pedidoFrescoPara({
    gateway_payment_id: "ORD01ABCDEFOLUIMWQKDXYZ01",
    total: 20,
    valor_estornado: 0,
  });
  const supabase = clienteFalso({
    candidatos: [],
    registro,
    refundsPendentes: [
      { id: "r8", order_id: pedido.id, amount: 20, status: "solicitado", tentativas: 0, mp_refund_id: null },
    ],
    resolverPedidoFresco: (orderId) => (orderId === pedido.id ? pedido : null),
  });
  const mp = fetchDubleReconciliacao([
    {
      metodo: "GET",
      trecho: "/v1/orders/ORD01ABCDEFOLUIMWQKDXYZ01",
      status: 200,
      corpo: {
        id: "ORD01ABCDEFOLUIMWQKDXYZ01",
        transactions: { payments: [{ id: "PAY_X", status: "processed" }] },
      },
    },
    {
      metodo: "POST",
      trecho: "/v1/orders/ORD01ABCDEFOLUIMWQKDXYZ01/refund",
      status: 201,
      corpo: { id: "REFUND01", status: "refunded" },
    },
  ]);

  const resposta = await handler(requisicaoComSegredo(SEGREDO), { supabase, fetchImpl: mp.f });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  assertEquals(corpo.estornos, { vistos: 1, concluidos: 1, adiados: 0, falhos: 0 });
  assertEquals(mp.chamadas.length, 2);
  assertEquals(mp.chamadas[0].metodo, "GET");
  assertEquals(mp.chamadas[1].metodo, "POST");
  const post = mp.chamadas[1].corpoEnviado as { transactions: Array<{ id: string }> };
  assertEquals(post.transactions[0].id, "PAY_X");
  assertEquals(mp.chamadas[1].chave, "r8");
  assertEquals(registro.chamadasConcluirEstorno.length, 1);
  assertEquals(registro.chamadasConcluirEstorno[0].args.p_refund_id, "r8");
});

// =============================================================================
// R9–R11 — D2/D3/D4 do laudo rodada 2 do PR #440 (BLOQUEIA-2 e
// ANTES-DE-CRESCER 3/5/6).
// =============================================================================

Deno.test("R9 - retry em_processamento de pedido PIX (gateway_payment_id de ORDER) chama consultarTransacaoDaOrder e refunda pela Orders API (D3, mutante: remover a injeção SÓ do retry)", async () => {
  const registro = {
    chamadasConfirmar: [] as Array<{ args: Record<string, unknown> }>,
    chamouCandidatos: false,
    chamadasConcluirEstorno: [] as Array<{ args: Record<string, unknown> }>,
    atualizacoesOrderRefunds: [] as Array<
      { id: string; valores: Record<string, unknown>; statusFiltro: string[] }
    >,
  };
  const pedido = pedidoFrescoPara({
    gateway_payment_id: "ORD01ABCDEFOLUIMWQKDXYZ01",
    total: 20,
    valor_estornado: 0,
  });
  const supabase = clienteFalso({
    candidatos: [],
    registro,
    refundsPendentes: [
      { id: "r9", order_id: pedido.id, amount: 20, status: "em_processamento", tentativas: 2, mp_refund_id: null },
    ],
    resolverPedidoFresco: (orderId) => (orderId === pedido.id ? pedido : null),
  });
  const mp = fetchDubleReconciliacao([
    // Serve TANTO o GET de confirmarPorConsulta (refunds[] vazio -> ainda
    // não confirmou) QUANTO o GET de consultarTransacaoDaOrder dentro do
    // retry (transactions.payments[] traz o id que o POST exige). R2/R3/R4
    // só cobrem este caminho com id CLÁSSICO (123456789) — todo o caminho
    // de recuperação para PIX (único método vivo) ficava sem teste.
    {
      metodo: "GET",
      trecho: "/v1/orders/ORD01ABCDEFOLUIMWQKDXYZ01",
      status: 200,
      // A1 (15/10/2026): a order paga SEM reembolso nenhum — o mesmo GET
      // serve à consulta do reenvio, que precisa provar `nao_achou` para o
      // POST sair (antes o corpo dizia `status: "refunded"` com a lista vazia,
      // contradição que a consulta do reenvio lê como "não sei").
      corpo: {
        id: "ORD01ABCDEFOLUIMWQKDXYZ01",
        status: "processed",
        status_detail: "accredited",
        transactions: {
          payments: [{ id: "PAY_RETRY", status: "processed" }],
          refunds: [],
        },
      },
    },
    {
      metodo: "POST",
      trecho: "/v1/orders/ORD01ABCDEFOLUIMWQKDXYZ01/refund",
      status: 201,
      corpo: { id: "REFUND_RETRY", status: "refunded" },
    },
  ]);

  const resposta = await handler(requisicaoComSegredo(SEGREDO), { supabase, fetchImpl: mp.f });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  assertEquals(corpo.estornos, { vistos: 1, concluidos: 1, adiados: 0, falhos: 0 });
  const postChamada = mp.chamadas.find((c) => c.metodo === "POST");
  assertEquals(postChamada !== undefined, true);
  // O corpo do POST usa a transação que consultarTransacaoDaOrder devolveu —
  // sem a injeção, executarEstorno nunca chegaria a montar este POST (viraria
  // tentar_depois para sempre, e o teste cairia em concluidos:0/adiados:1).
  const corpoEnviado = postChamada?.corpoEnviado as { transactions: Array<{ id: string }> };
  assertEquals(corpoEnviado.transactions[0].id, "PAY_RETRY");
  assertEquals(postChamada?.chave, "r9");
});

Deno.test("R10 - fila ordena por tentativas ASC antes de created_at ASC: linha travada (tentativas 5, regime D2) não mata de fome linha nova (tentativas 0) no LIMIT 20 (D4)", async () => {
  const registro = {
    chamadasConfirmar: [] as Array<{ args: Record<string, unknown> }>,
    chamouCandidatos: false,
    chamadasConcluirEstorno: [] as Array<{ args: Record<string, unknown> }>,
    atualizacoesOrderRefunds: [] as Array<
      { id: string; valores: Record<string, unknown>; statusFiltro: string[] }
    >,
  };
  const antigo = new Date(AGORA_MS - 3 * 60 * 1000).toISOString(); // fora da janela de 2 min

  // 20 linhas TRAVADAS (tentativas=5, o regime "só consulta" do D2) com
  // created_at MAIS ANTIGO que a linha nova — se a fila ordenasse só por
  // created_at (like antes do D4), elas ocupariam as 20 vagas do LIMIT e a
  // nova morreria de fome para sempre. O pedido delas nunca é resolvido
  // (resolverPedidoFresco só conhece a nova) — o que basta para provar QUAIS
  // entraram no lote, sem precisar de dublê de MP para elas.
  const travadas = Array.from({ length: 20 }, (_, i) => ({
    id: `travada-${i}`,
    order_id: `pedido-travada-${i}`,
    amount: 10,
    status: "em_processamento",
    tentativas: 5,
    mp_refund_id: null,
    updated_at: antigo,
    created_at: new Date(AGORA_MS - (100 - i) * UM_DIA_MS).toISOString(),
  }));
  const pedidoNovo = pedidoFrescoPara({ id: "20000000-0000-4000-8000-0000000000ff", total: 10 });
  const novo = {
    id: "novo",
    order_id: pedidoNovo.id,
    amount: 10,
    status: "solicitado",
    tentativas: 0,
    mp_refund_id: null,
    updated_at: antigo,
    // O MAIS RECENTE de todos — em ordenação só por created_at ficaria por
    // ÚLTIMO e sairia do LIMIT 20 (21 linhas no total).
    created_at: new Date(AGORA_MS).toISOString(),
  };

  const supabase = clienteFalso({
    candidatos: [],
    registro,
    refundsPendentes: [...travadas, novo],
    resolverPedidoFresco: (orderId) => (orderId === pedidoNovo.id ? pedidoNovo : null),
  });
  const mp = fetchDubleReconciliacao([
    { metodo: "POST", trecho: "/v1/payments/123456789/refunds", status: 201, corpo: { id: 1, status: "approved", amount: 10 } },
  ]);

  const resposta = await handler(requisicaoComSegredo(SEGREDO), { supabase, fetchImpl: mp.f });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  assertEquals(corpo.estornos.vistos, 20, "o LIMIT 20 continua valendo");
  // A prova real: a linha NOVA foi tocada (marcada em_processamento) — ela
  // entrou no lote. Sem o ORDER BY tentativas ASC (mutante m5: ordenar só
  // por created_at), ela ficaria de fora e este array estaria vazio.
  assertEquals(
    registro.atualizacoesOrderRefunds.some((a) => a.id === "novo"),
    true,
  );
  assertEquals(corpo.estornos.concluidos, 1, "a nova concluiu o estorno normalmente");
});

// Rodízio com estado: a ordem e o LIMIT vêm da query real; o dublê só
// persiste os UPDATEs. Dez minutos entre ciclos tornam todas as linhas
// elegíveis de novo, portanto a janela sozinha não resolve a inanição.
for (const falha of ["leitura", "consulta"] as const) {
  Deno.test(`RODIZIO - 25 linhas no teto, 20 falham na ${falha}: a segunda rodada visita a 21ª em diante`, async () => {
    const DataReal = Date;
    let agora = DataReal.now();
    globalThis.Date = class extends DataReal {
      constructor(...args: unknown[]) {
        super(...(args.length ? args : [agora]));
      }
      static now() { return agora; }
    };
    try {
      const linhas = Array.from({ length: 25 }, (_, i) => ({
        id: `rodizio-${i}`,
        order_id: `pedido-rodizio-${i}`,
        amount: 10,
        status: "em_processamento",
        tentativas: 5,
        mp_refund_id: null,
        solicitado_por: "lojista",
        created_at: new Date(agora - (50 - i) * 60_000).toISOString(),
        updated_at: new Date(agora - (50 - i) * 60_000).toISOString(),
      }));
      const visitas: string[] = [];
      const registro = { chamadasConfirmar: [], chamouCandidatos: false, chamadasConcluirEstorno: [], atualizacoesOrderRefunds: [] };
      const supabase = clienteFalso({
        registro,
        refundsPendentes: linhas,
        resolverPedidoFresco: (id) => {
          visitas.push(id);
          const indice = linhas.findIndex((r) => r.order_id === id);
          if (falha === "leitura" && indice < 20) throw new Error("leitura indisponível");
          return pedidoFrescoPara({ id, gateway_payment_id: String(123456789 + indice) });
        },
        atualizarOrderRefunds: (id, valores, statusFiltro) => {
          const linha = linhas.find((r) => r.id === id);
          if (!linha || !statusFiltro.includes(linha.status)) return { data: [], error: null };
          Object.assign(linha, valores);
          return { data: [{ id }], error: null };
        },
      });
      const chamadasMp: string[] = [];
      const fetchImpl = async (url: string, init?: RequestInit) => {
        chamadasMp.push(init?.method ?? "GET");
        const indice = Number(String(url).split("/").pop()) - 123456789;
        return new Response(JSON.stringify(indice < 20 ? {} : {
          id: 123456789 + indice, status: "approved", transaction_amount_refunded: 10,
        }), { status: indice < 20 ? 500 : 200 });
      };

      const primeira = await handler(requisicaoComSegredo(SEGREDO), { supabase, fetchImpl });
      assertEquals((await primeira.json()).estornos.vistos, 20);
      assertEquals(visitas, linhas.slice(0, 20).map((r) => r.order_id));
      agora += 10 * 60_000;
      const segunda = await handler(requisicaoComSegredo(SEGREDO), { supabase, fetchImpl });
      const resumo = (await segunda.json()).estornos;
      assertEquals(resumo.vistos, 20, "o lote continua limitado a 20");
      assertEquals(visitas.slice(20, 25), linhas.slice(20).map((r) => r.order_id), "as cinco nunca visitadas passam à frente");
      assertEquals(resumo.concluidos, 5);
      assertEquals(linhas.every((r) => r.tentativas === 5), true, "visita não gasta tentativa nem aumenta o teto");
      assertEquals(chamadasMp.every((metodo) => metodo === "GET"), true, "no teto não há POST");
    } finally {
      globalThis.Date = DataReal;
    }
  });
}

Deno.test("RODIZIO - linha dentro dos dois minutos não recebe visita nem carimbo", async () => {
  const registro = { chamadasConfirmar: [], chamouCandidatos: false, atualizacoesOrderRefunds: [] };
  let leituras = 0;
  const supabase = clienteFalso({
    registro,
    refundsPendentes: [{
      id: "recente", order_id: "pedido-recente", amount: 10,
      status: "em_processamento", tentativas: 5, mp_refund_id: null,
      updated_at: new Date(Date.now() - 30_000).toISOString(),
    }],
    resolverPedidoFresco: () => { leituras++; return null; },
  });
  const mp = fetchDubleReconciliacao([]);
  const resposta = await handler(requisicaoComSegredo(SEGREDO), { supabase, fetchImpl: mp.f });
  assertEquals((await resposta.json()).estornos, { vistos: 0, concluidos: 0, adiados: 0, falhos: 0 });
  assertEquals(leituras, 0);
  assertEquals(registro.atualizacoesOrderRefunds, []);
  assertEquals(mp.chamadas, []);
});

Deno.test("RODIZIO - caminho feliz mantém POST, chave e conclusão, carimbando só a visita", async () => {
  const registro = { chamadasConfirmar: [], chamouCandidatos: false, chamadasConcluirEstorno: [], atualizacoesOrderRefunds: [] };
  const pedido = pedidoFrescoPara({ total: 10 });
  const supabase = clienteFalso({
    registro,
    refundsPendentes: [{
      id: "feliz", order_id: pedido.id, amount: 10, status: "solicitado",
      tentativas: 0, mp_refund_id: null,
      updated_at: new Date(Date.now() - 10 * 60_000).toISOString(),
    }],
    resolverPedidoFresco: () => pedido,
  });
  const mp = fetchDubleReconciliacao([
    { metodo: "POST", trecho: "/v1/payments/123456789/refunds", status: 201, corpo: { id: 123, status: "approved", amount: 10 } },
  ]);
  const resposta = await handler(requisicaoComSegredo(SEGREDO), { supabase, fetchImpl: mp.f });
  assertEquals((await resposta.json()).estornos, { vistos: 1, concluidos: 1, adiados: 0, falhos: 0 });
  assertEquals(mp.chamadas.map((c) => [c.metodo, c.chave, c.corpoEnviado]), [["POST", "feliz", {}]]);
  assertEquals(registro.chamadasConcluirEstorno[0].args.p_refund_id, "feliz");
  const visita = registro.atualizacoesOrderRefunds.find((a) => Object.keys(a.valores).join() === "updated_at");
  assertEquals(typeof visita?.valores.updated_at, "string", "também carimba visita que concluiu");
});

Deno.test("R11 - concluido cuja RPC concluir_estorno levanta: incrementa tentativas e grava o motivo leigo, linha continua em_processamento (D4, ANTES-DE-CRESCER 5)", async () => {
  const registro = {
    chamadasConfirmar: [] as Array<{ args: Record<string, unknown> }>,
    chamouCandidatos: false,
    chamadasConcluirEstorno: [] as Array<{ args: Record<string, unknown> }>,
    atualizacoesOrderRefunds: [] as Array<
      { id: string; valores: Record<string, unknown>; statusFiltro: string[] }
    >,
  };
  const pedido = pedidoFrescoPara({ total: 30, valor_estornado: 0 });
  const supabase = clienteFalso({
    candidatos: [],
    registro,
    refundsPendentes: [
      { id: "r11", order_id: pedido.id, amount: 30, status: "em_processamento", tentativas: 2, mp_refund_id: null },
    ],
    resolverPedidoFresco: (orderId) => (orderId === pedido.id ? pedido : null),
    erroConcluirEstorno: { message: "conexão com o banco perdida" },
  });
  const mp = fetchDubleReconciliacao([
    { metodo: "GET", trecho: "/v1/payments/123456789", status: 200, corpo: { id: 123456789, status: "approved", transaction_amount_refunded: 30 } },
  ]);

  const resposta = await handler(requisicaoComSegredo(SEGREDO), { supabase, fetchImpl: mp.f });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  // O MP CONFIRMOU (GET diz 30/30) — o dinheiro já saiu; só a NOSSA escrita
  // (RPC concluir_estorno) falhou. Nunca "falhou": o dinheiro não pode
  // desaparecer do registro só porque a escrita local deu erro.
  assertEquals(corpo.estornos, { vistos: 1, concluidos: 0, adiados: 1, falhos: 0 });
  const gravado = registro.atualizacoesOrderRefunds.find((a) => a.id === "r11");
  assertEquals(gravado?.valores.tentativas, 3, "incrementa a partir das 2 tentativas já persistidas");
  assertEquals(typeof gravado?.valores.ultimo_erro, "string");
  assertEquals(gravado?.valores.status, undefined, "nunca falhou: o MP já confirmou o dinheiro");
  assertEquals(gravado?.statusFiltro, ["em_processamento"]);
});

// =============================================================================
// R12–R13 — brief P0 de 08/09/2026 (pré-requisito da T5/T6), achado 1 do laudo
// `20260908-laudo-opus-pr440-t4-reconciliacao-rodada2.md`: `confirmarPorConsulta`
// credita à linha avaliada QUALQUER refund processed do pedido — com duas
// linhas pendentes, uma é dada por devolvida com o dinheiro da outra.
// R15 — AC-3 da rodada 2 do laudo Opus do PR #447 (08/09/2026): a linha que
// JÁ carrega o próprio `mp_refund_id` (PIX em contingência) não pode ler a
// si mesma como "já reivindicada por outra linha" — o `.neq("id", refund.id)`
// é quem garante isso.
// =============================================================================

Deno.test("R12 - experimento do laudo ponta a ponta: com a ordenação tentativas ASC (b primeiro), b NÃO conclui com o refund de a; a conclui pela consulta", async () => {
  const registro = {
    chamadasConfirmar: [] as Array<{ args: Record<string, unknown> }>,
    chamouCandidatos: false,
    chamadasConcluirEstorno: [] as Array<{ args: Record<string, unknown> }>,
    atualizacoesOrderRefunds: [] as Array<
      { id: string; valores: Record<string, unknown>; statusFiltro: string[] }
    >,
  };
  const orderId = "20000000-0000-4000-8000-0000000000aa";
  const pedido = pedidoFrescoPara({
    id: orderId,
    gateway_payment_id: "ORD01ABCDEFOLUIMWQKDXYZ01",
    total: 30,
    valor_estornado: 0,
  });

  const supabase = clienteFalso({
    candidatos: [],
    registro,
    refundsPendentes: [
      // a: R$20, tentativas 5 (a que TEM o refund no MP). b: R$10,
      // tentativas 1 — vem PRIMEIRO na fila (tentativas ASC, D4).
      { id: "a", order_id: orderId, amount: 20, status: "em_processamento", tentativas: 5, mp_refund_id: null },
      { id: "b", order_id: orderId, amount: 10, status: "em_processamento", tentativas: 1, mp_refund_id: null },
    ],
    resolverPedidoFresco: (id) => (id === orderId ? pedido : null),
  });

  // A order do MP mostra UM refund processed de 20 (o de `a`) — nunca muda
  // entre as consultas (mesmo objeto, sempre a mesma resposta).
  const corpoOrder = {
    id: "ORD01ABCDEFOLUIMWQKDXYZ01",
    status: "refunded",
    transactions: {
      payments: [{ id: "PAY01XYZEXEMPLODETRANSA1", status: "processed" }],
      refunds: [{ id: "ref-a", amount: "20.00", status: "processed" }],
    },
  };
  const mp = fetchDubleReconciliacao([
    { metodo: "GET", trecho: "/v1/orders/ORD01ABCDEFOLUIMWQKDXYZ01", status: 200, corpo: corpoOrder },
    // Retry de b (POST com a chave dela): o MP diz "já em curso" — b fica
    // em_processamento (adiada), NUNCA concluída sem o refund dela aparecer.
    {
      metodo: "POST",
      trecho: "/v1/orders/ORD01ABCDEFOLUIMWQKDXYZ01/refund",
      status: 409,
      corpo: { error: "invalid_request", error_messages: [{ code: "order_refund_already_in_process" }] },
    },
  ]);

  const resposta = await handler(requisicaoComSegredo(SEGREDO), { supabase, fetchImpl: mp.f });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  // b (avaliada primeiro) NÃO conclui com o dinheiro de a (achado 1) e fica
  // adiada. a conclui SEM POST, pela consulta, com o refund que é exatamente
  // do valor dela.
  assertEquals(corpo.estornos, { vistos: 2, concluidos: 1, adiados: 1, falhos: 0 });
  assertEquals(registro.chamadasConcluirEstorno.length, 1);
  assertEquals(registro.chamadasConcluirEstorno[0].args.p_refund_id, "a");
  assertEquals(registro.chamadasConcluirEstorno[0].args.p_mp_refund_id, "ref-a");
  // A1 (15/10/2026): b já teve envio e, quando é avaliada, o MP mostra um
  // reembolso (o de a) que nenhuma linha reivindicou ainda — a consulta do
  // reenvio não sabe de quem é, então NENHUM POST sai neste ciclo (antes saía o
  // POST de b). No ciclo seguinte a já gravou o id dela e b volta a poder enviar.
  assertEquals(mp.chamadas.filter((c) => c.metodo === "POST").length, 0);
});

Deno.test("R13 - idsJaReivindicados: duas linhas do MESMO valor no mesmo lote — a 1ª conclui com o refund, a 2ª (vendo o id já gravado) NÃO conclui", async () => {
  const registro = {
    chamadasConfirmar: [] as Array<{ args: Record<string, unknown> }>,
    chamouCandidatos: false,
    chamadasConcluirEstorno: [] as Array<{ args: Record<string, unknown> }>,
    atualizacoesOrderRefunds: [] as Array<
      { id: string; valores: Record<string, unknown>; statusFiltro: string[] }
    >,
  };
  const orderId = "20000000-0000-4000-8000-0000000000bb";
  const pedido = pedidoFrescoPara({
    id: orderId,
    gateway_payment_id: "ORD01ABCDEFOLUIMWQKDXYZ01",
    total: 10,
    valor_estornado: 0,
  });

  // Estado SIMULADO do que cada linha já reivindicou — a 2ª iteração tem de
  // ver o que a 1ª gravou NO MESMO lote (a leitura é DENTRO do laço, por
  // item; um SELECT único antes do laço veria as duas ainda sem id).
  const reivindicadosPorOrder = new Map<string, string[]>();

  const supabase = clienteFalso({
    candidatos: [],
    registro,
    refundsPendentes: [
      // Mesmas tentativas — desempata por created_at (c1 antes de c2).
      {
        id: "c1",
        order_id: orderId,
        amount: 10,
        status: "em_processamento",
        tentativas: 1,
        mp_refund_id: null,
        created_at: "2026-09-01T00:00:00.000Z",
      },
      {
        id: "c2",
        order_id: orderId,
        amount: 10,
        status: "em_processamento",
        tentativas: 1,
        mp_refund_id: null,
        created_at: "2026-09-02T00:00:00.000Z",
      },
    ],
    resolverPedidoFresco: (id) => (id === orderId ? pedido : null),
    idsJaReivindicadosPorPedido: (id) => reivindicadosPorOrder.get(id) ?? [],
    aoConcluirEstorno: (args) => {
      const lista = reivindicadosPorOrder.get(orderId) ?? [];
      lista.push(String(args.p_mp_refund_id));
      reivindicadosPorOrder.set(orderId, lista);
    },
  });

  // A order do MP mostra UM único refund processed de 10 (`ref-x`) — o
  // MESMO valor das duas linhas.
  const corpoOrder = {
    id: "ORD01ABCDEFOLUIMWQKDXYZ01",
    status: "refunded",
    transactions: {
      payments: [{ id: "PAY01XYZEXEMPLODETRANSA1", status: "processed" }],
      refunds: [{ id: "ref-x", amount: "10.00", status: "processed" }],
    },
  };
  const mp = fetchDubleReconciliacao([
    { metodo: "GET", trecho: "/v1/orders/ORD01ABCDEFOLUIMWQKDXYZ01", status: 200, corpo: corpoOrder },
    // Retry de c2 (o único caminho que sobra depois de excluído ref-x): o MP
    // diz "já em curso" — c2 fica em_processamento (adiada).
    {
      metodo: "POST",
      trecho: "/v1/orders/ORD01ABCDEFOLUIMWQKDXYZ01/refund",
      status: 409,
      corpo: { error: "invalid_request", error_messages: [{ code: "order_refund_already_in_process" }] },
    },
  ]);

  const resposta = await handler(requisicaoComSegredo(SEGREDO), { supabase, fetchImpl: mp.f });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  // c1 conclui com ref-x; c2 (mesmo valor, MESMO refund já reivindicado por
  // c1) NÃO conclui — é exatamente o achado 1 do laudo, agora com DUAS
  // linhas do MESMO valor em vez de valores diferentes (E36 cobre a unidade;
  // este teste cobre o CONTRATO do cron ponta a ponta).
  assertEquals(corpo.estornos, { vistos: 2, concluidos: 1, adiados: 1, falhos: 0 });
  assertEquals(registro.chamadasConcluirEstorno.length, 1);
  assertEquals(registro.chamadasConcluirEstorno[0].args.p_refund_id, "c1");
  assertEquals(registro.chamadasConcluirEstorno[0].args.p_mp_refund_id, "ref-x");
});

Deno.test("R15 - linha em_processamento que JÁ carrega o PRÓPRIO mp_refund_id (PIX em contingência): o .neq exclui a si mesma e ela CONCLUI (AC-3, laudo #447 rodada 2)", async () => {
  const registro = {
    chamadasConfirmar: [] as Array<{ args: Record<string, unknown> }>,
    chamouCandidatos: false,
    chamadasConcluirEstorno: [] as Array<{ args: Record<string, unknown> }>,
    atualizacoesOrderRefunds: [] as Array<
      { id: string; valores: Record<string, unknown>; statusFiltro: string[] }
    >,
  };
  const orderId = "20000000-0000-4000-8000-0000000000cc";
  const pedido = pedidoFrescoPara({
    id: orderId,
    gateway_payment_id: "ORD01ABCDEFOLUIMWQKDXYZ01",
    total: 10,
    valor_estornado: 0,
  });

  // A ÚNICA linha do lote: em_processamento, já com o PRÓPRIO mp_refund_id
  // gravado numa passada anterior (`gravarDesfechoDoEstorno` grava o id na
  // linha `em_processamento` quando o POST devolve o assíncrono do PIX em
  // contingência — `resultado.tipo === "em_processamento"`, index.ts:~154).
  const linhasDoPedido = [
    { id: "rf-self-linha", order_id: orderId, mp_refund_id: "rf-self" },
  ];

  const supabase = clienteFalso({
    candidatos: [],
    registro,
    refundsPendentes: [
      {
        id: "rf-self-linha",
        order_id: orderId,
        amount: 10,
        status: "em_processamento",
        tentativas: 1,
        mp_refund_id: "rf-self",
      },
    ],
    resolverPedidoFresco: (id) => (id === orderId ? pedido : null),
    // Simula a query real (`.eq("order_id", x).neq("id", idAtual)
    // .not("mp_refund_id", "is", null)`): SÓ exclui a linha cujo id bate com
    // `idAtual`. Sem essa exclusão (mutação m3: `.neq("id", refund.id)` ->
    // `.neq("id", "0000...")`), a linha leria o PRÓPRIO mp_refund_id como já
    // reivindicado por OUTRA linha e nunca concluiria — morre de fome até o
    // teto com o dinheiro já devolvido (o cenário do AC-3).
    idsJaReivindicadosPorPedido: (oid, idAtual) =>
      linhasDoPedido
        .filter((l) => l.order_id === oid && l.id !== idAtual)
        .map((l) => l.mp_refund_id)
        .filter((id): id is string => typeof id === "string"),
  });

  // A order do MP mostra o refund `rf-self` (o mesmo id JÁ gravado na
  // linha) processed, do valor exato dela.
  const corpoOrder = {
    id: "ORD01ABCDEFOLUIMWQKDXYZ01",
    status: "refunded",
    transactions: {
      payments: [{ id: "PAY01XYZEXEMPLODETRANSA1", status: "processed" }],
      refunds: [{ id: "rf-self", amount: "10.00", status: "processed" }],
    },
  };
  const mp = fetchDubleReconciliacao([
    { metodo: "GET", trecho: "/v1/orders/ORD01ABCDEFOLUIMWQKDXYZ01", status: 200, corpo: corpoOrder },
  ]);

  const resposta = await handler(requisicaoComSegredo(SEGREDO), { supabase, fetchImpl: mp.f });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  // Conclui SEM POST nenhum (nenhuma rota POST no dublê acima) — o `.neq`
  // exclui a si mesma, e "rf-self" nunca entra em idsJaReivindicados.
  assertEquals(corpo.estornos, { vistos: 1, concluidos: 1, adiados: 0, falhos: 0 });
  assertEquals(registro.chamadasConcluirEstorno.length, 1);
  assertEquals(registro.chamadasConcluirEstorno[0].args.p_refund_id, "rf-self-linha");
  assertEquals(registro.chamadasConcluirEstorno[0].args.p_mp_refund_id, "rf-self");
});

// =============================================================================
// R14 — item "reconciliar-pagamentos" do brief da T5 (webhook): linha
// `solicitado_por = 'sistema'` (estorno feito fora do app, ou chargeback em
// análise) é dinheiro que JÁ se moveu — o cron jamais chama `executarEstorno`
// para ela (seria um POST de refund NOVO com a chave dela = pagar duas
// vezes). Só o webhook grava e conclui linha `sistema`.
// =============================================================================

Deno.test("R14 - linha 'sistema' em em_processamento NÃO é consultada nem POSTada; 'vistos' não a conta (mutação: tirar o .neq derruba)", async () => {
  const registro = {
    chamadasConfirmar: [] as Array<{ args: Record<string, unknown> }>,
    chamouCandidatos: false,
    chamadasConcluirEstorno: [] as Array<{ args: Record<string, unknown> }>,
    atualizacoesOrderRefunds: [] as Array<
      { id: string; valores: Record<string, unknown>; statusFiltro: string[] }
    >,
  };
  const pedido = pedidoFrescoPara();
  const supabase = clienteFalso({
    candidatos: [],
    registro,
    refundsPendentes: [
      {
        id: "r14-sistema",
        order_id: pedido.id,
        amount: 10,
        status: "em_processamento",
        solicitado_por: "sistema",
        tentativas: 1,
        mp_refund_id: null,
      },
    ],
    resolverPedidoFresco: (orderId) => (orderId === pedido.id ? pedido : null),
  });
  const mp = fetchDubleReconciliacao([]);

  const resposta = await handler(requisicaoComSegredo(SEGREDO), { supabase, fetchImpl: mp.f });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  // A linha 'sistema' nunca entra na fila que o handler enxerga: 'vistos'
  // fica em 0, nenhuma chamada ao MP, nenhuma atualização da linha.
  assertEquals(corpo.estornos, { vistos: 0, concluidos: 0, adiados: 0, falhos: 0 });
  assertEquals(mp.chamadas.length, 0);
  assertEquals(registro.atualizacoesOrderRefunds.length, 0);
  assertEquals(registro.chamadasConcluirEstorno.length, 0);
});

// --- PEÇA 5 (revisão de dinheiro-não-recebido, 12/09/2026): a reconciliação
// confirma pagamento que o webhook perdeu — e, ANTES desta peça, não avisava
// o cliente NUNCA. --------------------------------------------------------

Deno.test("PEÇA 5 - resultado 'pago' via reconciliação -> dispara o comprovante ao cliente, com o orderId certo", async () => {
  const registro = { chamadasConfirmar: [], chamouCandidatos: false };
  const idOrder = "ORDTST01KZZ4D94WC79335A68CZ5NZ7X";
  const candidatos = [{ order_id: UUID_PEDIDO_1, gateway_payment_id: idOrder }];
  const supabase = clienteFalso({ candidatos, rpcConfirmarResultado: "pago", registro });
  const fetchImpl = fetchConsulta(200, { id: idOrder, status: "processed", total_amount: "149.90", status_detail: "accredited" });
  const req = requisicaoComSegredo(SEGREDO);
  const chamadasComprovante: unknown[] = [];
  const enviarComprovante = async (args: unknown) => {
    chamadasComprovante.push(args);
  };
  const chamadasAvisoAtrasado: unknown[] = [];
  const enviarAvisoAtrasado = async (args: unknown) => {
    chamadasAvisoAtrasado.push(args);
  };

  const resposta = await handler(req, { supabase, fetchImpl, enviarComprovante, enviarAvisoAtrasado });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  assertEquals(corpo.confirmados, 1);
  assertEquals(chamadasComprovante.length, 1, "confirmação 'pago' pela reconciliação tem de mandar o comprovante — antes desta peça, não mandava nada");
  assertEquals((chamadasComprovante[0] as { orderId: string }).orderId, UUID_PEDIDO_1);
  assertEquals(chamadasAvisoAtrasado.length, 0);
});

Deno.test("PEÇA 5 - resultado 'pago_apos_expirar' via reconciliação -> dispara o aviso HONESTO, NUNCA o comprovante padrão", async () => {
  const registro = { chamadasConfirmar: [], chamouCandidatos: false };
  const idOrder = "ORDTST01KZZ4D94WC79335A68CZ5NZ7X";
  const candidatos = [{ order_id: UUID_PEDIDO_1, gateway_payment_id: idOrder }];
  const supabase = clienteFalso({ candidatos, rpcConfirmarResultado: "pago_apos_expirar", registro });
  const fetchImpl = fetchConsulta(200, { id: idOrder, status: "processed", total_amount: "149.90", status_detail: "accredited" });
  const req = requisicaoComSegredo(SEGREDO);
  const chamadasComprovante: unknown[] = [];
  const enviarComprovante = async (args: unknown) => {
    chamadasComprovante.push(args);
  };
  const chamadasAvisoAtrasado: unknown[] = [];
  const enviarAvisoAtrasado = async (args: unknown) => {
    chamadasAvisoAtrasado.push(args);
  };

  const resposta = await handler(req, { supabase, fetchImpl, enviarComprovante, enviarAvisoAtrasado });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  assertEquals(corpo.confirmados, 1);
  assertEquals(chamadasComprovante.length, 0, "'pago_apos_expirar' não pode receber o texto do comprovante padrão — mentiria");
  assertEquals(chamadasAvisoAtrasado.length, 1);
  assertEquals((chamadasAvisoAtrasado[0] as { orderId: string }).orderId, UUID_PEDIDO_1);
});

Deno.test("PEÇA 5 - resultado 'ja_pago' (reenvio) via reconciliação -> NÃO dispara comprovante nem aviso atrasado", async () => {
  const registro = { chamadasConfirmar: [], chamouCandidatos: false };
  const idOrder = "ORDTST01KZZ4D94WC79335A68CZ5NZ7X";
  const candidatos = [{ order_id: UUID_PEDIDO_1, gateway_payment_id: idOrder }];
  const supabase = clienteFalso({ candidatos, rpcConfirmarResultado: "ja_pago", registro });
  const fetchImpl = fetchConsulta(200, { id: idOrder, status: "processed", total_amount: "149.90", status_detail: "accredited" });
  const req = requisicaoComSegredo(SEGREDO);
  const chamadasComprovante: unknown[] = [];
  const enviarComprovante = async (args: unknown) => {
    chamadasComprovante.push(args);
  };
  const chamadasAvisoAtrasado: unknown[] = [];
  const enviarAvisoAtrasado = async (args: unknown) => {
    chamadasAvisoAtrasado.push(args);
  };

  const resposta = await handler(req, { supabase, fetchImpl, enviarComprovante, enviarAvisoAtrasado });

  assertEquals(resposta.status, 200);
  assertEquals(chamadasComprovante.length, 0);
  assertEquals(chamadasAvisoAtrasado.length, 0);
});

// --- o caminho REAL (deps.enviarComprovante/enviarAvisoAtrasado não
// injetados) — prova que a reconciliação alcança a MESMA reserva
// (`reivindicar_email_de_confirmacao`) que o webhook usa, e que ela é quem
// impede o e-mail duplicado quando os dois confirmam o mesmo pedido. -------

/**
 * Cliente supabase mínimo, ad-hoc (fora de `clienteFalso`, mesma técnica de
 * `webhook-mercadopago/index_test.ts:1990+`): cobre só o que os caminhos
 * REAIS de `dispararComprovanteReal`/`dispararAvisoDePagamentoAtrasadoReal`
 * tocam — a leitura de `marketplace_orders` devolve o MESMO objeto para
 * qualquer `select()` (a projeção por coluna não importa aqui, como no
 * dublê equivalente do webhook).
 */
function supabaseRealMinimo(opts: {
  candidatos: Array<{ order_id: string; gateway_payment_id: string }>;
  resultadoConfirmar: string;
  pedido: Record<string, unknown>;
  reservaResultados: Array<boolean>;
  registro: { chamadasRpc: Array<{ nome: string; args: Record<string, unknown> }> };
}) {
  let indiceReserva = 0;
  return {
    rpc: async (nome: string, args: Record<string, unknown>) => {
      opts.registro.chamadasRpc.push({ nome, args });
      if (nome === "pagamentos_a_reconciliar") return { data: opts.candidatos, error: null };
      if (nome === "confirmar_pagamento") return { data: opts.resultadoConfirmar, error: null };
      if (nome === "reivindicar_email_de_confirmacao") {
        const reservou = opts.reservaResultados[indiceReserva] ?? false;
        indiceReserva++;
        return { data: reservou, error: null };
      }
      return { data: null, error: null };
    },
    from(tabela: string) {
      if (tabela === "marketplace_orders") {
        return {
          select(_cols: string) {
            return {
              eq(_col: string, _val: unknown) {
                return { maybeSingle: async () => ({ data: opts.pedido, error: null }) };
              },
            };
          },
        };
      }
      if (tabela === "store_config") {
        return {
          select(_cols: string) {
            return { limit(_n: number) { return { maybeSingle: async () => ({ data: null, error: null }) }; } };
          },
        };
      }
      // Tarefa mp-2: a resolução das credenciais (_shared/credenciais-mp.ts)
      // lê app_settings pelo MESMO client. Sem registro — estes testes são
      // os do caminho de sempre, com a chave da plataforma (MP_ACCESS_TOKEN).
      if (tabela === "app_settings") {
        return {
          select(_cols: string) {
            return {
              eq(_col: string, _val: unknown) {
                return { maybeSingle: async () => ({ data: null, error: null }) };
              },
            };
          },
        };
      }
      if (tabela === "order_refunds") {
        return {
          select(_cols: string) {
            if (ehLeituraDeContestacao(_cols)) return cadeiaVazia();
            return {
              in(_col: string, _vals: string[]) {
                return {
                  neq(_c: string, _v: unknown) {
                    return {
                      lt(_c2: string, _v2: string) {
                        return {
                          order(_c3: string, _o: unknown) {
                            return {
                              order(_c4: string, _o2: unknown) {
                                return { limit: async (_n: number) => ({ data: [], error: null }) };
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
      throw new Error(`from inesperado no dublê mínimo: ${tabela}`);
    },
  };
}

Deno.test("PEÇA 5 (caminho real) - 'pago' -> alcança a MESMA reserva do comprovante padrão (reivindicar_email_de_confirmacao) com o orderId certo", async () => {
  Deno.env.set("SMTP_USER", "loja@exemplo.com");
  Deno.env.set("SMTP_PASSWORD", "fixture-nao-e-credencial-real");
  try {
    const registro = { chamadasRpc: [] as Array<{ nome: string; args: Record<string, unknown> }> };
    const idOrder = "ORDTST01KZZ4D94WC79335A68CZ5NZ7X";
    const pedido = {
      id: UUID_PEDIDO_1,
      user_id: null,
      customer_data: { email: "cliente@exemplo.com" },
      total: 149.9,
      total_amount: null,
    };
    const supabase = supabaseRealMinimo({
      candidatos: [{ order_id: UUID_PEDIDO_1, gateway_payment_id: idOrder }],
      resultadoConfirmar: "pago",
      pedido,
      reservaResultados: [false], // basta provar que a reserva foi ALCANÇADA
      registro,
    });
    const fetchImpl = fetchConsulta(200, { id: idOrder, status: "processed", total_amount: "149.90", status_detail: "accredited" });

    const resposta = await handler(requisicaoComSegredo(SEGREDO), { supabase, fetchImpl });

    assertEquals(resposta.status, 200);
    const chamadaReserva = registro.chamadasRpc.find((c) => c.nome === "reivindicar_email_de_confirmacao");
    assertEquals(chamadaReserva?.args.p_order_id, UUID_PEDIDO_1);
  } finally {
    Deno.env.delete("SMTP_USER");
    Deno.env.delete("SMTP_PASSWORD");
  }
});

Deno.test("PEÇA 5 (caminho real) - 'pago_apos_expirar' -> alcança a reserva do aviso atrasado (reivindicar_email_de_confirmacao) com o orderId certo", async () => {
  Deno.env.set("SMTP_USER", "loja@exemplo.com");
  Deno.env.set("SMTP_PASSWORD", "fixture-nao-e-credencial-real");
  try {
    const registro = { chamadasRpc: [] as Array<{ nome: string; args: Record<string, unknown> }> };
    const idOrder = "ORDTST01KZZ4D94WC79335A68CZ5NZ7X";
    const pedido = {
      id: UUID_PEDIDO_1,
      user_id: null,
      customer_data: { email: "cliente@exemplo.com" },
      total: 149.9,
      total_amount: null,
    };
    const supabase = supabaseRealMinimo({
      candidatos: [{ order_id: UUID_PEDIDO_1, gateway_payment_id: idOrder }],
      resultadoConfirmar: "pago_apos_expirar",
      pedido,
      reservaResultados: [false],
      registro,
    });
    const fetchImpl = fetchConsulta(200, { id: idOrder, status: "processed", total_amount: "149.90", status_detail: "accredited" });

    const resposta = await handler(requisicaoComSegredo(SEGREDO), { supabase, fetchImpl });

    assertEquals(resposta.status, 200);
    const chamadaReserva = registro.chamadasRpc.find((c) => c.nome === "reivindicar_email_de_confirmacao");
    assertEquals(chamadaReserva?.args.p_order_id, UUID_PEDIDO_1);
  } finally {
    Deno.env.delete("SMTP_USER");
    Deno.env.delete("SMTP_PASSWORD");
  }
});

// --- achado bloqueante da revisão (12/09/2026): a cópia desta função em
// reconciliar-pagamentos não tinha NENHUMA asserção de conteúdo — o texto
// podia divergir do gêmeo em webhook-mercadopago/index_test.ts sem nenhum
// sinal. Mesmo teste, mesmas asserções, agora nas duas cópias. -------------

function numeroDoPedidoEsperado(id: string): string {
  return `#${String(id).slice(-6).toUpperCase()}`;
}

Deno.test("htmlDoAvisoDePagamentoAtrasado (reconciliação): texto honesto — NUNCA promete 'aguardando confirmação' nem 'fila de separação', NUNCA afirma 'prazo' nem 'automaticamente'", () => {
  const html = htmlDoAvisoDePagamentoAtrasado({ orderId: UUID_PEDIDO_1, nomeDaLoja: "Loja Teste" });

  // As duas frases que o comprovante PADRÃO usa e que mentiriam aqui — ver
  // `htmlDoPedido` em `_shared/comprovante.ts`. A negação ("não entrou na
  // fila de separação") é o texto HONESTO — o que não pode aparecer é a
  // afirmação, no presente, de que o pedido ENTRA na fila.
  assertEquals(html.includes("aguardando"), false, "não pode dizer que o pagamento ainda está aguardando confirmação");
  assertEquals(html.includes("entra na fila de separação"), false, "o pedido está cancelado — nunca ENTRA na fila de separação");
  assertStringIncludes(html, "não entrou na fila de separação");

  // Achado bloqueante: 'pago_apos_expirar' também nasce de o CLIENTE cancelar
  // pelo app e pagar o PIX dentro da janela — "prazo" e "automaticamente" são
  // falsos nesse caminho. O texto não pode alegar causa nenhuma.
  assertEquals(html.includes("prazo"), false, "'prazo' só é verdade quando o pedido expirou — a RPC devolve o mesmo valor para o cliente que cancelou e pagou dentro da janela");
  assertEquals(html.includes("automátic"), false, "'automaticamente' é falso quando foi o CLIENTE quem cancelou pelo app");

  // O que TEM de estar dito: pagamento confirmado, pedido já cancelado.
  assertStringIncludes(html, "cancelado");
  assertStringIncludes(html, numeroDoPedidoEsperado(UUID_PEDIDO_1));
  assertStringIncludes(html, "Loja Teste");
});

Deno.test("aviso de pagamento atrasado (reconciliação): reserva NÃO concedida (reservou=false) -> não chega a ler store_config nem a enviar e-mail", async () => {
  // Mesma técnica de "webhook-mercadopago/index_test.ts: reserva NÃO
  // concedida" — prova, sem tocar SMTP de verdade, que um reenvio (ou o
  // webhook chegando primeiro pela MESMA reserva) barra ANTES de ler
  // store_config, e por isso nunca chega a tentar mandar um segundo e-mail.
  Deno.env.set("SMTP_USER", "loja@exemplo.com");
  Deno.env.set("SMTP_PASSWORD", "fixture-nao-e-credencial-real");
  try {
    const idOrder = "ORDTST01KZZ4D94WC79335A68CZ5NZ7X";
    const candidatos = [{ order_id: UUID_PEDIDO_1, gateway_payment_id: idOrder }];
    const pedido = {
      id: UUID_PEDIDO_1,
      user_id: null,
      customer_data: { email: "cliente@exemplo.com" },
      total: 149.9,
      total_amount: null,
    };
    let leuStoreConfig = false;
    const chamadasRpc: Array<{ nome: string; args: Record<string, unknown> }> = [];
    const supabase = {
      rpc: async (nome: string, args: Record<string, unknown>) => {
        chamadasRpc.push({ nome, args });
        if (nome === "pagamentos_a_reconciliar") return { data: candidatos, error: null };
        if (nome === "confirmar_pagamento") return { data: "pago_apos_expirar", error: null };
        if (nome === "reivindicar_email_de_confirmacao") return { data: false, error: null };
        return { data: null, error: null };
      },
      from(tabela: string) {
        if (tabela === "store_config") {
          leuStoreConfig = true;
          return {
            select(_cols: string) {
              return { limit(_n: number) { return { maybeSingle: async () => ({ data: null, error: null }) }; } };
            },
          };
        }
        if (tabela === "marketplace_orders") {
          return {
            select(_cols: string) {
              return {
                eq(_col: string, _val: unknown) {
                  return { maybeSingle: async () => ({ data: pedido, error: null }) };
                },
              };
            },
          };
        }
        // Tarefa mp-2: sem registro do lojista — este teste é o do caminho de
        // sempre, com a chave da plataforma (MP_ACCESS_TOKEN).
        if (tabela === "app_settings") {
          return {
            select(_cols: string) {
              return {
                eq(_col: string, _val: unknown) {
                  return { maybeSingle: async () => ({ data: null, error: null }) };
                },
              };
            },
          };
        }
        throw new Error(`from inesperado no dublê mínimo: ${tabela}`);
      },
    };
    const fetchImpl = fetchConsulta(200, { id: idOrder, status: "processed", total_amount: "149.90", status_detail: "accredited" });

    const resposta = await handler(requisicaoComSegredo(SEGREDO), { supabase, fetchImpl });
    const corpo = await resposta.json();

    assertEquals(resposta.status, 200);
    assertEquals(corpo.confirmados, 1, "a confirmação em si não é bloqueada pela reserva do e-mail — só o aviso é");
    const chamadaReserva = chamadasRpc.find((c) => c.nome === "reivindicar_email_de_confirmacao");
    assertEquals(chamadaReserva?.args.p_order_id, UUID_PEDIDO_1, "a reserva tem de ser alcançada com o orderId certo");
    assertEquals(leuStoreConfig, false, "reservou=false tem de barrar ANTES de ler store_config — é isso que prova que não se tenta enviar de novo");
  } finally {
    Deno.env.delete("SMTP_USER");
    Deno.env.delete("SMTP_PASSWORD");
  }
});

Deno.test("PEÇA 5 - AUSÊNCIA DE DUPLICATA: dois candidatos do MESMO pedido no mesmo ciclo -> só a 1ª reserva vinga, a 2ª (reservou=false) não manda nada de novo", async () => {
  // Cenário artificial (a RPC pagamentos_a_reconciliar não devolveria o
  // mesmo order_id duas vezes na vida real), mas é o jeito mais direto de
  // provar, sem tocar SMTP, que a trava é quem impede o e-mail duplicado —
  // não uma suposição de que "só roda uma vez por pedido". Mesma prova serve
  // para "webhook confirmou primeiro, a reconciliação chegou depois": dos
  // dois lados quem chama por último sempre recebe reservou=false.
  Deno.env.set("SMTP_USER", "loja@exemplo.com");
  Deno.env.set("SMTP_PASSWORD", "fixture-nao-e-credencial-real");
  try {
    const registro = { chamadasRpc: [] as Array<{ nome: string; args: Record<string, unknown> }> };
    const idOrder = "ORDTST01KZZ4D94WC79335A68CZ5NZ7X";
    const pedido = {
      id: UUID_PEDIDO_1,
      user_id: null,
      customer_data: { email: "cliente@exemplo.com" },
      total: 149.9,
      total_amount: null,
    };
    const supabase = supabaseRealMinimo({
      candidatos: [
        { order_id: UUID_PEDIDO_1, gateway_payment_id: idOrder },
        { order_id: UUID_PEDIDO_1, gateway_payment_id: idOrder },
      ],
      resultadoConfirmar: "pago_apos_expirar",
      pedido,
      // 1ª chamada de reivindicar_email_de_confirmacao reserva (true); a 2ª
      // (mesmo pedido, mesmo ciclo) já encontra reservado (false).
      reservaResultados: [true, false],
      registro,
    });
    const fetchImpl = fetchConsulta(200, { id: idOrder, status: "processed", total_amount: "149.90", status_detail: "accredited" });

    const resposta = await handler(requisicaoComSegredo(SEGREDO), { supabase, fetchImpl });
    const corpo = await resposta.json();

    assertEquals(resposta.status, 200);
    assertEquals(corpo.confirmados, 2, "os dois candidatos confirmam — a dedup é do E-MAIL, não da confirmação");
    const chamadasReserva = registro.chamadasRpc.filter((c) => c.nome === "reivindicar_email_de_confirmacao");
    assertEquals(chamadasReserva.length, 2, "as duas tentativas de aviso têm de ALCANÇAR a reserva");
    assertEquals(chamadasReserva[0].args.p_order_id, UUID_PEDIDO_1);
    assertEquals(chamadasReserva[1].args.p_order_id, UUID_PEDIDO_1);
  } finally {
    Deno.env.delete("SMTP_USER");
    Deno.env.delete("SMTP_PASSWORD");
  }
});

// --- Tarefa mp-2 (15/09/2026): de QUEM é o token que o cron consulta -------
//
// `resolverCredenciaisMp` (_shared/credenciais-mp.ts) decide entre a chave do
// LOJISTA (registro cifrado em app_settings) e a da PLATAFORMA
// (MP_ACCESS_TOKEN), e FECHA quando existe cadastro que não dá para decifrar.
// Aqui o efeito é diferente das outras três functions: consultar o MP com a
// chave da plataforma quando o lojista tem a dele devolveria 404 para toda
// order dele — a rede de segurança do dinheiro calada, que é exatamente o
// buraco que esta reconciliação existe para tapar.

/** Como `fetchConsulta`, mas guardando os headers: é no `Authorization` que
 * mora a resposta de "com a chave de quem este cron está perguntando". */
function fetchConsultaComHeaders(
  capturado: { autorizacoes: string[]; chamadas: number },
  status: number,
  corpo: Record<string, unknown>,
) {
  return async (_url: string, init?: RequestInit) => {
    capturado.chamadas++;
    capturado.autorizacoes.push(
      (init?.headers as Record<string, string> | undefined)?.Authorization ?? "",
    );
    return new Response(JSON.stringify(corpo), { status });
  };
}

Deno.test("MP-1 — com chave do LOJISTA cadastrada, o Bearer da consulta ao MP é o token DECIFRADO dele, nunca o MP_ACCESS_TOKEN da plataforma", async () => {
  Deno.env.set("MP_CHAVES_ENCRYPTION_KEY", CHAVE_CIFRA_TESTE);
  try {
    const registro = { chamadasConfirmar: [], chamouCandidatos: false };
    const idOrder = "ORDTST09LOJISTA4WC79335A68CZ5NZ7X";
    const supabase = clienteFalso({
      candidatos: [{ order_id: UUID_PEDIDO_1, gateway_payment_id: idOrder }],
      rpcConfirmarResultado: "pago",
      registro,
      registroMp: await registroMpDeTeste(),
    });
    const capturado = { autorizacoes: [] as string[], chamadas: 0 };
    const fetchImpl = fetchConsultaComHeaders(capturado, 200, {
      id: idOrder,
      status: "processed",
      total_amount: "149.90",
      status_detail: "accredited",
    });

    const resposta = await handler(requisicaoComSegredo(SEGREDO), { supabase, fetchImpl });
    const corpo = await resposta.json();

    assertEquals(corpo.confirmados, 1);
    assertEquals(capturado.autorizacoes[0], `Bearer ${TOKEN_LOJISTA_FALSO}`);
  } finally {
    Deno.env.delete("MP_CHAVES_ENCRYPTION_KEY");
  }
});

Deno.test("MP-2 — chave do lojista cadastrada + cofre ausente: o candidato é PULADO (falhas:1) e o MP não é consultado com a chave da plataforma", async () => {
  Deno.env.set("MP_CHAVES_ENCRYPTION_KEY", CHAVE_CIFRA_TESTE);
  const registroCifrado = await registroMpDeTeste();
  Deno.env.delete("MP_CHAVES_ENCRYPTION_KEY");

  const registro = { chamadasConfirmar: [], chamouCandidatos: false };
  const idOrder = "ORDTST10COFREAUSENTE4WC79335A68C";
  const supabase = clienteFalso({
    candidatos: [{ order_id: UUID_PEDIDO_1, gateway_payment_id: idOrder }],
    rpcConfirmarResultado: "pago",
    registro,
    registroMp: registroCifrado,
  });
  const capturado = { autorizacoes: [] as string[], chamadas: 0 };
  const fetchImpl = fetchConsultaComHeaders(capturado, 200, {
    id: idOrder,
    status: "processed",
    total_amount: "149.90",
    status_detail: "accredited",
  });

  const resposta = await handler(requisicaoComSegredo(SEGREDO), { supabase, fetchImpl });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  assertEquals(corpo.verificados, 1);
  assertEquals(corpo.confirmados, 0);
  assertEquals(corpo.falhas, 1);
  // Nem uma consulta: o candidato some do lote sem o token da plataforma
  // encostar na conta do lojista.
  assertEquals(capturado.chamadas, 0);
  assertEquals(registro.chamadasConfirmar.length, 0);
});

Deno.test("MP-3 — cofre ausente: a fila de ESTORNOS também para fechada (falhos:1), sem POST de Bearer vazio e sem gastar `tentativas` da linha", async () => {
  Deno.env.set("MP_CHAVES_ENCRYPTION_KEY", CHAVE_CIFRA_TESTE);
  const registroCifrado = await registroMpDeTeste();
  Deno.env.delete("MP_CHAVES_ENCRYPTION_KEY");

  const registro = {
    chamadasConfirmar: [] as Array<{ args: Record<string, unknown> }>,
    chamouCandidatos: false,
    chamadasConcluirEstorno: [] as Array<{ args: Record<string, unknown> }>,
    atualizacoesOrderRefunds: [] as Array<
      { id: string; valores: Record<string, unknown>; statusFiltro: string[] }
    >,
  };
  const pedido = pedidoFrescoPara({ total: 50 });
  const supabase = clienteFalso({
    candidatos: [],
    registro,
    registroMp: registroCifrado,
    refundsPendentes: [
      { id: "r1", order_id: pedido.id, amount: 50, status: "solicitado", tentativas: 0, mp_refund_id: null },
    ],
    resolverPedidoFresco: (orderId) => (orderId === pedido.id ? pedido : null),
  });
  const capturado = { autorizacoes: [] as string[], chamadas: 0 };
  const fetchImpl = fetchConsultaComHeaders(capturado, 201, {
    id: 999,
    status: "approved",
    amount: 50,
  });

  const resposta = await handler(requisicaoComSegredo(SEGREDO), { supabase, fetchImpl });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  // `falhos` e não `adiados`: "não deu para tentar" é falha honesta, do mesmo
  // jeito que o candidato de pagamento pulado lá em cima.
  assertEquals(corpo.estornos, { vistos: 1, concluidos: 0, adiados: 0, falhos: 1 });
  // Nenhum POST com Bearer vazio: o MP recusaria, e o preço dessa recusa é
  // uma `tentativas` queimada por ciclo até o teto de 5 — depois do teto a
  // linha entra no regime "só consulta" e o cron NUNCA mais repete o POST,
  // mesmo depois de alguém devolver o cofre ao lugar. Cofre fora do ar é
  // conserto de operador; não pode consumir o orçamento de tentativas de uma
  // devolução de dinheiro.
  assertEquals(capturado.chamadas, 0);
  // Sem credencial só há metadado de visita: status e tentativas intactos.
  assertEquals(registro.atualizacoesOrderRefunds.length, 1);
  assertEquals(Object.keys(registro.atualizacoesOrderRefunds[0].valores), ["updated_at"]);
  assertEquals(registro.atualizacoesOrderRefunds[0].statusFiltro, ["solicitado", "em_processamento"]);
  assertEquals(registro.chamadasConcluirEstorno.length, 0);
});

// --- Tarefa mp-6: UMA resolução de credenciais por invocação ---------------
//
// Ressalva da revisão de mp-1. Aqui o risco é de escala: este cron roda de
// 10 em 10 minutos sobre um LOTE de candidatos. Resolver a credencial
// dentro do laço multiplicaria por N o SELECT em app_settings e o AES-GCM —
// e, pior, o lote passaria a rodar com credenciais DIFERENTES entre um
// candidato e outro se o lojista salvasse a chave nova no meio da execução:
// metade dos pedidos consultada na conta velha, metade na nova, e o relatório
// de `falhas` sem como explicar. A resolução mora ANTES do laço; MP-4 prende
// isso contando as leituras de app_settings com DOIS candidatos.

// `contandoFrom` vem de `_shared/credenciais-mp_fixtures.ts` (mp-10) — era
// copiado igual no `webhook-mercadopago/index_test.ts`.

Deno.test("MP-4 — lote com DOIS candidatos resolve as credenciais UMA vez (um só SELECT em app_settings, não um por candidato)", async () => {
  Deno.env.set("MP_CHAVES_ENCRYPTION_KEY", CHAVE_CIFRA_TESTE);
  try {
    const registro = { chamadasConfirmar: [], chamouCandidatos: false };
    const idOrder1 = "ORDTST11LOTEUM4WC79335A68CZ5NZ7X";
    const idOrder2 = "ORDTST12LOTEDOIS4WC79335A68CZ5NZ";
    const tabelas: string[] = [];
    const supabase = contandoFrom(
      clienteFalso({
        candidatos: [
          { order_id: UUID_PEDIDO_1, gateway_payment_id: idOrder1 },
          { order_id: UUID_PEDIDO_2, gateway_payment_id: idOrder2 },
        ],
        rpcConfirmarResultado: "pago",
        registro,
        registroMp: await registroMpDeTeste(),
      }),
      tabelas,
    );
    const capturado = { autorizacoes: [] as string[], chamadas: 0 };
    const fetchImpl = fetchConsultaComHeaders(capturado, 200, {
      id: idOrder1,
      status: "processed",
      total_amount: "149.90",
      status_detail: "accredited",
    });

    // O e-mail do comprovante entra como dublê: ele resolve o REMETENTE em
    // app_settings (outra linha, a do e-mail da loja) e este teste conta só as
    // leituras das credenciais do Mercado Pago.
    const resposta = await handler(requisicaoComSegredo(SEGREDO), {
      supabase,
      fetchImpl,
      enviarComprovante: async () => {},
      enviarAvisoAtrasado: async () => {},
    });
    const corpo = await resposta.json();

    // Os DOIS candidatos passaram pelo laço com o token do lojista.
    assertEquals(corpo.verificados, 2);
    assertEquals(capturado.chamadas, 2);
    assertEquals(capturado.autorizacoes[0], `Bearer ${TOKEN_LOJISTA_FALSO}`);
    assertEquals(capturado.autorizacoes[1], `Bearer ${TOKEN_LOJISTA_FALSO}`);
    // E UMA leitura de app_settings para o lote inteiro.
    assertEquals(
      tabelas.filter((tabela) => tabela === "app_settings").length,
      1,
      "a credencial tem de ser resolvida antes do laço, não uma vez por candidato",
    );
  } finally {
    Deno.env.delete("MP_CHAVES_ENCRYPTION_KEY");
  }
});

// ═══ Fase 3.5 (26/09/2026): recusa de CARTÃO libera a vaga, nunca cancela ════
//
// Mesma regra do webhook, no caminho que recupera o que ele perdeu: o
// candidato cuja order de cartão foi recusada/cancelada/expirada chama
// `liberar_cobranca_do_pedido`, NUNCA `confirmar_pagamento('recusado')` (que
// cancelaria o pedido e devolveria o estoque). PIX segue como era.

function orderDoCandidato(id: string, status: string, statusDetail: string, tipo: string) {
  return {
    id,
    status,
    status_detail: statusDetail,
    total_amount: "149.90",
    transactions: { payments: [{ id: "PAY1", status, status_detail: statusDetail, payment_method: { type: tipo } }] },
  };
}

for (
  const caso of [
    { nome: "crédito recusado (failed:high_risk)", status: "failed", detalhe: "high_risk", tipo: "credit_card" },
    { nome: "débito cancelado", status: "canceled", detalhe: "canceled", tipo: "debit_card" },
    { nome: "crédito expirado (3DS abandonado)", status: "expired", detalhe: "expired", tipo: "credit_card" },
  ]
) {
  Deno.test(`cartão — candidato com order ${caso.nome} -> liberar_cobranca_do_pedido(candidato), NUNCA confirmar_pagamento; ignorados:1, cobrancasLiberadas:1`, async () => {
    const idOrder = "ORDTST01CARTAORECUSADO";
    const registro = { chamadasConfirmar: [], chamadasLiberar: [], chamouCandidatos: false };
    const candidatos = [{ order_id: UUID_PEDIDO_1, gateway_payment_id: idOrder }];
    const supabase = clienteFalso({ candidatos, registro });
    const fetchImpl = fetchConsulta(200, orderDoCandidato(idOrder, caso.status, caso.detalhe, caso.tipo));

    const resposta = await handler(requisicaoComSegredo(SEGREDO), { supabase, fetchImpl });
    const corpo = await resposta.json();

    assertEquals(resposta.status, 200);
    assertEquals(registro.chamadasConfirmar.length, 0, "confirmar_pagamento('recusado') cancelaria o pedido");
    assertEquals(registro.chamadasLiberar, [
      { args: { p_order_id: UUID_PEDIDO_1, p_gateway_payment_id: idOrder } },
    ]);
    assertEquals(corpo.verificados, 1);
    assertEquals(corpo.confirmados, 0);
    assertEquals(corpo.ignorados, 1);
    assertEquals(corpo.falhas, 0);
    assertEquals(corpo.cobrancasLiberadas, 1);
  });
}

Deno.test("cartão — liberar devolve false (vaga já solta pelo webhook, ou pedido já expirado) -> ignorados:1, cobrancasLiberadas:0", async () => {
  const idOrder = "ORDTST01CARTAOJASOLTO";
  const registro = { chamadasConfirmar: [], chamadasLiberar: [], chamouCandidatos: false };
  const supabase = clienteFalso({
    candidatos: [{ order_id: UUID_PEDIDO_1, gateway_payment_id: idOrder }],
    liberarResultado: false,
    registro,
  });
  const fetchImpl = fetchConsulta(200, orderDoCandidato(idOrder, "failed", "failed", "credit_card"));

  const corpo = await (await handler(requisicaoComSegredo(SEGREDO), { supabase, fetchImpl })).json();

  assertEquals(corpo.ignorados, 1);
  assertEquals(corpo.cobrancasLiberadas, 0);
  assertEquals(registro.chamadasLiberar.length, 1);
  assertEquals(registro.chamadasConfirmar.length, 0);
});

Deno.test("cartão — liberar com erro de banco -> falhas:1 (o candidato volta no próximo ciclo), sem confirmar_pagamento", async () => {
  const idOrder = "ORDTST01CARTAOERRO";
  const registro = { chamadasConfirmar: [], chamadasLiberar: [], chamouCandidatos: false };
  const supabase = clienteFalso({
    candidatos: [{ order_id: UUID_PEDIDO_1, gateway_payment_id: idOrder }],
    liberarErro: { message: "deadlock" },
    registro,
  });
  const fetchImpl = fetchConsulta(200, orderDoCandidato(idOrder, "failed", "failed", "credit_card"));
  const erroReal = console.error;
  console.error = () => {};
  let corpo: Record<string, unknown>;
  try {
    corpo = await (await handler(requisicaoComSegredo(SEGREDO), { supabase, fetchImpl })).json();
  } finally {
    console.error = erroReal;
  }

  assertEquals(corpo.falhas, 1);
  assertEquals(corpo.ignorados, 0);
  assertEquals(corpo.cobrancasLiberadas, 0);
  assertEquals(registro.chamadasConfirmar.length, 0);
});

Deno.test("cartão — aprovado (processed:accredited) continua em confirmar_pagamento('pago') — a regra nova é só da recusa", async () => {
  const idOrder = "ORDTST01CARTAOPAGO";
  const registro = { chamadasConfirmar: [], chamadasLiberar: [], chamouCandidatos: false };
  const supabase = clienteFalso({
    candidatos: [{ order_id: UUID_PEDIDO_1, gateway_payment_id: idOrder }],
    rpcConfirmarResultado: "ja_pago",
    registro,
  });
  const fetchImpl = fetchConsulta(200, orderDoCandidato(idOrder, "processed", "accredited", "credit_card"));

  await handler(requisicaoComSegredo(SEGREDO), { supabase, fetchImpl });

  assertEquals(registro.chamadasLiberar.length, 0);
  assertEquals(registro.chamadasConfirmar.length, 1);
  assertEquals(registro.chamadasConfirmar[0].args.p_status, "pago");
});

Deno.test("PIX — candidato com order recusada (failed, bank_transfer) continua em confirmar_pagamento('recusado') — comportamento de antes", async () => {
  const idOrder = "ORDTST01PIXRECUSADO";
  const registro = { chamadasConfirmar: [], chamadasLiberar: [], chamouCandidatos: false };
  const supabase = clienteFalso({
    candidatos: [{ order_id: UUID_PEDIDO_1, gateway_payment_id: idOrder }],
    rpcConfirmarResultado: "recusado",
    registro,
  });
  const fetchImpl = fetchConsulta(200, orderDoCandidato(idOrder, "failed", "failed", "bank_transfer"));

  const corpo = await (await handler(requisicaoComSegredo(SEGREDO), { supabase, fetchImpl })).json();

  assertEquals(registro.chamadasLiberar.length, 0);
  assertEquals(registro.chamadasConfirmar.length, 1);
  assertEquals(registro.chamadasConfirmar[0].args.p_status, "recusado");
  assertEquals(corpo.cobrancasLiberadas, 0);
});

Deno.test("PIX — candidato com order CANCELADA (troca PIX -> cartão) só libera a vaga, nunca cancela o pedido", async () => {
  const idOrder = "ORDTST01PIXCANCELADO";
  const registro = { chamadasConfirmar: [], chamadasLiberar: [], chamouCandidatos: false };
  const supabase = clienteFalso({
    candidatos: [{ order_id: UUID_PEDIDO_1, gateway_payment_id: idOrder }],
    registro,
  });
  const fetchImpl = fetchConsulta(200, orderDoCandidato(idOrder, "canceled", "canceled", "bank_transfer"));

  const corpo = await (await handler(requisicaoComSegredo(SEGREDO), { supabase, fetchImpl })).json();

  assertEquals(registro.chamadasConfirmar.length, 0);
  assertEquals(registro.chamadasLiberar.length, 1);
  assertEquals(corpo.ignorados, 1);
});

Deno.test("invariante confirmados + ignorados + falhas === verificados continua valendo com liberações de cartão no lote", async () => {
  const registro = { chamadasConfirmar: [], chamadasLiberar: [], chamouCandidatos: false };
  const candidatos = [
    { order_id: UUID_PEDIDO_1, gateway_payment_id: "ORDTST01A" },
    { order_id: UUID_PEDIDO_2, gateway_payment_id: "ORDTST01B" },
  ];
  const supabase = clienteFalso({ candidatos, rpcConfirmarResultado: "pago", registro });
  const fetchImpl = async (url: string) => {
    const corpo = url.endsWith("ORDTST01A")
      ? orderDoCandidato("ORDTST01A", "failed", "rejected_by_issuer", "credit_card")
      : orderDoCandidato("ORDTST01B", "processed", "accredited", "credit_card");
    return new Response(JSON.stringify(corpo), { status: 200 });
  };

  const corpo = await (await handler(requisicaoComSegredo(SEGREDO), { supabase, fetchImpl })).json();

  assertEquals(corpo.verificados, 2);
  assertEquals(corpo.confirmados + corpo.ignorados + corpo.falhas, corpo.verificados);
  assertEquals(corpo.confirmados, 1);
  assertEquals(corpo.ignorados, 1);
  assertEquals(corpo.cobrancasLiberadas, 1);
});


// ── LEASE (Lote A, 04/10/2026 — achado causal do 01765261): o cron entrega
// ao executor a pergunta ao banco feita IMEDIATAMENTE antes do POST
// (autorizar_post_do_estorno), nos DOIS caminhos que POSTam: a linha
// solicitado e o retry da em_processamento. Não cabe => nenhum POST, a linha
// fica em_processamento com o motivo em ultimo_erro, nada terminal.

function registroDoLease() {
  return {
    chamadasConfirmar: [] as Array<{ args: Record<string, unknown> }>,
    chamouCandidatos: false,
    chamadasConcluirEstorno: [] as Array<{ args: Record<string, unknown> }>,
    chamadasAutorizarPost: [] as Array<{ args: Record<string, unknown> }>,
    atualizacoesOrderRefunds: [] as Array<
      { id: string; valores: Record<string, unknown>; statusFiltro: string[]; filtroIs?: [string, unknown] }
    >,
  };
}

Deno.test("LEASE-C1 - linha solicitado: o banco diz que o POST não cabe mais -> NENHUM POST; a linha nunca teve POST -> recusado (R1), condicionado ao carimbo", async () => {
  // R1 (revisão Opus de 14d77a5b): antes "adiada, nada terminal" — e a
  // linha, sem POST nenhum, ficava reservada para sempre. A linha INCERTA
  // no mesmo nao_cabe segue adiada: LEASE-C2 e R1-C2.
  const registro = registroDoLease();
  const pedido = pedidoFrescoPara({ total: 100, valor_estornado: 20 });
  const supabase = clienteFalso({
    candidatos: [],
    registro,
    refundsPendentes: [
      { id: "rl1", order_id: pedido.id, amount: 20, status: "solicitado", tentativas: 0, mp_refund_id: null },
    ],
    resolverPedidoFresco: (orderId) => (orderId === pedido.id ? pedido : null),
    autorizarPost: () => ({ data: { decisao: "nao_cabe", disponivel: 10 }, error: null }),
  });
  const mp = fetchDubleReconciliacao([
    { metodo: "POST", trecho: "/v1/payments/123456789/refunds", status: 201, corpo: { id: 999, status: "approved", amount: 20 } },
  ]);

  const resposta = await handler(requisicaoComSegredo(SEGREDO), { supabase, fetchImpl: mp.f });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 200);
  assertEquals(mp.chamadas.filter((c) => c.metodo === "POST").length, 0, "nenhum POST saiu");
  assertEquals(corpo.estornos, { vistos: 1, concluidos: 0, adiados: 0, falhos: 1 });
  assertEquals(registro.chamadasAutorizarPost.map((c) => c.args), [{ p_refund_id: "rl1", p_valor: 20 }]);
  assertEquals(registro.chamadasConcluirEstorno.length, 0);
  const terminal = registro.atualizacoesOrderRefunds.filter((a) => a.valores.status === "recusado");
  assertEquals(terminal.length, 1);
  assertEquals(terminal[0].valores.ultimo_erro, MOTIVO_SALDO_NAO_COBRE_MAIS);
  assertEquals(terminal[0].statusFiltro, ["em_processamento"]);
  assertEquals(terminal[0].filtroIs, ["post_autorizado_em", null], "o recusado só pega linha sem POST autorizado");
});

Deno.test("LEASE-C2 - retry da em_processamento (consulta sem refund): o banco diz que não cabe -> só o GET, NENHUM POST", async () => {
  const registro = registroDoLease();
  const pedido = pedidoFrescoPara({ total: 100, valor_estornado: 20 });
  const supabase = clienteFalso({
    candidatos: [],
    registro,
    refundsPendentes: [
      { id: "rl2", order_id: pedido.id, amount: 20, status: "em_processamento", tentativas: 2, mp_refund_id: null },
    ],
    resolverPedidoFresco: (orderId) => (orderId === pedido.id ? pedido : null),
    autorizarPost: () => ({ data: { decisao: "nao_cabe", disponivel: 10 }, error: null }),
  });
  const mp = fetchDubleReconciliacao([
    // A1 (15/10/2026): o MP prova que nada foi devolvido — a pergunta ao banco
    // só acontece depois da consulta do reenvio dizer `nao_achou`.
    { metodo: "GET", trecho: "/v1/payments/123456789", status: 200, corpo: PAGAMENTO_SEM_REEMBOLSO },
    { metodo: "POST", trecho: "/v1/payments/123456789/refunds", status: 201, corpo: { id: 555, status: "approved", amount: 20 } },
  ]);

  const resposta = await handler(requisicaoComSegredo(SEGREDO), { supabase, fetchImpl: mp.f });
  const corpo = await resposta.json();

  assertEquals(mp.chamadas.map((c) => c.metodo), ["GET", "GET"], "confirmação + consulta do reenvio; nenhum POST");
  assertEquals(corpo.estornos.adiados, 1);
  assertEquals(registro.chamadasAutorizarPost.map((c) => c.args), [{ p_refund_id: "rl2", p_valor: 20 }]);
  // Linha LEGADA (sem criada_sob_autorizacao) com tentativas 2: incerta —
  // o motivo diz que o valor segue reservado (sufixo MOTIVO_LINHA_INCERTA).
  assertEquals(
    registro.atualizacoesOrderRefunds.some(
      (a) =>
        a.id === "rl2" && String(a.valores.ultimo_erro ?? "").startsWith(MOTIVO_SALDO_MUDOU_ANTES_DO_POST) &&
        String(a.valores.ultimo_erro ?? "").includes(MOTIVO_LINHA_INCERTA),
    ),
    true,
  );
});

Deno.test("LEASE-C3 - autorizado: os dois caminhos perguntam ao banco UMA vez cada e o POST sai (controle positivo)", async () => {
  const registro = registroDoLease();
  const pedido = pedidoFrescoPara({ total: 100, valor_estornado: 0 });
  const supabase = clienteFalso({
    candidatos: [],
    registro,
    refundsPendentes: [
      { id: "rl3", order_id: pedido.id, amount: 20, status: "solicitado", tentativas: 0, mp_refund_id: null },
      { id: "rl4", order_id: pedido.id, amount: 30, status: "em_processamento", tentativas: 2, mp_refund_id: null },
    ],
    resolverPedidoFresco: (orderId) => (orderId === pedido.id ? pedido : null),
  });
  const mp = fetchDubleReconciliacao([
    // A1 (15/10/2026): rl4 já teve envio — sem a prova de que nada foi
    // devolvido, o POST dela não sairia.
    { metodo: "GET", trecho: "/v1/payments/123456789", status: 200, corpo: PAGAMENTO_SEM_REEMBOLSO },
    { metodo: "POST", trecho: "/v1/payments/123456789/refunds", status: 201, corpo: { id: 555, status: "in_process" } },
  ]);

  await handler(requisicaoComSegredo(SEGREDO), { supabase, fetchImpl: mp.f });

  assertEquals(
    registro.chamadasAutorizarPost.map((c) => c.args.p_refund_id).sort(),
    ["rl3", "rl4"],
  );
  assertEquals(mp.chamadas.filter((c) => c.metodo === "POST").map((c) => c.chave).sort(), ["rl3", "rl4"]);
});


// ── LINHA INCERTA (Lote A, 04/10/2026 — achado do coordenador em 1a823e3f):
// a 2ª passada do cron numa linha em_processamento (tentativas >= 1: o POST
// anterior pode ter chegado ao MP) com o pedido já em 90 NUNCA a termina; a
// prova externa (consulta ao MP mostrando o refund) conclui. A linha
// 'solicitado' (nunca marcada, nunca POSTada) continua recusada como antes.

Deno.test("INCERTA-C1 - retry de linha em_processamento (tentativas 2) com o pedido em 90: tentar_depois, ZERO POST, nada terminal, reserva preservada", async () => {
  const registro = registroDoLease();
  const pedido = pedidoFrescoPara({ total: 100, valor_estornado: 90 });
  const supabase = clienteFalso({
    candidatos: [],
    registro,
    refundsPendentes: [
      { id: "ri1", order_id: pedido.id, amount: 20, status: "em_processamento", tentativas: 2, mp_refund_id: null },
    ],
    resolverPedidoFresco: (orderId) => (orderId === pedido.id ? pedido : null),
  });
  const mp = fetchDubleReconciliacao([
    // A consulta não esclarece (sem refunds) — é o caminho que levaria ao retry.
    { metodo: "GET", trecho: "/v1/payments/123456789", status: 200, corpo: { id: 123456789, status: "approved" } },
    { metodo: "POST", trecho: "/v1/payments/123456789/refunds", status: 201, corpo: { id: 555, status: "approved", amount: 20 } },
  ]);

  const resposta = await handler(requisicaoComSegredo(SEGREDO), { supabase, fetchImpl: mp.f });
  const corpo = await resposta.json();

  assertEquals(mp.chamadas.map((c) => c.metodo), ["GET"], "só a consulta; ZERO POST novo");
  assertEquals(corpo.estornos, { vistos: 1, concluidos: 0, adiados: 1, falhos: 0 });
  assertEquals(registro.chamadasConcluirEstorno.length, 0);
  assertEquals(
    registro.atualizacoesOrderRefunds.some((a) => a.valores.status === "falhou" || a.valores.status === "recusado"),
    false,
    "nada terminal: a reserva fica",
  );
  assertEquals(
    registro.atualizacoesOrderRefunds.some(
      (a) => a.id === "ri1" && String(a.valores.ultimo_erro ?? "").includes(MOTIVO_LINHA_INCERTA),
    ),
    true,
  );
});

Deno.test("INCERTA-C2 (controle) - linha 'solicitado' (nunca marcada) com o pedido em 90: recusado como antes, zero chamada ao MP", async () => {
  const registro = registroDoLease();
  const pedido = pedidoFrescoPara({ total: 100, valor_estornado: 90 });
  const supabase = clienteFalso({
    candidatos: [],
    registro,
    refundsPendentes: [
      { id: "ri2", order_id: pedido.id, amount: 20, status: "solicitado", tentativas: 0, mp_refund_id: null },
    ],
    resolverPedidoFresco: (orderId) => (orderId === pedido.id ? pedido : null),
  });
  const mp = fetchDubleReconciliacao([]);

  const resposta = await handler(requisicaoComSegredo(SEGREDO), { supabase, fetchImpl: mp.f });
  const corpo = await resposta.json();

  assertEquals(mp.chamadas.length, 0);
  assertEquals(corpo.estornos.falhos, 1);
  assertEquals(
    registro.atualizacoesOrderRefunds.some((a) => a.id === "ri2" && a.valores.status === "recusado"),
    true,
  );
});

Deno.test("INCERTA-C3 - prova externa: a consulta ao MP mostra o refund da linha incerta -> conclui pela RPC, ZERO POST", async () => {
  const registro = registroDoLease();
  const pedido = pedidoFrescoPara({ total: 100, valor_estornado: 20 });
  const supabase = clienteFalso({
    candidatos: [],
    registro,
    refundsPendentes: [
      { id: "ri3", order_id: pedido.id, amount: 20, status: "em_processamento", tentativas: 3, mp_refund_id: null },
    ],
    resolverPedidoFresco: (orderId) => (orderId === pedido.id ? pedido : null),
    idsJaReivindicadosPorPedido: () => ["REF_ANTIGO"],
  });
  const mp = fetchDubleReconciliacao([
    {
      metodo: "GET",
      trecho: "/v1/payments/123456789",
      status: 200,
      corpo: {
        id: 123456789,
        status: "approved",
        transaction_amount_refunded: 40,
        refunds: [
          { id: "REF_ANTIGO", amount: 20, status: "approved" },
          { id: "REF_DA_INCERTA", amount: 20, status: "approved" },
        ],
      },
    },
  ]);

  const resposta = await handler(requisicaoComSegredo(SEGREDO), { supabase, fetchImpl: mp.f });
  const corpo = await resposta.json();

  assertEquals(mp.chamadas.map((c) => c.metodo), ["GET"]);
  assertEquals(corpo.estornos.concluidos, 1);
  assertEquals(registro.chamadasConcluirEstorno.map((c) => c.args.p_mp_refund_id), ["REF_DA_INCERTA"]);
});

// ── R1 (revisão Opus de 14d77a5b, 04/10/2026): reserva presa para sempre ──
// O cenário do revisor no cron: linha do app nascida DEPOIS da 20261196000000
// (criada_sob_autorizacao true), em_processamento, tentativas 2, SEM POST
// autorizado nunca (post_autorizado_em NULL), num pedido de 100 cujo saldo
// caiu por um REF externo de 70. Antes: tentativas > 1 = "incerta" ->
// tentar_depois em todo ciclo até o teto de 5, e depois só consulta — a
// reserva de 50 presa para sempre, sem dinheiro nenhum ter saído. Agora:
// consulta (nada), retry, a guarda recusa -> recusado, reserva liberada,
// ZERO POST. Controle: a MESMA linha com post_autorizado_em -> adiada.

function linhaDoCenarioR1(extras: Record<string, unknown> = {}) {
  return {
    id: "rr1",
    order_id: "pedido-fresco",
    amount: 50,
    status: "em_processamento",
    tentativas: 2,
    mp_refund_id: null,
    post_autorizado_em: null,
    criada_sob_autorizacao: true,
    ...extras,
  };
}

Deno.test("R1-C1 - linha nova sem POST autorizado, pedido em 70 de 100: consulta, retry, recusado (reserva liberada), ZERO POST", async () => {
  const registro = registroDoLease();
  const pedido = pedidoFrescoPara({ total: 100, valor_estornado: 70 });
  const linha = linhaDoCenarioR1({ order_id: pedido.id });
  const supabase = clienteFalso({
    candidatos: [],
    registro,
    refundsPendentes: [linha],
    resolverPedidoFresco: (orderId) => (orderId === pedido.id ? pedido : null),
    idsJaReivindicadosPorPedido: () => ["REF-EXT"],
    autorizarPost: () => ({ data: { decisao: "nao_cabe", disponivel: 30 }, error: null }),
  });
  const mp = fetchDubleReconciliacao([
    { metodo: "GET", trecho: "/v1/payments/123456789", status: 200, corpo: { id: 123456789, status: "approved" } },
    { metodo: "POST", trecho: "/v1/payments/123456789/refunds", status: 201, corpo: { id: 555, status: "approved", amount: 50 } },
  ]);

  const resposta = await handler(requisicaoComSegredo(SEGREDO), { supabase, fetchImpl: mp.f });
  const corpo = await resposta.json();

  assertEquals(mp.chamadas.filter((c) => c.metodo === "POST").length, 0, "ZERO POST");
  assertEquals(corpo.estornos, { vistos: 1, concluidos: 0, adiados: 0, falhos: 1 });
  const terminal = registro.atualizacoesOrderRefunds.filter((a) => a.valores.status === "recusado");
  assertEquals(terminal.length, 1, "recusado: a reserva é liberada");
  assertEquals(terminal[0].id, "rr1");
  assertEquals(terminal[0].filtroIs, ["post_autorizado_em", null]);
  assertEquals(registro.chamadasConcluirEstorno.length, 0);
});

Deno.test("R1-C2 (controle) - a MESMA linha com post_autorizado_em: adiada, nada terminal, reserva mantida, ZERO POST", async () => {
  const registro = registroDoLease();
  const pedido = pedidoFrescoPara({ total: 100, valor_estornado: 70 });
  const linha = linhaDoCenarioR1({ order_id: pedido.id, post_autorizado_em: "2026-10-04T10:00:00Z" });
  const supabase = clienteFalso({
    candidatos: [],
    registro,
    refundsPendentes: [linha],
    resolverPedidoFresco: (orderId) => (orderId === pedido.id ? pedido : null),
    idsJaReivindicadosPorPedido: () => ["REF-EXT"],
    autorizarPost: () => ({ data: { decisao: "nao_cabe", disponivel: 30 }, error: null }),
  });
  const mp = fetchDubleReconciliacao([
    { metodo: "GET", trecho: "/v1/payments/123456789", status: 200, corpo: { id: 123456789, status: "approved" } },
    { metodo: "POST", trecho: "/v1/payments/123456789/refunds", status: 201, corpo: { id: 555, status: "approved", amount: 50 } },
  ]);

  const resposta = await handler(requisicaoComSegredo(SEGREDO), { supabase, fetchImpl: mp.f });
  const corpo = await resposta.json();

  assertEquals(mp.chamadas.filter((c) => c.metodo === "POST").length, 0);
  assertEquals(corpo.estornos.adiados, 1);
  assertEquals(
    registro.atualizacoesOrderRefunds.some((a) => a.valores.status === "recusado" || a.valores.status === "falhou"),
    false,
    "nada terminal",
  );
  assertEquals(
    registro.atualizacoesOrderRefunds.some(
      (a) => a.id === "rr1" && String(a.valores.ultimo_erro ?? "").includes(MOTIVO_LINHA_INCERTA),
    ),
    true,
  );
});

Deno.test("R1-C3 - duas passadas do cron (o liveness do revisor): passada 1 com o banco dizendo nao_cabe numa linha 'solicitado' nova já termina em recusado; ZERO POST nas duas", async () => {
  // Passada 1: a linha nasceu agora (solicitado, criada_sob_autorizacao
  // true), o retrato do pedido ainda é o de antes do REF externo (a guarda
  // passa) e o banco, sob a trava, diz nao_cabe. Nenhum POST foi autorizado
  // -> recusado já aqui; o pedido do revisor era "no máximo na 2a passada".
  const registro = registroDoLease();
  const pedido = pedidoFrescoPara({ total: 100, valor_estornado: 0 });
  const supabase = clienteFalso({
    candidatos: [],
    registro,
    refundsPendentes: [linhaDoCenarioR1({ order_id: pedido.id, status: "solicitado", tentativas: 0 })],
    resolverPedidoFresco: (orderId) => (orderId === pedido.id ? pedido : null),
    autorizarPost: () => ({ data: { decisao: "nao_cabe", disponivel: 30 }, error: null }),
  });
  const mp = fetchDubleReconciliacao([
    { metodo: "POST", trecho: "/v1/payments/123456789/refunds", status: 201, corpo: { id: 555, status: "approved", amount: 50 } },
  ]);
  const corpo = await (await handler(requisicaoComSegredo(SEGREDO), { supabase, fetchImpl: mp.f })).json();
  assertEquals(mp.chamadas.length, 0, "ZERO chamada ao MP");
  assertEquals(corpo.estornos.falhos, 1);
  const terminal = registro.atualizacoesOrderRefunds.filter((a) => a.valores.status === "recusado");
  assertEquals(terminal.length, 1);
  assertEquals(terminal[0].valores.ultimo_erro, MOTIVO_SALDO_NAO_COBRE_MAIS);
  assertEquals(terminal[0].filtroIs, ["post_autorizado_em", null]);
});

// ── Roteiro de publicação (revisão Opus, cenários C4 e D1): o DEFAULT true de
// criada_sob_autorizacao saiu da 96 para a 20261201000000. Enquanto só a 96
// está no ar, a linha nova nasce NULL — o banco devolve o campo NULL de
// verdade (não ausente) — e o executor a trata como LEGADO: com tentativas 2
// (a edge ANTIGA marcou e pode ter mandado o POST, sem carimbo), ela é
// incerta e a reserva fica. O mesmo cenário com true (R1-C1) é recusado: por
// isso a 201 só sobe depois das edges novas e do escoamento das antigas.

Deno.test("R1-C4 - só com a 96 (criada_sob_autorizacao NULL vindo do banco), POST da edge antiga sem carimbo, tentativas 2, pedido em 70: adiada, nada terminal, ZERO POST", async () => {
  const registro = registroDoLease();
  const pedido = pedidoFrescoPara({ total: 100, valor_estornado: 70 });
  const linha = linhaDoCenarioR1({ order_id: pedido.id, criada_sob_autorizacao: null });
  const supabase = clienteFalso({
    candidatos: [],
    registro,
    refundsPendentes: [linha],
    resolverPedidoFresco: (orderId) => (orderId === pedido.id ? pedido : null),
    idsJaReivindicadosPorPedido: () => ["REF-EXT"],
    autorizarPost: () => ({ data: { decisao: "nao_cabe", disponivel: 30 }, error: null }),
  });
  const mp = fetchDubleReconciliacao([
    { metodo: "GET", trecho: "/v1/payments/123456789", status: 200, corpo: { id: 123456789, status: "approved" } },
    { metodo: "POST", trecho: "/v1/payments/123456789/refunds", status: 201, corpo: { id: 555, status: "approved", amount: 50 } },
  ]);

  const corpo = await (await handler(requisicaoComSegredo(SEGREDO), { supabase, fetchImpl: mp.f })).json();

  assertEquals(mp.chamadas.filter((c) => c.metodo === "POST").length, 0, "ZERO POST");
  assertEquals(corpo.estornos, { vistos: 1, concluidos: 0, adiados: 1, falhos: 0 });
  assertEquals(
    registro.atualizacoesOrderRefunds.some((a) => a.valores.status === "recusado" || a.valores.status === "falhou"),
    false,
    "nada terminal: a reserva fica",
  );
  assertEquals(
    registro.atualizacoesOrderRefunds.some(
      (a) => a.id === "rr1" && String(a.valores.ultimo_erro ?? "").includes(MOTIVO_LINHA_INCERTA),
    ),
    true,
  );
});

// ── Cartão PARCELADO com juros do comprador (07/10/2026) ───────────────────
// Fixtures SINTÉTICAS (164,35 / 168,49), não taxas medidas no MP.
// A conferência lê total_amount e a evidência de juros do pagamento:
// installments, installment_amount e captura. D7 também cobre o total
// financiado na raiz; não depende da premissa "só total_paid_amount sobe".
for (const principal of ["37.27", "40.86"]) {
  for (const parcela of [null, "18.64", "20.43"]) {
    Deno.test(`R1 cron: principal ${principal}, captura 40,86, parcela ${parcela ?? "ausente"}`, async () => {
      const id = "ORDTST01PARCELADOCOMJUROS";
      const registro = { chamadasConfirmar: [], chamouCandidatos: false };
      const supabase = clienteFalso({ candidatos: [{ order_id: UUID_PEDIDO_1, gateway_payment_id: id }],
        pedidoTotal: 37.27, registro });
      const o = orderParceladaComJuros(id, 2, "40.86");
      o.total_amount = principal;
      o.transactions.payments[0].amount = principal;
      if (parcela === null) delete o.transactions.payments[0].payment_method.installment_amount;
      else o.transactions.payments[0].payment_method.installment_amount = parcela;
      const logs = [];
      const warn = console.warn;
      console.warn = (...args) => logs.push(args);
      let r;
      try {
        r = await handler(requisicaoComSegredo(SEGREDO), { supabase, fetchImpl: fetchConsulta(200, o), enviarPushContado: async () => 1 });
      } finally { console.warn = warn; }
      const esperado = principal === "37.27" || parcela === "20.43";
      assertEquals(r.status, 200);
      assertEquals(registro.chamadasConfirmar.length, esperado ? 1 : 0);
      const avisos = logs.filter((l) => l[0] === "pagamento: juros_sem_parcela_conferida");
      assertEquals(avisos.length, principal === "37.27" && parcela !== "20.43" ? 1 : 0);
      if (avisos.length) assertEquals(avisos[0][1], { pedido: UUID_PEDIDO_1, total: 37.27, capturado: 40.86, parcelas: 2 });
    });
  }
}

Deno.test("REV3 cron: recusa final recuperada guarda só diagnóstico sanitizado; falha de gravação não muda a liberação", async () => {
  for (const falha of [null, "retorno", "excecao"]) {
    const id = "ORDTST01CARTAORECUSADO";
    const registro = { chamadasConfirmar: [], chamadasLiberar: [], chamouCandidatos: false };
    const base = clienteFalso({ candidatos: [{ order_id: UUID_PEDIDO_1, gateway_payment_id: id }], registro });
    const linhas = [];
    const supabase = { ...base, from: (tabela) => tabela === "tentativas_cartao_diagnostico" ? {
      upsert: async (linha, opcoes) => {
        linhas.push({ linha, opcoes });
        if (falha === "excecao") throw new Error("dado-privado-nao-logar");
        return { error: falha === "retorno" ? { message: "dado-privado-nao-logar" } : null };
      },
    } : base.from(tabela) };
    const o = orderDoCandidato(id, "failed", "high_risk", "credit_card");
    o.transactions.payments[0].amount = "37.27";
    o.transactions.payments[0].payment_method.installments = 2;
    o.payer = { email: "nao-logar@example.invalid", identification: { number: "00000000000" } };
    o.transactions.payments[0].payment_method.token = "dado-privado-nao-logar";
    const logs = [];
    const warn = console.warn;
    console.warn = (...args) => logs.push(args);
    let r;
    try {
      r = await handler(requisicaoComSegredo(SEGREDO), { supabase, fetchImpl: fetchConsulta(200, o) });
    } finally { console.warn = warn; }
    assertEquals(r.status, 200);
    const corpo = await r.json();
    assertEquals(corpo.falhas, 0);
    assertEquals(corpo.cobrancasLiberadas, 1);
    assertEquals(registro.chamadasLiberar, [{ args: { p_order_id: UUID_PEDIDO_1, p_gateway_payment_id: id } }]);
    assertEquals(registro.chamadasConfirmar, []);
    assertEquals(linhas.length, 1);
    const { registrado_em, ...linha } = linhas[0].linha;
    assertEquals(Number.isFinite(Date.parse(registrado_em)), true);
    assertEquals(linha, {
      pedido_id: UUID_PEDIDO_1, mp_order_id: id, mp_payment_id: "PAY1",
      status: "failed", status_detail: "high_risk", parcelas: 2, valor: 37.27,
    });
    assertEquals(linhas[0].opcoes, { onConflict: "mp_order_id,mp_payment_id", ignoreDuplicates: false });
    assertEquals(logs.some((l) => String(l[0]).startsWith("diagnostico-do-cartao:")), falha !== null);
    assertEquals(JSON.stringify(logs).includes("dado-privado-nao-logar"), false);
    assertEquals(JSON.stringify(logs).includes("nao-logar@example.invalid"), false);
    assertEquals(JSON.stringify(logs).includes("00000000000"), false);
  }
});

Deno.test("REV5 sentinela: total do pedido inválido não é rotulado como valor pago divergente", async () => {
  const id = "ORDTST01CARTAOCAPTURADO";
  const registro = { chamadasConfirmar: [], chamouCandidatos: false, adocoesPedido: [], chamadasAviso: [] };
  const supabase = clienteFalso({ candidatos: [{ order_id: UUID_PEDIDO_1, gateway_payment_id: SENTINELA_1 }],
    pedidoTotal: "ilegivel", registro });
  const o = orderParceladaComJuros(id, 2, "40.86");
  const alertas = [];
  const logs = [];
  const error = console.error;
  console.error = (...args) => logs.push(args);
  let r;
  try {
    r = await handler(requisicaoComSegredo(SEGREDO), {
      supabase, fetchImpl: fetchSentinela({ status: 200, corpo: { results: [o] } }, o, []),
      enviarPushContado: async ({ aviso }) => { alertas.push(aviso); return 1; },
    });
  } finally { console.error = error; }
  assertEquals(r.status, 200);
  assertEquals(registro.adocoesPedido, []);
  assertEquals(registro.chamadasConfirmar, []);
  assertEquals(alertas.length, 1);
  assertStringIncludes(alertas[0].body, "total do pedido inválido");
  assertEquals(alertas[0].body.includes("valor divergente"), false);
  assertStringIncludes(String(logs[0][0]), "total do pedido inválido");
  assertEquals(logs[0][1].motivo, "total_do_pedido");
  assertEquals(registro.chamadasAviso[0].args.p_chave, `total_do_pedido_invalido:${UUID_PEDIDO_1}:${id}`);
});

Deno.test("R1 cron: divergência avisa o admin uma vez, sem confirmar", async () => {
  const id = "ORDTST01PARCELADOCOMJUROS";
  const registro = { chamadasConfirmar: [], chamouCandidatos: false, chamadasAviso: [] };
  const supabase = clienteFalso({ candidatos: [{ order_id: UUID_PEDIDO_1, gateway_payment_id: id }], pedidoTotal: 37.27, registro });
  const o = orderParceladaComJuros(id, 2, "55.91");
  o.total_amount = "37.27";
  o.transactions.payments[0].amount = "37.27";
  delete o.transactions.payments[0].payment_method.installment_amount;
  const alertas = [];
  for (let vez = 0; vez < 2; vez++) {
    const r = await handler(requisicaoComSegredo(SEGREDO), {
      supabase, fetchImpl: fetchConsulta(200, o),
      enviarPushContado: async ({ aviso }) => { alertas.push(aviso); return 1; },
    });
    assertEquals((await r.json()).confirmados, 0);
  }
  assertEquals(registro.chamadasConfirmar.length, 0);
  assertEquals(alertas.length, 1);
  assertEquals(alertas[0].body.includes("valor divergente"), true);
});

Deno.test("R2 sentinela: raiz financiada é adotada; menor não é; valor ausente preserva adoção anterior", async () => {
  for (const [principal, esperadoAdotar, esperadoConfirmar] of [["40.86", true, true], ["37.26", false, false], [null, true, false]]) {
    const id = "ORDTST01CARTAOCAPTURADO";
    const registro = { chamadasConfirmar: [], chamouCandidatos: false, adocoesPedido: [] };
    const supabase = clienteFalso({ candidatos: [{ order_id: UUID_PEDIDO_1, gateway_payment_id: SENTINELA_1 }], pedidoTotal: 37.27, registro });
    const o = orderParceladaComJuros(id, 2, "40.86");
    o.total_amount = principal;
    o.transactions.payments[0].amount = principal;
    const avisos = [];
    const r = await handler(requisicaoComSegredo(SEGREDO), {
      supabase, fetchImpl: fetchSentinela({ status: 200, corpo: { results: [o] } }, o, []),
      enviarPushContado: async ({ aviso }) => { avisos.push(aviso); return 1; },
    });
    assertEquals(r.status, 200);
    if (principal === "37.26") {
      assertEquals(avisos.length, 1, "divergência antes da adoção também precisa chegar ao admin");
      assertEquals(avisos[0].body.includes("valor divergente"), true);
    }
    assertEquals(registro.adocoesPedido.length, esperadoAdotar ? 1 : 0, String(principal));
    assertEquals(registro.chamadasConfirmar.length, esperadoConfirmar ? 1 : 0, String(principal));
  }
});

Deno.test("D7 cron: raiz financiada confirma; acima do teto ou captura menor não confirmam", async () => {
  for (const [total, pago, parcela, esperado] of [
    ["164.35", "164.35", "82.18", true],
    ["240.00", "240.00", "120.00", false],
    ["149.90", "149.89", "74.95", false],
  ]) {
    const registro = { chamadasConfirmar: [], chamouCandidatos: false };
    const id = "ORDTST01PARCELADOCOMJUROS";
    const supabase = clienteFalso({ candidatos: [{ order_id: UUID_PEDIDO_1, gateway_payment_id: id }], registro });
    const o = orderParceladaComJuros(id, 2, pago);
    o.total_amount = total;
    o.transactions.payments[0].amount = total;
    o.transactions.payments[0].payment_method.installment_amount = parcela;
    const r = await handler(requisicaoComSegredo(SEGREDO), { supabase, fetchImpl: fetchConsulta(200, o) });
    assertEquals(r.status, 200);
    assertEquals(registro.chamadasConfirmar.length, esperado ? 1 : 0);
    assertEquals((await r.json()).confirmados, esperado ? 1 : 0);
  }
});

const PARCELADOS_COM_JUROS = [
  { parcelas: 1, pago: "149.90" },
  { parcelas: 2, pago: "164.35" },
  { parcelas: 3, pago: "168.49" },
];

function orderParceladaComJuros(id: string, parcelas: number, pago: string): Record<string, unknown> {
  return {
    id,
    external_reference: UUID_PEDIDO_1,
    status: "processed",
    status_detail: "accredited",
    total_amount: "149.90",
    total_paid_amount: pago,
    date_created: "2026-09-30T12:00:00.000Z",
    transactions: {
      payments: [{
        amount: "149.90",
        paid_amount: pago,
        status: "processed",
        status_detail: "accredited",
        payment_method: { id: "visa", type: "credit_card", installments: parcelas, installment_amount: (Number(pago) / parcelas).toFixed(2) },
      }],
    },
  };
}

for (const caso of PARCELADOS_COM_JUROS) {
  Deno.test(`cartão parcelado ${caso.parcelas}x — order aprovada com valor pago ${caso.pago} (pedido 149,90) -> confirmados:1, nunca ignorado por valor`, async () => {
    const registro = { chamadasConfirmar: [], chamouCandidatos: false };
    const idOrder = "ORDTST01PARCELADOCOMJUROS";
    const candidatos = [{ order_id: UUID_PEDIDO_1, gateway_payment_id: idOrder }];
    const supabase = clienteFalso({ candidatos, rpcConfirmarResultado: "pago", registro });
    const fetchImpl = fetchConsulta(200, orderParceladaComJuros(idOrder, caso.parcelas, caso.pago));

    const resposta = await handler(requisicaoComSegredo(SEGREDO), { supabase, fetchImpl });
    const corpo = await resposta.json();

    assertEquals(resposta.status, 200);
    assertEquals(corpo.confirmados, 1, "juros do parcelado não é valor divergente");
    assertEquals(corpo.ignorados, 0);
    assertEquals(registro.chamadasConfirmar.length, 1);
    assertEquals(registro.chamadasConfirmar[0].args.p_payment_id, idOrder);
    assertEquals(registro.chamadasConfirmar[0].args.p_status, "pago");
  });

  Deno.test(`cartão parcelado ${caso.parcelas}x — sentinela com a order capturada e valor pago ${caso.pago} -> adota com parcelas ${caso.parcelas} e confirma`, async () => {
    const registro = { chamadasConfirmar: [], chamouCandidatos: false, adocoesPedido: [] as any[] };
    const candidatos = [{ order_id: UUID_PEDIDO_1, gateway_payment_id: SENTINELA_1 }];
    const supabase = clienteFalso({ candidatos, registro });
    const urls: string[] = [];
    const order = orderParceladaComJuros("ORDTST01CARTAOCAPTURADO", caso.parcelas, caso.pago);
    const fetchImpl = fetchSentinela({ status: 200, corpo: { results: [order] } }, order, urls);

    const resposta = await handler(requisicaoComSegredo(SEGREDO), { supabase, fetchImpl });
    const corpo = await resposta.json();

    assertEquals(resposta.status, 200);
    assertEquals(registro.adocoesPedido.length, 1);
    assertEquals(registro.adocoesPedido[0].valores.metodo_online, "credito");
    assertEquals(registro.adocoesPedido[0].valores.parcelas, caso.parcelas);
    assertEquals(registro.chamadasConfirmar.length, 1);
    assertEquals(registro.chamadasConfirmar[0].args.p_status, "pago");
    assertEquals(corpo.confirmados, 1);
  });
}

// --- O aviso "o cliente cancelou" NAO prende a fila de estornos (14/10/2026) --
//
// O passo que avisa o lojista roda ANTES da fila de `order_refunds`. Push
// service que aceita a conexao e nao responde (o `fetch` do web-push nao tem
// teto) deixava o handler parado nesse passo: nenhum estorno da loja rodava,
// inclusive o do proprio pedido cancelado, e a reserva vencia em 2 min e a
// rodada seguinte pendurava de novo. O passo INTEIRO corre contra um teto
// (`comTempoLimite`); vencido o teto, a rotina segue direto para os estornos.
const CLIENTE_DO_CANCELAMENTO = "c1111111-1111-4111-8111-111111111111";

function comCancelamentoDoCliente(base: ReturnType<typeof clienteFalso>, pedido: Record<string, unknown>) {
  const reservas = new Map<string, boolean>();
  const historico = [{
    id: "h1",
    order_id: pedido.id,
    old_status: "processing",
    created_by: CLIENTE_DO_CANCELAMENTO,
    created_at: new Date(Date.now() - 2 * 60000).toISOString(),
  }];
  const pedidoDoAviso = {
    id: pedido.id,
    user_id: CLIENTE_DO_CANCELAMENTO,
    customer_name: "Maria Silva",
    total: pedido.total,
    total_amount: null,
    payment_status: "pago",
    status: "cancelled",
    cancelled_after_shipping: false,
  };
  // Cadeia que ignora os filtros (eles tem teste proprio no modulo): o que
  // este teste prende e o TEMPO, nao a selecao.
  const cadeia = (dados: unknown[]) => {
    const q = { eq: () => q, not: () => q, gte: () => q, order: () => q, limit: () => q };
    return Object.assign(q, {
      then: (res: (v: unknown) => void, rej?: (e: unknown) => void) =>
        Promise.resolve({ data: dados, error: null }).then(res, rej),
    });
  };
  return {
    reservas,
    rpc: async (nome: string, args?: Record<string, unknown>) => {
      if (nome === "reservar_aviso_ao_lojista") {
        const chave = String(args?.p_chave);
        if (reservas.has(chave)) return { data: reservas.get(chave) ? "enviado" : "em_envio", error: null };
        reservas.set(chave, false);
        return { data: "reservado", error: null };
      }
      if (nome === "confirmar_aviso_ao_lojista") return reservas.set(String(args?.p_chave), true), { data: null, error: null };
      if (nome === "liberar_aviso_ao_lojista") return reservas.delete(String(args?.p_chave)), { data: null, error: null };
      return base.rpc(nome, args);
    },
    from(tabela: string) {
      if (tabela === "marketplace_order_history") return { select: () => cadeia(historico) };
      if (tabela === "profiles") return { select: () => ({ in: () => Promise.resolve({ data: [{ id: CLIENTE_DO_CANCELAMENTO, role: "customer" }], error: null }) }) };
      if (tabela === "marketplace_orders") {
        const original = base.from(tabela);
        return {
          ...original,
          select: (colunas: string) =>
            colunas.includes("user_id")
              ? { in: () => Promise.resolve({ data: [pedidoDoAviso], error: null }) }
              : original.select(colunas),
        };
      }
      return base.from(tabela);
    },
  };
}

function cenarioDeCancelamentoComEstorno() {
  const registro = {
    chamadasConfirmar: [] as Array<{ args: Record<string, unknown> }>,
    chamouCandidatos: false,
    chamadasConcluirEstorno: [] as Array<{ args: Record<string, unknown> }>,
    atualizacoesOrderRefunds: [] as Array<
      { id: string; valores: Record<string, unknown>; statusFiltro: string[] }
    >,
  };
  const pedido = pedidoFrescoPara({ total: 50 });
  const base = clienteFalso({
    candidatos: [],
    registro,
    refundsPendentes: [
      { id: "r1", order_id: pedido.id, amount: 50, status: "solicitado", tentativas: 0, mp_refund_id: null },
    ],
    resolverPedidoFresco: (orderId) => (orderId === pedido.id ? pedido : null),
  });
  const mp = fetchDubleReconciliacao([
    { metodo: "POST", trecho: "/v1/payments/123456789/refunds", status: 201, corpo: { id: 999, status: "approved", amount: 50 } },
  ]);
  return { registro, supabase: comCancelamentoDoCliente(base, pedido), mp };
}

async function rodarSemPrender(args: Parameters<typeof handler>[1]) {
  let temporizador: ReturnType<typeof setTimeout> | undefined;
  const pendurado = new Promise<"PENDURADO">((resolve) => {
    temporizador = setTimeout(() => resolve("PENDURADO"), 3000);
  });
  const e0 = console.error, w0 = console.warn, l0 = console.log;
  console.error = () => {};
  console.warn = () => {};
  console.log = () => {};
  try {
    return await Promise.race([handler(requisicaoComSegredo(SEGREDO), args), pendurado]);
  } finally {
    clearTimeout(temporizador);
    console.error = e0;
    console.warn = w0;
    console.log = l0;
  }
}

Deno.test("cancelamento do cliente: push que NUNCA responde NAO prende a fila de estornos - o estorno do proprio pedido cancelado sai", async () => {
  const { registro, supabase, mp } = cenarioDeCancelamentoComEstorno();

  const resposta = await rodarSemPrender({
    supabase,
    fetchImpl: mp.f,
    enviarPushContado: () => new Promise(() => {}),
    tetoDosCancelamentosMs: 50,
  });

  assertEquals(resposta === "PENDURADO", false, "o handler ficou preso no passo do aviso: a fila de estornos nunca foi lida");
  const corpo = await resposta.json();
  assertEquals(resposta.status, 200);
  assertEquals(corpo.estornos, { vistos: 1, concluidos: 1, adiados: 0, falhos: 0 });
  assertEquals(registro.chamadasConcluirEstorno.length, 1);
  // O teto venceu: o passo nao contou nada (o push segue em voo, em segundo plano).
  assertEquals(corpo.cancelamentos, { candidatos: 0, avisados: 0, ignorados: 0, falhas: 0 });
});

Deno.test("cancelamento do cliente: push que responde -> o lojista e avisado E o estorno sai na mesma rodada", async () => {
  const { registro, supabase, mp } = cenarioDeCancelamentoComEstorno();
  const pushes: Array<{ title: string }> = [];

  const resposta = await rodarSemPrender({
    supabase,
    fetchImpl: mp.f,
    enviarPushContado: ({ aviso }) => {
      pushes.push(aviso);
      return Promise.resolve(1);
    },
  });

  assertEquals(resposta === "PENDURADO", false);
  const corpo = await resposta.json();
  assertEquals(pushes.map((p) => p.title), ["Cliente cancelou o pedido"]);
  assertEquals(corpo.cancelamentos, { candidatos: 1, avisados: 1, ignorados: 0, falhas: 0 });
  assertEquals(corpo.estornos.concluidos, 1);
  assertEquals(registro.chamadasConcluirEstorno.length, 1);
});

// ── 14/10/2026 — reembolso da devolução, parte TypeScript (D4/D5/D6) ────────
// O cron grava o diagnóstico do POST ANTES de qualquer `falhou`, aplica o limite
// de falhas "nada saiu" e nunca põe motivo interno em `ultimo_erro`.

async function cronComPostRecusado(
  status: number,
  corpo: unknown,
  extras: Partial<Parameters<typeof clienteFalso>[0]> = {},
  linha: Record<string, unknown> = {},
) {
  const registro = {
    chamadasConfirmar: [] as Array<{ args: Record<string, unknown> }>,
    chamouCandidatos: false,
    chamadasConcluirEstorno: [] as Array<{ args: Record<string, unknown> }>,
    chamadasDiagnostico: [] as Array<{ args: Record<string, unknown> }>,
    ordemDeGravacao: [] as string[],
    atualizacoesOrderRefunds: [] as Array<
      { id: string; valores: Record<string, unknown>; statusFiltro: string[] }
    >,
  };
  const pedido = pedidoFrescoPara({ total: 50 });
  const supabase = clienteFalso({
    candidatos: [],
    registro,
    refundsPendentes: [
      { id: "r1", order_id: pedido.id, amount: 50, status: "solicitado", tentativas: 0, mp_refund_id: null, ...linha },
    ],
    resolverPedidoFresco: (orderId) => (orderId === pedido.id ? pedido : null),
    ...extras,
  });
  const mp = fetchDubleReconciliacao([
    { metodo: "POST", trecho: "/v1/payments/123456789/refunds", status, corpo },
  ]);
  const resposta = await handler(requisicaoComSegredo(SEGREDO), { supabase, fetchImpl: mp.f });
  return { corpo: await resposta.json(), registro };
}

Deno.test("C1 (M6/D4) - cron: 428 'sem saldo' (errors[]): diagnóstico gravado, linha adiada (NÃO falhou), ultimo_erro neutro", async () => {
  const { corpo, registro } = await cronComPostRecusado(428, { errors: [{ code: "insufficient_money_for_refund", message: "saldo" }] }, {
    diagnostico: { transitorios: 2, post_incerto: false },
  });
  assertEquals(corpo.estornos, { vistos: 1, concluidos: 0, adiados: 1, falhos: 0 });
  assertEquals(registro.chamadasDiagnostico.map((c) => c.args), [
    { p_refund_id: "r1", p_mp_codigo: "insufficient_money_for_refund", p_post_incerto: false, p_transitorio: true },
  ]);
  assertEquals(registro.atualizacoesOrderRefunds.some((a) => a.valores.status === "falhou"), false);
  const erro = registro.atualizacoesOrderRefunds.find((a) => typeof a.valores.ultimo_erro === "string");
  assertEquals(/saldo|insufficient|conta/i.test(String(erro?.valores.ultimo_erro)), false);
});

Deno.test("C2 (D4) - cron: a 5ª falha 'nada saiu' sem carimbo vira falhou, DEPOIS de gravar o diagnóstico; com carimbo nunca", async () => {
  const quinta = await cronComPostRecusado(428, { errors: [{ code: "insufficient_money_for_refund" }] }, {
    diagnostico: { transitorios: 5, post_incerto: false },
  });
  assertEquals(quinta.corpo.estornos, { vistos: 1, concluidos: 0, adiados: 0, falhos: 1 });
  assertEquals(quinta.registro.ordemDeGravacao, ["diagnostico", "final"]);
  const terminal = quinta.registro.atualizacoesOrderRefunds.find((a) => a.valores.status === "falhou");
  assertEquals(terminal?.statusFiltro, ["em_processamento"]);
  assertEquals(/saldo|insufficient|conta/i.test(String(terminal?.valores.ultimo_erro)), false);

  const comCarimbo = await cronComPostRecusado(428, { errors: [{ code: "insufficient_money_for_refund" }] }, {
    diagnostico: { transitorios: 9, post_incerto: true },
  });
  assertEquals(comCarimbo.corpo.estornos, { vistos: 1, concluidos: 0, adiados: 1, falhos: 0 });
  assertEquals(comCarimbo.registro.atualizacoesOrderRefunds.some((a) => a.valores.status === "falhou"), false);
});

Deno.test("C3 (D6) - cron: código DESCONHECIDO: falhou, mas só depois do diagnóstico com carimbo; se o diagnóstico não grava, NÃO falhou", async () => {
  const ok = await cronComPostRecusado(400, { errors: [{ code: "codigo_novo_do_mp" }] });
  assertEquals(ok.registro.chamadasDiagnostico.map((c) => c.args), [
    { p_refund_id: "r1", p_mp_codigo: "codigo_novo_do_mp", p_post_incerto: true, p_transitorio: false },
  ]);
  assertEquals(ok.registro.ordemDeGravacao, ["diagnostico", "final"]);
  assertEquals(JSON.stringify(ok.registro.atualizacoesOrderRefunds).includes("codigo_novo_do_mp"), false);

  const semDiagnostico = await cronComPostRecusado(400, { errors: [{ code: "codigo_novo_do_mp" }] }, {
    erroDiagnostico: { message: "banco fora" },
  });
  assertEquals(semDiagnostico.corpo.estornos.falhos, 0);
  assertEquals(semDiagnostico.registro.atualizacoesOrderRefunds.some((a) => a.valores.status === "falhou"), false);
});

Deno.test("C4 (D5) - cron: 'em andamento' (movement_operations_pending) fica em_processamento com carimbo e NUNCA vira falhou", async () => {
  const r = await cronComPostRecusado(409, { errors: [{ code: "movement_operations_pending" }] });
  assertEquals(r.corpo.estornos, { vistos: 1, concluidos: 0, adiados: 1, falhos: 0 });
  assertEquals(r.registro.chamadasDiagnostico[0].args.p_post_incerto, true);
  assertEquals(r.registro.atualizacoesOrderRefunds.some((a) => a.valores.status === "falhou"), false);
});

Deno.test("C5 (D4) - cron: linha antiga já no regime 'só consulta' (tentativas 5, sem diagnóstico): continua em consulta, sem POST e SEM falhou — o limite novo não a alcança", async () => {
  const r = await cronComPostRecusado(400, {}, {}, { status: "em_processamento", tentativas: 5 });
  assertEquals(r.corpo.estornos.falhos, 0);
  // Só a LEITURA do diagnóstico (tudo nulo/falso, nada incrementa nem carimba);
  // sem código gravado, a linha segue em consulta.
  assertEquals(r.registro.chamadasDiagnostico.map((c) => c.args), [
    { p_refund_id: "r1", p_mp_codigo: null, p_post_incerto: false, p_transitorio: false },
  ]);
  assertEquals(r.registro.atualizacoesOrderRefunds.some((a) => a.valores.status === "falhou"), false);
});

// ── 14/10/2026 (correção da revisão Opus do #855) — dois contadores, o mesmo teto ──
// O robô para de POSTar com 5 TENTATIVAS (sobem em todo ciclo, até as que nem
// chegam ao MP); a linha só virava `falhou` na 5ª RECUSA "nada saiu" (sobe só
// quando o MP responde). Uma consulta que falha no meio descasa os dois e a
// linha ficava em_processamento para sempre. Estes testes SIMULAM os ciclos do
// robô com o estado da linha e do diagnóstico acumulando de verdade.

// `post_201_processando`: entrou saldo, o MP aceita o POST (201, order "refunded")
// com o reembolso DESTA linha em "processing" — sem carimbo, e a gravação do id
// do MP nunca chega (o fake não guarda `mp_refund_id`, como numa escrita suave
// que falhou). `consulta_processando`: o GET mostra esse reembolso em andamento.
type CicloDoMp = "sem_saldo" | "consulta_cai" | "post_500" | "post_201_processando" | "consulta_processando";

async function simularCiclos(ciclos: CicloDoMp[]) {
  const orderId = "20000000-0000-4000-8000-0000000000dd";
  const pedido = pedidoFrescoPara({ id: orderId, gateway_payment_id: "ORD01ABCDEFOLUIMWQKDXYZ01", total: 50 });
  const linha = { status: "solicitado", tentativas: 0 };
  const tabela = { transitorios: 0, postIncerto: false, codigo: null as string | null, existe: false };
  const historico: string[] = [];
  const corpoOrder = {
    id: "ORD01ABCDEFOLUIMWQKDXYZ01",
    status: "processed",
    transactions: { payments: [{ id: "PAY01XYZEXEMPLODETRANSA1", status: "processed" }] },
  };
  for (const ciclo of ciclos) {
    if (linha.status === "falhou") {
      historico.push("falhou");
      continue;
    }
    const registro = {
      chamadasConfirmar: [] as Array<{ args: Record<string, unknown> }>,
      chamouCandidatos: false,
      chamadasConcluirEstorno: [] as Array<{ args: Record<string, unknown> }>,
      atualizacoesOrderRefunds: [] as Array<{ id: string; valores: Record<string, unknown>; statusFiltro: string[] }>,
    };
    const supabase = clienteFalso({
      candidatos: [],
      registro,
      refundsPendentes: [{ id: "r1", order_id: orderId, amount: 50, status: linha.status, tentativas: linha.tentativas, mp_refund_id: null }],
      resolverPedidoFresco: (id) => (id === orderId ? pedido : null),
      atualizarOrderRefunds: (_id, valores) => {
        if (typeof valores.tentativas === "number") linha.tentativas = valores.tentativas;
        if (typeof valores.status === "string") linha.status = valores.status;
        return { data: [{ id: "r1" }], error: null };
      },
      // O que a tabela de diagnóstico faz de verdade: UPSERT com incremento,
      // carimbo que nunca sai, código que só é trocado por outro não nulo. A
      // chamada "de leitura" (tudo nulo/falso) devolve o estado sem mexer.
      aoRegistrarDiagnostico: (args) => {
        tabela.existe = true;
        if (typeof args.p_mp_codigo === "string") tabela.codigo = args.p_mp_codigo;
        if (args.p_post_incerto === true) tabela.postIncerto = true;
        if (args.p_transitorio === true) tabela.transitorios++;
        return { transitorios: tabela.transitorios, post_incerto: tabela.postIncerto, mp_codigo: tabela.codigo };
      },
    });
    const orderComReembolsoEmAndamento = {
      ...corpoOrder,
      status: "refunded",
      transactions: {
        payments: [{ id: "PAY01XYZEXEMPLODETRANSA1", status: "processed" }],
        refunds: [{ id: "REF-X", amount: "50.00", status: "processing" }],
      },
    };
    const rotasGet = ciclo === "consulta_cai"
      ? [{ metodo: "GET", trecho: "/v1/orders/ORD01ABCDEFOLUIMWQKDXYZ01", status: 500, corpo: {} }]
      : [{ metodo: "GET", trecho: "/v1/orders/ORD01ABCDEFOLUIMWQKDXYZ01", status: 200, corpo: ciclo === "consulta_processando" ? orderComReembolsoEmAndamento : corpoOrder }];
    const rotaPost = ciclo === "post_500"
      ? { status: 500, corpo: {} }
      : ciclo === "post_201_processando"
      ? { status: 201, corpo: orderComReembolsoEmAndamento }
      : { status: 428, corpo: { errors: [{ code: "insufficient_money_for_refund" }] } };
    const mp = fetchDubleReconciliacao([
      ...rotasGet,
      { metodo: "POST", trecho: "/v1/orders/ORD01ABCDEFOLUIMWQKDXYZ01/refund", ...rotaPost },
    ]);
    await handler(requisicaoComSegredo(SEGREDO), { supabase, fetchImpl: mp.f });
    historico.push(`${linha.status}/t${linha.tentativas}/r${tabela.transitorios}${tabela.postIncerto ? "/carimbo" : ""}`);
  }
  return { linha, historico };
}

Deno.test("CICLOS-1 - a consulta cai no ciclo 4 e 'sem saldo' nos outros: tentativas (5) passam as recusas (4) e mesmo assim a linha vira falhou — não fica presa em_processamento", async () => {
  const r = await simularCiclos(["sem_saldo", "sem_saldo", "sem_saldo", "consulta_cai", "sem_saldo", "sem_saldo", "sem_saldo", "sem_saldo"]);
  // P1 do Codex no #888 (15/10/2026): a consulta que cai no ciclo 4 é o
  // pré-voo do reenvio — ciclo sem envio, NÃO gasta tentativa. Os dois
  // contadores seguem juntos (t4/r4 no ciclo 5) e a 5ª recusa vira falhou.
  // O descasamento por um ciclo sem POST que CONTA está em CICLOS-6.
  assertEquals(r.historico[3], "em_processamento/t3/r3");
  assertEquals(r.historico[4], "em_processamento/t4/r4");
  assertEquals(r.linha.status, "falhou");
  assertEquals(r.historico[5].startsWith("falhou"), true);
});

Deno.test("CICLOS-2 - sem nenhuma falha no meio o limite continua o de antes: a 5ª recusa vira falhou", async () => {
  const r = await simularCiclos(["sem_saldo", "sem_saldo", "sem_saldo", "sem_saldo", "sem_saldo", "sem_saldo"]);
  assertEquals(r.historico[4].startsWith("falhou"), true);
});

Deno.test("CICLOS-3 - COM carimbo de incerteza (um POST caiu em 500 no ciclo 4) a linha NUNCA vira falhou: fica em consulta pelos 9 ciclos", async () => {
  const r = await simularCiclos(["sem_saldo", "sem_saldo", "sem_saldo", "post_500", "sem_saldo", "sem_saldo", "sem_saldo", "sem_saldo", "sem_saldo"]);
  assertEquals(r.linha.status, "em_processamento");
  assertEquals(r.historico.at(-1)?.endsWith("/carimbo"), true);
});

Deno.test("CICLOS-4 - linha antiga (sem diagnóstico algum, regime 'só consulta' desde antes) continua em consulta: ler o diagnóstico não a transforma em 'nada saiu'", async () => {
  const r = await simularCiclos(["consulta_cai", "consulta_cai", "consulta_cai", "consulta_cai", "consulta_cai", "consulta_cai", "consulta_cai"]);
  assertEquals(r.linha.status, "em_processamento");
});

Deno.test("CICLOS-5 - o saldo ENTRA no ciclo 5 (POST 201, reembolso desta linha em 'processing', id do MP não grava) e no ciclo 6 a consulta o vê em andamento: a linha NÃO vira falhou (o dinheiro está saindo) — fica em consulta por todos os ciclos", async () => {
  const r = await simularCiclos([
    "sem_saldo", "sem_saldo", "sem_saldo", "sem_saldo", "post_201_processando",
    "consulta_processando", "consulta_processando", "consulta_processando",
  ]);
  assertEquals(r.historico[3], "em_processamento/t4/r4");
  assertEquals(r.historico[4], "em_processamento/t5/r4");
  assertEquals(r.linha.status, "em_processamento");
  assertEquals(r.historico.some((h) => h.startsWith("falhou")), false);
});

Deno.test("CICLOS-6 - na linha travada, consulta que FALHA (500) continua em consulta; no ciclo seguinte, com o MP legível e sem reembolso, vira falhou", async () => {
  // P1 do Codex no #888: o descasamento vem do 1º ciclo — a consulta da
  // TRANSAÇÃO cai antes de qualquer POST (linha nova, sem pré-voo), e esse ciclo
  // CONTA. Quatro "sem saldo" depois, a linha está travada com t5/r4.
  const r = await simularCiclos([
    "consulta_cai", "sem_saldo", "sem_saldo", "sem_saldo", "sem_saldo",
    "consulta_cai", "sem_saldo",
  ]);
  assertEquals(r.historico[0], "em_processamento/t1/r0");
  assertEquals(r.historico[4], "em_processamento/t5/r4");
  assertEquals(r.historico[5], "em_processamento/t5/r4");
  assertEquals(r.historico[6].startsWith("falhou"), true);
});

// =============================================================================
// P1 (21/10/2026, revisão adversarial do lote 1.5.47) — DEVOLUÇÃO PARCIAL
// ANTES DA CONFIRMAÇÃO, pela rede de segurança. O PIX de R$ 100 foi pago, o
// webhook falhou e o lojista devolveu R$ 20 no painel do Mercado Pago: a order
// passa a `processed:partially_refunded` (par que o mapa traduz para `null`
// DE PROPÓSITO) e este cron a ignorava como "status desconhecido" — o pedido
// expirava com a venda paga. Uma devolução parcial concluída prova a
// aprovação (só se devolve dinheiro de pagamento aprovado) quando a cobrança é
// a GRAVADA, o valor ORIGINAL bate o total e o pedido ainda espera.
// =============================================================================
const ORDER_DA_PARCIAL = "ORDTST01KZZ4D94WC79335AP1PARCIAL";

function orderParcialDoPainel(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: ORDER_DA_PARCIAL,
    external_reference: UUID_PEDIDO_1,
    type: "online",
    currency: "BRL",
    status: "processed",
    status_detail: "partially_refunded",
    total_amount: "100.00",
    transactions: {
      payments: [{
        id: "PAY01PARCIAL",
        amount: "100.00",
        paid_amount: "100.00",
        refunded_amount: "20.00",
        status: "processed",
        payment_method: { id: "pix", type: "bank_transfer" },
      }],
      refunds: [{ id: "REF-PAINEL-20", amount: "20.00", status: "processed" }],
    },
    ...extra,
  };
}

function pedidoDaParcial(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: UUID_PEDIDO_1,
    gateway_payment_id: ORDER_DA_PARCIAL,
    total: 100,
    total_amount: null,
    valor_estornado: 0,
    payment_status: "aguardando",
    paid_at: null,
    status: "pending",
    ...extra,
  };
}

async function reconciliarParcial(args: {
  order: Record<string, unknown>;
  pedido: Record<string, unknown>;
  rpcConfirmarResultado?: string;
  rpcConfirmarError?: unknown;
  estornoExternoDoMp?: (a: Record<string, unknown>) => { data: unknown; error: unknown };
  registro?: Record<string, unknown>;
}) {
  const registro = (args.registro ?? {
    chamadasConfirmar: [],
    chamouCandidatos: false,
    chamadasExternoDoMp: [],
    chamadasAviso: [],
  }) as any;
  const efeitos = { pushes: [] as unknown[], comprovantes: [] as unknown[], avisosAtrasados: [] as unknown[], alertas: [] as unknown[] };
  const supabase = clienteFalso({
    candidatos: [{ order_id: UUID_PEDIDO_1, gateway_payment_id: ORDER_DA_PARCIAL }],
    registro,
    rpcConfirmarResultado: args.rpcConfirmarResultado ?? "pago",
    rpcConfirmarError: args.rpcConfirmarError,
    resolverPedidoFresco: () => args.pedido,
    estornoExternoDoMp: args.estornoExternoDoMp,
  });
  const reais = { log: console.log, warn: console.warn, error: console.error };
  const warns: unknown[][] = [];
  console.log = () => {};
  console.warn = (...a: unknown[]) => void warns.push(a);
  console.error = () => {};
  try {
    const resposta = await handler(requisicaoComSegredo(SEGREDO), {
      supabase,
      fetchImpl: fetchConsulta(200, args.order),
      enviarPush: async (a: unknown) => void efeitos.pushes.push(a),
      enviarComprovante: async (a: unknown) => void efeitos.comprovantes.push(a),
      enviarAvisoAtrasado: async (a: unknown) => void efeitos.avisosAtrasados.push(a),
      enviarPushContado: async ({ aviso }: any) => {
        efeitos.alertas.push(aviso);
        return 1;
      },
    });
    return { resposta, corpo: await resposta.json(), registro, efeitos, warns };
  } finally {
    console.log = reais.log;
    console.warn = reais.warn;
    console.error = reais.error;
  }
}

Deno.test("P1 cron - PIX aguardando, parcial de 20 no painel, valor original = total -> registra a devolução ANTES e confirma 'pago' com o id da vaga", async () => {
  const ordem: string[] = [];
  const r = await reconciliarParcial({
    order: orderParcialDoPainel(),
    pedido: pedidoDaParcial(),
    estornoExternoDoMp: () => {
      ordem.push("ledger");
      return { data: { resultado: "inserido", aviso: null }, error: null };
    },
  });
  ordem.push(...r.registro.chamadasConfirmar.map(() => "confirmar"));

  assertEquals(r.resposta.status, 200);
  assertEquals(r.corpo.confirmados, 1);
  assertEquals(r.corpo.ignorados, 0);
  assertEquals(r.corpo.falhas, 0);
  assertEquals(ordem, ["ledger", "confirmar"]);
  assertEquals(r.registro.chamadasExternoDoMp.length, 1);
  assertEquals(r.registro.chamadasExternoDoMp[0].args, {
    p_order_id: UUID_PEDIDO_1,
    p_mp_refund_id: "REF-PAINEL-20",
    p_valor: 20,
    p_mp_status: "processed",
    p_mp_status_detail: "partially_refunded",
  });
  assertEquals(r.registro.chamadasConfirmar[0].args, {
    p_order_id: UUID_PEDIDO_1,
    p_payment_id: ORDER_DA_PARCIAL,
    p_status: "pago",
  });
  assertEquals(r.efeitos.comprovantes.length, 1, "o cliente recebe o comprovante da venda que estava para ser cancelada");
});

Deno.test("P1 cron - pedido já EXPIRADO (cancelado) -> confirma 'pago'; a RPC devolve pago_apos_expirar e o aviso honesto de atraso sai", async () => {
  const r = await reconciliarParcial({
    order: orderParcialDoPainel(),
    pedido: pedidoDaParcial({ payment_status: "expirado", status: "cancelled" }),
    rpcConfirmarResultado: "pago_apos_expirar",
  });

  assertEquals(r.corpo.confirmados, 1);
  assertEquals(r.registro.chamadasConfirmar[0].args.p_status, "pago");
  assertEquals(r.efeitos.avisosAtrasados.length, 1);
  assertEquals(r.efeitos.comprovantes.length, 0, "atrasado não recebe o texto do comprovante padrão");
});

Deno.test("P1 cron - valor ORIGINAL diferente do total do pedido -> NÃO confirma e NÃO registra nada (mantém ignorados:1)", async () => {
  const r = await reconciliarParcial({ order: orderParcialDoPainel(), pedido: pedidoDaParcial({ total: 150 }) });

  assertEquals(r.corpo.confirmados, 0);
  assertEquals(r.corpo.ignorados, 1);
  assertEquals(r.registro.chamadasConfirmar.length, 0);
  assertEquals(r.registro.chamadasExternoDoMp.length, 0);
});

Deno.test("P1 cron - pedido que já foi pago no meio do caminho (releitura fresca diz 'pago') -> nada a fazer", async () => {
  const r = await reconciliarParcial({
    order: orderParcialDoPainel(),
    pedido: pedidoDaParcial({ payment_status: "pago", paid_at: "2026-10-21T10:00:00Z" }),
  });

  assertEquals(r.corpo.ignorados, 1);
  assertEquals(r.registro.chamadasConfirmar.length, 0);
  assertEquals(r.registro.chamadasExternoDoMp.length, 0);
});

Deno.test("P1 cron - a vaga do pedido mudou para OUTRA cobrança (a parcial é da órfã) -> NÃO confirma", async () => {
  const r = await reconciliarParcial({
    order: orderParcialDoPainel(),
    pedido: pedidoDaParcial({ gateway_payment_id: "ORDTST01KZZ4D94WC79335AOUTRA000" }),
  });

  assertEquals(r.corpo.ignorados, 1);
  assertEquals(r.registro.chamadasConfirmar.length, 0);
  assertEquals(r.registro.chamadasExternoDoMp.length, 0);
});

Deno.test("P1 cron - detalhe parcial SEM devolução concluída (lista vazia, sem valor devolvido; ou 'processing') -> NÃO confirma", async () => {
  const vazia = orderParcialDoPainel();
  (vazia.transactions as any).refunds = [];
  delete (vazia.transactions as any).payments[0].refunded_amount;
  const emAndamento = orderParcialDoPainel();
  (emAndamento.transactions as any).refunds = [{ id: "REF-1", amount: "20.00", status: "processing" }];
  delete (emAndamento.transactions as any).payments[0].refunded_amount;
  for (const order of [vazia, emAndamento]) {
    const r = await reconciliarParcial({ order, pedido: pedidoDaParcial() });
    assertEquals(r.corpo.ignorados, 1);
    assertEquals(r.registro.chamadasConfirmar.length, 0);
  }
});

Deno.test("P1 cron - lista de devoluções MENOR que o refunded_amount -> NÃO confirma, NÃO registra e AVISA o lojista (motivo no log)", async () => {
  const order = orderParcialDoPainel();
  (order.transactions as any).payments[0].refunded_amount = "50.00"; // a lista só traz 20
  const r = await reconciliarParcial({ order, pedido: pedidoDaParcial() });
  assertEquals(
    r.warns.some((w) => w.includes("devolucao_nao_comprovada_por_inteiro")),
    true,
    "o motivo da recusa vai ao log",
  );
  assertEquals(r.corpo.confirmados, 0);
  assertEquals(r.corpo.ignorados, 1);
  assertEquals(r.registro.chamadasConfirmar.length, 0);
  assertEquals(r.registro.chamadasExternoDoMp.length, 0);
  assertEquals(r.efeitos.alertas.length, 1);
  assertEquals((r.efeitos.alertas[0] as any).title, "Devolução do Mercado Pago para conferir");
});

Deno.test("P1 cron - lista VAZIA com refunded_amount > 0 -> NÃO confirma e não avisa (só o log com o motivo); decisão igual à de antes", async () => {
  const order = orderParcialDoPainel();
  (order.transactions as any).refunds = [];
  const r = await reconciliarParcial({ order, pedido: pedidoDaParcial() });
  assertEquals(r.warns.some((w) => w.includes("sem_devolucao_concluida")), true);
  assertEquals(r.corpo.confirmados, 0);
  assertEquals(r.corpo.ignorados, 1);
  assertEquals(r.registro.chamadasConfirmar.length, 0);
  assertEquals(r.efeitos.alertas.length, 0);
});

Deno.test("P1 cron - o ledger FALHA -> falhas:1, NADA é confirmado (o candidato volta no próximo ciclo)", async () => {
  const r = await reconciliarParcial({
    order: orderParcialDoPainel(),
    pedido: pedidoDaParcial(),
    estornoExternoDoMp: () => ({ data: null, error: { message: "statement timeout" } }),
  });

  assertEquals(r.corpo.falhas, 1);
  assertEquals(r.corpo.confirmados, 0);
  assertEquals(r.registro.chamadasConfirmar.length, 0);
});

Deno.test("P1 cron - a RPC de pagamento falha depois do ledger: falhas:1; o ciclo seguinte repete, a devolução vem como ja_registrado e a confirmação roda", async () => {
  const registro = { chamadasConfirmar: [] as any[], chamouCandidatos: false, chamadasExternoDoMp: [] as any[], chamadasAviso: [] as any[] };
  const primeira = await reconciliarParcial({
    order: orderParcialDoPainel(),
    pedido: pedidoDaParcial(),
    rpcConfirmarError: { message: "deadlock detected" },
    registro,
  });
  assertEquals(primeira.corpo.falhas, 1);
  assertEquals(registro.chamadasExternoDoMp.length, 1);

  const segunda = await reconciliarParcial({ order: orderParcialDoPainel(), pedido: pedidoDaParcial(), registro });
  assertEquals(segunda.corpo.confirmados, 1);
  assertEquals(registro.chamadasExternoDoMp.length, 2, "o ledger é chamado de novo — idempotente, devolve ja_registrado");
  assertEquals(registro.chamadasConfirmar.length, 2);
});

Deno.test("P1 cron - devolução que não cabe no saldo do ledger NÃO impede confirmar o pagamento, mas avisa o lojista", async () => {
  const r = await reconciliarParcial({
    order: orderParcialDoPainel(),
    pedido: pedidoDaParcial(),
    estornoExternoDoMp: () => ({ data: { resultado: "nao_cabe", aviso: "saldo" }, error: null }),
  });

  assertEquals(r.corpo.confirmados, 1);
  assertEquals(r.efeitos.alertas.length, 1);
  assertEquals((r.efeitos.alertas[0] as any).title, "Devolução do Mercado Pago para conferir");
});

// =============================================================================
// P2 (21/10/2026, revisão adversarial do lote 1.5.47) — DEVOLUÇÃO INTEGRAL
// PELA RECONCILIAÇÃO. O mapa traduz `refunded:refunded` para 'estornado' e o
// cron mandava isso direto a `confirmar_pagamento`: no pedido aguardando+
// pending esse ramo devolve o estoque e cancela, mas NÃO grava `paid_at`, NÃO
// soma o valor devolvido e NÃO cria a linha de devolução — o dinheiro entrou
// e saiu sem rastro (totais brutos e histórico errados; regra A1 do
// pagamentos-rpc-viva). Pedido nunca pago não tem linha de devolução do app
// (solicitar_estorno exige pagamento): quem registra é a RPC do ledger, que
// trava o pedido e conclui o estorno (`concluir_estorno`: integral grava
// paid_at, soma o valor, devolve o estoque e cancela, numa transação).
// =============================================================================
function orderTotalmenteDevolvida(extra: Record<string, unknown> = {}): Record<string, unknown> {
  const order = orderParcialDoPainel({ status: "refunded", status_detail: "refunded", ...extra });
  (order.transactions as any).payments[0].refunded_amount = "100.00";
  (order.transactions as any).refunds = [{ id: "REF-PAINEL-100", amount: "100.00", status: "processed" }];
  return order;
}

Deno.test("P2 cron - devolução INTEGRAL de pedido nunca pago -> registra a devolução no ledger e NÃO chama confirmar_pagamento", async () => {
  const r = await reconciliarParcial({
    order: orderTotalmenteDevolvida(),
    pedido: pedidoDaParcial(),
    rpcConfirmarResultado: "estornado",
  });

  assertEquals(r.resposta.status, 200);
  assertEquals(r.registro.chamadasConfirmar.length, 0, "confirmar_pagamento('estornado') cancelaria sem registrar o dinheiro");
  assertEquals(r.registro.chamadasExternoDoMp.length, 1);
  assertEquals(r.registro.chamadasExternoDoMp[0].args, {
    p_order_id: UUID_PEDIDO_1,
    p_mp_refund_id: "REF-PAINEL-100",
    p_valor: 100,
    p_mp_status: "refunded",
    p_mp_status_detail: "refunded",
  });
  assertEquals(r.corpo.confirmados, 0);
  assertEquals(r.corpo.ignorados, 1);
  assertEquals(r.corpo.falhas, 0);
});

Deno.test("P2 cron - pedido já EXPIRADO (sem paid_at) e devolvido por inteiro: também vai ao ledger, não à RPC de pagamento", async () => {
  const r = await reconciliarParcial({
    order: orderTotalmenteDevolvida(),
    pedido: pedidoDaParcial({ payment_status: "expirado", status: "cancelled" }),
    rpcConfirmarResultado: "estornado",
  });

  assertEquals(r.registro.chamadasConfirmar.length, 0);
  assertEquals(r.registro.chamadasExternoDoMp.length, 1);
});

Deno.test("P2 cron - devolvido em duas vezes (60 + 40): cada devolução concluída é registrada, nenhuma confirmação de pagamento", async () => {
  const order = orderTotalmenteDevolvida();
  (order.transactions as any).refunds = [
    { id: "REF-60", amount: "60.00", status: "processed" },
    { id: "REF-40", amount: "40.00", status: "processed" },
  ];
  const r = await reconciliarParcial({ order, pedido: pedidoDaParcial(), rpcConfirmarResultado: "estornado" });

  assertEquals(r.registro.chamadasExternoDoMp.map((c: any) => [c.args.p_mp_refund_id, c.args.p_valor]), [
    ["REF-60", 60],
    ["REF-40", 40],
  ]);
  assertEquals(r.registro.chamadasConfirmar.length, 0);
});

Deno.test("P2 cron - 'refunded' mas NENHUMA devolução concluída ainda (lista vazia ou 'processing') -> espera: não registra nem cancela (regra A1 do webhook)", async () => {
  const vazia = orderTotalmenteDevolvida();
  (vazia.transactions as any).refunds = [];
  const emAndamento = orderTotalmenteDevolvida();
  (emAndamento.transactions as any).refunds = [{ id: "REF-100", amount: "100.00", status: "processing" }];
  for (const order of [vazia, emAndamento]) {
    const r = await reconciliarParcial({ order, pedido: pedidoDaParcial(), rpcConfirmarResultado: "estornado" });
    assertEquals(r.corpo.ignorados, 1);
    assertEquals(r.corpo.falhas, 0);
    assertEquals(r.registro.chamadasConfirmar.length, 0, "reserva nunca confirmada não cai no confirmar_pagamento legado");
    assertEquals(r.registro.chamadasExternoDoMp.length, 0);
  }
});

Deno.test("P2 cron - o ledger FALHA -> falhas:1 e nada é cancelado (o candidato volta no próximo ciclo)", async () => {
  const r = await reconciliarParcial({
    order: orderTotalmenteDevolvida(),
    pedido: pedidoDaParcial(),
    rpcConfirmarResultado: "estornado",
    estornoExternoDoMp: () => ({ data: null, error: { message: "statement timeout" } }),
  });

  assertEquals(r.corpo.falhas, 1);
  assertEquals(r.registro.chamadasConfirmar.length, 0);
});

Deno.test("P2 cron - rodar o MESMO ciclo duas vezes é seguro: a 2ª devolve ja_registrado e nada vai à RPC de pagamento", async () => {
  const registro = { chamadasConfirmar: [] as any[], chamouCandidatos: false, chamadasExternoDoMp: [] as any[], chamadasAviso: [] as any[] };
  for (const vez of [1, 2]) {
    const r = await reconciliarParcial({
      order: orderTotalmenteDevolvida(),
      pedido: pedidoDaParcial(),
      rpcConfirmarResultado: "estornado",
      registro,
    });
    assertEquals(r.corpo.falhas, 0, `vez ${vez}`);
  }
  assertEquals(registro.chamadasExternoDoMp.length, 2);
  assertEquals(registro.chamadasConfirmar.length, 0);
});

Deno.test("P2 cron - devolução que não cabe no saldo: não é gravada, o lojista é avisado e confirmar_pagamento continua de fora", async () => {
  const r = await reconciliarParcial({
    order: orderTotalmenteDevolvida(),
    pedido: pedidoDaParcial(),
    rpcConfirmarResultado: "estornado",
    estornoExternoDoMp: () => ({ data: { resultado: "nao_cabe", aviso: "saldo" }, error: null }),
  });

  assertEquals(r.registro.chamadasConfirmar.length, 0);
  assertEquals(r.efeitos.alertas.length, 1);
  assertEquals(r.corpo.ignorados, 1);
});

Deno.test("P2 cron - pedido que JÁ tem paid_at (pago no meio do caminho) mantém o caminho de antes: confirmar_pagamento('estornado')", async () => {
  const r = await reconciliarParcial({
    order: orderTotalmenteDevolvida(),
    pedido: pedidoDaParcial({ payment_status: "pago", paid_at: "2026-10-21T10:00:00Z", status: "processing" }),
    rpcConfirmarResultado: "estornado",
  });

  assertEquals(r.registro.chamadasConfirmar.length, 1);
  assertEquals(r.registro.chamadasConfirmar[0].args.p_status, "estornado");
  assertEquals(r.registro.chamadasExternoDoMp.length, 0);
});

Deno.test("P2 cron - candidato LEGADO (id clássico) devolvido: comportamento de antes, confirmar_pagamento('estornado')", async () => {
  const registro = { chamadasConfirmar: [] as any[], chamouCandidatos: false, chamadasExternoDoMp: [] as any[] };
  const supabase = clienteFalso({
    candidatos: [{ order_id: UUID_PEDIDO_1, gateway_payment_id: "123456789" }],
    registro,
    rpcConfirmarResultado: "estornado",
    resolverPedidoFresco: () => pedidoDaParcial({ gateway_payment_id: "123456789" }),
  });
  const fetchImpl = async (url: string) => {
    if (url.includes("/v1/payments/123456789")) {
      return new Response(JSON.stringify({ id: 123456789, status: "refunded", transaction_amount: 100 }), { status: 200 });
    }
    throw new Error(`fetch inesperado nos testes: ${url}`);
  };
  const resposta = await handler(requisicaoComSegredo(SEGREDO), { supabase, fetchImpl });
  await resposta.json();

  assertEquals(registro.chamadasConfirmar.length, 1);
  assertEquals(registro.chamadasConfirmar[0].args.p_status, "estornado");
  assertEquals(registro.chamadasExternoDoMp.length, 0);
});
