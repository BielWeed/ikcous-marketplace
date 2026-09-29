// @ts-nocheck
/**
 * Dublês dos testes da 1.5.7 (vários provedores). NÃO é arquivo de teste (o
 * nome não termina em `_test.ts`) e o bundle da edge não o importa.
 *
 * - `bancoFalso`: um Supabase em miniatura, com ESTADO — o upsert de uma
 *   credencial muda o que a próxima leitura vê (é assim que "salvar duas
 *   vezes" e "desligar apaga o cache" se provam de ponta a ponta).
 * - `transportadorasFalsas`: o `fetch` roteado por URL (ME, SuperFrete,
 *   Frenet), anotando cada chamada.
 *
 * Tokens, e-mails e produtos daqui são FICTÍCIOS. As respostas das
 * transportadoras são montadas pelos contratos oficiais (Frenet: doc
 * OpenAPI v2.1; SuperFrete: exemplo 200 da doc) ou pela resposta REAL do ME
 * redigida (auditoria 22/09/2026, corpo D, sem token). Os códigos de serviço
 * da Frenet são EXEMPLO, não códigos confirmados de conta real.
 */
import { handler } from "./index.ts"

export const TOKEN_ME = "tok-me-FICTICIO-1a2b3c4d5e6f"
export const TOKEN_SF = "tok-sf-FICTICIO-9f8e7d6c5b4a"
export const TOKEN_FRENET = "tok-frenet-FICTICIO-777abc"
export const EMAIL_SF = "loja@ex.com"
/** R3-7: o contato do ME é OUTRO e-mail (nunca copiado da SF). Fictício. */
export const EMAIL_ME = "contato-me@ex.com"

export const CONFIG_BASE = {
    origin_cep: "38500-000",
    shipping_provider: "superfrete",
    shipping_fee: 15,
    free_shipping_min: 0,
    enabled_shipping_methods: ["sedex", "pac"],
    shipping_coverage: "national",
    local_delivery_fee: 10,
    local_cep_range: "",
}

export const PRODUTO_P1 = {
    id: "p1",
    nome: "Produto Fictício Nome-Secreto-XYZ",
    preco_venda: 59.9,
    peso_kg: 0.1,
    largura_cm: 11,
    altura_cm: 6,
    comprimento_cm: 16,
    frete_gratis: false,
}

export const CARRINHO_P1 = [{ product: { id: "p1", price: 1 }, quantity: 1 }]

export const LINHA_ME = { provider: "melhor_envio", credentials: { token: TOKEN_ME, contact_email: EMAIL_ME }, updated_at: "2026-09-20T10:00:00.000Z" }
export const LINHA_SF = {
    provider: "superfrete",
    credentials: { token: TOKEN_SF, sandbox: false, contact_email: EMAIL_SF },
    updated_at: "2026-09-21T10:00:00.000Z",
}
export const LINHA_FRENET = { provider: "frenet", credentials: { token: TOKEN_FRENET }, updated_at: "2026-09-22T10:00:00.000Z" }
export const linhaLigados = (ligados: string[], atualizado = "2026-09-23T00:00:00.000Z") => ({
    provider: "_ligados",
    credentials: { ligados, atualizado_em: atualizado },
    updated_at: atualizado,
})

// ── Respostas das transportadoras ────────────────────────────────────────────

const correiosME = { id: 1, name: "Correios", picture: "" }
/** Resposta REAL do ME (auditoria 22/09, corpo D, 0,1 kg 16×11×6, com seguro 59,90), redigida e reduzida. */
export const RESPOSTA_ME_REAL = [
    { id: 1, name: "PAC", price: "26.75", custom_price: "26.75", delivery_time: 10, custom_delivery_time: 10, company: correiosME },
    { id: 2, name: "SEDEX", price: "55.22", custom_price: "55.22", delivery_time: 6, custom_delivery_time: 6, company: correiosME },
    { id: 3, name: ".Package", price: "21.13", custom_price: "21.13", delivery_time: 4, custom_delivery_time: 4, company: { id: 2, name: "Jadlog" } },
    { id: 17, name: "Mini Envios", error: "Dimensões do objeto ultrapassam o limite da transportadora.", company: correiosME },
    { id: 31, name: "Express", price: "10.49", custom_price: "10.49", delivery_time: 2, custom_delivery_time: 2, company: { id: 14, name: "Loggi" } },
    { id: 33, name: "Standard", error: "Não é possível realizar cotações, pois o trecho está temporariamente indisponível.", company: { id: 16, name: "JeT" } },
]

/** Exemplo 200 OFICIAL da SuperFrete (doc de cotação), reduzido aos campos lidos. */
export const RESPOSTA_SF_OFICIAL = [
    { id: 1, name: "PAC", price: 18.61, delivery_time: 5, company: { id: 1, name: "Correios" }, has_error: false },
    { id: 2, name: "SEDEX", price: 10.77, delivery_time: 1, company: { id: 1, name: "Correios" }, has_error: false },
    { id: 17, name: "Mini Envios", price: 13, delivery_time: 8, company: { id: 1, name: "Correios" }, has_error: false },
    { id: 3, name: "JADLOG.PACKAGE", price: 14.4, delivery_time: 2, company: { id: 2, name: "jadlog" }, has_error: false },
    { id: 31, name: "LOGGI Econômico", price: 9.76, delivery_time: 3, company: { id: 14, name: "loggi" }, has_error: false },
]

/**
 * Frenet — EXEMPLO montado pelo contrato oficial (POST /shipping/quote,
 * OpenAPI v2.1): os campos são os da doc; códigos e preços são ilustrativos
 * (os preços do print da auditoria), NÃO confirmados em conta real.
 */
export const RESPOSTA_FRENET_EXEMPLO = {
    ShippingSevicesArray: [
        { Carrier: "J&T Express", CarrierCode: "JTE", ServiceCode: "JTE_INT", ServiceDescription: "Standard", ShippingPrice: "11.74", OriginalShippingPrice: "11.74", DeliveryTime: "3", OriginalDeliveryTime: "3", Error: false, Msg: "" },
        { Carrier: "Jadlog", CarrierCode: "JAD", ServiceCode: "F_3", ServiceDescription: ".Package", ShippingPrice: "13,43", OriginalShippingPrice: "13,43", DeliveryTime: "6", OriginalDeliveryTime: "6", Error: false, Msg: "" },
        { Carrier: "Correios", CarrierCode: "COR", ServiceCode: "04227", ServiceDescription: "Mini Envios", ShippingPrice: "18.84", OriginalShippingPrice: "20.00", DeliveryTime: "11", OriginalDeliveryTime: "11", Error: false, Msg: "" },
        { Carrier: "Correios", CarrierCode: "COR", ServiceCode: "03298", ServiceDescription: "PAC", ShippingPrice: "25.09", OriginalShippingPrice: "25.09", DeliveryTime: "8", OriginalDeliveryTime: "8", Error: false, Msg: "" },
        { Carrier: "Correios", CarrierCode: "COR", ServiceCode: "03220", ServiceDescription: "SEDEX", ShippingPrice: "52.13", OriginalShippingPrice: "52.13", DeliveryTime: "4", OriginalDeliveryTime: "4", Error: false, Msg: "" },
    ],
}

/** Frenet — EXEMPLO de GET /shipping/info pelo contrato oficial (códigos ilustrativos). */
export const INFO_FRENET_EXEMPLO = {
    Message: "",
    ShippingSeviceAvailableArray: [
        { ServiceCode: "JTE_INT", ServiceDescription: "Standard", Carrier: "J&T Express", CarrierCode: "JTE" },
        { ServiceCode: "04227", ServiceDescription: "Mini Envios", Carrier: "Correios", CarrierCode: "COR" },
        { ServiceCode: "F_3", ServiceDescription: ".Package", Carrier: "Jadlog", CarrierCode: "JAD" },
        { ServiceCode: "03298", ServiceDescription: "PAC", Carrier: "Correios", CarrierCode: "COR" },
        { ServiceCode: "03220", ServiceDescription: "SEDEX", Carrier: "Correios", CarrierCode: "COR" },
    ],
}

/**
 * SuperFrete — GET /api/v0/services/info ("Informações dos pacotes"): resposta
 * REAL redigida (auditoria da loja principal, limites-api.json, HTTP 200),
 * reduzida aos campos lidos (sem `picture`, `requirements`, `optionals`).
 * Objeto com CHAVE = id do serviço. É o endpoint de LIMITES por serviço, não
 * a garantia do que a conta tem ativo.
 */
export const INFO_SF_REAL_REDIGIDA = {
    "1": { name: "PAC", type: "express", restrictions: { formats: { package: { weight: { min: 0.3, max: 30 } } } }, company: { name: "Correios" } },
    "2": { name: "SEDEX", type: "express", restrictions: { formats: { package: { weight: { min: 0.3, max: 30 } } } }, company: { name: "Correios" } },
    "3": { name: "Jadlog", type: "express", restrictions: {}, company: { name: "Jadlog" } },
    "17": { name: "MiniEnvios", type: "express", restrictions: { formats: { package: { weight: { min: 0.0001, max: 0.3 } } } }, company: { name: "Correios" } },
    "31": { name: "Loggi", type: "express", restrictions: {}, company: { name: "Loggi" } },
}

/** ME — GET /api/v2/me/shipment/services, forma da doc (id, name, company). */
export const SERVICOS_ME_EXEMPLO = [
    { id: 1, name: "PAC", type: "normal", company: { id: 1, name: "Correios" } },
    { id: 2, name: "SEDEX", type: "express", company: { id: 1, name: "Correios" } },
    { id: 31, name: "Express", type: "express", company: { id: 14, name: "Loggi" } },
]

export const json = (dados: unknown, status = 200) =>
    new Response(JSON.stringify(dados), { status, headers: { "Content-Type": "application/json" } })

// ── Banco falso ──────────────────────────────────────────────────────────────

export type Registro = {
    eventos: string[]
    colunasDeCredencial: string[]
    upsertsCredencial: any[]
    upsertsCache: any[]
    logs: any[]
    updatesConfig: any[]
    deletesCache: number
    cacheLinhas: any[]
}

export function bancoFalso(opts: {
    config?: Record<string, unknown>
    credenciais?: any[]
    produtos?: any[]
    variantes?: any[]
    cache?: Array<{ options: unknown }>
    enderecoDaLoja?: string | null
    falhas?: {
        credenciais?: "erro" | "excecao"
        espelho?: boolean
        apagarCache?: boolean
        gravarCredencial?: boolean
        gravarCache?: boolean
        /**
         * Simula a leitura tolerante das 5 colunas nacionais estourando
         * (`{error}` do PostgREST, ex.: `42703`) mesmo quando `opts.config`
         * TEM os campos — para provar que erro explícito se comporta igual a
         * coluna ausente (os dois viram `{ok:false}`, espelho legado).
         */
        colunasNacionais?: boolean
    }
} = {}) {
    const config = { ...CONFIG_BASE, ...(opts.config ?? {}) }
    const credenciais = (opts.credenciais ?? [LINHA_ME, LINHA_SF, LINHA_FRENET]).map((l) => structuredClone(l))
    const falhas = opts.falhas ?? {}
    const registro: Registro = {
        eventos: [],
        colunasDeCredencial: [],
        upsertsCredencial: [],
        upsertsCache: [],
        logs: [],
        updatesConfig: [],
        deletesCache: 0,
        cacheLinhas: (opts.cache ?? []).map((l) => structuredClone(l)),
    }

    const construtor = (tabela: string, operacao: string, carga?: any, opcoesUpsert?: any) => {
        const filtros: Array<[string, string, unknown]> = []
        let colunas = ""
        let unico = false
        let limite: number | null = null
        const executar = async (): Promise<any> => {
            registro.eventos.push(`${operacao}:${tabela}`)
            if (tabela === "store_config") {
                if (operacao === "update") {
                    registro.updatesConfig.push(carga)
                    if (falhas.espelho) return { error: { message: "falha simulada do espelho" } }
                    Object.assign(config, carga)
                    return { error: null }
                }
                if (colunas.includes("store_address")) {
                    return { data: { store_address: opts.enderecoDaLoja ?? null }, error: null }
                }
                // Estratégia NACIONAL (23/09): leitura SEPARADA e tolerante
                // das 5 colunas. `falhas.colunasNacionais` simula o erro real
                // do PostgREST (42703); sem `national_shipping_strategy` em
                // `opts.config` a leitura devolve o config INTEIRO como
                // sempre — a coluna pedida simplesmente não está lá, o mesmo
                // "ausente" que o validador da estratégia trata como null.
                if (colunas.includes("national_shipping_strategy")) {
                    if (falhas.colunasNacionais) {
                        return {
                            data: null,
                            error: { message: "column store_config.national_shipping_strategy does not exist", code: "42703" },
                        }
                    }
                    return { data: { ...config }, error: null }
                }
                return { data: unico ? { ...config } : [{ ...config }], error: null }
            }
            if (tabela === "produtos") return { data: opts.produtos ?? [PRODUTO_P1], error: null }
            if (tabela === "product_variants") return { data: opts.variantes ?? [], error: null }
            if (tabela === "store_shipping_credentials") {
                if (operacao === "upsert") {
                    const linhas = Array.isArray(carga) ? carga : [carga]
                    registro.upsertsCredencial.push({ linhas: structuredClone(linhas), onConflict: opcoesUpsert?.onConflict ?? null })
                    if (falhas.gravarCredencial) return { error: { message: `violação ao gravar ${JSON.stringify(linhas)}` } }
                    for (const linha of linhas) {
                        const i = credenciais.findIndex((c) => c.provider === linha.provider)
                        const nova = { provider: linha.provider, credentials: structuredClone(linha.credentials), updated_at: linha.updated_at }
                        if (i >= 0) credenciais.splice(i, 1, nova)
                        else credenciais.push(nova)
                    }
                    return { error: null }
                }
                registro.colunasDeCredencial.push(colunas)
                if (falhas.credenciais === "excecao") throw new Error("conexão perdida ao buscar credenciais")
                if (falhas.credenciais === "erro") return { data: null, error: { message: "erro simulado", code: "XX000" } }
                let linhas = credenciais
                for (const [tipo, coluna, valor] of filtros) {
                    if (tipo === "eq" && coluna === "provider") linhas = linhas.filter((l) => l.provider === valor)
                }
                const projetadas = linhas.map((l) => structuredClone(l))
                return { data: unico ? projetadas[0] ?? null : projetadas, error: null }
            }
            if (tabela === "shipping_quotes_cache") {
                if (operacao === "upsert") {
                    registro.upsertsCache.push({ linha: structuredClone(carga), onConflict: opcoesUpsert?.onConflict ?? null })
                    if (falhas.gravarCache) return { error: { message: "falha simulada do cache" } }
                    registro.cacheLinhas = [{ options: structuredClone(carga.options), cart_hash: carga.cart_hash }]
                    return { error: null }
                }
                if (operacao === "delete") {
                    registro.deletesCache += 1
                    if (falhas.apagarCache) return { error: { message: "falha simulada ao apagar" } }
                    registro.cacheLinhas = []
                    return { error: null }
                }
                const linhas = registro.cacheLinhas.map((l) => ({ options: structuredClone(l.options) }))
                return { data: limite != null ? linhas.slice(0, limite) : linhas, error: null }
            }
            if (tabela === "shipping_calculation_logs") {
                registro.logs.push(carga)
                return { error: null }
            }
            return { data: null, error: null }
        }
        const b: any = {
            select: (c?: string) => {
                colunas = c ?? ""
                return b
            },
            eq: (k: string, v: unknown) => {
                filtros.push(["eq", k, v])
                return b
            },
            neq: (k: string, v: unknown) => {
                filtros.push(["neq", k, v])
                return b
            },
            not: (k: string, _op: string, v: unknown) => {
                filtros.push(["not", k, v])
                return b
            },
            gt: () => b,
            gte: () => b,
            in: () => b,
            order: () => b,
            limit: (n: number) => {
                limite = n
                return b
            },
            single: () => {
                unico = true
                return executar()
            },
            maybeSingle: () => {
                unico = true
                return executar()
            },
            then: (ok: any, falha: any) => executar().then(ok, falha),
        }
        return b
    }

    const cliente = {
        from: (tabela: string) => ({
            select: (c?: string) => construtor(tabela, "select").select(c),
            insert: (linha: any) => construtor(tabela, "insert", linha),
            upsert: (linha: any, op?: any) => construtor(tabela, "upsert", linha, op),
            update: (linha: any) => construtor(tabela, "update", linha),
            delete: () => construtor(tabela, "delete"),
        }),
    }
    return { cliente, registro, credenciais, config }
}

// ── Transportadoras falsas ───────────────────────────────────────────────────

export type Chamada = { url: string; init: RequestInit }
export type Rotas = {
    me?: (c: Chamada) => Response | Promise<Response>
    meServicos?: (c: Chamada) => Response | Promise<Response>
    sf?: (c: Chamada) => Response | Promise<Response>
    sfInfo?: (c: Chamada) => Response | Promise<Response>
    frenet?: (c: Chamada) => Response | Promise<Response>
    frenetInfo?: (c: Chamada) => Response | Promise<Response>
}

export const cabecalho = (c: Chamada, nome: string) => new Headers(c.init.headers as HeadersInit).get(nome)
export const corpoDe = (c: Chamada) => JSON.parse(String(c.init.body))

function rotear(rotas: Rotas, chamada: Chamada): Response | Promise<Response> {
    const u = chamada.url
    if (u.includes("melhorenvio.com.br/api/v2/me/shipment/calculate")) {
        return (rotas.me ?? (() => json(RESPOSTA_ME_REAL)))(chamada)
    }
    if (u.includes("melhorenvio.com.br/api/v2/me/shipment/services")) {
        return (rotas.meServicos ?? (() => json(SERVICOS_ME_EXEMPLO)))(chamada)
    }
    if (u.includes("superfrete.com/api/v0/calculator")) return (rotas.sf ?? (() => json(RESPOSTA_SF_OFICIAL)))(chamada)
    if (u.includes("superfrete.com/api/v0/services/info")) return (rotas.sfInfo ?? (() => json(INFO_SF_REAL_REDIGIDA)))(chamada)
    if (u.includes("api.frenet.com.br/shipping/quote")) return (rotas.frenet ?? (() => json(RESPOSTA_FRENET_EXEMPLO)))(chamada)
    if (u.includes("api.frenet.com.br/shipping/info")) return (rotas.frenetInfo ?? (() => json(INFO_FRENET_EXEMPLO)))(chamada)
    return new Response("rota desconhecida no teste", { status: 599 })
}

/** Tudo que passou por console.* enquanto `fn` rodava, como texto. */
export async function capturarConsole<T>(fn: () => Promise<T>): Promise<{ resultado: T; saida: string }> {
    const linhas: string[] = []
    const originais = { error: console.error, warn: console.warn, log: console.log, info: console.info }
    const guardar = (...args: unknown[]) => {
        linhas.push(args.map((a) => {
            if (a instanceof Error) return `${a.name}: ${a.message}\n${a.stack ?? ""}`
            if (typeof a === "string") return a
            try {
                return JSON.stringify(a)
            } catch {
                return String(a)
            }
        }).join(" "))
    }
    console.error = guardar
    console.warn = guardar
    console.log = guardar
    console.info = guardar
    try {
        const resultado = await fn()
        return { resultado, saida: linhas.join("\n") }
    } finally {
        Object.assign(console, originais)
    }
}

/** As linhas JSON do log estruturado da cotação (uma por provedor). */
export function linhasDoLog(saida: string, evento = "cotacao_frete"): any[] {
    return saida.split("\n").flatMap((linha) => {
        if (!linha.startsWith("{")) return []
        try {
            const obj = JSON.parse(linha)
            return obj?.evento === evento ? [obj] : []
        } catch {
            return []
        }
    })
}

/** Roda o handler com o banco e as transportadoras falsas. */
export async function rodar(
    corpoDoPedido: Record<string, unknown>,
    ambiente: { banco?: ReturnType<typeof bancoFalso>; rotas?: Rotas; admin?: boolean } = {},
) {
    const banco = ambiente.banco ?? bancoFalso()
    const chamadas: Chamada[] = []
    const fetchOriginal = globalThis.fetch
    globalThis.fetch = ((url: string, init: RequestInit = {}) => {
        const chamada = { url: String(url), init }
        chamadas.push(chamada)
        banco.registro.eventos.push(`fetch:${chamada.url}`)
        try {
            return Promise.resolve(rotear(ambiente.rotas ?? {}, chamada))
        } catch (erro) {
            return Promise.reject(erro)
        }
    }) as any
    try {
        const { resultado, saida } = await capturarConsole(async () => {
            const resposta = await handler(
                new Request("http://localhost/calculate-shipping", {
                    method: "POST",
                    headers: { "Content-Type": "application/json", Authorization: "Bearer jwt-ficticio" },
                    body: JSON.stringify(corpoDoPedido),
                }),
                { supabase: banco.cliente, verificarAdmin: () => Promise.resolve(ambiente.admin ?? true) },
            )
            const texto = await resposta.text()
            await new Promise((r) => setTimeout(r, 20))
            return { resposta, texto }
        })
        let corpo: any = null
        try {
            corpo = JSON.parse(resultado.texto)
        } catch {
            corpo = null
        }
        return { ...resultado, corpo, saida, chamadas, registro: banco.registro, banco }
    } finally {
        globalThis.fetch = fetchOriginal
    }
}

/** Pedido de cotação da cliente. */
export const cotacao = (extra: Record<string, unknown> = {}) => ({ cep: "01001-000", cart: CARRINHO_P1, contratoCliente: 3, ...extra })
