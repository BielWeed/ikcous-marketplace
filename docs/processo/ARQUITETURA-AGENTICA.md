# Arquitetura agêntica do IKCOUS

> Adotada em 26/09/2026. Pedido do dono: "encontre uma arquitetura agêntica vencedora de
> hackathon para você trabalhar no ikcous". Este arquivo registra **o que foi verificado**, a
> escolha e como ela se encaixa no que o repositório já tinha. As regras do repositório
> continuam no [`AGENTS.md`](../../AGENTS.md) — aqui só o método de trabalho.

## O que a pesquisa encontrou (fontes conferidas em 26/09/2026)

| Candidata | Vitória | Evidência |
| --- | --- | --- |
| **Superpowers** (obra/superpowers) — spec → plano → subagente por tarefa com TDD → revisão | 2º lugar do *Built with Opus 4.7* (Wrench Board, abril/2026, ~500 participantes) | Blog oficial da Anthropic ("Meet the winners of Built with Opus 4.7") |
| Spec longa antes do código + "Intent-Diff Review" (deriva × revisão × bug) | 3º lugar do mesmo evento (Maieutic) | Mesmo blog |
| Uma sessão por subsistema, contexto limpo | 1º lugar do mesmo evento (Medkit) | Mesmo blog |
| **everything-claude-code** (affaan-m, hoje `affaan-m/ECC`) | Evento Forum Ventures × Anthropic, 12/09/2025, NY | O evento é confirmado; a vitória só é **autodeclarada** (README, site do autor). O prêmio foi do produto (Zenith), não da configuração |

Escolha: **Superpowers como espinha** (vitória confirmada pela Anthropic, e o repositório já
usa a convenção `docs/superpowers/specs|plans`) **+ três peças do ECC** que não tínhamos:
planejador dedicado, revisor de banco/segurança e corretor de build de diff mínimo. O resto
do ECC (dezenas de agentes, memória, "instintos") ficou de fora — o próprio ECC avisa que
esse volume consome a janela de contexto.

## O ciclo

```text
/planejar ──► Explore (paralelo) ──► planejador ──► spec + plano gravados
                                                        │
/executar-plano ◄───────────────────────────────────────┘
   para cada tarefa:
     implementador NOVO (TDD: teste falha → código → teste passa)
       └► revisor, etapa 1: aderência à spec (deriva / revisão / bug)
       └► revisor, etapa 2: as sete lentes
       └► revisor-risco (só tarefa RISCO; prova no Postgres efêmero)
       └► corretor-build (só erro mecânico de verificação)
       └► /checar com a saída colada — sem ela, não está pronto
   fim: revisor no branch inteiro → commit por caminho → PR em rascunho
```

## Os agentes (`.claude/agents/`)

| Agente | Papel | Modelo | Escreve? |
| --- | --- | --- | --- |
| `planejador` | spec + plano de tarefas de 2–5 min, com teste, verificação e etiqueta de risco | opus | não |
| `implementador` | UMA tarefa, TDD, verificação real | sonnet | sim |
| `revisor` | sete lentes + aderência à spec | opus | não |
| `revisor-risco` | banco e segurança do mapa de risco, com prova no Postgres efêmero | opus | não |
| `corretor-build` | conserto mínimo de tsc/vite/deno/eslint | sonnet | sim (mínimo) |

## Os comandos (`.claude/commands/`)

`/planejar`, `/executar-plano` (novos) e os que já existiam: `/checar`, `/nova-tela`,
`/nova-migration`, `/release`, `/autorizacao`.

## Prova do banco sem tocar em banco real

O mapa de risco exige que migration seja provada. Sem Docker, qualquer máquina roda o mesmo
Postgres 17 do CI:

```bash
# binários oficiais empacotados (npm), fora do projeto
npm pack @embedded-postgres/linux-x64@17.9.0-beta.17   # ou o pacote do seu SO
# initdb + pg_ctl start numa pasta descartável, porta 5432, auth trust
export DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres CI_BANCO_EFEMERO=1
node scripts/ci/banco/provisionar-efemero.cjs
node scripts/ci/banco/aplicar-migrations.cjs supabase/migrations
node scripts/ci/banco/prova-dupla-aplicacao.cjs supabase/migrations
```

Os scripts de `scripts/ci/banco/` recusam host de Supabase gerenciado — a trava é deles.

## Fontes

- <https://claude.com/blog/meet-the-winners-of-built-with-opus-4-7-claude-code-hackathon>
- <https://claude.com/blog/meet-the-winners-of-our-built-with-opus-4-6-claude-code-hackathon>
- <https://github.com/obra/superpowers>
- <https://www.forumvc.com/forum-ventures-x-anthropic-ai-hackathon>
- <https://github.com/affaan-m/everything-claude-code>
