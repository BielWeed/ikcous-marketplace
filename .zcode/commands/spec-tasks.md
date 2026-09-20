---
description: Generate implementation tasks for a specification
allowed-tools: Read, Task
argument-hint: <feature-name> [-y] [--sequential]
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


# Implementation Tasks Generator

## Parse Arguments
- Feature name: `$1`
- Auto-approve flag: `$2` (optional, "-y")
- Sequential mode flag: `$3` (optional, "--sequential")

## Validate
Check that design has been completed:
- Verify `.kiro/specs/$1/` exists
- Verify `.kiro/specs/$1/design.md` exists
- Determine `sequential = ($3 == "--sequential")`

If validation fails, inform user to complete design phase first.

## Invoke Subagent

Delegate task generation to spec-tasks:

Use the Task tool to invoke the Subagent with file path patterns:

```
Task(
  subagent_type="spec-tasks",
  description="Generate implementation tasks",
  prompt="""
Feature: $1
Spec directory: .kiro/specs/$1/
Auto-approve: {true if $2 == "-y", else false}
Sequential mode: {true if sequential else false}

File patterns to read:
- .kiro/specs/$1/*.{json,md}
- .kiro/steering/*.md
- .kiro/settings/rules/tasks-generation.md
- .kiro/settings/rules/tasks-parallel-analysis.md (include only when sequential mode is false)
- .kiro/settings/templates/specs/tasks.md

Mode: {generate or merge based on tasks.md existence}
Instruction highlights:
- Map all requirements to tasks and list requirement IDs only (comma-separated) without extra narration
- Promote single actionable sub-tasks to major tasks and keep container summaries concise
- Apply `(P)` markers only when parallel criteria met (omit in sequential mode)
- Mark optional acceptance-criteria-focused test coverage subtasks with `- [ ]*` only when deferrable post-MVP
"""
)
```

## Display Result

Show Subagent summary to user, then provide next step guidance:

### Next Phase: Implementation

**Before Starting Implementation**:
- **IMPORTANT**: Clear conversation history and free up context before running `/spec-impl`
- This applies when starting first task OR switching between tasks
- Fresh context ensures clean state and proper task focus

**If Tasks Approved**:
- Execute specific task: `/spec-impl $1 1.1` (recommended: clear context between each task)
- Execute multiple tasks: `/spec-impl $1 1.1,1.2` (use cautiously, clear context between tasks)
- Without arguments: `/spec-impl $1` (executes all pending tasks - NOT recommended due to context bloat)

**If Modifications Needed**:
- Provide feedback and re-run `/spec-tasks $1`
- Existing tasks used as reference (merge mode)

**Note**: The implementation phase will guide you through executing tasks with appropriate context and validation.
