// @ts-nocheck
// A LOJA NOVA SÓ ENTREGA NA CIDADE DEPOIS DE CONFIRMAR (28/11/2026, migration
// 20261655000000): enquanto `store_config.entrega_confirmada_em` (20261652000000)
// for NULL, a cotação não oferece a Entrega Local — e nunca responde lista vazia
// em silêncio: sem outra opção, 409 com `codigo` próprio
// (`loja_se_preparando_para_entregar`); com a retirada, a retirada vem sozinha e
// a resposta avisa (`entregaLocalPendente`). Banco sem a coluna (antes da 1652) =
// confirmada (o comportamento de antes). Transportadora (fora da cidade) não muda.
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts"
import { bancoFalso, cotacao, rodar } from "./apoio-dos-testes.ts"

const CEP_LOCAL = "38500-100"
const CEP_FORA = "01001-000"
const FRASE = "Esta loja ainda está se preparando para entregar."
const ENTREGO = { enabled_shipping_methods: ["sedex", "pac"], local_delivery_enabled: true, local_delivery_days: 1 }
const ENTREGO_E_RETIRO = { ...ENTREGO, enabled_shipping_methods: ["sedex", "pac", "store-pickup"] }

async function cota(config: Record<string, unknown>, cep = CEP_LOCAL, falhas?: Record<string, unknown>) {
    const banco = bancoFalso({ config, enderecoDaLoja: "Rua das Flores, 100 - Centro", falhas })
    return await rodar({ ...cotacao(), cep, aceitaRetirada: true, contratoCliente: 3 }, { banco })
}
const ids = (corpo: any) => (corpo.options ?? []).map((o: any) => o.id)

for (const cobertura of ["national", "local"]) {
    Deno.test(`entrega pendente (${cobertura}), sem retirada: 409 loja_se_preparando_para_entregar, nunca lista vazia, sem transportadora`, async () => {
        const { resposta, corpo, chamadas, saida } = await cota({ ...ENTREGO, shipping_coverage: cobertura, entrega_confirmada_em: null })
        assertEquals(resposta.status, 409)
        assertEquals(corpo.codigo, "loja_se_preparando_para_entregar")
        assertEquals(corpo.error, FRASE)
        assertEquals(corpo.options, undefined)
        assertEquals(chamadas.length, 0)
        assertEquals(saida.includes("Top-level Edge Function Error"), false)
    })

    Deno.test(`entrega pendente (${cobertura}), com retirada: só a retirada, avisando que a entrega está pendente`, async () => {
        const { resposta, corpo } = await cota({ ...ENTREGO_E_RETIRO, shipping_coverage: cobertura, entrega_confirmada_em: null })
        assertEquals(resposta.status, 200)
        assertEquals(ids(corpo), ["store-pickup"])
        assertEquals(corpo.entregaLocalPendente, true)
        assertEquals(corpo.codigo, undefined)
    })
}

Deno.test("entrega CONFIRMADA: a Entrega Local volta, sem aviso de pendência (controle)", async () => {
    const { resposta, corpo } = await cota({ ...ENTREGO_E_RETIRO, entrega_confirmada_em: "2026-11-28T10:00:00+00:00" })
    assertEquals(resposta.status, 200)
    assertEquals(ids(corpo), ["local-delivery", "store-pickup"])
    assertEquals(corpo.entregaLocalPendente, undefined)
})

Deno.test("banco sem a coluna (antes da 20261652000000): lê como confirmada, a Entrega Local segue como sempre", async () => {
    for (const erro of ["42703", "PGRST204"]) {
        const { resposta, corpo } = await cota(ENTREGO, CEP_LOCAL, { erroDaConfirmacao: erro })
        assertEquals(resposta.status, 200, erro)
        assertEquals(ids(corpo), ["local-delivery"], erro)
    }
    // Sem a chave na linha (dublê sem a coluna): idem.
    const { corpo } = await cota(ENTREGO)
    assertEquals(ids(corpo), ["local-delivery"])
})

Deno.test("falha ao ler a confirmação (não é coluna ausente): não inventa nem esconde a entrega — a cotação falha", async () => {
    const { resposta, corpo } = await cota(ENTREGO, CEP_LOCAL, { erroDaConfirmacao: "XX000" })
    assertEquals(resposta.status, 500)
    assertEquals(ids(corpo), [])
})

Deno.test("entrega pendente não mexe em quem é de FORA da cidade: a transportadora cota como sempre", async () => {
    const { resposta, corpo, chamadas } = await cota({ ...ENTREGO, entrega_confirmada_em: null }, CEP_FORA)
    assertEquals(resposta.status, 200)
    assertEquals(corpo.codigo, undefined)
    assertEquals(chamadas.length > 0, true)
    assertEquals(ids(corpo).includes("local-delivery"), false)
    assertEquals(ids(corpo).length > 0, true)
})

Deno.test("Só retiro com a entrega pendente: nada muda (a Entrega Local já não existia)", async () => {
    const { resposta, corpo } = await cota({ ...ENTREGO_E_RETIRO, local_delivery_enabled: false, entrega_confirmada_em: null })
    assertEquals(resposta.status, 200)
    assertEquals(ids(corpo), ["store-pickup"])
    assertEquals(corpo.entregaLocalPendente, undefined)
})
