// @ts-nocheck
import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import * as webpush from "jsr:@negrel/webpush@0.3.0"

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req: Request) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        const supabaseClient = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        )

        // Security check: Verify user is admin
        const authHeader = req.headers.get('Authorization');
        if (!authHeader) {
            console.error('send-push: Missing Authorization header');
            throw new Error('Missing Authorization header');
        }

        const token = authHeader.replace(/^Bearer\s+/i, '');
        const { data: { user }, error: userError } = await supabaseClient.auth.getUser(token);

        if (userError || !user) {
            console.error('send-push: Auth verification failed', userError);
            throw new Error('Not authenticated');
        }

        const { data: profile, error: profileError } = await supabaseClient
            .from('profiles')
            .select('role')
            .eq('id', user.id)
            .single()

        if (profileError || profile?.role !== 'admin') {
            throw new Error('Unauthorized: Admin access required')
        }

        const payload = await req.json()
        const { title, body, url, targetUserId } = payload

        console.log(`Sending push notification: ${title} - ${body} (Target: ${targetUserId || 'All'})`)

        // Fetch subscriptions (selective or all)
        const query = supabaseClient.from('push_subscriptions').select('*')
        if (targetUserId) {
            query.eq('user_id', targetUserId)
        }

        const { data: subscriptions, error: subError } = await query

        if (subError) throw subError

        const vapidKeys = {
            publicKey: Deno.env.get('VAPID_PUBLIC_KEY')!,
            privateKey: Deno.env.get('VAPID_PRIVATE_KEY')!,
        }

        if (!vapidKeys.publicKey || !vapidKeys.privateKey) {
            throw new Error('VAPID keys not configured in environment variables')
        }

        const results = await Promise.allSettled(
            (subscriptions || []).map(async (sub: any) => {
                try {
                    const pushSubscription = {
                        endpoint: sub.endpoint,
                        keys: {
                            p256dh: sub.p256dh,
                            auth: sub.auth,
                        }
                    };

                    const notificationPayload = JSON.stringify({
                        title,
                        body,
                        url: url || '/'
                    });

                    await webpush.sendNotification(pushSubscription, notificationPayload, {
                        vapidDetails: {
                            subject: 'mailto:admin@ikcous.com',
                            publicKey: vapidKeys.publicKey,
                            privateKey: vapidKeys.privateKey,
                        },
                    });

                    return { success: true, endpoint: sub.endpoint };
                } catch (err: any) {
                    console.error(`Error sending to ${sub.endpoint}:`, err);

                    // If expired or invalid, we could remove it
                    if (err.statusCode === 410 || err.statusCode === 404) {
                        await supabaseClient.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
                    }

                    throw err;
                }
            })
        )

        return new Response(
            JSON.stringify({ success: true, total: (subscriptions || []).length, results }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    } catch (error: any) {
        console.error('Push error:', error);
        return new Response(
            JSON.stringify({ error: error.message }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    }
})
