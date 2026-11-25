// @ts-nocheck
// Caça por mutação (25/11/2026) no handler da melhor-envio-etiqueta: onde o
// dinheiro da loja é gasto (compra da etiqueta) e onde o pedido errado poderia
// ser etiquetado. Cada teste derruba um defeito plantado que passava por todos
// os testes antigos: "extras pagos" ligados no carrinho (aviso de recebimento,
// mão própria), 500 do checkout tratado como "não pagou" (liberaria o pedido
// para uma compra DUPLA), erro de gravação mascarado, protocolo do ME perdido
// no histórico, recusas que virariam 200. Banco e Melhor Envio são dublês
// locais (nada de rede, nada de token real); o dublê é próprio deste arquivo.
import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.177.0/testing/asserts.ts"

// ── Costura de rede da porta de admin (mesma estratégia dos testes antigos) ──
const fetchNativo = globalThis.fetch
const URL_SUPA_TESTE = "https://supa-fake.local"
const ID_ADMIN = "admin-1111-2222"

const fetchAdminFalso = ((input: any) => {
    const url = String(input instanceof Request ? input.url : input)
    const json = (dados: unknown) =>
        new Response(JSON.stringify(dados), { status: 200, headers: { "Content-Type": "application/json" } })
    if (url.includes("/auth/v1/user")) {
        return json({
            id: ID_ADMIN,
            email: "admin@teste.local",
            aud: "authenticated",
            role: "authenticated",
            app_metadata: { provider: "email", role: "admin" },
        })
    }
    if (url.includes("/rest/v1/profiles")) return json({ id: ID_ADMIN, role: "admin" })
    return new Response(JSON.stringify({ message: "fora do roteiro" }), { status: 404 })
}) as any

globalThis.fetch = fetchAdminFalso
const { handler } = await import("./index.ts")
globalThis.fetch = fetchNativo

const ENV_ADMIN: Array<[string, string]> = [
    ["SUPABASE_URL", URL_SUPA_TESTE],
    ["SUPABASE_PUBLISHABLE_KEYS", JSON.stringify({ default: "anon-chave-de-teste" })],
    ["SUPABASE_SECRET_KEYS", JSON.stringify({ default: "service-role-de-teste" })],
]

async function comAdmin<T>(executar: () => Promise<T>): Promise<T> {
    const anteriores = ENV_ADMIN.map(([chave]) => [chave, Deno.env.get(chave)] as const)
    for (const [chave, valor] of ENV_ADMIN) Deno.env.set(chave, valor)
    const fetchAnterior = globalThis.fetch
    globalThis.fetch = fetchAdminFalso
    try {
        return await executar()
    } finally {
        globalThis.fetch = fetchAnterior
        for (const [chave, valor] of anteriores) {
            if (valor === undefined) Deno.env.delete(chave)
            else Deno.env.set(chave, valor)
        }
    }
}

// ── Dados fictícios ─────────────────────────────────────────────────────────
const LABEL_ID = "label-abc-123"
const PEDIDO = {
    id: "pedido-1",
    status: "processing",
    payment_status: "pago",
    tracking_code: null,
    shipping_label_id: null,
    shipping_label_url: null,
    customer_name: "Maria Souza",
    customer_data: {
        cep: "38500-000",
        street: "Rua Antiga",
        number: "42",
        city: "Monte Carmelo",
        state: "MG",
        shipping_option_id: "melhor-envio-1",
        cpf: "52998224725", // CPF válido de teste
    },
}
const CONTA_ME = {
    name: "Loja do Gabriel",
    companies: [{ name: "IKCOUS", company_document: "12345678000199", phone: "34999990000" }],
    addresses: [
        {
            postal_code: "38500-000",
            address: "Rua A",
            number: "10",
            district: "Centro",
            city: { city: "Monte Carmelo", state_abbr: "MG" },
            is_default: true,
        },
    ],
}
const pedidoCom = (extra: Record<string, unknown>, dados: Record<string, unknown> = {}) => ({
    ...PEDIDO,
    ...extra,
    customer_data: { ...PEDIDO.customer_data, ...dados },
})

type ConfigBanco = {
    pedido?: any
    /** O que a leitura do pedido devolve quando dá erro do banco, MESMO com a linha presente. */
    erroNaLeituraDoPedido?: boolean
    erroNaCredencial?: boolean
    credentials?: Record<string, unknown>
    linhasReivindicadas?: any[]
    /** A reivindicação devolve erro do banco JUNTO com uma linha. */
    erroNaReivindicacao?: boolean
    /** O update que completa o pedido (url da etiqueta) falha. */
    erroNoUpdateDaUrl?: boolean
    erroNoUpdateDoCpf?: boolean
    linhasCpf?: any[]
}

/** Supabase em miniatura que anota tudo o que o handler grava (assento dos testes). */
function banco(configuracao: ConfigBanco = {}) {
    const pedidoAtual = configuracao.pedido === undefined ? { ...PEDIDO } : configuracao.pedido
    let leituras = 0
    const registro = {
        pedidoAtual,
        reivindicacoes: [] as any[],
        liberacoes: [] as any[],
        atualizacoesDeUrl: [] as any[],
        atualizacoesDeRastreio: [] as any[],
        atualizacoesDeCpf: [] as any[],
        eventos: [] as any[],
    }
    const resolver = (no: any): Promise<any> => {
        if (no.tabela === "store_shipping_credentials") {
            if (configuracao.erroNaCredencial) {
                return Promise.resolve({ data: null, error: { code: "XX000", message: "falha simulada" } })
            }
            return Promise.resolve({
                data: { credentials: configuracao.credentials ?? { token: "token-me-de-teste", sandbox: true } },
                error: null,
            })
        }
        if (no.tabela === "order_shipping_events") {
            registro.eventos.push(no.valores)
            return Promise.resolve({ data: null, error: null })
        }
        if (no.tabela === "marketplace_order_items") {
            return Promise.resolve({ data: [{ product_id: "p1", quantity: 1, price: 10 }], error: null })
        }
        if (no.tabela === "produtos") {
            return Promise.resolve({ data: [{ id: "p1", nome: "Caneca", preco_venda: 10 }], error: null })
        }
        if (no.acao === "update") {
            const valores = no.valores || {}
            const bate = pedidoAtual && no.filtros.every((f: any) => {
                if (f.metodo === "eq" || f.metodo === "is") return Reflect.get(pedidoAtual, f.coluna) === f.valor
                return true
            })
            if ("customer_data" in valores) {
                registro.atualizacoesDeCpf.push({ valores, filtros: [...no.filtros] })
                if (configuracao.erroNoUpdateDoCpf) {
                    return Promise.resolve({ data: null, error: { code: "XX000", message: "falha simulada" } })
                }
                return Promise.resolve({ data: configuracao.linhasCpf ?? [{ id: pedidoAtual?.id ?? "pedido-1" }], error: null })
            }
            if ("tracking_code" in valores) {
                registro.atualizacoesDeRastreio.push({ valores, filtros: [...no.filtros] })
                if (bate) Object.assign(pedidoAtual, valores)
                return Promise.resolve({ data: null, error: null })
            }
            if ("shipping_label_id" in valores && valores.shipping_label_id === null) {
                registro.liberacoes.push({ valores, filtros: [...no.filtros] })
                if (bate) Object.assign(pedidoAtual, valores)
                return Promise.resolve({ data: null, error: null })
            }
            if ("shipping_label_url" in valores) {
                registro.atualizacoesDeUrl.push({ valores, filtros: [...no.filtros] })
                if (configuracao.erroNoUpdateDaUrl) {
                    return Promise.resolve({ data: null, error: { code: "XX000", message: "falha simulada" } })
                }
                if (bate) Object.assign(pedidoAtual, valores)
                return Promise.resolve({ data: null, error: null })
            }
            // Reivindicação: shipping_label_id NULL -> labelId.
            registro.reivindicacoes.push({ valores, filtros: [...no.filtros] })
            const linhas = configuracao.linhasReivindicadas ?? [{ id: pedidoAtual?.id ?? "pedido-1" }]
            if (bate && linhas.length) Object.assign(pedidoAtual, valores)
            return Promise.resolve({
                data: linhas,
                error: configuracao.erroNaReivindicacao ? { code: "XX000", message: "falha simulada" } : null,
            })
        }
        leituras++
        if (configuracao.erroNaLeituraDoPedido && leituras === 1) {
            return Promise.resolve({ data: pedidoAtual ? { ...pedidoAtual } : null, error: { code: "XX000", message: "falha simulada" } })
        }
        return Promise.resolve({ data: pedidoAtual ? { ...pedidoAtual } : null, error: null })
    }
    const cliente = {
        from(tabela: string) {
            const no: any = { tabela, acao: null, valores: null, filtros: [] }
            const api: any = {
                select(colunas?: string) {
                    no.colunas = colunas
                    return api
                },
                insert(valores: any) {
                    no.acao = "insert"
                    no.valores = valores
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
                is(coluna: string, valor: any) {
                    no.filtros.push({ metodo: "is", coluna, valor })
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
    return { cliente, registro }
}

type ConfigMe = {
    conta?: unknown
    cartCorpo?: unknown
    checkoutStatus?: number
    generateStatus?: number
    meExcecao?: boolean
}

/** Melhor Envio falso: roteia pela URL e CONTA o que foi chamado (assento do dinheiro). */
function melhorEnvio(opcoes: ConfigMe = {}) {
    const registro = {
        chamadas: [] as string[],
        carrinho: 0,
        remocoes: 0,
        checkouts: 0,
        corpoDoCarrinho: null as any,
    }
    const resposta = (corpo: unknown, status = 200) =>
        new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } })
    const buscar = (async (input: any, init?: any) => {
        const url = String(input instanceof Request ? input.url : input)
        const metodo = String(init?.method || "GET")
        registro.chamadas.push(`${metodo} ${url}`)
        if (url.endsWith("/api/v2/me/cart") && metodo === "POST") {
            registro.carrinho++
            registro.corpoDoCarrinho = JSON.parse(String(init?.body || "{}"))
            return resposta(opcoes.cartCorpo !== undefined ? opcoes.cartCorpo : { id: LABEL_ID, protocol: "proto-1" }, 201)
        }
        if (url.includes("/api/v2/me/cart/") && metodo === "DELETE") {
            registro.remocoes++
            return resposta({})
        }
        if (url.endsWith("/api/v2/me/shipment/checkout")) {
            registro.checkouts++
            if (opcoes.checkoutStatus && opcoes.checkoutStatus !== 200) {
                return resposta({ error: "falha do checkout" }, opcoes.checkoutStatus)
            }
            return resposta({ purchase: { id: "pur-1", status: "paid" } })
        }
        if (url.endsWith("/api/v2/me/shipment/generate")) {
            if (opcoes.generateStatus && opcoes.generateStatus !== 200) {
                return resposta({ error: "falha da geração" }, opcoes.generateStatus)
            }
            return resposta({})
        }
        if (url.endsWith("/api/v2/me/shipment/print")) return resposta({ url: "https://imprimir.teste/etiqueta" })
        if (url.endsWith("/api/v2/me/shipment/tracking")) {
            return resposta({ [LABEL_ID]: { tracking: "ME123456789BR", status: "generated" } })
        }
        if (url.endsWith("/api/v2/me")) {
            if (opcoes.meExcecao) throw new Error("queda de rede simulada")
            return resposta(opcoes.conta !== undefined ? opcoes.conta : CONTA_ME)
        }
        return resposta({ message: "url fora do roteiro" }, 404)
    }) as any
    return { buscar, registro }
}

async function chamar(
    corpo: Record<string, unknown>,
    ambiente: { banco?: ReturnType<typeof banco>; me?: ReturnType<typeof melhorEnvio> } = {},
) {
    const supa = ambiente.banco ?? banco()
    const me = ambiente.me ?? melhorEnvio()
    const resposta = await comAdmin(() =>
        handler(
            new Request("http://localhost/melhor-envio-etiqueta", {
                method: "POST",
                headers: { Authorization: "Bearer jwt-admin-de-teste" },
                body: JSON.stringify(corpo),
            }),
            { supabase: supa.cliente, buscar: me.buscar, esperar: async () => {} },
        )
    )
    return { status: resposta.status, corpo: await resposta.json(), supa, me }
}
const gerar = (ambiente = {}, extra: Record<string, unknown> = {}) =>
    chamar({ action: "gerar_etiqueta", orderId: "pedido-1", ...extra }, ambiente)

// ── Id do pedido ────────────────────────────────────────────────────────────

Deno.test("id do pedido vazio, número, nulo ou objeto: 400 antes de qualquer leitura (nada de admin, banco ou ME)", async () => {
    for (const orderId of ["", 123, null, {}]) {
        const resposta = await handler(
            new Request("https://x/", { method: "POST", body: JSON.stringify({ action: "gerar_etiqueta", orderId }) }),
        )
        assertEquals(resposta.status, 400, `orderId=${JSON.stringify(orderId)}`)
        assertEquals((await resposta.json()).error, "Id do pedido é obrigatório.")
    }
})

// ── definir_cpf_destinatario ────────────────────────────────────────────────

const CPF_OK = "529.982.247-25"

Deno.test("definir CPF de pedido que não existe: 404 (nunca 500) e nada gravado", async () => {
    const r = await chamar({ action: "definir_cpf_destinatario", orderId: "pedido-1", cpf: CPF_OK }, { banco: banco({ pedido: null }) })
    assertEquals(r.status, 404)
    assertEquals(r.corpo.error, "Pedido não encontrado.")
    assertEquals(r.supa.registro.atualizacoesDeCpf, [])
})

Deno.test("definir CPF com erro do banco na leitura, mesmo trazendo a linha: 404 e nada gravado (a linha não vale)", async () => {
    const r = await chamar(
        { action: "definir_cpf_destinatario", orderId: "pedido-1", cpf: CPF_OK },
        { banco: banco({ pedido: pedidoCom({}, { cpf: undefined }), erroNaLeituraDoPedido: true }) },
    )
    assertEquals(r.status, 404)
    assertEquals(r.supa.registro.atualizacoesDeCpf, [])
})

Deno.test("definir CPF: falha ao gravar vira 500 com recado (nunca 200 'salvo'), e o CPF inteiro não volta na resposta", async () => {
    const r = await chamar(
        { action: "definir_cpf_destinatario", orderId: "pedido-1", cpf: CPF_OK },
        { banco: banco({ pedido: pedidoCom({}, { cpf: undefined }), erroNoUpdateDoCpf: true }) },
    )
    assertEquals(r.status, 500)
    assertStringIncludes(r.corpo.error, "Não foi possível salvar o CPF")
    assertEquals(JSON.stringify(r.corpo).includes("52998224725"), false)
})

Deno.test("definir CPF: o endereço em formato que NÃO é objeto (texto, nulo, lista) fica exatamente como estava; só o objeto perde o cpf", async () => {
    const casos: Array<[string, unknown, unknown]> = [
        ["texto", "Rua Velha, 10", "Rua Velha, 10"],
        ["nulo", null, null],
        ["lista", ["Rua", "10"], ["Rua", "10"]],
    ]
    for (const [rotulo, endereco, esperado] of casos) {
        const r = await chamar(
            { action: "definir_cpf_destinatario", orderId: "pedido-1", cpf: CPF_OK },
            { banco: banco({ pedido: pedidoCom({}, { cpf: undefined, address: endereco }) }) },
        )
        assertEquals(r.status, 200, rotulo)
        const gravado = r.supa.registro.atualizacoesDeCpf[0].valores.customer_data
        assertEquals(gravado.address, esperado, rotulo)
        assertEquals(gravado.cpf, "52998224725")
    }
    // Sem a chave `address`, nenhuma é inventada.
    const semEndereco = await chamar(
        { action: "definir_cpf_destinatario", orderId: "pedido-1", cpf: CPF_OK },
        { banco: banco({ pedido: pedidoCom({}, { cpf: undefined }) }) },
    )
    assertEquals("address" in semEndereco.supa.registro.atualizacoesDeCpf[0].valores.customer_data, false)
    // Endereço objeto com cpf preso: o cpf sai, o resto fica.
    const comCpfPreso = await chamar(
        { action: "definir_cpf_destinatario", orderId: "pedido-1", cpf: CPF_OK },
        { banco: banco({ pedido: pedidoCom({}, { cpf: undefined, address: { street: "Rua A", cpf: "11111111111" } }) }) },
    )
    assertEquals(comCpfPreso.supa.registro.atualizacoesDeCpf[0].valores.customer_data.address, { street: "Rua A" })
})

// ── Credencial e token do Melhor Envio ──────────────────────────────────────

Deno.test("erro ao ler a credencial do ME: 500 com recado, nenhuma chamada ao ME, nas duas ações", async () => {
    for (const action of ["gerar_etiqueta", "consultar_rastreio"]) {
        const me = melhorEnvio()
        const r = await chamar({ action, orderId: "pedido-1" }, { banco: banco({ erroNaCredencial: true }), me })
        assertEquals(r.status, 500, action)
        assertStringIncludes(r.corpo.error, "Não consegui ler a credencial do Melhor Envio")
        assertEquals(me.registro.chamadas, [])
    }
})

Deno.test("sem token do ME cadastrado: 400 antes de qualquer chamada, nas duas ações", async () => {
    for (const action of ["gerar_etiqueta", "consultar_rastreio"]) {
        const me = melhorEnvio()
        const r = await chamar({ action, orderId: "pedido-1" }, { banco: banco({ credentials: {} }), me })
        assertEquals(r.status, 400, action)
        assertStringIncludes(r.corpo.error, "Token do Melhor Envio não configurado")
        assertEquals(me.registro.chamadas, [])
    }
})

// ── consultar_rastreio ──────────────────────────────────────────────────────

Deno.test("consultar rastreio: pedido inexistente = 404 e pedido sem etiqueta = 400, sem falar com o ME", async () => {
    const me = melhorEnvio()
    const inexistente = await chamar({ action: "consultar_rastreio", orderId: "pedido-1" }, { banco: banco({ pedido: null }), me })
    assertEquals(inexistente.status, 404)
    const semEtiqueta = await chamar({ action: "consultar_rastreio", orderId: "pedido-1" }, { banco: banco(), me })
    assertEquals(semEtiqueta.status, 400)
    assertStringIncludes(semEtiqueta.corpo.error, "ainda não tem etiqueta")
    assertEquals(me.registro.chamadas, [])
})

// ── gerar_etiqueta: pedido certo, uma vez só ────────────────────────────────

Deno.test("gerar etiqueta de pedido inexistente: 404 e nenhuma chamada ao ME", async () => {
    const me = melhorEnvio()
    const r = await gerar({ banco: banco({ pedido: null }), me })
    assertEquals(r.status, 404)
    assertEquals(me.registro.chamadas, [])
})

Deno.test("pedido que JÁ tem etiqueta não compra outra: responde success + already com a etiqueta existente, sem tocar no ME", async () => {
    const me = melhorEnvio()
    const pedido = pedidoCom({
        shipping_label_id: "etiqueta-antiga",
        shipping_label_url: "https://imprimir.teste/antiga",
        tracking_code: "ME000000000BR",
    })
    const r = await gerar({ banco: banco({ pedido }), me })
    assertEquals(r.status, 200)
    assertEquals(r.corpo, {
        success: true,
        already: true,
        tracking_code: "ME000000000BR",
        label_url: "https://imprimir.teste/antiga",
        label_id: "etiqueta-antiga",
    })
    assertEquals(me.registro.chamadas, [])
})

Deno.test("conta do ME sem cadastro de remetente: 400, nada é criado no carrinho do ME", async () => {
    const me = melhorEnvio({ conta: {} })
    const r = await gerar({ me })
    assertEquals(r.status, 400)
    assertStringIncludes(r.corpo.error, "não tem cadastro completo de remetente")
    assertEquals(me.registro.carrinho, 0)
})

Deno.test("queda de rede ao ler o remetente: 500 genérico (nunca 200), sem carrinho nem reivindicação", async () => {
    const me = melhorEnvio({ meExcecao: true })
    const supa = banco()
    const r = await gerar({ banco: supa, me })
    assertEquals(r.status, 500)
    assertStringIncludes(r.corpo.error, "Não foi possível gerar a etiqueta agora")
    assertEquals(me.registro.carrinho, 0)
    assertEquals(supa.registro.reivindicacoes, [])
})

// ── O carrinho do ME: o que é pedido e o que NÃO pode ser pedido (cobra a mais) ──

Deno.test("carrinho do ME: sem aviso de recebimento, sem mão própria, sem reversa, não comercial, seguro = subtotal dos itens", async () => {
    const me = melhorEnvio()
    const r = await gerar({ me })
    assertEquals(r.status, 200)
    assertEquals(me.registro.corpoDoCarrinho.options, {
        insurance_value: 10,
        receipt: false,
        own_hand: false,
        reverse: false,
        non_commercial: true,
    })
})

Deno.test("destinatário no carrinho: WhatsApp vale mais que telefone; sem nenhum, o padrão; e-mail e complemento só quando existem", async () => {
    const casos: Array<[string, Record<string, unknown>, string]> = [
        ["whatsapp e telefone", { whatsapp: "(34) 99999-0000", phone: "(34) 3333-4444" }, "34999990000"],
        ["só whatsapp", { whatsapp: "(34) 99999-0000" }, "34999990000"],
        ["só telefone", { phone: "(34) 3333-4444" }, "3433334444"],
        ["nenhum dos dois", {}, "0000000000"],
    ]
    for (const [rotulo, contatos, esperado] of casos) {
        const me = melhorEnvio()
        const r = await gerar({ banco: banco({ pedido: pedidoCom({}, contatos) }), me })
        assertEquals(r.status, 200, rotulo)
        assertEquals(me.registro.corpoDoCarrinho.to.phone, esperado, rotulo)
    }
    const completo = melhorEnvio()
    await gerar({ banco: banco({ pedido: pedidoCom({}, { email: "maria@example.com", complement: "Apto 3" }) }), me: completo })
    assertEquals(completo.registro.corpoDoCarrinho.to.email, "maria@example.com")
    assertEquals(completo.registro.corpoDoCarrinho.to.complement, "Apto 3")
    const simples = melhorEnvio()
    await gerar({ me: simples })
    assertEquals(simples.registro.corpoDoCarrinho.to.email, null)
    assertEquals(simples.registro.corpoDoCarrinho.to.complement, null)
})

Deno.test("carrinho do ME que volta sem id (corpo nulo, texto ou lista): 502, sem reivindicar o pedido", async () => {
    for (const cartCorpo of [null, "ok", [], {}]) {
        const me = melhorEnvio({ cartCorpo })
        const supa = banco()
        const r = await gerar({ banco: supa, me })
        assertEquals(r.status, 502, JSON.stringify(cartCorpo))
        assertStringIncludes(r.corpo.error, "não devolveu o id da etiqueta")
        assertEquals(supa.registro.reivindicacoes, [])
        assertEquals(me.registro.checkouts, 0)
    }
})

// ── A trava anti-compra-dupla (reivindicação) ───────────────────────────────

Deno.test("reivindicação com erro do banco, mesmo trazendo uma linha: conta como corrida perdida (409), tira o item do carrinho e NÃO compra", async () => {
    const me = melhorEnvio()
    const supa = banco({ erroNaReivindicacao: true })
    const r = await gerar({ banco: supa, me })
    assertEquals(r.status, 409)
    assertEquals(r.corpo.resgate, true)
    assertEquals(me.registro.checkouts, 0)
    assertEquals(me.registro.remocoes, 1)
})

Deno.test("corrida perdida na reivindicação: 409, item removido, nada pago e o protocolo do ME fica no histórico", async () => {
    const me = melhorEnvio()
    const supa = banco({ linhasReivindicadas: [] })
    const r = await gerar({ banco: supa, me })
    assertEquals(r.status, 409)
    assertEquals(me.registro.checkouts, 0)
    assertEquals(supa.registro.eventos.at(-1).protocol, "proto-1")
    assertEquals(supa.registro.eventos.at(-1).payload.etapa, "reivindicacao")
})

// ── Checkout: só 4xx significa "não pagou"; 5xx (inclusive 500) é INDETERMINADO ──

Deno.test("checkout com HTTP 500: estado INDETERMINADO — o vínculo fica, o carrinho não é mexido e o histórico leva o protocolo (nada de liberar para pagar de novo)", async () => {
    const me = melhorEnvio({ checkoutStatus: 500 })
    const supa = banco()
    const r = await gerar({ banco: supa, me })
    assertEquals(r.status, 502)
    assertEquals(r.corpo.resgate, true)
    assertStringIncludes(r.corpo.error, "INDETERMINADO")
    assertEquals(supa.registro.liberacoes, [], "liberar aqui permitiria uma segunda compra")
    assertEquals(me.registro.remocoes, 0)
    assertEquals(supa.registro.pedidoAtual.shipping_label_id, LABEL_ID)
    const evento = supa.registro.eventos.at(-1)
    assertEquals(evento.payload.etapa, "checkout_indeterminado")
    assertEquals(evento.protocol, "proto-1")
})

Deno.test("checkout recusado com 422: o ME disse que não pagou — item removido, vínculo liberado e o histórico leva o protocolo", async () => {
    const me = melhorEnvio({ checkoutStatus: 422 })
    const supa = banco()
    const r = await gerar({ banco: supa, me })
    assertEquals(r.status, 502)
    assertEquals(me.registro.remocoes, 1)
    assertEquals(supa.registro.liberacoes.length, 1)
    assertEquals(supa.registro.pedidoAtual.shipping_label_id, null)
    assertEquals(supa.registro.eventos.at(-1).payload.etapa, "checkout")
    assertEquals(supa.registro.eventos.at(-1).protocol, "proto-1")
})

Deno.test("geração do arquivo falha DEPOIS de pago: o vínculo fica, resposta 502 'resgate' e o histórico leva o protocolo", async () => {
    const me = melhorEnvio({ generateStatus: 500 })
    const supa = banco()
    const r = await gerar({ banco: supa, me })
    assertEquals(r.status, 502)
    assertEquals(r.corpo.resgate, true)
    assertEquals(r.corpo.label_id, LABEL_ID)
    assertEquals(supa.registro.liberacoes, [])
    assertEquals(supa.registro.pedidoAtual.shipping_label_id, LABEL_ID)
    assertEquals(supa.registro.eventos.at(-1).payload.etapa, "generate")
    assertEquals(supa.registro.eventos.at(-1).protocol, "proto-1")
})

// ── Fim feliz e gravação final ──────────────────────────────────────────────

Deno.test("etiqueta gerada: resposta e histórico carregam protocolo, compra (purchase_id), rastreio e link; o rastreio só entra com código", async () => {
    const me = melhorEnvio()
    const supa = banco()
    const r = await gerar({ banco: supa, me })
    assertEquals(r.status, 200)
    assertEquals(r.corpo, {
        success: true,
        already: false,
        tracking_code: "ME123456789BR",
        label_url: "https://imprimir.teste/etiqueta",
        label_id: LABEL_ID,
        protocol: "proto-1",
        sandbox: true,
    })
    const evento = supa.registro.eventos.at(-1)
    assertEquals(evento.event_type, "etiqueta_gerada")
    assertEquals(evento.protocol, "proto-1")
    assertEquals(evento.payload.purchase_id, "pur-1")
    assertEquals(evento.tracking_code, "ME123456789BR")
    assertEquals(supa.registro.atualizacoesDeRastreio.length, 1)
    assertEquals(supa.registro.atualizacoesDeRastreio[0].valores, { tracking_code: "ME123456789BR" })
})

Deno.test("etiqueta paga mas a gravação da url falha: 500 'resgate' com o id, e o erro NÃO é mascarado pela gravação do rastreio", async () => {
    const me = melhorEnvio()
    const supa = banco({ erroNoUpdateDaUrl: true })
    const r = await gerar({ banco: supa, me })
    assertEquals(r.status, 500)
    assertEquals(r.corpo.resgate, true)
    assertEquals(r.corpo.label_id, LABEL_ID)
    assertStringIncludes(r.corpo.error, "link de impressão ou o rastreio não foi salvo")
    assertEquals(supa.registro.atualizacoesDeRastreio, [], "com a primeira gravação falha, não segue para a segunda")
    const evento = supa.registro.eventos.at(-1)
    assertEquals(evento.payload.etapa, "gravacao")
    assertEquals(evento.protocol, "proto-1")
    assertEquals(evento.tracking_code, "ME123456789BR")
})

Deno.test("etiqueta paga SEM código de rastreio ainda: grava a url e não tenta gravar rastreio vazio", async () => {
    const me = melhorEnvio()
    const semRastreio = ((input: any, init?: any) => {
        if (String(input).endsWith("/api/v2/me/shipment/tracking")) {
            return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))
        }
        return me.buscar(input, init)
    }) as any
    const supa = banco()
    const resposta = await comAdmin(() =>
        handler(
            new Request("http://localhost/melhor-envio-etiqueta", {
                method: "POST",
                headers: { Authorization: "Bearer jwt-admin-de-teste" },
                body: JSON.stringify({ action: "gerar_etiqueta", orderId: "pedido-1" }),
            }),
            { supabase: supa.cliente, buscar: semRastreio, esperar: async () => {} },
        )
    )
    const corpo = await resposta.json()
    assertEquals(resposta.status, 200)
    assertEquals(corpo.tracking_code, null)
    assertEquals(supa.registro.atualizacoesDeUrl.length, 1)
    assertEquals(supa.registro.atualizacoesDeRastreio, [], "sem código, nada de update de rastreio")
    assert(supa.registro.pedidoAtual.tracking_code === null)
})
