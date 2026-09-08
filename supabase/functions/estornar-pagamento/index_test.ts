// @ts-nocheck
// Testes da edge estornar-pagamento — Task 3 da frente "estorno de dinheiro
// pelo app" (plano 20260907). Padrão da casa (melhor-envio-etiqueta /
// calculate-shipping): handler exportado com costura de deps, NENHUMA rede
// real — o executor da Task 2 é DUBLÊ aqui (a Restrição Global veda chamada
// real ao MP em teste; a integração com o `_shared/estorno.ts` de verdade é
// validada pelo CI quando os PRs da T2 e da T3 se encontram).
//
// Afirmativas nomeadas (plano T3 Step 1):
//   F1  sem JWT -> 401
//   F2  JWT de cliente comum -> 401
//   F3  refund_id inexistente -> 404
//   F4  linha concluida -> 409 sem chamar o executor (nem MP)
//   F5  fluxo feliz (Payments, total) -> linha concluida via RPC
//       concluir_estorno, resposta {status, valor, texto} SEM mp_refund_id
//   F6  parcial -> resposta com o valor parcial; a RPC decide o resto
//   F7  in_process -> 202 com o texto exato do plano, linha em_processamento
//   F8  429/tentar_depois -> 202, ultimo_erro gravado, tentativas=1 na marca
//   F9  duas chamadas, a segunda perde a marca (0 linhas) -> 409 e UMA só
//       chamada ao fetch do MP
//   F10 X-Idempotency-Key recebido pelo fetch == refund_id (a chave é o id
//       da linha, nunca um id inventado aqui)
//   F11 desfecho terminal recusado/falhou grava estado+motivo com update
//       CONDICIONAL (só 'em_processamento') — e 0 linhas no desfecho
//       responde 409 estorno_ja_tratado (M1/M2 do laudo do PR #439)
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts"

// ── Costura de REDE para a porta de admin (verifyIsAdmin monta os PRÓPRIOS
// clients do supabase-js — a costura deps não os cobre). Mesma estratégia do
// melhor-envio-etiqueta: patch de globalThis.fetch ANTES do import dinâmico
// (o supabase-js captura a referência de fetch no carregamento) e reinstala
// o patch SÓ durante cada chamada de handler que passa pela porta.
const fetchNativo = globalThis.fetch

const URL_SUPA_TESTE = "https://supa-fake.local"
const ID_ADMIN = "admin-1111-2222"
const ID_CLIENTE = "cliente-3333-4444"
const REFUND_ID = "11111111-1111-4111-8111-111111111111"
const TEXTO_202 = "O Mercado Pago ainda está processando; eu confiro de novo em até 10 minutos."

function respostaAdminFalsa(): Response {
    return new Response(
        JSON.stringify({ id: ID_ADMIN, email: "admin@teste.local", aud: "authenticated", role: "authenticated" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
    )
}

const fetchAdminFalso = ((input: any) => {
    const url = String(input instanceof Request ? input.url : input)
    if (url.includes("/auth/v1/user")) return respostaAdminFalsa()
    if (url.includes("/rest/v1/profiles")) {
        return new Response(
            JSON.stringify({ id: ID_ADMIN, role: "admin" }),
            { status: 200, headers: { "Content-Type": "application/json" } },
        )
    }
    return new Response(JSON.stringify({ message: "fora do roteiro" }), { status: 404 })
}) as any

const fetchClienteFalso = ((input: any) => {
    const url = String(input instanceof Request ? input.url : input)
    if (url.includes("/auth/v1/user")) {
        return new Response(
            JSON.stringify({ id: ID_CLIENTE, email: "cliente@teste.local", aud: "authenticated", role: "authenticated" }),
            { status: 200, headers: { "Content-Type": "application/json" } },
        )
    }
    if (url.includes("/rest/v1/profiles")) {
        // profiles.role vivo: admin|gerente|vendedor|customer — o comum é customer.
        return new Response(
            JSON.stringify({ id: ID_CLIENTE, role: "customer" }),
            { status: 200, headers: { "Content-Type": "application/json" } },
        )
    }
    return new Response(JSON.stringify({ message: "fora do roteiro" }), { status: 404 })
}) as any

globalThis.fetch = fetchAdminFalso
const { handler } = await import("./index.ts")
globalThis.fetch = fetchNativo

async function comFetch(fetchFalso: any, executar: () => Promise<any>): Promise<any> {
    const anterior = globalThis.fetch
    globalThis.fetch = fetchFalso
    try {
        return await executar()
    } finally {
        globalThis.fetch = anterior
    }
}

/** Env que a porta de admin (e o token do MP) precisam ANTES de qualquer client. */
function prepararEnv(extra: Record<string, string> = {}): () => void {
    const pares: Array<[string, string]> = [
        ["SUPABASE_URL", URL_SUPA_TESTE],
        ["SUPABASE_PUBLISHABLE_KEYS", JSON.stringify({ default: "anon-de-teste" })],
        ["SUPABASE_SECRET_KEYS", JSON.stringify({ default: "service-role-de-teste" })],
        ["MP_ACCESS_TOKEN", "TEST-0000000000000000-000000"],
        ...Object.entries(extra),
    ]
    const anteriores = pares.map(([chave]) => [chave, Deno.env.get(chave)] as [string, string | undefined])
    for (const [chave, valor] of pares) Deno.env.set(chave, valor)
    // Sem sessão guardada, o getUser do supabase-js pode falhar ANTES da rede
    // ("session missing") — mesma semente do melhor-envio-etiqueta.
    try {
        const host = new URL(URL_SUPA_TESTE).hostname.split(".")[0]
        localStorage.setItem(
            `sb-${host}-auth-token`,
            JSON.stringify({
                access_token: "jwt-de-teste",
                refresh_token: "refresh-de-teste",
                token_type: "bearer",
                expires_in: 3600,
                expires_at: Math.floor(Date.now() / 1000) + 3600,
                user: { id: ID_ADMIN, email: "admin@teste.local", aud: "authenticated", role: "authenticated" },
            }),
        )
    } catch {
        // storage indisponível neste runner — o header global cobre
    }
    return () => {
        for (const [chave, valor] of anteriores) {
            if (valor === undefined) Deno.env.delete(chave)
            else Deno.env.set(chave, valor)
        }
    }
}

async function comEnv(extra: Record<string, string>, executar: () => Promise<void> | Promise<any>): Promise<any> {
    const restaurar = prepararEnv(extra)
    try {
        return await executar()
    } finally {
        restaurar()
    }
}

// ── Cliente Supabase falso (padrão melhor-envio: from() registra ação e
// filtros; o rpc() é o assento da RPC concluir_estorno — padrão
// reconciliar-pagamentos). A MARCA se reconhece por valores.status ===
// 'em_processamento': é o único update que a edge faz com esse status; o
// DESFECHO terminal (falhou/recusado) é o único com outro status.
function clienteSupaFalso(opts: {
    linha?: any
    linhaFinal?: any
    pedido?: any
    marcas?: number[]
    finais?: number[]
    rpcResultado?: any
    rpcErro?: any
} = {}) {
    const registro = {
        leiturasLinha: 0,
        leiturasPedido: 0,
        marcas: [] as any[],
        finais: [] as any[],
        atualizacoes: [] as any[],
        rpcs: [] as any[],
    }
    let chamadasDeMarca = 0
    let chamadasDeFim = 0
    const promessa = (valor: any) => Promise.resolve(valor)
    const cliente: any = {
        rpc(nome: string, args?: any) {
            registro.rpcs.push({ nome, args })
            return promessa({ data: opts.rpcResultado ?? { concluido: true }, error: opts.rpcErro ?? null })
        },
        from(tabela: string) {
            const no: any = { tabela, acao: null, valores: null, filtros: [] as any[] }
            const api: any = {
                select(_colunas?: string) {
                    return api
                },
                update(valores: any) {
                    no.acao = "update"
                    no.valores = valores
                    return api
                },
                eq(coluna: string, valor: any) {
                    no.filtros.push({ metodo: "eq", coluna, valor })
                    return api
                },
                in(coluna: string, valores: any) {
                    no.filtros.push({ metodo: "in", coluna, valores })
                    return api
                },
                maybeSingle() {
                    return api
                },
                single() {
                    return api
                },
                then(resolveu: any, rejeitou: any) {
                    return resolver(no).then(resolveu, rejeitou)
                },
            }
            return api
        },
    }
    function resolver(no: any) {
        if (no.tabela === "marketplace_orders") {
            registro.leiturasPedido++
            return promessa({ data: opts.pedido ?? null, error: null })
        }
        if (no.acao === null) {
            registro.leiturasLinha++
            // A 2a+ leitura simples (409 unificado do laudo do PR #439:
            // index.ts releu o status quando o UPDATE terminal perdeu a
            // linha) devolve linhaFinal se configurada — representa o que
            // o cron/webhook gravou no meio, não a linha original.
            if (registro.leiturasLinha > 1 && "linhaFinal" in opts) {
                return promessa({ data: opts.linhaFinal ?? null, error: null })
            }
            return promessa({ data: opts.linha ?? null, error: null })
        }
        if (no.acao === "update" && no.valores?.status === "em_processamento") {
            registro.marcas.push({ valores: no.valores, filtros: [...no.filtros] })
            // .at(i) em vez de [i]: a indexação dinâmica de objeto é o único
            // warning que o eslint viu nesta suíte (catraca do PR #439, C2a).
            const linhas = opts.marcas?.at(chamadasDeMarca) ?? 1
            chamadasDeMarca++
            const resposta = Array.from({ length: linhas }, () => ({ id: REFUND_ID }))
            return promessa({ data: resposta, error: null })
        }
        if (no.acao === "update" && (no.valores?.status === "falhou" || no.valores?.status === "recusado")) {
            registro.finais.push({ valores: no.valores, filtros: [...no.filtros] })
            const linhas = opts.finais?.at(chamadasDeFim) ?? 1
            chamadasDeFim++
            const resposta = Array.from({ length: linhas }, () => ({ id: REFUND_ID }))
            return promessa({ data: resposta, error: null })
        }
        registro.atualizacoes.push({ valores: no.valores, filtros: [...no.filtros] })
        return promessa({ data: null, error: null })
    }
    return { cliente, registro }
}

// ── Executor falso: registra os args, opcionalmente faz UMA chamada ao
// buscar recebido (o caminho real passa pelo MP — é onde F9/F10 contam e
// leem o header de idempotência) e devolve o resultado configurado.
function executorFalso(resultado: any, opts: { chamarMp?: boolean } = {}) {
    const registro = { chamadas: [] as any[] }
    const fn = async (args: any) => {
        registro.chamadas.push(args)
        if (opts.chamarMp && args.buscar) {
            await args.buscar("https://api.mercadopago.com/v1/payments/123456789/refunds", {
                method: "POST",
                headers: { "X-Idempotency-Key": args.linha.id, Authorization: `Bearer ${args.token}` },
                body: "{}",
            })
        }
        return resultado
    }
    return { fn, registro }
}

/** Fetch do MP falso: CONTA chamadas e guarda os headers (assento do F9/F10). */
function fetchMpFalso() {
    const registro = { chamadas: 0, headers: [] as any[] }
    const buscar = ((_input: any, init?: any) => {
        registro.chamadas++
        registro.headers.push(init?.headers ?? {})
        return Promise.resolve(
            new Response(JSON.stringify({ id: 111222333, status: "approved", amount: 100 }), {
                status: 201,
                headers: { "Content-Type": "application/json" },
            }),
        )
    }) as any
    return { buscar, registro }
}

// ── Cenário base ───────────────────────────────────────────────────────────

const LINHA_SOLICITADA = {
    id: REFUND_ID,
    order_id: "99999999-9999-4999-8999-999999999999",
    amount: 100,
    status: "solicitado",
    mp_refund_id: null,
    tentativas: 0,
}

const PEDIDO_PAGO = {
    id: "99999999-9999-4999-8999-999999999999",
    gateway_payment_id: "123456789",
    total: 100,
    valor_estornado: 0,
    payment_status: "pago",
    paid_at: new Date().toISOString(),
    status: "cancelled",
}

function requisicao(corpo: any, authorization?: string): Request {
    const headers: Record<string, string> = { "Content-Type": "application/json" }
    if (authorization) headers.Authorization = authorization
    return new Request("https://edge.local/estornar-pagamento", {
        method: "POST",
        headers,
        body: JSON.stringify(corpo),
    })
}

const AUTH_ADMIN = "Bearer jwt-admin-de-teste"

// ── F1: sem JWT -> 401 (sem tocar o banco) ─────────────────────────────────

Deno.test("F1 - sem Authorization responde 401 e nao le o banco", async () => {
    const { cliente, registro } = clienteSupaFalso({ linha: LINHA_SOLICITADA })
    const resposta = await handler(requisicao({ refund_id: REFUND_ID }), { supabase: cliente })
    assertEquals(resposta.status, 401)
    assertEquals(registro.leiturasLinha, 0)
})

// ── F2: JWT de cliente comum -> 401 ────────────────────────────────────────

Deno.test("F2 - JWT de cliente comum responde 401", async () => {
    const { cliente, registro } = clienteSupaFalso({ linha: LINHA_SOLICITADA })
    const resposta = await comEnv({}, () =>
        comFetch(fetchClienteFalso, () =>
            handler(requisicao({ refund_id: REFUND_ID }, "Bearer jwt-cliente-de-teste"), { supabase: cliente }),
        ),
    )
    assertEquals(resposta.status, 401)
    assertEquals(registro.leiturasLinha, 0)
})

// ── F3: refund_id inexistente -> 404 ───────────────────────────────────────

Deno.test("F3 - refund_id inexistente responde 404", async () => {
    const { cliente } = clienteSupaFalso({ linha: null })
    const resposta = await comEnv({}, () =>
        comFetch(fetchAdminFalso, () =>
            handler(requisicao({ refund_id: REFUND_ID }, AUTH_ADMIN), { supabase: cliente }),
        ),
    )
    assertEquals(resposta.status, 404)
})

Deno.test("F3b - refund_id com formato invalido responde 400 antes de ler o banco", async () => {
    const { cliente, registro } = clienteSupaFalso({ linha: LINHA_SOLICITADA })
    const resposta = await comEnv({}, () =>
        comFetch(fetchAdminFalso, () =>
            handler(requisicao({ refund_id: "nao-e-uuid" }, AUTH_ADMIN), { supabase: cliente }),
        ),
    )
    assertEquals(resposta.status, 400)
    assertEquals(registro.leiturasLinha, 0)
})

// ── F4: linha concluída -> 409 sem executar nada ──────────────────────────

Deno.test("F4 - linha concluida responde 409 estorno_ja_tratado sem chamar executor nem MP", async () => {
    const { cliente } = clienteSupaFalso({ linha: { ...LINHA_SOLICITADA, status: "concluido" }, pedido: PEDIDO_PAGO })
    const executor = executorFalso({ tipo: "concluido" })
    const mp = fetchMpFalso()
    const resposta = await comEnv({}, () =>
        comFetch(fetchAdminFalso, () =>
            handler(requisicao({ refund_id: REFUND_ID }, AUTH_ADMIN), {
                supabase: cliente,
                executarEstorno: executor.fn,
                buscar: mp.buscar,
            }),
        ),
    )
    assertEquals(resposta.status, 409)
    const corpo = await resposta.json()
    assertEquals(corpo.erro, "estorno_ja_tratado")
    assertEquals(corpo.status, "concluido")
    assertEquals(executor.registro.chamadas.length, 0)
    assertEquals(mp.registro.chamadas, 0)
})

// ── F5: fluxo feliz total → RPC concluir_estorno, resposta sem mp_refund_id ─

Deno.test("F5 - fluxo feliz conclui via RPC e responde {status, valor, texto} sem mp_refund_id", async () => {
    const { cliente, registro } = clienteSupaFalso({ linha: LINHA_SOLICITADA, pedido: PEDIDO_PAGO })
    const executor = executorFalso(
        { tipo: "concluido", mp_refund_id: "111222333", mp_status: "approved", mp_status_detail: null, valor: 100 },
        { chamarMp: true },
    )
    const mp = fetchMpFalso()
    const resposta = await comEnv({}, () =>
        comFetch(fetchAdminFalso, () =>
            handler(requisicao({ refund_id: REFUND_ID }, AUTH_ADMIN), {
                supabase: cliente,
                executarEstorno: executor.fn,
                buscar: mp.buscar,
            }),
        ),
    )
    assertEquals(resposta.status, 200)
    const corpo = await resposta.json()
    assertEquals(corpo.status, "concluido")
    assertEquals(corpo.valor, 100)
    // A resposta ao lojista NUNCA carrega o id do MP (Restrição Global).
    assertEquals(JSON.stringify(corpo).includes("111222333"), false)
    assertEquals("mp_refund_id" in corpo, false)
    // A MARCA aconteceu ANTES do executor (status em_processamento + tentativas 0+1).
    assertEquals(registro.marcas.length, 1)
    assertEquals(registro.marcas[0].valores.status, "em_processamento")
    assertEquals(registro.marcas[0].valores.tentativas, 1)
    // E a marca é CONDICIONAL (I2 do laudo do PR #439): os filtros exigem o id
    // E o estado vivo — sem o .in de status, dois cliques simultâneos chamam o
    // MP duas vezes; apagar esta linha da edge derruba esta asserção.
    assertEquals(registro.marcas[0].filtros, [
        { metodo: "eq", coluna: "id", valor: REFUND_ID },
        { metodo: "in", coluna: "status", valores: ["solicitado", "em_processamento"] },
    ])
    // E a conclusão é ATÔMICA pela RPC (a edge não soma valor_estornado na mão).
    assertEquals(registro.rpcs.length, 1)
    assertEquals(registro.rpcs[0].nome, "concluir_estorno")
    assertEquals(registro.rpcs[0].args.p_refund_id, REFUND_ID)
    assertEquals(registro.rpcs[0].args.p_mp_refund_id, "111222333")
    assertEquals(registro.rpcs[0].args.p_mp_status, "approved")
    // O executor recebeu a linha CERTA (id = chave de idempotência) e o pedido.
    assertEquals(executor.registro.chamadas[0].linha.id, REFUND_ID)
    assertEquals(executor.registro.chamadas[0].linha.tentativas, 1)
    assertEquals(executor.registro.chamadas[0].pedido.gateway_payment_id, "123456789")
})

// ── F5b: PIX (Orders API) → a edge PRECISA de consultarTransacaoDaOrder ────
// Conserto do laudo do PR #439 (07/09): sem passar consultarTransacaoDaOrder
// ao executor, todo estorno de pedido cujo gateway_payment_id é de ORDER (o
// caminho do PIX, único método vivo da loja) devolvia tentar_depois PARA
// SEMPRE — o clique do lojista nunca devolvia dinheiro. Este teste NÃO
// injeta deps.executarEstorno: usa o módulo real (_shared/estorno.ts) via o
// import dinâmico da edge, e o dublê de fetch responde às DUAS chamadas
// (GET da order, depois POST do refund-order).

const PEDIDO_ORDER = {
    id: "99999999-9999-4999-8999-999999999999",
    gateway_payment_id: "ORDTST05ABCDEFGHIJKLMNOPQR",
    total: 100,
    valor_estornado: 0,
    payment_status: "pago",
    paid_at: new Date().toISOString(),
    status: "cancelled",
}

/** Fetch falso que discrimina por MÉTODO: GET = consulta da order, POST = refund-order. */
function fetchOrderRefundFalso() {
    const registro = { chamadas: [] as any[] }
    const buscar = ((input: any, init?: any) => {
        const url = String(input instanceof Request ? input.url : input)
        const metodo = String(init?.method ?? "GET").toUpperCase()
        registro.chamadas.push({ url, metodo, init })
        if (metodo === "GET") {
            return new Response(
                JSON.stringify({
                    id: "ORDTST05ABCDEFGHIJKLMNOPQR",
                    status: "processed",
                    status_detail: "accredited",
                    transactions: { payments: [{ id: "PAY_X", status: "processed" }] },
                }),
                { status: 200, headers: { "Content-Type": "application/json" } },
            )
        }
        return new Response(
            JSON.stringify({ id: "ORDTST05ABCDEFGHIJKLMNOPQR", status: "refunded" }),
            { status: 201, headers: { "Content-Type": "application/json" } },
        )
    }) as any
    return { buscar, registro }
}

Deno.test("F5b - pedido PIX (order): a edge passa consultarTransacaoDaOrder e o corpo do refund leva o id do PAGAMENTO", async () => {
    const { cliente, registro } = clienteSupaFalso({ linha: LINHA_SOLICITADA, pedido: PEDIDO_ORDER })
    const mp = fetchOrderRefundFalso()
    const resposta = await comEnv({}, () =>
        comFetch(fetchAdminFalso, () =>
            handler(requisicao({ refund_id: REFUND_ID }, AUTH_ADMIN), {
                supabase: cliente,
                buscar: mp.buscar,
                // SEM executarEstorno: força a edge a usar o módulo real.
            }),
        ),
    )
    assertEquals(resposta.status, 200)
    const corpo = await resposta.json()
    assertEquals(corpo.status, "concluido")
    assertEquals(corpo.valor, 100)

    // Uma chamada GET (consulta da transação) e uma POST (refund-order).
    const gets = mp.registro.chamadas.filter((c: any) => c.metodo === "GET")
    const posts = mp.registro.chamadas.filter((c: any) => c.metodo === "POST")
    assertEquals(gets.length, 1)
    assertEquals(posts.length, 1)

    // O GET da order sai AUTENTICADO com o token da edge (laudo Opus rodada 4,
    // mutante M-C: sem esta linha, token vazio passava verde e o PIX voltava a
    // "tentar_depois" para sempre com CI verde).
    assertEquals(gets[0].init.headers.Authorization, "Bearer TEST-0000000000000000-000000")

    // O corpo do POST leva o id do PAGAMENTO (PAY_X), nunca o id da order.
    const corpoPost = JSON.parse(posts[0].init.body)
    assertEquals(corpoPost.transactions[0].id, "PAY_X")

    // A chave de idempotência do POST é o refund_id da linha.
    assertEquals(posts[0].init.headers["X-Idempotency-Key"], REFUND_ID)

    assertEquals(registro.rpcs.length, 1)
    assertEquals(registro.rpcs[0].nome, "concluir_estorno")
})

// ── F6: parcial → valor parcial na resposta ────────────────────────────────

Deno.test("F6 - devolucao parcial devolve o valor parcial e a decisao de payment_status e' da RPC", async () => {
    const { cliente, registro } = clienteSupaFalso({
        linha: { ...LINHA_SOLICITADA, amount: 30 },
        pedido: PEDIDO_PAGO,
        rpcResultado: { concluido: true, payment_status: "pago" },
    })
    const executor = executorFalso(
        { tipo: "concluido", mp_refund_id: "444555666", mp_status: "approved", mp_status_detail: "partially_refunded", valor: 30 },
        { chamarMp: true },
    )
    const mp = fetchMpFalso()
    const resposta = await comEnv({}, () =>
        comFetch(fetchAdminFalso, () =>
            handler(requisicao({ refund_id: REFUND_ID }, AUTH_ADMIN), {
                supabase: cliente,
                executarEstorno: executor.fn,
                buscar: mp.buscar,
            }),
        ),
    )
    assertEquals(resposta.status, 200)
    const corpo = await resposta.json()
    assertEquals(corpo.status, "concluido")
    assertEquals(corpo.valor, 30)
    // A edge NÃO escreve valor_estornado/payment_status: uma chamada à RPC, nada além.
    assertEquals(registro.rpcs.length, 1)
    const escreveuPedido = registro.atualizacoes.some((u) => u.valores && ("valor_estornado" in u.valores || "payment_status" in u.valores))
    assertEquals(escreveuPedido, false)
})

// ── F7: in_process → 202 com o texto exato ────────────────────────────────

Deno.test("F7 - in_process responde 202 com o texto exato e mantem a linha em processamento", async () => {
    const { cliente, registro } = clienteSupaFalso({ linha: LINHA_SOLICITADA, pedido: PEDIDO_PAGO })
    const executor = executorFalso({ tipo: "em_processamento", mp_refund_id: "777888999", mp_status: "in_process" })
    const mp = fetchMpFalso()
    const resposta = await comEnv({}, () =>
        comFetch(fetchAdminFalso, () =>
            handler(requisicao({ refund_id: REFUND_ID }, AUTH_ADMIN), {
                supabase: cliente,
                executarEstorno: executor.fn,
                buscar: mp.buscar,
            }),
        ),
    )
    assertEquals(resposta.status, 202)
    const corpo = await resposta.json()
    assertEquals(corpo.status, "em_processamento")
    assertEquals(corpo.texto, TEXTO_202)
    // A linha JÁ está marcada em_processamento (a marca de antes do MP); a
    // edge só grava o diagnóstico do MP — nenhum update de status final.
    const statusGravado = registro.atualizacoes.some((u) => u.valores?.status && u.valores.status !== "em_processamento")
    assertEquals(statusGravado, false)
    const diagnostico = registro.atualizacoes.find((u) => u.valores?.mp_status === "in_process")
    assertEquals(Boolean(diagnostico), true)
    // E é CONDICIONAL (M1-resto do laudo do PR #439): sem o .in de status, o
    // webhook concluindo a linha no meio faria este UPDATE sobrescrever
    // mp_status de uma linha já concluída; apagar o .in derruba esta asserção.
    assertEquals(diagnostico.filtros, [
        { metodo: "eq", coluna: "id", valor: REFUND_ID },
        { metodo: "in", coluna: "status", valores: ["em_processamento"] },
    ])
})

// ── F8: 429/tentar_depois → 202, ultimo_erro gravado, tentativas=1 ────────

Deno.test("F8 - 429 (tentar_depois) responde 202, grava ultimo_erro e a marca contabilizou tentativas=1", async () => {
    const { cliente, registro } = clienteSupaFalso({ linha: LINHA_SOLICITADA, pedido: PEDIDO_PAGO })
    const executor = executorFalso({ tipo: "tentar_depois", motivo: "O Mercado Pago está limitando as chamadas agora.", retryAfterS: 30 })
    const mp = fetchMpFalso()
    const resposta = await comEnv({}, () =>
        comFetch(fetchAdminFalso, () =>
            handler(requisicao({ refund_id: REFUND_ID }, AUTH_ADMIN), {
                supabase: cliente,
                executarEstorno: executor.fn,
                buscar: mp.buscar,
            }),
        ),
    )
    assertEquals(resposta.status, 202)
    const corpo = await resposta.json()
    assertEquals(corpo.status, "em_processamento")
    assertEquals(corpo.texto, TEXTO_202)
    // A linha CONTINUA em_processamento (a marca), com o erro registrado.
    const comErro = registro.atualizacoes.find((u) => u.valores?.ultimo_erro === "O Mercado Pago está limitando as chamadas agora.")
    assertEquals(Boolean(comErro), true)
    assertEquals(comErro.valores.status, undefined)
    // E é CONDICIONAL (M1-resto do laudo do PR #439), mesma razão do F7:
    // apagar o .in derruba esta asserção.
    assertEquals(comErro.filtros, [
        { metodo: "eq", coluna: "id", valor: REFUND_ID },
        { metodo: "in", coluna: "status", valores: ["em_processamento"] },
    ])
    assertEquals(registro.marcas.length, 1)
    assertEquals(registro.marcas[0].valores.tentativas, 1)
})

// ── F9: corrida — segunda chamada perde a marca → 409, UMA chamada ao MP ──

Deno.test("F9 - segunda chamada que perde a marca responde 409 e o MP so' e' chamado uma vez", async () => {
    // marcas[0] = 1 (a primeira marca pega), marcas[1] = 0 (a segunda vê a
    // linha fora de solicitado/em_processamento — outro executor concluiu no
    // meio; e' o TOCTOU que a marca existe para fechar).
    const { cliente, registro } = clienteSupaFalso({
        linha: LINHA_SOLICITADA,
        pedido: PEDIDO_PAGO,
        marcas: [1, 0],
    })
    const executor = executorFalso(
        { tipo: "concluido", mp_refund_id: "111222333", mp_status: "approved", mp_status_detail: null, valor: 100 },
        { chamarMp: true },
    )
    const mp = fetchMpFalso()
    const deps = { supabase: cliente, executarEstorno: executor.fn, buscar: mp.buscar }
    const primeira = await comEnv({}, () =>
        comFetch(fetchAdminFalso, () => handler(requisicao({ refund_id: REFUND_ID }, AUTH_ADMIN), deps)),
    )
    assertEquals(primeira.status, 200)
    const segunda = await comEnv({}, () =>
        comFetch(fetchAdminFalso, () => handler(requisicao({ refund_id: REFUND_ID }, AUTH_ADMIN), deps)),
    )
    assertEquals(segunda.status, 409)
    assertEquals(mp.registro.chamadas, 1)
    assertEquals(executor.registro.chamadas.length, 1)
    assertEquals(registro.rpcs.length, 1)
    // As DUAS marcas foram condicionais (I2): a segunda chamada também pediu o
    // .in de status — foi ele que devolveu 0 linhas, e não um acidente do dublê.
    assertEquals(registro.marcas.length, 2)
    assertEquals(registro.marcas[1].filtros, [
        { metodo: "eq", coluna: "id", valor: REFUND_ID },
        { metodo: "in", coluna: "status", valores: ["solicitado", "em_processamento"] },
    ])
})

// ── F10: X-Idempotency-Key == refund_id ───────────────────────────────────

Deno.test("F10 - o header X-Idempotency-Key que chega ao MP e' o refund_id da linha", async () => {
    const { cliente } = clienteSupaFalso({ linha: LINHA_SOLICITADA, pedido: PEDIDO_PAGO })
    const executor = executorFalso(
        { tipo: "concluido", mp_refund_id: "111222333", mp_status: "approved", mp_status_detail: null, valor: 100 },
        { chamarMp: true },
    )
    const mp = fetchMpFalso()
    await comEnv({}, () =>
        comFetch(fetchAdminFalso, () =>
            handler(requisicao({ refund_id: REFUND_ID }, AUTH_ADMIN), {
                supabase: cliente,
                executarEstorno: executor.fn,
                buscar: mp.buscar,
            }),
        ),
    )
    assertEquals(mp.registro.chamadas, 1)
    assertEquals(mp.registro.headers[0]["X-Idempotency-Key"], REFUND_ID)
})

// ── extras de contrato da porta e da marca ────────────────────────────────

Deno.test("extra - metodo GET responde 405 sem tocar nada", async () => {
    const resposta = await handler(new Request("https://edge.local/estornar-pagamento", { method: "GET" }), {})
    assertEquals(resposta.status, 405)
})

Deno.test("extra - sem MP_ACCESS_TOKEN a edge falha 500 ANTES de marcar a linha (nada fica preso)", async () => {
    const { cliente, registro } = clienteSupaFalso({ linha: LINHA_SOLICITADA, pedido: PEDIDO_PAGO })
    const executor = executorFalso({ tipo: "concluido", valor: 100 })
    const resposta = await comEnv({ MP_ACCESS_TOKEN: "" }, () =>
        comFetch(fetchAdminFalso, () =>
            handler(requisicao({ refund_id: REFUND_ID }, AUTH_ADMIN), {
                supabase: cliente,
                executarEstorno: executor.fn,
            }),
        ),
    )
    assertEquals(resposta.status, 500)
    assertEquals(registro.marcas.length, 0)
    assertEquals(executor.registro.chamadas.length, 0)
})

// ── F11: desfecho terminal falhou/recusado — o único ramo que grava estado
// TERMINAL numa linha de dinheiro (M2 do laudo do PR #439: nenhum dos 13
// testes passava por ele). O update é condicional como a MARCA (M1): só
// substitui 'em_processamento'.

Deno.test("F11 - recusado grava estado terminal com motivo e o update so' pega linha em_processamento", async () => {
    const { cliente, registro } = clienteSupaFalso({ linha: LINHA_SOLICITADA, pedido: PEDIDO_PAGO })
    const executor = executorFalso({ tipo: "recusado", motivo: "o cartão do estorno foi negado pelo banco emissor" })
    const mp = fetchMpFalso()
    const resposta = await comEnv({}, () =>
        comFetch(fetchAdminFalso, () =>
            handler(requisicao({ refund_id: REFUND_ID }, AUTH_ADMIN), {
                supabase: cliente,
                executarEstorno: executor.fn,
                buscar: mp.buscar,
            }),
        ),
    )
    assertEquals(resposta.status, 200)
    const corpo = await resposta.json()
    assertEquals(corpo.status, "recusado")
    assertEquals(corpo.valor, 100)
    assertEquals(corpo.texto, "A devolução não foi feita: o cartão do estorno foi negado pelo banco emissor")
    // O desfecho terminal foi gravado COM o motivo leigo...
    assertEquals(registro.finais.length, 1)
    assertEquals(registro.finais[0].valores.status, "recusado")
    assertEquals(registro.finais[0].valores.ultimo_erro, "o cartão do estorno foi negado pelo banco emissor")
    // ...e é CONDICIONAL (M1): id E status='em_processamento' — estado
    // terminal só substitui a marca; concluído por cron/webhook no meio
    // NÃO é sobrescrito.
    assertEquals(registro.finais[0].filtros, [
        { metodo: "eq", coluna: "id", valor: REFUND_ID },
        { metodo: "in", coluna: "status", valores: ["em_processamento"] },
    ])
    // Estado terminal não passa pela RPC de soma — recusado é recusado.
    assertEquals(registro.rpcs.length, 0)
})

Deno.test("F11b - falhou grava estado terminal com motivo", async () => {
    const { cliente, registro } = clienteSupaFalso({ linha: LINHA_SOLICITADA, pedido: PEDIDO_PAGO })
    const executor = executorFalso({ tipo: "falhou", motivo: "o Mercado Pago não respondeu sobre o estorno", codigo: "mp_sem_resposta" })
    const mp = fetchMpFalso()
    const resposta = await comEnv({}, () =>
        comFetch(fetchAdminFalso, () =>
            handler(requisicao({ refund_id: REFUND_ID }, AUTH_ADMIN), {
                supabase: cliente,
                executarEstorno: executor.fn,
                buscar: mp.buscar,
            }),
        ),
    )
    assertEquals(resposta.status, 200)
    const corpo = await resposta.json()
    assertEquals(corpo.status, "falhou")
    assertEquals(corpo.texto, "A devolução não foi concluída: o Mercado Pago não respondeu sobre o estorno")
    assertEquals(registro.finais.length, 1)
    assertEquals(registro.finais[0].valores.status, "falhou")
    assertEquals(registro.finais[0].valores.ultimo_erro, "o Mercado Pago não respondeu sobre o estorno")
    assertEquals(registro.rpcs.length, 0)
})

Deno.test("F11c - desfecho que perde a linha (cron concluiu no meio) responde 409 estorno_ja_tratado", async () => {
    // marcas[0] = 1 (a marca pega), finais[0] = 0 (o cron concluiu a linha
    // entre o executor e o desfecho): o update terminal não pega ninguém e a
    // edge responde o REAL, não o seu resultado (M1 do laudo do PR #439).
    const { cliente, registro } = clienteSupaFalso({
        linha: LINHA_SOLICITADA,
        // O que o cron/webhook gravou no meio — a releitura do 409
        // unificado (anotado no laudo do PR #439) tem de trazer ESTE
        // status, não o da linha original.
        linhaFinal: { ...LINHA_SOLICITADA, status: "concluido" },
        pedido: PEDIDO_PAGO,
        marcas: [1],
        finais: [0],
    })
    const executor = executorFalso({ tipo: "falhou", motivo: "timeout" })
    const mp = fetchMpFalso()
    const resposta = await comEnv({}, () =>
        comFetch(fetchAdminFalso, () =>
            handler(requisicao({ refund_id: REFUND_ID }, AUTH_ADMIN), {
                supabase: cliente,
                executarEstorno: executor.fn,
                buscar: mp.buscar,
            }),
        ),
    )
    assertEquals(resposta.status, 409)
    const corpo = await resposta.json()
    assertEquals(corpo.erro, "estorno_ja_tratado")
    // O 409 novo agora tem o mesmo formato do 409 do passo 2 ({erro, status}).
    assertEquals(corpo.status, "concluido")
    assertEquals(registro.marcas.length, 1)
})
