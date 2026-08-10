# Fase 3 da cobrança — o webhook e a reconciliação

> **Para quem executa:** SUB-SKILL OBRIGATÓRIA — use `superpowers:subagent-driven-development`
> (recomendado) ou `superpowers:executing-plans` para implementar tarefa a tarefa. Os passos
> usam checkbox (`- [ ]`) para acompanhamento.

**Data:** 07/08/2026 · **Spec:** [`2026-08-07-fase-3-webhook-design.md`](../specs/2026-08-07-fase-3-webhook-design.md)
**Issues:** `CHECKOUT-010` #109, `CHECKOUT-040` #110, `CHECKOUT-050` #111 · **Desbloqueia:** #162

**Objetivo:** fazer o pedido virar `pago` quando o PIX cair, com o webhook do Mercado Pago
confirmando contra a API do MP e uma reconciliação que pega o que o webhook perder.

**Arquitetura:** o webhook **não escreve no pedido** — ele valida a assinatura, pergunta o
status real ao MP e chama a RPC `confirmar_pagamento`, que pega a linha com `FOR UPDATE` e
**relê o estado** antes de decidir. É isso que mata a corrida com a varredura de expiração. A
reconciliação usa **a mesma RPC**, com outra origem: nunca existem dois códigos decidindo
sobre dinheiro.

**Tecnologias:** Deno (edge functions), Postgres/plpgsql, `pg_cron` + `pg_net`, React 19 +
Vite no front, Vitest e `deno test`.

---

## Restrições globais

Valem para **todas** as tarefas. Cada tarefa herda esta seção sem repetir.

- **Migration NÃO leva `BEGIN`/`COMMIT`.** O `scripts/db-apply.cjs` abre a transação. Com
  eles, o `ROLLBACK` do script de prova vira no-op e a mudança **fica gravada em produção**.
  Já aconteceu neste repositório em 05/08/2026.
- **Nunca rodar `supabase db push`.** Há 42 migrations locais nunca aplicadas e 28 versões no
  banco sem arquivo. Aplicação é só via `scripts/db-apply.cjs`.
- **Nunca `--no-verify` no commit.** O hook de `secretlint` é a única trava contra credencial
  vazada, e este repo já teve `service_role` e senha de banco no histórico.
- **Nenhum deploy de edge function neste plano.** Deploy é a etapa de rollout, atrás dos dois
  portões do Gabriel (`vercel env ls` e Task 0 do Mercado Pago). Se uma tarefa parecer pedir
  deploy, ela está mal lida.
- **O implementador NÃO commita.** Entrega o diff no working tree; quem commita é a sessão
  principal. É a regra do `CLAUDE.md` ("Só a sessão principal commita"), e este plano a
  contrariava: os passos "Passo N: commit" de cada tarefa foram escritos para a **sessão**, não
  para o implementador. As tarefas 1 e 2 commitaram porque o plano mandava; a partir da 3, não.
  Se você é um implementador e chegou num passo de commit, **pare ali** e reporte o que deixou
  no working tree.
- **Prova por mutação de função de banco roda DENTRO da transação, sem aplicar nada.** Esta
  regra existe porque as duas anteriores se contradiziam na Task 5: "prove por mutação" exige
  uma função no banco, e "não aplique" proíbe pôr uma lá. As duas coisas são compatíveis pela
  técnica que a revisão da Task 2 usou — abra `BEGIN`, rode `CREATE OR REPLACE FUNCTION` com a
  versão **mutada** dentro da transação, rode as asserções, e termine em `ROLLBACK`. A função
  mutada nunca existe fora daquela transação, e o banco volta ao estado anterior.

  Faça o mesmo para provar a versão **correta** antes de ela ser aplicada: cria dentro da
  transação, roda a prova inteira, `ROLLBACK`. É assim que se sabe que a migration funciona
  **antes** de gravá-la em produção.
- **O implementador NUNCA aplica migration no banco.** Escreve o arquivo, escreve o script de
  prova, e roda a prova — que vive inteira dentro de `BEGIN`/`ROLLBACK` e **não grava**. A
  aplicação é da sessão principal, **depois** de o `revisor` ter lido.

  *Por que esta regra existe:* a primeira versão deste plano mandava o implementador aplicar,
  e a Task 2 chegou a rodar em produção **antes** de qualquer revisão. Isso torna o portão do
  `revisor` Opus para migration decorativo — ele passa a revisar o que já rodou. Num banco com
  backup diário e sem PITR, a ordem certa é: escrever → provar com `ROLLBACK` → revisar →
  aplicar. Decisão do Gabriel em 07/08/2026, depois do fato.

  Antes de aplicar, a prova roda uma vez **contra o banco sem a migration** e tem de **FALHAR**
  (`function ... does not exist`). Prova que passa antes de a função existir não prova nada.

  Passe ao `db-apply.cjs` **só o nome-base** do arquivo, não o caminho: o caminho completo
  quebra a montagem do nome do rollback (`ENOENT`). Medido na Task 2.
- **`npm run dev` aponta para o Supabase de PRODUÇÃO** e já vem logado como admin. Não testar
  cadastro nem pedido pela tela.
- **Segredo nunca vai para o `.env` do front** (vira bundle). `MP_WEBHOOK_SECRET` e
  `RECONCILIACAO_SECRET` só no ambiente das functions.
- **Verificação:** `npm run typecheck`, `npm test`, `npm run build`, `npm run lint:links`,
  `npm run lint:ratchet`, `npm run size`. `eslint` tem 553 warnings pré-existentes e **0
  erro** — warning não reprova, **erro novo reprova**. O `lint:ratchet` acusa Biome acima do
  teto no Windows por causa de CRLF; **não é dívida**, o próprio script avisa que Biome só é
  cobrado no CI (Linux).
- **Comentário explica POR QUÊ, não O QUÊ.** É o padrão de todo arquivo deste repositório.
- **Sem `any` novo em código de front.** As edge functions usam `// @ts-nocheck` no topo, que
  é o padrão já estabelecido em `_shared/`.

---

## Estrutura de arquivos

| arquivo | responsabilidade | tarefa |
| --- | --- | --- |
| `supabase/config.toml` | **criar** — versiona `verify_jwt` das funções existentes (#162) | 1 |
| `supabase/migrations/20260808000000_confirmar_pagamento.sql` | **criar** — `paid_at` + `confirmar_pagamento` | 2 |
| `scripts/db-prove-checkout-060.cjs` | **criar** — prova da RPC, tudo em `ROLLBACK` | 2 |
| `supabase/functions/_shared/mercadopago.ts` | **modificar** — ganha `validarAssinatura` | 3 |
| `supabase/functions/webhook-mercadopago/index.ts` | **criar** — recebe a confirmação | 4 |
| `supabase/migrations/20260808000100_reconciliacao.sql` | **criar** — candidatos + `pg_net` + cron | 5 |
| `supabase/functions/reconciliar-pagamentos/index.ts` | **criar** — varre e chama a mesma RPC | 6 |
| `supabase/functions/criar-pagamento/index.ts` | **modificar** — `notification_url`, recusa cartão | 7 |
| `src/components/checkout/PagamentoOnline.tsx` | **modificar** — Brick só PIX | 8 |
| tela de pedidos do admin | **modificar** — filtro por `payment_status` | 9 |

**Ordem e paralelismo.** Independentes, podem ir juntas: **1, 2, 3, 7, 8, 9**. Depois: **4**
(precisa de 2 e 3) e **5** (precisa de 2). Por último: **6** (precisa de 5).

---

### Task 1: `supabase/config.toml` — versionar o `verify_jwt` (#162)

**Arquivos:**
- Criar: `supabase/config.toml`

**Interfaces:**
- Consome: nada.
- Produz: o arquivo que as tarefas 4 e 6 vão **acrescentar** a própria entrada.

**O que este arquivo faz e o que ele NÃO faz** — medido na documentação do CLI em 07/08/2026,
não suposto. A precedência no deploy é:

```
--no-verify-jwt (flag)  >  verify_jwt no config.toml  >  preserva o que está no servidor
```

Três leituras que saem daí, e que a primeira versão deste plano errava:

1. **Função sem entrada aqui NÃO é revertida para `true`.** O CLI omite o campo e a API
   preserva o que já está no servidor. Omitir não derruba a função — o custo é o repositório
   continuar sem dizer a verdade sobre ela, que é exatamente o estado que a #162 descreve.
2. **Este arquivo não protege contra a flag.** `--no-verify-jwt` continua ganhando do
   `config.toml`. Quem digitar a flag na função errada ainda quebra as coisas.
3. **O que se ganha é real, mas é outra coisa:** a configuração passa a ser revisável em PR, e
   um deploy sem flag aplica o que está escrito aqui em vez de depender do que sobrou no
   servidor de um deploy anterior que ninguém lembra.

Escreva o comentário do arquivo dizendo **isto**, não uma promessa maior.

- [ ] **Passo 1: a checagem do CLI já foi feita — leia e siga**

Este passo era "confirme na documentação antes de escrever". A checagem foi feita em
07/08/2026, pela sessão principal e por um implementador antes de você, contra
`/supabase/cli` no `context7`, e o resultado está no bloco acima: **flag > config > preserva**.
Três fontes independentes do código do CLI (`deploy.go`, `deploy.ts`, `deploy.command.ts`)
concordam, com comentário explícito do mantenedor.

Não precisa refazer a consulta. Se você **discordar** do que está escrito acima ao ler a
documentação por outro motivo, pare e reporte — não escreva o arquivo contradizendo isto em
silêncio.

- [ ] **Passo 2: levantar o estado atual de cada função**

Leia `DEPLOYMENT.md` inteiro e liste as seis funções que existem hoje
(`supabase/functions/`, ignorando `_shared`) com o `verify_jwt` que cada uma tem. O que o
`DEPLOYMENT.md` afirma:

- `send-otp-email` → sem JWT (`DEPLOYMENT.md:52`)
- `notify-new-order` → sem JWT (`DEPLOYMENT.md:57`, PEDIDO-020 #89)
- `criar-pagamento` → padrão, com JWT (`criar-pagamento/index.ts:8`)

Para `calculate-shipping`, `send-order-whatsapp` e `send-push`, **leia o cabeçalho de cada
`index.ts`** e registre o que ele afirma. Se um deles não disser, escreva `true` (o padrão) e
**diga no relatório final que essa entrada não teve evidência** — a sessão principal confere
com o Gabriel contra o painel antes de qualquer deploy.

- [ ] **Passo 3: escrever o arquivo**

O slug vai **entre aspas** (`[functions."send-otp-email"]`), que é a forma que os testes do
próprio CLI usam. TOML aceitaria a chave nua com hifen, mas seguir a forma da documentação
tira a dúvida de quem for ler depois.

```toml
# Versiona o verify_jwt de cada edge function (#162).
#
# POR QUE ESTE ARQUIVO EXISTE
#
# Ate 07/08/2026 o verify_jwt so existia na linha de comando de quem deployava
# (`--no-verify-jwt` digitado a mao) e no DEPLOYMENT.md. Aqui ele passa a ser
# revisavel em PR como o resto do projeto.
#
# PRECEDENCIA MEDIDA NO CLI EM 07/08/2026 — nao suponha outra coisa:
#
#   --no-verify-jwt (flag)  >  verify_jwt aqui  >  preserva o que ja esta no
#                                                  servidor
#
# Duas consequencias, ditas para ninguem confiar demais neste arquivo:
#
# 1. Funcao SEM entrada aqui nao e' revertida: o CLI omite o campo e a API
#    preserva o valor atual. O custo de omitir nao e' derrubar a funcao — e'
#    o repositorio voltar a nao dizer a verdade sobre ela.
# 2. Este arquivo NAO protege contra a flag. Quem digitar --no-verify-jwt na
#    funcao errada continua ganhando de tudo que esta escrito aqui.

# project_id e' identificador LOCAL — distingue projetos no mesmo host, e
# NAO escolhe o destino do deploy. O alvo e' o projeto linkado ou o
# --project-ref. Isso importa aqui: o DEPLOYMENT.md:28 avisa que o seletor
# interativo lista o sandbox ANTES do projeto certo, e que dar Enter direto
# publica no lugar errado sem erro nenhum. Ver este campo como "alvo fixado"
# e largar o --project-ref e' exatamente como se publica no sandbox.
project_id = "cafkrminfnokvgjqtkle"

# Sem JWT de proposito, e NAO porque exista link aberto por quem nao tem
# sessao — nao existe link: esta funcao manda um codigo de 6 digitos.
#
# O unico chamador e' um trigger do banco (handle_new_otp_verification), que
# se autentica com um segredo opaco lido do Vault, nao com JWT. Com
# verify_jwt = true o gateway devolve 401 ANTES de a funcao rodar, nenhum
# codigo chega ao cliente, e o login cai. Ver DEPLOYMENT.md:52.
[functions."send-otp-email"]
verify_jwt = false

# Sem JWT de proposito (PEDIDO-020 #89): o pedido de convidado nasce sem
# sessao. O que protege e' a propria funcao — corpo so aceita orderId, janela
# de 15 min, forma de UUID. Ver DEPLOYMENT.md:57.
[functions."notify-new-order"]
verify_jwt = false

[functions."calculate-shipping"]
verify_jwt = true

[functions."send-order-whatsapp"]
verify_jwt = true

[functions."send-push"]
verify_jwt = true

# Chamada pelo cliente logado ou convidado com sessao; o verify_jwt filtra
# trafego de fora do projeto e a funcao extrai a identidade do token.
[functions."criar-pagamento"]
verify_jwt = true
```

O `project_id` acima **já foi conferido** contra o `--project-ref` do `DEPLOYMENT.md` em
07/08/2026: bate, sem divergência.

- [ ] **Passo 4: provar que o arquivo é TOML válido e não quebra o CI**

```bash
npm run typecheck
```

```bash
npm run lint:links
```

Depois rode a verificação inteira:

```bash
npm test
```

Esperado: passa sem mudança de contagem. Este arquivo não entra em nenhuma suíte — o que se
prova aqui é que ele **não quebra** nada.

- [ ] **Passo 5: commit**

```bash
git add supabase/config.toml
```

```bash
git commit -m "chore(edge): versiona o verify_jwt das funcoes no config.toml (#162)"
```

---

### Task 2: migration — `paid_at` e `confirmar_pagamento`

**Arquivos:**
- Criar: `supabase/migrations/20260808000000_confirmar_pagamento.sql`
- Criar: `scripts/db-prove-checkout-060.cjs`
- Modificar: `scripts/db-apply.cjs` (registrar a migration no mapa `VERIFICACOES`)

**Esta é a primeira tarefa que escreve no banco de PRODUÇÃO.** Backup é diário e não há PITR;
reverter custa até 24 h de pedidos. A migration é aditiva (`ADD COLUMN IF NOT EXISTS`,
`CREATE OR REPLACE FUNCTION`) e não apaga nem reescreve dado — mas o `ADD COLUMN` **não entra
no rollback** que o `db-apply` gera.

**Interfaces:**
- Consome: `public.devolver_estoque(uuid)` (Fase 1, migration `20260807000000`).
- Produz: `public.confirmar_pagamento(p_order_id uuid, p_payment_id text, p_status text)
  RETURNS text`. Retornos possíveis, exatos, consumidos pelas tarefas 4 e 6:
  `'pago'`, `'pago_apos_expirar'`, `'ja_pago'`, `'recusado'`, `'estornado'`,
  `'ja_estornado'`, `'divergente'`, `'inexistente'`, `'ignorado'`.

**A corrida que esta função existe para resolver.** O comentário da
`expirar_pedidos_vencidos` (migration `20260807000000`, linhas 87–95) já a descreve: se a
varredura pegar a trava primeiro, um `UPDATE` do webhook **espera, reavalia o `WHERE` por id —
que continua valendo — e sobrescreve**, produzindo pedido `pago` com `status = 'cancelled'` e
estoque já devolvido. Por isso aqui é `SELECT ... FOR UPDATE` **sem** `SKIP LOCKED` (esperar é
o ponto) seguido de **releitura** do `payment_status`.

- [ ] **Passo 1: escrever a migration**

```sql
-- Fase 3 da cobranca: a RPC que confirma pagamento sob trava.
-- SEM BEGIN/COMMIT: o db-apply.cjs abre a transacao.

-- 1. Carimbo de quando o dinheiro entrou -------------------------------
-- Sem ele, "quando entrou" so existe no Mercado Pago, e a fila de atencao do
-- admin nao tem como ordenar nem a reconciliacao como medir atraso.
ALTER TABLE public.marketplace_orders
  ADD COLUMN IF NOT EXISTS paid_at timestamptz;

-- 2. A decisao sob trava ------------------------------------------------
CREATE OR REPLACE FUNCTION public.confirmar_pagamento(
    p_order_id   uuid,
    p_payment_id text,
    p_status     text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $confirmar$
DECLARE
    v_pedido RECORD;
BEGIN
    -- FOR UPDATE sem SKIP LOCKED: se a expirar_pedidos_vencidos esta com a
    -- linha, ESPERAR e' o comportamento correto. Pular deixaria o pagamento
    -- sem registro. Depois da espera, o payment_status lido aqui embaixo ja
    -- e' o que a varredura gravou — e' a releitura que decide, nao o WHERE.
    -- `status` entra no SELECT porque as duas transicoes que mexem em
    -- estoque dependem dele — ver a guarda `status = 'pending'` mais abaixo.
    SELECT id, payment_status, status, gateway_payment_id
      INTO v_pedido
      FROM public.marketplace_orders
     WHERE id = p_order_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RETURN 'inexistente';
    END IF;

    -- O pedido guarda o id da cobranca desde a criacao (Fase 2). Se o que
    -- chegou nao bate, alguem esta confirmando o pagamento de OUTRO pedido:
    -- nao escrever e deixar para uma pessoa olhar.
    --
    -- As duas primeiras clausulas NAO sao redundantes. `IS DISTINCT FROM`
    -- sozinho e' NULL-safe no sentido ERRADO para uma checagem de
    -- identidade: dois NULLs contam como iguais, e a guarda LIBERA
    -- justamente quando nao ha com o que comparar. Medido em 07/08/2026
    -- contra o banco real: pedido 'aguardando' sem gateway_payment_id,
    -- confirmado com p_payment_id NULL, virava 'pago' com paid_at carimbado
    -- e sem pagamento nenhum. E 'aguardando' + gateway_payment_id NULL e' o
    -- estado NORMAL de todo pedido entre o checkout e a criacao da cobranca
    -- — com a flag da Fase 2 desligada, e' o estado permanente.
    IF p_payment_id IS NULL
       OR v_pedido.gateway_payment_id IS NULL
       OR v_pedido.gateway_payment_id IS DISTINCT FROM p_payment_id THEN
        RETURN 'divergente';
    END IF;

    IF p_status = 'estornado' THEN
        IF v_pedido.payment_status = 'estornado' THEN
            RETURN 'ja_estornado';
        END IF;

        -- A partir de 'aguardando' NADA saiu: o estoque esta apenas
        -- RESERVADO, e devolver e' seguro. A regra "estorno nunca mexe em
        -- estoque" existe para o caso 'pago', onde a mercadoria pode ja ter
        -- saido — nao para este.
        --
        -- Sem este ramo o pedido ficaria 'estornado' com status 'pending', e
        -- a expirar_pedidos_vencidos (que exige payment_status='aguardando',
        -- ver 20260807000000:106) NUNCA MAIS o alcancaria: a reserva sumiria
        -- do catalogo para sempre. Medido em 07/08/2026 — 3 unidades
        -- perdidas, e a varredura rodando logo depois nao tocou na linha.
        -- `AND status = 'pending'` NAO e' zelo: e' a MESMA guarda que a
        -- expirar_pedidos_vencidos ja usa, pelo MESMO motivo, e esta
        -- explicada em 20260807000000:97-102. A update_order_status_atomic
        -- devolve o estoque quando o cliente cancela pelo app e NAO escreve
        -- payment_status — o pedido fica 'aguardando' + 'cancelled' com o
        -- estoque JA de volta. Sem esta clausula, creditar aqui poe no
        -- catalogo unidade que nao existe. Medido em 07/08/2026: 10 -> 13.
        --
        -- Vale igual para 'processing': venda que o admin fechou por fora
        -- dentro dos 30 min nao pode ser cancelada por confirmacao de
        -- gateway, e a mercadoria pode ja ter saido.
        IF v_pedido.payment_status = 'aguardando'
           AND v_pedido.status = 'pending' THEN
            PERFORM public.devolver_estoque(p_order_id);
            UPDATE public.marketplace_orders
               SET payment_status = 'estornado',
                   status         = 'cancelled',
                   updated_at     = now()
             WHERE id = p_order_id;
            RETURN 'estornado';
        END IF;

        -- Todo o resto: marca e NAO mexe em estoque. Isso inclui 'pago',
        -- 'pago_apos_expirar', 'expirado', 'recusado', NULL — e tambem o
        -- 'aguardando' que NAO esta 'pending', que caiu ate aqui pela guarda
        -- acima. A partir de 'pago' houve venda e possivelmente entrega;
        -- repor sozinho e' chutar onde a mercadoria esta. Nos demais o
        -- estoque JA voltou por outro caminho, e mexer de novo creditaria em
        -- dobro — devolver_estoque nao e' idempotente.
        UPDATE public.marketplace_orders
           SET payment_status = 'estornado',
               updated_at     = now()
         WHERE id = p_order_id;
        RETURN 'estornado';
    END IF;

    IF p_status = 'pago' THEN
        -- Idempotencia do webhook: o MP reenvia quando nao recebe 200 rapido.
        -- A segunda chamada cai aqui e nao dispara push de novo.
        IF v_pedido.payment_status IN ('pago', 'pago_apos_expirar') THEN
            RETURN 'ja_pago';
        END IF;

        -- A varredura ganhou a corrida: o estoque JA voltou. Nao mexer em
        -- estoque nem em status — so marcar e chamar uma pessoa.
        IF v_pedido.payment_status = 'expirado' THEN
            UPDATE public.marketplace_orders
               SET payment_status = 'pago_apos_expirar',
                   paid_at        = now(),
                   updated_at     = now()
             WHERE id = p_order_id;
            RETURN 'pago_apos_expirar';
        END IF;

        IF v_pedido.payment_status = 'aguardando' THEN
            UPDATE public.marketplace_orders
               SET payment_status = 'pago',
                   paid_at        = now(),
                   updated_at     = now()
             WHERE id = p_order_id;
            RETURN 'pago';
        END IF;

        -- 'recusado', NULL (os 64 pedidos historicos) ou qualquer outro:
        -- nao inventar transicao.
        RETURN 'ignorado';
    END IF;

    IF p_status = 'recusado' THEN
        -- devolver_estoque NAO e' idempotente (ver o COMMENT dela). So se
        -- chama a partir de 'aguardando', que e' a unica transicao que
        -- acontece uma vez, e de dentro desta trava.
        IF v_pedido.payment_status <> 'aguardando' THEN
            RETURN 'ignorado';
        END IF;

        -- Mesma guarda do ramo do estorno, e pelo mesmo motivo — o gatilho
        -- aqui e' ate mais provavel: cartao recusado logo depois de o
        -- cliente desistir e cancelar pelo app. O estoque JA voltou pela
        -- update_order_status_atomic; creditar de novo poe unidade fantasma
        -- no catalogo. Medido em 07/08/2026: 10 -> 13.
        --
        -- Marca mesmo assim, em vez de 'ignorado': sem isso o pedido ficaria
        -- 'aguardando' para sempre — a varredura tambem exige
        -- status = 'pending' e nunca mais o alcancaria.
        IF v_pedido.status <> 'pending' THEN
            UPDATE public.marketplace_orders
               SET payment_status = 'recusado',
                   updated_at     = now()
             WHERE id = p_order_id;
            RETURN 'recusado';
        END IF;

        PERFORM public.devolver_estoque(p_order_id);

        UPDATE public.marketplace_orders
           SET payment_status = 'recusado',
               status         = 'cancelled',
               updated_at     = now()
         WHERE id = p_order_id;
        RETURN 'recusado';
    END IF;

    -- 'aguardando' vindo do MP (pending/in_process) cai aqui: nada a fazer,
    -- o pedido ja esta nesse estado e a expiracao cuida do prazo.
    RETURN 'ignorado';
END;
$confirmar$;

REVOKE ALL ON FUNCTION public.confirmar_pagamento(uuid, text, text)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.confirmar_pagamento(uuid, text, text) IS
  'Unico caminho que escreve payment_status a partir do gateway. O webhook e a '
  'reconciliacao chamam ESTA funcao — nao um UPDATE proprio — porque a decisao '
  'depende de reler o estado sob FOR UPDATE, e nao do WHERE da chamada.';
```

- [ ] **Passo 2: escrever o script de prova**

Crie `scripts/db-prove-checkout-060.cjs` copiando a estrutura de
`scripts/db-prove-checkout-010.cjs`: mesmo `lerDatabaseUrl()`, mesmo `conferir()`, `BEGIN` no
começo e **`ROLLBACK` no `finally`**. Leia aquele arquivo antes de escrever este.

Duas armadilhas que aquele script documenta e que valem aqui: `produtos.custo` é `NOT NULL`
sem default, e `marketplace_orders.customer_data` (jsonb) e `subtotal` são `NOT NULL` sem
default. Omitir qualquer um quebra o `INSERT`.

Os casos que o script tem de cobrir — **um por linha da tabela de decisão**:

| cenário montado | chamada | esperado |
| --- | --- | --- |
| `payment_status='aguardando'`, `gateway_payment_id='MP1'` | `('MP1','pago')` | `'pago'`, `paid_at` não nulo, estoque **intacto** |
| o mesmo pedido, chamando de novo | `('MP1','pago')` | `'ja_pago'`, `paid_at` **inalterado** |
| `payment_status='expirado'`, `gateway_payment_id='MP2'` | `('MP2','pago')` | `'pago_apos_expirar'`, `status` continua `'cancelled'`, estoque **inalterado** |
| `payment_status='aguardando'` com 3 unidades reservadas | `('MP3','recusado')` | `'recusado'`, estoque **+3**, `status='cancelled'` |
| pedido já `'recusado'` | `('MP3','recusado')` | `'ignorado'`, estoque **inalterado** (é a prova de que não credita duas vezes) |
| `pago` com 3 unidades, `'MP4'` | `('MP4','estornado')` | `'estornado'`, estoque **inalterado** (pode ter saído) |
| **`aguardando` com 3 unidades, `'MP5'`** | `('MP5','estornado')` | `'estornado'`, estoque **+3**, `status='cancelled'` |
| o mesmo pedido, de novo | `('MP5','estornado')` | `'ja_estornado'`, estoque **inalterado** |
| `aguardando`, `'MP6'` | `('OUTRO','pago')` | `'divergente'`, `payment_status` **inalterado** |
| **`aguardando` com `gateway_payment_id` NULL** | `(NULL,'pago')` | `'divergente'` — **não** `'pago'` |
| **`aguardando`, `'MP7'`** | `(NULL,'pago')` | `'divergente'` |
| **`aguardando` + `status='cancelled'` com 3 un., `'MP8'`** | `('MP8','estornado')` | `'estornado'`, estoque **inalterado**, `status` continua `'cancelled'` |
| **`aguardando` + `status='cancelled'` com 3 un., `'MP9'`** | `('MP9','recusado')` | `'recusado'`, estoque **inalterado** |
| id que não existe | `(uuid aleatório,'X','pago')` | `'inexistente'` |

**As duas linhas de `status='cancelled'` são o achado da re-revisão de 07/08/2026**, e sem elas
a guarda entra sem teste. Elas montam o estado que a `update_order_status_atomic` produz
quando o cliente cancela pelo app: ela devolve o estoque e **não escreve `payment_status`**,
deixando `aguardando` + `cancelled` com o estoque já de volta. Medido sem a guarda: o estoque
ia de 10 para 13 — unidade fantasma no catálogo.

As três linhas em **negrito** são as que a revisão de 07/08/2026 provou que faltavam, e cada
uma cobre um defeito que estava mesmo no banco: o vazamento de estoque no estorno cedo, e a
guarda de identidade que liberava no par NULL/NULL.

**TODO pedido montado leva item de verdade em `marketplace_order_items`** (`product_id`,
`quantity > 0`), sem exceção — **inclusive** os casos cuja asserção é "estoque intacto".

*Por que isso não é zelo:* na primeira versão deste script, `criarPedido()` não inseria item
nenhum e só um caso tinha. Medido em 07/08/2026: `devolver_estoque` devolveria 0 unidades,
então três asserções de "estoque intacto" passavam **mesmo com o mecanismo invertido**. A
revisão mutou o ramo do estorno para creditar estoque — o que o comentário proíbe em caixa
alta — e a prova continuou verde. Asserção de estoque sobre pedido sem item não prova nada.

**Cada caso monta o próprio pedido.** Na primeira versão os casos 2, 6 e 7 dependiam do estado
deixado pelos anteriores no mesmo pedido: mudar o caso 2 mudava o significado do 6 e do 7 em
silêncio, e o 7 acabava comparando `'estornado'` com `'estornado'`. Um
`gateway_payment_id` distinto por pedido resolve — o índice UNIQUE é parcial.

Meça `produtos.estoque` antes e depois em **todos** os casos: é a única forma de separar "não
mexeu" de "não tinha o que mexer".

- [ ] **Passo 3: rodar a prova e verificar que FALHA**

```bash
node scripts/db-prove-checkout-060.cjs
```

Esperado: **FALHA** com erro de função inexistente (`confirmar_pagamento does not exist`), já
que a migration ainda não foi aplicada. Se passar aqui, o script não está provando nada.

- [ ] **Passo 4: registrar a migration no `VERIFICACOES` do `db-apply.cjs`**

**Leia `scripts/db-apply.cjs:13-36` e `:117-130` antes.** O script tem um mapa `VERIFICACOES`
que, depois de aplicar, relê a função que ficou no banco e confere se os marcadores esperados
estão lá. **Migration não registrada não é verificada** — e essa é a trava que pega
`CREATE OR REPLACE` que aplicou mas perdeu um trecho no caminho.

Acrescente a entrada, na forma de array que a `20260807000000_reserva_com_expiracao.sql` já
usa (ela toca duas funções):

```js
  "20260808000000_confirmar_pagamento.sql": [
    {
      funcao: "confirmar_pagamento",
      esperado: [
        // FOR UPDATE sem SKIP LOCKED: e' o que faz o webhook ESPERAR a
        // varredura em vez de pular a linha. Trocado por SKIP LOCKED, o
        // pagamento fica sem registro e o teste nao pega.
        "FOR UPDATE;",
        // A releitura que decide. Sem ela volta o UPDATE cego que produz
        // pedido 'pago' com status 'cancelled'.
        "IF v_pedido.payment_status = 'expirado' THEN",
        "RETURN 'pago_apos_expirar';",
        // A guarda que impede credito de estoque em dobro.
        "IF v_pedido.payment_status <> 'aguardando' THEN",
      ],
    },
  ],
```

- [ ] **Passo 5: ensaiar com `--dry-run`** *(a aplicação é da sessão principal — ver
      Restrições globais. Este passo pedia que o implementador aplicasse; foi corrigido em
      07/08/2026, depois de a Task 2 ter chegado a produção antes da revisão.)*

```bash
node scripts/db-apply.cjs --dry-run supabase/migrations/20260808000000_confirmar_pagamento.sql
```

Leia o plano impresso. **Duas coisas que o script avisa e que valem repetir aqui:** o arquivo
de rollback que ele gera guarda **só a definição atual das funções** que a migration toca —
`ADD COLUMN`, índice e constraint **não entram**. Como esta migration adiciona `paid_at`,
desfazer a coluna seria manual. E o banco é o de **produção**: backup é diário e não há PITR.

Se o dry-run acusar qualquer coisa que você não esperava, **pare e reporte**.

A aplicação e a prova pós-aplicação ficam com a sessão principal:

```bash
node scripts/db-apply.cjs 20260808000000_confirmar_pagamento.sql
```

```bash
node scripts/db-prove-checkout-060.cjs
```

Esperado: todos os `ok`, nenhum `FALHA`, e a verificação de marcadores do próprio `db-apply`
passando. **A saída inteira das duas execuções vai no relatório.**

- [ ] **Passo 6: prova por mutação — o teste tem dente?**

Comente a linha `IF v_pedido.gateway_payment_id IS DISTINCT FROM p_payment_id` e o `RETURN
'divergente'`, reaplique num `ROLLBACK` e rode a prova: o caso `divergente` **tem que
reprovar**. Depois desfaça. Faça o mesmo com o ramo `IN ('pago','pago_apos_expirar')` → o caso
`ja_pago` tem que reprovar.

Se algum caso continuar verde com o mecanismo removido, o teste é decorativo e precisa ser
reescrito antes de seguir.

- [ ] **Passo 7: commit**

```bash
git add supabase/migrations/20260808000000_confirmar_pagamento.sql scripts/db-prove-checkout-060.cjs scripts/db-apply.cjs
```

```bash
git commit -m "feat(checkout): confirmar_pagamento decide sob trava, com paid_at"
```

---

### Task 3: `validarAssinatura` no `_shared/mercadopago.ts`

**Arquivos:**
- Modificar: `supabase/functions/_shared/mercadopago.ts`
- Criar: `supabase/functions/_shared/mercadopago_assinatura_test.ts`

**Interfaces:**
- Consome: nada.
- Produz:
  `export async function validarAssinatura(args: { xSignature: string | null; xRequestId: string | null; dataId: string; segredo: string; agora?: number; toleranciaSegundos?: number }): Promise<boolean>`

**Esta é a única autenticação que o webhook tem.** Não há JWT. Se ela passar só nos casos
felizes, não testamos nada.

- [ ] **Passo 1: confirmar o formato do manifesto na documentação do MP**

Use `mcp__context7__query-docs` para o Mercado Pago: validação de `x-signature` em webhooks —
o formato do header, o template do manifesto e o algoritmo.

O que este plano assume (e que **você tem de confirmar antes de escrever o teste**):
- o header vem como `ts=<epoch>,v1=<hex>`;
- o manifesto é `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`;
- HMAC-SHA256 do manifesto com o segredo, comparado ao `v1` em hexadecimal.

**Se a documentação divergir em qualquer ponto — inclusive se o `data.id` alfanumérico tiver
de ir em minúsculas, ou se o segmento `request-id` for omitido quando o header não vem —
siga a documentação e diga no relatório o que mudou.** O vetor do teste depende disso, e um
manifesto errado faz a função recusar 100% dos webhooks legítimos.

- [ ] **Passo 2: gerar o vetor do teste com uma implementação independente**

Rode, no PowerShell, com o manifesto **exatamente como a documentação descreve**:

```bash
node -e "const c=require('crypto');const m='id:12345;request-id:abc-123;ts:1700000000;';console.log(c.createHmac('sha256','segredo-de-teste').update(m).digest('hex'))"
```

Anote a saída. O teste vai comparar a implementação em Deno contra este valor, produzido pelo
`crypto` do Node — **duas implementações concordando**, não a função conferindo a si mesma.

- [ ] **Passo 3: escrever o teste que falha**

```ts
import { assert, assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { validarAssinatura } from "./mercadopago.ts";

const SEGREDO = "segredo-de-teste";
const TS = 1700000000;
const DATA_ID = "12345";
const REQUEST_ID = "abc-123";
// Gerado pelo crypto do Node em 07/08/2026, com o manifesto
// `id:12345;request-id:abc-123;ts:1700000000;`. Se este hex for recalculado
// pela propria funcao, o teste deixa de provar qualquer coisa.
//
// SE o Passo 1 revelar manifesto diferente, REFACA o Passo 2 e troque este
// valor — este hex vale para o manifesto acima e para nenhum outro.
const V1_VALIDO =
  "5bad78f1f0f10eb98d20496b6b8330f24a7469884503659db81991a37b30de40";

const agoraOk = (TS + 10) * 1000;

Deno.test("aceita assinatura valida", async () => {
  const ok = await validarAssinatura({
    xSignature: `ts=${TS},v1=${V1_VALIDO}`,
    xRequestId: REQUEST_ID,
    dataId: DATA_ID,
    segredo: SEGREDO,
    agora: agoraOk,
  });
  assert(ok);
});

Deno.test("recusa segredo errado", async () => {
  const ok = await validarAssinatura({
    xSignature: `ts=${TS},v1=${V1_VALIDO}`,
    xRequestId: REQUEST_ID,
    dataId: DATA_ID,
    segredo: "outro-segredo",
    agora: agoraOk,
  });
  assertEquals(ok, false);
});

Deno.test("recusa corpo adulterado com assinatura antiga", async () => {
  // Mesmo ts, mesmo v1, OUTRO pagamento: e' o ataque que a assinatura existe
  // para barrar — reaproveitar um header legitimo apontando para outro id.
  const ok = await validarAssinatura({
    xSignature: `ts=${TS},v1=${V1_VALIDO}`,
    xRequestId: REQUEST_ID,
    dataId: "99999",
    segredo: SEGREDO,
    agora: agoraOk,
  });
  assertEquals(ok, false);
});

Deno.test("recusa ts fora da tolerancia", async () => {
  const ok = await validarAssinatura({
    xSignature: `ts=${TS},v1=${V1_VALIDO}`,
    xRequestId: REQUEST_ID,
    dataId: DATA_ID,
    segredo: SEGREDO,
    agora: (TS + 60 * 60) * 1000,
  });
  assertEquals(ok, false);
});

// Os dois testes abaixo existem porque a prova por mutacao da revisao de
// 09/08/2026 mostrou que a suite NAO pegava nem o casing do dataId nem o ramo
// condicional do request-id — as duas decisoes que o manifesto realmente toma.
// Sem eles, trocar toLowerCase por toUpperCase deixava os 5 testes verdes.
Deno.test("preserva o casing do dataId no manifesto", async () => {
  // Vetor gerado no Node sobre `id:AbC12;request-id:abc-123;ts:1700000000;`.
  //
  // O id e' MISTO de proposito. Um id todo maiusculo ("ABC12") nao serve
  // aqui: `"ABC12".toUpperCase()` e' ele mesmo, entao a mutacao que forca
  // maiusculas passaria despercebida e o teste so provaria metade do que
  // promete. Com "AbC12", QUALQUER normalizacao de caixa — toLowerCase ou
  // toUpperCase — muda o manifesto e derruba o teste. Medido em 09/08/2026,
  // depois de a primeira versao deste teste falhar exatamente por isso.
  const V1_MISTO =
    "eb23df430623adc6ed3593f4a4a5f0b2e275750ee790ab1bae37af4d2f5e9c78";
  const ok = await validarAssinatura({
    xSignature: `ts=${TS},v1=${V1_MISTO}`,
    xRequestId: REQUEST_ID,
    dataId: "AbC12",
    segredo: SEGREDO,
    agora: agoraOk,
  });
  assert(ok, "id com caixa mista tem de validar com o casing preservado");
});

Deno.test("omite o segmento request-id quando o header nao veio", async () => {
  // Vetor gerado no Node sobre `id:12345;ts:1700000000;` — SEM request-id.
  const V1_SEM_REQUEST_ID =
    "0ada36b4ecda6b0e1d969a628e11b8a70430c3f77bc510fe9ad37fd2a713250c";
  const ok = await validarAssinatura({
    xSignature: `ts=${TS},v1=${V1_SEM_REQUEST_ID}`,
    xRequestId: null,
    dataId: DATA_ID,
    segredo: SEGREDO,
    agora: agoraOk,
  });
  assert(ok);
});

Deno.test("recusa header ausente ou malformado", async () => {
  for (const xSignature of [null, "", "v1=semtimestamp", "ts=abc,v1=xyz", "lixo"]) {
    const ok = await validarAssinatura({
      xSignature,
      xRequestId: REQUEST_ID,
      dataId: DATA_ID,
      segredo: SEGREDO,
      agora: agoraOk,
    });
    assertEquals(ok, false, `deveria recusar: ${JSON.stringify(xSignature)}`);
  }
});
```

- [ ] **Passo 4: rodar e verificar que falha**

```bash
deno test --allow-all --no-check supabase/functions/_shared/mercadopago_assinatura_test.ts
```

Esperado: FALHA — `validarAssinatura` não existe.

- [ ] **Passo 5: implementar**

Acrescente ao fim de `supabase/functions/_shared/mercadopago.ts`. Ajuste o manifesto ao que a
documentação confirmou no Passo 1:

```ts
/**
 * Valida o x-signature do webhook do Mercado Pago.
 *
 * E' a UNICA autenticacao que a webhook-mercadopago tem: ela roda com
 * verify_jwt = false porque o MP nao manda JWT. Sem isto, quem descobrir a URL
 * forja um "aprovado" e leva produto de graca.
 *
 * Pura e com `agora` injetavel para o teste nao depender do relogio.
 */
export async function validarAssinatura(args: {
  xSignature: string | null;
  xRequestId: string | null;
  dataId: string;
  segredo: string;
  agora?: number;
  toleranciaSegundos?: number;
}): Promise<boolean> {
  const { xSignature, xRequestId, dataId, segredo } = args;
  const agora = args.agora ?? Date.now();
  const tolerancia = args.toleranciaSegundos ?? 300;

  if (!xSignature || !segredo || !dataId) return false;

  let ts = "";
  let v1 = "";
  for (const parte of xSignature.split(",")) {
    const [chave, ...resto] = parte.split("=");
    const valor = resto.join("=").trim();
    if (chave?.trim() === "ts") ts = valor;
    if (chave?.trim() === "v1") v1 = valor;
  }
  if (!ts || !v1) return false;

  // `ts` fora da janela: header legitimo reaproveitado semanas depois nao vale.
  const tsNumero = Number(ts);
  if (!Number.isFinite(tsNumero)) return false;
  const idadeSegundos = Math.abs(agora / 1000 - tsNumero);
  if (idadeSegundos > tolerancia) return false;

  // O segmento de request-id so entra quando o header veio — igual ao
  // buildManifest do SDK oficial (`if (requestId) parts.push(...)`).
  //
  // `dataId` vai COM O CASING ORIGINAL. A documentacao do MP pede minusculas
  // ("ensuring data.id_url is in lowercase") e ESTA ERRADA: o SDK oficial
  // REMOVEU o .toLowerCase() de proposito (PR mercadopago/sdk-nodejs#439),
  // porque o MP assina com o casing original e qualquer id com maiuscula
  // falhava com SignatureMismatch. Medido em 09/08/2026: com .toLowerCase(),
  // um dataId "ABC12" assinado como o MP assina e' RECUSADO.
  //
  // Nao e' a unica coisa que essa pagina da doc erra: ela tambem diz que o
  // `ts` vem em milissegundos, e vem em SEGUNDOS (issue #458 do mesmo SDK).
  // Quando doc e SDK divergirem aqui, o SDK ganha — ele foi corrigido por
  // observacao de trafego real, a doc nao.
  const manifesto = xRequestId
    ? `id:${dataId};request-id:${xRequestId};ts:${ts};`
    : `id:${dataId};ts:${ts};`;

  const chave = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(segredo),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const assinado = await crypto.subtle.sign(
    "HMAC",
    chave,
    new TextEncoder().encode(manifesto),
  );
  const esperado = Array.from(new Uint8Array(assinado))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // Comparacao de tempo constante: `===` em string vaza, pelo tempo de
  // resposta, quantos caracteres do prefixo o atacante ja acertou.
  if (esperado.length !== v1.length) return false;
  let diferenca = 0;
  for (let i = 0; i < esperado.length; i++) {
    diferenca |= esperado.charCodeAt(i) ^ v1.charCodeAt(i);
  }
  return diferenca === 0;
}
```

- [ ] **Passo 6: rodar e verificar que passa**

```bash
deno test --allow-all --no-check supabase/functions/_shared/mercadopago_assinatura_test.ts
```

Esperado: 5 testes passando.

- [ ] **Passo 7: prova por mutação**

Troque a comparação de tempo constante por `return esperado === v1;` — os testes **têm que
continuar passando** (o comportamento é o mesmo; o que muda é o vazamento por tempo, que
nenhum teste pega, e está aqui só para você saber disso). Depois **remova a checagem de
tolerância do `ts`** — o teste "recusa ts fora da tolerancia" tem que **reprovar**. Desfaça as
duas.

- [ ] **Passo 8: commit**

```bash
git add supabase/functions/_shared/mercadopago.ts supabase/functions/_shared/mercadopago_assinatura_test.ts
```

```bash
git commit -m "feat(edge): valida a assinatura do webhook do Mercado Pago"
```

---

### Task 4: `webhook-mercadopago`

**Arquivos:**
- Criar: `supabase/functions/webhook-mercadopago/index.ts`
- Criar: `supabase/functions/webhook-mercadopago/index_test.ts`
- Modificar: `supabase/config.toml` (acrescentar a entrada)

**Interfaces:**
- Consome: `validarAssinatura`, `consultarPagamento`, `mapearStatus` do
  `../_shared/mercadopago.ts`; `carregarChavesVapid`, `enviarParaInscritos`, `resumir`,
  `corsHeaders`, `readKey` do `../_shared/webpush.ts`; a RPC `confirmar_pagamento` da Task 2.
- Produz: nada que outra tarefa consuma.

**A costura de teste é a mesma da `criar-pagamento`:** um `handler(req, deps = {})` com
`deps.supabase`, `deps.fetchImpl` e `deps.enviarPush`, registrada com
**`serve((req) => handler(req))`**, um único argumento. Leia
`supabase/functions/criar-pagamento/index.ts:124-140` antes de escrever.

**Uma correção de 09/08/2026, para a regra não virar dogma copiado.** Este plano dizia que
`serve(handler)` direto **quebraria produção**, porque o `serve` do std passa um segundo
argumento (`ConnInfo`) que cairia em `deps`. A revisão da Task 4 **mediu e refutou**: passando
um `ConnInfo` como segundo argumento, o handler se comporta igual, porque **toda** dep usa `??`
com fallback real (`deps.supabase ?? createClient(...)`, `deps.fetchImpl` → `fetch`,
`deps.enviarPush ?? disparoPushReal`). Um objeto estranho em `deps` sem as chaves esperadas
cai nos mesmos defaults.

Continue escrevendo com um argumento — é mais claro e não depende de todo fallback estar
correto para sempre. Mas **não é a trava de segurança** que o comentário da `criar-pagamento`
sugere, e escrever isso no código como se fosse é plantar uma crença falsa.

- [ ] **Passo 1: escrever os testes que falham**

Cubra, com `deps` injetadas (sem rede, sem banco):

1. **assinatura inválida → 401** e `confirmar_pagamento` **não é chamada** (registre as
   chamadas no fake do supabase e asserte `rpc.length === 0`).
2. **MP responde 500 → a função responde 500** (é quando reenviar ajuda).
3. **MP diz `approved`, RPC devolve `'pago'` → 200** e o push é disparado uma vez.
4. **RPC devolve `'ja_pago'` → 200 e NENHUM push.** É a prova da idempotência.
5. **RPC devolve `'pago_apos_expirar'` → 200 e push disparado** (texto diferente).
6. **MP devolve status desconhecido (ex.: `in_mediation`) → 200, sem chamar a RPC com um
   status inventado.** `mapearStatus` devolve `null`; a função não pode traduzir `null` em
   nada.
7. **corpo sem `data.id` → 400**, sem tocar em MP nem banco.

**Mais três, que a revisão de 09/08/2026 provou que faltavam.** Ela mutou o handler nas três
direções abaixo e a suíte ficou **verde nas três** — são as invariantes mais caras da função, e
eram justamente as sem teste:

8. **O corpo NÃO decide qual pedido é confirmado.** Monte um webhook com assinatura válida para
   `data.id=999` e, no corpo, `external_reference`, `order_id`, `p_order_id` e
   `data.external_reference` **todos** apontando para um UUID hostil — com o MP devolvendo
   outro. Asserte que o `p_order_id` que chegou à RPC é **o do MP**. Esta é a invariante nº 1:
   sem ela, quem descobrir a URL confirma o pedido que quiser. A mutação que passa hoje é
   trocar por `body?.data?.external_reference ?? consulta.externalReference` — refatoração
   plausível, porque as notificações do MP em alguns tópicos carregam esse campo.
9. **Push exatamente em 2 dos 9 retornos.** Um laço sobre os nove valores, asserindo a contagem
   de pushes: 1 para `'pago'` e `'pago_apos_expirar'`, **0** para os outros sete. A mutação que
   passa hoje é `if (resultado !== "ja_pago")` — e ela faria `divergente` virar push a cada ~15
   min, no ritmo do reenvio do MP.
10. **`ts` antigo é ACEITO.** Assine com `ts = agora - 3600` (uma hora atrás) e asserte `200`
    com a RPC chamada. Todos os testes atuais assinam com `ts = agora`, então a decisão de
    desligar a janela não está presa por nada — alguém remove a linha achando que é redundante
    e o primeiro reenvio do MP vira 401 permanente.

Para o push, injete uma dependência `enviarPush` em `deps` que só conta chamadas — não suba
push service local aqui; o envio em si já é coberto pelos testes da `send-push`, que
exercitam o mesmo `enviarParaInscritos`. É o mesmo argumento que `notify-new-order/index_test.ts:7-12`
usa.

Para o MP, use `deps.fetchImpl` devolvendo `new Response(JSON.stringify({...}), {status})` —
igual ao que os testes da `criar-pagamento` já fazem.

- [ ] **Passo 2: rodar e verificar que falham**

```bash
deno test --allow-all --no-check supabase/functions/webhook-mercadopago/
```

Esperado: FALHA — o módulo não existe.

- [ ] **Passo 3: implementar o handler**

Regras que o código tem de obedecer, e que os testes acima cobrem:

- Do corpo saem **exatamente dois campos**: `data.id`, que diz qual **cobrança** perguntar ao
  MP, e `type`, que só serve para descartar tópico que não é de pagamento. **Nenhum dos dois
  diz qual PEDIDO confirmar** — isso vem do `external_reference` da resposta do MP.

  O filtro de `type` entrou na rodada de conserto de 09/08/2026 e é seguro **porque só age
  quando o campo está presente**: notificação sem `type`, com `topic: "payment"`, ou com `type`
  não-string continua sendo processada. Medido com contrafactual, e preso nos dois sentidos —
  mutar o gate para `if (tipoDoEvento !== "payment")` (que descartaria notificação sem o campo)
  reprova 7 testes. Ele roda **depois** do HMAC, então não é oráculo para quem não tem o
  segredo, e loga o `type` recusado como tripwire caso o formato do MP mude.
- **Passe `toleranciaSegundos: Number.POSITIVE_INFINITY`** para `validarAssinatura` — ou seja,
  **desligue a janela de `ts` nesta função**. Não herde o default de 300 s.

  *Primeira versão deste plano dizia 86400 (24 h). Foi corrigido em 09/08/2026, com um número
  que a revisão da Task 4 mediu:* o MP não para de reenviar depois da terceira tentativa — ele
  **estende o intervalo e continua**, sem limite documentado. Logo **nenhuma janela finita é
  segura**: uma cadeia longa de reenvios ultrapassa qualquer valor que se escolha, e o último
  reenvio vira 401 permanente.

  *Por que desligar não custa nada:* **o webhook nunca confia no que chega.** Ele pega só o
  `data.id` e vai perguntar ao MP o status **atual**. Um header replayado — mesmo capturado há
  meses — produz uma consulta nova ao MP e a decisão correta para o estado de agora. A
  `confirmar_pagamento` fecha o resto: retorno terminal, sem push. Não existe cenário em que
  aceitar um `ts` antigo cause dano.

  A assimetria é total: a janela protege contra nada e pode custar um pedido pago sem produto.
  É por isso que o SDK oficial do MP entrega essa checagem **desligada por padrão**. Quem
  autentica aqui é o HMAC, não o relógio.
- Chama `consultarPagamento` e usa **o status que o MP devolveu**, nunca o do corpo.
- `mapearStatus(...) === null` → `200` com `console.warn` alto, **sem chamar a RPC**.
- Chama `supabase.rpc("confirmar_pagamento", { p_order_id, p_payment_id, p_status })`, onde
  `p_order_id` vem do `external_reference` da resposta do MP — **não** do corpo do webhook.
- **Valide o `external_reference` com `pareceUuid` antes de chamar a RPC.** Se não tiver forma
  de UUID (ausente, vazio, ou pagamento criado por fora deste sistema), responda `200` com log
  alto e **não** chame a RPC. Sem isso, o Postgres recusa o cast com `22P02`, a chamada
  rejeita, e o handler devolve `500` — fazendo o MP reenviar para sempre um evento que nunca
  vai dar certo. `pareceUuid` está em `notify-new-order/index.ts:66`.
- **O retorno da RPC decide o push:** só `'pago'` e `'pago_apos_expirar'` disparam.
- **Código HTTP:** `200` quando o evento foi tratado ou é intratável (status desconhecido,
  `external_reference` inválido, RPC devolvendo `divergente`/`inexistente`/`ignorado`/`ja_pago`).
  `500` quando reenviar ajuda: **qualquer** `consultarPagamento` com `ok: false` — exceto
  `status === 404`, que significa "esse pagamento não existe" e não melhora com retentativa —
  e erro de banco. Note que isso inclui `401`: token do MP errado é emergência operacional, e
  `500` mantém o evento vivo na fila do MP enquanto alguém conserta.

**O push precisa de dados que a RPC não devolve.** Ela retorna só um texto. Depois de a RPC
devolver `'pago'` ou `'pago_apos_expirar'`, **leia o pedido** para montar o aviso:

```ts
const { data: pedido } = await supabase
  .from("marketplace_orders")
  .select("id, customer_name, total, total_amount")
  .eq("id", orderId)
  .maybeSingle();
```

`total` e `total_amount` coexistem nesta tabela e a `notify-new-order` lê as duas com fallback
(`index.ts:163`) — faça igual, não escolha uma. Se o `select` falhar ou vier vazio, **mande o
push mesmo assim**, com o que você tem: o pedido foi pago, e deixar o lojista sem aviso porque
a leitura cosmética falhou é pior que um aviso sem valor.

```ts
const aviso = resultado === "pago_apos_expirar"
  ? {
      title: "Pagamento fora do prazo",
      body: `${numeroDoPedido(orderId)} · ${formatarBRL(valor)} · estoque ja devolvido`,
      url: "/admin-orders",
    }
  : {
      title: "Pedido pago",
      body: `${numeroDoPedido(orderId)} · ${formatarBRL(valor)}`,
      url: "/admin-orders",
    };
```

`numeroDoPedido`, `formatarBRL` e `pareceUuid` **não são exportados de um lugar comum hoje** —
`numeroDoPedido` está em `notify-new-order/index.ts:73`, `pareceUuid` em `:66`, e `formatarBRL`
é local ali. Importar de `notify-new-order` acopla uma função à outra. **Copie as três para
este arquivo** e diga no relatório: extrair para `_shared` é refatoração que a sessão principal
decide, não você.

**Acrescente um teste para a validação do `external_reference`:** MP responde `approved` mas
com `external_reference` ausente — e outro caso com `"nao-e-uuid"` — e a função devolve `200`
com a RPC **não** chamada. Asserte o contador de chamadas da RPC em zero, não só o código HTTP.

- [ ] **Passo 4: rodar e verificar que passam**

```bash
deno test --allow-all --no-check supabase/functions/webhook-mercadopago/
```

- [ ] **Passo 5: acrescentar a entrada no `config.toml`**

```toml
# verify_jwt = false OBRIGATORIO: o Mercado Pago nao manda JWT. Quem autentica
# e' o x-signature validado em _shared/mercadopago.ts. Ligar o verify_jwt aqui
# faz o gateway recusar TODA confirmacao de pagamento, em silencio, e os
# pedidos pagos expiram como se ninguem tivesse pago.
[functions."webhook-mercadopago"]
verify_jwt = false
```

- [ ] **Passo 6: prova por mutação**

Remova a chamada a `validarAssinatura` (aceite qualquer requisição) — o teste 1 tem que
**reprovar**. Depois troque a condição do push para disparar em qualquer retorno — o teste 4
tem que **reprovar**. Desfaça as duas.

- [ ] **Passo 7: verificação e commit**

```bash
npm test
```

```bash
npm run typecheck
```

```bash
git add supabase/functions/webhook-mercadopago/ supabase/config.toml
```

```bash
git commit -m "feat(checkout): webhook do Mercado Pago confirma pagamento de PIX"
```

---

### Task 5: migration da reconciliação — candidatos, `pg_net` e cron

**Arquivos:**
- Criar: `supabase/migrations/20260808000100_reconciliacao.sql`
- Modificar: `scripts/db-prove-checkout-060.cjs` (acrescenta os casos de candidatos)

**Interfaces:**
- Consome: `paid_at` e a CHECK de `payment_status` (Task 2).
- Produz: `public.pagamentos_a_reconciliar()` devolvendo `TABLE(order_id uuid,
  gateway_payment_id text)`.

- [ ] **Passo 1: confirmar `pg_net` e Vault na documentação**

Use `mcp__context7__query-docs` para Supabase: `pg_net` com `pg_cron`, e como guardar segredo
no Vault (`vault.create_secret` / `vault.decrypted_secrets`) para o cron ler sem deixar a
credencial em texto na definição do job.

**Se o Vault não estiver disponível neste projeto, PARE e reporte.** Deixar o segredo em texto
na definição do job é decisão da sessão principal — não sua.

- [ ] **Passo 2: escrever a migration**

```sql
-- Fase 3: quem o webhook perdeu.
-- SEM BEGIN/COMMIT: o db-apply.cjs abre a transacao.

-- 1. So SELECIONA candidatos. Nao decide nada -------------------------
-- A decisao mora inteira na confirmar_pagamento. Se esta funcao decidisse,
-- existiriam DOIS codigos movendo estoque a partir de status de pagamento, e
-- eles divergiriam em tres meses — como a regra de frete gratis, que chegou a
-- estar escrita em sete lugares (#53).
CREATE OR REPLACE FUNCTION public.pagamentos_a_reconciliar()
RETURNS TABLE (order_id uuid, gateway_payment_id text)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $candidatos$
    SELECT id, gateway_payment_id
      FROM public.marketplace_orders
     WHERE payment_status = 'expirado'
       AND gateway_payment_id IS NOT NULL
       AND paid_at IS NULL
       -- 24 h: depois disso o PIX ja nao e' pagavel e a janela vira varredura
       -- do historico inteiro a cada 10 minutos.
       AND expires_at > now() - interval '24 hours'
     ORDER BY expires_at
     LIMIT 100;
$candidatos$;

REVOKE ALL ON FUNCTION public.pagamentos_a_reconciliar()
  FROM PUBLIC, anon, authenticated;

-- 2. pg_net + agendamento ---------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_net;
```

O agendamento vai no **mesmo arquivo**. Rascunho abaixo — **confirme cada nome contra o que o
Passo 1 devolveu antes de usar**, porque `vault.decrypted_secrets` e a assinatura de
`net.http_post` são exatamente o tipo de detalhe que não pode vir de memória:

```sql
-- O segredo NAO fica em texto aqui: sai do Vault na hora da chamada. E nao e'
-- a service_role — e' um RECONCILIACAO_SECRET dedicado, cujo pior caso ao
-- vazar e' alguem disparar uma reconciliacao, que so pergunta ao MP e chama a
-- confirmar_pagamento (idempotente).
SELECT cron.schedule(
    'reconciliar-pagamentos',
    '*/10 * * * *',
    $cron$
    SELECT net.http_post(
        url     := (SELECT decrypted_secret FROM vault.decrypted_secrets
                     WHERE name = 'reconciliacao_url'),
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-reconciliacao-secret',
            (SELECT decrypted_secret FROM vault.decrypted_secrets
              WHERE name = 'reconciliacao_secret')
        ),
        body    := '{}'::jsonb
    );
    $cron$
);
```

Os dois segredos (`reconciliacao_url` e `reconciliacao_secret`) **são criados fora desta
migration**, pela sessão principal, com `vault.create_secret`. O arquivo da migration não pode
conter nenhum dos dois valores — o `secretlint` barraria, e com razão.

Espelhe a forma do agendamento que a Fase 1 já criou: leia
`scripts/db-check-cron-expiracao.cjs` para ver como o job da expiração ficou registrado.

- [ ] **Passo 3: acrescentar os casos ao script de prova**

No `db-prove-checkout-060.cjs`, dentro da mesma transação com `ROLLBACK`:

| cenário | esperado |
| --- | --- |
| `expirado` + `gateway_payment_id` + `paid_at` nulo + expirou há 1 h | **aparece** |
| `expirado` + `gateway_payment_id` nulo | **não aparece** (nunca teve cobrança) |
| `expirado` + `paid_at` preenchido | **não aparece** (já reconciliado) |
| `expirado` há 30 h | **não aparece** (fora da janela) |
| `aguardando` no prazo | **não aparece** |

- [ ] **Passo 4: registrar no `VERIFICACOES` e provar SEM aplicar**

Acrescente a entrada da `pagamentos_a_reconciliar` ao mapa `VERIFICACOES` do
`scripts/db-apply.cjs`, na mesma forma que a Task 2 usou. Marcadores que valem — trechos cuja
remoção muda comportamento:

```js
  "20260808000100_reconciliacao.sql": [
    {
      funcao: "pagamentos_a_reconciliar",
      esperado: [
        // Sem isto a varredura revisita pedido ja reconciliado a cada ciclo.
        "AND paid_at IS NULL",
        // A janela. Sem ela vira varredura do historico inteiro a cada 10 min.
        "interval '24 hours'",
        // So quem chegou a ter cobranca no MP.
        "AND gateway_payment_id IS NOT NULL",
      ],
    },
  ],
```

**Você NÃO aplica esta migration.** Rode a prova contra o banco **sem** ela e confirme que os
casos novos **FALHAM** (`function pagamentos_a_reconciliar does not exist`):

```bash
node scripts/db-prove-checkout-060.cjs
```

Depois rode o ensaio, que não grava, e **cole a saída**:

```bash
node scripts/db-apply.cjs --dry-run 20260808000100_reconciliacao.sql
```

**Por que esta migration é mais perigosa que a da Task 2, e por isso a sessão principal aplica
depois da revisão:** a da Task 2 era aditiva e inerte (uma coluna nula e uma função que
ninguém chamava). Esta habilita a extensão **`pg_net`** e cria um **job no `pg_cron` que passa
a rodar a cada 10 minutos** em produção, fazendo requisição HTTP. Nem a extensão nem o
agendamento entram no arquivo de rollback que o `db-apply` gera — desfazer os dois é manual.

Deixe no relatório, explicitamente, o comando de desfazer que a sessão vai precisar se algo
der errado (`cron.unschedule('reconciliar-pagamentos')` e o `DROP FUNCTION`), para ninguém ter
de descobrir isso no meio de um incidente.

- [ ] **Passo 5: prova por mutação**

Remova o `AND paid_at IS NULL` e rode a prova: o caso "já reconciliado" tem que **reprovar**.
Desfaça.

- [ ] **Passo 6: commit**

```bash
git add supabase/migrations/20260808000100_reconciliacao.sql scripts/db-prove-checkout-060.cjs
```

```bash
git commit -m "feat(checkout): candidatos a reconciliacao e o agendamento no pg_cron"
```

---

### Task 6: `reconciliar-pagamentos`

**Arquivos:**
- Criar: `supabase/functions/reconciliar-pagamentos/index.ts`
- Criar: `supabase/functions/reconciliar-pagamentos/index_test.ts`
- Modificar: `supabase/config.toml`

**Interfaces:**
- Consome: `pagamentos_a_reconciliar()` (Task 5), `confirmar_pagamento` (Task 2),
  `consultarPagamento` e `mapearStatus` (`_shared/mercadopago.ts`).
- Produz: nada que outra tarefa consuma.

- [ ] **Passo 1: escrever os testes que falham**

1. **Sem o header `x-reconciliacao-secret` correto → 401**, e `pagamentos_a_reconciliar`
   **não é chamada**.
2. **Nenhum candidato → 200** com `{ ok: true, verificados: 0 }`.
3. **Candidato cujo MP diz `approved` → chama `confirmar_pagamento` com `'pago'`** e conta 1
   confirmado. (A RPC é quem decide virar `pago_apos_expirar`; esta função **não** decide.)
4. **Candidato cujo MP diz `cancelled` → chama a RPC com `'recusado'`.**
5. **Um candidato falha na consulta ao MP e os outros continuam** — a falha de um não aborta
   o lote.

- [ ] **Passo 2: rodar e verificar que falham**

```bash
deno test --allow-all --no-check supabase/functions/reconciliar-pagamentos/
```

- [ ] **Passo 3: implementar**

Mesma costura `handler(req, deps = {})` da Task 4. Regras:

- Compara o header com `Deno.env.get("RECONCILIACAO_SECRET")` **em tempo constante** — reuse a
  ideia da comparação de `validarAssinatura`. Segredo ausente no ambiente → `503`, nunca
  "passa direto".
- Para cada candidato: `consultarPagamento` → `mapearStatus` → se `null`, `console.warn` e
  segue para o próximo; senão `supabase.rpc("confirmar_pagamento", ...)`.
- **Cada candidato dentro do seu próprio `try`.** Um erro não pode abortar o lote — é
  exatamente o cenário do teste 5.
- Devolve `{ ok: true, verificados, confirmados, ignorados, falhas }`. Contagem verdadeira: responder
  sucesso sem verificar nada é como este projeto passou meses achando que o push funcionava
  (#80).
- **Não manda push.** Quem avisa é o webhook; se a reconciliação também avisasse, o lojista
  receberia dois avisos do mesmo pedido. O `pago_apos_expirar` encontrado aqui aparece na fila
  de atenção da Task 9.

- [ ] **Passo 4: rodar, verificar que passam, e mutar**

```bash
deno test --allow-all --no-check supabase/functions/reconciliar-pagamentos/
```

Depois remova a checagem do segredo — o teste 1 tem que **reprovar**. Desfaça.

- [ ] **Passo 5: entrada no `config.toml`**

```toml
# verify_jwt = false de proposito: quem chama e' o pg_cron via pg_net, e com
# verify_jwt = true a credencial teria de ser a service_role — que passaria a
# viver dentro do banco. Aqui a autenticacao e' o RECONCILIACAO_SECRET, cujo
# pior caso ao vazar e' alguem disparar uma reconciliacao idempotente.
[functions."reconciliar-pagamentos"]
verify_jwt = false
```

- [ ] **Passo 6: verificação e commit**

```bash
npm test
```

```bash
git add supabase/functions/reconciliar-pagamentos/ supabase/config.toml
```

```bash
git commit -m "feat(checkout): reconciliacao pega o pagamento que o webhook perdeu"
```

---

### Task 7: `criar-pagamento` — `notification_url` e recusa de cartão

**Arquivos:**
- Modificar: `supabase/functions/criar-pagamento/index.ts:156` e o trecho que monta o corpo
  (linhas 224–244)
- Modificar: `supabase/functions/_shared/mercadopago.ts` (`montarCorpoPix`)
- Modificar: os testes existentes da `criar-pagamento` e do `_shared`

**Interfaces:**
- Consome: `montarCorpoPix` (assinatura atual em `_shared/mercadopago.ts:58-83`).
- Produz: `montarCorpoPix` passa a aceitar `notificationUrl?: string`.

**Duas mudanças, uma razão comum:** as duas fecham porta que a Fase 2 deixou aberta e que só
morde quando a flag ligar.

- [ ] **Passo 1: escrever os testes que falham**

Em `_shared`: `montarCorpoPix` com `notificationUrl` **inclui** `notification_url` no corpo; e
**sem** o parâmetro, a chave **não existe** no objeto (não pode virar `undefined` serializado).

Na `criar-pagamento`: `body.metodo === "cartao"` devolve **400** com mensagem que diz que o
cartão está indisponível, **sem chamar o MP** (asserte que `fetchImpl` não foi chamado).

- [ ] **Passo 2: rodar e verificar que falham**

```bash
deno test --allow-all --no-check supabase/functions/
```

- [ ] **Passo 3: implementar**

Em `_shared/mercadopago.ts`, dentro de `montarCorpoPix`, depois do `external_reference`:

```ts
// Sem isto o webhook depende de configuracao no painel do MP — que ninguem
// percebe quando some, e nenhum teste pega. Herança nº 4 da Fase 2.
...(args.notificationUrl ? { notification_url: args.notificationUrl } : {}),
```

Em `criar-pagamento/index.ts:156`, trocar a validação de método:

```ts
  // Fase 3 entrega SO PIX. O cartao continua desligado no Brick (Task 8), mas
  // a recusa tem de ser aqui tambem: a tela e' do cliente, e o caminho de
  // cartao tem defeito conhecido — depois da primeira recusa o pedido fica
  // impagavel ate expirar (herança nº 2 da Fase 2). Cartao e' a Fase 3.5.
  if (body.metodo !== "pix") {
    return json({ error: "No momento aceitamos apenas PIX." }, 400);
  }
```

E o `notificationUrl` na chamada de `montarCorpoPix`:

```ts
        notificationUrl: `${Deno.env.get("SUPABASE_URL")}/functions/v1/webhook-mercadopago`,
```

O ramo `montarCorpoCartao` fica **inalcançável** a partir daqui. **Não apague
`montarCorpoCartao` nem seus testes** — é a Fase 3.5 que os usa. Diga no relatório que ele
ficou órfão de propósito, para o `knip` não ser "corrigido" por engano.

- [ ] **Passo 4: rodar, verificar, mutar**

```bash
deno test --allow-all --no-check supabase/functions/
```

Mutação: troque `body.metodo !== "pix"` de volta para a condição antiga — o teste do cartão
tem que **reprovar**.

- [ ] **Passo 5: commit**

```bash
git add supabase/functions/criar-pagamento/ supabase/functions/_shared/mercadopago.ts
```

```bash
git commit -m "feat(checkout): notification_url no corpo e recusa de cartao na Fase 3"
```

---

### Task 8: Brick só com PIX

**Arquivos:**
- Modificar: `src/components/checkout/PagamentoOnline.tsx:102-106`
- Modificar/criar: teste em `tests/front/`

**Interfaces:**
- Consome: nada.
- Produz: nada.

- [ ] **Passo 1: confirmar a configuração do Brick na documentação**

Use `mcp__context7__query-docs` para o Mercado Pago Bricks: como **desabilitar cartão** no
Payment Brick — se é omitir a chave `creditCard` do `customization.paymentMethods` ou passar
um valor explícito. Siga o que a documentação disser.

- [ ] **Passo 2: escrever o teste que falha**

O teste monta o componente com o SDK do MP stubado e asserte que o objeto passado a
`mp.bricks().create("payment", ...)` **não** habilita cartão. Leia os testes já existentes
deste componente em `tests/front/` antes — a Fase 2 deixou o stub do SDK pronto, e refazer
outro do zero é como o teste começa a divergir do componente.

- [ ] **Passo 3: rodar e verificar que falha**

```bash
npx vitest run tests/front
```

- [ ] **Passo 4: implementar**

Em `PagamentoOnline.tsx:104-106`:

```tsx
        customization: {
          // So PIX na Fase 3. O caminho de cartao existe no codigo mas tem
          // defeito conhecido: depois da primeira recusa o pedido fica
          // impagavel ate expirar, e a mensagem atual pede "tente outro
          // cartao", o que e' impossivel. Religar cartao e' a Fase 3.5, e
          // depende de chave de idempotencia versionada.
          paymentMethods: { bankTransfer: "all" },
        },
```

- [ ] **Passo 5: rodar, verificar, mutar**

```bash
npx vitest run tests/front
```

Mutação: devolva `creditCard: "all"` — o teste tem que **reprovar**.

- [ ] **Passo 6: commit**

```bash
git add src/components/checkout/PagamentoOnline.tsx tests/front
```

```bash
git commit -m "feat(checkout): Brick oferece so PIX na Fase 3"
```

---

### Task 9: fila de atenção no admin

**Arquivos:**
- Modificar: `src/views/admin/AdminOrdersView.tsx`
- Modificar: `src/components/admin/orders/OrderStatusBadge.tsx` (é onde o destaque visual de
  status já mora — **leia antes**, para o `payment_status` seguir a mesma convenção do
  `status` em vez de inventar uma segunda)
- Modificar/criar: teste em `tests/front/`

**Interfaces:**
- Consome: a coluna `payment_status` (Fase 1) e `paid_at` (Task 2).
- Produz: nada.

**O mínimo que a decisão de `pago_apos_expirar` exige, e nada além.** Painel completo de
pagamento é a Fase 4 (#110). Se esta tarefa crescer para além de filtro e destaque, ela saiu
do escopo — pare e reporte.

- [ ] **Passo 1: ler a tela antes de tocar nela**

Leia `src/views/admin/AdminOrdersView.tsx` e `src/components/admin/orders/OrderStatusBadge.tsx`
inteiros. Use `mcp__serena__find_referencing_symbols` no badge para ver quem mais o consome
antes de mudar a assinatura dele. **Não** faça `grep` cego: este repositório tem arquivos
grandes (o `CheckoutView.tsx` tem 1.110 linhas) e mudança cega neles é como se cria duplicata
— foi assim que a regra de frete grátis acabou em sete lugares (#53).

- [ ] **Passo 2: escrever o teste que falha**

Com uma lista de pedidos em memória cobrindo `aguardando`, `pago`, `pago_apos_expirar`,
`estornado` e `payment_status` **nulo** (os 64 pedidos históricos têm `NULL` — a tela não pode
quebrar com eles), asserte:

1. o filtro por `payment_status` restringe a lista;
2. `pago_apos_expirar` e `estornado` recebem destaque visual distinto dos demais;
3. pedido com `payment_status` nulo continua aparecendo e não quebra a renderização.

- [ ] **Passo 3: rodar e verificar que falha**

```bash
npx vitest run tests/front
```

- [ ] **Passo 4: implementar**

Siga o padrão de filtro que a tela já usa para `status`. Não introduza biblioteca nova. Os
rótulos em português, na convenção do resto do admin:

| valor | rótulo |
| --- | --- |
| `aguardando` | Aguardando pagamento |
| `pago` | Pago |
| `recusado` | Recusado |
| `expirado` | Expirado |
| `estornado` | Estornado — precisa de atenção |
| `pago_apos_expirar` | Pago fora do prazo — precisa de atenção |
| `NULL` | Sem cobrança online |

- [ ] **Passo 5: rodar, verificar, e ver na tela**

```bash
npx vitest run tests/front
```

Suba o preview com `mcp__Claude_Browser__preview_start` e `{name: "core_app_mkt"}` e confira o
filtro. **Não crie pedido nem cadastro pela tela** — o dev local escreve no Supabase de
produção. Só olhe a lista que já existe.

- [ ] **Passo 6: commit**

```bash
git add src tests/front
```

```bash
git commit -m "feat(admin): filtro por status de pagamento e fila de atencao"
```

---

## Fecho da fase — o que a sessão principal faz

Depois das nove tarefas revisadas e integradas:

1. Rodar os sete comandos do CI e **colar a saída**.
2. Abrir o PR para a `develop`.
3. **Portão do Gabriel:** `vercel env ls` provando que o Preview **não** aponta para o
   Supabase de produção. Se apontar, **parar aqui** — o PIX de teste reservaria estoque real,
   revertido só pelo `pg_cron` 35 min depois.
4. **Portão do Gabriel:** Task 0 do Mercado Pago — escopo de PIX na conta, aceitar que o
   dinheiro cai no saldo do MP, gerar credenciais de **TESTE**.
5. Deploy das functions com o `config.toml` conferido contra o painel, e os segredos
   (`MP_WEBHOOK_SECRET`, `RECONCILIACAO_SECRET`) no ambiente das functions.
6. Ligar `VITE_PAGAMENTO_ONLINE=true` **só no Preview**.
7. Um PIX de teste percorrendo `pagamento → webhook → pago → push`.

**A loja em produção continua sem cobrar quando esta fase fechar.** Ligar lá é decisão
separada do Gabriel.

---

## O que este plano NÃO entrega

- **Cartão** — desligado no Brick e recusado na `criar-pagamento`. Fase 3.5, e ela precisa de
  chave de idempotência versionada (`orderId:1`, `orderId:2`) e tela de sucesso.
- **Teste de concorrência real** entre a varredura e o webhook. Exige duas sessões de banco
  simultâneas. O script prova o **resultado** (pedido `expirado` recebendo confirmação vira
  `pago_apos_expirar`), não o entrelaçamento das travas. **A garantia ali vem do `FOR UPDATE`
  e da releitura — quem revisar precisa olhar o código com esse olho.**
- **`in_mediation` mapeado explicitamente** — cai no ramo de desconhecido (`200` + log +
  fila), que é seguro. Fase 3.5.
- **Painel completo de pagamento** (#110), **e-mail de confirmação** (#106), **status em
  `notificacoes`** (#107).
- **Cupom devolvido em pedido expirado** — #116 (CUPOM-030), já no board.
