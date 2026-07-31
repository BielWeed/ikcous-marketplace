// @ts-nocheck
import { serve } from "https://deno.land/std@0.177.0/http/server.ts"

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function maskEmail(email: string): string {
    const parts = email.split('@');
    if (parts.length !== 2) return '***';
    const [name, domain] = parts;
    const maskedName = name.length > 2 ? `${name[0]}***${name[name.length - 1]}` : '***';
    return `${maskedName}@${domain}`;
}

serve(async (req: Request) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        const resendApiKey = Deno.env.get('RESEND_API_KEY')
        if (!resendApiKey) {
            throw new Error('RESEND_API_KEY is not configured in Supabase environment')
        }

        // Esta função é chamada por um trigger no banco, que manda a chave secreta do
        // projeto no Authorization como segredo compartilhado.
        //
        // O projeto está migrando das chaves legadas (service_role, formato JWT) para as
        // novas (secret). Aceita as DUAS durante a migração: se aceitasse só uma, ou o
        // trigger atual pararia de passar, ou a função quebraria no dia em que as legadas
        // fossem desligadas no painel.
        const authHeader = req.headers.get('Authorization')
        const acceptedKeys: string[] = []
        try {
            const parsed = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}')
            if (parsed?.default) acceptedKeys.push(parsed.default)
        } catch {
            // variável ausente ou JSON inválido — segue só com a legada
        }
        const legacyKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
        if (legacyKey) acceptedKeys.push(legacyKey)

        const authorized =
            !!authHeader && acceptedKeys.some((key) => authHeader === `Bearer ${key}`)
        if (!authorized) {
            console.error('Unauthorized request to send-otp Edge Function')
            return new Response(
                JSON.stringify({ error: 'Unauthorized' }),
                { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        const payload = await req.json()
        console.log('Received OTP request')

        // Webhook payload format
        const { record } = payload
        if (!record) {
            throw new Error('Invalid payload: Missing record')
        }

        const { email, otp_code } = record
        if (!email) {
            throw new Error('Invalid record: Missing email')
        }
        if (!otp_code) {
            throw new Error('Invalid record: Missing otp_code')
        }

        console.log(`Sending OTP to ${maskEmail(email)}...`)

        // Send email via Resend API
        const res = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${resendApiKey}`
            },
            body: JSON.stringify({
                from: 'IKCOUS Marketplace <onboarding@resend.dev>',
                to: [email],
                subject: 'Código de Verificação - IKCOUS Marketplace',
                html: `
                    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; border: 1px solid #e4e4e7; border-radius: 24px; color: #18181b;">
                        <div style="text-align: center; margin-bottom: 24px;">
                            <h1 style="font-size: 20px; font-weight: 900; letter-spacing: -0.05em; text-transform: uppercase; margin: 0; italic: true;">IKCOUS Marketplace</h1>
                        </div>
                        <p style="font-size: 14px; line-height: 20px; color: #71717a; margin-top: 0; margin-bottom: 16px; font-weight: 500;">
                            Olá,
                        </p>
                        <p style="font-size: 14px; line-height: 20px; color: #3f3f46; margin-top: 0; margin-bottom: 24px; font-weight: 500;">
                            Você solicitou o acesso ao rastreamento de seus pedidos no IKCOUS Marketplace. Use o código de verificação abaixo para continuar:
                        </p>
                        <div style="background-color: #f4f4f5; border: 1px solid #e4e4e7; padding: 20px; text-align: center; border-radius: 16px; font-size: 32px; font-weight: 900; letter-spacing: 8px; color: #09090b; font-family: monospace; margin-bottom: 24px;">
                            ${otp_code}
                        </div>
                        <p style="font-size: 11px; line-height: 16px; color: #a1a1aa; text-align: center; margin-top: 0; margin-bottom: 24px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em;">
                            Este código expira em 15 minutos. Se você não solicitou este código, ignore este e-mail.
                        </p>
                        <div style="border-top: 1px solid #e4e4e7; padding-top: 16px; text-align: center;">
                            <p style="font-size: 11px; color: #a1a1aa; margin: 0; font-weight: 500;">
                                &copy; 2026 IKCOUS Marketplace. Monte Carmelo, MG.
                            </p>
                        </div>
                    </div>
                `
            })
        })

        if (!res.ok) {
            const errText = await res.text()
            console.error('Resend API response error:', errText)
            throw new Error(`Resend API returned status ${res.status}: ${errText}`)
        }

        const resData = await res.json()
        console.log('Resend dispatch success:', JSON.stringify(resData))

        return new Response(
            JSON.stringify({ success: true, resendId: resData.id }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    } catch (error: any) {
        console.error('OTP dispatch error:', error);
        return new Response(
            JSON.stringify({ error: error.message }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    }
})
