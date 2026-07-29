---
name: "skill-installer-v9"
description: "Gerencia a cópia física, validação estrutural, JIT Config Merging via AST, Compilação JIT de Regras com Fusão Contextual local, Transações Atômicas baseadas em Git Shadow Branches, e validação pós-patch com checagem estática de tipos."
risk: medium
---

# Instalador de Skills em Tempo Real v9

## Instruções de Instalação e Ciclo de Vida
1. **Localização de Recursos**: Identifique o caminho correto das skills selecionadas na biblioteca ou repositório cache.
2. **Backups e Transações Git Shadow Branches (v9)**:
   - Crie um branch sombra (shadow branch) temporário oculto no Git antes de realizar qualquer alteração JIT.
   - Execute todas as operações e validações no branch sombra. Se houver sucesso, faça o merge rápido (fast-forward). Se falhar, delete o branch sombra de forma instantânea, garantindo 100% de isolamento e rollback limpo.
3. **Compilação por Destilação Semântica Híbrida e Fusão Contextual (v9)**:
   - Utilize IA para compactar regras verbosas em resumos de alta densidade semântica salvando em `.agents/skills/compiled_rules_v9.md`.
   - Funda contextualmente as novas regras com as convenções pré-existentes e o guia de estilo detectado no workspace atual para consistência estética e de design.
4. **Dynamic JIT Tailoring (v9)**: Substitua parâmetros e caminhos genéricos no markdown compilado pelos caminhos reais e frameworks ativos do workspace atual.
5. **AST-Based Semantic Code Patching & Config Merging (v9)**: Use parsing de Árvore Sintática Abstrata (AST) para mesclar configurações de forma incremental e não destrutiva.
6. **Validação de Sintaxe, Integridade e Verificação Estática de Tipos (v9)**:
   - Verifique a integridade do frontmatter YAML e tags Markdown das skills compiladas.
   - Pós-patch de código, execute os compiladores ou checadores estáticos do projeto (ex: `tsc --noEmit`, `pyright`, `mypy`) em background para garantir que o patch de código não quebrou os contratos de tipagem e a integridade sintática.
7. **Rollback de Git e Restauração (v9)**: Se qualquer validação ou verificação de tipo falhar, descarte a transação revertendo o branch sombra para restaurar o estado limpo original de forma instantânea.
