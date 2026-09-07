// ============================================================================
// Edge function estornar-pagamento — Task 3 da frente "estorno de dinheiro
// pelo app" (plano 20260907).
//
// O CLIQUE DO LOJISTA em "Devolver dinheiro": recebe o refund_id da linha de
// order_refunds (nascida pela RPC de cancelamento ou por solicitar_estorno,
// Task 1), MARCA a linha ANTES de chamar o Mercado Pago, executa pelo
// executor único da Task 2 e grava o resultado.
//
// DINHEIRO — as proteções desta function:
//   * Admin-only: JWT do lojista validado com anon key e papel sobe por
//     profiles com service role (MESMA cópia do verifyIsAdmin do
//     melhor-envio-etiqueta/calculate-shipping). Não-admin não lê NADA.
//   * A MARCA ANTES DO MP: `UPDATE order_refunds SET
//     status='em_processamento', tentativas=tentativas+1 WHERE id=$1 AND
//     status IN ('solicitado','em_processamento')`. Se 0 linhas voltaram,
//     outro executor (cron/webhook/clique paralelo) mudou a linha no meio —
//     409 sem chamar o MP. E' o mesmo update condicional do cron (Task 4) —
//     UM desenho, dois chamadores.
//   * A CHAVE DE IDEMPOTÊNCIA é o order_refunds.id (linha.id), SEMPRE —
//     quem monta o header é o executor (Task 2); esta function só garante
//     que a linha certa (o id certo) chega a ele.
//   * A CONCLUSÃO É ATÔMICA pela RPC concluir_estorno (migration
//     2026110000100): status da linha + soma de valor_estornado +
//     virada condicional de payment_status numa transação só — a edge NUNCA
//     soma valor_estornado na mão. A mesma RPC serve ao cron (T4) e ao
//     webhook (T5). No banco a RPC NÃO tem grant a authenticated (régua
//     confirmar_pagamento, laudo C1 do PR #439): esta edge chama com
//     SERVICE ROLE — a autorização do clique do lojista é AQUI (porta de
//     admin acima), não no banco.
//   * MP_ACCESS_TOKEN só via Deno.env; SEM token a function falha ANTES de
//     marcar a linha (nada fica preso em_processamento por falta de
//     configuração). Nunca se decide NADA de dinheiro pelo prefixo do token.
//   * Timeout: o buscar entregue ao executor já embute o fetchComTempo de
//     15 s (padrão da casa) — o executor pode ter o seu, e o de fora é o
//     freio garantido.
//
// ANTI-COLISÃO COM A TASK 2: o executor (_shared/estorno.ts) nasce em
// paralelo nesta frente. Esta function codifica contra a INTERFACE
// documentada no plano (LinhaEstorno/PedidoParaEstorno/ResultadoEstorno,
// redefinidas localmente abaixo) e só carrega o módulo DEPOIS que uma
// chamada passa pelas portas — `await import` dinâmico, injetável via
// deps.executarEstorno. Os testes (index_test.ts) sempre injetam o dublê
// (Restrição Global: nenhuma chamada real ao MP em teste); a integração com
// o módulo de verdade é validada pelo CI quando os PRs da T2 e da T3 se
// encontram.
// ============================================================================
import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { fetchComTempo } from "../_shared/mercadopago.ts"

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ── Interface do executor (Task 2, plano 20260907 — cópia FIEL da
// documentada; a fonte viva é _shared/estorno.ts quando a T2 chegar) ──────

export type LinhaEstorno = {
    id: string
    order_id: string
    amount: number
    status: 'solicitado' | 'em_processamento' | 'concluido' | 'falhou' | 'recusado'
    mp_refund_id: string | null
    tentativas: number
}

export type PedidoParaEstorno = {
    id: string
    gateway_payment_id: string
    total: number
    valor_estornado: number
    payment_status: string | null
    paid_at: string | null
    status: string
}

export type ResultadoEstorno =
    | { tipo: 'concluido'; mp_refund_id: string; mp_status: string; mp_status_detail: string | null; valor: number }
    | { tipo: 'em_processamento'; mp_refund_id: string | null; mp_status: string }
    | { tipo: 'falhou'; motivo: string; codigo: string }
    | { tipo: 'recusado'; motivo: string }
    | { tipo: 'tentar_depois'; motivo: string; retryAfterS?: number }

export type ExecutorEstorno = (args: {
    linha: LinhaEstorno
    pedido: PedidoParaEstorno
    token: string
    buscar?: typeof fetch
}) => Promise<ResultadoEstorno>

/** Texto EXATO do plano (T3) para 202 — o lojista sabe quem confere e quando. */
const TEXTO_EM_PROCESSAMENTO = 'O Mercado Pago ainda está processando; eu confiro de novo em até 10 minutos.'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const json = (corpo: unknown, status: number): Response =>
    new Response(JSON.stringify(corpo), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

/**
 * O projeto está migrando das chaves legados para as novas
 * (publishable/secret). MESMA cópia do melhor-envio-etiqueta: lê a nova e
 * cai para a legada.
 */
function readKey(newVar: string, legacyVar: string): string {
    try {
        const parsed = JSON.parse(Deno.env.get(newVar) ?? '{}')
        if (parsed?.default) return parsed.default
    } catch {
        // variável ausente ou JSON inválido — segue para o fallback
    }
    return Deno.env.get(legacyVar) ?? ''
}

/**
 * Verifica se quem chamou é admin. MESMA cópia do padrão
 * melhor-envio-etiqueta/calculate-shipping: valida o JWT com o anon key e
 * sobe o papel de `profiles` com service role.
 */
async function verifyIsAdmin(
    authHeader: string | null,
    supabaseUrl: string,
    serviceRoleKey: string,
): Promise<boolean> {
    if (!authHeader) return false
    try {
        const anonKey = readKey('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY')
        const userClient = createClient(supabaseUrl, anonKey, {
            global: { headers: { Authorization: authHeader } },
        })
        const { data: { user }, error: userError } = await userClient.auth.getUser()
        if (userError || !user) return false
        const systemClient = createClient(supabaseUrl, serviceRoleKey)
        const { data: profile, error: profileError } = await systemClient
            .from('profiles')
            .select('role')
            .eq('id', user.id)
            .single()
        if (profileError || !profile) return false
        return profile.role === 'admin'
    } catch (err) {
        console.error('[estornar-pagamento] Falha no check de admin:', err)
        return false
    }
}

/**
 * Costura de teste (padrão da casa): cliente do Supabase, fetch e executor
 * injetáveis. Em produção nada muda.
 */
export type EstornoDeps = {
    supabase?: any
    buscar?: typeof fetch
    executarEstorno?: ExecutorEstorno
}

export async function handler(req: Request, deps: EstornoDeps = {}): Promise<Response> {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }
    if (req.method !== 'POST') {
        return json({ erro: 'Use POST com { refund_id }.' }, 405)
    }

    let body: { refund_id?: unknown }
    try {
        body = await req.json()
    } catch {
        return json({ erro: 'Corpo inválido: esperado JSON { refund_id }.' }, 400)
    }

    const refundId = typeof body.refund_id === 'string' ? body.refund_id.trim() : ''
    if (!UUID_RE.test(refundId)) {
        return json({ erro: 'refund_id inválido: esperado o id (uuid) da devolução.' }, 400)
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const serviceRoleKey = readKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY')

    // Porta de admin ANTES de qualquer leitura/escrita — dinheiro.
    const authHeader = req.headers.get('Authorization')
    const isAdmin = await verifyIsAdmin(authHeader, supabaseUrl, serviceRoleKey)
    if (!isAdmin) {
        return json({ erro: 'Não autorizado: apenas administradores devolvem dinheiro pelo painel.' }, 401)
    }

    const supabase = deps.supabase ?? createClient(supabaseUrl, serviceRoleKey)

    try {
        // 1. A linha do ledger (service role: RLS de order_refunds não cobre
        //    a edge, e a porta de admin já filtreou quem chegou até aqui).
        const { data: linha, error: erroLinha } = await supabase
            .from('order_refunds')
            .select('id, order_id, amount, status, mp_refund_id, tentativas')
            .eq('id', refundId)
            .maybeSingle()
        if (erroLinha) {
            console.error('[estornar-pagamento] Erro ao ler a linha:', erroLinha)
            return json({ erro: 'Não consegui ler a devolução agora. Tente novamente em instantes.' }, 500)
        }
        if (!linha) {
            return json({ erro: 'Devolução não encontrada.' }, 404)
        }

        // 2. Só linha VIVA é executável: concluido/falhou/recusado são
        //    passado (o botão da T6 nem aparece; aqui é a defesa de baixo).
        if (linha.status !== 'solicitado' && linha.status !== 'em_processamento') {
            return json({ erro: 'estorno_ja_tratado', status: linha.status }, 409)
        }

        // 3. O pedido da linha (o executor valida pagamento/prazo/saldo).
        const { data: pedido, error: erroPedido } = await supabase
            .from('marketplace_orders')
            .select('id, gateway_payment_id, total, valor_estornado, payment_status, paid_at, status')
            .eq('id', linha.order_id)
            .maybeSingle()
        if (erroPedido || !pedido) {
            console.error('[estornar-pagamento] Pedido da devolução não carregou:', erroPedido ?? linha.order_id)
            return json({ erro: 'Não consegui ler o pedido desta devolução agora. Tente novamente em instantes.' }, 500)
        }

        // 4. Token do MP ANTES da marca: sem token não há execução — e uma
        //    linha marcada em_processamento sem chamada é fila parada à toa
        //    (o cron recuperaria em 2 min, mas não há por que marcar).
        const token = Deno.env.get('MP_ACCESS_TOKEN') ?? ''
        if (!token) {
            console.error('[estornar-pagamento] MP_ACCESS_TOKEN ausente no ambiente da function.')
            return json(
                { erro: 'A devolução não pôde ser iniciada agora (integração com o Mercado Pago sem credencial). Tente novamente em instantes; se persistir, contate o suporte.' },
                500,
            )
        }

        // 5. A MARCA — antes do MP, update CONDICIONAL. `tentativas` usa o
        //    valor lido +1 (a API de update não exprime `tentativas+1` em
        //    SQL): numa corrida de duas execuções a contagem pode perder 1
        //    ponto — `tentativas` é MÉTRICA de fila (teto do cron na T4), o
        //    dinheiro é protegido pela chave de idempotência, não por ela.
        const { data: marcada, error: erroMarca } = await supabase
            .from('order_refunds')
            .update({
                status: 'em_processamento',
                tentativas: Number(linha.tentativas ?? 0) + 1,
                updated_at: new Date().toISOString(),
            })
            .eq('id', refundId)
            .in('status', ['solicitado', 'em_processamento'])
            .select()
        if (erroMarca) {
            console.error('[estornar-pagamento] Erro ao marcar a linha:', erroMarca)
            return json({ erro: 'Não consegui marcar a devolução agora. Tente novamente em instantes.' }, 500)
        }
        if (!Array.isArray(marcada) || marcada.length === 0) {
            // 0 linhas: entre o carregamento e a marca, outro executor mudou
            // o estado (cron, webhook, clique paralelo) — NÃO chama o MP.
            return json({ erro: 'estorno_em_execucao' }, 409)
        }

        // 6. O executor único (Task 2). O buscar entregue JÁ tem o corte de
        //    15 s do fetchComTempo — o freio vale mesmo se o executor
        //    confiar no fetch cru.
        const executar = deps.executarEstorno
            ?? (await import('../_shared/estorno.ts')).executarEstorno
        const resultado = await executar({
            linha: {
                id: linha.id,
                order_id: linha.order_id,
                amount: Number(linha.amount),
                status: 'em_processamento',
                mp_refund_id: linha.mp_refund_id ?? null,
                tentativas: Number(linha.tentativas ?? 0) + 1,
            },
            pedido: {
                id: pedido.id,
                gateway_payment_id: pedido.gateway_payment_id,
                total: Number(pedido.total),
                valor_estornado: Number(pedido.valor_estornado ?? 0),
                payment_status: pedido.payment_status ?? null,
                paid_at: pedido.paid_at ?? null,
                status: pedido.status,
            },
            token,
            // Assinatura LARGA (URL | RequestInfo, a mesma de typeof fetch):
            // o executor da Task 2 declara buscar?: typeof fetch, e uma
            // lambda de (url: string) não é atribuível a ele — o deno check
            // da integração real (I3 do laudo) pegou exatamente isto. O
            // fetchComTempo quer string: Request vira .url, URL/string
            // viram String(input).
            buscar: (input: URL | RequestInfo, init?: RequestInit) =>
                fetchComTempo(
                    deps.buscar ?? fetch,
                    input instanceof Request ? input.url : String(input),
                    init,
                ),
        })

        // 7. O resultado vira estado + resposta. Nenhum texto carrega
        //    mp_refund_id ou jargão (Restrição Global); valor é NÚMERO cru —
        //    quem formata em R$ é o front (M4 do PR #436).
        if (resultado.tipo === 'concluido') {
            const { data: concluida, error: erroConcluir } = await supabase
                .rpc('concluir_estorno', {
                    p_refund_id: refundId,
                    p_mp_refund_id: resultado.mp_refund_id,
                    p_mp_status: resultado.mp_status,
                    p_mp_status_detail: resultado.mp_status_detail,
                })
            if (erroConcluir) {
                // O MP confirmou — a linha fica em_processamento e o
                // cron/webhook completam pela MESMA RPC (idempotente, P13).
                // Mentir "concluído" sem gravação é pior que admitir "ainda
                // não terminei de registrar".
                console.error('[estornar-pagamento] concluir_estorno falhou (cron completa):', erroConcluir)
                return json({ status: 'em_processamento', texto: TEXTO_EM_PROCESSAMENTO }, 202)
            }
            const valor = Number(resultado.valor ?? linha.amount)
            return json({
                status: 'concluido',
                valor,
                texto: 'A devolução foi concluída: o Mercado Pago confirmou e o dinheiro volta para o cliente — PIX cai na conta dele; cartão aparece como crédito na fatura.',
                // Diagnóstico interno da RPC (valor_estornado/payment_status
                // do pedido) — sem id do MP.
                payment_status: concluida?.payment_status ?? null,
            }, 200)
        }

        if (resultado.tipo === 'em_processamento') {
            // O MP ficou de processar (PIX em contingência é 201 in_process):
            // a linha JÁ está marcada; grava só o diagnóstico. CONDICIONAL
            // (M1-resto do laudo do PR #439): na era T4/T5 o webhook pode
            // concluir a linha no meio (RPC concluir_estorno) — sem o .in,
            // esta escrita de diagnóstico sobrescreveria mp_status de uma
            // linha já concluída. Sem asserção de linhas (é diagnóstico,
            // não dinheiro): 0 linhas afetadas é silenciosamente aceitável.
            const { error: erroDiag } = await supabase
                .from('order_refunds')
                .update({
                    mp_refund_id: resultado.mp_refund_id ?? undefined,
                    mp_status: resultado.mp_status,
                    updated_at: new Date().toISOString(),
                })
                .eq('id', refundId)
                .in('status', ['em_processamento'])
            if (erroDiag) console.error('[estornar-pagamento] Falha ao gravar diagnóstico do MP (suave):', erroDiag)
            return json({ status: 'em_processamento', texto: TEXTO_EM_PROCESSAMENTO }, 202)
        }

        if (resultado.tipo === 'tentar_depois') {
            // 429/5xx/rede: NÃO é falha definitiva. Mantém em_processamento
            // com o erro registrado — o cron (T4) repete com a MESMA chave.
            // Mesma condição do ramo acima (M1-resto): o webhook pode ter
            // concluído a linha no meio, e sem o .in este UPDATE gravaria
            // ultimo_erro numa linha já concluída.
            const { error: erroAdio } = await supabase
                .from('order_refunds')
                .update({
                    ultimo_erro: resultado.motivo,
                    updated_at: new Date().toISOString(),
                })
                .eq('id', refundId)
                .in('status', ['em_processamento'])
            if (erroAdio) console.error('[estornar-pagamento] Falha ao gravar o adiamento (suave):', erroAdio)
            return json({ status: 'em_processamento', texto: TEXTO_EM_PROCESSAMENTO }, 202)
        }

        if (resultado.tipo === 'falhou' || resultado.tipo === 'recusado') {
            // Definitivo: guarda o estado e o motivo leigo (a T6 mostra o
            // botão "Tentar de novo" só para falhou — nova linha, nova chave).
            // O update é CONDICIONAL como a MARCA (M1 do laudo do PR #439):
            // estado terminal só substitui 'em_processamento' — se a T4/T5
            // concluiu no meio, 0 linhas voltam e NADA é sobrescrito.
            const { data: fim, error: erroFim } = await supabase
                .from('order_refunds')
                .update({
                    status: resultado.tipo,
                    ultimo_erro: resultado.motivo,
                    updated_at: new Date().toISOString(),
                })
                .eq('id', refundId)
                .in('status', ['em_processamento'])
                .select()
            if (erroFim) {
                console.error('[estornar-pagamento] Falha ao gravar o desfecho:', erroFim)
                return json({ erro: 'A devolução terminou, mas o registro falhou. Atualize a página para ver o estado real.' }, 500)
            }
            if (!Array.isArray(fim) || fim.length === 0) {
                // Outro executor (cron/webhook) mudou a linha no meio: o
                // estado terminal DELE fica — responder o real, não o nosso.
                // Unifica o formato com o 409 de cima (passo 2, {erro, status}
                // — anotado no laudo do PR #439): uma releitura rápida diz
                // qual é esse estado real (a T6 consome o campo).
                const { data: linhaAtual } = await supabase
                    .from('order_refunds')
                    .select('status')
                    .eq('id', refundId)
                    .maybeSingle()
                return json({ erro: 'estorno_ja_tratado', status: linhaAtual?.status ?? null }, 409)
            }
            const valor = Number(linha.amount)
            return json({
                status: resultado.tipo,
                valor,
                texto: resultado.tipo === 'falhou'
                    ? `A devolução não foi concluída: ${resultado.motivo}`
                    : `A devolução não foi feita: ${resultado.motivo}`,
            }, 200)
        }

        // Resultado fora da união tipada — executor novo com forma nova:
        // falha alto, nunca silenciosamente "ok".
        console.error('[estornar-pagamento] Resultado desconhecido do executor:', resultado)
        return json({ erro: 'Resposta inesperada do executor da devolução.' }, 500)
    } catch (err) {
        console.error('[estornar-pagamento] Erro de topo:', err)
        return json({ erro: 'Não foi possível processar a devolução agora. Tente novamente em instantes.' }, 500)
    }
}

// `(req) => handler(req)`, e não `serve(handler)` direto: o `serve` do std
// passa um segundo argumento (ConnInfo) que cairia em `deps`.
const isTesting = Deno.mainModule.endsWith('_test.ts') || Deno.mainModule.endsWith('_test.js') || Deno.mainModule.includes('index_test')
if (!isTesting) serve((req: Request) => handler(req))
