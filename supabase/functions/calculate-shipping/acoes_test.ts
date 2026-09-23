// @ts-nocheck
// RELEASE 1.5.7 — ações de admin da edge (contrato §4 + R1-3, R1-8, R2-1,
// R2-2, R3-1): ler_configuracao_frete, list_services, save_credentials (os
// três provedores, com merge), test_credentials (a MESMA função da cotação) e
// save_active_providers (linha `_ligados`), mais a pública
// revisao_config_frete.
import { assert, assertEquals, assertNotEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts"
import {
    bancoFalso,
    cabecalho,
    corpoDe,
    cotacao,
    EMAIL_ME,
    EMAIL_SF,
    json,
    LINHA_FRENET,
    LINHA_ME,
    LINHA_SF,
    linhaLigados,
    linhasDoLog,
    RESPOSTA_FRENET_EXEMPLO,
    RESPOSTA_ME_REAL,
    RESPOSTA_SF_OFICIAL,
    rodar,
    TOKEN_FRENET,
    TOKEN_ME,
    TOKEN_SF,
} from "./apoio-dos-testes.ts"

const ME = "melhorenvio.com.br/api/v2/me/shipment/calculate"
const SF = "superfrete.com/api/v0/calculator"
const FRENET = "api.frenet.com.br/shipping/quote"
const chamadasPara = (chamadas: any[], trecho: string) => chamadas.filter((c) => c.url.includes(trecho))
const semSegredo = (texto: string) => [TOKEN_ME, TOKEN_SF, TOKEN_FRENET].every((t) => !texto.includes(t))
const linhasGravadas = (registro: any) => registro.upsertsCredencial.flatMap((u: any) => u.linhas)
const revisaoDe = (banco: any) => banco.credenciais.find((l: any) => l.provider === "_revisao")?.credentials?.revisao
const TOKEN_NOVO = "tok-NOVO-FICTICIO-0a1b2c3d"

// ── revisao_config_frete (pública) ──────────────────────────────────────────

Deno.test("revisao_config_frete: pública (sem admin, sem CEP), só {revisaoConfig}, nenhuma transportadora, nenhum token", async () => {
    const { resposta, corpo, chamadas, texto } = await rodar({ action: "revisao_config_frete" }, { admin: false })
    assertEquals(resposta.status, 200)
    assertEquals(Object.keys(corpo), ["revisaoConfig"])
    assertEquals(/^[0-9a-f]{64}$/.test(corpo.revisaoConfig), true)
    assertEquals(chamadas.length, 0)
    assert(semSegredo(texto))
})

Deno.test("revisao_config_frete: muda com o updated_at da credencial ligada e com a linha _ligados; NÃO muda com o token (que nunca entra)", async () => {
    const a = await rodar({ action: "revisao_config_frete" })
    const outroToken = bancoFalso({ credenciais: [LINHA_ME, { ...LINHA_SF, credentials: { ...LINHA_SF.credentials, token: "outro-token-mesma-data" } }, LINHA_FRENET] })
    const b = await rodar({ action: "revisao_config_frete" }, { banco: outroToken })
    assertEquals(b.corpo.revisaoConfig, a.corpo.revisaoConfig)
    const outraData = bancoFalso({ credenciais: [LINHA_ME, { ...LINHA_SF, updated_at: "2026-09-23T11:11:11.000Z" }, LINHA_FRENET] })
    const c = await rodar({ action: "revisao_config_frete" }, { banco: outraData })
    assertNotEquals(c.corpo.revisaoConfig, a.corpo.revisaoConfig)
    const multi = bancoFalso({ credenciais: [LINHA_ME, LINHA_SF, LINHA_FRENET, linhaLigados(["superfrete"])] })
    const d = await rodar({ action: "revisao_config_frete" }, { banco: multi })
    assertNotEquals(d.corpo.revisaoConfig, a.corpo.revisaoConfig)
})

// ── ler_configuracao_frete ──────────────────────────────────────────────────

Deno.test("ler_configuracao_frete: só admin (403 sem nada)", async () => {
    const { resposta, texto } = await rodar({ action: "ler_configuracao_frete" }, { admin: false })
    assertEquals(resposta.status, 403)
    assert(semSegredo(texto))
})

Deno.test("ler_configuracao_frete: LEGADO — ligados = [shipping_provider]; por provedor tem_chave/sandbox/servicos/seguro/contato, sem token", async () => {
    const banco = bancoFalso({
        credenciais: [
            { ...LINHA_ME, credentials: { token: TOKEN_ME, servicos: ["1", "31"], seguro: "sem_seguro" } },
            LINHA_SF,
        ],
    })
    const { corpo, texto } = await rodar({ action: "ler_configuracao_frete" }, { banco })
    assertEquals(corpo.success, true)
    assertEquals(corpo.modo, "legado")
    assertEquals(corpo.ligados, ["superfrete"])
    assertEquals(corpo.provedores.melhor_envio, {
        tem_chave: true,
        sandbox: false,
        servicos: ["1", "31"],
        seguro: "sem_seguro",
        contato_email: null,
        precisa_salvar_de_novo: false,
    })
    assertEquals(corpo.provedores.superfrete, { tem_chave: true, sandbox: false, servicos: null, contato_email: EMAIL_SF, precisa_salvar_de_novo: false })
    assertEquals(corpo.provedores.frenet, { tem_chave: false, sandbox: false, servicos: null, precisa_salvar_de_novo: false })
    assert(semSegredo(texto))
})

Deno.test("ler_configuracao_frete: MULTI — ligados = _ligados filtrado por quem tem token; o que perdeu o token pede para salvar de novo", async () => {
    const banco = bancoFalso({
        credenciais: [{ ...LINHA_ME, credentials: {} }, LINHA_SF, LINHA_FRENET, linhaLigados(["melhor_envio", "frenet"])],
    })
    const { corpo } = await rodar({ action: "ler_configuracao_frete" }, { banco })
    assertEquals(corpo.modo, "multi")
    assertEquals(corpo.ligados, ["frenet"])
    assertEquals(corpo.provedores.melhor_envio.precisa_salvar_de_novo, true)
    assertEquals("_ligados" in corpo.provedores, false)
})

// ── list_services ───────────────────────────────────────────────────────────

Deno.test("list_services: só admin; provedor inválido, _ligados e _revisao recusados", async () => {
    assertEquals((await rodar({ action: "list_services", provider: "frenet" }, { admin: false })).resposta.status, 403)
    for (const provider of ["_ligados", "_revisao", "flat_fee", undefined]) {
        const { corpo, chamadas } = await rodar({ action: "list_services", provider })
        assertEquals(corpo.success, false, String(provider))
        assertEquals(chamadas.length, 0)
    }
})

Deno.test("list_services ME: GET /shipment/services com a chave SALVA; devolve {codigo, transportadora, servico}, sem token", async () => {
    const { corpo, chamadas, texto } = await rodar({ action: "list_services", provider: "melhor_envio" })
    assertEquals(chamadas.length, 1)
    assertEquals(chamadas[0].url, "https://melhorenvio.com.br/api/v2/me/shipment/services")
    assertEquals(cabecalho(chamadas[0], "Authorization"), `Bearer ${TOKEN_ME}`)
    assertEquals(corpo, {
        success: true,
        servicos: [
            { codigo: "1", transportadora: "Correios", servico: "PAC" },
            { codigo: "2", transportadora: "Correios", servico: "SEDEX" },
            { codigo: "31", transportadora: "Loggi", servico: "Express" },
        ],
    })
    assert(semSegredo(texto))
})

Deno.test("list_services Frenet: GET /shipping/info com o header token; aceita a chave DIGITADA pelo admin", async () => {
    const { corpo, chamadas } = await rodar({ action: "list_services", provider: "frenet", token: "tok-digitado-FICTICIO" })
    assertEquals(chamadas[0].url, "https://api.frenet.com.br/shipping/info")
    assertEquals(cabecalho(chamadas[0], "token"), "tok-digitado-FICTICIO")
    assertEquals(corpo.servicos[0], { codigo: "JTE_INT", transportadora: "J&T Express", servico: "Standard" })
    assertEquals(corpo.servicos.length, 5)
    assertEquals(corpo.texto?.includes("tok-digitado") ?? false, false)
})

Deno.test("list_services SF: GET /services/info (limites por serviço) -> {codigo = chave, transportadora = company.name, servico = name}, origem catalogo_documentado + aviso", async () => {
    const { corpo, chamadas, texto } = await rodar({ action: "list_services", provider: "superfrete" })
    assertEquals(chamadas.length, 1)
    assertEquals(chamadas[0].url, "https://api.superfrete.com/api/v0/services/info")
    assertEquals(cabecalho(chamadas[0], "Authorization"), `Bearer ${TOKEN_SF}`)
    assertEquals(cabecalho(chamadas[0], "User-Agent"), `IKCOUS Marketplace 1.5.7 (${EMAIL_SF})`)
    assertEquals(chamadas[0].init.method ?? "GET", "GET")
    assert(chamadas[0].init.signal instanceof AbortSignal)
    assertEquals(corpo.success, true)
    assertEquals(corpo.origem, "catalogo_documentado")
    assertEquals(typeof corpo.aviso, "string")
    assertEquals(corpo.servicos, [
        { codigo: "1", transportadora: "Correios", servico: "PAC" },
        { codigo: "2", transportadora: "Correios", servico: "SEDEX" },
        { codigo: "3", transportadora: "Jadlog", servico: "Jadlog" },
        { codigo: "17", transportadora: "Correios", servico: "MiniEnvios" },
        { codigo: "31", transportadora: "Loggi", servico: "Loggi" },
    ])
    assert(semSegredo(texto))
})

Deno.test("list_services SF: endpoint falhou (401, 5xx, timeout, corpo ilegível, vazio) ou sem chave/e-mail -> catálogo mínimo 1, 2, 17 com o MESMO aviso; nunca inventa ausência", async () => {
    const minimo = ["1", "2", "17"]
    for (const rota of [
        () => new Response("no", { status: 401 }),
        () => new Response("x", { status: 502 }),
        () => Promise.reject(new DOMException("aborted", "AbortError")),
        () => new Response("<html>", { status: 200 }),
        () => json({}),
        () => json([1, 2]),
    ]) {
        const r = await rodar({ action: "list_services", provider: "superfrete" }, { rotas: { sfInfo: rota } })
        assertEquals(r.corpo.success, true)
        assertEquals(r.corpo.origem, "catalogo_documentado")
        assertEquals(typeof r.corpo.aviso, "string")
        assertEquals(r.corpo.servicos.map((s: any) => s.codigo), minimo)
    }
    const semChave = await rodar({ action: "list_services", provider: "superfrete" }, { banco: bancoFalso({ credenciais: [LINHA_ME] }) })
    assertEquals(semChave.chamadas.length, 0)
    assertEquals(semChave.corpo.servicos.map((s: any) => s.codigo), minimo)
    // Chave válida mas item sem nome/transportadora ou chave inválida: só esse item sai.
    const parcial = await rodar({ action: "list_services", provider: "superfrete" }, {
        rotas: { sfInfo: () => json({ "1": { name: "PAC", company: { name: "Correios" } }, "": { name: "x" }, "9": { name: 3 } }) },
    })
    assertEquals(parcial.corpo.servicos, [{ codigo: "1", transportadora: "Correios", servico: "PAC" }])
})

Deno.test("list_services: 401 = chave_recusada, 5xx/timeout/corpo ilegível = indisponivel, sem chave = recusa sem rede; texto redigido", async () => {
    const recusada = await rodar({ action: "list_services", provider: "frenet" }, {
        rotas: { frenetInfo: () => new Response(`token ${TOKEN_FRENET} inválido`, { status: 401 }) },
    })
    assertEquals([recusada.corpo.success, recusada.corpo.motivo], [false, "chave_recusada"])
    assert(semSegredo(recusada.texto))
    for (const rota of [
        () => new Response("x", { status: 502 }),
        () => Promise.reject(new DOMException("aborted", "AbortError")),
        () => new Response("<html>", { status: 200 }),
    ]) {
        const r = await rodar({ action: "list_services", provider: "frenet" }, { rotas: { frenetInfo: rota } })
        assertEquals(r.corpo.motivo, "indisponivel")
    }
    const vazia = await rodar({ action: "list_services", provider: "frenet" }, { rotas: { frenetInfo: () => json({ ShippingSeviceAvailableArray: [] }) } })
    assertEquals(vazia.corpo.motivo, "sem_servicos")
    const semChave = await rodar({ action: "list_services", provider: "frenet" }, { banco: bancoFalso({ credenciais: [LINHA_SF] }) })
    assertEquals(semChave.corpo.success, false)
    assertEquals(semChave.chamadas.length, 0)
})

// ── save_credentials ────────────────────────────────────────────────────────

Deno.test("save_credentials: só admin; provedor inválido, _ligados e _revisao recusados sem gravar", async () => {
    const naoAdmin = await rodar({ action: "save_credentials", provider: "frenet", token: TOKEN_NOVO }, { admin: false })
    assertEquals(naoAdmin.resposta.status, 403)
    assertEquals(naoAdmin.registro.upsertsCredencial.length, 0)
    for (const provider of ["_ligados", "_revisao", "flat_fee", "SUPERFRETE", undefined]) {
        const r = await rodar({ action: "save_credentials", provider, token: TOKEN_NOVO })
        assertEquals(r.corpo.success, false, String(provider))
        assertEquals(r.registro.upsertsCredencial.length, 0)
    }
})

Deno.test("save_credentials: chave DESCONHECIDA na lista branca do provedor = recusa (Frenet não tem sandbox/seguro/e-mail; ninguém tem `ativo`)", async () => {
    for (const corpo of [
        { provider: "melhor_envio", token: TOKEN_NOVO, ativo: true },
        { provider: "frenet", token: TOKEN_NOVO, contact_email: EMAIL_SF },
        { provider: "frenet", token: TOKEN_NOVO, sandbox: true },
        { provider: "frenet", token: TOKEN_NOVO, seguro: "sem_seguro" },
        { provider: "frenet", token: TOKEN_NOVO, ativo: true },
        { provider: "superfrete", token: TOKEN_NOVO, contact_email: EMAIL_SF, hack: 1 },
    ]) {
        const r = await rodar({ action: "save_credentials", ...corpo })
        assertEquals(r.corpo.success, false, JSON.stringify(corpo))
        assertEquals(r.registro.upsertsCredencial.length, 0)
    }
})

Deno.test("save_credentials: UM upsert multi-linha com a linha do provedor + _revisao (uuid novo); merge preserva o resto; updated_at novo; sem token na resposta", async () => {
    const banco = bancoFalso({
        credenciais: [
            { ...LINHA_ME, credentials: { token: TOKEN_ME, sandbox: false, servicos: ["1"], seguro: "sem_seguro", extra_antigo: "fica" } },
            LINHA_SF,
            { provider: "_revisao", credentials: { revisao: "rev-velha" }, updated_at: "t" },
        ],
    })
    const antes = Date.now()
    const { corpo, registro, texto, saida } = await rodar({ action: "save_credentials", provider: "melhor_envio", token: ` ${TOKEN_NOVO} ` }, { banco })
    assertEquals(corpo, { success: true, tem_chave: true, servicos: ["1"], seguro: "sem_seguro", contact_email: null })
    assertEquals(registro.upsertsCredencial.length, 1)
    const [upsert] = registro.upsertsCredencial
    assertEquals(upsert.onConflict, "provider")
    assertEquals(upsert.linhas.map((l: any) => l.provider).sort(), ["_revisao", "melhor_envio"])
    const me = upsert.linhas.find((l: any) => l.provider === "melhor_envio")
    assertEquals(me.credentials, { token: TOKEN_NOVO, sandbox: false, servicos: ["1"], seguro: "sem_seguro", extra_antigo: "fica" })
    assert(Date.parse(me.updated_at) >= antes - 1000)
    const rev = upsert.linhas.find((l: any) => l.provider === "_revisao")
    assertEquals(/^[0-9a-f-]{36}$/.test(rev.credentials.revisao), true)
    assertNotEquals(rev.credentials.revisao, "rev-velha")
    assert(semSegredo(texto))
    assertEquals(saida.includes(TOKEN_NOVO), false)
})

Deno.test("save_credentials: token vazio MANTÉM o salvo; sem salvo e sem novo = recusa", async () => {
    const banco = bancoFalso({ credenciais: [{ ...LINHA_FRENET, credentials: { token: TOKEN_FRENET, servicos: ["F_3"] } }] })
    const mantido = await rodar({ action: "save_credentials", provider: "frenet", token: "  ", servicos: ["03298"] }, { banco })
    assertEquals(mantido.corpo.success, true)
    assertEquals(linhasGravadas(mantido.registro).find((l: any) => l.provider === "frenet").credentials, { token: TOKEN_FRENET, servicos: ["03298"] })
    const semNada = await rodar({ action: "save_credentials", provider: "frenet", servicos: ["03298"] }, { banco: bancoFalso({ credenciais: [] }) })
    assertEquals(semNada.corpo.success, false)
    assertEquals(semNada.registro.upsertsCredencial.length, 0)
})

Deno.test("save_credentials: servicos omitido MANTÉM; [] recusa; vazio, repetido, > 50, > 100 caracteres e formato errado (ME não numérico) recusam", async () => {
    const banco = bancoFalso({ credenciais: [{ ...LINHA_ME, credentials: { token: TOKEN_ME, servicos: ["31"] } }] })
    const omitido = await rodar({ action: "save_credentials", provider: "melhor_envio", seguro: "valor_dos_produtos" }, { banco })
    assertEquals(omitido.corpo.servicos, ["31"])
    for (const servicos of [[], [""], ["  "], ["1", "1"], ["1", " 1 "], ["abc"], [1], [null], "1,2", Array.from({ length: 51 }, (_, i) => String(i + 1))]) {
        const r = await rodar({ action: "save_credentials", provider: "melhor_envio", servicos }, { banco: bancoFalso({ credenciais: [LINHA_ME] }) })
        assertEquals(r.corpo.success, false, JSON.stringify(servicos))
        assertEquals(r.registro.upsertsCredencial.length, 0)
    }
    const longo = await rodar({ action: "save_credentials", provider: "frenet", servicos: ["x".repeat(101)] }, { banco: bancoFalso({ credenciais: [LINHA_FRENET] }) })
    assertEquals(longo.corpo.success, false)
    // Frenet: código livre (sem formato inventado) com até 100 caracteres.
    const livre = await rodar({ action: "save_credentials", provider: "frenet", servicos: ["JTE_INT", "código livre"] }, { banco: bancoFalso({ credenciais: [LINHA_FRENET] }) })
    assertEquals(livre.corpo.success, true)
})

Deno.test("save_credentials: seguro só nos dois valores do enum, e só no ME", async () => {
    const ok = await rodar({ action: "save_credentials", provider: "melhor_envio", seguro: "sem_seguro" })
    assertEquals(ok.corpo.seguro, "sem_seguro")
    const ruim = await rodar({ action: "save_credentials", provider: "melhor_envio", seguro: "zero" })
    assertEquals(ruim.corpo.success, false)
})

Deno.test("save_credentials SF: aceita o formato 1.5.5 (credentials:{...}) e exige o e-mail com as mesmas mensagens", async () => {
    const velho = await rodar({ action: "save_credentials", provider: "superfrete", credentials: { token: TOKEN_NOVO, sandbox: false, contact_email: EMAIL_SF } })
    assertEquals(velho.corpo, { success: true, tem_chave: true, servicos: null, sandbox: false, contact_email: EMAIL_SF })
    const semEmail = await rodar({ action: "save_credentials", provider: "superfrete", token: TOKEN_NOVO, contact_email: "joão@x.com" })
    assertEquals(semEmail.corpo.success, false)
    assert(String(semEmail.corpo.error).includes("e-mail"))
})

Deno.test("save_credentials com o provedor LIGADO e chave nova: testa com a chave NOVA antes de gravar; falhou = não grava e devolve o motivo", async () => {
    const banco = bancoFalso({ credenciais: [LINHA_ME, LINHA_SF, LINHA_FRENET, linhaLigados(["frenet"])] })
    const r = await rodar({ action: "save_credentials", provider: "frenet", token: TOKEN_NOVO }, {
        banco,
        rotas: { frenet: () => new Response("unauthorized", { status: 401 }) },
    })
    assertEquals(r.corpo.success, false)
    assertEquals(r.corpo.motivo, "chave_recusada")
    assertEquals(r.registro.upsertsCredencial.length, 0)
    assertEquals(cabecalho(chamadasPara(r.chamadas, FRENET)[0], "token"), TOKEN_NOVO)
    // A antiga continua.
    assertEquals(banco.credenciais[2].credentials.token, TOKEN_FRENET)
})

Deno.test("save_credentials com o provedor LIGADO: 'indisponivel' nunca vira chave recusada, e também não grava", async () => {
    const banco = bancoFalso({ credenciais: [LINHA_ME, LINHA_SF, LINHA_FRENET, linhaLigados(["frenet"])] })
    const r = await rodar({ action: "save_credentials", provider: "frenet", token: TOKEN_NOVO }, {
        banco,
        rotas: { frenet: () => new Response("erro", { status: 503 }) },
    })
    assertEquals(r.corpo.motivo, "indisponivel")
    assertEquals(r.registro.upsertsCredencial.length, 0)
})

Deno.test("save_credentials com o provedor DESLIGADO: grava sem testar (salvar não liga nada)", async () => {
    const r = await rodar({ action: "save_credentials", provider: "frenet", token: TOKEN_NOVO })
    assertEquals(r.corpo.success, true)
    assertEquals(r.chamadas.length, 0)
    assertEquals(linhasGravadas(r.registro).some((l: any) => l.provider === "_ligados"), false)
})

Deno.test("save_credentials: mudou chave/serviços/seguro -> apaga o cache de cotação; só o e-mail -> não apaga; falha ao apagar = success com cache 'pendente'", async () => {
    const chave = await rodar({ action: "save_credentials", provider: "frenet", token: TOKEN_NOVO })
    assertEquals(chave.registro.deletesCache, 1)
    const email = await rodar({ action: "save_credentials", provider: "superfrete", contact_email: "outro@ex.com" })
    assertEquals(email.corpo.success, true)
    assertEquals(email.registro.deletesCache, 0)
    const pendente = await rodar({ action: "save_credentials", provider: "melhor_envio", seguro: "sem_seguro" }, {
        banco: bancoFalso({ falhas: { apagarCache: true } }),
    })
    assertEquals(pendente.corpo.success, true)
    assertEquals(pendente.corpo.cache, "pendente")
})

Deno.test("save_credentials: falha do banco ao gravar -> 5xx em português, sem o token (nem no console)", async () => {
    const r = await rodar({ action: "save_credentials", provider: "frenet", token: TOKEN_NOVO }, { banco: bancoFalso({ falhas: { gravarCredencial: true } }) })
    assert(r.resposta.status >= 500)
    assertEquals(r.corpo.success, false)
    assertEquals(r.texto.includes(TOKEN_NOVO), false)
    assertEquals(r.saida.includes(TOKEN_NOVO), false)
})

// ── test_credentials (R1-8) ─────────────────────────────────────────────────

Deno.test("test_credentials: a MESMA cotação do checkout, da origem da loja para 01015070, pacote 0,1 kg 16×11×4, services = os selecionados", async () => {
    const banco = bancoFalso({ config: { origin_cep: "30140-071" } })
    const { corpo, chamadas } = await rodar({ action: "test_credentials", provider: "melhor_envio", usarCredencialSalva: true, servicos: ["31", "1"] }, { banco })
    const [c] = chamadasPara(chamadas, ME)
    const pedido = corpoDe(c)
    assertEquals(pedido.from, { postal_code: "30140071" })
    assertEquals(pedido.to, { postal_code: "01015070" })
    assertEquals(pedido.services, "1,31")
    assertEquals(pedido.products.length, 1)
    assertEquals([pedido.products[0].weight, pedido.products[0].length, pedido.products[0].width, pedido.products[0].height], [0.1, 16, 11, 4])
    assertEquals(corpo.success, true)
    assertEquals(corpo.cotadas, 2)
    assertEquals(corpo.servicosTestados, [
        { codigo: "1", ok: true, preco: 26.75, prazo: 10 },
        { codigo: "31", ok: true, preco: 10.49, prazo: 2 },
    ])
})

Deno.test("test_credentials: 200 legível com TODOS os selecionados em erro = sem_cotacao_valida, com erro_do_servico por serviço (NUNCA chave_recusada)", async () => {
    const { corpo } = await rodar({ action: "test_credentials", provider: "melhor_envio", usarCredencialSalva: true, servicos: ["17", "33", "99"] })
    assertEquals(corpo.success, false)
    assertEquals(corpo.motivo, "sem_cotacao_valida")
    assertEquals(corpo.servicosTestados.map((s: any) => [s.codigo, s.ok, s.motivo]), [
        ["17", false, "erro_do_servico"],
        ["33", false, "erro_do_servico"],
        ["99", false, "nao_retornado"],
    ])
    assert(String(corpo.servicosTestados[0].detalhe).includes("Dimensões"))
})

Deno.test("test_credentials: 401/403 = chave_recusada; 5xx, timeout e corpo ilegível = indisponivel", async () => {
    for (const status of [401, 403]) {
        const r = await rodar({ action: "test_credentials", provider: "frenet", usarCredencialSalva: true }, { rotas: { frenet: () => new Response("no", { status }) } })
        assertEquals(r.corpo.motivo, "chave_recusada", String(status))
    }
    for (const rota of [
        () => new Response("x", { status: 500 }),
        () => Promise.reject(new DOMException("aborted", "AbortError")),
        () => Promise.reject(new TypeError("error sending request")),
        () => new Response("<html>", { status: 200 }),
    ]) {
        const r = await rodar({ action: "test_credentials", provider: "frenet", usarCredencialSalva: true }, { rotas: { frenet: rota } })
        assertEquals(r.corpo.motivo, "indisponivel")
        assertEquals(r.corpo.success, false)
    }
})

Deno.test("test_credentials Frenet: Msg explícito de token = chave_recusada; Msg de trecho = erro_do_servico; token digitado e sem token na resposta", async () => {
    const token = await rodar({ action: "test_credentials", provider: "frenet", token: "tok-digitado-FICTICIO", servicos: ["03298"] }, {
        rotas: { frenet: () => json({ ShippingSevicesArray: [{ ServiceCode: "03298", Error: true, Msg: "Token inválido" }] }) },
    })
    assertEquals(token.corpo.motivo, "chave_recusada")
    assertEquals(cabecalho(chamadasPara(token.chamadas, FRENET)[0], "token"), "tok-digitado-FICTICIO")
    const trecho = await rodar({ action: "test_credentials", provider: "frenet", usarCredencialSalva: true, servicos: ["03298"] }, {
        rotas: { frenet: () => json({ ShippingSevicesArray: [{ ServiceCode: "03298", Error: true, Msg: `não atende o trecho ${TOKEN_FRENET}` }] }) },
    })
    assertEquals(trecho.corpo.motivo, "sem_cotacao_valida")
    assertEquals(trecho.corpo.servicosTestados[0].motivo, "erro_do_servico")
    assert(semSegredo(trecho.texto))
})

Deno.test("test_credentials: sem servicos informados usa os SALVOS; sem salvos, o filtro legado", async () => {
    const banco = bancoFalso({ credenciais: [LINHA_ME, LINHA_SF, { ...LINHA_FRENET, credentials: { token: TOKEN_FRENET, servicos: ["JTE_INT"] } }] })
    const salvos = await rodar({ action: "test_credentials", provider: "frenet", usarCredencialSalva: true }, { banco })
    assertEquals(salvos.corpo.servicosTestados.map((s: any) => s.codigo), ["JTE_INT"])
    const legado = await rodar({ action: "test_credentials", provider: "frenet", usarCredencialSalva: true })
    assertEquals(legado.corpo.success, true)
    assertEquals(legado.corpo.servicosTestados.map((s: any) => s.codigo), ["03298", "03220"])
})

Deno.test("test_credentials: só admin; sem chave salva = erro claro sem rede; formato 1.5.5 da SF continua (e-mail do campo)", async () => {
    assertEquals((await rodar({ action: "test_credentials", provider: "frenet", usarCredencialSalva: true }, { admin: false })).resposta.status, 403)
    const semChave = await rodar({ action: "test_credentials", provider: "frenet", usarCredencialSalva: true }, { banco: bancoFalso({ credenciais: [LINHA_SF] }) })
    assertEquals(semChave.corpo.success ?? false, false)
    assertEquals(semChave.chamadas.length, 0)
    const sf = await rodar({ action: "test_credentials", provider: "superfrete", usarCredencialSalva: true, credentials: { contact_email: "novo@ex.com" } })
    assertEquals(sf.corpo.success, true)
    assertEquals(cabecalho(chamadasPara(sf.chamadas, SF)[0], "User-Agent"), "IKCOUS Marketplace 1.5.7 (novo@ex.com)")
    assertEquals(typeof sf.corpo.message, "string")
})

// ── save_active_providers (R2-1, R3-1, R2-2, R1-3) ──────────────────────────

Deno.test("save_active_providers: só admin; lista inválida, provedor desconhecido, _ligados e sem chave salva = recusa sem gravar", async () => {
    assertEquals((await rodar({ action: "save_active_providers", ligados: ["superfrete"] }, { admin: false })).resposta.status, 403)
    for (const ligados of [undefined, "superfrete", ["flat_fee"], ["_ligados"], ["_revisao"]]) {
        const r = await rodar({ action: "save_active_providers", ligados })
        assertEquals(r.corpo.success, false, JSON.stringify(ligados))
        assertEquals(r.registro.upsertsCredencial.length, 0)
    }
    const semChave = await rodar({ action: "save_active_providers", ligados: ["frenet"] }, { banco: bancoFalso({ credenciais: [LINHA_SF] }) })
    assertEquals(semChave.corpo.success, false)
    assertEquals(semChave.corpo.provider, "frenet")
})

Deno.test("save_active_providers: sandbox não liga, e o teste reprovado de quem PASSA a ser ligado barra tudo (nada grava)", async () => {
    const sandbox = await rodar({ action: "save_active_providers", ligados: ["melhor_envio"] }, {
        banco: bancoFalso({ credenciais: [{ ...LINHA_ME, credentials: { token: TOKEN_ME, sandbox: true, contact_email: EMAIL_ME } }, LINHA_SF] }),
    })
    assertEquals(sandbox.corpo.success, false)
    assertEquals(sandbox.corpo.provider, "melhor_envio")
    assertEquals(sandbox.corpo.motivo, "sandbox")
    assertEquals(sandbox.chamadas.length, 0)
    const reprovado = await rodar({ action: "save_active_providers", ligados: ["superfrete", "frenet"] }, {
        rotas: { frenet: () => new Response("x", { status: 500 }) },
    })
    assertEquals(reprovado.corpo.success, false)
    assertEquals(reprovado.corpo.provider, "frenet")
    assertEquals(reprovado.corpo.motivo, "indisponivel")
    assertEquals(reprovado.registro.upsertsCredencial.length, 0)
    assertEquals(reprovado.registro.updatesConfig.length, 0)
    // A SF já estava ligada (legado): não é testada de novo.
    assertEquals(chamadasPara(reprovado.chamadas, SF).length, 0)
})

Deno.test("save_active_providers: aprovado = UM upsert com _ligados + _revisao (nunca regrava credencial), espelho = 1º na ordem, cache apagado", async () => {
    const banco = bancoFalso()
    const { corpo, registro } = await rodar({ action: "save_active_providers", ligados: ["frenet", "melhor_envio", "frenet"] }, { banco })
    assertEquals(corpo, { success: true, ligados: ["melhor_envio", "frenet"] })
    assertEquals(registro.upsertsCredencial.length, 1)
    const linhas = registro.upsertsCredencial[0].linhas
    assertEquals(linhas.map((l: any) => l.provider).sort(), ["_ligados", "_revisao"])
    const ligadosLinha = linhas.find((l: any) => l.provider === "_ligados")
    assertEquals(ligadosLinha.credentials.ligados, ["melhor_envio", "frenet"])
    assertEquals(typeof ligadosLinha.credentials.atualizado_em, "string")
    assertEquals(JSON.stringify(linhas).includes("token"), false)
    assertEquals(registro.updatesConfig, [{ shipping_provider: "melhor_envio" }])
    assertEquals(registro.deletesCache, 1)
    // A `_revisao` nasceu na primeira escrita da edge (R3-1).
    assertEquals(/^[0-9a-f-]{36}$/.test(revisaoDe(banco)), true)
    // Validou e testou ANTES de gravar; o espelho vem DEPOIS do upsert.
    const ev = registro.eventos
    assert(ev.findIndex((e) => e.startsWith("fetch:")) < ev.indexOf("upsert:store_shipping_credentials"))
    assert(ev.indexOf("upsert:store_shipping_credentials") < ev.indexOf("update:store_config"))
})

Deno.test("save_active_providers: lista vazia = espelho 'flat_fee'; salvar DUAS vezes é idempotente (a 2ª não testa nem muda o conjunto)", async () => {
    const vazio = await rodar({ action: "save_active_providers", ligados: [] })
    assertEquals(vazio.corpo, { success: true, ligados: [] })
    assertEquals(vazio.registro.updatesConfig, [{ shipping_provider: "flat_fee" }])
    const banco = bancoFalso()
    const primeira = await rodar({ action: "save_active_providers", ligados: ["superfrete", "melhor_envio"] }, { banco })
    assertEquals(primeira.corpo.success, true)
    const segunda = await rodar({ action: "save_active_providers", ligados: ["melhor_envio", "superfrete"] }, { banco })
    assertEquals(segunda.corpo, { success: true, ligados: ["superfrete", "melhor_envio"] })
    assertEquals(segunda.chamadas.length, 0)
    assertEquals(banco.credenciais.find((l: any) => l.provider === "_ligados").credentials.ligados, ["superfrete", "melhor_envio"])
})

Deno.test("save_active_providers: o espelho falhou -> success com espelho:'pendente' e aviso honesto (os ligados gravaram)", async () => {
    const { corpo, registro } = await rodar({ action: "save_active_providers", ligados: ["superfrete"] }, { banco: bancoFalso({ falhas: { espelho: true } }) })
    assertEquals(corpo.success, true)
    assertEquals(corpo.espelho, "pendente")
    assertEquals(typeof corpo.aviso, "string")
    assertEquals(registro.upsertsCredencial.length, 1)
})

Deno.test("save_active_providers: apagar o cache falhou -> success com cache:'pendente'", async () => {
    const { corpo } = await rodar({ action: "save_active_providers", ligados: ["superfrete"] }, { banco: bancoFalso({ falhas: { apagarCache: true } }) })
    assertEquals(corpo.success, true)
    assertEquals(corpo.cache, "pendente")
})

Deno.test("R2-2 de ponta a ponta: cotou com o ME ligado, desligou o ME -> a linha do cache sumiu e a RPC simulada não acha o id", async () => {
    const banco = bancoFalso({ credenciais: [LINHA_ME, LINHA_SF, LINHA_FRENET, linhaLigados(["melhor_envio", "superfrete"])] })
    const cot = await rodar({ cep: "01001-000", cart: [{ product: { id: "p1" }, quantity: 1 }], contratoCliente: 3 }, { banco })
    const idDoMe = cot.corpo.options.find((o: any) => o.provider === "melhor_envio").id
    const rpcAcha = (id: string) => banco.registro.cacheLinhas.some((l: any) => l.options.some((o: any) => o.id === id))
    assertEquals(rpcAcha(idDoMe), true)
    const salvar = await rodar({ action: "save_active_providers", ligados: ["superfrete"] }, { banco })
    assertEquals(salvar.corpo.success, true)
    assertEquals(rpcAcha(idDoMe), false)
    void RESPOSTA_ME_REAL
    void RESPOSTA_SF_OFICIAL
    void RESPOSTA_FRENET_EXEMPLO
})

// ── R3-7: o e-mail de contato do ME vem do app ─────────────────────────────

const UA_LEGADO_DO_ME = "IKCOUS-Marketplace-Integration (contato@ikcous.com.br)"

Deno.test("R3-7 save_credentials ME: contact_email válido grava APARADO; inválido recusa com a mensagem da SF 1.5.5; vazio/ausente MANTÉM o salvo", async () => {
    const ok = await rodar({ action: "save_credentials", provider: "melhor_envio", contact_email: "  novo-me@ex.com " })
    assertEquals(ok.corpo.success, true)
    assertEquals(ok.corpo.contact_email, "novo-me@ex.com")
    assertEquals(linhasGravadas(ok.registro).find((l: any) => l.provider === "melhor_envio").credentials.contact_email, "novo-me@ex.com")
    for (const ruim of ["sem-arroba", "a@b.com\r\nX: y", "joão@x.com", "a b@c.com"]) {
        const r = await rodar({ action: "save_credentials", provider: "melhor_envio", contact_email: ruim })
        assertEquals(r.corpo, { success: false, error: "Confira o e-mail de contato técnico: use um endereço completo, sem espaços nem acentos (exemplo: voce@sualoja.com.br)." })
        assertEquals(r.registro.upsertsCredencial.length, 0)
    }
    for (const vazio of ["", "   ", null]) {
        const r = await rodar({ action: "save_credentials", provider: "melhor_envio", contact_email: vazio, seguro: "sem_seguro" })
        assertEquals(r.corpo.success, true, JSON.stringify(vazio))
        assertEquals(linhasGravadas(r.registro).find((l: any) => l.provider === "melhor_envio").credentials.contact_email, EMAIL_ME)
    }
})

Deno.test("R3-7: o e-mail da SF NUNCA é copiado para o ME, nem o contrário", async () => {
    const banco = bancoFalso({ credenciais: [{ ...LINHA_ME, credentials: { token: TOKEN_ME } }, LINHA_SF] })
    await rodar({ action: "save_credentials", provider: "superfrete", contact_email: "outro-sf@ex.com" }, { banco })
    assertEquals(banco.credenciais.find((l: any) => l.provider === "melhor_envio").credentials.contact_email, undefined)
    await rodar({ action: "save_credentials", provider: "melhor_envio", contact_email: "so-me@ex.com" }, { banco })
    assertEquals(banco.credenciais.find((l: any) => l.provider === "superfrete").credentials.contact_email, "outro-sf@ex.com")
    const lida = await rodar({ action: "ler_configuracao_frete" }, { banco })
    assertEquals(lida.corpo.provedores.melhor_envio.contato_email, "so-me@ex.com")
    assertEquals(lida.corpo.provedores.superfrete.contato_email, "outro-sf@ex.com")
    assert(semSegredo(lida.texto))
})

Deno.test("R3-7 save_active_providers: ligar o ME SEM contact_email é recusado com a mensagem do contrato (nada grava, nada chama)", async () => {
    const r = await rodar({ action: "save_active_providers", ligados: ["superfrete", "melhor_envio"] }, {
        banco: bancoFalso({ credenciais: [{ ...LINHA_ME, credentials: { token: TOKEN_ME } }, LINHA_SF, LINHA_FRENET] }),
    })
    assertEquals(r.corpo, {
        success: false,
        provider: "melhor_envio",
        motivo: "sem_email",
        error: "Informe o e-mail de contato do Melhor Envio (a API exige um contato da loja)",
    })
    assertEquals(r.registro.upsertsCredencial.length, 0)
    assertEquals(r.chamadas.length, 0)
})

Deno.test("R3-7 cotação: o User-Agent do ME leva o contato DA LOJA; o log marca ua_contato 'loja' e nunca imprime o e-mail", async () => {
    const banco = bancoFalso({ credenciais: [LINHA_ME, LINHA_SF, LINHA_FRENET, linhaLigados(["melhor_envio"])] })
    const { chamadas, saida, texto } = await rodar(cotacao(), { banco })
    const me = chamadasPara(chamadas, ME)
    assertEquals(me.length, 1)
    assertEquals(cabecalho(me[0], "User-Agent"), `IKCOUS-Marketplace-Integration (${EMAIL_ME})`)
    const linha = linhasDoLog(saida).find((l) => l.provedor === "melhor_envio")
    assertEquals(linha.ua_contato, "loja")
    assertEquals(saida.includes(EMAIL_ME), false)
    assertEquals(texto.includes(EMAIL_ME), false)
})

Deno.test("R3-7 cotação: ME SEM contato em modo LEGADO usa o recuo antigo (lojas de hoje no ar) e o log marca ua_contato 'legado'", async () => {
    const banco = bancoFalso({ config: { shipping_provider: "melhor_envio" }, credenciais: [{ ...LINHA_ME, credentials: { token: TOKEN_ME } }] })
    const { resposta, chamadas, saida } = await rodar(cotacao(), { banco })
    assertEquals(resposta.status, 200)
    assertEquals(cabecalho(chamadas[0], "User-Agent"), UA_LEGADO_DO_ME)
    assertEquals(linhasDoLog(saida).map((l) => l.ua_contato), ["legado"])
})

Deno.test("R3-7 list_services ME: o catálogo também sai com o contato DA LOJA; sem contato, o recuo legado", async () => {
    const com = await rodar({ action: "list_services", provider: "melhor_envio" })
    assertEquals(cabecalho(com.chamadas[0], "User-Agent"), `IKCOUS-Marketplace-Integration (${EMAIL_ME})`)
    assertEquals(com.texto.includes(EMAIL_ME), false)
    const sem = await rodar({ action: "list_services", provider: "melhor_envio" }, {
        banco: bancoFalso({ credenciais: [{ ...LINHA_ME, credentials: { token: TOKEN_ME } }] }),
    })
    assertEquals(cabecalho(sem.chamadas[0], "User-Agent"), UA_LEGADO_DO_ME)
})

Deno.test("R3-7 test_credentials ME: e-mail DIGITADO inválido recusa sem chamar; válido vai no User-Agent", async () => {
    const ruim = await rodar({ action: "test_credentials", provider: "melhor_envio", usarCredencialSalva: true, contact_email: "a@b.com)" })
    assertEquals(ruim.corpo.success, false)
    assertEquals(ruim.chamadas.length, 0)
    const bom = await rodar({ action: "test_credentials", provider: "melhor_envio", usarCredencialSalva: true, contact_email: "digitado-me@ex.com" })
    assertEquals(cabecalho(bom.chamadas[0], "User-Agent"), "IKCOUS-Marketplace-Integration (digitado-me@ex.com)")
    assertEquals(bom.texto.includes("digitado-me@ex.com"), false)
})

Deno.test("R3-7: a ação PÚBLICA revisao_config_frete não carrega e-mail nenhum (nem da SF, nem do ME)", async () => {
    const { texto } = await rodar({ action: "revisao_config_frete" }, { admin: false })
    for (const email of [EMAIL_ME, EMAIL_SF]) assertEquals(texto.includes(email), false)
})

// ── Revisor do L → E: e-mail de contato vai para o User-Agent — controle recusa ──

const COM_CONTROLE = [
    "loja@ex.com\r\nX-Injetado: 1",
    "loja@ex.com\n",
    "\r\nloja@ex.com",
    "loja@ex.com\t",
    "\tloja@ex.com",
    "lo\u0000ja@ex.com",
    "loja@ex.com\u007f",
    "loja@ex.com\u0085",
    "\r\n",
]
const MSG_EMAIL_INVALIDO = "Confira o e-mail de contato técnico: use um endereço completo, sem espaços nem acentos (exemplo: voce@sualoja.com.br)."

Deno.test("contact_email com CR/LF/TAB/NUL/DEL/NEL em QUALQUER posição é RECUSADO no save_credentials (ME e SF) — nada grava, nada chama", async () => {
    for (const provider of ["melhor_envio", "superfrete"]) {
        for (const ruim of COM_CONTROLE) {
            for (const forma of ["topo", "credentials"]) {
                const corpo = forma === "topo"
                    ? { action: "save_credentials", provider, contact_email: ruim }
                    : { action: "save_credentials", provider, credentials: { contact_email: ruim } }
                const r = await rodar(corpo)
                assertEquals(r.corpo, { success: false, error: MSG_EMAIL_INVALIDO }, `${provider} ${forma} ${JSON.stringify(ruim)}`)
                assertEquals(r.registro.upsertsCredencial.length, 0)
                assertEquals(r.chamadas.length, 0)
            }
        }
    }
})

Deno.test("contact_email com controle é RECUSADO no test_credentials e no list_services (ME e SF), antes de qualquer chamada", async () => {
    for (const provider of ["melhor_envio", "superfrete"]) {
        for (const ruim of COM_CONTROLE) {
            const teste = await rodar({ action: "test_credentials", provider, usarCredencialSalva: true, contact_email: ruim })
            assertEquals(teste.corpo.success, false, `${provider} ${JSON.stringify(ruim)}`)
            assertEquals(teste.corpo.error, MSG_EMAIL_INVALIDO)
            assertEquals(teste.chamadas.length, 0)
            const lista = await rodar({ action: "list_services", provider, contact_email: ruim })
            assertEquals(lista.corpo, { success: false, error: MSG_EMAIL_INVALIDO }, `${provider} ${JSON.stringify(ruim)}`)
            assertEquals(lista.chamadas.length, 0)
        }
    }
})

Deno.test("controle: nenhum User-Agent que SAI carrega CR/LF (cotação com e-mail salvo limpo; espaço nas pontas continua aparado)", async () => {
    const ok = await rodar({ action: "save_credentials", provider: "melhor_envio", contact_email: "  limpo-me@ex.com  " })
    assertEquals(ok.corpo.success, true)
    assertEquals(ok.corpo.contact_email, "limpo-me@ex.com")
    const { chamadas } = await rodar(cotacao())
    assert(chamadas.length > 0)
    for (const c of chamadas) {
        const ua = cabecalho(c, "User-Agent") ?? ""
        assertEquals(/[\r\n\t]/.test(ua), false, ua)
    }
})

// ── Revisão Opus (ações de admin): provedor LIGADO não vira Sandbox ─────────

const TOKEN_SANDBOX = "tok-SANDBOX-ficticio-000"
const RECUSA_SANDBOX_ME = {
    success: false,
    motivo: "sandbox",
    error: "Melhor Envio está ligada: desligue antes de usar o modo de testes (Sandbox). A chave de testes não pode cotar para clientes.",
}

Deno.test("save_credentials: ME LIGADO (multi) + sandbox:true = recusa SEM teste, SEM upsert, SEM apagar cache; o checkout continua em produção", async () => {
    const banco = bancoFalso({
        credenciais: [
            { ...LINHA_ME, credentials: { token: TOKEN_ME, sandbox: false, contact_email: EMAIL_ME } },
            LINHA_SF,
            linhaLigados(["melhor_envio"]),
        ],
    })
    const r = await rodar({ action: "save_credentials", provider: "melhor_envio", token: TOKEN_SANDBOX, sandbox: true }, { banco })
    assertEquals(r.corpo, RECUSA_SANDBOX_ME)
    assertEquals(r.chamadas.length, 0)
    assertEquals(r.registro.upsertsCredencial.length, 0)
    assertEquals(r.registro.deletesCache, 0)
    assertEquals(banco.credenciais.find((l: any) => l.provider === "melhor_envio").credentials.sandbox, false)
    assertEquals(r.texto.includes(TOKEN_SANDBOX), false)
    // No formato 1.5.5 (credentials:{...}) a mesma recusa.
    const velho = await rodar({ action: "save_credentials", provider: "melhor_envio", credentials: { token: TOKEN_SANDBOX, sandbox: true } }, { banco })
    assertEquals(velho.corpo, RECUSA_SANDBOX_ME)
    assertEquals(velho.registro.upsertsCredencial.length, 0)
    const q = await rodar(cotacao(), { banco })
    assertEquals(q.resposta.status, 200)
    assert(q.chamadas.length > 0)
    for (const c of q.chamadas) assertEquals(c.url.includes("sandbox"), false, c.url)
})

Deno.test("save_credentials: SF ligada no LEGADO (espelho) + sandbox:true = mesma recusa; a cotação segue em api.superfrete.com", async () => {
    const banco = bancoFalso({ credenciais: [LINHA_SF] })
    const r = await rodar({ action: "save_credentials", provider: "superfrete", token: TOKEN_SANDBOX, sandbox: true }, { banco })
    assertEquals(r.corpo, {
        success: false,
        motivo: "sandbox",
        error: "SuperFrete está ligada: desligue antes de usar o modo de testes (Sandbox). A chave de testes não pode cotar para clientes.",
    })
    assertEquals(r.chamadas.length, 0)
    assertEquals(r.registro.upsertsCredencial.length, 0)
    assertEquals(r.registro.deletesCache, 0)
    const q = await rodar(cotacao(), { banco })
    assertEquals(q.resposta.status, 200)
    assert(q.chamadas.length > 0)
    for (const c of q.chamadas) assert(c.url.startsWith("https://api.superfrete.com/"), c.url)
})

Deno.test("save_credentials sandbox: controle — DESLIGADO grava (salvar não liga); ligado já em Sandbox pode VOLTAR à produção com a chave de produção", async () => {
    const desligado = await rodar({ action: "save_credentials", provider: "melhor_envio", token: TOKEN_SANDBOX, sandbox: true }, {
        banco: bancoFalso({ credenciais: [LINHA_ME, LINHA_SF, linhaLigados(["superfrete"])] }),
    })
    assertEquals(desligado.corpo.success, true)
    assertEquals(linhasGravadas(desligado.registro).find((l: any) => l.provider === "melhor_envio").credentials.sandbox, true)
    const banco = bancoFalso({ credenciais: [{ ...LINHA_SF, credentials: { ...LINHA_SF.credentials, sandbox: true } }] })
    const volta = await rodar({ action: "save_credentials", provider: "superfrete", token: TOKEN_NOVO, sandbox: false }, { banco })
    assertEquals(volta.corpo.success, true)
    assertEquals(banco.credenciais.find((l: any) => l.provider === "superfrete").credentials.sandbox, false)
})

Deno.test("save_credentials sandbox: ME na lista _ligados SEM chave salva (a chave nova o ligaria) + sandbox:true = mesma recusa", async () => {
    const banco = bancoFalso({ credenciais: [{ ...LINHA_ME, credentials: { contact_email: EMAIL_ME } }, LINHA_SF, linhaLigados(["melhor_envio", "superfrete"])] })
    const r = await rodar({ action: "save_credentials", provider: "melhor_envio", token: TOKEN_SANDBOX, sandbox: true }, { banco })
    assertEquals(r.corpo, RECUSA_SANDBOX_ME)
    assertEquals(r.registro.upsertsCredencial.length, 0)
    assertEquals(r.chamadas.length, 0)
})

// ── Hub (D1/R1): nenhuma chave passa a cotar para cliente sem teste ─────────

Deno.test("save_credentials: provedor na lista _ligados SEM chave salva recebe chave nova -> TESTA antes de gravar; reprovado não grava nada", async () => {
    // Duas formas de "sem chave": sem linha nenhuma, e linha sem token.
    for (const linhaFrenet of [[], [{ ...LINHA_FRENET, credentials: { servicos: ["03298"] } }]]) {
        const banco = bancoFalso({ credenciais: [LINHA_ME, LINHA_SF, ...linhaFrenet, linhaLigados(["superfrete", "frenet"])] })
        const antes = structuredClone(banco.credenciais)
        const r = await rodar({ action: "save_credentials", provider: "frenet", token: TOKEN_NOVO }, {
            banco,
            rotas: { frenet: () => new Response("unauthorized", { status: 401 }) },
        })
        assertEquals(r.corpo.success, false, JSON.stringify(linhaFrenet))
        assertEquals(r.corpo.motivo, "chave_recusada")
        assertEquals(chamadasPara(r.chamadas, FRENET).length, 1)
        assertEquals(cabecalho(chamadasPara(r.chamadas, FRENET)[0], "token"), TOKEN_NOVO)
        assertEquals(r.registro.upsertsCredencial.length, 0)
        assertEquals(r.registro.deletesCache, 0)
        assertEquals(banco.credenciais, antes)
        assertEquals(r.texto.includes(TOKEN_NOVO), false)
    }
})

Deno.test("save_credentials: provedor na lista _ligados SEM chave salva recebe chave nova -> teste APROVADO grava (e passa a cotar)", async () => {
    const banco = bancoFalso({ credenciais: [LINHA_ME, LINHA_SF, linhaLigados(["superfrete", "frenet"])] })
    const r = await rodar({ action: "save_credentials", provider: "frenet", token: TOKEN_NOVO }, { banco })
    assertEquals(r.corpo.success, true)
    assertEquals(chamadasPara(r.chamadas, FRENET).length, 1)
    assertEquals(r.registro.upsertsCredencial.length, 1)
    assertEquals(banco.credenciais.find((l: any) => l.provider === "frenet").credentials.token, TOKEN_NOVO)
    const q = await rodar(cotacao(), { banco })
    assertEquals(chamadasPara(q.chamadas, FRENET).length, 1)
})
