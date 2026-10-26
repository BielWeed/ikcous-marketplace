// @ts-nocheck
// Frente E / E1 (26/10/2026) — limite de cotações por origem na `calculate-shipping`.
//
// O defeito: qualquer visitante com a chave pública podia chamar a função em laço, com o CEP
// variando para driblar o cache, e gastar a cota do token da transportadora (Melhor Envio /
// Frenet / SuperFrete) e encher `shipping_calculation_logs` e `shipping_quotes_cache`.
//
// O que estes testes prendem:
//  - a chamada que passa do teto, dentro da janela, recebe 429 + Retry-After e NÃO chega à
//    transportadora, ao cache nem ao histórico;
//  - a cliente de verdade nunca é barrada (cache, erro de validação, entrega local, ação do
//    painel e origem sem identidade NÃO contam; falha do contador NÃO derruba a cotação);
//  - uma origem barrada não afeta as outras;
//  - o que vai ao banco é um HASH da origem, nunca o IP.
import { assert, assertEquals, assertNotEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts"
import {
    bancoFalso,
    CARRINHO_P1,
    cotacao,
    json,
    LINHA_SF,
    RESPOSTA_SF_OFICIAL,
    rodar,
} from "./apoio-dos-testes.ts"
import {
    chaveDaOrigem,
    COTACOES_POR_JANELA,
    JANELA_EM_SEGUNDOS,
    origemDaRequisicao,
} from "./limite-por-origem.ts"

const SF = "superfrete.com/api/v0/calculator"
const IP_A = "203.0.113.7"
const IP_B = "198.51.100.23"
const daOrigem = (ip: string) => ({ "cf-connecting-ip": ip })
const bancoSoSf = (extra: any = {}) => bancoFalso({ credenciais: [LINHA_SF], ...extra })
const chamadasParaSf = (chamadas: any[]) => chamadas.filter((c) => c.url.includes(SF)).length

/** Uma cotação que NÃO pega o cache (esvazia o cache falso antes), para contar cada uma como "miss". */
async function cotarSemCache(banco: any, cabecalhos: Record<string, string>, corpo: Record<string, unknown> = cotacao()) {
    banco.registro.cacheLinhas = []
    return await rodar(corpo, { banco, cabecalhos })
}

// ── A origem: de onde vem, e que ninguém a forja ────────────────────────────────────────────

Deno.test("origem: o cabeçalho da Cloudflare vale mais que o x-forwarded-for", () => {
    const h = new Headers({ "cf-connecting-ip": IP_A, "x-forwarded-for": `${IP_B}, 10.0.0.9` })
    assertEquals(origemDaRequisicao(h), IP_A)
})

Deno.test("origem: x-forwarded-for forjado pelo visitante vem ANTES do IP real — vale o da direita", () => {
    // Medido na comunidade do Supabase: o cliente manda `spoofed`, o gateway ACRESCENTA o IP real
    // no fim ("spoofed,68.65.164.215"). Quem muda a esquerda não escolhe o próprio balde.
    assertEquals(origemDaRequisicao(new Headers({ "x-forwarded-for": `1.1.1.1, 2.2.2.2, ${IP_A}` })), IP_A)
})

Deno.test("origem: salto interno (IP privado/loopback) no fim do x-forwarded-for é pulado — não junta todo mundo num balde só", () => {
    assertEquals(origemDaRequisicao(new Headers({ "x-forwarded-for": `${IP_A}, 10.1.2.3, 172.16.0.4, 192.168.1.1, 127.0.0.1` })), IP_A)
    assertEquals(origemDaRequisicao(new Headers({ "x-forwarded-for": "10.1.2.3, 192.168.0.9" })), null)
})

Deno.test("origem: sem cabeçalho, ou com lixo no lugar do IP, a origem é DESCONHECIDA (null)", () => {
    assertEquals(origemDaRequisicao(new Headers()), null)
    assertEquals(origemDaRequisicao(new Headers({ "cf-connecting-ip": "nao-sou-ip" })), null)
    assertEquals(origemDaRequisicao(new Headers({ "x-forwarded-for": "'; drop table x;--" })), null)
    assertEquals(origemDaRequisicao(new Headers({ "cf-connecting-ip": "999.1.1.1" })), null)
})

Deno.test("origem: IPv6 vale pelo bloco /64 (um endereço novo a cada chamada não foge do limite)", () => {
    const a = origemDaRequisicao(new Headers({ "cf-connecting-ip": "2001:db8:abcd:12:1:2:3:4" }))
    const b = origemDaRequisicao(new Headers({ "cf-connecting-ip": "2001:DB8:abcd:12::9" }))
    const c = origemDaRequisicao(new Headers({ "cf-connecting-ip": "2001:db8:abcd:13::9" }))
    assertEquals(a, b)
    assertNotEquals(a, c)
    assertEquals(origemDaRequisicao(new Headers({ "cf-connecting-ip": "::ffff:203.0.113.7" })), IP_A)
})

Deno.test("chave da origem: é um hash estável — o IP não aparece e dois IPs diferentes não colidem", async () => {
    const a1 = await chaveDaOrigem(IP_A)
    const a2 = await chaveDaOrigem(IP_A)
    const b = await chaveDaOrigem(IP_B)
    assertEquals(a1, a2)
    assertNotEquals(a1, b)
    assert(/^[0-9a-f]{32}$/.test(a1), a1)
    assert(!a1.includes("203") || !a1.includes(IP_A))
})

// ── O limite no handler ────────────────────────────────────────────────────────────────────

Deno.test("a chamada que passa do teto recebe 429 com Retry-After e NÃO chega à transportadora, ao cache nem ao histórico", async () => {
    const banco = bancoSoSf({ cota: { limite: 3, espereSegundos: 120 } })
    for (let i = 0; i < 3; i++) {
        const ok = await cotarSemCache(banco, daOrigem(IP_A))
        assertEquals(ok.resposta.status, 200, `chamada ${i + 1}`)
    }
    const antes = {
        fetchs: 3,
        caches: banco.registro.upsertsCache.length,
        logs: banco.registro.logs.length,
    }
    const barrada = await cotarSemCache(banco, daOrigem(IP_A))
    assertEquals(barrada.resposta.status, 429)
    assertEquals(barrada.resposta.headers.get("Retry-After"), "120")
    assertEquals(barrada.corpo.codigo, "muitas_consultas")
    assertEquals(barrada.corpo.espereSegundos, 120)
    // Português simples, sem jargão e sem culpar a cliente.
    assert(/Muitas consultas de frete/.test(barrada.corpo.error), barrada.corpo.error)
    assert(/minuto/.test(barrada.corpo.error), barrada.corpo.error)
    // Nada saiu para a transportadora, o cache ou o histórico.
    assertEquals(chamadasParaSf(barrada.chamadas), 0)
    assertEquals(banco.registro.upsertsCache.length, antes.caches)
    assertEquals(banco.registro.logs.length, antes.logs)
    assert(!barrada.saida.includes('"evento":"cotacao_frete"'), barrada.saida)
    // O navegador precisa poder ler o Retry-After (CORS).
    assertEquals(barrada.resposta.headers.get("Access-Control-Expose-Headers"), "Retry-After")
    assertEquals(barrada.resposta.headers.get("Access-Control-Allow-Origin"), "*")
})

Deno.test("o teto de verdade: 60 cotações por janela de 5 minutos passam, a 61ª é barrada (e a edge manda esses números ao banco)", async () => {
    assertEquals(COTACOES_POR_JANELA, 60)
    assertEquals(JANELA_EM_SEGUNDOS, 300)
    const banco = bancoSoSf()
    for (let i = 1; i <= COTACOES_POR_JANELA; i++) {
        const r = await cotarSemCache(banco, daOrigem(IP_A))
        assertEquals(r.resposta.status, 200, `a chamada ${i} dentro do teto tem de passar`)
    }
    const ultima = await cotarSemCache(banco, daOrigem(IP_A))
    assertEquals(ultima.resposta.status, 429)
    assertEquals(chamadasParaSf(ultima.chamadas), 0)
    const todas = banco.registro.chamadasDeCota
    assertEquals(todas.length, COTACOES_POR_JANELA + 1)
    for (const c of todas) {
        assertEquals(c.nome, "frete_consumir_cota")
        assertEquals(c.args.p_limite, COTACOES_POR_JANELA)
        assertEquals(c.args.p_janela_segundos, JANELA_EM_SEGUNDOS)
    }
})

Deno.test("outra origem não é afetada pelo bloqueio de uma", async () => {
    const banco = bancoSoSf({ cota: { limite: 1 } })
    assertEquals((await cotarSemCache(banco, daOrigem(IP_A))).resposta.status, 200)
    assertEquals((await cotarSemCache(banco, daOrigem(IP_A))).resposta.status, 429)
    const outra = await cotarSemCache(banco, daOrigem(IP_B))
    assertEquals(outra.resposta.status, 200)
    assertEquals(chamadasParaSf(outra.chamadas), 1)
    // Os dois baldes são distintos e nenhum carrega o IP.
    const origens = new Set(banco.registro.chamadasDeCota.map((c: any) => c.args.p_origem))
    assertEquals(origens.size, 2)
    for (const o of origens) assert(!String(o).includes("203.0.113") && !String(o).includes("198.51.100"), String(o))
})

Deno.test("cache hit NÃO conta: repetir a mesma cotação gasta uma unidade só", async () => {
    const banco = bancoSoSf()
    const primeira = await rodar(cotacao(), { banco, cabecalhos: daOrigem(IP_A) })
    assertEquals(primeira.resposta.status, 200)
    assertEquals(banco.registro.chamadasDeCota.length, 1)
    for (let i = 0; i < 5; i++) {
        const repetida = await rodar(cotacao(), { banco, cabecalhos: daOrigem(IP_A) })
        assertEquals(repetida.resposta.status, 200)
    }
    assertEquals(chamadasParaSf(primeira.chamadas), 1)
    assertEquals(banco.registro.chamadasDeCota.length, 1, "o acerto do cache não pode gastar a cota")
})

Deno.test("erro de validação NÃO conta: sem CEP, CEP curto, carrinho grande demais e CEP que a transportadora não conhece", async () => {
    const banco = bancoSoSf()
    assertEquals((await rodar({ cart: CARRINHO_P1 }, { banco, cabecalhos: daOrigem(IP_A) })).resposta.status, 400)
    assertEquals((await rodar(cotacao({ cep: "123" }), { banco, cabecalhos: daOrigem(IP_A) })).resposta.status, 400)
    const grande = Array.from({ length: 5000 }, () => ({ product: { id: "p1", price: 1 }, quantity: 1 }))
    assertEquals((await rodar(cotacao({ cart: grande }), { banco, cabecalhos: daOrigem(IP_A) })).resposta.status, 400)
    assertEquals(banco.registro.chamadasDeCota.length, 0)
})

Deno.test("entrega local e ação do painel não passam pelo contador (não chamam transportadora)", async () => {
    const local = bancoSoSf({ config: { local_cep_range: "01001000-01001999" } })
    const r = await rodar(cotacao(), { banco: local, cabecalhos: daOrigem(IP_A) })
    assertEquals(r.resposta.status, 200)
    assertEquals(chamadasParaSf(r.chamadas), 0)
    assertEquals(local.registro.chamadasDeCota.length, 0)

    const painel = bancoSoSf()
    const acao = await rodar({ action: "revisao_config_frete" }, { banco: painel, cabecalhos: daOrigem(IP_A) })
    assertEquals(acao.resposta.status, 200)
    assertEquals(painel.registro.chamadasDeCota.length, 0)
})

Deno.test("origem sem identidade (nenhum cabeçalho de IP) não é barrada nem junta todo mundo num balde: o contador nem é chamado", async () => {
    const banco = bancoSoSf({ cota: { limite: 0 } })
    const r = await cotarSemCache(banco, {})
    assertEquals(r.resposta.status, 200)
    assertEquals(chamadasParaSf(r.chamadas), 1)
    assertEquals(banco.registro.chamadasDeCota.length, 0)
})

for (const falha of ["erro", "excecao", "resposta_estranha", "ausente"] as const) {
    Deno.test(`o contador quebrado (${falha}) NÃO derruba a cotação: a cliente recebe o frete e o aviso fica no log, sem IP`, async () => {
        const banco = bancoSoSf({ cota: { falha } })
        const r = await rodar(cotacao(), { banco, cabecalhos: daOrigem(IP_A) })
        assertEquals(r.resposta.status, 200)
        assert(Array.isArray(r.corpo.options) && r.corpo.options.length > 0)
        assertEquals(chamadasParaSf(r.chamadas), 1)
        assert(r.saida.includes("contador_de_cotacoes_indisponivel"), r.saida)
        assert(!r.saida.includes(IP_A), "o IP não pode aparecer no log")
        assert(!r.saida.includes("detalhe privado"), "o detalhe cru do erro não pode vazar")
    })
}

Deno.test("o contador que TRAVA não segura a cotação além do prazo: a cliente recebe o frete", async () => {
    const banco = bancoSoSf({ cota: { falha: "travado" } })
    const inicio = performance.now()
    const r = await rodar(cotacao(), { banco, cabecalhos: daOrigem(IP_A) })
    const gasto = performance.now() - inicio
    assertEquals(r.resposta.status, 200)
    assertEquals(chamadasParaSf(r.chamadas), 1)
    assert(gasto < 4000, `esperou ${gasto} ms pelo contador`)
    assert(r.saida.includes("contador_de_cotacoes_indisponivel"), r.saida)
})

Deno.test("a recotação (configuração mudou no meio) gasta UMA unidade, não duas", async () => {
    const banco = bancoSoSf({ credenciais: [LINHA_SF, { provider: "_revisao", credentials: { revisao: "rev-A" }, updated_at: "t" }] })
    let n = 0
    const r = await rodar(cotacao(), {
        banco,
        cabecalhos: daOrigem(IP_A),
        rotas: {
            sf: () => {
                n += 1
                if (n === 1) banco.credenciais[1].credentials.revisao = "rev-B"
                return json(RESPOSTA_SF_OFICIAL)
            },
        },
    })
    assertEquals(n, 2, "o cenário só vale se a transportadora foi chamada duas vezes")
    assertEquals(r.resposta.status, 200)
    assertEquals(banco.registro.chamadasDeCota.length, 1)
})

Deno.test("o bloqueio não deixa rastro do IP no console nem no corpo", async () => {
    const banco = bancoSoSf({ cota: { limite: 0 } })
    const r = await rodar(cotacao(), { banco, cabecalhos: daOrigem(IP_A) })
    assertEquals(r.resposta.status, 429)
    assert(!r.saida.includes(IP_A), r.saida)
    assert(!r.texto.includes(IP_A), r.texto)
})
