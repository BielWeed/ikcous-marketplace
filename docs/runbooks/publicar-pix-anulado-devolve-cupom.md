# Publicar o cupom do PIX anulado (09/10/2026)

Passo a passo para publicar a mudança "o cupom de quem cancelou com o PIX já gerado volta em
minutos, não em um dia". São **duas** migrations (`20261209000000` e `20261210000000`), aplicadas
juntas pela esteira da release, com o **portão** (consultas `16a` e `16b`) conferindo o banco de
cada loja antes e depois. O item do portão, com todos os limites, está em
[producao-unica-fonte.md](producao-unica-fonte.md) (lote `20261209000000` + `20261210000000`).

## O que muda para quem usa

- **Quem compra:** cancelou o pedido depois de gerar o PIX e nunca pagou → o cupom de uso único
  volta quando o **prazo do PIX acaba** (até uns 45 minutos depois de o pedido ser criado), mais o
  ciclo de 15 minutos da varredura. Antes voltava cerca de **24 horas** depois do prazo. A tela do
  checkout (que mostra "o cupom volta em ...") já passa a prometer o prazo novo, sem trocar o site.
- **No instante do clique em "cancelar" o cupom NÃO volta:** de propósito. Um PIX cancelado ainda
  pode ser pago por quem já tinha o código na tela, e devolver o cupom ali daria desconto em dobro.
- **A lojista:** nada muda nas telas.
- **O que não muda:** pedido pago, enviado ou já devolvido nunca devolve o cupom; cartão segue a
  regra de hoje (a pista rápida só vale quando a "foto" do cancelamento prova que **nunca** houve
  cartão naquele pedido); pedido cancelado **antes** desta publicação não tem foto e segue com o
  prazo de 24 h.

## O que sobe, e em que ordem

| Ordem | O quê | Onde |
|---|---|---|
| 0 | Pré-requisito: `20261205000000` e `20261206000000` (cupom preso) já no banco de cada loja | `16b` PARA se faltar |
| 1 | **Antes do banco:** medir a versão das edge functions no ar em **cada** loja (seção abaixo) | IKCOUS e Savy |
| 2 | Banco: a foto da cobrança no cancelamento (tabela fechada, função e gatilho) e as três funções do cupom lendo a foto | [`20261209000000_a_foto_da_cobranca_no_cancelamento.sql`](../../supabase/migrations/20261209000000_a_foto_da_cobranca_no_cancelamento.sql) e [`20261210000000_a_vaga_do_cupom_do_pix_anulado_volta_em_minutos.sql`](../../supabase/migrations/20261210000000_a_vaga_do_cupom_do_pix_anulado_volta_em_minutos.sql) |
| 3 | O site (promoção normal da release, todas as lojas) | sem mudança própria deste lote |

**As duas migrations vão juntas e nessa ordem** (a segunda exige a foto da primeira). **IKCOUS
primeiro, depois a Savy, fora do horário de pico.** As duas são **aditivas**: nenhuma tabela,
coluna ou linha de dado existente é apagada (a segunda apaga só a função de 9 parâmetros que ela
mesma recria com 13). As lojas de teste (Almeida, Brand Meliz e Space) não se mexem.

Seguro em qualquer ordem com o site: com o banco novo e o site antigo nada muda para quem compra
(só encurta a espera de quem cancelou com o PIX gerado).

## 1. Antes do banco: medir as edge functions no ar (pré-condição, não é opcional)

O banco **não prova** duas coisas de código das edge functions, e a pista rápida só é segura com
elas no ar (a foto com zero tentativas prova que nunca houve cartão **porque** o código abaixo
vale):

- `criar-pagamento` nunca manda cartão ao Mercado Pago sem ocupar antes a vaga de cobrança (a
  "reserva antes do POST", de 02/10/2026 em diante);
- `webhook-mercadopago` só **adota** cobrança para cartão. Há um teste novo que fixa isso no ramo
  `test/pix-anulado-webhook-20261009` (`supabase/functions/webhook-mercadopago/index_test.ts`); ele
  entra no mesmo PR deste lote. Se um dia o webhook passar a adotar PIX, a pista precisa ser revista.

Regra segura e simples: **no ar tem de estar o código do SHA desta release (ou um mais novo)** para
essas duas functions e o que elas importam (`_shared`).

**Como medir, uma loja por vez:**

1. A data do código que importa, no SHA da release (PowerShell, na pasta do repositório):

   ```powershell
   git log -1 --format=%cI <sha40> -- supabase/functions/criar-pagamento supabase/functions/webhook-mercadopago supabase/functions/_shared
   ```

2. O que está no ar **na IKCOUS**: *Actions* → **Publicar edge functions** → *Run workflow* com
   `projeto = ikcous-publicada`, `functions = listar` e `expected_sha` = o SHA da release. O modo
   `listar` **só lista, não publica** nada; o resumo do run mostra, por function, a **versão** e a
   data de atualização.
3. **Na Savy** esse modo não existe. Duas saídas (decisão do dono, a mais segura primeiro): publicar
   as cinco financeiras do SHA da release (`functions = cobranca`, `projeto = savy`), o que o portão
   já imprime quando a release mexe nelas; ou o dono abrir o painel da Savy (*Edge Functions*) e
   ler a data de atualização de `criar-pagamento` e `webhook-mercadopago`.
4. **Se a data no ar for anterior à do passo 1:** NÃO aplique o banco ainda. Publique primeiro as
   functions (o `publicar-functions.yml` com o `expected_sha` da release) e meça de novo. O portão
   imprime "banco → functions → front"; aqui, de propósito, as functions desta pista vêm **antes**
   do apply. Anote as versões no ar (é o retrato "ANTES" para desfazer).

## 2. Banco, uma loja por vez

O ensaio da release imprime o comando pronto de cada loja (nunca montar à mão):

```powershell
node scripts/frota/publicar-release.mjs --sha <sha40> --deployment <dpl_...>
```

Ele não aplica nada: imprime, **um passo por vez**, o comando pronto para colar. Primeiro o da
consulta **`16a`** (sai NEGATIVA: as migrations ainda não estão), depois o da **`16b`** (tem de sair
POSITIVA e mais nova que a `16a`), os dois pelo workflow *Conferir banco da loja*; só então imprime o
`aplicar-migrations.yml` com os **dois** arquivos, `20261209000000_...sql` e `20261210000000_...sql`,
para o `projeto` daquela loja (`ikcous-publicada` ou `savy`). Depois do apply, rodar o ensaio de
novo: ele pede a `16a` outra vez, que tem de sair POSITIVA.

- **`16b` NEGATIVA** (falta a `20261205`/`20261206`, a foto já existe, o corpo de uma função é
  outro, ou só a `20261209` foi aplicada): **o portão PARA e nada é aplicado.** A linha que
  reprovou nomeia o objeto. A decisão é do dono.
- **`16a` POSITIVA com a versão fora do ledger:** PARA (ninguém registra versão à mão).
- **Aplicar fora do horário de pico.** A `20261209` espera um pedido em andamento por até 4 s (sem
  parar o checkout) e **falha sem gravar nada** (erro `55P03`) se ele não terminar: basta repetir.
  A `20261210` não pede trava de tabela.
- **O que acontece com o que já existe:** nenhuma linha de pedido, cupom ou cliente é lida nem
  reescrita. Pedido cancelado antes não ganha foto. A varredura seguinte (até 15 min depois) já usa
  a regra nova e devolve a vaga dos pedidos de PIX cancelados cujo prazo já passou: é o efeito
  pretendido.
- **Rodar duas vezes** é igual a rodar uma.

**Conferir à mão (SQL Editor do projeto da loja, só leitura), se quiser:**

```sql
-- o gatilho da foto existe e está ligado (esperado: O)
SELECT tgenabled FROM pg_trigger
 WHERE tgname = 'tr_pedido_foto_da_cobranca_ao_cancelar';

-- o auxiliar tem uma versão só, de 13 parâmetros (esperado: 1)
SELECT count(*) FROM pg_proc WHERE proname = 'cupom__vaga_volta_em';

-- nenhum papel de fora lê a foto (esperado: f, f, f)
SELECT has_table_privilege('anon', 'public.pedido_cobranca_ao_cancelar', 'SELECT'),
       has_table_privilege('authenticated', 'public.pedido_cobranca_ao_cancelar', 'SELECT'),
       has_table_privilege('service_role', 'public.pedido_cobranca_ao_cancelar', 'SELECT');
```

## 3. O site

Promoção normal da release (todas as lojas de uma vez, ver "Publicar uma release" em
[producao-unica-fonte.md](producao-unica-fonte.md)). Este lote não troca nada no site.

Teste de fumaça, **na IKCOUS** (loja de desenvolvimento; a Savy é cliente real, sem pedido de
teste): criar um pedido com cupom de uso único, gerar o PIX, **cancelar sem pagar** e conferir que o
cupom volta depois do prazo do PIX e do ciclo de 15 minutos (não no clique).

## Desfazer (de trás para frente)

- **Site:** `vercel rollback` (seção Rollback de [producao-unica-fonte.md](producao-unica-fonte.md)).
- **Banco: decisão do dono, nunca automática.** Primeiro
  [`rollback-manual-20261210000000_a_vaga_do_cupom_do_pix_anulado_volta_em_minutos.sql`](../../supabase/migrations/rollback-manual-20261210000000_a_vaga_do_cupom_do_pix_anulado_volta_em_minutos.sql)
  e **depois**
  [`rollback-manual-20261209000000_a_foto_da_cobranca_no_cancelamento.sql`](../../supabase/migrations/rollback-manual-20261209000000_a_foto_da_cobranca_no_cancelamento.sql),
  cada um pelo `aplicar-migrations.yml` (ele apaga a linha da versão do ledger na mesma transação).
  O da `20261209` recusa enquanto as funções da `20261210` citarem a tabela da foto. **Antes de
  rodar, saiba o que cada um faz:**
  - o da `20261210` devolve as três funções aos corpos da `20261206`/`20261205`, byte a byte: o
    cupom de PIX cancelado volta a esperar as 24 h. **Não toca dado:** o cupom que a varredura já
    devolveu continua devolvido;
  - o da `20261209` **apaga as fotos já gravadas** (uma linha por pedido cancelado depois da
    publicação). Elas só servem para antecipar a vaga do cupom; nenhum pedido, cupom ou pagamento
    é tocado.
  - Depois dos dois rollbacks a `16b` volta a sair POSITIVA e a `16a` NEGATIVA: o portão vê a loja
    como "antes do apply" e imprime o apply de novo (provado em
    `tests/banco/cupom-pix-anulado-portao-viva.cjs`).
