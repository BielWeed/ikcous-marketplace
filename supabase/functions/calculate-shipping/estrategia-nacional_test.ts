// @ts-nocheck
// Regra pura da estratégia do frete NACIONAL (23/09/2026). Contrato:
// `docs/superpowers/plans/2026-09-23-estrategias-de-frete-local-e-nacional.md`.
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts"
import {
    aplicarEstrategiaNacional,
    type EstrategiaNacional,
    espelhoLegado,
    estrategiaNacionalDaLinha,
    subtotalDoCarrinho,
} from "./estrategia-nacional.ts"

const opcao = (id: string, price: number) => ({ id, name: id, price, deliveryDays: 5, provider: "melhor_envio" })

const estrategia = (parcial: Partial<EstrategiaNacional>): EstrategiaNacional => ({
    estrategia: "desligado",
    minimo: 0,
    tipoDesconto: null,
    valorDesconto: 0,
    alcance: "todas",
    ...parcial,
})

// ── espelhoLegado (tabela do contrato) ──────────────────────────────────────

// EMENDA (revisão T1, 23/09): `desligado` nasce com alcance `mais_barata`
// (o default da coluna no banco), não `todas` — os outros três continuam `todas`.
Deno.test("espelhoLegado: 0 e null → desligado, alcance mais_barata (o default da coluna)", () => {
    assertEquals(espelhoLegado(0), estrategia({ estrategia: "desligado", alcance: "mais_barata" }))
    assertEquals(espelhoLegado(null), estrategia({ estrategia: "desligado", alcance: "mais_barata" }))
    assertEquals(espelhoLegado(undefined), estrategia({ estrategia: "desligado", alcance: "mais_barata" }))
})

Deno.test("espelhoLegado: 0.01 → sempre, todas", () => {
    assertEquals(espelhoLegado(0.01), estrategia({ estrategia: "sempre", alcance: "todas" }))
})

Deno.test("espelhoLegado: negativo → por_produto, todas", () => {
    assertEquals(espelhoLegado(-1), estrategia({ estrategia: "por_produto", alcance: "todas" }))
    assertEquals(espelhoLegado(-0.5), estrategia({ estrategia: "por_produto", alcance: "todas" }))
})

Deno.test("espelhoLegado: positivo (≠ 0.01) → acima_de_valor, min = o mesmo, todas", () => {
    assertEquals(espelhoLegado(199), estrategia({ estrategia: "acima_de_valor", minimo: 199, alcance: "todas" }))
    assertEquals(espelhoLegado("150.5"), estrategia({ estrategia: "acima_de_valor", minimo: 150.5, alcance: "todas" }))
})

// ── estrategiaNacionalDaLinha (validação da linha crua do banco) ───────────

Deno.test("estrategiaNacionalDaLinha: linha válida vira EstrategiaNacional", () => {
    const linha = {
        national_shipping_strategy: "desconto_na_mais_barata",
        national_shipping_min: 100,
        national_discount_type: "percentual",
        national_discount_value: 15,
        national_benefit_scope: "mais_barata",
    }
    assertEquals(estrategiaNacionalDaLinha(linha), {
        estrategia: "desconto_na_mais_barata",
        minimo: 100,
        tipoDesconto: "percentual",
        valorDesconto: 15,
        alcance: "mais_barata",
    })
})

Deno.test("estrategiaNacionalDaLinha: tipoDesconto null é válido quando a estratégia não é desconto", () => {
    const linha = {
        national_shipping_strategy: "sempre",
        national_shipping_min: 0,
        national_discount_type: null,
        national_discount_value: 0,
        national_benefit_scope: "todas",
    }
    assertEquals(estrategiaNacionalDaLinha(linha)?.tipoDesconto, null)
})

Deno.test("estrategiaNacionalDaLinha: enum inválido, número negativo, tipo desconhecido, coluna ausente → null (banco velho ou linha corrompida)", () => {
    const base = {
        national_shipping_strategy: "sempre",
        national_shipping_min: 0,
        national_discount_type: null,
        national_discount_value: 0,
        national_benefit_scope: "todas",
    }
    assertEquals(estrategiaNacionalDaLinha({ ...base, national_shipping_strategy: "sempre_grátis" }), null)
    assertEquals(estrategiaNacionalDaLinha({ ...base, national_shipping_min: -1 }), null)
    assertEquals(estrategiaNacionalDaLinha({ ...base, national_discount_type: "cupom" }), null)
    assertEquals(estrategiaNacionalDaLinha({ ...base, national_discount_value: -5 }), null)
    assertEquals(estrategiaNacionalDaLinha({ ...base, national_benefit_scope: "regiao" }), null)
    assertEquals(estrategiaNacionalDaLinha({}), null)
    assertEquals(estrategiaNacionalDaLinha(null), null)
    // Banco sem as colunas: select() de hoje devolveria as OUTRAS colunas
    // (COLUNAS_DA_LOJA) — a forma não bate, vira null (espelho legado).
    assertEquals(estrategiaNacionalDaLinha({ origin_cep: "38500-000", shipping_provider: "superfrete" }), null)
})

// ── subtotalDoCarrinho (mesma conta da RPC) ─────────────────────────────────

const PRODUTOS = new Map([
    ["p1", { id: "p1", preco_venda: 59.9 }],
    ["p2", { id: "p2", preco_venda: 10 }],
])
const VARIANTES = new Map([
    ["v1", { id: "v1", product_id: "p1", price_override: 49.9 }],
    ["v2", { id: "v2", product_id: "p1", price_override: null }],
])

Deno.test("subtotalDoCarrinho: soma preco_venda × quantidade (quantidade ausente = 1)", () => {
    const itens = [{ product: { id: "p1" }, quantity: 2 }, { product: { id: "p2" } }]
    assertEquals(subtotalDoCarrinho(itens, PRODUTOS, VARIANTES), 59.9 * 2 + 10)
})

Deno.test("subtotalDoCarrinho: price_override da variação vence preco_venda; null no override cai no preco_venda", () => {
    const comOverride = [{ product: { id: "p1" }, variantId: "v1", quantity: 1 }]
    assertEquals(subtotalDoCarrinho(comOverride, PRODUTOS, VARIANTES), 49.9)
    const overrideNulo = [{ product: { id: "p1" }, variantId: "v2", quantity: 3 }]
    assertEquals(subtotalDoCarrinho(overrideNulo, PRODUTOS, VARIANTES), 59.9 * 3)
})

Deno.test("subtotalDoCarrinho: carrinho vazio → 0; produto desconhecido não entra na soma", () => {
    assertEquals(subtotalDoCarrinho([], PRODUTOS, VARIANTES), 0)
    assertEquals(subtotalDoCarrinho([{ product: { id: "fantasma" }, quantity: 5 }], PRODUTOS, VARIANTES), 0)
    const misto = [{ product: { id: "p1" }, quantity: 1 }, { product: { id: "fantasma" }, quantity: 5 }]
    assertEquals(subtotalDoCarrinho(misto, PRODUTOS, VARIANTES), 59.9)
})

// ── aplicarEstrategiaNacional ────────────────────────────────────────────────

Deno.test("desligado: preço cheio intacto, carimbado", () => {
    const opcoes = [opcao("a", 25.5), opcao("b", 30)]
    const resultado = aplicarEstrategiaNacional(opcoes, estrategia({ estrategia: "desligado" }), 100)
    assertEquals(resultado.map((o) => o.price), [25.5, 30])
    assertEquals(resultado.map((o) => o.precoCheio), [25.5, 30])
    assertEquals(resultado[0].estrategiaNacional, estrategia({ estrategia: "desligado" }))
})

Deno.test("por_produto: aplicarEstrategiaNacional NÃO desconta (o benefício é só o atalho free-shipping-promo)", () => {
    const opcoes = [opcao("a", 25.5)]
    const resultado = aplicarEstrategiaNacional(opcoes, estrategia({ estrategia: "por_produto" }), 100)
    assertEquals(resultado[0].price, 25.5)
    assertEquals(resultado[0].precoCheio, 25.5)
})

Deno.test("sempre + alcance todas: TODAS as opções zeram, sem olhar subtotal", () => {
    const opcoes = [opcao("a", 25.5), opcao("b", 40)]
    const resultado = aplicarEstrategiaNacional(opcoes, estrategia({ estrategia: "sempre", alcance: "todas" }), 0)
    assertEquals(resultado.map((o) => o.price), [0, 0])
    assertEquals(resultado.map((o) => o.precoCheio), [25.5, 40])
})

Deno.test("sempre + alcance mais_barata, sem empate: só a mais barata zera", () => {
    const opcoes = [opcao("a", 25.5), opcao("b", 40)]
    const resultado = aplicarEstrategiaNacional(opcoes, estrategia({ estrategia: "sempre", alcance: "mais_barata" }), 0)
    assertEquals(resultado.find((o) => o.id === "a")?.price, 0)
    assertEquals(resultado.find((o) => o.id === "b")?.price, 40)
})

Deno.test("sempre + alcance mais_barata, EMPATE: todas as empatadas zeram", () => {
    const opcoes = [opcao("a", 25.5), opcao("b", 25.5), opcao("c", 40)]
    const resultado = aplicarEstrategiaNacional(opcoes, estrategia({ estrategia: "sempre", alcance: "mais_barata" }), 0)
    assertEquals(resultado.find((o) => o.id === "a")?.price, 0)
    assertEquals(resultado.find((o) => o.id === "b")?.price, 0)
    assertEquals(resultado.find((o) => o.id === "c")?.price, 40)
})

Deno.test("acima_de_valor: subtotal abaixo do mínimo → cheio", () => {
    const opcoes = [opcao("a", 25.5)]
    const resultado = aplicarEstrategiaNacional(opcoes, estrategia({ estrategia: "acima_de_valor", minimo: 200 }), 199.99)
    assertEquals(resultado[0].price, 25.5)
})

Deno.test("acima_de_valor: subtotal igual ao mínimo (borda) → zera", () => {
    const opcoes = [opcao("a", 25.5)]
    const resultado = aplicarEstrategiaNacional(opcoes, estrategia({ estrategia: "acima_de_valor", minimo: 200 }), 200)
    assertEquals(resultado[0].price, 0)
})

Deno.test("acima_de_valor com minimo=0 (defesa: o CHECK real nunca deixa) NÃO beneficia — exige minimo > 0", () => {
    const opcoes = [opcao("a", 25.5)]
    const resultado = aplicarEstrategiaNacional(opcoes, estrategia({ estrategia: "acima_de_valor", minimo: 0 }), 0)
    assertEquals(resultado[0].price, 25.5)
})

Deno.test("desconto_na_mais_barata: subtotal abaixo do mínimo → cheio", () => {
    const opcoes = [opcao("a", 24.9)]
    const e = estrategia({ estrategia: "desconto_na_mais_barata", minimo: 100, tipoDesconto: "percentual", valorDesconto: 15, alcance: "mais_barata" })
    const resultado = aplicarEstrategiaNacional(opcoes, e, 99.99)
    assertEquals(resultado[0].price, 24.9)
})

Deno.test("desconto_na_mais_barata com minimo 0 = sempre vale (subtotal 0 já bate)", () => {
    const opcoes = [opcao("a", 24.9)]
    const e = estrategia({ estrategia: "desconto_na_mais_barata", minimo: 0, tipoDesconto: "percentual", valorDesconto: 15, alcance: "mais_barata" })
    const resultado = aplicarEstrategiaNacional(opcoes, e, 0)
    assertEquals(resultado[0].price, 21.16)
})

// index-2609: a conta é em CENTAVOS INTEIROS, "cheioC − round(cheioC×pct/100)"
// (a fórmula do CONTRATO — plano §"CONTRATO FIXO", linha "percentual:
// cheioC − Math.round(cheioC×pct/100)"). 24,90 com 15% dá 21,16 por essa
// fórmula (2490 − round(2490×15/100) = 2490 − round(373.5) = 2490 − 374 =
// 2116 → R$ 21,16) — NÃO R$ 21,17, que sairia de uma fórmula DIFERENTE
// (round(cheioC×(100−pct)/100) = round(2490×0.85) = round(2116.5) = 2117).
// Verificado em Node antes de escrever este teste (as duas fórmulas só
// concordam quando o meio-centavo não aparece — caso de 19,95 abaixo).
Deno.test("desconto_na_mais_barata percentual: cheio 24,90 com 15% -> 21,16 (fórmula do CONTRATO, round-então-subtrai)", () => {
    const opcoes = [opcao("a", 24.9)]
    const e = estrategia({ estrategia: "desconto_na_mais_barata", minimo: 0, tipoDesconto: "percentual", valorDesconto: 15, alcance: "mais_barata" })
    const resultado = aplicarEstrategiaNacional(opcoes, e, 500)
    assertEquals(resultado[0].price, 21.16)
    assertEquals(resultado[0].precoCheio, 24.9)
})

Deno.test("desconto_na_mais_barata percentual: cheio 19,95 com 15% -> 16,96 (sem ambiguidade de meio-centavo)", () => {
    const opcoes = [opcao("a", 19.95)]
    const e = estrategia({ estrategia: "desconto_na_mais_barata", minimo: 0, tipoDesconto: "percentual", valorDesconto: 15, alcance: "mais_barata" })
    const resultado = aplicarEstrategiaNacional(opcoes, e, 500)
    assertEquals(resultado[0].price, 16.96)
})

Deno.test("desconto_na_mais_barata fixo: desconto maior que o preço -> 0, nunca negativo", () => {
    const opcoes = [opcao("a", 15)]
    const e = estrategia({ estrategia: "desconto_na_mais_barata", minimo: 0, tipoDesconto: "fixo", valorDesconto: 50, alcance: "mais_barata" })
    const resultado = aplicarEstrategiaNacional(opcoes, e, 500)
    assertEquals(resultado[0].price, 0)
})

Deno.test("desconto_na_mais_barata fixo: desconto menor que o preço -> subtrai reto", () => {
    const opcoes = [opcao("a", 30)]
    const e = estrategia({ estrategia: "desconto_na_mais_barata", minimo: 0, tipoDesconto: "fixo", valorDesconto: 12.5, alcance: "mais_barata" })
    const resultado = aplicarEstrategiaNacional(opcoes, e, 500)
    assertEquals(resultado[0].price, 17.5)
})

Deno.test("desconto_na_mais_barata + alcance mais_barata, EMPATE: todas as empatadas descontam; as outras ficam cheias", () => {
    const opcoes = [opcao("a", 20), opcao("b", 20), opcao("c", 40)]
    const e = estrategia({ estrategia: "desconto_na_mais_barata", minimo: 0, tipoDesconto: "fixo", valorDesconto: 5, alcance: "mais_barata" })
    const resultado = aplicarEstrategiaNacional(opcoes, e, 500)
    assertEquals(resultado.find((o) => o.id === "a")?.price, 15)
    assertEquals(resultado.find((o) => o.id === "b")?.price, 15)
    assertEquals(resultado.find((o) => o.id === "c")?.price, 40)
})

// EMENDA (revisão T1, 23/09): o ALCANCE só vale para o GRÁTIS. O desconto é
// SEMPRE só na(s) de menor preço cheio — mesmo que a coluna guarde 'todas'
// (o admin não oferece essa combinação, mas o servidor não confia nisso).
Deno.test("desconto_na_mais_barata + alcance 'todas' na coluna: MESMO ASSIM só a mais barata desconta (o alcance é ignorado no desconto)", () => {
    const opcoes = [opcao("a", 20), opcao("b", 40)]
    const e = estrategia({ estrategia: "desconto_na_mais_barata", minimo: 0, tipoDesconto: "fixo", valorDesconto: 5, alcance: "todas" })
    const resultado = aplicarEstrategiaNacional(opcoes, e, 500)
    assertEquals(resultado.find((o) => o.id === "a")?.price, 15)
    assertEquals(resultado.find((o) => o.id === "b")?.price, 40)
})

Deno.test("aplicarEstrategiaNacional: lista vazia devolve vazia sem estourar", () => {
    assertEquals(aplicarEstrategiaNacional([], estrategia({ estrategia: "sempre" }), 100), [])
})

Deno.test("aplicarEstrategiaNacional: cada opção carrega o MESMO carimbo (as 5 colunas)", () => {
    const opcoes = [opcao("a", 20), opcao("b", 40)]
    const e = estrategia({ estrategia: "acima_de_valor", minimo: 100 })
    const resultado = aplicarEstrategiaNacional(opcoes, e, 150)
    assertEquals(resultado[0].estrategiaNacional, e)
    assertEquals(resultado[1].estrategiaNacional, e)
})

// EMENDA (revisão T1, 23/09): `subtotalCotacao` vai em TODA opção carimbada
// (beneficiada ou não) — é o número que a RPC compara com o subtotal da hora
// do pedido para saber se a cotação ainda vale.
Deno.test("aplicarEstrategiaNacional: subtotalCotacao vai em TODA opção (beneficiada ou não), arredondado ao centavo", () => {
    const opcoes = [opcao("a", 20), opcao("b", 40)]
    const beneficiada = aplicarEstrategiaNacional(opcoes, estrategia({ estrategia: "acima_de_valor", minimo: 100 }), 149.999)
    assertEquals(beneficiada[0].subtotalCotacao, 150)
    assertEquals(beneficiada[1].subtotalCotacao, 150)
    assertEquals(beneficiada[0].price, 0)

    const semBeneficio = aplicarEstrategiaNacional(opcoes, estrategia({ estrategia: "acima_de_valor", minimo: 500 }), 149.999)
    assertEquals(semBeneficio[0].subtotalCotacao, 150)
    assertEquals(semBeneficio[0].price, 20)
})
