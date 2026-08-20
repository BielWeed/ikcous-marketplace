# Auditoria — o lado de quem compra e o backend

**Data:** 20/08/2026 · **Alvo:** catálogo, produto, busca, carrinho, checkout · banco, edge
functions, permissões · **Banco lido:** o de desenvolvimento (o mesmo que a produção usa hoje)

Tudo aqui é leitura. Nenhuma linha do banco foi escrita, nenhum arquivo do app foi alterado.

---

## O resumo em uma tela

Achei **um buraco grave** e **dois defeitos que o cliente sente**. O resto é dívida: coisa que
não dói hoje mas atrapalha quem for mexer amanhã.

A boa notícia primeiro, porque ela é grande: **o caminho do dinheiro está certo**. Eu fui atrás
de fraude de preço — cliente mandar "esse pedido custa R$ 1" e o sistema aceitar — e não achei.
O banco recalcula tudo sozinho e usa o valor que o navegador manda só como conferência. Testei
quatro hipóteses de furo no checkout e **as quatro caíram**. Isso está listado no fim, porque
saber o que foi conferido e está bom vale tanto quanto saber o que está quebrado.

| # | O que é | Gravidade |
|---|---|---|
| 1 | Qualquer pessoa, sem login, pode alterar o preço, o estoque e o nome de qualquer produto — e apagar produtos | 🔴 Crítico |
| 2 | Cupom criado sem preencher "limite de uso" nasce quebrado: a tela aplica o desconto e o pedido é recusado — 🟢 **já resolvido e no ar**, ver a seção | 🟠 Alto |
| 3 | Existe um segundo caminho de fazer pedido, esquecido e ligado, com regras mais fracas — **dormente hoje, ver a correção de gravidade na seção** | 🟡 Médio |
| 4 | Pedido abandonado devolve o estoque mas não devolve o cupom | 🟡 Médio |
| 5 | O app tem duas colunas para a mesma informação, e em um lugar lê a errada | 🟡 Médio |
| 6 | O app reescreve sozinho o nome de um produto específico | 🟡 Médio |
| 7 | ~20 funções no banco que ninguém chama, e 4 pares ambíguos | ⚪ Dívida |

---

## 1. 🔴 Sem login, dá para mudar o preço de qualquer produto

**O que uma pessoa mal-intencionada consegue fazer:** abrir o site, pegar a chave pública que
vem dentro da página (ela é pública de propósito, isso é normal), e com ela **mudar o preço de
qualquer produto para R$ 0,01, zerar o estoque da loja inteira, trocar os nomes dos produtos, ou
apagar produtos**. Sem conta, sem senha, sem ser admin.

Isso não exige nada sofisticado — é uma requisição de uma linha.

### Por que acontece

O app não lê a tabela de produtos direto. Ele lê uma "vitrine" chamada `vw_produtos_public`, que
mostra só os produtos ativos. Isso é bom desenho. O problema é **como** essa vitrine foi
declarada, e são três peças que sozinhas seriam inofensivas:

1. **A vitrine roda com o crachá do dono, não com o de quem pediu.** Falta nela uma opção
   chamada `security_invoker`. Sem essa opção, quem pergunta é o visitante, mas quem **executa** é
   o `postgres` — o dono do banco.
2. **O dono do banco passa por cima das travas de segurança.** As travas (RLS) da tabela
   `produtos` dizem "só admin escreve" — e elas estão corretas. Só que elas nunca são consultadas
   nesse caminho, porque o dono da tabela é isento delas.
3. **O visitante anônimo recebeu permissão de escrita na vitrine.** E a vitrine é do tipo que
   aceita escrita (é uma vitrine simples de uma tabela só, então o banco repassa a escrita para a
   tabela por baixo).

Juntando: o visitante escreve na vitrine → a vitrine repassa para `produtos` usando o crachá do
dono → as travas não são consultadas → a escrita passa.

### A prova

Tudo abaixo saiu de consulta ao catálogo do banco, hoje:

```
vw_produtos_public  · dono: postgres · opções: (nenhuma — falta security_invoker)
                    · is_updatable: YES
produtos            · dono: postgres · RLS ligado: true · force_rls: FALSE  ← o dono é isento

has_table_privilege('anon','public.vw_produtos_public','UPDATE')  →  true
has_table_privilege('anon','public.vw_produtos_public','DELETE')  →  true
has_table_privilege('anon','public.vw_produtos_public','INSERT')  →  true
```

E as travas que **deveriam** barrar, e que nunca são consultadas por esse caminho:

```
produtos_admin_update_policy · UPDATE · {authenticated} · is_admin()
produtos_admin_delete_policy · DELETE · {authenticated} · is_admin()
```

**Limite honesto do que eu provei:** provei a *permissão*, lendo o catálogo do banco. **Não
executei a escrita**, porque escrever não estava autorizado nesta auditoria. Também está provado
que esse endereço é alcançável de fora, porque o próprio app já lê por ele
([useProducts.ts:351](../../src/hooks/useProducts.ts:351)) — a escrita é o mesmo endereço com
outro verbo. Para fechar em 100%, alguém precisa rodar um `PATCH` de teste num produto
descartável e desfazer.

### Direção do conserto

⚠️ **CORRIGIDO em 20/08/2026, depois de medir.** A primeira versão desta seção mandava ligar
`security_invoker` na vitrine. **Isso apagaria o catálogo da loja inteira** — e o erro só apareceu
porque eu fui medir antes de gastar a tarefa.

Motivo: com `security_invoker` ligado, a permissão passa a ser conferida como a de quem pergunta.
E o **visitante anônimo** não tem `SELECT` na tabela `produtos`:

```
has_any_column_privilege('anon',          'public.produtos','SELECT')  →  false
has_any_column_privilege('authenticated', 'public.produtos','SELECT')  →  true  (29 de 30 colunas)
```

⚠️ **Correção de uma medição minha.** A primeira versão desta seção dizia que **ninguém** tem
`SELECT` na tabela, citando `has_table_privilege(...) → false` para os dois papéis. Isso está certo
para o `anon` e **errado para o `authenticated`**: ele tem `SELECT` **por coluna** em 29 das 30
colunas — todas menos `custo`, exatamente o que a migration `20260805000000_restore_admin_view_and_
hide_custo.sql` fez. E `has_table_privilege` devolve `false` para grant por coluna, que é
justamente a leitura que engana. A conclusão sobrevive, mas por causa de **metade** dos papéis, não
dos dois.

O catálogo funciona **exatamente porque** a vitrine roda com o crachá do dono. Testado: como
`anon`, `select count(*) from vw_produtos_public` devolve **19 produtos** hoje. Ligar a opção
sozinha derrubaria isso para zero, com "permission denied", para todo visitante **não logado** — e
como a loja precisa vender para quem ainda não tem conta, isso é a loja no chão do mesmo jeito.

**O conserto certo é o oposto — não mexer na leitura, e tirar a escrita:**

```sql
REVOKE INSERT, UPDATE, DELETE ON public.vw_produtos_public FROM anon, authenticated;
```

Só isso fecha o buraco. O caminho de leitura fica intocado, e nada no app escreve por essa
vitrine (conferido). O painel do lojista escreve pela `vw_produtos_admin` e direto em `produtos`,
e nenhum dos dois é afetado.

A correção canônica do Supabase (`GRANT SELECT ON produtos` + `security_invoker = on`, deixando o
RLS ser a fonte única da verdade) continua sendo o destino melhor — mas ela mexe no caminho que
funciona hoje, então é tarefa própria, depois, com prova própria. Segurança se corrige com o
**menor** escopo possível.

⚠️ **Isso viaja para toda loja clonada.** Não é um defeito deste banco, é um defeito do molde.

### E o conserto não se defende sozinho — achado da revisão

Revogar fecha o buraco hoje, **e a próxima migration que recriar a vitrine reabre**. Não é
hipótese: toda relação nova criada no schema `public` já nasce com escrita liberada para o
visitante anônimo, por conta dos privilégios padrão do projeto Supabase:

```
pg_default_acl · public · dono_futuro=postgres
  anon=arwdDxtm    (a=INSERT, w=UPDATE, d=DELETE)
  authenticated=arwdDxtm
```

`CREATE OR REPLACE VIEW` preserva as permissões; `DROP` + `CREATE` **não**. E a história desta
vitrine é DROP+CREATE **seis vezes**, sempre seguidas de um `GRANT SELECT ... TO anon,
authenticated` — na crença de que SELECT é tudo que o anônimo tem. **Foi assim que este buraco
nasceu.**

O precedente que fecha o argumento: a migration `_arquivadas/20260708110000` criou a vitrine
**com `security_invoker = on`**, e a `_arquivadas/20260713000000` a recriou **sem**. Uma proteção
já foi perdida exatamente por esse mecanismo, neste mesmo arquivo.

Gatilho nomeado: a próxima migration que adicionar uma coluna à vitrine. E não há rede — o script
de prova não está no `npm test` nem no CI (`grep -rn db-prove .github/` volta vazio), é prova
manual de uma vez só.

Como os privilégios padrão são do projeto Supabase e mudá-los afeta o schema inteiro, o que dá
para mudar é a convenção: **toda migration futura que recriar uma view põe o `REVOKE INSERT,
UPDATE, DELETE` ao lado do `GRANT SELECT`.**

### Outras três views têm a permissão larga — mas NÃO o buraco

⚠️ **CORRIGIDO em 20/08/2026 pela direção.** A primeira versão desta seção se chamava "mais três
views da mesma classe" e deixava entender que havia mais três buracos críticos em aberto. **Não
há**, e o erro era meu de dimensionamento.

O visitante anônimo tem mesmo INSERT/UPDATE/DELETE em `sales_overview`, `v_store_config` e
`vw_questions_with_answers_count` — isso está medido certo. Mas o buraco da `vw_produtos_public`
precisa de **três** peças juntas, e a terceira não existe nessas:

```
sales_overview                   reloptions = {security_invoker=on}
v_store_config                   reloptions = {security_invoker=on}
vw_questions_with_answers_count  reloptions = {security_invoker=on}
vw_produtos_public               reloptions = NULL   ← a ÚNICA sem
```

Com `security_invoker` ligado, a escrita é conferida como a de **quem chamou**, e aí o RLS da
tabela de baixo vale. A permissão larga fica feia na listagem e não vira acesso.

`vw_produtos_admin` também aparece na lista de permissão larga, e também foi provada inerte —
mas por outro mecanismo: o `WHERE is_admin()` dentro do corpo esvazia o conjunto de linhas.

Nenhuma das quatro foi exercitada com escrita real. O que muda em relação à primeira versão é o
**tamanho**: era "mais três tarefas urgentes", é "quatro permissões largas para limpar quando
sobrar tempo".

### Nota: `TRUNCATE` está solto, mas não é alcançável

Enquanto conferia, achei que `anon` tem `TRUNCATE` em **todas** as tabelas centrais — `produtos`,
`marketplace_orders`, `profiles`, `user_addresses`, `coupons`. E `TRUNCATE` **não passa por RLS**,
por definição do Postgres.

**Não é emergência, e é importante não inflar:** o PostgREST só expõe `GET`, `POST`, `PATCH` e
`DELETE` — [não existe verbo TRUNCATE na API](https://docs.postgrest.org/en/v12/references/api/tables_views.html).
Com a chave pública não há caminho até ele. Só seria alcançável por quem já tivesse a senha do
banco — e quem tem a senha do banco já tem tudo.

Fica como tarefa separada e de prioridade baixa, **de propósito fora do conserto acima**: juntar
as duas faria um "passa" tirar junto o conserto que importa, se algo desse errado.

---

## 2. 🟠 O cupom que a tela aceita e o pedido recusa

**O que a pessoa vive:** digita o cupom no checkout, a tela responde "cupom aplicado" e mostra o
desconto. Ela clica em finalizar e leva **"Cupom X inválido ou expirado"**. Tentar de novo dá o
mesmo. O pedido não sai.

**Quando acontecia:** sempre que o cupom foi criado sem preencher o campo "Limite de Uso".

> ## 🟢 RESOLVIDO — já está no ar
>
> Confirmado no banco em 20/08/2026, depois que este relatório foi escrito: a correção **está
> aplicada e viva**. As duas funções que criam pedido agora tratam `0` como ilimitado:
>
> ```
> create_marketplace_order_v23 · contém "usage_limit <= 0" → true
> create_marketplace_order_v24 · contém "usage_limit <= 0" → true
> ```
>
> O conserto veio de uma sessão paralela que auditava o painel do lojista e chegou ao mesmo
> defeito pelo outro lado — a correção dela e a minha eram idênticas caractere por caractere, e a
> dela foi a escolhida por ter guarda melhor no `db-apply`. O `CUPOM10` não derruba mais pedido.
>
> **O resto desta seção fica como registro do defeito e do porquê**, que continua valendo para
> qualquer loja que ainda não receba essa atualização.

### Por que acontece

O campo "Limite de Uso" no admin tem escrito, dentro dele,
**"0 = Ilimitado"** ([AdminCouponFormView.tsx:430](../../src/views/admin/AdminCouponFormView.tsx:430)),
e o formulário já começa com `0` ([linha 35](../../src/views/admin/AdminCouponFormView.tsx:35)).
Ou seja: o caminho normal — criar um cupom sem mexer nesse campo — grava `0`.

Aí as duas funções do banco discordam sobre o que `0` significa:

| Função | O que faz com `usage_limit = 0` |
|---|---|
| `validate_coupon_secure_v2` — a que a **tela** usa | `usage_limit > 0` antes de checar → **pula a checagem**. Cupom válido, desconto mostrado. |
| `create_marketplace_order_v23` e `v24` — as que **criam o pedido** | `usage_count < usage_limit` → `0 < 0` é falso → cupom não encontrado → **exceção**. |

A tela concorda com o "0 = Ilimitado" que ela mesma promete. Quem cria o pedido, não.

**Não é hipótese — está no banco agora:**

```
code=CUPOM10 · active=true · usage_limit=0 · usage_count=0 · type=percentage · value=10
```

Esse cupom, hoje, aplica 10% na tela e derruba o pedido.

### Direção do conserto

Escolher **um** significado para `0` e fazer os três lugares concordarem. O que a interface já
promete é "ilimitado", então o menor conserto é alinhar as duas RPCs de pedido com a validação —
e não o contrário, que quebraria a promessa escrita na tela.

---

## 3. 🟠 Um segundo caixa, esquecido e destrancado

Existem **quatro gerações** da função que cria pedido vivas no banco ao mesmo tempo:

| Função | Situação |
|---|---|
| `create_marketplace_order_v24` | Em uso (pagamento online) |
| `create_marketplace_order_v23` | Em uso (pagamento na entrega) |
| `create_marketplace_order_v22` | Só encaminha para a v23 — **inofensiva** |
| `create_marketplace_order` | **Implementação completa, própria, e aberta a qualquer pessoa logada** |

A primeira da lista, sem sufixo, não é um resto inofensivo: são 5.652 caracteres de código
próprio, com regras **diferentes e piores** das que valem hoje. Qualquer cliente logado consegue
chamá-la direto. Nela:

- **Cupom de porcentagem vira desconto em reais.** Ela lê o campo `value` e subtrai como se fosse
  dinheiro, sem olhar o tipo. Com um cupom de 10%, tiraria **R$ 10,00**.
- **O estoque poderia ficar negativo** — o `UPDATE` que desconta não confere quantas linhas
  mexeu. (A checagem de saldo, essa, existe: ela recusa antes, com "Estoque insuficiente".)
- **Grava nas colunas erradas** (`total_amount` em vez de `total`) — e nenhuma tela lê essas.
- **Fica fora do controle de reserva** — sem `payment_status`, sem prazo de 30 minutos.
- **Não valida o frete pela cotação guardada**, ao contrário da v23/v24.

### ⚠️ CORRIGIDO em 20/08/2026: a gravidade era menor do que eu escrevi

A primeira versão desta seção classificava o item como **🟠 Alto** e afirmava, no presente, que o
estoque **fica** negativo e que o pedido **aparece** como R$ 0,00 no painel. As duas coisas estão
erradas, e só apareceram quando a correção foi implementada e revisada.

**Esta função nunca gravou um pedido sequer.** A coluna `marketplace_orders.total` é `NOT NULL`
sem valor padrão, a tabela **não tem gatilho nenhum** que a preencha, e o `INSERT` da v1 não
inclui essa coluna. Então ele viola a obrigatoriedade **de forma incondicional, para qualquer
entrada**.

E a ordem do corpo é o que decide: o `INSERT` do cabeçalho vem **antes** do laço que desconta
estoque e antes do consumo do cupom. A função aborta ali, a transação inteira é desfeita, e os
dois defeitos que motivaram o alarme **nunca chegaram a rodar**. Dano persistido até hoje: **zero**.

**A correção continua valendo, e por um motivo datado.** O que segura a v1 hoje é um *acidente de
schema*, não uma trava desenhada. Um valor padrão em `total` a ressuscita inteira no mesmo
instante — e há trabalho em curso mexendo exatamente em obrigatoriedade e valor padrão nessa
tabela. Revogar a execução tira a função do alcance do navegador independente do que aconteça com
o schema.

Ou seja: o trabalho estava certo, a **razão** estava errada. Não é "fechar um caixa em operação",
é "tirar do alcance uma função dormente antes que uma mudança de schema a acorde".

Não é um furo de preço (ela calcula os preços no servidor). É um **caixa paralelo com regras
antigas** que ninguém fecha.

### Direção do conserto

⚠️ **CORRIGIDO em 20/08/2026, depois de medir.** A primeira versão desta seção mandava "apagar a
v1 e a v22". Está errado em duas frentes, e as duas só apareceram na medição:

**A v22 não é para tocar.** Ela é um encaminhador de 6 linhas para a v23 e herda todas as
proteções dela — inofensiva. E tem dependentes reais: três scripts do repositório a **chamam**
de verdade (`db-prove-regression.cjs:63`, `db-test-guest-checkout.cjs:64`,
`db-test-migration-v23.cjs:127`), e o mapa `VERIFICACOES` do `db-apply.cjs` guarda o corpo dela
pela entrada de `20260729000000_fix_free_shipping_rule_parity.sql`. Apagá-la quebra os quatro em
troca de nada.

**Apagar a v1 é mais do que o necessário.** Medido: **ninguém** a chama — nem o app, nem edge
function, nem script, nem outra função do banco (varri `pg_get_functiondef` de todas). O que a
torna perigosa é só estar **executável** por `anon` e `authenticated`. Revogar isso a torna
inalcançável por qualquer requisição HTTP, que é o único caminho que existe até ela:

```sql
REVOKE EXECUTE ON FUNCTION public.create_marketplace_order(
  jsonb, text, uuid, text, text, text, text
) FROM anon, authenticated, PUBLIC;
```

Mesma proteção que apagar, reversível, e é exatamente a forma que este repositório já usou para
fechar um caso idêntico (`20260812010000_revoke_check_user_confirmation_status.sql`). Com backup
diário e sem PITR, tirar permissão vence apagar corpo.

*(Nota: o comentário em `src/contexts/StoreContext.tsx:607` cita a v22 como se ela fosse a RPC
viva do checkout. Está desatualizado — quem vale é a v23/v24. É comentário, não chamada.)*

---

## 4. 🟡 O estoque volta, o cupom não

Quando um pedido é cancelado — seja pelo cliente, seja pelo prazo de 30 minutos vencendo — o
sistema **devolve o estoque corretamente**. Isso está bem-feito e bem comentado nas duas funções.

Mas nenhuma das duas devolve o **uso do cupom**. O contador `usage_count` só sobe, nunca desce.

**O que o lojista vive:** cria um cupom para 10 usos. Dez pessoas colocam no carrinho, geram o
PIX e desistem. O cupom morre sem ter dado **nenhuma** venda.

Confirmei lendo as duas funções (`expirar_pedidos_vencidos` e `update_order_status_atomic`):
nenhuma toca em `coupons`. **Nos dados ainda não aconteceu** — os dois cupons do banco estão com
`usage_count = 0`. É defeito confirmado no código, com zero ocorrências até agora.

---

## 5. 🟡 Duas colunas para a mesma verdade — e uma leitura na errada

A tabela de pedidos tem pares duplicados, sobra das gerações antigas da RPC:

| A que vale hoje | A duplicata | Preenchida em |
|---|---|---|
| `total` | `total_amount` | 46 de 84 pedidos |
| `shipping` | `shipping_cost` | 46 de 84 |
| `notes` | `observation` | 28 de 84 |
| — | `customer_phone` | 3 de 84 |

Conferi: **todas** as funções de leitura (`get_admin_orders_paged`, `get_admin_dashboard_stats`,
`get_admin_analytics_v2`, e as duas de consulta de pedido por OTP e WhatsApp) usam `total`.
Nenhuma usa `total_amount`. Então a duplicata é peso morto — exceto pelo item 3 acima, que grava
nela.

**O caso que já está errado** é na tabela de cupons, que tem `usage_count` **e** `used_count`. As
funções do banco escrevem em `usage_count`. E o app, ao sincronizar,
[lê `used_count` primeiro](../../src/lib/realtimeSyncEngine.ts:144):

```js
usageCount: raw.used_count || raw.usage_count || 0,
```

Hoje os dois estão em `0`, então ninguém percebe. No dia em que um cupom for usado de verdade, o
painel vai mostrar **0 usos** para um cupom que já vendeu — porque `used_count` continua zerado e
`0 || 0` cai no segundo. (O `||` salva por acidente enquanto o valor é zero; assim que
`usage_count` virar 3 e `used_count` continuar 0, a leitura mostra 3. O defeito real aparece se
alguém um dia gravar em `used_count`.) É frágil por construção: a decisão de qual coluna vale
está espalhada em vez de escrita num lugar só.

---

## 6. 🟡 O app reescreve sozinho o nome de um produto

Em [mappers.ts:93](../../src/lib/mappers.ts:93), no tradutor que **todo** produto atravessa antes
de aparecer na tela:

```js
const formattedName =
  name === "boobie goods" || name === "Boobie Goods"
    ? "Bobbie Goods"
    : name;
```

**O que o lojista vive:** ele digita um nome no painel, salva, e a loja mostra outro. Não há aviso,
não há registro, e o painel provavelmente mostra o nome que ele digitou — então ele nem descobre.

Uma correção de digitação de um produto específico foi colocada dentro do encanamento
compartilhado do app. O lugar disso é o dado, não o código: corrigir o nome no cadastro e apagar
essas três linhas.

---

## 7. ⚪ Dívida do banco

### Funções que ninguém chama

Estão no banco, quase todas com poder elevado (`SECURITY DEFINER`) e com permissão concedida, e
**nenhuma referência no app** além dos dois arquivos de tipos gerados automaticamente (conferi
arquivo por arquivo, não por estimativa):

`check_stock_v1` · `decrement_stock` · `get_active_products_internal` ·
`get_products_with_variants` · `get_admin_dashboard_stats` · `get_admin_dashboard_summary` ·
`get_admin_executive_summary` · `get_admin_list_paginated` · `get_customer_intelligence` ·
`get_inventory_health` · `get_product_stats` · `get_product_optimization_data` ·
`get_category_sales` · `get_sales_analytics` · `get_retention_analytics` ·
`validate_coupon_secure` (v1) · `check_is_admin` · `generate_order_otp_v1` ·
`check_user_confirmation_status` · `handle_order_item_stock` · `tr_prevent_role_change`

Duas merecem nota:

- **`handle_order_item_stock`** é uma função de gatilho **sem gatilho nenhum apontando para ela**.
  Conferi a lista de gatilhos do banco inteiro. Isso é bom: se ela estivesse ligada, o estoque
  seria descontado **duas vezes** por pedido (uma pela função de criar pedido, outra por ela). Fica
  registrado porque religá-la por engano seria caro.
- **`tr_prevent_role_change`** existe como função, e o gatilho de mesmo nome usa outra
  (`prevent_role_change`). Duas quase-iguais, uma morta — receita de consertar a errada.

### Pares ambíguos

Quatro funções existem em duas assinaturas ao mesmo tempo. O PostgREST escolhe pelos parâmetros
enviados, e quando não consegue decidir, devolve erro:

- `get_sales_analytics` — uma com `timestamp`, outra com `timestamp with time zone`. É a mais
  arriscada das quatro: as duas aceitam a mesma chamada.
- `get_retention_analytics` — uma sem parâmetro, outra com `p_days`
- `answer_question_atomic` e `reply_review_atomic` — cada uma com e sem `p_admin_id`

### Sobras

- `answers_dedup_backup_20260812` — tabela de backup de 12/08 ainda no schema. Está com RLS ligado
  e **zero políticas**, ou seja, ninguém lê. Fecha por acidente, mas fecha; é entulho, não furo.
- `increment_helpful` exige login mas não impede repetição: a mesma pessoa pode marcar a mesma
  avaliação como útil quantas vezes quiser. Não há tabela de controle de voto. Cosmético hoje.

### Nota de operação

Ao rodar consultas por script, o pooler do Supabase **manteve um `SET ROLE` de uma conexão para a
seguinte** — eu troquei para o papel `anon` numa consulta e a chamada seguinte, num processo novo,
ainda estava como `anon`. Quem for rodar script no banco: começar com `reset role`, ou o resultado
sai do papel errado sem avisar.

---

## O que conferi e está CERTO

Isso não é enchimento — é metade do valor da auditoria. Cada item abaixo foi uma hipótese de
defeito que eu persegui e **derrubei com evidência**.

- **Fraude de preço no checkout: não existe.** Li o corpo inteiro da `create_marketplace_order_v24`
  no banco. Ela relê preço, estoque, frete e cupom do banco, calcula o total sozinha, e usa o valor
  que o navegador mandou **só para conferir** (tolerância de R$ 0,05). O comentário que o código do
  app faz sobre isso ([useOrders.ts:1065](../../src/hooks/useOrders.ts:1065)) confere com o que a
  função realmente faz.
- **O frete não vem do cliente.** O preço da opção de transportadora é buscado na cotação que o
  **servidor** gravou, com validade de 24h. O que o navegador mandar é ignorado.
- **A v22 é inofensiva.** Minha primeira medição sugeriu que ela não tinha guarda de preço. Li o
  corpo: são 6 linhas que só repassam para a v23. A medição estava errada, o corpo corrigiu.
- **Frete grátis para convidado: consistente.** Persegui a hipótese de o carrinho prometer frete
  grátis a quem não está logado enquanto o banco cobra (o que travaria o pedido). Os quatro lugares
  checam login: `CartContext:754`, `CartReminder:88`, `FreeShippingBlock:81` e a própria v24.
- **PIX de convidado: não é buraco.** A tela de checkout só verifica pagamento para cliente logado
  — mas o pagamento online **exige conta** (`PAGAMENTO_ONLINE_EXIGE_CONTA`), então não existe
  convidado esperando confirmação de PIX.
- **`vw_produtos_admin` está protegida.** Achei que ela vazasse custo e fornecedor para o público.
  Ela tem `WHERE is_admin()` **dentro** da vitrine. Testei assumindo o papel `anon`: voltou vazio.
- **As funções de admin conferem admin por dentro.** Várias estão liberadas para "qualquer usuário
  logado", o que assusta na listagem de permissões — mas li os corpos de `decrement_stock`,
  `swap_banner_order` e `update_order_status_atomic`, e todas barram com `is_admin()` na primeira
  linha. A permissão larga não vira acesso.
- **RLS ligado em todas as 30 tabelas.**
- **Estoque não é descontado em dobro** (ver `handle_order_item_stock`, acima).
- **A busca cobre o catálogo carregado**, e o catálogo é paginado. Com **19 produtos ativos**
  (23 no cadastro) isso é indiferente hoje; vira problema quando o catálogo passar do tamanho de
  uma página.

---

## O que esta auditoria NÃO cobriu

⚠️ **Duas linhas acrescentadas em 20/08/2026 pela direção.** A versão original desta seção omitia
busca e carrinho, e eles estavam no pedido — omitir a rasura é pior que a rasura.

- 🔴 **Carrinho — cobertura RASA.** A única coisa que eu exercitei foi a regra de frete grátis, em
  três arquivos. **Não olhei:** quantidade contra estoque na hora de adicionar, preço que
  envelhece no carrinho entre a adição e o checkout, persistência entre aparelhos
  (`sync_cart_atomic`), e o caso da variante. `sync_cart_atomic` grava `variant_id` como texto
  vazio quando não há variante, e eu não segui o que acontece com isso na volta.
- 🔴 **Busca — cobertura RASA.** Uma frase, na seção acima. **Não olhei:** o que a busca deixa de
  achar (ela só olha nome e descrição — não categoria, não código), o comportamento com acento e
  maiúscula além do caso já testado, e a interação entre o filtro local e a paginação do servidor.
- **O painel do lojista** (`src/views/admin/`) — só entrei nele para rastrear o formulário de
  cupom e a origem de um dado. Não foi auditado. *(Uma sessão paralela auditou o painel; o
  resultado dela está em `docs/auditoria/2026-08-20-painel-config.md`.)*
- **As 9 edge functions** — olhei quais RPCs elas chamam e como, não o corpo delas. O webhook do
  Mercado Pago e a reconciliação merecem passagem própria. ⚠️ E há uma pegadinha: a
  `send-otp-email` que o **banco** chama por `net.http_post` está publicada em **outro projeto
  Supabase**, não na pasta deste repositório — divergência já registrada como alta em
  `docs/onboarding/06-ESTADO-ATUAL.md:265`.
- **`CheckoutView.tsx` tem 2.412 linhas.** Li os trechos de pedido, pagamento, frete e cupom. O
  resto não.
- **Nada foi testado no navegador.** Todos os achados vêm de leitura de código e consulta ao banco.

### Sobre escopo, explicitamente

Encontrei textos fixos com o nome "IKCOUS" espalhados pelo app — na tela de atualização, no banner
de notificação, no texto de compartilhar. Pela regra do próprio projeto, **isso não é trabalho
desta sessão**: a loja do Gabriel *é* a IKCOUS, ninguém sente falta disso hoje, e quem sente é
quem clona o app para outra loja — que é outro projeto. Registro e não proponho.

O item 6 (o nome reescrito) é diferente e **está no escopo**: ali o app contraria o que o próprio
lojista digitou, na loja dele, hoje.

---

## Onde isto parou — 20/08/2026

| Item | Situação |
|---|---|
| **1** — escrita anônima na vitrine | Migration escrita e **revisada**, commitada em `f91b1a9`. 🔴 **NÃO aplicada — o buraco está aberto no banco neste instante.** |
| **2** — cupom com limite zero | 🟢 **Resolvido e no ar**, por uma sessão paralela. Confirmado no corpo vivo das duas funções. |
| **3** — caixa paralelo (v1) | Migration escrita e **revisada**, commitada em `de2d705`. Não aplicada. Dormente, então não urge. |
| 4 a 7 | Fila normal. A direção mediu e **recomendou não gastar** outra rodada de auditoria no mesmo formato: nenhum deles custa algo por dia parado. |

🔴 **A frase que não pode se perder:** commit não é estar no ar, e merge também não. O item 1 só
está fechado quando a migration for **aplicada** — até lá, o que existe é um arquivo numa branch.
Medido depois dos commits:

```
has_table_privilege('anon','public.vw_produtos_public','UPDATE') → true   (ainda)
select version from supabase_migrations.schema_migrations
  where version in ('20260821000100','20260825000000')          → vazio
```

Os itens 1 e 3 são migration e mexem em permissão — pela regra do projeto, tarefa delegada com
revisão em Opus, e migration **sem** `BEGIN`/`COMMIT`.
