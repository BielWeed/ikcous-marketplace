# Rituais

Cinco. Os **quatro de coordenação** não passam de 30 minutos. O quinto — a sessão de par —
vai a 90 e **não cumpre esse teto, de propósito**: não é coordenação, é trabalho sendo feito
com duas pessoas no mesmo código. Está declarado aqui em vez de disfarçado.

Cada ritual tem escrito **o que acontece se ninguém aparecer** — ritual sem consequência
morre em duas semanas e ninguém percebe.

Todos os horários são propostas, em horário de Brasília (America/Sao_Paulo). **Ajustem no
primeiro planejamento**; o que importa é que sejam fixos depois disso, não que sejam estes.

## Calendário

| Quando | Ritual | Duração | Formato |
| --- | --- | --- | --- |
| Segunda, 19h00 | Planejamento do ciclo | 30 min | Chamada |
| Todo dia útil, até 10h | Sincronização diária | 2 min para escrever | Mensagem no Discord |
| Sexta, 18h00 | Fechamento do ciclo + retro | 20 min | Chamada |
| Sob demanda | Sessão de par · sessão de arqueologia | até 90 min · ~20 min | Chamada com tela compartilhada |
| Primeira segunda do mês, 19h30 | Revisão do backlog | 30 min | Chamada, logo após o planejamento |

**Coordenação marcada por semana: 50 minutos** (30 de planejamento + 20 de fechamento). Na
semana da revisão do backlog — a primeira de cada mês —, **80**, e a segunda vira uma hora
corrida de 19h00 às 20h00; se cansar, mova a revisão para a terça.

A isso somam-se as sessões de par, que a §4 torna **obrigatórias** para cartão de risco alto,
cartão que toca banco e o primeiro cartão do Netim. Elas não são reunião, mas são tempo dos
dois: numa semana com cartão de risco alto, conte mais 60 a 90 minutos.

---

## Sua primeira segunda-feira

Enquanto o primeiro planejamento não acontecer, este parágrafo é o processo. Segunda de
manhã, na ordem:

> **Exceção: a primeira segunda do Netim não é esta.** No dia 1 dele vale a
> [`PRIMEIRA-SEMANA-NETIM.md`](PRIMEIRA-SEMANA-NETIM.md), que manda ler e rodar o app, **sem
> escrever código** — os cartões dele saem do planejamento das 19h daquele mesmo dia. O que
> segue vale para o Gabriel nessa segunda, e para os dois em todas as seguintes.

1. **Até as 10h**, escreva a sincronização de 3 linhas no canal do projeto no Discord
   (formato na §2). Se o canal ainda não existe, escreva no privado — a mensagem importa
   mais que o canal.
2. **Não espere o planejamento para trabalhar.** Até o primeiro planejamento acontecer, o
   horário dele é **segunda, 19h00**, sem ajuste e sem discussão — o ajuste é assunto da
   própria reunião.
3. **De onde puxar cartão enquanto o quadro não existe.** O board do GitHub Projects é
   entregável do prompt 5 e ainda não foi criado. Até ele existir: escolha o cartão pelo ID
   direto do ⧗ `docs/backlog/BACKLOG.md`, anuncie no Discord ("peguei `BUSCA-010`") e trate
   esse anúncio como o cartão em `Em progresso`. O limite continua sendo **2 por pessoa**.
4. **Se não houver cartão que passe na
   [Definition of Ready](DEFINITION-OF-DONE.md#definition-of-ready)**, o trabalho da manhã é
   preparar cartões contra ela. Isso é trabalho, não preparação para o trabalho.

> **⧗** Duas ferramentas que estes rituais assumem ainda não existem em 30/07/2026: o **canal
> do Discord** e o **board do Kanban**. Cada ritual abaixo tem uma linha "enquanto não
> existir". Nenhum ritual fica bloqueado esperando ferramenta.

---

## 1. Planejamento do ciclo

**Quando.** Segunda, 19h00. 30 minutos, cronometrados.
**Quem conduz.** Gabriel nos quatro primeiros ciclos, porque só ele tem o contexto para dizer
o que é urgente. **A partir do quinto, alterna** — se depois de três meses ele ainda estiver
conduzindo todos, o gargalo de conhecimento não se moveu e isso é assunto da retro.

**Propósito.** Sair com os cartões dos dois escolhidos e movidos para `Pronto pra pegar`.
Não é para discutir solução técnica — é para escolher trabalho.

**Formato exato:**

1. **(5 min)** O que ficou aberto do ciclo passado e por quê. Sem justificativa longa.
2. **(5 min)** Tem P0 aberto? Tem cartão bloqueando o outro? Tem decisão travando trilha?
   Essas três perguntas decidem quase tudo — a ordem está em
   [`METODOLOGIA.md`, §2.2](METODOLOGIA.md#22-planejamento-de-ciclo).
3. **(15 min)** Escolher os cartões, conferindo a
   [Definition of Ready](DEFINITION-OF-DONE.md#definition-of-ready). Cartão que reprova volta
   para `Backlog` na hora, com o motivo escrito.
4. **(5 min)** Conflito de arquivo: quem pega o quê. As notas de paralelização do
   ⧗ [`ROADMAP.md`](../backlog/ROADMAP.md) são o mapa — `StoreContext.tsx`, `CartContext.tsx`,
   `useOrders.ts`, `CheckoutView.tsx`, `mappers.ts` e `vite.config.ts` são os arquivos que
   geram conflito de verdade, e cada um deles ganha **dono por ciclo**. É alocação de
   trabalho, não propriedade: expira na sexta.

**Enquanto o board não existir.** A escolha vira uma mensagem no Discord com os IDs dos
cartões e quem pegou cada um. Essa mensagem é o registro do ciclo.

**Se ninguém aparecer.**
- **Se só um apareceu:** ele escolhe os cartões dos dois sozinho e escreve a escolha no
  Discord. Quem faltou **não pode reclamar da escolha** — essa é a consequência, e ela
  precisa ser aplicada na primeira vez, senão não vale nada.
- **Se os dois faltarem:** o ciclo herda os cartões da semana anterior, e quem chegar
  primeiro na terça escreve a escolha no Discord **antes** de puxar qualquer coisa. Ninguém
  começa cartão novo numa semana sem escolha registrada.
- **Duas segundas seguidas sem ninguém:** o ritual está morto. Mate formalmente e substitua
  por uma mensagem assíncrona de escolha de cartões.

**Sinal de que virou burocracia.** Os cartões já estavam decididos antes da chamada e a
reunião só confirma. Se acontecer duas vezes seguidas, **corte para 15 minutos**. Se
continuar, **corte o ritual** e faça a escolha por mensagem.

---

## 2. Sincronização diária — assíncrona, sem hora marcada

**Quando.** Todo dia útil, até as 10h. **Não é reunião.** Ninguém espera ninguém.
**Quem conduz.** Ninguém. Cada um escreve a sua.

**Propósito.** Que o outro saiba, sem perguntar, onde você está e se você está travado.
Três linhas, sempre no mesmo formato, no canal do projeto no Discord.

```text
Ontem: <o que avançou — cartão e estado, não narrativa>
Hoje:  <o que vai avançar>
Trava: <o que está me impedindo, ou "nada">
```

Exemplo do que se espera:

```text
Ontem: BUSCA-010 — normalizeText em src/lib/utils.ts pronto, faltam os 3 call sites
Hoje:  fecho os 3 e abro PR
Trava: nada
```

E um exemplo do que **não** serve:

```text
Ontem: mexi na busca
Hoje:  continuo
Trava: nada
```

A diferença é que o primeiro dá ao outro a chance de dizer "o `HomeView.tsx:129` também
normaliza, não esquece" antes do PR existir. O segundo não dá nada.

**Regra da trava.** Trava escrita é trava que o outro **precisa** responder no mesmo dia. Se
você escreveu "trava: nada" três dias seguidos e não fechou nada, isso é uma trava — escreva.

**Enquanto o canal não existir.** Mensagem direta, mesmo formato. O formato é o ritual; o
canal é só o lugar.

**Se ninguém escrever.** Nada acontece automaticamente, e isso é o ponto: é o ritual mais
barato da lista. Mas duas ausências seguidas e o outro pergunta uma vez, direto. Se só uma
pessoa escrever por duas semanas, **mate o ritual** — sincronização que um só cumpre é
relatório, e relatório para ninguém ler é desperdício.

**Sinal de que virou burocracia.** As mensagens ficam iguais dia após dia, ou viram
"trabalhando no de sempre". Aí ela não está informando nada e vira ruído.

---

## 3. Fechamento do ciclo + retro

**Quando.** Sexta, 18h00. 20 minutos. Não passa disso nem que esteja bom.
**Quem conduz.** **O Netim.** É deliberado: quem tem menos contexto conduz a retro, porque
conduzir obriga a perguntar, e perguntar é exatamente o que precisa acontecer nos primeiros
meses.

**Propósito.** Fechar o ciclo com um número e sair com **um** combinado. Retro de duas
pessoas é conversa — não tem post-it, não tem votação, não tem categoria.

**Formato exato:**

1. **(5 min)** O número: quantos cartões fecharam. Anota. É a única métrica que esta dupla
   tem, e ela só existe se for anotada toda semana desde o primeiro ciclo.
2. **(5 min)** O que atrapalhou. Um de cada.
3. **(5 min)** O que funcionou e vale repetir. Um de cada.
4. **(5 min)** **Um** combinado para a semana que vem, escrito no Discord. Um só. Retro que
   sai com cinco combinados não muda nada, porque nenhum é acompanhado.

O combinado da semana anterior é a primeira coisa checada na semana seguinte: aconteceu ou
não? Se não aconteceu duas vezes, o problema não é o combinado, é a retro.

**Enquanto o board não existir.** O número sai da contagem de PRs mergeados na semana
(`gh pr list --state merged --search "merged:>=AAAA-MM-DD"`), e é anotado na mensagem de
fechamento no Discord.

**Se ninguém aparecer.** Quem apareceu escreve o fechamento em cinco linhas no Discord,
incluindo o número de cartões. Se os dois faltarem, **o ciclo não fecha** e o planejamento da
segunda começa com "por que não fechamos" — que é uma abertura ruim e é para ser mesmo.

**Sinal de que virou burocracia.** O combinado da semana passada nunca é lembrado, ou as
respostas viram "foi tudo bem". Aí ela virou reunião de status, que já é a sincronização
diária. **Corte para 10 minutos.** Se continuar, corte o ritual e mantenha só o número.

---

## 4. Sessão de par e sessão de arqueologia

São dois formatos com propósitos diferentes, agrupados aqui porque os dois são "chamada com
tela compartilhada, sob demanda".

**Propósito dos dois.** Tirar da cabeça de quem sabe o contexto que o cartão exige, **antes**
que o risco vire commit.

### 4a. Sessão de par — marcada, até 90 min

**Quando.** Marcada com pelo menos meio dia de antecedência.
**Quem conduz.** Quem pediu — e, nas três sessões **obrigatórias** abaixo, em que ninguém
pediu, conduz quem **não** tem o contexto: quem vai ficar com o cartão.

**É obrigatória** — não é escolha:

- Cartão com `Risco de mexer: alto`
- Qualquer cartão que toque banco de produção
- O primeiro cartão do Netim (ver [`PRIMEIRA-SEMANA-NETIM.md`](PRIMEIRA-SEMANA-NETIM.md))

Nessas três, a falta de quem **não** conduz cai na regra do "convidado não apareceu", abaixo.

**Formato.** Um compartilha a tela e digita, o outro dirige e pergunta. **Trocam na metade** —
com uma exceção: quando a sessão é de **transferência de contexto** (alguém mostrando o
caminho para quem nunca viu aquela parte), não há troca; quem conhece mostra e sai, e o resto
do cartão é feito sozinho. O dia 2 do Netim é exatamente esse caso.

Termina com o cartão em estado commitável ou com o próximo passo escrito no cartão — nunca
com "a gente continua depois", que é como o contexto se perde.

**Se quem pediu não aparecer.** O outro segue com o próprio trabalho e o cartão de risco alto
**não avança sozinho**: fica em `Em progresso` sem commit até a sessão acontecer. Essa
consequência protege a loja — cartão de risco alto feito sozinho é como o
`update_order_status_atomic` chegou em produção comparando `NULL != <uuid>`.

**Se o convidado não aparecer** (o caso mais provável, já que quem pede costuma ser quem está
travado): quem pediu escreve no cartão o que ia perguntar, marca o outro, e segue em outro
cartão. O de risco alto continua parado. Duas ausências seguidas viram assunto da retro.

### 4b. Sessão de arqueologia — imediata, ~20 min

**Quando.** Alguém travado há **mais de 40 minutos** numa parte que o outro conhece. Sem
antecedência, sem agenda: chama e pronto.

**Por que é separada da 4a.** Não faz sentido marcar com meio dia de antecedência uma
chamada para alguém que está travado agora. Travar sozinho por orgulho é o desperdício mais
caro de uma dupla assíncrona.

**Formato.** Quem sabe abre o arquivo e mostra. Quem travou anota. Ao fim, **o que foi
explicado vira comentário na issue ou linha na documentação** — senão a mesma sessão acontece
de novo em duas semanas.

**Se o outro não puder atender na hora.** Ele responde "não consigo agora, X horas" e quem
travou troca de cartão nesse meio-tempo. Ninguém fica 3 horas travado esperando.

**Sinal de que virou burocracia.** Ninguém marca nenhuma sessão de par por um mês inteiro
**e** existiram cartões de risco alto no período — significa que estão sendo feitos sozinhos
e o ritual virou letra morta. O oposto também conta: se toda tarefa vira sessão de par, o
assíncrono parou de funcionar e o problema é a documentação, não o ritual.

---

## 5. Revisão do backlog

**Quando.** Primeira segunda do mês, 19h30, logo depois do planejamento. 30 minutos.
**Quem conduz.** Alterna.

**Propósito.** O backlog envelhece mais rápido do que parece, e **não tem como registrar isso
sozinho**: o `BACKLOG.md` tem os campos `Tipo`, `Prioridade`, `Tamanho`, `Épico`, `Risco`,
`Contexto`, `Evidência`, `Critério de aceite`, `Arquivos`, `Depende de` e
`Bom pra quem está chegando` — **nenhum deles é status**. Status vive no board, por desenho.
Então a única forma de saber o que já está feito é conferir o board contra o que mergeou.

Prova de que isso não é hipótese: o **PR #11**, quando mergear, fecha cinco cartões
(`INFRA-030`, `INFRA-040`, `INFRA-050`, `INFRA-140`, `INFRA-160`) e invade outros dois
(`INFRA-020`, `INFRA-120`). Sete cartões afetados por um PR só, num dia.

**Formato exato:**

1. **(10 min)** O que já está feito e ninguém fechou no board. Confere contra
   `gh pr list --state merged`. Fecha.
2. **(8 min)** O que deixou de fazer sentido porque o código mudou. Fecha com o motivo.
3. **(5 min)** A fila de decisões: das 20 tarefas de tipo `decisao`, quais foram respondidas
   e viraram ADR, e qual é a próxima que trava mais gente.
4. **(4 min)** Reprioriza o que a realidade do mês mudou. Não é replanejar o ROADMAP inteiro.
5. **(3 min)** **As práticas da [`METODOLOGIA.md`](METODOLOGIA.md)**: alguma virou teatro?
   Alguma nasceu morta? Este é o bloco em que aquele documento é podado — e é aqui que se
   confere o sinal de ritmo sustentável (fatia de commits entre 00h e 06h).

**Se ninguém aparecer.** O backlog fica velho, e o custo aparece no planejamento seguinte,
quando alguém puxar um cartão já resolvido. Quando isso acontecer, a revisão do mês seguinte
é obrigatória e vira o primeiro item do planejamento.

**Sinal de que virou burocracia.** Duas revisões seguidas sem fechar nenhum cartão obsoleto.
Aí o backlog está estável e a revisão pode virar **trimestral** — mas os passos 3 e 5 (fila
de decisões e poda das práticas, incluindo o sinal de commits entre 00h e 06h) continuam
mensais, migrando para o fechamento de ciclo da primeira sexta do mês. São eles que mantêm a
[`METODOLOGIA.md`](METODOLOGIA.md) viva.

---

## Autorização explícita para matar ritual

**Qualquer um dos dois pode propor matar qualquer ritual desta lista, a qualquer momento, sem
justificar com dados.** Basta abrir um PR removendo a seção e dizendo por quê. Se o outro
concordar, acabou.

Isto está escrito de propósito. O modo de falha mais comum de processo em time pequeno não é
o ritual ruim — é o ritual ruim que ninguém se sente autorizado a matar, e que vira teatro
semanal que os dois cumprem enquanto reclamam um do outro no privado.

**Três coisas que não morrem por decisão unilateral**, porque não são ritual e sim acordo de
engenharia:

1. **A Definition of Done.**
2. **O PR.** Todo trabalho passa por PR, sempre. *Revisão* é outra coisa: pelo
   ⧗ `CONTRIBUTING.md`, se o outro está indisponível, mergear sem revisão é decisão do autor —
   o que fica registrado é o PR, não a aprovação. Combinado prático: **espere as 48h antes de
   mergear sozinho**, e diga no Discord que fez isso.
3. **Alteração de banco passa pelo Gabriel.**
