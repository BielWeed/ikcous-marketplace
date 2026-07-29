---
name: "skill-evaluator-v9"
description: "Avalia a eficiência das skills, gerencia o histórico de aprendizado em grafo de memória relacional distribuído semântico v9, previne regressões por simulação estática de impacto e gera testes de diagnóstico baseados em contratos na sandbox."
risk: low
---

# Avaliador de Habilidades e Registro de Experiência v9

## Use esta habilidade quando
- Concluir tarefas complexas que usaram skills dinâmicas ou regras compiladas JIT.
- Ocorrerem conflitos, erros de compilação ou falhas de autocura no workspace.
- Iniciar uma tarefa, para mapear riscos históricos e instanciar diretrizes preventivas baseadas em grafos de erro anteriores.

## Instruções
1. **Busca e Alerta no Grafo Relacional Semântico (Prevenção de Regressões v9)**:
   - No início de qualquer tarefa, carregue `./.agents/experience_ledger.json` e faça uma travessia densa no grafo de memória relacional distribuído semântico.
   - Identifique conexões baseadas em similaridade sintática (AST), cobertura de código e falhas de autocura de tarefas anteriores.
   - Injete proativamente as soluções de hotfix recomendadas e calcule a probabilidade de regressão.
2. **Prevenção de Regressão por Simulação Estática de Impacto (v9)**:
   - Execute simulação estática de impacto comparando o patch gerado com o histórico de regressões registradas no ledger relacional, alertando sobre possíveis efeitos colaterais em módulos distantes.
3. **Geração Dinâmica de Testes Sandbox baseada em Contratos (v9)**:
   - Durante a resolução ou na autocura de falhas, gere testes unitários/diagnósticos sob `/scratch` definindo pré-condições, pós-condições e invariantes no código (Design by Contract).
   - Analise os erros de execução usando a estrutura da AST das falhas e a cobertura de código para guiar a autocorreção na sandbox sob validação formal contratual.
4. **Avaliação Operacional**: Classifique a experiência de 1 a 5 com base na precisão da destilação semântica híbrida, integridade da fusão contextual e velocidade da autocura contratual.
5. **Gravação do Ledger (Grafo Relacional Semântico v9)**: Salve em `./.agents/experience_ledger.json` de forma relacional:
   - `task_description`: Descrição detalhada da tarefa resolvida.
   - `skills_applied`: Lista de skills compiladas/utilizadas.
   - `efficacy_rating`: Nota de eficácia geral (1-5).
   - `conflicts_detected`: Detalhes de conflitos resolvidos e qual camada prevaleceu na matriz v9.
   - `diagnostic_tests_run`: Nomes e resultados dos scripts de teste dinâmicos baseados em contratos executados na sandbox.
   - `errors_encountered`: Histórico de bugs encontrados e como foram corrigidos pela autocura baseada em AST e contratos.
   - `lessons_learned`: Recomendações e aprendizados práticos.
   - `graph_edges`: Conexões bidirecionais densas associando IDs de tarefas por similaridade de código, caminhos de cobertura ou histórico de erros.
6. **Autopromoção de Habilidades com Testes de Stress (v9)**: Monitore chaves JIT e recomende sua promoção para regras permanentes (`AGENTS.md`) caso mantenham eficácia superior a 4.5 e passem em testes de stress automatizados na sandbox em cenários de alta concorrência.
