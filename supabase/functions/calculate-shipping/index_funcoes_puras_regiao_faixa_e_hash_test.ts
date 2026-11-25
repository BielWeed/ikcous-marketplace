// @ts-nocheck
// Caça por mutação (25/11/2026) nas funções PURAS do topo da `calculate-shipping`
// (`index.ts`): cada teste abaixo derruba um defeito de uma linha que passava por
// TODOS os testes antigos. Sem banco, sem rede, sem relógio.
//
//  - `calculateSmartFallback`: só a escada (15/22/38) e um par de regiões eram
//    conferidos. Faltavam: CEP de origem OU destino vazio devolver a taxa
//    (`||`), os três pares de vizinhança (SP, Sul e Sudeste, nos dois sentidos),
//    a soma de +7/+20 acima dos pisos.
//  - `isLocalCep`: origem vazia com faixa configurada, token "um bloco longo +
//    um curto" (não é faixa), faixa escrita ao contrário, dois CEPs completos
//    só valem como início/fim quando NÃO há faixa explícita, e o padrão de 5
//    dígitos (a vizinha de 4 dígitos igual NÃO é local).
//  - `getCartHash`: o hash que a RPC do pedido compara por TEXTO. Quantidade 0 e
//    ausente contam 1, e dois itens do mesmo produto com variantes diferentes
//    saem na MESMA ordem qualquer que seja a ordem de entrada (comparador
//    simétrico).
//  - `carrinhoParaOHistorico`: a projeção que vai para `shipping_calculation_logs`
//    (id cortado em 64, 200 linhas, quantidade 0 vale 1, texto não numérico =
//    null).
//
// MUTANTES EQUIVALENTES (anotados, não viram teste):
//  - `Number.isFinite(flatFee) ? flatFee : 0` -> `: 1` em
//    `precoDeContingenciaDoTopo`: 0 e 1 ficam abaixo dos pisos 15/22/38.
//  - `precoResolvidoSemCache` sem o `typeof id !== 'string'`: `===` com id que
//    não é texto já dá `false`.
//  - `lerEnderecoDaLoja` com `data?.store_address ?? null` no lugar do `typeof`:
//    `opcaoDeRetirada` recusa endereço que não é texto do mesmo jeito.
//  - `isLocalCep`, `padEnd(8, '0')` do destino e `s.length === 8 ? igual :
//    startsWith`: o handler só chama com CEP de EXATOS 8 dígitos (`CEP
//    inválido` antes), e com 8 dígitos `startsWith` e `===` são a mesma conta.
//  - `idLongoDemais` sem `valor !== null`: `String(null)` tem 4 letras.
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts"
import * as edge from "./index.ts"

// ── calculateSmartFallback ───────────────────────────────────────────────────

Deno.test("escada de frete: origem OU destino sem dígito devolve a taxa pedida, sem chutar região", () => {
    assertEquals(edge.calculateSmartFallback("", "01000000", 30), 30)
    assertEquals(edge.calculateSmartFallback("38500000", "", 30), 30)
    assertEquals(edge.calculateSmartFallback("sem digito", "01000000", 30), 30)
    assertEquals(edge.calculateSmartFallback("38500000", "---", 7), 7)
})

Deno.test("escada de frete: vizinhança SP (0-1), Sul (8-9) e Sudeste (2-3), nos DOIS sentidos, custa 22; fora dos grupos custa 38", () => {
    const cep = (primeiro: string) => `${primeiro}0000000`
    for (const [a, b] of [["0", "1"], ["1", "0"], ["8", "9"], ["9", "8"], ["2", "3"], ["3", "2"]]) {
        assertEquals(edge.calculateSmartFallback(cep(a), cep(b), 10), 22, `${a}->${b} é vizinha`)
    }
    for (const [a, b] of [["0", "2"], ["1", "3"], ["7", "8"], ["7", "9"], ["2", "4"], ["4", "3"], ["0", "8"], ["5", "6"]]) {
        assertEquals(edge.calculateSmartFallback(cep(a), cep(b), 10), 38, `${a}->${b} é remota`)
    }
    for (const r of ["0", "3", "5", "9"]) {
        assertEquals(edge.calculateSmartFallback(cep(r), cep(r), 10), 15, `${r}->${r} é a mesma região`)
    }
})

Deno.test("escada de frete: acima dos pisos a taxa da loja SOMA (+7 vizinha, +20 remota) e na mesma região vale a própria taxa", () => {
    assertEquals(edge.calculateSmartFallback("01000000", "02000000", 30), 30, "mesma região: a taxa maior vence o piso 15")
    assertEquals(edge.calculateSmartFallback("01000000", "11000000", 30), 37, "vizinha: 30 + 7")
    assertEquals(edge.calculateSmartFallback("01000000", "51000000", 30), 50, "remota: 30 + 20")
})

// ── isLocalCep ───────────────────────────────────────────────────────────────

Deno.test("CEP local: sem CEP de origem a faixa configurada NÃO vale (nada é local)", () => {
    assertEquals(edge.isLocalCep("", "38500100", "38500000-38500999"), false)
    assertEquals(edge.isLocalCep("", "38500100", "38500"), false)
    assertEquals(edge.isLocalCep("38500000", "", "38500000-38500999"), false)
})

Deno.test("CEP local: 'um bloco longo e outro curto' NÃO é faixa — é um CEP escrito de outro jeito (só ele mesmo é local)", () => {
    // "385000-00" são os 8 dígitos 38500000, não o intervalo [00999999, 38500000].
    assertEquals(edge.isLocalCep("01000000", "38500000", "385000-00"), true)
    assertEquals(edge.isLocalCep("01000000", "38500100", "385000-00"), false)
    assertEquals(edge.isLocalCep("01000000", "20000000", "385000-00"), false)
})

Deno.test("CEP local: faixa explícita escrita ao contrário (fim-início) vale igual", () => {
    assertEquals(edge.isLocalCep("01000000", "38500500", "38500999-38500000"), true)
    assertEquals(edge.isLocalCep("01000000", "38500000", "38500999-38500000"), true, "o início inclusivo")
    assertEquals(edge.isLocalCep("01000000", "38500999", "38500999-38500000"), true, "o fim inclusivo")
    assertEquals(edge.isLocalCep("01000000", "38501000", "38500999-38500000"), false)
})

Deno.test("CEP local: dois CEPs completos viram início e fim SÓ quando não há faixa explícita; com faixa, valem como CEPs avulsos", () => {
    // sem faixa explícita: intervalo [39000000, 39000999]
    assertEquals(edge.isLocalCep("01000000", "39000500", "39000000, 39000999"), true)
    // com uma faixa explícita ao lado, os dois completos NÃO formam intervalo: só eles mesmos
    const mista = "38500000-38500999, 39000000, 39000999"
    assertEquals(edge.isLocalCep("01000000", "38500500", mista), true, "a faixa explícita")
    assertEquals(edge.isLocalCep("01000000", "39000000", mista), true, "o CEP avulso")
    assertEquals(edge.isLocalCep("01000000", "39000999", mista), true, "o outro CEP avulso")
    assertEquals(edge.isLocalCep("01000000", "39000500", mista), false, "no meio dos dois avulsos NÃO é local")
})

Deno.test("CEP local: sem faixa configurada vale o prefixo de 5 dígitos (o 5º dígito diferente já é outra área)", () => {
    assertEquals(edge.isLocalCep("38500000", "38500999"), true)
    assertEquals(edge.isLocalCep("38500000", "38501000"), false, "só o 5º dígito difere")
    assertEquals(edge.isLocalCep("38500000", "38499999"), false)
    assertEquals(edge.isLocalCep("38500-000", "38500-123", ""), true)
    assertEquals(edge.isLocalCep("38500-000", "38501-123", "   "), false, "faixa só de espaços = sem faixa")
})

// ── getCartHash ──────────────────────────────────────────────────────────────

Deno.test("hash do carrinho: quantidade 0, ausente ou vazia conta 1 (o hash que a RPC recalcula); quantidade real aparece", () => {
    assertEquals(edge.getCartHash([{ productId: "p1", quantity: 0 }]), "p1::1")
    assertEquals(edge.getCartHash([{ productId: "p1" }]), "p1::1")
    assertEquals(edge.getCartHash([{ productId: "p1", quantity: 3 }]), "p1::3")
    assertEquals(edge.getCartHash([{ product: { id: "p1" }, quantity: 2, variantId: "v9" }]), "p1:v9:2")
})

Deno.test("hash do carrinho: o MESMO produto em duas variantes sai na mesma ordem qualquer que seja a ordem de entrada", () => {
    const v1 = { productId: "p1", variantId: "v1", quantity: 2 }
    const v2 = { productId: "p1", variantId: "v2", quantity: 1 }
    const esperado = "p1:v1:2,p1:v2:1"
    assertEquals(edge.getCartHash([v1, v2]), esperado)
    assertEquals(edge.getCartHash([v2, v1]), esperado)
    const tres = { productId: "p0", variantId: "", quantity: 1 }
    assertEquals(edge.getCartHash([v2, tres, v1]), `p0::1,${esperado}`)
    assertEquals(edge.getCartHash([v1, v2, tres]), `p0::1,${esperado}`)
})

// ── carrinhoParaOHistorico ───────────────────────────────────────────────────

Deno.test("histórico do carrinho: id cortado em 64 caracteres, no máximo 200 linhas, quantidade 0 vale 1, número vira texto", () => {
    const longo = "x".repeat(100)
    const [linha] = edge.carrinhoParaOHistorico([{ product: { id: longo }, variantId: longo, quantity: 2 }])
    assertEquals(linha.produto, "x".repeat(64))
    assertEquals(linha.variante, "x".repeat(64))
    assertEquals(linha.qtd, 2)

    const [zero] = edge.carrinhoParaOHistorico([{ productId: 7, quantity: 0 }])
    assertEquals(zero, { produto: "7", variante: null, qtd: 1 })

    const [texto] = edge.carrinhoParaOHistorico([{ productId: "p1", quantity: "abc" }])
    assertEquals(texto.qtd, null, "quantidade que não é número vira null, não NaN")

    const muitos = Array.from({ length: 250 }, (_, i) => ({ productId: `p${i}`, quantity: 1 }))
    const historico = edge.carrinhoParaOHistorico(muitos)
    assertEquals(historico.length, 200)
    assertEquals(historico[199].produto, "p199")

    assertEquals(edge.carrinhoParaOHistorico("não é lista"), [])
    assertEquals(edge.carrinhoParaOHistorico(null), [])
})
