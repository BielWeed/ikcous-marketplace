---
description: Validate implementation against requirements, design, and tasks
allowed-tools: Read, Task
argument-hint: [feature-name] [task-numbers]
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


# Implementation Validation

## Parse Arguments
- Feature name: `$1` (optional)
- Task numbers: `$2` (optional)

## Auto-Detection Logic

**Perform detection before invoking Subagent**:

**If no arguments** (`$1` empty):
- Parse conversation history for `/spec-impl <feature> [tasks]` patterns
- OR scan `.kiro/specs/*/tasks.md` for `[x]` checkboxes
- Pass detected features and tasks to Subagent

**If feature only** (`$1` present, `$2` empty):
- Read `.kiro/specs/$1/tasks.md` and find all `[x]` checkboxes
- Pass feature and detected tasks to Subagent

**If both provided** (`$1` and `$2` present):
- Pass directly to Subagent without detection

## Invoke Subagent

Delegate validation to validate-impl:

Use the Task tool to invoke the Subagent with file path patterns:

```
Task(
  subagent_type="validate-impl",
  description="Validate implementation",
  prompt="""
Feature: {$1 or auto-detected}
Target tasks: {$2 or auto-detected}
Mode: {auto-detect, feature-all, or explicit}

File patterns to read:
- .kiro/specs/{feature}/*.{json,md}
- .kiro/steering/*.md

Validation scope: {based on detection results}
"""
)
```

## Display Result

Show Subagent summary to user, then provide next step guidance:

### Next Steps Guidance

**If GO Decision**:
- Implementation validated and ready
- Proceed to deployment or next feature

**If NO-GO Decision**:
- Address critical issues listed
- Re-run `/spec-impl <feature> [tasks]` for fixes
- Re-validate with `/validate-impl [feature] [tasks]`

**Note**: Validation is recommended after implementation to ensure spec alignment and quality.
