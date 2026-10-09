# Publicar os cupons no checkout (reescrito em 09/10/2026)

Passo a passo para publicar a seção nova de cupons do checkout e a escolha de "Quem pode usar" no
painel. Este texto **substitui** o rascunho de 28/09/2026 da branch `cupons/checkout-inteligente`
(duas migrations `20261187`/`20261188`, aplicação à mão pelo dono): aqui é **uma** migration
(`20261208000000`), aplicada pela esteira da release, com o **portão** (consultas `15a` e `15b`)
conferindo o banco de cada loja antes e depois. O desenho e o diagnóstico estão na
[investigação](../superpowers/specs/2026-09-28-cupons-checkout-investigacao.md); o item do portão,
com todos os limites, está em
[producao-unica-fonte.md](producao-unica-fonte.md) (lote `20261208000000`).

## O que muda para quem usa

- **Quem compra:** além do campo de digitar o código, o checkout mostra os cupons que **aquela
  pessoa** pode usar (desconto, validade e "Faltam R$ X em produtos") e aplica com um toque.
  Quem não está logado vê só os cupons de "Todos os clientes".
- **A lojista:** em cada cupom, no painel, **Quem pode usar**: quem tiver o código (secreto, o
  padrão), todos os clientes (aparece no checkout de todos) ou clientes escolhidos (só as contas da
  lista veem **e** usam).
- **O que já existe não muda:** todo cupom de hoje continua secreto (só vale para quem tem o
  código). Nada aparece no checkout até a lojista marcar um cupom como "Todos" ou "Escolhidos".

## O que sobe, e em que ordem

| Ordem | O quê | Onde |
|---|---|---|
| 0 | Pré-requisito: `20261203000000` (cupons desligados, #777) já no banco de cada loja | `15b` PARA se faltar |
| 1 | Banco: coluna `alcance`, lista de clientes do exclusivo, gatilho do pedido, validação que conhece o dono, lista do checkout | [`20261208000000_o_checkout_mostra_os_cupons_da_cliente.sql`](../../supabase/migrations/20261208000000_o_checkout_mostra_os_cupons_da_cliente.sql) |
| 2 | O site (checkout e painel), em todas as lojas | promoção normal da release |

(O contador morto `coupons.used_count` já saiu na `20261207000000`, lote próprio. Não é mais parte
desta publicação.)

**Banco antes do site.** Com o banco novo e o site antigo nada muda para ninguém. Com o site novo e o
banco antigo o checkout só mostra o campo de digitar, e o painel **falha ao salvar** um cupom em que
a lojista mudou "Quem pode usar": por isso o banco de **cada** loja vai primeiro.

**Não marque nenhum cupom como "Clientes escolhidos" antes do site novo estar no ar.** O painel
antigo não mostra nem preserva a lista, e o checkout antigo guarda o código do cupom no rascunho da
aba sem dizer de quem ele é: outra conta que entrasse na mesma aba veria o código (não conseguiria
usar, o banco recusa, mas veria).

**Resíduo conhecido:** quem não está na lista de um exclusivo e digita o código dele no pedido pode
receber o motivo real da recusa ("exige compra mínima", "expirou", "atingiu o limite") em vez de "não
existe", porque a mensagem vem da `create_marketplace_order_v24`, que roda antes do gatilho. Isso só
revela que o código existe; o gatilho continua impedindo o uso. Por isso, para exclusivo, use o botão
**Gerar** (código aleatório, difícil de adivinhar). Fechar isso exige reescrever a v24 e fica para um
pedido à parte. **Fora do escopo:** limite de uso **por cliente** (issue #30): um exclusivo sem limite
vale em todas as compras de quem está na lista, e o formulário novo avisa.

## 1. Banco, uma loja por vez

O ensaio da release imprime o comando pronto de cada loja (nunca montar à mão):

```powershell
node scripts/frota/publicar-release.mjs --sha <sha40> --deployment <dpl_...>
```

Ele não aplica nada: imprime, **um passo por vez**, o comando pronto para colar. Primeiro o da
consulta **`15a`** (sai NEGATIVA: a migration ainda não está), depois o da **`15b`** (tem de sair
POSITIVA e mais nova que a `15a`), os dois pelo workflow *Conferir banco da loja*; só então imprime o
`aplicar-migrations.yml` com o arquivo `20261208000000_...sql` para o `projeto` daquela loja
(`ikcous-publicada` ou `savy`). Depois do apply, rodar o ensaio de novo: ele pede a `15a` outra vez,
que tem de sair POSITIVA.

- **`15b` NEGATIVA** (falta a `20261203`, corpo da validação diferente do esperado, ou a migration já
  pela metade): **o portão PARA e nada é aplicado.** A linha que reprovou nomeia o objeto. A decisão é do
  dono.
- **`15a` POSITIVA com a versão fora do ledger:** PARA (ninguém registra versão à mão).
- **Aplicar fora do horário de pico.** A migration trava `coupons`, `profiles` e `marketplace_orders`
  por milésimos de segundo. Se um pedido em andamento segurar uma delas por mais de 5 segundos, a
  migration **falha sem gravar nada** (erro `55P03`) e basta repetir. Se um cancelamento cruzar com a
  trava, o Postgres desfaz um dos dois (`40P01`): ou a migration (repetir) ou o cancelamento (a tela
  pede para tentar de novo).
- **O que acontece com o que já existe:** nenhum cupom, pedido ou cliente é lido nem reescrito. Todo
  cupom existente vira "Quem tiver o código", como já era. Duas diferenças num cupom antigo, só de
  texto ou instante: a recusa por mínimo passa a dizer quanto falta, e o cupom vence **no instante** de
  `valid_until` (antes, um instante depois).
- **Rodar duas vezes** é igual a rodar uma.

**Conferir à mão (SQL Editor do projeto da loja, só leitura), se quiser:**

```sql
-- todos os cupons de hoje continuam secretos (esperado: uma linha, 'codigo')
SELECT alcance, count(*) FROM public.coupons GROUP BY alcance;

-- o gatilho do exclusivo existe e está ligado (esperado: O)
SELECT tgenabled FROM pg_trigger
 WHERE tgname = 'tr_pedido_com_cupom_so_nasce_para_a_lista';

-- anon executa a lista do checkout e NÃO executa as funções do painel (esperado: t, f, f)
SELECT has_function_privilege('anon', 'public.cupons_do_checkout(numeric)', 'EXECUTE'),
       has_function_privilege('anon', 'public.admin_cupom_definir_clientes(uuid, uuid[])', 'EXECUTE'),
       has_function_privilege('anon', 'public.admin_cupom_clientes(uuid)', 'EXECUTE');
```

## 2. O site

Promoção normal da release (todas as lojas de uma vez, ver a seção "Publicar uma release" de
[producao-unica-fonte.md](producao-unica-fonte.md)). Teste de fumaça no celular, com uma conta de
teste, **na IKCOUS** (loja de desenvolvimento; a Savy é cliente real, sem venda de teste):

1. Painel → Cupons → um cupom de teste → **Quem pode usar: Todos os clientes** → salvar. Abrir o
   checkout **sem conta**: o cartão aparece com "Aplicar".
2. Outro cupom de teste → **Clientes escolhidos** → adicionar a conta de teste → salvar. Entrar com
   essa conta: o cartão aparece com "Exclusivo para você". Entrar com **outra** conta: o cartão não
   aparece, e digitar o código responde "Cupom inválido ou expirado.".
3. Aplicar um cupom com um toque, conferir "Você economiza R$ X" e a linha "Desconto" do resumo;
   "Remover" tira.

## Desfazer (de trás para frente)

- **Site:** `vercel rollback` para a produção anterior (a seção Rollback de
  [producao-unica-fonte.md](producao-unica-fonte.md) tem o comando).
- **Banco: decisão do dono, nunca automática.**
  [`rollback-manual-20261208000000_o_checkout_mostra_os_cupons_da_cliente.sql`](../../supabase/migrations/rollback-manual-20261208000000_o_checkout_mostra_os_cupons_da_cliente.sql),
  pelo `aplicar-migrations.yml` (ele apaga a linha da versão do ledger na mesma transação). **Antes de
  rodar, saiba o que ele APAGA:**
  - a **lista de clientes** de cada cupom exclusivo e a coluna `alcance`: quem escolheu "todos os
    clientes" ou "clientes escolhidos" **perde a escolha** (todo cupom volta a ser só de código);
  - ele **desativa** todo cupom exclusivo antes de apagar a coluna, para a volta nunca abrir um
    exclusivo para quem tiver o código; os cupons de "todos os clientes" somem do checkout (o código
    deles continua valendo);
  - pedidos e contadores de uso **não** são tocados, e a correção dos cupons desligados (`20261203`)
    fica intacta (a validação volta ao corpo dela, byte a byte).
  - **Atenção ao reativar:** depois do rollback (e mesmo se a `20261208` for reaplicada) os
    ex-exclusivos voltam como "Quem tiver o código": reativar um deles o abre para **qualquer** pessoa
    que tenha o código. Só reative o que pode ser público, ou reaplique a migration e marque de novo
    "Clientes escolhidos" com a lista **antes** de reativar.
  - Depois do rollback a `15b` volta a sair POSITIVA e a `15a` NEGATIVA: o portão vê a loja como
    "antes do apply" e imprime o apply de novo.
