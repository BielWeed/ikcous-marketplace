// @ts-nocheck
// Caça por mutação (25/11/2026) na `calculate-shipping`: pontos do handler em
// que um defeito plantado passava por TODOS os testes antigos. Cada teste aqui
// derruba um defeito específico (citado no título) e passa no código real.
// Dublês: os mesmos de `apoio-dos-testes.ts` (banco e transportadoras falsos,
// tokens e produtos fictícios), nenhuma rede.
import { assert, assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts"
import {
    bancoFalso,
    CARRINHO_P1,
    cotacao,
    LINHA_FRENET,
    LINHA_ME,
    LINHA_SF,
    linhaLigados,
    PRODUTO_P1,
    rodar,
} from "./apoio-dos-testes.ts"
import * as edge from "./index.ts"

const ids = (corpo: any) => corpo.options.map((o: any) => o.id)
const CEP_LOCAL = "38500-120"
const IDS_SF = ["superfrete-1", "superfrete-17", "superfrete-2"]

/** Banco no modo MULTI (linha `_ligados`), como o da `cotacao_multi_test.ts`. */
const multi = (ligados: string[], outras: Record<string, unknown> = {}) =>
    bancoFalso({ credenciais: [LINHA_ME, LINHA_SF, LINHA_FRENET, linhaLigados(ligados)], ...outras })

/**
 * A leitura principal de `store_config` (a primeira) volta com erro DO
 * PostgREST **e** com a linha presente — o que acontece quando o banco devolve
 * o corpo e o aviso juntos (timeout parcial, `PGRST` de coluna). A linha não
 * pode valer: erro explícito é falha de configuração.
 */
function comErroNaConfigMasComLinha(banco: ReturnType<typeof bancoFalso>) {
    const original = banco.cliente.from
    let falhou = false
    banco.cliente.from = (tabela: string) => {
        const base = original(tabela)
        if (tabela !== "store_config") return base
        return {
            ...base,
            select: (colunas?: string) => {
                const construtor = base.select(colunas)
                if (falhou) return construtor
                const lerUnico = construtor.single
                construtor.single = async () => {
                    falhou = true
                    const lido = await lerUnico()
                    return { data: lido.data, error: { code: "57014", message: "statement timeout simulado" } }
                }
                return construtor
            },
        }
    }
}

/** Anota cada `.eq/.gt/.order/.limit` pedido ao cache de cotações. */
function espiarOCache(banco: ReturnType<typeof bancoFalso>) {
    const pedidos: any[][] = []
    const original = banco.cliente.from
    banco.cliente.from = (tabela: string) => {
        const base = original(tabela)
        if (tabela !== "shipping_quotes_cache") return base
        return {
            ...base,
            select: (colunas?: string) => {
                const construtor = base.select(colunas)
                for (const nome of ["eq", "gt", "order", "limit"]) {
                    const funcao = Reflect.get(construtor, nome)
                    Reflect.set(construtor, nome, (...args: unknown[]) => {
                        pedidos.push([nome, ...args])
                        return funcao(...args)
                    })
                }
                return construtor
            },
        }
    }
    return pedidos
}

// ── Erro de configuração com a linha presente ───────────────────────────────

Deno.test("store_config com erro do banco MESMO trazendo a linha: 500, nenhuma transportadora chamada e nada gravado (a linha não vale)", async () => {
    const banco = bancoFalso()
    comErroNaConfigMasComLinha(banco)
    const { resposta, corpo, chamadas, registro } = await rodar(cotacao(), { banco })
    assertEquals(resposta.status, 500)
    assertEquals(corpo.error, "Não foi possível calcular o frete agora. Tente novamente.")
    assertEquals(chamadas.length, 0)
    assertEquals(registro.upsertsCache.length, 0)
})

// ── Frete grátis só com item MARCADO (dinheiro) ─────────────────────────────

Deno.test("preset por_produto (-1) com item NÃO marcado: fora da cidade cota de verdade, nunca free-shipping-promo R$ 0", async () => {
    const banco = bancoFalso({ config: { free_shipping_min: -1 }, produtos: [{ ...PRODUTO_P1, frete_gratis: false }] })
    const { resposta, corpo, chamadas, texto } = await rodar(cotacao(), { banco })
    assertEquals(resposta.status, 200)
    assertEquals(ids(corpo).sort(), IDS_SF)
    assert(corpo.options.every((o: any) => o.price > 0))
    assert(chamadas.length > 0, "tem que ter falado com a transportadora")
    assertEquals(texto.includes("free-shipping-promo"), false)
})

Deno.test("preset por_produto (-1) com item NÃO marcado, CEP da cidade: Entrega Local R$ 10, nunca R$ 0", async () => {
    const banco = bancoFalso({ config: { free_shipping_min: -1 }, produtos: [{ ...PRODUTO_P1, frete_gratis: false }] })
    const { corpo } = await rodar(cotacao({ cep: CEP_LOCAL }), { banco })
    assertEquals(ids(corpo), ["local-delivery"])
    assertEquals(corpo.options[0].price, 10)
})

Deno.test("o navegador não decide o grátis: product.freeShipping true com o BANCO dizendo false continua pagando frete", async () => {
    const banco = bancoFalso({ config: { free_shipping_min: -1 }, produtos: [{ ...PRODUTO_P1, frete_gratis: false }] })
    const fora = await rodar(cotacao({ cart: [{ product: { id: "p1", freeShipping: true }, quantity: 1 }] }), { banco })
    assertEquals(ids(fora.corpo).sort(), IDS_SF)
    assertEquals(fora.texto.includes("free-shipping-promo"), false)
    const bancoLocal = bancoFalso({ config: { free_shipping_min: -1 }, produtos: [{ ...PRODUTO_P1, frete_gratis: false }] })
    const local = await rodar(
        cotacao({ cep: CEP_LOCAL, cart: [{ product: { id: "p1", freeShipping: true }, quantity: 1 }] }),
        { banco: bancoLocal },
    )
    assertEquals(local.corpo.options[0].price, 10)
})

Deno.test("estratégia nacional por_produto com item NÃO marcado: cota de verdade (o atalho de R$ 0 exige item marcado)", async () => {
    const banco = bancoFalso({
        config: {
            national_shipping_strategy: "por_produto",
            national_shipping_min: 0,
            national_discount_type: null,
            national_discount_value: 0,
            national_benefit_scope: "todas",
        },
        produtos: [{ ...PRODUTO_P1, frete_gratis: false }],
    })
    const { corpo, chamadas, texto } = await rodar(cotacao(), { banco })
    assertEquals(ids(corpo).sort(), IDS_SF)
    assert(chamadas.length > 0)
    assertEquals(texto.includes("free-shipping-promo"), false)
})

Deno.test("grátis por produto: a resposta é uma lista inteira (cotacaoIncompleta false) e já traz a revisão da configuração", async () => {
    const banco = bancoFalso({ config: { free_shipping_min: -1 }, produtos: [{ ...PRODUTO_P1, frete_gratis: true }] })
    const { corpo } = await rodar(cotacao(), { banco })
    assertEquals(ids(corpo), ["free-shipping-promo"])
    assertEquals(corpo.cotacaoIncompleta, false)
    assertEquals(typeof corpo.revisaoConfig, "string")
})

// ── Só consulta o que o carrinho tem ────────────────────────────────────────

Deno.test("carrinho vazio não consulta produtos nem variações; carrinho sem variação consulta só os produtos", async () => {
    const vazio = await rodar(cotacao({ cart: [] }), {})
    assertEquals(vazio.resposta.status, 200)
    assertEquals(vazio.registro.filtrosIn, [])
    assertEquals(vazio.chamadas.length, 0)

    const semVariacao = await rodar(cotacao(), {})
    assertEquals(semVariacao.registro.filtrosIn.map((f: any) => [f.tabela, f.coluna, f.valores]), [["produtos", "id", ["p1"]]])
})

// ── Revisão e credenciais: sem a revisão lida, a resposta não leva carimbo ──

Deno.test("revisão ilegível com credenciais lidas: a resposta local NÃO inventa revisaoConfig (nem calcula com revisão faltando)", async () => {
    const banco = bancoFalso({ falhas: { revisao: true } })
    const { resposta, corpo } = await rodar(cotacao({ cep: CEP_LOCAL }), { banco })
    assertEquals(resposta.status, 200)
    assertEquals(ids(corpo), ["local-delivery"])
    assertEquals("revisaoConfig" in corpo, false)
})

// ── Histórico: qual provedor e qual motivo ficam gravados ───────────────────

Deno.test("produtos ilegíveis: o histórico leva o provedor da loja, e 'flat_fee' só quando a loja não tem provedor", async () => {
    const comProvedor = await rodar(cotacao(), { banco: bancoFalso({ falhaAoLerProdutos: true }) })
    assertEquals(comProvedor.resposta.status, 503)
    assertEquals(comProvedor.registro.logs.at(-1)?.provider, "superfrete")
    assertEquals(comProvedor.registro.logs.at(-1)?.status, "error")

    const semProvedor = await rodar(cotacao(), { banco: bancoFalso({ falhaAoLerProdutos: true, config: { shipping_provider: "" } }) })
    assertEquals(semProvedor.registro.logs.at(-1)?.provider, "flat_fee")
})

Deno.test("credenciais ilegíveis: o histórico leva o provedor da loja, e 'flat_fee' só quando a loja não tem provedor", async () => {
    const comProvedor = await rodar(cotacao(), { banco: bancoFalso({ falhas: { credenciais: "erro" } }) })
    assertEquals(comProvedor.registro.logs.at(-1)?.provider, "superfrete")
    assertEquals(comProvedor.registro.logs.at(-1)?.status, "error")

    const semProvedor = await rodar(cotacao(), { banco: bancoFalso({ falhas: { credenciais: "erro" }, config: { shipping_provider: "" } }) })
    assertEquals(semProvedor.registro.logs.at(-1)?.provider, "flat_fee")
})

Deno.test("sem transportadora ligada: o motivo gravado no histórico diz a coisa certa em cada modo (multi x legado)", async () => {
    const emMulti = await rodar(cotacao(), { banco: multi([]) })
    assertEquals(emMulti.corpo.options, [])
    const motivoMulti = String(emMulti.registro.logs.at(-1)?.error_message)
    assert(motivoMulti.includes("Nenhuma transportadora ligada"), motivoMulti)

    const emLegado = await rodar(cotacao(), { banco: bancoFalso({ config: { shipping_provider: "flat_fee" } }) })
    assertEquals(emLegado.corpo.options, [])
    const motivoLegado = String(emLegado.registro.logs.at(-1)?.error_message)
    assert(motivoLegado.includes("Loja sem transportadora conectada"), motivoLegado)
    assertEquals(motivoLegado.includes("Nenhuma transportadora ligada"), false)
})

Deno.test("transportadora ligada sem chave: o motivo gravado diz a coisa certa em cada modo (multi x legado)", async () => {
    // multi: a lista liga o Frenet, mas a linha dele sumiu.
    const emMulti = await rodar(cotacao(), {
        banco: bancoFalso({ credenciais: [LINHA_ME, LINHA_SF, linhaLigados(["frenet"])] }),
    })
    assertEquals(emMulti.corpo.options, [])
    const motivoMulti = String(emMulti.registro.logs.at(-1)?.error_message)
    assert(motivoMulti.includes("sem chave de acesso"), motivoMulti)

    // legado: o shipping_provider aponta para um provedor sem linha de credencial.
    const emLegado = await rodar(cotacao(), {
        banco: bancoFalso({ credenciais: [LINHA_ME], config: { shipping_provider: "superfrete" } }),
    })
    assertEquals(emLegado.corpo.options, [])
    const motivoLegado = String(emLegado.registro.logs.at(-1)?.error_message)
    assert(motivoLegado.includes('Sem credencial cadastrada para o provedor "superfrete"'), motivoLegado)
    assertEquals(motivoLegado.includes("sem chave de acesso"), false)
})

// ── Cache: a linha MAIS NOVA, e a resposta do acerto é lista inteira ────────

Deno.test("acerto do cache: lê só a linha mais NOVA das últimas 2 h e responde lista inteira (cotacaoIncompleta e cotacaoParcial false)", async () => {
    const banco = bancoFalso()
    const primeira = await rodar(cotacao(), { banco })
    assertEquals(primeira.resposta.status, 200)

    const pedidos = espiarOCache(banco)
    const agora = Date.now()
    const segunda = await rodar(cotacao(), { banco })
    assertEquals(segunda.chamadas.length, 0, "foi servida do cache")
    assertEquals(segunda.corpo.options, primeira.corpo.options)
    assertEquals(segunda.corpo.cotacaoIncompleta, false)
    assertEquals(segunda.corpo.cotacaoParcial, false)
    assertEquals(typeof segunda.corpo.revisaoConfig, "string")

    const ordem = pedidos.find((p) => p[0] === "order")
    assertEquals(ordem?.slice(1), ["created_at", { ascending: false }])
    assertEquals(pedidos.find((p) => p[0] === "limit")?.slice(1), [1])
    const janela = pedidos.find((p) => p[0] === "gt")
    assertEquals(janela?.[1], "created_at")
    const limiteLido = Date.parse(String(janela?.[2]))
    assert(Math.abs(limiteLido - (agora - 2 * 60 * 60 * 1000)) < 60_000, `janela do cache: ${janela?.[2]}`)
    assertEquals(
        pedidos.filter((p) => p[0] === "eq").map((p) => [p[1], p[2]]),
        [["origin_cep", "38500000"], ["destination_cep", "01001000"], ["cart_hash", edge.getCartHash(CARRINHO_P1)]],
    )
})
