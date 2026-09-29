---
description: Analyze implementation gap between requirements and existing codebase
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


# Implementation Gap Validation

## Parse Arguments
- Feature name: `$1`

## Validate
Check that requirements have been completed:
- Verify `.kiro/specs/$1/` exists
- Verify `.kiro/specs/$1/requirements.md` exists

If validation fails, inform user to complete requirements phase first.

## Invoke Subagent

Delegate gap analysis to validate-gap:

Use the Task tool to invoke the Subagent with file path patterns:

```
Task(
  subagent_type="validate-gap",
  description="Analyze implementation gap",
  prompt="""
Feature: $1
Spec directory: .kiro/specs/$1/

File patterns to read:
- .kiro/specs/$1/spec.json
- .kiro/specs/$1/requirements.md
- .kiro/steering/*.md
- .kiro/settings/rules/gap-analysis.md
"""
)
```

## Display Result

Show Subagent summary to user, then provide next step guidance:

### Next Phase: Design Generation

**If Gap Analysis Complete**:
- Review gap analysis insights
- Run `/spec-design $1` to create technical design document
- Or `/spec-design $1 -y` to auto-approve requirements and proceed directly

**Note**: Gap analysis is optional but recommended for brownfield projects to inform design decisions.