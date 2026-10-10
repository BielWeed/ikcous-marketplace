---
description: BMAD-METHOD no ZCode — 5 personas e fluxo em 4 fases com aprovação do dono
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

# /bmad-method — BMAD-METHOD adaptado para o ZCode

Instalação da galeria (execução 1336ad74141e46a48403709f7e669eaf), árvore
upstream íntegra em `.zcode/galeria/bmad-method/skills/` (commit fixado; hashes
registrados em `INSTALACAO.json`).

## Como usar

As instruções de cada skill são lidas diretamente da árvore registrada. Antes de
executar qualquer fase ou persona, LEIA o `SKILL.md` correspondente em
`.zcode/galeria/bmad-method/skills/<skill>/SKILL.md` e siga-o; arquivos irmãos
(`references/`, `assets/`) resolvem a partir da raiz da skill.

## Fluxo em 4 fases (pare para o dono aprovar ao fim de cada uma)

1. **Ideia** — `.zcode/galeria/bmad-method/skills/bmad-brainstorming/SKILL.md`
   (alternativa enxuta: `bmad-forge-idea`).
2. **Planejamento** — `bmad-product-brief` e depois `bmad-prd`
   (alternativa: `bmad-prfaq`).
3. **Arquitetura** — `bmad-architecture`.
4. **Implementação** — `bmad-build` com a persona `bmad-dev`.

## Personas (subagentes ZCode)

`bmad-analyst` (Mary), `bmad-pm`, `bmad-ux-designer`, `bmad-architect` e
`bmad-dev` — arquivos em `.zcode/agents/`, cada um apontando para a skill
original. Invoque-as pelo nome quando a fase pedir.

## Avisos importantes

- Skills BMAD podem pedir scripts em `_bmad/scripts/` (ex.: resolver
  customizações). Este projeto ainda não passou pelo setup oficial; se um
  script não existir, use o fallback manual descrito no próprio SKILL.md e
  registre a limitação ao dono. O setup oficial (`references/setup.md` da skill
  `bmad`) pode ser executado depois, a pedido.
- Em dúvida sobre a próxima skill, leia
  `.zcode/galeria/bmad-method/skills/bmad/SKILL.md` (roteador oficial).
- Não escreva nada fora do projeto sem perguntar; artefatos de fase ficam em
  `docs/` conforme cada skill determinar.
