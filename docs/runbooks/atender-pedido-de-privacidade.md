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
   do passo 4 (o ensaio). Espere o "pode" antes de apagar fotos do Storage ou
   rodar "valendo". A correção de e-mail também precisa do "pode".
2. **Nunca apagar** a linha do login (`auth.users`) nem os pedidos
   (`marketplace_orders`). Os pedidos apontam para o login, sem cascata, e apagar
   levaria junto o histórico fiscal e financeiro da loja. A exclusão é
   **anonimizar + bloquear a entrada**. **A conta da dona da loja** (linha de
   `dono_da_loja`) **e a de quem é administrador** (`profiles.role = 'admin'` ou o
   papel de admin no login) **não se anonimizam por este roteiro: o bloco do passo 4
   para** com `PARADO:`. A chave estrangeira de `dono_da_loja` só impede APAGAR a
   linha do login, e este roteiro não apaga — por isso a trava fica no bloco. Se o
   pedido veio de uma dessas contas, leve ao dono: primeiro ele tira o cargo de
   administrador ou troca o dono da loja (`DELETE FROM public.dono_da_loja` e novo
   `INSERT`, só com o "pode" dele); só depois o roteiro segue.
3. **O prazo é de 15 dias**, contados do dia em que a cliente pediu. Como a loja
   é avisada: a **bolinha vermelha do sino** do painel acende enquanto houver
   pedido de privacidade esperando, a tela de Notificações lista quantos são, e
   a seção "Pedidos de privacidade dos clientes" mostra "Responder até" e fica
   vermelha quando o prazo passa. **Não há e-mail, push nem mensagem para a
   loja**: se ninguém abrir o painel, ninguém é avisado. Por isso: abra o painel
   todo dia útil.
4. **A nota do painel não substitui a confirmação por e-mail.** A cliente só
   consegue ler a nota se ainda puder entrar no app. Na exclusão, a loja envia
   a confirmação à mão (passo 7). Escreva a nota em português simples, sem
   endereço de e-mail, outros dados pessoais ou nomes de tabelas.
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

   **Esse e-mail só avisa que o pedido chegou.** Para exclusão, mantenha a
   conversa do aviso. Antes de apagar fotos ou bloquear a conta, reconfira o
   destinatário no passo 4. Depois de concluir e conferir a exclusão, responda
   na conversa do aviso que valeu para a espera (passo 7). Não copie o endereço
   de e-mail para a nota do pedido.

2. **Conte 3 dias corridos** a partir do envio do aviso e anote a data na nota
   interna de quem atende. Antes disso, **não** troque o e-mail, **não** apague
   fotos e **não** rode o passo 4 "valendo" (o ensaio, com
   `v_confirmar := false`, pode rodar a qualquer hora).
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
Os pedidos e as notas fiscais ficam guardados (valores, itens, datas e forma de pagamento), mas sem o seu nome, telefone, CPF, e-mail e endereço. Suas avaliações e perguntas públicas, se houver, também ficam, sem o seu nome. O registro dos seus pedidos de privacidade também fica, com o e-mail novo que você digitou se pediu para corrigir o e-mail.
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
WITH alvo AS (SELECT 'COLE-O-ID-AQUI'::uuid AS id), a_devolver AS (
  -- Mesma conta do painel "Dinheiro a devolver" (20261402000000), por pedido,
  -- em centavos, limitada à conta da cliente.
  SELECT GREATEST(b.centavos - COALESCE(l.em_curso, 0)
                  - GREATEST(COALESCE(l.concluido, 0) - b.estornado, 0), 0) AS resto
    FROM (
      SELECT o.id,
             GREATEST(round(COALESCE(o.total, 0) * 100)
                      - round(COALESCE(dm.valor, 0) * 100)
                      - round(COALESCE(o.valor_estornado, 0) * 100), 0) AS centavos,
             round(COALESCE(o.valor_estornado, 0) * 100) AS estornado
        FROM public.marketplace_orders o
        LEFT JOIN LATERAL (
          SELECT sum(dv.valor_reembolso) AS valor FROM public.devolucoes dv
           WHERE dv.order_id = o.id AND dv.status = 'concluida' AND dv.reembolso_manual
        ) dm ON true
       WHERE o.user_id = (SELECT id FROM alvo)
         AND o.status = 'cancelled'
         AND o.payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega')
         AND NOT (COALESCE(o.cancelled_after_shipping, false) AND o.returned_to_seller_at IS NULL)
    ) b
    LEFT JOIN LATERAL (
      SELECT sum(round(r.amount * 100)) FILTER (WHERE r.status IN ('solicitado', 'em_processamento')) AS em_curso,
             sum(round(r.amount * 100)) FILTER (WHERE r.status = 'concluido') AS concluido
        FROM public.order_refunds r
       WHERE r.order_id = b.id
         AND r.status IN ('solicitado', 'em_processamento', 'concluido')
         AND round(r.amount * 100) > 0
    ) l ON true
   WHERE b.centavos > 0
)
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
UNION ALL SELECT 'avisos de celular (push)', count(*)::text FROM public.push_subscriptions ps, alvo WHERE ps.user_id = alvo.id
UNION ALL SELECT 'pedidos (todos)', count(*)::text FROM public.marketplace_orders o, alvo WHERE o.user_id = alvo.id
UNION ALL SELECT 'pedidos EM ANDAMENTO', count(*)::text FROM public.marketplace_orders o, alvo
  WHERE o.user_id = alvo.id
    AND (o.status IN ('new', 'processing', 'shipping')
         OR (o.status = 'pending' AND coalesce(o.payment_status, '') NOT IN ('expirado', 'recusado', 'estornado')))
UNION ALL SELECT 'pedidos com DINHEIRO A DEVOLVER', count(*)::text FROM a_devolver WHERE resto > 0
UNION ALL SELECT 'pedidos cancelados esperando a mercadoria voltar', count(*)::text
  FROM public.marketplace_orders o, alvo
  WHERE o.user_id = alvo.id AND o.status = 'cancelled'
    AND o.payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega')
    AND o.cancelled_after_shipping AND o.returned_to_seller_at IS NULL
UNION ALL SELECT 'estornos EM ANDAMENTO', count(*)::text
  FROM public.order_refunds r JOIN public.marketplace_orders o ON o.id = r.order_id, alvo
  WHERE o.user_id = alvo.id AND r.status IN ('solicitado', 'em_processamento')
UNION ALL SELECT 'devoluções EM ANDAMENTO', count(*)::text FROM public.devolucoes d, alvo
  WHERE d.user_id = alvo.id AND d.status IN ('solicitada', 'aprovada', 'em_transito', 'recebida')
UNION ALL SELECT 'devoluções com REEMBOLSO NÃO CONCLUÍDO', count(*)::text
  FROM public.devolucoes d JOIN public.order_refunds r ON r.id = d.refund_id, alvo
  WHERE d.user_id = alvo.id AND d.status = 'concluida' AND d.resolucao_final = 'reembolso'
    AND NOT d.reembolso_manual AND r.status <> 'concluido'
UNION ALL SELECT 'devoluções concluídas com VALE ou TROCA', count(*)::text FROM public.devolucoes d, alvo
  WHERE d.user_id = alvo.id AND d.status = 'concluida' AND d.resolucao_final IN ('vale', 'troca')
UNION ALL SELECT 'cupons EXCLUSIVOS dela ainda válidos', count(*)::text
  FROM public.cupom_clientes cc JOIN public.coupons c ON c.id = cc.coupon_id, alvo
  WHERE cc.user_id = alvo.id AND c.alcance = 'exclusivo' AND c.active = true
    AND (c.valid_until IS NULL OR c.valid_until > now())
    AND NOT (c.usage_limit IS NOT NULL AND c.usage_limit > 0 AND COALESCE(c.usage_count, 0) >= c.usage_limit)
UNION ALL SELECT 'cupom exclusivo válido (código)', c.code
  FROM public.cupom_clientes cc JOIN public.coupons c ON c.id = cc.coupon_id, alvo
  WHERE cc.user_id = alvo.id AND c.alcance = 'exclusivo' AND c.active = true
    AND (c.valid_until IS NULL OR c.valid_until > now())
    AND NOT (c.usage_limit IS NOT NULL AND c.usage_limit > 0 AND COALESCE(c.usage_count, 0) >= c.usage_limit)
UNION ALL SELECT 'fotos de devolução guardadas', count(*)::text FROM storage.objects s, alvo
  WHERE s.bucket_id = 'devolucoes' AND split_part(s.name, '/', 1) = alvo.id::text;
```

**Anote** o e-mail de entrada, o nome, o whatsapp, o CPF e o **endereço** (rua,
complemento, bairro e CEP) que aparecerem: o passo 6 precisa deles (depois do
passo 4 eles deixam de existir no banco).

Anote também os telefones distintos guardados nos pedidos da cliente, antes que
o passo 4 os apague:

```sql
SELECT DISTINCT customer_phone FROM public.marketplace_orders WHERE user_id = 'COLE-O-ID-AQUI'::uuid;
```

Leve esses números ao passo 6 e repita a busca de sobras para cada telefone,
além do whatsapp atual.

Mostre o resultado ao dono. Se qualquer uma das **contagens de pendências**
(pedido ou devolução em andamento, dinheiro a devolver, mercadoria a voltar,
estorno em andamento ou reembolso não concluído) for maior que zero, pare.
Anonimizar agora pode atrapalhar a entrega ou tirar da cliente o acesso para
acompanhar o reembolso. O passo 4 também recusa nesses casos. Espere resolver e
volte. O pedido de privacidade continua aberto — o prazo corre, então avise a
cliente por fora do app.

**Vale-troca, troca e cupom só dela: avise ANTES de anonimizar.** Depois do
passo 4 a conta antiga fica bloqueada e, se a cliente criar outra, a conta nova
tem outro identificador: nada do que estava preso à conta antiga passa sozinho.

- **"devoluções concluídas com VALE ou TROCA" maior que zero:** o app não guarda
  se o vale (o cupom que a loja criou à mão) já foi usado nem se a troca já foi
  entregue. Confira na conversa com a cliente. **Troca ainda não entregue:
  entregue antes** de anonimizar (o endereço some no passo 4). **Vale ainda não
  usado:** escreva à cliente, na conversa do aviso, dizendo que o vale continua
  valendo e como usá-lo (se for um código, ela usa digitando o código, com
  qualquer conta). Anote só a data do aviso.
- **"cupons EXCLUSIVOS dela ainda válidos" maior que zero** (as linhas "cupom
  exclusivo válido (código)" dizem quais): o cupom de "Clientes escolhidos" só
  vale para a conta antiga. **O passo 4 para enquanto um deles valer.** Avise a
  cliente e, no painel, abra **Cupons** > o cupom > **Quem pode usar** >
  **Clientes escolhidos** e tire a conta dela da lista (se ela já tiver conta
  nova, ponha a conta nova no lugar). Rode o passo 2 de novo: a contagem tem de
  dar 0.
- "avisos de celular (push)" não pede nada: o passo 4 apaga esses registros.

A linha "pedidos com DINHEIRO A DEVOLVER" segue a mesma conta do painel
"Dinheiro a devolver" (trecho `a_devolver` da migration
[`20261402000000`](../../supabase/migrations/20261402000000_o_inicio_mostra_o_dinheiro_a_devolver_e_a_margem_do_financeiro.sql)).
Ela inclui o cancelado pago depois do prazo e desconta o que já foi devolvido
ou está em estorno. O painel deixa fora desse saldo o cancelado que saiu para
entrega e ainda espera a mercadoria voltar, mas **o roteiro bloqueia também
esse caso**: o reembolso só pode acontecer depois que o produto voltar.
"Estornos EM ANDAMENTO" inclui todo estorno solicitado ou em processamento,
mesmo que já cubra o saldo. "Devoluções com REEMBOLSO NÃO CONCLUÍDO" cobre
também a devolução encerrada cujo estorno pelo Mercado Pago falhou ou foi
recusado: encerrar a devolução não quer dizer que o dinheiro saiu.

## Passo 3 — Localizar as fotos de devolução (sem apagar)

Se o passo 2 mostrou fotos, abra Supabase > **Storage** (menu da esquerda) >
bucket **devolucoes** > pasta cujo nome é o **identificador da cliente**.
Confira que é a pasta certa. **Não clique em Delete neste passo.** Apagar
o arquivo não tem desfazer pelo SQL: deixe para a execução definitiva do
passo 4, depois do ensaio e da aprovação.

## Passo 4 — Anonimizar (primeiro o ENSAIO, depois valendo)

**Antes de apagar fotos ou rodar "valendo": o aviso ao e-mail atual já foi
enviado e já se passaram 3 dias corridos sem resposta "não fui eu"** (seção
"Aviso ao e-mail ATUAL e espera de 3 dias", regra 7). O ensaio pode rodar antes;
a execução definitiva, não.

As mudanças que o bloco faz **no banco** acontecem juntas (ou tudo, ou nada).
Ele **não apaga o login nem pedido nenhum**. Os arquivos no Storage são
apagados separadamente e não voltam se o SQL falhar:

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
- as **anotações internas** da lojista sobre os pedidos dela
  (`marketplace_order_internal_notes`) são **apagadas** (a linha inteira), com a
  contagem no relatório;
- devoluções: somem o texto que a cliente escreveu e a lista de fotos (o valor,
  o motivo e os estados ficam); as notas da loja são conferidas e tratadas à
  mão no passo 6;
- eventos de navegação (`analytics_events`): perdem o vínculo com a cliente.

O bloco **para sem mudar nada** (`PARADO:`) se: não há pedido de exclusão
aberto; a conta não existe; é a conta da **dona da loja** ou de um
**administrador** (regra 2); há pendência de entrega, devolução ou dinheiro do
passo 2; há **cupom exclusivo dela ainda válido** (passo 2); ou, valendo,
ainda há fotos dela no Storage.

Como usar:

1. Cole, troque `COLE-O-ID-AQUI` pelo identificador. **Deixe `v_confirmar := false`.**
2. Rode. O resultado esperado é um **erro vermelho** começando por
   `ENSAIO (nada foi gravado)` seguido da lista "quantas linhas cada coisa
   mudaria". Esse erro é de propósito: ele desfaz tudo, é o ensaio.
3. Mostre a lista ao dono, incluindo a contagem de fotos do passo 2. Só siga
   depois do "pode" dele e da espera de 3 dias descrita acima.
4. **Antes de apagar qualquer foto**, abra Supabase > **Authentication > Users**
   e localize a conta pelo identificador do passo 1. Confira se o e-mail
   verificado que aparece ali ainda é o destinatário do aviso. Se mudou, não
   apague fotos nem bloqueie a conta: envie um novo aviso ao endereço verificado
   atual e conte de novo os 3 dias corridos a partir desse envio. Anote só a
   data do novo aviso, sem copiar o endereço para a nota do pedido. Se não
   conseguir confirmar o endereço, deixe o pedido aberto e avise o dono.
   Com o destinatário conferido e a espera cumprida, rode de novo o passo 2
   e o ensaio com `v_confirmar := false`. Confirme que o pedido de exclusão
   segue aberto, que não chegou resposta "não fui eu", que todas as
   contagens de pendências do passo 2 estão zeradas e que o vale, a troca e o
   cupom exclusivo do passo 2 já foram avisados ou resolvidos. Se aparecer `PARADO:`,
   outro erro ou algo diferente do aprovado, pare sem apagar e leve ao dono.
   Se houver fotos, liste os caminhos dos arquivos, no mesmo Supabase.
   A lista precisa bater com a contagem de fotos que você acabou de conferir:

   ```sql
   SELECT s.name FROM storage.objects s
    WHERE s.bucket_id = 'devolucoes'
      AND split_part(s.name, '/', 1) = 'COLE-O-ID-AQUI'::uuid::text
    ORDER BY s.name;
   ```

5. Só então, se houver fotos, volte à pasta conferida no passo 3. Compare com
   a lista do item anterior e selecione **só os arquivos listados**, um por um,
   pelo caminho completo. Toque em **Delete** e confirme. Não use "selecionar todos". Se vir um
   arquivo novo, se a lista não bater ou se não tiver certeza, pare e refaça
   a conferência do item 4 antes de apagar. Rode o passo 2 de novo: "fotos de
   devolução guardadas" tem de dar 0. Se não der, pare. **[CONFERIR EM LOJA DE
   TESTE]** os nomes dos botões do Storage (mudam com a versão do painel).
6. **Imediatamente antes de bloquear a conta**, mesmo se não houver fotos,
   repita a conferência do destinatário do item 4. Se o e-mail mudou, siga a
   mesma regra de novo aviso e nova espera antes de retomar. Use a conversa
   desse aviso conferido para a confirmação do passo 7.
   Só então troque para `v_confirmar := true` e rode de novo. O bloco reconfere as
   travas, inclusive a ausência de fotos no Storage. Se der `PARADO:` ou
   outro erro, o bloco não gravou nada **no banco**; as fotos já apagadas não
   voltam. Mantenha o pedido aberto e avise o dono antes de continuar.
   Sem erro no SQL, siga para o passo 5; ainda não marque como atendido.

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
  -- Conta da DONA da loja ou de ADMINISTRADOR: bloquear a entrada tiraria a loja de quem a
  -- administra. A chave estrangeira de dono_da_loja só segura DELETE, e este bloco não apaga:
  -- quem segura é esta trava. Papel admin nas DUAS fontes (perfil e login), qualquer uma basta.
  -- O papel "vendedor" é o padrão de todo perfil (não é cargo) e não entra aqui.
  -- Loja que ainda não recebeu a 20261383 não tem dono_da_loja: fica só a trava do admin.
  IF to_regclass('public.dono_da_loja') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.dono_da_loja WHERE user_id = v_id) THEN
      RAISE EXCEPTION 'PARADO: esta conta é da DONA da loja. Não se anonimiza por este roteiro: leve ao dono. Nada foi mudado.';
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = v_id AND role = 'admin')
     OR EXISTS (SELECT 1 FROM auth.users WHERE id = v_id AND (raw_app_meta_data ->> 'role') = 'admin') THEN
    RAISE EXCEPTION 'PARADO: esta conta é de um ADMINISTRADOR da loja. Primeiro o dono tira o cargo; depois rode de novo. Nada foi mudado.';
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
  -- Estorno em curso bloqueia mesmo quando já cobre todo o saldo do painel.
  IF EXISTS (
    SELECT 1 FROM public.order_refunds r
      JOIN public.marketplace_orders o ON o.id = r.order_id
     WHERE o.user_id = v_id AND r.status IN ('solicitado', 'em_processamento')
  ) THEN
    RAISE EXCEPTION 'PARADO: há estorno EM ANDAMENTO desta cliente. Espere terminar. Nada foi mudado no banco.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.marketplace_orders o
     WHERE o.user_id = v_id AND o.status = 'cancelled'
       AND o.payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega')
       AND o.cancelled_after_shipping AND o.returned_to_seller_at IS NULL
  ) THEN
    RAISE EXCEPTION 'PARADO: há pedido cancelado esperando a mercadoria voltar; o reembolso ainda vai acontecer.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.devolucoes d JOIN public.order_refunds r ON r.id = d.refund_id
     WHERE d.user_id = v_id AND d.status = 'concluida' AND d.resolucao_final = 'reembolso'
       AND NOT d.reembolso_manual AND r.status <> 'concluido'
  ) THEN
    RAISE EXCEPTION 'PARADO: há devolução com REEMBOLSO NÃO CONCLUÍDO. Resolva o reembolso antes.';
  END IF;
  -- Mesma conta do passo 2 e do painel "Dinheiro a devolver" (20261402000000).
  IF EXISTS (
    SELECT 1
      FROM (
        SELECT o.id,
               GREATEST(round(COALESCE(o.total, 0) * 100)
                        - round(COALESCE(dm.valor, 0) * 100)
                        - round(COALESCE(o.valor_estornado, 0) * 100), 0) AS centavos,
               round(COALESCE(o.valor_estornado, 0) * 100) AS estornado
          FROM public.marketplace_orders o
          LEFT JOIN LATERAL (
            SELECT sum(dv.valor_reembolso) AS valor FROM public.devolucoes dv
             WHERE dv.order_id = o.id AND dv.status = 'concluida' AND dv.reembolso_manual
          ) dm ON true
         WHERE o.user_id = v_id
           AND o.status = 'cancelled'
           AND o.payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega')
           AND NOT (COALESCE(o.cancelled_after_shipping, false) AND o.returned_to_seller_at IS NULL)
      ) b
      LEFT JOIN LATERAL (
        SELECT sum(round(r.amount * 100)) FILTER (WHERE r.status IN ('solicitado', 'em_processamento')) AS em_curso,
               sum(round(r.amount * 100)) FILTER (WHERE r.status = 'concluido') AS concluido
          FROM public.order_refunds r
         WHERE r.order_id = b.id
           AND r.status IN ('solicitado', 'em_processamento', 'concluido')
           AND round(r.amount * 100) > 0
      ) l ON true
     WHERE b.centavos > 0
       AND GREATEST(b.centavos - COALESCE(l.em_curso, 0)
                    - GREATEST(COALESCE(l.concluido, 0) - b.estornado, 0), 0) > 0
  ) THEN
    RAISE EXCEPTION 'PARADO: há pedido com DINHEIRO A DEVOLVER para esta cliente. Resolva o reembolso antes. Nada foi mudado no banco.';
  END IF;
  -- Cupom exclusivo (vale-troca, presente) preso ao identificador dela: uma conta nova teria
  -- outro identificador e não veria o cupom. Válido = o mesmo critério do checkout
  -- (cupons_do_checkout, 20261208000000). Usado até o limite, vencido ou desligado não trava.
  IF EXISTS (
    SELECT 1 FROM public.cupom_clientes cc JOIN public.coupons c ON c.id = cc.coupon_id
     WHERE cc.user_id = v_id AND c.alcance = 'exclusivo' AND c.active = true
       AND (c.valid_until IS NULL OR c.valid_until > now())
       AND NOT (c.usage_limit IS NOT NULL AND c.usage_limit > 0 AND COALESCE(c.usage_count, 0) >= c.usage_limit)
  ) THEN
    RAISE EXCEPTION 'PARADO: há CUPOM EXCLUSIVO ainda válido só desta cliente. Avise a cliente e, no painel, tire-a da lista do cupom (ou passe-o para a conta nova dela). Nada foi mudado no banco.';
  END IF;
  IF v_confirmar AND EXISTS (SELECT 1 FROM storage.objects s
                             WHERE s.bucket_id = 'devolucoes' AND split_part(s.name, '/', 1) = v_id::text) THEN
    RAISE EXCEPTION 'PARADO: ainda há fotos de devolução dela no Storage. Siga a ordem do passo 4. Nada foi mudado no banco.';
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

  -- Anotação interna da lojista sobre os pedidos dela (tabela nova da 20261247): é texto livre
  -- que pode citar a cliente, então SAI (apaga a linha, não só o texto). Loja que ainda não
  -- recebeu a migration não tem a tabela: o bloco só avisa.
  IF to_regclass('public.marketplace_order_internal_notes') IS NOT NULL THEN
    DELETE FROM public.marketplace_order_internal_notes
     WHERE order_id IN (SELECT id FROM public.marketplace_orders WHERE user_id = v_id);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_rel := v_rel || format(E'anotações internas dos pedidos apagadas: %s\n', v_n);
  ELSE
    v_rel := v_rel || E'anotações internas dos pedidos: esta loja ainda não tem a tabela (nada a apagar)\n';
  END IF;

  -- Devoluções: o que a cliente escreveu e a lista de fotos. No ensaio, os arquivos
  -- ficam no Storage e o próprio bloco desfaz a limpeza da lista.
  UPDATE public.devolucoes SET detalhe = NULL, fotos = '{}' WHERE user_id = v_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rel := v_rel || format(E'devoluções limpas de texto e fotos: %s\n', v_n);

  -- Livro de registro (20261510): as versões ANTIGAS de pedido e devolução dela, inclusive as que os
  -- UPDATEs logo acima acabaram de guardar (com o nome e o telefone de antes). Sai tudo em que ela é a
  -- titular; por isso este passo vem DEPOIS de todo UPDATE em pedido e devolução. Loja que ainda não
  -- recebeu a migration não tem o livro: o bloco só avisa. FICAM, de propósito, as linhas em que quem
  -- é o uid dela e o titular é NULL (estoque, cupom: não são dela): até 90 dias, elas ligam esse código
  -- (sem nome) à compra, como o resto do banco faz com o uid que este roteiro mantém.
  IF to_regclass('public.livro_de_registro') IS NOT NULL THEN
    DELETE FROM public.livro_de_registro WHERE titular = v_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_rel := v_rel || format(E'versões antigas guardadas no livro de registro apagadas: %s\n', v_n);
  ELSE
    v_rel := v_rel || E'livro de registro: esta loja ainda não tem o livro (nada a apagar)\n';
  END IF;

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
      || E'Siga a ordem do passo 4: aprovação, reconferência e fotos antes de rodar valendo.';
  END IF;
  RAISE NOTICE '%', E'FEITO:\n' || v_rel;
END
$anonimizar$;
```

**[CONFERIR EM LOJA DE TESTE]** (só um Supabase de verdade prova):

- depois de rodar valendo, **tente entrar** na conta de teste (senha antiga): tem de
  ser recusado; e um celular já logado deve perder a sessão (no máximo em 1 hora).
  Nesse intervalo ainda pode gravar dados: faça a reconferência do passo 5;
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

## Passo 5 — Reconferir depois de 1 hora

1. Anote a data, o horário e o fuso em que terminou o passo 4 valendo. Espere
   **mais de 1 hora**: esse é o prazo máximo do token de acesso já emitido (o
   código que um aparelho já logado usa para acessar a conta), mesmo com a conta
   bloqueada e as sessões apagadas.
2. Rode de novo o **mesmo bloco de leitura do passo 2**, com o mesmo
   identificador. Confira o perfil: nome "Cliente removido", whatsapp e CPF
   vazios; em `user_addresses`, a contagem de endereços tem de ser 0.
3. Confira também os pedidos criados depois do horário anotado. O bloco do
   passo 2 conta todos os pedidos; para ver só os novos, use esta leitura
   (colunas conferidas em `supabase/migrations/20260806000000_baseline_do_schema_vivo.sql`).
   Troque o identificador e a data/hora de exemplo pelo horário do passo 4,
   incluindo o fuso (`-03:00` no exemplo):

   ```sql
   SELECT id, created_at, customer_name, customer_phone, customer_data, notes, observation
     FROM public.marketplace_orders
    WHERE user_id = 'COLE-O-ID-AQUI'::uuid
      AND created_at > timestamptz '2026-11-17 10:00:00-03:00';
   ```

4. Se apareceu dado pessoal novo no perfil, endereço ou pedido, **mantenha o
   pedido aberto e avise o dono**. Não repita o passo 4: a conta já foi
   bloqueada. Só prossiga depois de corrigir a pendência e reconferir os dados.
5. Para perguntas, avaliações e respostas públicas, faça a limpeza e a
   conferência na vitrine do passo 6. Se ainda encontrar um dado público,
   repita só essa limpeza e a conferência. Não reenvie o aviso nem confira
   ou registre o destinatário de novo: no passo 7, use a conversa já verificada
   antes do bloqueio.

## Passo 6 — Caçar o que sobrou (texto livre)

Faça esta conferência **antes de marcar o pedido como atendido**, depois do
passo 4 valendo e da espera e reconferência do passo 5.

**Confira as notas de inspeção, as mensagens ao cliente e as notas das decisões
da loja vinculadas à conta**, mesmo que a busca pelo nome completo não encontre
nada. No detalhe da devolução, o painel mostra essas notas em **Inspeção**,
**Sua mensagem ao cliente** e **Histórico**. Ao aprovar, recusar ou reprovar
uma devolução, a loja grava o MESMO texto em dois lugares (`mensagem_loja` e a
nota do histórico): limpe os dois.

1. Rode as duas leituras com o identificador da cliente. Leia cada nota inteira:
   um primeiro nome sozinho, apelido ou telefone antigo pode não aparecer na
   busca automática.

   ```sql
   SELECT d.id, d.protocolo, d.observacao_inspecao, d.mensagem_loja
     FROM public.devolucoes d
    WHERE d.user_id = 'COLE-O-ID-AQUI'::uuid
      AND (nullif(btrim(d.observacao_inspecao), '') IS NOT NULL
           OR nullif(btrim(d.mensagem_loja), '') IS NOT NULL)
    ORDER BY d.protocolo;
   ```

   ```sql
   SELECT e.id, e.devolucao_id, e.nota
     FROM public.devolucao_eventos e
     JOIN public.devolucoes d ON d.id = e.devolucao_id
    WHERE d.user_id = 'COLE-O-ID-AQUI'::uuid
      AND e.ator = 'loja' AND e.nota IS NOT NULL
    ORDER BY e.devolucao_id, e.id;
   ```

2. No Supabase > **Table Editor**, filtre pelos identificadores antes de editar:
   em **devolucoes**, confira `user_id`, `id` e o protocolo; em
   **devolucao_eventos**, confira `devolucao_id`, o `id` do evento e
   `ator = loja`. Confira o texto atual. Na célula `observacao_inspecao`,
   `mensagem_loja` ou `nota`, troque só o trecho que identifica a cliente por
   `[removido]`.
   Preserve as informações sobre o produto, os valores, a situação e as
   linhas do histórico. Não copie a nota original para fora do Supabase.
3. Rode as duas leituras de novo e confira as notas. Se não conseguir confirmar a
   linha, separar os trechos ou salvar a correção, mantenha o pedido aberto e
   avise o dono. Não passe para o passo 7 enquanto a conferência estiver
   pendente.

O que o bloco do passo 4 não consegue saber: texto livre onde o **nome** ou o
**telefone** dela foi escrito à mão (resposta da loja numa avaliação, nota de
devolução, pedido feito sem login com o mesmo e-mail…). Este bloco só LÊ e lista
"tabela, coluna, quantas linhas" que ainda contêm os dados antigos que você
anotou no passo 2. Troque os quatro valores entre aspas (se não tiver um deles,
deixe `''`).

**Confira as perguntas, as avaliações e as respostas da loja antes de encerrar.**
A busca por número só acha os números que você informou: um telefone antigo ou
um nome escrito só pelo primeiro nome pode passar batido.

1. No Supabase > **SQL Editor**, rode a leitura com o identificador da cliente.
   O resultado lista o tipo, o identificador do texto, o produto e o que ela
   escreveu. Leia cada texto inteiro, procurando nome, telefone (inclusive
   antigo), CPF, e-mail, endereço ou outro dado que identifique a cliente.

   ```sql
   SELECT 'pergunta' AS tipo, q.id, q.product_id, q.question AS texto
     FROM public.questions q WHERE q.user_id = 'COLE-O-ID-AQUI'::uuid
   UNION ALL
   SELECT 'avaliação', r.id, r.product_id, r.comment
     FROM public.reviews r WHERE r.user_id = 'COLE-O-ID-AQUI'::uuid;
   ```

2. No Supabase > **Table Editor**, abra **questions** (coluna `question`) ou
   **reviews** (coluna `comment`). Filtre pelo identificador do texto e confira
   o produto e a cliente antes de editar. Troque só o trecho com dado pessoal
   por `[removido]` e salve. A pergunta ou avaliação fica, sem identificar a
   cliente. Leia também as respostas da loja nesses textos. Se uma resposta
   citar dados dela, faça a mesma limpeza em **reviews** (`merchant_reply`) ou
   em **answers** (confira o `question_id` e o identificador da resposta).
**Agora rode a busca de sobras** com os valores anotados no passo 2:

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

Resultado vazio = a busca não achou os dados que você informou; isso não
substitui a leitura à mão. Se listar algo, confira se cada trecho é mesmo da
cliente e troque só esse trecho à mão por "[removido]". Os dois últimos valores
são o **endereço** que você anotou no passo 2 (rua, complemento e bairro, na lista
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
Refaça a busca depois de corrigir os trechos. Se sobrar algum dado pessoal
da cliente que você não consiga tratar, deixe o pedido aberto e avise o dono.

**Por fim, reconfira o que o público vê:**

1. Abra a **vitrine sem entrar na conta** e vá à página de cada produto
   conferido, incluindo produtos com textos encontrados na busca de sobras.
2. Recarregue a página e abra **Perguntas** e **Avaliações**. Leia os textos
   e as respostas. Deu certo quando nenhum deles mostra dado da cliente.
3. Se ainda aparecer algum dado, volte à correção e repita a busca e a
   conferência na vitrine. Se não conseguir confirmar a correção, mantenha
   o pedido aberto e avise o dono. Não passe para o passo 7.

**Planilhas já baixadas (fora do banco).** O painel exporta os pedidos em
planilha (Pedidos > **Exportar CSV**), com o **nome e o telefone** da cliente. O
passo 4 não alcança arquivo baixado. Pergunte a quem usa o painel se baixou
planilha com pedidos dela; em cada arquivo achado, apague as linhas dela ou troque
nome e telefone por `[removido]`, inclusive cópias enviadas por e-mail ou
WhatsApp a quem cuida das contas. Se não conseguir conferir, avise o dono. Não
reenvie planilha antiga.

O que **fica de propósito**: a linha do pedido de privacidade (a tabela
`pedidos_de_privacidade`, que guarda o e-mail novo quando o pedido era de
correção — é o registro legal do que foi pedido); `vor_receipts` (cadeia de
provas encadeadas por hash: mexer quebraria a prova); o identificador (um código
sem nome) que continua ligando pedidos ao login bloqueado; e, no livro de registro
(`livro_de_registro`, as versões antigas guardadas por 90 dias), o que não tem a
cliente como titular: produto, cupom, caixa e configuração da loja (não são dela)
e a versão antiga de pedido feito **sem conta** (visitante), que sai sozinha em
até 90 dias. As versões em que ela é a titular o passo 4 já apagou. Também ficam
as linhas em que ela é quem **fez** a mudança (`quem` = o identificador dela) mas
o titular é vazio, como a baixa de estoque e o uso do cupom da compra dela: por
até 90 dias elas ligam o mesmo código sem nome à compra, do mesmo jeito que o
identificador que este roteiro mantém liga pedidos ao login bloqueado.

## Passo 7 — Enviar a confirmação e marcar o pedido no painel

1. Antes de encerrar a exclusão, confirme que o passo 4 rodou valendo e que
   as conferências dos passos 5 e 6 terminaram sem dado pessoal pendente,
   incluindo as notas da loja, a busca de sobras e a revisão na vitrine.
2. Abra a conversa do aviso cujo destinatário foi conferido no passo 4, antes
   do bloqueio. Se houve novo aviso, use a conversa desse último aviso, não a
   do endereço anterior. Envie **manualmente** a confirmação por ali. Não use
   o endereço substituto do login nem dependa da nota do painel para avisar a
   cliente. Exemplo:

   > Olá! Concluímos a exclusão da sua conta. Você não poderá mais entrar nela.
   > Seus pedidos ficam guardados sem seus dados pessoais, como a lei exige.

   Confira que a mensagem aparece em **Enviados**. Se o envio falhar ou voltar
   como não entregue, não encerre o pedido enquanto a confirmação estiver
   pendente; avise o dono.
3. No painel, abra **Ajustes > Minha loja > Pedidos de privacidade dos clientes**.
   Na nota, registre que a confirmação foi enviada por e-mail, **sem copiar o
   endereço ou a conversa**. Toque em **Marcar como atendido** e confirme.
   O pedido deve passar para **Já respondidos** como atendido, com a data da
   decisão. Se não aparecer, recarregue e confira antes de tentar de novo.
4. Se a decisão for recusar (por exemplo, a dona da conta respondeu "não fui eu"),
   use **Não posso atender** e informe o motivo na nota. A cliente pode ler
   a resposta no app se ainda conseguir entrar.

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
- Não marcar "atendido" antes de terminar os passos 3, 4, 5 e 6 e, na exclusão,
  enviar a confirmação do passo 7 (a decisão é final).
- Não pedir a senha da cliente, nem por e-mail.
- Não copiar dados da cliente para planilha, e-mail ou conversa (e as planilhas
  CSV já baixadas entram na limpeza do passo 6).

## Como desfazer a migration (só se nunca houve pedido)

`supabase/migrations/rollback-manual-20261238000000_*.sql` **recusa rodar** se
existir qualquer pedido registrado (o registro é prova legal). Com a tabela
vazia ela desfaz tudo.
