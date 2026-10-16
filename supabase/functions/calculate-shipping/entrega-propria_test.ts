// @ts-nocheck
// Regra PURA da entrega própria (16/10/2026): a linha das duas colunas, o
// bloco do hash, o prazo para o app e a retirada anexada. A cotação de ponta a
// ponta mora em `entrega-propria_cotacao_test.ts`.
import { assertEquals, assertStrictEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts"
import {
    blocoDaEntregaPropriaNaRevisao,
    comRetiradaAnexada,
    ENTREGA_PROPRIA_PADRAO,
    entregaPropriaDaLinha,
    entregaPropriaDifereDoPadrao,
    opcaoDeEntregaLocal,
    prazoDaEntregaParaOApp,
} from "./entrega-propria.ts"

Deno.test("padrão = o comportamento de hoje: entrega ligada, 1 dia", () => {
    assertEquals(ENTREGA_PROPRIA_PADRAO, { ativa: true, dias: 1 })
})

Deno.test("entregaPropriaDaLinha: linha válida (incluindo os limites 0 e 30 do CHECK)", () => {
    assertEquals(entregaPropriaDaLinha({ local_delivery_enabled: true, local_delivery_days: 1 }), { ativa: true, dias: 1 })
    assertEquals(entregaPropriaDaLinha({ local_delivery_enabled: false, local_delivery_days: 0 }), { ativa: false, dias: 0 })
    assertEquals(entregaPropriaDaLinha({ local_delivery_enabled: true, local_delivery_days: 30 }), { ativa: true, dias: 30 })
    // Coluna extra na linha não atrapalha (o dublê devolve o config inteiro).
    assertEquals(
        entregaPropriaDaLinha({ origin_cep: "1", local_delivery_enabled: false, local_delivery_days: 7 }),
        { ativa: false, dias: 7 },
    )
})

Deno.test("entregaPropriaDaLinha: forma que o CHECK não garante vira null (a linha inteira, nunca pela metade)", () => {
    const invalidas = [
        null,
        undefined,
        {},
        { local_delivery_enabled: true }, // falta o prazo
        { local_delivery_days: 1 }, // falta o modo
        { local_delivery_enabled: "true", local_delivery_days: 1 },
        { local_delivery_enabled: 1, local_delivery_days: 1 },
        { local_delivery_enabled: null, local_delivery_days: 1 },
        { local_delivery_enabled: true, local_delivery_days: -1 },
        { local_delivery_enabled: true, local_delivery_days: 31 },
        { local_delivery_enabled: true, local_delivery_days: 1.5 },
        { local_delivery_enabled: true, local_delivery_days: "1" },
        { local_delivery_enabled: true, local_delivery_days: null },
        { local_delivery_enabled: true, local_delivery_days: Number.NaN },
        { local_delivery_enabled: true, local_delivery_days: Infinity },
    ]
    for (const linha of invalidas) assertEquals(entregaPropriaDaLinha(linha), null, JSON.stringify(linha))
})

Deno.test("difere do padrão: só retiro OU prazo diferente de 1; o padrão não difere", () => {
    assertEquals(entregaPropriaDifereDoPadrao({ ativa: true, dias: 1 }), false)
    assertEquals(entregaPropriaDifereDoPadrao({ ativa: false, dias: 1 }), true)
    assertEquals(entregaPropriaDifereDoPadrao({ ativa: true, dias: 0 }), true)
    assertEquals(entregaPropriaDifereDoPadrao({ ativa: true, dias: 2 }), true)
    assertEquals(entregaPropriaDifereDoPadrao({ ativa: false, dias: 5 }), true)
})

Deno.test("bloco do hash: vazio sem leitura ou no padrão; {entrega_propria:{ativa,dias}} fora do padrão", () => {
    assertEquals(blocoDaEntregaPropriaNaRevisao(null), {})
    assertEquals(blocoDaEntregaPropriaNaRevisao({ ativa: true, dias: 1 }), {})
    assertEquals(blocoDaEntregaPropriaNaRevisao({ ativa: false, dias: 1 }), { entrega_propria: { ativa: false, dias: 1 } })
    assertEquals(blocoDaEntregaPropriaNaRevisao({ ativa: true, dias: 4 }), { entrega_propria: { ativa: true, dias: 4 } })
    assertEquals(blocoDaEntregaPropriaNaRevisao({ ativa: true, dias: 0 }), { entrega_propria: { ativa: true, dias: 0 } })
})

Deno.test("prazo para o app: só o 0 é reescrito, e só sem a prova do contrato 3+ (número exato)", () => {
    for (const dias of [1, 2, 7, 30]) {
        assertEquals(prazoDaEntregaParaOApp(dias, undefined), dias)
        assertEquals(prazoDaEntregaParaOApp(dias, 3), dias)
    }
    assertEquals(prazoDaEntregaParaOApp(0, 3), 0)
    assertEquals(prazoDaEntregaParaOApp(0, 4), 0)
    assertEquals(prazoDaEntregaParaOApp(0, 2.9), 1)
    for (const contrato of [undefined, null, 0, 1, 2, "3", "4", true, {}, [3], Number.NaN]) {
        assertEquals(prazoDaEntregaParaOApp(0, contrato), 1, `contrato ${JSON.stringify(contrato)}`)
    }
})

Deno.test("opção da Entrega Local: id, nome e provedor INTOCADOS; preço e prazo vêm de quem chama", () => {
    assertEquals(opcaoDeEntregaLocal(10, { ativa: true, dias: 1 }, 3), {
        id: "local-delivery",
        name: "Entrega Local",
        price: 10,
        deliveryDays: 1,
        provider: "local",
    })
    assertEquals(opcaoDeEntregaLocal(0, { ativa: true, dias: 0 }, 3).deliveryDays, 0)
    assertEquals(opcaoDeEntregaLocal(0, { ativa: true, dias: 0 }, undefined).deliveryDays, 1)
    assertEquals(opcaoDeEntregaLocal(12.5, { ativa: true, dias: 9 }, undefined).price, 12.5)
})

Deno.test("retirada anexada: vai no FIM, sem mexer na lista de entrada; nula devolve a própria lista", () => {
    const entrada = [{ id: "a" }, { id: "b" }]
    const retirada = { id: "store-pickup" }
    const saida = comRetiradaAnexada(entrada, retirada)
    assertEquals(saida.map((o) => o.id), ["a", "b", "store-pickup"])
    assertEquals(entrada.length, 2, "a lista que vai para o cache não é alterada")
    assertStrictEquals(comRetiradaAnexada(entrada, null), entrada)
    assertEquals(comRetiradaAnexada([], retirada), [retirada])
    assertEquals(comRetiradaAnexada([], null), [])
})
