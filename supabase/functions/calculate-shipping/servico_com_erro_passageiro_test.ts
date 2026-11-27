// @ts-nocheck
/**
 * Serviço que volta com erro PASSAGEIRO dentro de uma cotação 200 (27/11/2026).
 *
 * A marca `cotacaoParcial` só nascia quando um provedor INTEIRO falhava. Se o
 * Melhor Envio (ou a SuperFrete) respondia 200 com o PAC em "Serviço
 * indisponível no momento", o PAC sumia em silêncio e a lista sem ele ia para o
 * cache de 2 h como completa: a cliente ficava sem o PAC mesmo depois de ele
 * voltar, e não via o "Tentar de novo".
 *
 * Recusa LEGÍTIMA (não atende o trecho, peso/medida fora do limite) NÃO marca:
 * é a resposta certa para aquele carrinho e aquele CEP, e repetir a consulta
 * devolve a mesma recusa.
 *
 * Os textos de recusa e de indisponibilidade são os que as APIs devolvem de
 * verdade: os do Melhor Envio vêm da resposta real auditada
 * (`RESPOSTA_ME_REAL`), do fórum oficial (docs.melhorenvio.com.br/discuss,
 * "Serviço indisponível no momento") e de relato público de integração
 * ("Transportadora não atende este trecho."). A doc oficial da SuperFrete
 * (superfrete.readme.io, "Cotação de frete") só documenta `has_error`, sem os
 * textos: ali a mesma régua vale, e erro sem texto NÃO é passageiro.
 */
import { assert, assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts"
import {
    bancoFalso,
    cotacao,
    json,
    LINHA_ME,
    LINHA_SF,
    linhaLigados,
    RESPOSTA_ME_REAL,
    RESPOSTA_SF_OFICIAL,
    rodar,
} from "./apoio-dos-testes.ts"
import { cotacaoDoCacheServe } from "./configuracao.ts"
import { erroDeServicoPassageiro } from "./provedores.ts"

// ── A régua pura ─────────────────────────────────────────────────────────────

Deno.test("erro passageiro: indisponibilidade dita como momentânea e tempo esgotado", () => {
    for (const texto of [
        "Serviço indisponível no momento",
        "Serviço momentaneamente indisponível",
        // "temporariamente" sem falar de trecho continua passageiro.
        "Serviço temporariamente indisponível",
        "Tempo limite esgotado ao consultar a transportadora",
        "Tempo de resposta da transportadora excedido",
        "Request timed out",
        "timeout",
        "Erro ao consultar a transportadora, tente novamente mais tarde.",
        "Service Unavailable",
    ]) {
        assertEquals(erroDeServicoPassageiro(texto), true, texto)
    }
})

Deno.test("erro NÃO passageiro: recusa legítima (trecho não atendido, peso/medida), texto vago ou vazio", () => {
    for (const texto of [
        "Transportadora não atende este trecho.",
        // A J&T (Standard, 33) responde assim à ROTA que não atende: o texto
        // fala do trecho, e repetir a consulta devolve a mesma recusa.
        "Não é possível realizar cotações, pois o trecho está temporariamente indisponível.",
        "Dimensões do objeto ultrapassam o limite da transportadora.",
        "Altura acima do permitido",
        "Peso excedido para o serviço",
        "Serviço indisponível",
        "Serviço indisponível para o CEP de destino",
        // Os dois sinais juntos: na dúvida, recusa (não marca parcial).
        "Serviço indisponível no momento para o peso informado",
        "erro do serviço",
        "",
        null,
        undefined,
    ]) {
        assertEquals(erroDeServicoPassageiro(texto), false, String(texto))
    }
})

// ── No handler: Melhor Envio ─────────────────────────────────────────────────

const PAC_ME = RESPOSTA_ME_REAL[0]
const SEDEX_ME = RESPOSTA_ME_REAL[1]
const soME = () => bancoFalso({ credenciais: [LINHA_ME, linhaLigados(["melhor_envio"])] })

async function cotarMEComPac(pac: Record<string, unknown>) {
    return await rodar(cotacao(), { banco: soME(), rotas: { me: () => json([pac, SEDEX_ME]) } })
}

Deno.test("Melhor Envio 200 com o PAC (pedido) 'indisponível no momento': a cotação sai PARCIAL e o cache não a serve depois", async () => {
    const r = await cotarMEComPac({ id: 1, name: "PAC", error: "Serviço indisponível no momento", company: PAC_ME.company })
    assertEquals(r.resposta.status, 200)
    assertEquals(r.corpo.options.map((o: any) => o.id), ["melhor-envio-2"])
    assertEquals(r.corpo.cotacaoParcial, true)
    const gravado = r.registro.cacheLinhas.at(-1)
    assert(gravado, "a cotação foi gravada no cache (a RPC do pedido precisa dela)")
    assertEquals(gravado.options.every((o: any) => o.cotacaoParcial === true), true)
    assertEquals(cotacaoDoCacheServe(gravado.options, gravado.options[0].assinaturaCotacao), false)
})

Deno.test("Melhor Envio 200 com o PAC recusado de verdade (não atende o trecho / medida): cotação COMPLETA, sem a marca", async () => {
    for (const erro of ["Transportadora não atende este trecho.", "Dimensões do objeto ultrapassam o limite da transportadora."]) {
        const r = await cotarMEComPac({ id: 1, name: "PAC", error: erro, company: PAC_ME.company })
        assertEquals(r.resposta.status, 200, erro)
        assertEquals(r.corpo.cotacaoParcial, false, erro)
        assertEquals(r.corpo.options.some((o: any) => "cotacaoParcial" in o), false, erro)
    }
})

Deno.test("Melhor Envio: serviço com erro passageiro que a loja NÃO pediu não marca a cotação como parcial", async () => {
    // A loja só usa PAC e SEDEX; o J&T (Standard, 33) volta "indisponível no
    // momento" e fica fora da conta.
    const jetPassageiro = { ...RESPOSTA_ME_REAL[5], error: "Serviço indisponível no momento" }
    const r = await rodar(cotacao(), { banco: soME(), rotas: { me: () => json([PAC_ME, SEDEX_ME, jetPassageiro]) } })
    assertEquals(r.resposta.status, 200)
    assertEquals(r.corpo.cotacaoParcial, false)
})

// A J&T PEDIDA pela loja, com a frase real da rota que ela não atende.
const ME_CALCULATE = "melhorenvio.com.br/api/v2/me/shipment/calculate"
const meComJet = () => bancoFalso({
    credenciais: [{ ...LINHA_ME, credentials: { ...LINHA_ME.credentials, servicos: ["1", "2", "33"] } }, linhaLigados(["melhor_envio"])],
})

Deno.test("Melhor Envio 200 com a J&T (pedida) em 'trecho temporariamente indisponível': cotação COMPLETA, vai ao cache e o próximo pedido não gasta cotação", async () => {
    const jet = RESPOSTA_ME_REAL[5]
    assertEquals(jet.company.name, "JeT")
    const banco = meComJet()
    const r = await rodar(cotacao(), { banco, rotas: { me: () => json([PAC_ME, SEDEX_ME, jet]) } })
    assertEquals(r.resposta.status, 200)
    assertEquals(r.chamadas.filter((c: any) => c.url.includes(ME_CALCULATE)).length, 1)
    assertEquals(r.corpo.options.map((o: any) => o.id), ["melhor-envio-1", "melhor-envio-2"])
    assertEquals(r.corpo.cotacaoParcial, false)
    assertEquals(r.corpo.options.some((o: any) => "cotacaoParcial" in o), false)
    const gravado = r.registro.cacheLinhas.at(-1)
    assert(gravado, "a cotação completa foi gravada no cache")
    assertEquals(cotacaoDoCacheServe(gravado.options, gravado.options[0].assinaturaCotacao), true)

    // "Tentar de novo" (ou outra visita) dentro das 2 h: o cache serve, a
    // transportadora não é chamada de novo.
    const segunda = await rodar(cotacao(), { banco, rotas: { me: () => json([PAC_ME, SEDEX_ME, jet]) } })
    assertEquals(segunda.resposta.status, 200)
    assertEquals(segunda.chamadas.filter((c: any) => c.url.includes(ME_CALCULATE)).length, 0)
    assertEquals(segunda.corpo.options.map((o: any) => o.id), ["melhor-envio-1", "melhor-envio-2"])
})

Deno.test("Melhor Envio 200 com a J&T (pedida) 'indisponível no momento' SEM falar de trecho: segue PARCIAL", async () => {
    const jet = { ...RESPOSTA_ME_REAL[5], error: "Serviço indisponível no momento" }
    const r = await rodar(cotacao(), { banco: meComJet(), rotas: { me: () => json([PAC_ME, SEDEX_ME, jet]) } })
    assertEquals(r.resposta.status, 200)
    assertEquals(r.corpo.cotacaoParcial, true)
})

// ── No handler: SuperFrete ───────────────────────────────────────────────────

const soSF = () => bancoFalso({ credenciais: [LINHA_SF, linhaLigados(["superfrete"])] })
const PAC_SF = RESPOSTA_SF_OFICIAL[0]

Deno.test("SuperFrete 200 com o PAC (pedido) em has_error + tempo esgotado: cotação PARCIAL", async () => {
    const r = await rodar(cotacao(), {
        banco: soSF(),
        rotas: { sf: () => json([{ ...PAC_SF, has_error: true, error: "Tempo limite esgotado na consulta" }, ...RESPOSTA_SF_OFICIAL.slice(1)]) },
    })
    assertEquals(r.resposta.status, 200)
    assertEquals(r.corpo.cotacaoParcial, true)
    assertEquals(r.corpo.options.some((o: any) => o.id === "superfrete-1"), false)
})

Deno.test("SuperFrete 200 com o PAC em has_error SEM texto ou com recusa de medida: cotação COMPLETA", async () => {
    for (const pac of [
        { ...PAC_SF, has_error: true },
        { ...PAC_SF, has_error: true, error: "Dimensões acima do permitido" },
        { ...PAC_SF, has_error: true, message: "Transportadora não atende este trecho." },
    ]) {
        const r = await rodar(cotacao(), { banco: soSF(), rotas: { sf: () => json([pac, ...RESPOSTA_SF_OFICIAL.slice(1)]) } })
        assertEquals(r.resposta.status, 200, JSON.stringify(pac))
        assertEquals(r.corpo.cotacaoParcial, false, JSON.stringify(pac))
    }
})

Deno.test("SuperFrete: a mensagem passageira em `message` (sem `error`) também marca parcial", async () => {
    const r = await rodar(cotacao(), {
        banco: soSF(),
        rotas: { sf: () => json([{ ...PAC_SF, has_error: true, message: "Serviço indisponível no momento" }, ...RESPOSTA_SF_OFICIAL.slice(1)]) },
    })
    assertEquals(r.corpo.cotacaoParcial, true)
})
