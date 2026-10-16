// @ts-nocheck
// "COMO ENTREGO NA MINHA CIDADE" + PRAZO DA ENTREGA PRÓPRIA (16/10/2026) —
// a cotação pública. Desenho: `equipe/bastoes/desenho-entrega-so-retiro-e-prazo-20261016.md`,
// peça B (edge).
//
// A lojista escolhe "Entrego" / "Entrego e retiro" / "Só retiro" e o prazo da
// entrega própria. As duas colunas novas de `store_config`
// (`local_delivery_enabled`, `local_delivery_days`) são lidas à parte e com
// tolerância; sem elas (banco antes da migration, erro, valor fora do CHECK) a
// resposta é a de hoje: entrega ligada, 1 dia.
//
// Regra-mãe: "Só retiro" desliga a Entrega Local e a retirada vale para
// QUALQUER CEP. Nos outros dois modos a retirada continua só para a cidade.
import { assert, assertEquals, assertNotEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts"
import {
    bancoFalso,
    CONFIG_BASE,
    cotacao,
    json,
    LINHA_ME,
    LINHA_SF,
    linhaLigados,
    PRODUTO_P1,
    RESPOSTA_SF_OFICIAL,
    rodar,
} from "./apoio-dos-testes.ts"
import * as edge from "./index.ts"
import { COLUNAS_DA_LOJA } from "./configuracao.ts"

const ENDERECO = "Rua das Flores, 100 - Centro"
const CEP_LOCAL = "38500-100" // mesma raiz de 5 dígitos da origem (38500-000)
const CEP_FORA = "01001-000"
const SF = "superfrete.com/api/v0/calculator"

type Modo = "entrego" | "entrego_e_retiro" | "so_retiro"
const MODOS: Modo[] = ["entrego", "entrego_e_retiro", "so_retiro"]

/** O que cada resposta do painel grava (a chave `store-pickup` já existia). */
const DOS_MODOS: Record<Modo, Record<string, unknown>> = {
    entrego: { enabled_shipping_methods: ["sedex", "pac"], local_delivery_enabled: true, local_delivery_days: 1 },
    entrego_e_retiro: {
        enabled_shipping_methods: ["sedex", "pac", "store-pickup"],
        local_delivery_enabled: true,
        local_delivery_days: 1,
    },
    so_retiro: {
        enabled_shipping_methods: ["sedex", "pac", "store-pickup"],
        local_delivery_enabled: false,
        local_delivery_days: 1,
    },
}

const ids = (corpo: any) => corpo.options.map((o: any) => o.id)
const doProvedor = (corpo: any) => corpo.options.filter((o: any) => o.provider === "superfrete")

async function cota(opts: {
    modo?: Modo
    config?: Record<string, unknown>
    cep?: string
    cobertura?: "national" | "local"
    comTransportadora?: boolean
    aceitaRetirada?: unknown
    contratoCliente?: unknown
    endereco?: string | null
    falhas?: Record<string, boolean>
    cart?: unknown
    produtos?: any[]
    banco?: ReturnType<typeof bancoFalso>
    rotas?: any
} = {}) {
    const config = {
        ...(opts.modo ? DOS_MODOS[opts.modo] : {}),
        shipping_coverage: opts.cobertura ?? "national",
        ...(opts.config ?? {}),
    }
    const banco = opts.banco ?? bancoFalso({
        config,
        credenciais: opts.comTransportadora === false ? [] : undefined,
        enderecoDaLoja: opts.endereco === undefined ? ENDERECO : opts.endereco,
        falhas: opts.falhas,
        produtos: opts.produtos,
    })
    const pedido: Record<string, unknown> = { cep: opts.cep ?? CEP_LOCAL }
    pedido.cart = "cart" in opts ? opts.cart : cotacao().cart
    if (opts.aceitaRetirada !== "omitir") pedido.aceitaRetirada = opts.aceitaRetirada === undefined ? true : opts.aceitaRetirada
    if (opts.contratoCliente !== "omitir") pedido.contratoCliente = opts.contratoCliente === undefined ? 3 : opts.contratoCliente
    return await rodar(pedido, { banco, rotas: opts.rotas })
}

// ── A matriz do desenho: destino x cobertura x transportadora x modo ────────

type Esperado = { status: number; ids?: string[]; semRetirada?: boolean; soRetirada?: boolean; vazia?: boolean }

const CENARIOS: Array<{
    nome: string
    cep: string
    cobertura: "national" | "local"
    comTransportadora: boolean
    esperado: Record<Modo, Esperado>
}> = [
    {
        nome: "CEP local, cobertura nacional",
        cep: CEP_LOCAL,
        cobertura: "national",
        comTransportadora: true,
        esperado: {
            entrego: { status: 200, ids: ["local-delivery"] },
            entrego_e_retiro: { status: 200, ids: ["local-delivery", "store-pickup"] },
            so_retiro: { status: 200, ids: ["store-pickup"] },
        },
    },
    {
        nome: "CEP local, cobertura só cidade",
        cep: CEP_LOCAL,
        cobertura: "local",
        comTransportadora: true,
        esperado: {
            entrego: { status: 200, ids: ["local-delivery"] },
            entrego_e_retiro: { status: 200, ids: ["local-delivery", "store-pickup"] },
            so_retiro: { status: 200, ids: ["store-pickup"] },
        },
    },
    {
        nome: "fora da cidade, cobertura só cidade",
        cep: CEP_FORA,
        cobertura: "local",
        comTransportadora: true,
        esperado: {
            entrego: { status: 400 },
            entrego_e_retiro: { status: 400 },
            so_retiro: { status: 200, ids: ["store-pickup"] },
        },
    },
    {
        nome: "fora da cidade, com transportadora",
        cep: CEP_FORA,
        cobertura: "national",
        comTransportadora: true,
        esperado: {
            entrego: { status: 200, semRetirada: true },
            entrego_e_retiro: { status: 200, semRetirada: true },
            so_retiro: { status: 200 }, // transportadoras + Retirar (conferido abaixo)
        },
    },
    {
        nome: "fora da cidade, sem transportadora",
        cep: CEP_FORA,
        cobertura: "national",
        comTransportadora: false,
        esperado: {
            entrego: { status: 200, vazia: true },
            entrego_e_retiro: { status: 200, vazia: true },
            so_retiro: { status: 200, ids: ["store-pickup"] },
        },
    },
]

for (const cenario of CENARIOS) {
    for (const modo of MODOS) {
        Deno.test(`matriz: ${cenario.nome} x ${modo}`, async () => {
            const { resposta, corpo, registro } = await cota({
                modo,
                cep: cenario.cep,
                cobertura: cenario.cobertura,
                comTransportadora: cenario.comTransportadora,
            })
            const esperado = Object.entries(cenario.esperado).find(([chave]) => chave === modo)![1]
            assertEquals(resposta.status, esperado.status, JSON.stringify(corpo))
            if (esperado.status !== 200) return
            assertEquals(corpo.cotacaoIncompleta, false)
            if (esperado.ids) assertEquals(ids(corpo), esperado.ids)
            if (esperado.vazia) assertEquals(corpo.options, [])
            const naFrente = ids(corpo)
            if (cenario.cep === CEP_FORA && cenario.comTransportadora && cenario.cobertura === "national") {
                // Transportadoras primeiro e, só em "Só retiro", a retirada DEPOIS delas.
                assert(doProvedor(corpo).length > 0, "as transportadoras continuam na resposta")
                if (modo === "so_retiro") {
                    assertEquals(naFrente.at(-1), "store-pickup")
                    assertEquals(corpo.options.length, doProvedor(corpo).length + 1)
                } else {
                    assertEquals(naFrente.includes("store-pickup"), false)
                }
            }
            // A Entrega Local NUNCA sai em "Só retiro"; a retirada NUNCA vai ao cache.
            if (modo === "so_retiro") assertEquals(naFrente.includes("local-delivery"), false)
            assertEquals(JSON.stringify(registro.upsertsCache).includes("store-pickup"), false)
        })
    }
}

// ── O prazo da entrega própria ──────────────────────────────────────────────

Deno.test("prazo: a lojista põe 3 dias -> a Entrega Local diz 3 (preço e nome intactos)", async () => {
    const { corpo } = await cota({ modo: "entrego", config: { local_delivery_days: 3 } })
    assertEquals(corpo.options.length, 1)
    assertEquals(corpo.options[0].id, "local-delivery")
    assertEquals(corpo.options[0].name, "Entrega Local")
    assertEquals(corpo.options[0].provider, "local")
    assertEquals(corpo.options[0].price, 10)
    assertEquals(corpo.options[0].deliveryDays, 3)
})

Deno.test("prazo: o prazo vale também na cobertura só-cidade e ao lado da retirada", async () => {
    const { corpo } = await cota({ modo: "entrego_e_retiro", cobertura: "local", config: { local_delivery_days: 7 } })
    assertEquals(ids(corpo), ["local-delivery", "store-pickup"])
    assertEquals(corpo.options[0].deliveryDays, 7)
    assertEquals(corpo.options[1].deliveryDays, 0) // a retirada segue sem prazo inventado
})

Deno.test("prazo: banco ANTES da migration (colunas ausentes) -> 1 dia, como sempre", async () => {
    const { corpo } = await cota({ config: { enabled_shipping_methods: ["sedex", "pac"] } })
    assertEquals(ids(corpo), ["local-delivery"])
    assertEquals(corpo.options[0].deliveryDays, 1)
})

Deno.test("prazo 0 (mesmo dia): app com contratoCliente 3 recebe 0; app anterior recebe 1 (nunca 'até 0 dia útil')", async () => {
    const novo = await cota({ modo: "entrego", config: { local_delivery_days: 0 }, contratoCliente: 3 })
    assertEquals(novo.corpo.options[0].deliveryDays, 0)
    const futuro = await cota({ modo: "entrego", config: { local_delivery_days: 0 }, contratoCliente: 4 })
    assertEquals(futuro.corpo.options[0].deliveryDays, 0)
    for (const contrato of ["omitir", 2, 1, 0, "3", null, true, {}, [3]]) {
        const { corpo } = await cota({ modo: "entrego", config: { local_delivery_days: 0 }, contratoCliente: contrato })
        assertEquals(corpo.options[0].deliveryDays, 1, `contratoCliente=${JSON.stringify(contrato)}`)
    }
})

Deno.test("prazo: só o 0 é reescrito para o app antigo — 2 dias seguem 2 sem contratoCliente", async () => {
    const { corpo } = await cota({ modo: "entrego", config: { local_delivery_days: 2 }, contratoCliente: "omitir" })
    assertEquals(corpo.options[0].deliveryDays, 2)
})

// ── Leitura tolerante: tudo que não é a linha esperada vira "como hoje" ─────

Deno.test("tolerância: erro do PostgREST (42703) na leitura das colunas novas -> entrega ligada, 1 dia, 200", async () => {
    const { resposta, corpo } = await cota({
        modo: "so_retiro",
        config: { local_delivery_days: 5 },
        falhas: { colunasDaEntrega: true },
    })
    assertEquals(resposta.status, 200)
    // Comportamento de hoje, com a chave da retirada ligada: as duas opções, entrega em 1 dia.
    assertEquals(ids(corpo), ["local-delivery", "store-pickup"])
    assertEquals(corpo.options[0].deliveryDays, 1)
})

Deno.test("tolerância: EXCEÇÃO (rede caiu) ao ler as colunas novas -> como hoje, 200, e a ação pública também responde", async () => {
    const banco = bancoFalso({ config: { ...DOS_MODOS.so_retiro, local_delivery_days: 4 }, enderecoDaLoja: ENDERECO })
    const fromOriginal = banco.cliente.from
    banco.cliente.from = (tabela: string) => {
        const t = fromOriginal(tabela)
        if (tabela !== "store_config") return t
        return {
            ...t,
            select: (c?: string) => {
                if (c?.includes("local_delivery_enabled")) throw new Error("conexão perdida")
                return t.select(c)
            },
        }
    }
    const { resposta, corpo } = await cota({ banco })
    assertEquals(resposta.status, 200)
    assertEquals(ids(corpo), ["local-delivery", "store-pickup"])
    assertEquals(corpo.options[0].deliveryDays, 1)
    const acao = await rodar({ action: "revisao_config_frete" }, { admin: false, banco })
    assertEquals(acao.resposta.status, 200)
})

Deno.test("tolerância: a coluna nova NUNCA entra no select principal (a cotação inteira depende dele)", async () => {
    assertEquals(COLUNAS_DA_LOJA.includes("local_delivery_enabled"), false)
    assertEquals(COLUNAS_DA_LOJA.includes("local_delivery_days"), false)
    // E, num banco que recusa qualquer select que cite as colunas novas, a cotação de fora também sai.
    const { resposta, corpo } = await cota({ cep: CEP_FORA, falhas: { colunasDaEntrega: true } })
    assertEquals(resposta.status, 200, JSON.stringify(corpo))
    assert(doProvedor(corpo).length > 0)
})

Deno.test("tolerância: valor fora do que o CHECK da migration garante -> a linha INTEIRA é ignorada (como hoje)", async () => {
    const invalidos: Array<Record<string, unknown>> = [
        { local_delivery_enabled: false, local_delivery_days: 31 },
        { local_delivery_enabled: false, local_delivery_days: -1 },
        { local_delivery_enabled: false, local_delivery_days: 1.5 },
        { local_delivery_enabled: false, local_delivery_days: "2" },
        { local_delivery_enabled: false, local_delivery_days: null },
        { local_delivery_enabled: "false", local_delivery_days: 1 },
        { local_delivery_enabled: null, local_delivery_days: 1 },
        { local_delivery_enabled: false }, // só uma das duas colunas veio
        { local_delivery_days: 4 },
    ]
    for (const extra of invalidos) {
        const { corpo } = await cota({ config: { enabled_shipping_methods: ["sedex", "pac"], ...extra } })
        assertEquals(ids(corpo), ["local-delivery"], JSON.stringify(extra))
        assertEquals(corpo.options[0].deliveryDays, 1, JSON.stringify(extra))
    }
})

Deno.test("tolerância: limites do CHECK (0 e 30) valem; 30 sai como 30", async () => {
    const trinta = await cota({ modo: "entrego", config: { local_delivery_days: 30 } })
    assertEquals(trinta.corpo.options[0].deliveryDays, 30)
    const zero = await cota({ modo: "entrego", config: { local_delivery_days: 0 } })
    assertEquals(zero.corpo.options[0].deliveryDays, 0)
})

// ── Só retiro: o que acontece quando falta alguma peça ──────────────────────

Deno.test("só retiro: app ANTIGO (sem aceitaRetirada) na cidade -> lista vazia (nunca Entrega Local), endereço nem é lido", async () => {
    for (const sinal of ["omitir", false, "true", 1, null]) {
        const { resposta, corpo, registro } = await cota({ modo: "so_retiro", aceitaRetirada: sinal })
        assertEquals(resposta.status, 200)
        assertEquals(corpo.options, [], `aceitaRetirada=${JSON.stringify(sinal)}`)
        assertEquals(registro.leiturasDeEndereco, 0)
    }
})

Deno.test("só retiro: app ANTIGO fora da cidade -> só as transportadoras (como hoje), sem retirada", async () => {
    const { corpo } = await cota({ modo: "so_retiro", cep: CEP_FORA, aceitaRetirada: "omitir" })
    assert(doProvedor(corpo).length > 0)
    assertEquals(ids(corpo).includes("store-pickup"), false)
})

Deno.test("só retiro: app ANTIGO + cobertura só-cidade + CEP de fora -> 200 lista vazia (não o 400 'só entregas locais')", async () => {
    const { resposta, corpo } = await cota({ modo: "so_retiro", cep: CEP_FORA, cobertura: "local", aceitaRetirada: "omitir" })
    assertEquals(resposta.status, 200)
    assertEquals(corpo.options, [])
})

Deno.test("só retiro: SEM endereço físico (null, vazio, só espaços) -> nada a oferecer, nunca endereço inventado", async () => {
    for (const endereco of [null, "", "   "]) {
        const { resposta, corpo } = await cota({ modo: "so_retiro", endereco })
        assertEquals(resposta.status, 200)
        assertEquals(corpo.options, [], `endereço ${JSON.stringify(endereco)}`)
    }
})

Deno.test("só retiro: chave store-pickup AUSENTE (estado que a trigger do banco impede) -> também nada, e sem Entrega Local", async () => {
    const { corpo, registro } = await cota({
        config: { enabled_shipping_methods: ["sedex", "pac"], local_delivery_enabled: false, local_delivery_days: 1 },
    })
    assertEquals(corpo.options, [])
    assertEquals(registro.leiturasDeEndereco, 0)
})

Deno.test("só retiro: a retirada leva o endereço aparado e o contrato de sempre", async () => {
    const { corpo } = await cota({ modo: "so_retiro", endereco: `  ${ENDERECO}  `, cep: CEP_FORA, comTransportadora: false })
    assertEquals(corpo.options, [{
        id: "store-pickup",
        name: "Retirar na loja",
        price: 0,
        deliveryDays: 0,
        provider: "pickup",
        pickupAddress: ENDERECO,
    }])
})

Deno.test("só retiro: leitura do endereço falha -> 200 sem retirada (nada de erro 500)", async () => {
    const banco = bancoFalso({ config: DOS_MODOS.so_retiro, enderecoDaLoja: ENDERECO })
    const clienteOriginal = banco.cliente.from
    banco.cliente.from = (tabela: string) => {
        const t = clienteOriginal(tabela)
        if (tabela !== "store_config") return t
        return {
            ...t,
            select: (c?: string) => {
                if (c?.includes("store_address")) throw new Error("conexão perdida")
                return t.select(c)
            },
        }
    }
    const { resposta, corpo } = await cota({ banco })
    assertEquals(resposta.status, 200)
    assertEquals(corpo.options, [])
})

Deno.test("só retiro + frete grátis por produto (CEP de fora): a promoção sai E a retirada junto", async () => {
    const { corpo } = await cota({
        modo: "so_retiro",
        cep: CEP_FORA,
        config: { free_shipping_min: -1 },
        produtos: [{ ...PRODUTO_P1, frete_gratis: true }],
    })
    assertEquals(ids(corpo), ["free-shipping-promo", "store-pickup"])
})

Deno.test("só retiro + carrinho vazio (CEP de fora): só a retirada, como a cidade devolve opções com carrinho vazio", async () => {
    const { resposta, corpo } = await cota({ modo: "so_retiro", cep: CEP_FORA, cart: [] })
    assertEquals(resposta.status, 200)
    assertEquals(ids(corpo), ["store-pickup"])
})

Deno.test("só retiro + credenciais ilegíveis (CEP de fora): sem cotação de fora, mas a retirada continua", async () => {
    const { corpo } = await cota({ modo: "so_retiro", cep: CEP_FORA, falhas: { credenciais: "erro" } })
    assertEquals(ids(corpo), ["store-pickup"])
})

// ── Cache: a retirada é anexada DEPOIS, nunca guardada ──────────────────────

Deno.test("cache: só retiro grava só as transportadoras; o acerto do cache devolve transportadoras + retirada", async () => {
    const banco = bancoFalso({ config: DOS_MODOS.so_retiro, enderecoDaLoja: ENDERECO })
    const primeira = await cota({ banco, cep: CEP_FORA })
    assertEquals(banco.registro.upsertsCache.length, 1)
    assertEquals(JSON.stringify(banco.registro.upsertsCache).includes("store-pickup"), false)
    assertEquals(primeira.corpo.options.at(-1).id, "store-pickup")

    const chamadasAntes = primeira.chamadas.filter((c) => c.url.includes(SF)).length
    assertEquals(chamadasAntes, 1)
    const segunda = await cota({ banco, cep: CEP_FORA })
    assertEquals(segunda.chamadas.filter((c) => c.url.includes(SF)).length, 0, "a segunda veio do cache")
    assertEquals(banco.registro.upsertsCache.length, 1, "o acerto não regrava")
    assertEquals(segunda.corpo.options.at(-1).id, "store-pickup")
    assertEquals(ids(segunda.corpo).filter((i) => i === "store-pickup").length, 1, "uma retirada só, nunca duplicada")
    assertEquals(JSON.stringify(banco.registro.cacheLinhas).includes("store-pickup"), false)
})

Deno.test("cache: a cliente do app antigo, no cache de uma loja em só retiro, não recebe retirada", async () => {
    const banco = bancoFalso({ config: DOS_MODOS.so_retiro, enderecoDaLoja: ENDERECO })
    await cota({ banco, cep: CEP_FORA })
    const antigo = await cota({ banco, cep: CEP_FORA, aceitaRetirada: "omitir" })
    assertEquals(ids(antigo.corpo).includes("store-pickup"), false)
    assert(doProvedor(antigo.corpo).length > 0)
})

Deno.test("cache: falha ao gravar o cache em só retiro -> a retirada (que não precisa do cache) sai, incompleta; nos outros modos é 503 como sempre", async () => {
    const soRetiro = await cota({ modo: "so_retiro", cep: CEP_FORA, falhas: { gravarCache: true } })
    assertEquals(soRetiro.resposta.status, 200)
    assertEquals(ids(soRetiro.corpo), ["store-pickup"])
    assertEquals(soRetiro.corpo.cotacaoIncompleta, true)
    const retiroEEntrego = await cota({ modo: "entrego_e_retiro", cep: CEP_FORA, falhas: { gravarCache: true } })
    assertEquals(retiroEEntrego.resposta.status, 503)
})

const FALHAS_NACIONAIS = [
    {
        nome: "transportadora sem nenhuma opção",
        falhas: {},
        rotas: () => ({ sf: () => json({ message: "fora do ar" }, 500) }),
        chamadasSf: 1,
        erro: { error: "Não foi possível calcular o frete agora. Tente novamente em instantes." },
    },
    {
        nome: "revisão das credenciais ilegível",
        falhas: { revisao: true },
        rotas: () => ({}),
        chamadasSf: 0,
        erro: { error: "Não foi possível calcular o frete agora. Tente novamente em instantes." },
    },
    {
        nome: "configuração mudou duas vezes",
        falhas: {},
        rotas: (banco: ReturnType<typeof bancoFalso>) => {
            let revisao = 0
            return {
                sf: () => {
                    banco.credenciais.find((l) => l.provider === "_revisao").credentials.revisao = `rev-${++revisao}`
                    return json(RESPOSTA_SF_OFICIAL)
                },
            }
        },
        chamadasSf: 2,
        erro: { error: "Não foi possível registrar a cotação de frete. Tente calcular novamente.", cotacaoIncompleta: true },
    },
]

for (const falha of FALHAS_NACIONAIS) {
    const cotarComFalha = async (modo: Modo, extra: Parameters<typeof cota>[0] = {}) => {
        const configDoModo = Object.entries(DOS_MODOS).find(([chave]) => chave === modo)![1]
        const banco = bancoFalso({
            config: { ...configDoModo, ...extra.config },
            enderecoDaLoja: extra.endereco === undefined ? ENDERECO : extra.endereco,
            credenciais: [LINHA_SF, { provider: "_revisao", credentials: { revisao: "rev-0" }, updated_at: "t" }],
            falhas: falha.falhas,
        })
        const resultado = await cota({ ...extra, banco, cep: CEP_FORA, rotas: falha.rotas(banco) })
        assertEquals(resultado.chamadas.filter((c) => c.url.includes(SF)).length, falha.chamadasSf)
        assertEquals(resultado.registro.upsertsCache, [], "a falha não grava cotação nem retirada no cache")
        assertEquals(resultado.registro.logs.at(-1)?.status, "error", "o motivo continua no histórico")
        return resultado
    }

    Deno.test(`só retiro: ${falha.nome} fora da cidade preserva só a retirada, incompleta`, async () => {
        const { resposta, corpo } = await cotarComFalha("so_retiro")
        assertEquals(resposta.status, 200)
        assertEquals(corpo.options, [{
            id: "store-pickup",
            name: "Retirar na loja",
            price: 0,
            deliveryDays: 0,
            provider: "pickup",
            pickupAddress: ENDERECO,
        }])
        assertEquals(corpo.cotacaoIncompleta, true)
    })

    for (const modo of ["entrego", "entrego_e_retiro"] as const) {
        Deno.test(`${modo}: ${falha.nome} fora da cidade mantém o 503 e o corpo de antes`, async () => {
            const { resposta, texto, registro } = await cotarComFalha(modo)
            assertEquals(resposta.status, 503)
            assertEquals(texto, JSON.stringify(falha.erro))
            assertEquals(registro.leiturasDeEndereco, 0)
        })
    }

    Deno.test(`só retiro: ${falha.nome} sem cada requisito da retirada mantém o 503 de antes`, async () => {
        for (const extra of [
            { aceitaRetirada: "omitir" },
            { aceitaRetirada: false },
            { aceitaRetirada: "true" },
            { config: { enabled_shipping_methods: ["sedex", "pac"] } },
            { endereco: null },
            { endereco: "" },
            { endereco: "   " },
        ]) {
            const { resposta, texto } = await cotarComFalha("so_retiro", extra)
            assertEquals(resposta.status, 503, JSON.stringify(extra))
            assertEquals(texto, JSON.stringify(falha.erro))
        }
    })
}

// ── A revisão (o hash que invalida o cache do celular) ──────────────────────
//
// Constantes DOURADAS: calculadas com o `configuracao.ts` ANTES desta peça
// (origin/claude/app-major-upgrade-wmc8x2 @ db231b87). Loja no padrão tem de
// continuar com o MESMO hash, byte a byte.

const LINHAS_LEGADO = new Map([["superfrete", LINHA_SF]])
const LINHAS_MULTI = new Map([
    ["melhor_envio", LINHA_ME],
    ["superfrete", LINHA_SF],
    ["_ligados", linhaLigados(["melhor_envio", "superfrete"])],
])
const NACIONAL = { estrategia: "acima_de_valor", minimo: 199, tipoDesconto: null, valorDesconto: 0, alcance: "todas" }
const PADRAO = { ativa: true, dias: 1 }
const OURO = {
    legadoSemNacional: "8f6ad496554bf036be7e8c63e573a23c67f94720d4068acb51d341c8ec8a065a",
    legadoComNacional: "57242eed55316e674c3b9981a42bd728b2434c18fd376ec4050f5810338972b1",
    multiComNacional: "6bfdd08250e57e3ae8226b920d5398ed2298e10d5029c9486605954c7744c70e",
}
const CONFIG_MULTI = { ...CONFIG_BASE, enabled_shipping_methods: ["sedex", "store-pickup"], local_cep_range: "38500-000, 38500-999" }

Deno.test("revisão: loja no padrão mantém o hash de ANTES, byte a byte (3 combinações, com e sem o argumento novo)", async () => {
    // Sem o argumento (a chamada de antes desta peça):
    assertEquals(await edge.calcularRevisaoConfig(CONFIG_BASE, LINHAS_LEGADO, "rev-1", null), OURO.legadoSemNacional)
    assertEquals(await edge.calcularRevisaoConfig(CONFIG_BASE, LINHAS_LEGADO, "rev-1", NACIONAL), OURO.legadoComNacional)
    assertEquals(await edge.calcularRevisaoConfig(CONFIG_MULTI, LINHAS_MULTI, "rev-2", NACIONAL), OURO.multiComNacional)
    // Com a leitura nova no padrão (ligada, 1 dia) ou ausente (null): o MESMO hash.
    for (const padrao of [PADRAO, null]) {
        assertEquals(await edge.calcularRevisaoConfig(CONFIG_BASE, LINHAS_LEGADO, "rev-1", null, padrao), OURO.legadoSemNacional)
        assertEquals(await edge.calcularRevisaoConfig(CONFIG_BASE, LINHAS_LEGADO, "rev-1", NACIONAL, padrao), OURO.legadoComNacional)
        assertEquals(await edge.calcularRevisaoConfig(CONFIG_MULTI, LINHAS_MULTI, "rev-2", NACIONAL, padrao), OURO.multiComNacional)
    }
})

Deno.test("revisão: fora do padrão o hash MUDA — só retiro, cada prazo, e os dois juntos são hashes diferentes", async () => {
    const base = OURO.legadoComNacional
    const soRetiro = await edge.calcularRevisaoConfig(CONFIG_BASE, LINHAS_LEGADO, "rev-1", NACIONAL, { ativa: false, dias: 1 })
    const doisDias = await edge.calcularRevisaoConfig(CONFIG_BASE, LINHAS_LEGADO, "rev-1", NACIONAL, { ativa: true, dias: 2 })
    const mesmoDia = await edge.calcularRevisaoConfig(CONFIG_BASE, LINHAS_LEGADO, "rev-1", NACIONAL, { ativa: true, dias: 0 })
    const soRetiro3 = await edge.calcularRevisaoConfig(CONFIG_BASE, LINHAS_LEGADO, "rev-1", NACIONAL, { ativa: false, dias: 3 })
    const todos = [base, soRetiro, doisDias, mesmoDia, soRetiro3]
    assertEquals(new Set(todos).size, todos.length)
    // Sem segredo: o hash continua 64 hex.
    for (const h of todos) assert(/^[0-9a-f]{64}$/.test(h))
})

Deno.test("revisão: a resposta da cotação usa o hash de antes com os padrões, e muda quando a lojista muda", async () => {
    const revisaoDe = async (config: Record<string, unknown>, falhas?: Record<string, boolean>) =>
        (await cota({ config: { enabled_shipping_methods: ["sedex", "pac"], ...config }, falhas })).corpo.revisaoConfig
    const semColunas = await revisaoDe({})
    assert(typeof semColunas === "string" && semColunas.length === 64)
    // Colunas no padrão = mesmo hash de banco sem as colunas.
    assertEquals(await revisaoDe({ local_delivery_enabled: true, local_delivery_days: 1 }), semColunas)
    // Leitura falhou (mesmo com a loja em só retiro gravada): comportamento de hoje, hash de hoje.
    assertEquals(
        await revisaoDe({ local_delivery_enabled: false, local_delivery_days: 4 }, { colunasDaEntrega: true }),
        semColunas,
    )
    // Valor inválido: leitura rejeitada = hash de hoje.
    assertEquals(await revisaoDe({ local_delivery_enabled: false, local_delivery_days: 99 }), semColunas)
    // Muda quando a lojista muda...
    const soRetiro = await revisaoDe({ local_delivery_enabled: false, local_delivery_days: 1 })
    const doisDias = await revisaoDe({ local_delivery_enabled: true, local_delivery_days: 2 })
    assertNotEquals(soRetiro, semColunas)
    assertNotEquals(doisDias, semColunas)
    assertNotEquals(soRetiro, doisDias)
    // ...e volta ao hash de antes quando ela volta ao padrão.
    assertEquals(await revisaoDe({ local_delivery_enabled: true, local_delivery_days: 1 }), semColunas)
})

Deno.test("revisão: a ação pública revisao_config_frete reage ao modo e ao prazo como a cotação", async () => {
    const pelaAcao = async (extra: Record<string, unknown>) => {
        const banco = bancoFalso({ config: { enabled_shipping_methods: ["sedex", "pac"], ...extra } })
        return (await rodar({ action: "revisao_config_frete" }, { admin: false, banco })).corpo.revisaoConfig
    }
    const padrao = await pelaAcao({})
    assertEquals(await pelaAcao({ local_delivery_enabled: true, local_delivery_days: 1 }), padrao)
    assertNotEquals(await pelaAcao({ local_delivery_enabled: false, local_delivery_days: 1 }), padrao)
    assertNotEquals(await pelaAcao({ local_delivery_enabled: true, local_delivery_days: 5 }), padrao)
    // Banco que recusa as colunas: a ação continua respondendo, com o hash de hoje.
    const banco = bancoFalso({
        config: { enabled_shipping_methods: ["sedex", "pac"], local_delivery_enabled: false },
        falhas: { colunasDaEntrega: true },
    })
    assertEquals((await rodar({ action: "revisao_config_frete" }, { admin: false, banco })).corpo.revisaoConfig, padrao)
})

Deno.test("cache nacional: mudar para só retiro invalida a assinatura (a cliente com carrinho aberto recota)", async () => {
    const banco = bancoFalso({ config: DOS_MODOS.entrego_e_retiro, enderecoDaLoja: ENDERECO })
    await cota({ banco, cep: CEP_FORA })
    assertEquals(banco.registro.upsertsCache.length, 1)
    banco.config.local_delivery_enabled = false // a lojista passa a "Só retiro"
    const depois = await cota({ banco, cep: CEP_FORA })
    assertEquals(depois.chamadas.filter((c) => c.url.includes(SF)).length, 1, "recotou: o cache antigo não serve")
    assertEquals(depois.corpo.options.at(-1).id, "store-pickup")
})
