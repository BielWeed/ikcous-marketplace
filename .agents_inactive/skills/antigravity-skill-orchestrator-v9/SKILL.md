---
name: "antigravity-skill-orchestrator-v9"
description: "Meta-skill avançada v9 de seleção, orquestração de enxame de agentes baseada em intenção, especulação paralela com testes de mutação, transações em Git shadow branches, autocura baseada em contratos e ledger relacional distribuído semântico v9."
risk: low
---

# Orquestrador Dinâmico de Skills v9

## Use esta habilidade quando
- Iniciar tarefas complexas que exijam múltiplas competências especializadas da biblioteca.
- Coordenar fluxos de trabalho concorrentes envolvendo múltiplos subagentes em formato de enxame de agentes baseado em intenções (Intent-Driven Swarm).
- Precisar de especulação paralela de código em sandboxes isoladas com testes diferenciais e de mutação sintética.
- Desejar aprovação interativa avançada com diffs, predição de comandos e simulações dry-run reversíveis no Consent Gate.

## Instruções
1. **Mapeamento Semântico Híbrido (v9)**: Analise semanticamente o prompt utilizando uma combinação de busca baseada em vetor denso/esparso e dependências estruturais do grafo de código (Graph-RAG) para pré-carregar preventivamente skills recomendadas.
2. **Dependências e Resolução de Conflitos (Hierárquica v9)**: Identifique a skill principal e suas dependências. Resolva conflitos de regras usando a matriz de de-confliction baseada em 6 camadas de prioridade (Layer 1 a 6):
   - **Camada 1**: Segurança e Regras Hard do Usuário (Absoluta).
   - **Camada 2**: Preferências JIT do Usuário (Ajustes em tempo real).
   - **Camada 3**: Padrões do Workspace e Tipagem Estrita (Estilo, TypeScript, Pydantic, etc.).
   - **Camada 4**: Experiências do Ledger (Histórico de bugs/correções salvos no memory graph semântico distribuído v9).
   - **Camada 5**: Restrições Sandbox JIT (Métricas de execuções experimentais e falhas de sandbox da sessão atual).
   - **Camada 6**: Recomendações JIT da Habilidade (Sugestões da skill instalada).
3. **Intent-Driven Swarm & Starvation-Free Locks (v9)**:
   - Gerencie subagentes de forma assíncrona no Blackboard com base em contratos de intenção semântica e autonomia cognitiva.
   - Utilize travas de leitura/escrita hierárquicas preditivas. Previna starvation de agentes reorganizando dinamicamente a fila com base na análise sintática (AST) do fluxo de controle em background.
4. **Especulação Paralela Multi-Branch com Mutação (v9)**: Se uma skill for de risco médio/alto:
   - Crie branches Git sombra (shadow branches) ocultos e execute variações concorrentes na sandbox.
   - Gere dados de teste extremos (edge-cases) e execute testes de mutação sintética no código para validar a robustez estrutural.
   - Apresente relatórios comparativos com análise estática de tipo, cobertura de testes e estimativa de regressão.
5. **Consent Gate com Simulação dry-run Reversível (v9)**: Apresente explicações completas de dependências e dry-run com um clique para aprovação interativa do usuário.
6. **Autocura Ativa baseada em Contratos (v9)**: Em caso de falha:
   - Defina pré-condições, pós-condições e invariantes no código (Design by Contract) nos testes dinâmicos de diagnóstico unitários gerados em `/scratch`.
   - Analise os erros sintáticos (AST) e as linhas cobertas para aplicar micro-patches direcionados na sandbox até a validação formal completa.
7. **Verificação & Rollback de Git Shadow Branches (v9)**: Se a validação final falhar, execute reset atômico para limpar o workspace e remover quaisquer arquivos não rastreados de forma instantânea.
8. **Registro de Aprendizado Semântico (v9)**: Conclua atualizando o grafo de memória relacional semântica do ledger distribuído, conectando a tarefa atual a tarefas passadas correlatas por similaridade sintática de grafos.
