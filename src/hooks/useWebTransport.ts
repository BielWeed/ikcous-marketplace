import { useEffect, useCallback, useRef } from 'react';

/**
 * useWebTransport
 * Camada 2 da v22.0 SINGULARITY.
 * Utiliza o protocolo Web Transport (HTTP/3) para streaming de logs para o servidor.
 * Superior ao WebSockets em performance e latência para dados de diagnóstico.
 */
export function useWebTransport() {
    const transportRef = useRef<any>(null);
    const streamRef = useRef<any>(null);

    const connect = useCallback(async () => {
        if (!('WebTransport' in window)) {
            console.warn('[WebTransport] Not supported by this browser.');
            return;
        }

        try {
            // URL fictícia de endpoint de logs via HTTP/3
            const url = 'https://ickous-logs.vercel.app/streaming-logs';

            // SUPRESSÃO TEMPORÁRIA: Endpoint inativo causa erros QUIC ruidosos no console.
            // Para habilitar, defina window.ENABLE_LOG_STREAMING = true;
            if (!(window as any).ENABLE_LOG_STREAMING) {
                return;
            }

            // Verificação rápida de suporte antes de tentar conectar
            if (window.location.hostname === 'localhost') {
                console.debug('[WebTransport] Skipping connection on localhost to avoid noise.');
                return;
            }

            const transport = new (window as any).WebTransport(url);

            // Timeout de segurança para a conexão
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('WebTransport Timeout')), 2000)
            );

            await Promise.race([transport.ready, timeoutPromise]);
            transportRef.current = transport;

            const writable = await transport.createUnidirectionalStream();
            streamRef.current = writable.getWriter();

            console.log('[WebTransport] Stream connection established via HTTP/3');
        } catch (_err) {
            // Captura falhas de conexão (como ERR_QUIC_PROTOCOL_ERROR) e as trata como debug
            console.debug('[WebTransport] Connection suppressed. Endpoint likely inactive or QUIC unavailable.');
        }
    }, []);

    const streamLog = useCallback(async (log: any) => {
        if (streamRef.current) {
            const encoder = new TextEncoder();
            const data = encoder.encode(JSON.stringify(log));
            await streamRef.current.write(data);
        }
    }, []);

    useEffect(() => {
        connect();
        return () => {
            if (transportRef.current) transportRef.current.close();
        };
    }, [connect]);

    return { streamLog };
}
