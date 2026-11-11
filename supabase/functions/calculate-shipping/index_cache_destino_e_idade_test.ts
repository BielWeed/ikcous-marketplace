// @ts-nocheck
import { assert, assertEquals, assertNotEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts"
import { bancoFalso, corpoDe, cotacao, json, rodar } from "./apoio-dos-testes.ts"

// Só o cache ganha outro dublê: os demais dados e a injeção são os dos vizinhos.
// A consulta aplica os filtros recebidos, não exige que um filtro esteja presente.
function bancoComCacheFiltrado() {
    const banco = bancoFalso()
    const fromOriginal = banco.cliente.from
    const linhas = []
    banco.cliente.from = (tabela) => {
        if (tabela !== "shipping_quotes_cache") return fromOriginal(tabela)
        return {
            select: () => {
                const filtros = []
                let ordenar = (_a, _b) => 0
                let limite = Infinity
                const consulta = {
                    eq: (coluna, valor) => {
                        filtros.push((linha) => Reflect.get(linha, coluna) === valor)
                        return consulta
                    },
                    gt: (coluna, valor) => {
                        filtros.push((linha) => Date.parse(Reflect.get(linha, coluna)) > Date.parse(valor))
                        return consulta
                    },
                    order: (coluna, { ascending }) => {
                        ordenar = (a, b) => (Date.parse(Reflect.get(a, coluna)) - Date.parse(Reflect.get(b, coluna))) * (ascending ? 1 : -1)
                        return consulta
                    },
                    limit: (n) => {
                        limite = n
                        return consulta
                    },
                    then: (ok, erro) => Promise.resolve({
                        data: linhas.filter((linha) => filtros.every((filtro) => filtro(linha)))
                            .sort(ordenar).slice(0, limite).map((linha) => ({ options: structuredClone(linha.options) })),
                        error: null,
                    }).then(ok, erro),
                }
                return consulta
            },
            upsert: async (linha, opcoes) => {
                banco.registro.upsertsCache.push({ linha: structuredClone(linha), onConflict: opcoes?.onConflict ?? null })
                const indice = linhas.findIndex((salva) => salva.origin_cep === linha.origin_cep
                    && salva.destination_cep === linha.destination_cep && salva.cart_hash === linha.cart_hash)
                if (indice >= 0) linhas.splice(indice, 1)
                linhas.push(structuredClone(linha))
                return { error: null }
            },
        }
    }
    return { banco, linhas }
}

const CEP_A = "01001000"
const CEP_B = "30140071"
const SF = "superfrete.com/api/v0/calculator"
const chamadasDaTransportadora = (resultado) => resultado.chamadas.filter((c) => c.url.includes(SF))
const novaOferta = () => json([
    { id: 1, name: "PAC", price: 42.9, delivery_time: 9, company: { id: 1, name: "Correios" }, has_error: false },
])

async function prepararCache() {
    const estado = bancoComCacheFiltrado()
    // A própria cotação cria a assinatura atual; sem ela, remover o filtro
    // daria miss pela assinatura e esconderia justamente a regressão procurada.
    const primeira = await rodar(cotacao({ cep: CEP_A }), { banco: estado.banco })
    assertEquals(primeira.resposta.status, 200)
    assertEquals(chamadasDaTransportadora(primeira).length, 1)
    assertEquals(estado.linhas.length, 1)
    assert(estado.linhas[0].options.every((opcao) => typeof opcao.assinaturaCotacao === "string"))
    assertEquals(estado.linhas[0].destination_cep, CEP_A)
    return { ...estado, primeira }
}

Deno.test("cache de destino: cotação recente do CEP A não oferece preço nem prazo ao CEP B", async () => {
    const { banco, linhas, primeira } = await prepararCache()
    const linhaDeA = structuredClone(linhas[0])
    const segunda = await rodar(cotacao({ cep: CEP_B }), { banco, rotas: { sf: novaOferta } })

    assertEquals(segunda.resposta.status, 200)
    assertEquals(chamadasDaTransportadora(segunda).length, 1, "outro CEP exige recotar na transportadora")
    assertEquals(corpoDe(chamadasDaTransportadora(segunda)[0]).to.postal_code, CEP_B)
    assertEquals(segunda.corpo.options.map((opcao) => [opcao.price, opcao.deliveryDays]), [[42.9, 9]])
    assertNotEquals(segunda.corpo.options, primeira.corpo.options)
    assertEquals(banco.registro.upsertsCache.length, 2)
    const gravada = banco.registro.upsertsCache[1]
    assertEquals(gravada.onConflict, "origin_cep,destination_cep,cart_hash")
    assertEquals(gravada.linha.destination_cep, CEP_B)
    assertEquals(gravada.linha.cart_hash, linhaDeA.cart_hash)
    assertEquals(gravada.linha.options, segunda.corpo.options)
    assertEquals(linhas.find((linha) => linha.destination_cep === CEP_A), linhaDeA)
})

Deno.test("cache de idade: cotação assinada há mais de duas horas recota e renova preço e prazo", async () => {
    const { banco, linhas } = await prepararCache()
    linhas[0].created_at = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString()
    const antiga = structuredClone(linhas[0])
    const antesDeRecotar = Date.now()
    const segunda = await rodar(cotacao({ cep: CEP_A }), { banco, rotas: { sf: novaOferta } })

    assertEquals(segunda.resposta.status, 200)
    assertEquals(chamadasDaTransportadora(segunda).length, 1, "cotação expirada exige recotar na transportadora")
    assertEquals(corpoDe(chamadasDaTransportadora(segunda)[0]).to.postal_code, CEP_A)
    assertEquals(segunda.corpo.options.map((opcao) => [opcao.price, opcao.deliveryDays]), [[42.9, 9]])
    assertEquals(banco.registro.upsertsCache.length, 2)
    const renovada = banco.registro.upsertsCache[1].linha
    assertEquals(renovada.destination_cep, CEP_A)
    assertEquals(renovada.cart_hash, antiga.cart_hash)
    assertEquals(renovada.options, segunda.corpo.options)
    assertEquals(renovada.options[0].assinaturaCotacao, antiga.options[0].assinaturaCotacao)
    assert(Date.parse(renovada.created_at) >= antesDeRecotar, "a renovação precisa atualizar a data do cache")
    assertEquals(linhas, [renovada])
})

Deno.test("cache de controle: cotação recente do mesmo CEP é servida sem chamar a transportadora", async () => {
    const { banco, linhas, primeira } = await prepararCache()
    linhas[0].created_at = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const salva = structuredClone(linhas[0])
    const segunda = await rodar(cotacao({ cep: CEP_A }), { banco, rotas: { sf: novaOferta } })

    assertEquals(segunda.resposta.status, 200)
    assertEquals(chamadasDaTransportadora(segunda).length, 0)
    assertEquals(segunda.chamadas.length, 0)
    assertEquals(segunda.corpo.options, primeira.corpo.options)
    assertEquals(banco.registro.upsertsCache.length, 1)
    assertEquals(linhas, [salva])
})
