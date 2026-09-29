// @ts-nocheck
/**
 * RÉGUA COMUM DA COTAÇÃO (release 1.5.7 — vários provedores ao mesmo tempo).
 *
 * Tudo aqui é função pura (ou quase: `sha256Hex` é assíncrona, e
 * `buscarComTempo` recebe o `fetch` de fora). É a MESMA régua para o Melhor
 * Envio, a SuperFrete e a Frenet — antes cada ramo tinha a sua (o ME fazia
 * `Number(price)` cru, a Frenet também, e só a SuperFrete validava). Contrato:
 * CONTRATO-1.5.7.md §2, §7 (R1-5) e §8 (R2-7).
 */

/** Padrões de peso (kg) e medida (cm) — os mesmos da 1.5.6. */
export const PESO_PADRAO_KG = 0.3
export const MEDIDA_PADRAO_CM = 15

/**
 * Medida do BANCO que vale como está: número finito e > 0 (ou texto
 * numérico). Ausente, null, 0, negativo, NaN, infinito, texto não numérico e
 * booleano = `null` (quem chama usa o padrão). Régua da 1.5.6, agora usada
 * pelos três provedores.
 */
export function medidaPositivaDoBanco(valor: unknown): number | null {
    const numero = typeof valor === 'number'
        ? valor
        : typeof valor === 'string' && valor.trim().length > 0 ? Number(valor) : Number.NaN
    return Number.isFinite(numero) && numero > 0 ? numero : null
}

/** Número do banco (numeric chega como number ou texto): finito e >= 0, senão `null`. */
function numeroNaoNegativoDoBanco(valor: unknown): number | null {
    const numero = typeof valor === 'number'
        ? valor
        : typeof valor === 'string' && valor.trim().length > 0 ? Number(valor) : Number.NaN
    return Number.isFinite(numero) && numero >= 0 ? numero : null
}

/**
 * Preço unitário do item pelo BANCO, com a MESMA regra da RPC do pedido
 * (`create_marketplace_order_v23/v24`): item com variação =
 * `COALESCE(variante.price_override, produto.preco_venda)`; sem variação =
 * `produto.preco_venda`. Produto desconhecido, variação pedida e não achada
 * (ou de outro produto) e preço inválido = `null` — quem precisa do valor
 * falha FECHADO (nunca o preço que o navegador mandou).
 */
export function valorUnitarioDoBanco(produto: any, variante: any, variantePedida: boolean): number | null {
    if (!produto) return null
    if (variantePedida) {
        if (!variante || (variante.product_id != null && variante.product_id !== produto.id)) return null
        if (variante.price_override !== null && variante.price_override !== undefined) {
            return numeroNaoNegativoDoBanco(variante.price_override)
        }
    }
    return numeroNaoNegativoDoBanco(produto.preco_venda)
}

/** Arredonda ao centavo (o MESMO número vai para a tela e para o cache que a RPC lê). */
export function aoCentavo(valor: number): number {
    return Math.round(valor * 100) / 100
}

/**
 * Preço vindo de API de transportadora. Aceita número, ou texto com UM
 * separador decimal (ponto ou vírgula: "11.74", "11,74"). Finito, >= 0,
 * arredondado ao centavo. Ausente, vazio, não numérico, negativo, booleano =
 * `null` (o serviço é descartado).
 *
 * `aceitaZero`: R1-5 — 0 é VÁLIDO no ME e na Frenet (regra da loja,
 * `custom_price`/`ShippingPrice`); R2-7 — na SuperFrete 0 continua
 * DESCARTADO (régua da 1.5.6).
 */
export function precoDaApi(valor: unknown, opcoes: { aceitaZero: boolean }): number | null {
    let numero = Number.NaN
    if (typeof valor === 'number') {
        numero = valor
    } else if (typeof valor === 'string') {
        const texto = valor.trim()
        // Duas regex planas (sem quantificador aninhado) no lugar de `^\d+([.,]\d+)?$`.
        if (/^\d+$/.test(texto) || /^\d+[.,]\d+$/.test(texto)) numero = Number(texto.replace(',', '.'))
    }
    if (!Number.isFinite(numero) || numero < 0) return null
    if (numero === 0 && !opcoes.aceitaZero) return null
    return aoCentavo(numero)
}

/**
 * Prazo em dias vindo de API: inteiro >= `minimo` (número inteiro ou texto
 * só de dígitos). O canônico é guardado como veio (R1-4: 0 é 0, para todo
 * cliente). A SuperFrete mantém o mínimo 1 da 1.5.6.
 */
export function prazoDaApi(valor: unknown, minimo: number): number | null {
    let numero = Number.NaN
    if (typeof valor === 'number') numero = valor
    else if (typeof valor === 'string' && /^\d+$/.test(valor.trim())) numero = Number(valor.trim())
    return Number.isInteger(numero) && numero >= minimo ? numero : null
}

/**
 * Código de serviço (R1-5): texto aparado, não vazio, <= 100 caracteres, sem
 * caractere de controle. Nada de enum nem de formato inventado. Número vira
 * texto (o ME e a SuperFrete mandam o id como número).
 */
export function codigoDeServicoValido(valor: unknown): string | null {
    let texto: string
    if (typeof valor === 'number' && Number.isFinite(valor)) texto = String(valor)
    else if (typeof valor === 'string') texto = valor.trim()
    else return null
    if (texto.length === 0 || texto.length > 100) return null
    if (temCaractereDeControle(texto)) return null
    return texto
}

/**
 * Verdadeiro se o texto tem QUALQUER caractere de controle (U+0000..U+001F,
 * U+007F..U+009F: CR, LF, TAB, NUL...). Laço por código em vez de regex com
 * faixa de controle (`no-control-regex`). Usado onde o valor vira cabeçalho
 * HTTP (e-mail de contato no User-Agent) ou chave de serviço.
 */
export function temCaractereDeControle(texto: string): boolean {
    for (let i = 0; i < texto.length; i++) {
        const codigo = texto.charCodeAt(i)
        if (codigo <= 0x1f || (codigo >= 0x7f && codigo <= 0x9f)) return true
    }
    return false
}

/**
 * Nome da opção na tela (contrato §2 + R1-7): "Entrega econômica" SÓ para o
 * PAC dos Correios e "Entrega expressa" SÓ para o SEDEX dos Correios —
 * reconhecidos pela transportadora E pelo serviço, por inteiro (nunca por
 * pedaço de texto: "Loggi Express" e ".Package" não são PAC nem SEDEX). Todo
 * o resto é "<Transportadora> — <Serviço>". Sem transportadora, o serviço.
 */
export function nomeDaOpcao(transportadora: unknown, servico: unknown): string {
    const t = typeof transportadora === 'string' ? transportadora.trim() : ''
    const s = typeof servico === 'string' ? servico.trim() : ''
    if (/correios/i.test(t)) {
        // "PAC" / "Correios PAC" (idem SEDEX), sem regex de quantificador aninhado.
        const servicoSemPrefixo = s.replace(/^correios\s+/i, '').toLowerCase()
        if (servicoSemPrefixo === 'pac') return 'Entrega econômica'
        if (servicoSemPrefixo === 'sedex') return 'Entrega expressa'
    }
    if (t && s) return `${t} — ${s}`
    return s || t
}

/**
 * JSON com as chaves de TODO objeto em ordem alfabética — a base dos hashes
 * da revisão e da assinatura. `undefined` some (como no JSON.stringify).
 */
export function jsonCanonico(valor: unknown): string {
    const ordenar = (v: unknown): unknown => {
        if (Array.isArray(v)) return v.map(ordenar)
        if (v && typeof v === 'object') {
            // Mesma ordem do `.sort()` padrão (unidade de código UTF-16).
            const pares = Object.entries(v as Record<string, unknown>)
                .filter(([, item]) => item !== undefined)
                .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
                .map(([chave, item]) => [chave, ordenar(item)] as const)
            return Object.fromEntries(pares)
        }
        return v
    }
    return JSON.stringify(ordenar(valor))
}

/** SHA-256 em hexadecimal (Web Crypto do Deno). */
export async function sha256Hex(texto: string): Promise<string> {
    const bytes = new TextEncoder().encode(texto)
    const resumo = await crypto.subtle.digest('SHA-256', bytes)
    return [...new Uint8Array(resumo)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Texto de erro de terceiro pronto para log/resposta (release 1.5.4): troca
 * cada segredo conhecido (o token da transportadora) e qualquer
 * `Bearer <algo>` por `[redacted]`, e corta no `limite`. Redige ANTES de
 * cortar: o corte nunca deixa meio token para trás.
 */
export function textoSemSegredo(texto: unknown, segredos: unknown[] = [], limite = 300): string {
    let saida = String(texto ?? '')
    for (const segredo of segredos) {
        if (typeof segredo === 'string' && segredo.length > 0) {
            saida = saida.split(segredo).join('[redacted]')
        }
    }
    saida = saida.replace(/(Bearer\s+)[^\s"',;}]+/gi, '$1[redacted]')
    if (saida.length > limite) saida = `${saida.slice(0, limite)}…`
    return saida
}

/**
 * LAUDO 31/08 (D2): fetch com TEMPO DE ESPERA. O AbortController corta no
 * tempo; quem chama vê AbortError como qualquer falha de rede. O `buscar`
 * entra como parâmetro (o fetch de fora, injetável) para o teste provar o
 * aborto com um fetch falso.
 */
export async function buscarComTempo(
    buscar: typeof fetch,
    url: string,
    init: RequestInit = {},
    tempoMs = 15000,
): Promise<Response> {
    const controle = new AbortController()
    const despertar = setTimeout(() => controle.abort(), tempoMs)
    try {
        return await buscar(url, { ...init, signal: controle.signal })
    } finally {
        clearTimeout(despertar)
    }
}
