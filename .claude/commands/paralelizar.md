---
description: Fan-out de ESCRITA sem conflito — decompõe o pedido em frentes de arquivos disjuntos, roda todas ao mesmo tempo em worktrees isolados, revisa em paralelo e integra em ordem (fase 2 paralela do ciclo agêntico)
argument-hint: <o pedido grande, em linguagem natural — ou o caminho de um manifesto já pronto>
---

# Paralelizar: $ARGUMENTS

Você é o **orquestrador**: decompõe, despacha, colhe, integra. **Não escreve código de frente** e
não edita arquivo dentro da posse de uma frente enquanto ela roda. Método, evidência e limites:
`docs/processo/ARQUITETURA-PARALELA.md`. Este comando é a versão paralela do
`/planejar` + `/executar-plano` (que continuam valendo para trabalho serial).

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

## Fase 1 — mapear (leitura paraleliza)

Despache, **numa única mensagem**, agentes `Explore` — um por área que o pedido toca (telas, hooks,
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
- **Granularidade:** 3 a 8 frentes grossas (uma frente = várias tarefas de 2–5 min do mesmo
  território), não uma por tarefa. O limite duro de subagentes simultâneos é 20.
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

## Fase 3 — despachar TUDO numa única mensagem

Uma chamada `Agent` por frente, **todas na mesma mensagem** (é o que as faz rodar juntas),
`subagent_type: "frente"`, `run_in_background: true`. O agente já traz `isolation: worktree` e a
guarda de faixa. Brief de cada uma — autocontido:

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

## Fase 4 — enquanto rodam

Aguarde as notificações de término — não faça polling, não use `sleep`. Não edite arquivo da posse de
nenhuma frente. Pode adiantar, na árvore principal e só nos arquivos **compartilhados**, a escrita dos
PEDIDOS que já chegaram? **Não** — espere todas voltarem: os pedidos de frentes diferentes ao mesmo
arquivo precisam ser aplicados juntos, uma vez.

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

Depois, **numa única mensagem**, revisão em contexto limpo — quem escreveu não revisa:

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

## Parar e subir ao dono

Ação irreversível; segurança; decisão de produto/dinheiro; push/merge em branch que não é sua;
conflito de integração com faixas validadas (sinal de decomposição errada, não de má sorte).
