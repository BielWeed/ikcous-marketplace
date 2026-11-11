// @ts-nocheck
// Consulta de rastreio pelo handler real, sem rede nem credenciais reais.
// Retirar o `tracking &&` deve fazer o primeiro caso detectar UPDATE com null.
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts"

const URL_SUPA_TESTE = 'https://supa-fake.local'
const ID_ADMIN = 'admin-1111-2222'
const LABEL_ID = 'label-abc-123'
const PEDIDO_ID = 'pedido-1'

function respostaJson(dados: unknown): Response {
    return new Response(JSON.stringify(dados), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    })
}

const fetchAdminFalso = ((input: any) => {
    const url = new URL(String(input instanceof Request ? input.url : input))
    if (url.origin !== URL_SUPA_TESTE) throw new Error('Rede fora do roteiro do teste')
    if (url.pathname === '/auth/v1/user') {
        return Promise.resolve(respostaJson({
            id: ID_ADMIN,
            email: 'admin@teste.local',
            aud: 'authenticated',
            role: 'authenticated',
            app_metadata: { provider: 'email', role: 'admin' },
        }))
    }
    if (url.pathname === '/rest/v1/profiles') {
        return Promise.resolve(respostaJson({ id: ID_ADMIN, role: 'admin' }))
    }
    throw new Error('Auth fora do roteiro do teste')
}) as typeof fetch

// Como nos vizinhos: supabase-js captura fetch no import; a porta de admin
// cria seus próprios clients, fora de deps.supabase.
const fetchNativo = globalThis.fetch
let handler: typeof import('./index.ts').handler
try {
    globalThis.fetch = fetchAdminFalso
    ;({ handler } = await import('./index.ts'))
} finally {
    globalThis.fetch = fetchNativo
}

const ENV_ADMIN: Array<[string, string]> = [
    ['SUPABASE_URL', URL_SUPA_TESTE],
    ['SUPABASE_PUBLISHABLE_KEYS', JSON.stringify({ default: 'anon-chave-de-teste' })],
    ['SUPABASE_SECRET_KEYS', JSON.stringify({ default: 'service-role-de-teste' })],
]

async function comAdminFalso(executar: () => Promise<void>): Promise<void> {
    const anteriores = ENV_ADMIN.map(([chave]) => [chave, Deno.env.get(chave)] as const)
    const fetchAnterior = globalThis.fetch
    const chaveStorage = 'sb-supa-fake-auth-token'
    let storageAnterior: string | null = null
    try { storageAnterior = localStorage.getItem(chaveStorage) } catch { /* storage indisponível */ }
    try {
        for (const [chave, valor] of ENV_ADMIN) Deno.env.set(chave, valor)
        globalThis.fetch = fetchAdminFalso
        try {
            localStorage.setItem(chaveStorage, JSON.stringify({
                access_token: 'jwt-admin-de-teste',
                refresh_token: 'refresh-de-teste',
                token_type: 'bearer',
                expires_in: 3600,
                expires_at: Math.floor(Date.now() / 1000) + 3600,
                user: { id: ID_ADMIN, email: 'admin@teste.local', aud: 'authenticated', role: 'authenticated' },
            }))
        } catch { /* header Authorization cobre runners sem storage */ }
        await executar()
    } finally {
        globalThis.fetch = fetchAnterior
        for (const [chave, valor] of anteriores) {
            if (valor === undefined) Deno.env.delete(chave)
            else Deno.env.set(chave, valor)
        }
        try {
            if (storageAnterior === null) localStorage.removeItem(chaveStorage)
            else localStorage.setItem(chaveStorage, storageAnterior)
        } catch { /* storage indisponível */ }
    }
}

function clienteFalso() {
    const pedidoAtual = {
        id: PEDIDO_ID,
        status: 'shipping',
        shipping_label_id: LABEL_ID,
        tracking_code: 'CODIGO-SALVO',
    }
    const atualizacoes: Array<{ valores: any; filtros: Array<[string, unknown]> }> = []
    const eventos: any[] = []
    return {
        pedidoAtual,
        atualizacoes,
        eventos,
        cliente: {
            from(tabela: string) {
                let acao = 'select'
                let valores: any
                const filtros: Array<[string, unknown]> = []
                const resolver = () => {
                    if (tabela === 'store_shipping_credentials') {
                        assertEquals(filtros, [['provider', 'melhor_envio']])
                        return { data: { credentials: { token: 'token-me-de-teste', sandbox: true, contact_email: 'loja@teste.local' } }, error: null }
                    }
                    if (tabela === 'order_shipping_events' && acao === 'insert') {
                        eventos.push(valores)
                        return { data: null, error: null }
                    }
                    if (tabela !== 'marketplace_orders') throw new Error('Tabela fora do roteiro do teste')
                    // A leitura é um snapshot; a escrita só muda a linha quando
                    // os filtros casam, tal como o banco (não basta registrar).
                    const bate = filtros.every(([coluna, valor]) => pedidoAtual[coluna] === valor)
                    if (acao === 'update') {
                        atualizacoes.push({ valores: { ...valores }, filtros: [...filtros] })
                        if (bate) Object.assign(pedidoAtual, valores)
                        return { data: null, error: null }
                    }
                    assertEquals(acao, 'select')
                    return { data: bate ? { ...pedidoAtual } : null, error: null }
                }
                const api: any = {
                    select() { return api },
                    maybeSingle() { return api },
                    eq(coluna: string, valor: unknown) {
                        filtros.push([coluna, valor])
                        return api
                    },
                    update(dados: any) {
                        acao = 'update'
                        valores = dados
                        return api
                    },
                    insert(dados: any) {
                        acao = 'insert'
                        valores = dados
                        return api
                    },
                    then(resolveu: any, rejeitou: any) {
                        return Promise.resolve().then(resolver).then(resolveu, rejeitou)
                    },
                }
                return api
            },
        },
    }
}

async function consultarRastreio(entrada: Record<string, unknown>) {
    const supa = clienteFalso()
    let consultas = 0
    const buscar = (async (input: any, init?: RequestInit) => {
        assertEquals(String(input), 'https://sandbox.melhorenvio.com.br/api/v2/me/shipment/tracking')
        assertEquals(init?.method, 'POST')
        assertEquals(JSON.parse(String(init?.body)), { orders: [LABEL_ID] })
        consultas++
        return respostaJson({ [LABEL_ID]: entrada })
    }) as typeof fetch
    const res = await handler(new Request('http://localhost/melhor-envio-etiqueta', {
        method: 'POST',
        headers: { Authorization: 'Bearer jwt-admin-de-teste' },
        body: JSON.stringify({ action: 'consultar_rastreio', orderId: PEDIDO_ID }),
    }), { supabase: supa.cliente, buscar })
    const corpo = await res.json()
    assertEquals(res.status, 200)
    assertEquals(corpo.success, true)
    assertEquals(consultas, 1)
    assertEquals(supa.eventos.map((evento) => evento.event_type), ['rastreio_consultado'])
    return { supa, corpo }
}

Deno.test('handler - consulta sem código não apaga rastreio salvo nem envia UPDATE com null', async () => {
    await comAdminFalso(async () => {
        const { supa, corpo } = await consultarRastreio({ status: 'generated' })
        assertEquals(corpo.tracking_code, null)
        assertEquals(supa.atualizacoes, [], 'Consulta sem código não deve enviar UPDATE de rastreio com null')
        assertEquals(supa.pedidoAtual.tracking_code, 'CODIGO-SALVO', 'O rastreio já salvo deve permanecer')
    })
})

Deno.test('handler - consulta com código novo atualiza o rastreio do pedido correto', async () => {
    await comAdminFalso(async () => {
        const { supa, corpo } = await consultarRastreio({ tracking: 'CODIGO-NOVO', status: 'posted' })
        assertEquals(corpo.tracking_code, 'CODIGO-NOVO')
        assertEquals(supa.atualizacoes, [{
            valores: { tracking_code: 'CODIGO-NOVO' },
            filtros: [['id', PEDIDO_ID]],
        }])
        assertEquals(supa.pedidoAtual.tracking_code, 'CODIGO-NOVO')
    })
})
