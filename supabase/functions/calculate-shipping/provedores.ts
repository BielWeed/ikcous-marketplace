// @ts-nocheck
/**
 * ADAPTADORES DAS TRANSPORTADORAS (release 1.5.7 — vários provedores).
 *
 * Um adaptador por provedor (Melhor Envio, SuperFrete, Frenet), todos com a
 * MESMA forma: recebem a credencial, os insumos do BANCO e a seleção de
 * serviços, fazem UMA chamada (sem retry) com tempo limite próprio e devolvem
 * `ResultadoDoProvedor` — ou lançam `FalhaDoProvedor` com o motivo
 * classificado. A cotação do checkout e o teste de credencial do painel usam
 * estas MESMAS funções (contrato §4 + R1-8).
 *
 * Nada aqui lê banco nem decide modo legado/multi: isso é do
 * `configuracao.ts`. Contrato: CONTRATO-1.5.7.md §1–3, §7 (R1), §8 (R2).
 */
import {
    aoCentavo,
    codigoDeServicoValido,
    nomeDaOpcao,
    prazoDaApi,
    precoDaApi,
    textoSemSegredo,
} from './regua.ts'

/** Tempo limite de CADA provedor (A2): 10 s, corpo incluído. Sem retry. */
export const TEMPO_LIMITE_DO_PROVEDOR_MS = 10000

/** Os três provedores, na ordem canônica (a do espelho `store_config.shipping_provider`). */
export const PROVEDORES: readonly string[] = ['superfrete', 'melhor_envio', 'frenet']

export const ROTULO_DO_PROVEDOR: ReadonlyMap<string, string> = new Map([
    ['melhor_envio', 'Melhor Envio'],
    ['superfrete', 'SuperFrete'],
    ['frenet', 'Frenet'],
])

export function ehProvedor(valor: unknown): boolean {
    return typeof valor === 'string' && PROVEDORES.includes(valor)
}

/** Ordena uma lista de provedores na ordem canônica, sem repetição e só os conhecidos. */
export function emOrdemCanonica(lista: unknown[]): string[] {
    const pedidos = new Set(lista.filter(ehProvedor))
    return PROVEDORES.filter((p) => pedidos.has(p))
}

/**
 * Motivo da falha de um provedor inteiro (não de um serviço):
 * - `configuracao`: nem chamou (sem chave, sem e-mail, sem serviço, sem preço do banco);
 * - `chave_recusada`: 401/403 ou erro EXPLÍCITO de token/autenticação;
 * - `indisponivel`: rede, tempo esgotado, 5xx, outro status, corpo ilegível;
 * - `cep_invalido`: 422 citando o CEP de destino (regra de hoje).
 */
export type MotivoDaFalha = 'configuracao' | 'chave_recusada' | 'indisponivel' | 'cep_invalido' | 'sandbox'

export class FalhaDoProvedor extends Error {
    motivo: MotivoDaFalha
    constructor(motivo: MotivoDaFalha, mensagem: string) {
        super(mensagem)
        this.name = 'FalhaDoProvedor'
        this.motivo = motivo
    }
}

/** 422 com indicação explícita do CEP de destino (regra de sempre). */
export function erroDeTransportadoraEhCepInvalido(mensagem: string | null | undefined): boolean {
    return !!mensagem && mensagem.includes('retornou 422:') && mensagem.includes('cep_destino')
}

/**
 * Casa o nome COMERCIAL do serviço com a CHAVE da tela (`sedex`, `pac`,
 * `jadlog`) — o filtro LEGADO do ME e da Frenet (sem seleção salva). Cada
 * chave casa por um padrão que identifica o serviço, nunca substring solta:
 * ".package" não é PAC. Chave desconhecida cai no `includes`.
 */
export function servicoCasaChave(nomeDoServico: string | null | undefined, chave: string): boolean {
    const nome = String(nomeDoServico || '').toLowerCase()
    const chaveNormalizada = String(chave || '').toLowerCase().trim()
    if (chaveNormalizada === 'pac') return /\bpac\b/.test(nome)
    if (chaveNormalizada === 'jadlog') return /jadlog|package|centralizado|\.com/.test(nome)
    if (chaveNormalizada === 'sedex') return nome.includes('sedex')
    return nome.includes(chaveNormalizada)
}

/** Token salvo/digitado: texto não vazio depois de aparado, senão `null`. */
export function tokenDe(credenciais: any): string | null {
    const token = credenciais?.token
    if (typeof token !== 'string') return null
    const aparado = token.trim()
    return aparado.length > 0 ? aparado : null
}

/** `'sem_seguro'` só quando gravado EXATO; todo o resto é o padrão (contrato §1). */
export function seguroDoMe(credenciais: any): 'valor_dos_produtos' | 'sem_seguro' {
    return credenciais?.seguro === 'sem_seguro' ? 'sem_seguro' : 'valor_dos_produtos'
}

const CODIGO_NUMERICO = /^\d+$/

/** O formato do código de serviço de cada provedor (R1-5: nada inventado além disto). */
export function codigoNoFormatoDoProvedor(provider: string, valor: unknown): string | null {
    const codigo = codigoDeServicoValido(valor)
    if (codigo === null) return null
    if (provider === 'frenet') return codigo
    return CODIGO_NUMERICO.test(codigo) ? codigo : null
}

/**
 * Seleção de serviços SALVA, normalizada (contrato §1):
 * - `null` = sem seleção (campo ausente ou não-lista) → filtro LEGADO;
 * - lista = filtro por código; itens inválidos saem, repetidos também. Lista
 *   que ficou VAZIA continua lista (e o provedor falha fechado por
 *   configuração) — nunca vira "legado" em silêncio, que pediria MAIS
 *   serviços do que a lojista escolheu.
 * ME e SF em ordem numérica; Frenet na ordem em que foi salva.
 */
export function servicosSalvos(provider: string, credenciais: any): string[] | null {
    const lista = credenciais?.servicos
    if (!Array.isArray(lista)) return null
    const vistos = new Set<string>()
    for (const item of lista) {
        const codigo = codigoNoFormatoDoProvedor(provider, item)
        if (codigo !== null) vistos.add(codigo)
    }
    const saida = [...vistos]
    if (provider !== 'frenet') saida.sort((a, b) => Number(a) - Number(b))
    return saida
}

// ── SUPERFRETE (contrato oficial superfrete.readme.io; regra 1.5.6) ─────────

const SUPERFRETE_BASE_PRODUCAO = 'https://api.superfrete.com'
const SUPERFRETE_BASE_SANDBOX = 'https://sandbox.superfrete.com'

/** Chave da tela → ids SF (1.5.6: `pac` pede PAC 1 e Mini 17). */
export const SUPERFRETE_SERVICOS_POR_CHAVE: ReadonlyMap<string, readonly number[]> = new Map([
    ['pac', [1, 17]],
    ['sedex', [2]],
    ['jadlog', [3]],
])

/** "Lista vazia = todas": os ids documentados. */
export const SUPERFRETE_TODOS_OS_SERVICOS: readonly number[] = [1, 2, 3, 17, 31, 33]

/** Versão no User-Agent da SuperFrete: a da release que publica esta edge. */
export const VERSAO_DA_INTEGRACAO_SUPERFRETE = '1.5.7'

/**
 * Marca da COTAÇÃO da SuperFrete em cada opção (`cotacaoSf`). A 1.5.7 não
 * muda o significado da cotação SF (mesmo corpo); o que invalida as linhas
 * antigas agora é a `assinaturaCotacao`.
 */
export const VERSAO_DA_COTACAO_SUPERFRETE = 2

export const MOTIVO_SEM_EMAIL_SUPERFRETE =
    'Falta o e-mail de contato técnico da SuperFrete — preencha em Ajustes > Transportadoras.'

export const MOTIVO_EMAIL_DE_CONTATO_INVALIDO =
    'Confira o e-mail de contato técnico: use um endereço completo, sem espaços nem acentos (exemplo: voce@sualoja.com.br).'

/** `services` legado da SF a partir das chaves de transportadora (vazio = todas). */
export function servicosSuperFrete(chaves: string[]): string {
    if (chaves.length === 0) return SUPERFRETE_TODOS_OS_SERVICOS.join(',')
    const ids = new Set<number>()
    for (const chave of chaves) {
        for (const id of SUPERFRETE_SERVICOS_POR_CHAVE.get(String(chave || '').toLowerCase().trim()) ?? []) {
            ids.add(id)
        }
    }
    return [...ids].sort((a, b) => a - b).join(',')
}

/** Só `sandbox === true` EXATO vai para o sandbox. */
export function baseDaSuperFrete(sandbox: unknown): string {
    return sandbox === true ? SUPERFRETE_BASE_SANDBOX : SUPERFRETE_BASE_PRODUCAO
}

export function urlDaCotacaoSuperFrete(sandbox: unknown): string {
    return `${baseDaSuperFrete(sandbox)}/api/v0/calculator`
}

/**
 * E-mail de contato técnico (1.5.5): só ASCII, um `@`, sem espaço nem
 * caractere que quebre o header; <= 254. Devolve o e-mail aparado ou `null`.
 */
export function emailDeContatoValido(valor: unknown): string | null {
    if (typeof valor !== 'string') return null
    const email = valor.trim()
    if (email.length === 0 || email.length > 254) return null
    const arroba = email.indexOf('@')
    if (arroba <= 0 || arroba !== email.lastIndexOf('@')) return null
    if (!/^[A-Za-z0-9._%+-]+$/.test(email.slice(0, arroba))) return null
    const rotulos = email.slice(arroba + 1).split('.')
    if (rotulos.length < 2) return null
    if (!/^[A-Za-z]{2,}$/.test(rotulos.at(-1) ?? '')) return null
    return rotulos.every((rotulo) => /^[A-Za-z0-9-]+$/.test(rotulo)) ? email : null
}

/** `IKCOUS Marketplace <versão> (<e-mail da loja>)`, ou `null` sem e-mail válido. */
export function userAgentDaSuperFrete(email: unknown): string | null {
    const valido = emailDeContatoValido(email)
    return valido ? `IKCOUS Marketplace ${VERSAO_DA_INTEGRACAO_SUPERFRETE} (${valido})` : null
}

export function cabecalhosDaSuperFrete(token: string, userAgent: string): Record<string, string> {
    return {
        'Authorization': `Bearer ${token}`,
        'User-Agent': userAgent,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
    }
}

// ── MELHOR ENVIO: User-Agent com o contato DA LOJA (R3-7) ───────────────────

/**
 * Recuo LEGADO do User-Agent do ME (R3-7): só para a credencial que ainda não
 * tem `contact_email` (lojas de hoje em modo legado) — até a lojista
 * preencher. O log marca `ua_contato:'legado'`; o e-mail não é impresso.
 */
const USER_AGENT_LEGADO_DO_ME = 'IKCOUS-Marketplace-Integration (contato@ikcous.com.br)'

/** Mensagem da recusa de ligar o ME sem contato (texto do contrato R3-7). */
export const MOTIVO_SEM_EMAIL_MELHOR_ENVIO =
    'Informe o e-mail de contato do Melhor Envio (a API exige um contato da loja)'

/**
 * User-Agent do ME montado NO SERVIDOR (R3-7), em TODA chamada ao ME:
 * `IKCOUS-Marketplace-Integration (<contact_email da credencial ME>)`, com a
 * mesma régua de e-mail da SuperFrete. Sem e-mail válido: o recuo legado.
 * O e-mail da SF NUNCA é usado aqui.
 */
export function userAgentDoMelhorEnvio(credenciais: any): { userAgent: string; contato: 'loja' | 'legado' } {
    const email = emailDeContatoValido(credenciais?.contact_email)
    return email
        ? { userAgent: `IKCOUS-Marketplace-Integration (${email})`, contato: 'loja' }
        : { userAgent: USER_AGENT_LEGADO_DO_ME, contato: 'legado' }
}

// ── Chamada HTTP com tempo limite (corpo incluído) ──────────────────────────

/**
 * UMA chamada, sem retry. O AbortController corta no tempo INCLUSIVE a
 * leitura do corpo (o `buscarComTempo` antigo soltava o relógio quando os
 * cabeçalhos chegavam). O `fetch` é o global lido NA HORA (os testes o
 * trocam). Falha de rede/tempo vira `FalhaDoProvedor('indisponivel')`.
 */
export async function chamarComTempo(
    url: string,
    init: RequestInit,
    tempoMs = TEMPO_LIMITE_DO_PROVEDOR_MS,
): Promise<{ status: number; ok: boolean; texto: string }> {
    const controle = new AbortController()
    const despertar = setTimeout(() => controle.abort(), tempoMs)
    try {
        let resposta: Response
        try {
            resposta = await globalThis.fetch(url, { ...init, signal: controle.signal })
        } catch (erro) {
            const nome = (erro as { name?: unknown } | null)?.name === 'AbortError' ? 'tempo esgotado' : 'falha de rede'
            throw new FalhaDoProvedor('indisponivel', `${nome}: ${textoSemSegredo((erro as Error)?.message ?? erro)}`)
        }
        let texto: string
        try {
            texto = await resposta.text()
        } catch {
            throw new FalhaDoProvedor('indisponivel', 'o corpo da resposta não pôde ser lido (tempo esgotado ou conexão caiu).')
        }
        return { status: resposta.status, ok: resposta.ok, texto }
    } finally {
        clearTimeout(despertar)
    }
}

/** Status não-2xx → falha classificada. A mensagem mantém o formato de sempre ("<Nome> API retornou <status>: <corpo>"). */
export function falhaPorStatus(nome: string, status: number, texto: string, segredos: unknown[]): FalhaDoProvedor {
    const mensagem = `${nome} API retornou ${status}: ${textoSemSegredo(texto, segredos, Number.POSITIVE_INFINITY)}`
    if (status === 401 || status === 403) return new FalhaDoProvedor('chave_recusada', mensagem)
    if (erroDeTransportadoraEhCepInvalido(mensagem)) return new FalhaDoProvedor('cep_invalido', mensagem)
    return new FalhaDoProvedor('indisponivel', mensagem)
}

function lerJson(nome: string, texto: string): unknown {
    try {
        return JSON.parse(texto)
    } catch {
        throw new FalhaDoProvedor('indisponivel', `${nome}: resposta não é JSON válido.`)
    }
}

/** Erro por serviço que fala EXPLICITAMENTE de token/autenticação (R1-8). */
const ERRO_DE_TOKEN = /\btoken\b|autentica|unauthori[sz]ed|não autorizado|nao autorizado|credencia/i

// ── Tipos comuns ────────────────────────────────────────────────────────────

/** Um item do carrinho com os números JÁ pela régua do banco (R1-1). */
export type ItemDoInsumo = {
    produto: string | null
    variante: string | null
    qtd: number
    peso: number
    C: number
    L: number
    A: number
    valor: number | null
}

export type EntradaDaCotacao = {
    originCep: string
    destinationCep: string
    itens: ItemDoInsumo[]
    /** Chaves de transportadora da loja (sem `store-pickup`) — só o filtro LEGADO usa. */
    chaves: string[]
}

/** Um serviço como a API devolveu, já lido pela régua (vai para o log e para o teste). */
export type ServicoRetornado = {
    codigo: string | null
    preco: number | null
    preco_original: number | null
    prazo: number | null
    erro: boolean
    /** Passou no filtro (seleção salva ou nome legado). */
    pedido: boolean
    /** Texto de erro da transportadora, redigido — NUNCA vai para o log. */
    detalhe?: string
}

export type ResultadoDoProvedor = {
    provider: string
    servicosPedidos: string[] | 'legado'
    retornados: ServicoRetornado[]
    opcoes: any[]
}

const somaDoValor = (itens: ItemDoInsumo[]): number =>
    aoCentavo(itens.reduce((soma, item) => soma + (item.valor ?? 0) * item.qtd, 0))

const textoDaApi = (valor: unknown): string => (typeof valor === 'string' ? valor.trim() : '')

/** Uma opção por id (a API pode repetir): fica a mais barata; empate, a primeira. */
function semRepetirId(opcoes: any[]): any[] {
    const porId = new Map<string, any>()
    for (const opcao of opcoes) {
        const atual = porId.get(opcao.id)
        if (!atual || opcao.price < atual.price) porId.set(opcao.id, opcao)
    }
    return opcoes.filter((opcao) => porId.get(opcao.id) === opcao)
}

/**
 * Nenhuma opção válida E algum serviço disse, com todas as letras, que o
 * problema é o token: a chave foi recusada (R1-8). Erro de trecho, de
 * dimensão ou de indisponibilidade NUNCA vira chave recusada.
 */
function falhaSeTokenRecusado(nome: string, tokenRecusado: boolean): void {
    if (tokenRecusado) {
        throw new FalhaDoProvedor('chave_recusada', `${nome}: a transportadora recusou a chave de acesso.`)
    }
}

// ── MELHOR ENVIO ────────────────────────────────────────────────────────────

/**
 * POST /api/v2/me/shipment/calculate (modo `products`).
 * - `services=<ids>` quando há seleção salva; sem ela, pede tudo e filtra por
 *   NOME como hoje (`servicoCasaChave`).
 * - `insurance_value` por produto = valor do BANCO (padrão), ou 0 com
 *   `sem_seguro` — e aí o id ganha `-ss` (a etiqueta sabe pelo id).
 * - preço = `custom_price` válido, senão `price` (R1-5: 0 vale); prazo =
 *   `custom_delivery_time` válido, senão `delivery_time`.
 * Sem o preço do banco e COM seguro: falha fechada, sem chamar.
 */
export async function cotarMelhorEnvio(credenciais: any, entrada: EntradaDaCotacao, selecao: string[] | null): Promise<ResultadoDoProvedor> {
    const token = tokenDe(credenciais)
    if (!token) throw new FalhaDoProvedor('configuracao', 'Token do Melhor Envio ausente')
    if (selecao && selecao.length === 0) {
        throw new FalhaDoProvedor('configuracao', 'Melhor Envio não consultado: nenhum serviço válido na seleção salva.')
    }
    const semSeguro = seguroDoMe(credenciais) === 'sem_seguro'
    if (!semSeguro && entrada.itens.some((item) => item.valor === null)) {
        throw new FalhaDoProvedor(
            'configuracao',
            'Melhor Envio não consultado: preço de produto indisponível no cadastro (o seguro usa o valor do banco).',
        )
    }
    const products = entrada.itens.map((item) => ({
        id: String(item.produto ?? 'item'),
        width: item.L,
        height: item.A,
        length: item.C,
        weight: item.peso,
        insurance_value: semSeguro ? 0 : aoCentavo(item.valor as number),
        quantity: item.qtd,
    }))
    const corpo: Record<string, unknown> = {
        from: { postal_code: entrada.originCep },
        to: { postal_code: entrada.destinationCep },
        products,
    }
    if (selecao) corpo.services = selecao.join(',')
    const base = credenciais?.sandbox === true ? 'https://sandbox.melhorenvio.com.br' : 'https://melhorenvio.com.br'
    const resposta = await chamarComTempo(`${base}/api/v2/me/shipment/calculate`, {
        method: 'POST',
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
            'User-Agent': userAgentDoMelhorEnvio(credenciais).userAgent,
        },
        body: JSON.stringify(corpo),
    })
    if (!resposta.ok) throw falhaPorStatus('Melhor Envio', resposta.status, resposta.texto, [token])
    const dados = lerJson('Melhor Envio', resposta.texto)
    if (!Array.isArray(dados)) {
        throw new FalhaDoProvedor('indisponivel', 'Melhor Envio: resposta inesperada (não é uma lista de serviços).')
    }
    const pedidos = selecao ? new Set(selecao) : null
    const seguroDeclarado = semSeguro ? 0 : somaDoValor(entrada.itens)
    const retornados: ServicoRetornado[] = []
    const opcoes: any[] = []
    let tokenRecusado = false
    for (const servico of dados) {
        if (!servico || typeof servico !== 'object') continue
        const codigo = codigoNoFormatoDoProvedor('melhor_envio', servico.id)
        const nomeDoServico = textoDaApi(servico.name)
        const pedido = codigo !== null && (pedidos
            ? pedidos.has(codigo)
            : entrada.chaves.length === 0 || entrada.chaves.some((chave) => servicoCasaChave(nomeDoServico, chave)))
        if (servico.error) {
            const detalhe = textoSemSegredo(typeof servico.error === 'string' ? servico.error : JSON.stringify(servico.error), [token], 200)
            if (pedido && ERRO_DE_TOKEN.test(detalhe)) tokenRecusado = true
            retornados.push({ codigo, preco: null, preco_original: null, prazo: null, erro: true, pedido, detalhe })
            continue
        }
        const original = precoDaApi(servico.price, { aceitaZero: true })
        const custom = precoDaApi(servico.custom_price, { aceitaZero: true })
        const preco = custom ?? original
        const prazo = prazoDaApi(servico.custom_delivery_time, 0) ?? prazoDaApi(servico.delivery_time, 0)
        retornados.push({ codigo, preco, preco_original: original, prazo, erro: false, pedido })
        if (!pedido || codigo === null || preco === null || prazo === null) continue
        const transportadora = textoDaApi(servico.company?.name)
        opcoes.push({
            id: `melhor-envio-${codigo}${semSeguro ? '-ss' : ''}`,
            name: nomeDaOpcao(transportadora, nomeDoServico),
            price: preco,
            deliveryDays: prazo,
            provider: 'melhor_envio',
            transportadora,
            servico: nomeDoServico,
            provedorRotulo: 'Melhor Envio',
            seguroDeclarado,
        })
    }
    if (opcoes.length === 0) falhaSeTokenRecusado('Melhor Envio', tokenRecusado)
    return { provider: 'melhor_envio', servicosPedidos: selecao ?? 'legado', retornados, opcoes: semRepetirId(opcoes) }
}

// ── SUPERFRETE ──────────────────────────────────────────────────────────────

/**
 * POST {base}/api/v0/calculator — o MESMO corpo da 1.5.6 (sem seguro, sem
 * mão própria, sem AR; `products` do banco campo a campo). `services` =
 * seleção salva, senão o mapeamento de hoje (pac→1,17; sedex→2). Sem o
 * agrupamento PAC×Mini: as duas ofertas vão na lista. Preço 0 DESCARTA
 * (R2-7) e prazo precisa ser >= 1 (régua 1.5.6).
 */
export async function cotarSuperFrete(credenciais: any, entrada: EntradaDaCotacao, selecao: string[] | null): Promise<ResultadoDoProvedor> {
    const services = selecao ? selecao.join(',') : servicosSuperFrete(entrada.chaves)
    const token = tokenDe(credenciais)
    if (!token) throw new FalhaDoProvedor('configuracao', 'Token da SuperFrete ausente')
    const userAgent = userAgentDaSuperFrete(credenciais?.contact_email)
    if (!userAgent) throw new FalhaDoProvedor('configuracao', MOTIVO_SEM_EMAIL_SUPERFRETE)
    if (!services) {
        throw new FalhaDoProvedor(
            'configuracao',
            'SuperFrete não consultada: nenhum serviço habilitado (sedex, pac ou jadlog) corresponde a um serviço da SuperFrete.',
        )
    }
    const corpo = {
        from: { postal_code: entrada.originCep },
        to: { postal_code: entrada.destinationCep },
        services,
        options: { own_hand: false, receipt: false, insurance_value: 0, use_insurance_value: false },
        products: entrada.itens.map((item) => ({
            quantity: item.qtd,
            weight: item.peso,
            height: item.A,
            width: item.L,
            length: item.C,
        })),
    }
    const resposta = await chamarComTempo(urlDaCotacaoSuperFrete(credenciais?.sandbox), {
        method: 'POST',
        headers: cabecalhosDaSuperFrete(token, userAgent),
        body: JSON.stringify(corpo),
    })
    if (!resposta.ok) throw falhaPorStatus('SuperFrete', resposta.status, resposta.texto, [token])
    const dados = lerJson('SuperFrete', resposta.texto)
    if (!Array.isArray(dados)) {
        throw new FalhaDoProvedor('indisponivel', 'SuperFrete: resposta inesperada (não é uma lista de serviços).')
    }
    const pedidos = new Set(services.split(',').filter(Boolean))
    const retornados: ServicoRetornado[] = []
    const opcoes: any[] = []
    let tokenRecusado = false
    for (const servico of dados) {
        if (!servico || typeof servico !== 'object') continue
        const codigo = codigoNoFormatoDoProvedor('superfrete', servico.id)
        const pedido = codigo !== null && Number(codigo) > 0 && pedidos.has(codigo)
        if (servico.has_error === true || servico.error) {
            const texto = typeof servico.error === 'string' ? servico.error : servico.message ?? servico.error ?? 'erro do serviço'
            const detalhe = textoSemSegredo(typeof texto === 'string' ? texto : JSON.stringify(texto), [token], 200)
            if (pedido && ERRO_DE_TOKEN.test(detalhe)) tokenRecusado = true
            retornados.push({ codigo, preco: null, preco_original: null, prazo: null, erro: true, pedido, detalhe })
            continue
        }
        const preco = precoDaApi(servico.price, { aceitaZero: false })
        const prazo = prazoDaApi(servico.delivery_time, 1)
        retornados.push({ codigo, preco, preco_original: precoDaApi(servico.price, { aceitaZero: true }), prazo, erro: false, pedido })
        if (!pedido || preco === null || prazo === null) continue
        const transportadora = textoDaApi(servico.company?.name)
        const nomeDoServico = textoDaApi(servico.name)
        opcoes.push({
            id: `superfrete-${codigo}`,
            name: nomeDaOpcao(transportadora, nomeDoServico),
            price: preco,
            deliveryDays: prazo,
            provider: 'superfrete',
            transportadora,
            servico: nomeDoServico,
            provedorRotulo: 'SuperFrete',
            cotacaoSf: VERSAO_DA_COTACAO_SUPERFRETE,
        })
    }
    if (opcoes.length === 0) falhaSeTokenRecusado('SuperFrete', tokenRecusado)
    return {
        provider: 'superfrete',
        servicosPedidos: services.split(',').filter(Boolean),
        retornados,
        opcoes: semRepetirId(opcoes),
    }
}

// ── FRENET ──────────────────────────────────────────────────────────────────

/**
 * POST https://api.frenet.com.br/shipping/quote (doc OpenAPI v2.1), header
 * `token`. `ShipmentInvoiceValue` = Σ valor do BANCO × qtd; sem o preço do
 * banco, falha fechada. Filtro por `ServiceCode` salvo (R1-5: aparado, <= 100,
 * sem controle; id `frenet-<ServiceCode>` exato); sem seleção, o filtro de
 * NOME de hoje. Preço = `ShippingPrice` (0 vale, com ou sem Original); o
 * `OriginalShippingPrice` vai só para o log.
 */
export async function cotarFrenet(credenciais: any, entrada: EntradaDaCotacao, selecao: string[] | null): Promise<ResultadoDoProvedor> {
    const token = tokenDe(credenciais)
    if (!token) throw new FalhaDoProvedor('configuracao', 'Token da Frenet ausente')
    if (selecao && selecao.length === 0) {
        throw new FalhaDoProvedor('configuracao', 'Frenet não consultada: nenhum serviço válido na seleção salva.')
    }
    if (entrada.itens.some((item) => item.valor === null)) {
        throw new FalhaDoProvedor('configuracao', 'Frenet não consultada: preço de produto indisponível no cadastro (o valor declarado vem do banco).')
    }
    const corpo = {
        SellerCEP: entrada.originCep,
        RecipientCEP: entrada.destinationCep,
        ShipmentInvoiceValue: somaDoValor(entrada.itens),
        ShippingItemArray: entrada.itens.map((item) => ({
            Weight: item.peso,
            Length: item.C,
            Height: item.A,
            Width: item.L,
            Quantity: item.qtd,
        })),
    }
    const resposta = await chamarComTempo('https://api.frenet.com.br/shipping/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'token': token },
        body: JSON.stringify(corpo),
    })
    if (!resposta.ok) throw falhaPorStatus('Frenet', resposta.status, resposta.texto, [token])
    const dados = lerJson('Frenet', resposta.texto) as any
    const lista = dados?.ShippingSevicesArray
    if (!Array.isArray(lista)) {
        throw new FalhaDoProvedor('indisponivel', 'Frenet: resposta inesperada (sem a lista de serviços).')
    }
    const pedidos = selecao ? new Set(selecao) : null
    const retornados: ServicoRetornado[] = []
    const opcoes: any[] = []
    let tokenRecusado = false
    for (const servico of lista) {
        if (!servico || typeof servico !== 'object') continue
        const codigo = codigoNoFormatoDoProvedor('frenet', servico.ServiceCode)
        const descricao = textoDaApi(servico.ServiceDescription)
        const pedido = codigo !== null && (pedidos
            ? pedidos.has(codigo)
            : entrada.chaves.length === 0 || entrada.chaves.some((chave) => servicoCasaChave(descricao, chave)))
        if (servico.Error === true) {
            const detalhe = textoSemSegredo(servico.Msg ?? 'erro do serviço', [token], 200)
            if (ERRO_DE_TOKEN.test(detalhe)) tokenRecusado = true
            retornados.push({ codigo, preco: null, preco_original: null, prazo: null, erro: true, pedido, detalhe })
            continue
        }
        const preco = precoDaApi(servico.ShippingPrice, { aceitaZero: true })
        const prazo = prazoDaApi(servico.DeliveryTime, 0)
        retornados.push({
            codigo,
            preco,
            preco_original: precoDaApi(servico.OriginalShippingPrice, { aceitaZero: true }),
            prazo,
            erro: false,
            pedido,
        })
        if (!pedido || preco === null || prazo === null) continue
        const transportadora = textoDaApi(servico.Carrier)
        opcoes.push({
            id: `frenet-${codigo}`,
            name: nomeDaOpcao(transportadora, descricao),
            price: preco,
            deliveryDays: prazo,
            provider: 'frenet',
            transportadora,
            servico: descricao,
            provedorRotulo: 'Frenet',
        })
    }
    if (opcoes.length === 0) falhaSeTokenRecusado('Frenet', tokenRecusado)
    return { provider: 'frenet', servicosPedidos: selecao ?? 'legado', retornados, opcoes: semRepetirId(opcoes) }
}

const ADAPTADORES: ReadonlyMap<string, typeof cotarFrenet> = new Map([
    ['melhor_envio', cotarMelhorEnvio],
    ['superfrete', cotarSuperFrete],
    ['frenet', cotarFrenet],
])

/** O adaptador do provedor — a MESMA função na cotação e no teste de credencial. */
export function cotarPeloProvedor(provider: string, credenciais: any, entrada: EntradaDaCotacao, selecao: string[] | null) {
    const adaptador = ADAPTADORES.get(provider)
    if (!adaptador) return Promise.reject(new FalhaDoProvedor('configuracao', `Provedor de frete desconhecido: ${provider}`))
    return adaptador(credenciais, entrada, selecao)
}

/** Quantos serviços tiveram o preço mudado por regra da conta (efetivo ≠ original). */
export function precosMudadosPelaRegra(retornados: ServicoRetornado[]): number {
    return retornados.filter((r) => !r.erro && r.preco !== null && r.preco_original !== null && r.preco !== r.preco_original).length
}
