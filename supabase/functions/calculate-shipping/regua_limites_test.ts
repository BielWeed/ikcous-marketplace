// @ts-nocheck
/**
 * Caça por mutação (25/11/2026) em `regua.ts` — a régua que decide o PREÇO, o
 * PRAZO e o PESO que a cliente vê no frete, e que a RPC do pedido compara por
 * texto exato. Depois de `index_test.ts` e `cotacao_multi_test.ts` ainda
 * sobreviviam defeitos de UMA linha:
 *
 *   * `valorUnitarioDoBanco`: a variação que pertence a OUTRO produto era
 *     aceita (o preço da variação alheia valia), e `price_override` inválido
 *     (texto vazio, negativo) caía para o preço do produto em vez de falhar
 *     fechado;
 *   * `idCanonico`: texto que NÃO é uuid (grupo de tamanho não múltiplo de 4,
 *     hífen duplo, 36 dígitos, letra fora de 0-9a-f, chave só de um lado)
 *     era "canonizado" mesmo assim e entrava no `cart_hash`;
 *   * `precoDaApi`: notação científica e hexadecimal precisam ser recusadas;
 *   * `prazoDaApi` e `codigoDeServicoValido`: espaço nas pontas, limites de 100
 *     caracteres e a faixa de caracteres de controle.
 *
 * Tudo puro; valores inventados; sem rede.
 */
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts"
import {
    buscarComTempo,
    codigoDeServicoValido,
    idCanonico,
    jsonCanonico,
    nomeDaOpcao,
    prazoDaApi,
    precoDaApi,
    temCaractereDeControle,
    textoSemSegredo,
    valorUnitarioDoBanco,
} from "./regua.ts"

const UUID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301"

// ── idCanonico ─────────────────────────────────────────────────────────

Deno.test("idCanonico - o que NÃO é uuid em nenhuma grafia fica como veio (só caixa e espaço das pontas)", () => {
    // grupo de 5 dígitos: o Postgres não aceita hífen fora de múltiplo de 4
    assertEquals(idCanonico("3f250-4e04f8941d39a0c0305e82c3301"), "3f250-4e04f8941d39a0c0305e82c3301")
    // hífen duplo (grupo vazio)
    assertEquals(idCanonico("3f2504e0--4f8941d39a0c0305e82c3301"), "3f2504e0--4f8941d39a0c0305e82c3301")
    assertEquals(idCanonico("-3f2504e04f8941d39a0c0305e82c3301"), "-3f2504e04f8941d39a0c0305e82c3301")
    // tamanho errado: 28, 33 e 36 dígitos
    assertEquals(idCanonico("a".repeat(28)), "a".repeat(28))
    assertEquals(idCanonico("a".repeat(33)), "a".repeat(33))
    assertEquals(idCanonico("A".repeat(36)), "a".repeat(36))
    // letra fora de 0-9a-f no meio de um grupo que, de resto, parece hex
    assertEquals(idCanonico("3f2504e04f8941d39a0c0305e82c33zz"), "3f2504e04f8941d39a0c0305e82c33zz")
    assertEquals(idCanonico("3f2504e04f8941d39a0c0305e82c33 1"), "3f2504e04f8941d39a0c0305e82c33 1")
    // chave só de um lado não é "entre chaves"
    assertEquals(idCanonico(`{${UUID}x`), `{${UUID}x`)
    assertEquals(idCanonico(`x${UUID}}`), `x${UUID}}`)
    assertEquals(idCanonico(`{${UUID}`), `{${UUID}`)
    assertEquals(idCanonico(`${UUID}}`), `${UUID}}`)
    assertEquals(idCanonico("{}"), "{}")
    assertEquals(idCanonico(""), "")
    // controle: as grafias válidas continuam virando a forma do banco
    assertEquals(idCanonico(`{${UUID.toUpperCase()}}`), UUID)
    assertEquals(idCanonico(UUID.replaceAll("-", "")), UUID)
})

// ── valorUnitarioDoBanco ───────────────────────────────────────────────

Deno.test("valorUnitarioDoBanco - variação de OUTRO produto não vale: falha fechado (nunca o preço da variação alheia)", () => {
    const produto = { id: "p1", preco_venda: 100 }
    assertEquals(valorUnitarioDoBanco(produto, { product_id: "p2", price_override: 5 }, true), null)
    assertEquals(valorUnitarioDoBanco(produto, { product_id: "p1", price_override: 5 }, true), 5)
    // sem product_id na linha (null ou ausente) a variação vale
    assertEquals(valorUnitarioDoBanco(produto, { product_id: null, price_override: 5 }, true), 5)
    assertEquals(valorUnitarioDoBanco(produto, { price_override: 5 }, true), 5)
    // variação pedida e não achada, ou produto desconhecido
    assertEquals(valorUnitarioDoBanco(produto, null, true), null)
    assertEquals(valorUnitarioDoBanco(produto, undefined, true), null)
    assertEquals(valorUnitarioDoBanco(null, { price_override: 5 }, true), null)
    assertEquals(valorUnitarioDoBanco(undefined, null, false), null)
})

Deno.test("valorUnitarioDoBanco - variação sem override usa o preço do produto; override 0 vale 0; override inválido NÃO cai para o preço do produto", () => {
    const produto = { id: "p1", preco_venda: "100.50" }
    assertEquals(valorUnitarioDoBanco(produto, { product_id: "p1", price_override: null }, true), 100.5)
    assertEquals(valorUnitarioDoBanco(produto, { product_id: "p1" }, true), 100.5)
    assertEquals(valorUnitarioDoBanco(produto, { product_id: "p1", price_override: 0 }, true), 0)
    assertEquals(valorUnitarioDoBanco(produto, { product_id: "p1", price_override: "7.5" }, true), 7.5)
    assertEquals(valorUnitarioDoBanco(produto, { product_id: "p1", price_override: "" }, true), null)
    assertEquals(valorUnitarioDoBanco(produto, { product_id: "p1", price_override: "  " }, true), null)
    assertEquals(valorUnitarioDoBanco(produto, { product_id: "p1", price_override: "7,5" }, true), null)
    assertEquals(valorUnitarioDoBanco(produto, { product_id: "p1", price_override: -1 }, true), null)
    assertEquals(valorUnitarioDoBanco(produto, { product_id: "p1", price_override: Number.NaN }, true), null)
    assertEquals(valorUnitarioDoBanco(produto, { product_id: "p1", price_override: true }, true), null)
    // sem variação pedida, a variação que vier é ignorada
    assertEquals(valorUnitarioDoBanco(produto, { product_id: "p1", price_override: 5 }, false), 100.5)
    assertEquals(valorUnitarioDoBanco(produto, null, false), 100.5)
    // preço do produto inválido ou zero
    assertEquals(valorUnitarioDoBanco({ id: "p1", preco_venda: 0 }, null, false), 0)
    for (const ruim of ["", "  ", "abc", -0.01, Number.NaN, Number.POSITIVE_INFINITY, null, undefined, false]) {
        assertEquals(valorUnitarioDoBanco({ id: "p1", preco_venda: ruim }, null, false), null, String(ruim))
    }
})

// ── precoDaApi ─────────────────────────────────────────────────────────

Deno.test("precoDaApi - só número ou texto decimal simples: notação científica, hexadecimal, Infinity e lixo viram null", () => {
    for (const texto of ["1.5e3", "1,5e3", "1e3", "0x10", "Infinity", "-1", "-1,5", "1.", ".5", ",5", "1,2,3", "1.2.3", "R$ 1,50", "1.5 reais", "abc", "", "  "]) {
        assertEquals(precoDaApi(texto, { aceitaZero: true }), null, JSON.stringify(texto))
    }
    for (const nao of [null, undefined, true, false, {}, [], [1], Number.NaN, Number.POSITIVE_INFINITY, -0.01, -1]) {
        assertEquals(precoDaApi(nao, { aceitaZero: true }), null, String(nao))
    }
})

Deno.test("precoDaApi - ponto ou vírgula, espaço nas pontas, arredonda ao centavo; zero só quando aceito", () => {
    assertEquals(precoDaApi("11.74", { aceitaZero: false }), 11.74)
    assertEquals(precoDaApi("11,74", { aceitaZero: false }), 11.74)
    assertEquals(precoDaApi("  11,74\n", { aceitaZero: false }), 11.74)
    assertEquals(precoDaApi("10,999", { aceitaZero: false }), 11)
    assertEquals(precoDaApi(10.004, { aceitaZero: false }), 10)
    assertEquals(precoDaApi("7", { aceitaZero: false }), 7)
    assertEquals(precoDaApi(0, { aceitaZero: true }), 0)
    assertEquals(precoDaApi("0", { aceitaZero: true }), 0)
    assertEquals(precoDaApi("0,00", { aceitaZero: true }), 0)
    assertEquals(precoDaApi(0, { aceitaZero: false }), null)
    assertEquals(precoDaApi("0", { aceitaZero: false }), null)
    assertEquals(precoDaApi("0,00", { aceitaZero: false }), null)
    assertEquals(precoDaApi(0.004, { aceitaZero: false }), 0) // arredonda para 0 DEPOIS da checagem: continua aceito
})

// ── prazoDaApi ─────────────────────────────────────────────────────────

Deno.test("prazoDaApi - inteiro >= mínimo; texto só de dígitos (com espaço nas pontas); fracionário, negativo e lixo viram null", () => {
    assertEquals(prazoDaApi(" 3 ", 1), 3)
    assertEquals(prazoDaApi("\t12\n", 0), 12)
    assertEquals(prazoDaApi("3", 1), 3)
    assertEquals(prazoDaApi(3, 1), 3)
    assertEquals(prazoDaApi(0, 0), 0)
    assertEquals(prazoDaApi("0", 0), 0)
    assertEquals(prazoDaApi(0, 1), null)
    assertEquals(prazoDaApi("0", 1), null)
    assertEquals(prazoDaApi(1, 1), 1) // o mínimo vale (>=, não >)
    for (const ruim of [3.5, "3.5", "3,5", -1, "-1", "", "  ", "3 dias", "1e2", null, undefined, true, {}, [3], Number.NaN, Number.POSITIVE_INFINITY]) {
        assertEquals(prazoDaApi(ruim, 0), null, String(ruim))
    }
})

// ── codigoDeServicoValido e caractere de controle ─────────────────────────────────

Deno.test("codigoDeServicoValido - 100 caracteres passam, 101 não; vazio e só espaço não; número finito vira texto", () => {
    assertEquals(codigoDeServicoValido("a".repeat(100)), "a".repeat(100))
    assertEquals(codigoDeServicoValido("a".repeat(101)), null)
    assertEquals(codigoDeServicoValido(`  ${"a".repeat(100)}  `), "a".repeat(100))
    assertEquals(codigoDeServicoValido(" x "), "x")
    assertEquals(codigoDeServicoValido(""), null)
    assertEquals(codigoDeServicoValido("   "), null)
    assertEquals(codigoDeServicoValido(7), "7")
    assertEquals(codigoDeServicoValido(0), "0")
    assertEquals(codigoDeServicoValido(Number.NaN), null)
    assertEquals(codigoDeServicoValido(Number.POSITIVE_INFINITY), null)
    for (const nao of [null, undefined, true, {}, ["x"]]) {
        assertEquals(codigoDeServicoValido(nao), null, String(nao))
    }
})

Deno.test("codigoDeServicoValido - caractere de controle no meio recusa (U+0000 a U+001F e U+007F a U+009F); U+0020 e U+00A0 passam", () => {
    for (const codigo of [0x00, 0x09, 0x0a, 0x0d, 0x1f, 0x7f, 0x80, 0x9f]) {
        assertEquals(codigoDeServicoValido(`a${String.fromCharCode(codigo)}b`), null, `U+${codigo.toString(16)}`)
        assertEquals(temCaractereDeControle(`a${String.fromCharCode(codigo)}b`), true, `U+${codigo.toString(16)}`)
    }
    for (const codigo of [0x20, 0x7e, 0xa0, 0xe9]) {
        assertEquals(codigoDeServicoValido(`a${String.fromCharCode(codigo)}b`), `a${String.fromCharCode(codigo)}b`, `U+${codigo.toString(16)}`)
        assertEquals(temCaractereDeControle(`a${String.fromCharCode(codigo)}b`), false, `U+${codigo.toString(16)}`)
    }
    assertEquals(temCaractereDeControle(""), false)
})

// ── jsonCanonico (base dos hashes da revisão e da assinatura) ───────────────────────

Deno.test("jsonCanonico - chaves em ordem alfabética em todo nível, lista mantém a ordem, undefined some, null fica", () => {
    assertEquals(
        jsonCanonico({ b: 1, a: { d: 1, c: [{ z: 1, y: 2 }, 3] }, e: null, f: undefined }),
        '{"a":{"c":[{"y":2,"z":1},3],"d":1},"b":1,"e":null}',
    )
    assertEquals(jsonCanonico([3, 1, 2]), "[3,1,2]")
    assertEquals(jsonCanonico([{ b: 1, a: 2 }]), '[{"a":2,"b":1}]')
    assertEquals(jsonCanonico("texto"), '"texto"')
    assertEquals(jsonCanonico(null), "null")
    assertEquals(jsonCanonico(5), "5")
    // ordem por unidade de código UTF-16 (maiúscula antes de minúscula; acento depois)
    assertEquals(jsonCanonico({ b: 1, B: 2, a: 3, "é": 4, A: 5 }), '{"A":5,"B":2,"a":3,"b":1,"é":4}')
    // a mesma estrutura em ordens diferentes dá o MESMO texto
    assertEquals(jsonCanonico({ x: 1, y: { q: 1, p: 2 } }), jsonCanonico({ y: { p: 2, q: 1 }, x: 1 }))
})

// ── nomeDaOpcao ───────────────────────────────────────────────────────

Deno.test("nomeDaOpcao - espaço nas pontas sai do nome; PAC/SEDEX só por inteiro, com ou sem o prefixo 'Correios'", () => {
    assertEquals(nomeDaOpcao("  Jadlog  ", "  .Package  "), "Jadlog — .Package")
    assertEquals(nomeDaOpcao("  Jadlog  ", ""), "Jadlog")
    assertEquals(nomeDaOpcao("", "  Rápido  "), "Rápido")
    assertEquals(nomeDaOpcao(null, null), "")
    assertEquals(nomeDaOpcao("Correios", "Correios PAC"), "Entrega econômica")
    assertEquals(nomeDaOpcao("CORREIOS", "pac"), "Entrega econômica")
    assertEquals(nomeDaOpcao("Correios", "correios   sedex"), "Entrega expressa")
    assertEquals(nomeDaOpcao("  Correios  ", "  SEDEX  "), "Entrega expressa")
    assertEquals(nomeDaOpcao("Correios", "PAC Mini"), "Correios — PAC Mini")
    assertEquals(nomeDaOpcao("Correios", "SEDEX Hoje"), "Correios — SEDEX Hoje")
    assertEquals(nomeDaOpcao("Correios", "Impresso"), "Correios — Impresso")
    // transportadora que só CONTÉM a palavra continua sendo Correios (regra de contenção do código)
    assertEquals(nomeDaOpcao("Empresa Brasileira de Correios", "PAC"), "Entrega econômica")
    // PAC e SEDEX de outra transportadora não ganham o nome da casa
    assertEquals(nomeDaOpcao("Jadlog", "SEDEX"), "Jadlog — SEDEX")
    assertEquals(nomeDaOpcao("", "PAC"), "PAC")
})

// ── textoSemSegredo (erro de terceiro que vai para log e resposta) ───────────────────

Deno.test("textoSemSegredo - o segredo conhecido some em TODAS as ocorrências; segredo vazio ou que não é texto é ignorado; null e undefined viram vazio", () => {
    assertEquals(textoSemSegredo("falhou com tok-123 e de novo tok-123", ["tok-123"]), "falhou com [redacted] e de novo [redacted]")
    assertEquals(textoSemSegredo("texto normal", ["", 123, null, undefined]), "texto normal")
    assertEquals(textoSemSegredo(undefined), "")
    assertEquals(textoSemSegredo(null), "")
    assertEquals(textoSemSegredo(""), "")
    assertEquals(textoSemSegredo(404), "404")
})

Deno.test("textoSemSegredo - 'Bearer <token>' some em qualquer caixa e para no primeiro separador (espaço, aspas, vírgula, ponto e vírgula, chave)", () => {
    assertEquals(textoSemSegredo("Authorization: Bearer abc123def"), "Authorization: Bearer [redacted]")
    assertEquals(textoSemSegredo("authorization: bearer abc123def"), "authorization: bearer [redacted]")
    assertEquals(textoSemSegredo("BEARER   abc123def depois"), "BEARER   [redacted] depois")
    assertEquals(textoSemSegredo('{"h":"Bearer abc123","x":1}'), '{"h":"Bearer [redacted]","x":1}')
    assertEquals(textoSemSegredo("{'h':'Bearer abc123','x':1}"), "{'h':'Bearer [redacted]','x':1}")
    assertEquals(textoSemSegredo("Bearer abc123, outro"), "Bearer [redacted], outro")
    assertEquals(textoSemSegredo("Bearer abc123; outro"), "Bearer [redacted]; outro")
    assertEquals(textoSemSegredo("{Bearer abc123}"), "{Bearer [redacted]}")
    assertEquals(textoSemSegredo("duas: Bearer aaa e Bearer bbb"), "duas: Bearer [redacted] e Bearer [redacted]")
    // a palavra sozinha, sem token, não some
    assertEquals(textoSemSegredo("Bearer"), "Bearer")
})

Deno.test("textoSemSegredo - corta no limite DEPOIS de redigir: 300 por padrão, reticências só quando passa, e nunca meio segredo", () => {
    assertEquals(textoSemSegredo("a".repeat(300)), "a".repeat(300))
    assertEquals(textoSemSegredo("a".repeat(301)), `${"a".repeat(300)}…`)
    assertEquals(textoSemSegredo("abcde", [], 5), "abcde")
    assertEquals(textoSemSegredo("abcdef", [], 5), "abcde…")
    // o segredo atravessa a linha de corte: redige primeiro, então o corte cai fora do segredo
    const cortado = textoSemSegredo("xx12345678yy", ["12345678"], 6)
    assertEquals(cortado, "xx[red…")
    assertEquals(cortado.includes("1234"), false)
})

// ── buscarComTempo: o tempo padrão e a limpeza do temporizador ───────────────────

Deno.test("buscarComTempo - sem tempo informado espera 15 s; o temporizador é limpo quando a resposta chega (e quando falha)", async () => {
    const setOriginal = globalThis.setTimeout
    const clearOriginal = globalThis.clearTimeout
    const pedidos: number[] = []
    const limpos: unknown[] = []
    // deno-lint-ignore no-explicit-any
    ;(globalThis as any).setTimeout = (_fn: unknown, ms: number) => { pedidos.push(ms); return 4242 }
    // deno-lint-ignore no-explicit-any
    ;(globalThis as any).clearTimeout = (h: unknown) => { limpos.push(h) }
    try {
        const ok = async () => new Response("ok")
        await buscarComTempo(ok as any, "https://fixture.invalid/")
        assertEquals(pedidos, [15000])
        assertEquals(limpos, [4242])
        await buscarComTempo(ok as any, "https://fixture.invalid/", {}, 250)
        assertEquals(pedidos, [15000, 250])
        assertEquals(limpos, [4242, 4242])
        const quebra = async () => { throw new Error("rede caiu") }
        let erro = ""
        try {
            await buscarComTempo(quebra as any, "https://fixture.invalid/", {}, 90)
        } catch (e) {
            erro = (e as Error).message
        }
        assertEquals(erro, "rede caiu")
        assertEquals(limpos.length, 3)
    } finally {
        globalThis.setTimeout = setOriginal
        globalThis.clearTimeout = clearOriginal
    }
})
