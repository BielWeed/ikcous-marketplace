---
description: Interactive technical design quality review and validation
allowed-tools: Read, Task
argument-hint: <feature-name>
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


# Technical Design Validation

## Parse Arguments
- Feature name: `$1`

## Validate
Check that design has been completed:
- Verify `.kiro/specs/$1/` exists
- Verify `.kiro/specs/$1/design.md` exists

If validation fails, inform user to complete design phase first.

## Invoke Subagent

Delegate design validation to validate-design:

Use the Task tool to invoke the Subagent with file path patterns:

```
Task(
  subagent_type="validate-design",
  description="Interactive design review",
  prompt="""
Feature: $1
Spec directory: .kiro/specs/$1/

File patterns to read:
- .kiro/specs/$1/spec.json
- .kiro/specs/$1/requirements.md
- .kiro/specs/$1/design.md
- .kiro/steering/*.md
- .kiro/settings/rules/design-review.md
"""
)
```

## Display Result

Show Subagent summary to user, then provide next step guidance:

### Next Phase: Task Generation

**If Design Passes Validation (GO Decision)**:
- Review feedback and apply changes if needed
- Run `/spec-tasks $1` to generate implementation tasks
- Or `/spec-tasks $1 -y` to auto-approve and proceed directly

**If Design Needs Revision (NO-GO Decision)**:
- Address critical issues identified
- Re-run `/spec-design $1` with improvements
- Re-validate with `/validate-design $1`

**Note**: Design validation is recommended but optional. Quality review helps catch issues early.