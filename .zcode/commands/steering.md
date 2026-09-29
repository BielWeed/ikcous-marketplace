---
description: Manage .kiro/steering/ as persistent project knowledge
allowed-tools: Read, Task, Glob
---

<!-- galeria:idioma-pt-br:v1 -->
## Idioma da conversa
Converse sempre em português do Brasil com Gabriel. Todas as respostas,
explicações, perguntas, títulos, rótulos e opções de escolha produzidos pelo
agente devem estar em português, inclusive campos de ferramentas de perguntas.
Ao delegar, exija a mesma orientação dos subagentes e apresente seus resultados
em português. O usuário não fala inglês. Preserve identificadores de código,
nomes de arquivos e comandos quando a tradução impedir seu funcionamento.
Esta regra vale mesmo quando as instruções da arquitetura abaixo estão em inglês.
<!-- /galeria:idioma-pt-br:v1 -->

<!-- galeria:nota-zcode:v1 -->
## Nota do instalador da galeria (ZCode)
No ZCode, os subagentes desta arquitetura são invocados pelos tipos
`spec-requirements`, `spec-design`, `spec-tasks`, `spec-impl`, `validate-design`,
`validate-gap`, `validate-impl`, `steering` e `steering-custom` (arquivos em
`.zcode/agents/`), correspondendo aos agentes upstream com sufixo `-agent`.
Regras e modelos de documento vivem em `.kiro/settings/`.
<!-- /galeria:nota-zcode:v1 -->


# Kiro Steering Management

## Mode Detection

**Perform detection before invoking Subagent**:

Check `.kiro/steering/` status:
- **Bootstrap Mode**: Empty OR missing core files (product.md, tech.md, structure.md)
- **Sync Mode**: All core files exist

Use Glob to check for existing steering files.

## Invoke Subagent

Delegate steering management to steering:

Use the Task tool to invoke the Subagent with file path patterns:

```
Task(
  subagent_type="steering",
  description="Manage steering files",
  prompt="""
Mode: {bootstrap or sync based on detection}

File patterns to read:
- .kiro/steering/*.md (if sync mode)
- .kiro/settings/templates/steering/*.md
- .kiro/settings/rules/steering-principles.md

JIT Strategy: Fetch codebase files when needed, not upfront
"""
)
```

## Display Result

Show Subagent summary to user:

### Bootstrap:
- Generated steering files: product.md, tech.md, structure.md
- Review and approve as Source of Truth

### Sync:
- Updated steering files
- Code drift warnings
- Recommendations for custom steering

## Notes

- All `.kiro/steering/*.md` loaded as project memory
- Templates and principles are external for customization
- Focus on patterns, not catalogs
- "Golden Rule": New code following patterns shouldn't require steering updates
- Avoid documenting agent-specific tooling directories (e.g. `.cursor/`, `.gemini/`, `.claude/`)
- `.kiro/settings/` content should NOT be documented in steering files (settings are metadata, not project knowledge)
- Light references to `.kiro/specs/` and `.kiro/steering/` are acceptable; avoid other `.kiro/` directories
