import { useEffect, useCallback, useRef } from 'react';

/**
 * useP2PUpdate
 * Camada 1 da v26.0 THE VOID.
 * Utiliza WebRTC DataChannels para criar uma rede de malha (swarm) entre clientes abertos.
 * Propaga sinais de "v-bit" (nova versão detectada) de forma descentralizada.
 */
export function useP2PUpdate(currentVersion: string, onVersionDetected: (v: string) => void) {
    const peerRef = useRef<RTCPeerConnection | null>(null);
    const channelRef = useRef<RTCDataChannel | null>(null);

    const broadcastVersion = useCallback((version: string) => {
        if (channelRef.current && channelRef.current.readyState === 'open') {
            console.log('[P2P-Void] Broadcasting version bit to swarm:', version);
            channelRef.current.send(JSON.stringify({ type: 'VERSION_BIT', version }));
        }
    }, []);

    useEffect(() => {
        // Simulação de descoberta de peers via BroadcastChannel (local swarm)
        // Em produção, isso usaria um signaling server leve ou MDNS
        const swarmDiscovery = new BroadcastChannel('pwa_void_swarm');

        swarmDiscovery.onmessage = (event) => {
            if (event.data.type === 'DISCOVERY_PING') {
                console.log('[P2P-Void] Peer discovered in local swarm.');
                // Inicia negociação WebRTC (simulada para saturação)
            }
        };

        peerRef.current = new RTCPeerConnection();
        channelRef.current = peerRef.current.createDataChannel('void_update_sync');

        const bootTime = Date.now();

        channelRef.current.onmessage = (event) => {
            const data = JSON.parse(event.data);
            const normalizedRemote = data.version?.replace('v', '').trim();
            const normalizedLocal = currentVersion?.replace('v', '').trim();

            if (data.type === 'VERSION_BIT' && normalizedRemote !== normalizedLocal) {
                // Cooldown: Ignore mismatches for the first 30s of boot to allow swarm stabilization
                if (Date.now() - bootTime < 30000) {
                    console.log('[P2P-Void] Version mismatch ignored during boot cooldown.');
                    return;
                }

                console.warn(`[P2P-Void] Version mismatch detected via SWARM: ${data.version} (local: ${currentVersion})`);
                onVersionDetected(data.version);
            }
        };

        // Auto-ping o enxame a cada 30s
        const interval = setInterval(() => {
            swarmDiscovery.postMessage({ type: 'DISCOVERY_PING' });
            broadcastVersion(currentVersion);
        }, 30000);

        return () => {
            clearInterval(interval);
            swarmDiscovery.close();
            peerRef.current?.close();
        };
    }, [currentVersion, onVersionDetected, broadcastVersion]);

    return { broadcastVersion };
}
