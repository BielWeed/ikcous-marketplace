// @ts-nocheck
/**
 * Caça por mutação (25/11/2026) em `provedores.ts` — as funções puras que
 * decidem COM QUE token, QUE e-mail de contato, QUE serviços e COM QUE seguro a
 * cotação de frete vai à transportadora da lojista (dinheiro e chave). Quase
 * nenhuma tinha teste direto: só passavam de raspão pelo `index_test.ts`.
 *
 *   * `emailDeContatoValido`: o e-mail vai num cabeçalho HTTP (User-Agent) — o
 *     limite de 254, o `@` único, os caracteres do local, o domínio com pelo
 *     menos dois rótulos e o último só de letras, e nada de quebra de linha;
 *   * `tokenDe`, `seguroDoMe`, `baseDaSuperFrete`: a chave aparada, o seguro só
 *     quando gravado EXATO, o sandbox só com `true` EXATO;
 *   * `servicosSalvos` / `codigoNoFormatoDoProvedor`: itens inválidos e
 *     repetidos saem, ME e SuperFrete em ordem NUMÉRICA ("10" depois de "2"),
 *     Frenet na ordem salva, lista vazia continua lista;
 *   * `servicosSuperFrete`: lista vazia = todos; ids únicos e em ordem numérica;
 *   * `servicoCasaChave`: PAC só por palavra inteira (".Package" não é PAC);
 *   * `falhaPorStatus`, `emOrdemCanonica`, `precosMudadosPelaRegra`.
 *
 * Tudo puro; e-mails `@fixture.invalid`; sem rede.
 */
import { assert, assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts"
import {
    baseDaSuperFrete,
    cabecalhosDaSuperFrete,
    chamarComTempo,
    codigoNoFormatoDoProvedor,
    ehProvedor,
    emailDeContatoValido,
    emOrdemCanonica,
    erroDeTransportadoraEhCepInvalido,
    FalhaDoProvedor,
    falhaPorStatus,
    precosMudadosPelaRegra,
    seguroDoMe,
    servicoCasaChave,
    servicosSalvos,
    servicosSuperFrete,
    TEMPO_LIMITE_DO_PROVEDOR_MS,
    tokenDe,
    urlDaCotacaoSuperFrete,
    userAgentDaSuperFrete,
    userAgentDoMelhorEnvio,
} from "./provedores.ts"

// ── provedores conhecidos ───────────────────────────────────────────────

Deno.test("emOrdemCanonica - só os três conhecidos, sem repetição, SEMPRE na ordem canônica (não na ordem pedida)", () => {
    assertEquals(emOrdemCanonica(["frenet", "x", "superfrete", "frenet", 3, null, "melhor_envio"]), ["superfrete", "melhor_envio", "frenet"])
    assertEquals(emOrdemCanonica(["frenet", "melhor_envio"]), ["melhor_envio", "frenet"])
    assertEquals(emOrdemCanonica(["Frenet", "MELHOR_ENVIO", " superfrete"]), [])
    assertEquals(emOrdemCanonica([]), [])
    assertEquals(ehProvedor("frenet"), true)
    assertEquals(ehProvedor("Frenet"), false)
    assertEquals(ehProvedor(["frenet"]), false)
    assertEquals(ehProvedor(undefined), false)
})

// ── CEP inválido e status ─────────────────────────────────────────────

Deno.test("erroDeTransportadoraEhCepInvalido - precisa dos DOIS sinais ('retornou 422:' e 'cep_destino')", () => {
    assertEquals(erroDeTransportadoraEhCepInvalido('Melhor Envio API retornou 422: {"cep_destino":["invalido"]}'), true)
    assertEquals(erroDeTransportadoraEhCepInvalido("Melhor Envio API retornou 422: outro problema"), false)
    assertEquals(erroDeTransportadoraEhCepInvalido("Melhor Envio API retornou 500: cep_destino"), false)
    assertEquals(erroDeTransportadoraEhCepInvalido("cep_destino sozinho"), false)
    assertEquals(erroDeTransportadoraEhCepInvalido("retornou 422 sem dois pontos cep_destino"), false)
    assertEquals(erroDeTransportadoraEhCepInvalido(""), false)
    assertEquals(erroDeTransportadoraEhCepInvalido(null), false)
    assertEquals(erroDeTransportadoraEhCepInvalido(undefined), false)
})

Deno.test("falhaPorStatus - 401 e 403 são chave recusada; 422 com cep_destino é CEP inválido; o resto é indisponível; segredo some e o corpo não é cortado", () => {
    const f401 = falhaPorStatus("Melhor Envio", 401, "Unauthenticated", [])
    assert(f401 instanceof FalhaDoProvedor)
    assertEquals(f401.name, "FalhaDoProvedor")
    assertEquals(f401.motivo, "chave_recusada")
    assertEquals(f401.message, "Melhor Envio API retornou 401: Unauthenticated")
    assertEquals(falhaPorStatus("SuperFrete", 403, "x", []).motivo, "chave_recusada")
    assertEquals(falhaPorStatus("Frenet", 422, '{"cep_destino":"x"}', []).motivo, "cep_invalido")
    assertEquals(falhaPorStatus("Frenet", 422, "outro", []).motivo, "indisponivel")
    // o texto cita cep_destino, mas o status não é 422
    assertEquals(falhaPorStatus("Frenet", 400, "cep_destino", []).motivo, "indisponivel")
    assertEquals(falhaPorStatus("Frenet", 500, "boom", []).motivo, "indisponivel")
    assertEquals(falhaPorStatus("Frenet", 429, "boom", []).motivo, "indisponivel")
    assertEquals(falhaPorStatus("Frenet", 400, "boom", []).motivo, "indisponivel")
    assertEquals(falhaPorStatus("Frenet", 404, "boom", []).motivo, "indisponivel")
    // segredo conhecido e Bearer somem da mensagem; o corpo longo NÃO é cortado
    const redigida = falhaPorStatus("Frenet", 500, "falha com tok-secreto-1 e Bearer abc.def", ["tok-secreto-1"])
    assertEquals(redigida.message, "Frenet API retornou 500: falha com [redacted] e Bearer [redacted]")
    assertEquals(falhaPorStatus("Frenet", 500, "a".repeat(5000), []).message.length, "Frenet API retornou 500: ".length + 5000)
})

// ── nome do serviço × chave da tela ─────────────────────────────────────

Deno.test("servicoCasaChave - PAC só por palavra inteira; Jadlog por jadlog/package/centralizado/.com; SEDEX por inclusão; chave desconhecida por inclusão", () => {
    assertEquals(servicoCasaChave("PAC", "pac"), true)
    assertEquals(servicoCasaChave("Correios PAC", "pac"), true)
    assertEquals(servicoCasaChave("PAC Mini", "pac"), true)
    assertEquals(servicoCasaChave(".Package", "pac"), false)
    assertEquals(servicoCasaChave("pacote", "pac"), false)
    assertEquals(servicoCasaChave("SEDEX", "pac"), false)
    assertEquals(servicoCasaChave(".Package", "jadlog"), true)
    assertEquals(servicoCasaChave("Jadlog Express", "jadlog"), true)
    assertEquals(servicoCasaChave(".Com", "jadlog"), true)
    assertEquals(servicoCasaChave("Centralizado", "jadlog"), true)
    assertEquals(servicoCasaChave("SEDEX", "jadlog"), false)
    assertEquals(servicoCasaChave("PAC", "jadlog"), false)
    assertEquals(servicoCasaChave("SEDEX", "sedex"), true)
    assertEquals(servicoCasaChave("SEDEX 10", "sedex"), true)
    assertEquals(servicoCasaChave("PAC", "sedex"), false)
    assertEquals(servicoCasaChave("Loggi Express", "loggi"), true)
    assertEquals(servicoCasaChave("Loggi Express", "azul"), false)
    // chave com caixa e espaço vale como a normalizada; nome ausente nunca casa chave conhecida
    assertEquals(servicoCasaChave("PAC", "  PAC "), true)
    assertEquals(servicoCasaChave("SEDEX", " SEDEX"), true)
    assertEquals(servicoCasaChave(".PACKAGE", "JADLOG"), true)
    assertEquals(servicoCasaChave(null, "pac"), false)
    assertEquals(servicoCasaChave(undefined, "sedex"), false)
    assertEquals(servicoCasaChave("", "jadlog"), false)
})

// ── token, seguro, sandbox ────────────────────────────────────────────

Deno.test("tokenDe - texto aparado; vazio, só espaço, número, nulo e credencial ausente dão null", () => {
    assertEquals(tokenDe({ token: " abc123 " }), "abc123")
    assertEquals(tokenDe({ token: "\nabc123\t" }), "abc123")
    assertEquals(tokenDe({ token: "a" }), "a")
    for (const ruim of [{ token: "" }, { token: "   " }, { token: 123 }, { token: null }, { token: undefined }, { token: ["abc"] }, {}, null, undefined, "abc"]) {
        assertEquals(tokenDe(ruim), null, JSON.stringify(ruim))
    }
})

Deno.test("seguroDoMe - 'sem_seguro' só quando gravado EXATO; todo o resto é o padrão (valor dos produtos)", () => {
    assertEquals(seguroDoMe({ seguro: "sem_seguro" }), "sem_seguro")
    for (const outro of ["valor_dos_produtos", "Sem_Seguro", "sem seguro", " sem_seguro", "true", true, 1, "", null, undefined]) {
        assertEquals(seguroDoMe({ seguro: outro }), "valor_dos_produtos", String(outro))
    }
    assertEquals(seguroDoMe({}), "valor_dos_produtos")
    assertEquals(seguroDoMe(null), "valor_dos_produtos")
    assertEquals(seguroDoMe(undefined), "valor_dos_produtos")
})

Deno.test("baseDaSuperFrete - só sandbox === true EXATO vai para o sandbox", () => {
    assertEquals(baseDaSuperFrete(true), "https://sandbox.superfrete.com")
    assertEquals(urlDaCotacaoSuperFrete(true), "https://sandbox.superfrete.com/api/v0/calculator")
    for (const outro of ["true", 1, "sandbox", false, null, undefined, {}]) {
        assertEquals(baseDaSuperFrete(outro), "https://api.superfrete.com", String(outro))
    }
    assertEquals(urlDaCotacaoSuperFrete(false), "https://api.superfrete.com/api/v0/calculator")
})

// ── e-mail de contato (vai num cabeçalho HTTP) ────────────────────────────

Deno.test("emailDeContatoValido - endereço completo em ASCII, aparado; um só '@'; domínio com 2+ rótulos e TLD só de letras (2+)", () => {
    assertEquals(emailDeContatoValido("voce@fixture.invalid"), "voce@fixture.invalid")
    assertEquals(emailDeContatoValido("  voce@fixture.invalid \n"), "voce@fixture.invalid")
    assertEquals(emailDeContatoValido("a@b.co"), "a@b.co")
    assertEquals(emailDeContatoValido("a.b+c_d%e-f@x-y.fixture.invalid"), "a.b+c_d%e-f@x-y.fixture.invalid")
    assertEquals(emailDeContatoValido("A1@B2.COM"), "A1@B2.COM")
    for (const ruim of [
        "", "   ", "@fixture.invalid", "a@b", "a@bb", "a@localhost", "a@b.c", "a@b.c1", "a@b.1", "a@@b.com", "a@b@c.com", "a b@c.com", "a@b c.com",
        "á@b.com", "a@b.cõm", "a@bé.com", "a@b..com", "a@.com", "a@b.", "a@b.com.", "a,b@c.com", "a<b@c.com", "a;b@c.com", 'a"b@c.com',
        "a@b_c.com", "a@b!.com", "voce@fixture.invalid\r\nBcc: x@y.com", "voce@fixture.invalid\nX-Teste: 1", "voce@fixture.invalid\u0000",
    ]) {
        assertEquals(emailDeContatoValido(ruim), null, JSON.stringify(ruim))
    }
    for (const naoTexto of [123, null, undefined, {}, ["a@b.com"], true]) {
        assertEquals(emailDeContatoValido(naoTexto), null, String(naoTexto))
    }
})

Deno.test("emailDeContatoValido - limite de 254 caracteres (254 vale, 255 não)", () => {
    const de = (total: number) => `${"a".repeat(total - "@fixture.invalid".length)}@fixture.invalid`
    assertEquals(de(254).length, 254)
    assertEquals(emailDeContatoValido(de(254)), de(254))
    assertEquals(emailDeContatoValido(de(255)), null)
    assertEquals(emailDeContatoValido(de(253)), de(253))
})

Deno.test("User-Agent da SuperFrete e do Melhor Envio - com o e-mail da loja quando válido; sem ele, SF nega e ME cai no legado", () => {
    assertEquals(userAgentDaSuperFrete("voce@fixture.invalid"), "IKCOUS Marketplace 1.5.7 (voce@fixture.invalid)")
    assertEquals(userAgentDaSuperFrete("  voce@fixture.invalid "), "IKCOUS Marketplace 1.5.7 (voce@fixture.invalid)")
    assertEquals(userAgentDaSuperFrete("invalido"), null)
    assertEquals(userAgentDaSuperFrete(""), null)
    assertEquals(userAgentDaSuperFrete(undefined), null)
    assertEquals(userAgentDoMelhorEnvio({ contact_email: "voce@fixture.invalid" }), {
        userAgent: "IKCOUS-Marketplace-Integration (voce@fixture.invalid)",
        contato: "loja",
    })
    const legado = {
        userAgent: "IKCOUS-Marketplace-Integration (contato@ikcous.com.br)",
        contato: "legado",
    }
    for (const sem of [{ contact_email: "invalido" }, { contact_email: "  " }, { contact_email: null }, { contact_email: 5 }, {}, null, undefined]) {
        assertEquals(userAgentDoMelhorEnvio(sem), legado, JSON.stringify(sem))
    }
    // o e-mail da SuperFrete nunca é usado no ME
    assertEquals(userAgentDoMelhorEnvio({ email: "voce@fixture.invalid" }), legado)
    assertEquals(cabecalhosDaSuperFrete("tok", "UA/1"), {
        Authorization: "Bearer tok",
        "User-Agent": "UA/1",
        Accept: "application/json",
        "Content-Type": "application/json",
    })
})

// ── serviços salvos ───────────────────────────────────────────────────

Deno.test("codigoNoFormatoDoProvedor - ME e SuperFrete só aceitam dígitos; Frenet aceita qualquer código de texto válido", () => {
    assertEquals(codigoNoFormatoDoProvedor("melhor_envio", "12"), "12")
    assertEquals(codigoNoFormatoDoProvedor("melhor_envio", " 12 "), "12")
    assertEquals(codigoNoFormatoDoProvedor("superfrete", 17), "17")
    for (const ruim of ["1a", "a1", "1 2", "1.5", "-1", "", "  ", "1\n2", null, undefined, true, {}, Number.NaN, -1, 1.5]) {
        assertEquals(codigoNoFormatoDoProvedor("melhor_envio", ruim), null, String(ruim))
        assertEquals(codigoNoFormatoDoProvedor("superfrete", ruim), null, String(ruim))
    }
    assertEquals(codigoNoFormatoDoProvedor("frenet", "SEDEX_10-A"), "SEDEX_10-A")
    assertEquals(codigoNoFormatoDoProvedor("frenet", 7), "7")
    assertEquals(codigoNoFormatoDoProvedor("frenet", "a b"), "a b")
    assertEquals(codigoNoFormatoDoProvedor("frenet", ""), null)
    assertEquals(codigoNoFormatoDoProvedor("frenet", "a\nb"), null)
    assertEquals(codigoNoFormatoDoProvedor("frenet", null), null)
})

Deno.test("servicosSalvos - sem lista é null (legado); lista vazia continua lista; itens inválidos e repetidos saem; ME/SF em ordem NUMÉRICA, Frenet na ordem salva", () => {
    for (const sem of [null, undefined, {}, { servicos: null }, { servicos: undefined }, { servicos: "1,2" }, { servicos: 12 }, { servicos: { 0: "1" } }]) {
        assertEquals(servicosSalvos("melhor_envio", sem), null, JSON.stringify(sem))
    }
    assertEquals(servicosSalvos("melhor_envio", { servicos: [] }), [])
    assertEquals(servicosSalvos("melhor_envio", { servicos: ["x", " "] }), [])
    assertEquals(servicosSalvos("melhor_envio", { servicos: ["10", "2", 2, "x", "2", 1, "100", 9] }), ["1", "2", "9", "10", "100"])
    assertEquals(servicosSalvos("superfrete", { servicos: [17, "1", "2", 17] }), ["1", "2", "17"])
    assertEquals(servicosSalvos("frenet", { servicos: ["b", "a", "b", "x y", 3, "", null] }), ["b", "a", "x y", "3"])
    assertEquals(servicosSalvos("frenet", { servicos: ["10", "2"] }), ["10", "2"])
})

Deno.test("servicosSuperFrete - lista vazia pede todos; chaves viram ids únicos em ordem NUMÉRICA; chave desconhecida some; caixa e espaço não importam", () => {
    assertEquals(servicosSuperFrete([]), "1,2,3,17,31,33")
    assertEquals(servicosSuperFrete(["pac"]), "1,17")
    assertEquals(servicosSuperFrete(["sedex"]), "2")
    assertEquals(servicosSuperFrete(["jadlog"]), "3")
    assertEquals(servicosSuperFrete(["jadlog", "pac", "sedex"]), "1,2,3,17")
    assertEquals(servicosSuperFrete(["pac", "pac", "PAC", " Pac "]), "1,17")
    assertEquals(servicosSuperFrete(["loggi"]), "")
    assertEquals(servicosSuperFrete(["loggi", "sedex"]), "2")
    assertEquals(servicosSuperFrete(["", null]), "")
})

// ── preços mudados pela regra ───────────────────────────────────────────

Deno.test("precosMudadosPelaRegra - conta só serviço SEM erro, com os dois preços conhecidos e DIFERENTES", () => {
    const servico = (parcial: Record<string, unknown>) => ({ codigo: "1", preco: 10, preco_original: 12, prazo: 3, erro: false, pedido: true, ...parcial })
    assertEquals(precosMudadosPelaRegra([]), 0)
    assertEquals(precosMudadosPelaRegra([servico({})]), 1)
    assertEquals(precosMudadosPelaRegra([servico({ preco: 12 })]), 0)
    assertEquals(precosMudadosPelaRegra([servico({ erro: true })]), 0)
    assertEquals(precosMudadosPelaRegra([servico({ preco: null })]), 0)
    assertEquals(precosMudadosPelaRegra([servico({ preco_original: null })]), 0)
    assertEquals(precosMudadosPelaRegra([servico({ preco: 0, preco_original: 5 })]), 1)
    assertEquals(
        precosMudadosPelaRegra([servico({}), servico({ preco: 12 }), servico({ erro: true }), servico({ preco: 9, preco_original: 12 })]),
        2,
    )
})

// ── chamarComTempo: tempo padrão e nome da falha ─────────────────────────────

Deno.test("chamarComTempo - sem tempo informado espera 10 s; falha de rede e tempo esgotado têm mensagens distintas; o temporizador é limpo", async () => {
    assertEquals(TEMPO_LIMITE_DO_PROVEDOR_MS, 10000)
    const fetchOriginal = globalThis.fetch
    const setOriginal = globalThis.setTimeout
    const clearOriginal = globalThis.clearTimeout
    const pedidos: number[] = []
    const limpos: unknown[] = []
    ;(globalThis as any).setTimeout = (_fn: unknown, ms: number) => { pedidos.push(ms); return 99 }
    ;(globalThis as any).clearTimeout = (h: unknown) => { limpos.push(h) }
    try {
        globalThis.fetch = async () => new Response("corpo", { status: 201 })
        assertEquals(await chamarComTempo("https://fixture.invalid/", {}), { status: 201, ok: true, texto: "corpo" })
        assertEquals(pedidos, [10000])
        assertEquals(limpos, [99])
        globalThis.fetch = async () => new Response("ruim", { status: 500 })
        assertEquals(await chamarComTempo("https://fixture.invalid/", {}, 5), { status: 500, ok: false, texto: "ruim" })
        assertEquals(pedidos, [10000, 5])

        const erroDe = async (lanca: () => never) => {
            globalThis.fetch = async () => lanca()
            try {
                await chamarComTempo("https://fixture.invalid/", {}, 5)
            } catch (e) {
                return e
            }
            return null
        }
        const abortado = await erroDe(() => { throw Object.assign(new Error("cortou"), { name: "AbortError" }) })
        assert(abortado instanceof FalhaDoProvedor)
        assertEquals(abortado.motivo, "indisponivel")
        assertEquals(abortado.message, "tempo esgotado: cortou")
        const rede = await erroDe(() => { throw new Error("dns falhou") })
        assertEquals(rede.motivo, "indisponivel")
        assertEquals(rede.message, "falha de rede: dns falhou")
        // o temporizador foi limpo em todos os caminhos (2 chamadas com resposta + 2 com falha)
        assertEquals(limpos.length, 4)
    } finally {
        globalThis.fetch = fetchOriginal
        globalThis.setTimeout = setOriginal
        globalThis.clearTimeout = clearOriginal
    }
})
