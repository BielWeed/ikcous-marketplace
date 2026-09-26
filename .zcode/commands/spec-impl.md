---
description: Execute spec tasks using TDD methodology
allowed-tools: Read, Task
argument-hint: <feature-name> [task-numbers]
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


# Implementation Task Executor

## Parse Arguments
- Feature name: `$1`
- Task numbers: `$2` (optional)
  - Format: "1.1" (single task) or "1,2,3" (multiple tasks)
  - If not provided: Execute all pending tasks

## Validate
Check that tasks have been generated:
- Verify `.kiro/specs/$1/` exists
- Verify `.kiro/specs/$1/tasks.md` exists

If validation fails, inform user to complete tasks generation first.

## Task Selection Logic

**Parse task numbers from `$2`** (perform this in Slash Command before invoking Subagent):
- If `$2` provided: Parse task numbers (e.g., "1.1", "1,2,3")
- Otherwise: Read `.kiro/specs/$1/tasks.md` and find all unchecked tasks (`- [ ]`)

## Invoke Subagent

Delegate TDD implementation to spec-tdd-impl-agent:

Use the Task tool to invoke the Subagent with file path patterns:

```
Task(
  subagent_type="spec-tdd-impl-agent",
  description="Execute TDD implementation",
  prompt="""
Feature: $1
Spec directory: .kiro/specs/$1/
Target tasks: {parsed task numbers or "all pending"}

File patterns to read:
- .kiro/specs/$1/*.{json,md}
- .kiro/steering/*.md

TDD Mode: strict (test-first)
"""
)
```

## Display Result

Show Subagent summary to user, then provide next step guidance:

### Task Execution

**Execute specific task(s)**:
- `/spec-impl $1 1.1` - Single task
- `/spec-impl $1 1,2,3` - Multiple tasks

**Execute all pending**:
- `/spec-impl $1` - All unchecked tasks

**Before Starting Implementation**:
- **IMPORTANT**: Clear conversation history and free up context before running `/spec-impl`
- This applies when starting first task OR switching between tasks
- Fresh context ensures clean state and proper task focus
