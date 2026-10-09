# Arquitetura paralela do IKCOUS — várias frentes ao mesmo tempo, sem conflito

> Instalada em 09/10/2026. Pedido do dono: "instale a arquitetura agêntica do campeão de um
> hackathon recente, com muito paralelismo, para fazer várias frentes simultâneas no frontend e no
> backend sem conflitar". Este arquivo registra **o que a pesquisa verificou**, o que foi escolhido
> e como operar. Ele **completa** o [`ARQUITETURA-AGENTICA.md`](ARQUITETURA-AGENTICA.md) (ciclo
> serial: planejar → implementar → revisar), não o substitui. Regras do repositório: o
> [`AGENTS.md`](../../AGENTS.md).

## O que a pesquisa encontrou (fontes conferidas em 09/10/2026)

O hackathon **mais recente com resultado publicado** é o *Built with Opus 4.7* (abril/2026;
vencedores divulgados pela Anthropic em 15/06/2026). Não há resultado posterior publicado — a busca
por um "Built with Opus 4.8" não achou nada.

| Vencedor | O que o texto oficial diz sobre o método |
| --- | --- |
| **1º — Medkit** (Bedirhan Keskin) | Quatro sessões separadas do Claude Code, uma por subsistema (motor de voz, geração de conteúdo, camada 3D do jogo, app central), cada uma com contexto limpo, avançando ao mesmo tempo. |
| **2º — Wrench Board** (Alexis Chapellier) | Separou as responsabilidades do app em quatro domínios, escreveu **spec e depois plano para cada um**, executou no modo multiagente do Claude Code com **"cinco ou seis agentes em paralelo, um agente dedicado por domínio"**, usando o framework Superpowers (brainstorm → plano). |
| 3º — Maieutic | Dois dias de spec antes de qualquer código (sem detalhe de paralelismo). |

Edição anterior (*Built with Opus 4.6*): 1º CrossBeam usa subagentes paralelos **dentro do produto**;
2º Elisa, 76 commits e 1.500+ testes em ~30 h, com um meta-planejador que decompõe a spec num grafo
de tarefas.

E o evento Forum Ventures × Anthropic de set/2025, de onde vem o **everything-claude-code** (ECC,
hoje `affaan-m/ECC`): vitória do *produto* Zenith, autodeclarada; a configuração foi publicada
depois. O que ele diz de paralelismo é uma regra de decisão: **fork de conversa para tarefas que não
se tocam; `git worktree` para trabalho que se sobrepõe**, uma instância por worktree.

### O que os textos oficiais NÃO dizem — e por que isso importa

Nenhum post da Anthropic descreve **como** os vencedores evitaram conflito entre sessões paralelas
(sem menção a worktree, a posse de arquivo ou a integração). O padrão se repete, porém, em todo
material técnico sério sobre o tema: *"decomponha em pedaços que não compartilham estado; no
momento em que dois agentes precisam do mesmo arquivo você criou um conflito de merge; a
decomposição prévia é a habilidade real"* (relato de 140 PRs numa semana, junho/2026) e *"o
orquestrador sabe tudo, cada subagente recebe a tarefa, o worktree e um resumo do que as vizinhas
estão fazendo — só para saber onde não pisar; nenhum fala com nenhum"* (orquestrador paralelo por
worktrees, abril/2026). Consenso nos relatos técnicos — e verdade por construção, em git:
**worktree evita sobrescrita em disco, mas não evita conflito de merge**.

Esta instalação é, portanto, **a síntese do que é verificável + o que faltava para a escrita
paralela ser segura**. Não é "a configuração do campeão" — essa configuração não é pública no nível
de detalhe que o pedido supunha, e dizer o contrário seria inventar.

## O que o repositório já tinha (sessão de 26/09/2026)

Superpowers como espinha (spec → plano → subagente por tarefa com TDD → revisão em duas etapas) +
`planejador`, `revisor-risco` e `corretor-build` do ECC. Funciona, mas é **serial por desenho**: o
`AGENTS.md` dizia "leitura paraleliza, escrita não". O `/executar-plano` só paraleliza tarefas "sem
arquivo em comum" e deixa a verificação disso ao olho do orquestrador.

## A peça que faltava: escrita paralela com prova de disjunção

```text
/paralelizar ──► Explore ×N (paralelo) ──► planejador ──► spec + plano + MANIFESTO de frentes
                                                              │
                                    frente.mjs validar ◄──────┘   (código, não opinião:
                                    posse disjunta · compartilhados · faixas de migration)
                                                              │ ✓
        ┌───────────────┬───────────────┬──────────────┐      ▼   UMA mensagem, N Agent calls
        ▼               ▼               ▼              ▼
   frente A         frente B        frente C       frente D     cada uma: worktree próprio,
   (worktree)       (worktree)      (worktree)     (worktree)   branch própria, hook de faixa,
        │               │               │              │       TDD, verificação escopada
        └───────────────┴───────┬───────┴──────────────┘
                                ▼
            frente.mjs integrar --so-conferir   (prova que ninguém saiu da faixa)
                                ▼
        revisor ×N + revisor-risco ×M   (UMA mensagem, paralelo, contexto limpo)
                                ▼
       frente.mjs integrar (merge --no-ff, em ordem) → PEDIDOS compartilhados num commit
                                ▼
                     /checar completo, UMA vez → PR em rascunho
```

### As quatro ideias (e por que cada uma existe)

1. **Posse de arquivo provada, não combinada.** Cada frente declara os globs que ela, e só ela,
   escreve. [`scripts/paralelo/faixas.mjs`](../../scripts/paralelo/faixas.mjs) reprova o manifesto
   se dois globs *podem* casar o mesmo arquivo (teste conservador: falso alarme custa uma conversa,
   falso "ok" custa um merge quebrado).
2. **Arquivo que não admite dois autores é de ninguém.** Medidos no histórico deste repo como os
   que mais mudam e mais colidem: `package.json` e `package-lock.json`, `src/types/database.types.ts`
   (gerado), `src/App.tsx` e `src/config/rotas.ts` (roteador manual — a skill `nova-tela` lista 6+
   pontos), `vercel.json`, workflows, `AGENTS.md`. A frente **pede** a mudança no relatório; o
   integrador aplica **uma vez**, e lockfile/tipos se regeneram com a ferramenta, não à mão. O
   manifesto pode entregar um desses, por caminho exato, a uma única frente (`liberados`).
3. **Faixa de numeração de migration.** A versão é um timestamp sequencial; duas frentes criando
   migration colidem na ordem de aplicação. Cada frente recebe um intervalo de prefixos de 8
   dígitos, acima da maior existente; `conferir` reprova migration (ou `rollback-manual-…`) fora dele.
4. **Três camadas de defesa, da mais cedo à mais forte:**
   - *Hook `PreToolUse`* ([`guarda-de-faixa.mjs`](../../scripts/paralelo/guarda-de-faixa.mjs)):
     bloqueia `Write/Edit` fora da faixa na hora, com o motivo. Roda no `settings.json` e funciona
     dentro de subagentes (provado ao vivo). Tem dois modos: **global** (inerte fora de worktree com
     faixa) e **estrito** (fecha por padrão: sem faixa registrada, ou alvo fora do próprio worktree
     ⇒ bloqueia). O estrito liga por `--estrito` **ou** quando o JSON do harness traz
     `agent_type: frente`. **Medido ao vivo:** o hook declarado no *frontmatter* do agente `frente`
     não disparou (a mensagem de bloqueio mostrou o comando global, sem `--estrito`) — por isso o
     estrito não depende dele. O frontmatter fica como segunda via (se o harness passar a honrá-lo,
     o comando tem `|| exit 2`, porque script ausente sai 127 e a doc diz que isso **não bloqueia**).
   - *`frente.mjs commitar`*: recusa o commit inteiro se houver arquivo fora da faixa; comita só o
     que é da frente; **deixa os hooks do repo rodarem** (secretlint, commitlint).
   - *`frente.mjs integrar`*: antes de mesclar **qualquer** frente, prova a faixa de **todas**;
     reprovou uma ⇒ nada entra. É a garantia autoritativa — cobre o que o hook não vê
     (escrita por `Bash`: `sed -i`, `>`, `cp`).

## Por que worktree nativo e por que `baseRef: "head"` (medido, não suposto)

O agente [`frente`](../../.claude/agents/frente.md) usa `isolation: worktree` do Claude Code: cada
instância ganha um checkout próprio em `.claude/worktrees/`, e o harness bloqueia edição que mire
a árvore principal. **Sonda feita nesta instalação** (subagente de leitura, com `isolation: worktree`):
o worktree nasceu de `e8f5a3cc` — a branch padrão do remoto — e **não** do HEAD da sessão
(`8455d4bd`); o `.claude/agents/` dele tinha só 2 dos agentes do projeto. Sem corrigir isso, nenhuma
frente enxergaria o sistema de frentes. Correção: `"worktree": { "baseRef": "head" }` em
`.claude/settings.json` — e a regra de operação "**commite antes de despachar**" (Fase 0 do
`/paralelizar`), porque o worktree nasce do commit, não da árvore suja.

**Confirmado ao vivo depois da correção** (dois subagentes em worktree nativo): ambos nasceram em
`f851bd23`, com o sistema de frentes presente — `baseRef: "head"` funciona. O isolamento nativo
recusou escrita na árvore principal ("Edit the worktree copy of this file instead of the
shared-checkout path"); o hook bloqueou `package.json` (compartilhado) e a faixa vizinha;
`integrar --so-conferir` e `integrar` mesclaram as duas frentes sem conflito; remover os worktrees
não tocou o `node_modules` real.

Outras coisas medidas na sonda: `$CLAUDE_PROJECT_DIR` **não** existe no ambiente do `Bash` (só nos
hooks, onde a doc o define) — por isso os comandos dos agentes usam caminho relativo, e só o hook usa
a variável; o worktree não tem `node_modules` — `frente.mjs entrar` o liga por symlink (junction no
Windows) à árvore principal, evitando um `npm ci` por frente.

## Como operar

### Fluxo normal — o comando faz tudo

```
/paralelizar <o pedido grande, em linguagem natural>
```

Fases 0–7 no [comando](../../.claude/commands/paralelizar.md): pré-voo → mapear → decompor e
**validar** → despachar tudo numa mensagem → colher → revisar em paralelo → integrar → checar uma vez
→ limpar. Pergunta de produto, dinheiro, público ou irreversível sobe ao Gabriel com a conta feita.

### Fluxo manual — várias sessões suas, em terminais (ou no ZCode)

Os scripts são `git` + `node` puros, sem depender do Claude Code. Cada sessão num worktree:

```
node scripts/paralelo/frente.mjs validar docs/superpowers/lanes/<manifesto>.json
node scripts/paralelo/frente.mjs criar   docs/superpowers/lanes/<manifesto>.json <frente>
cd .worktrees/<plano>-<frente>      # abra a sessão aqui; trabalhe SÓ na posse
node scripts/paralelo/frente.mjs conferir
node scripts/paralelo/frente.mjs commitar -m "feat(checkout): …"
# na árvore principal, quando todas terminarem:
node scripts/paralelo/frente.mjs integrar docs/superpowers/lanes/<manifesto>.json
node scripts/paralelo/frente.mjs limpar   docs/superpowers/lanes/<manifesto>.json
```

`criar` usa a convenção `.worktrees/` (já ignorada pelo git e pelo eslint) e a branch
`paralelo/<plano>/<frente>`. Ele **não** grava `.worktrees/estado.json` do comando `/wt` do ZCode.

### Limites e números

- 20 subagentes simultâneos é o teto padrão do Claude Code (`CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`);
  o recomendado é **3–8 frentes grossas** por onda. Mais frentes ≠ mais velocidade: a integração e
  a revisão são o gargalo (o relato de 140 PRs/semana diz o mesmo).
- Frentes que dependem uma da outra ⇒ **ondas** (um manifesto por onda). Dependência dentro de uma
  onda é erro de decomposição: a frente para e relata, não improvisa.
- Teste **escopado** dentro de cada frente; `npm test` inteiro só na integração — o teto de 4
  trabalhadores do Vitest é de memória (`vitest.config.ts`), e N frentes × 4 esgotam a máquina.
- Frente de **mapa de risco** é despachada com `model: "opus"` e ganha `revisor-risco`. Quem escreveu
  não revisa.

## O que NÃO foi instalado, de propósito

- **O ECC inteiro** (60+ agentes, 200+ skills, "instintos", memória): o próprio ECC avisa que o
  volume consome a janela de contexto; e os `/multi-*` dele exigem um runtime externo (`ccg-workflow`)
  que o repositório não traz.
- **O plugin Superpowers via `enabledPlugins`**: a metodologia já está adotada (26/09). Habilitar um
  plugin de terceiros por configuração versionada, com hook de `SessionStart`, é decisão de cadeia
  de suprimento do dono. Se quiser: `/plugin install superpowers@claude-plugins-official`.
- **Workflows multiagente em escala "ultracode"** (dezenas de agentes): custo alto e só com pedido
  explícito do dono. O `/paralelizar` usa o `Agent` nativo.

## Outras sessões trabalhando no mesmo repositório

Este repositório costuma ter uma sessão local (ZCode/Claude Code na máquina do dono) editando ao
mesmo tempo. O `/paralelizar` isola frentes **entre si**; ele **não** enxerga o que uma sessão local
ainda não publicou. Três consequências, todas operacionais:

- **Faixa de migration:** `frente.mjs validar` confere o piso contra as migrations da sua cópia **e
  das branches remotas já buscadas**, mas uma migration só existente numa máquina local é invisível.
  Antes de fixar `faixa_migrations`, confirme com o dono a faixa reservada no mural
  (`~/.claude/mural/core_app_mkt/_REGRAS.md`) — e deixe folga acima da última publicada.
- **Base do PR:** a linha de trabalho do dono é `claude/app-major-upgrade-wmc8x2` ("o principal"),
  **não** `main` (medido: `main` está 1.393 commits fora dela; um PR contra `main` mostrou 883
  commits e 1.219 arquivos). `git branch -r --contains HEAD` e o último PR mergeado dizem a base.
- **Arquivos de processo** (`AGENTS.md`, `.claude/settings.json`, `.gitignore`) são editados por
  mais de uma sessão: conflito ali é trivial de texto, mas existe — rode `git fetch` antes de integrar.

## Revisão independente (09/10/2026) — o que ela achou e o que mudou

Um `revisor` em contexto limpo atacou a garantia "duas frentes nunca tocam o mesmo arquivo". Veredito
inicial: **não passa**. Corrigido neste PR, cada item com teste que falha sem a correção:

- **BLOQUEIA — `**` dentro de um segmento** (`src/lib/**.ts`, `src/t**`) dava falso "disjunto": a
  regex de casamento atravessava diretório, a prova de sobreposição não. Duas frentes passariam na
  validação sendo donas do mesmo arquivo. Agora `sobrepoe` trata qualquer `**` como curinga e
  `validar` rejeita `**` que não seja segmento inteiro.
- **A guarda estrita falhava aberta** se a frente corrompesse `.claude/lane.json` por `Bash` (o
  `catch` só olhava a flag, que o harness real não passa). Agora olha `agent_type` também.
- **Ferramentas de escrita do Serena** saíram do agente `frente`: o hook só lê `file_path`, e o
  Serena escreve por `relative_path` no projeto ativo dele (talvez a árvore principal).
- **A mensagem do merge** estourava as 100 colunas do commitlint com nomes longos, e a falha era
  rotulada "decomposição errada". Mensagem encurtada, orçamento de 60 caracteres para plano+frente,
  checagem de tamanho antes do primeiro merge, e "recusado por hook" separado de "conflito".
- **Caixa:** `src/app.tsx` × `src/App.tsx` é o mesmo arquivo no disco do dono; sobreposição e lista
  de compartilhados agora ignoram maiúsculas.
- **Configuração dos hooks e dos portões** (`lefthook.yml`, `.commitlintrc.json`, `eslint.config.js`,
  `biome.json`, `tsconfig*.json`…) virou compartilhada: `commitar` é auto-aprovado em
  `settings.json`, e uma frente que mude essas regras mudaria as de todas as outras.
- `git diff` com falha não vira mais "sem alterações, pulada"; `status` e `limpar` validam o manifesto.

Pendente de verificação (o revisor não conseguiu): junction do Windows sob `git worktree remove
--force`; checkout em disco case-insensitive; qual projeto o Serena considera ativo num worktree.

### Efeito colateral de `worktree.baseRef: "head"` para a equipe

Como está versionado, vale para **todos** que abrirem o repo no Claude Code: `claude --worktree` e o
isolamento de subagente passam a nascer do **HEAD local** (com commits ainda não publicados), não de
`origin/HEAD`. É o que faz as frentes enxergarem este sistema, mas muda o hábito de quem usa
`--worktree` hoje. Há relatos de que o app desktop ignora essa chave (não verificado aqui).

## Riscos conhecidos desta camada

- O hook não vê escrita por `Bash` — a garantia é o diff (`conferir`/`integrar`). Um agente que
  burla pelo `Bash` só adia a reprovação.
- Subagente em worktree **não** carrega o `CLAUDE.md`/`.claude/rules` do próprio worktree (a doc é
  explícita); recebe o da sessão principal. As regras vão no brief e no corpo do agente `frente`.
- O hook global falha SEM bloquear se o script não existir (exit 127 é não-bloqueante, segundo a
  doc de hooks): em sessão normal é o desejado; só o agente `frente` fecha por padrão
  (`|| exit 2`).
- `integrar` roda `git merge` por script. Não está na lista de permissões automáticas (continua
  pedindo confirmação), assim como `limpar`.

## Fontes

- <https://claude.com/blog/meet-the-winners-of-built-with-opus-4-7-claude-code-hackathon>
- <https://claude.com/blog/meet-the-winners-of-our-built-with-opus-4-6-claude-code-hackathon>
- <https://github.com/Junkz3/wrench-board> (2º lugar, 4.7: workflows ortogonais, loops de busca noturnos)
- <https://github.com/affaan-m/ECC> e o guia longo de paralelização (fork × worktree)
- <https://github.com/obra/superpowers> (`dispatching-parallel-agents`, `using-git-worktrees`,
  `subagent-driven-development`, `finishing-a-development-branch`)
- <https://code.claude.com/docs/en/worktrees>, <https://code.claude.com/docs/en/sub-agents>,
  <https://code.claude.com/docs/en/hooks>
- <https://saasforge.cz/blog/claude-code-agents-hackathon/> (140 PRs numa semana: decomposição é a habilidade)
- <https://dev.to/mexiter/claude-code-parallel-agent-driven-worktrees-orchestration-5bf0> (orquestrador +
  worktree por tarefa + resumo das vizinhas)
