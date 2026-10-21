# Plano — geração finita de tipos do efêmero

Spec: docs/superpowers/specs/2026-10-20-tipos-efemeros-design.md.
Manifesto: docs/superpowers/lanes/2026-10-20-tipos-efemeros.json.
Base anterior e59a03523945d560e32a0167553a890a765949d7, validada no CI; só seguir depois de commit destes canônicos e validação do manifesto.

1. Executor GPT em worktree ANINHADA exclusiva implementa UMA tarefa: wrapper de geração, teste Deno offline e dois passos/paths no RPC-CI existente. Posse exata do manifesto; shared workflow liberado só a esta frente. TDD antes de produção; fonte por Read/Edit/Write, nenhum formatter --write. Sem push/merge/dispatch/DB real. Usar git -C absoluto ou Set-Location+comando MESMA chamada; divergência de raiz/branch/SHA significa PARAR antes de entrar.
2. Revisor Opus independente no SHA final: isolamento do alvo, subprocesso/credenciais/artefato, proteção de guardas existentes e teste causal. Integrador aplica só após aprovação, por frente.mjs conferir/integrar. Sem aprovação do SHA, não integrar.
3. Integrador executa CI finito no topo final e lê artefato/metadata. Sem resultado real não alegar geração concluída. Consumidor/tipos de src aguardam etapa posterior; CI não prova banco real.
4. **Última tarefa: diretor factual** confere conjunto, evidência no SHA final e limites de publicação. Não trocar por segunda revisão de código nem liberar produção.

## Teto e verificações
Máximo4 vagas totais, RAM>=2GB medida antes de cada despacho. Um teste curto por vez; suíte inteira só CI gratuito do repo público. Sem Monitor permanente, sem cota paga, sem segredo ou contorno de recusa. Nova dependência não entra em package/lockfile: npx de versão explícita só no runner. Arquivos compartilhados fora da faixa viram PEDIDOS.
