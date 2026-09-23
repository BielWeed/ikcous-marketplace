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
    analisarOpcaoMelhorEnvio,
    extrairEnderecoDoPedido,
    extrairServiceIdDaOpcao,
    handler,
    montarProdutosEVolumes,
    montarRemetente,
    normalizarCheckout,
    normalizarTracking,
    erroDeAgenciaObrigatoria,
    erroDePagamentoParaEtiqueta,
    erroDePedidoParaEtiqueta,
    erroDeServicoParaEtiqueta,
    normalizarServicoEscolhidoPeloLojista,
} = await import('./index.ts')
const { cpfValido, cpfDoDestinatario, sanitizarCpfDoTexto } = await import('./cpf.ts')
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

/**
 * Captura as linhas de `console.log` durante o bloco — usada só para provar
 * o marcador `ua_contato:legado` (contrato 1.5.7, R3-7) sem acoplar no
 * formato completo da mensagem de log.
 */
async function comConsoleLogCapturado(executar: () => Promise<void>): Promise<string[]> {
    const linhas: string[] = []
    const original = console.log
    console.log = ((...args: any[]) => { linhas.push(args.map(String).join(' ')) }) as any
    try {
        await executar()
    } finally {
        console.log = original
    }
    return linhas
}

/** Mesma ideia de `comConsoleLogCapturado`, para `console.error` — usada para
 *  provar que o CPF nunca aparece cru num log (achado da revisão Opus sobre
 *  o commit aadbf4c: o `cart sem id` ecoava o corpo cru do ME). */
async function comConsoleErrorCapturado(executar: () => Promise<void>): Promise<string[]> {
    const linhas: string[] = []
    const original = console.error
    console.error = ((...args: any[]) => { linhas.push(args.map(String).join(' ')) }) as any
    try {
        await executar()
    } finally {
        console.error = original
    }
    return linhas
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

// ── analisarOpcaoMelhorEnvio (contrato 1.5.7, R1-6: captura completa,
// ^melhor-envio-(\d+)(-ss)?$, nunca parseInt parcial nem startsWith) ───────

Deno.test("opção ME - id com sufixo -ss é seguro ZERO; extrairServiceIdDaOpcao continua achando só os dígitos", () => {
  assertEquals(analisarOpcaoMelhorEnvio("melhor-envio-31-ss"), { id: "31", semSeguro: true })
  assertEquals(extrairServiceIdDaOpcao("melhor-envio-31-ss"), "31")
})

Deno.test("opção ME - id sem sufixo é seguro do subtotal (padrão de hoje)", () => {
  assertEquals(analisarOpcaoMelhorEnvio("melhor-envio-31"), { id: "31", semSeguro: false })
})

Deno.test("opção ME - superfrete-*, frenet-*, formato quebrado e sufixo errado não casam", () => {
  assertEquals(analisarOpcaoMelhorEnvio("superfrete-1"), null)
  assertEquals(analisarOpcaoMelhorEnvio("frenet-ABC123"), null)
  assertEquals(analisarOpcaoMelhorEnvio("melhor-envio-abc-ss"), null)
  assertEquals(analisarOpcaoMelhorEnvio("melhor-envio-31-outro"), null)
  assertEquals(analisarOpcaoMelhorEnvio(null), null)
})

// ── erroDeAgenciaObrigatoria (contrato §5/A7: LATAM 12, Azul 15/16, Buslog 22) ──

Deno.test("agência obrigatória - ids 12, 15, 16 e 22 recusam com a mensagem do site do Melhor Envio", () => {
  for (const id of ["12", "15", "16", "22"]) {
    const mensagem = erroDeAgenciaObrigatoria(id)
    assertEquals(mensagem !== null, true)
    assertEquals(String(mensagem).includes("Melhor Envio"), true)
    assertEquals(String(mensagem).toLowerCase().includes("agência") || String(mensagem).toLowerCase().includes("agencia"), true)
  }
})

Deno.test("agência obrigatória - qualquer outro id passa (null)", () => {
  assertEquals(erroDeAgenciaObrigatoria("1"), null)
  assertEquals(erroDeAgenciaObrigatoria("31"), null)
  assertEquals(erroDeAgenciaObrigatoria("120"), null) // não é '12' — string inteira, não substring
})

// ── erroDeServicoParaEtiqueta (achado index-691: a recusa tem que dizer a
// verdade — frete grátis NÃO é frete fixo nem entrega local) ────────────────

Deno.test("erro de serviço - frete grátis (sem opção, shipping=0) diz a verdade e oferece escolher o serviço", () => {
  const { mensagem, podeEscolherServico } = erroDeServicoParaEtiqueta(null, 0)
  const msg = mensagem.toLowerCase()
  assertEquals(msg.includes("frete fixo"), false)
  assertEquals(msg.includes("entrega local"), false)
  assertEquals(msg.includes("grátis") || msg.includes("gratis"), true)
  assertEquals(podeEscolherServico, true)
})

Deno.test("erro de serviço - entrega local de verdade continua sem oferecer serviço do ME", () => {
  const { mensagem, podeEscolherServico } = erroDeServicoParaEtiqueta("local-delivery", 10)
  assertEquals(mensagem.toLowerCase().includes("entrega local"), true)
  assertEquals(podeEscolherServico, false)
})

Deno.test("erro de serviço - pedido antigo sem opção salva (shipping > 0) recebe mensagem genérica honesta", () => {
  const { mensagem, podeEscolherServico } = erroDeServicoParaEtiqueta(null, 45.9)
  const msg = mensagem.toLowerCase()
  assertEquals(msg.includes("frete fixo"), false)
  assertEquals(podeEscolherServico, true)
})

// ── normalizarServicoEscolhidoPeloLojista ───────────────────────────────────

Deno.test("serviço escolhido pelo lojista - só dígitos, igual ao formato do checkout", () => {
  assertEquals(normalizarServicoEscolhidoPeloLojista("77"), "77")
  assertEquals(normalizarServicoEscolhidoPeloLojista(" 77 "), "77")
  assertEquals(normalizarServicoEscolhidoPeloLojista("melhor-envio-77"), null)
  assertEquals(normalizarServicoEscolhidoPeloLojista(""), null)
  assertEquals(normalizarServicoEscolhidoPeloLojista(null), null)
  assertEquals(normalizarServicoEscolhidoPeloLojista(77), null)
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
  // Produto no banco: nome e medida do banco; PREÇO é o VENDIDO no pedido
  // (item.price = 10, gravado pela RPC), NUNCA o preco_venda atual do
  // catálogo (25) — correção pós-revisão Opus. Peso da LINHA (0.4 × 2).
  assertEquals(products[0], { name: "Caneca", quantity: 2, unitary_value: 10 })
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
function clienteFalso(configuracao: { pedido?: any; linhasReivindicadas?: any[]; linhasCpfAtualizadas?: any[]; itens?: any[]; produtosDb?: any[]; credentials?: any } = {}) {
    const registro = {
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
            const atualizaCpf = 'customer_data' in (no.valores || {})
            if (atualizaCpf) {
                registro.cpfAtualizacoes.push({ valores: no.valores, filtros: [...no.filtros] })
                // O teste que arma `linhasCpfAtualizadas: []` simula a corrida
                // perdida (update condicional que não bateu em nenhuma linha).
                const linhas = configuracao.linhasCpfAtualizadas ?? [{ id: configuracao.pedido?.id ?? 'pedido-1' }]
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
function buscarMeFalso(opcoes: { checkout?: 'pago' | 'pendente' | 'excecao' | 'erro-5xx'; cartSemId?: boolean; cartSemIdPayload?: Record<string, unknown> } = {}) {
    const registro = {
        carrinho: 0,
        remocoes: 0,
        checkouts: 0,
        geracoes: 0,
        chamadasMe: 0,
        ultimoServico: null as string | null,
        ultimoInsuranceValue: null as number | null,
        ultimoProducts: null as Array<Record<string, unknown>> | null,
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
                registro.ultimoTo = corpo?.to ?? null
            } catch {
                registro.ultimoServico = null
                registro.ultimoInsuranceValue = null
                registro.ultimoProducts = null
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

// ── handler: achado index-691 — pedido de frete grátis não gera etiqueta e a
// recusa mentia o motivo ("foi frete fixo ou entrega local"). ──────────────

Deno.test("handler - frete grátis sem opção escolhida: recusa 400 diz o motivo VERDADEIRO e nunca chega a criar etiqueta no ME", async () => {
    await comEnvAdmin(async () => {
        // CartView.tsx:495 esconde a calculadora no grátis — nasce sem
        // shipping_option_id, com shipping=0 (não é frete fixo nem local).
        const pedidoFreteGratis = {
            ...PEDIDO_FELIZ,
            shipping: 0,
            customer_data: { ...PEDIDO_FELIZ.customer_data, shipping_option_id: null },
        }
        const supa = clienteFalso({ pedido: pedidoFreteGratis })
        const me = buscarMeFalso()
        const res = await comAdminFalso(() =>
            handler(requisicaoGerar(), { supabase: supa.cliente, buscar: me.buscar }))
        assertEquals(res.status, 400)
        const corpo = await res.json()
        const mensagem = String(corpo.error).toLowerCase()
        // a recusa NÃO pode mais culpar um motivo que não é o verdadeiro
        assertEquals(mensagem.includes('frete fixo'), false)
        assertEquals(mensagem.includes('entrega local'), false)
        assertEquals(mensagem.includes('grátis') || mensagem.includes('gratis'), true)
        // contrato para o card (tarefa irmã EtiquetasEnvioCard): sinaliza que
        // dá para oferecer a escolha do serviço em vez de só recusar
        assertEquals(corpo.precisa_escolher_servico, true)
        // recusou ANTES de gastar qualquer chamada de dinheiro no ME
        assertEquals(me.registro.carrinho, 0)
    })
})

Deno.test("handler - entrega local de verdade continua recusando (aqui o motivo É esse) e não ganha seletor de serviço", async () => {
    await comEnvAdmin(async () => {
        const pedidoEntregaLocal = {
            ...PEDIDO_FELIZ,
            shipping: 10,
            customer_data: { ...PEDIDO_FELIZ.customer_data, shipping_option_id: 'local-delivery' },
        }
        const supa = clienteFalso({ pedido: pedidoEntregaLocal })
        const me = buscarMeFalso()
        const res = await comAdminFalso(() =>
            handler(requisicaoGerar(), { supabase: supa.cliente, buscar: me.buscar }))
        assertEquals(res.status, 400)
        const corpo = await res.json()
        assertEquals(String(corpo.error).toLowerCase().includes('entrega local'), true)
        assertEquals(corpo.precisa_escolher_servico, false)
        assertEquals(me.registro.carrinho, 0)
    })
})

// RETIRADA NA LOJA (release 1.5.3): a cliente busca o pedido no balcão —
// não existe envio, e a etiqueta seria dinheiro gasto do saldo do Melhor
// Envio à toa. Sem o ramo próprio, `store-pickup` com frete 0 caía em "saiu
// com frete grátis… escolha o serviço" (podeEscolherServico: true) e o
// lojista conseguia COMPRAR a etiqueta escolhendo um serviço no card.
Deno.test("erro de serviço - retirada na loja recusa etiqueta e NÃO oferece escolher serviço", () => {
  const { mensagem, podeEscolherServico } = erroDeServicoParaEtiqueta("store-pickup", 0)
  const msg = mensagem.toLowerCase()
  assertEquals(msg.includes("retira"), true)
  assertEquals(msg.includes("grátis") || msg.includes("gratis"), false)
  assertEquals(podeEscolherServico, false)
})

Deno.test("handler - retirada na loja com serviceId no corpo recusa: nenhuma etiqueta, nenhum carrinho no ME", async () => {
    await comEnvAdmin(async () => {
        const pedidoRetirada = {
            ...PEDIDO_FELIZ,
            shipping: 0,
            customer_data: {
                ...PEDIDO_FELIZ.customer_data,
                shipping_option_id: 'store-pickup',
                pickup_address: 'Rua Fictícia de Teste, 100 — Centro',
            },
        }
        for (const corpoExtra of [{}, { serviceId: '77' }]) {
            const supa = clienteFalso({ pedido: pedidoRetirada })
            const me = buscarMeFalso()
            const res = await comAdminFalso(() =>
                handler(requisicaoGerar('gerar_etiqueta', corpoExtra), { supabase: supa.cliente, buscar: me.buscar }))
            assertEquals(res.status, 400)
            const corpo = await res.json()
            assertEquals(String(corpo.error).toLowerCase().includes('retira'), true)
            assertEquals(corpo.precisa_escolher_servico, false)
            assertEquals(me.registro.carrinho, 0)
        }
    })
})

Deno.test("handler - entrega local com serviceId no corpo continua recusando: o override só vale quando a recusa autoriza", async () => {
    await comEnvAdmin(async () => {
        // Ressalva da revisão de index-691: a mensagem dizia
        // podeEscolherServico=false, mas o servidor aceitava o serviceId do
        // corpo mesmo assim — pedido de entrega local (quem despacha é a
        // própria loja) NUNCA pode comprar etiqueta.
        const pedidoEntregaLocal = {
            ...PEDIDO_FELIZ,
            shipping: 10,
            customer_data: { ...PEDIDO_FELIZ.customer_data, shipping_option_id: 'local-delivery' },
        }
        const supa = clienteFalso({ pedido: pedidoEntregaLocal })
        const me = buscarMeFalso()
        const res = await comAdminFalso(() =>
            handler(requisicaoGerar('gerar_etiqueta', { serviceId: '77' }), { supabase: supa.cliente, buscar: me.buscar }))
        assertEquals(res.status, 400)
        const corpo = await res.json()
        assertEquals(corpo.precisa_escolher_servico, false)
        assertEquals(me.registro.carrinho, 0)
    })
})

Deno.test("handler - pedido antigo com frete em shipping_cost (shipping no DEFAULT 0) não é tratado como frete grátis", async () => {
    await comEnvAdmin(async () => {
        const pedidoAntigo = {
            ...PEDIDO_FELIZ,
            shipping: 0,
            shipping_cost: 45.9,
            customer_data: { ...PEDIDO_FELIZ.customer_data, shipping_option_id: null },
        }
        const supa = clienteFalso({ pedido: pedidoAntigo })
        const me = buscarMeFalso()
        const res = await comAdminFalso(() =>
            handler(requisicaoGerar(), { supabase: supa.cliente, buscar: me.buscar }))
        assertEquals(res.status, 400)
        const corpo = await res.json()
        assertEquals(String(corpo.error).toLowerCase().includes('frete grátis'), false)
        assertEquals(corpo.precisa_escolher_servico, true)
    })
})

Deno.test("handler - lojista escolhe o serviço na hora de etiquetar um pedido de frete grátis: etiqueta sai normalmente", async () => {
    await comEnvAdmin(async () => {
        const pedidoFreteGratis = {
            ...PEDIDO_FELIZ,
            shipping: 0,
            customer_data: { ...PEDIDO_FELIZ.customer_data, shipping_option_id: null },
        }
        const supa = clienteFalso({ pedido: pedidoFreteGratis })
        const me = buscarMeFalso()
        const res = await comAdminFalso(() =>
            handler(requisicaoGerar('gerar_etiqueta', { serviceId: '77' }), { supabase: supa.cliente, buscar: me.buscar }))
        assertEquals(res.status, 200)
        const corpo = await res.json()
        assertEquals(corpo.success, true)
        assertEquals(corpo.label_id, LABEL_ID)
        // o serviço que chegou no carrinho do ME foi o que o LOJISTA escolheu
        assertEquals(me.registro.carrinho, 1)
        assertEquals(me.registro.ultimoServico, '77')
    })
})

Deno.test("handler - opção do checkout (quando existe) SEMPRE vence o serviço escolhido no card — override só serve para o caso sem opção", async () => {
    await comEnvAdmin(async () => {
        // PEDIDO_FELIZ já tem shipping_option_id: 'melhor-envio-1' — um
        // serviceId no corpo não pode reescrever o que o CLIENTE pagou.
        const supa = clienteFalso({ pedido: PEDIDO_FELIZ })
        const me = buscarMeFalso()
        const res = await comAdminFalso(() =>
            handler(requisicaoGerar('gerar_etiqueta', { serviceId: '999' }), { supabase: supa.cliente, buscar: me.buscar }))
        assertEquals(res.status, 200)
        assertEquals(me.registro.ultimoServico, '1')
    })
})

// --- SUPERFRETE (release 1.5.4) ---------------------------------------------
// Pedido cotado e cobrado pela SuperFrete (`superfrete-<id>`) não tem etiqueta
// pelo Melhor Envio: a etiqueta é feita no site da SuperFrete. Sem o ramo
// próprio, `superfrete-1` com frete > 0 caía na recusa genérica com
// podeEscolherServico: true — e um `serviceId` no corpo COMPRAVA a etiqueta no
// ME com o saldo da lojista, para um frete de outra transportadora.
Deno.test("erro de serviço - pedido cotado pela SuperFrete recusa etiqueta e NÃO oferece escolher serviço", () => {
    for (const frete of [25, 0]) {
        const { mensagem, podeEscolherServico } = erroDeServicoParaEtiqueta('superfrete-1', frete)
        assertEquals(podeEscolherServico, false)
        assertEquals(mensagem.includes('SuperFrete'), true)
    }
})

// --- FRENET (release 1.5.7) -------------------------------------------------
// Mesma ideia do ramo SuperFrete: pedido cotado e cobrado pela Frenet não tem
// etiqueta pelo Melhor Envio (contrato 1.5.7, §5/R1-6).
Deno.test("erro de serviço - pedido cotado pela Frenet recusa etiqueta e NÃO oferece escolher serviço, com frete 0 e com frete > 0", () => {
    for (const frete of [25, 0]) {
        const { mensagem, podeEscolherServico } = erroDeServicoParaEtiqueta('frenet-ABC123', frete)
        assertEquals(podeEscolherServico, false)
        assertEquals(mensagem.includes('Frenet'), true)
    }
})

Deno.test("handler - pedido superfrete-* com serviceId no corpo recusa 400 com frete 0 e com frete > 0: nenhuma chamada de rede ao ME (nem o GET /me)", async () => {
    await comEnvAdmin(async () => {
        for (const shipping of [18.61, 0]) {
            const pedidoSuperFrete = {
                ...PEDIDO_FELIZ,
                shipping,
                customer_data: { ...PEDIDO_FELIZ.customer_data, shipping_option_id: 'superfrete-1' },
            }
            for (const corpoExtra of [{ serviceId: '1' }, {}]) {
                const supa = clienteFalso({ pedido: pedidoSuperFrete })
                const me = buscarMeFalso()
                const urls: string[] = []
                const buscarQueAnota = ((input: any, init?: any) => {
                    urls.push(`${String(init?.method || 'GET')} ${String(input instanceof Request ? input.url : input)}`)
                    return me.buscar(input, init)
                }) as any
                const res = await comAdminFalso(() =>
                    handler(requisicaoGerar('gerar_etiqueta', corpoExtra), { supabase: supa.cliente, buscar: buscarQueAnota }))
                assertEquals(res.status, 400)
                const corpo = await res.json()
                assertEquals(corpo.precisa_escolher_servico, false)
                assertEquals(String(corpo.error).includes('SuperFrete'), true)
                assertEquals(me.registro.carrinho, 0)
                assertEquals(me.registro.checkouts, 0)
                assertEquals(me.registro.geracoes, 0)
                // contrato 1.5.7, §5: nenhuma chamada ao ME, INCLUSIVE o GET /me
                assertEquals(me.registro.chamadasMe, 0)
                assertEquals(urls, [])
            }
        }
    })
})

// --- FRENET (release 1.5.7) -------------------------------------------------
// Pedido cotado e cobrado pela Frenet (`frenet-<ServiceCode>`) não tem
// etiqueta pelo Melhor Envio — mesmo contrato do ramo SuperFrete acima.
Deno.test("handler - pedido frenet-* com serviceId no corpo recusa 400 com frete 0 e com frete > 0: nenhuma chamada de rede ao ME (nem o GET /me)", async () => {
    await comEnvAdmin(async () => {
        for (const shipping of [18.61, 0]) {
            const pedidoFrenet = {
                ...PEDIDO_FELIZ,
                shipping,
                customer_data: { ...PEDIDO_FELIZ.customer_data, shipping_option_id: 'frenet-ABC123' },
            }
            for (const corpoExtra of [{ serviceId: '1' }, {}]) {
                const supa = clienteFalso({ pedido: pedidoFrenet })
                const me = buscarMeFalso()
                const urls: string[] = []
                const buscarQueAnota = ((input: any, init?: any) => {
                    urls.push(`${String(init?.method || 'GET')} ${String(input instanceof Request ? input.url : input)}`)
                    return me.buscar(input, init)
                }) as any
                const res = await comAdminFalso(() =>
                    handler(requisicaoGerar('gerar_etiqueta', corpoExtra), { supabase: supa.cliente, buscar: buscarQueAnota }))
                assertEquals(res.status, 400)
                const corpo = await res.json()
                assertEquals(corpo.precisa_escolher_servico, false)
                assertEquals(String(corpo.error).includes('Frenet'), true)
                assertEquals(me.registro.carrinho, 0)
                assertEquals(me.registro.checkouts, 0)
                assertEquals(me.registro.geracoes, 0)
                assertEquals(me.registro.chamadasMe, 0)
                assertEquals(urls, [])
            }
        }
    })
})

// --- Ids que exigem agência de coleta (LATAM 12, Azul 15/16, Buslog 22) ----

Deno.test("handler - opção do CHECKOUT com id que exige agência recusa SEM oferecer novo serviço (o cliente já pagou por este) e sem chamada nenhuma ao ME", async () => {
    await comEnvAdmin(async () => {
        for (const idAgencia of ['12', '15', '16', '22']) {
            const pedido = {
                ...PEDIDO_FELIZ,
                customer_data: { ...PEDIDO_FELIZ.customer_data, shipping_option_id: `melhor-envio-${idAgencia}` },
            }
            const supa = clienteFalso({ pedido })
            let chamadas = 0
            const buscarQueConta = (() => {
                chamadas++
                throw new Error('não deveria chamar rede nenhuma do ME')
            }) as any
            const res = await comAdminFalso(() =>
                handler(requisicaoGerar(), { supabase: supa.cliente, buscar: buscarQueConta }))
            assertEquals(res.status, 400)
            const corpo = await res.json()
            assertEquals(String(corpo.error).includes('Melhor Envio'), true)
            assertEquals(corpo.precisa_escolher_servico, false)
            assertEquals(chamadas, 0)
        }
    })
})

Deno.test("handler - lojista escolhe manualmente um id que exige agência: recusa MAS pode tentar outro serviço, sem chamada nenhuma ao ME", async () => {
    await comEnvAdmin(async () => {
        for (const idAgencia of ['12', '15', '16', '22']) {
            // Frete grátis, sem opção salva no checkout — o lojista escolhe
            // agora (índice-691) e tropeça num id que exige agência.
            const pedidoFreteGratis = {
                ...PEDIDO_FELIZ,
                shipping: 0,
                customer_data: { ...PEDIDO_FELIZ.customer_data, shipping_option_id: null },
            }
            const supa = clienteFalso({ pedido: pedidoFreteGratis })
            let chamadas = 0
            const buscarQueConta = (() => {
                chamadas++
                throw new Error('não deveria chamar rede nenhuma do ME')
            }) as any
            const res = await comAdminFalso(() =>
                handler(requisicaoGerar('gerar_etiqueta', { serviceId: idAgencia }), { supabase: supa.cliente, buscar: buscarQueConta }))
            assertEquals(res.status, 400)
            const corpo = await res.json()
            assertEquals(String(corpo.error).includes('Melhor Envio'), true)
            // veio da escolha do LOJISTA (sem opção travada no checkout):
            // ele pode tentar um serviço diferente (R1-6 item 6).
            assertEquals(corpo.precisa_escolher_servico, true)
            assertEquals(chamadas, 0)
        }
    })
})

// --- Seguro coerente entre cotação e etiqueta (contrato A6/R1-6) ----------

Deno.test("handler - opção com sufixo -ss cota seguro ZERO no carrinho do ME", async () => {
    await comEnvAdmin(async () => {
        const pedidoSemSeguro = {
            ...PEDIDO_FELIZ,
            customer_data: { ...PEDIDO_FELIZ.customer_data, shipping_option_id: 'melhor-envio-1-ss' },
        }
        const supa = clienteFalso({ pedido: pedidoSemSeguro })
        const me = buscarMeFalso()
        const res = await comAdminFalso(() =>
            handler(requisicaoGerar(), { supabase: supa.cliente, buscar: me.buscar }))
        assertEquals(res.status, 200)
        assertEquals(me.registro.ultimoInsuranceValue, 0)
    })
})

Deno.test("handler - opção sem sufixo continua declarando o subtotal como seguro (comportamento de hoje preservado)", async () => {
    await comEnvAdmin(async () => {
        // PEDIDO_FELIZ tem shipping_option_id 'melhor-envio-1' (sem -ss) e o
        // clienteFalso devolve 1 item (price 10, quantity 1) -> subtotal 10.
        const supa = clienteFalso({ pedido: PEDIDO_FELIZ })
        const me = buscarMeFalso()
        const res = await comAdminFalso(() =>
            handler(requisicaoGerar(), { supabase: supa.cliente, buscar: me.buscar }))
        assertEquals(res.status, 200)
        assertEquals(me.registro.ultimoInsuranceValue, 10)
    })
})

// --- Item 5 do pacote L (regressão pós-revisão Opus): a base do SEGURO e da
// DECLARAÇÃO FISCAL da etiqueta é o valor VENDIDO no pedido (item.price,
// gravado pela RPC = COALESCE(price_override, preco_venda) no momento da
// compra) — NUNCA o preco_venda ATUAL do catálogo, que pode ter mudado desde
// a venda. Provado NO HANDLER (não só na função pura): produtos.preco_venda
// diverge do item.price de propósito, e o corpo real do POST /cart é
// inspecionado (contrato com o comentário do revisor, item 3).
Deno.test("handler - unitary_value e insurance_value usam o preço VENDIDO no pedido, não o preco_venda atual do catálogo", async () => {
    await comEnvAdmin(async () => {
        const supa = clienteFalso({
            pedido: PEDIDO_FELIZ,
            itens: [{ product_id: 'p1', quantity: 1, price: 80 }],
            produtosDb: [{ id: 'p1', nome: 'Caneca', preco_venda: 45 }],
        })
        const me = buscarMeFalso()
        const res = await comAdminFalso(() =>
            handler(requisicaoGerar(), { supabase: supa.cliente, buscar: me.buscar }))
        assertEquals(res.status, 200)
        assertEquals(me.registro.ultimoProducts, [{ name: 'Caneca', quantity: 1, unitary_value: 80 }])
        assertEquals(me.registro.ultimoInsuranceValue, 80)
    })
})

Deno.test("handler - opção -ss: unitary_value continua o preço VENDIDO (80), mas o seguro (insurance_value) vai a zero", async () => {
    await comEnvAdmin(async () => {
        const pedidoSemSeguro = {
            ...PEDIDO_FELIZ,
            customer_data: { ...PEDIDO_FELIZ.customer_data, shipping_option_id: 'melhor-envio-1-ss' },
        }
        const supa = clienteFalso({
            pedido: pedidoSemSeguro,
            itens: [{ product_id: 'p1', quantity: 1, price: 80 }],
            produtosDb: [{ id: 'p1', nome: 'Caneca', preco_venda: 45 }],
        })
        const me = buscarMeFalso()
        const res = await comAdminFalso(() =>
            handler(requisicaoGerar(), { supabase: supa.cliente, buscar: me.buscar }))
        assertEquals(res.status, 200)
        assertEquals(me.registro.ultimoProducts, [{ name: 'Caneca', quantity: 1, unitary_value: 80 }])
        assertEquals(me.registro.ultimoInsuranceValue, 0)
    })
})

// --- User-Agent com contact_email da credencial ME (contrato 1.5.7, R3-7,
// root 23/09: "Se precisa de email deve ter no app para eu colocar e não
// você colocar") ------------------------------------------------------------

Deno.test("handler - User-Agent do ME leva o contact_email da credencial melhor_envio em TODAS as chamadas", async () => {
    await comEnvAdmin(async () => {
        const supa = clienteFalso({
            pedido: PEDIDO_FELIZ,
            credentials: { token: 'token-me-de-teste', sandbox: true, contact_email: 'loja@exemplo.com.br' },
        })
        const me = buscarMeFalso()
        const res = await comAdminFalso(() =>
            handler(requisicaoGerar(), { supabase: supa.cliente, buscar: me.buscar }))
        assertEquals(res.status, 200)
        // pelo menos as chamadas do fluxo feliz: /me, /cart, /checkout, /generate, /print, /tracking
        assertEquals(me.registro.userAgentsVistos.length >= 5, true)
        // MESMO User-Agent em TODAS elas — um Set de tamanho 1
        assertEquals(new Set(me.registro.userAgentsVistos).size, 1)
        assertEquals(me.registro.userAgentsVistos[0], 'IKCOUS-Marketplace-Integration (loja@exemplo.com.br)')
    })
})

Deno.test("handler - sem contact_email na credencial ME cai no User-Agent legado, e o log marca a queda sem imprimir e-mail", async () => {
    await comEnvAdmin(async () => {
        const supa = clienteFalso({
            pedido: PEDIDO_FELIZ,
            credentials: { token: 'token-me-de-teste', sandbox: true }, // sem contact_email
        })
        const me = buscarMeFalso()
        const linhasDeLog = await comConsoleLogCapturado(async () => {
            const res = await comAdminFalso(() =>
                handler(requisicaoGerar(), { supabase: supa.cliente, buscar: me.buscar }))
            assertEquals(res.status, 200)
        })
        assertEquals(new Set(me.registro.userAgentsVistos).size, 1)
        assertEquals(me.registro.userAgentsVistos[0], 'IKCOUS-Marketplace-Integration (contato@ikcous.com.br)')
        assertEquals(linhasDeLog.some((l) => l.includes('ua_contato:legado')), true)
        // sem contact_email não há e-mail nenhum para vazar — mas garante
        // que a linha do log não tem arroba nenhuma
        assertEquals(linhasDeLog.some((l) => l.includes('@')), false)
    })
})

Deno.test("handler - o e-mail de contato do ME e o token NUNCA vazam na resposta pública (contrato R3-7)", async () => {
    await comEnvAdmin(async () => {
        const supa = clienteFalso({
            pedido: PEDIDO_FELIZ,
            credentials: { token: 'segredo-super-secreto-do-me', sandbox: true, contact_email: 'loja@exemplo.com.br' },
        })
        const me = buscarMeFalso()
        const res = await comAdminFalso(() =>
            handler(requisicaoGerar(), { supabase: supa.cliente, buscar: me.buscar }))
        const textoResposta = JSON.stringify(await res.json())
        assertEquals(textoResposta.includes('segredo-super-secreto-do-me'), false)
        assertEquals(textoResposta.includes('loja@exemplo.com.br'), false)
    })
})

// ============================================================================
// CPF do destinatário (requisito novo: o Melhor Envio exige `to.document`
// para inserir o frete no carrinho — docs.melhorenvio.com.br/reference/
// inserir-fretes-no-carrinho, "Documentos from/to"). Contrato com a frente
// de checkout: `customer_data.cpf` é STRING de 11 dígitos sem máscara,
// gravada só quando a entrega é por transportadora; pedido antigo não tem a
// chave.
// ============================================================================

// ── cpfValido / cpfDoDestinatario (funções puras, cpf.ts) ──────────────────

Deno.test("cpfValido - aceita CPF real com e sem máscara; recusa dígitos repetidos, checksum errado e tamanho errado", () => {
    assertEquals(cpfValido('529.982.247-25'), true)
    assertEquals(cpfValido('52998224725'), true)
    assertEquals(cpfValido('11111111111'), false) // todos os dígitos iguais
    assertEquals(cpfValido('00000000000'), false)
    assertEquals(cpfValido('52998224700'), false) // dígitos verificadores errados
    assertEquals(cpfValido('5299822472'), false) // 10 dígitos
    assertEquals(cpfValido('529982247256'), false) // 12 dígitos
    assertEquals(cpfValido(null), false)
    assertEquals(cpfValido(undefined), false)
    assertEquals(cpfValido(''), false)
    assertEquals(cpfValido({}), false)
})

Deno.test("cpfDoDestinatario - lê SÓ customer_data.cpf (nunca customer_data.document nem outro campo); ausente e inválido devolvem null", () => {
    assertEquals(cpfDoDestinatario({ cpf: '529.982.247-25' }), '52998224725')
    assertEquals(cpfDoDestinatario({ cpf: '52998224725' }), '52998224725')
    assertEquals(cpfDoDestinatario({}), null)
    assertEquals(cpfDoDestinatario({ cpf: null }), null)
    assertEquals(cpfDoDestinatario({ cpf: '' }), null)
    assertEquals(cpfDoDestinatario({ cpf: '11111111111' }), null)
    assertEquals(cpfDoDestinatario(null), null)
    assertEquals(cpfDoDestinatario(undefined), null)
    assertEquals(cpfDoDestinatario({ document: '52998224725' }), null)
})

// ── sanitizarCpfDoTexto ──────────────────────────────────────────────────

Deno.test("sanitizarCpfDoTexto - troca CPF mascarado e cru por [cpf], preserva o resto do texto", () => {
    assertEquals(
        sanitizarCpfDoTexto('to.document 529.982.247-25 é inválido para este destinatário'),
        'to.document [cpf] é inválido para este destinatário',
    )
    assertEquals(
        sanitizarCpfDoTexto('{"document":"52998224725","field":"to.document"}'),
        '{"document":"[cpf]","field":"to.document"}',
    )
    assertEquals(sanitizarCpfDoTexto('mensagem sem nada sensível aqui'), 'mensagem sem nada sensível aqui')
    // não confunde CEP (8 dígitos) nem telefone com DDI (mais de 11) com CPF
    assertEquals(sanitizarCpfDoTexto('CEP 38500000, telefone 5534999990000'), 'CEP 38500000, telefone 5534999990000')
})

// ── gerar_etiqueta: to.document e o portão de CPF ──────────────────────────

Deno.test("handler - carrinho do ME leva to.document = CPF do banco (11 dígitos, sem máscara)", async () => {
    await comEnvAdmin(async () => {
        const supa = clienteFalso({ pedido: PEDIDO_FELIZ })
        const me = buscarMeFalso()
        const res = await comAdminFalso(() =>
            handler(requisicaoGerar(), { supabase: supa.cliente, buscar: me.buscar }))
        assertEquals(res.status, 200)
        assertEquals(me.registro.ultimoTo?.document, '52998224725')
    })
})

Deno.test("handler - CPF ausente no pedido: 400 com precisa_cpf, zero chamadas ao ME (nem /me nem /cart) e pedido NÃO reivindicado", async () => {
    await comEnvAdmin(async () => {
        const customerDataSemCpf = { ...PEDIDO_FELIZ.customer_data }
        // @ts-ignore — a linha de cima existe só no PEDIDO_FELIZ (com cpf);
        // esta cópia remove a chave para simular pedido antigo/sem checkout novo.
        delete customerDataSemCpf.cpf
        const pedidoSemCpf = { ...PEDIDO_FELIZ, customer_data: customerDataSemCpf }
        const supa = clienteFalso({ pedido: pedidoSemCpf })
        const me = buscarMeFalso()
        const res = await comAdminFalso(() =>
            handler(requisicaoGerar(), { supabase: supa.cliente, buscar: me.buscar }))
        assertEquals(res.status, 400)
        const corpo = await res.json()
        assertEquals(corpo.precisa_cpf, true)
        assertEquals(String(corpo.error).toLowerCase().includes('não tem o cpf'), true)
        assertEquals(me.registro.carrinho, 0)
        assertEquals(me.registro.chamadasMe, 0)
        assertEquals(supa.registro.reivindicacoes.length, 0)
    })
})

Deno.test("handler - CPF inválido no pedido (checksum errado, dígitos repetidos, tamanho errado): 400 com precisa_cpf, mensagem distinta de 'ausente', zero chamadas ao ME", async () => {
    await comEnvAdmin(async () => {
        for (const cpfInvalido of ['52998224700', '11111111111', '5299822472']) {
            const pedidoCpfInvalido = {
                ...PEDIDO_FELIZ,
                customer_data: { ...PEDIDO_FELIZ.customer_data, cpf: cpfInvalido },
            }
            const supa = clienteFalso({ pedido: pedidoCpfInvalido })
            const me = buscarMeFalso()
            const res = await comAdminFalso(() =>
                handler(requisicaoGerar(), { supabase: supa.cliente, buscar: me.buscar }))
            assertEquals(res.status, 400)
            const corpo = await res.json()
            assertEquals(corpo.precisa_cpf, true)
            assertEquals(String(corpo.error).toLowerCase().includes('inválido'), true)
            assertEquals(String(corpo.error).toLowerCase().includes('não tem o cpf'), false)
            assertEquals(me.registro.carrinho, 0)
        }
    })
})

Deno.test("handler - CPF válido COM máscara no banco passa normalmente (o portão limpa antes de validar)", async () => {
    await comEnvAdmin(async () => {
        const pedidoComMascara = {
            ...PEDIDO_FELIZ,
            customer_data: { ...PEDIDO_FELIZ.customer_data, cpf: '529.982.247-25' },
        }
        const supa = clienteFalso({ pedido: pedidoComMascara })
        const me = buscarMeFalso()
        const res = await comAdminFalso(() =>
            handler(requisicaoGerar(), { supabase: supa.cliente, buscar: me.buscar }))
        assertEquals(res.status, 200)
        assertEquals(me.registro.ultimoTo?.document, '52998224725')
    })
})

Deno.test("handler - cpf no BODY de gerar_etiqueta é IGNORADO: pedido sem CPF no banco continua recusando mesmo com CPF válido no corpo", async () => {
    await comEnvAdmin(async () => {
        const customerDataSemCpf = { ...PEDIDO_FELIZ.customer_data }
        // @ts-ignore
        delete customerDataSemCpf.cpf
        const pedidoSemCpf = { ...PEDIDO_FELIZ, customer_data: customerDataSemCpf }
        const supa = clienteFalso({ pedido: pedidoSemCpf })
        const me = buscarMeFalso()
        const res = await comAdminFalso(() =>
            handler(requisicaoGerar('gerar_etiqueta', { cpf: '52998224725' }), { supabase: supa.cliente, buscar: me.buscar }))
        assertEquals(res.status, 400)
        const corpo = await res.json()
        assertEquals(corpo.precisa_cpf, true)
        assertEquals(me.registro.carrinho, 0)
        assertEquals(me.registro.chamadasMe, 0)
    })
})

Deno.test("handler - pedido já etiquetado sem CPF continua devolvendo `already` (legado não quebra pelo portão novo)", async () => {
    await comEnvAdmin(async () => {
        const customerDataSemCpf = { ...PEDIDO_FELIZ.customer_data }
        // @ts-ignore
        delete customerDataSemCpf.cpf
        const pedidoLegadoEtiquetado = {
            ...PEDIDO_FELIZ,
            shipping_label_id: 'lbl-legado',
            shipping_label_url: 'https://melhorenvio.com.br/imprimir/legado',
            tracking_code: 'ME-legado',
            customer_data: customerDataSemCpf,
        }
        const supa = clienteFalso({ pedido: pedidoLegadoEtiquetado })
        const me = buscarMeFalso()
        const res = await comAdminFalso(() =>
            handler(requisicaoGerar(), { supabase: supa.cliente, buscar: me.buscar }))
        assertEquals(res.status, 200)
        const corpo = await res.json()
        assertEquals(corpo.already, true)
        assertEquals(me.registro.carrinho, 0)
    })
})

// ── ACTION: definir_cpf_destinatario ────────────────────────────────────────

function requisicaoDefinirCpf(cpf: unknown, orderId = 'pedido-2', extra: Record<string, unknown> = {}): Request {
    return new Request('http://localhost/melhor-envio-etiqueta', {
        method: 'POST',
        headers: { Authorization: 'Bearer jwt-admin-de-teste' },
        body: JSON.stringify({ action: 'definir_cpf_destinatario', orderId, cpf, ...extra }),
    })
}

const PEDIDO_PARA_DEFINIR_CPF = {
    id: 'pedido-2',
    status: 'processing',
    shipping_label_id: null,
    customer_data: { cep: '38500-000', whatsapp: '34999999999' },
}

Deno.test("definir_cpf_destinatario - sem Authorization recusa 403 ANTES de qualquer leitura/escrita (mesmo portão de admin das outras actions)", async () => {
    const supa = clienteFalso({ pedido: PEDIDO_PARA_DEFINIR_CPF })
    const res = await handler(
        new Request('http://localhost/melhor-envio-etiqueta', {
            method: 'POST',
            body: JSON.stringify({ action: 'definir_cpf_destinatario', orderId: 'pedido-2', cpf: '52998224725' }),
        }),
        { supabase: supa.cliente },
    )
    assertEquals(res.status, 403)
    assertEquals(supa.registro.cpfAtualizacoes.length, 0)
})

Deno.test("definir_cpf_destinatario - não depende do token do Melhor Envio (roda mesmo sem credencial cadastrada)", async () => {
    await comEnvAdmin(async () => {
        // credentials com token vazio — se a action dependesse do portão de
        // token (linha ~646), cairia em 400 de 'token não configurado' antes
        // de chegar ao próprio código da action.
        const supa = clienteFalso({ pedido: PEDIDO_PARA_DEFINIR_CPF, credentials: { token: '', sandbox: true } })
        const res = await comAdminFalso(() =>
            handler(requisicaoDefinirCpf('52998224725'), { supabase: supa.cliente }))
        assertEquals(res.status, 200)
    })
})

Deno.test("definir_cpf_destinatario - CPF inválido recusa 400 SEM gravar (checksum errado, repetido e tamanho errado)", async () => {
    await comEnvAdmin(async () => {
        for (const cpfInvalido of ['52998224700', '11111111111', '5299822472', '', null]) {
            const supa = clienteFalso({ pedido: PEDIDO_PARA_DEFINIR_CPF })
            const res = await comAdminFalso(() =>
                handler(requisicaoDefinirCpf(cpfInvalido), { supabase: supa.cliente }))
            assertEquals(res.status, 400)
            assertEquals(supa.registro.cpfAtualizacoes.length, 0)
        }
    })
})

Deno.test("definir_cpf_destinatario - pedido já etiquetado recusa 409: CPF de etiqueta emitida não muda mais", async () => {
    await comEnvAdmin(async () => {
        const pedidoEtiquetado = { ...PEDIDO_PARA_DEFINIR_CPF, shipping_label_id: 'lbl-existente' }
        const supa = clienteFalso({ pedido: pedidoEtiquetado })
        const res = await comAdminFalso(() =>
            handler(requisicaoDefinirCpf('52998224725'), { supabase: supa.cliente }))
        assertEquals(res.status, 409)
        assertEquals(supa.registro.cpfAtualizacoes.length, 0)
    })
})

Deno.test("definir_cpf_destinatario - pedido cancelado/entregue/devolvido recusa 400 sem gravar", async () => {
    await comEnvAdmin(async () => {
        for (const status of ['cancelled', 'delivered', 'returned']) {
            const pedidoMorto = { ...PEDIDO_PARA_DEFINIR_CPF, status }
            const supa = clienteFalso({ pedido: pedidoMorto })
            const res = await comAdminFalso(() =>
                handler(requisicaoDefinirCpf('52998224725'), { supabase: supa.cliente }))
            assertEquals(res.status, 400)
            assertEquals(supa.registro.cpfAtualizacoes.length, 0)
        }
    })
})

Deno.test("definir_cpf_destinatario - sucesso grava o CPF preservando as OUTRAS chaves de customer_data, com update condicional (id + sem etiqueta + cpf anterior ausente), e NUNCA devolve o CPF inteiro", async () => {
    await comEnvAdmin(async () => {
        const supa = clienteFalso({ pedido: PEDIDO_PARA_DEFINIR_CPF })
        const res = await comAdminFalso(() =>
            handler(requisicaoDefinirCpf('529.982.247-25'), { supabase: supa.cliente }))
        assertEquals(res.status, 200)
        const corpo = await res.json()
        assertEquals(corpo.success, true)
        assertEquals(corpo.cpf_final, '25')
        assertEquals(JSON.stringify(corpo).includes('52998224725'), false)

        assertEquals(supa.registro.cpfAtualizacoes.length, 1)
        assertEquals(supa.registro.cpfAtualizacoes[0].valores.customer_data, {
            cep: '38500-000',
            whatsapp: '34999999999',
            cpf: '52998224725',
        })
        const filtros = supa.registro.cpfAtualizacoes[0].filtros
        const colunas = filtros.map((f: any) => f.coluna)
        assertEquals(colunas.includes('id'), true)
        assertEquals(colunas.includes('shipping_label_id'), true)
        const filtroCpfAnterior = filtros.find((f: any) => f.coluna === 'customer_data->>cpf')
        assertEquals(filtroCpfAnterior?.metodo, 'is')
        assertEquals(filtroCpfAnterior?.valor, null)
    })
})

Deno.test("definir_cpf_destinatario - CPF anterior presente usa filtro eq (não is) contra o valor antigo (update condicional cobre também troca de CPF)", async () => {
    await comEnvAdmin(async () => {
        const pedidoComCpfAntigo = {
            ...PEDIDO_PARA_DEFINIR_CPF,
            customer_data: { ...PEDIDO_PARA_DEFINIR_CPF.customer_data, cpf: '11144477735' },
        }
        const supa = clienteFalso({ pedido: pedidoComCpfAntigo })
        const res = await comAdminFalso(() =>
            handler(requisicaoDefinirCpf('52998224725'), { supabase: supa.cliente }))
        assertEquals(res.status, 200)
        const filtroCpfAnterior = supa.registro.cpfAtualizacoes[0].filtros.find((f: any) => f.coluna === 'customer_data->>cpf')
        assertEquals(filtroCpfAnterior?.metodo, 'eq')
        assertEquals(filtroCpfAnterior?.valor, '11144477735')
    })
})

Deno.test("definir_cpf_destinatario - update condicional sem bater linha (corrida: outra escrita mudou o pedido no meio tempo) devolve 409 mandando recarregar", async () => {
    await comEnvAdmin(async () => {
        const supa = clienteFalso({ pedido: PEDIDO_PARA_DEFINIR_CPF, linhasCpfAtualizadas: [] })
        const res = await comAdminFalso(() =>
            handler(requisicaoDefinirCpf('52998224725'), { supabase: supa.cliente }))
        assertEquals(res.status, 409)
        const corpo = await res.json()
        assertEquals(String(corpo.error).toLowerCase().includes('recarregue'), true)
    })
})

// ── log 'cart sem id' sanitiza o CPF (achado da revisão Opus, aadbf4c) ────

Deno.test("handler - cart sem id: o log de erro NUNCA imprime o CPF cru (mascarado ou não) que o ME ecoou na resposta", async () => {
    await comEnvAdmin(async () => {
        const supa = clienteFalso({ pedido: PEDIDO_FELIZ })
        const me = buscarMeFalso({ cartSemId: true })
        const linhas = await comConsoleErrorCapturado(async () => {
            const res = await comAdminFalso(() =>
                handler(requisicaoGerar(), { supabase: supa.cliente, buscar: me.buscar }))
            assertEquals(res.status, 502)
        })
        const linhaDoCart = linhas.find((l) => l.includes('cart sem id'))
        assertEquals(linhaDoCart !== undefined, true)
        assertEquals(String(linhaDoCart).includes('529.982.247-25'), false)
        assertEquals(String(linhaDoCart).includes('52998224725'), false)
        assertEquals(String(linhaDoCart).includes('[cpf]'), true)
    })
})

Deno.test("handler - cart sem id: CPF que cruza a fronteira do corte de 500 caracteres não vaza pedaço nenhum (sanitiza ANTES de cortar)", async () => {
    await comEnvAdmin(async () => {
        const supa = clienteFalso({ pedido: PEDIDO_FELIZ })
        // Preenchimento calculado para o CPF cair ATRAVESSANDO o caractere
        // 500 do JSON.stringify: `{"pad":"` (8) + 478 'A' (posições 8-485) +
        // `","cpf":"` (9, posições 486-494) + CPF (11, posições 495-505) —
        // o corte em 500 cairia no MEIO do CPF (dígito de índice 5). É
        // exatamente o caso que "cortar primeiro, sanitizar depois" deixava
        // vazar um pedaço de dígitos (2ª rodada da revisão Opus, aadbf4c).
        const preenchimento = 'A'.repeat(478)
        const me = buscarMeFalso({
            cartSemId: true,
            cartSemIdPayload: { pad: preenchimento, cpf: '52998224725' },
        })
        const linhas = await comConsoleErrorCapturado(async () => {
            const res = await comAdminFalso(() =>
                handler(requisicaoGerar(), { supabase: supa.cliente, buscar: me.buscar }))
            assertEquals(res.status, 502)
        })
        const linhaDoCart = linhas.find((l) => l.includes('cart sem id'))
        assertEquals(linhaDoCart !== undefined, true)
        // Nenhuma corrida de 4+ dígitos pode sobrar — nem o CPF inteiro, nem
        // um pedaço cortado dele.
        assertEquals(/\d{4,}/.test(String(linhaDoCart)), false)
        assertEquals(String(linhaDoCart).includes('[cpf]'), true)
    })
})
