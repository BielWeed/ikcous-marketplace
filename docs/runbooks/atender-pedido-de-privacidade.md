# Atender um pedido de privacidade (exclusão de conta ou correção de e-mail)

> Escrito em 14/10/2026 junto com a tela "Privacidade e meus dados" (cliente) e a
> seção "Pedidos de privacidade dos clientes" (painel, Ajustes > Minha loja).
> O app **só registra** o pedido. Quem atende é a loja, à mão, seguindo este
> roteiro. **Nada aqui é automático e nada aqui apaga o login ou os pedidos.**
>
> O SQL dos blocos abaixo foi **ensaiado** num banco de teste com as 165
> migrations do projeto e dados de mentira (cliente, pedido, devolução com foto,
> código de verificação, avaliação…): `tests/banco/anonimizar-conta-ensaio-viva.cjs`
> lê estes mesmos blocos deste arquivo e roda. Mas o ensaio roda num Postgres
> emulado; o que só um Supabase de verdade pode provar está marcado
> **[CONFERIR EM LOJA DE TESTE]** e precisa ser conferido uma vez, numa loja de
> teste, antes do primeiro pedido real.

## Regras que não se negociam

1. **Toda exclusão real passa pelo dono.** Quem atende mostra ao dono o resultado
   do passo 4 (o ensaio) e só roda "valendo" depois do "pode". Vale também para a
   correção de e-mail.
2. **Nunca apagar** a linha do login (`auth.users`) nem os pedidos
   (`marketplace_orders`). Os pedidos apontam para o login, sem cascata, e apagar
   levaria junto o histórico fiscal e financeiro da loja. A exclusão é
   **anonimizar + bloquear a entrada**.
3. **O prazo é de 15 dias**, contados do dia em que a cliente pediu. Como a loja
   é avisada: a **bolinha vermelha do sino** do painel acende enquanto houver
   pedido de privacidade esperando, a tela de Notificações lista quantos são, e
   a seção "Pedidos de privacidade dos clientes" mostra "Responder até" e fica
   vermelha quando o prazo passa. **Não há e-mail, push nem mensagem para a
   loja**: se ninguém abrir o painel, ninguém é avisado. Por isso: abra o painel
   todo dia útil.
4. **A nota que você escreve ao marcar o pedido é lida pela cliente**, na tela
   dela. Escreva em português simples, sem dados de outras pessoas e sem nome de
   tabela. Exemplo: "Sua conta foi encerrada e seus dados pessoais foram
   removidos. Os pedidos ficam guardados sem os seus dados, como a lei exige."
5. **A decisão é final.** Depois de marcar "atendido" ou "não posso atender" o
   banco não deixa mudar. Marque só depois de terminar o trabalho.
6. **Loja por loja.** Cada loja (IKCOUS, Savy…) tem o banco dela e os pedidos
   dela. O pedido aparece só no painel da loja onde a cliente o fez, e este
   roteiro roda no Supabase dessa loja.
7. **Quem pediu pode não ser a dona da conta.** O app só confere que a pessoa
   estava com a conta aberta no aparelho; com um celular emprestado, outra pessoa
   pode pedir a troca do e-mail (para o e-mail dela) ou a exclusão. Por isso,
   **antes de trocar o e-mail ou de anonimizar**, a loja faz sempre as duas coisas
   da seção "Aviso ao e-mail ATUAL e espera de 3 dias" (logo abaixo): avisar o
   e-mail que está hoje na conta e esperar 3 dias corridos. Sem isso, não troque
   e não anonimize.

## Aviso ao e-mail ATUAL e espera de 3 dias (vale para os DOIS tipos de pedido)

1. **Avise o e-mail que está hoje na conta** (não o e-mail novo): ele aparece na
   ficha da cliente no painel e, se não aparecer, em Supabase > Authentication >
   Users. Texto-modelo (troque `TIPO` por "a exclusão da
   sua conta" ou "a troca do e-mail da sua conta"):

   > Olá! Recebemos, pelo app, um pedido de **TIPO**. Se foi você, não precisa
   > fazer nada: vamos atender daqui a 3 dias. Se NÃO foi você (por exemplo, alguém
   > usou o seu celular), responda a este e-mail agora dizendo "não fui eu" e não
   > vamos mexer em nada.

2. **Conte 3 dias corridos** a partir do envio do aviso e anote a data na nota
   interna de quem atende. Antes disso, **não** troque o e-mail e **não** rode o
   passo 4 "valendo" (o ensaio, com `v_confirmar := false`, pode rodar a qualquer
   hora).
3. **Se a dona da conta responder "não fui eu"** (em qualquer momento), pare: não
   troque, não anonimize, marque "Não posso atender" com a nota "Não conseguimos
   confirmar o seu pedido. Se precisar, faça um novo pedido pelo app." e avise o
   dono, porque alguém usou a conta dela.
4. O prazo de 15 dias da regra 3 continua valendo e a espera de 3 dias cabe nele:
   avise no mesmo dia em que abrir o pedido.

## O que a tela da cliente promete (e o roteiro cumpre)

A tela "Privacidade e meus dados" promete exatamente isto — se o texto da tela
mudar, este bloco e o SQL mudam junto (um teste confere que são o mesmo texto):

<!-- tela:apaga -->
- Seu nome, seu telefone e seu CPF
- Seu e-mail de entrada: a conta fica bloqueada e você deixa de entrar
- Seus endereços, inclusive os guardados dentro dos pedidos
- Seus favoritos, seu carrinho e seus avisos dentro do app
- As fotos de devolução que você enviou
- Os códigos de confirmação enviados para você
- O que você escreveu nas observações dos pedidos
<!-- /tela:apaga -->

<!-- tela:fica -->
Os pedidos e as notas fiscais ficam guardados (valores, itens, datas e forma de pagamento), mas sem o seu nome, telefone, CPF, e-mail e endereço. Suas avaliações e perguntas públicas, se houver, também ficam, sem o seu nome.
<!-- /tela:fica -->

O que **não** está nessa promessa e continua fora do nosso alcance (diga ao dono):
a etiqueta de envio (PDF com nome e endereço) fica na transportadora; os dados no
Mercado Pago ficam lá; o que a cliente guardou no aparelho dela (cache do app)
só some quando ela sair da conta ou limpar o navegador.

## Passo 1 — Abrir o pedido

Painel > Ajustes > Minha loja > "Pedidos de privacidade dos clientes". O botão
"Ver cliente" abre a ficha dela. Anote o **identificador** da cliente (é um
código comprido, tipo `a1b2c3d4-…`, na ficha dela) e, se for correção, o e-mail
novo.

## Passo 2 — Ver o que existe (só lê, não muda nada)

No Supabase da loja: SQL Editor > New query. Cole o bloco, troque
`COLE-O-ID-AQUI` pelo identificador (deixe as aspas) e rode (Run). Se esquecer de
trocar, o Supabase responde com erro de formato — nada acontece.

```sql
-- BLOCO: listar
WITH alvo AS (SELECT 'COLE-O-ID-AQUI'::uuid AS id)
SELECT 'e-mail de entrada' AS o_que, u.email AS valor FROM auth.users u, alvo WHERE u.id = alvo.id
UNION ALL SELECT 'nome', p.full_name FROM public.profiles p, alvo WHERE p.id = alvo.id
UNION ALL SELECT 'whatsapp', p.whatsapp FROM public.profiles p, alvo WHERE p.id = alvo.id
UNION ALL SELECT 'cpf', p.cpf FROM public.profiles p, alvo WHERE p.id = alvo.id
UNION ALL SELECT 'endereços', count(*)::text FROM public.user_addresses a, alvo WHERE a.user_id = alvo.id
UNION ALL SELECT 'endereço: rua', a.street FROM public.user_addresses a, alvo WHERE a.user_id = alvo.id
UNION ALL SELECT 'endereço: complemento', a.complement FROM public.user_addresses a, alvo WHERE a.user_id = alvo.id AND nullif(btrim(a.complement), '') IS NOT NULL
UNION ALL SELECT 'endereço: bairro', a.neighborhood FROM public.user_addresses a, alvo WHERE a.user_id = alvo.id
UNION ALL SELECT 'endereço: CEP', a.cep FROM public.user_addresses a, alvo WHERE a.user_id = alvo.id
UNION ALL SELECT 'troca de e-mail pendente', nullif(u.email_change, '') FROM auth.users u, alvo WHERE u.id = alvo.id
UNION ALL SELECT 'troca de telefone pendente', nullif(u.phone_change, '') FROM auth.users u, alvo WHERE u.id = alvo.id
UNION ALL SELECT 'favoritos', count(*)::text FROM public.favorites f, alvo WHERE f.user_id = alvo.id
UNION ALL SELECT 'itens no carrinho', count(*)::text FROM public.cart_items c, alvo WHERE c.user_id = alvo.id
UNION ALL SELECT 'avisos no app', count(*)::text FROM public.notificacoes n, alvo WHERE n.usuario_id = alvo.id
UNION ALL SELECT 'pedidos (todos)', count(*)::text FROM public.marketplace_orders o, alvo WHERE o.user_id = alvo.id
UNION ALL SELECT 'pedidos EM ANDAMENTO', count(*)::text FROM public.marketplace_orders o, alvo
  WHERE o.user_id = alvo.id
    AND (o.status IN ('new', 'processing', 'shipping')
         OR (o.status = 'pending' AND coalesce(o.payment_status, '') NOT IN ('expirado', 'recusado', 'estornado')))
UNION ALL SELECT 'devoluções EM ANDAMENTO', count(*)::text FROM public.devolucoes d, alvo
  WHERE d.user_id = alvo.id AND d.status IN ('solicitada', 'aprovada', 'em_transito', 'recebida')
UNION ALL SELECT 'fotos de devolução guardadas', count(*)::text FROM storage.objects s, alvo
  WHERE s.bucket_id = 'devolucoes' AND split_part(s.name, '/', 1) = alvo.id::text;
```

**Anote** o e-mail de entrada, o nome, o whatsapp, o CPF e o **endereço** (rua,
complemento, bairro e CEP) que aparecerem: o passo 6 precisa deles (depois do
passo 4 eles deixam de existir no banco).

Mostre o resultado ao dono. Se houver **pedido ou devolução em andamento**, pare:
anonimizar o endereço de um pedido que ainda não foi entregue estraga a entrega.
O bloco do passo 4 recusa rodar nesse caso. Espere o pedido terminar (ou combine
com a cliente, fora do app) e volte. O pedido de privacidade continua aberto —
o prazo corre, então avise a cliente por fora do app.

## Passo 3 — Apagar as fotos de devolução (se o passo 2 mostrou alguma)

O SQL não consegue apagar arquivo de verdade (só a linha do cadastro, deixando o
arquivo órfão), então este passo é à mão, no site:

1. Supabase > **Storage** (menu da esquerda) > bucket **devolucoes**.
2. Abra a pasta cujo nome é o **identificador da cliente**.
3. Marque todos os arquivos (caixinha de cima) > **Delete** > confirme.
4. Rode o bloco do passo 2 de novo: "fotos de devolução guardadas" tem de dar 0.

O bloco do passo 4 recusa rodar se ainda houver foto. **[CONFERIR EM LOJA DE
TESTE]** os nomes exatos dos botões do Storage (mudam com a versão do painel).

## Passo 4 — Anonimizar (primeiro o ENSAIO, depois valendo)

**Antes do "valendo": o aviso ao e-mail atual já foi enviado e já se passaram 3
dias corridos sem resposta "não fui eu"** (seção "Aviso ao e-mail ATUAL e espera
de 3 dias", regra 7). O ensaio pode rodar antes; o "valendo", não.

Este bloco faz **tudo numa operação só** (ou tudo, ou nada) e **não apaga o login
nem pedido nenhum**:

- perfil: nome vira "Cliente removido"; telefone, CPF e fotos de perfil somem;
- login: o e-mail vira `excluido+<id>@invalid.local` (um endereço que não existe),
  os dados de cadastro (nome, telefone, CPF) são esvaziados, o pedido pendente de
  troca de e-mail ou telefone e os códigos em andamento são esvaziados, a conta é
  **bloqueada** e as sessões abertas são encerradas; ligações com Google/outros
  são desfeitas;
- registro do login (esquema `auth` do Supabase): os códigos de troca e
  recuperação e as verificações em duas etapas (com telefone) são **apagados**;
  o registro de atividade (`audit_log_entries`) **fica, linha por linha, mas sem o
  IP** e sem e-mail, telefone ou nome — só sobram a ação, o tipo e a data;
- apaga endereços, favoritos, carrinho, avisos do app, avisos de celular
  (push) e códigos de verificação (`otp_verifications`);
- pedidos: o nome vira "Cliente removido"; do retrato do pedido **só passa** a
  forma de entrega, o endereço da loja (retirada) e o canal de venda — telefone,
  e-mail, CPF e **todo o endereço**, com o nome de campo que tiver, saem; o texto
  livre das observações é substituído por um aviso. **Ficam** valores, itens,
  datas, forma de pagamento, frete e rastreio;
- devoluções: somem o texto que a cliente escreveu e a lista de fotos (o valor,
  o motivo e os estados ficam);
- eventos de navegação (`analytics_events`): perdem o vínculo com a cliente.

Como usar:

1. Cole, troque `COLE-O-ID-AQUI` pelo identificador. **Deixe `v_confirmar := false`.**
2. Rode. O resultado esperado é um **erro vermelho** começando por
   `ENSAIO (nada foi gravado)` seguido da lista "quantas linhas cada coisa
   mudaria". Esse erro é de propósito: ele desfaz tudo, é o ensaio.
3. Mostre essa lista ao dono. Com o "pode" dele, troque para `v_confirmar := true`
   e rode de novo. Sem erro = feito.
4. Se o erro começar por `PARADO:` leia o motivo (pedido em andamento, foto
   ainda no Storage, pedido de exclusão não está aberto…). Nada foi mudado.

```sql
-- BLOCO: anonimizar
DO $anonimizar$
DECLARE
  v_id uuid := 'COLE-O-ID-AQUI';   -- identificador da cliente (ficha dela)
  v_confirmar boolean := false;    -- false = ENSAIO (desfaz tudo) | true = VALE
  v_email text;
  v_novo_email text;
  v_n bigint;
  v_rel text := '';
BEGIN
  -- Travas: o que impede de anonimizar no momento errado.
  IF NOT EXISTS (SELECT 1 FROM public.pedidos_de_privacidade
                  WHERE user_id = v_id AND tipo = 'excluir_conta' AND situacao = 'aberto') THEN
    RAISE EXCEPTION 'PARADO: esta cliente não tem pedido de EXCLUSÃO aberto. Nada foi mudado.';
  END IF;
  SELECT email INTO v_email FROM auth.users WHERE id = v_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PARADO: não achei esta cliente no login. Confira o identificador. Nada foi mudado.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.marketplace_orders o
              WHERE o.user_id = v_id
                AND (o.status IN ('new', 'processing', 'shipping')
                     OR (o.status = 'pending' AND coalesce(o.payment_status, '') NOT IN ('expirado', 'recusado', 'estornado')))) THEN
    RAISE EXCEPTION 'PARADO: há pedido EM ANDAMENTO desta cliente (o endereço ainda é necessário para entregar). Espere terminar. Nada foi mudado.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.devolucoes d
              WHERE d.user_id = v_id AND d.status IN ('solicitada', 'aprovada', 'em_transito', 'recebida')) THEN
    RAISE EXCEPTION 'PARADO: há DEVOLUÇÃO em andamento desta cliente. Espere terminar. Nada foi mudado.';
  END IF;
  IF EXISTS (SELECT 1 FROM storage.objects s
              WHERE s.bucket_id = 'devolucoes' AND split_part(s.name, '/', 1) = v_id::text) THEN
    RAISE EXCEPTION 'PARADO: ainda há fotos de devolução dela no Storage. Apague-as primeiro (passo 3). Nada foi mudado.';
  END IF;

  v_novo_email := 'excluido+' || v_id::text || '@invalid.local';

  -- Perfil.
  UPDATE public.profiles
     SET full_name = 'Cliente removido', whatsapp = NULL, cpf = NULL, avatar_url = NULL, cover_url = NULL
   WHERE id = v_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rel := v_rel || format(E'perfil (nome, telefone, CPF, fotos): %s\n', v_n);

  -- Dados soltos da cliente.
  DELETE FROM public.user_addresses WHERE user_id = v_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rel := v_rel || format(E'endereços apagados: %s\n', v_n);
  DELETE FROM public.favorites WHERE user_id = v_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rel := v_rel || format(E'favoritos apagados: %s\n', v_n);
  DELETE FROM public.cart_items WHERE user_id = v_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rel := v_rel || format(E'itens do carrinho apagados: %s\n', v_n);
  DELETE FROM public.notificacoes WHERE usuario_id = v_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rel := v_rel || format(E'avisos do app apagados: %s\n', v_n);
  DELETE FROM public.push_subscriptions WHERE user_id = v_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rel := v_rel || format(E'avisos de celular (push) apagados: %s\n', v_n);
  DELETE FROM public.otp_verifications
   WHERE order_id IN (SELECT id FROM public.marketplace_orders WHERE user_id = v_id)
      OR lower(email) = lower(v_email);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rel := v_rel || format(E'códigos de verificação apagados: %s\n', v_n);
  UPDATE public.analytics_events SET user_id = NULL WHERE user_id = v_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rel := v_rel || format(E'eventos de navegação desvinculados: %s\n', v_n);

  -- Pedidos: ficam (valores, itens, datas, pagamento, frete, rastreio); saem os dados pessoais.
  -- No retrato do pedido (customer_data) só PASSA o que está na lista de permitidos:
  -- forma de entrega, endereço da LOJA (retirada) e canal de venda. Qualquer outra
  -- chave, mesmo de nome que ninguém previu, sai junto.
  UPDATE public.marketplace_orders
     SET customer_name = 'Cliente removido',
         customer_phone = NULL,
         customer_data = CASE WHEN jsonb_typeof(customer_data) = 'object'
           THEN coalesce((SELECT jsonb_object_agg(e.key, e.value)
                            FROM jsonb_each(customer_data) AS e
                           WHERE e.key IN ('shipping_option_id', 'pickup_address', 'canal')),
                         '{}'::jsonb)
           ELSE '{}'::jsonb END,
         notes = CASE WHEN nullif(btrim(notes), '') IS NULL THEN notes
                      ELSE '[texto removido a pedido da cliente]' END,
         observation = CASE WHEN nullif(btrim(observation), '') IS NULL THEN observation
                            ELSE '[texto removido a pedido da cliente]' END
   WHERE user_id = v_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rel := v_rel || format(E'pedidos anonimizados (continuam existindo): %s\n', v_n);

  -- Devoluções: o que a cliente escreveu e a lista de fotos (as fotos já foram apagadas no passo 3).
  UPDATE public.devolucoes SET detalhe = NULL, fotos = '{}' WHERE user_id = v_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rel := v_rel || format(E'devoluções limpas de texto e fotos: %s\n', v_n);

  -- Login: NUNCA apagar. E-mail sem identidade, cadastro esvaziado, conta bloqueada, sessões encerradas.
  -- Também esvazia o pedido pendente de troca de e-mail/telefone e os códigos em andamento.
  UPDATE auth.users
     SET email = v_novo_email,
         phone = NULL,
         raw_user_meta_data = jsonb_build_object('anonimizado', true),
         email_change = '',
         phone_change = '',
         confirmation_token = '',
         recovery_token = '',
         email_change_token_new = '',
         email_change_token_current = '',
         phone_change_token = '',
         reauthentication_token = '',
         banned_until = timestamptz '2999-12-31 00:00:00+00',
         updated_at = now()
   WHERE id = v_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rel := v_rel || format(E'login bloqueado e sem identidade: %s\n', v_n);
  UPDATE auth.identities
     SET identity_data = jsonb_build_object('sub', v_id::text, 'email', v_novo_email),
         provider_id = v_id::text
   WHERE user_id = v_id AND provider = 'email';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rel := v_rel || format(E'ligação de e-mail anonimizada: %s\n', v_n);
  DELETE FROM auth.identities WHERE user_id = v_id AND provider <> 'email';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rel := v_rel || format(E'ligações com Google/outros desfeitas: %s\n', v_n);
  DELETE FROM auth.sessions WHERE user_id = v_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rel := v_rel || format(E'sessões abertas encerradas: %s\n', v_n);
  DELETE FROM auth.one_time_tokens WHERE user_id = v_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rel := v_rel || format(E'códigos de troca/recuperação do login apagados: %s\n', v_n);
  DELETE FROM auth.mfa_factors WHERE user_id = v_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rel := v_rel || format(E'verificações em duas etapas (com telefone) apagadas: %s\n', v_n);

  -- Registro de atividade do login (auth.audit_log_entries): a LINHA fica (ação, tipo, data,
  -- identificador), mas sem o IP e sem nada pessoal (e-mail, telefone, nome). Só PASSA o que
  -- está na lista de permitidos. (a) o que a própria cliente fez:
  UPDATE auth.audit_log_entries a
     SET ip_address = '',
         payload = (
           coalesce((SELECT jsonb_object_agg(e.key, e.value)
                       FROM jsonb_each(a.payload::jsonb) AS e
                      WHERE e.key IN ('actor_id', 'actor_via_sso', 'action', 'log_type')),
                    '{}'::jsonb)
           || CASE WHEN jsonb_typeof(a.payload::jsonb -> 'traits') = 'object'
                   THEN jsonb_build_object('traits',
                          coalesce((SELECT jsonb_object_agg(t.key, t.value)
                                      FROM jsonb_each(a.payload::jsonb -> 'traits') AS t
                                     WHERE t.key IN ('user_id', 'provider', 'factor_id', 'factor_type')),
                                   '{}'::jsonb))
                   ELSE '{}'::jsonb END
         )::json
   WHERE a.payload ->> 'actor_id' = v_id::text;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rel := v_rel || format(E'registro de atividade dela, sem IP e sem dados pessoais: %s\n', v_n);
  -- (b) o que um administrador fez no cadastro dela: o IP e o nome dele ficam, saem o
  -- e-mail e o telefone DELA que o registro guardou.
  UPDATE auth.audit_log_entries a
     SET payload = jsonb_set(a.payload::jsonb, '{traits}',
           coalesce((SELECT jsonb_object_agg(t.key, t.value)
                       FROM jsonb_each(a.payload::jsonb -> 'traits') AS t
                      WHERE t.key IN ('user_id', 'provider', 'factor_id', 'factor_type')),
                    '{}'::jsonb))::json
   WHERE jsonb_typeof(a.payload::jsonb -> 'traits') = 'object'
     AND a.payload::jsonb -> 'traits' ->> 'user_id' = v_id::text
     AND coalesce(a.payload ->> 'actor_id', '') <> v_id::text;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rel := v_rel || format(E'registro de atividade de administrador sobre ela, sem e-mail/telefone dela: %s\n', v_n);

  IF NOT v_confirmar THEN
    RAISE EXCEPTION '%', E'ENSAIO (nada foi gravado). Isto é o que mudaria:\n' || v_rel
      || E'Para valer, mude v_confirmar para true e rode de novo.';
  END IF;
  RAISE NOTICE '%', E'FEITO:\n' || v_rel;
END
$anonimizar$;
```

**[CONFERIR EM LOJA DE TESTE]** (só um Supabase de verdade prova):

- depois de rodar valendo, **tente entrar** na conta de teste (senha antiga): tem de
  ser recusado; e um celular já logado deve perder a sessão (no máximo em 1 hora);
- os nomes das colunas do esquema `auth` na versão do Supabase da loja
  (`banned_until`, `raw_user_meta_data`, `identities.provider_id`,
  `identities.identity_data`, `sessions`, as colunas de troca e de código de
  `users` — `email_change`, `phone_change`, `*_token*` —, `one_time_tokens`,
  `mfa_factors` e `audit_log_entries.payload` / `ip_address`). O ensaio local usa
  uma cópia emulada delas (o `payload` do registro de atividade como `json`, como o
  GoTrue cria). Se o Supabase recusar alguma coluna, o bloco para inteiro e nada
  muda: avise quem programa;
- se o papel do SQL Editor tem **permissão de escrever** em `auth.audit_log_entries`,
  `auth.one_time_tokens` e `auth.mfa_factors` (em algumas versões só o papel interno
  do login escreve ali: o bloco para inteiro com "permission denied" e nada muda);
- se algum gatilho do Supabase (fora das migrations do projeto) reage a mudança
  no `auth.users`;
- se o passo 6, rodado de novo depois, não lista nenhuma tabela `auth.`.

Ficam de fora, de propósito (não são dado pessoal legível, mas diga ao dono):
`auth.refresh_tokens` e `auth.flow_state` (códigos técnicos de acesso, sem nome
nem e-mail; o ensaio não os cobre). O acesso já está bloqueado pela conta banida;
se o dono quiser limpar também, é um passo novo a pedir a quem programa.

## Passo 5 — Marcar o pedido no painel

Só depois do passo 4 valendo. Volte à seção "Pedidos de privacidade dos
clientes", escreva a nota (regra 4) e toque em "Marcar como atendido" (ou "Não
posso atender", com o motivo na nota) e confirme na pergunta. O painel grava quem
decidiu e quando; a cliente passa a ver a resposta na tela dela.

## Passo 6 — Caçar o que sobrou (texto livre)

O que o bloco do passo 4 não consegue saber: texto livre onde o **nome** ou o
**telefone** dela foi escrito à mão (resposta da loja numa avaliação, nota de
devolução, pedido feito sem login com o mesmo e-mail…). Este bloco só LÊ e lista
"tabela, coluna, quantas linhas" que ainda contêm os dados antigos que você
anotou no passo 2. Troque os quatro valores entre aspas (se não tiver um deles,
deixe `''`):

```sql
-- BLOCO: sobras
CREATE OR REPLACE FUNCTION pg_temp.sobras(
  p_nome text, p_email text, p_fone text, p_cpf text,
  p_endereco text[], p_cep text)
RETURNS TABLE (tabela text, coluna text, linhas bigint)
LANGUAGE plpgsql AS $sobras$
DECLARE
  r record;
  e text;
  v_texto text[] := ARRAY[]::text[];
  v_fone text := right(regexp_replace(coalesce(p_fone, ''), '\D', '', 'g'), 10);
  v_cpf text := regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g');
  v_cep text := regexp_replace(coalesce(p_cep, ''), '\D', '', 'g');
  v_n bigint;
BEGIN
  IF length(btrim(coalesce(p_nome, ''))) >= 5 THEN v_texto := v_texto || ('%' || btrim(p_nome) || '%'); END IF;
  IF position('@' IN coalesce(p_email, '')) > 0 THEN v_texto := v_texto || ('%' || btrim(p_email) || '%'); END IF;
  -- Endereço: rua, complemento e bairro (cada um com pelo menos 5 letras, senão casaria com tudo).
  FOREACH e IN ARRAY coalesce(p_endereco, ARRAY[]::text[]) LOOP
    IF length(btrim(coalesce(e, ''))) >= 5 THEN v_texto := v_texto || ('%' || btrim(e) || '%'); END IF;
  END LOOP;
  IF length(v_fone) < 10 THEN v_fone := NULL; END IF;
  IF length(v_cpf) <> 11 THEN v_cpf := NULL; END IF;
  IF length(v_cep) <> 8 THEN v_cep := NULL; END IF;
  FOR r IN
    SELECT c.table_schema::text AS s, c.table_name::text AS t, c.column_name::text AS col
      FROM information_schema.columns c
      JOIN information_schema.tables x
        ON x.table_schema = c.table_schema AND x.table_name = c.table_name
     WHERE c.table_schema IN ('public', 'auth') AND x.table_type = 'BASE TABLE'
       AND c.data_type IN ('text', 'character varying', 'jsonb', 'json', 'ARRAY')
       AND c.table_name <> 'pedidos_de_privacidade'
  LOOP
    EXECUTE format(
      $q$SELECT count(*) FROM %1$I.%2$I
          WHERE %3$I::text ILIKE ANY ($1)
             OR ($2 IS NOT NULL AND regexp_replace(%3$I::text, '\D', '', 'g') LIKE '%%' || $2 || '%%')
             OR ($3 IS NOT NULL AND regexp_replace(%3$I::text, '\D', '', 'g') LIKE '%%' || $3 || '%%')
             OR ($4 IS NOT NULL AND regexp_replace(%3$I::text, '\D', '', 'g') LIKE '%%' || $4 || '%%')$q$,
      r.s, r.t, r.col) INTO v_n USING v_texto, v_fone, v_cpf, v_cep;
    IF v_n > 0 THEN
      tabela := CASE WHEN r.s = 'public' THEN r.t ELSE r.s || '.' || r.t END;
      coluna := r.col; linhas := v_n;
      RETURN NEXT;
    END IF;
  END LOOP;
END
$sobras$;

SELECT * FROM pg_temp.sobras('NOME COMPLETO ANTIGO', 'email.antigo@exemplo.com', '(11) 91234-5678', '123.456.789-09',
                             ARRAY['RUA ANTIGA', 'COMPLEMENTO ANTIGO', 'BAIRRO ANTIGO'], '01001-000');
```

Resultado vazio = não sobrou nada. Se listar algo, abra aquela tabela, olhe as
linhas e troque o trecho à mão por "[removido]". Os dois últimos valores são o
**endereço** que você anotou no passo 2 (rua, complemento e bairro, na lista
entre colchetes, e o CEP): esvazie o que não tiver (`ARRAY[]::text[]` e `''`).
Tabelas que começam por `auth.` são do login (registro de atividade, códigos de
troca, verificação em duas etapas): se aparecer alguma depois do passo 4, **pare
e avise quem programa** — o passo 4 devia ter limpado. Linhas de `reviews`
(`merchant_reply`), `answers` e `devolucao_eventos` são os suspeitos de sempre:
são textos que a **loja** escreveu e podem citar o nome dela. Os números de
telefone, CPF e CEP casam por dígitos, então um código de barras parecido pode
aparecer: confira antes de mexer. O endereço **da loja** (retirada) fica no
pedido de propósito: se a cliente morava no mesmo bairro da loja, o bairro
aparece em `marketplace_orders.customer_data` e é esperado — confira.

O que **fica de propósito**: a linha do pedido de privacidade (a tabela
`pedidos_de_privacidade`, que guarda o e-mail novo quando o pedido era de
correção — é o registro legal do que foi pedido); `vor_receipts` (cadeia de
provas encadeadas por hash: mexer quebraria a prova); o identificador (um código
sem nome) que continua ligando pedidos ao login bloqueado.

## Correção de e-mail (a cliente digitou o e-mail novo)

O app não troca o e-mail sozinho: falta um remetente de confirmação, e trocar
sem confirmar deixaria qualquer um tomar a conta de outra pessoa. Por isso a
troca é manual e **só com prova de que o e-mail novo é dela** e **depois de
avisar o e-mail de hoje e esperar 3 dias** (um celular emprestado bastaria para
alguém pedir a troca para o e-mail dele e ficar com a conta):

1. **Avise o e-mail ATUAL da conta** com o texto-modelo da seção "Aviso ao e-mail
   ATUAL e espera de 3 dias" (diga que houve um pedido de troca de e-mail e que,
   se não foi ela, deve responder). Anote a data.
2. Escreva para o **e-mail novo** que a cliente pediu, pedindo que ela responda
   confirmando que foi ela. Não troque antes da resposta.
3. Só troque quando **as duas coisas** já tiverem acontecido: a resposta do
   e-mail novo **e** 3 dias corridos desde o aviso ao e-mail atual, sem resposta
   "não fui eu". Com isso e o "pode" do dono: Supabase > Authentication > Users >
   a cliente > editar o e-mail (marque como confirmado, já que você acabou de
   conferir por resposta).
4. Se o e-mail novo não responder em 7 dias, marque "Não posso atender" com a nota
   "Não conseguimos confirmar que o e-mail novo é seu. Faça um novo pedido
   quando puder responder ao nosso e-mail."

## O que NÃO fazer

- Não apagar o login da cliente nem pedido nenhum.
- Não marcar "atendido" antes de terminar os passos 3 e 4 (a decisão é final).
- Não pedir a senha da cliente, nem por e-mail.
- Não copiar dados da cliente para planilha, e-mail ou conversa.

## Como desfazer a migration (só se nunca houve pedido)

`supabase/migrations/rollback-manual-20261238000000_*.sql` **recusa rodar** se
existir qualquer pedido registrado (o registro é prova legal). Com a tabela
vazia ela desfaz tudo.
