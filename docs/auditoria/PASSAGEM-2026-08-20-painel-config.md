# Passagem — painel do lojista: Clientes, Ajustes, Cupons, Frete e Push

Documento para quem continuar isto numa sessão nova. Lê em 4 minutos.

⚠️ **Datas.** Tudo nesta linha de trabalho aconteceu em **20/08/2026**. A versão anterior deste
documento datava entregas em 21 e 22/08 e o próprio arquivo se chamava `PASSAGEM-2026-08-22`;
nenhuma dessas datas existiu — o `git log --date=iso-strict` mostra os commits entre 04:22 e
05:04 do dia 20. As datas falsas concordavam entre si e não quebravam teste nenhum. Carimbe
data de `git log` ou do relógio, nunca de cabeça.

Esta é uma de **três frentes** que trabalharam no mesmo repositório e na mesma árvore ao mesmo
tempo. As outras são `painel-pedidos-produtos` (passagem em
[PASSAGEM-2026-08-20.md](PASSAGEM-2026-08-20.md)) e `coordenacao-e-fechamento`.

---

## Onde o trabalho está

- **Branch:** `fix/painel-pedidos-alto-risco`, compartilhada pelas três frentes.
- **Tudo commitado e empurrado.** Sem PR aberto no momento em que isto foi escrito — a frente
  de coordenação combinou abrir **um** PR com tudo, para o CI não medir alvo em movimento.
- **Não confie em nenhuma afirmação de estado escrita aqui.** Rode o quadro, que mede na hora:

  ```bash
  node "C:\Users\Gabriel\.claude\mural\mural.mjs" core_app_mkt
  ```

- **PRs já mergeados na `develop`:** #241 e #243. Nada foi para a `main` — **merge não é estar
  no ar**.
- **A migration `20260821000200` (cupom sem limite) JÁ FOI APLICADA** no Supabase de
  desenvolvimento, com autorização explícita do Gabriel, e conferida por duas revisões
  independentes depois.

---

## O que está fechado

Auditoria das cinco telas → **16 achados** com evidência de tela + banco, em
[2026-08-20-painel-config.md](2026-08-20-painel-config.md), ordenados por dor. O Gabriel mandou
corrigir um a um, por essa ordem. Fechados:

| # | O defeito | O que a tela faz agora |
|---|---|---|
| 1 | Cupom "∞ usos" aceito no checkout e **recusado ao finalizar** | limite nulo ou ≤ 0 significa ilimitado nas duas RPCs de criação de pedido |
| 2 | "Todos os pedidos terão cobrança de entrega" — falso com a taxa em zero | as frases saíram do JSX, viraram função pura, e o estado perigoso ganhou aviso |
| 3 | "Frete grátis a partir de R$ 100" sem dizer que exige estar logado | a frase conta a condição |
| 4 | "Ticket Médio" divergindo do Dashboard | o cartão **parou de calcular** e lê a fonte que o Dashboard já publica |
| 5 | Mesmo cliente com 6 pedidos na lista e 16 na ficha | o cartão usa a regra do servidor e diz quantos ficaram de fora |
| 6 | Contadores de segmento de Push eram 30%, 25% e 45% do total | os quatro são medidos; "3 · 2 · 3" virou "2 · 0 · 0" |
| 7 | "iOS: 3 · Android: 5" | saiu da tela — não existe coluna de plataforma para medir |
| 12 | "Receberão: 8 clientes" | "8 aparelhos", com singular e plural certos |

**Três vizinhos apareceram nas revisões e foram junto:**

- **"Pedidos Totais"** contava 12 enquanto o Dashboard contava 11 (mesma raiz do achado 4).
- **O total de aparelhos** ficava em `0` para sempre se a consulta falhasse — indistinguível de
  loja sem ninguém inscrito. A trava do botão de enviar **não** mudou: desconhecido continua
  desabilitando. Falha fechado.
- **A ficha do cliente** dizia "N cancelado fora da conta" para um número que conta cancelado
  **e** devolvido.

Cada correção tem teste próprio **e prova de mutação** — o código foi sabotado e os testes
caíram. As mutações estão descritas nos blocos ✅ do relatório e nas mensagens de commit.

---

## ⚠️ O que falta

### Defeito puro — dá para seguir sozinho, na ordem de dor

O próximo é o **8**: a opção "Notificação Push" aparece no menu dos 16 clientes e funciona em
**1**. Para os outros 15 o envio para no começo e **nem o aviso dentro do app é criado**, porque
o `return` vem antes de qualquer gravação.

Depois: **11** (histórico diz "ENVIADA" mesmo quando ninguém recebeu), **13** (o "Audit Log" de
frete nunca terá linha enquanto a loja usar Taxa Fixa), **14** ("pending" é o único status em
inglês), **15** (mínimo de compra sem centavos), **16** (dois textos errados em Cupons).

### 🔴 Trava no Gabriel — decisão de produto, não técnica

| # | A escolha | Por que é dele |
|---|---|---|
| 9 | "Congelar Acesso" não faz nada | ou implementa o bloqueio de conta, ou tira a opção da tela |
| 10 | Cupom vencido continua "Ativo" | a tela **promete** desativação automática e ela não existe: ou cria o mecanismo, ou apaga a promessa |
| 17 | "LTV Total" por cliente conta pedido não pago | exige **migration** numa função que alimenta a tela inteira, e está fora dos 16 |
| 18 | A tela de Push baixa credencial de envio só para contar | exige função nova no banco; hoje são 3 KB, ninguém sente |

Os achados **17 e 18** nasceram das revisões, não da auditoria, e estão escritos no relatório
com evidência e com o motivo de não terem sido corrigidos.

---

## O que JÁ foi verificado

| | |
|---|---|
| `diretor` sobre o conjunto das 5 primeiras entregas | **CORRIGE** — datas inventadas, achado 5 sem CI, números da passagem medidos localmente e não pelo CI. Tudo cumprido |
| `revisor` (Opus) sobre as 5 primeiras correções | um **BLOQUEIA** (Ticket Médio pela metade), corrigido |
| `revisor` (Sonnet) sobre a tela de Push | passa, com achados que viraram os commits seguintes |
| `revisor` (Sonnet) sobre o Ticket Médio | passa, e achou o vizinho "Pedidos Totais" |
| Revisão independente da frente irmã sobre a migration do cupom | **passa** — e a prova forte: o predicado novo é a negação exata do que o checkout já recusava, então a criação de pedido passou a aceitar exatamente o conjunto que o checkout aceitava, nem um a mais |
| Testes dos 4 arquivos tocados | **28 casos, 4 arquivos, 0 falhas** (`--maxWorkers=1`) |
| `typecheck` | limpo |
| `lint:links` | 288 links em 47 arquivos, nenhum quebrado |
| eslint no escopo dos diffs | **0 erros**, e nenhum aviso novo em linha minha |

⚠️ **A suíte de front inteira não foi rodada nesta sessão**, de propósito: três frentes na mesma
máquina, e duas rodadas concorrentes se atrapalham. Quem certifica é o CI, sobre o PR.

---

## ⚠️ Armadilhas que custaram tempo

- **`git add` não reserva nada nesta árvore — o índice do git é compartilhado.** Ele *arma* o
  arquivo para o próximo commit de **qualquer** sessão, e o hook de pre-commit leva 20-30 s.
  Foi assim que o commit `6e406b4` saiu com 24 linhas de documentação de outra frente dentro.
  Use **`git commit -- <caminho>`**, que ignora o índice.
- **Nunca `git stash`, `checkout`, `restore`, `clean` nem `reset`.** Já apagaram trabalho alheio
  aqui. Para ver o original de um arquivo: `git show HEAD:<caminho>`.
- **O `pre-push` roda `typecheck` sobre a ÁRVORE, não sobre o seu commit.** Trabalho pela metade
  de outra frente bloqueia o seu push com o seu commit impecável — e o inverso é pior: **vermelho
  de `pre-push` não acusa o commit que está sendo empurrado.** Olhe o `git status` antes do diff.
- **O `SET SESSION` vaza entre programas.** A `DATABASE_URL` aponta para o pooler do Supabase
  (`:6543`), que reaproveita conexão entre clientes. Use `BEGIN READ ONLY` ou `SET LOCAL`, e
  abra todo script com `RESET ALL`.
- **Script de prova que escreve é ação de escrita, mesmo chamando-se prova.**
  `db-prove-cupom-sem-limite.cjs` redefine as duas funções do caminho do dinheiro dentro de uma
  transação e trava `store_config`. Com outras sessões no mesmo banco, prefira a prova
  equivalente só de leitura: comparar `pg_get_functiondef` vivo com o arquivo da migration.
- **`tests/front/checkout-view-flag-off.test.tsx` é vermelho conhecido nesta máquina** — o
  `.env.local` tem `VITE_PAGAMENTO_ONLINE=true` e o teste mede a flag desligada. Confirmado com
  a variável sobreposta: passa. **Não descarte esse vermelho sem sobrepor a variável** — esse
  rótulo já escondeu regressão real uma vez.
- **jsdom aqui não traz `localStorage`, `matchMedia`, `ResizeObserver` nem
  `IntersectionObserver`**, e **`@testing-library/react` não existe** neste projeto. Teste de
  tela de admin precisa dos quatro dublês; sem eles o conteúdo some dentro do ErrorBoundary e o
  vermelho parece ser do valor quando é do ambiente.
- **`lint:ratchet` completo passa de 10 min aqui** (o CI faz em ~1,2 min). Rode o eslint só nos
  arquivos do diff e compare os avisos linha a linha contra as faixas do `git diff -U0`.
- **Escopo de commit vem de lista fechada** em `.commitlintrc.json`, e o **assunto não pode ter
  iniciais maiúsculas** — "Pedidos Totais" no assunto reprova.

---

## Coordenação entre as sessões

Existe um quadro compartilhado, fora da árvore do projeto, em `~/.claude/mural/`. Protocolo em
`COMO-FUNCIONA.md`, terreno deste repositório em `core_app_mkt/_REGRAS.md`. **Registre a sua
frente antes de editar o primeiro arquivo** — o quadro acusa arquivo mexido que ninguém assumiu.

⚠️ **A armadilha do campo `sessao`:** o identificador do transcript (o nome da pasta de
scratchpad) **não é** o identificador do canal de mensagens, e uma sessão não consegue ler o
próprio. **As três frentes publicaram o identificador errado** — inclusive a que escreveu o
alerta sobre isso. Ele só aparece no cabeçalho de uma mensagem, do outro lado: mande uma
mensagem a alguém e peça o identificador de volta.

**Faixa de migration desta frente:** `20260821*` a `20260824*`. Confira o disco antes de
escolher número — existe uma quarta frente que nunca entrou no acordo e já usou número de duas
faixas reservadas.
