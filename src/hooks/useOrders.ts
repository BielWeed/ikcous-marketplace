import { clearAnalyticsCache } from "@/hooks/useAnalytics";
import { useAuth } from "@/hooks/useAuth";
import { useLeaderElection } from "@/hooks/useLeaderElection";
import { mapOrderFromDB } from "@/lib/mappers";
import { supabase } from "@/lib/supabase";
import type { DashboardSummary, Order, OrderStatus } from "@/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

interface SharedSubscription {
  channel: any;
  refCount: number;
  callbacks: Set<(payload: any) => void>;
  cleanupTimeout?: ReturnType<typeof setTimeout>;
}
const globalOrderSubscriptions = new Map<string, SharedSubscription>();

const validateStatusUpdate = (
  order: Order | undefined,
  isAdmin: boolean,
  status: OrderStatus,
  silent: boolean,
) => {
  if (!isAdmin) {
    if (status !== "cancelled") {
      const errorMsg = "Usuários só podem cancelar pedidos";
      if (!silent) toast.error(errorMsg);
      throw new Error(errorMsg);
    }

    // Regra do Gabriel (24/08/2026): o divisor e' se o produto SAIU, nao se
    // foi pago. Nao enviado (pending/processing) e enviado (shipping) podem
    // ser cancelados; entregue nao — produto entregue e' devolucao, outro
    // assunto. Espelha a mesma trava do servidor
    // (update_order_status_atomic, supabase/migrations/20260970000000_
    // cancelamento_respeita_o_envio.sql).
    if (
      order &&
      !["pending", "processing", "shipping"].includes(order.status)
    ) {
      const errorMsg = "Este pedido não pode mais ser cancelado";
      if (!silent) toast.error(errorMsg);
      throw new Error(errorMsg);
    }
  }
};

async function syncOfflineOrderUpdates(): Promise<boolean> {
  if (typeof window === "undefined" || !navigator.onLine) return false;
  const queueStr = localStorage.getItem("orders_offline_updates_queue");
  if (!queueStr) return false;

  try {
    const queue = JSON.parse(queueStr);
    if (!Array.isArray(queue) || queue.length === 0) return false;

    const remainingQueue: any[] = [];
    const toastId = toast.loading(
      `Sincronizando ${queue.length} atualizações de status de pedidos offline...`,
    );

    for (const item of queue) {
      const { orderId, status, notes, silent } = item;
      try {
        const { error } = await (supabase.rpc as any)(
          "update_order_status_atomic",
          {
            p_order_id: orderId,
            p_new_status: status,
            p_notes: notes || null,
            p_silent: silent || false,
          },
        );

        if (error) throw error;
      } catch (err) {
        console.error(
          "[Offline Sync] Failed to sync order status %s:",
          orderId,
          err,
        );
        remainingQueue.push(item);
      }
    }

    const syncedAny = remainingQueue.length < queue.length;

    if (remainingQueue.length > 0) {
      localStorage.setItem(
        "orders_offline_updates_queue",
        JSON.stringify(remainingQueue),
      );
      toast.error(
        `Falha ao sincronizar ${remainingQueue.length} alterações de pedidos. Tentando novamente mais tarde.`,
        { id: toastId },
      );
    } else {
      localStorage.removeItem("orders_offline_updates_queue");
      clearAnalyticsCache();
      toast.success(
        "Todas as atualizações de status de pedidos foram sincronizadas!",
        { id: toastId },
      );
    }

    return syncedAny;
  } catch (e) {
    console.error("[Offline Sync] Error parsing offline orders queue:", e);
    return false;
  }
}

// Memory cache for Admin Orders (SWR Pattern)
let cachedAdminOrders: Order[] | null = null;
let cachedAdminTotalOrders = 0;

/**
 * CHECKOUT-080 (#213): o conjunto fechado que `criar-pagamento` (edge
 * function) emite no campo `statusPagamento` — o MESMO `payment_status` que
 * a coluna `marketplace_orders.payment_status` já usa (CHECK constraint
 * marketplace_orders_payment_status_check). `pago_apos_expirar` fica de
 * fora de propósito: só a RPC `confirmar_pagamento` produz esse valor,
 * olhando o estado ATUAL do pedido no banco — `criar-pagamento` não tem
 * como emitir isso na resposta de uma criação/reconsulta.
 *
 * ESCOLHA DE TIPAGEM (relatório da CHECKOUT-080): o campo do retorno de
 * `criarPagamento`, abaixo, é `statusPagamento: string`, NÃO
 * `StatusPagamentoConhecido` — mesmo esta união existindo. O ramo de
 * RECONSULTA da Orders API (`criar-pagamento/index.ts`, par desconhecido)
 * devolve o par CRU "status:status_detail" quando o MP manda uma
 * combinação que `mapearStatusOrder` não reconhece; o ramo clássico
 * devolve o `status` cru do MP quando `mapearStatus` também não reconhece.
 * Tipar o campo como a união fechada seria dizer ao TypeScript algo que o
 * runtime não garante — e um `as StatusPagamentoConhecido` no meio do
 * caminho só esconderia a mentira, não a resolveria. `string` deixa
 * PagamentoOnline.tsx comparar `statusPagamento` contra os literais deste
 * conjunto (com "valor desconhecido = terminal" como rede de segurança),
 * sem o TypeScript prometer algo que a função pode não entregar.
 *
 * Achado da revisão da CHECKOUT-080: esta união teve, por uma rodada, um
 * type guard de pertencimento (`ehStatusPagamentoConhecido`) que NINGUÉM
 * chamava — e cuja semântica (`"recusado"` é "conhecido") era o OPOSTO da
 * checagem que `PagamentoOnline.tsx` faz de verdade (lá "conhecido" quer
 * dizer "pode seguir", e `"recusado"` é justamente um dos terminais). Foi
 * apagado por isso: superfície morta que mente sobre o próprio nome é pior
 * que não existir.
 */
export type StatusPagamentoConhecido =
  | "aguardando"
  | "pago"
  | "recusado"
  | "expirado"
  | "estornado";

/** Argumentos de uma chamada de `loadOrders`, guardados para poder repeti-la. */
export type ConsultaAdmin = [
  page?: number,
  pageSize?: number,
  statusFilter?: string,
  searchQuery?: string,
  startDate?: string,
  endDate?: string,
  silent?: boolean,
];

/**
 * Escolhe QUAL consulta o realtime deve repetir quando a conexão volta
 * (PEDIDO-030, #83).
 *
 * O `useOrders` serve as duas metades do app pelo mesmo hook: o cliente, com
 * `fetchUserOrders` (filtra por `user_id`), e o painel, com `loadOrders`
 * (paginada, sem filtro de dono). Os três caminhos de reconexão —
 * `handleReconnect`, `handleVisibilityChange` e `handleOnline` — chamavam sempre
 * a consulta do CLIENTE.
 *
 * Para a lojista isso devolvia zero, porque ela não compra na própria loja: o
 * painel passava a dizer "Ainda não tem nenhum pedido" com a paginação ainda
 * indicando várias páginas, e com pedido real parado esperando ser separado.
 * Cair e voltar a rede é rotina em celular; o defeito aparecia sozinho.
 *
 * Duas escolhas dentro desta função, e as duas são sobre não trocar um estrago
 * por outro:
 *
 * - **`silent` forçado para true** no modo admin: a recarga acontece sem ela
 *   pedir, no meio da operação. Acender o esqueleto de carregamento por cima da
 *   lista assusta igual ao defeito original.
 * - **sem consulta anterior, não dispara nada**: não há página nem filtro a
 *   preservar, e a tela do painel já carrega ao montar. Chamar com os valores
 *   padrão jogaria a lojista de volta para a página 1 sem filtro.
 */
export function escolherRecargaDeReconexao(deps: {
  isAdmin: boolean;
  fetchUserOrders: () => Promise<unknown>;
  loadOrders: (...args: ConsultaAdmin) => Promise<unknown>;
  ultimaConsultaAdmin: ConsultaAdmin | null;
}): () => Promise<unknown> {
  const { isAdmin, fetchUserOrders, loadOrders, ultimaConsultaAdmin } = deps;

  if (!isAdmin) return () => fetchUserOrders();

  if (!ultimaConsultaAdmin) return () => Promise.resolve();

  const [page, pageSize, statusFilter, searchQuery, startDate, endDate] =
    ultimaConsultaAdmin;

  return () =>
    loadOrders(
      page,
      pageSize,
      statusFilter,
      searchQuery,
      startDate,
      endDate,
      true,
    );
}

/**
 * Traduz a recusa crua da CRIAÇÃO do pedido (create_marketplace_order_v23/
 * v24, supabase/migrations/20260821000200_cupom_sem_limite_e_ilimitado.sql)
 * numa mensagem que quem está comprando entende. Exportada porque
 * CheckoutView.tsx recebe o MESMO erro relançado por `createOrder` (abaixo)
 * e precisa da MESMA tradução — duplicar aqui e lá divergiria assim que a
 * RPC mudasse.
 *
 * Toda saída, fora do ramo P0001, é string ESTÁTICA: nome de coluna,
 * restrição ou stack trace não pode chegar à tela. O erro completo segue
 * vivo no console.error de quem chamou.
 *
 * O DEFAULT FALHA FECHADO (achado B da revisão de 22/08/2026): só o que
 * está COMPROVADAMENTE revertido pode dizer "tente de novo" sem ressalva.
 * Tudo o mais herda a ressalva de duplicidade, inclusive causa nunca vista
 * antes.
 *
 * A REGRA POR FORMATO, não por lista (achado da revisão de 22/08/2026,
 * A2-fix2 — substitui a lista fixa de 5 códigos que existia aqui antes):
 *
 *   `code` no formato de SQLSTATE — 5 caracteres, cada um dígito ou letra
 *   maiúscula ([0-9A-Z]{5}) — é o formato de TODO código de erro que o
 *   próprio Postgres emite (RAISE com ERRCODE explícito ou implícito,
 *   deadlock, violação de restrição, timeout, esgotamento de conexão etc.),
 *   catalogado ou não. Medido nas RPCs vivas create_marketplace_order_v23/
 *   v24 com sonda somente-leitura (22/08/2026): 0 bloco EXCEPTION WHEN, 10
 *   RAISE EXCEPTION POR FUNÇÃO (20 somando as duas), 0 USING ERRCODE — ou
 *   seja, cada chamada de RPC do PostgREST é UMA transação sem nada que
 *   engula erro no meio do caminho.
 *   Logo, se um erro com SQLSTATE chega ao cliente, é porque o statement
 *   abortou dentro do Postgres, e aborto de statement reverte a transação
 *   inteira. O pedido NÃO foi criado — sem precisar manter uma lista fixa
 *   que fica sub-inclusiva a cada causa nova (deadlock 40P01, lock timeout
 *   55P03, violação de restrição 23505/23514/23502, conexões esgotadas
 *   53300, e qualquer SQLSTATE ainda não visto).
 *
 *   Duas exceções tratadas à parte, porque NÃO são SQLSTATE:
 *   - "P0001" (RAISE EXCEPTION dentro da própria função — endereço
 *     inválido, quantidade inválida, produto indisponível, estoque
 *     insuficiente, entrega local fora da faixa, cotação de frete expirada,
 *     cupom inválido/expirado, valores do pedido mudaram): TEM formato
 *     SQLSTATE, mas ganha tratamento especial porque a própria função
 *     escreve o texto já em português — usa-se o texto real em vez da
 *     frase genérica.
 *   - "PGRST202" (PostgREST: função não existe no cache de schema),
 *     "PGRST301" (JWT inválido ou expirado) e "PGRST302" (papel anônimo
 *     desabilitado, sem sessão): nenhum tem formato SQLSTATE (8 caracteres,
 *     prefixo do PostgREST) — são código do PostgREST, e os três acontecem
 *     na fase de autenticação, ANTES de qualquer requisição chegar ao
 *     Postgres (confirmado na doc oficial:
 *     docs.postgrest.org/en/v12/references/errors.html) — a chamada nunca
 *     chega a invocar a função.
 *
 *   QUALQUER OUTRA COISA — code ausente ou vazio (falha de rede: "Failed to
 *   fetch", formato real de postgrest-js quando o fetch lança; ou resposta
 *   que não é JSON — 502/504/524 de gateway, que postgrest-js devolve como
 *   `{ message: <corpo> }` SEM `code` nenhum), ou code que não bate o
 *   formato (minúsculo, tamanho diferente de 5 — não pode ter vindo do
 *   Postgres) — NÃO permite concluir que o pedido foi criado ou não.
 *   Mandar "tente de novo" sem ressalva aqui é o que duplica pedido —
 *   estoque debitado duas vezes, cupom de uso único consumido duas vezes.
 */
const FORMATO_SQLSTATE = /^[0-9A-Z]{5}$/;
// Códigos do PostgREST (nunca SQLSTATE) sobre os quais se pode afirmar que a
// chamada nem chegou a invocar a função no Postgres — ver docstring acima.
const CODIGOS_POSTGREST_REVERTIDO_COMPROVADO = new Set([
  "PGRST202",
  "PGRST301",
  "PGRST302",
]);

export const mensagemAmigavelErroPedido = (error: unknown): string => {
  const detalhes = (error ?? {}) as { code?: unknown; message?: unknown };
  const codigo = typeof detalhes.code === "string" ? detalhes.code : "";
  const textoOriginal =
    typeof detalhes.message === "string" ? detalhes.message : "";

  if (codigo === "P0001" && textoOriginal) {
    return textoOriginal;
  }

  if (
    CODIGOS_POSTGREST_REVERTIDO_COMPROVADO.has(codigo) ||
    FORMATO_SQLSTATE.test(codigo)
  ) {
    return "Não foi possível criar seu pedido agora. Tente novamente em instantes.";
  }

  // DEFAULT FALHA FECHADO: code ausente, vazio, ou fora do formato de
  // SQLSTATE não permite concluir que o pedido NÃO foi criado. Isso já
  // cobre falha de rede sozinho — postgrest-js nunca preenche `code` para
  // erro de fetch ou gateway (ver node_modules/@supabase/postgrest-js/
  // dist/index.cjs:359 e :432) — então não há ramo separado para detectar
  // "failed to fetch" por texto: ele cairia aqui de qualquer forma, e um
  // ramo próprio só duplicaria a mesma frase (achado A da revisão de
  // 22/08/2026 — o ramo antigo devolvia byte a byte o mesmo texto deste
  // default).
  return "Não conseguimos confirmar se o pedido foi enviado. Verifique se ele já apareceu antes de tentar de novo.";
};

/**
 * Traduz a recusa crua da CONSULTA do pedido por código (get_orders_by_
 * otp_v1) para quem está acompanhando sem conta.
 *
 * 🔴 ESTADO DE BANCO NÃO MORA EM COMENTÁRIO DE CÓDIGO. Várias migrations
 * definem esta função ao longo do tempo (a mais recente delas foi escrita
 * para acrescentar `payment_status` ao JSON — ver `src/lib/mappers.ts:246`
 * — e o nome do arquivo descreve o que ela resolve: rastreio por código
 * volta a mostrar o pagamento). QUAL migration está VIVA no banco muda a
 * qualquer hora — inclusive enquanto este arquivo continua aberto na sua
 * tela, se outra frente aplicar uma migration nesse meio-tempo. Antes de
 * copiar QUALQUER corpo desta função para escrever uma migration nova,
 * confirme a definição viva de novo — não confie no que uma versão antiga
 * deste comentário disse:
 *
 *   1. Sonda somente-leitura (é o corpo que ela devolver que manda, nunca
 *      o que está escrito aqui):
 *      `BEGIN READ ONLY; SELECT pg_get_functiondef(oid) FROM pg_proc
 *      WHERE proname = 'get_orders_by_otp_v1'; ROLLBACK;`
 *   2. Confirme que nenhuma migration mais nova sobre esta função está
 *      pendente: `node scripts/db-reconcilia-ledger.cjs
 *      --listar-pendentes`.
 *
 * Copiar o corpo errado faz um `CREATE OR REPLACE` apagar `payment_status`
 * do JSON de novo — a tela de rastreio por código volta a mostrar todo
 * pedido como se não houvesse cobrança nenhuma, inclusive um já pago.
 *
 * Essa função NUNCA dá RAISE: toda recusa de código (errado, expirado,
 * bloqueado por excesso de tentativas) já volta em português dentro de
 * `data.ok === false`, tratada ANTES de qualquer coisa chegar aqui (ver
 * fetchOrdersByOtp abaixo). Ou seja: tudo que cai nesta função é falha em
 * CHEGAR à verificação — nunca o código em si —, e usar "Código inválido ou
 * expirado" para essas causas mentiria e mandaria a pessoa pedir um código
 * novo à toa.
 */
export const mensagemAmigavelErroOtp = (error: unknown): string => {
  const detalhes = (error ?? {}) as { code?: unknown; message?: unknown };
  const codigo = typeof detalhes.code === "string" ? detalhes.code : "";
  const textoOriginal =
    typeof detalhes.message === "string" ? detalhes.message : "";
  const pista = `${codigo} ${textoOriginal}`.toLowerCase();

  if (
    pista.includes("failed to fetch") ||
    pista.includes("networkerror") ||
    pista.includes("network request failed") ||
    pista.includes("load failed")
  ) {
    return "Sem conexão com o servidor. Verifique sua internet e tente novamente.";
  }

  return "Não conseguimos verificar seu código agora. Tente novamente em instantes.";
};

/**
 * Traduz a recusa crua de `update_order_status_atomic` (RPC chamada por
 * `updateOrderStatus`, abaixo — supabase/migrations/20260901000000_
 * devolver_uso_de_cupom_ao_desfazer_pedido.sql tem a definição viva) para o
 * que quem mexe no pedido lê na tela.
 *
 * Confirmado na fonte, não presumido: a função inteira não tem NENHUM
 * `RAISE ... USING ERRCODE` — todo `RAISE EXCEPTION` dela (sessão ausente,
 * pedido não encontrado, permissão negada, transição de status não
 * permitida) sai com o SQLSTATE padrão do plpgsql (`P0001`, raise_exception)
 * e texto JÁ em português, iguais aos de `mensagemAmigavelErroPedido` acima.
 * Por isso o mesmo tratamento: `code === "P0001"` é a RPC falando por conta
 * própria — passa direto.
 *
 * Sem a ressalva de duplicidade de `mensagemAmigavelErroPedido`: repetir uma
 * atualização de status não duplica efeito nenhum. A própria função é
 * idempotente na única operação com efeito colateral (a restituição de
 * estoque do cancelamento só roda `IF v_old_status IS DISTINCT FROM
 * 'cancelled'` — reenviar o mesmo cancelamento não devolve estoque duas
 * vezes), então "tente novamente" é seguro para QUALQUER causa que não seja
 * P0001, sem precisar distinguir formato de SQLSTATE.
 */
export const mensagemAmigavelErroAtualizacaoStatus = (
  error: unknown,
): string => {
  const detalhes = (error ?? {}) as { code?: unknown; message?: unknown };
  const codigo = typeof detalhes.code === "string" ? detalhes.code : "";
  const textoOriginal =
    typeof detalhes.message === "string" ? detalhes.message : "";

  // `validateStatusUpdate` (topo deste arquivo) lança ANTES de qualquer
  // chamada de rede, com uma das duas frases fixas abaixo — já em
  // português, escritas pelo próprio app. Ela já dispara o SEU PRÓPRIO
  // `toast.error` com o mesmo texto (quando `!silent`); sem este
  // passthrough, este catch trocaria essa segunda leitura por uma frase
  // genérica diferente, o que pareceria dois erros DIFERENTES para o mesmo
  // clique. Comparação por texto exato — e não "sem `code`" — porque uma
  // falha de rede pura (ex.: `TypeError: Failed to fetch`) também chega sem
  // `code`, e essa SIM precisa cair no genérico.
  if (
    textoOriginal === "Usuários só podem cancelar pedidos" ||
    textoOriginal === "Este pedido não pode mais ser cancelado"
  ) {
    return textoOriginal;
  }

  if (codigo === "P0001" && textoOriginal) {
    return textoOriginal;
  }

  return "Não foi possível atualizar o status do pedido agora. Tente novamente em instantes.";
};

/**
 * Funde a linha que o realtime do Supabase entrega em `payload.new` sobre o
 * pedido que já está em memória (PEDIDO-04, achado da auditoria de
 * 26/08/2026). Extraída do corpo de `handleRealtimeUpdate` só para poder ser
 * testada sem montar o WebSocket inteiro — mesma ideia de
 * `escolherRecargaDeReconexao`, acima.
 *
 * O DEFEITO QUE ISTO SUBSTITUI: `handleRealtimeUpdate` remontava o pedido com
 * uma lista fechada de campos (`status`, `trackingCode` — confirmado em
 * `git show HEAD:src/hooks/useOrders.ts` antes desta correção) escrita à mão.
 * O realtime do Postgres entrega a LINHA INTEIRA em `payload.new` — não um diff — e
 * `payment_status` (e `total`) nunca estavam na lista. Resultado: o PIX
 * confirmava, o webhook gravava `payment_status = 'pago'` no banco, e quem
 * estava com a tela "Meus Pedidos" aberta continuava vendo "Aguardando
 * pagamento" até sair e voltar — e essa mesma leitura errada era regravada no
 * cache do localStorage, então a PRÓXIMA abertura também nascia errada.
 *
 * A CORREÇÃO NÃO É ACRESCENTAR `payment_status` À LISTA — é eliminar a lista.
 * `mapOrderFromDB` (src/lib/mappers.ts) já cobre TODOS os campos da própria
 * linha de `marketplace_orders`, e é o MESMO mapeador que `handleRealtimeInsert`
 * (logo acima) já usa para o INSERT. Uma lista escrita à mão é a causa raiz;
 * trocar de lista mantém a causa viva para o próximo campo que alguém
 * esquecer.
 *
 * O QUE FALTA NA LINHA DO REALTIME, E POR QUE ISTO PRECISA DE CUIDADO: o
 * realtime entrega só a linha de `marketplace_orders`, sem as junções que
 * `fetchUserOrders`/`loadOrders`/`handleRealtimeInsert` pedem (`items` via
 * `marketplace_order_items`, `address` via `user_addresses`). Sem essas
 * junções, `mapOrderFromDB` devolveria `items: []` — apagando da tela os
 * itens de um pedido que já existia — E, para cliente LOGADO com endereço
 * salvo, o endereço de entrega inteiro em branco: `create_marketplace_order_
 * v23`/`v24` gravam `customer_data.address = null` nesse caso (`supabase/
 * migrations/20260960000000_variacao_obrigatoria_no_servidor.sql:344-350`),
 * e `typeof null === "object"` faz `mapOrderFromDB` cair nesse `null` (que é
 * falsy) e depois no `customer_data` cru, que não tem `street`/`number`/etc.
 *
 * ACHADO BLOQUEANTE DA REVISÃO DESTA CORREÇÃO (26/08/2026): a primeira
 * versão só protegia `items`, e essa mesma correção passou a zerar o
 * "Endereço de Entrega" na ficha de pedido aberta a cada atualização em
 * tempo real — o PIX confirmando, ou a própria lojista mudando o status.
 * `CamposPreservadosDaMemoria`, abaixo, é a resposta: os campos que
 * `mapOrderFromDB` deriva de uma junção que a linha do realtime nunca traz
 * saem do PEDIDO EM MEMÓRIA, nunca do resultado de `mapOrderFromDB(linhaNova)`.
 *
 * ⚠️ ISTO NÃO GENERALIZA, e é importante não acreditar que generaliza: o tipo
 * é um `Pick` de DOIS NOMES ESCRITOS À MÃO. Se alguém acrescentar uma junção
 * nova ao select (por exemplo `coupon:coupons(*)`), mapeá-la em
 * `mapOrderFromDB` e NÃO vier aqui, o código compila, os testes passam, e cada
 * atualização em tempo real apaga esse campo da tela aberta e grava o apagado
 * no cache do aparelho. Não há trava automática para o campo ESQUECIDO —
 * a checagem do TypeScript só pega campo a mais ou a menos no literal.
 * Quem acrescentar junção tem de vir aqui na mão. Isto não
 * perde nenhuma atualização legítima: nem `customer_name` nem `customer_data`
 * (as duas colunas que alimentam `customer`) são reescritas por RPC nenhuma
 * depois da criação do pedido — confirmado varrendo `supabase/` inteiro por
 * `customer_data\s*=`/`customer_name\s*=` fora de INSERT/jsonb_build_object
 * (0 ocorrências). `items` já tinha a mesma garantia, e é por isso que os dois
 * podem ser tratados igual aqui.
 */
// Os dois campos abaixo — `items` e `customer` — são os campos preservados da
// memória de que o docstring acima fala. "Derivado de JOIN" é o nome do RISCO,
// não da fonte: `customer` também carrega `customer_name` e `customer_data`,
// que são COLUNAS de `marketplace_orders`, não junção nenhuma. Preservá-las
// aqui é seguro pelo mesmo motivo que `items` é — nenhuma RPC as reescreve
// depois da criação do pedido (varredura no docstring acima: 0 ocorrências de
// `customer_data\s*=`/`customer_name\s*=` fora de INSERT/jsonb_build_object)
// —, não porque tenham vindo de um JOIN de verdade.
type CamposPreservadosDaMemoria = Pick<Order, "items" | "customer">;

export function mesclarAtualizacaoRealtime(
  pedidoAtual: Order,
  linhaNova: Parameters<typeof mapOrderFromDB>[0],
): Order {
  const mapeado = mapOrderFromDB(linhaNova);
  // Escritos por nome, não num laço percorrendo uma lista de chaves: a
  // versão anterior (`for (const campo of [...]) resultado[campo] =
  // pedidoAtual[campo]`) acessava os dois objetos por chave vinda de
  // variável, e isso é exatamente o padrão que `security/detect-object-
  // injection` existe para pegar — disparava uma vez na leitura e outra na
  // escrita. Só há dois campos hoje: se um terceiro precisar da mesma
  // proteção, adicione-o AQUI e no tipo `CamposPreservadosDaMemoria` acima —
  // o literal do objeto abaixo tem checagem de excesso/falta do TypeScript
  // contra esse tipo, então campo sobrando ou faltando vira erro de build.
  const preservados: CamposPreservadosDaMemoria = {
    items: pedidoAtual.items,
    customer: pedidoAtual.customer,
  };
  return { ...pedidoAtual, ...mapeado, ...preservados };
}

/**
 * Estado da conexão realtime do canal de pedidos (auditoria de 26/08/2026,
 * achado do selo "Operações ao Vivo"/"Moderação Ativa" no painel). O
 * `channel.subscribe` abaixo (dentro de `useOrders`, seção "Realtime
 * subscription for orders") já tratava `SUBSCRIBED`, `CHANNEL_ERROR`,
 * `TIMED_OUT` e `CLOSED` — só que NENHUM dos quatro ramos tinha `setState`:
 * o handler falava só com `console.*` e `handleReconnect()`. Sem estado
 * exportado, nenhuma tela tinha como saber se o canal estava vivo — o selo
 * não estava mal ligado, ele não tinha a que se ligar.
 *
 * QUATRO estados, de propósito — nunca um booleano. Colapsar "ainda não sei"
 * em "não conectado" foi o que produziu metade dos selos que mentem nesta
 * auditoria: um selo que mostra "desconectado" durante o primeiro segundo de
 * toda abertura é o MESMO defeito com outro sinal.
 *
 * - "conectando": o efeito de inscrição acabou de montar e NENHUMA resposta
 *   do canal chegou ainda — nem sucesso, nem erro. É o "ainda não sei", e
 *   dura só o instante inicial de toda abertura.
 * - "conectado": o último status que o canal reportou foi "SUBSCRIBED".
 * - "reconectando": o canal caiu (CHANNEL_ERROR/TIMED_OUT/CLOSED, ou uma
 *   falha ao criar o canal) e a retentativa automática já existente
 *   (`handleReconnect`, INALTERADA por esta mudança) está em curso. Visível
 *   em vez de silenciosa.
 * - "desconectado": NENHUMA inscrição está ativa para esta instância do
 *   hook — `enabled === false` ou sem usuário logado. Nunca usado para "caiu
 *   e está tentando de novo"; esse caso é sempre "reconectando", porque o
 *   hook nunca desiste sozinho — `handleReconnect` tenta para sempre.
 */
export type EstadoConexaoRealtime =
  | "conectando"
  | "conectado"
  | "reconectando"
  | "desconectado";

/**
 * Traduz o status cru que o supabase-js entrega ao callback de
 * `channel.subscribe` no `EstadoConexaoRealtime` que a UI pode mostrar sem
 * mentir. Extraída para ser testável sem montar o WebSocket — mesma ideia de
 * `escolherRecargaDeReconexao` e `mesclarAtualizacaoRealtime`, acima.
 *
 * Só "SUBSCRIBED" vira "conectado". QUALQUER outra coisa — CHANNEL_ERROR,
 * TIMED_OUT, CLOSED, e qualquer status futuro do SDK que este código ainda
 * não conheça — vira "reconectando", porque o handler que chama esta função
 * SEMPRE aciona `handleReconnect()` para os três primeiros. "desconectado"
 * nunca sai daqui: é reservado para quando NENHUMA inscrição está ativa (ver
 * o docstring de `EstadoConexaoRealtime`, acima).
 */
export function proximoEstadoConexao(
  statusCanal: string,
): EstadoConexaoRealtime {
  if (statusCanal === "SUBSCRIBED") return "conectado";
  return "reconectando";
}

interface EstadoConexaoCompartilhado {
  status: EstadoConexaoRealtime;
  listeners: Set<(status: EstadoConexaoRealtime) => void>;
}

/**
 * Guarda o estado de conexão POR CANAL (`channelId`, a mesma chave de
 * `globalOrderSubscriptions`, acima) — nunca por instância do hook. O
 * WebSocket real é compartilhado entre todas as instâncias que apontam para
 * o mesmo canal (duas telas montadas ao mesmo tempo, ou várias na mesma
 * página); se o estado fosse por instância, cada uma reagiria à própria
 * cópia e divergiria da real (item 5 do pedido).
 *
 * Mapa SEPARADO de `globalOrderSubscriptions` de propósito: aquele guarda o
 * canal e os callbacks de EVENTO (INSERT/UPDATE/DELETE); este guarda só o
 * estado de CONEXÃO. Separar os dois deixa esta parte testável sem montar
 * `SharedSubscription` inteira, e não arrisca o resto do fluxo de evento
 * (`mesclarAtualizacaoRealtime` e vizinhos), que acabaram de sair de
 * revisão.
 */
const globalConnectionStatus = new Map<string, EstadoConexaoCompartilhado>();

/**
 * Atualiza o estado de conexão de um canal e avisa todas as instâncias
 * inscritas nele. Idempotente por design (item "cuidado com o custo de
 * render" do pedido): se o status novo é IGUAL ao que já estava, não
 * notifica ninguém. Sem isto, uma rede ruim que gera CHANNEL_ERROR repetido
 * chamaria `setState` a cada tentativa — mesmo o estado visível
 * ("reconectando") nunca mudando — provocando re-render em cascata numa
 * tela com lista grande.
 */
export function definirStatusConexao(
  channelId: string,
  status: EstadoConexaoRealtime,
): void {
  const atual = globalConnectionStatus.get(channelId);
  if (atual) {
    if (atual.status === status) return;
    atual.status = status;
    for (const listener of atual.listeners) {
      // Um listener que lance não pode interromper a notificação dos
      // seguintes — hoje só há um por instância do hook (`setConnectionStatus`)
      // e ele não lança, mas duas telas montadas ao mesmo tempo já são dois
      // listeners no MESMO Set.
      try {
        listener(status);
      } catch (e) {
        console.error("[Realtime] Order connection status listener error:", e);
      }
    }
    return;
  }
  globalConnectionStatus.set(channelId, { status, listeners: new Set() });
}

/**
 * Inscreve uma instância do hook nas mudanças de estado de um canal. Devolve
 * o status ATUAL (para a instância que monta depois de outra já estar
 * conectada não passar pelo "conectando" à toa) e uma função para cancelar a
 * inscrição no cleanup do efeito.
 */
export function assinarStatusConexao(
  channelId: string,
  listener: (status: EstadoConexaoRealtime) => void,
): { statusAtual: EstadoConexaoRealtime; cancelar: () => void } {
  let entry = globalConnectionStatus.get(channelId);
  if (!entry) {
    entry = { status: "conectando", listeners: new Set() };
    globalConnectionStatus.set(channelId, entry);
  }
  entry.listeners.add(listener);
  const entryFinal = entry;
  return {
    statusAtual: entryFinal.status,
    cancelar: () => entryFinal.listeners.delete(listener),
  };
}

/**
 * Decide se ESTE `channel.subscribe` callback ainda pode escrever no estado
 * de conexão compartilhado — condicionado à IDENTIDADE DO CANAL (é ele que
 * está registrado agora para este `channelId`?), NUNCA ao `isUnmounting` da
 * instância do hook que o criou.
 *
 * ACHADO B1 DA REVISÃO DE 26/08/2026: a versão anterior guardava a escrita
 * atrás de `if (isUnmounting) return`, onde `isUnmounting` é uma flag POR
 * INSTÂNCIA, fechada sobre a execução do efeito que criou o canal. O canal
 * físico SOBREVIVE ao desmonte de quem o criou — o remount reaproveita via
 * `refCount++` (ramo `existing` de `setupRealtime`, abaixo) e NUNCA chama
 * `channel.subscribe` de novo. O callback registrado na criação continua
 * sendo a ÚNICA fonte de status daquele canal. Guardar por `isUnmounting`
 * da instância CRIADORA congelava o estado para sempre assim que ela
 * desmontava, mesmo com outra instância viva usando o MESMO canal —
 * cliente troca "Meus Pedidos" pela ficha de um pedido (mesmo `channelId`),
 * entra num elevador, o socket cai: selo verde numa tela morta,
 * indefinidamente.
 *
 * A guarda certa é por CANAL, não por instância: só recusa a escrita quando
 * o canal desta execução já foi SUBSTITUÍDO por um canal novo no mapa
 * compartilhado (teardown completo seguido de recriação) — nesse caso sim,
 * o callback é ruído de um canal morto e não pode sobrescrever o estado do
 * canal atual.
 *
 * `subscriptions` é passado explicitamente (em vez de ler
 * `globalOrderSubscriptions` direto) para poder ser testado sem montar o
 * canal real do Supabase.
 */
export function podeEscreverStatusDoCanal(
  channelId: string,
  channel: unknown,
  subscriptions: Map<string, { channel: unknown }>,
): boolean {
  return subscriptions.get(channelId)?.channel === channel;
}

/**
 * Remove a entrada de um canal do mapa de status compartilhado. Chamado do
 * teardown DEFINITIVO — depois do debounce de 4s, quando o `refCount`
 * continua em zero e o canal é mesmo removido (não só um remount que o
 * reaproveitou).
 *
 * ACHADO C1 DA REVISÃO DE 26/08/2026: nenhuma referência ao mapa fazia
 * `delete`. Depois do último canal cair e o debounce de limpeza rodar, a
 * entrada ficava parada no ÚLTIMO status conhecido — "conectado", na
 * maioria dos casos, porque é o estado que mais tempo passa estável. Um
 * remount que aconteça DEPOIS dessa limpeza (ex.: cliente sai de "Meus
 * Pedidos", passa 30s numa página de produto, perde a rede, volta) lia esse
 * verde vencido no PRIMEIRO render, antes de qualquer canal novo existir —
 * e ficava assim até o SDK esgotar o próprio tempo (10s por padrão).
 */
export function limparStatusConexao(channelId: string): void {
  globalConnectionStatus.delete(channelId);
}

/**
 * Decide o que fazer com uma mensagem recebida no `BroadcastChannel`
 * compartilhado entre abas, para o canal `channelId` desta instância.
 * Extraída para ser testável sem `BroadcastChannel` real — mesma ideia de
 * `escolherRecargaDeReconexao`, acima.
 *
 * ACHADO C2 DA REVISÃO DE 26/08/2026: o ramo NÃO-LÍDER nunca chamava
 * `definirStatusConexao` — a semente ficava em "conectando" para sempre,
 * mesmo essa aba recebendo atualização de PEDIDO de verdade pelo mesmo
 * `BroadcastChannel` (é o `order_change` que o líder já emite). Com zero
 * consumidor do campo isso era acidentalmente inofensivo; com telas do
 * painel lendo o campo, um selo que nunca sai de "conectando…" ensina a
 * pessoa a ignorar TODOS os selos, inclusive o da aba líder, onde ele está
 * certo e importa. A saúde do socket da aba não-líder É a saúde do socket
 * do líder — o broadcast dele é a ÚNICA fonte dela.
 *
 * Mensagem de tipo desconhecido (`channelId` de outra aba, ou um `type`
 * que esta versão do app ainda não conhece) é ignorada de propósito — não
 * pode quebrar uma aba rodando versão diferente do app.
 */
export function processarMensagemBroadcast(
  mensagem: {
    type?: unknown;
    channelId?: unknown;
    payload?: unknown;
    status?: unknown;
  },
  channelId: string,
  isLeader: boolean,
  acoes: {
    onEvent: (payload: unknown) => void;
    definirStatus: (channelId: string, status: EstadoConexaoRealtime) => void;
    responderStatusAtual: () => void;
  },
): void {
  if (mensagem?.channelId !== channelId) return;

  if (mensagem.type === "order_change") {
    // O líder já processou o evento direto do canal real — o broadcast é
    // só para as OUTRAS abas.
    if (!isLeader) acoes.onEvent(mensagem.payload);
  } else if (mensagem.type === "conn_status") {
    // O líder é a FONTE deste campo, nunca o destino: ele já sabe o status
    // real do próprio socket.
    if (!isLeader && typeof mensagem.status === "string") {
      acoes.definirStatus(channelId, mensagem.status as EstadoConexaoRealtime);
    }
  } else if (mensagem.type === "conn_status_request") {
    // Só o líder tem o socket para responder por.
    if (isLeader) acoes.responderStatusAtual();
  }
}

export function useOrders(
  enabled = true,
  isAdmin = false,
  options?: { onRealtimeEvent?: (payload: any) => void },
) {
  const { user, isAdmin: isUserAdmin } = useAuth();
  const { isLeader } = useLeaderElection();
  const userOrdersAbortControllerRef = useRef<AbortController | null>(null);
  const adminOrdersAbortControllerRef = useRef<AbortController | null>(null);
  const [orders, setOrders] = useState<Order[]>(() => {
    if (isAdmin) return cachedAdminOrders || [];
    if (typeof window === "undefined" || !user?.id) return [];
    try {
      const cacheKey = `ikcous_orders_cache_${user.id}`;
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed)) {
          return parsed;
        }
      }
    } catch (e) {
      console.error("Error loading cached orders:", e);
    }
    return [];
  });
  const [loading, setLoading] = useState(enabled);
  const [totalOrders, setTotalOrders] = useState(() => {
    return isAdmin ? cachedAdminTotalOrders : 0;
  });
  // Estado da conexão realtime exposto para a UI — ver o docstring de
  // `EstadoConexaoRealtime`, acima. "conectando" é o valor inicial correto
  // mesmo quando `enabled` é false: o efeito de inscrição, logo abaixo,
  // corrige para "desconectado" no primeiro render quando não há inscrição
  // nenhuma para fazer.
  const [connectionStatus, setConnectionStatus] =
    useState<EstadoConexaoRealtime>("conectando");

  // Synchronously load cache on mount or when user changes
  useEffect(() => {
    if (isAdmin) return;

    // Mesma regra do fetch: só troca a referência se o conteúdo mudou. Aqui o
    // efeito roda pouco (só quando o usuário muda), mas manter as duas
    // escritas com a mesma disciplina evita que a próxima pessoa reintroduza o
    // loop da PEDIDO-040 por este caminho.
    if (!user?.id) {
      setOrders((atual) => (atual.length === 0 ? atual : []));
      return;
    }
    const cacheKey = `ikcous_orders_cache_${user.id}`;
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed)) {
          setOrders((atual) =>
            JSON.stringify(atual) === JSON.stringify(parsed) ? atual : parsed,
          );
        }
      }
    } catch (e) {
      console.error("Error loading cached orders:", e);
    }
  }, [user?.id, isAdmin]);

  // Fetch orders for the logged-in user
  const fetchUserOrders = useCallback(async () => {
    if (!user || !enabled) return [];
    const cacheKey = `ikcous_orders_cache_${user.id}`;
    let hasCache = false;
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        hasCache = true;
      }
    } catch {
      // ignore localStorage issues
    }

    if (userOrdersAbortControllerRef.current) {
      userOrdersAbortControllerRef.current.abort();
    }
    userOrdersAbortControllerRef.current = new AbortController();
    const signal = userOrdersAbortControllerRef.current.signal;

    if (!hasCache) {
      setLoading(true);
    }
    try {
      const query = supabase
        .from("marketplace_orders")
        .select(
          `
          *,
          items:marketplace_order_items(*, product:produtos(imagem_url, imagem_urls)),
          address:user_addresses(*)
        `,
        )
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .abortSignal(signal);

      const { data, error } = await query;

      if (error) throw error;

      if (data) {
        const mappedOrders = data.map((item) => mapOrderFromDB(item as any));
        const serializado = JSON.stringify(mappedOrders);

        // Devolver a MESMA referência quando o resultado não mudou faz o React
        // desistir do re-render. Sem isto, `setOrders` trocava a referência a
        // cada volta — inclusive para lista vazia, porque `if (data)` é
        // verdadeiro para `[]` — e quem tivesse `orders` nas dependências de um
        // useCallback ficava em loop de requisição. Era o caso do
        // OrderDetailsView para usuário logado sem nenhum pedido (PEDIDO-040,
        // #84).
        //
        // A comparação é contra o state ATUAL, não contra o último fetch: se um
        // update otimista mexeu na lista e o servidor devolver o valor antigo,
        // a tela precisa voltar para o que o servidor diz.
        setOrders((atual) =>
          JSON.stringify(atual) === serializado ? atual : mappedOrders,
        );
        localStorage.setItem(cacheKey, serializado);
        return mappedOrders;
      }
      return [];
    } catch (err: any) {
      if (
        err?.name === "AbortError" ||
        err?.message === "Fetch is aborted" ||
        err?.message?.includes("aborted")
      ) {
        return [];
      }
      console.error("Error fetching user orders:", err);
      toast.error("Erro ao carregar seus pedidos");
      return [];
    } finally {
      setLoading(false);
    }
  }, [user, enabled]);

  // Load orders with pagination (Admin) - Optimized
  const loadOrders = useCallback(
    async (
      page = 0,
      pageSize = 20,
      statusFilter?: string,
      searchQuery?: string,
      startDate?: string,
      endDate?: string,
      silent = false,
    ) => {
      if (!enabled) return { orders: [], total: 0 };

      // Guarda a consulta para a reconexao poder repetir ESTA pagina e ESTE
      // filtro em vez de jogar a lojista para a pagina 1 (PEDIDO-030, #83).
      ultimaConsultaAdminRef.current = [
        page,
        pageSize,
        statusFilter,
        searchQuery,
        startDate,
        endDate,
        silent,
      ];

      if (adminOrdersAbortControllerRef.current) {
        adminOrdersAbortControllerRef.current.abort();
      }
      adminOrdersAbortControllerRef.current = new AbortController();
      const signal = adminOrdersAbortControllerRef.current.signal;

      try {
        if (!silent) {
          setLoading(true);
        }

        const query = (supabase.rpc as any)("get_admin_orders_paged", {
          p_search: searchQuery || "",
          p_status: statusFilter || "all",
          p_start_date: startDate || "",
          p_end_date: endDate || "",
          p_page: page,
          p_page_size: pageSize,
        }).abortSignal(signal);

        const { data, error } = await query;

        if (error) throw error;

        if (data) {
          const orderData = data.data || [];
          const totalCount = Number(data.total_count) || 0;

          const mappedOrders = orderData.map((item: any) =>
            mapOrderFromDB(item),
          );
          setOrders(mappedOrders);
          setTotalOrders(totalCount);

          cachedAdminOrders = mappedOrders;
          cachedAdminTotalOrders = totalCount;

          return { orders: mappedOrders, total: totalCount };
        }
        return { orders: [], total: 0 };
      } catch (err: any) {
        if (
          err?.name === "AbortError" ||
          err?.message === "Fetch is aborted" ||
          err?.message?.includes("aborted")
        ) {
          return { orders: [], total: 0 };
        }
        console.error("Error loading orders:", err);
        toast.error("Erro ao carregar pedidos");
        return { orders: [], total: 0 };
      } finally {
        setLoading(false);
      }
    },
    [enabled],
  );

  // Wrapper for backward compatibility
  const fetchOrders = useCallback(
    async (limitCount?: number) => {
      return loadOrders(0, limitCount || 50);
    },
    [loadOrders],
  );

  const handleRealtimeInsert = useCallback(
    async (newPayload: any) => {
      const { data, error } = await supabase
        .from("marketplace_orders")
        .select(
          "*, items:marketplace_order_items(*, product:produtos(imagem_url, imagem_urls)), address:user_addresses(*)",
        )
        .eq("id", newPayload.id)
        .single();

      if (!error && data) {
        if (!isAdmin && data.user_id !== user?.id) return;
        const newOrder = mapOrderFromDB(data as any);
        setOrders((prev) => {
          if (prev.some((o) => o.id === newOrder.id)) return prev;
          const updated = [newOrder, ...prev];
          if (user?.id && !isAdmin) {
            const cacheKey = `ikcous_orders_cache_${user.id}`;
            localStorage.setItem(cacheKey, JSON.stringify(updated));
          }
          return updated;
        });
        if (!isAdmin && !onRealtimeEventRef.current) {
          toast.info(`Novo pedido recebido! #${newOrder.id.slice(0, 8)}`);
        }
      }
    },
    [isAdmin, user?.id],
  );

  const handleRealtimeUpdate = useCallback(
    (updatedOrder: any) => {
      if (!updatedOrder.id) return;
      setOrders((prev) => {
        const updated = prev.map((o) =>
          o.id === updatedOrder.id
            ? mesclarAtualizacaoRealtime(o, updatedOrder)
            : o,
        );
        if (user?.id && !isAdmin) {
          const cacheKey = `ikcous_orders_cache_${user.id}`;
          localStorage.setItem(cacheKey, JSON.stringify(updated));
        }
        return updated;
      });
    },
    [isAdmin, user?.id],
  );

  const handleRealtimeDelete = useCallback(
    (oldId: string | undefined) => {
      if (oldId) {
        setOrders((prev) => {
          const updated = prev.filter((o) => o.id !== oldId);
          if (user?.id && !isAdmin) {
            const cacheKey = `ikcous_orders_cache_${user.id}`;
            localStorage.setItem(cacheKey, JSON.stringify(updated));
          }
          return updated;
        });
      }
    },
    [isAdmin, user?.id],
  );

  const ultimaConsultaAdminRef = useRef<ConsultaAdmin | null>(null);
  const fetchUserOrdersRef = useRef(fetchUserOrders);
  /**
   * O que os tres caminhos de reconexao devem recarregar: a consulta pessoal do
   * cliente, ou a paginada do painel na pagina e no filtro em que a lojista
   * estava (PEDIDO-030, #83). Ver `escolherRecargaDeReconexao`.
   */
  const recarregarAposReconexaoRef = useRef<() => Promise<unknown>>(() =>
    Promise.resolve(),
  );
  const handleRealtimeInsertRef = useRef(handleRealtimeInsert);
  const handleRealtimeUpdateRef = useRef(handleRealtimeUpdate);
  const handleRealtimeDeleteRef = useRef(handleRealtimeDelete);
  const onRealtimeEventRef = useRef(options?.onRealtimeEvent);

  useEffect(() => {
    fetchUserOrdersRef.current = fetchUserOrders;
    recarregarAposReconexaoRef.current = escolherRecargaDeReconexao({
      isAdmin,
      fetchUserOrders,
      loadOrders,
      ultimaConsultaAdmin: ultimaConsultaAdminRef.current,
    });
    handleRealtimeInsertRef.current = handleRealtimeInsert;
    handleRealtimeUpdateRef.current = handleRealtimeUpdate;
    handleRealtimeDeleteRef.current = handleRealtimeDelete;
    onRealtimeEventRef.current = options?.onRealtimeEvent;
  });

  // Realtime subscription for orders
  useEffect(() => {
    if (!enabled || !user?.id) {
      // Nenhuma inscrição vai acontecer nesta montagem — "conectando" aqui
      // mentiria que uma tentativa está em curso. Só o estado LOCAL desta
      // instância muda: como `assinarStatusConexao` nunca chega a rodar
      // neste ramo, nenhuma entrada é criada em `globalConnectionStatus`
      // para este `channelId` por causa desta instância — não há o que
      // `limparStatusConexao` (achado C1, acima) precise desfazer aqui.
      setConnectionStatus("desconectado");
      return;
    }

    const channelId = isAdmin
      ? "admin_order_updates"
      : `order_updates_${user.id}`;
    // Sincroniza esta instância com o estado JÁ conhecido do canal
    // compartilhado (item 5 do pedido: duas telas montadas ao mesmo tempo
    // têm que ler o MESMO estado, não uma cópia própria) e passa a ouvir
    // as próximas mudanças.
    const statusInscricao = assinarStatusConexao(
      channelId,
      setConnectionStatus,
    );
    setConnectionStatus(statusInscricao.statusAtual);
    let isUnmounting = false;
    let isConnecting = false;
    let retryCount = 0;
    let reconnectTimeout: ReturnType<typeof setTimeout> | undefined;
    let visibilityTimeout: ReturnType<typeof setTimeout> | undefined;
    let onlineTimeout: ReturnType<typeof setTimeout> | undefined;

    const bc =
      typeof window !== "undefined"
        ? new BroadcastChannel("ikcous_orders_realtime")
        : null;
    // Listener ÚNICO, anexado independente de liderança (achado C2 da
    // revisão de 26/08/2026 — antes só a aba NÃO-líder ouvia, e só para
    // "order_change"). `processarMensagemBroadcast` decide o que fazer com
    // cada tipo de mensagem; ver o docstring dela, acima, para o porquê de
    // cada ramo.
    // ⚠️ ACHADO B-1 DA REVISÃO DE 26/08/2026, TAPADO PELA METADE — leia antes
    // de mexer. Este `bc` pertence à INSTÂNCIA e é fechado no teardown dela
    // (`bc?.close()`, no fim deste efeito). Mas o CANAL de realtime sobrevive
    // à instância que o criou (`refCount` + debounce de 4 s), e o callback de
    // `channel.subscribe` registrado por ela continua rodando. Resultado: ele
    // chamava `bc.postMessage` num canal já fechado, o que lança
    // `InvalidStateError` — e o `realtime-js` invoca esse callback CRU, sem
    // try/catch, então virava rejeição não tratada em produção. Isso disparava
    // mesmo com ZERO consumidor do estado de conexão.
    //
    // Esta flag para o ESTOURO. Ela NÃO conserta o defeito: a mensagem
    // continua não chegando na segunda aba, que segue mostrando o último
    // status recebido. O conserto de verdade é dar ao canal de aviso o tempo
    // de vida do CANAL, não o da instância — mesma lição do B1 anterior (o
    // estado é por canal; quem publica o estado também tem de ser). Está
    // documentado como ABERTO, e por isso o selo de "Operações ao Vivo" NÃO
    // pode ser ligado a este campo ainda.
    let bcFechado = false;
    // Um ponto só de publicação: qualquer `postMessage` deste efeito passa
    // por aqui, para que a flag acima não dependa de alguém lembrar dela.
    const publicarNoBc = (mensagem: unknown) => {
      if (bcFechado) return;
      bc?.postMessage(mensagem);
    };
    let bcListener: ((event: MessageEvent) => void) | null = null;
    if (bc) {
      bcListener = (event: MessageEvent) => {
        processarMensagemBroadcast(event.data, channelId, isLeader, {
          onEvent: (payload) => onEvent(payload),
          definirStatus: definirStatusConexao,
          responderStatusAtual: () => {
            const atual = globalConnectionStatus.get(channelId)?.status;
            if (atual) {
              publicarNoBc({ type: "conn_status", channelId, status: atual });
            }
          },
        });
      };
      bc.addEventListener("message", bcListener);
    }

    const onEvent = async (payload: any) => {
      if (isUnmounting) return;
      const newId = (payload.new as any)?.id;
      const oldId = (payload.old as any)?.id;

      console.log(
        "[Realtime] Order change event processed:",
        payload.eventType,
        newId || oldId,
      );

      if (
        payload.eventType === "INSERT" &&
        payload.new &&
        "id" in payload.new
      ) {
        await handleRealtimeInsertRef.current(payload.new);
      } else if (payload.eventType === "UPDATE" && payload.new) {
        handleRealtimeUpdateRef.current(payload.new);
      } else if (payload.eventType === "DELETE") {
        handleRealtimeDeleteRef.current(oldId);
      }

      if (onRealtimeEventRef.current) {
        onRealtimeEventRef.current(payload);
      }
    };

    const setupRealtime = async () => {
      if (isUnmounting || isConnecting) return;

      const existing = globalOrderSubscriptions.get(channelId);
      if (existing) {
        existing.callbacks.add(onEvent);
        return;
      }

      isConnecting = true;
      try {
        console.log(
          `[Realtime] Creating new order channel (${isAdmin ? "Admin" : "User"}): ${channelId}`,
        );
        const channel = supabase.channel(channelId);

        channel.on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "marketplace_orders",
            ...(isAdmin ? {} : { filter: `user_id=eq.${user.id}` }),
          },
          async (payload) => {
            // Leader posts message to other tabs
            publicarNoBc({ type: "order_change", channelId, payload });

            const sub = globalOrderSubscriptions.get(channelId);
            if (sub) {
              const cbPromises = Array.from(sub.callbacks).map((cb) => {
                try {
                  return Promise.resolve(cb(payload));
                } catch (e) {
                  console.error("[Realtime] Order callback error:", e);
                  return Promise.resolve();
                }
              });
              await Promise.all(cbPromises);
            }
          },
        );

        const subObj: SharedSubscription = {
          channel,
          refCount: 1,
          callbacks: new Set([onEvent]),
        };
        globalOrderSubscriptions.set(channelId, subObj);

        channel.subscribe(async (status: any, err?: any) => {
          isConnecting = false;

          // B1 (revisão de 26/08/2026): a ESCRITA do estado vem ANTES da
          // guarda de instância, condicionada à IDENTIDADE DO CANAL —
          // `podeEscreverStatusDoCanal` (ver o docstring dela, acima) nunca
          // olha `isUnmounting`. O canal físico sobrevive ao desmonte de
          // quem o criou (remount reaproveita via refCount++, sem chamar
          // `channel.subscribe` de novo), e este callback continua sendo a
          // ÚNICA fonte de status daquele canal.
          if (
            podeEscreverStatusDoCanal(
              channelId,
              channel,
              globalOrderSubscriptions,
            )
          ) {
            const novoStatus = proximoEstadoConexao(status);
            definirStatusConexao(channelId, novoStatus);
            // C2: a aba NÃO-líder aprende a saúde deste socket pelo MESMO
            // BroadcastChannel que já leva `order_change` — a saúde dela É
            // a saúde do líder, porque este broadcast é a única fonte dela.
            publicarNoBc({
              type: "conn_status",
              channelId,
              status: novoStatus,
            });
          }

          // Guarda por INSTÂNCIA, inalterada: só governa `handleReconnect`
          // e `retryCount`, que continuam fora do escopo desta correção.
          if (isUnmounting) return;

          if (status === "SUBSCRIBED") {
            retryCount = 0;
            console.log(`[Realtime] Active shared channel: ${channelId}`);
          } else if (status === "CHANNEL_ERROR") {
            const errMessage =
              err?.message || (typeof err === "string" ? err : "");
            const isNormalClose =
              errMessage.includes("1000") || errMessage.includes("normal");
            const isAbnormalClose =
              errMessage.includes("1006") || errMessage.includes("abnormal");
            if (isNormalClose) {
              console.log(
                "[Realtime] Order channel closed normally (socket closed: 1000)",
              );
            } else if (isAbnormalClose) {
              console.warn(
                "[Realtime] Order channel closed abnormally (socket closed: 1006). SDK will auto-reconnect.",
              );
            } else {
              console.error(
                "[Realtime] Order channel error:",
                err?.message || err,
              );
            }
            handleReconnect();
          } else if (status === "TIMED_OUT" || status === "CLOSED") {
            handleReconnect();
          }
        });
      } catch (err) {
        console.error("[Realtime] Orders critical setup error:", err);
        isConnecting = false;
        // A criação do canal falhou antes de chegar a `channel.subscribe` —
        // não há status do SDK para traduzir aqui, mas `handleReconnect()`,
        // logo abaixo, vai tentar de novo do mesmo jeito.
        definirStatusConexao(channelId, "reconectando");
        handleReconnect();
      }
    };

    const handleReconnect = (initialDelay?: number) => {
      if (isUnmounting) return;

      const timeout = initialDelay || Math.min(1000 * 1.5 ** retryCount, 30000);
      retryCount++;

      clearTimeout(reconnectTimeout);
      reconnectTimeout = setTimeout(
        async () => {
          if (isUnmounting) return;
          try {
            await recarregarAposReconexaoRef.current();
            if (!isUnmounting) setupRealtime();
          } catch {
            if (!isUnmounting) setupRealtime();
          }
        },
        timeout + Math.random() * 1000,
      );
    };

    if (isLeader) {
      const existing = globalOrderSubscriptions.get(channelId);
      if (existing) {
        if (existing.cleanupTimeout) {
          clearTimeout(existing.cleanupTimeout);
          existing.cleanupTimeout = undefined;
          console.log(
            `[Realtime] Cancelled cleanup timeout for channel (existing mount): ${channelId}`,
          );
        }
        existing.refCount++;
        existing.callbacks.add(onEvent);
      } else {
        setupRealtime();
      }
    } else {
      console.log(
        `[Realtime-Orders] Secondary tab listening via BroadcastChannel: ${channelId}`,
      );
      // C2: pede ao líder o status ATUAL logo ao montar — sem isto, uma
      // aba não-líder que abre e não vê nenhuma transição de status fica
      // em "conectando" até a próxima queda do socket do líder.
      publicarNoBc({ type: "conn_status_request", channelId });
    }

    const handleVisibilityChange = () => {
      if (!isLeader) return;
      if (document.visibilityState === "visible") {
        clearTimeout(visibilityTimeout);
        visibilityTimeout = setTimeout(() => {
          const sub = globalOrderSubscriptions.get(channelId);
          if ((!sub || sub.refCount <= 0) && !isUnmounting && !isConnecting) {
            console.log("[Realtime] Orders foregrounded. Forcing reconnect...");
            retryCount = 0;
            clearTimeout(reconnectTimeout);
            recarregarAposReconexaoRef.current().then(() => {
              if (!isUnmounting) setupRealtime();
            });
          }
        }, 500);
      }
    };

    const handleOnline = () => {
      if (!isLeader) return;
      clearTimeout(onlineTimeout);
      onlineTimeout = setTimeout(() => {
        const sub = globalOrderSubscriptions.get(channelId);
        if ((!sub || sub.refCount <= 0) && !isUnmounting && !isConnecting) {
          console.log("[Realtime] Orders online. Checking...");
          retryCount = 0;
          clearTimeout(reconnectTimeout);
          recarregarAposReconexaoRef.current().then(() => {
            if (!isUnmounting) setupRealtime();
          });
        }
      }, 500);
    };

    globalThis.addEventListener("visibilitychange", handleVisibilityChange);
    globalThis.addEventListener("online", handleOnline);

    return () => {
      isUnmounting = true;
      statusInscricao.cancelar();
      clearTimeout(reconnectTimeout);
      clearTimeout(visibilityTimeout);
      clearTimeout(onlineTimeout);
      globalThis.removeEventListener(
        "visibilitychange",
        handleVisibilityChange,
      );
      globalThis.removeEventListener("online", handleOnline);

      if (isLeader) {
        const sub = globalOrderSubscriptions.get(channelId);
        if (sub) {
          sub.callbacks.delete(onEvent);
          sub.refCount--;
          if (sub.refCount <= 0) {
            if (sub.cleanupTimeout) {
              clearTimeout(sub.cleanupTimeout);
            }
            sub.cleanupTimeout = setTimeout(() => {
              const currentSub = globalOrderSubscriptions.get(channelId);
              if (currentSub && currentSub.refCount <= 0) {
                globalOrderSubscriptions.delete(channelId);
                // C1: apaga a entrada do estado de conexão JUNTO com a do
                // canal — sem isto ela ficava presa no último status
                // conhecido, e o próximo remount lia um verde vencido antes
                // de qualquer canal novo existir. Ver o docstring de
                // `limparStatusConexao`, acima.
                limparStatusConexao(channelId);
                supabase.removeChannel(currentSub.channel).catch(() => {});
                console.log(
                  `[Realtime] Cleaned up shared channel after debounce: ${channelId}`,
                );
              }
            }, 4000); // 4 seconds debounce
            console.log(
              `[Realtime] Scheduled cleanup for channel: ${channelId} (refCount: ${sub.refCount})`,
            );
          }
        }
      }
      // Listener único (achado C2) — removido independente de liderança,
      // porque agora é anexado independente dela também.
      if (bcListener && bc) {
        bc.removeEventListener("message", bcListener);
      }
      bcFechado = true;
      bc?.close();
    };
  }, [enabled, user?.id, isAdmin, isLeader]);

  const updateOrderStatus = useCallback(
    async (
      orderId: string,
      status: OrderStatus,
      notes?: string,
      silent = false,
    ) => {
      const originalOrders = [...orders];
      let originalCache: Order[] | null = null;
      try {
        // Find the order in the current state to check its existing status
        const order = orders.find((o) => o.id === orderId);

        // Validation logic extracted for clarity
        validateStatusUpdate(order, isAdmin, status, silent);

        // Optimistic update
        originalCache = cachedAdminOrders ? [...cachedAdminOrders] : null;
        cachedAdminOrders = (cachedAdminOrders || []).map((o) => {
          if (o.id === orderId) {
            const updatedOrder = Object.assign({}, o);
            updatedOrder.status = status;
            return updatedOrder;
          }
          return o;
        });

        setOrders((prev) => {
          const updated = prev.map((o) => {
            if (o.id === orderId) {
              const updatedOrder = Object.assign({}, o);
              updatedOrder.status = status;
              return updatedOrder;
            }
            return o;
          });
          if (user?.id && !isAdmin) {
            const cacheKey = `ikcous_orders_cache_${user.id}`;
            localStorage.setItem(cacheKey, JSON.stringify(updated));
          }
          return updated;
        });

        // Check if offline
        if (typeof navigator !== "undefined" && !navigator.onLine) {
          const queueStr =
            localStorage.getItem("orders_offline_updates_queue") || "[]";
          const queue = JSON.parse(queueStr);
          const cleanQueue = queue.filter(
            (item: any) => item.orderId !== orderId,
          );
          cleanQueue.push({
            orderId,
            status,
            notes,
            silent,
            timestamp: Date.now(),
          });
          localStorage.setItem(
            "orders_offline_updates_queue",
            JSON.stringify(cleanQueue),
          );

          if (!silent) {
            toast.info("Alteração de status guardada offline.", {
              description:
                "Será sincronizada com o servidor quando reestabelecer conexão.",
            });
          }
          return;
        }

        const { error } = await (supabase.rpc as any)(
          "update_order_status_atomic",
          {
            p_order_id: orderId,
            p_new_status: status,
            p_notes: notes || null,
            p_silent: silent,
          },
        );

        if (error) throw error;

        clearAnalyticsCache();
        if (!silent) toast.success("Status atualizado com sucesso");
      } catch (err: any) {
        console.error("Error updating status:", err);
        cachedAdminOrders = cachedAdminOrders
          ? [...(cachedAdminOrders || [])]
          : null; // will revert below or use originalCache
        cachedAdminOrders = originalCache;
        setOrders(originalOrders);
        if (user?.id && !isAdmin) {
          const cacheKey = `ikcous_orders_cache_${user.id}`;
          localStorage.setItem(cacheKey, JSON.stringify(originalOrders));
        }
        if (!silent) toast.error(mensagemAmigavelErroAtualizacaoStatus(err));
        throw err;
      }
    },
    [isAdmin, orders, user?.id],
  );

  const fetchOrderHistory = useCallback(async (orderId: string) => {
    try {
      // Cast to any because table might be missing in generated types
      const { data, error } = await (supabase as any)
        .from("marketplace_order_history")
        .select("*")
        .eq("order_id", orderId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data;
    } catch (err) {
      console.error("Error fetching order history:", err);
      return [];
    }
  }, []);

  const fetchOrdersByWhatsapp = useCallback(
    async (
      whatsapp: string,
      email?: string,
      orderFragment?: string,
    ): Promise<Order[]> => {
      try {
        const { data, error } = await (supabase.rpc as any)(
          "get_orders_by_whatsapp_v3",
          {
            p_phone_number: whatsapp,
            p_customer_email: email || null,
            p_order_fragment: orderFragment || null,
          },
        );

        if (error) throw error;
        return ((data as any[]) || []).map((item) => mapOrderFromDB(item));
      } catch (err) {
        console.error("Error fetching orders by whatsapp:", err);
        toast.error("Erro ao buscar pedidos. Verifique os dados informados.");
        return [];
      }
    },
    [],
  );

  const fetchDashboardSummary =
    useCallback(async (): Promise<DashboardSummary | null> => {
      if (!isUserAdmin) {
        console.warn(
          "[useOrders] fetchDashboardSummary bypassed: user is not admin",
        );
        return null;
      }
      try {
        const { data } = await (supabase.rpc as any)("get_admin_analytics_v2");
        if (data) {
          return data as DashboardSummary;
        }
        return null;
      } catch (err) {
        console.error("Error fetching dashboard summary:", err);
        return null;
      }
    }, [isUserAdmin]);

  /**
   * Avisa o lojista que entrou pedido novo (PEDIDO-020, #89).
   *
   * Deliberadamente SEM await e com catch que só registra. Neste ponto o pedido
   * JÁ está criado no banco: o critério 3 da issue exige que falha do aviso não
   * derrube o checkout, e a forma de garantir isso é o fluxo do cliente nunca
   * esperar por esta chamada nem enxergar o resultado dela.
   *
   * O que pode dar errado aqui e é aceito de propósito: função fora do ar, rede
   * do cliente caindo, ou o cliente fechando a aba antes de a requisição sair.
   * Nos três casos o pedido está salvo e o lojista vê pelo painel. É o preço da
   * arquitetura sem trigger, registrado na issue — quando a BANCO-040 (#40) for
   * respondida e o trigger virar possível, este disparo passa a ser redundante,
   * não errado.
   */
  const avisarLojista = useCallback((orderId: string) => {
    try {
      void (supabase as any).functions
        .invoke("notify-new-order", { body: { orderId } })
        .then((r: any) => {
          if (r?.error) {
            console.warn("notify-new-order: aviso não saiu", r.error);
          }
        })
        .catch((err: unknown) => {
          console.warn("notify-new-order: aviso não saiu", err);
        });
    } catch (err) {
      // invoke() lançar de forma síncrona não deveria acontecer, mas se
      // acontecer não pode chegar ao checkout.
      console.warn("notify-new-order: aviso não saiu", err);
    }
  }, []);

  /**
   * Manda ao CLIENTE o comprovante do pedido dele (PEDIDO-070, #106).
   *
   * Mesma forma do `avisarLojista` logo acima, e pelo mesmo motivo: sem `await`
   * e com catch que só registra. O pedido JÁ está no banco quando isto roda, e
   * o critério 3 da issue exige que falha de envio não impeça a criação do
   * pedido — a forma de garantir isso é o fluxo de quem compra nunca esperar
   * por esta chamada nem enxergar o resultado dela.
   *
   * A repetição é problema do BANCO, não daqui: `reivindicar_email_de_
   * confirmacao` faz um UPDATE condicional atômico e só a primeira chamada
   * ganha. Isso é o que segura o StrictMode montando duas vezes, o recarregar
   * de página e a retentativa de rede — nenhum dos três é evitável deste lado.
   */
  const enviarComprovanteAoCliente = useCallback((orderId: string) => {
    try {
      void (supabase as any).functions
        .invoke("send-order-confirmation", { body: { orderId } })
        .then((r: any) => {
          if (r?.error) {
            console.warn(
              "send-order-confirmation: comprovante não saiu",
              r.error,
            );
          }
        })
        .catch((err: unknown) => {
          console.warn("send-order-confirmation: comprovante não saiu", err);
        });
    } catch (err) {
      console.warn("send-order-confirmation: comprovante não saiu", err);
    }
  }, []);

  const createOrder = useCallback(
    async (orderData: any, opts?: { comPagamentoOnline?: boolean }) => {
      // 🛡️ Checkout de Convidados: O login não é mais obrigatório no frontend.
      // O RPC v22 cuidará da atribuição do user_id (NULL para convidados).

      // A v24 é idêntica à v23 no caminho do dinheiro — validação de preço,
      // estoque, frete e cupom são o mesmo corpo. A ÚNICA diferença é que ela
      // carimba payment_status='aguardando' e expires_at = now() + 30min.
      //
      // Por isso a escolha é do chamador e não uma troca global: pedido "na
      // entrega" não pode ganhar prazo, senão o pg_cron cancela venda legítima
      // — foi essa a correção que tirou a troca da Fase 1.
      const rpc = opts?.comPagamentoOnline
        ? "create_marketplace_order_v24"
        : "create_marketplace_order_v23";

      try {
        // 🛡️ SECURITY: Usando a RPC v22 Blindada (Zero-Trust)
        // O backend recalcula o total consultando os preços diretamente do banco (produtos/variants)
        // e usa o 'p_total_amount' como um Checksum para garantir integridade.
        const { data, error } = await (supabase as any).rpc(rpc, {
          p_items: orderData.items.map((item: any) => ({
            product_id: item.product_id || item.productId,
            variant_id: item.variant_id || item.variantId || null,
            quantity: item.quantity,
          })),
          p_total_amount: orderData.totalAmount,
          p_shipping_cost: orderData.shippingCost,
          p_payment_method: orderData.paymentMethod,
          p_address_id: orderData.addressId || null,
          p_coupon_code: orderData.couponCode || null,
          p_customer_name: orderData.customer.name,
          p_customer_phone: orderData.customer.whatsapp,
          p_observation: orderData.notes || null,
          p_address_data: orderData.addressData || null,
          // O banco usa estes dois para localizar a cotação que ELE gravou e
          // confirmar o valor do frete. O preço enviado pelo cliente é ignorado.
          p_destination_cep: orderData.destinationCep || null,
          p_shipping_option_id: orderData.shippingOptionId || null,
        });

        if (error) throw error;
        if (!data) throw new Error("Falha ao obter ID do pedido");

        // PEDIDO-020 (#89). Depois do `throw`, para não avisar de pedido que não
        // existe; e antes do return, para o disparo sair mesmo que a tela navegue
        // em seguida.
        //
        // A-3 da revisão final: no caminho online o pedido é uma RESERVA que o
        // pg_cron cancela em 30 min, não um pedido definitivo — avisar aqui faria
        // o lojista separar mercadoria de um pedido que pode morrer. Quem avisa
        // nesse caminho é o webhook da Fase 3, quando o pagamento é confirmado
        // ("aprovado → payment_status='pago', dispara notify-new-order").
        // O comprovante do cliente segue a MESMA regra do aviso ao lojista, e
        // pelo mesmo motivo: no caminho online o pedido é uma reserva que o
        // pg_cron cancela em 30 min. Mandar "recebemos seu pedido" ali seria o
        // app afirmando o que ele mesmo pode desfazer daqui a meia hora. Quem
        // envia nesse caminho é o webhook, quando o pagamento confirma —
        // entrega separada, porque mexer no caminho do dinheiro pede revisão
        // própria.
        if (!opts?.comPagamentoOnline) {
          avisarLojista(data);
          enviarComprovanteAoCliente(data);
        }

        return {
          ...orderData,
          id: data,
          status: "pending" as const,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
      } catch (err: any) {
        console.error("Error creating order:", err);
        toast.error(mensagemAmigavelErroPedido(err));
        throw err;
      }
    },
    [avisarLojista, enviarComprovanteAoCliente],
  );

  /**
   * Pede à edge function que crie a cobrança no Mercado Pago.
   *
   * Diferente do avisarLojista (PEDIDO-020), aqui o cliente ESPERA: sem a
   * resposta não há QR code para mostrar. Erro aqui não perde o pedido — ele
   * já está criado e expira sozinho em 30 minutos, que é a rede descrita na
   * spec.
   */
  const criarPagamento = useCallback(
    async (args: {
      orderId: string;
      metodo: "pix" | "cartao";
      token?: string;
      parcelas?: number;
      paymentMethodId?: string;
      issuerId?: string;
      email?: string;
      documento?: { type: string; number: string };
    }) => {
      const { data, error } = await (supabase as any).functions.invoke(
        "criar-pagamento",
        { body: args },
      );

      // ATENÇÃO ao contrato do supabase-js v2, que não é o intuitivo: quando a
      // resposta NÃO é 2xx, `data` chega NULL e o corpo fica em `error.context`,
      // que é um Response. Ler só `data?.error` — como a primeira versão deste
      // plano mandava — jogaria fora as quatro mensagens distintas que a edge
      // function escreve com cuidado ("Este pedido já tem uma cobrança gerada.",
      // "O prazo para pagar este pedido acabou.", "Pedido inválido.",
      // "Pagamento indisponível.") e mostraria a mesma frase genérica em todas.
      if (error) {
        let mensagem = "Não foi possível gerar a cobrança.";
        // CHECKOUT-050 (#194): `terminal` viaja JUNTO da mensagem, lido do
        // mesmo corpo — é o campo que a edge function grava nos três ramos
        // de "recusar" de podeCobrar() (supabase/functions/criar-pagamento
        // /index.ts). Sem ele, quem chama esta função tinha que ADIVINHAR a
        // categoria comparando a MENSAGEM por igualdade exata com um texto
        // fixo — e quebrava assim que a mensagem real mudava (achado da
        // revisão, ver o comentário grande em PagamentoOnline.tsx). Default
        // `false`: falha fechada quando o corpo não tem o campo (edge
        // function antiga ainda no ar, ou corpo ilegível) — de propósito
        // SEM reconstruir a categoria a partir de texto nesse caso.
        let terminal = false;
        try {
          const corpo = await (error as any).context?.json?.();
          if (corpo?.error) mensagem = corpo.error;
          if (typeof corpo?.terminal === "boolean") terminal = corpo.terminal;
        } catch {
          // Corpo ilegível: fica a mensagem genérica, que é melhor que vazar
          // o texto cru de um erro de infraestrutura para o cliente.
        }
        throw Object.assign(new Error(mensagem), { terminal });
      }
      if (data?.error) {
        // Mesma regra estrita do ramo `error` acima: só `true` literal vira
        // terminal. `Boolean(...)` aceitaria "false" (string), 1, `{}` — este
        // ramo é inalcançável hoje (o supabase-js v2 sempre preenche `error`
        // numa resposta não-2xx), mas duas leituras do mesmo campo lado a
        // lado é convite para elas divergirem.
        throw Object.assign(new Error(data.error), {
          terminal:
            typeof (data as any).terminal === "boolean" &&
            (data as any).terminal,
        });
      }
      return data as {
        paymentId: string;
        // CHECKOUT-080 (#213): renomeado de `status` — o campo agora fala o
        // vocabulário FECHADO do banco ('aguardando'/'pago'/'recusado'/
        // 'expirado'/'estornado'), não mais o vocabulário clássico do MP, e
        // o nome novo torna impossível confundir com o `status` de PEDIDO
        // (`OrderStatus`, valores diferentes) que já existe neste mesmo
        // arquivo. `string`, não `StatusPagamentoConhecido` — ver o
        // comentário grande de `StatusPagamentoConhecido`, acima: a edge
        // function pode devolver um par cru para status que ela mesma não
        // reconhece, e o tipo não pode prometer o que o runtime não garante.
        statusPagamento: string;
        expiraEm: string;
        qrCode?: string;
        qrCodeBase64?: string;
        ticketUrl?: string;
      };
    },
    [],
  );

  const generateOrderOtp = useCallback(
    async (
      email: string,
      whatsapp: string,
      orderFragment: string,
    ): Promise<boolean> => {
      // Inversão de 19/08/2026 (#161 + #86). Antes isto chamava a RPC
      // `generate_order_otp_v1`, que só GRAVAVA o código e deixava um gatilho
      // do banco enfileirar o e-mail com `net.http_post` — e essa fila só é
      // processada DEPOIS do commit, então a RPC voltava `true` antes de
      // qualquer envio existir. Era esse `true` prematuro que fazia a tela
      // escrever "código de verificação enviado" sem que ninguém tivesse como
      // saber se algo saiu.
      //
      // Agora quem envia é a edge function, e ela responde. `true` aqui passa
      // a significar "o e-mail saiu", que é o que a tela sempre afirmou.
      const NAO_ENVIOU =
        "Não conseguimos enviar seu código agora. Tente de novo em alguns minutos.";
      // Mensagem única para "pedido não existe", "e-mail não bate" e
      // "fragmento curto demais": distinguir os três diria a quem está
      // adivinhando qual metade ele já acertou (AUTH-010, #118).
      const NAO_CONFERE =
        "Não encontramos um pedido com esse e-mail, WhatsApp e ID juntos.";

      try {
        const { data, error } = await supabase.functions.invoke(
          "send-otp-email",
          { body: { email, whatsapp, orderFragment } },
        );

        // `invoke` transforma status >= 400 em `error`. A função devolve 502
        // quando a loja falhou (envio ou remetente ausente) — daí o erro sem
        // corpo cair no mesmo aviso de "não conseguimos enviar".
        if (error && !data) {
          console.error("Error generating OTP:", error);
          toast.error(NAO_ENVIOU);
          return false;
        }

        if (data?.ok) return true;

        if (data?.motivo === "muito_recente") {
          toast.error(
            `Já enviamos um código há pouco. Espere ${data.espereSegundos ?? 60} segundos e confira sua caixa de entrada.`,
          );
          return false;
        }

        if (
          data?.motivo === "envio_falhou" ||
          data?.motivo === "sem_remetente"
        ) {
          toast.error(NAO_ENVIOU);
          return false;
        }

        toast.error(NAO_CONFERE);
        return false;
      } catch (err: any) {
        // Rede caiu, função fora do ar, corpo ilegível: nada disso é culpa de
        // quem está comprando, e nenhum deles pode virar `true`.
        console.error("Error generating OTP:", err);
        toast.error(NAO_ENVIOU);
        return false;
      }
    },
    [],
  );

  const fetchOrdersByOtp = useCallback(
    async (email: string, otp: string): Promise<Order[]> => {
      try {
        setLoading(true);
        const { data, error } = await (supabase.rpc as any)(
          "get_orders_by_otp_v1",
          {
            p_email: email,
            p_otp: otp,
          },
        );

        if (error) throw error;

        // Contrato novo desde a AUTH-010 (#118): a RPC devolve
        // { ok, orders } ou { ok: false, error, restantes } em vez de um array
        // cru. O caminho de falha RETORNA em vez de levantar exceção de
        // propósito — no PostgREST cada RPC é uma transação, e um RAISE
        // reverteria o incremento do contador de tentativas.
        if (data && typeof data === "object" && "ok" in data) {
          if (!data.ok) {
            const restantes = (data as any).restantes;
            toast.error(
              typeof restantes === "number" && restantes > 0
                ? `${(data as any).error} Restam ${restantes} tentativa(s).`
                : (data as any).error || "Código inválido ou expirado",
            );
            return [];
          }
          const orders = (((data as any).orders as any[]) || []).map((item) =>
            mapOrderFromDB(item),
          );
          if (orders.length === 0) {
            // B2 da revisão de 22/08/2026: a verificação deu certo
            // (`data.ok === true`) mas não sobrou pedido para devolver. A
            // ÚNICA causa viva disso é uma corrida DENTRO desta própria
            // chamada de RPC — o pedido foi apagado entre o SELECT que acha
            // o código e o RETURN que monta o JSON (a FK de
            // otp_verifications.order_id é NOT NULL + ON DELETE CASCADE:
            // fora dessa janela estreita a linha do OTP já teria sido
            // apagada junto, e cairia no ramo `!data.ok` acima). Este é o
            // ÚNICO lugar onde essa causa é conhecida — por isso o toast
            // mora aqui, e não em OrderSearch.tsx.
            toast.error(
              "Seu código foi verificado, mas esse pedido não está mais disponível. Fale com a loja.",
            );
          }
          return orders;
        }

        // Ramo defensivo, hoje MORTO contra o banco vivo: resposta no
        // formato antigo (array cru), sem o envelope `{ ok, orders }`. Toda
        // versão de get_orders_by_otp_v1 desde a AUTH-010 (#118) — inclusive
        // a que está viva agora, ver docstring de mensagemAmigavelErroOtp
        // acima sobre COMO confirmar qual é — devolve SEMPRE o envelope com
        // `ok`, então o `if (data && "ok" in data)` logo acima captura toda
        // resposta real, e este `return` nunca executa hoje. Mantido como
        // salvaguarda contra uma versão anterior da função (rollback, ou
        // downgrade de schema); se a função nunca mais voltar ao formato de
        // array cru, este ramo pode ser removido com segurança.
        return ((data as any[]) || []).map((item) => mapOrderFromDB(item));
      } catch (err: any) {
        console.error("Error fetching orders by OTP:", err);
        toast.error(mensagemAmigavelErroOtp(err));
        return [];
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const subscribeToOrders = useCallback(
    (onChange?: (payload: any) => void) => {
      if (!user) return () => {};

      const channelId = isAdmin
        ? "admin_order_updates_realtime"
        : `order_updates_realtime_${user.id}`;
      console.log(
        `[Realtime] Subscribing to orders (${isAdmin ? "Admin" : "User"}): ${channelId}`,
      );

      const channel = supabase.channel(channelId);

      channel.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "marketplace_orders",
          ...(isAdmin ? {} : { filter: `user_id=eq.${user.id}` }),
        },
        async (payload) => {
          console.log("[Realtime] Order change event:", payload.eventType);
          if (onChange) {
            onChange(payload);
          }
        },
      );

      channel.subscribe((status, err) => {
        if (status === "SUBSCRIBED") {
          console.log(`[Realtime] Active orders channel: ${channelId}`);
        } else if (status === "CHANNEL_ERROR") {
          const errMessage =
            (err as any)?.message ||
            (typeof (err as any) === "string" ? (err as any) : "");
          const isNormalClose =
            errMessage.includes("1000") || errMessage.includes("normal");
          const isAbnormalClose =
            errMessage.includes("1006") || errMessage.includes("abnormal");
          if (isNormalClose) {
            console.log(
              `[Realtime] Orders channel closed normally: ${channelId}`,
            );
          } else if (isAbnormalClose) {
            console.warn(
              `[Realtime] Orders channel closed abnormally (socket closed: 1006): ${channelId}. SDK will auto-reconnect.`,
            );
          } else {
            console.error(
              "[Realtime] Orders channel error:",
              err?.message || err,
            );
          }
        }
      });

      return () => {
        console.log(`[Realtime] Cleaning up orders channel: ${channelId}`);
        supabase.removeChannel(channel).catch(() => {});
      };
    },
    [user, isAdmin],
  );

  // Synchronize queued offline order status updates when coming back online
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleOnlineSync = () => {
      setTimeout(() => {
        syncOfflineOrderUpdates().then((synced) => {
          if (synced) {
            if (isAdmin) {
              loadOrders(0, 10, "all", "", "", "", true).catch(() => {});
            } else if (user?.id) {
              fetchUserOrders().catch(() => {});
            }
          }
        });
      }, 1000);
    };

    window.addEventListener("online", handleOnlineSync);
    if (navigator.onLine) {
      handleOnlineSync();
    }
    return () => {
      window.removeEventListener("online", handleOnlineSync);
    };
  }, [user?.id, isAdmin, loadOrders, fetchUserOrders]);

  useEffect(() => {
    return () => {
      if (userOrdersAbortControllerRef.current) {
        userOrdersAbortControllerRef.current.abort();
      }
      if (adminOrdersAbortControllerRef.current) {
        adminOrdersAbortControllerRef.current.abort();
      }
    };
  }, []);

  return {
    orders,
    loading,
    isLoaded: !loading,
    totalOrders,
    // Estado da conexão realtime (auditoria de 26/08/2026) — ver o
    // docstring de `EstadoConexaoRealtime`, acima. Quatro valores possíveis:
    // "conectando" | "conectado" | "reconectando" | "desconectado". Nunca
    // colapsar num booleano na tela que consumir isto.
    realtimeConnectionStatus: connectionStatus,
    fetchUserOrders,
    loadOrders, // New pagination function
    fetchOrders, // Legacy alias
    updateOrderStatus,
    fetchOrdersByWhatsapp,
    generateOrderOtp,
    fetchOrdersByOtp,
    createOrder,
    criarPagamento,
    fetchDashboardSummary,
    fetchOrderHistory,
    subscribeToOrders,
  };
}
