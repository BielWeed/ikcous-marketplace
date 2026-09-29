// @ts-nocheck
/**
 * AÇÕES DE ADMIN DA EDGE `calculate-shipping` (release 1.5.7) + a pública
 * `revisao_config_frete`. Contrato: §4, §7 (R1-2, R1-3, R1-8), §8 (R2-1,
 * R2-2), §9 (R3-1, R3-6).
 *
 * Regras que valem para TODAS:
 * - admin por `verifyIsAdmin` (costura `deps.verificarAdmin` nos testes),
 *   exceto `revisao_config_frete`;
 * - recusa de VALIDAÇÃO = 200 `{success:false, error}` (com 4xx o
 *   `supabase.functions.invoke` entrega `data: null` e a frase não chega à
 *   tela); falha de banco = 5xx sem texto cru;
 * - nenhuma devolve token; todo texto de terceiro passa por `textoSemSegredo`;
 * - `_ligados` e `_revisao` NUNCA são provedor (list/test/save recusam);
 * - toda escrita de configuração é UM upsert multi-linha com `_revisao`
 *   (uuid novo) — nunca dois pedidos (R3-1).
 */
import { jsonCanonico, temCaractereDeControle, textoSemSegredo } from './regua.ts'
import {
    baseDaSuperFrete,
    cabecalhosDaSuperFrete,
    chamarComTempo,
    codigoNoFormatoDoProvedor,
    cotarPeloProvedor,
    ehProvedor,
    emailDeContatoValido,
    emOrdemCanonica,
    FalhaDoProvedor,
    falhaPorStatus,
    MOTIVO_EMAIL_DE_CONTATO_INVALIDO,
    MOTIVO_SEM_EMAIL_MELHOR_ENVIO,
    MOTIVO_SEM_EMAIL_SUPERFRETE,
    PROVEDORES,
    ROTULO_DO_PROVEDOR,
    seguroDoMe,
    servicosSalvos,
    tokenDe,
    userAgentDaSuperFrete,
    userAgentDoMelhorEnvio,
} from './provedores.ts'
import {
    chavesDeTransportadora,
    COLUNAS_DA_LOJA,
    conjuntoLigado,
    LINHA_DA_REVISAO,
    LINHA_DOS_LIGADOS,
    lerCredenciais,
    metodosDaLoja,
    revisaoConfigDaLoja,
} from './configuracao.ts'

export type ContextoDaAcao = {
    body: any
    supabase: any
    ehAdmin: () => Promise<boolean>
    cabecalhos: Record<string, string>
}

const ACOES_DE_ADMIN = new Set([
    'ler_configuracao_frete',
    'list_services',
    'save_credentials',
    'test_credentials',
    'save_active_providers',
])

const MENSAGEM_DE_NAO_ADMIN = new Map([
    ['test_credentials', 'Não autorizado: Apenas administradores podem testar credenciais.'],
    ['save_credentials', 'Não autorizado: Apenas administradores podem salvar credenciais.'],
])

const rotulo = (provider: string) => ROTULO_DO_PROVEDOR.get(provider) ?? provider

/** CEP e pacote do teste de credencial (R1-8): 0,1 kg, 16×11×4, para 01015070. */
export const CEP_DO_TESTE = '01015070'
export const PACOTE_DO_TESTE = { peso: 0.1, C: 16, L: 11, A: 4, valor: 10 }

/** Catálogo mínimo documentado da SuperFrete, quando o GET de limites falha (R3-6). */
const CATALOGO_MINIMO_SUPERFRETE = [
    { codigo: '1', transportadora: 'Correios', servico: 'PAC' },
    { codigo: '2', transportadora: 'Correios', servico: 'SEDEX' },
    { codigo: '17', transportadora: 'Correios', servico: 'Mini Envios' },
]
const AVISO_DO_CATALOGO_SUPERFRETE =
    'Lista de serviços documentados pela SuperFrete. O teste confirma quais cotam na sua conta.'

/** Campos que cada provedor aceita no `save_credentials` (lista branca). */
const CAMPOS_PERMITIDOS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
    ['melhor_envio', new Set(['token', 'sandbox', 'contact_email', 'servicos', 'seguro'])],
    ['superfrete', new Set(['token', 'sandbox', 'contact_email', 'servicos'])],
    ['frenet', new Set(['token', 'servicos'])],
])

/** E-mail de contato DIGITADO com caractere de controle (vai para cabeçalho HTTP): recusa. */
function contatoComControle(valor: unknown): boolean {
    return typeof valor === 'string' && temCaractereDeControle(valor)
}

const SEGUROS = new Set(['valor_dos_produtos', 'sem_seguro'])
const MAX_SERVICOS = 50

function ehObjeto(valor: unknown): boolean {
    return !!valor && typeof valor === 'object' && !Array.isArray(valor)
}

/**
 * Valida a seleção de serviços recebida (contrato §4 + R1-5): lista de 1 a 50
 * textos, cada um aparado, não vazio, <= 100, sem caractere de controle, sem
 * repetição e no formato do provedor (ME e SF: id numérico; Frenet: texto
 * livre). Devolve a lista aparada ou a frase da recusa.
 */
export function validarServicos(provider: string, valor: unknown): { ok: true; servicos: string[] } | { ok: false; error: string } {
    if (!Array.isArray(valor)) return { ok: false, error: 'A lista de serviços é inválida.' }
    if (valor.length === 0) return { ok: false, error: 'Escolha pelo menos um serviço.' }
    if (valor.length > MAX_SERVICOS) return { ok: false, error: `Escolha no máximo ${MAX_SERVICOS} serviços.` }
    const vistos = new Set<string>()
    for (const item of valor) {
        if (typeof item !== 'string') return { ok: false, error: 'Código de serviço inválido.' }
        const codigo = codigoNoFormatoDoProvedor(provider, item)
        if (codigo === null) return { ok: false, error: 'Código de serviço inválido.' }
        if (vistos.has(codigo)) return { ok: false, error: 'Serviço repetido na lista.' }
        vistos.add(codigo)
    }
    return { ok: true, servicos: [...vistos] }
}

/** Apaga o cache de cotação do servidor (R2-2) — cache derivado, sem dado de cliente. */
async function apagarCacheDeCotacao(supabase: any): Promise<boolean> {
    try {
        const { error } = await supabase.from('shipping_quotes_cache').delete().not('id', 'is', null)
        if (error) {
            console.error('[calculate-shipping] limpeza do cache de cotação falhou:', error?.code ?? 'sem código')
            return false
        }
        return true
    } catch (erro) {
        console.error('[calculate-shipping] limpeza do cache de cotação falhou:', (erro as Error)?.name ?? 'erro')
        return false
    }
}

async function lerLoja(supabase: any): Promise<any | null> {
    try {
        const { data, error } = await supabase.from('store_config').select(COLUNAS_DA_LOJA).eq('id', 1).single()
        return error || !data ? null : data
    } catch {
        return null
    }
}

const linhaDaRevisaoNova = (agora: string) => ({
    provider: LINHA_DA_REVISAO,
    credentials: { revisao: crypto.randomUUID() },
    updated_at: agora,
})

// ── Teste de credencial: a MESMA cotação do checkout (R1-8) ─────────────────

export type ResultadoDoTeste = {
    success: boolean
    motivo?: 'chave_recusada' | 'indisponivel' | 'sem_servicos' | 'sem_cotacao_valida'
    detalhe?: string
    cotadas?: number
    servicosTestados?: Array<{ codigo: string; ok: boolean; preco?: number; prazo?: number; motivo?: string; detalhe?: string }>
    error?: string
    message?: string
}

/**
 * Cota o pacote de teste (0,1 kg, 16×11×4) da origem da loja para 01015070
 * pelo MESMO adaptador do checkout, com a seleção informada/salva (ou o filtro
 * legado). Sucesso = >= 1 serviço SELECIONADO com cotação válida. A
 * classificação é honesta: serviço com erro da transportadora é
 * `erro_do_servico` NAQUELE serviço, nunca chave recusada.
 */
export async function testarCredencial(provider: string, credenciais: any, selecao: string[] | null, config: any): Promise<ResultadoDoTeste> {
    const origem = String(config?.origin_cep ?? '').replace(/\D/g, '')
    if (!origem) return { success: false, error: 'A loja ainda não configurou o CEP de origem do frete.' }
    const token = tokenDe(credenciais)
    try {
        const resultado = await cotarPeloProvedor(provider, credenciais, {
            originCep: origem,
            destinationCep: CEP_DO_TESTE,
            itens: [{ produto: 'pacote-de-teste', variante: null, qtd: 1, ...PACOTE_DO_TESTE }],
            chaves: chavesDeTransportadora(metodosDaLoja(config)),
        }, selecao)
        const porCodigo = new Map(resultado.retornados.filter((r) => r.codigo !== null).map((r) => [r.codigo, r]))
        const codigos = selecao ?? resultado.retornados.filter((r) => r.pedido && r.codigo !== null).map((r) => r.codigo as string)
        const servicosTestados = [...new Set(codigos)].map((codigo) => {
            const r = porCodigo.get(codigo)
            if (!r) return { codigo, ok: false, motivo: 'nao_retornado' }
            if (r.erro) return { codigo, ok: false, motivo: 'erro_do_servico', detalhe: r.detalhe }
            if (r.preco === null || r.prazo === null) {
                return { codigo, ok: false, motivo: 'erro_do_servico', detalhe: 'A transportadora não devolveu preço e prazo válidos.' }
            }
            return { codigo, ok: true, preco: r.preco, prazo: r.prazo }
        })
        const cotadas = servicosTestados.filter((s) => s.ok).length
        if (cotadas > 0) {
            return {
                success: true,
                cotadas,
                servicosTestados,
                message: `${rotulo(provider)}: a chave funcionou — ${cotadas} serviço(s) cotaram o pacote de teste.`,
            }
        }
        const semServicos = resultado.retornados.length === 0
        return {
            success: false,
            motivo: semServicos ? 'sem_servicos' : 'sem_cotacao_valida',
            cotadas: 0,
            servicosTestados,
            error: semServicos
                ? `${rotulo(provider)} não devolveu nenhum serviço para o pacote de teste.`
                : 'A chave está certa; estes serviços não cotaram para o pacote de teste.',
        }
    } catch (erro) {
        const detalhe = textoSemSegredo((erro as Error)?.message ?? erro, [token])
        if (!(erro instanceof FalhaDoProvedor) || erro.motivo === 'configuracao') {
            return { success: false, error: detalhe }
        }
        if (erro.motivo === 'chave_recusada') {
            return {
                success: false,
                motivo: 'chave_recusada',
                detalhe,
                error: `${rotulo(provider)} recusou a chave. Confira se ela é do ambiente escolhido (produção ou Sandbox) — são chaves diferentes.`,
            }
        }
        return {
            success: false,
            motivo: 'indisponivel',
            detalhe,
            error: `${rotulo(provider)} não respondeu direito agora. Tente de novo em instantes.`,
        }
    }
}

// ── Roteador ────────────────────────────────────────────────────────────────

/** Responde a ação, ou `null` quando `action` não é uma destas (segue a cotação). */
export async function tratarAcao(action: unknown, ctx: ContextoDaAcao): Promise<Response | null> {
    const responder = (conteudo: Record<string, unknown>, status = 200) =>
        new Response(JSON.stringify(conteudo), { status, headers: { ...ctx.cabecalhos, 'Content-Type': 'application/json' } })

    if (action === 'revisao_config_frete') {
        // Pública (R1-2): só o hash, nenhum campo das credenciais, nenhuma transportadora.
        const revisaoConfig = await revisaoConfigDaLoja(ctx.supabase)
        return responder({ revisaoConfig }, revisaoConfig ? 200 : 503)
    }
    if (typeof action !== 'string' || !ACOES_DE_ADMIN.has(action)) return null

    if (!(await ctx.ehAdmin())) {
        return responder({
            success: false,
            error: MENSAGEM_DE_NAO_ADMIN.get(action) ?? 'Não autorizado: Apenas administradores podem configurar o frete.',
        }, 403)
    }

    const body = ctx.body ?? {}
    if (action === 'save_active_providers') return await salvarLigados(body, ctx.supabase, responder)
    if (action === 'ler_configuracao_frete') return await lerConfiguracao(ctx.supabase, responder)

    if (!ehProvedor(body.provider)) {
        return responder({ success: false, error: `Provedor de frete desconhecido: ${textoSemSegredo(body.provider, [], 40)}` })
    }
    if (action === 'list_services') return await listarServicos(body, ctx.supabase, responder)
    if (action === 'test_credentials') return await testarPelaTela(body, ctx.supabase, responder)
    return await salvarCredenciais(body, ctx.supabase, responder)
}

type Responder = (conteudo: Record<string, unknown>, status?: number) => Response

const FALHA_DE_LEITURA = 'Não foi possível ler a configuração do frete agora. Tente de novo em instantes.'

// ── ler_configuracao_frete ──────────────────────────────────────────────────

async function lerConfiguracao(supabase: any, responder: Responder): Promise<Response> {
    const lidas = await lerCredenciais(supabase)
    const config = await lerLoja(supabase)
    if (!lidas.ok || !config) return responder({ success: false, error: FALHA_DE_LEITURA }, 503)
    const { modo, pedidos, ligados } = conjuntoLigado(config, lidas.linhas)
    const provedores = new Map<string, unknown>()
    for (const p of PROVEDORES) {
        const credenciais = lidas.linhas.get(p)?.credentials
        const temChave = tokenDe(credenciais) !== null
        const item: Record<string, unknown> = {
            tem_chave: temChave,
            sandbox: credenciais?.sandbox === true,
            servicos: servicosSalvos(p, credenciais),
            precisa_salvar_de_novo: pedidos.includes(p) && !temChave,
        }
        if (p === 'melhor_envio') item.seguro = seguroDoMe(credenciais)
        // O contato de CADA provedor vem da PRÓPRIA linha (R3-7: nunca copiado entre SF e ME).
        if (p === 'superfrete' || p === 'melhor_envio') {
            item.contato_email = typeof credenciais?.contact_email === 'string' ? credenciais.contact_email.trim() : null
        }
        provedores.set(p, item)
    }
    return responder({ success: true, modo, ligados, provedores: Object.fromEntries(provedores) })
}

// ── list_services ───────────────────────────────────────────────────────────

async function listarServicos(body: any, supabase: any, responder: Responder): Promise<Response> {
    const provider = body.provider
    const lidas = await lerCredenciais(supabase)
    if (!lidas.ok) return responder({ success: false, error: FALHA_DE_LEITURA }, 503)
    const salvas = lidas.linhas.get(provider)?.credentials ?? {}
    const token = tokenDe({ token: body.token }) ?? tokenDe(salvas)
    if (contatoComControle(body.contact_email)) return responder({ success: false, error: MOTIVO_EMAIL_DE_CONTATO_INVALIDO })

    if (provider === 'superfrete') {
        const catalogo = await catalogoDaSuperFrete(token, body.contact_email ?? salvas.contact_email, salvas.sandbox)
        return responder({ success: true, servicos: catalogo, origem: 'catalogo_documentado', aviso: AVISO_DO_CATALOGO_SUPERFRETE })
    }
    if (!token) return responder({ success: false, error: `Cole a chave de acesso da ${rotulo(provider)}.` })

    try {
        const contatoDigitado = typeof body.contact_email === 'string' && body.contact_email.trim().length > 0
        const servicos = provider === 'melhor_envio'
            ? await servicosDoMelhorEnvio(token, salvas.sandbox, contatoDigitado ? body.contact_email : salvas.contact_email)
            : await servicosDaFrenet(token)
        if (servicos.length === 0) {
            return responder({ success: false, motivo: 'sem_servicos', error: `${rotulo(provider)} não devolveu nenhum serviço.` })
        }
        return responder({ success: true, servicos })
    } catch (erro) {
        const detalhe = textoSemSegredo((erro as Error)?.message ?? erro, [token])
        const motivo = erro instanceof FalhaDoProvedor && erro.motivo === 'chave_recusada' ? 'chave_recusada' : 'indisponivel'
        return responder({
            success: false,
            motivo,
            detalhe,
            error: motivo === 'chave_recusada'
                ? `${rotulo(provider)} recusou a chave.`
                : `${rotulo(provider)} não respondeu direito agora. Tente de novo em instantes.`,
        })
    }
}

const textoDe = (valor: unknown) => (typeof valor === 'string' ? valor.trim() : '')

async function servicosDoMelhorEnvio(token: string, sandbox: unknown, contato: unknown) {
    const base = sandbox === true ? 'https://sandbox.melhorenvio.com.br' : 'https://melhorenvio.com.br'
    const resposta = await chamarComTempo(`${base}/api/v2/me/shipment/services`, {
        method: 'GET',
        headers: {
            'Accept': 'application/json',
            'Authorization': `Bearer ${token}`,
            'User-Agent': userAgentDoMelhorEnvio({ contact_email: contato }).userAgent,
        },
    })
    if (!resposta.ok) throw falhaPorStatus('Melhor Envio', resposta.status, resposta.texto, [token])
    const dados = lerJsonOuFalha('Melhor Envio', resposta.texto)
    if (!Array.isArray(dados)) throw new FalhaDoProvedor('indisponivel', 'Melhor Envio: resposta inesperada.')
    return dados.flatMap((s: any) => {
        const codigo = codigoNoFormatoDoProvedor('melhor_envio', s?.id)
        const servico = textoDe(s?.name)
        return codigo && servico ? [{ codigo, transportadora: textoDe(s?.company?.name), servico }] : []
    })
}

async function servicosDaFrenet(token: string) {
    const resposta = await chamarComTempo('https://api.frenet.com.br/shipping/info', {
        method: 'GET',
        headers: { 'Accept': 'application/json', 'token': token },
    })
    if (!resposta.ok) throw falhaPorStatus('Frenet', resposta.status, resposta.texto, [token])
    const dados = lerJsonOuFalha('Frenet', resposta.texto) as any
    const lista = dados?.ShippingSeviceAvailableArray
    if (!Array.isArray(lista)) throw new FalhaDoProvedor('indisponivel', 'Frenet: resposta inesperada.')
    return lista.flatMap((s: any) => {
        const codigo = codigoNoFormatoDoProvedor('frenet', s?.ServiceCode)
        const servico = textoDe(s?.ServiceDescription)
        return codigo && servico ? [{ codigo, transportadora: textoDe(s?.Carrier), servico }] : []
    })
}

/**
 * R3-6: GET {base}/api/v0/services/info ("Informações dos pacotes") — objeto
 * com chave pelo id. É catálogo DOCUMENTADO de limites, não a garantia do que
 * a conta tem ativo (o teste confirma). Qualquer falha (sem chave/e-mail,
 * rede, status, corpo ilegível ou vazio) cai no catálogo mínimo 1, 2 e 17 —
 * nunca se conclui que um serviço "não existe".
 */
async function catalogoDaSuperFrete(token: string | null, email: unknown, sandbox: unknown) {
    const userAgent = userAgentDaSuperFrete(email)
    if (!token || !userAgent) return CATALOGO_MINIMO_SUPERFRETE
    try {
        const resposta = await chamarComTempo(`${baseDaSuperFrete(sandbox)}/api/v0/services/info`, {
            method: 'GET',
            headers: cabecalhosDaSuperFrete(token, userAgent),
        })
        if (!resposta.ok) return CATALOGO_MINIMO_SUPERFRETE
        const dados = JSON.parse(resposta.texto)
        if (!ehObjeto(dados)) return CATALOGO_MINIMO_SUPERFRETE
        const servicos = Object.entries(dados).flatMap(([chave, v]: [string, any]) => {
            const codigo = codigoNoFormatoDoProvedor('superfrete', chave)
            const servico = textoDe(v?.name)
            const transportadora = textoDe(v?.company?.name)
            return codigo && servico && transportadora ? [{ codigo, transportadora, servico }] : []
        }).sort((a, b) => Number(a.codigo) - Number(b.codigo))
        return servicos.length > 0 ? servicos : CATALOGO_MINIMO_SUPERFRETE
    } catch {
        return CATALOGO_MINIMO_SUPERFRETE
    }
}

function lerJsonOuFalha(nome: string, texto: string): unknown {
    try {
        return JSON.parse(texto)
    } catch {
        throw new FalhaDoProvedor('indisponivel', `${nome}: resposta não é JSON válido.`)
    }
}

// ── test_credentials ────────────────────────────────────────────────────────

/**
 * Credencial do teste pela TELA: a linha salva (lida com a service role
 * depois da checagem de admin) com o que a lojista DIGITOU por cima — token,
 * modo de testes e, na SuperFrete, o e-mail. Aceita o formato 1.5.5
 * (`credentials: {token, sandbox, contact_email}`) e o 1.5.7 (no topo).
 */
async function testarPelaTela(body: any, supabase: any, responder: Responder): Promise<Response> {
    const provider = body.provider
    const digitadas = { ...(ehObjeto(body.credentials) ? body.credentials : {}), ...body }
    const lidas = await lerCredenciais(supabase)
    const config = await lerLoja(supabase)
    if (!lidas.ok || !config) return responder({ success: false, error: FALHA_DE_LEITURA }, 503)
    const salvas = ehObjeto(lidas.linhas.get(provider)?.credentials) ? lidas.linhas.get(provider).credentials : {}
    const tokenDigitado = tokenDe({ token: digitadas.token })
    const credenciais = { ...salvas }
    if (tokenDigitado) credenciais.token = tokenDigitado
    if (typeof digitadas.sandbox === 'boolean' && tokenDigitado) credenciais.sandbox = digitadas.sandbox
    if (!tokenDe(credenciais)) {
        return responder({ success: false, error: 'Nenhuma chave de acesso salva para esta transportadora. Cole a chave e salve antes de testar.' })
    }
    if (contatoComControle(digitadas.contact_email)) return responder({ success: false, error: MOTIVO_EMAIL_DE_CONTATO_INVALIDO })
    const emailDigitado = typeof digitadas.contact_email === 'string' && digitadas.contact_email.trim().length > 0
    if (emailDigitado && provider !== 'frenet' && !emailDeContatoValido(digitadas.contact_email)) {
        return responder({ success: false, error: MOTIVO_EMAIL_DE_CONTATO_INVALIDO })
    }
    if (emailDigitado && provider !== 'frenet') credenciais.contact_email = digitadas.contact_email
    if (provider === 'superfrete' && !emailDeContatoValido(credenciais.contact_email)) {
        return responder({ success: false, error: MOTIVO_SEM_EMAIL_SUPERFRETE })
    }
    let selecao: string[] | null
    if (digitadas.servicos !== undefined) {
        const validados = validarServicos(provider, digitadas.servicos)
        if (!validados.ok) return responder({ success: false, error: validados.error })
        selecao = validados.servicos
        if (provider !== 'frenet') selecao = [...selecao].sort((a, b) => Number(a) - Number(b))
    } else {
        selecao = servicosSalvos(provider, credenciais)
    }
    return responder({ ...(await testarCredencial(provider, credenciais, selecao, config)) })
}

// ── save_credentials ────────────────────────────────────────────────────────

/**
 * Grava a credencial de QUALQUER dos três provedores, em MERGE (R1-3): lê a
 * linha atual e escreve `{...atual, ...permitidosNovos}` — campo que não veio
 * (ou fora da lista branca do pedido) fica como estava. Token vazio = mantém.
 * Provedor LIGADO com chave ou serviços novos: testa com os valores NOVOS
 * antes; reprovado = não grava. Escrita = UM upsert com a linha e `_revisao`
 * (R3-1); depois, se mudou chave/serviços/seguro, apaga o cache (R2-2).
 *
 * Concorrência: é ler-e-regravar; dois salvamentos simultâneos terminam com
 * o último — o mesmo "último vence" de sempre.
 */
async function salvarCredenciais(body: any, supabase: any, responder: Responder): Promise<Response> {
    const provider = body.provider
    const nome = rotulo(provider)
    const entrada: Record<string, unknown> = {
        ...(ehObjeto(body.credentials) ? body.credentials : {}),
        ...Object.fromEntries(
            Object.entries(body).filter(([chave]) => chave !== 'action' && chave !== 'provider' && chave !== 'credentials'),
        ),
    }
    const permitidos = CAMPOS_PERMITIDOS.get(provider) as ReadonlySet<string>
    const desconhecida = Object.keys(entrada).find((chave) => !permitidos.has(chave))
    if (desconhecida !== undefined) {
        return responder({ success: false, error: `Campo não aceito para a ${nome}: ${textoSemSegredo(desconhecida, [], 40)}.` })
    }

    const novos: Record<string, unknown> = {}
    if (entrada.token !== undefined && entrada.token !== null && typeof entrada.token !== 'string') {
        return responder({ success: false, error: 'A chave de acesso precisa ser texto.' })
    }
    const tokenNovo = tokenDe({ token: entrada.token })
    if (tokenNovo) novos.token = tokenNovo
    if (entrada.sandbox !== undefined) {
        if (typeof entrada.sandbox !== 'boolean') return responder({ success: false, error: 'O modo de testes (Sandbox) é inválido.' })
        novos.sandbox = entrada.sandbox
    }
    if (entrada.servicos !== undefined) {
        const validados = validarServicos(provider, entrada.servicos)
        if (!validados.ok) return responder({ success: false, error: validados.error })
        novos.servicos = validados.servicos
    }
    if (entrada.seguro !== undefined) {
        if (!SEGUROS.has(entrada.seguro as string)) return responder({ success: false, error: 'Escolha de seguro inválida.' })
        novos.seguro = entrada.seguro
    }
    // O e-mail vai para o cabeçalho User-Agent: controle (CR, LF, TAB...) em
    // QUALQUER posição recusa — antes do `trim()`, que tiraria o das pontas.
    if (contatoComControle(entrada.contact_email)) return responder({ success: false, error: MOTIVO_EMAIL_DE_CONTATO_INVALIDO })
    const contatoVazio = entrada.contact_email === null ||
        (typeof entrada.contact_email === 'string' && entrada.contact_email.trim().length === 0)
    // R3-7: no ME, vazio/ausente = mantém o salvo. Na SF, a régua da 1.5.5 (vazio recusa).
    if (entrada.contact_email !== undefined && !(provider === 'melhor_envio' && contatoVazio)) {
        const email = emailDeContatoValido(entrada.contact_email)
        if (!email) return responder({ success: false, error: MOTIVO_EMAIL_DE_CONTATO_INVALIDO })
        novos.contact_email = email
    }

    const lidas = await lerCredenciais(supabase)
    const config = await lerLoja(supabase)
    if (!lidas.ok || !config) {
        return responder({ success: false, error: 'Não foi possível conferir a chave salva agora. Tente de novo em instantes.' }, 503)
    }
    const atual = ehObjeto(lidas.linhas.get(provider)?.credentials) ? lidas.linhas.get(provider).credentials : {}
    const tokenAtual = tokenDe(atual)
    if (!tokenNovo && !tokenAtual) return responder({ success: false, error: `Cole a chave de acesso da ${nome}.` })
    // A chave é POR AMBIENTE: trocar o modo de testes sem a chave do ambiente
    // novo deixaria a chave velha apontada para o lugar errado (regra 1.5.5).
    if (!tokenNovo && novos.sandbox !== undefined && (novos.sandbox === true) !== (atual.sandbox === true)) {
        return responder({
            success: false,
            error: 'Para trocar o modo de testes (Sandbox), cole a chave de acesso do ambiente escolhido — Sandbox e produção usam chaves diferentes.',
        })
    }
    const credenciais = { ...atual, ...novos }
    const conjunto = conjuntoLigado(config, lidas.linhas)
    // Provedor LIGADO não vira Sandbox (revisão Opus, 1.5.7): o checkout
    // passaria a cotar no ambiente de testes para cliente real. Nos DOIS
    // modos — no legado, o espelho é quem cota. Recusa antes de testar,
    // gravar ou apagar o cache. Vale também para quem está na lista SEM
    // chave (`pedidos`): a chave que chega agora o ligaria já em Sandbox.
    if (credenciais.sandbox === true && conjunto.pedidos.includes(provider)) {
        return responder({
            success: false,
            motivo: 'sandbox',
            error: `${nome} está ligada: desligue antes de usar o modo de testes (Sandbox). A chave de testes não pode cotar para clientes.`,
        })
    }
    if (provider === 'superfrete' && !emailDeContatoValido(credenciais.contact_email)) {
        return responder({ success: false, error: MOTIVO_EMAIL_DE_CONTATO_INVALIDO })
    }

    const mudouChave = (tokenNovo !== null && tokenNovo !== tokenAtual) || (credenciais.sandbox === true) !== (atual.sandbox === true)
    const mudouServicos = jsonCanonico(servicosSalvos(provider, credenciais)) !== jsonCanonico(servicosSalvos(provider, atual))
    const mudouSeguro = provider === 'melhor_envio' && seguroDoMe(credenciais) !== seguroDoMe(atual)
    const segredos = [tokenNovo, tokenAtual]

    // Testa quem está na LISTA (`pedidos`), não só quem já cota (`ligados`):
    // o provedor em `_ligados` sem chave passa a cotar assim que esta chave
    // grava — nenhuma chave cota para cliente sem teste (D1/R1).
    if ((mudouChave || mudouServicos) && conjunto.pedidos.includes(provider)) {
        const teste = await testarCredencial(provider, credenciais, servicosSalvos(provider, credenciais), config)
        if (!teste.success) {
            return responder({ ...teste, error: `Não salvei: o teste com os dados novos não passou. ${teste.error ?? ''}`.trim() })
        }
    }

    const agora = new Date().toISOString()
    try {
        const { error } = await supabase.from('store_shipping_credentials').upsert(
            [{ provider, credentials: credenciais, updated_at: agora }, linhaDaRevisaoNova(agora)],
            { onConflict: 'provider' },
        )
        if (error) {
            console.error('[calculate-shipping] save_credentials: gravação falhou:', textoSemSegredo(error?.message ?? error, segredos))
            return responder({ success: false, error: `Não foi possível salvar a chave da ${nome}. Tente de novo.` }, 500)
        }
    } catch (erro) {
        console.error('[calculate-shipping] save_credentials: exceção:', textoSemSegredo((erro as Error)?.message ?? erro, segredos))
        return responder({ success: false, error: `Não foi possível salvar a chave da ${nome}. Tente de novo.` }, 500)
    }

    const resposta: Record<string, unknown> = {
        success: true,
        tem_chave: true,
        servicos: servicosSalvos(provider, credenciais),
    }
    if (provider === 'melhor_envio') resposta.seguro = seguroDoMe(credenciais)
    if (provider === 'superfrete') {
        resposta.sandbox = credenciais.sandbox === true
        resposta.contact_email = emailDeContatoValido(credenciais.contact_email)
    }
    if (provider === 'melhor_envio') resposta.contact_email = emailDeContatoValido(credenciais.contact_email)
    if ((mudouChave || mudouServicos || mudouSeguro) && !(await apagarCacheDeCotacao(supabase))) {
        resposta.cache = 'pendente'
        resposta.aviso = 'Configuração salva. As cotações antigas ainda podem aparecer por até 2 horas; calcule o frete de novo para conferir.'
    }
    return responder(resposta)
}

// ── save_active_providers ───────────────────────────────────────────────────

/**
 * Liga/desliga provedores (R2-1 + R1-3 + R3-1). Ordem:
 * 1. valida: todo pedido tem chave salva e não é Sandbox; quem PASSA a ser
 *    ligado precisa passar no teste (em paralelo). Qualquer recusa = nada grava;
 * 2. UM upsert com `_ligados` + `_revisao` (nunca regrava credencial);
 * 3. apaga o cache (R2-2) — falhou = `cache:'pendente'`;
 * 4. o espelho `store_config.shipping_provider` (1º ligado na ordem canônica,
 *    ou `flat_fee`) — falhou = `espelho:'pendente'`, nunca "falhou".
 * Repetir com a MESMA lista não testa, não regrava e não apaga nada.
 */
async function salvarLigados(body: any, supabase: any, responder: Responder): Promise<Response> {
    const lista = body.ligados
    if (!Array.isArray(lista) || lista.some((p) => !ehProvedor(p))) {
        return responder({ success: false, error: 'Lista de provedores inválida.' })
    }
    const ligados = emOrdemCanonica(lista)
    const lidas = await lerCredenciais(supabase)
    const config = await lerLoja(supabase)
    if (!lidas.ok || !config) return responder({ success: false, error: FALHA_DE_LEITURA }, 503)
    const atual = conjuntoLigado(config, lidas.linhas)

    for (const p of ligados) {
        const credenciais = lidas.linhas.get(p)?.credentials
        if (!tokenDe(credenciais)) {
            return responder({ success: false, provider: p, motivo: 'sem_chave', error: `${rotulo(p)}: salve a chave de acesso antes de ligar.` })
        }
        if (p === 'melhor_envio' && userAgentDoMelhorEnvio(credenciais).contato !== 'loja') {
            return responder({ success: false, provider: p, motivo: 'sem_email', error: MOTIVO_SEM_EMAIL_MELHOR_ENVIO })
        }
        if (credenciais.sandbox === true) {
            return responder({
                success: false,
                provider: p,
                motivo: 'sandbox',
                error: `${rotulo(p)}: a chave salva é de testes (Sandbox) e não pode cotar para clientes. Salve a chave de produção.`,
            })
        }
    }
    const novos = ligados.filter((p) => !atual.ligados.includes(p))
    const testes = await Promise.all(novos.map(async (p) => {
        const credenciais = lidas.linhas.get(p).credentials
        return { p, teste: await testarCredencial(p, credenciais, servicosSalvos(p, credenciais), config) }
    }))
    const reprovado = testes.find(({ teste }) => !teste.success)
    if (reprovado) {
        const { p, teste } = reprovado
        return responder({
            success: false,
            provider: p,
            motivo: teste.motivo ?? 'configuracao',
            servicosTestados: teste.servicosTestados,
            detalhe: teste.detalhe,
            error: `${rotulo(p)} não foi ligada: ${teste.error ?? 'o teste não passou.'}`,
        })
    }

    const mesmaLista = atual.modo === 'multi' && jsonCanonico(atual.pedidos) === jsonCanonico(ligados)
    const resposta: Record<string, unknown> = { success: true, ligados }
    const avisos: string[] = []
    if (!mesmaLista) {
        const agora = new Date().toISOString()
        try {
            const { error } = await supabase.from('store_shipping_credentials').upsert(
                [
                    { provider: LINHA_DOS_LIGADOS, credentials: { ligados, atualizado_em: agora }, updated_at: agora },
                    linhaDaRevisaoNova(agora),
                ],
                { onConflict: 'provider' },
            )
            if (error) {
                console.error('[calculate-shipping] save_active_providers: gravação falhou:', error?.code ?? 'sem código')
                return responder({ success: false, error: 'Não foi possível salvar os provedores ligados. Tente de novo.' }, 500)
            }
        } catch (erro) {
            console.error('[calculate-shipping] save_active_providers: exceção:', (erro as Error)?.name ?? 'erro')
            return responder({ success: false, error: 'Não foi possível salvar os provedores ligados. Tente de novo.' }, 500)
        }
        if (!(await apagarCacheDeCotacao(supabase))) {
            resposta.cache = 'pendente'
            avisos.push('as cotações antigas ainda podem aparecer por até 2 horas')
        }
    }
    try {
        const { error } = await supabase
            .from('store_config')
            .update({ shipping_provider: ligados[0] ?? 'flat_fee' })
            .eq('id', 1)
        if (error) throw new Error(error?.code ?? 'erro')
    } catch (erro) {
        console.error('[calculate-shipping] save_active_providers: espelho não atualizou:', (erro as Error)?.message ?? 'erro')
        resposta.espelho = 'pendente'
        avisos.push('o indicador antigo não atualizou, salve de novo para sincronizar')
    }
    if (avisos.length > 0) resposta.aviso = `Provedores salvos; ${avisos.join('; ')}.`
    return responder(resposta)
}
