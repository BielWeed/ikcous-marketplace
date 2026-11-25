// @ts-nocheck
/**
 * Caça por mutação (25/11/2026) em `estrategia-nacional.ts` — a regra que zera
 * ou reduz o frete que a cliente paga (dinheiro). Depois de
 * `estrategia-nacional_test.ts`, ainda sobreviviam defeitos de UMA linha:
 *
 *   * `estrategiaNacionalDaLinha`: coluna numérica nula, vazia ou não
 *     numérica tem de dar `null` (leitura que falhou → espelho legado), e
 *     nunca uma estratégia com `minimo: null`; o tipo de desconto AUSENTE (a
 *     chave nem veio) vale como `null`;
 *   * `subtotalDoCarrinho`: quantidade que não é número conta como 1;
 *   * `aplicarEstrategiaNacional`: o desconto percentual acima de 100% nunca
 *     deixa o frete negativo; subtotal ausente ou não numérico vira 0 (e o
 *     desconto com mínimo 0 continua valendo); lista vazia volta a MESMA lista.
 *
 * Tudo puro; valores inventados; sem rede.
 */
import { assert, assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts"
import {
    aplicarEstrategiaNacional,
    estrategiaNacionalDaLinha,
    subtotalDoCarrinho,
} from "./estrategia-nacional.ts"

const linha = (parcial: Record<string, unknown> = {}) => ({
    national_shipping_strategy: "desligado",
    national_shipping_min: 0,
    national_discount_type: null,
    national_discount_value: 0,
    national_benefit_scope: "mais_barata",
    ...parcial,
})

const opcao = (id: string, price: number) => ({ id, name: id, price, deliveryDays: 5, provider: "melhor_envio" })

const estrategia = (parcial: Record<string, unknown>) => ({
    estrategia: "desligado",
    minimo: 0,
    tipoDesconto: null,
    valorDesconto: 0,
    alcance: "todas",
    ...parcial,
})

// ── estrategiaNacionalDaLinha ─────────────────────────────────────────────

Deno.test("estrategiaNacionalDaLinha - mínimo e valor de desconto nulos, ausentes, vazios ou não numéricos dão null (nunca uma estratégia com número nulo)", () => {
    for (const ruim of [null, undefined, "", "   ", "abc", "5,5", Number.NaN, Number.POSITIVE_INFINITY, true, {}]) {
        assertEquals(estrategiaNacionalDaLinha(linha({ national_shipping_min: ruim })), null, `min ${String(ruim)}`)
        assertEquals(estrategiaNacionalDaLinha(linha({ national_discount_value: ruim })), null, `valor ${String(ruim)}`)
    }
    // controle: zero (número e texto) e texto numérico valem
    assertEquals(estrategiaNacionalDaLinha(linha({ national_shipping_min: 0, national_discount_value: 0 })).minimo, 0)
    assertEquals(estrategiaNacionalDaLinha(linha({ national_shipping_min: "0", national_discount_value: "0" })).valorDesconto, 0)
    assertEquals(estrategiaNacionalDaLinha(linha({ national_shipping_min: "150.14" })).minimo, 150.14)
    assertEquals(estrategiaNacionalDaLinha(linha({ national_discount_value: " 12.5 " })).valorDesconto, 12.5)
    // negativo nunca
    assertEquals(estrategiaNacionalDaLinha(linha({ national_shipping_min: -0.01 })), null)
    assertEquals(estrategiaNacionalDaLinha(linha({ national_discount_value: -1 })), null)
})

Deno.test("estrategiaNacionalDaLinha - tipo de desconto ausente (chave não veio) ou null vale null; tipo desconhecido recusa a linha", () => {
    const semChave = linha()
    delete semChave.national_discount_type
    assertEquals(estrategiaNacionalDaLinha(semChave), estrategia({ alcance: "mais_barata" }))
    assertEquals(estrategiaNacionalDaLinha(linha({ national_discount_type: undefined })).tipoDesconto, null)
    assertEquals(estrategiaNacionalDaLinha(linha({ national_discount_type: null })).tipoDesconto, null)
    assertEquals(estrategiaNacionalDaLinha(linha({ national_discount_type: "percentual" })).tipoDesconto, "percentual")
    assertEquals(estrategiaNacionalDaLinha(linha({ national_discount_type: "fixo" })).tipoDesconto, "fixo")
    for (const ruim of ["", "PERCENTUAL", "percent", 0, false]) {
        assertEquals(estrategiaNacionalDaLinha(linha({ national_discount_type: ruim })), null, String(ruim))
    }
    assertEquals(estrategiaNacionalDaLinha(null), null)
    assertEquals(estrategiaNacionalDaLinha(undefined), null)
})

// ── subtotalDoCarrinho ────────────────────────────────────────────────

Deno.test("subtotalDoCarrinho - quantidade que não é número (texto, NaN) conta como 1; texto numérico vale", () => {
    const produtos = new Map([["p1", { id: "p1", preco_venda: 10 }]])
    const total = (quantity: unknown) => subtotalDoCarrinho([{ product: { id: "p1" }, quantity }], produtos, new Map())
    assertEquals(total("abc"), 10)
    assertEquals(total(Number.NaN), 10)
    assertEquals(total(undefined), 10)
    assertEquals(total(null), 10)
    assertEquals(total("3"), 30)
    assertEquals(total(2), 20)
})

// ── aplicarEstrategiaNacional ──────────────────────────────────────────

Deno.test("aplicarEstrategiaNacional - desconto percentual acima de 100% zera o frete e NUNCA deixa negativo", () => {
    const resultado = aplicarEstrategiaNacional(
        [opcao("a", 20)],
        estrategia({ estrategia: "desconto_na_mais_barata", tipoDesconto: "percentual", valorDesconto: 150 }),
        100,
    )
    assertEquals(resultado[0].price, 0)
    assertEquals(resultado[0].precoCheio, 20)
    // controle: 100% também zera, 50% dá a metade
    assertEquals(
        aplicarEstrategiaNacional([opcao("a", 20)], estrategia({ estrategia: "desconto_na_mais_barata", tipoDesconto: "percentual", valorDesconto: 100 }), 100)[0].price,
        0,
    )
    assertEquals(
        aplicarEstrategiaNacional([opcao("a", 20)], estrategia({ estrategia: "desconto_na_mais_barata", tipoDesconto: "percentual", valorDesconto: 50 }), 100)[0].price,
        10,
    )
})

Deno.test("aplicarEstrategiaNacional - subtotal ausente ou não numérico vira 0: desconto com mínimo 0 vale, mínimo maior que 0 não", () => {
    const comMinimoZero = estrategia({ estrategia: "desconto_na_mais_barata", tipoDesconto: "fixo", valorDesconto: 5, minimo: 0 })
    const comMinimo = estrategia({ estrategia: "desconto_na_mais_barata", tipoDesconto: "fixo", valorDesconto: 5, minimo: 50 })
    for (const subtotal of [undefined, null, "abc", Number.NaN]) {
        const r = aplicarEstrategiaNacional([opcao("a", 20)], comMinimoZero, subtotal)
        assertEquals(r[0].price, 15, `mínimo 0, subtotal ${String(subtotal)}`)
        assertEquals(r[0].subtotalCotacao, 0, `subtotal ${String(subtotal)}`)
        const r2 = aplicarEstrategiaNacional([opcao("a", 20)], comMinimo, subtotal)
        assertEquals(r2[0].price, 20, `mínimo 50, subtotal ${String(subtotal)}`)
        assertEquals(r2[0].subtotalCotacao, 0)
    }
})

Deno.test("aplicarEstrategiaNacional - lista vazia volta a MESMA lista; o que não é lista volta como veio", () => {
    const vazia: unknown[] = []
    assert(aplicarEstrategiaNacional(vazia, estrategia({ estrategia: "sempre" }), 100) === vazia)
    assertEquals(aplicarEstrategiaNacional(null, estrategia({ estrategia: "sempre" }), 100), null)
    assertEquals(aplicarEstrategiaNacional(undefined, estrategia({ estrategia: "sempre" }), 100), undefined)
})
