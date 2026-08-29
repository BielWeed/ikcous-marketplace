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
 * abaixo). O `catch` de topo agora mostra `taxaDaLoja` direto quando
 * `taxaDaLojaConfigurada` é `true`, e falha fechado quando não é — nunca mais
 * a estimativa por distância. Esta função continua exportada e testada
 * porque descreve, isolada, um comportamento que já existiu em produção;
 * nenhum caminho do `handler` a chama mais.
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
 * fechado quando falta CEP de origem ou (no frete fixo) a taxa.
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
 * A taxa fixa só é exigida quando `provider` é `'flat_fee'`: nos demais
 * provedores quem decide o preço é a API do transportador, e a taxa fixa
 * nem chega a ser usada no caminho feliz.
 *
 * @returns a mensagem de erro quando falta configuração, ou `null` quando
 * pode seguir com a cotação.
 */
export function validarOrigemEFrete(
    originCep: string | null | undefined,
    shippingFee: number | null | undefined,
    provider: string,
): string | null {
    if (!originCep) {
        return 'A loja ainda não configurou o CEP de origem do frete.'
    }
    if (provider === 'flat_fee' && (shippingFee === null || shippingFee === undefined)) {
        return 'A loja ainda não configurou a taxa de frete.'
    }
    return null
}

/**
 * Decide se a taxa fixa configurada pela loja pode virar a opção "Entrega
 * Padrão" numa cotação — usada dentro de `getFlatFeeResponse`.
 *
 * MESMO DEFEITO QUE `validarOrigemEFrete`, UM ANDAR ABAIXO: ela só exige
 * `shipping_fee` quando `provider === 'flat_fee'`, de propósito — nos demais
 * provedores quem decide o preço é a API do transportador. Mas
 * `getFlatFeeResponse` cai na taxa fixa mesmo assim quando faltam
 * credenciais do transportador (provider `melhor_envio`/`frenet` sem linha
 * em `store_shipping_credentials`), e `Number(null)` é `0`: loja que nunca
 * configurou taxa fixa E nunca cadastrou credencial cotava frete GRÁTIS
 * para o Brasil inteiro — pior que o R$ 15 cravado que existia antes da
 * Tarefa 7. A checagem olha o valor ORIGINAL (não o já convertido por
 * `Number()`), porque `Number(null)` e um `0` configurado de propósito são
 * indistinguíveis depois da conversão, e a loja pode legitimamente escolher
 * taxa fixa R$ 0.
 *
 * @returns `true` só quando `shippingFee` é um número configurado de
 * verdade (inclusive `0`, se foi essa a escolha da loja).
 */
export function flatFeeConfigurada(shippingFee: number | null | undefined): boolean {
    return shippingFee !== null && shippingFee !== undefined && Number.isFinite(Number(shippingFee))
}

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
 * linha na definição viva, `20260821000200_cupom_sem_limite_e_ilimitado.sql`
 * (v23 a partir de :138, v24 a partir de :383). Se uma `v25` chegar com ramo
 * diferente, nada aqui avisa: é preciso reconferir esta lista à mão.
 *
 * A cópia literal dos ramos:
 *
 *   ELSIF p_shipping_option_id LIKE 'flat-fee-%'   -> store_config.shipping_fee
 *   ELSIF p_shipping_option_id = 'local-delivery'  -> store_config.local_delivery_fee
 *   ELSIF p_destination_cep IS NOT NULL            -> SELECT em shipping_quotes_cache
 *
 * Ou seja: `melhor-envio-*` e `frenet-*` caem no SELECT do cache e são
 * recusadas sem a linha gravada; as duas de cima passam do mesmo jeito.
 *
 * ⚠️ A cópia é literal sobre QUAL ramo a RPC toma, não sobre QUANTO ela
 * cobra: casar o ramo NÃO BASTA, porque o preço que vai valer é o da
 * `store_config` (`COALESCE(shipping_fee, 0)` / `local_delivery_fee`). Opção
 * cujo preço é CALCULADO não pode entrar neste classificador nem que o id
 * case com o prefixo — é o caso de `flat-fee-contingency`, que sai de
 * `calculateSmartFallback` e só é inofensiva hoje porque nasce no ramo em que
 * a gravação nem chega a ser tentada; movida para o `else`, ela faria a
 * cliente ver um preço que a RPC não vai honrar — e o pedido nem chega a
 * fechar pelo da `store_config`, porque as duas RPCs comparam o total que o
 * carrinho mandou com o que elas mesmas recalculam e RECUSAM a divergência
 * acima de cinco centavos (`ABS(v_calculated_total - p_total_amount) > 0.05`
 * -> `RAISE EXCEPTION`, v23 em :212 e v24 em :457 de
 * `20260821000200_cupom_sem_limite_e_ilimitado.sql`). O prejuízo, portanto,
 * não é sangria silenciosa do bolso da lojista: é venda perdida no último
 * clique, sem que nada apareça deste lado.
 *
 * Por isso a falha de gravação não pode derrubar a resposta inteira: ela só
 * pode derrubar o que a validação do pedido realmente recusaria.
 *
 * Casa por igualdade e por prefixo exatamente como o SQL (`=` e `LIKE
 * 'flat-fee-%'`). Qualquer id que não se encaixe nesses dois ramos conta como
 * "precisa do cache" — o lado seguro é recusar, nunca vender por um preço que
 * o banco vai rejeitar no último clique.
 */
export function precoResolvidoSemCache(id: unknown): boolean {
    if (typeof id !== 'string') return false
    return id === 'local-delivery' || id.startsWith('flat-fee-')
}

/**
 * Monta o registro do `shipping_calculation_logs` para a cotação de TAXA
 * FIXA (achado 9 do laudo de 29/08: esse ramo respondia antes de gravar log
 * — o histórico da lojista nunca mostrava o provedor padrão).
 *
 * `cart || []` não é detalhe: a coluna cart_items é NOT NULL, e este ramo
 * também atende carrinho ausente/vazio de QUALQUER provedor — nesse caso o
 * provider honesto é o sufixo "(sem itens)", porque quem respondeu foi a
 * contingência da loja, não a transportadora escolhida. `status: 'empty'`
 * marca a resposta sem opção nenhuma (taxa fixa não configurada e sem
 * entrega local), para o histórico não confundir com uma cotação bem
 * sucedida. Pura e exportada para o index_test.ts provar o formato.
 */
export function montarLogDaCotacaoFlatFee(
    originCep: string,
    destinationCepLimpo: string,
    provider: string,
    cart: unknown,
    quantidadeDeOpcoes: number,
): Record<string, unknown> {
    return {
        origin_cep: originCep,
        destination_cep: destinationCepLimpo,
        provider: provider === 'flat_fee' ? 'flat_fee' : 'flat_fee (sem itens)',
        cart_items: cart || [],
        response_time_ms: 0,
        status: quantidadeDeOpcoes > 0 ? 'success' : 'empty',
    }
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

    // Espelho do que a contingencia de topo precisa saber para cotar. Nasce
    // `const` dentro do `try` -- o `catch` nao os enxerga -- e por isso a
    // contingência de baixo (a que faltava, até 18/08/2026) só sabia devolver
    // um número cravado.
    //
    // `taxaDaLoja` sozinho não basta: até 25/08/2026 a contingência de topo
    // usava `precoDeContingenciaDoTopo` (a escada por região de
    // `calculateSmartFallback`) e precisava dos CEPs para calcular a
    // distância. Essa escada foi retirada — ver o `catch` de topo abaixo —
    // porque o preço que ela inventava divergia do que a RPC realmente
    // cobra para qualquer id `flat-fee-%` (`store_config.shipping_fee`).
    // `taxaDaLojaConfigurada` é o que resta: sem ele, `taxaDaLoja` não diz se
    // é uma taxa REAL configurada pela loja ou o `0` que nasce de
    // `Number(null)` quando o provedor não é `flat_fee` e nada foi
    // configurado (ver `flatFeeConfigurada` acima). É essa distinção que
    // decide, nos dois fallbacks abaixo, entre mostrar a taxa fixa de
    // verdade ou falhar fechado — os CEPs deixaram de ser necessários porque
    // uma taxa FIXA não depende de distância nenhuma.
    let taxaDaLoja: number | undefined
    let taxaDaLojaConfigurada = false

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
                        : 'https://api.melhorenvio.com.br'
                        
                    const response = await fetch(`${baseUrl}/api/v2/me`, {
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
                    const response = await fetch('https://api.frenet.com.br/shipping/quote', {
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

        // Falha fechado: sem CEP de origem, ou sem taxa fixa quando o
        // provedor é o frete fixo, a função não calcula nada. Ver
        // `validarOrigemEFrete` acima — mesmo defeito que a 1.4.0 corrigiu
        // na contingência do topo, um andar acima.
        const erroDeConfiguracao = validarOrigemEFrete(storeConfig.origin_cep, storeConfig.shipping_fee, provider)
        if (erroDeConfiguracao) {
            throw new Error(erroDeConfiguracao)
        }

        const originCep = storeConfig.origin_cep.replace(/\D/g, '')
        const flatFee = Number(storeConfig.shipping_fee)
        taxaDaLoja = flatFee
        taxaDaLojaConfigurada = flatFeeConfigurada(storeConfig.shipping_fee)
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

        // If local-only coverage, enforce and return early
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

        // Helper: Generate fallback flat fee response
        //
        // FALHA FECHADO NA TAXA FIXA, TAMBÉM: quando o provedor não é
        // `flat_fee` (ex.: `melhor_envio`/`frenet` sem credencial
        // cadastrada), `storeConfig.shipping_fee` nunca foi exigido por
        // `validarOrigemEFrete` e pode ser `null` — e `Number(null)` é `0`.
        // Sem a checagem de `flatFeeConfigurada`, essa contingência cotava
        // frete GRÁTIS para o Brasil inteiro em vez de recusar a opção.
        // Ver `flatFeeConfigurada` acima.
        const getFlatFeeResponse = () => {
            const list = []
            if (isLocal) {
                list.push({
                    id: 'local-delivery',
                    name: 'Entrega Local',
                    price: allFree ? 0 : localDeliveryFee,
                    deliveryDays: 1,
                    provider: 'local'
                })
            } else if (flatFeeConfigurada(storeConfig.shipping_fee)) {
                list.push({
                    id: 'flat-fee-standard',
                    name: 'Entrega Padrão',
                    price: flatFee,
                    deliveryDays: 2,
                    provider: 'flat_fee'
                })
            }
            return list
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

        // 4. If provider is flat_fee, return immediately
        if (provider === 'flat_fee' || !cart || !Array.isArray(cart) || cart.length === 0) {
            const opcoes = getFlatFeeResponse()
            // Achado 9 do laudo (29/08): este ramo respondia ANTES de gravar
            // log — o "Histórico de Cotações" do painel nunca mostrava as
            // cotações da taxa fixa, o provedor padrão da loja. Mesmo
            // formato dos outros logs (fire and forget: a resposta não
            // espera o log; a falha dele só é logada no console).
            fireAndForget(
                supabaseClient.from('shipping_calculation_logs').insert(
                    montarLogDaCotacaoFlatFee(originCep, cleanCep, provider, cart, opcoes.length),
                ),
                'Failed to log flat fee quote:',
            )
            return new Response(
                JSON.stringify({ options: opcoes, cotacaoIncompleta: false }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
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
            console.warn(
                "Credentials not found for provider:",
                provider,
                "falling back to flat fee. Error:",
                credsError
            )
            return new Response(
                JSON.stringify({ options: getFlatFeeResponse(), cotacaoIncompleta: false }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
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
                    : 'https://api.melhorenvio.com.br'

                const response = await fetch(`${baseUrl}/api/v2/me/shipment/calculate`, {
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
                                name: `${service.name} (Melhor Envio)`,
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

                const response = await fetch('https://api.frenet.com.br/shipping/quote', {
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
                            name: `${s.ServiceDescription} (Frenet)`,
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

        // Prepend local option if customer is local
        if (isLocal) {
            const localOption = {
                id: 'local-delivery',
                name: 'Entrega Local',
                price: allFree ? 0 : localDeliveryFee,
                deliveryDays: 1,
                provider: 'local'
            }
            shippingOptions = [localOption, ...shippingOptions.filter(opt => opt.id !== 'local-delivery')]
        }

        // A lista devolvida é a lista INTEIRA? Só deixa de ser quando a
        // gravação da cotação falha e opções que dependiam dela são removidas
        // (ver abaixo). O campo viaja nas SETE rotas normais de 200 — as seis
        // saídas antecipadas mais o `return` final —, inclusive quando é
        // `false`: campo que só aparece quando é verdadeiro é campo que quem
        // consome esquece de checar, e a tela passa a "funcionar" por omissão.
        //
        // A oitava rota que responde 200 com `options` NÃO leva o campo: a
        // contingência do `catch` de topo, que já se identifica por
        // `fallback: true`. É o caminho de exceção inesperada, deixado como
        // está de propósito — mas quem consome não pode presumir o campo
        // presente em toda resposta com preço.
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
        // sem nada aparecer deste lado.
        //
        // A regra que fecha o buraco: só mostrar um preço que a RPC REALMENTE
        // vai cobrar. Isso só existe quando a loja configurou uma taxa fixa de
        // verdade (`flatFeeConfigurada`) — nesse caso `getFlatFeeResponse()`
        // devolve exatamente essa taxa, idêntica ao que a RPC vai ler de
        // `store_config`. Sem taxa fixa configurada não há preço honesto: a
        // função falha fechado, e o carrinho volta a usar a taxa que a própria
        // loja definiu no painel (ver `ShippingCalculator.tsx`).
        if (shippingOptions.length === 0) {
            // A guarda é o que `getFlatFeeResponse()` REALMENTE devolve, não
            // `flatFeeConfigurada` sozinha: `getFlatFeeResponse()` também
            // entrega `local-delivery` quando `isLocal`, campo que
            // `flatFeeConfigurada(storeConfig.shipping_fee)` nem olha. Hoje o
            // bloco que faz o prepend de `local-delivery` (acima) já garante
            // `shippingOptions.length >= 1` sempre que `isLocal` é `true`,
            // então este ramo só é alcançado com `isLocal` falso — mas
            // autenticar o resultado de verdade, em vez de um campo que só
            // por coincidência concorda com ele hoje, é o que impede a guarda
            // de voltar a divergir se aquele bloco for reordenado.
            const opcoesDeContingencia = getFlatFeeResponse()
            if (opcoesDeContingencia.length > 0) {
                shippingOptions = opcoesDeContingencia

                // Log contingency — não precisa aguardar: já existe um preço
                // válido para entregar, então atrasar a resposta não evita
                // nenhum prejuízo (ao contrário do ramo de erro logo abaixo).
                fireAndForget(
                    supabaseClient.from('shipping_calculation_logs').insert({
                        origin_cep: originCep,
                        destination_cep: cleanCep,
                        provider: provider,
                        cart_items: cart,
                        response_time_ms: latency,
                        status: 'contingency',
                        error_message: apiError || 'Nenhum método de envio retornado.'
                    }),
                    'Failed to log contingency:',
                )
            } else {
                // Sem taxa fixa configurada, todo preço aqui seria chute. O log
                // é AGUARDADO pelo mesmo motivo do 503 mais abaixo: aqui não há
                // preço para entregar, então esperar não tira nada de ninguém, e
                // é a ÚNICA janela que a lojista tem para essa falha.
                //
                // O status é 'error', não 'contingency': este ramo não entrega
                // NENHUM preço — a resposta é 503 e ninguém compra. O painel
                // (`AdminShippingView.tsx`) pinta 'contingency' de âmbar,
                // reservado a "deu certo pelo plano B", e só 'error' de
                // vermelho. O irmão deste ramo, logo acima, entrega preço de
                // verdade e por isso continua 'contingency' com razão — aqui
                // não há razão nenhuma.
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
            }
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
        // A correção é a mesma: só mostrar um preço que a RPC vai honrar. Isso
        // só existe quando `store_config` já foi lida com sucesso (senão nem
        // `taxaDaLojaConfigurada` teria como ser `true`) E a loja tem uma taxa
        // fixa configurada de verdade — nesse caso o preço mostrado é
        // `taxaDaLoja`, o MESMO valor que a RPC vai ler de
        // `store_config.shipping_fee`, sem passar pela escada. Sem isso, não há
        // preço honesto: falha fechado, exatamente como quando faltam os CEPs.
        try {
            if (!taxaDaLojaConfigurada) {
                return new Response(
                    JSON.stringify({ error: err.message }),
                    { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                )
            }

            const fallbackOptions = [
                {
                    id: 'flat-fee-fallback',
                    name: 'Entrega Padrão (Contingência)',
                    price: taxaDaLoja,
                    deliveryDays: 2,
                    provider: 'flat_fee'
                }
            ]
            return new Response(
                JSON.stringify({ options: fallbackOptions, fallback: true, error: err.message }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        } catch {
            return new Response(
                JSON.stringify({ error: err.message }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }
    }
}

// `(req) => handler(req)`, e não `serve(handler)` direto: o `serve` do std
// passa um segundo argumento (ConnInfo) que cairia em `deps`.
if (!isTesting) serve((req: Request) => handler(req));
