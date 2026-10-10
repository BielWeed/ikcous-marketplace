---
description: Spec + plano de tarefas pequenas antes de qualquer código (fase 1 do ciclo agêntico)
argument-hint: <o pedido, em linguagem natural>
---

# Planejar: $ARGUMENTS

Fase 1 do ciclo descrito em `docs/processo/ARQUITETURA-AGENTICA.md`.

1. **Pesquisa em paralelo** (leitura paraleliza): despache agentes `Explore` para mapear o
   código que o pedido toca e, se houver biblioteca/API externa, um agente de pesquisa com
   fonte oficial. Brief autocontido — subagente não vê esta sessão.
2. **Plano**: despache o agente `planejador` com o pedido + o que a pesquisa trouxe.
3. **Grave** o que ele devolver:
   - spec em `docs/superpowers/specs/<AAAA-MM-DD>-<assunto>-design.md`;
   - plano em `docs/superpowers/plans/<AAAA-MM-DD>-<assunto>.md`.
4. **Pare** se houver pergunta ao dono (produto, dinheiro, público, irreversível): suba com a
   recomendação e a conta feita. Sem pergunta pendente, siga para `/executar-plano`.
