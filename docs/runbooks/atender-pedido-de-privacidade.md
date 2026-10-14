# Atender um pedido de privacidade (exclusão de conta ou correção de e-mail)

> Escrito em 14/10/2026 junto com a tela "Privacidade e meus dados" (cliente) e a
> seção "Pedidos de privacidade dos clientes" (painel, Ajustes > Minha loja).
> O app **só registra** o pedido. Quem atende é a loja, à mão, seguindo este
> roteiro. **Nada aqui é automático e nada aqui apaga conta ou pedido.**
>
> **Este roteiro NÃO foi ensaiado em loja real.** Os passos 3, 4 e 6 mexem em
> dado de verdade: cada um tem a marca [CONFERIR] onde o procedimento ainda
> precisa ser provado numa loja de teste antes do primeiro pedido real.

## Regras que não se negociam

1. **Toda exclusão real passa pelo dono.** Quem está atendendo mostra ao dono o
   que vai mudar (lista do passo 2) e só executa depois do "pode". Vale também
   para a correção de e-mail.
2. **Nunca apagar** a linha do login (`auth.users`) nem os pedidos
   (`marketplace_orders`). Os pedidos apontam para o login, sem cascata, e
   apagar levaria junto o histórico fiscal e financeiro da loja. A exclusão é
   **anonimizar + bloquear a entrada**.
3. **O prazo é de 15 dias** contados do dia em que a cliente pediu. A seção do
   painel mostra "Responder até" e fica vermelha quando passa. O sino do painel
   avisa quando há pedido esperando.
4. **A nota que você escreve ao marcar o pedido é lida pela cliente**, na tela
   dela. Escreva em português simples, sem dados de outras pessoas e sem nome de
   tabela. Exemplo: "Sua conta foi encerrada e seus dados pessoais foram
   removidos. Os pedidos ficam guardados sem o seu nome, como a lei exige."
5. **A decisão é final.** Depois de marcar "atendido" ou "não posso atender" o
   banco não deixa mudar. Marque só depois de terminar o trabalho.
6. **Loja por loja.** Cada loja (IKCOUS, Savy…) tem o banco dela e os pedidos
   dela. O pedido aparece só no painel da loja onde a cliente o fez.

## Passo 1 — Abrir o pedido

Painel > Ajustes > Minha loja > "Pedidos de privacidade dos clientes". O botão
"Ver cliente" abre a ficha dela (nome, e-mail de entrada, pedidos).

Anote: o tipo do pedido, a data, e (se for correção) o e-mail novo.

## Passo 2 — Antes de mexer: listar o que existe e mostrar ao dono

No SQL Editor do Supabase **da loja certa**, só com `SELECT` (não muda nada),
troque `<ID>` pelo identificador da cliente (aparece na ficha dela):

```sql
select id, full_name, whatsapp, cpf is not null as tem_cpf, avatar_url is not null as tem_foto
  from public.profiles where id = '<ID>';
select count(*) as enderecos from public.user_addresses where user_id = '<ID>';
select count(*) as favoritos from public.favorites where user_id = '<ID>';
select count(*) as pedidos from public.marketplace_orders where user_id = '<ID>';
select count(*) as no_carrinho from public.cart_items where user_id = '<ID>';
select count(*) as avisos_no_aparelho from public.push_subscriptions where user_id = '<ID>';
select count(*) as avaliacoes from public.reviews where user_id = '<ID>';
select count(*) as perguntas from public.questions where user_id = '<ID>';
```

Mostre o resultado ao dono. Ele decide se segue.

## Passo 3 — Exclusão de conta: anonimizar [CONFERIR numa loja de teste]

O que sai (a lista que a tela da cliente promete):

- **Nome, telefone e CPF** do perfil (`profiles`: `full_name`, `whatsapp`,
  `cpf`, `avatar_url`, `cover_url`). Troque o nome por `Cliente removido` e
  esvazie os outros.
- **Endereços** (`user_addresses`): apagar as linhas da cliente.
- **Favoritos** (`favorites`) e **carrinho** (`cart_items`): apagar as linhas.
- **Avisos neste aparelho** (`push_subscriptions`): apagar as linhas.

O que fica, porque a lei manda guardar:

- **Os pedidos** (`marketplace_orders`) e as notas fiscais. Troque nos pedidos
  dela `customer_name` por `Cliente removido` e esvazie `customer_phone`.
  [CONFERIR] o campo `customer_data` (JSON) também guarda nome, e-mail e
  telefone: limpe esses três e **deixe o que a nota fiscal exige** — o que fica
  é decisão do dono com o contador, não minha. Os itens, valores, datas e o
  código de pagamento ficam intactos.
- As **avaliações e perguntas** públicas continuam, mas passam a mostrar o nome
  anonimizado do perfil ("Cliente removido"). Se a cliente pedir para tirar o
  texto também, é um segundo pedido: trate com o dono, caso a caso.

Modelo (rode primeiro dentro de `begin; … rollback;`, confira as contagens, e
só então troque `rollback` por `commit` — com o "pode" do dono):

```sql
begin;
update public.profiles
   set full_name = 'Cliente removido', whatsapp = null, cpf = null,
       avatar_url = null, cover_url = null
 where id = '<ID>';
delete from public.user_addresses where user_id = '<ID>';
delete from public.favorites where user_id = '<ID>';
delete from public.cart_items where user_id = '<ID>';
delete from public.push_subscriptions where user_id = '<ID>';
update public.marketplace_orders
   set customer_name = 'Cliente removido', customer_phone = null
 where user_id = '<ID>';
-- customer_data: limpar nome/e-mail/telefone conforme decisão do dono (ver acima)
rollback;  -- troque por commit só depois da conferência e do "pode"
```

Os `delete` acima são sobre **dados pessoais soltos da cliente**, nunca sobre
pedidos nem sobre o login. [CONFERIR] se algum gatilho de `marketplace_orders`
reage a esse `update` (o histórico do pedido pode registrar a mudança).

## Passo 4 — Bloquear a entrada [CONFERIR]

Sem isto a cliente continua conseguindo entrar na conta vazia.

Supabase > Authentication > Users > a cliente > "Ban user" (ou o equivalente da
versão do painel do Supabase). **Não use "Delete user"**: apagar o login
quebra a ligação dos pedidos.

[CONFERIR] ainda não foi provado que o bloqueio do Supabase derruba a sessão que
ela já tem aberta no celular (o acesso vence sozinho em até uma hora). Prove
numa loja de teste antes do primeiro pedido real.

## Passo 5 — Correção de e-mail (a cliente digitou o e-mail novo)

O app não troca o e-mail sozinho: falta um remetente de confirmação, e trocar
sem confirmar deixaria qualquer um tomar a conta de outra pessoa. Por isso a
troca é manual e **só com prova de que o e-mail novo é dela**:

1. Escreva para o **e-mail novo** que a cliente pediu, pedindo que ela responda
   confirmando que foi ela. Não troque antes da resposta.
2. Com a confirmação e o "pode" do dono: Supabase > Authentication > Users >
   a cliente > editar o e-mail (marque o e-mail como confirmado, já que você
   acabou de conferir por resposta).
3. Se a cliente não responder em 7 dias, marque "Não posso atender" com a nota
   "Não conseguimos confirmar que o e-mail novo é seu. Faça um novo pedido
   quando puder responder ao nosso e-mail."

## Passo 6 — Marcar o pedido no painel

Volte à seção "Pedidos de privacidade dos clientes", escreva a nota (regra 4) e
toque em "Marcar como atendido" (ou "Não posso atender" com o motivo na nota) e
confirme na pergunta. O painel grava quem decidiu e quando; a cliente passa a
ver a resposta na tela "Privacidade e meus dados".

## O que NÃO fazer

- Não apagar o login da cliente nem pedido nenhum.
- Não marcar "atendido" antes de terminar os passos 3 e 4 (a decisão é final).
- Não pedir a senha da cliente, nem por e-mail.
- Não copiar dados da cliente para planilha, e-mail ou conversa.

## Como desfazer a migration (só se nunca houve pedido)

`supabase/migrations/rollback-manual-20261234000000_*.sql` **recusa rodar** se
existir qualquer pedido registrado (o registro é prova legal). Com a tabela
vazia ela desfaz tudo.
