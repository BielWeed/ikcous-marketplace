---
name: "pwa-sentinel"
description: "Diretrizes para o monitoramento e recuperação do Service Worker do PWA."
risk: low
---

# PWA Sentinel

## Use esta habilidade quando
- Desenvolver, depurar ou evoluir o ciclo de vida do Service Worker (`src/pwa-sentinel.ts`).
- Investigar falhas de sincronização de cache, carregamento offline ou pings de batimento cardíaco (heartbeat).

## Instruções
1. **Monitoramento de Pulso**: O Sentinel faz pings a cada 30 segundos (`HEARTBEAT_PING`). O SW responde com `HEARTBEAT_ACK`. Se o pulso for perdido por mais de 5 minutos, inicia a auto-recuperação.
2. **Protocolo de Recuperação**: Em falha, limpe todos os registros de SW usando `registration.unregister()` e force o recarregamento com `window.location.reload()` registrando o motivo no `localStorage`.
3. **Isolamento de UI**: Nunca adicione dependências pesadas ou chamadas de renderização dentro do Sentinel. Ele deve rodar em background.