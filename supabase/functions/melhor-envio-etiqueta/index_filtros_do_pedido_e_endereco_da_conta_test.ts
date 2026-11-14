// @ts-nocheck
// Guardas de DINHEIRO da geração de etiqueta que NENHUM teste antigo derrubava
// (achados 1, 2 e 3 da onda 119, base 083f3c820):
//   1. a trava anti-compra-dupla — o UPDATE condicional da reivindicação
//      (`.eq('id').is('shipping_label_id', null)`) e o da conclusão (`.eq('id')`);
//   2. os filtros do pedido — itens `.eq('order_id')` e a releitura de antes do
//      checkout (`.eq('shipping_label_id', labelId)`);
//   3. o endereço da CONTA (user_addresses) só vira destino se estiver completo.
//
// Por que um dublê novo e não o de `index_test.ts`: o de lá DEVOLVE as linhas
// configuradas sem consultar os filtros (a reivindicação), trata filtro vazio
// como "bate" (a conclusão) e responde a leitura de itens sem olhar o
// `order_id`. Apagar o filtro em produção não deixava nada vermelho. Aqui o
// dublê é uma TABELA de verdade com DOIS pedidos: eq/is/in filtram de fato, o
// UPDATE só toca as linhas que casam, e o `maybeSingle` recusa mais de uma
// linha (PGRST116) como o PostgREST. Sem rede, sem segredo, dados inventados.
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts"

// ── Costura de REDE (mesma estratégia do index_test.ts) ────────────────────
// A porta de admin monta os próprios clients do supabase-js: o patch de fetch
// tem de estar NO LUGAR antes do import do index.ts.
const fetchNativo = globalThis.fetch

const URL_SUPA_TESTE = 'https://supa-fake.local'
const ID_ADMIN = 'admin-1111-2222'

function fetchAdminFalso(input: any): Response {
    const url = String(input instanceof Request ? input.url : input)
    if (url.includes('/auth/v1/user')) {
        return new Response(
            JSON.stringify({
                id: ID_ADMIN,
                email: 'admin@teste.fixture.invalid',
                aud: 'authenticated',
                role: 'authenticated',
                app_metadata: { provider: 'email', role: 'admin' },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
    }
    if (url.includes('/rest/v1/profiles')) {
        return new Response(JSON.stringify({ id: ID_ADMIN, role: 'admin' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        })
    }
    return new Response(JSON.stringify({ message: 'fora do roteiro do teste' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
    })
}

globalThis.fetch = fetchAdminFalso
const { handler } = await import('./index.ts')
globalThis.fetch = fetchNativo

async function comAdminFalso(executar: () => Promise<any>): Promise<any> {
    const anterior = globalThis.fetch
    globalThis.fetch = fetchAdminFalso
    try {
        return await executar()
    } finally {
        globalThis.fetch = anterior
    }
}

const ENV_ADMIN: Array<[string, string]> = [
    ['SUPABASE_URL', URL_SUPA_TESTE],
    ['SUPABASE_PUBLISHABLE_KEYS', JSON.stringify({ default: 'anon-chave-de-teste' })],
    ['SUPABASE_SECRET_KEYS', JSON.stringify({ default: 'service-role-de-teste' })],
]

async function comEnvAdmin(executar: () => Promise<void>): Promise<void> {
    const anteriores = ENV_ADMIN.map(([chave]) => [chave, Deno.env.get(chave)] as [string, string | undefined])
    for (const [chave, valor] of ENV_ADMIN) Deno.env.set(chave, valor)
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
                user: { id: ID_ADMIN, email: 'admin@teste.fixture.invalid', aud: 'authenticated', role: 'authenticated' },
            }),
        )
    } catch {
        // runner sem localStorage: o header Authorization global cobre
    }
    try {
        await executar()
    } finally {
        for (const [chave, valor] of anteriores) {
            if (valor === undefined) Deno.env.delete(chave)
            else Deno.env.set(chave, valor)
        }
    }
}

// ── Dados inventados ───────────────────────────────────────────────────────

const LABEL_ID = 'label-abc-123'
const LABEL_DO_CONCORRENTE = 'label-do-concorrente-999'
const LABEL_DE_OUTRO_ESCRITOR = 'label-de-outro-escritor-777'
const CPF_VALIDO_DE_TESTE = '52998224725'

const PEDIDO_1 = {
    id: 'pedido-1',
    status: 'processing',
    payment_status: 'pago',
    tracking_code: null,
    shipping_label_id: null,
    shipping_label_url: null,
    customer_name: 'Maria Souza',
    customer_data: {
        cep: '38500-000',
        street: 'Rua Antiga',
        number: '42',
        city: 'Monte Carmelo',
        state: 'MG',
        shipping_option_id: 'melhor-envio-1',
        cpf: CPF_VALIDO_DE_TESTE,
    },
}

// O VIZINHO: outro pedido, também pago e sem etiqueta — é ele quem pagaria o
// preço se um UPDATE perdesse o `.eq('id', orderId)`.
const PEDIDO_2 = {
    ...PEDIDO_1,
    id: 'pedido-2',
    customer_name: 'Joana Lima',
}

const CONTA_ME_FELIZ = {
    name: 'Loja de Teste',
    companies: [{ name: 'LOJA', company_document: '12345678000199', phone: '34999990000' }],
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

// ── Dublê do Supabase: tabelas de verdade, filtros que filtram ─────────────

function clone(linha: any): any {
    return JSON.parse(JSON.stringify(linha))
}

function casa(linha: any, filtros: any[]): boolean {
    return filtros.every((f) => {
        const valor = linha[f.coluna]
        if (f.metodo === 'eq') return valor === f.valor
        if (f.metodo === 'is') return f.valor === null ? valor === null || valor === undefined : valor === f.valor
        if (f.metodo === 'in') return f.valores.includes(valor)
        throw new Error(`filtro fora do roteiro do dublê: ${f.metodo}`)
    })
}

// Sem itens configurados, o pedido-1 leva 1 caneca (senão o handler recusa com
// 'pedido sem itens' antes de chegar ao que cada teste quer provar).
const ITENS_PADRAO_DO_PEDIDO_1 = [{ order_id: 'pedido-1', product_id: 'p1', quantity: 1, price: 10 }]
const PRODUTOS_PADRAO = [{ id: 'p1', nome: 'Caneca', preco_venda: 10 }]

function clienteComTabelas(
    configuracao: {
        pedidos: any[]
        itens?: any[]
        produtos?: any[]
        enderecos?: any[]
        // Chamado logo DEPOIS que a reivindicação gravou e devolveu a sua
        // resposta: modela "outro escritor trocou o vínculo entre o passo 6.5
        // e a releitura de antes do checkout". Recebe as linhas VIVAS.
        aposReivindicar?: (pedidos: any[]) => void
    },
) {
    const tabelas = new Map<string, any[]>([
        ['marketplace_orders', configuracao.pedidos.map(clone)],
        ['marketplace_order_items', (configuracao.itens ?? ITENS_PADRAO_DO_PEDIDO_1).map(clone)],
        ['produtos', (configuracao.produtos ?? PRODUTOS_PADRAO).map(clone)],
        ['user_addresses', (configuracao.enderecos ?? []).map(clone)],
    ])
    const registro = {
        atualizacoes: [] as Array<{ tabela: string; valores: any; filtros: any[]; idsAfetados: string[] }>,
        leituras: [] as Array<{ tabela: string; filtros: any[] }>,
        eventos: [] as any[],
    }
    const resolver = (no: any): Promise<any> => {
        if (no.tabela === 'store_shipping_credentials') {
            return Promise.resolve({ data: { credentials: { token: 'token-me-de-teste', sandbox: true } }, error: null })
        }
        if (no.tabela === 'order_shipping_events') {
            registro.eventos.push(no.valores)
            return Promise.resolve({ data: null, error: null })
        }
        const linhas = tabelas.get(no.tabela)
        if (!linhas) throw new Error(`tabela fora do roteiro do dublê: ${no.tabela}`)
        if (no.acao === 'update') {
            const alvo = linhas.filter((l) => casa(l, no.filtros))
            for (const linha of alvo) Object.assign(linha, no.valores)
            registro.atualizacoes.push({
                tabela: no.tabela,
                valores: no.valores,
                filtros: [...no.filtros],
                idsAfetados: alvo.map((l) => l.id),
            })
            // `.update().select()` devolve as linhas JÁ atualizadas; sem
            // `.select()` o PostgREST não devolve corpo.
            const data = no.devolveLinhas ? alvo.map(clone) : null
            if (ehReivindicacao({ tabela: no.tabela, valores: no.valores }) && configuracao.aposReivindicar) {
                configuracao.aposReivindicar(linhas)
            }
            return Promise.resolve({ data, error: null })
        }
        if (no.acao) throw new Error(`ação fora do roteiro do dublê: ${no.acao}`)
        registro.leituras.push({ tabela: no.tabela, filtros: [...no.filtros] })
        const achadas = linhas.filter((l) => casa(l, no.filtros)).map(clone)
        if (no.unica) {
            if (achadas.length > 1) {
                return Promise.resolve({ data: null, error: { code: 'PGRST116', message: 'mais de uma linha' } })
            }
            return Promise.resolve({ data: achadas[0] ?? null, error: null })
        }
        return Promise.resolve({ data: achadas, error: null })
    }
    const cliente = {
        from(tabela: string) {
            const no: any = { tabela, acao: null, valores: null, filtros: [], devolveLinhas: false, unica: false }
            const api: any = {
                select(_colunas?: string) {
                    if (no.acao === 'update') no.devolveLinhas = true
                    return api
                },
                insert(valores: any) {
                    no.acao = 'insert'
                    no.valores = valores
                    return api
                },
                update(valores: any) {
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
                    no.unica = true
                    return api
                },
                single() {
                    no.unica = true
                    return api
                },
                then(resolveu: any, rejeitou: any) {
                    return resolver(no).then(resolveu, rejeitou)
                },
            }
            // `insert` de evento termina sem `.select()`: o `then` resolve.
            return api
        },
    }
    const pedido = (id: string) => tabelas.get('marketplace_orders')!.find((l) => l.id === id)
    return { cliente, registro, pedido }
}

// Classificação dos UPDATEs de marketplace_orders pela forma dos valores
// (a mesma que o index.ts grava em cada passo).
function ehReivindicacao(a: { tabela: string; valores: any }): boolean {
    return (
        a.tabela === 'marketplace_orders' &&
        typeof a.valores?.shipping_label_id === 'string' &&
        !('shipping_label_url' in a.valores)
    )
}
const ehLiberacao = (a: any) => a.tabela === 'marketplace_orders' && a.valores?.shipping_label_id === null
const ehConclusao = (a: any) => a.tabela === 'marketplace_orders' && 'shipping_label_url' in (a.valores ?? {})
const ehRastreio = (a: any) => a.tabela === 'marketplace_orders' && 'tracking_code' in (a.valores ?? {})

// ── Fetch falso do Melhor Envio (o assento de dinheiro) ────────────────────

function buscarMeFalso(opcoes: { aoCriarCarrinho?: () => void } = {}) {
    const registro = {
        carrinho: 0,
        remocoes: 0,
        checkouts: 0,
        geracoes: 0,
        chamadasMe: 0,
        ultimoInsuranceValue: null as number | null,
        ultimoProducts: null as any[] | null,
        ultimoVolumes: null as any[] | null,
        ultimoTo: null as Record<string, unknown> | null,
        // O que o ME RECEBEU em cada passo que compra/gera: o corpo, não só "foi chamado".
        corposDoCheckout: [] as any[],
        corposDaGeracao: [] as any[],
    }
    const json = (corpo: unknown, status = 200) =>
        new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } })
    const buscar = (async (input: any, init?: any) => {
        const url = String(input instanceof Request ? input.url : input)
        const metodo = String(init?.method || 'GET')
        if (url.endsWith('/api/v2/me/cart') && metodo === 'POST') {
            registro.carrinho++
            const corpo = JSON.parse(String(init?.body || '{}'))
            registro.ultimoInsuranceValue = corpo?.options?.insurance_value ?? null
            registro.ultimoProducts = corpo?.products ?? null
            registro.ultimoVolumes = corpo?.volumes ?? null
            registro.ultimoTo = corpo?.to ?? null
            opcoes.aoCriarCarrinho?.()
            return json({ id: LABEL_ID, protocol: 'proto-1' }, 201)
        }
        if (url.includes('/api/v2/me/cart/') && metodo === 'DELETE') {
            registro.remocoes++
            return json({})
        }
        if (url.endsWith('/api/v2/me/shipment/checkout')) {
            registro.checkouts++
            registro.corposDoCheckout.push(JSON.parse(String(init?.body || '{}')))
            return json({ purchase: { id: 'pur-1', status: 'paid' } })
        }
        if (url.endsWith('/api/v2/me/shipment/generate')) {
            registro.geracoes++
            registro.corposDaGeracao.push(JSON.parse(String(init?.body || '{}')))
            return json({})
        }
        if (url.endsWith('/api/v2/me/shipment/print')) return json({ url: 'https://imprimir.teste/etiqueta' })
        if (url.endsWith('/api/v2/me/shipment/tracking')) {
            return json({ [LABEL_ID]: { tracking: 'ME123456789BR', status: 'generated' } })
        }
        if (url.endsWith('/api/v2/me')) {
            registro.chamadasMe++
            return json(CONTA_ME_FELIZ)
        }
        return json({ message: 'url fora do roteiro' }, 404)
    }) as any
    return { buscar, registro }
}

function requisicaoGerar(): Request {
    return new Request('http://localhost/melhor-envio-etiqueta', {
        method: 'POST',
        headers: { Authorization: 'Bearer jwt-admin-de-teste' },
        body: JSON.stringify({ action: 'gerar_etiqueta', orderId: 'pedido-1' }),
    })
}

const FILTRO_ID_PEDIDO_1 = { metodo: 'eq', coluna: 'id', valor: 'pedido-1' }

// ═══ ACHADO 1 — a trava anti-compra-dupla ═════════════════════════════════

Deno.test('reivindicação - pedido-1 vinculado por um CONCORRENTE durante o /cart: 409, item removido, checkout NUNCA, vínculo alheio e pedido-2 intactos', async () => {
    await comEnvAdmin(async () => {
        const supa = clienteComTabelas({ pedidos: [PEDIDO_1, PEDIDO_2] })
        // O concorrente (outra aba, outro clique) grava o vínculo DELE entre a
        // leitura do passo 2 (ainda sem etiqueta) e a reivindicação do 6.5.
        const me = buscarMeFalso({
            aoCriarCarrinho: () => {
                supa.pedido('pedido-1').shipping_label_id = LABEL_DO_CONCORRENTE
            },
        })
        const res = await comAdminFalso(() => handler(requisicaoGerar(), { supabase: supa.cliente, buscar: me.buscar }))
        const corpo = await res.json()

        assertEquals(res.status, 409)
        assertEquals(corpo.resgate, true)
        assertEquals(corpo.label_id, LABEL_ID)
        assertEquals(corpo.success, undefined)
        assertEquals(me.registro.carrinho, 1)
        assertEquals(me.registro.remocoes, 1)
        assertEquals(me.registro.checkouts, 0)
        assertEquals(me.registro.geracoes, 0)

        // Os FILTROS que a trava grava — o contrato, não só "foi chamada".
        const reivindicacoes = supa.registro.atualizacoes.filter(ehReivindicacao)
        assertEquals(reivindicacoes.length, 1)
        assertEquals(reivindicacoes[0].valores, { shipping_label_id: LABEL_ID })
        assertEquals(reivindicacoes[0].filtros, [
            FILTRO_ID_PEDIDO_1,
            { metodo: 'is', coluna: 'shipping_label_id', valor: null },
        ])
        // Perdeu a corrida de verdade: o UPDATE condicional não tocou linha nenhuma.
        assertEquals(reivindicacoes[0].idsAfetados, [])

        // Nada além da reivindicação escreveu em pedido: nem liberação (não é dela
        // soltar o vínculo do concorrente), nem conclusão, nem rastreio.
        assertEquals(supa.registro.atualizacoes.length, 1)

        // O vínculo do concorrente sobrevive; o pedido-2 nunca recebe etiqueta.
        assertEquals(supa.pedido('pedido-1').shipping_label_id, LABEL_DO_CONCORRENTE)
        assertEquals(supa.pedido('pedido-1').shipping_label_url, null)
        assertEquals(supa.pedido('pedido-2').shipping_label_id, null)
        assertEquals(supa.pedido('pedido-2').shipping_label_url, null)
        assertEquals(supa.pedido('pedido-2').tracking_code, null)
        assertEquals(supa.registro.eventos.some((e) => e.payload?.etapa === 'reivindicacao'), true)
    })
})

Deno.test('reivindicação e conclusão - CONTROLE com 2 pedidos na tabela: só o pedido-1 é tocado, com os filtros certos, e o pedido-2 fica sem vínculo, url e rastreio', async () => {
    await comEnvAdmin(async () => {
        const supa = clienteComTabelas({ pedidos: [PEDIDO_1, PEDIDO_2] })
        const me = buscarMeFalso()
        const res = await comAdminFalso(() => handler(requisicaoGerar(), { supabase: supa.cliente, buscar: me.buscar }))
        const corpo = await res.json()

        assertEquals(res.status, 200)
        assertEquals(corpo.success, true)
        assertEquals(corpo.already, false)
        assertEquals(me.registro.checkouts, 1)
        assertEquals(me.registro.remocoes, 0)

        // O EFEITO primeiro (o que ficou nas tabelas): pedido-1 completo, pedido-2 virgem.
        assertEquals(supa.pedido('pedido-1').shipping_label_id, LABEL_ID)
        assertEquals(supa.pedido('pedido-1').shipping_label_url, 'https://imprimir.teste/etiqueta')
        assertEquals(supa.pedido('pedido-1').tracking_code, 'ME123456789BR')
        assertEquals(supa.pedido('pedido-2').shipping_label_id, null)
        assertEquals(supa.pedido('pedido-2').shipping_label_url, null)
        assertEquals(supa.pedido('pedido-2').tracking_code, null)

        // Depois o CONTRATO: os filtros que cada UPDATE grava.
        // Reivindicação: 1 linha, a do pedido-1.
        const reivindicacoes = supa.registro.atualizacoes.filter(ehReivindicacao)
        assertEquals(reivindicacoes.length, 1)
        assertEquals(reivindicacoes[0].idsAfetados, ['pedido-1'])
        assertEquals(reivindicacoes[0].filtros, [
            FILTRO_ID_PEDIDO_1,
            { metodo: 'is', coluna: 'shipping_label_id', valor: null },
        ])

        // Conclusão (url): só o filtro de id do pedido.
        const conclusoes = supa.registro.atualizacoes.filter(ehConclusao)
        assertEquals(conclusoes.length, 1)
        assertEquals(conclusoes[0].filtros, [FILTRO_ID_PEDIDO_1])
        assertEquals(conclusoes[0].idsAfetados, ['pedido-1'])

        // Rastreio: id do pedido E "ainda sem código" (não pisa em rastreio alheio).
        const rastreios = supa.registro.atualizacoes.filter(ehRastreio)
        assertEquals(rastreios.length, 1)
        assertEquals(rastreios[0].filtros, [
            FILTRO_ID_PEDIDO_1,
            { metodo: 'is', coluna: 'tracking_code', valor: null },
        ])
        assertEquals(rastreios[0].idsAfetados, ['pedido-1'])

        assertEquals(supa.registro.atualizacoes.filter(ehLiberacao).length, 0)
    })
})

// A compra paga o id da ETIQUETA que o /cart devolveu, nunca o id do pedido do
// app. O dublê de cima responde `paid` a qualquer corpo; sem olhar o que chegou,
// trocar `orders: [labelId]` por `orders: [orderId]` não deixava nada vermelho
// (e na vida real o ME pagaria — ou recusaria — uma etiqueta que não é a do pedido).
Deno.test('compra - o checkout e a geração recebem orders = [id da etiqueta devolvido pelo /cart], e não o id do pedido do app', async () => {
    await comEnvAdmin(async () => {
        const supa = clienteComTabelas({ pedidos: [PEDIDO_1, PEDIDO_2] })
        const me = buscarMeFalso()
        const res = await comAdminFalso(() => handler(requisicaoGerar(), { supabase: supa.cliente, buscar: me.buscar }))
        const corpo = await res.json()

        assertEquals(res.status, 200)
        assertEquals(corpo.success, true)
        // Os dois ids do fixture são de fato diferentes: senão o teste não distingue nada.
        assertEquals(LABEL_ID !== 'pedido-1', true)

        assertEquals(me.registro.corposDoCheckout, [{ orders: [LABEL_ID] }])
        assertEquals(me.registro.corposDaGeracao, [{ orders: [LABEL_ID] }])
    })
})

// ═══ ACHADO 2 — filtros do pedido (itens e releitura de antes do checkout) ═

const PRODUTOS_DOS_DOIS_PEDIDOS = [
    { id: 'p1', nome: 'Camiseta', preco_venda: 10, peso_kg: 0.25, largura_cm: 20, altura_cm: 4, comprimento_cm: 30 },
    { id: 'p9', nome: 'Bermuda', preco_venda: 99, peso_kg: 2, largura_cm: 40, altura_cm: 10, comprimento_cm: 50 },
]

Deno.test('itens - a etiqueta do pedido-1 leva SÓ peso, medidas, nomes e seguro dos itens do pedido-1 (a tabela guarda itens de dois pedidos)', async () => {
    await comEnvAdmin(async () => {
        const supa = clienteComTabelas({
            // Jadlog (3) mantém um volume por linha: um item de outro pedido
            // aparece como volume e como produto a mais, sem consolidar.
            pedidos: [
                { ...PEDIDO_1, customer_data: { ...PEDIDO_1.customer_data, shipping_option_id: 'melhor-envio-3' } },
                PEDIDO_2,
            ],
            itens: [
                { order_id: 'pedido-1', product_id: 'p1', quantity: 2, price: 10 },
                { order_id: 'pedido-2', product_id: 'p9', quantity: 3, price: 99 },
            ],
            produtos: PRODUTOS_DOS_DOIS_PEDIDOS,
        })
        const me = buscarMeFalso()
        const res = await comAdminFalso(() => handler(requisicaoGerar(), { supabase: supa.cliente, buscar: me.buscar }))
        assertEquals(res.status, 200)

        // O efeito no carrinho do ME (dinheiro: frete cobrado e seguro).
        assertEquals(me.registro.ultimoProducts, [{ name: 'Camiseta', quantity: 2, unitary_value: 10 }])
        assertEquals(me.registro.ultimoVolumes, [{ weight: 0.5, width: 20, height: 8, length: 30 }])
        assertEquals(me.registro.ultimoInsuranceValue, 20)

        // O filtro que a leitura grava.
        const leituraDeItens = supa.registro.leituras.filter((l) => l.tabela === 'marketplace_order_items')
        assertEquals(leituraDeItens.length, 1)
        assertEquals(leituraDeItens[0].filtros, [{ metodo: 'eq', coluna: 'order_id', valor: 'pedido-1' }])

    })
})

Deno.test('releitura antes do checkout - vínculo trocado por outro escritor DEPOIS da reivindicação: 409, checkout NUNCA, item removido e o vínculo alheio NÃO é solto', async () => {
    await comEnvAdmin(async () => {
        const supa = clienteComTabelas({
            pedidos: [PEDIDO_1, PEDIDO_2],
            // Passo 6.5 vence (devolve 1 linha) e, logo em seguida, outro
            // escritor troca o vínculo — antes da releitura do passo 7.
            aposReivindicar: (pedidos) => {
                pedidos.find((l) => l.id === 'pedido-1').shipping_label_id = LABEL_DE_OUTRO_ESCRITOR
            },
        })
        const me = buscarMeFalso()
        const res = await comAdminFalso(() => handler(requisicaoGerar(), { supabase: supa.cliente, buscar: me.buscar }))
        const corpo = await res.json()

        assertEquals(res.status, 409)
        assertEquals(typeof corpo.error, 'string')
        assertEquals(corpo.success, undefined)
        assertEquals(me.registro.carrinho, 1)
        assertEquals(me.registro.remocoes, 1)
        assertEquals(me.registro.checkouts, 0)
        assertEquals(me.registro.geracoes, 0)

        // A reivindicação ganhou (1 linha); a releitura é que barrou.
        const reivindicacoes = supa.registro.atualizacoes.filter(ehReivindicacao)
        assertEquals(reivindicacoes.length, 1)
        assertEquals(reivindicacoes[0].idsAfetados, ['pedido-1'])

        // O filtro da releitura (a última leitura de pedido antes do checkout).
        const leiturasDePedido = supa.registro.leituras.filter((l) => l.tabela === 'marketplace_orders')
        assertEquals(leiturasDePedido[leiturasDePedido.length - 1].filtros, [
            FILTRO_ID_PEDIDO_1,
            { metodo: 'eq', coluna: 'shipping_label_id', valor: LABEL_ID },
        ])

        // A liberação é condicional ao vínculo DESTA chamada: não casa com o do
        // outro escritor, então não solta nada.
        const liberacoes = supa.registro.atualizacoes.filter(ehLiberacao)
        assertEquals(liberacoes.length, 1)
        assertEquals(liberacoes[0].filtros, [
            FILTRO_ID_PEDIDO_1,
            { metodo: 'eq', coluna: 'shipping_label_id', valor: LABEL_ID },
        ])
        assertEquals(liberacoes[0].idsAfetados, [])
        assertEquals(supa.pedido('pedido-1').shipping_label_id, LABEL_DE_OUTRO_ESCRITOR)
        assertEquals(supa.pedido('pedido-2').shipping_label_id, null)
        assertEquals(supa.registro.eventos.some((e) => e.payload?.etapa === 'validacao_pedido'), true)
    })
})

// ═══ ACHADO 3 — endereço da CONTA incompleto ═══════════════════════════════

const ENDERECO_DA_CONTA_COMPLETO = {
    id: 'addr-1',
    user_id: 'user-1',
    cep: '01310-100',
    street: 'Av. Paulista',
    number: '1000',
    complement: 'Ap 12',
    neighborhood: 'Bela Vista',
    city: 'São Paulo',
    state: 'SP',
}

// Cliente LOGADO: `customer_data` sem endereço; o destino vem de user_addresses.
const PEDIDO_LOGADO = {
    ...PEDIDO_1,
    customer_data: { shipping_option_id: 'melhor-envio-1', cpf: CPF_VALIDO_DE_TESTE },
    address_id: 'addr-1',
    user_id: 'user-1',
}

Deno.test('endereço da conta - CONTROLE: linha de user_addresses completa vira o destino e a etiqueta sai', async () => {
    await comEnvAdmin(async () => {
        const supa = clienteComTabelas({ pedidos: [PEDIDO_LOGADO], enderecos: [ENDERECO_DA_CONTA_COMPLETO] })
        const me = buscarMeFalso()
        const res = await comAdminFalso(() => handler(requisicaoGerar(), { supabase: supa.cliente, buscar: me.buscar }))
        assertEquals(res.status, 200)
        assertEquals(me.registro.carrinho, 1)
        assertEquals(me.registro.ultimoTo?.postal_code, '01310100')
        assertEquals(me.registro.ultimoTo?.address, 'Av. Paulista')
        assertEquals(me.registro.ultimoTo?.number, '1000')
        assertEquals(me.registro.ultimoTo?.city, 'São Paulo')
    })
})

for (
    const [rotulo, campos] of [
        ['sem número (number vazio)', { number: '' }],
        ['sem rua (street vazia)', { street: '' }],
        ['sem cidade (city vazia)', { city: '' }],
        ['CEP de 7 dígitos', { cep: '0131010' }],
    ] as const
) {
    Deno.test(`endereço da conta - incompleto, ${rotulo}: 400 'endereço completo', NENHUM carrinho no ME e nenhuma reivindicação`, async () => {
        await comEnvAdmin(async () => {
            // Só UM campo difere do controle acima, então o 400 só pode vir dele.
            const supa = clienteComTabelas({
                pedidos: [PEDIDO_LOGADO],
                enderecos: [{ ...ENDERECO_DA_CONTA_COMPLETO, ...campos }],
            })
            const me = buscarMeFalso()
            const res = await comAdminFalso(() => handler(requisicaoGerar(), { supabase: supa.cliente, buscar: me.buscar }))
            const corpo = await res.json()
            assertEquals(res.status, 400)
            assertEquals(String(corpo.error).toLowerCase().includes('endereço completo'), true)
            assertEquals(me.registro.carrinho, 0)
            assertEquals(me.registro.chamadasMe, 0)
            assertEquals(me.registro.checkouts, 0)
            assertEquals(supa.registro.atualizacoes.filter(ehReivindicacao).length, 0)
            assertEquals(supa.registro.atualizacoes.length, 0)
            assertEquals(supa.pedido('pedido-1').shipping_label_id, null)
        })
    })
}

// ═══ QUEM VAI RECEBER — o nome do destinatário da etiqueta (13/11/2026) ═════
// A cliente digita "Quem vai receber" no endereço; a migration 20261399997000 copia o nome para
// `customer_data.address.recipient_name` do pedido. A etiqueta usa esse nome quando existe e o de quem
// comprou quando não existe (pedido antigo, sem nome, só espaços, convidada). O CPF/documento NÃO muda:
// segue o do comprador (a documentação do Melhor Envio não diz que o nome tenha de ser o do titular do CPF,
// nem o contrário; ver o relatório da tarefa). Funciona COM ou SEM a migration no ar.
const { nomeDeQuemRecebe } = await import('./index.ts')

const ENDERECO_COPIADO_NO_PEDIDO = {
    cep: '38500-100',
    street: 'Rua da Prova',
    number: '10',
    neighborhood: 'Centro',
    city: 'Monte Carmelo',
    state: 'MG',
}

const pedidoComEndereco = (address: Record<string, unknown> | null, extra: Record<string, unknown> = {}) => ({
    ...PEDIDO_1,
    customer_data: { shipping_option_id: 'melhor-envio-1', cpf: CPF_VALIDO_DE_TESTE, address, ...extra },
})

Deno.test('nomeDeQuemRecebe - o nome do endereço do pedido vence; sem ele (ou só espaços) cai no comprador; aparado e sem espaço duplo', () => {
    assertEquals(nomeDeQuemRecebe('Maria Souza', { address: { recipient_name: 'Ana Presente' } }), 'Ana Presente')
    assertEquals(nomeDeQuemRecebe('Maria Souza', { address: { recipient_name: '  Ana   Presente  ' } }), 'Ana Presente')
    assertEquals(nomeDeQuemRecebe('Maria Souza', { addressData: { recipient_name: 'Ana Presente' } }), 'Ana Presente')
    assertEquals(nomeDeQuemRecebe('Maria Souza', { address: { recipient_name: '   ' } }), 'Maria Souza')
    assertEquals(nomeDeQuemRecebe('Maria Souza', { address: { recipient_name: null } }), 'Maria Souza')
    assertEquals(nomeDeQuemRecebe('Maria Souza', { address: { recipient_name: 42 } }), 'Maria Souza')
    assertEquals(nomeDeQuemRecebe('Maria Souza', { address: { street: 'Rua A' } }), 'Maria Souza')
    assertEquals(nomeDeQuemRecebe('Maria Souza', { address: null }), 'Maria Souza')
    assertEquals(nomeDeQuemRecebe('Maria Souza', { address: 'Rua A, 10' }), 'Maria Souza')
    assertEquals(nomeDeQuemRecebe('Maria Souza', null), 'Maria Souza')
    assertEquals(nomeDeQuemRecebe('Maria Souza', undefined), 'Maria Souza')
    // O nome solto na raiz do customer_data nao conta: so o do endereco.
    assertEquals(nomeDeQuemRecebe('Maria Souza', { recipient_name: 'Ana Presente' }), 'Maria Souza')
    // Sem nenhum nome, o texto de sempre.
    assertEquals(nomeDeQuemRecebe(null, null), 'Cliente')
    assertEquals(nomeDeQuemRecebe('', { address: { recipient_name: '' } }), 'Cliente')
    assertEquals(nomeDeQuemRecebe(undefined, { address: { recipient_name: 'Ana Presente' } }), 'Ana Presente')
})

Deno.test('quem vai receber - o endereço do pedido traz o nome: o carrinho do ME leva o nome de quem recebe e o CPF de quem comprou', async () => {
    await comEnvAdmin(async () => {
        const supa = clienteComTabelas({
            pedidos: [pedidoComEndereco({ ...ENDERECO_COPIADO_NO_PEDIDO, recipient_name: 'Ana Presente' })],
        })
        const me = buscarMeFalso()
        const res = await comAdminFalso(() => handler(requisicaoGerar(), { supabase: supa.cliente, buscar: me.buscar }))
        assertEquals(res.status, 200)
        assertEquals(me.registro.carrinho, 1)
        assertEquals(me.registro.ultimoTo?.name, 'Ana Presente')
        // O documento segue o do comprador, nao muda com o nome.
        assertEquals(me.registro.ultimoTo?.document, CPF_VALIDO_DE_TESTE)
        // O resto do destino e' o mesmo de sempre.
        assertEquals(me.registro.ultimoTo?.postal_code, '38500100')
        assertEquals(me.registro.ultimoTo?.address, 'Rua da Prova')
        assertEquals(me.registro.ultimoTo?.number, '10')
    })
})

for (
    const [rotulo, address] of [
        ['sem recipient_name (pedido antigo ou sem nome)', { ...ENDERECO_COPIADO_NO_PEDIDO }],
        ['recipient_name so de espacos', { ...ENDERECO_COPIADO_NO_PEDIDO, recipient_name: '   ' }],
        ['recipient_name nulo', { ...ENDERECO_COPIADO_NO_PEDIDO, recipient_name: null }],
    ] as const
) {
    Deno.test(`quem vai receber - ${rotulo}: a etiqueta sai com o nome de quem comprou`, async () => {
        await comEnvAdmin(async () => {
            const supa = clienteComTabelas({ pedidos: [pedidoComEndereco(address)] })
            const me = buscarMeFalso()
            const res = await comAdminFalso(() => handler(requisicaoGerar(), { supabase: supa.cliente, buscar: me.buscar }))
            assertEquals(res.status, 200)
            assertEquals(me.registro.ultimoTo?.name, 'Maria Souza')
            assertEquals(me.registro.ultimoTo?.document, CPF_VALIDO_DE_TESTE)
        })
    })
}

Deno.test('quem vai receber - pedido de conta SEM copia no pedido (antigo): o endereço vem da conta, o nome continua o de quem comprou (a linha da conta pode ter mudado depois da compra)', async () => {
    await comEnvAdmin(async () => {
        const supa = clienteComTabelas({
            pedidos: [PEDIDO_LOGADO],
            enderecos: [{ ...ENDERECO_DA_CONTA_COMPLETO, recipient_name: 'Nome Que A Cliente Digitou Depois' }],
        })
        const me = buscarMeFalso()
        const res = await comAdminFalso(() => handler(requisicaoGerar(), { supabase: supa.cliente, buscar: me.buscar }))
        assertEquals(res.status, 200)
        assertEquals(me.registro.ultimoTo?.postal_code, '01310100')
        assertEquals(me.registro.ultimoTo?.name, 'Maria Souza')
    })
})

Deno.test('quem vai receber - o nome de quem recebe nao e usado em nenhum outro campo do destino nem some o do comprador no pedido: so o `to.name` muda', async () => {
    await comEnvAdmin(async () => {
        const comNome = clienteComTabelas({
            pedidos: [pedidoComEndereco({ ...ENDERECO_COPIADO_NO_PEDIDO, recipient_name: 'Ana Presente' })],
        })
        const semNome = clienteComTabelas({ pedidos: [pedidoComEndereco({ ...ENDERECO_COPIADO_NO_PEDIDO })] })
        const meA = buscarMeFalso()
        const meB = buscarMeFalso()
        assertEquals((await comAdminFalso(() => handler(requisicaoGerar(), { supabase: comNome.cliente, buscar: meA.buscar }))).status, 200)
        assertEquals((await comAdminFalso(() => handler(requisicaoGerar(), { supabase: semNome.cliente, buscar: meB.buscar }))).status, 200)
        const { name: nomeA, ...restoA } = meA.registro.ultimoTo as Record<string, unknown>
        const { name: nomeB, ...restoB } = meB.registro.ultimoTo as Record<string, unknown>
        assertEquals(nomeA, 'Ana Presente')
        assertEquals(nomeB, 'Maria Souza')
        assertEquals(restoA, restoB)
    })
})
