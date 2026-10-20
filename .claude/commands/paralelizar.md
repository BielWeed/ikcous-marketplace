---
description: Fan-out de ESCRITA sem conflito em 3 modos (eco, normal, max) — decompõe o pedido em frentes de arquivos disjuntos, roda em worktrees isolados por sessão do desktop OU por subagente (escolhe o melhor canal por frente), respeita o modo /gpt, revisa em paralelo e integra em ordem
argument-hint: [eco|normal|max] <o pedido grande, em linguagem natural — ou o caminho de um manifesto já pronto>
---

# Paralelizar: $ARGUMENTS

Você é o **orquestrador**: decompõe, despacha, colhe, integra. **Não escreve código de frente** e
não edita arquivo dentro da posse de uma frente enquanto ela roda. Método, evidência e limites:
`docs/processo/ARQUITETURA-PARALELA.md`. Este comando é a versão paralela do
`/planejar` + `/executar-plano` (que continuam valendo para trabalho serial).

## Modo (primeira palavra do argumento: `eco`, `normal` ou `max`; sem palavra = `normal`)

O modo decide **quanto** paralelizar. O resto do comando (decompor, provar faixas, revisar, integrar)
vale igual nos três: o modo muda a largura, nunca a disciplina.

| | `eco` | `normal` | `max` |
|---|---|---|---|
| Para que serve | tarefa média ou RAM/cota apertada; paralelismo barato | o dia a dia | pedido grande, dono quer o PC inteiro trabalhando |
| Agentes vivos ao mesmo tempo (teto) | **2 a 3** | **4 a 5** | **8** (o teto medido, abaixo) |
| Frentes por onda | 2 a 3 | 3 a 5 | até 8, em ondas encadeadas |
| Revisor | um por frente, que nasce junto com a frente quando couber no teto; `revisor-risco` só onde o mapa de risco mandar | idem | idem, e o crítico de desenho entra no início |
| Reposição | despacha o lote, colhe, despacha o seguinte | repõe a vaga quando uma frente termina | **reposição contínua**: a vaga que abre é preenchida na hora; do primeiro ao último minuto o teto está cheio enquanto houver trabalho disjunto na fila |
| Se a fila acabar | segue com o que tem | segue com o que tem | em vez de deixar vaga vazia, abre trabalho útil já previsto (revisor adiantado, teste de uma frente pronta, leitura da próxima onda); não inventa frente fora do pedido |

**Teto de 8:** `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS=8` em `~/.claude/settings.json`, medido em 14/10 (o 9º
subagente falha com "Concurrent subagent limit"). Conta **tudo que está vivo**: subagente Claude, `codex:sol`
e cada sessão do desktop (esta vale **2 vagas**: traz MCPs e `tsserver` próprios, medido em 16/10 com ~1,2 GB só de
`tsserver`; recalibrar por medição). Em nenhum modo passe do teto do modo.

**Portão de RAM antes de cada despacho (nos três modos):** meça a RAM livre
(`Get-CimInstance Win32_OperatingSystem`, `FreePhysicalMemory`). Abaixo de **2 GB livres**, não despache nada
novo até uma vaga fechar e a memória voltar; um dia em que o PC travou derrubou tudo junto. O `max` usa o PC
inteiro, mas **até** esse piso, nunca abaixo dele. Acima do piso a RAM é dos agentes; não "economize por
educação" fora do `eco`.

## Canais: como cada frente roda (decida POR FRENTE, a cada tarefa que aparece)

Há dois canais de execução e você escolhe o melhor para **cada** frente, não um para o lote todo. Reavalie a cada
vaga que abre: o que aparece no meio do trabalho também escolhe o canal.

| Canal | Como | Escolha quando |
|---|---|---|
| **Subagente** (ferramenta `Agent`) | roda dentro desta sessão; o relatório final volta inteiro para você | frente curta ou média, bem delimitada; leitura, mapa, revisão, medição; precisa do resultado **agora** para decidir a próxima peça; muitas frentes pequenas |
| **Sessão do Claude Desktop em worktree própria** (`mcp__ccd_session__start_session`, `use_worktree: true`) | aparece como linha na janela ao lado, com contexto, branch e PR próprios; o dono vê e pode conversar com ela | frente **longa ou pesada** (muitos arquivos, vai ter PR próprio), que merece janela de contexto limpa e se beneficia de o dono acompanhar ou intervir; trabalho que sobrevive à compactação desta sessão; peça que termina em PR |
| **`codex:sol`** (modelo GPT) | um subagente `codex:sol` | só quando o `/gpt` está ligado (regras abaixo) |

Critérios práticos, nesta ordem: (1) **risco** — dinheiro, autenticação, permissão, migração, contrato: Claude
(Opus), nunca decidido só pelo Codex; (2) **tamanho** — pequena e rápida = subagente; grande e autônoma = sessão;
(3) **precisa voltar para mim já?** — sim = subagente (a sessão só devolve uma nota curta, de ~400 caracteres, e
você confere pelo disco); (4) **o dono quer ver?** — sim = sessão; (5) **vaga e RAM** — sessão custa 2 vagas;
quando o teto está apertado, prefira subagente. Frentes de arquivos que se cruzam não rodam em paralelo em canal
nenhum.

Sessão do desktop: o brief é o mesmo da Fase 3 (autocontido) e deve dizer a posse, a faixa de migration, o que as
vizinhas fazem e "não toque em arquivo fora da posse"; **você não vê o relatório inteiro**, então no fim confira o
resultado pelo disco (`git log`, `git diff`, `frente.mjs integrar --so-conferir`), nunca pela nota. Quando você
não está dentro do app desktop (CLI puro, sessão na nuvem) o canal sessão não existe: use só subagentes e diga isso
uma vez.

### Se o `/gpt` estiver ligado (leia `~/.claude/estado/modo-gpt.json`; o hook também avisa a cada turno)

O modo `/paralelizar` **obedece o `/gpt`**; ele não o contorna nem o dobra. Os modos do `/gpt` se somam ao seu:

- **Fatia no Codex** por lote (conta por TAREFA despachada): `normal` 40–50%, `alto` 50–75%, `ultra` 90–100%.
  Escreva a conta no relatório final: "Equipe: X Claude / Y GPT".
- **Só `codex:sol`** (gpt-6.1-sol; raciocínio: **`low` é proibido**; sem a linha `effort:` roda em `high` (preferido); `medium` só para tarefa simples e fácil; `xhigh`/`max`/`ultra` para o difícil). Cabeçalho do prompt: `sandbox: workspace-write`
  (escrita só em worktree **aninhada na da sessão**) ou `read-only` (leitura, pesquisa, revisão) e `approvals: ask`.
  **Nunca** `yolo`, `full-access` nem "Allow always".
- **Escolha para o Codex o que ele faz bem:** volume, arquivos disjuntos, leitura, segunda opinião adversarial.
  Decisão de produto e peça que depende de contexto longo desta conversa ficam no Claude.
- **O sandbox do Codex não grava o `.git` nem atravessa a junction do `node_modules`:** quem commita, roda `tsc`,
  build e testes é o Claude. Conte isso na decisão (frente que precisa rodar teste pesado vira Claude ou exige que
  você rode por ela).
- **Pisos que nenhum modo dobra:** risco alto só junta com **uma revisão Opus** do SHA final; segredo, chave e
  credencial nunca vão ao Codex; o gate de revisão do Codex segue desligado; achado do Codex se **verifica no
  código** antes de agir; Codex indisponível ou sem limite = cai para Claude e você avisa; `socio`, `diretor` e
  `investigador` ficam no Claude. A fatia do Codex é meta do lote, não licença para empurrar o que depende de
  decisão de produto.
- `/gpt` desligado = nenhuma tarefa no Codex.

## Quando NÃO paralelizar (decida antes de gastar um token)

| Situação | Faça |
|---|---|
| Duas partes mexem na MESMA função/arquivo | uma frente só, ou serial |
| B precisa de algo que A cria (RPC, tipo gerado, componente) | duas **ondas**: manifesto 1 → integra → manifesto 2 |
| Renomeação/refactor que atravessa o repo | serial, `corretor-build` |
| Migration que depende de objeto criado por outra migration | mesma frente (mesma faixa) |
| Só 1 frente sobrou | `/executar-plano` |
| Pedido é decisão de produto/dinheiro/público/irreversível | suba ao dono com a conta feita (AGENTS.md) |

Cada **onda** = um manifesto. Dentro da onda tudo é paralelo; entre ondas é serial.

## Fase 0 — pré-voo (obrigatório; falhou, pare)

O worktree dos subagentes nasce do **HEAD commitado**, não da sua árvore suja. (Medido nesta
instalação: sem `worktree.baseRef: "head"` ele nasce da branch padrão do remoto e não enxerga nada
disto.) Confira:

1. `git status --short` limpo — senão commite o que for seu antes de despachar.
2. `.claude/settings.json` tem `"worktree": { "baseRef": "head" }`.
3. `git cat-file -e HEAD:scripts/paralelo/frente.mjs` e `HEAD:.claude/agents/frente.md` existem.
4. Você está numa branch de integração própria (nunca `main`/`develop`; o `guarda-de-branch` barra).
   A BASE do PR final é a linha de trabalho do dono — hoje `claude/app-major-upgrade-wmc8x2`, **não**
   `main` (`git branch -r --contains HEAD` e o último PR mergeado confirmam). Pode haver uma sessão
   local editando ao mesmo tempo: `git fetch` e olhe as branches recentes antes de decompor.
5. `git worktree list` — se sobraram worktrees de uma rodada anterior, `frente.mjs limpar` primeiro.
6. **Modo e ambiente** (diga o resultado em uma linha ao começar): (a) o modo lido do argumento (`eco`, `normal`,
   `max`; sem palavra = `normal`) e o teto dele; (b) o `/gpt`: `Get-Content ~/.claude/estado/modo-gpt.json` (modo
   `off`/`normal`/`alto`/`ultra`) e se os agentes `codex:sol` existem nesta sessão; (c) se a ferramenta
   `mcp__ccd_session__start_session` existe (app desktop) — sem ela, só subagentes; (d) RAM livre e vagas já em
   uso por agentes de fundo desta sessão (`/faxina` mostra o quadro).

## Fase 1 — mapear (leitura paraleliza)

Despache, **numa única mensagem** (até o teto do modo), agentes `Explore` — um por área que o pedido toca (telas, hooks,
edge functions, banco, testes). Brief autocontido (subagente não vê esta sessão): o pedido, a área,
o que devolver (arquivos reais, símbolos, quem consome o quê, **pontos de contato entre áreas**).
Os pontos de contato são o insumo da decomposição: é neles que frentes colidem.

## Fase 2 — decompor em frentes e provar que não se cruzam

Despache o `planejador` com o pedido + o mapa. Peça **um manifesto JSON** além da spec e do plano:

```json
{
  "plano": "cupom-e-painel",
  "frentes": [
    {
      "nome": "cupom-checkout",
      "descricao": "regra de cupom no checkout",
      "posse": ["src/views/customer/CheckoutView.tsx", "src/lib/cupom/**", "tests/front/cupom-*.test.ts"],
      "faixa_migrations": { "de": "20261300", "ate": "20261309" }
    },
    { "nome": "painel-financeiro", "posse": ["src/views/admin/AdminFinanceiroView.tsx", "src/components/admin/financeiro/**"] }
  ],
  "liberados": { "src/App.tsx": "painel-financeiro" }
}
```

Regras da decomposição (o `planejador` deve cumpri-las; você confere):

- **Posse = o que a frente escreve, teste incluído.** Globs ancorados num diretório; nada de `**/*`.
- **Disjunção.** Dois globs que podem casar o mesmo arquivo reprovam. Na dúvida, estreite o glob.
- **Compartilhados** (`package.json`, lockfile, `database.types.ts`, `App.tsx`, `rotas.ts`,
  `vercel.json`, workflows, `AGENTS.md`…) não são de frente nenhuma: viram PEDIDO. Se UMA frente
  precisa de verdade escrever num deles, entregue o caminho exato em `"liberados"`.
- **Migration:** `faixa_migrations` de 8 dígitos, acima da maior existente (o `validar` olha a sua
  cópia e as branches remotas; **migration só local de outra sessão ele não vê** — confirme a faixa
  com o dono/mural), sem cruzar com outra frente — folga de ~10 por frente. Migration nunca entra em `posse`.
- **Granularidade:** frentes grossas (uma frente = várias tarefas de 2–5 min do mesmo território), não uma por
  tarefa. Quantas: a do modo (`eco` 2–3, `normal` 3–5, `max` até 8 em ondas). O teto simultâneo é o do modo e
  nunca passa de 8 (`CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS=8`; o 20 que a doc cita é o padrão do Claude Code, não o
  desta máquina). Mais frentes que o teto vão para a fila da Fase 3.
- **Etiqueta de risco** por frente (mapa do `AGENTS.md`): frente de risco é despachada com
  `model: "opus"` e ganha `revisor-risco` na Fase 5.

Grave: spec/plano por frente em `docs/superpowers/specs|plans/`, o manifesto em
`docs/superpowers/lanes/<AAAA-MM-DD>-<assunto>.json`. Depois **prove** (isto é código, não opinião):

```
node scripts/paralelo/frente.mjs validar docs/superpowers/lanes/<manifesto>.json
```

Reprovou → devolva ao `planejador` com a saída; repita até `✓`. **Não despache com manifesto
reprovado** — é a única garantia de que o merge não vai conflitar. Pergunta ao dono pendente
(produto/dinheiro/público/irreversível)? Pare e suba com a recomendação.

Commite spec, plano e manifesto — arquivos NOVOS, então `git add -N <caminhos>` (intenção de adicionar;
não troca o índice dos outros) e `git commit -- <caminhos>` (`git commit -- <novo>` sozinho falha com
"pathspec did not match"). **O manifesto tem que estar commitado**: os worktrees nascem do HEAD, as
frentes leem o próprio plano e `frente.mjs entrar` só aceita um manifesto de `docs/superpowers/lanes/`
presente no HEAD (um manifesto solto ou fora dessa pasta é recusado — é o que impede a frente de
forjar a própria faixa).

## Fase 3 — despachar até o teto do modo, numa única mensagem

Antes de despachar: (1) escolha o **canal de cada frente** (seção "Canais", acima) e a fatia do Codex se o `/gpt`
estiver ligado; (2) confira o **portão de RAM** (2 GB livres); (3) some as vagas: nenhum modo passa do seu teto
(`eco` 2–3, `normal` 4–5, `max` 8; sessão do desktop vale 2).

As frentes que cabem no teto vão **todas na mesma mensagem** (é o que as faz rodar juntas). As que não cabem
ficam numa **fila ordenada** (a que destrava mais trabalho, ou a de maior risco, primeiro) e entram na Fase 4,
uma por vaga que abrir. Por canal:

- **Subagente Claude:** uma chamada `Agent`, `subagent_type: "frente"`, `run_in_background: true`. O agente já
  traz `isolation: worktree` e a guarda de faixa.
- **Subagente Codex (só com `/gpt` ligado):** uma chamada `Agent` com `subagent_type: "codex:sol"`, cabeçalho
  `sandbox: workspace-write` + `approvals: ask` no topo do prompt, e o caminho ABSOLUTO de uma worktree **aninhada
  na desta sessão** (`git worktree add -b <branch> .claude/worktrees/<nome> HEAD`, com `node_modules` ligado por
  junction se a frente precisa de teste, que o Codex não roda: você roda). Hook barra escrita em worktree irmã.
  **Você, o orquestrador, faz o que o Codex não consegue (ele não grava no `.git`):** antes de despachar, dentro
  dessa worktree, `node scripts/paralelo/frente.mjs entrar docs/superpowers/lanes/<arquivo>.json <frente>`
  (o manifesto já está no HEAD de onde ela nasceu); quando o Codex voltar, na mesma worktree rode
  `frente.mjs conferir` (tem de passar) e `frente.mjs commitar -m "<tipo>(<escopo válido>): …"`. Sem o commit a
  branch fica no SHA de base e `integrar` enxerga zero arquivos mudados, pulando o trabalho dele em silêncio. Na
  Fase 5 a frente do Codex entra no mapa `frente=<branch>` como as outras.
- **Sessão do desktop:** `mcp__ccd_session__start_session` com `use_worktree: true`, `context: "fresh"`,
  `initiation: "user_asked"` (o dono invocou `/paralelizar`, que é o pedido de trabalho paralelo em palavras dele),
  `source_branch: <sua branch de integração>` (o manifesto tem que estar commitado nela, senão a sessão nasce sem
  ele), `branch_name` curto, `prompt` = o brief abaixo e `background` = o objetivo geral do lote (≥ 80 caracteres).
  Uma sessão por frente, nunca duas na mesma. A sessão **não é** um agente `frente`: não tem a guarda de faixa
  automática, então o brief manda ela registrar a faixa (`entrar`) como primeiro passo e conferir antes de terminar.

Brief de cada uma — autocontido:

```
Frente: <nome>   Manifesto: docs/superpowers/lanes/<arquivo>.json
Objetivo: <1–3 frases, sem justificativa de loja/cliente/assinatura (AGENTS.md: escopo)>
Plano desta frente: docs/superpowers/plans/<arquivo>.md   (tarefas, testes, verificação)
Posse (só escreva aqui): <globs>     Faixa de migration: <de–ate | nenhuma>
Compartilhado → PEDIDO no relatório, nunca edição.
Risco: <rotina | mapa de risco: qual item>
Vizinhas rodando agora (NÃO toque no território delas): <nome — o que fazem, em 1 linha cada>
Traga de volta: o relatório final do seu agente (identidade/branch/worktree, arquivos,
verificação colada, PEDIDOS, risco, bloqueios).
```

**Só para sessão do desktop**, acrescente ao brief estes passos (a sessão não traz a guarda do agente `frente`):

1. Primeiro comando: `node scripts/paralelo/frente.mjs entrar docs/superpowers/lanes/<arquivo>.json <frente>`
   (registra a faixa uma vez; se recusar, pare e relate).
2. Trabalhe só dentro da posse. Teste escopado, nunca a suíte inteira.
3. Antes de terminar: `node scripts/paralelo/frente.mjs conferir` (tem de passar) e
   `node scripts/paralelo/frente.mjs commitar -m "<tipo>(<escopo válido>): …"`. Não abra PR nem faça merge: a
   integração é do orquestrador.
4. Nota final: branch, SHA e lista de PEDIDOS. Não toque em arquivo compartilhado.

A linha "vizinhas" é o que o vencedor do padrão usa no lugar de comunicação entre agentes: cada
frente sabe **onde não pisar**, e só. Elas não conversam entre si.

**O que segura, dito sem enfeite.** As permissões do `settings.json` (o `allow`) não são fronteira: várias
ferramentas liberadas executam arquivos que a frente escreve na própria faixa (`deno test --allow-all`,
`sqlfluff`, `stylelint`, `cspell`), e aspas ou barra invertida driblam o texto das regras — medido em
`docs/processo/ARQUITETURA-PARALELA.md`, seção "O que o `allow` não garante". O que segura de fato é: nada
se integra sozinho, `integrar` prova a faixa contra o manifesto **canônico** e a revisão lê o diff. Isso
protege o que entra no repositório; **não protege a máquina** de um código que já rodou (no Windows nativo
não existe sandbox). As medidas que fechariam mais do que resta (guarda de nome de arquivo de configuração,
hook de `Bash`, tirar `WebFetch`/`WebSearch` do agente, WSL2 com sandbox) estão listadas lá como decisão
pendente — **não estão feitas**.

Não rode `npm test` inteiro em várias frentes ao mesmo tempo (o teto de 4 trabalhadores do Vitest é
de memória): cada frente roda teste escopado; a suíte cheia roda uma vez, na Fase 6.

## Fase 4 — enquanto rodam (a reposição é do modo)

Aguarde as notificações de término — não faça polling, não use `sleep`. Não edite arquivo da posse de
nenhuma frente. Pode adiantar, na árvore principal e só nos arquivos **compartilhados**, a escrita dos
PEDIDOS que já chegaram? **Não** — espere todas voltarem: os pedidos de frentes diferentes ao mesmo
arquivo precisam ser aplicados juntos, uma vez.

**A cada término** (notificação de subagente, ou nota de sessão): primeiro **confira o resultado pelo disco**
(`git log`/`git diff` da branch dela, `frente.mjs integrar … --so-conferir`), nunca só pelo texto do relatório;
depois repita o ciclo da vaga que abriu:

1. **`max`:** reponha **na hora**, na mesma resposta em que você processa o término: portão de RAM, escolha do canal
   para a próxima frente da fila (a necessidade mudou? reavalie), despacho. O teto de 8 fica cheio de ponta a
   ponta; vaga vazia com fila não vazia é falha sua. Quando a fila esvazia, preencha com o que a seção "Modo" prevê
   (revisor adiantado, teste de frente pronta, leitura da próxima onda).
2. **`normal`:** reponha a vaga se a fila tiver frente destravada; não force vaga que só atrasa a integração.
3. **`eco`:** não reponha sozinho além do teto 2–3; só abra a seguinte quando a atual for colhida.

O revisor de uma frente que terminou ocupa vaga como qualquer agente: no `max` ele nasce assim que o diff existe.
Achado que bloqueia volta à **mesma** frente (`SendMessage`), sem abrir vaga nova.

Frente bloqueada por dependência com outra: não conserte por cima. Registre, deixe terminar o que dá
e planeje a onda seguinte.

## Fase 5 — colher e revisar em paralelo

Para cada relatório: anote branch e worktree. Em seguida, **a prova do orquestrador, sem confiar no
"passou" de quem escreveu**:

```
node scripts/paralelo/frente.mjs integrar <manifesto> <frente>=<branch> … --so-conferir
```

(`--so-conferir` não mescla nada; reprova se qualquer frente tocou arquivo fora da faixa **e imprime o
MAPA DE RISCO derivado dos caminhos E do conteúdo do diff** — migration, edge function, checkout/pagamento, OTP/auth,
service worker, `vercel.json`, devolução. Frente listada ali EXIGE `revisor-risco`: a etiqueta que o
planejador ou a frente deram ao próprio trabalho não rebaixa isso. É heurística (caminho + palavras no diff: `fin_*`, `SECURITY DEFINER`, `export` de função/tipo alterado ou removido, cartão, Mercado Pago, PIX, login/sessão…): ela só ACRESCENTA frentes ao revisor-risco, nunca dispensa uma — e não vê o que não tem essas marcas, então decisão de risco duvidosa continua escalando para revisão cara (AGENTS.md: "na dúvida, revisão cara"). **Lista vazia NÃO significa "rotina"**: significa "nenhum padrão conhecido casou"; quem decide que é rotina é a leitura do diff (a saída de `integrar` diz isso). Frente
rodada pelo worktree nativo tem branch `worktree-agent-<id>`, por isso o mapa `frente=branch`.)

Depois, **numa única mensagem** (até o teto do modo; as que não couberem entram por vaga, como na Fase 4), revisão em
contexto limpo — quem escreveu não revisa. Com o `/gpt` ligado, a revisão adversarial de uma frente que **não** é de
risco pode ir ao `codex:sol` (read-only); a de risco alto leva sempre uma revisão **Opus** do SHA final:

- um `revisor` por frente (etapa 1: aderência à spec; etapa 2: as sete lentes) sobre
  `git diff <base>..<branch>`;
- `revisor-risco` em cada frente com etiqueta de risco (prova de migration no Postgres efêmero);
- `corretor-build` só para erro mecânico de typecheck/lint.

Achado que bloqueia volta à **mesma** frente (`SendMessage` ao agente dela, que mantém o worktree e o
contexto) até 3 rodadas; na quarta, `frente` novo com `model: "opus"`.

## Fase 6 — integrar (serial, num worktree de integração) e checar uma vez

0. Integre num **worktree de integração** limpo e em branch própria
   (`git worktree add -b <branch-de-integração> .worktrees/integracao`), não trocando de ramo na árvore
   compartilhada. `integrar` também roda na principal, mas **nunca** dentro do worktree de uma frente.
1. `node scripts/paralelo/frente.mjs integrar <manifesto> <frente>=<branch> …` — prova todas as
   faixas de novo e só então faz um `merge --no-ff` por frente, na ordem do manifesto. Faixas
   disjuntas ⇒ sem conflito; se houver, ele aborta e a decomposição estava errada: reabra a Fase 2.
2. **Pedidos compartilhados, de uma vez, em UM commit.** Se esse commit toca o mapa de risco
   (`vercel.json`, workflows, `database.types.ts`, qualquer caminho que `integrar` marcou), ele também
   passa pelo `revisor-risco` antes do push — o `revisor` genérico do fim não basta. (você ou um `implementador`): some os
   PEDIDOS das frentes; `package-lock.json` e `src/types/database.types.ts` se **regeneram** com a
   ferramenta do repo (`npm install`/`supabase gen types`), nunca à mão; roteador pela skill
   `nova-tela`.
3. **Remova os worktrees das frentes ANTES de checar** (Fase 7): o Biome varre `.claude/worktrees/` e
   conta as cópias como dívida — medido: um worktree esquecido subiu a catraca de 15 para 16 erros
   e a falha parecia ser do código. Então `/checar` completo, **uma vez**, sobre a branch integrada: `npm run typecheck`, `npm test`,
   `npm run build`, `lint:links`, `lint:ratchet`, `size`. Cole a saída.
4. Fim: revisão do branch inteiro pelo `revisor` (contexto limpo) → push → PR em rascunho.

## Fase 7 — limpar

`node scripts/paralelo/frente.mjs limpar <manifesto>` remove os worktrees `.worktrees/` já
integrados e limpos. Worktrees nativos de subagente (`.claude/worktrees/agent-*`) saem com
`git worktree remove <caminho>` + `git branch -d <branch>` depois da integração (o Claude Code
também os varre sozinho passado `cleanupPeriodDays`, nunca os que têm trabalho não integrado).

**Worktree com `node_modules` ligado por junction** (as do Codex e as de sessão, quando criadas por você): antes de
`git worktree remove`, desfaça só o atalho com `cmd /c rmdir <worktree>\node_modules` (sem `/s`). Remover a
worktree com a junction de pé apaga o `node_modules` verdadeiro da árvore principal. Worktree de sessão do desktop
que ainda esteja aberta no app: arquive a sessão primeiro, depois remova.

## Parar e subir ao dono

Ação irreversível; segurança; decisão de produto/dinheiro; push/merge em branch que não é sua;
conflito de integração com faixas validadas (sinal de decomposição errada, não de má sorte).
