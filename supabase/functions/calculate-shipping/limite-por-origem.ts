// @ts-nocheck
/**
 * LIMITE DE COTAÇÕES POR ORIGEM (Frente E / E1, 26/10/2026).
 *
 * O DEFEITO: a `calculate-shipping` é pública (a cotação do carrinho roda com a chave pública do
 * app). Quem chamasse em laço, variando o CEP para driblar o cache, gastava a cota do token da
 * transportadora (Melhor Envio, Frenet, SuperFrete — o token é da lojista) e enchia
 * `shipping_calculation_logs` e `shipping_quotes_cache`. Não existia limite por origem.
 *
 * O QUE ESTE ARQUIVO FAZ: dá a cada origem (IP) um teto de COTAÇÕES DE VERDADE — as que vão à
 * transportadora — por janela curta. Quem conta é o BANCO (RPC `frete_consumir_cota`, migration
 * 20261389000000): o estado em memória de uma edge não serve, porque cada instância é efêmera e
 * há várias ao mesmo tempo.
 *
 * O TETO — 60 cotações novas por 5 minutos por origem:
 *  - Uso normal: a cliente digita o CEP (1 cotação), erra e corrige (2–3), troca a quantidade de
 *    um item (1 por troca, com debounce) e a tela de carrinho pede a "economia do frete" (mais 1
 *    por combinação). Uma sessão apertada chega a ~10 em 5 minutos; 60 é 6x isso.
 *  - Rede compartilhada (loja, escritório, operadora móvel que reparte um IP): ainda cabem várias
 *    clientes ao mesmo tempo antes de alguém sentir o teto.
 *  - Abuso: 60 por 5 min é 12 por minuto (~17 mil por dia) por origem — o laço que esgotava a cota
 *    em segundos agora precisa de MUITOS IPs, e cada um é barrado ao passar do teto.
 *  Só contam as passadas que CHEGARIAM à transportadora: acerto de cache, erro de validação,
 *  entrega local, ação do painel e origem sem identidade NÃO contam.
 *
 * FALHA ABERTA, DE PROPÓSITO: se o contador não responde (banco fora, rede, função ausente porque
 * a migration ainda não chegou à loja, resposta estranha, prazo), a cotação SEGUE e o aviso vai
 * para o log (sem IP e sem texto cru do erro). Frete é a hora em que a cliente decide comprar;
 * derrubá-lo porque o CONTADOR falhou trocaria um risco de custo (cota do token) por um prejuízo
 * certo (venda perdida). Publicar a edge antes da migration, portanto, não derruba nada: só deixa o
 * limite sem efeito até a migration chegar.
 *
 * A ORIGEM — de onde vem o IP, e por que não se confia no que o visitante manda:
 *  1. `cf-connecting-ip`: a Cloudflare (que fica na frente do gateway do Supabase) SOBRESCREVE esse
 *     cabeçalho; o visitante não escolhe.
 *  2. `x-forwarded-for`: o visitante pode mandar o que quiser à ESQUERDA, e cada salto ACRESCENTA o
 *     IP que viu à DIREITA. Vale então o ENTRADA MAIS À DIREITA que é IP público; salto interno
 *     (privado/loopback) é pulado, para um proxy de dentro nunca juntar todo mundo num balde só.
 *  3. Sem nenhum dos dois, a origem é desconhecida e o limite não se aplica (um balde "desconhecido"
 *     compartilhado barraria clientes de verdade, e é o pior erro possível aqui).
 *  IPv6 vale pelo bloco /64: o provedor entrega um /64 (ou maior) por casa; um endereço novo a cada
 *  chamada, dentro do mesmo bloco, não pode fugir do teto.
 *  UNVERIFIED: quais desses cabeçalhos o gateway real entrega à função não foi medido nesta
 *  máquina (sem chamada à produção); as duas leituras acima seguem o relato público do Supabase
 *  (discussão #34647) e a doc da Cloudflare. A primeira cotação real após a publicação mostra,
 *  no log do contador, se a origem veio (ver `origem_desconhecida` abaixo).
 *
 * PRIVACIDADE: o banco recebe só um HASH (SHA-256 truncado) do IP, nunca o IP; o log nunca o traz.
 */

/** Cotações novas (que vão à transportadora) permitidas por origem em cada janela. */
export const COTACOES_POR_JANELA = 60
/** Janela fixa do contador, em segundos. */
export const JANELA_EM_SEGUNDOS = 300
/** Quanto a cotação espera o contador antes de seguir sem ele. */
export const PRAZO_DO_CONTADOR_MS = 2000

export type VeredictoDaCota = { bloqueado: false } | { bloqueado: true; esperarSegundos: number }

// ── Origem ──────────────────────────────────────────────────────────────────────────────────

type IpLido = { texto: string; privado: boolean }

function lerIpv4(bruto: string): IpLido | null {
    const partes = bruto.split('.')
    if (partes.length !== 4) return null
    const octetos: number[] = []
    for (const parte of partes) {
        if (!/^\d{1,3}$/.test(parte)) return null
        const n = Number(parte)
        if (n > 255) return null
        octetos.push(n)
    }
    const [a, b] = octetos
    const privado =
        a === 0 || a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
        (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127) || a >= 224
    return { texto: octetos.join('.'), privado }
}

function lerIpv6(bruto: string): IpLido | null {
    if (!bruto.includes(':') || bruto.length > 45 || bruto.includes('%')) return null
    // Cauda em IPv4 ("::ffff:203.0.113.7"): vira dois grupos de 16 bits.
    let texto = bruto
    const ultimoDoisPontos = texto.lastIndexOf(':')
    const cauda = texto.slice(ultimoDoisPontos + 1)
    if (cauda.includes('.')) {
        const v4 = lerIpv4(cauda)
        if (!v4) return null
        const [a, b, c, d] = v4.texto.split('.').map(Number)
        texto = `${texto.slice(0, ultimoDoisPontos + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`
    }
    const pedacos = texto.split('::')
    if (pedacos.length > 2) return null
    const grupos = (s: string) => (s === '' ? [] : s.split(':'))
    const inicio = grupos(pedacos[0])
    const fim = pedacos.length === 2 ? grupos(pedacos[1]) : []
    if (pedacos.length === 1 && inicio.length !== 8) return null
    const faltam = 8 - inicio.length - fim.length
    if (pedacos.length === 2 && faltam < 1) return null
    const todos = pedacos.length === 2 ? [...inicio, ...Array(faltam).fill('0'), ...fim] : inicio
    if (todos.length !== 8 || !todos.every((g) => /^[0-9a-fA-F]{1,4}$/.test(g))) return null
    const n = todos.map((g) => parseInt(g, 16))
    // IPv4 mapeado em IPv6 (::ffff:a.b.c.d): vale como o IPv4.
    if (n.slice(0, 5).every((x) => x === 0) && n[5] === 0xffff) {
        return lerIpv4(`${n[6] >> 8}.${n[6] & 255}.${n[7] >> 8}.${n[7] & 255}`)
    }
    const privado =
        n.every((x) => x === 0) || (n.slice(0, 7).every((x) => x === 0) && n[7] === 1) ||
        (n[0] & 0xfe00) === 0xfc00 || (n[0] & 0xffc0) === 0xfe80 || (n[0] & 0xff00) === 0xff00
    // O bloco /64: os quatro primeiros grupos.
    return { texto: `${n.slice(0, 4).map((x) => x.toString(16)).join(':')}::/64`, privado }
}

function lerIp(bruto: string | null | undefined): IpLido | null {
    const texto = String(bruto ?? '').trim()
    if (!texto || texto.length > 45) return null
    return lerIpv4(texto) ?? lerIpv6(texto)
}

/**
 * O IP (IPv6: o bloco /64) de quem chamou, ou `null` quando não há como saber com segurança.
 * Ver o comentário do arquivo sobre qual cabeçalho vale e por quê.
 */
export function origemDaRequisicao(cabecalhos: Headers): string | null {
    const daCloudflare = lerIp(cabecalhos.get('cf-connecting-ip'))
    if (daCloudflare && !daCloudflare.privado) return daCloudflare.texto

    const encaminhados = (cabecalhos.get('x-forwarded-for') ?? '').split(',')
    // Da direita para a esquerda: a direita é o que o gateway acrescentou; a esquerda é do visitante.
    for (const bruto of encaminhados.reverse()) {
        const ip = lerIp(bruto)
        if (!ip) return null // lixo no meio do caminho: não adivinha, não confia.
        if (!ip.privado) return ip.texto
    }
    return null
}

/** O que o banco guarda no lugar do IP: SHA-256 (32 primeiros hex) do IP com um prefixo próprio. */
export async function chaveDaOrigem(origem: string): Promise<string> {
    const bytes = new TextEncoder().encode(`frete-cota|${origem}`)
    const resumo = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
    return Array.from(resumo, (b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32)
}

// ── O contador ──────────────────────────────────────────────────────────────────────────────

function avisoDoContador(motivo: string, codigo?: unknown) {
    // Só um motivo CLASSIFICADO (e o código SQLSTATE, se houver): nunca IP, nunca texto cru do erro.
    const sqlstate = typeof codigo === 'string' && /^[0-9A-Z]{5,8}$/.test(codigo) ? codigo : undefined
    console.warn(JSON.stringify({ evento: 'contador_de_cotacoes_indisponivel', motivo, ...(sqlstate ? { codigo: sqlstate } : {}) }))
}

/**
 * Gasta UMA unidade da cota da origem de `cabecalhos` e diz se a cotação pode seguir.
 * Nunca lança: qualquer falha do contador vira "pode seguir" + aviso no log (falha aberta).
 */
export async function consumirCotaDaOrigem(
    supabase: any,
    cabecalhos: Headers,
    opcoes: { prazoMs?: number } = {},
): Promise<VeredictoDaCota> {
    let temporizador: ReturnType<typeof setTimeout> | undefined
    try {
        const origem = origemDaRequisicao(cabecalhos)
        if (!origem) {
            avisoDoContador('origem_desconhecida')
            return { bloqueado: false }
        }
        if (typeof supabase?.rpc !== 'function') {
            avisoDoContador('sem_rpc')
            return { bloqueado: false }
        }
        const chamada = Promise.resolve(supabase.rpc('frete_consumir_cota', {
            p_origem: await chaveDaOrigem(origem),
            p_limite: COTACOES_POR_JANELA,
            p_janela_segundos: JANELA_EM_SEGUNDOS,
        }))
        const prazo = new Promise<never>((_, rejeita) => {
            temporizador = setTimeout(() => rejeita(new Error('prazo')), opcoes.prazoMs ?? PRAZO_DO_CONTADOR_MS)
        })
        const resposta: any = await Promise.race([chamada, prazo])
        if (resposta?.error) {
            avisoDoContador('erro_do_banco', resposta.error?.code)
            return { bloqueado: false }
        }
        const dado = resposta?.data
        if (dado && typeof dado === 'object' && dado.permitido === true) return { bloqueado: false }
        if (dado && typeof dado === 'object' && dado.permitido === false) {
            const espera = Number(dado.espere_segundos)
            const esperarSegundos = Number.isFinite(espera) ? Math.min(Math.max(Math.ceil(espera), 1), JANELA_EM_SEGUNDOS) : JANELA_EM_SEGUNDOS
            return { bloqueado: true, esperarSegundos }
        }
        avisoDoContador('resposta_fora_do_contrato')
        return { bloqueado: false }
    } catch (erro) {
        avisoDoContador((erro as Error)?.message === 'prazo' ? 'prazo' : 'excecao')
        return { bloqueado: false }
    } finally {
        if (temporizador !== undefined) clearTimeout(temporizador)
    }
}

/** Texto para a cliente: simples, sem jargão, sem culpa, com o tempo certo em minutos. */
export function mensagemDoLimite(esperarSegundos: number): string {
    const minutos = Math.max(1, Math.ceil(esperarSegundos / 60))
    return `Muitas consultas de frete em pouco tempo. Aguarde ${minutos} ${minutos === 1 ? 'minuto' : 'minutos'} e tente de novo.`
}
