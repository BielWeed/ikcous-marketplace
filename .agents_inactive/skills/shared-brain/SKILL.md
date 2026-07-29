---
name: "shared-brain"
description: "Gerenciamento de SharedWorker e comunicação unificada entre abas no ecossistema THE VOID."
risk: medium
---

# Shared Brain

## Use esta habilidade quando
- Alterar ou expandir a comunicação e compartilhamento de estado entre abas em `src/shared-brain.ts`.
- Resolver problemas de sincronização de carrinho de compras, dados de sessão ou sinais duplicados de API.

## Instruções
1. **Gerenciamento de Portas**: Acompanhe conexões ativas no array global `ports`. Incremente a contagem de instâncias no evento `onconnect`.
2. **Protocolos de Mensagem**: Suporte `SYNC_STATE` para alinhamento inicial de estado e `BROADCAST` para disparar sinais para todas as outras instâncias/abas.
3. **Segurança e Concorrência**: Trate desconexões e mantenha locks consistentes para que abas inactivas não travem a comunicação.