# A fila única de dor do painel do lojista

Feito em 20/08/2026, por ordem do `diretor`. **Este documento não substitui os dois relatórios de
auditoria** — [Pedidos e Produtos](2026-08-20-painel-pedidos-produtos.md) e
[Clientes, Ajustes, Cupons, Frete e Push](2026-08-20-painel-config.md) continuam sendo a
evidência. Aqui só existe **a ordem**.

## Por que este documento existe

As duas auditorias ordenaram por dor, cada uma **dentro de si**. Enquanto forem duas filas,
"corrija por ordem de dor" significa **duas ordens diferentes**, e quem pega trabalho pega o topo
da fila que estiver olhando.

O efeito já aconteceu, e é medido: o commit `6e406b4` consertou um achado de dor **Média**
enquanto dois **Médio-alto** da outra lista continuavam abertos. Ninguém errou — não existia uma
lista só.

## A régua

Ordenar por adjetivo ("Alto", "Médio") não sobrevive à fusão: o "Médio" de uma auditoria não é o
"Médio" da outra. Então a fila usa uma escada de **quatro degraus**, e o que decide o degrau é
**se quem opera a loja consegue perceber o problema sozinho**:

| Degrau | O que caracteriza | Por que é essa a ordem |
|---|---|---|
| **1 — Mente em silêncio** | O número ou o estado está errado e **nada denuncia**. Quem opera decide em cima dele achando que está certo | Não tem contorno. A pessoa não pode reagir ao que não vê |
| **2 — Promete o que não cumpre** | A tela oferece uma função que não existe, ou afirma um comportamento que não acontece | A pessoa confia, age, e a confiança quebra depois — e ela descobre pelo cliente |
| **3 — Atrapalha, e se vê** | Dá trabalho, esconde informação, obriga a procurar — mas a pessoa **percebe** e contorna | Custa tempo, não custa decisão errada |
| **4 — É feio, e não engana** | Texto, formato, tradução, duplicação de aviso | Ninguém decide errado por causa disso |

**O degrau ganha do adjetivo.** Foi essa troca que mudou a ordem — ver a seção final.

---

## A fila

### Degrau 1 — mente em silêncio

| # | Origem | O que está errado | Quem sente |
|---|---|---|---|
| **A** | config 17 | **"LTV Total" de cada cliente soma pedido que ninguém pagou.** A função da tela de Clientes não tem filtro de cobrança; a do Dashboard tem 19. Hoje batem por coincidência (o cancelamento automático já limpou o que estava em aberto) — divergem no primeiro PIX pendente | quem vende |
| **B** | config 8 | **"Notificação Push" funciona para 1 dos 16 clientes, e falha calado.** Para os outros 15 o envio para e nem a notificação dentro do app é criada. Quem clicou acha que avisou 16 pessoas | quem vende e quem compra |
| **C** | config 11 | **O histórico de Push diz "ENVIADA" em toda linha**, porque o selo é texto fixo. Um envio que ninguém recebeu grava "0 clientes · ENVIADA" — e é justamente o registro que alguém consultaria para descobrir o item **B** | quem vende |
| **D** | pedidos 8 | **Produto sem custo cadastrado aparece como o mais lucrativo do catálogo**, com "Margem 100,0%". E a etiqueta "Custo Suspeito", que existe para pegar isso, **pula justamente o custo zero** | quem vende |
| **E** | pedidos 13 | **Duas contas do mesmo estoque que se soltaram:** card, formulário e variante dizem 10 unidades; o KPI precifica 11 | quem vende |

### Degrau 2 — promete o que não cumpre

| # | Origem | O que está errado | Quem sente |
|---|---|---|---|
| **F** | config 10 | A tela diz "após esse prazo, o cupom é **desativado automaticamente pelo sistema**". **Não existe nada que desative.** O cupom vencido segue com o selo verde "ATIVO" e contando no KPI "Cupons Ativos" | quem vende |
| **G** | config 9 | **"Congelar Acesso"**, em vermelho, no menu do cliente: mostra "Funcionalidade em desenvolvimento" | quem vende |
| **H** | pedidos 9 | **6 produtos com a etiqueta verde "Em Operação" estão com estoque zero** — e na loja o botão deles é "Esgotado". O painel e a vitrine discordam sobre o mesmo produto | quem vende e quem compra |
| **I** | config 13 | "Histórico de Cotações & Audit Logs — exibindo as 15 mais recentes": com o provedor de taxa fixa, que é o padrão e o atual, **nada é registrado ali, nunca** | quem vende |

### Degrau 3 — atrapalha, e se vê

| # | Origem | O que está errado | Quem sente |
|---|---|---|---|
| **J** | pedidos 6 | "Todos Ativos", ligado por padrão, traz tudo: **72 dos 84 pedidos são cancelados**. Achar quem pagou e espera envio custa sete páginas | quem vende |
| **K** | pedidos 12 | O filtro "Status de Pagamento" **só filtra os 12 pedidos da página aberta**, não os 84. É a outra metade do **J**: sem ele, **J** continua doendo depois de resolvido | quem vende |
| **L** | pedidos 7 | "Capital Alocado", "Lucro Potencial" e "ROI" **congelam** depois de excluir, duplicar ou editar produto | quem vende |
| **M** | pedidos 10 | "Ações Pendentes: 7" e, ao lado, o crachá "6" na navegação — dois contadores da mesma coisa discordando na mesma tela | quem vende |
| **N** | pedidos 11 | A tela de Produtos abre dizendo "Nenhum produto cadastrado / 0 itens". São 19; é o texto do carregamento | quem vende |
| **O** | pedidos 16 | Excluir um produto mostra **dois** avisos de "produto removido" | quem vende |

### Degrau 4 — é feio, e não engana

| # | Origem | O que está errado |
|---|---|---|
| **P** | pedidos 14 | "Potencial: + R$ 37,2" — dinheiro com uma casa decimal |
| **Q** | pedidos 15 | "ID: #" na ficha do pedido, sem nada depois |
| **R** | config 14 | "pending" é o único status que aparece em inglês |
| **S** | config 15 | "Mínimo Compra R$ 50" — o valor é exibido sem centavos; R$ 49,90 vira R$ 50 |
| **T** | config 16 | "usem cupons **no carrinho**" (o campo fica no checkout) e "receber **discounts** especiais" |

---

## O que a fila única mudou, e é o ponto do documento

**Três achados subiram, e um bloco inteiro desceu.**

- **B e C sobem para o degrau 1**, vindos de "Médio" e "Médio-baixo". Separados, cada um parece
  um contador errado. **Juntos são um mecanismo:** o envio falha para 15 de 16 pessoas, e o único
  lugar onde isso apareceria carimba "ENVIADA" em tudo. Quem opera a loja não tem **nenhuma**
  forma de descobrir. Nenhuma das duas listas podia ver isso, porque são o mesmo assunto na
  mesma auditoria — mas em posições distantes da tabela.
- **D e E sobem** de "Médio" e "Baixo". Os dois alimentam decisão de preço e de reposição com
  número errado, sem avisar. "Baixo" era a avaliação do sintoma; a régua olha a consequência.
- **J e L descem** de "Médio-alto" para o degrau 3. Continuam valendo conserto — mas quem opera
  **vê** os 72 cancelados e **vê** o KPI parado. Incomodam; não enganam.

**A consequência prática:** os dois "Médio-alto" que pareciam ser o próximo trabalho não são o
topo da fila única. **A é o topo**, e **B+C juntos** vêm logo atrás.

## Duas observações que a fila não resolve, e não deve

- **A, F e G exigem decisão de produto antes de código** — o que a tela deve prometer não é
  escolha técnica. Nenhum agente deve tocar neles antes disso.
- **K é a segunda metade de J.** Consertar J sozinho deixa o problema pela metade, e essa
  dependência não aparecia em nenhuma das duas listas porque as duas ordenavam por dor
  individual, não por dependência.

**Quem está trabalhando em quê agora não está escrito aqui, de propósito** — retrato escrito
vence em minutos e já produziu erro nas duas direções neste repositório. Quem responde isso é o
mural, que mede na hora:

```
node "C:\Users\Gabriel\.claude\mural\mural.mjs" core_app_mkt
```

## Já corrigido, para não voltar à fila

**Pedidos e Produtos 1 a 5** (pedido invisível a todo contador; a ficha não dizia se o pedido foi
pago; "Receita Hoje" contava PIX nunca pago; "Total Concluído" não contava concluído; dinheiro em
pedido cancelado sem fila de ação) e **Clientes/Push 1 a 7 e 12** (cupom ilimitado recusado ao
fechar; frete grátis para o Brasil inteiro; frete grátis que exigia login sem dizer; ticket médio
dividido por clientes; 6 pedidos na lista e 16 na ficha; contadores de segmento inventados;
"iOS/Android" calculado por porcentagem; "clientes" que eram aparelhos).
