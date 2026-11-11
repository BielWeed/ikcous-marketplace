// @ts-nocheck
// O CORTE DE TEMPO DE CADA TRANSPORTADORA (A2, 1.5.7): `chamarComTempo` aborta a chamada
// em 10 s, LEITURA DO CORPO INCLUÍDA. Sem ele, uma transportadora pendurada segura o
// `Promise.allSettled` da cotação e o frete de toda cliente fica girando.
//
// Por que um arquivo só para isto: os testes vizinhos fazem o `fetch` falso REJEITAR
// com AbortError já pronto (ou testam o `buscarComTempo`, hoje código morto), e o
// `rodar` de `apoio-dos-testes.ts` responde na hora e nunca escuta `init.signal`. Com
// isso, apagar o setTimeout, trocar o padrão de 10 s ou soltar o relógio antes de ler
// o corpo deixava tudo verde. AQUI o `fetch` falso RESPEITA o sinal: só termina quando
// o sinal aborta — se o corte sumir, o caso fica pendurado e o PRAZO DE SEGURANÇA do
// teste (que nunca depende do código de produção) o reprova em vez de travar a suíte.
//
// Dados fictícios; nada de rede, banco ou segredo.
import { assert, assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts"
import { bancoFalso, cotacao, LINHA_FRENET, LINHA_ME, LINHA_SF, linhaLigados, rodar } from "./apoio-dos-testes.ts"
import { chamarComTempo, FalhaDoProvedor, TEMPO_LIMITE_DO_PROVEDOR_MS } from "./provedores.ts"

const URL_FICTICIA = "https://transportadora.fixture.invalid/cotar"
/** Relógio de verdade, guardado ANTES de qualquer espião: os auxiliares do teste usam este. */
const setTimeoutReal = globalThis.setTimeout.bind(globalThis)
const clearTimeoutReal = globalThis.clearTimeout.bind(globalThis)
/** Folga de segurança do TESTE (não do produto): corte que sumiu = caso reprovado, nunca suíte travada. */
const PRAZO_DE_SEGURANCA_MS = 3000

const PENDURADO = Symbol("pendurado")

/** Espera `promessa` até `ms`; se não terminar, devolve PENDURADO (e não deixa timer para trás). */
async function comPrazo<T>(promessa: Promise<T>, ms = PRAZO_DE_SEGURANCA_MS): Promise<T | typeof PENDURADO> {
    let id: ReturnType<typeof setTimeout> | undefined
    const prazo = new Promise<typeof PENDURADO>((resolve) => {
        id = setTimeoutReal(() => resolve(PENDURADO), ms)
    })
    try {
        return await Promise.race([promessa, prazo])
    } finally {
        clearTimeoutReal(id)
    }
}

/** Rejeita só quando o sinal aborta — como o `fetch` de verdade (motivo do abort = AbortError). */
const soTerminaNoAbort = (sinal: AbortSignal): Promise<never> =>
    new Promise((_, rejeita) => {
        if (sinal.aborted) return rejeita(sinal.reason)
        sinal.addEventListener("abort", () => rejeita(sinal.reason), { once: true })
    })

/** Corpo que nunca fecha e só ERRA quando o sinal aborta (o que o `fetch` real faz com o corpo em andamento). */
const corpoQueNuncaFecha = (sinal: AbortSignal): ReadableStream =>
    new ReadableStream({
        start(controle) {
            if (sinal.aborted) return controle.error(sinal.reason)
            sinal.addEventListener("abort", () => controle.error(sinal.reason), { once: true })
        },
    })

async function comFetch<T>(falso: (url: string, init: RequestInit) => Promise<Response>, fn: () => Promise<T>): Promise<T> {
    const original = globalThis.fetch
    globalThis.fetch = falso as any
    try {
        return await fn()
    } finally {
        globalThis.fetch = original
    }
}

/**
 * Espião do relógio: anota cada `setTimeout` pedido pelo código sob teste e cada
 * `clearTimeout`, e ENCURTA os prazos grandes (>= 5 s: os do provedor) para
 * `encurtarPara` ms, para a suíte não esperar 10 s de verdade. O valor PEDIDO
 * fica anotado — é ele que prova o padrão de 10 s.
 */
function espiarRelogio(encurtarPara = 30) {
    const pedidos: Array<{ id: unknown; ms: number }> = []
    const limpos = new Set<unknown>()
    const originalSet = globalThis.setTimeout
    const originalClear = globalThis.clearTimeout
    globalThis.setTimeout = ((fn: any, ms?: number, ...resto: any[]) => {
        const pedido = Number(ms ?? 0)
        const id = originalSet(fn, pedido >= 5000 ? encurtarPara : pedido, ...resto)
        if (pedido >= 5000) pedidos.push({ id, ms: pedido })
        return id
    }) as any
    globalThis.clearTimeout = ((id: any) => {
        limpos.add(id)
        return originalClear(id)
    }) as any
    return {
        pedidos,
        limpos,
        restaurar() {
            globalThis.setTimeout = originalSet
            globalThis.clearTimeout = originalClear
        },
    }
}

async function capturarFalha(promessa: Promise<unknown>): Promise<FalhaDoProvedor> {
    try {
        await promessa
    } catch (erro) {
        assert(erro instanceof FalhaDoProvedor, `esperava FalhaDoProvedor, veio ${String(erro)}`)
        return erro
    }
    throw new Error("era para falhar e NÃO falhou")
}

// ── (1) cabeçalho que nunca chega ───────────────────────────────────────────

Deno.test("tempo: transportadora que não responde (fetch só termina no abort) vira 'indisponivel' / 'tempo esgotado' em poucas centenas de ms", async () => {
    const inicio = performance.now()
    const resultado = await comFetch(
        (_url, init) => soTerminaNoAbort(init.signal as AbortSignal),
        () => comPrazo(capturarFalha(chamarComTempo(URL_FICTICIA, { method: "POST" }, 20))),
    )
    const gasto = performance.now() - inicio
    assert(resultado !== PENDURADO, "o corte de tempo não disparou: a chamada ficou pendurada")
    assertEquals(resultado.motivo, "indisponivel")
    assert(resultado.message.startsWith("tempo esgotado"), resultado.message)
    assert(gasto < 1000, `cortou, mas só depois de ${Math.round(gasto)} ms (tempo pedido: 20 ms)`)
})

// ── (2) cabeçalhos na hora, corpo que nunca fecha ───────────────────────────

Deno.test("tempo: cabeçalhos chegam na hora mas o CORPO nunca fecha — o corte pega a leitura do corpo (relógio não solta com os cabeçalhos)", async () => {
    const inicio = performance.now()
    const resultado = await comFetch(
        (_url, init) => Promise.resolve(new Response(corpoQueNuncaFecha(init.signal as AbortSignal), { status: 200 })),
        () => comPrazo(capturarFalha(chamarComTempo(URL_FICTICIA, { method: "POST" }, 20))),
    )
    const gasto = performance.now() - inicio
    assert(resultado !== PENDURADO, "o corte de tempo não alcançou a leitura do corpo: a chamada ficou pendurada")
    assertEquals(resultado.motivo, "indisponivel")
    assert(resultado.message.includes("o corpo da resposta não pôde ser lido"), resultado.message)
    // Não é a mensagem de falha ao obter os cabeçalhos: a resposta CHEGOU, o que travou foi o corpo.
    assert(!resultado.message.startsWith("tempo esgotado"), resultado.message)
    assert(gasto < 1000, `cortou, mas só depois de ${Math.round(gasto)} ms (tempo pedido: 20 ms)`)
})

// ── (3) controle: resposta rápida e completa; o relógio é limpo ─────────────

Deno.test("tempo (controle): resposta rápida e completa devolve status e corpo, e o relógio de 10 s é pedido e LIMPO", async () => {
    const relogio = espiarRelogio()
    try {
        const resposta = await comFetch(
            () => Promise.resolve(new Response('{"ok":true}', { status: 200 })),
            () => comPrazo(chamarComTempo(URL_FICTICIA, { method: "POST" })),
        )
        assert(resposta !== PENDURADO)
        assertEquals(resposta, { status: 200, ok: true, texto: '{"ok":true}' })
        // O padrão do parâmetro de tempo é o do contrato (A2): 10 s — o valor PEDIDO ao setTimeout.
        assertEquals(TEMPO_LIMITE_DO_PROVEDOR_MS, 10000)
        assertEquals(relogio.pedidos.map((p) => p.ms), [10000])
        // E o relógio foi solto no fim (nem sobra timer pendurado nem aborta uma chamada que já acabou).
        assert(relogio.limpos.has(relogio.pedidos[0].id), "o setTimeout da chamada não foi limpo (clearTimeout)")
    } finally {
        relogio.restaurar()
    }
})

// Os sanitizadores do Deno (ligados por padrão) NÃO enxergam timer de 60 s deixado para trás
// nesta versão (medido: o mutante "sem clearTimeout" passou por eles) — por isso a prova do
// relógio limpo é o ESPIÃO acima, e aqui o mesmo vale para o caminho de status não-2xx.
Deno.test("tempo (controle): status não-2xx devolve status e corpo para quem classifica, e o relógio também é limpo", async () => {
    const relogio = espiarRelogio()
    try {
        const resposta = await comFetch(
            () => Promise.resolve(new Response("corpo", { status: 503 })),
            () => comPrazo(chamarComTempo(URL_FICTICIA, { method: "GET" })),
        )
        assertEquals(resposta, { status: 503, ok: false, texto: "corpo" })
        assertEquals(relogio.pedidos.length, 1)
        assert(relogio.limpos.has(relogio.pedidos[0].id), "o relógio não foi limpo na resposta 503")
    } finally {
        relogio.restaurar()
    }
})

Deno.test("tempo (controle): falha de rede imediata é 'falha de rede' (não 'tempo esgotado') e o relógio também é limpo", async () => {
    const relogio = espiarRelogio()
    try {
        const falha = await comFetch(
            () => Promise.reject(new TypeError("conexão recusada")),
            () => comPrazo(capturarFalha(chamarComTempo(URL_FICTICIA, { method: "POST" }))),
        )
        assert(falha !== PENDURADO)
        assertEquals(falha.motivo, "indisponivel")
        assert(falha.message.startsWith("falha de rede"), falha.message)
        assert(!falha.message.includes("tempo esgotado"), falha.message)
        assertEquals(relogio.pedidos.length, 1)
        assert(relogio.limpos.has(relogio.pedidos[0].id), "o relógio não foi limpo no caminho de erro")
    } finally {
        relogio.restaurar()
    }
})

// ── (4) o handler: um provedor pendurado não segura o frete dos outros ──────

Deno.test("handler: com um provedor pendurado e dois ok, responde 200 com cotacaoParcial=true quando o corte de 10 s dispara (relógio encurtado só no teste)", async () => {
    const relogio = espiarRelogio()
    const fetchOriginal = globalThis.fetch
    const banco = bancoFalso({
        credenciais: [LINHA_ME, LINHA_SF, LINHA_FRENET, linhaLigados(["melhor_envio", "superfrete", "frenet"])],
    })
    let meChamado = 0
    const inicio = performance.now()
    try {
        const feito = await comPrazo(
            rodar(cotacao(), {
                banco,
                rotas: {
                    // O ME fica pendurado: só termina quando o SINAL da chamada aborta.
                    me: (c) => {
                        meChamado += 1
                        return soTerminaNoAbort(c.init.signal as AbortSignal) as any
                    },
                },
            }),
        )
        const gasto = performance.now() - inicio
        assert(feito !== PENDURADO, "a cotação inteira ficou presa no provedor pendurado (o corte de tempo não disparou)")
        assertEquals(meChamado, 1)
        assertEquals(feito.resposta.status, 200)
        assertEquals(feito.corpo.cotacaoParcial, true)
        const provedores = new Set(feito.corpo.options.map((o: any) => o.provider))
        assertEquals(provedores, new Set(["superfrete", "frenet"]))
        assert(feito.saida.includes("tempo esgotado"), "o log da falha não registra o tempo esgotado")
        assert(gasto < 2500, `respondeu, mas só depois de ${Math.round(gasto)} ms`)
        // Os três provedores foram chamados com o corte de 10 s (o valor PEDIDO, não o encurtado).
        assertEquals(relogio.pedidos.map((p) => p.ms), [10000, 10000, 10000])
        for (const pedido of relogio.pedidos) assert(relogio.limpos.has(pedido.id), "relógio de provedor sem clearTimeout")
    } finally {
        relogio.restaurar()
        globalThis.fetch = fetchOriginal
    }
})
