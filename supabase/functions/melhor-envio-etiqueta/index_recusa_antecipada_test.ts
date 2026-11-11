// @ts-nocheck
// Recusas antecipadas do handler: montagem copiada de index_test.ts,
// sem rede e sem credenciais reais.
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts"

// ── Costura de REDE para os testes do handler ──────────────────────────────
// A porta de admin do handler (verifyIsAdmin) monta os PRÓPRIOS clients do
// supabase-js — a costura `deps` só cobre o client principal. Estratégia da
// casa (calculate-shipping): patch de globalThis.fetch. Aqui o patch precisa
// estar NO LUGAR ANTES do import: o supabase-js captura a referência de fetch
// no carregamento (cross-fetch). Então o index.ts é importado dinamicamente
// com o patch ativo e o fetch original volta em seguida (não vaza para os
// outros arquivos de teste do mesmo processo); cada teste de handler volta a
// instalar o patch durante a chamada (cobre resolução lazy de fetch também).
const fetchNativo = globalThis.fetch

const URL_SUPA_TESTE = 'https://supa-fake.local'
const ID_ADMIN = 'admin-1111-2222'
const ANON_DE_TESTE = 'anon-chave-de-teste'

/**
 * Papel ATUAL nas duas fontes (`_shared/admin-atual.ts`, a mesma regra de
 * `public.is_admin_atual()`): `app_metadata.role` do usuário que o GET /user
 * do Auth carrega do banco, e `profiles.role`. O admin de verdade tem
 * 'admin' nas duas.
 */
function respostaDePapeisFalsa(url: string, papelNoAuth: string, papelNoPerfil: string): Response {
    if (url.includes('/auth/v1/user')) {
        return new Response(
            JSON.stringify({
                id: ID_ADMIN,
                email: 'admin@teste.local',
                aud: 'authenticated',
                role: 'authenticated',
                app_metadata: { provider: 'email', role: papelNoAuth },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
    }
    if (url.includes('/rest/v1/profiles')) {
        // `.single()` pede o accept vnd.pgrst.object — o SERVIDOR é quem
        // devolve objeto (não array); o fake imita o servidor.
        return new Response(
            JSON.stringify({ id: ID_ADMIN, role: papelNoPerfil }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
    }
    return new Response(
        JSON.stringify({ message: 'fora do roteiro do teste' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } },
    )
}

function fetchPapeisFalso(papelNoAuth: string, papelNoPerfil: string): any {
    return ((input: any) =>
        respostaDePapeisFalsa(String(input instanceof Request ? input.url : input), papelNoAuth, papelNoPerfil)) as any
}

const fetchAdminFalso = fetchPapeisFalso('admin', 'admin')

globalThis.fetch = fetchAdminFalso
const { handler, erroDePedidoParaEtiqueta, erroDePagamentoParaEtiqueta } = await import('./index.ts')
globalThis.fetch = fetchNativo

/** Instala o fetch admin falso SÓ durante a chamada ao handler. */
async function comAdminFalso(executar: () => Promise<any>): Promise<any> {
    return await comFetchFalso(fetchAdminFalso, executar)
}

/** Instala um fetch falso qualquer SÓ durante a chamada ao handler. */
async function comFetchFalso(fetchFalso: any, executar: () => Promise<any>): Promise<any> {
    const anterior = globalThis.fetch
    globalThis.fetch = fetchFalso
    try {
        return await executar()
    } finally {
        globalThis.fetch = anterior
    }
}

/** Env de que a porta de admin precisa ANTES de criar qualquer client.
 *  DEVOLVE a função de restauração: quem chama roda dentro de `comEnvAdmin`
 *  e o env volta ao valor anterior no fim — sem vazar para os testes
 *  seguintes do mesmo processo (nit H3 da 3ª rodada, PR #423). */
const ENV_ADMIN: Array<[string, string]> = [
    ['SUPABASE_URL', URL_SUPA_TESTE],
    ['SUPABASE_PUBLISHABLE_KEYS', JSON.stringify({ default: ANON_DE_TESTE })],
    // verifyIsAdmin também monta o client de SISTEMA com a service role —
    // sem ela o createClient lança "supabaseKey is required" e a porta
    // falha fechado (a costura deps.supabase não cobre estes clients).
    ['SUPABASE_SECRET_KEYS', JSON.stringify({ default: 'service-role-de-teste' })],
]

function prepararEnvAdmin(): () => void {
    const chaveStorage = `sb-${new URL(URL_SUPA_TESTE).hostname.split('.')[0]}-auth-token`
    let storageAnterior: string | null = null
    try { storageAnterior = localStorage.getItem(chaveStorage) } catch { /* storage indisponível */ }
    const anteriores = ENV_ADMIN.map(([chave]) => [chave, Deno.env.get(chave)] as [string, string | undefined])
    for (const [chave, valor] of ENV_ADMIN) Deno.env.set(chave, valor)
    // Sem sessão guardada, o getUser do supabase-js pode falhar ANTES da
    // rede ("session missing") em versões que exigem sessão; semear o
    // storage deixa o caminho determinístico. Se o runner não tem
    // localStorage, o header Authorization global cobre.
    try {
        const host = new URL(URL_SUPA_TESTE).hostname.split('.')[0]
        localStorage.setItem(
            `sb-${host}-auth-token`,
            JSON.stringify({
                access_token: 'jwt-admin-de-teste',
                refresh_token: 'refresh-de-teste',
                token_type: 'bearer',
                expires_in: 3600,
                expires_at: Math.floor(Date.now() / 1000) + 3600,
                user: { id: ID_ADMIN, email: 'admin@teste.local', aud: 'authenticated', role: 'authenticated' },
            }),
        )
    } catch {
        // storage indisponível neste runner — segue com o header global
    }
    return () => {
        try {
            if (storageAnterior === null) localStorage.removeItem(chaveStorage)
            else localStorage.setItem(chaveStorage, storageAnterior)
        } catch { /* storage indisponível */ }
        for (const [chave, valor] of anteriores) {
            if (valor === undefined) Deno.env.delete(chave)
            else Deno.env.set(chave, valor)
        }
    }
}

/** Instala o env da porta de admin SÓ durante o bloco (restaura no fim,
 *  mesmo se uma asserção falhar). */
async function comEnvAdmin(executar: () => Promise<void>): Promise<void> {
    const restaurar = prepararEnvAdmin()
    try {
        await executar()
    } finally {
        restaurar()
    }
}


const LABEL_ID = 'label-abc-123'

const PEDIDO_FELIZ = {
    id: 'pedido-1',
    status: 'processing',
    payment_status: 'pago',
    subtotal: 10,
    tracking_code: null,
    shipping_label_id: null,
    shipping_label_url: null,
    total: 24.9,
    customer_name: 'Maria Souza',
    customer_data: {
        cep: '38500-000',
        street: 'Rua Antiga',
        number: '42',
        city: 'Monte Carmelo',
        state: 'MG',
        shipping_option_id: 'melhor-envio-1',
        // CPF válido de teste (52998224725) — requisito novo do Melhor
        // Envio (`to.document`). Sem ele, todo fluxo feliz deste arquivo
        // pararia no portão de CPF antes de chegar aos ramos que cada teste
        // quer provar.
        cpf: '52998224725',
    },
}

const CONTA_ME_FELIZ = {
    name: 'Loja do Gabriel',
    companies: [{ name: 'IKCOUS', company_document: '12345678000199', phone: '34999990000' }],
    addresses: [
        {
            postal_code: '38500-000',
            address: 'Rua A',
            number: '10',
            district: 'Centro',
            city: { city: 'Monte Carmelo', state_abbr: 'MG' },
            is_default: true,
        },
    ],
}

/**
 * Cliente Supabase falso: cadeia encadeada igual à real (from →
 * select/insert/update → eq/is/in → maybeSingle/single/then) e um `registro`
 * que guarda o que aconteceu — o registro vira o ASSENTO dos testes
 * (reivindicação gravada? liberação com os dois filtros? evento de qual
 * etapa?).
 */
function clienteFalso(configuracao: { pedido?: any; linhasReivindicadas?: any[]; linhasCpfAtualizadas?: any[]; itens?: any[]; produtosDb?: any[]; credentials?: any; enderecoConta?: any; erroRastreio?: boolean; erroReleituraPedido?: boolean } = {}) {
    const pedidoAtual = configuracao.pedido ? { ...configuracao.pedido } : null
    let leiturasPedido = 0
    const registro = {
        pedidoAtual,
        gravacoesPedido: 0,
        reivindicacoes: [] as Array<{ valores: any; filtros: any[] }>,
        liberacoes: [] as Array<{ valores: any; filtros: any[] }>,
        completacoes: [] as Array<{ valores: any; filtros: any[] }>,
        // update do CPF (definir_cpf_destinatario) — assento à parte porque o
        // valor gravado é `customer_data` (não `shipping_label_id`).
        cpfAtualizacoes: [] as Array<{ valores: any; filtros: any[] }>,
        eventos: [] as any[],
    }
    const resolver = (no: any): Promise<any> => {
        if (no.tabela === 'store_shipping_credentials') {
            return Promise.resolve({
                data: { credentials: configuracao.credentials ?? { token: 'token-me-de-teste', sandbox: true } },
                error: null,
            })
        }
        if (no.tabela === 'order_shipping_events') {
            registro.eventos.push(no.valores)
            return Promise.resolve({ data: null, error: null })
        }
        if (no.tabela === 'marketplace_order_items') {
            return Promise.resolve({ data: configuracao.itens ?? [{ product_id: 'p1', quantity: 1, price: 10 }], error: null })
        }
        if (no.tabela === 'produtos') {
            return Promise.resolve({ data: configuracao.produtosDb ?? [{ id: 'p1', nome: 'Caneca', preco_venda: 10 }], error: null })
        }
        // user_addresses — fallback de `buscarEnderecoDaConta` (achado
        // 26/09/2026). `enderecoConta` ausente simula pedido sem linha (ou
        // sem address_id nenhum); presente, mas com `id`/`user_id` que não
        // batem com os filtros da chamada, simula endereço de OUTRO usuário
        // (dono explícito) — a MESMA linha só volta quando os DOIS filtros
        // (`id`, `user_id`) casam, igual ao `.eq().eq()` real.
        if (no.tabela === 'user_addresses') {
            const linha = configuracao.enderecoConta ?? null
            if (!linha) return Promise.resolve({ data: null, error: null })
            const bate = no.filtros.every((f: any) => f.metodo !== 'eq' || linha[f.coluna] === f.valor)
            return Promise.resolve({ data: bate ? linha : null, error: null })
        }
        // marketplace_orders
        if (no.acao === 'update') {
            const bate = pedidoAtual && no.filtros.every((f: any) => {
                if (f.metodo === 'eq' || f.metodo === 'is') return pedidoAtual[f.coluna] === f.valor
                if (f.metodo === 'in') return f.valores.includes(pedidoAtual[f.coluna])
                return true
            })
            if ('tracking_code' in (no.valores || {}) && configuracao.erroRastreio) {
                return Promise.resolve({ data: null, error: { code: 'XX000', message: 'Falha simulada ao gravar rastreio' } })
            }
            const soltaVinculo = 'shipping_label_id' in (no.valores || {}) && no.valores.shipping_label_id === null
            const tomaVinculo = 'shipping_label_id' in (no.valores || {}) && no.valores.shipping_label_id !== null && !('shipping_label_url' in no.valores)
            if (soltaVinculo) {
                registro.liberacoes.push({ valores: no.valores, filtros: [...no.filtros] })
                if (bate) Object.assign(pedidoAtual, no.valores)
                return Promise.resolve({ data: null, error: null })
            }
            if (tomaVinculo) {
                registro.reivindicacoes.push({ valores: no.valores, filtros: [...no.filtros] })
                // Quem vence a corrida recebe 1 linha; o teste que arma
                // `linhasReivindicadas: []` simula o perdedor.
                const linhas = configuracao.linhasReivindicadas ?? [{ id: configuracao.pedido?.id ?? 'pedido-1' }]
                if (bate && linhas.length) Object.assign(pedidoAtual, no.valores)
                return Promise.resolve({ data: linhas, error: null })
            }
            const atualizaCpf = 'customer_data' in (no.valores || {})
            if (atualizaCpf) {
                registro.cpfAtualizacoes.push({ valores: no.valores, filtros: [...no.filtros] })
                // O teste que arma `linhasCpfAtualizadas: []` simula a corrida
                // perdida (update condicional que não bateu em nenhuma linha).
                const linhas = configuracao.linhasCpfAtualizadas ?? [{ id: configuracao.pedido?.id ?? 'pedido-1' }]
                return Promise.resolve({ data: linhas, error: null })
            }
            registro.completacoes.push({ valores: no.valores, filtros: [...no.filtros] })
            if (bate) Object.assign(pedidoAtual, no.valores)
            return Promise.resolve({ data: null, error: null })
        }
        leiturasPedido++
        if (leiturasPedido > 1 && configuracao.erroReleituraPedido) {
            return Promise.resolve({ data: null, error: { code: 'XX000', message: 'Falha simulada ao reler pedido' } })
        }
        return Promise.resolve({ data: pedidoAtual ? { ...pedidoAtual } : null, error: null })
    }
    const cliente = {
        from(tabela: string) {
            const no: any = { tabela, acao: null, valores: null, filtros: [] }
            const api: any = {
                select(_colunas?: string) {
                    return api
                },
                insert(valores: any) {
                    if (tabela === 'marketplace_orders') registro.gravacoesPedido++
                    no.acao = 'insert'
                    no.valores = valores
                    return api
                },
                update(valores: any) {
                    if (tabela === 'marketplace_orders') registro.gravacoesPedido++
                    no.acao = 'update'
                    no.valores = valores
                    return api
                },
                eq(coluna: string, valor: any) {
                    no.filtros.push({ metodo: 'eq', coluna, valor })
                    return api
                },
                is(coluna: string, valor: any) {
                    no.filtros.push({ metodo: 'is', coluna, valor })
                    return api
                },
                in(coluna: string, valores: any) {
                    no.filtros.push({ metodo: 'in', coluna, valores })
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
    return { cliente, registro }
}

/**
 * Fetch falso do Melhor Envio: roteia pela URL e CONTA as chamadas — é o
 * assento de dinheiro dos testes (carrinho criado? item removido? checkout
 * chamado?). `checkout` é configurável: 'pago' (default), 'pendente' (o ME
 * responde 200 com status pending — compra NÃO fechou), 'erro-5xx' (o
 * gateway responde 502 — a compra PODE ter fechado com a resposta perdida,
 * revisor A′ da 3ª rodada) ou 'excecao' (a chamada estoura no meio —
 * timeout/queda de rede pós-reivindicação).
 */
function buscarMeFalso(opcoes: { checkout?: 'pago' | 'pendente' | 'excecao' | 'erro-5xx'; cartSemId?: boolean; cartSemIdPayload?: Record<string, unknown>; cartPrice?: unknown; checkoutTotal?: unknown; geracao?: 'ok' | 'excecao' } = {}) {
    const registro = {
        carrinho: 0,
        remocoes: 0,
        checkouts: 0,
        geracoes: 0,
        chamadasMe: 0,
        ultimoServico: null as string | null,
        ultimoInsuranceValue: null as number | null,
        ultimoProducts: null as Array<Record<string, unknown>> | null,
        // Os volumes do carrinho (lote 227): Correios aceitam UM por chamada.
        ultimoVolumes: null as Array<Record<string, unknown>> | null,
        // CPF (`to.document`) — assento para o portão de CPF do destinatário.
        ultimoTo: null as Record<string, unknown> | null,
        userAgentsVistos: [] as string[],
    }
    const buscar = (async (input: any, init?: any) => {
        const url = String(input instanceof Request ? input.url : input)
        const metodo = String(init?.method || 'GET')
        // R3-7: assento do User-Agent em TODA chamada (/me, /cart, /checkout,
        // /generate, /print, /tracking) — prova que é sempre o MESMO.
        const userAgent = init?.headers?.['User-Agent']
        if (typeof userAgent === 'string') registro.userAgentsVistos.push(userAgent)
        if (url.endsWith('/api/v2/me/cart') && metodo === 'POST') {
            registro.carrinho++
            // Assento para os testes de índice-691: qual `service` chegou de
            // fato no carrinho do ME (o do checkout ou o escolhido pelo lojista).
            // O seguro efetivamente cotado (`-ss` → 0, contrato A6/R1-6) e os
            // `products` (declaração fiscal — regressão pós-revisão Opus:
            // unitary_value tem que ser o preço VENDIDO, não o do catálogo).
            try {
                const corpo = JSON.parse(String(init?.body || '{}'))
                registro.ultimoServico = corpo?.service ?? null
                registro.ultimoInsuranceValue = corpo?.options?.insurance_value ?? null
                registro.ultimoProducts = corpo?.products ?? null
                registro.ultimoVolumes = corpo?.volumes ?? null
                registro.ultimoTo = corpo?.to ?? null
            } catch {
                registro.ultimoServico = null
                registro.ultimoInsuranceValue = null
                registro.ultimoProducts = null
                registro.ultimoVolumes = null
                registro.ultimoTo = null
            }
            if (opcoes.cartSemId) {
                // Simula o ME ecoando o `to.document` cru numa resposta 201
                // SEM `id` (o campo que dispara o log 'cart sem id') — é
                // exatamente o formato que o log tinha de sanitizar antes de
                // imprimir (achado da revisão Opus sobre o commit aadbf4c).
                // `cartSemIdPayload` deixa o teste escolher o corpo exato —
                // usado para colocar o CPF cruzando a fronteira do corte de
                // 500 caracteres (2ª rodada da revisão).
                return new Response(
                    JSON.stringify(
                        opcoes.cartSemIdPayload ?? { errors: { 'to.document': ['529.982.247-25 já está em uso'] } },
                    ),
                    { status: 201, headers: { 'Content-Type': 'application/json' } },
                )
            }
            return new Response(JSON.stringify({ id: LABEL_ID, protocol: 'proto-1', ...(opcoes.cartPrice !== undefined ? { price: opcoes.cartPrice } : {}) }), {
                status: 201,
                headers: { 'Content-Type': 'application/json' },
            })
        }
        if (url.includes('/api/v2/me/cart/') && metodo === 'DELETE') {
            registro.remocoes++
            return new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } })
        }
        if (url.endsWith('/api/v2/me/shipment/checkout')) {
            registro.checkouts++
            if (opcoes.checkout === 'excecao') {
                throw new Error('AbortError: tempo esgotado simulado')
            }
            if (opcoes.checkout === 'erro-5xx') {
                return new Response(JSON.stringify({ error: 'Bad gateway' }), {
                    status: 502,
                    headers: { 'Content-Type': 'application/json' },
                })
            }
            const status = opcoes.checkout === 'pendente' ? 'pending' : 'paid'
            return new Response(JSON.stringify({ purchase: { id: 'pur-1', status, ...(opcoes.checkoutTotal !== undefined ? { total: opcoes.checkoutTotal } : {}) } }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            })
        }
        if (url.endsWith('/api/v2/me/shipment/generate')) {
            registro.geracoes++
            if (opcoes.geracao === 'excecao') throw new Error('queda de rede simulada na geração')
            return new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } })
        }
        if (url.endsWith('/api/v2/me/shipment/print')) {
            return new Response(JSON.stringify({ url: 'https://imprimir.teste/etiqueta' }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            })
        }
        if (url.endsWith('/api/v2/me/shipment/tracking')) {
            return new Response(JSON.stringify({ [LABEL_ID]: { tracking: 'ME123456789BR', status: 'generated' } }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            })
        }
        if (url.endsWith('/api/v2/me')) {
            registro.chamadasMe++
            return new Response(JSON.stringify(CONTA_ME_FELIZ), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            })
        }
        return new Response(JSON.stringify({ message: 'url fora do roteiro' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
        })
    }) as any
    return { buscar, registro }
}

function requisicaoGerar(action = "gerar_etiqueta", extra: Record<string, unknown> = {}): Request {
  return new Request("http://localhost/melhor-envio-etiqueta", {
    method: "POST",
    headers: { Authorization: "Bearer jwt-admin-de-teste" },
    body: JSON.stringify({ action, orderId: "pedido-1", ...extra }),
  })
}


// A contagem envolve TODA chamada ao ME (não só cart/checkout) e TODA
// tentativa de gravação no pedido, inclusive update que não encontra linha.
async function executarPedido(pedido: any) {
    const supa = clienteFalso({ pedido })
    const me = buscarMeFalso()
    let chamadasMelhorEnvio = 0
    const buscar = async (input: any, init?: any) => {
        chamadasMelhorEnvio++
        return await me.buscar(input, init)
    }
    const res = await comAdminFalso(() => handler(requisicaoGerar(), { supabase: supa.cliente, buscar }))
    const corpo = await res.json()
    return { res, corpo, supa, me, chamadasMelhorEnvio }
}

// Controle dentro de CADA teste: as mesmas fixtures chegam ao carrinho e
// observam gravações reais do handler quando ambos os portões autorizam.
async function provarControlePositivo() {
    const { res, corpo, supa, me, chamadasMelhorEnvio } = await executarPedido(PEDIDO_FELIZ)
    assertEquals(res.status, 200)
    assertEquals(corpo.success, true)
    assertEquals(me.registro.carrinho, 1)
    assertEquals(me.registro.checkouts, 1)
    assertEquals(chamadasMelhorEnvio > 0, true)
    assertEquals(supa.registro.gravacoesPedido > 0, true)
    assertEquals(supa.registro.reivindicacoes.length, 1)
}

function exigirRecusaAntecipada(resultado: Awaited<ReturnType<typeof executarPedido>>, erro: string | null, caso: string) {
    const { res, corpo, supa, me, chamadasMelhorEnvio } = resultado
    assertEquals(res.status, 400, `${caso}: a recusa deve acontecer no portão inicial`)
    assertEquals(typeof erro, 'string', `${caso}: o helper real deve recusar esta fixture`)
    assertEquals(corpo.error, erro, `${caso}: a resposta deve preservar a mensagem do helper real`)
    assertEquals(corpo.success, undefined)
    assertEquals(chamadasMelhorEnvio, 0, `${caso}: nenhuma chamada ao Melhor Envio`)
    assertEquals(me.registro.carrinho, 0)
    assertEquals(me.registro.checkouts, 0)
    assertEquals(supa.registro.gravacoesPedido, 0, `${caso}: nenhuma tentativa de gravação no pedido`)
    assertEquals(supa.registro.reivindicacoes.length, 0)
    assertEquals(supa.registro.pedidoAtual.shipping_label_id, null)
    assertEquals(supa.registro.eventos.length, 0)
}

Deno.test('handler - pedido já cancelado/entregue é recusado com 400 antes de qualquer chamada externa ou gravação', async () => {
    await comEnvAdmin(async () => {
        await provarControlePositivo()
        for (const status of ['cancelled', 'delivered']) {
            const pedido = { ...PEDIDO_FELIZ, status, payment_status: 'pago' }
            exigirRecusaAntecipada(await executarPedido(pedido), erroDePedidoParaEtiqueta(pedido), status)
        }
    })
})

Deno.test('handler - pagamento não confirmado é recusado com 400 antes de qualquer chamada externa ou gravação', async () => {
    await comEnvAdmin(async () => {
        await provarControlePositivo()
        for (const payment_status of ['aguardando', 'recusado', 'estornado', undefined]) {
            const pedido = { ...PEDIDO_FELIZ, status: 'processing', payment_status }
            // Ausente de verdade: simula pedido anterior à coluna, não null.
            if (payment_status === undefined) delete pedido.payment_status
            exigirRecusaAntecipada(
                await executarPedido(pedido),
                erroDePagamentoParaEtiqueta(pedido.payment_status),
                payment_status ?? 'ausente',
            )
        }
    })
})
