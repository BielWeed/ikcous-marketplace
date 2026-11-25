// @ts-nocheck
// Caça por mutação (25/11/2026) no handler da `calculate-shipping`: bordas que
// passavam por TODOS os testes antigos. Dublês: os de `apoio-dos-testes.ts`
// (banco e transportadoras falsos, tokens fictícios), nenhuma rede.
//
//  1. Pré-voo OPTIONS: a cotação é PÚBLICA e roda no navegador; sem a resposta
//     "ok" com CORS ao pré-voo o checkout inteiro fica sem frete.
//  2. Gravação do cache que REJEITA SEM MOTIVO (`Promise.reject()` / `null`):
//     tem de virar falha de gravação (503 "tente calcular novamente"), nunca
//     "deu certo" — senão o preço sai na tela e a RPC do pedido recusa depois
//     ("cotação expirou") no último clique. Mensagem de erro vazia cai no texto
//     do próprio erro, não numa string vazia no histórico.
//  3. Endereço da loja (retirada): a leitura filtra por `id = 1` e um ERRO do
//     banco que traga uma linha junto NÃO oferece retirada (endereço de leitura
//     que falhou não vale).
//  4. Sem transportadora: o histórico é GRAVADO antes da resposta (é a única
//     janela que a lojista tem para saber o que consertar) e a resposta de lista
//     vazia leva a `revisaoConfig` como toda outra resposta.
import { assert, assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts"
import { bancoFalso, cotacao, rodar } from "./apoio-dos-testes.ts"
import { handler } from "./index.ts"

const CEP_LOCAL = "38500-120"
const ids = (corpo: any) => corpo.options.map((o: any) => o.id)

/** Troca o que `from(tabela)` devolve, deixando o resto do banco como está. */
function trocandoTabela(banco: ReturnType<typeof bancoFalso>, tabela: string, troca: (base: any) => any) {
    const original = banco.cliente.from
    banco.cliente.from = (nome: string) => {
        const base = original(nome)
        return nome === tabela ? troca(base) : base
    }
    return banco
}

function chamarDireto(banco: ReturnType<typeof bancoFalso>, req: Request) {
    return handler(req, { supabase: banco.cliente, verificarAdmin: () => Promise.resolve(false) })
}

// ── 1. Pré-voo ───────────────────────────────────────────────────────────────

Deno.test("pré-voo OPTIONS: 200 'ok' com CORS completo e SEM tocar o banco nem as transportadoras", async () => {
    const banco = bancoFalso()
    const resposta = await chamarDireto(banco, new Request("http://localhost/calculate-shipping", { method: "OPTIONS" }))
    assertEquals(resposta.status, 200)
    assertEquals(await resposta.text(), "ok")
    assertEquals(resposta.headers.get("Access-Control-Allow-Origin"), "*")
    const permitidos = (resposta.headers.get("Access-Control-Allow-Headers") ?? "").split(",").map((c) => c.trim().toLowerCase())
    for (const cabecalho of ["authorization", "x-client-info", "apikey", "content-type"]) {
        assert(permitidos.includes(cabecalho), `o pré-voo recusaria ${cabecalho}`)
    }
    assertEquals(banco.registro.eventos, [])
})

// ── 2. Gravação do cache que rejeita sem motivo ──────────────────────────────

for (const [rotulo, motivo, mensagem] of [
    ["rejeição sem valor (undefined)", undefined, "Falha ao gravar a cotação: Falha desconhecida ao gravar a cotação"],
    ["rejeição com null", null, "Falha ao gravar a cotação: Falha desconhecida ao gravar a cotação"],
    ["Error com mensagem vazia", new Error(""), "Falha ao gravar a cotação: Error"],
] as Array<[string, unknown, string]>) {
    Deno.test(`gravar o cache falha com ${rotulo}: 503 para a cliente e o histórico diz que a gravação falhou`, async () => {
        const banco = trocandoTabela(bancoFalso(), "shipping_quotes_cache", (base) => ({
            ...base,
            upsert: () => Promise.reject(motivo),
        }))
        const { resposta, corpo, registro } = await rodar(cotacao(), { banco })
        assertEquals(resposta.status, 503)
        assertEquals(corpo, { error: "Não foi possível registrar a cotação de frete. Tente calcular novamente." })
        const ultima = registro.logs.at(-1)
        assertEquals(ultima.status, "error")
        assertEquals(ultima.error_message, mensagem)
    })
}

// ── 3. Endereço da loja (retirada) ───────────────────────────────────────────

const CONFIG_COM_RETIRADA = {
    enabled_shipping_methods: ["sedex", "store-pickup"],
    local_delivery_enabled: true,
    local_delivery_days: 1,
}

function bancoComLeituraDoEndereco(resposta: unknown, filtros: Array<[string, unknown]>) {
    return trocandoTabela(bancoFalso({ config: CONFIG_COM_RETIRADA }), "store_config", (base) => ({
        ...base,
        select: (colunas?: string) => {
            if (!String(colunas ?? "").includes("store_address")) return base.select(colunas)
            const b: any = {
                eq: (coluna: string, valor: unknown) => {
                    filtros.push([coluna, valor])
                    return b
                },
                maybeSingle: () => Promise.resolve(resposta),
                single: () => Promise.resolve(resposta),
            }
            return b
        },
    }))
}

Deno.test("retirada: o endereço da loja é lido da linha id = 1 (e a retirada sai com esse endereço)", async () => {
    const filtros: Array<[string, unknown]> = []
    const banco = bancoComLeituraDoEndereco({ data: { store_address: "Rua Fictícia, 1" }, error: null }, filtros)
    const { resposta, corpo } = await rodar(cotacao({ cep: CEP_LOCAL, aceitaRetirada: true }), { banco })
    assertEquals(resposta.status, 200)
    assertEquals(ids(corpo), ["local-delivery", "store-pickup"])
    assertEquals(corpo.options[1].pickupAddress, "Rua Fictícia, 1")
    assertEquals(filtros, [["id", 1]])
})

Deno.test("retirada: erro do banco ao ler o endereço NÃO oferece retirada, mesmo que o erro traga uma linha junto", async () => {
    const banco = bancoComLeituraDoEndereco(
        { data: { store_address: "Rua Fictícia, 1" }, error: { message: "permissão negada", code: "42501" } },
        [],
    )
    const { resposta, corpo } = await rodar(cotacao({ cep: CEP_LOCAL, aceitaRetirada: true }), { banco })
    assertEquals(resposta.status, 200)
    assertEquals(ids(corpo), ["local-delivery"])
})

// ── 4. Sem transportadora ────────────────────────────────────────────────────

Deno.test("sem transportadora conectada: o histórico é gravado ANTES de a resposta sair (a lojista só descobre por ali)", async () => {
    let gravado = false
    const banco = trocandoTabela(bancoFalso({ credenciais: [] }), "shipping_calculation_logs", (base) => ({
        ...base,
        insert: (linha: unknown) =>
            new Promise((resolver) =>
                setTimeout(() => {
                    banco.registro.logs.push(linha)
                    gravado = true
                    resolver({ error: null })
                }, 30)
            ),
    }))
    const resposta = await chamarDireto(banco, new Request("http://localhost/calculate-shipping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cotacao()),
    }))
    assertEquals(gravado, true, "a resposta saiu antes de o histórico ser gravado")
    assertEquals(resposta.status, 200)
    const corpo = await resposta.json()
    assertEquals(corpo.options, [])
    assertEquals(banco.registro.logs.length, 1)
    assertEquals(banco.registro.logs[0].status, "error")
    assert(String(banco.registro.logs[0].error_message).includes('Sem credencial cadastrada para o provedor "superfrete"'))
})

Deno.test("sem transportadora conectada: a lista vazia leva a mesma revisaoConfig que as outras respostas da loja", async () => {
    const vazia = await rodar(cotacao(), { banco: bancoFalso({ credenciais: [] }) })
    assertEquals(vazia.resposta.status, 200)
    assertEquals(vazia.corpo.options, [])
    assertEquals(vazia.corpo.cotacaoIncompleta, false)
    assertEquals(typeof vazia.corpo.revisaoConfig, "string")
    assert(vazia.corpo.revisaoConfig.length > 0)
    const local = await rodar(cotacao({ cep: CEP_LOCAL }), { banco: bancoFalso({ credenciais: [] }) })
    assertEquals(local.corpo.revisaoConfig, vazia.corpo.revisaoConfig)
})

// ── 5. A checagem de admin recebe o cabeçalho da requisição ──────────────────

Deno.test("ação do painel: a checagem de admin recebe EXATAMENTE o cabeçalho Authorization da requisição (sem ele, ninguém seria admin)", async () => {
    const recebidos: Array<string | null> = []
    const banco = bancoFalso()
    const pedir = (cabecalhos: Record<string, string>) =>
        handler(
            new Request("http://localhost/calculate-shipping", {
                method: "POST",
                headers: { "Content-Type": "application/json", ...cabecalhos },
                body: JSON.stringify({ action: "ler_configuracao_frete" }),
            }),
            {
                supabase: banco.cliente,
                verificarAdmin: (cabecalho: string | null) => {
                    recebidos.push(cabecalho)
                    return Promise.resolve(false)
                },
            },
        )
    const comSessao = await pedir({ Authorization: "Bearer sessao-da-lojista" })
    assertEquals(comSessao.status, 403, "quem não é admin recebe a recusa")
    const semSessao = await pedir({})
    assertEquals(semSessao.status, 403)
    assertEquals(recebidos, ["Bearer sessao-da-lojista", null])
})
