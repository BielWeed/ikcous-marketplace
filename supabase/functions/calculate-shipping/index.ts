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
if (!isTesting) {
serve(async (req: Request) => {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    // Espelho das tres coisas que a contingencia de topo precisa saber para
    // cotar. Elas nascem `const` dentro do `try` -- o `catch` nao as enxerga,
    // e era por isso que ele so' sabia devolver um numero cravado.
    let cepDeDestino = ''
    let cepDeOrigem = ''
    let taxaDaLoja: number | undefined

    try {
        const body = await req.json()
        const { cep, cart, action } = body

        // Initialize Supabase clients
        const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
        const supabaseServiceRole = readKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY')
        const supabaseClient = createClient(supabaseUrl, supabaseServiceRole)

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
        cepDeDestino = cleanCep
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
        cepDeOrigem = originCep
        taxaDaLoja = flatFee
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
                    ]
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
                    ]
                }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // 4. If provider is flat_fee, return immediately
        if (provider === 'flat_fee' || !cart || !Array.isArray(cart) || cart.length === 0) {
            return new Response(
                JSON.stringify({ options: getFlatFeeResponse() }),
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
                JSON.stringify({ options: cachedQuote.options }),
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
                JSON.stringify({ options: getFlatFeeResponse() }),
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
                    ]
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

        // If no options returned (or API failed), use smart fallback
        if (shippingOptions.length === 0) {
            const fallbackPrice = calculateSmartFallback(originCep, cleanCep, flatFee)
            shippingOptions = [
                {
                    id: 'flat-fee-contingency',
                    name: 'Entrega Padrão (Contingência)',
                    price: fallbackPrice,
                    deliveryDays: 3,
                    provider: 'flat_fee'
                }
            ]

            // Log contingency
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
            // Save to cache
            fireAndForget(
                supabaseClient.from('shipping_quotes_cache').insert({
                    origin_cep: originCep,
                    destination_cep: cleanCep,
                    cart_hash: cartHash,
                    options: shippingOptions
                }),
                'Failed to cache shipping options:',
            )

            // Log success
            fireAndForget(
                supabaseClient.from('shipping_calculation_logs').insert({
                    origin_cep: originCep,
                    destination_cep: cleanCep,
                    provider: provider,
                    cart_items: cart,
                    response_time_ms: latency,
                    status: 'success'
                }),
                'Failed to log success:',
            )
        }

        return new Response(
            JSON.stringify({ options: shippingOptions }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )

    } catch (err) {
        console.error('[calculate-shipping] Top-level Edge Function Error:', err)
        
        // Contingência de último recurso, pela escada de região — nunca mais um
        // preço cravado. Ver `precoDeContingenciaDoTopo` no topo do arquivo.
        try {
            const preco = precoDeContingenciaDoTopo(cepDeOrigem, cepDeDestino, taxaDaLoja)

            // Sem os dois CEPs não há distância, e sem distância todo preço é
            // chute. Responder erro faz o carrinho aplicar a taxa que a lojista
            // configurou, em vez de a gente inventar uma barata por ela.
            if (preco === null) {
                return new Response(
                    JSON.stringify({ error: err.message }),
                    { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                )
            }

            const fallbackOptions = [
                {
                    id: 'flat-fee-fallback',
                    name: 'Entrega Padrão (Contingência)',
                    price: preco,
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
})
}
