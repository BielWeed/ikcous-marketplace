// @ts-nocheck
// Testes da function melhor-envio-etiqueta (padrão calculate-shipping:
// funções puras exportadas + handler com costura de deps — sem rede).
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

function respostaAdminFalsa(url: string): Response {
    if (url.includes('/auth/v1/user')) {
        return new Response(
            JSON.stringify({ id: ID_ADMIN, email: 'admin@teste.local', aud: 'authenticated', role: 'authenticated' }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
    }
    if (url.includes('/rest/v1/profiles')) {
        // `.single()` pede o accept vnd.pgrst.object — o SERVIDOR é quem
        // devolve objeto (não array); o fake imita o servidor.
        return new Response(
            JSON.stringify({ id: ID_ADMIN, role: 'admin' }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
    }
    return new Response(
        JSON.stringify({ message: 'fora do roteiro do teste' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } },
    )
}

const fetchAdminFalso = ((input: any) =>
    respostaAdminFalsa(String(input instanceof Request ? input.url : input))) as any

globalThis.fetch = fetchAdminFalso
const {
    extrairEnderecoDoPedido,
    extrairServiceIdDaOpcao,
    handler,
    montarProdutosEVolumes,
    montarRemetente,
    normalizarCheckout,
    normalizarTracking,
    erroDePagamentoParaEtiqueta,
    erroDePedidoParaEtiqueta,
} = await import('./index.ts')
globalThis.fetch = fetchNativo

/** Instala o fetch admin falso SÓ durante a chamada ao handler. */
async function comAdminFalso(executar: () => Promise<any>): Promise<any> {
    const anterior = globalThis.fetch
    globalThis.fetch = fetchAdminFalso
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

// ── extrairServiceIdDaOpcao ────────────────────────────────────────────────

Deno.test("service id - opção melhor-envio guarda os dígitos do serviço", () => {
  assertEquals(extrairServiceIdDaOpcao("melhor-envio-12345"), "12345")
})

Deno.test("service id - frete fixo, entrega local e null não casam", () => {
  assertEquals(extrairServiceIdDaOpcao("flat-fee-standard"), null)
  assertEquals(extrairServiceIdDaOpcao("local-delivery"), null)
  assertEquals(extrairServiceIdDaOpcao(null), null)
  assertEquals(extrairServiceIdDaOpcao("melhor-envio-abc"), null)
})

// ── extrairEnderecoDoPedido ────────────────────────────────────────────────

Deno.test("endereço - snapshot addressData vence (mesma prioridade do mapper)", () => {
  const cd = {
    cep: "38500-000",
    city: "Monte Carmelo",
    street: "Rua Antiga",
    addressData: {
      cep: "01310-100",
      street: "Av. Paulista",
      number: "1000",
      city: "São Paulo",
      state: "SP",
      neighborhood: "Bela Vista",
    },
  }
  const endereco = extrairEnderecoDoPedido(cd)
  assertEquals(endereco.cep, "01310100") // só dígitos, pronto para o ME
  assertEquals(endereco.street, "Av. Paulista")
  assertEquals(endereco.city, "São Paulo")
})

Deno.test("endereço - sem snapshot, cai na raiz do customer_data", () => {
  const cd = {
    cep: "38500000",
    address_text: "Rua da Matriz",
    number: "42",
    city: "Monte Carmelo",
    state: "MG",
    neighborhood: "Centro",
  }
  const endereco = extrairEnderecoDoPedido(cd)
  assertEquals(endereco.street, "Rua da Matriz")
  assertEquals(endereco.number, "42")
})

Deno.test("endereço - faltou CEP, rua, número ou cidade: recusa", () => {
  assertEquals(extrairEnderecoDoPedido({ city: "Monte Carmelo", street: "Rua", number: "1" }), null)
  assertEquals(extrairEnderecoDoPedido({ cep: "38500000", street: "Rua", number: "1" }), null)
  assertEquals(extrairEnderecoDoPedido({ cep: "38500000", city: "X", number: "1" }), null)
  assertEquals(extrairEnderecoDoPedido({ cep: "38500000", city: "X", street: "Rua" }), null)
  assertEquals(extrairEnderecoDoPedido(null), null)
})

// ── erroDePedidoParaEtiqueta ───────────────────────────────────────────────

Deno.test("portão de status - cancelado e entregue não geram etiqueta", () => {
  assertEquals(erroDePedidoParaEtiqueta({ status: "cancelled" }) !== null, true)
  assertEquals(erroDePedidoParaEtiqueta({ status: "delivered" }) !== null, true)
  assertEquals(erroDePedidoParaEtiqueta({ status: "returned" }) !== null, true)
})

Deno.test("portão de status - processando e novo passam", () => {
  assertEquals(erroDePedidoParaEtiqueta({ status: "processing" }), null)
  assertEquals(erroDePedidoParaEtiqueta({ status: "new" }), null)
  assertEquals(erroDePedidoParaEtiqueta({ status: null }), null)
})

// ── erroDePagamentoParaEtiqueta (falha fechado — só pago etiqueta) ─────────

Deno.test("portão de pagamento - os TRÊS valores de dinheiro que entrou passam (revisor, item D da 2ª rodada)", () => {
  assertEquals(erroDePagamentoParaEtiqueta("pago"), null)
  assertEquals(erroDePagamentoParaEtiqueta("pago_apos_expirar"), null)
  assertEquals(erroDePagamentoParaEtiqueta("recebido_na_entrega"), null) // pago na mão pelo lojista
  assertEquals(erroDePagamentoParaEtiqueta("PAGO"), null) // case-insensitive
})

Deno.test("portão de pagamento - aguardando, recusado, expirado, estornado e NULL recusados (falha fechado)", () => {
  assertEquals(erroDePagamentoParaEtiqueta("aguardando") !== null, true)
  assertEquals(erroDePagamentoParaEtiqueta("recusado") !== null, true)
  assertEquals(erroDePagamentoParaEtiqueta("expirado") !== null, true)
  assertEquals(erroDePagamentoParaEtiqueta("estornado") !== null, true)
  // NULL = pedido antigo (pré-coluna) ou não confirmado: recusa.
  assertEquals(erroDePagamentoParaEtiqueta(null) !== null, true)
  assertEquals(erroDePagamentoParaEtiqueta(undefined) !== null, true)
  assertEquals(erroDePagamentoParaEtiqueta("") !== null, true)
})

// ── montarProdutosEVolumes ─────────────────────────────────────────────────

Deno.test("produtos e volumes - leitura do banco com fallbacks da cotação", () => {
  // Coluna de preço real do schema vivo: `price` (marketplace_order_items).
  const itens = [
    { product_id: "p1", quantity: 2, price: 10 },
    { product_id: "p2", quantity: 1, price: 5 },
  ]
  const produtosDb = [
    { id: "p1", nome: "Caneca", preco_venda: 25, peso_kg: 0.4, largura_cm: 10, altura_cm: 12, comprimento_cm: 14 },
  ]
  const { products, volumes } = montarProdutosEVolumes(itens, produtosDb)
  assertEquals(products.length, 2)
  assertEquals(volumes.length, 2)
  // Produto no banco: preço e medida do banco, peso da LINHA (0.4 × 2).
  assertEquals(products[0], { name: "Caneca", quantity: 2, unitary_value: 25 })
  assertEquals(volumes[0], { weight: 0.8, width: 10, height: 12, length: 14 })
  // Produto fora do banco: fallbacks iguais aos do calculate-shipping.
  assertEquals(products[1], { name: "Produto", quantity: 1, unitary_value: 5 })
  assertEquals(volumes[1], { weight: 0.3, width: 15, height: 15, length: 15 })
})

// ── montarRemetente ────────────────────────────────────────────────────────

Deno.test("remetente - empresa + endereço padrão da conta ME viram o from", () => {
  const meData = {
    name: "Loja do Gabriel",
    email: "loja@teste.com",
    companies: [{ name: "IKCOUS", company_document: "12345678000199", phone: "34999990000" }],
    addresses: [
      { postal_code: "38500-000", address: "Rua A", number: "10", district: "Centro", city: { city: "Monte Carmelo", state_abbr: "MG" }, is_default: false },
      { postal_code: "01310100", address: "Av. B", number: "20", district: "Bela Vista", city: { city: "São Paulo", state_abbr: "SP" }, is_default: true },
    ],
  }
  const from = montarRemetente(meData)
  assertEquals(from.company_document, "12345678000199")
  assertEquals(from.document, undefined) // PJ não leva CPF junto
  assertEquals(from.postal_code, "01310100") // endereço PADRÃO, não o primeiro
  assertEquals(from.state_abbr, "SP")
  assertEquals(from.country_id, "BR")
})

Deno.test("remetente - falta documento ou CEP válido: null (falha antes de gastar saldo)", () => {
  assertEquals(montarRemetente({ companies: [{}], addresses: [{ postal_code: "38500000", city: { city: "X", state_abbr: "MG" } }] }), null)
  assertEquals(montarRemetente({ companies: [{ company_document: "123" }], addresses: [{ postal_code: "123", city: { city: "X", state_abbr: "MG" } }] }), null)
  assertEquals(montarRemetente(null), null)
})

// ── normalizarCheckout ─────────────────────────────────────────────────────

Deno.test("checkout - status paid fecha a compra", () => {
  const r = normalizarCheckout({ purchase: { id: "pur-1", status: "paid" } })
  assertEquals(r.pago, true)
  assertEquals(r.purchaseId, "pur-1")
})

Deno.test("checkout - 200 sem pagamento não engana: status pendente vira erro amigável", () => {
  const r = normalizarCheckout({ purchase: { id: "pur-2", status: "pending" } })
  assertEquals(r.pago, false)
  assertEquals(String(r.erro).includes("saldo"), true)
})

// ── normalizarTracking ─────────────────────────────────────────────────────

Deno.test("tracking - objeto chaveado pelo id da etiqueta", () => {
  const data = { "abc-123": { tracking: "ME23002OWZ7BR", status: "posted" } }
  assertEquals(normalizarTracking(data, "abc-123").tracking, "ME23002OWZ7BR")
  assertEquals(normalizarTracking(data, "abc-123").status, "posted")
})

Deno.test("tracking - vazio NÃO é erro: etiqueta recém-gerada pode não ter código", () => {
  assertEquals(normalizarTracking({ "abc-123": {} }, "abc-123").tracking, null)
  assertEquals(normalizarTracking({}, "abc-123").tracking, null)
})

// ── handler (costura de deps, sem rede) ────────────────────────────────────

function respostaJson(res: Response): Promise<any> {
  return res.json()
}

Deno.test("handler - OPTIONS responde ok (CORS)", async () => {
  const res = await handler(new Request("https://x/", { method: "OPTIONS" }))
  assertEquals(res.status, 200)
})

Deno.test("handler - sem orderId recusa antes de qualquer leitura", async () => {
  const res = await handler(
    new Request("https://x/", { method: "POST", body: JSON.stringify({ action: "gerar_etiqueta" }) }),
  )
  assertEquals(res.status, 400)
  const corpo = await respostaJson(res)
  assertEquals(String(corpo.error).includes("pedido"), true)
})

Deno.test("handler - sem Authorization NÃO passa da porta de admin", async () => {
  const res = await handler(
    new Request("https://x/", {
      method: "POST",
      body: JSON.stringify({ action: "gerar_etiqueta", orderId: "00000000-0000-0000-0000-000000000000" }),
    }),
  )
  assertEquals(res.status, 403)
  const corpo = await respostaJson(res)
  assertEquals(String(corpo.error).includes("administradores"), true)
})

Deno.test("handler - action desconhecida nomeia as duas válidas e NÃO alcança leitura de pedido", async () => {
  // Com a porta de admin PASSANDO (env + fetch admin falsos), a action
  // estranha morre no portão da action: 400 nomeando as duas válidas —
  // nenhuma leitura de pedido acontece. O `403 || 400` antigo não provava
  // nada: o 403 era só o JWT falso caindo na porta de admin antes.
  await comEnvAdmin(async () => {
    const supa = clienteFalso({ pedido: PEDIDO_FELIZ })
    const res = await comAdminFalso(() =>
      handler(requisicaoGerar("apagar_tudo"), { supabase: supa.cliente, buscar: buscarMeFalso().buscar }))
    assertEquals(res.status, 400)
    const corpo = await respostaJson(res)
    assertEquals(String(corpo.error).includes("apagar_tudo"), true)
    assertEquals(String(corpo.error).includes("gerar_etiqueta"), true)
    assertEquals(String(corpo.error).includes("consultar_rastreio"), true)
  })
})

// ── handler: os ramos de DINHEIRO (revisor, item C da 2ª rodada, PR #423) ──
// O handler é exercido DE PONTA A PONTA com supabase falso (chainable, que
// registra reivindicação/liberação/eventos) e fetch do ME falso (que conta
// carrinho/remoção/checkout). É a prova dos três ramos de dinheiro:
// checkout recusado, corrida perdida e checkout indeterminado.

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
function clienteFalso(configuracao: { pedido?: any; linhasReivindicadas?: any[] } = {}) {
    const registro = {
        reivindicacoes: [] as Array<{ valores: any; filtros: any[] }>,
        liberacoes: [] as Array<{ valores: any; filtros: any[] }>,
        completacoes: [] as Array<{ valores: any; filtros: any[] }>,
        eventos: [] as any[],
    }
    const resolver = (no: any): Promise<any> => {
        if (no.tabela === 'store_shipping_credentials') {
            return Promise.resolve({
                data: { credentials: { token: 'token-me-de-teste', sandbox: true } },
                error: null,
            })
        }
        if (no.tabela === 'order_shipping_events') {
            registro.eventos.push(no.valores)
            return Promise.resolve({ data: null, error: null })
        }
        if (no.tabela === 'marketplace_order_items') {
            return Promise.resolve({ data: [{ product_id: 'p1', quantity: 1, price: 10 }], error: null })
        }
        if (no.tabela === 'produtos') {
            return Promise.resolve({ data: [{ id: 'p1', nome: 'Caneca', preco_venda: 10 }], error: null })
        }
        // marketplace_orders
        if (no.acao === 'update') {
            const soltaVinculo = 'shipping_label_id' in (no.valores || {}) && no.valores.shipping_label_id === null
            const tomaVinculo = 'shipping_label_id' in (no.valores || {}) && no.valores.shipping_label_id !== null
            if (soltaVinculo) {
                registro.liberacoes.push({ valores: no.valores, filtros: [...no.filtros] })
                return Promise.resolve({ data: null, error: null })
            }
            if (tomaVinculo) {
                registro.reivindicacoes.push({ valores: no.valores, filtros: [...no.filtros] })
                // Quem vence a corrida recebe 1 linha; o teste que arma
                // `linhasReivindicadas: []` simula o perdedor.
                const linhas = configuracao.linhasReivindicadas ?? [{ id: configuracao.pedido?.id ?? 'pedido-1' }]
                return Promise.resolve({ data: linhas, error: null })
            }
            registro.completacoes.push({ valores: no.valores, filtros: [...no.filtros] })
            return Promise.resolve({ data: null, error: null })
        }
        return Promise.resolve({ data: configuracao.pedido ?? null, error: null })
    }
    const cliente = {
        from(tabela: string) {
            const no: any = { tabela, acao: null, valores: null, filtros: [] }
            const api: any = {
                select(_colunas?: string) {
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
function buscarMeFalso(opcoes: { checkout?: 'pago' | 'pendente' | 'excecao' | 'erro-5xx' } = {}) {
    const registro = { carrinho: 0, remocoes: 0, checkouts: 0, geracoes: 0 }
    const buscar = (async (input: any, init?: any) => {
        const url = String(input instanceof Request ? input.url : input)
        const metodo = String(init?.method || 'GET')
        if (url.endsWith('/api/v2/me/cart') && metodo === 'POST') {
            registro.carrinho++
            return new Response(JSON.stringify({ id: LABEL_ID, protocol: 'proto-1' }), {
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
            return new Response(JSON.stringify({ purchase: { id: 'pur-1', status } }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            })
        }
        if (url.endsWith('/api/v2/me/shipment/generate')) {
            registro.geracoes++
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

function requisicaoGerar(action = "gerar_etiqueta"): Request {
  return new Request("http://localhost/melhor-envio-etiqueta", {
    method: "POST",
    headers: { Authorization: "Bearer jwt-admin-de-teste" },
    body: JSON.stringify({ action, orderId: "pedido-1" }),
  })
}

Deno.test("handler - checkout recusado (200 com status pending): item sai do carrinho E reivindicação LIBERADA (o pedido volta a poder etiquetar)", async () => {
    // O ME RESPONDEU que não pagou — não há ambiguidade: é exatamente o caso
    // que deixava o pedido preso para sempre (bloqueante A da 2ª rodada).
    await comEnvAdmin(async () => {
        const supa = clienteFalso({ pedido: PEDIDO_FELIZ })
        const me = buscarMeFalso({ checkout: 'pendente' })
        const res = await comAdminFalso(() =>
            handler(requisicaoGerar(), { supabase: supa.cliente, buscar: me.buscar }))
        assertEquals(res.status, 502)
        const corpo = await res.json()
        assertEquals(String(corpo.error).includes('saldo'), true)
        // item removido do carrinho do ME (nada para "comprar o carrinho" sem querer)
        assertEquals(me.registro.remocoes, 1)
        // liberação com update CONDICIONAL: os dois filtros (id do pedido E o
        // vínculo desta corrida) e o valor voltando a null
        assertEquals(supa.registro.liberacoes.length, 1)
        assertEquals(supa.registro.liberacoes[0].valores, { shipping_label_id: null })
        const colunasLiberacao = supa.registro.liberacoes[0].filtros
            .filter((f) => f.metodo === 'eq')
            .map((f) => f.coluna)
        assertEquals(colunasLiberacao.includes('id'), true)
        assertEquals(colunasLiberacao.includes('shipping_label_id'), true)
        // o evento de erro sai com a etapa certa
        assertEquals(supa.registro.eventos.length, 1)
        assertEquals(supa.registro.eventos[0].event_type, 'erro')
        assertEquals(supa.registro.eventos[0].payload.etapa, 'checkout')
        assertEquals(supa.registro.eventos[0].payload.label_id, LABEL_ID)
        // ramo que LIBERA não é resgate: o card pode reapresentar o botão
        assertEquals(corpo.resgate, undefined)
    })
})

Deno.test("handler - corrida perdida (reivindicação devolve 0 linhas): 409, item removido do carrinho e checkout NUNCA é chamado", async () => {
    // O perdedor da corrida remove o PRÓPRIO item e não chega perto do saldo.
    await comEnvAdmin(async () => {
        const supa = clienteFalso({ pedido: PEDIDO_FELIZ, linhasReivindicadas: [] })
        const me = buscarMeFalso()
        const res = await comAdminFalso(() =>
            handler(requisicaoGerar(), { supabase: supa.cliente, buscar: me.buscar }))
        assertEquals(res.status, 409)
        // E′: 409 é ramo de RESGATE por contrato (o card sai do modo gasto)
        const corpo = await res.json()
        assertEquals(corpo.resgate, true)
        assertEquals(corpo.label_id, LABEL_ID)
        assertEquals(me.registro.carrinho, 1) // a etiqueta foi criada no carrinho…
        assertEquals(me.registro.remocoes, 1) // …e o perdedor remove o próprio item
        assertEquals(me.registro.checkouts, 0) // e NUNCA chama o checkout (dinheiro)
        assertEquals(supa.registro.reivindicacoes.length, 1)
        assertEquals(supa.registro.liberacoes.length, 0)
        assertEquals(supa.registro.eventos.length, 1)
        assertEquals(supa.registro.eventos[0].event_type, 'erro')
        assertEquals(supa.registro.eventos[0].payload.etapa, 'reivindicacao')
    })
})

Deno.test("handler - checkout estoura pós-reivindicação (exceção): evento checkout_indeterminado gravado e reivindicação MANTIDA", async () => {
    // Aqui a ambiguidade de dinheiro é REAL (o ME pode ter processado com a
    // resposta perdida): não libera, não mexe no carrinho — registra e manda
    // conferir a conta do ME (caminho B mínimo da 2ª rodada).
    await comEnvAdmin(async () => {
        const supa = clienteFalso({ pedido: PEDIDO_FELIZ })
        const me = buscarMeFalso({ checkout: 'excecao' })
        const res = await comAdminFalso(() =>
            handler(requisicaoGerar(), { supabase: supa.cliente, buscar: me.buscar }))
        assertEquals(res.status, 502)
        const corpo = await res.json()
        // a resposta NOMEIA o id da etiqueta e manda conferir a conta do ME
        assertEquals(String(corpo.error).includes(LABEL_ID), true)
        assertEquals(String(corpo.error).includes('INDETERMINADO'), true)
        // E′: indeterminado também é resgate por contrato
        assertEquals(corpo.resgate, true)
        assertEquals(corpo.label_id, LABEL_ID)
        assertEquals(me.registro.checkouts, 1)
        // indeterminado = NÃO liberar a reivindicação e NÃO mexer no carrinho
        assertEquals(supa.registro.liberacoes.length, 0)
        assertEquals(me.registro.remocoes, 0)
        // e o estado fica REGISTRADO para o dono ver no histórico do pedido
        const evento = supa.registro.eventos.find((e) => e.payload?.etapa === 'checkout_indeterminado')
        assertEquals(evento !== undefined, true)
        assertEquals(evento.event_type, 'erro')
        assertEquals(evento.payload.label_id, LABEL_ID)
    })
})

Deno.test("handler - checkout responde 5xx de gateway: INDETERMINADO — reivindicação MANTIDA, carrinho intacto, sem liberação (A′)", async () => {
    // 5xx (500/502/504) NÃO é "o ME respondeu que não pagou": o gateway pode
    // ter DEBITADO com a resposta perdida. Liberar a reivindicação aqui
    // deixaria o próximo "Confirmar e gerar" pagar DE NOVO — a porta de
    // compra dupla que o A′ fecha (revisor, 3ª rodada, PR #423). Mesmo
    // tratamento do catch indeterminado, via finalizarIndeterminado.
    await comEnvAdmin(async () => {
        const supa = clienteFalso({ pedido: PEDIDO_FELIZ })
        const me = buscarMeFalso({ checkout: 'erro-5xx' })
        const res = await comAdminFalso(() =>
            handler(requisicaoGerar(), { supabase: supa.cliente, buscar: me.buscar }))
        assertEquals(res.status, 502)
        const corpo = await res.json()
        assertEquals(String(corpo.error).includes(LABEL_ID), true)
        assertEquals(String(corpo.error).includes('INDETERMINADO'), true)
        // E′: contrato de resgate (o card lê o campo, sem regex na prosa)
        assertEquals(corpo.resgate, true)
        assertEquals(corpo.label_id, LABEL_ID)
        assertEquals(me.registro.checkouts, 1)
        // A PROVA DO A′: nada liberado, nada removido — a ambiguidade fica
        // registrada e o vínculo impede a segunda compra
        assertEquals(supa.registro.liberacoes.length, 0)
        assertEquals(me.registro.remocoes, 0)
        const evento = supa.registro.eventos.find((e) => e.payload?.etapa === 'checkout_indeterminado')
        assertEquals(evento !== undefined, true)
        assertEquals(evento.event_type, 'erro')
        assertEquals(evento.payload.label_id, LABEL_ID)
    })
})
