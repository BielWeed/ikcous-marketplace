/**
 * Shared Brain — The Trans-Tab Consciousness
 * Camada 2 da v26.0 THE VOID.
 * SharedWorker que unifica o estado e lógica de todas as abas.
 * Garante que apenas um "cérebro" processe dados, independentemente do número de abas.
 */

const ports: MessagePort[] = [];
const globalState = {
    lastUpdate: Date.now(),
    instances: 0
};

// @ts-ignore
self.onconnect = (event: MessageEvent) => {
    const port = event.ports[0];
    ports.push(port);
    globalState.instances++;

    console.log(`[Shared-Brain] New cell connected. Total cells: ${globalState.instances}`);

    port.onmessage = (msg) => {
        const { type, payload } = msg.data;

        switch (type) {
            case 'SYNC_STATE':
                port.postMessage({ type: 'STATE_SYNCED', payload: globalState });
                break;

            case 'BROADCAST':
                // Envia para todas as outras células (abas)
                ports.forEach(p => {
                    if (p !== port) p.postMessage({ type: 'EXTERNAL_SIGNAL', payload });
                });
                break;

            default:
                break;
        }
    };

    port.start();
};
