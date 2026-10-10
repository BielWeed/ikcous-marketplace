---
description: Executa um plano gravado, tarefa por tarefa, com implementador isolado e revisão em duas etapas (fase 2 do ciclo agêntico)
argument-hint: <caminho do plano em docs/superpowers/plans/>
---

# Executar plano: $ARGUMENTS

Fase 2 do ciclo descrito em `docs/processo/ARQUITETURA-AGENTICA.md`. Para CADA tarefa do
plano, na ordem das dependências:

1. **Implementar** — despache um `implementador` NOVO (contexto limpo) com o brief da tarefa
   copiado do plano: arquivos, teste que falha primeiro, verificação, travas do `AGENTS.md`.
   Tarefas sem arquivo em comum podem ir em paralelo; arquivo compartilhado, nunca.
2. **Revisar, etapa 1 — aderência à spec**: o `revisor` classifica cada divergência entre
   spec e código como *deriva* (código fugiu da spec → consertar), *revisão* (a spec estava
   errada → atualizar a spec) ou *bug*.
3. **Revisar, etapa 2 — qualidade**: o mesmo `revisor`, as sete lentes.
4. **Tarefa `RISCO`** — além do `revisor`, o `revisor-risco` (banco/segurança), com a prova
   do Postgres efêmero quando há migration.
5. **Consertar** — achado BLOQUEIA volta ao `implementador` (até 3 rodadas); na quarta, um
   `implementador` novo com modelo mais forte. Erro mecânico de build → `corretor-build`.
6. **Evidência** — nenhuma tarefa é "pronta" sem a saída real de `/checar` colada.

No fim do plano: revisão do branch inteiro pelo `revisor` (contexto limpo) e, só então,
commit por caminho (`git commit -- <arquivos>`), push e PR em rascunho.

Pare para o humano apenas em: ação irreversível, segurança, decisão de produto/dinheiro,
push/merge em branch que não é seu.
