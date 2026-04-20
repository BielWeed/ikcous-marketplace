// @ts-nocheck
import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req: Request) => {
    // Handle CORS
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        const supabaseClient = createClient(supabaseUrl, supabaseServiceKey)

        // O payload do Webhook do Supabase vem no formato:
        // { type: 'INSERT', table: 'marketplace_orders', record: { ... }, old_record: null, ... }
        const payload = await req.json()
        const { record, type, table } = payload

        if (type !== 'INSERT' || table !== 'marketplace_orders') {
            return new Response(JSON.stringify({ skipped: true, reason: 'Not an insert on marketplace_orders' }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 200
            })
        }

        const orderId = record.id
        const customerName = record.customer_name
        const customerWhatsapp = record.customer_data?.whatsapp
        const totalPrice = record.total_price || record.total || 0
        const paymentMethod = record.payment_method

        if (!customerWhatsapp) {
            console.warn(`Pedido ${orderId} sem número de WhatsApp vinculado.`)
            return new Response(JSON.stringify({ error: 'No WhatsApp number' }), { status: 200 })
        }

        // 1. Buscar itens do pedido
        const { data: items, error: itemsError } = await supabaseClient
            .from('marketplace_order_items')
            .select('product_name, quantity')
            .eq('order_id', orderId)

        if (itemsError) throw itemsError

        // 2. Buscar configurações da loja
        const { data: config, error: configError } = await supabaseClient
            .from('store_config')
            .select('whatsapp_api_url, whatsapp_api_key, whatsapp_api_instance')
            .limit(1)
            .single()

        if (configError) throw configError

        if (!config.whatsapp_api_url || !config.whatsapp_api_key || !config.whatsapp_api_instance) {
            console.log('WhatsApp API não configurada na store_config.')
            return new Response(JSON.stringify({ skipped: true, reason: 'API not configured' }), { status: 200 })
        }

        // 3. Montar a mensagem
        const itemsList = items?.map((item: any) => `- ${item.product_name} (${item.quantity}x)`).join('\n')
        const paymentLabel = paymentMethod === 'pix' ? 'Pix' : paymentMethod === 'card' ? 'Cartão' : 'Dinheiro'

        const message = `*Pedido Confirmado!* 🛍️\n\n` +
            `Olá *${customerName}*, recebemos seu pedido *#${orderId.slice(-6)}* com sucesso!\n\n` +
            `*Resumo do Pedido:*\n${itemsList}\n\n` +
            `*Total:* R$ ${Number(totalPrice).toFixed(2).replace('.', ',')}\n` +
            `*Pagamento:* ${paymentLabel}\n\n` +
            `Agradecemos a preferência!`;

        // 4. Enviar para a Evolution API
        let formattedNumber = customerWhatsapp.replace(/\D/g, '')

        // Formatação para Brasil (55)
        if (formattedNumber.length === 11 || formattedNumber.length === 10) {
            if (!formattedNumber.startsWith('55')) {
                formattedNumber = '55' + formattedNumber
            }
        }

        console.log(`Iniciando envio para ${formattedNumber} (original: ${customerWhatsapp})`)

        const response = await fetch(`${config.whatsapp_api_url}/message/sendText/${config.whatsapp_api_instance}`, {
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

        const result = await response.json()
        console.log(`Mensagem enviada para ${customerWhatsapp}:`, result)

        return new Response(JSON.stringify({ success: true, result }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200
        })

    } catch (error: any) {
        console.error('Erro na Edge Function send-order-whatsapp:', error)
        return new Response(JSON.stringify({ error: error.message }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 500
        })
    }
})
