// @ts-nocheck
import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Helper to calculate smart fallback price based on Brazilian CEP regions
export function calculateSmartFallback(origin: string, dest: string, baseFee: number): number {
    const cleanOrigin = origin.replace(/\D/g, '')
    const cleanDest = dest.replace(/\D/g, '')
    if (cleanOrigin.length === 0 || cleanDest.length === 0) return baseFee

    const oReg = cleanOrigin.charAt(0)
    const dReg = cleanDest.charAt(0)
    
    // Same region (e.g. both start with 3 - Minas Gerais)
    if (oReg === dReg) {
        return Math.max(15, baseFee); // Local/Regional: standard flat fee
    }
    
    // Close region groups
    const groups = [
        ['0', '1'], // SP
        ['8', '9'], // South (PR, SC, RS)
        ['2', '3']  // Southeast (RJ, ES, MG)
    ];
    
    let neighboring = false;
    for (const g of groups) {
        if (g.includes(oReg) && g.includes(dReg)) {
            neighboring = true;
            break;
        }
    }
    
    if (neighboring) {
        return Math.max(22, baseFee + 7); // Neighboring state/region
    }
    
    // Remote states
    return Math.max(38, baseFee + 20); // Remote regions
}

/**
 * Preço da contingência de ÚLTIMO recurso — a do `catch` de topo, quando a
 * função inteira estourou.
 *
 * POR QUE ELA EXISTE SEPARADA DE `calculateSmartFallback`
 *
 * A contingência de topo roda num ponto em que talvez nada tenha sido lido: o
 * erro pode ter vindo antes do `req.json()`, antes do `store_config`, antes de
 * qualquer coisa. Então ela precisa decidir com o que houver — e precisa poder
 * dizer "não sei", que é o caso em que `null` é devolvido.
 *
 * O QUE ELA CONSERTA
 *
 * Até 18/08/2026 esse `catch` devolvia `price: 15` cravado, para qualquer
 * destino do Brasil. A escada por região (15 / 22 / 38) já existia logo acima e
 * não era usada aqui. O efeito: toda cotação que estourasse mandava uma peça de
 * Monte Carmelo para Manaus por R$ 15, e a diferença saía do bolso da lojista,
 * sem aparecer em tela nenhuma. Cotação falha é justamente quando ninguém está
 * olhando.
 *
 * POR QUE `null` EM VEZ DE UM NÚMERO ALTO QUANDO FALTA CEP
 *
 * Sem os dois CEPs não há distância, e sem distância todo número é chute. Chute
 * barato custa o dinheiro dela; chute caro afasta a compradora. Devolver `null`
 * faz a função responder erro, e aí o carrinho aplica a taxa que a própria
 * lojista configurou no painel — número dela, escolhido por ela.
 *
 * @returns o preço em reais, ou `null` quando não há como cotar honestamente.
 *
 * ⚠️ DESLIGADA DO `catch` DE TOPO EM 25/08/2026: a escada por região que ela
 * devolve não bate com o que a RPC do checkout cobra para um id `flat-fee-%`
 * (`store_config.shipping_fee`, sempre — ver `precoResolvidoSemCache`
 * abaixo). O `catch` de topo passou então a mostrar `taxaDaLoja` direto
 * quando `taxaDaLojaConfigurada` era `true`, e falhava fechado quando não
 * era — nunca mais a estimativa por distância. FRETE V2 (03/09/2026): essa
 * contingência de taxa fixa saiu INTEIRA com o caminho de flat_fee — o
 * `catch` de topo hoje falha fechado sempre, sem preço nenhum. Esta função
 * continua exportada e testada porque descreve, isolada, um comportamento
 * que já existiu em produção; nenhum caminho do `handler` a chama mais.
 */
export function precoDeContingenciaDoTopo(
    originCep?: string,
    destCep?: string,
    flatFee?: number,
): number | null {
    const origem = (originCep ?? '').replace(/\D/g, '')
    const destino = (destCep ?? '').replace(/\D/g, '')
    if (origem.length === 0 || destino.length === 0) return null

    // `flatFee` é o piso configurado pela loja. Quando o erro impediu de lê-lo,
    // 0 deixa a escada decidir sozinha — os pisos dela (15/22/38) já protegem.
    const base = Number.isFinite(flatFee) ? (flatFee as number) : 0
    return calculateSmartFallback(origem, destino, base)
}

/**
 * Resolve se dá para cotar a partir do que a loja configurou — falhando
 * fechado quando falta CEP de origem.
 *
 * MESMO DEFEITO QUE A 1.4.0 CORRIGIU NA CONTINGÊNCIA DE TOPO, um andar acima
 * (ver `precoDeContingenciaDoTopo`): até 18/08/2026 o cálculo direto usava
 * `storeConfig.origin_cep || '38500-000'` e
 * `Number(storeConfig.shipping_fee || 15)` — loja que nunca disse de onde
 * despacha, ou quanto cobra, tinha o frete calculado a partir de Monte
 * Carmelo e de R$ 15, calada. `Number(null)` é `0` e `null || 15` é `15`:
 * os dois caminhos estavam errados. Cotação sem origem não é cotação — é
 * chute com aparência de preço.
 *
 * FRETE V2 (03/09/2026): a exigência de taxa fixa que vivia aqui (quando
 * `provider` era `'flat_fee'`) saiu JUNTO com o caminho de taxa fixa — a
 * cotação de fora da cidade agora é SÓ a de transportadora real
 * (melhor_envio/frenet), e quem decide o preço é a API dela. O que resta é a
 * origem: sem ela não há distância, e sem distância todo preço é chute.
 *
 * @returns a mensagem de erro quando falta configuração, ou `null` quando
 * pode seguir com a cotação.
 */
export function validarOrigemEFrete(originCep: string | null | undefined): string | null {
    if (!originCep) {
        return 'A loja ainda não configurou o CEP de origem do frete.'
    }
    return null
}

// FRETE V2 (03/09/2026): `flatFeeConfigurada` e `getFlatFeeResponse` — a
// checagem e a montagem da opção de taxa fixa ("Entrega Padrão" com o valor
// de `store_config.shipping_fee`) — foram REMOVIDAS junto com o caminho que
// as usava. Ordem do dono: "entrega fixa não faz sentido existir, parece
// opção duplicada". Fora da cidade o preço vem SÓ de transportadora real;
// sem ela, a resposta é a lista vazia e honesta (ver
// `respostaSemCotacaoDeFora` abaixo). `store_config.shipping_fee` fica
// órfão no banco de propósito (sem migration nesta frente).

/**
 * Dispara uma query sem bloquear a resposta, sem quebrar a função.
 *
 * O PostgrestBuilder do supabase-js implementa apenas `PromiseLike` — tem `then`,
 * mas NÃO tem `catch`. O código anterior fazia `.insert({...}).catch(...)`, o que
 * lançava `TypeError: .catch is not a function`. Esse erro subia até o try/catch
 * de topo e a função descartava as cotações reais da transportadora para devolver
 * o fallback fixo de R$ 15 — ou seja, o frete calculado nunca chegava ao cliente.
 *
 * Envolver em `Promise.resolve()` converte o thenable em Promise de verdade (o que
 * também dispara a execução da query, já que o builder é lazy) e permite tratar
 * tanto a rejeição quanto o `{ error }` que o PostgREST devolve sem rejeitar.
 */
function fireAndForget(query: PromiseLike<unknown>, label: string): void {
    Promise.resolve(query).then(
        (result) => {
            const error = (result as { error?: unknown } | null)?.error
            if (error) console.error(label, error)
        },
        (err) => console.error(label, err),
    )
}

/**
 * O oposto do `fireAndForget` acima: espera a gravação terminar e devolve o
 * erro, se houve.
 *
 * Duas formas de falhar precisam sair pelo mesmo lugar — o PostgREST devolve
 * `{ error }` sem rejeitar, e rede/permissão rejeitam a promessa. As duas
 * viram um valor de retorno, e NENHUMA vira exceção: se a exceção subisse, o
 * `catch` de topo desta função a converteria num preço de contingência com
 * status 200 — ou seja, o preço sairia mesmo sem a cotação gravada, que é
 * exatamente o defeito que este caminho existe para fechar.
 *
 * Recebe uma função (e não o builder já criado) porque o builder do
 * supabase-js é lazy: assim a query só é disparada aqui dentro, com o
 * `try/catch` já em volta.
 */
async function gravarCotacao(gravar: () => PromiseLike<unknown>): Promise<unknown | null> {
    try {
        const resultado = await gravar()
        const erro = (resultado as { error?: unknown } | null)?.error
        if (erro) {
            console.error('Failed to cache shipping options:', erro)
            return erro
        }
        return null
    } catch (err) {
        console.error('Failed to cache shipping options:', err)
        return err ?? new Error('Falha desconhecida ao gravar a cotação')
    }
}

/**
 * Texto legível de um erro que pode ser exceção (`Error`) ou objeto do
 * PostgREST (`{ message, code }`) — as duas formas que `gravarCotacao`
 * devolve. Só vai para `shipping_calculation_logs`, que é tabela de admin;
 * nunca para o corpo que a cliente recebe.
 */
function mensagemDoErro(erro: unknown): string {
    const mensagem = (erro as { message?: unknown } | null)?.message
    if (typeof mensagem === 'string' && mensagem.length > 0) return mensagem
    return String(erro)
}

/**
 * A RPC que valida o pedido resolve o preço de ALGUMAS opções direto da
 * `store_config`, sem olhar `shipping_quotes_cache`. Estas são elas.
 *
 * São DUAS RPCs, e o checkout escolhe entre elas em `useOrders.ts:1060`:
 * `create_marketplace_order_v24` no pagamento online e
 * `create_marketplace_order_v23` no resto. Um classificador só serve para as
 * duas porque os ramos de frete delas são hoje IDÊNTICOS — conferido linha a
 * linha na `20261081000000_a_regra_do_frete_gratis_mora_no_servidor.sql`
 * (corpos verbatim da `20261040000000_a_idempotencia_insere_a_chave.sql`
 * com a emenda de 03/09). Se uma `v25` chegar com ramo diferente, nada aqui
 * avisa: é preciso reconferir esta lista à mão.
 *
 * A cópia literal dos ramos — EMENDA FRETE V2 (03/09, ordem do dono "entrega
 * fixa não faz sentido existir"): os resquícios da taxa fixa que ACEITAVAM
 * `flat-fee-%` cobrando `store_config.shipping_fee` e deixavam pedido sem
 * opção cair em `COALESCE(shipping_fee, 0)` viraram FALHA FECHADA no
 * servidor:
 *
 *   ELSIF p_shipping_option_id IS NULL/''          -> RAISE EXCEPTION (sem opção escolhida)
 *   ELSIF p_shipping_option_id LIKE 'flat-fee-%'   -> RAISE EXCEPTION (taxa fixa morta)
 *   ELSIF p_shipping_option_id = 'local-delivery'  -> store_config.local_delivery_fee
 *   ELSIF p_destination_cep IS NOT NULL            -> SELECT em shipping_quotes_cache
 *   ELSE (id não reconhecido, sem CEP p/ reconciliar) -> RAISE EXCEPTION
 *
 * Ou seja: a ÚNICA opção resolvida sem cache é a ENTREGA LOCAL.
 * `melhor-envio-*` e `frenet-*` caem no SELECT do cache e são recusadas sem a
 * linha gravada; `flat-fee-%` e "sem opção" não passam NENHUMA — o servidor
 * recusa com mensagem clara pedindo entrega válida, nunca cobra preço
 * inventado ou zero.
 *
 * ⚠️ A cópia é literal sobre QUAL ramo a RPC toma, não sobre QUANTO ela
 * cobra. Opção cujo preço é CALCULADO não pode entrar neste classificador:
 * a cliente veria um preço que a RPC não honra — e as RPCs comparam o total
 * do carrinho com o que elas mesmas recalculam e RECUSAM a divergência acima
 * de cinco centavos (`ABS(v_calculated_total - p_total_amount) > 0.05` ->
 * `RAISE EXCEPTION`). Venda perdida no último clique, sem nada aparecer
 * deste lado. Errar para MENOS aqui (deixar de listar) só derruba a opção na
 * falha de gravação — o lado seguro.
 *
 * Por isso a falha de gravação não pode derrubar a resposta inteira: ela só
 * pode derrubar o que a validação do pedido realmente recusaria.
 *
 * FRETE V2 (03/09/2026): a edge NÃO PRODUZ mais ids `flat-fee-%` (o caminho
 * de taxa fixa saiu) e, com a emenda, a RPC os RECUSA em vez de cobrar a
 * taxa da loja — mantê-los neste classificador seria deixá-los vivos numa
 * resposta de falha de cache para o pedido morrer no último clique.
 */
export function precoResolvidoSemCache(id: unknown): boolean {
    if (typeof id !== 'string') return false
    return id === 'local-delivery'
}

/**
 * LAUDO 31/08 (D2): fetch com TEMPO DE ESPERA. Até hoje as quatro chamadas
 * a Melhor Envio/Frenet deste arquivo penduravam sem limite — o DNS do ME
 * já caiu de verdade nesta máquina (#356), e uma transportadora lenta
 * segurava a cotação (e o cliente) indefinidamente. O AbortController
 * corta no tempo; quem chama vê AbortError como qualquer falha de rede e
 * cai na contingência que já existe.
 *
 * O `buscar` entra como parâmetro (o fetch de fora, injetável) para o
 * index_test.ts provar o aborto com um fetch falso — em produção nada
 * muda: chama-se com o `fetch` de sempre.
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

/**
 * A resposta honesta de "não há cotação de fora da cidade": lista VAZIA, sem
 * preço inventado — e, quando há algo para a lojista consertar, a linha no
 * histórico (`shipping_calculation_logs`) dizendo O QUE falta.
 *
 * FRETE V2 (03/09/2026): substitui o que `getFlatFeeResponse` fazia nos
 * ramais sem cotação real. Fora da cidade o preço vem SÓ de transportadora
 * conectada; provedor `flat_fee` remanescente no config de loja antiga é
 * tratado aqui como "sem cotação de fora", sem explodir.
 *
 * O log é AGUARDADO pelo mesmo motivo do ramo 503 mais abaixo: aqui não há
 * preço para entregar, então esperar não atrasa ninguém — e a linha vermelha
 * com o motivo é a ÚNICA janela que a lojista tem para descobrir que precisa
 * conectar/configurar (`HistoricoCotacoesCard` pinta 'error' de vermelho).
 * Promessa não aguardada pode morrer no encerramento da instância
 * (`EarlyDrop`) — ver `gravarCotacao`.
 *
 * `log` nulo = não há nada para a lojista consertar (ex.: carrinho vazio) —
 * responde vazio SEM sujar o histórico com um erro que ninguém causou.
 *
 * A forma do corpo é a MESMA que o carrinho já consumia para "não há
 * opções" (`options: []` com `cotacaoIncompleta: false`): a tela mostra
 * nenhuma opção, nenhum preço falso, nenhum spinner eterno.
 */
async function respostaSemCotacaoDeFora(
    supabaseClient: any,
    log: {
        originCep: string
        destinationCep: string
        provider: string
        cart: unknown
        motivo: string
    } | null,
): Promise<Response> {
    if (log) {
        const logEmVoo = Promise.resolve(
            supabaseClient.from('shipping_calculation_logs').insert({
                origin_cep: log.originCep,
                destination_cep: log.destinationCep,
                provider: log.provider,
                cart_items: log.cart || [],
                response_time_ms: 0,
                status: 'error',
                error_message: log.motivo,
            }),
        )
        fireAndForget(logEmVoo, 'Failed to log missing-carrier quote:')
        await logEmVoo.catch(() => {})
    }
    return new Response(
        JSON.stringify({ options: [], cotacaoIncompleta: false }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
}

/**
 * Nome de serviço de transportadora em linguagem de gente (pedido do
 * Gabriel, 02/09: ".Package" não explica nada para o cliente).
 *
 * A API do Melhor Envio manda o nome COMERCIAL do serviço ("SEDEX",
 * ".Package", ".Package Centralizado") e a tela mostrava esse nome cru
 * com o sufixo "(Melhor Envio)" — jargão de integrador. A tradução cobre
 * os nomes conhecidos; o que não é conhecido volta LIMPO (sem o sufixo),
 * porque o sufixo dizia com quem a LOJA integrou, assunto do lojista, e
 * o cliente só decide por preço e prazo (que já aparecem no card).
 *
 * A ordem importa: ".Package Centralizado" contém "package" — a checagem
 * de "centralizado" vem antes para distinguir a modalidade; e o PAC dos
 * Correios casa por fronteira de palavra (`\bpac\b`), que NÃO casa no
 * "pac" embutido em ".package".
 */
export function nomeAmigavelDoServico(service: { name?: string }): string {
    const nome = String(service?.name || '').trim()
    const low = nome.toLowerCase()
    if (low.includes('sedex')) return 'Entrega expressa'
    if (low.includes('centralizado')) return 'Entrega econômica (centro de distribuição)'
    if (low.includes('package') || /\bpac\b/.test(low)) return 'Entrega econômica'
    if (low.includes('.com') || low.includes('express')) return 'Entrega expressa'
    return nome
}

// Helper to check if destination is a local CEP
export function isLocalCep(originCep: string, destCep: string, localCepRange?: string): boolean {
    const cleanOrigin = originCep.replace(/\D/g, '')
    const cleanDest = destCep.replace(/\D/g, '')
    
    if (cleanOrigin.length === 0 || cleanDest.length === 0) return false
    
    if (localCepRange && localCepRange.trim().length > 0) {
        // O hífen faz parte do formato do CEP brasileiro ("38500-000"), então NÃO
        // pode ser tratado como separador de faixa: a versão anterior lia
        // "38500-000, 38500-999" como duas faixas [38500..0] e [38500..999],
        // que nunca casavam com um CEP de 8 dígitos. Resultado: a faixa configurada
        // pelo lojista — exatamente no formato que o placeholder do admin ensina —
        // era sempre ignorada e ninguém recebia a taxa de entrega local.
        const destVal = Number(cleanDest.padEnd(8, '0'))
        const ranges: Array<[number, number]> = []
        const singles: string[] = []

        for (const rawToken of localCepRange.split(',')) {
            const parts = rawToken.split('-').map(p => p.replace(/\D/g, '')).filter(Boolean)
            if (parts.length === 0) continue

            // "38500000-38505000": dois blocos longos = faixa explícita.
            // "38500-000": 5+3 dígitos = um único CEP formatado.
            if (parts.length === 2 && parts[0].length >= 6 && parts[1].length >= 6) {
                const start = Number(parts[0].padEnd(8, '0'))
                const end = Number(parts[1].padEnd(8, '9'))
                ranges.push(start <= end ? [start, end] : [end, start])
            } else {
                singles.push(parts.join(''))
            }
        }

        if (ranges.some(([start, end]) => destVal >= start && destVal <= end)) {
            return true
        }

        // Formato do placeholder do admin ("38500-000, 38500-999"):
        // dois CEPs completos = início e fim de uma faixa.
        if (ranges.length === 0 && singles.length === 2 && singles.every(s => s.length === 8)) {
            const bounds = singles.map(Number).sort((a, b) => a - b)
            return destVal >= bounds[0] && destVal <= bounds[1]
        }

        // Demais casos: CEP completo casa exato; item mais curto vale como prefixo.
        return singles.some(s => (s.length === 8 ? cleanDest === s : cleanDest.startsWith(s)))
    }
    
    // Default fallback: match first 5 digits
    return cleanOrigin.slice(0, 5) === cleanDest.slice(0, 5)
}

// Helper to generate a stable, order-independent cart hash representation
export function getCartHash(cart: any[]): string {
    if (!cart || !Array.isArray(cart)) return 'empty'
    const sorted = [...cart].sort((a, b) => {
        const idA = (a.product?.id || a.productId || '') + (a.variantId || '')
        const idB = (b.product?.id || b.productId || '') + (b.variantId || '')
        return idA.localeCompare(idB)
    })
    
    return sorted.map((item: any) => {
        const prodId = item.product?.id || item.productId
        const variantId = item.variantId || ''
        const quantity = item.quantity || 1
        return `${prodId}:${variantId}:${quantity}`
    }).join(',')
}

/**
 * O projeto está migrando das chaves legadas (anon/service_role, formato JWT) para
 * as novas (publishable/secret). Durante a migração as duas coexistem: lê a nova e
 * cai pra legada. Assim esta função funciona antes E depois de as legadas serem
 * desligadas no painel — o que evita janela de indisponibilidade.
 *
 * Quando as legadas forem removidas de vez, o fallback pode sair.
 */
function readKey(newVar: string, legacyVar: string): string {
    try {
        const parsed = JSON.parse(Deno.env.get(newVar) ?? '{}')
        if (parsed?.default) return parsed.default
    } catch {
        // variável ausente ou JSON inválido — segue pro fallback
    }
    return Deno.env.get(legacyVar) ?? ''
}

// Helper to verify if the caller has admin permissions
async function verifyIsAdmin(authHeader: string | null, supabaseUrl: string, serviceRoleKey: string): Promise<boolean> {
    if (!authHeader) return false;

    try {
        const anonKey = readKey('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY')
        const userClient = createClient(supabaseUrl, anonKey, {
            global: { headers: { Authorization: authHeader } }
        });
        
        const { data: { user }, error: userError } = await userClient.auth.getUser();
        if (userError || !user) {
            console.error('[verifyIsAdmin] Auth getUser failed:', userError);
            return false;
        }
        
        const systemClient = createClient(supabaseUrl, serviceRoleKey);
        const { data: profile, error: profileError } = await systemClient
            .from('profiles')
            .select('role')
            .eq('id', user.id)
            .single();
            
        if (profileError || !profile) {
            console.error('[verifyIsAdmin] Query profile role failed:', profileError);
            return false;
        }
        
        return profile.role === 'admin';
    } catch (err) {
        console.error('[verifyIsAdmin] Exception during admin check:', err);
        return false;
    }
}

const isTesting = Deno.mainModule.endsWith("_test.ts") || Deno.mainModule.endsWith("_test.js") || Deno.mainModule.includes("index_test");

/**
 * Costura de teste, a mesma que `criar-pagamento` e `reconciliar-pagamentos`
 * já usam: o handler é uma função exportada e o cliente do Supabase pode ser
 * substituído por um dublê. Sem isso, o corpo do handler ficava dentro de
 * `serve(...)` e NENHUM teste conseguia exercitar a resposta HTTP — só as
 * funções puras do topo do arquivo. Em produção nada muda: `deps` chega vazio
 * e o cliente real é criado como sempre.
 */
export type CalculateShippingDeps = {
    supabase?: any
}

export async function handler(req: Request, deps: CalculateShippingDeps = {}): Promise<Response> {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    // FRETE V2 (03/09/2026): as variáveis `taxaDaLoja`/`taxaDaLojaConfigurada`
    // que viviam aqui alimentavam a contingência do `catch` de topo — que
    // devolvia a taxa fixa com id `flat-fee-fallback`. Ela saiu junto com o
    // caminho de taxa fixa: fora da cidade é SÓ cotação real de
    // transportadora, e exceção inesperada agora é falha fechado (500), sem
    // preço nenhum.

    try {
        const body = await req.json()
        const { cep, cart, action } = body

        // Initialize Supabase clients
        const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
        const supabaseServiceRole = readKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY')
        const supabaseClient = deps.supabase ?? createClient(supabaseUrl, supabaseServiceRole)

        // ROUTE: test_credentials
        if (action === 'test_credentials') {
            const authHeader = req.headers.get('Authorization')
            const isAdmin = await verifyIsAdmin(authHeader, supabaseUrl, supabaseServiceRole)
            
            if (!isAdmin) {
                return new Response(
                    JSON.stringify({ error: 'Não autorizado: Apenas administradores podem testar credenciais.' }),
                    { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                )
            }
            
            const { provider, credentials } = body
            if (!provider || !credentials) {
                return new Response(
                    JSON.stringify({ error: 'Provedor e credenciais são obrigatórios' }),
                    { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                )
            }
            
            const token = credentials.token
            if (!token) {
                return new Response(
                    JSON.stringify({ error: 'Token de acesso não informado.' }),
                    { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                )
            }

            try {
                if (provider === 'melhor_envio') {
                    const isSandbox = credentials.sandbox === true
                    const baseUrl = isSandbox 
                        ? 'https://sandbox.melhorenvio.com.br' 
                        : 'https://melhorenvio.com.br'
                        
                    const response = await buscarComTempo(fetch, `${baseUrl}/api/v2/me`, {
                        headers: {
                            'Accept': 'application/json',
                            'Authorization': `Bearer ${token}`,
                            'User-Agent': 'IKCOUS-Marketplace-Integration (contato@ikcous.com.br)'
                        }
                    })
                    
                    if (response.ok) {
                        const userData = await response.json()
                        return new Response(
                            JSON.stringify({ success: true, message: `Conectado à conta: ${userData.name || 'Melhor Envio'}` }),
                            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                        )
                    } else {
                        const errText = await response.text()
                        return new Response(
                            JSON.stringify({ success: false, error: `Melhor Envio (Status ${response.status}): ${errText}` }),
                            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                        )
                    }
                } else if (provider === 'frenet') {
                    const response = await buscarComTempo(fetch, 'https://api.frenet.com.br/shipping/quote', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Accept': 'application/json',
                            'token': token
                        },
                        body: JSON.stringify({
                            SellerCEP: '38500000',
                            RecipientCEP: '38500000',
                            ShipmentInvoiceValue: 10,
                            ShippingItemArray: [
                                {
                                    Weight: 0.1,
                                    Length: 10,
                                    Height: 10,
                                    Width: 10,
                                    Quantity: 1
                                }
                            ]
                        })
                    })
                    
                    if (response.ok) {
                        const data = await response.json()
                        const services = data.ShippingSevicesArray || []
                        const firstService = services[0]
                        
                        if (firstService?.Error && firstService.Msg === 'Token inválido') {
                            return new Response(
                                JSON.stringify({ success: false, error: 'Frenet retornou: Token inválido' }),
                                { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                            )
                        }
                        
                        return new Response(
                            JSON.stringify({ success: true, message: 'Conexão com a Frenet estabelecida com sucesso.' }),
                            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                        )
                    } else {
                        const errText = await response.text()
                        return new Response(
                            JSON.stringify({ success: false, error: `Frenet (Status ${response.status}): ${errText}` }),
                            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                        )
                    }
                } else {
                    return new Response(
                        JSON.stringify({ error: `Provedor de frete desconhecido: ${provider}` }),
                        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                    )
                }
            } catch (err) {
                return new Response(
                    JSON.stringify({ success: false, error: `Falha de rede: ${err.message}` }),
                    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                )
            }
        }

        // ROUTE: calculate (default flow)
        if (!cep) {
            return new Response(
                JSON.stringify({ error: 'CEP de destino é obrigatório' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // Clean CEP (only digits)
        const cleanCep = cep.replace(/\D/g, '')
        if (cleanCep.length !== 8) {
            return new Response(
                JSON.stringify({ error: 'CEP inválido' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // 1. Fetch public store configuration
        const { data: storeConfig, error: configError } = await supabaseClient
            .from('store_config')
            .select('origin_cep, shipping_provider, shipping_fee, enabled_shipping_methods, shipping_coverage, local_delivery_fee, local_cep_range')
            .eq('id', 1)
            .single()

        if (configError || !storeConfig) {
            console.error('Error fetching store config:', configError)
            throw new Error('Falha ao obter configuração da loja')
        }

        const provider = storeConfig.shipping_provider || 'flat_fee'

        // Falha fechado: sem CEP de origem, a função não calcula nada. Ver
        // `validarOrigemEFrete` acima — a exigência de taxa fixa que vivia
        // aqui saiu junto com o caminho de taxa fixa (frete v2, 03/09/2026).
        const erroDeConfiguracao = validarOrigemEFrete(storeConfig.origin_cep)
        if (erroDeConfiguracao) {
            throw new Error(erroDeConfiguracao)
        }

        const originCep = storeConfig.origin_cep.replace(/\D/g, '')
        const enabledMethods = storeConfig.enabled_shipping_methods || ['sedex', 'pac']
        
        const shippingCoverage = storeConfig.shipping_coverage || 'national'
        const localDeliveryFee = Number(storeConfig.local_delivery_fee ?? 10)
        const localCepRange = storeConfig.local_cep_range || ''

        // 2. Check if destination is local CEP
        const isLocal = isLocalCep(originCep, cleanCep, localCepRange)

        // 2. Resolve products in cart securely using the database
        const productIds = cart && Array.isArray(cart) 
            ? cart.map((item: any) => item.product?.id || item.productId).filter(Boolean)
            : []

        let dbProducts: any[] = []
        if (productIds.length > 0) {
            const { data: prods, error: prodsError } = await supabaseClient
                .from('produtos')
                .select('id, nome, preco_venda, peso_kg, largura_cm, altura_cm, comprimento_cm, frete_gratis')
                .in('id', productIds)

            if (prodsError) {
                console.error('[calculate-shipping] Error querying database products:', prodsError)
            } else {
                dbProducts = prods || []
            }
        }

        const dbProductsMap = new Map(dbProducts.map(p => [p.id, p]))

        // 3. Check if all items in the cart are free shipping
        const allFree = cart && Array.isArray(cart) && cart.length > 0 && cart.every((item: any) => {
            const prodId = item.product?.id || item.productId
            const dbProd = dbProductsMap.get(prodId)
            return !!(dbProd?.frete_gratis ?? item.product?.freeShipping)
        })

        // Se a cobertura da loja é só local, o CEP de fora não é atendido.
        if (shippingCoverage === 'local') {
            if (!isLocal) {
                return new Response(
                    JSON.stringify({ error: 'Esta loja realiza apenas entregas locais na sua região.' }),
                    { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                )
            }
            return new Response(
                JSON.stringify({
                    options: [
                        {
                            id: 'local-delivery',
                            name: 'Entrega Local',
                            price: allFree ? 0 : localDeliveryFee,
                            deliveryDays: 1,
                            provider: 'local'
                        }
                    ],
                    cotacaoIncompleta: false
                }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // Cliente LOCAL recebe SÓ a Entrega Local — mesmo com a loja
        // atendendo o Brasil inteiro (pedido do Gabriel, 02/09: na foto do
        // carrinho, um CEP da própria cidade listava SEDEX e .Package ao
        // lado da Entrega Local; o cliente da cidade não escolhe
        // transportadora nacional, e a cotação dela não custa de graça).
        // Este retorno cedo tem que vir ANTES da cotação de transportadora
        // e do cache — a partir daqui, `isLocal` é invariantemente falso em
        // todo o resto do handler.
        //
        // R3 da revisão: o caminho que existia antes (national+isLocal até
        // o fim do handler) GRAVAVA linha no `shipping_calculation_logs` —
        // era a cotação local que aparecia no "Histórico de Cotações" do
        // painel. O retorno cedo mantém esse registro (mesmo formato dos
        // outros, provider 'local'), senão a lojista perde a janela de
        // todas as cotações locais do dia.
        if (isLocal) {
            fireAndForget(
                supabaseClient.from('shipping_calculation_logs').insert({
                    origin_cep: originCep,
                    destination_cep: cleanCep,
                    provider: 'local',
                    cart_items: cart,
                    response_time_ms: 0,
                    status: 'success'
                }),
                'Failed to log local quote:',
            )
            return new Response(
                JSON.stringify({
                    options: [
                        {
                            id: 'local-delivery',
                            name: 'Entrega Local',
                            price: allFree ? 0 : localDeliveryFee,
                            deliveryDays: 1,
                            provider: 'local'
                        }
                    ],
                    cotacaoIncompleta: false
                }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        if (allFree) {
            console.log('[calculate-shipping] All cart items have free shipping. Returning 0 freight cost.')
            return new Response(
                JSON.stringify({
                    options: [
                        {
                            id: 'free-shipping-promo',
                            name: 'Frete Grátis (Promoção)',
                            price: 0,
                            deliveryDays: 3,
                            provider: 'free'
                        }
                    ],
                    cotacaoIncompleta: false
                }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // 4. SEM COTAÇÃO DE FORA quando não há transportadora real para cotar.
        //
        // FRETE V2 (03/09/2026, ordem do dono — "entrega fixa não faz
        // sentido existir, parece opção duplicada"): o caminho de TAXA FIXA
        // que vivia aqui (`getFlatFeeResponse`, opção "Entrega Padrão" com o
        // valor de `store_config.shipping_fee`) foi REMOVIDO. Fora da cidade
        // o preço vem SÓ da transportadora conectada (Melhor Envio/Frenet).
        // Restam dois casos sem o que cotar de verdade:
        //
        //   - carrinho ausente/vazio: nada para colocar na balança da
        //     cotação (a transportadora cobra por item). Nada de log de
        //     erro: não há nada para a lojista consertar.
        //   - provedor `flat_fee` remanescente no config de loja antiga
        //     (ou ausente — o default lá em cima): tratado como "sem
        //     cotação de fora", sem explodir. O motivo vai para o histórico
        //     (log de erro) — a única janela da lojista para o frete.
        //
        // A resposta é a lista VAZIA com `cotacaoIncompleta: false` — a
        // mesma forma que o carrinho já consumia para "não há opções"
        // (ver `respostaSemCotacaoDeFora`): nenhum preço inventado, nenhum
        // spinner eterno.
        if (!cart || !Array.isArray(cart) || cart.length === 0) {
            return await respostaSemCotacaoDeFora(supabaseClient, null)
        }
        if (provider === 'flat_fee') {
            return await respostaSemCotacaoDeFora(supabaseClient, {
                originCep,
                destinationCep: cleanCep,
                provider,
                cart,
                motivo: 'Loja sem transportadora conectada para entregas fora da cidade (o frete de taxa fixa foi descontinuado). Conecte Melhor Envio ou Frenet para cotar o frete nacional.',
            })
        }

        // ── CACHE LOOKUP ──
        const cartHash = getCartHash(cart)
        const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
        
        const { data: cachedQuote, error: cacheQueryError } = await supabaseClient
            .from('shipping_quotes_cache')
            .select('options')
            .eq('origin_cep', originCep)
            .eq('destination_cep', cleanCep)
            .eq('cart_hash', cartHash)
            .gt('created_at', twoHoursAgo)
            .maybeSingle()

        if (cachedQuote && !cacheQueryError && cachedQuote.options) {
            console.log(`[calculate-shipping] Caching hit for CEP: ${cleanCep}`)
            
            // Log cache hit asynchronously (fire and forget)
            fireAndForget(
                supabaseClient.from('shipping_calculation_logs').insert({
                    origin_cep: originCep,
                    destination_cep: cleanCep,
                    provider: `${provider} (Cache)`,
                    cart_items: cart,
                    response_time_ms: 0,
                    status: 'success'
                }),
                'Failed to log cache hit:',
            )

            return new Response(
                JSON.stringify({ options: cachedQuote.options, cotacaoIncompleta: false }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // 5. Fetch carrier credentials securely
        const { data: credsData, error: credsError } = await supabaseClient
            .from('store_shipping_credentials')
            .select('credentials')
            .eq('provider', provider)
            .maybeSingle()

        if (credsError || !credsData) {
            // FRETE V2 (03/09/2026): este ramo devolvia a taxa fixa como
            // "Entrega Padrão" (`getFlatFeeResponse`) — o plano B que fazia
            // loja SEM transportadora conectada aparecer cobrando fora da
            // cidade. O plano B morreu com o flat_fee: sem credencial não há
            // cotação de fora, e a resposta honesta é a lista vazia com o
            // motivo no histórico para a lojista conectar.
            console.warn(
                "Credentials not found for provider:",
                provider,
                "— responding with no out-of-city options (flat fee is gone). Error:",
                credsError
            )
            return await respostaSemCotacaoDeFora(supabaseClient, {
                originCep,
                destinationCep: cleanCep,
                provider,
                cart,
                motivo: `Sem credencial cadastrada para o provedor "${provider}". Conecte a transportadora para cotar entregas fora da cidade.`,
            })
        }

        const credentials = credsData.credentials || {}
        let shippingOptions: any[] = []
        const nonFreeCart = cart.filter((item: any) => {
            const prodId = item.product?.id || item.productId
            const dbProd = dbProductsMap.get(prodId)
            return !(dbProd?.frete_gratis ?? item.product?.freeShipping ?? false)
        })

        if (nonFreeCart.length === 0) {
            return new Response(
                JSON.stringify({
                    options: [
                        {
                            id: 'free-shipping-promo',
                            name: 'Frete Grátis (Promoção)',
                            price: 0,
                            deliveryDays: 3,
                            provider: 'free'
                        }
                    ],
                    cotacaoIncompleta: false
                }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        const apiStartTime = performance.now()
        let apiError: string | null = null

        try {
            if (provider === 'melhor_envio') {
                const token = credentials.token
                if (!token) throw new Error('Token do Melhor Envio ausente')

                const products = nonFreeCart.map((item: any) => {
                    const prodId = item.product?.id || item.productId
                    const dbProd = dbProductsMap.get(prodId)

                    const price = Number(dbProd?.preco_venda ?? item.product?.price ?? 0)
                    const weight = Number(dbProd?.peso_kg ?? 0.3)
                    const width = Number(dbProd?.largura_cm ?? 15)
                    const height = Number(dbProd?.altura_cm ?? 15)
                    const length = Number(dbProd?.comprimento_cm ?? 15)

                    return {
                        name: dbProd?.nome || item.product?.nome || 'Produto',
                        quantity: Number(item.quantity || 1),
                        unitary_weight: weight,
                        price: price,
                        width: width,
                        height: height,
                        length: length
                    }
                })

                const isSandbox = credentials.sandbox === true
                const baseUrl = isSandbox 
                    ? 'https://sandbox.melhorenvio.com.br' 
                    : 'https://melhorenvio.com.br'

                const response = await buscarComTempo(fetch, `${baseUrl}/api/v2/me/shipment/calculate`, {
                    method: 'POST',
                    headers: {
                        'Accept': 'application/json',
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`,
                        'User-Agent': 'IKCOUS-Marketplace-Integration (contato@ikcous.com.br)'
                    },
                    body: JSON.stringify({
                        from: { postal_code: originCep },
                        to: { postal_code: cleanCep },
                        products: products
                    })
                })

                if (!response.ok) {
                    const errText = await response.text()
                    throw new Error(`Melhor Envio API retornou ${response.status}: ${errText}`)
                }

                const data = await response.json()
                if (Array.isArray(data)) {
                    shippingOptions = data
                        .filter(service => !service.error && service.price)
                        .map(service => {
                            const serviceNameLower = service.name.toLowerCase()
                            const isEnabled = enabledMethods.length === 0 || enabledMethods.some((m: string) => serviceNameLower.includes(m.toLowerCase()))
                            if (!isEnabled) return null

                            return {
                                id: `melhor-envio-${service.id}`,
                                name: nomeAmigavelDoServico(service),
                                price: Number(service.price),
                                deliveryDays: Number(service.delivery_time),
                                provider: 'melhor_envio'
                            }
                        })
                        .filter(Boolean)
                }
            } 
            else if (provider === 'frenet') {
                const token = credentials.token
                if (!token) throw new Error('Token da Frenet ausente')

                const invoiceValue = nonFreeCart.reduce((sum: number, item: any) => {
                    const prodId = item.product?.id || item.productId
                    const dbProd = dbProductsMap.get(prodId)
                    const price = Number(dbProd?.preco_venda ?? item.product?.price ?? 0)
                    return sum + (price * Number(item.quantity || 1))
                }, 0)

                const items = nonFreeCart.map((item: any) => {
                    const prodId = item.product?.id || item.productId
                    const dbProd = dbProductsMap.get(prodId)

                    const weight = Number(dbProd?.peso_kg ?? 0.3)
                    const width = Number(dbProd?.largura_cm ?? 15)
                    const height = Number(dbProd?.altura_cm ?? 15)
                    const length = Number(dbProd?.comprimento_cm ?? 15)

                    return {
                        Weight: weight,
                        Length: length,
                        Height: height,
                        Width: width,
                        Quantity: Number(item.quantity || 1)
                    }
                })

                const response = await buscarComTempo(fetch, 'https://api.frenet.com.br/shipping/quote', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json',
                        'token': token
                    },
                    body: JSON.stringify({
                        SellerCEP: originCep,
                        RecipientCEP: cleanCep,
                        ShipmentInvoiceValue: invoiceValue,
                        ShippingItemArray: items
                    })
                })

                if (!response.ok) {
                    const errText = await response.text()
                    throw new Error(`Frenet API retornou ${response.status}: ${errText}`)
                }

                const data = await response.json()
                const services = data?.ShippingSevicesArray || []
                shippingOptions = services
                    .filter((s: any) => !s.Error && s.ShippingPrice)
                    .map((s: any) => {
                        const descLower = s.ServiceDescription.toLowerCase()
                        const isEnabled = enabledMethods.length === 0 || enabledMethods.some((m: string) => descLower.includes(m.toLowerCase()))
                        if (!isEnabled) return null

                        return {
                            id: `frenet-${s.ServiceCode || s.ServiceDescription}`,
                            name: nomeAmigavelDoServico({ name: s.ServiceDescription }),
                            price: Number(s.ShippingPrice),
                            deliveryDays: Number(s.DeliveryTime),
                            provider: 'frenet'
                        }
                    })
                    .filter(Boolean)
            }
        } catch (apiErr) {
            console.error("[calculate-shipping] API quotation failed for %s:", provider, apiErr)
            apiError = apiErr.message
        }

        const apiEndTime = performance.now()
        const latency = Math.round(apiEndTime - apiStartTime)

        // (O prepend de `local-delivery` que vivia aqui foi absorvido pelo
        // retorno cedo de `isLocal`, logo acima do ramo de taxa fixa: o
        // cliente local não chega mais até a cotação de transportadora.)

        // A lista devolvida é a lista INTEIRA? Só deixa de ser quando a
        // gravação da cotação falha e opções que dependiam dela são removidas
        // (ver abaixo). O campo viaja nas NOVE rotas normais de 200 — as
        // oito saídas antecipadas mais o `return` final —, inclusive quando é
        // `false`: campo que só aparece quando é verdadeiro é campo que quem
        // consome esquece de checar, e a tela passa a "funcionar" por omissão.
        //
        // FRETE V2 (03/09/2026): a DÉCIMA resposta — a contingência do
        // `catch` de topo, que respondia 200 com `fallback: true` — deixou de
        // existir junto com o flat_fee; exceção inesperada agora é 500 sem
        // preço. Toda resposta 200 com `options` leva o campo.
        let cotacaoIncompleta = false

        // Transportadora falhou ou não devolveu nenhuma opção habilitada.
        //
        // ATÉ 25/08/2026 este ramo inventava um preço por `calculateSmartFallback`
        // (estimativa por REGIÃO de CEP) e o devolvia com id `flat-fee-contingency`.
        // A RPC que valida o pedido ignora esse preço para QUALQUER id
        // `flat-fee-%` e cobra `COALESCE(store_config.shipping_fee, 0)` — ver
        // `precoResolvidoSemCache` acima e
        // `20260960000000_variacao_obrigatoria_no_servidor.sql:223-224`. Como a
        // estimativa por região quase nunca bate com a taxa fixa da loja, a
        // cliente preenchia endereço e pagamento, clicava em Finalizar, e a RPC
        // recusava por divergência de total — venda perdida no último clique,
        // sem que nada aparecesse deste lado.
        //
        // ATÉ 03/09/2026 ainda havia um SEGUNDO plano B aqui: com a taxa fixa
        // configurada, o ramo devolvia `getFlatFeeResponse()` ("Entrega
        // Padrão", preço idêntico ao que a RPC leria). FRETE V2 matou o
        // flat_fee e com ele o último plano B: fora da cidade só preço de
        // transportadora real. Sem opção real, não há preço honesto — a
        // função falha fechado (503), com o motivo no histórico.
        if (shippingOptions.length === 0) {
            // O log é AGUARDADO pelo mesmo motivo do 503: aqui não há preço
            // para entregar, então esperar não tira nada de ninguém, e é a
            // ÚNICA janela que a lojista tem para essa falha.
            //
            // O status é 'error', não 'contingency': este ramo não entrega
            // NENHUM preço — a resposta é 503 e ninguém compra. O painel
            // (`AdminShippingView.tsx`) pinta 'contingency' de âmbar,
            // reservado a "deu certo pelo plano B", e só 'error' de
            // vermelho. O irmão que gravava 'contingency' com razão (plano B
            // da taxa fixa) foi removido com o flat_fee.
            const logEmVoo = Promise.resolve(
                supabaseClient.from('shipping_calculation_logs').insert({
                    origin_cep: originCep,
                    destination_cep: cleanCep,
                    provider: provider,
                    cart_items: cart,
                    response_time_ms: latency,
                    status: 'error',
                    error_message: apiError || 'Nenhum método de envio retornado.'
                }),
            )
            fireAndForget(logEmVoo, 'Failed to log contingency:')
            await logEmVoo.catch(() => {})

            return new Response(
                JSON.stringify({ error: 'Não foi possível calcular o frete agora. Tente novamente em instantes.' }),
                { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        } else {
            // Save to cache — AGUARDANDO, e a resposta sai daqui.
            //
            // Esta linha é a cotação que a validação do pedido vai exigir na
            // hora de fechar a compra. Enquanto ela era `fireAndForget`, o
            // preço ia para o navegador com a gravação ainda em voo — e a doc
            // do Supabase é explícita: promessa não aguardada pode morrer no
            // encerramento da instância (`EarlyDrop`). A cliente então
            // preenchia endereço, escolhia pagamento, clicava em finalizar, e
            // só ali era recusada. Falhar aqui custa um clique; falhar lá
            // custa a compra inteira.
            const erroDeGravacao = await gravarCotacao(
                () => supabaseClient.from('shipping_quotes_cache').insert({
                    origin_cep: originCep,
                    destination_cep: cleanCep,
                    cart_hash: cartHash,
                    options: shippingOptions
                }),
            )

            // Log — DEPOIS de saber se a gravação deu certo, e derivado dela.
            //
            // `shipping_calculation_logs` é a única janela da lojista para o
            // frete, e o painel pinta `status === 'success'` de verde
            // "Sucesso". Enquanto a resposta era 200 com preço, gravar
            // 'success' aqui era verdade. Com a recusa abaixo, deixou de ser:
            // numa loja em que a gravação esteja falhando, ninguém compra e o
            // único lugar onde ela veria a quebra afirmaria que está tudo bem.
            //
            // A query é materializada numa Promise de verdade porque o ramo
            // que responde 503 precisa AGUARDÁ-LA (ver abaixo), e o builder do
            // supabase-js é lazy: chamar `.then` nele duas vezes gravaria duas
            // linhas. `Promise.resolve` dispara a query UMA vez, e o
            // `fireAndForget` logo abaixo recebe a Promise já pronta — para
            // ele, `Promise.resolve` de uma Promise nativa é identidade.
            const logEmVoo = Promise.resolve(
                supabaseClient.from('shipping_calculation_logs').insert({
                    origin_cep: originCep,
                    destination_cep: cleanCep,
                    provider: provider,
                    cart_items: cart,
                    response_time_ms: latency,
                    status: erroDeGravacao ? 'error' : 'success',
                    error_message: erroDeGravacao
                        ? `Falha ao gravar a cotação: ${mensagemDoErro(erroDeGravacao)}`
                        : null,
                }),
            )
            fireAndForget(logEmVoo, 'Failed to log shipping calculation:')

            if (erroDeGravacao) {
                // Sem a linha gravada, cai a opção cujo preço a validação do
                // pedido buscaria NO CACHE. O que a RPC resolve pela
                // `store_config` continua válido e continua vendável — ver
                // `precoResolvidoSemCache`. Recusar essas junto era perder uma
                // venda que o checkout teria aceitado.
                const opcoesQueDispensamOCache = shippingOptions.filter(opt => precoResolvidoSemCache(opt?.id))

                if (opcoesQueDispensamOCache.length === 0) {
                    // Aqui a recusa é a resposta certa: todo preço restante
                    // dependia da linha que não foi gravada. Responder erro
                    // AGORA é a forma barata de falhar — a cliente reaperta
                    // "calcular"; falhar no último clique custa a compra.
                    //
                    // E o log espera AQUI, pelo mesmo motivo que a gravação da
                    // cotação virou `await`: promessa não aguardada pode morrer
                    // no encerramento da instância. Neste ramo a linha do log é
                    // a ÚNICA coisa que a lojista recebe — e a falha é
                    // correlacionada, porque a mesma causa que derruba o insert
                    // do cache derruba o insert do log. Sem esperar, o sintoma
                    // dela é "ninguém compra" sem linha nenhuma no painel, nem
                    // verde nem vermelha. Custo zero: aqui não há preço para
                    // entregar, então atrasar a resposta não tira nada de
                    // ninguém — o mesmo não vale para o 200 acima.
                    //
                    // O `catch` vazio é obrigatório: `fireAndForget` já
                    // registrou o erro no console, e uma exceção solta aqui
                    // subiria ao `catch` de topo, que a converteria num 200 com
                    // preço de contingência — exatamente o que esta recusa
                    // existe para impedir.
                    await logEmVoo.catch(() => {})

                    return new Response(
                        JSON.stringify({ error: 'Não foi possível registrar a cotação de frete. Tente calcular novamente.' }),
                        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                    )
                }

                // Incompleta é sobre o que FOI TIRADO, não sobre ter havido
                // erro: se nada precisava do cache, a lista continua inteira.
                cotacaoIncompleta = opcoesQueDispensamOCache.length < shippingOptions.length
                shippingOptions = opcoesQueDispensamOCache
            }
        }

        return new Response(
            JSON.stringify({ options: shippingOptions, cotacaoIncompleta }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )

    } catch (err) {
        console.error('[calculate-shipping] Top-level Edge Function Error:', err)

        // LAUDO 31/08 (D2): o `err.message` que sobe até aqui pode carregar
        // texto de API de terceiros (o errText do Melhor Envio/Frenet vem
        // cru dentro dele) ou de banco — e até hoje esse texto era devolvido
        // AO NAVEGADOR DO CLIENTE no retorno abaixo. O detalhe que
        // presta fica no console.error acima, nos logs da função; quem paga
        // lê uma frase utilizável. (O `err.message` do caminho
        // `test_credentials` fica como está: é o painel da LOJISTA lendo o
        // erro do token DELA.)
        const mensagemSegura = 'Não foi possível calcular o frete agora. Tente novamente.'

        // MESMO DEFEITO DO OUTRO FALLBACK, NUM SEGUNDO LUGAR: até 25/08/2026
        // esta contingência de último recurso usava `precoDeContingenciaDoTopo`
        // — a escada por região de `calculateSmartFallback` — e devolvia a
        // estimativa com id `flat-fee-fallback`. A RPC que valida o pedido
        // ignora esse preço para qualquer id `flat-fee-%` e cobra
        // `COALESCE(store_config.shipping_fee, 0)` (ver `precoResolvidoSemCache`
        // acima). A escada quase nunca bate com a taxa fixa real da loja, então
        // mostrar a estimativa aqui também levava ao "os valores do pedido
        // mudaram" no último clique.
        //
        // FRETE V2 (03/09/2026): a correção intermediária — mostrar a taxa
        // fixa da loja (`taxaDaLoja`) quando configurada — foi REMOVIDA junto
        // com o flat_fee. Fora da cidade o único preço honesto é o da
        // transportadora real; exceção inesperada é falha fechado, sem preço
        // nenhum.
        return new Response(
            JSON.stringify({ error: mensagemSegura }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    }
}

// `(req) => handler(req)`, e não `serve(handler)` direto: o `serve` do std
// passa um segundo argumento (ConnInfo) que cairia em `deps`.
if (!isTesting) serve((req: Request) => handler(req));
