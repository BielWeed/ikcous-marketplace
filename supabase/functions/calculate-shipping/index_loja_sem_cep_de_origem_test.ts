// @ts-nocheck
// Loja nova que ainda não preencheu o endereço em "Minha loja" (sem CEP de
// origem): a cotação não tem de onde partir. Até 27/11/2026 isso virava um
// `throw` que caía no `catch` de topo — 500 com "Tente novamente" — e a tela
// oferecia "Tentar de novo" para sempre. Agora é uma recusa com `codigo`
// próprio, que o app reconhece sem ler texto (mesmo formato de `fora_da_area`,
// `cep_invalido`, `carrinho_invalido`). Dublês de `apoio-dos-testes.ts`.
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts"
import { bancoFalso, cotacao, rodar } from "./apoio-dos-testes.ts"

for (const [rotulo, origem] of [
    ["nula", null],
    ["vazia", ""],
] as const) {
    Deno.test(`loja sem CEP de origem (${rotulo}): 409 com codigo loja_sem_cep_de_origem, sem transportadora, cache, cota nem erro de topo`, async () => {
        const banco = bancoFalso({ config: { origin_cep: origem } })
        const { resposta, corpo, chamadas, registro, saida } = await rodar(cotacao(), { banco })

        assertEquals(resposta.status, 409)
        assertEquals(corpo.codigo, "loja_sem_cep_de_origem")
        assertEquals(corpo.error, "A loja ainda não configurou o CEP de origem do frete.")
        assertEquals(corpo.options, undefined)
        assertEquals(chamadas.length, 0)
        assertEquals(registro.upsertsCache.length, 0)
        assertEquals(registro.chamadasDeCota.length, 0)
        // Recusa esperada não é falha da função: nada no log de erro de topo.
        assertEquals(saida.includes("Top-level Edge Function Error"), false)
    })
}

Deno.test("loja COM CEP de origem: a cotação segue como sempre (200, com opções, sem codigo de recusa)", async () => {
    const { resposta, corpo, chamadas } = await rodar(cotacao(), { banco: bancoFalso() })

    assertEquals(resposta.status, 200)
    assertEquals(corpo.codigo, undefined)
    assertEquals(Array.isArray(corpo.options), true)
    assertEquals(corpo.options.length > 0, true)
    assertEquals(chamadas.length > 0, true)
})
