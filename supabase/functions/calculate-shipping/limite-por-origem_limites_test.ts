// @ts-nocheck
/**
 * Caça por mutação (25/11/2026) em `limite-por-origem.ts` — o freio que impede
 * um visitante de gastar a cota do token da transportadora da lojista (dinheiro
 * e disponibilidade do frete). Depois de `limite_por_origem_test.ts`, ainda
 * sobreviviam defeitos de UMA linha, quase todos nas FRONTEIRAS:
 *
 *   * quais endereços contam como INTERNOS (pulados) e quais como públicos: as
 *     bordas de 172.16/12, 100.64/10, 192.168/16, 169.254/16, 224+/multicast e o
 *     "0.x.x.x" — errar um lado junta todo mundo num balde só (cliente de
 *     verdade barrada) ou deixa o visitante escolher o próprio balde;
 *   * IPv6: `::`, `::1`, fc00::/7, fe80::/10, ff00::/8, o bloco /64, o IPv4
 *     mapeado, os grupos (8 sem `::`, no máximo um `::`, tamanho de grupo);
 *   * o hash que vai ao banco é estável (o prefixo `frete-cota|` não pode
 *     mudar: zeraria os contadores no dia da publicação);
 *   * o veredito do contador: espera arredondada para cima, entre 1 s e a
 *     janela; só `permitido === true`/`false` EXATOS valem; qualquer outra
 *     forma de resposta segue a cotação (falha aberta) com o aviso certo e
 *     SEM o IP no log;
 *   * a mensagem à cliente: minuto no singular e no plural.
 *
 * Tudo puro; IPs de documentação (RFC 5737/3849); sem rede, sem banco.
 */
import { assert, assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts"
import {
    chaveDaOrigem,
    consumirCotaDaOrigem,
    COTACOES_POR_JANELA,
    JANELA_EM_SEGUNDOS,
    mensagemDoLimite,
    origemDaRequisicao,
    PRAZO_DO_CONTADOR_MS,
} from "./limite-por-origem.ts"

const PUBLICO = "203.0.113.7"
const OUTRO_PUBLICO = "198.51.100.23"
const xff = (valor: string) => new Headers({ "x-forwarded-for": valor })
const cf = (valor: string) => new Headers({ "cf-connecting-ip": valor })

/** Um endereço sozinho no x-forwarded-for: o texto da origem, ou `null` quando é interno/ilegível. */
const origemDe = (ip: string) => origemDaRequisicao(xff(ip))

// ── IPv4: o que é interno (pulado) e o que é público ────────────────────────────

Deno.test("origem IPv4 - cada faixa INTERNA é pulada, nos dois extremos (o balde não vira o do proxy)", () => {
    for (const interno of [
        "0.0.0.0", "0.1.2.3",
        "10.0.0.1", "10.255.255.255",
        "127.0.0.1", "127.255.255.254",
        "172.16.0.1", "172.20.1.1", "172.31.255.255",
        "192.168.0.1", "192.168.255.255",
        "169.254.0.1", "169.254.169.254",
        "100.64.0.1", "100.100.100.100", "100.127.255.255",
        "224.0.0.1", "239.255.255.250", "240.0.0.1", "255.255.255.255",
    ]) {
        assertEquals(origemDe(interno), null, interno)
        // e com um público à esquerda, vale o público: o interno do fim é só pulado
        assertEquals(origemDaRequisicao(xff(`${PUBLICO}, ${interno}`)), PUBLICO, interno)
    }
})

Deno.test("origem IPv4 - o vizinho PÚBLICO de cada faixa interna é aceito como origem (um byte fora da faixa)", () => {
    for (const publico of [
        "1.0.0.1", "9.255.255.255", "11.0.0.1",
        "126.255.255.255", "128.0.0.1",
        "172.15.255.255", "172.32.0.1",
        "192.167.255.255", "192.169.0.1", "192.0.2.1",
        "169.253.255.255", "169.255.0.1", "168.254.0.1",
        "100.63.255.255", "100.128.0.1", "101.64.0.1",
        "223.255.255.255", "8.8.8.255",
    ]) {
        assertEquals(origemDe(publico), publico, publico)
    }
})

Deno.test("origem IPv4 - octeto até 255 vale; 256, mais de 3 dígitos, partes a mais ou a menos e vazio são lixo (null)", () => {
    assertEquals(origemDe("8.8.8.255"), "8.8.8.255")
    assertEquals(origemDe("8.8.255.8"), "8.8.255.8")
    assertEquals(origemDe("08.8.8.8"), "8.8.8.8") // zero à esquerda sai
    for (const lixo of ["8.8.8.256", "8.8.8.1000", "8.8.8", "8.8.8.8.8", "8.8.8.", "8..8.8", "8.8.8.-1", "8.8.8.a", "oito"]) {
        assertEquals(origemDe(lixo), null, lixo)
    }
})

Deno.test("origem - lixo no MEIO do x-forwarded-for: vale o da direita se for público; lixo à direita nega tudo (não adivinha)", () => {
    assertEquals(origemDaRequisicao(xff(`${PUBLICO}, lixo, ${OUTRO_PUBLICO}`)), OUTRO_PUBLICO)
    assertEquals(origemDaRequisicao(xff(`${OUTRO_PUBLICO}, lixo`)), null)
    assertEquals(origemDaRequisicao(xff(`lixo, ${PUBLICO}`)), PUBLICO)
    assertEquals(origemDaRequisicao(xff(`${PUBLICO}, 10.0.0.1, lixo`)), null)
    assertEquals(origemDaRequisicao(xff(` ${PUBLICO} `)), PUBLICO)
})

Deno.test("origem - cabeçalho da Cloudflare interno ou ilegível cai para o x-forwarded-for; público vence", () => {
    assertEquals(origemDaRequisicao(new Headers({ "cf-connecting-ip": "10.0.0.1", "x-forwarded-for": PUBLICO })), PUBLICO)
    assertEquals(origemDaRequisicao(new Headers({ "cf-connecting-ip": "lixo", "x-forwarded-for": PUBLICO })), PUBLICO)
    assertEquals(origemDaRequisicao(new Headers({ "cf-connecting-ip": "::1", "x-forwarded-for": PUBLICO })), PUBLICO)
    assertEquals(origemDaRequisicao(new Headers({ "cf-connecting-ip": PUBLICO, "x-forwarded-for": OUTRO_PUBLICO })), PUBLICO)
    assertEquals(origemDaRequisicao(cf("10.0.0.1")), null)
    assertEquals(origemDaRequisicao(cf("")), null)
    assertEquals(origemDaRequisicao(xff("")), null)
})

// ── IPv6 ──────────────────────────────────────────────────────────────

Deno.test("origem IPv6 - não especificado, loopback, ULA (fc00::/7), link-local (fe80::/10) e multicast (ff00::/8) são internos", () => {
    for (const interno of [
        "::", "::1", "0:0:0:0:0:0:0:1", "0:0:0:0:0:0:0:0",
        "fc00::1", "fd12:3456::1", "fdff:ffff::1",
        "fe80::1", "fe80:0:0:0:1:2:3:4", "febf::1",
        "ff02::1", "ff00::1", "ffff::1",
    ]) {
        assertEquals(origemDe(interno), null, interno)
        assertEquals(origemDaRequisicao(xff(`${PUBLICO}, ${interno}`)), PUBLICO, interno)
    }
})

Deno.test("origem IPv6 - o vizinho público de cada faixa interna é aceito, e vale pelo bloco /64 (4 primeiros grupos, minúsculo, sem zeros à esquerda)", () => {
    for (const publico of ["fb00::1", "fe00::1", "fec0::1", "fe7f::1", "::2", "1::", "2001:db8::1"]) {
        assert(origemDe(publico) !== null, publico)
    }
    assertEquals(origemDe("2001:db8::1"), "2001:db8:0:0::/64")
    assertEquals(origemDe("2001:DB8:0:0:ffff:ffff:ffff:ffff"), "2001:db8:0:0::/64")
    assertEquals(origemDe("2001:0db8:0000:0000::1"), "2001:db8:0:0::/64")
    assertEquals(origemDe("2001:db8:1:2:3:4:5:6"), "2001:db8:1:2::/64")
    // o quarto grupo faz parte do bloco; o quinto não
    assertEquals(origemDe("2001:db8:1:2:aaaa::1"), origemDe("2001:db8:1:2:bbbb::9"))
    assert(origemDe("2001:db8:1:2::1") !== origemDe("2001:db8:1:3::1"))
    assert(origemDe("2001:db8:1:2::1") !== origemDe("2001:db8:9:2::1"))
})

Deno.test("origem IPv6 - IPv4 mapeado vale como o IPv4 (público aceito, interno pulado, em texto ou em hexa)", () => {
    assertEquals(origemDe("::ffff:203.0.113.7"), PUBLICO)
    assertEquals(origemDe("::FFFF:203.0.113.7"), PUBLICO)
    assertEquals(origemDe("::ffff:cb00:7107"), PUBLICO)
    assertEquals(origemDe("0:0:0:0:0:ffff:203.0.113.7"), PUBLICO)
    assertEquals(origemDe("::ffff:10.0.0.1"), null)
    assertEquals(origemDe("::ffff:127.0.0.1"), null)
    assertEquals(origemDe("::ffff:203.0.113.999"), null)
    // não é mapeado: o 6º grupo não é ffff, ou há grupo diferente de zero antes
    assertEquals(origemDe("::fffe:203.0.113.7"), "0:0:0:0::/64")
    assertEquals(origemDe("1::ffff:203.0.113.7"), "1:0:0:0::/64")
    // cauda IPv4 em endereço comum vira dois grupos
    assertEquals(origemDe("2001:db8::203.0.113.7"), "2001:db8:0:0::/64")
})

Deno.test("origem IPv6 - forma inválida é lixo (null): grupos demais ou de menos, mais de um '::', grupo grande ou não hexa, zona", () => {
    for (const lixo of [
        "2001:db8:1:2:3:4:5", // 7 grupos sem ::
        "2001:db8:1:2:3:4:5:6:7", // 9 grupos
        "1:2:3:4:5:6:7:8::", // 8 grupos e ainda ::
        "1::2::3", "::1::", ":::",
        "12345::1", "2001:db8g::1", "2001:db8:::1", ":2001:db8::1",
        "fe80::1%eth0",
        "2001:db8::" + "1:".repeat(30),
    ]) {
        assertEquals(origemDe(lixo), null, lixo)
    }
    // controle: os limites que ainda valem
    assert(origemDe("1:2:3:4:5:6:7::") !== null)
    assert(origemDe("::2:3:4:5:6:7:8") !== null)
    assert(origemDe("1:2:3:4:5:6:7:8") !== null)
})

// ── A chave que vai ao banco ────────────────────────────────────────────────

Deno.test("chaveDaOrigem - o hash é o do prefixo 'frete-cota|' (SHA-256, 32 primeiros hexa): mudar o prefixo zeraria os contadores", async () => {
    assertEquals(await chaveDaOrigem(PUBLICO), "f9c936414f0151fc7e201e56dbed0c1d")
    assertEquals(await chaveDaOrigem("2001:db8:0:0::/64"), "24ad25fc85f27e56643c667bd3461fec")
})

// ── O contador ────────────────────────────────────────────────────────

const CABECALHOS = cf(PUBLICO)

/** Roda `consumirCotaDaOrigem` com `console.warn` capturado. */
async function consumir(supabase: unknown, cabecalhos: Headers = CABECALHOS, opcoes = {}) {
    const avisos: string[] = []
    const original = console.warn
    console.warn = (...args: unknown[]) => { avisos.push(args.map(String).join(" ")) }
    try {
        const veredito = await consumirCotaDaOrigem(supabase, cabecalhos, opcoes)
        return { veredito, avisos }
    } finally {
        console.warn = original
    }
}
const rpcDevolve = (resposta: unknown) => ({ rpc: () => Promise.resolve(resposta) })

Deno.test("contador - manda ao banco a função, o hash da origem, o teto de 60 e a janela de 300 s (e o IP nunca)", async () => {
    assertEquals(COTACOES_POR_JANELA, 60)
    assertEquals(JANELA_EM_SEGUNDOS, 300)
    assertEquals(PRAZO_DO_CONTADOR_MS, 2000)
    const chamadas: unknown[][] = []
    const supabase = { rpc: (...args: unknown[]) => { chamadas.push(args); return Promise.resolve({ data: { permitido: true }, error: null }) } }
    const { veredito, avisos } = await consumir(supabase)
    assertEquals(veredito, { bloqueado: false })
    assertEquals(avisos, [])
    assertEquals(chamadas, [["frete_consumir_cota", {
        p_origem: "f9c936414f0151fc7e201e56dbed0c1d",
        p_limite: 60,
        p_janela_segundos: 300,
    }]])
    assertEquals(JSON.stringify(chamadas).includes(PUBLICO), false)
})

Deno.test("contador - 'permitido: false' bloqueia com a espera arredondada PARA CIMA, no mínimo 1 s e no máximo a janela", async () => {
    const espera = async (valor: unknown) =>
        (await consumir(rpcDevolve({ data: { permitido: false, espere_segundos: valor }, error: null }))).veredito
    assertEquals(await espera(90.2), { bloqueado: true, esperarSegundos: 91 })
    assertEquals(await espera(90), { bloqueado: true, esperarSegundos: 90 })
    assertEquals(await espera("45"), { bloqueado: true, esperarSegundos: 45 })
    assertEquals(await espera(0.2), { bloqueado: true, esperarSegundos: 1 })
    assertEquals(await espera(0), { bloqueado: true, esperarSegundos: 1 })
    assertEquals(await espera(-30), { bloqueado: true, esperarSegundos: 1 })
    assertEquals(await espera(1), { bloqueado: true, esperarSegundos: 1 })
    assertEquals(await espera(299), { bloqueado: true, esperarSegundos: 299 })
    assertEquals(await espera(300), { bloqueado: true, esperarSegundos: 300 })
    assertEquals(await espera(301), { bloqueado: true, esperarSegundos: 300 })
    assertEquals(await espera(99999), { bloqueado: true, esperarSegundos: 300 })
    // sem número legível: espera a janela inteira (obs.: `null` vira 0 em Number(), e 0 sai como 1 s)
    for (const ruim of [undefined, "abc", Number.NaN, Number.POSITIVE_INFINITY, {}]) {
        assertEquals(await espera(ruim), { bloqueado: true, esperarSegundos: 300 }, String(ruim))
    }
})

Deno.test("contador - só `permitido === true` ou `=== false` valem; qualquer outra forma segue a cotação com o aviso 'resposta_fora_do_contrato'", async () => {
    for (const resposta of [
        { data: null, error: null },
        { data: undefined, error: null },
        { data: {}, error: null },
        { data: [], error: null },
        { data: "permitido", error: null },
        { data: true, error: null },
        { data: { permitido: "true" }, error: null },
        { data: { permitido: 1 }, error: null },
        { data: { permitido: "false" }, error: null },
        { data: { permitido: 0 }, error: null },
        { data: { permitido: null }, error: null },
        null,
        undefined,
        "texto",
    ]) {
        const { veredito, avisos } = await consumir(rpcDevolve(resposta))
        assertEquals(veredito, { bloqueado: false }, JSON.stringify(resposta))
        assertEquals(avisos.length, 1, JSON.stringify(resposta))
        assertEquals(JSON.parse(avisos[0]), { evento: "contador_de_cotacoes_indisponivel", motivo: "resposta_fora_do_contrato" })
    }
})

Deno.test("contador - falha do banco, função ausente, origem desconhecida, prazo e exceção seguem a cotação, cada um com o seu aviso e sem o IP", async () => {
    const motivoDe = (avisos: string[]) => JSON.parse(avisos[0])
    // origem desconhecida: nem chama o banco
    let chamou = false
    const espiao = { rpc: () => { chamou = true; return Promise.resolve({ data: { permitido: false }, error: null }) } }
    const semOrigem = await consumir(espiao, new Headers())
    assertEquals(semOrigem.veredito, { bloqueado: false })
    assertEquals(motivoDe(semOrigem.avisos), { evento: "contador_de_cotacoes_indisponivel", motivo: "origem_desconhecida" })
    assertEquals(chamou, false)
    // sem rpc
    for (const supabase of [{}, null, undefined, { rpc: "x" }]) {
        const r = await consumir(supabase)
        assertEquals(r.veredito, { bloqueado: false })
        assertEquals(motivoDe(r.avisos).motivo, "sem_rpc")
    }
    // erro do banco, com SQLSTATE só quando é de 5 a 8 caracteres maiúsculos/dígitos
    for (const [codigo, esperado] of [
        ["42883", "42883"], ["P0001", "P0001"], ["ABCDEFGH", "ABCDEFGH"],
        ["4288", undefined], ["428831234", undefined], ["abcde", undefined], ["42 83", undefined], [undefined, undefined], [42883, undefined],
    ] as const) {
        const r = await consumir(rpcDevolve({ data: null, error: { code: codigo, message: "texto cru com 203.0.113.7" } }))
        assertEquals(r.veredito, { bloqueado: false })
        const aviso = motivoDe(r.avisos)
        assertEquals(aviso.motivo, "erro_do_banco")
        assertEquals(aviso.codigo, esperado)
        assertEquals(r.avisos[0].includes("texto cru"), false)
        assertEquals(r.avisos[0].includes(PUBLICO), false)
    }
    // exceção na chamada
    const quebra = await consumir({ rpc: () => { throw new Error("explodiu 203.0.113.7") } })
    assertEquals(quebra.veredito, { bloqueado: false })
    assertEquals(motivoDe(quebra.avisos).motivo, "excecao")
    assertEquals(quebra.avisos[0].includes("explodiu"), false)
    // promessa rejeitada
    const rejeita = await consumir({ rpc: () => Promise.reject(new Error("rede")) })
    assertEquals(motivoDe(rejeita.avisos).motivo, "excecao")
    // banco que trava: o prazo vence e a cotação segue
    const trava = await consumir({ rpc: () => new Promise(() => {}) }, CABECALHOS, { prazoMs: 15 })
    assertEquals(trava.veredito, { bloqueado: false })
    assertEquals(motivoDe(trava.avisos).motivo, "prazo")
})

Deno.test("contador - sem prazo informado espera 2 s; o temporizador é limpo quando o banco responde", async () => {
    const setOriginal = globalThis.setTimeout
    const clearOriginal = globalThis.clearTimeout
    const pedidos: number[] = []
    const limpos: unknown[] = []
    ;(globalThis as any).setTimeout = (_fn: unknown, ms: number) => { pedidos.push(ms); return 777 }
    ;(globalThis as any).clearTimeout = (h: unknown) => { limpos.push(h) }
    try {
        const r = await consumir(rpcDevolve({ data: { permitido: true }, error: null }))
        assertEquals(r.veredito, { bloqueado: false })
        assertEquals(pedidos, [2000])
        assertEquals(limpos, [777])
        await consumir(rpcDevolve({ data: { permitido: true }, error: null }), CABECALHOS, { prazoMs: 33 })
        assertEquals(pedidos, [2000, 33])
    } finally {
        globalThis.setTimeout = setOriginal
        globalThis.clearTimeout = clearOriginal
    }
})

// ── A mensagem à cliente ─────────────────────────────────────────────

Deno.test("mensagemDoLimite - minutos arredondados para cima, no mínimo 1, singular só no 1", () => {
    const msg = (minutos: string) => `Muitas consultas de frete em pouco tempo. Aguarde ${minutos} e tente de novo.`
    assertEquals(mensagemDoLimite(0), msg("1 minuto"))
    assertEquals(mensagemDoLimite(1), msg("1 minuto"))
    assertEquals(mensagemDoLimite(59), msg("1 minuto"))
    assertEquals(mensagemDoLimite(60), msg("1 minuto"))
    assertEquals(mensagemDoLimite(61), msg("2 minutos"))
    assertEquals(mensagemDoLimite(120), msg("2 minutos"))
    assertEquals(mensagemDoLimite(121), msg("3 minutos"))
    assertEquals(mensagemDoLimite(300), msg("5 minutos"))
})
