// @ts-nocheck
import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { numeroDoPedido } from "../_shared/pedido.ts"

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface DadosDaMensagem {
    orderId: string
    customerName: string
    itemsList?: string
    totalPrice: number | string
    paymentMethod: string
}

// Texto que o cliente recebe no WhatsApp. Separado do handler para o teste
// medir a mensagem sem rede nem banco.
export function montarMensagem({ orderId, customerName, itemsList, totalPrice, paymentMethod }: DadosDaMensagem): string {
    const paymentLabel = paymentMethod === 'pix' ? 'Pix' : paymentMethod === 'card' ? 'Cartão' : 'Dinheiro'

    return `*Pedido Confirmado!* 🛍️\n\n` +
        `Olá *${customerName}*, recebemos seu pedido *${numeroDoPedido(orderId)}* com sucesso!\n\n` +
        `*Resumo do Pedido:*\n${itemsList}\n\n` +
        `*Total:* R$ ${Number(totalPrice).toFixed(2).replace('.', ',')}\n` +
        `*Pagamento:* ${paymentLabel}\n\n` +
        `Agradecemos a preferência!`;
}

// Em teste o módulo só é importado: não sobe o servidor.
const emTeste =
    Deno.mainModule.endsWith('_test.ts') ||
    Deno.mainModule.endsWith('_test.js') ||
    Deno.mainModule.includes('index_test')

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Comparação em tempo constante (mesma razão do `segredoConfere` da
// reconciliar-pagamentos): `===` vaza, pelo tempo de resposta, quantos
// caracteres do prefixo já batem.
function iguais(esperado: string, recebido: string): boolean {
    if (esperado.length !== recebido.length) return false
    let diferenca = 0
    for (let i = 0; i < esperado.length; i++) {
        diferenca |= esperado.charCodeAt(i) ^ recebido.charCodeAt(i)
    }
    return diferenca === 0
}

// Quem pode mandar WhatsApp ao cliente: SÓ o chamador de servidor — o gatilho do
// banco que a chamava, com a chave de serviço no Authorization. Não há chave
// nova: é a mesma que o projeto já tem. O `verify_jwt` padrão da plataforma
// deixa passar até a chave pública (anon) e o JWT de qualquer comprador, então
// a porta é esta; sem chave de serviço no ambiente ninguém passa (falha fechada).
export function chamadorEhServidor(authorization: string | null, chavesDeServico: string[]): boolean {
    const m = /^Bearer (.+)$/.exec(authorization ?? '')
    if (!m) return false
    const recebido = m[1]
    let ok = false
    for (const chave of chavesDeServico) {
        if (chave && iguais(chave, recebido)) ok = true
    }
    return ok
}

const json = (corpo: unknown, status = 200) =>
    new Response(JSON.stringify(corpo), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status,
    })

interface Dependencias {
    supabase: any            // cliente com a chave de serviço (lê o pedido)
    chavesDeServico: string[] // o que vale como "chamador de servidor"
    fetchImpl?: typeof fetch  // costura de teste: em produção, o fetch global
}

export async function processar(req: Request, deps: Dependencias): Promise<Response> {
    // 1. Autorização ANTES de qualquer outra coisa: nem o corpo é lido, nem o
    //    banco é consultado, nem a Evolution é chamada.
    if (!chamadorEhServidor(req.headers.get('authorization'), deps.chavesDeServico)) {
        console.warn('[send-order-whatsapp] chamada recusada: sem credencial de servidor.')
        return json({ error: 'Não autorizado.' }, 401)
    }

    const supabaseClient = deps.supabase
    const fetchImpl = deps.fetchImpl ?? fetch
    let orderId = ''

    try {
        // 2. Do corpo só vale o `order_id`. Telefone, nome, valor e forma de
        //    pagamento vêm do BANCO — o corpo nunca decide quem recebe o quê.
        const corpo = await req.json().catch(() => null)
        const idDoCorpo = corpo?.order_id
        if (typeof idDoCorpo !== 'string' || !UUID.test(idDoCorpo)) {
            return json({ error: 'order_id obrigatório (uuid).' }, 400)
        }
        orderId = idDoCorpo

        const { data: pedido, error: pedidoError } = await supabaseClient
            .from('marketplace_orders')
            .select('id, customer_name, customer_data, total, payment_method')
            .eq('id', orderId)
            .maybeSingle()

        if (pedidoError) throw pedidoError
        if (!pedido) {
            console.warn(`[send-order-whatsapp] pedido ${numeroDoPedido(orderId)} não encontrado.`)
            return json({ error: 'Pedido não encontrado.' }, 404)
        }

        const customerWhatsapp = pedido.customer_data?.whatsapp

        if (!customerWhatsapp) {
            console.warn(`[send-order-whatsapp] pedido ${numeroDoPedido(orderId)} sem número de WhatsApp vinculado.`)
            return new Response(JSON.stringify({ error: 'No WhatsApp number' }), { status: 200 })
        }

        // 3. Buscar itens do pedido
        const { data: items, error: itemsError } = await supabaseClient
            .from('marketplace_order_items')
            .select('product_name, quantity')
            .eq('order_id', orderId)

        if (itemsError) throw itemsError

        // 4. Buscar configurações da loja
        const { data: config, error: configError } = await supabaseClient
            .from('store_config')
            .select('whatsapp_api_url, whatsapp_api_key, whatsapp_api_instance')
            .limit(1)
            .single()

        if (configError) throw configError

        if (!config.whatsapp_api_url || !config.whatsapp_api_key || !config.whatsapp_api_instance) {
            console.log('[send-order-whatsapp] WhatsApp API não configurada na store_config.')
            return json({ skipped: true, reason: 'API not configured' })
        }

        // 5. Montar a mensagem
        const itemsList = items?.map((item: any) => `- ${item.product_name} (${item.quantity}x)`).join('\n')
        const message = montarMensagem({
            orderId,
            customerName: pedido.customer_name,
            itemsList,
            totalPrice: pedido.total,
            paymentMethod: pedido.payment_method,
        })

        // 6. Enviar para a Evolution API
        let formattedNumber = String(customerWhatsapp).replace(/\D/g, '')

        // Formatação para Brasil (55)
        if (formattedNumber.length === 11 || formattedNumber.length === 10) {
            if (!formattedNumber.startsWith('55')) {
                formattedNumber = '55' + formattedNumber
            }
        }

        const response = await fetchImpl(`${config.whatsapp_api_url}/message/sendText/${config.whatsapp_api_instance}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': config.whatsapp_api_key
            },
            body: JSON.stringify({
                number: formattedNumber,
                text: message,
                linkPreview: false
            })
        })
        // O retorno da Evolution pode ecoar o telefone: é consumido e descartado,
        // não vai para o log nem para a resposta.
        await response.text()

        // Log só com o número do pedido: sem telefone, nome ou endereço.
        console.log(`[send-order-whatsapp] pedido ${numeroDoPedido(orderId)}: envio respondeu HTTP ${response.status}.`)

        return json({ success: true })

    } catch (error: any) {
        // Só o tipo do erro: a mensagem de uma falha de banco ou de rede pode
        // trazer o valor que falhou (telefone, nome).
        const motivo = String(error?.code ?? error?.name ?? 'erro')
        console.error(`[send-order-whatsapp] falha ao processar o pedido ${orderId ? numeroDoPedido(orderId) : '(sem id)'}: ${motivo}`)
        return json({ error: 'Falha ao processar o pedido.' }, 500)
    }
}

// Chaves que valem como "servidor": a nova (SUPABASE_SECRET_KEYS.default) e a
// legada (SUPABASE_SERVICE_ROLE_KEY) coexistem durante a migração (#126).
function chavesDeServicoDoAmbiente(): string[] {
    const chaves: string[] = []
    try {
        const nova = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}')?.default
        if (nova) chaves.push(nova)
    } catch {
        // variável ausente ou JSON inválido — segue para a legada
    }
    const legada = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (legada) chaves.push(legada)
    return chaves
}

if (!emTeste) serve(async (req: Request) => {
    // Handle CORS
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const chavesDeServico = chavesDeServicoDoAmbiente()
    return processar(req, {
        supabase: createClient(supabaseUrl, chavesDeServico[0] ?? ''),
        chavesDeServico,
    })
})
