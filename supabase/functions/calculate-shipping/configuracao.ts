// @ts-nocheck
/**
 * CONFIGURAÇÃO DO FRETE: quem está ligado, a revisão e a assinatura do cache
 * (release 1.5.7). Contrato: §1, §3, §7 R1-1, §8 R2-1, §9 R3.
 *
 * - Modo: existe a linha `provider='_ligados'` = MULTI (ligados = a lista
 *   dela, filtrada por quem tem linha com token); não existe = LEGADO
 *   (ligados = `[store_config.shipping_provider]` se for um dos três). Ninguém
 *   lê nem escreve `ativo`.
 * - `revisaoConfig`: hash canônico, SEM segredo, do que muda o preço sem mudar
 *   o carrinho. O token e qualquer hash dele NUNCA entram.
 * - `assinaturaCotacao`: hash de `{contrato:3, revisaoConfig, insumos}`.
 */
import { ID_RETIRADA_NA_LOJA } from '../_shared/retirada-na-loja.ts'
import { aoCentavo, jsonCanonico, MEDIDA_PADRAO_CM, medidaPositivaDoBanco, PESO_PADRAO_KG, sha256Hex, valorUnitarioDoBanco } from './regua.ts'
import {
    emOrdemCanonica,
    ehProvedor,
    type ItemDoInsumo,
    seguroDoMe,
    servicosSalvos,
    tokenDe,
    VERSAO_DA_COTACAO_SUPERFRETE,
} from './provedores.ts'
import { type EstrategiaNacional, estrategiaNacionalDaLinha } from './estrategia-nacional.ts'

/** As linhas especiais de `store_shipping_credentials` que NÃO são provedor. */
export const LINHA_DOS_LIGADOS = '_ligados'
export const LINHA_DA_REVISAO = '_revisao'

/** O que a cotação e a revisão leem de `store_config` (a mesma lista nos dois). */
export const COLUNAS_DA_LOJA =
    'origin_cep, shipping_provider, shipping_fee, free_shipping_min, enabled_shipping_methods, shipping_coverage, local_delivery_fee, local_cep_range'

/**
 * As 5 colunas da estratégia NACIONAL (migration `20261171000000`) — lidas
 * numa consulta SEPARADA e tolerante (molde `lerEnderecoDaLoja`, index.ts),
 * NUNCA somadas a `COLUNAS_DA_LOJA`: em banco sem elas, o select principal
 * (que a cotação inteira depende) continuaria funcionando; misturado ali,
 * quebraria.
 */
export const COLUNAS_NACIONAIS =
    'national_shipping_strategy, national_shipping_min, national_discount_type, national_discount_value, national_benefit_scope'

/**
 * Leitura tolerante das 5 colunas nacionais: `{ok:true, estrategia}` quando a
 * linha bate com o formato esperado; `{ok:false}` em erro do PostgREST
 * (banco sem as colunas — `42703`), exceção, ou linha com forma inesperada.
 * Quem chama cai no espelho legado de `free_shipping_min` (comportamento de
 * hoje) quando a leitura falha.
 */
export async function lerEstrategiaNacionalDaLoja(supabase: any): Promise<{ ok: true; estrategia: EstrategiaNacional } | { ok: false }> {
    try {
        const { data, error } = await supabase
            .from('store_config')
            .select(COLUNAS_NACIONAIS)
            .eq('id', 1)
            .maybeSingle()
        if (error || !data) return { ok: false }
        const estrategia = estrategiaNacionalDaLinha(data)
        return estrategia ? { ok: true, estrategia } : { ok: false }
    } catch {
        return { ok: false }
    }
}

/**
 * As chaves de `enabled_shipping_methods` que falam de TRANSPORTADORA (a da
 * retirada, `store-pickup`, mora no mesmo array e não filtra serviço). Lista
 * vazia continua valendo "todas".
 */
export function chavesDeTransportadora(enabledMethods: unknown): string[] {
    if (!Array.isArray(enabledMethods)) return []
    return enabledMethods.filter((m) => m !== ID_RETIRADA_NA_LOJA)
}

/** `enabled_shipping_methods` efetivo (ausente = `['sedex','pac']`, como sempre). */
export function metodosDaLoja(config: any): unknown {
    return config?.enabled_shipping_methods || ['sedex', 'pac']
}

/**
 * `_revisao` — lida ANTES da configuração (R3-2). `{ok:true, revisao}` com o
 * uuid ou `null` sem a linha; `{ok:false}` quando a leitura falhou (quem
 * chama falha FECHADO no caminho nacional).
 */
export async function lerRevisao(supabase: any): Promise<{ ok: true; revisao: string | null } | { ok: false }> {
    try {
        const { data, error } = await supabase
            .from('store_shipping_credentials')
            .select('credentials')
            .eq('provider', LINHA_DA_REVISAO)
            .maybeSingle()
        if (error) return { ok: false }
        const revisao = data?.credentials?.revisao
        return { ok: true, revisao: typeof revisao === 'string' && revisao.length > 0 ? revisao : null }
    } catch {
        return { ok: false }
    }
}

/**
 * Todas as linhas de credencial numa consulta só, como `Map` por provider
 * (inclui `_ligados` e `_revisao`, que NÃO são provedor — quem lista
 * provedores filtra por `ehProvedor`). Erro do PostgREST = `{ok:false}`;
 * exceção sobe.
 */
export async function lerCredenciais(supabase: any): Promise<{ ok: true; linhas: Map<string, any> } | { ok: false; erro: unknown }> {
    const { data, error } = await supabase
        .from('store_shipping_credentials')
        .select('provider, credentials, updated_at')
    if (error) return { ok: false, erro: error }
    const linhas = new Map<string, any>()
    for (const linha of Array.isArray(data) ? data : []) {
        if (linha && typeof linha.provider === 'string') linhas.set(linha.provider, linha)
    }
    return { ok: true, linhas }
}

export type ConjuntoLigado = {
    modo: 'legado' | 'multi'
    /** O que a loja PEDIU ligado (multi: a lista de `_ligados`; legado: o espelho). */
    pedidos: string[]
    /** O que cota: multi = pedidos COM token; legado = o espelho (contrato §1). */
    ligados: string[]
}

/** A lista gravada em `_ligados`, só com provedores conhecidos, na ordem canônica. */
function listaDaLinhaDosLigados(linha: any): string[] {
    const lista = linha?.credentials?.ligados
    return Array.isArray(lista) ? emOrdemCanonica(lista) : []
}

export function conjuntoLigado(config: any, linhas: Map<string, any>): ConjuntoLigado {
    const linhaDosLigados = linhas.get(LINHA_DOS_LIGADOS)
    if (linhaDosLigados) {
        const pedidos = listaDaLinhaDosLigados(linhaDosLigados)
        return { modo: 'multi', pedidos, ligados: pedidos.filter((p) => tokenDe(linhas.get(p)?.credentials) !== null) }
    }
    const espelho = config?.shipping_provider
    const pedidos = ehProvedor(espelho) ? [espelho] : []
    return { modo: 'legado', pedidos, ligados: pedidos }
}

/**
 * `revisaoConfig` (R1-1 + R2-1 + R3-1): SHA-256 do JSON canônico de
 * - `store_config`: origem, espelho, métodos (sem `store-pickup`,
 *   ordenados), faixa e taxa local, grátis, taxa, cobertura;
 * - por provedor LIGADO: `{p, updated_at, servicos|'legado', seguro (ME), sandbox}`;
 * - a linha `_ligados` (updated_at e a lista) e o uuid de `_revisao`.
 * O token NUNCA entra — trocar a chave muda o `updated_at`, e é isso que muda
 * a revisão.
 *
 * `estrategiaNacional` (23/09/2026, T2): as 5 colunas nacionais entram no
 * hash SÓ quando a leitura tolerante teve sucesso (`estrategiaNacional`
 * não-nulo) — banco antigo (sem as colunas, `null` aqui) mantém EXATAMENTE o
 * hash de hoje, byte a byte.
 */
export async function calcularRevisaoConfig(
    config: any,
    linhas: Map<string, any>,
    revisao: string | null,
    estrategiaNacional: EstrategiaNacional | null = null,
): Promise<string> {
    const { ligados } = conjuntoLigado(config, linhas)
    const linhaDosLigados = linhas.get(LINHA_DOS_LIGADOS)
    const chaves = chavesDeTransportadora(metodosDaLoja(config)).map((c) => String(c)).sort()
    const dados = {
        loja: {
            origin_cep: config?.origin_cep ?? null,
            shipping_provider: config?.shipping_provider ?? null,
            enabled_shipping_methods: chaves,
            local_cep_range: config?.local_cep_range ?? null,
            local_delivery_fee: config?.local_delivery_fee ?? null,
            free_shipping_min: config?.free_shipping_min ?? null,
            shipping_fee: config?.shipping_fee ?? null,
            shipping_coverage: config?.shipping_coverage ?? null,
            ...(estrategiaNacional
                ? {
                    national_shipping_strategy: estrategiaNacional.estrategia,
                    national_shipping_min: estrategiaNacional.minimo,
                    national_discount_type: estrategiaNacional.tipoDesconto,
                    national_discount_value: estrategiaNacional.valorDesconto,
                    national_benefit_scope: estrategiaNacional.alcance,
                }
                : {}),
        },
        provedores: ligados.map((p) => {
            const linha = linhas.get(p)
            const credenciais = linha?.credentials
            return {
                p,
                updated_at: linha?.updated_at ?? null,
                servicos: servicosSalvos(p, credenciais) ?? 'legado',
                seguro: p === 'melhor_envio' ? seguroDoMe(credenciais) : undefined,
                sandbox: credenciais?.sandbox === true,
            }
        }),
        ligados: linhaDosLigados
            ? {
                updated_at: linhaDosLigados.updated_at ?? null,
                lista: Array.isArray(linhaDosLigados.credentials?.ligados) ? linhaDosLigados.credentials.ligados : null,
                atualizado_em: linhaDosLigados.credentials?.atualizado_em ?? null,
            }
            : null,
        revisao,
    }
    return await sha256Hex(jsonCanonico(dados))
}

/**
 * Os insumos do carrinho pelo BANCO (R1-1 + A2): peso e medidas campo a campo
 * pela régua da 1.5.6 (`medidaPositivaDoBanco`, padrão 0,3 kg / 15 cm só no
 * campo ruim); valor = `COALESCE(variante.price_override, produto.preco_venda)`
 * (a regra da RPC). Produto desconhecido: todos os padrões e valor `null`.
 * Na ORDEM do carrinho (o corpo das APIs segue a 1.5.6).
 */
export function montarInsumos(cart: any[], produtosPorId: Map<unknown, any>, variantesPorId: Map<unknown, any>) {
    let produtosSemCadastro = 0
    let camposPadrao = 0
    const itens: ItemDoInsumo[] = cart.map((item: any) => {
        const produtoId = item?.product?.id || item?.productId || null
        const varianteId = item?.variantId || null
        const qtd = Number(item?.quantity || 1)
        const produto = produtosPorId.get(produtoId)
        if (!produto) {
            produtosSemCadastro += 1
            return {
                produto: produtoId,
                variante: varianteId,
                qtd,
                peso: PESO_PADRAO_KG,
                C: MEDIDA_PADRAO_CM,
                L: MEDIDA_PADRAO_CM,
                A: MEDIDA_PADRAO_CM,
                valor: null,
            }
        }
        const campo = (valor: unknown, padrao: number): number => {
            const medida = medidaPositivaDoBanco(valor)
            if (medida === null) {
                camposPadrao += 1
                return padrao
            }
            return medida
        }
        const valor = valorUnitarioDoBanco(produto, varianteId ? variantesPorId.get(varianteId) : null, !!varianteId)
        return {
            produto: produtoId,
            variante: varianteId,
            qtd,
            peso: campo(produto.peso_kg, PESO_PADRAO_KG),
            C: campo(produto.comprimento_cm, MEDIDA_PADRAO_CM),
            L: campo(produto.largura_cm, MEDIDA_PADRAO_CM),
            A: campo(produto.altura_cm, MEDIDA_PADRAO_CM),
            valor: valor === null ? null : aoCentavo(valor),
        }
    })
    return { itens, produtosSemCadastro, camposPadrao }
}

/**
 * `assinaturaCotacao` (R1-1): hash de `{contrato:3, revisaoConfig, insumos}`.
 * Os insumos entram ORDENADOS por produto:variante (o `cart_hash` também não
 * depende da ordem do carrinho).
 */
export async function assinaturaDaCotacao(revisaoConfig: string, itens: ItemDoInsumo[]): Promise<string> {
    const insumos = itens
        .map((i) => ({ produto: i.produto, variante: i.variante, qtd: i.qtd, peso: i.peso, C: i.C, L: i.L, A: i.A, valor: i.valor }))
        .sort((a, b) => `${a.produto}:${a.variante}:${a.qtd}`.localeCompare(`${b.produto}:${b.variante}:${b.qtd}`))
    return await sha256Hex(jsonCanonico({ contrato: 3, revisaoConfig, insumos }))
}

/**
 * O cache do servidor serve (contrato §3 + R1-1): TODAS as opções nacionais
 * com a assinatura esperada e nenhuma parcial (e a SF com a marca
 * `cotacaoSf`). Local, grátis e retirada seguem a regra de hoje. Linha antiga
 * sem assinatura = falta (uma recotação, sem estrago).
 */
export function cotacaoDoCacheServe(options: unknown, assinatura: string): boolean {
    if (!Array.isArray(options) || options.length === 0) return false
    return options.every((opcao: any) => {
        const dono = opcao?.provider
        if (dono === 'local' || dono === 'free' || dono === 'pickup') return true
        if (!ehProvedor(dono)) return false
        if (opcao.assinaturaCotacao !== assinatura || opcao.cotacaoParcial === true) return false
        return dono !== 'superfrete' || opcao.cotacaoSf === VERSAO_DA_COTACAO_SUPERFRETE
    })
}

/**
 * Lê store_config + credenciais + `_revisao` e calcula a revisão (ação
 * pública e testes). Também lê a estratégia nacional (tolerante — banco sem
 * as colunas não muda o hash) para que o `revisao_config_frete` público (que
 * invalida o cache do celular) reaja a uma mudança de estratégia nacional
 * como reage a qualquer outra mudança de configuração.
 */
export async function revisaoConfigDaLoja(supabase: any): Promise<string | null> {
    const revisao = await lerRevisao(supabase)
    if (!revisao.ok) return null
    const { data: config, error } = await supabase.from('store_config').select(COLUNAS_DA_LOJA).eq('id', 1).single()
    if (error || !config) return null
    const credenciais = await lerCredenciais(supabase)
    if (!credenciais.ok) return null
    const leituraNacional = await lerEstrategiaNacionalDaLoja(supabase)
    return await calcularRevisaoConfig(config, credenciais.linhas, revisao.revisao, leituraNacional.ok ? leituraNacional.estrategia : null)
}
