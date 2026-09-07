// @ts-nocheck
/**
 * reconciliar-pagamentos — varre os pedidos que o `webhook-mercadopago`
 * perdeu (Fase 3, Task 6). Chamada pelo `pg_cron` via `pg_net`, a cada 10
 * minutos, com o corpo montado pela migration
 * `20260808000100_reconciliacao.sql`.
 *
 * O QUE PROTEGE ESTA FUNÇÃO
 *
 * Roda com `verify_jwt = false` (config.toml) porque quem chama é o
 * `pg_net`, não um usuário logado, e o `pg_net` não manda JWT de usuário. Dar
 * `verify_jwt = true` obrigaria a credencial a ser a `service_role` — que
 * passaria a viver dentro do banco, num Vault que qualquer `SECURITY
 * DEFINER` mal configurado poderia ler. Em vez disso a autenticação é o
 * `RECONCILIACAO_SECRET`: um segredo dedicado cujo pior caso ao vazar é
 * alguém disparar uma reconciliação — que só pergunta ao MP e chama a
 * `confirmar_pagamento`, idempotente.
 *
 * ESTA FUNÇÃO NÃO DECIDE NADA — SÓ PERGUNTA E REPASSA
 *
 * `pagamentos_a_reconciliar()` (Task 5, alargada pelo issue #180) já filtrou
 * os candidatos — `expirado` OU `aguardando` com `status = 'cancelled'`
 * (pedido cancelado pelo app cujo PIX foi pago mesmo assim) —, sempre com
 * `gateway_payment_id`, `paid_at` nulo e dentro de 24h. Para cada um, esta
 * função só pergunta ao MP o status ATUAL e repassa para `confirmar_pagamento`
 * (Task 2) — a MESMA RPC que o `webhook-mercadopago` chama. Se esta função também
 * decidisse quando virar `pago_apos_expirar`, existiriam DOIS lugares
 * decidindo isso a partir de status de pagamento, e eles divergiriam em três
 * meses — como a regra de frete grátis, que chegou a estar escrita em sete
 * lugares (#53).
 *
 * SEM PUSH AQUI
 *
 * Quem avisa o lojista é o `webhook-mercadopago`. Se esta função também
 * avisasse, um pedido que o webhook JÁ confirmou (e que só está na fila de
 * candidatos por causa de uma corrida improvável) geraria dois avisos do
 * mesmo pedido. O `pago_apos_expirar` encontrado aqui aparece na fila de
 * atenção da Task 9 — não é um push perdido, é um push que não é desta
 * função.
 */
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  consultarOrder,
  consultarPagamento,
  extrairValorDaOrder,
  fetchComTempo,
  idEhClassico,
  mapearStatus,
  mapearStatusOrder,
  TOLERANCIA_DE_VALOR,
} from "../_shared/mercadopago.ts";
import { readKey } from "../_shared/webpush.ts";
import {
  confirmarPorConsulta,
  executarEstorno,
  type LinhaEstorno,
  type PedidoParaEstorno,
  type ResultadoEstorno,
} from "../_shared/estorno.ts";

/** Único texto do app que manda o lojista ao painel do MP (Restrições
 * globais do plano) — só depois de 5 tentativas sem confirmação. */
const TEXTO_LIMITE_DE_TENTATIVAS =
  "não consegui confirmar a devolução no Mercado Pago depois de 5 tentativas; confira no painel do MP";

/**
 * Grava o desfecho de UM estorno (Task 2/T2 `ResultadoEstorno`) na MESMA
 * tabela de gravação que a edge `estornar-pagamento` (T3) usa — um desenho,
 * dois chamadores, para não existir um segundo lugar decidindo o que
 * `concluido`/`falhou`/`tentar_depois` significam no ledger.
 *
 * `concluido` → RPC `concluir_estorno` (atômica: soma `valor_estornado` e
 * vira `payment_status` numa transação só). Se a RPC falhar o dinheiro já
 * saiu do MP — a linha fica `em_processamento` (nunca `falhou`) para o
 * PRÓXIMO ciclo completar o registro, nunca "esquecer que o MP confirmou".
 * `tentar_depois`/`em_processamento` → mantém a linha viva, grava o
 * diagnóstico. `falhou`/`recusado` → UPDATE terminal condicional
 * (`.in('status', ['em_processamento'])`): se outro executor já concluiu ou
 * falhou a linha no meio, 0 linhas voltam e nada é sobrescrito.
 */
async function gravarDesfechoDoEstorno(
  supabase: ReturnType<typeof createClient>,
  refundId: string,
  resultado: ResultadoEstorno,
): Promise<"concluido" | "adiado" | "falhou"> {
  if (resultado.tipo === "concluido") {
    const { error } = await supabase.rpc("concluir_estorno", {
      p_refund_id: refundId,
      p_mp_refund_id: resultado.mp_refund_id,
      p_mp_status: resultado.mp_status,
      p_mp_status_detail: resultado.mp_status_detail,
    });
    if (error) {
      console.error(
        "reconciliar-pagamentos: concluir_estorno falhou (o MP confirmou; o próximo ciclo completa o registro)",
        refundId,
        error,
      );
      return "adiado";
    }
    return "concluido";
  }

  if (resultado.tipo === "tentar_depois") {
    const { error } = await supabase
      .from("order_refunds")
      .update({ ultimo_erro: resultado.motivo, updated_at: new Date().toISOString() })
      .eq("id", refundId)
      .in("status", ["em_processamento"]);
    if (error) {
      console.error("reconciliar-pagamentos: falha ao gravar o adiamento do estorno", refundId, error);
    }
    return "adiado";
  }

  if (resultado.tipo === "em_processamento") {
    // Resposta assíncrona do MP (PIX em contingência): a linha JÁ está
    // em_processamento — só grava o diagnóstico (mesmo padrão da edge, T3).
    const { error } = await supabase
      .from("order_refunds")
      .update({
        mp_refund_id: resultado.mp_refund_id ?? undefined,
        mp_status: resultado.mp_status,
        updated_at: new Date().toISOString(),
      })
      .eq("id", refundId)
      .in("status", ["em_processamento"]);
    if (error) {
      console.error("reconciliar-pagamentos: falha ao gravar o diagnóstico do estorno", refundId, error);
    }
    return "adiado";
  }

  // falhou | recusado: definitivo. `falhou` com codigo
  // 'confirmacao_insuficiente' só chega aqui vindo de um POST que devolveu
  // 4296/order_already_refunded (o MP contradisse a si mesmo) — é terminal
  // mesmo (a alternativa B do I-A garante que o caminho DIRETO desta função
  // nunca produz `falhou` por "ainda não apareceu").
  const { error } = await supabase
    .from("order_refunds")
    .update({
      status: resultado.tipo,
      ultimo_erro: resultado.motivo,
      updated_at: new Date().toISOString(),
    })
    .eq("id", refundId)
    .in("status", ["em_processamento"]);
  if (error) {
    console.error("reconciliar-pagamentos: falha ao gravar o desfecho terminal do estorno", refundId, error);
  }
  return "falhou";
}

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), {
    status,
    headers: { "Content-Type": "application/json" },
  });

/**
 * Compara `x-reconciliacao-secret` com `RECONCILIACAO_SECRET` em tempo
 * constante — mesma ideia do fim de `validarAssinatura`
 * (`_shared/mercadopago.ts`): `===` em string vaza, pelo tempo de resposta,
 * quantos caracteres do prefixo o atacante já acertou. Copiada aqui, não
 * extraída para `_shared`: extrair é refatoração que a sessão principal
 * decide, não esta tarefa.
 */
function segredoConfere(esperado: string, recebido: string): boolean {
  if (esperado.length !== recebido.length) return false;
  let diferenca = 0;
  for (let i = 0; i < esperado.length; i++) {
    diferenca |= esperado.charCodeAt(i) ^ recebido.charCodeAt(i);
  }
  return diferenca === 0;
}

/**
 * Mesma costura `handler(req, deps = {})` da Task 4
 * (`webhook-mercadopago/index.ts`): em produção o `serve()` lá embaixo chama
 * `handler(req)` com um único argumento; os testes injetam `supabase` e
 * `fetchImpl` para não tocar rede nem banco — o que importa aqui, porque a
 * RPC `pagamentos_a_reconciliar` (Task 5) ainda não foi aplicada em produção.
 */
async function handler(
  req: Request,
  deps: {
    supabase?: ReturnType<typeof createClient>;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<Response> {
  // Sem CORS aqui: quem chama é o `pg_net` (agendado pela migration
  // `20260808000100_reconciliacao.sql`), que não faz preflight — nenhum
  // navegador chama esta função. O `corsHeaders` de `_shared/webpush.ts`
  // também não liberaria `x-reconciliacao-secret`, então um ramo `OPTIONS`
  // aqui afirmaria uma consistência que nem existiria de verdade.

  // Ordem que importa: primeiro confere se o ambiente TEM o segredo — sem
  // isso, um deploy que esqueceu de configurar `RECONCILIACAO_SECRET`
  // compararia contra "" e QUALQUER header vazio "passaria direto". Só depois
  // compara em tempo constante. Assim um ambiente mal configurado nunca vira
  // "passa direto" nem um 401 confuso de diagnosticar.
  const segredoEsperado = Deno.env.get("RECONCILIACAO_SECRET");
  if (!segredoEsperado) {
    console.error("reconciliar-pagamentos: RECONCILIACAO_SECRET ausente no ambiente");
    return json({ error: "Ambiente mal configurado." }, 503);
  }

  const segredoRecebido = req.headers.get("x-reconciliacao-secret") ?? "";
  if (!segredoConfere(segredoEsperado, segredoRecebido)) {
    console.warn("reconciliar-pagamentos: segredo inválido");
    return json({ error: "Não autorizado." }, 401);
  }

  const supabase =
    deps.supabase ??
    createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      readKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY"),
    );

  // Em try: uma REJEIÇÃO (rede, cliente mal configurado) não pode escapar do
  // handler inteiro — o `webhook-mercadopago` envolve a chamada equivalente
  // pelo mesmo motivo.
  let candidatos: Array<{ order_id: string; gateway_payment_id: string }> | null;
  try {
    const { data, error: erroCandidatos } = await supabase.rpc("pagamentos_a_reconciliar");
    if (erroCandidatos) throw erroCandidatos;
    candidatos = data;
  } catch (erro) {
    console.error("reconciliar-pagamentos: pagamentos_a_reconciliar falhou", erro);
    return json({ error: "Erro ao buscar candidatos." }, 500);
  }

  let verificados = 0;
  let confirmados = 0;
  let ignorados = 0;
  let falhas = 0;

  // Cada candidato dentro do seu próprio try: a reconciliação existe
  // exatamente para pegar o que já falhou uma vez (o webhook não confirmou),
  // então um segundo candidato não pode perder a vez porque o primeiro deu
  // erro de rede.
  for (const candidato of candidatos ?? []) {
    verificados++;
    try {
      const mpToken = Deno.env.get("MP_ACCESS_TOKEN") ?? "";

      // Tarefa 4 (CHECKOUT-070), correção pós-revisão: discrimina pela FORMA
      // do id (`idEhClassico`, `_shared/mercadopago.ts`), não pelo código de
      // erro HTTP que a Orders API devolveu. A versão anterior deste
      // comentário afirmava que "a Orders API nunca reconhece esse id e
      // devolve 404, sempre" — o MP não devolve 404 para um id sem forma de
      // order: devolve 400 `invalid_path_param` ("must begin with the prefix
      // 'ORD'..."); 404 só existe quando a forma JÁ é de order, mas a order
      // não existe. Um id clássico (numérico) nunca tem forma de order, então
      // batia 400, nunca 404 — o fallback para o legado nunca disparava de
      // verdade: um candidato legado pago caía no `else` genérico, virava
      // `falhas++`, e sumia da fila para sempre (dinheiro no MP, pedido
      // `expirado`, estoque já revendido). Decidir pela forma, como o
      // `webhook-mercadopago` já fazia, não depende de o MP manter essa
      // taxonomia de erro — e poupa a chamada à Orders API para todo
      // candidato legado, que nunca vai ser reconhecido por ela.
      let statusMapeado: string | null;
      // Só para o log de "status desconhecido do MP" logo abaixo — sem isto
      // esse ramo (que existe justamente para descobrir status NOVO do MP)
      // não dizia qual status tinha chegado.
      let statusBrutoParaLog: string;
      // Valor que o MP APROVOU, na grafia de cada rota (laudo 31/08, A3) —
      // undefined quando o corpo não trouxe número. A conferência contra o
      // total do pedido fica logo abaixo do filtro de 'expirado'.
      let valorAprovado: number | undefined;

      if (idEhClassico(candidato.gateway_payment_id)) {
        // Candidato LEGADO, criado antes da migração para a Orders API — vai
        // DIRETO para o endpoint clássico, sem gastar uma consulta na Orders
        // API que nunca vai reconhecer este id.
        const consultaClassica = await consultarPagamento({
          token: mpToken,
          paymentId: candidato.gateway_payment_id,
          fetchImpl: deps.fetchImpl,
        });

        if (!consultaClassica.ok) {
          console.warn(
            "reconciliar-pagamentos: consultarPagamento falhou (candidato legado)",
            candidato.order_id,
            consultaClassica.status,
            consultaClassica.erro,
          );
          falhas++;
          continue;
        }
        statusMapeado = mapearStatus(consultaClassica.status);
        statusBrutoParaLog = consultaClassica.status;
        valorAprovado = typeof consultaClassica.valor === "number" ? consultaClassica.valor : undefined;
      } else {
        // Candidato NOVO — `gateway_payment_id` é um id de ORDER (prefixo
        // ORD/ORDTST) desde a Tarefa 2.
        const consultaOrder = await consultarOrder({
          token: mpToken,
          orderId: candidato.gateway_payment_id,
          fetchImpl: deps.fetchImpl,
        });

        if (!consultaOrder.ok) {
          console.warn(
            "reconciliar-pagamentos: consultarOrder falhou",
            candidato.order_id,
            consultaOrder.status,
            consultaOrder.erro,
          );
          falhas++;
          continue;
        }

        // `status`/`status_detail` ficam na RAIZ da order — existe um par
        // igual dentro de `transactions.payments[0]`, mas ali é um índice de
        // array que viraria escolha carregada no dia em que a order tiver
        // mais de um pagamento. A raiz é a verdade do pedido; mapearStatusOrder
        // recebe exatamente o par da raiz (fato medido contra a API real,
        // 14/08/2026).
        const order = consultaOrder.order as Record<string, unknown>;
        const statusRaiz = String(order.status ?? "");
        const statusDetailRaiz = String(order.status_detail ?? "");
        statusMapeado = mapearStatusOrder(statusRaiz, statusDetailRaiz);
        statusBrutoParaLog = `${statusRaiz}:${statusDetailRaiz}`;
        valorAprovado = extrairValorDaOrder(order);
      }

      // Usa o status que o MP DEVOLVEU, nunca inventa um. Status
      // desconhecido não é falha — é o mesmo "não decide sozinho" do
      // webhook: fica para o próximo ciclo de reconciliação. Mas "não
      // decide" não é "não conta": entra em ignorados (não confirmou, não é
      // falha), para o corpo continuar auditável sem abrir o log.
      if (statusMapeado === null) {
        console.warn(
          "reconciliar-pagamentos: status desconhecido do MP",
          candidato.order_id,
          statusBrutoParaLog,
        );
        ignorados++;
        continue;
      }

      // Armadilha 2 do brief: 'expirado' só a Orders API produz (o clássico
      // nunca mapeia para ele, ver mapearStatus), e a RPC confirmar_pagamento
      // não tem ramo para esse valor (20260810000000_confirmar_pagamento_
      // guarda_status.sql) — cairia no RETURN 'ignorado' do fim do jeito
      // errado, indistinguível no log de um 'ignorado' que passou pela RPC
      // de verdade. Filtra ANTES de chamar a RPC, com rótulo próprio, e
      // conta em ignorados — sem inventar tratamento novo na RPC (migration
      // não é desta tarefa).
      if (statusMapeado === "expirado") {
        console.warn(
          "reconciliar-pagamentos: order expirada no MP — não chama confirmar_pagamento (RPC não trata 'expirado')",
          candidato.order_id,
        );
        ignorados++;
        continue;
      }

      // CONFERÊNCIA DE VALOR (laudo caça-bugs 31/08, achado A3 + ressalva 1
      // da revisão do PR #366): a reconciliação atinge PEDIDO VIVO
      // ('aguardando' + 'pending', migration 20261010000000) — sem esta
      // porta, um pagamento divergente recusado pelo webhook era confirmado
      // AQUI depois, por status, sem ninguém olhar o valor: a dobradiça do
      // outro lado da porta que o webhook fechou. Mesma tolerância, mesma
      // fonte (resposta autenticada do MP), mesmo "valor ausente = warn e
      // segue" do webhook — regra em um lugar só (`_shared/mercadopago.ts`).
      //
      // Divergente: NÃO chama a RPC e entra em ignorados — o candidato fica
      // na fila (reconcilia de novo no próximo ciclo) e o dinheiro divergente
      // cabe ao lojista resolver no painel do MP. Log error, no padrão dos
      // 'divergente'/'inexistente' da RPC.
      if (statusMapeado === "pago" || statusMapeado === "pago_apos_expirar") {
        const { data: linhaDoPedido, error: erroLeituraTotal } = await supabase
          .from("marketplace_orders")
          .select("total, total_amount")
          .eq("id", candidato.order_id)
          .maybeSingle();
        if (erroLeituraTotal) throw erroLeituraTotal;

        const brutoTotal =
          (linhaDoPedido as Record<string, unknown> | null)?.total ??
          (linhaDoPedido as Record<string, unknown> | null)?.total_amount;
        const totalDoPedido = typeof brutoTotal === "number" ? brutoTotal : Number(brutoTotal);

        if (linhaDoPedido && typeof valorAprovado === "number") {
          if (
            Number.isFinite(totalDoPedido) &&
            Math.abs(valorAprovado - totalDoPedido) > TOLERANCIA_DE_VALOR
          ) {
            console.error(
              "reconciliar-pagamentos: VALOR aprovado diverge do total do pedido — candidato NÃO confirmado; conferir no painel do MP",
              {
                order_id: candidato.order_id,
                gateway_payment_id: candidato.gateway_payment_id,
                valorAprovado,
                totalDoPedido,
              },
            );
            ignorados++;
            continue;
          }
        } else if (linhaDoPedido && valorAprovado === undefined) {
          console.warn(
            "reconciliar-pagamentos: valor aprovado não veio na resposta do MP — conferência de valor não rodou",
            candidato.order_id,
          );
        }
      }

      // A RPC é quem decide 'pago' vs 'pago_apos_expirar' (e idempotência,
      // sob FOR UPDATE) — esta função só repassa o status mapeado. Mas ler o
      // texto que ela DEVOLVEU para contar não é decidir nada: "não decide"
      // é sobre a transição de estado, não sobre a contagem. Sem isto, 3 PIX
      // expirados que ninguém pagou (MP ainda diz 'pending' → RPC cai no
      // RETURN 'ignorado' por default, sem erro) viravam "3 confirmados".
      //
      // p_payment_id sai da MESMA linha do banco (candidato.gateway_payment_id),
      // nunca do id que a resposta do MP devolveu — igual ao caminho clássico
      // já fazia (armadilha 4 do brief). É isto que torna 'divergente' quase
      // impossível aqui, ao contrário do webhook.
      const { data: resultadoRpc, error: erroRpc } = await supabase.rpc("confirmar_pagamento", {
        p_order_id: candidato.order_id,
        p_payment_id: candidato.gateway_payment_id,
        p_status: statusMapeado,
      });
      if (erroRpc) throw erroRpc;

      // Os MESMOS dois valores que webhook-mercadopago/index.ts usa para
      // decidir o push (linha ~302) — divergir os dois critérios é a doença
      // do #53 de novo.
      const resultado = resultadoRpc as string;
      if (resultado === "pago" || resultado === "pago_apos_expirar") {
        confirmados++;
      } else {
        // 'divergente' e 'inexistente' significam que o candidato não bate
        // com o pedido — ninguém deveria descobrir isso só pela contagem.
        if (resultado === "divergente" || resultado === "inexistente") {
          console.warn(
            "reconciliar-pagamentos: candidato não bate com o pedido",
            candidato.order_id,
            resultado,
          );
        }
        ignorados++;
      }
    } catch (erro) {
      console.error("reconciliar-pagamentos: falha ao processar candidato", candidato.order_id, erro);
      falhas++;
    }
  }

  // ─── PASSO NOVO (Task 4, frente "estorno pelo app"): processa a fila de
  // `order_refunds` pendentes — o cron pega tudo que a edge do clique do
  // lojista (T3) ou o cancelamento automático (T1) deixaram para trás. TRY
  // PRÓPRIO envolvendo o passo inteiro: uma falha aqui (ex.: a query da
  // fila) não pode apagar o resultado da reconciliação de PAGAMENTOS acima,
  // que já rodou.
  let refundsVistos = 0;
  let refundsConcluidos = 0;
  let refundsAdiados = 0;
  let refundsFalhos = 0;

  try {
    // Janela de 2 minutos (brief da T4): evita disputar com a edge do
    // clique, que pode estar processando a MESMA linha agora mesmo.
    const doisMinutosAtras = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const { data: refundsPendentes, error: erroRefunds } = await supabase
      .from("order_refunds")
      .select("id, order_id, amount, status, tentativas, mp_refund_id")
      .in("status", ["solicitado", "em_processamento"])
      .lt("updated_at", doisMinutosAtras)
      .order("created_at", { ascending: true })
      .limit(20);
    if (erroRefunds) throw erroRefunds;

    const mpToken = Deno.env.get("MP_ACCESS_TOKEN") ?? "";
    // Mesmo timeout de 15s de toda chamada ao MP (Restrições globais) — o
    // `buscar` injetado pelos testes (`deps.fetchImpl`) nunca vê o `fetch`
    // cru por fora deste envelope, igual à edge do clique (T3).
    const buscarEstorno: typeof fetch = (input, init) =>
      fetchComTempo(
        deps.fetchImpl ?? fetch,
        input instanceof Request ? input.url : String(input),
        init,
      );

    for (const refund of refundsPendentes ?? []) {
      refundsVistos++;
      // Cada linha no seu próprio try: a reconciliação de estornos existe
      // para pegar o que já falhou uma vez — um item não pode custar a vez
      // do seguinte (mesma defesa do laço de pagamentos acima).
      try {
        // I-B (laudo do PR #438 rodada 2): releitura FRESCA do pedido,
        // DENTRO do laço, por item — NUNCA um SELECT único antes do laço.
        // Duas linhas do mesmo pedido no mesmo lote com um snapshot só
        // fariam a segunda concluir sem o dinheiro dela ter saído do MP.
        const { data: pedidoRow, error: erroPedido } = await supabase
          .from("marketplace_orders")
          .select(
            "id, gateway_payment_id, total, valor_estornado, payment_status, paid_at, status",
          )
          .eq("id", refund.order_id)
          .maybeSingle();
        if (erroPedido) throw erroPedido;
        if (!pedidoRow) {
          console.error(
            "reconciliar-pagamentos: pedido da devolução não encontrado",
            refund.id,
            refund.order_id,
          );
          refundsFalhos++;
          continue;
        }

        const pedido: PedidoParaEstorno = {
          id: String((pedidoRow as Record<string, unknown>).id),
          gateway_payment_id: String(
            (pedidoRow as Record<string, unknown>).gateway_payment_id ?? "",
          ),
          total: Number((pedidoRow as Record<string, unknown>).total),
          valor_estornado: Number(
            (pedidoRow as Record<string, unknown>).valor_estornado ?? 0,
          ),
          payment_status:
            (pedidoRow as Record<string, unknown>).payment_status as string | null,
          paid_at: (pedidoRow as Record<string, unknown>).paid_at as string | null,
          status: String((pedidoRow as Record<string, unknown>).status),
        };

        if (refund.status === "solicitado") {
          // A MARCA — mesmo UPDATE condicional da edge do clique (T3): se 0
          // linhas voltarem, o clique do lojista já pegou esta linha.
          const { data: marcada, error: erroMarca } = await supabase
            .from("order_refunds")
            .update({
              status: "em_processamento",
              tentativas: Number(refund.tentativas ?? 0) + 1,
              updated_at: new Date().toISOString(),
            })
            .eq("id", refund.id)
            .in("status", ["solicitado"])
            .select();
          if (erroMarca) throw erroMarca;
          if (!Array.isArray(marcada) || marcada.length === 0) {
            refundsAdiados++;
            continue;
          }

          const linha: LinhaEstorno = {
            id: String(refund.id),
            order_id: String(refund.order_id),
            amount: Number(refund.amount),
            status: "em_processamento",
            mp_refund_id: (refund.mp_refund_id as string | null) ?? null,
            tentativas: Number(refund.tentativas ?? 0) + 1,
          };
          const resultado = await executarEstorno({
            linha,
            pedido,
            token: mpToken,
            buscar: buscarEstorno,
          });
          const desfecho = await gravarDesfechoDoEstorno(supabase, String(refund.id), resultado);
          if (desfecho === "concluido") refundsConcluidos++;
          else if (desfecho === "adiado") refundsAdiados++;
          else refundsFalhos++;
          continue;
        }

        // refund.status === "em_processamento": a MARCA de "já pedi ao MP
        // com esta chave" — o cron NUNCA cria chave nova aqui. PRIMEIRO
        // consulta (sem POST); só repete o POST se a consulta não esclarecer.
        const linhaAtual: LinhaEstorno = {
          id: String(refund.id),
          order_id: String(refund.order_id),
          amount: Number(refund.amount),
          status: "em_processamento",
          mp_refund_id: (refund.mp_refund_id as string | null) ?? null,
          tentativas: Number(refund.tentativas ?? 0),
        };
        const confirmacao = await confirmarPorConsulta({
          buscar: buscarEstorno,
          token: mpToken,
          linha: linhaAtual,
          pedido,
        });

        if (confirmacao.tipo === "concluido") {
          const desfecho = await gravarDesfechoDoEstorno(supabase, String(refund.id), confirmacao);
          if (desfecho === "concluido") refundsConcluidos++;
          else if (desfecho === "adiado") refundsAdiados++;
          else refundsFalhos++;
          continue;
        }

        // Não confirmou (a alternativa B do I-A garante que o caminho
        // DIRETO desta função nunca devolve `falhou` por "ainda não
        // apareceu" — só `concluido` ou `tentar_depois`).
        const tentativasAtuais = Number(refund.tentativas ?? 0);
        if (tentativasAtuais >= 5) {
          const { error: erroLimite } = await supabase
            .from("order_refunds")
            .update({
              status: "falhou",
              ultimo_erro: TEXTO_LIMITE_DE_TENTATIVAS,
              updated_at: new Date().toISOString(),
            })
            .eq("id", refund.id)
            .in("status", ["em_processamento"]);
          if (erroLimite) {
            console.error(
              "reconciliar-pagamentos: falha ao gravar o limite de tentativas",
              refund.id,
              erroLimite,
            );
          }
          refundsFalhos++;
          continue;
        }

        // Marca a NOVA tentativa ANTES do POST: se o processo cair no meio,
        // a contagem já reflete que houve uma chamada — nunca reprocessa a
        // mesma tentativa como se fosse a primeira.
        const { error: erroTentativa } = await supabase
          .from("order_refunds")
          .update({
            tentativas: tentativasAtuais + 1,
            updated_at: new Date().toISOString(),
          })
          .eq("id", refund.id)
          .in("status", ["em_processamento"]);
        if (erroTentativa) throw erroTentativa;

        const resultadoRetry = await executarEstorno({
          linha: { ...linhaAtual, tentativas: tentativasAtuais + 1 },
          pedido,
          token: mpToken,
          buscar: buscarEstorno,
        });
        const desfechoRetry = await gravarDesfechoDoEstorno(
          supabase,
          String(refund.id),
          resultadoRetry,
        );
        if (desfechoRetry === "concluido") refundsConcluidos++;
        else if (desfechoRetry === "adiado") refundsAdiados++;
        else refundsFalhos++;
      } catch (erro) {
        console.error(
          "reconciliar-pagamentos: falha ao processar devolução",
          refund.id,
          erro,
        );
        refundsFalhos++;
      }
    }
  } catch (erro) {
    console.error("reconciliar-pagamentos: varredura de devoluções pendentes falhou", erro);
  }

  // Contagem verdadeira: responder sucesso sem verificar nada é como este
  // projeto passou meses achando que o push funcionava (#80). `ok` continua
  // `true` mesmo com falhas — decisão da sessão principal, pendência
  // separada desta rodada.
  //
  // INVARIANTE (não quebrar): confirmados + ignorados + falhas === verificados.
  // Todo `continue` e todo fim de iteração do loop acima incrementa
  // exatamente um dos três — inclusive o status que o MP devolve fora do
  // mapa (ignorados), o 404 nos dois endpoints (falhas) e a order 'expirado'
  // que a Tarefa 4 passou a filtrar ANTES da RPC (ignorados, sem chamá-la).
  // Sem essa invariante o corpo não é auditável sem abrir o log: um
  // candidato "sumiria" do total.
  return json(
    {
      ok: true,
      verificados,
      confirmados,
      ignorados,
      falhas,
      estornos: {
        vistos: refundsVistos,
        concluidos: refundsConcluidos,
        adiados: refundsAdiados,
        falhos: refundsFalhos,
      },
    },
    200,
  );
}

// O guard do runner de teste é COPIADO de webhook-mercadopago/index.ts: sem
// ele, `npm run test:edge` importa este módulo e sobe um servidor HTTP no
// meio da suíte.
const emTeste =
  Deno.mainModule.endsWith("_test.ts") ||
  Deno.mainModule.endsWith("_test.js") ||
  Deno.mainModule.includes("index_test");

if (!emTeste) serve((req) => handler(req));

export { handler };
