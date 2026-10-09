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
   - *Âncora do worktree* ([`integridade.mjs`](../../scripts/paralelo/integridade.mjs)): `entrar` grava
     plano, frente, base e origem em `.git/worktrees/<nome>/paralelo-ancora.json` (fora da árvore de
     trabalho) e hook, `conferir` e `commitar` só aceitam um `lane.json` que concorde com ela — e, em
     worktree de `criar`, com o ramo `paralelo/<plano>/<frente>`. É o que impede trocar só o nome da
     frente ou apontar a `base` para um commit antigo de manifesto mais largo.

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
a variável; o worktree não tem `node_modules` próprio e **não precisa**: o Node, tsc, vite, vitest, eslint, biome e
`npm run` resolvem subindo diretórios, e o worktree mora dentro do repo. Medido: `vitest`, `eslint`,
`biome`, `npm run` e `tsc -b --force` passam num worktree sem `node_modules` e sem link (as ferramentas só
criam ali um diretório REAL de cache). A primeira versão ligava o `node_modules` por symlink/junction — e
isso era o perigo (ver "Revisão do dono" abaixo).

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

## Revisão do dono (Windows) e 2ª revisão independente — 09/10/2026

O Gabriel pediu uma revisão na sessão local (reproduzida no Windows) e eu pedi uma segunda, às cegas, a um
`revisor` novo. Elas convergiram nos dois pontos graves. Estado após `79a4070e` → este commit:

| Achado | O que mudou |
| --- | --- |
| **B1 — a faxina apagava o `node_modules` da principal** (junction + `git worktree remove --force`, medido no Windows; há relatos públicos do mesmo acidente) | **Eliminado na raiz: não existe mais link nenhum.** Medido: `vitest`, `eslint`, `biome`, `npm run` e `tsc -b --force` passam num worktree sem `node_modules`, porque o Node resolve subindo diretórios até o da principal. As ferramentas criam ali só cache, num diretório real. `frente.md` proíbe `npm install/ci`. Teste: nenhum `node_modules` no worktree **e** `require.resolve` ainda acha o pacote. |
| **A2 — a frente forjava a própria faixa** (manifesto escrito na própria posse + `entrar` auto-aprovado ⇒ editava `scripts/paralelo/` ⇒ código dela rodava sem confirmação) | `entrar` só aceita manifesto de `docs/superpowers/lanes/` **commitado no HEAD** (a fonte é o blob do git) e **recusa se já existe `lane.json`**. Hook, `conferir` e `commitar` exigem que o manifesto embutido seja idêntico ao commitado na `base` (`integridade.mjs`). Hook também resolve symlink. |
| **A3 — `integrar`/`limpar` só na árvore principal** (obrigava a trocar de ramo lá) | Rodam também num **worktree de integração** limpo, nunca no de uma frente. O manifesto resolve primeiro pelo worktree atual (arquivo velho na principal não vence). |
| **M5 — risco dependia da palavra da frente** | `integrar`/`status` derivam o **mapa de risco dos caminhos E do conteúdo do diff** (`fin_*`, `SECURITY DEFINER`, gate de admin, RLS/gatilho, `export` de função/tipo alterado ou removido — achado P1 do Codex: `useFinanceiro.ts` chama as RPCs de dinheiro e não tem palavra-chave no nome; testes e docs ficam fora da leitura de conteúdo) e imprimem as frentes que EXIGEM `revisor-risco`; o commit dos PEDIDOS em arquivo de risco também passa por ele. `AGENTS.md` ganhou a exceção na linha que ainda dizia "escrita serial". |
| TOCTOU no `integrar` (2ª revisão) | O SHA conferido é o SHA mesclado: commit feito na frente *depois* da conferência não entra. |
| Rollback em `supabase/migrations/` (2ª revisão, bloqueio funcional) | A convenção atual da skill `nova-migration` agora é aceita; antes a frente de banco não commitava o próprio rollback. |
| `commitar` após `git rm`; `liberados` de não-compartilhado; `Skill` no agente; `git commit -- <novo>` impossível; hook que não carrega abre para a frente | Corrigidos, cada um com teste (mutação conferida). |
| B7/B8 (caixa da letra do disco e de `Supabase/Migrations`), B9 (`criar --base --force` cru ao git) | Corrigidos. |

**Decisões do Gabriel — aprovadas em 09/10/2026** (as três primeiras ficam como estão; a quarta é uma
limitação conhecida, não uma decisão). Para reverter: o `baseRef` é a chave `worktree` e as permissões são as
linhas `Bash(node scripts/paralelo/frente.mjs …)` do `allow`, ambas em `.claude/settings.json`.

- **M4 — `worktree.baseRef: "head"`** vale para todo worktree do projeto, não só as frentes. É o que faz as
  frentes enxergarem este sistema; sem ele elas nascem da branch padrão do remoto (medido). Se preferir não
  alterar o comportamento de `claude --worktree` para a equipe, a alternativa é remover a chave e usar só
  `frente.mjs criar` (worktrees em `.worktrees/` a partir do HEAD) — perde o isolamento nativo do harness.
- **Permissões auto-aprovadas** (`entrar`, `commitar`, `conferir`, `status`, `validar`, `criar`): com a faixa
  íntegra, forjar exige um commit forjado (git pede confirmação). Mesmo assim, qualquer comando auto-aprovado
  que roda código do repositório dá ao agente uma superfície a mais. Tirar `entrar`/`commitar` do `allow`
  custa um prompt por frente (e prompts de subagente em segundo plano travam o paralelismo). **O `allow`
  inteiro NÃO é uma fronteira de segurança** — a seção "O que o `allow` não garante" abaixo mede por quê.
- **B6 — o hook global é "fail-open" fora do que eu consigo fechar:** se o `node` nem for executado (por
  exemplo, `${CLAUDE_PROJECT_DIR}` não expandir em PowerShell sem Git Bash) o Claude Code só bloqueia com
  exit 2 e a escrita passa; o hook do frontmatter só roda com workspace confiável e nunca em `-p`. A garantia
  que **não depende de hook** é `integrar` (lê o manifesto da árvore do integrador e reprova antes de
  qualquer merge) mais a revisão.
- **Contra um agente HOSTIL com `Bash` livre nada em processo é garantia absoluta** (ele escreve no disco do
  mesmo jeito que o integrador). A defesa real é o conjunto: nada auto-integra, o diff é conferido contra o
  manifesto canônico, e o risco sai dos caminhos e do conteúdo do diff (heurística: só acrescenta revisão, nunca dispensa).

**Não verificado (nenhuma das duas revisões nem eu conseguimos):** o teste de ponta a ponta **não rodou no
Windows** — a causa do B1 (junction) deixou de existir, então não há o que testar lá além de "nenhum link é
criado", que é independente de sistema e está coberto; caixa de disco no NTFS; `agent_type`/`cwd` no app
desktop; se a limpeza automática de worktrees nativos do Claude Code atravessa junctions (não há mais
junction).

### Efeito colateral de `worktree.baseRef: "head"` para a equipe

Como está versionado, vale para **todos** que abrirem o repo no Claude Code: `claude --worktree` e o
isolamento de subagente passam a nascer do **HEAD local** (com commits ainda não publicados), não de
`origin/HEAD`. É o que faz as frentes enxergarem este sistema, mas muda o hábito de quem usa
`--worktree` hoje. Há relatos de que o app desktop ignora essa chave (não verificado aqui).

## O que o `allow` não garante — re-revisão independente do #782 (09/10/2026)

Uma re-revisão do que foi juntado (Opus, só leitura, reproduzida no Windows) achou três pontos: **M1**
(`npx eslint -c <arquivo>.mjs` executava código sem confirmação), **M2** (o mapa de risco deixava dinheiro e
login como "rotina") e **B2** (`lane.json` com só o nome trocado ou com `base` antiga passava). M2 e B2 estão
corrigidos, com teste que falha sem a correção. **M1 não se fecha por `permissions`, e esta seção diz o porquê
em vez de prometer "seguro por construção".**

### O que a documentação oficial garante (e o que não)

Fonte: <https://code.claude.com/docs/en/permissions>. Tudo abaixo foi **conferido no motor real**
(`claude -p --bare --permission-prompts none` contra um servidor de API falso que devolve um `tool_use` Bash com o
comando exato — sem modelo, sem custo).

- **Garante:** a ordem é deny → ask → allow e a primeira que casa decide, em qualquer escopo de arquivo de
  configuração; `*` casa qualquer texto (inclusive espaços) em qualquer posição; `Bash(x *)` casa também `x` sozinho,
  mas só quando o `*` final é o único curinga; `:*` só vale no fim e equivale a ` *`; num comando composto
  (`&&`, `||`, `;`, `|`, `&`, quebra de linha) o allow exige que **cada** subcomando case e o deny/ask vale se **qualquer**
  um casar, inclusive dentro de `$()`; `timeout`, `time`, `nice`, `nohup`, `stdbuf` e atribuição `VAR=valor` à frente
  são descascados antes de casar; `npx` **não** é descascado.
- **Não garante** (a própria doc diz): regra de Bash que tenta restringir argumento é "frágil", não é "fronteira de
  segurança" e não cobre outra forma de chamar o mesmo programa (`git 'push'`, `/bin/rm`, `sh -c`).
- **Medido além da doc:** espaços repetidos e tab são normalizados; `$(…)` e `${…}` de valor desconhecido caem em
  "pede confirmação"; `X=-c; cmd "$X"` é resolvido e barrado; **aspas partidas (`'-c'`, `--con"fig"`) e barra invertida
  (`\-c`) escapam de qualquer regra, e não existe sintaxe de padrão que case a barra invertida**; aspas que preservam o
  texto da flag (`"--config"`) ainda casam por subcadeia.

### O que se fechou e o que fica como risco residual — as 57 regras de `allow`, agrupadas

"Executa código da frente?" = a frente escreve um arquivo na própria faixa e a regra o executa **sem confirmação**.
Todas as linhas marcadas **sim** foram provadas com marcador inofensivo, não supostas.

| Regra de `allow` | Executa código da frente? | Decisão |
| --- | --- | --- |
| `npx eslint:*` | por flag: `-c`/`--config` e `-f ./x.cjs` (**sim, provados**); `--parser` e `--plugin` carregam módulo por nome ou caminho | **deny** da forma literal; `-f`/`--format` viram **ask**. Config ao lado do arquivo **não** executa (eslint 9.39.2, provado) |
| `npx knip:*` | por flag: `-c`, `--config`, `--directory`, `--reporter`/`--preprocessor` por caminho | **deny** (`-c`, `--config`, `--directory`); **ask** (`--reporter`, `--preprocessor`) |
| `npx vite build:*`, `npx vite preview:*` | por flag: `-c`, `--config` | **deny** |
| `npx commitlint:*` | por flag: `-g`/`--config`, `-x`/`--extends`, `-p`/`--parser-preset`, `-d`/`--cwd` | **deny**; `-o`/`--format` **ask** |
| `npx htmlhint:*` | por flag: `-R`/`--rulesdir`; `-c` só lê JSON (provado) | **deny** |
| `npx stylelint:*` | por flag **e sem flag**: `stylelint.config.cjs` ao lado do `.css` executa (**sim, provado**) | flags **deny**; **risco residual** (config adjacente) |
| `npx cspell:*` | por flag **e sem flag**: `cspell.config.cjs` numa subpasta do arquivo executa (**sim, provado**) | flags **deny**; **risco residual** |
| `python -m sqlfluff lint:*` | sem flag: `.sqlfluff` ao lado do `.sql` com `library_path` importa Python (**sim, provado**) | **risco residual** |
| `npm run lint:css`, `npm run spellcheck` | os mesmos arquivos adjacentes de stylelint/cspell (o script é fixo, os arquivos lidos não) | fica como está (o brief mantém `npm run` versionado); **risco residual** |
| `deno test:*` | **sim, por desenho**: com `--allow-all`/`-A` (o fluxo que o `frente.md` prescreve) o teste da frente roda com todos os poderes; sem flag roda sem permissão nenhuma (provado) | **risco residual inerente**: a frente escreve código na própria faixa e roda o teste dele |
| `deno lint:*` | o plugin de `deno.json` roda, **mas sem nenhuma permissão** (provado: escrita negada) | sem mudança |
| `deno check:*`, `deno fmt:*` | não executam; `check` busca import remoto (rede) | sem mudança; rede é residual |
| `git show:*`, `git diff:*`, `git log:*` | **sim, sem aspas**: `--output=<arquivo>` grava o blob da frente por cima de qualquer arquivo (provado) — via para trocar `scripts/paralelo/` e rodar o subcomando auto-aprovado | **deny** de `--output`; aspas partidas contornam |
| `git branch:*` | não executa; `-D`/`-f`/`-m` apagam/movem refs | observação, fora da classe: não mexi |
| `git blame`, `ls-files`, `rev-parse`, `status`, `remote -v`, `stash list`, `worktree list`, `ls`, `node --version`, `npm --version`, `npm ls` | não | sem mudança |
| `node scripts/paralelo/frente.mjs <sub>:*` | executa o script do próprio worktree, que a frente não escreve (compartilhado + hook) — **exceto** por uma primitiva de escrita fora do hook | mitigado: `git --output` negado, âncora do worktree; `tsc` com `tsconfig` da faixa segue possível (abaixo) |
| `npx tsc:*` | não executa, mas **`--outDir`/`--outFile` copiam JS da frente para onde ela quiser** (provado), direto ou num `tsconfig` da faixa (`-p`) | **risco residual** (`-p` tem uso legítimo; não dá para negar) |
| `npx biome check/format:*` | não (config JSON, sem plugin executável no Biome 1.9.4); `--write` reescreve o que recebe | sem mudança |
| `npx lockfile-lint:*`, `npx size-limit:*` | não; `size-limit --save-bundle/--clean-dir` e `vite build --emptyOutDir` apagam/escrevem pasta | observação: destrutivo, não executa |
| `npm run build/dev/preview/lint/lint:html/lint:lockfile/knip/size/biome:*` | roda o `package.json` versionado | fica como está |
| `supabase db lint/gen types/migration list/status/test db:*` | `test db` executa SQL da frente; com `--db-url`/`--linked`/`--project-id` fala com banco remoto | **risco residual**; só a falta de credencial ao alcance da frente segura (não testado) |
| `Read(./.env.example)` | não | sem mudança |

Nenhum `ask` ou `deny` anterior foi tocado (o teste `tests/front/paralelo-permissoes.test.ts` trava isso). As regras
novas são só acréscimo: 41 `deny` e 8 `ask`.

### O que isso significa na prática

1. **O `allow` é um quebra-molas, não uma fronteira.** Barra a forma literal que um prompt injetado costuma digitar;
   não barra quem parte a flag com aspas, usa barra invertida, grava um `.sqlfluff`/`stylelint.config.cjs`/`cspell.config.cjs`
   ao lado do arquivo, ou roda `deno test --allow-all`. Código arbitrário rodando como o usuário lê `.env`, faz `git push`
   por dentro (sem passar pelo `ask`) e fala com a rede.
2. **O que segura de fato é outra coisa:** nada se integra sozinho. `integrar` lê o manifesto **canônico** da árvore do
   integrador e reprova arquivo fora da faixa antes de qualquer merge; a revisão (`revisor`, `revisor-risco` onde o mapa
   manda) lê o diff; e o resultado entra por branch e PR, que o dono vê. Isso protege **o que entra no repositório**.
   **Não protege a máquina nem as credenciais** de um código que já rodou.
3. **O limite de verdade não existe no Windows nativo:** o sandbox do Claude Code (restringe arquivos e rede por
   sistema operacional) roda em macOS, Linux e WSL2; no Windows nativo os comandos rodam sem sandbox
   (<https://code.claude.com/docs/en/sandboxing>).
4. **Não foi feito aqui e é decisão de quem manda** (cada um fecha parte do residual): (a) a guarda de escrita recusar nome
   de arquivo de configuração de ferramenta (`.sqlfluff`, `stylelint.config.*`, `cspell.config.*`) dentro de uma faixa —
   fecha a via sem flag **na origem**, onde aspas não ajudam; (b) um hook `PreToolUse` para `Bash` que lê o comando inteiro
   (a doc o recomenda quando o texto precisa ser inspecionado); (c) tirar `WebFetch`/`WebSearch` da lista de ferramentas do
   agente `frente` (é a porta de entrada da injeção de prompt); (d) rodar as frentes em WSL2 com sandbox.

### M2 e B2, em uma linha cada

- **M2 — risco semântico:** o mapa de risco passou a casar por caminho `cartao`, `mercado`, `pix`, `payment`, `webhook`,
  `financ`, `login`, `sessao`/`session`, `password`/`senha` (ligar crédito em `config_pagamento_cartao` é decisão de dinheiro do
  dono, AGENTS.md); no conteúdo, `\bfin_` pega `fin_${acao}` montado em template; só `tests/` na raiz e os sufixos
  `.test`/`_test`/`.spec` saem da leitura (uma pasta `tests/` sob `src/` é código); e a saída de `integrar` diz que **lista vazia não
  significa "rotina"** — só que nenhum padrão conhecido casou. A caixa de `Supabase/migrations` já estava certa; ficou travada em teste.
  Custo conhecido: falso alarme (ex.: `CartaoDaVitrine.tsx` é um cartão de tela, não de pagamento) custa um `revisor-risco` a mais.
- **B2 — faixa:** a âncora do worktree (acima). Worktree registrado antes dela é recusado com a mensagem "sem âncora — recrie".

## Riscos conhecidos desta camada

- O hook não vê escrita por `Bash` — a garantia é o diff (`conferir`/`integrar`). Um agente que
  burla pelo `Bash` só adia a reprovação.
- `conferir --base <ref>` aceita qualquer base: serve para conferir um trecho, mas uma frente que o chama com
  `--base HEAD` não vê violação já commitada. A prova que vale é `integrar`, que usa o manifesto canônico.
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
