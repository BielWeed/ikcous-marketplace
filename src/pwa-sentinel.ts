/**
 * PWA Sentinel — The Guardian
 * Camada 3 da v23.0 OMNIPOTENCE.
 * Este script roda fora do ciclo de vida principal do React para monitorar a saúde do SW.
 * Se o SW travar ou falhar em responder corações (heartbeats), o Sentinel intervém.
 */
export const initSentinel = () => {
    if (!navigator.serviceWorker) return;

    console.log('[PWA-Sentinel] Guardian active. Monitoring Service Worker health...');

    let lastHeartbeat = Date.now();
    const channel = new BroadcastChannel('sw-heartbeat');

    const handleHeartbeatAck = (data: any) => {
        if (data === 'HEARTBEAT_ACK') {
            lastHeartbeat = Date.now();
        }
    };

    channel.onmessage = (event) => {
        handleHeartbeatAck(event.data);
    };

    // Standard Direct Service Worker message communication listener
    navigator.serviceWorker.addEventListener('message', (event) => {
        handleHeartbeatAck(event.data);
    });

    // Verificação de pulso a cada 30 segundos
    setInterval(() => {
        if (!navigator.serviceWorker.controller) {
            lastHeartbeat = Date.now();
            return;
        }

        const timeSinceLastPulse = Date.now() - lastHeartbeat;

        if (timeSinceLastPulse > 300000) { // 5 minutos sem sinal = falha crítica
            console.error(`[PWA Sentinel] ⚠️ CRITICAL: Service Worker pulse lost (${timeSinceLastPulse}ms). Triggering Emergency Recovery...`);

            navigator.serviceWorker.getRegistrations().then(registrations => {
                for (const registration of registrations) {
                    registration.unregister();
                }
                console.warn('[PWA Sentinel] 🔌 Service Worker Unregistered. Forcing reload.');
                localStorage.setItem('pwa_reload_reason', `Sentinel Recovery: Pulse loss (${timeSinceLastPulse}ms)`);
                window.location.reload();
            });
        } else {
            // Quiet heart-ping
            navigator.serviceWorker.controller?.postMessage('HEARTBEAT_PING');
        }
    }, 30000);
};
