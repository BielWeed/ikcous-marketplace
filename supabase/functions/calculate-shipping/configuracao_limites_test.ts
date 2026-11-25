// @ts-nocheck
/**
 * Caça por mutação (25/11/2026) em `configuracao.ts` — o que decide QUAIS
 * transportadoras cotam, com QUE peso/medida/valor, e se o cache do servidor
 * ainda vale (preço velho servido à cliente = dinheiro). Só passavam pelo
 * `index_test.ts` (handler inteiro); defeitos de UMA linha sobreviviam:
 *
 *   * `montarInsumos`: o id do produto vem de `product.id` OU de `productId`,
 *     quantidade ausente/zero conta como 1, cada medida usa a SUA coluna e o
 *     SEU padrão (peso 0,3 kg; medida 15 cm), e os contadores de "produto sem
 *     cadastro" e "campo no padrão" andam de 1 em 1;
 *   * `assinaturaDaCotacao`: o hash é o do contrato 3 e NÃO depende da ordem do
 *     carrinho (trocar o `contrato` ou a ordenação mudaria todas as assinaturas
 *     e jogaria fora o cache de todas as lojas na publicação);
 *   * `cotacaoDoCacheServe`: lista vazia não serve; local/grátis/retirada
 *     servem; provedor desconhecido não; assinatura velha ou cotação parcial
 *     não; SuperFrete só com a marca da versão da cotação;
 *   * `conjuntoLigado`, `chavesDeTransportadora`, `metodosDaLoja`.
 *
 * Tudo puro; ids e valores inventados; sem rede, sem banco.
 */
import { assert, assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts"
import {
    assinaturaDaCotacao,
    chavesDeTransportadora,
    conjuntoLigado,
    cotacaoDoCacheServe,
    LINHA_DOS_LIGADOS,
    metodosDaLoja,
    montarInsumos,
} from "./configuracao.ts"
import { VERSAO_DA_COTACAO_SUPERFRETE } from "./provedores.ts"

// ── chaves e métodos ───────────────────────────────────────────────────

Deno.test("chavesDeTransportadora - tira só a retirada na loja; lista vazia continua vazia; o que não é lista dá []", () => {
    assertEquals(chavesDeTransportadora(["sedex", "store-pickup", "pac"]), ["sedex", "pac"])
    assertEquals(chavesDeTransportadora(["store-pickup"]), [])
    assertEquals(chavesDeTransportadora([]), [])
    assertEquals(chavesDeTransportadora(["Store-Pickup"]), ["Store-Pickup"])
    for (const nao of [null, undefined, "sedex", 5, { 0: "sedex" }, true]) {
        assertEquals(chavesDeTransportadora(nao), [], String(nao))
    }
})

Deno.test("metodosDaLoja - ausente vale sedex e pac; lista vazia continua vazia (= todas)", () => {
    assertEquals(metodosDaLoja({ enabled_shipping_methods: ["jadlog"] }), ["jadlog"])
    assertEquals(metodosDaLoja({ enabled_shipping_methods: [] }), [])
    assertEquals(metodosDaLoja({}), ["sedex", "pac"])
    assertEquals(metodosDaLoja({ enabled_shipping_methods: null }), ["sedex", "pac"])
    assertEquals(metodosDaLoja(null), ["sedex", "pac"])
    assertEquals(metodosDaLoja(undefined), ["sedex", "pac"])
})

// ── conjunto ligado ───────────────────────────────────────────────────

Deno.test("conjuntoLigado - com a linha `_ligados` vale a lista (só conhecidos, em ordem canônica) e cota só quem tem token; sem ela vale o espelho", () => {
    const linhas = new Map<string, any>([
        [LINHA_DOS_LIGADOS, { credentials: { ligados: ["frenet", "x", "melhor_envio", "superfrete", "frenet"] } }],
        ["melhor_envio", { credentials: { token: "tok-me" } }],
        ["frenet", { credentials: { token: "   " } }],
        ["superfrete", { credentials: {} }],
    ])
    assertEquals(conjuntoLigado({ shipping_provider: "superfrete" }, linhas), {
        modo: "multi",
        pedidos: ["superfrete", "melhor_envio", "frenet"],
        ligados: ["melhor_envio"],
    })
    // linha `_ligados` sem lista legível: ninguém ligado (e continua modo multi)
    for (const credentials of [{}, { ligados: "frenet" }, { ligados: null }, null]) {
        assertEquals(conjuntoLigado({ shipping_provider: "frenet" }, new Map([[LINHA_DOS_LIGADOS, { credentials }]])), {
            modo: "multi", pedidos: [], ligados: [],
        })
    }
    // legado: o espelho, só se for um provedor conhecido
    assertEquals(conjuntoLigado({ shipping_provider: "frenet" }, new Map()), { modo: "legado", pedidos: ["frenet"], ligados: ["frenet"] })
    for (const espelho of ["correios", "", null, undefined, 3, ["frenet"]]) {
        assertEquals(conjuntoLigado({ shipping_provider: espelho }, new Map()), { modo: "legado", pedidos: [], ligados: [] }, String(espelho))
    }
    assertEquals(conjuntoLigado(null, new Map()), { modo: "legado", pedidos: [], ligados: [] })
})

// ── insumos do carrinho ──────────────────────────────────────────────

const PRODUTO = {
    id: "p-a", preco_venda: 10, peso_kg: 1.5, comprimento_cm: 20, largura_cm: 10, altura_cm: 5,
}

Deno.test("montarInsumos - cada medida usa a SUA coluna (comprimento=C, largura=L, altura=A), o valor vem do banco ao centavo, na ordem do carrinho", () => {
    const { itens, produtosSemCadastro, camposPadrao } = montarInsumos(
        [{ product: { id: "p-a" }, quantity: 2 }],
        new Map([["p-a", PRODUTO]]),
        new Map(),
    )
    assertEquals(itens, [{ produto: "p-a", variante: null, qtd: 2, peso: 1.5, C: 20, L: 10, A: 5, valor: 10 }])
    assertEquals(produtosSemCadastro, 0)
    assertEquals(camposPadrao, 0)
    // valor com fração de centavo é arredondado
    const arred = montarInsumos([{ product: { id: "p-a" } }], new Map([["p-a", { ...PRODUTO, preco_venda: "10.006" }]]), new Map())
    assertEquals(arred.itens[0].valor, 10.01)
})

Deno.test("montarInsumos - id vem de `product.id` ou de `productId`; quantidade ausente, zero ou nula conta 1; texto numérico vale", () => {
    const produtos = new Map([["p-a", PRODUTO]])
    const qtdDe = (item: unknown) => montarInsumos([item], produtos, new Map()).itens[0]
    assertEquals(qtdDe({ productId: "p-a" }).produto, "p-a")
    assertEquals(qtdDe({ product: { id: "p-a" } }).produto, "p-a")
    assertEquals(qtdDe({ product: {}, productId: "p-a" }).produto, "p-a")
    assertEquals(qtdDe({ productId: "p-a" }).valor, 10)
    assertEquals(qtdDe({ productId: "p-a" }).qtd, 1)
    assertEquals(qtdDe({ productId: "p-a", quantity: 0 }).qtd, 1)
    assertEquals(qtdDe({ productId: "p-a", quantity: null }).qtd, 1)
    assertEquals(qtdDe({ productId: "p-a", quantity: "3" }).qtd, 3)
    assertEquals(qtdDe({ productId: "p-a", quantity: 4 }).qtd, 4)
})

Deno.test("montarInsumos - medida ruim usa o padrão CERTO de cada campo (0,3 kg; 15 cm) e conta um por campo; produto sem cadastro conta um e leva todos os padrões", () => {
    const ruim = { id: "p-a", preco_venda: 10, peso_kg: 0, comprimento_cm: null, largura_cm: "abc", altura_cm: -1 }
    const r = montarInsumos([{ productId: "p-a" }], new Map([["p-a", ruim]]), new Map())
    assertEquals(r.itens[0], { produto: "p-a", variante: null, qtd: 1, peso: 0.3, C: 15, L: 15, A: 15, valor: 10 })
    assertEquals(r.camposPadrao, 4)
    assertEquals(r.produtosSemCadastro, 0)
    // só um campo ruim: conta 1 e os outros ficam como estão
    const um = montarInsumos([{ productId: "p-a" }], new Map([["p-a", { ...PRODUTO, largura_cm: 0 }]]), new Map())
    assertEquals(um.itens[0].L, 15)
    assertEquals(um.itens[0].C, 20)
    assertEquals(um.itens[0].A, 5)
    assertEquals(um.camposPadrao, 1)
    // produto que o banco não conhece: padrão em tudo, valor null, contador 1 por item
    const sem = montarInsumos(
        [{ productId: "p-x", variantId: "v-9", quantity: 3 }, { productId: "p-y" }, { productId: "p-a" }],
        new Map([["p-a", PRODUTO]]),
        new Map(),
    )
    assertEquals(sem.itens[0], { produto: "p-x", variante: "v-9", qtd: 3, peso: 0.3, C: 15, L: 15, A: 15, valor: null })
    assertEquals(sem.itens[1].produto, "p-y")
    assertEquals(sem.itens[2].valor, 10)
    assertEquals(sem.produtosSemCadastro, 2)
    assertEquals(sem.camposPadrao, 0)
    // item sem id nenhum: produto null, e conta como sem cadastro
    const vazio = montarInsumos([{}], new Map(), new Map())
    assertEquals(vazio.itens[0].produto, null)
    assertEquals(vazio.produtosSemCadastro, 1)
})

Deno.test("montarInsumos - variação pedida usa o price_override do banco; variação de outro produto ou ausente deixa o valor null (falha fechada)", () => {
    const variantes = new Map([
        ["v-1", { id: "v-1", product_id: "p-a", price_override: 7.5 }],
        ["v-2", { id: "v-2", product_id: "p-outro", price_override: 1 }],
    ])
    const produtos = new Map([["p-a", PRODUTO]])
    const valorDe = (variantId: string) => montarInsumos([{ productId: "p-a", variantId }], produtos, variantes).itens[0].valor
    assertEquals(valorDe("v-1"), 7.5)
    assertEquals(valorDe("v-2"), null)
    assertEquals(valorDe("v-9"), null)
})

// ── assinatura da cotação ─────────────────────────────────────────────

Deno.test("assinaturaDaCotacao - é o hash do contrato 3 (valor fixo) e NÃO muda com a ordem do carrinho", async () => {
    const a = { produto: "p-a", variante: null, qtd: 2, peso: 0.3, C: 15, L: 15, A: 15, valor: 10 }
    const b = { produto: "p-b", variante: "v-1", qtd: 1, peso: 1.5, C: 20, L: 10, A: 5, valor: null }
    const esperado = "9d5dc8ac6c9457349582c05894ad002e81df7dbad680cfb079f180c2712672e8"
    assertEquals(await assinaturaDaCotacao("rev-fixture", [a, b]), esperado)
    assertEquals(await assinaturaDaCotacao("rev-fixture", [b, a]), esperado)
    // qualquer insumo ou a revisão que mude, muda a assinatura
    assert((await assinaturaDaCotacao("rev-fixture", [a, { ...b, valor: 1 }])) !== esperado)
    assert((await assinaturaDaCotacao("rev-fixture", [a, { ...b, qtd: 2 }])) !== esperado)
    assert((await assinaturaDaCotacao("outra-revisao", [a, b])) !== esperado)
    assert((await assinaturaDaCotacao("rev-fixture", [a])) !== esperado)
})

// ── o cache serve? ────────────────────────────────────────────────────

Deno.test("cotacaoDoCacheServe - só serve com TODAS as opções válidas: assinatura igual, sem parcial, provedor conhecido; local, grátis e retirada servem sempre", () => {
    const ASS = "assinatura-fixture"
    const nacional = (parcial: Record<string, unknown> = {}) => ({ provider: "melhor_envio", assinaturaCotacao: ASS, ...parcial })
    assertEquals(cotacaoDoCacheServe([nacional()], ASS), true)
    assertEquals(cotacaoDoCacheServe([nacional(), nacional({ provider: "frenet" })], ASS), true)
    // não serve: vazio, não lista, assinatura velha ou ausente, parcial, provedor desconhecido
    for (const options of [[], null, undefined, "x", {}, 5]) {
        assertEquals(cotacaoDoCacheServe(options, ASS), false, JSON.stringify(options))
    }
    assertEquals(cotacaoDoCacheServe([nacional({ assinaturaCotacao: "velha" })], ASS), false)
    assertEquals(cotacaoDoCacheServe([nacional({ assinaturaCotacao: undefined })], ASS), false)
    assertEquals(cotacaoDoCacheServe([nacional({ cotacaoParcial: true })], ASS), false)
    assertEquals(cotacaoDoCacheServe([nacional({ cotacaoParcial: false })], ASS), true)
    assertEquals(cotacaoDoCacheServe([nacional({ provider: "correios" })], ASS), false)
    assertEquals(cotacaoDoCacheServe([nacional({ provider: undefined })], ASS), false)
    assertEquals(cotacaoDoCacheServe([null], ASS), false)
    // UMA opção ruim derruba a lista inteira
    assertEquals(cotacaoDoCacheServe([nacional(), nacional({ assinaturaCotacao: "velha" })], ASS), false)
    // local, grátis e retirada servem sem assinatura, e não salvam uma nacional ruim
    for (const dono of ["local", "free", "pickup"]) {
        assertEquals(cotacaoDoCacheServe([{ provider: dono }], ASS), true, dono)
        assertEquals(cotacaoDoCacheServe([{ provider: dono }, nacional({ assinaturaCotacao: "velha" })], ASS), false, dono)
    }
    assertEquals(cotacaoDoCacheServe([{ provider: "store-pickup" }], ASS), false)
})

Deno.test("cotacaoDoCacheServe - SuperFrete só serve com a marca da versão da cotação", () => {
    const ASS = "assinatura-fixture"
    const sf = (parcial: Record<string, unknown> = {}) => ({ provider: "superfrete", assinaturaCotacao: ASS, cotacaoSf: VERSAO_DA_COTACAO_SUPERFRETE, ...parcial })
    assertEquals(cotacaoDoCacheServe([sf()], ASS), true)
    assertEquals(cotacaoDoCacheServe([sf({ cotacaoSf: VERSAO_DA_COTACAO_SUPERFRETE - 1 })], ASS), false)
    assertEquals(cotacaoDoCacheServe([sf({ cotacaoSf: VERSAO_DA_COTACAO_SUPERFRETE + 1 })], ASS), false)
    assertEquals(cotacaoDoCacheServe([sf({ cotacaoSf: undefined })], ASS), false)
    assertEquals(cotacaoDoCacheServe([sf({ cotacaoSf: String(VERSAO_DA_COTACAO_SUPERFRETE) })], ASS), false)
    // os outros provedores não precisam da marca
    assertEquals(cotacaoDoCacheServe([{ provider: "frenet", assinaturaCotacao: ASS }], ASS), true)
})
