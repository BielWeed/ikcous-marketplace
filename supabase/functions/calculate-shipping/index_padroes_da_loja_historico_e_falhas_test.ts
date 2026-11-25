// @ts-nocheck
// Caça por mutação (25/11/2026) no handler da `calculate-shipping`, segunda
// fornada: decisões do `cotarUmaVez` que passavam por TODOS os testes antigos.
// Dublês: os de `apoio-dos-testes.ts`; nenhuma rede, nenhum relógio.
//
//  - Padrões da loja quando a configuração vem vazia: cobertura vazia = nacional
//    (nunca "só local", que recusaria o Brasil inteiro), taxa de entrega local
//    ausente = R$ 10 e taxa 0 = entrega local GRÁTIS (a lojista que zera a taxa
//    não pode passar a cobrar R$ 10).
//  - O carrinho todo vai ao banco (`.in('id', ...)` com TODOS os produtos), e a
//    promoção de frete grátis tem o formato exato que o app e a RPC esperam.
//  - O histórico do painel (`shipping_calculation_logs`): provedores juntos na
//    ordem canônica, a falha de cada transportadora com o NOME dela quando há
//    mais de uma, todas as mensagens (não só a primeira).
//  - Só `sandbox: true` EXATO bloqueia a cotação (um texto "false" não).
//  - "CEP não encontrado" só quando NENHUMA transportadora respondeu e todas as
//    que falharam recusaram o CEP; uma que respondeu (ainda que sem opções)
//    impede a conclusão de que o CEP é o errado.
//  - Cobertura "só local" também zera a entrega local no preset "por produto";
//    só o texto "local" restringe a cobertura; erro na LEITURA do cache nunca
//    serve cotação guardada; o histórico guarda a cotação parcial e o tempo de
//    resposta; o log estruturado separa as opções de cada provedor e o erro de
//    gravação do histórico local vai para o log.
//
// MUTANTES EQUIVALENTES (anotados, não viram teste):
//  - `cotacaoIncompleta = opcoesQueDispensamOCache.length < opcoesDaResposta.length`
//    trocado por `true` ou por `<=`: as opções de transportadora (que NUNCA
//    dispensam o cache) sempre sobram na resposta, então a lista que dispensa o
//    cache é sempre estritamente menor que a lista toda.
//  - `dbProductsMap` indexado por `p.id` em vez de `idCanonico(p.id)`: o
//    Postgres devolve uuid sempre em minúsculas e com hífens, que já é a forma
//    canônica.
//  - `if (!releitura.ok || releitura.revisao !== revisaoLida.revisao)` sem o
//    `!releitura.ok`: leitura que falha não tem `revisao` (`undefined`), e a
//    revisão lida antes é sempre texto ou `null` — nunca `undefined`; a
//    comparação já dá "mudou".
import { assert, assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts"
import {
    bancoFalso,
    cotacao,
    json,
    linhasDoLog,
    LINHA_ME,
    LINHA_SF,
    linhaLigados,
    PRODUTO_P1,
    RESPOSTA_SF_OFICIAL,
    rodar,
    TOKEN_SF,
} from "./apoio-dos-testes.ts"

const CEP_LOCAL = "38500-120"
const ids = (corpo: any) => corpo.options.map((o: any) => o.id)
const multi = (ligados: string[], outras: Record<string, unknown> = {}) =>
    bancoFalso({ credenciais: [LINHA_ME, LINHA_SF, linhaLigados(ligados)], ...outras })

// ── Padrões da loja ──────────────────────────────────────────────────────────

for (const vazio of [null, undefined, ""]) {
    Deno.test(`loja com shipping_coverage ${JSON.stringify(vazio) ?? "ausente"}: vale a cobertura NACIONAL (cota fora da cidade, não recusa)`, async () => {
        const banco = bancoFalso({ config: { shipping_coverage: vazio } })
        const { resposta, corpo, chamadas } = await rodar(cotacao(), { banco })
        assertEquals(resposta.status, 200)
        assertEquals(chamadas.length, 1, "a transportadora foi consultada")
        assert(ids(corpo).every((id: string) => id.startsWith("superfrete-")), JSON.stringify(ids(corpo)))
    })
}

Deno.test("taxa da entrega local: sem valor na loja vale R$ 10; zero é GRÁTIS (não vira R$ 10); valor da loja vale", async () => {
    const preco = async (taxa: unknown) => {
        const banco = bancoFalso({ config: { local_delivery_fee: taxa } })
        const { corpo } = await rodar(cotacao({ cep: CEP_LOCAL }), { banco })
        assertEquals(ids(corpo), ["local-delivery"])
        return corpo.options[0].price
    }
    assertEquals(await preco(null), 10)
    assertEquals(await preco(undefined), 10)
    assertEquals(await preco(0), 0)
    assertEquals(await preco(7.5), 7.5)
})

// ── O carrinho inteiro vai ao banco; a promoção de frete grátis ──────────────

Deno.test("o banco recebe TODOS os produtos do carrinho (não só o primeiro) e as variações pedidas", async () => {
    const banco = bancoFalso({ produtos: [PRODUTO_P1, { ...PRODUTO_P1, id: "p2" }, { ...PRODUTO_P1, id: "p3" }] })
    const carrinho = [
        { product: { id: "p1" }, quantity: 1 },
        { product: { id: "P2" }, quantity: 2 },
        { productId: "p3", quantity: 1, variantId: "V9" },
    ]
    await rodar(cotacao({ cart: carrinho }), { banco })
    const pedidos = banco.registro.filtrosIn
    assertEquals(pedidos.find((f) => f.tabela === "produtos")?.valores, ["p1", "p2", "p3"])
    assertEquals(pedidos.find((f) => f.tabela === "product_variants")?.valores, ["v9"])
})

Deno.test("frete grátis por produto: a opção tem o formato exato (id, nome, preço 0, prazo 3 dias, provedor free) e nenhuma transportadora é chamada", async () => {
    const banco = bancoFalso({
        config: { free_shipping_min: -1 },
        produtos: [{ ...PRODUTO_P1, frete_gratis: true }],
    })
    const { resposta, corpo, chamadas } = await rodar(cotacao(), { banco })
    assertEquals(resposta.status, 200)
    assertEquals(chamadas.length, 0)
    assertEquals(corpo.options, [
        { id: "free-shipping-promo", name: "Frete Grátis (Promoção)", price: 0, deliveryDays: 3, provider: "free" },
    ])
    assertEquals(corpo.cotacaoIncompleta, false)
})

// ── Histórico do painel ──────────────────────────────────────────────────────

Deno.test("sem chave de acesso em nenhuma transportadora ligada: o histórico lista TODAS, na ordem canônica (superfrete antes de melhor_envio)", async () => {
    const banco = bancoFalso({
        credenciais: [
            { provider: "melhor_envio", credentials: {}, updated_at: "t" },
            { provider: "superfrete", credentials: {}, updated_at: "t" },
            linhaLigados(["superfrete", "melhor_envio"]),
        ],
    })
    const { resposta, corpo, registro } = await rodar(cotacao(), { banco })
    assertEquals(resposta.status, 200)
    assertEquals(corpo.options, [])
    assertEquals(registro.logs.length, 1)
    assertEquals(registro.logs[0].provider, "superfrete, melhor_envio")
    assertEquals(registro.logs[0].status, "error")
    assert(String(registro.logs[0].error_message).includes("sem chave de acesso"))
})

Deno.test("cotação bem-sucedida com dois provedores: o histórico diz os DOIS (superfrete, melhor_envio)", async () => {
    const { resposta, registro } = await rodar(cotacao(), { banco: multi(["superfrete", "melhor_envio"]) })
    assertEquals(resposta.status, 200)
    assertEquals(registro.logs.at(-1).provider, "superfrete, melhor_envio")
    assertEquals(registro.logs.at(-1).status, "success")
})

Deno.test("dois provedores falham: o histórico leva a mensagem de CADA um, com o nome dele; com um só provedor não há prefixo", async () => {
    const rotas = {
        me: () => new Response("falha do ME", { status: 500 }),
        sf: () => new Response("falha da SF", { status: 500 }),
    }
    const dois = await rodar(cotacao(), { banco: multi(["melhor_envio", "superfrete"]), rotas })
    assertEquals(dois.resposta.status, 503)
    const mensagem = String(dois.registro.logs.at(-1).error_message)
    const partes = mensagem.split(" | ")
    assertEquals(partes.length, 2, mensagem)
    assert(partes[0].startsWith("superfrete: "), mensagem)
    assert(partes[1].startsWith("melhor_envio: "), mensagem)

    const um = await rodar(cotacao(), { banco: multi(["superfrete"]), rotas })
    assertEquals(um.resposta.status, 503)
    const unica = String(um.registro.logs.at(-1).error_message)
    assertEquals(unica.includes(" | "), false, unica)
    assertEquals(unica.startsWith("superfrete: "), false, unica)
})

for (
    const [forma, rota] of [
        ["a transportadora responde um erro HTTP que repete o token", () => json({ message: `acesso negado para ${TOKEN_SF}` }, 500)],
        [
            "a conexão cai com uma mensagem que repete o token (falha de rede)",
            () => {
                throw new Error(`conexão recusada em https://api.exemplo.test/?token=${TOKEN_SF}`)
            },
        ],
    ] as Array<[string, () => Response]>
) {
    Deno.test(`token da loja repetido na mensagem de erro (${forma}): o histórico e o log guardam '[redacted]', nunca o token`, async () => {
        const banco = multi(["superfrete"])
        const { registro, saida } = await rodar(cotacao(), { banco, rotas: { sf: rota } })
        const mensagem = String(registro.logs.at(-1).error_message)
        for (const texto of [mensagem, saida]) {
            assertEquals(texto.includes(TOKEN_SF), false, texto)
        }
        assert(mensagem.includes("[redacted]"), mensagem)
    })
}

// ── Sandbox só com `true` EXATO ──────────────────────────────────────────────

Deno.test("modo multi: credencial com sandbox em TEXTO ('false', 'true') não é Sandbox — a cotação segue normal", async () => {
    for (const sandbox of ["false", "true", 1]) {
        const banco = bancoFalso({
            credenciais: [{ ...LINHA_SF, credentials: { ...LINHA_SF.credentials, sandbox } }, linhaLigados(["superfrete"])],
        })
        const { resposta, corpo, chamadas } = await rodar(cotacao(), { banco })
        assertEquals(resposta.status, 200, `sandbox=${JSON.stringify(sandbox)}`)
        assertEquals(chamadas.length, 1)
        assert(corpo.options.length > 0)
    }
})

// ── "CEP não encontrado" ─────────────────────────────────────────────────────

Deno.test("CEP não encontrado (400) só quando NINGUÉM respondeu: um provedor que respondeu sem opções vira o 503 genérico", async () => {
    const recusaOCep = () => new Response('{"error":"cep_destino inválido"}', { status: 422 })
    const so = await rodar(cotacao(), { banco: multi(["superfrete"]), rotas: { sf: recusaOCep } })
    assertEquals(so.resposta.status, 400)
    assertEquals(so.corpo.codigo, "cep_invalido")

    // ME respondeu, mas nenhum serviço serve (lista vazia); a SF recusou o CEP.
    const meVazio = () => json([])
    const misto = await rodar(cotacao(), { banco: multi(["melhor_envio", "superfrete"]), rotas: { me: meVazio, sf: recusaOCep } })
    assertEquals(misto.resposta.status, 503, JSON.stringify(misto.corpo))
    assertEquals(misto.corpo.codigo, undefined)
})

// ── Cobertura "só local" e frete grátis; valor desconhecido de cobertura ─────

Deno.test("cobertura só local + preset 'por produto' com item marcado: a entrega local sai GRÁTIS (R$ 0), não a taxa da loja", async () => {
    const banco = bancoFalso({
        config: { shipping_coverage: "local", free_shipping_min: -1, local_delivery_fee: 10 },
        produtos: [{ ...PRODUTO_P1, frete_gratis: true }],
    })
    const { resposta, corpo, chamadas } = await rodar(cotacao({ cep: CEP_LOCAL }), { banco })
    assertEquals(resposta.status, 200)
    assertEquals(chamadas.length, 0)
    assertEquals(ids(corpo), ["local-delivery"])
    assertEquals(corpo.options[0].price, 0)
})

Deno.test("cobertura: só o texto 'local' restringe a entregas locais; qualquer outro valor cota como nacional (comportamento atual, não decisão de produto)", async () => {
    const banco = bancoFalso({ config: { shipping_coverage: "regional" } })
    const { resposta, corpo, chamadas } = await rodar(cotacao(), { banco })
    assertEquals(resposta.status, 200)
    assertEquals(chamadas.length, 1)
    assert(corpo.options.length > 0)
})

// ── Cache: erro da leitura do cache nunca serve cotação guardada ─────────────

Deno.test("cache: se a LEITURA do cache vem com erro (mesmo trazendo uma linha), a cotação é refeita na transportadora", async () => {
    const banco = bancoFalso()
    await rodar(cotacao(), { banco }) // popula o cache
    const controle = await rodar(cotacao(), { banco })
    assertEquals(controle.chamadas.length, 0, "controle: sem erro o cache é servido")

    const original = banco.cliente.from
    banco.cliente.from = (tabela: string) => {
        const base = original(tabela)
        if (tabela !== "shipping_quotes_cache") return base
        return {
            ...base,
            select: () => {
                const b: any = {
                    eq: () => b,
                    gt: () => b,
                    order: () => b,
                    limit: () => b,
                    then: (ok: any, falha: any) =>
                        Promise.resolve({
                            data: banco.registro.cacheLinhas.map((l: any) => ({ options: structuredClone(l.options) })),
                            error: { message: "leitura parcial", code: "XX000" },
                        }).then(ok, falha),
                }
                return b
            },
        }
    }
    const comErro = await rodar(cotacao(), { banco })
    assertEquals(comErro.resposta.status, 200)
    assertEquals(comErro.chamadas.length, 1, "o erro na leitura do cache obriga a cotar de novo")
})

// ── Histórico: cotação parcial e tempo de resposta ───────────────────────────

Deno.test("cotação parcial (um provedor caiu, outro respondeu): 200, a resposta avisa e o histórico guarda 'Cotação parcial: <provedor>: <motivo>' com status success", async () => {
    const parcial = await rodar(cotacao(), {
        banco: multi(["melhor_envio", "superfrete"]),
        rotas: { me: () => new Response("falha do ME", { status: 500 }) },
    })
    assertEquals(parcial.resposta.status, 200)
    assertEquals(parcial.corpo.cotacaoParcial, true)
    const ultima = parcial.registro.logs.at(-1)
    assertEquals(ultima.status, "success")
    assert(String(ultima.error_message).startsWith("Cotação parcial: melhor_envio: "), String(ultima.error_message))

    const completa = await rodar(cotacao(), { banco: multi(["melhor_envio", "superfrete"]) })
    assertEquals(completa.corpo.cotacaoParcial, false)
    assertEquals(completa.registro.logs.at(-1).error_message, null)
})

Deno.test("o histórico guarda quanto a transportadora demorou (response_time_ms), na cotação que deu certo e na que falhou", async () => {
    const devagar = async (resposta: Response) => {
        await new Promise((r) => setTimeout(r, 40))
        return resposta
    }
    const ok = await rodar(cotacao(), { rotas: { sf: () => devagar(json(RESPOSTA_SF_OFICIAL)) } })
    assertEquals(ok.resposta.status, 200)
    assert(ok.registro.logs.at(-1).response_time_ms >= 30, `response_time_ms=${ok.registro.logs.at(-1).response_time_ms}`)

    const falha = await rodar(cotacao(), { rotas: { sf: () => devagar(new Response("x", { status: 500 })) } })
    assertEquals(falha.resposta.status, 503)
    assert(falha.registro.logs.at(-1).response_time_ms >= 30, `response_time_ms=${falha.registro.logs.at(-1).response_time_ms}`)
})

// ── Log da função ────────────────────────────────────────────────────────────

Deno.test("log estruturado: a linha de CADA provedor lista só as opções DELE (não as dos outros ligados)", async () => {
    const { corpo, saida } = await rodar(cotacao(), { banco: multi(["melhor_envio", "superfrete"]) })
    const linhas = linhasDoLog(saida)
    assertEquals(linhas.length, 2)
    for (const linha of linhas) {
        const esperado = corpo.options.filter((o: any) => o.provider === linha.provedor).map((o: any) => o.id)
        assert(esperado.length > 0, `o provedor ${linha.provedor} deveria ter opções`)
        assertEquals(linha.opcoes_finais.map((o: any) => o.id), esperado)
    }
})

for (const [forma, resultado] of [
    ["o banco devolve { error }", () => Promise.resolve({ error: { message: "violação simulada", code: "XX000" } })],
    ["a gravação rejeita", () => Promise.reject(new Error("conexão perdida"))],
] as Array<[string, () => Promise<unknown>]>) {
    Deno.test(`histórico da entrega local que não grava (${forma}): a cliente recebe a cotação e o erro vai para o log`, async () => {
        const banco = bancoFalso()
        const original = banco.cliente.from
        banco.cliente.from = (tabela: string) => {
            const base = original(tabela)
            return tabela === "shipping_calculation_logs" ? { ...base, insert: () => resultado() } : base
        }
        const { resposta, corpo, saida } = await rodar(cotacao({ cep: CEP_LOCAL }), { banco })
        assertEquals(resposta.status, 200)
        assertEquals(ids(corpo), ["local-delivery"])
        assert(saida.includes("Failed to log local quote:"), saida)
    })
}

Deno.test("erro ao gravar a cotação que repete o token da loja: o histórico (a tela do painel) guarda '[redacted]', nunca o token", async () => {
    const banco = bancoFalso()
    const original = banco.cliente.from
    banco.cliente.from = (tabela: string) => {
        const base = original(tabela)
        return tabela === "shipping_quotes_cache"
            ? { ...base, upsert: () => Promise.resolve({ error: { message: `violação ao gravar com ${TOKEN_SF}` } }) }
            : base
    }
    const { resposta, registro } = await rodar(cotacao(), { banco })
    assertEquals(resposta.status, 503)
    const mensagem = String(registro.logs.at(-1).error_message)
    assert(mensagem.startsWith("Falha ao gravar a cotação: violação ao gravar com [redacted]"), mensagem)
    assertEquals(mensagem.includes(TOKEN_SF), false)
    assertEquals(JSON.stringify(registro.logs).includes(TOKEN_SF), false)
})

// ── CEP com dígito demais; erro inesperado sem segredo no log; logs da revisão ──

Deno.test("CEP com mais de 8 dígitos é recusado (400 'CEP inválido'), como o de menos de 8; nenhuma transportadora é chamada", async () => {
    for (const cep of ["01001-0000", "010010001", "1234567"]) {
        const { resposta, corpo, chamadas } = await rodar(cotacao({ cep }), { banco: bancoFalso() })
        assertEquals(resposta.status, 400, cep)
        assertEquals(corpo, { error: "CEP inválido" }, cep)
        assertEquals(chamadas.length, 0)
    }
})

Deno.test("falha inesperada no topo: 500 com frase para a cliente, e o log do servidor sai redigido ('Bearer ...' nunca aparece)", async () => {
    const banco = bancoFalso()
    banco.cliente.from = () => {
        throw new Error("falha com Authorization: Bearer abc123segredo no meio")
    }
    const { resposta, corpo, saida } = await rodar(cotacao(), { banco })
    assertEquals(resposta.status, 500)
    assertEquals(corpo, { error: "Não foi possível calcular o frete agora. Tente novamente." })
    assertEquals(saida.includes("abc123segredo"), false, saida)
    assert(saida.includes("Top-level Edge Function Error:"), saida)
    assert(saida.includes("Bearer [redacted]"), saida)
})

Deno.test("cache: o log de acerto sai UMA linha por provedor ligado (não só a do primeiro)", async () => {
    const banco = multi(["melhor_envio", "superfrete"])
    await rodar(cotacao(), { banco })
    const segunda = await rodar(cotacao(), { banco })
    assertEquals(segunda.chamadas.length, 0, "controle: a segunda foi servida do cache")
    const linhas = linhasDoLog(segunda.saida)
    assertEquals(linhas.map((l: any) => [l.provedor, l.cache]).sort(), [["melhor_envio", "hit"], ["superfrete", "hit"]])
})

Deno.test("revisão mudou durante a cotação: o log diz 'recotar' na 1ª vez e 'recusar' na 2ª (é o que o painel de logs mostra)", async () => {
    const credenciais = () => [LINHA_SF, { provider: "_revisao", credentials: { revisao: "rev-A" }, updated_at: "t" }]
    const uma = bancoFalso({ credenciais: credenciais() })
    let chamadas = 0
    const recotou = await rodar(cotacao(), {
        banco: uma,
        rotas: {
            sf: () => {
                chamadas += 1
                if (chamadas === 1) uma.credenciais[1].credentials.revisao = "rev-B"
                return json(RESPOSTA_SF_OFICIAL)
            },
        },
    })
    assertEquals(recotou.resposta.status, 200)
    assert(recotou.saida.includes('"acao":"recotar"'), recotou.saida)
    assertEquals(recotou.saida.includes('"acao":"recusar"'), false)

    const duas = bancoFalso({ credenciais: credenciais() })
    let n = 0
    const recusou = await rodar(cotacao(), {
        banco: duas,
        rotas: {
            sf: () => {
                n += 1
                duas.credenciais[1].credentials.revisao = `rev-${n}`
                return json(RESPOSTA_SF_OFICIAL)
            },
        },
    })
    assertEquals(recusou.resposta.status, 503)
    assert(recusou.saida.includes('"acao":"recotar"'), recusou.saida)
    assert(recusou.saida.includes('"acao":"recusar"'), recusou.saida)
})
