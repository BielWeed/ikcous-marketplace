# Fase 3 — o webhook fecha o laço

**Data:** 07/08/2026 · **Issues:** `CHECKOUT-010` #109, `CHECKOUT-040` #110,
`CHECKOUT-050` #111 (as mesmas da Fase 2 — o laço só fecha aqui) · **Desbloqueia:** #162
**Antecede:** `2026-08-06-gateway-mercadopago-design.md` (desenho do gateway inteiro)
**Herda de:** `plans/2026-08-06-fase-2-criar-pagamento-e-brick.md`, seção "O que a Fase 3 herda"

Esta spec **não** substitui o desenho de 06/08. Ela decide o que aquele documento
deixou em aberto e corrige um ponto dele que não fecha (ver *Reconciliação*).

---

## Onde estamos

**Fase 1, em produção desde 06/08/2026.** Colunas `payment_status`, `expires_at` e
`gateway_payment_id`; `devolver_estoque(order_id)`; `expirar_pedidos_vencidos()`;
`pg_cron` a cada 5 min.

**Fase 2, na `develop` pelo PR #178 (`b81932a`).** A `criar-pagamento` cria a cobrança
no Mercado Pago e o Brick renderiza. Tudo atrás de `VITE_PAGAMENTO_ONLINE`, que **falha
fechada** — só a string exata `"true"` liga. A flag está desligada nos três ambientes.

**Nenhum pedido vira `pago` hoje.** É isso que esta fase entrega.

**O que já está armado esperando por ela:** `gateway_payment_id` com índice UNIQUE
parcial, `external_reference = orderId` em todos os corpos, `mapearStatus` no `_shared`
sem consumidor, `pago_apos_expirar` reservado na CHECK, e o comentário da
`expirar_pedidos_vencidos` descrevendo a corrida exata que o webhook vai enfrentar.

---

## Escopo: só PIX

A fase entrega **PIX funcionando de ponta a ponta**. O cartão continua desligado.

**Por quê:** 63 dos 64 pedidos deste projeto são PIX, e três das sete heranças da Fase 2
são exclusivamente de cartão — a recusa que deixa o pedido impagável até expirar, a
ausência de tela de sucesso para aprovado não-PIX, e a contestação (`in_mediation`).
Nenhuma delas existe no PIX: ou o dinheiro cai, ou o pedido expira.

Cartão vira **Fase 3.5**, com o webhook já rodando e observado em produção. É trabalho
menor com a confirmação funcionando do que junto dela.

**Consequência que não pode ser esquecida:** o Brick da Fase 2 já sabe renderizar
cartão. Ligar a flag sem fechar essa porta expõe o caminho quebrado. Esta fase
**restringe o Brick a PIX** e faz a `criar-pagamento` **recusar meio de pagamento que
não seja PIX** — a recusa no servidor, não só na tela, porque a tela é do cliente.

---

## O caminho da confirmação

**O webhook não escreve no pedido. Ele chama uma RPC que decide sob trava.**

```
MP → POST /webhook-mercadopago   (verify_jwt = false)
  1. valida x-signature (HMAC-SHA256 do ts + id)   → 401 se não bater
  2. lê SÓ o data.id do corpo                       → ignora o resto
  3. GET /v1/payments/{id} no MP                    → status real + external_reference
  4. mapearStatus(...)                              → pago | recusado | estornado
                                                      | aguardando | null
  5. RPC confirmar_pagamento(order_id, payment_id, status)
  6. o RETORNO da RPC decide se manda push
```

### Por que RPC e não `UPDATE`

O comentário da `expirar_pedidos_vencidos` (migration `20260807000000`, linhas 87–95)
mede a corrida: se a varredura pegar a trava primeiro, um `UPDATE` do webhook **espera,
reavalia o `WHERE` por id — que continua valendo — e sobrescreve**. Sai pedido `pago`
com `status = 'cancelled'` e estoque já devolvido.

A RPC pega a linha com `SELECT ... FOR UPDATE` (espera a varredura, **não** `SKIP
LOCKED`) e **relê o estado antes de decidir**:

| estado encontrado | ação | retorno |
| --- | --- | --- |
| `aguardando`, no prazo | `pago`, grava `paid_at` | `pago` |
| `expirado` — a varredura ganhou | `pago_apos_expirar`, grava `paid_at`, **não toca estoque nem `status`** | `pago_apos_expirar` |
| já `pago` | nada | `ja_pago` |
| `aguardando` + MP diz recusado | `devolver_estoque` + `recusado` + `cancelled` | `recusado` |
| qualquer + MP diz estornado | marca `estornado`, **nunca toca estoque** | `estornado` |
| `gateway_payment_id` ≠ `p_payment_id` | **não escreve** | `divergente` |

### Três consequências do desenho

**O push é idempotente de graça.** Só sai quando o retorno é `pago` ou
`pago_apos_expirar` — quando a transição de fato aconteceu. O reenvio do MP encontra
`ja_pago` e devolve `200` calado. Não há segundo mecanismo anti-duplicata para manter.

**`devolver_estoque` só é chamada de dentro da trava**, e só na transição a partir de
`aguardando`. Ela não é idempotente — o próprio `COMMENT` dela avisa — e a trava é o que
garante chamada única.

**O código HTTP é decisão de retentativa, não de sucesso.** `500` só para falha
transitória (MP fora do ar, erro de banco), que é quando reenviar ajuda. Status
desconhecido volta `200` com log alto: reenviar não muda um status que não vai mudar
sozinho, e a reconciliação revisita.

---

## PIX pago depois de expirar

O cliente lê o QR no minuto 29:50; o `pg_cron` roda em 30:00 e devolve o estoque. O
dinheiro entrou e a mercadoria já voltou para a prateleira — possivelmente vendida a
outro.

**Decisão do Gabriel em 07/08/2026: marca e chama uma pessoa.** `payment_status =
'pago_apos_expirar'`, push imediato ao lojista, e o pedido entra na fila de atenção do
admin. **Nada automático mexe em estoque ou em dinheiro.** Ele decide caso a caso: se
ainda tem a mercadoria, reativa; se não tem, estorna pelo painel do MP.

As duas alternativas descartadas, e por quê: re-reservar sozinho escreve no estoque a
partir de uma chamada externa e, falhando no meio, deixa o pedido num estado que
ninguém projetou; estornar automático é código que move dinheiro sozinho na primeira
versão do webhook, e joga fora venda que talvez desse para atender.

---

## Quem avisa o lojista

**O webhook manda o push direto**, via `enviarParaInscritos` do `_shared/webpush.ts`,
com texto de **"pedido pago"**. A `notify-new-order` **não é chamada e não muda**.

**Por quê.** A `notify-new-order` roda sem `verify_jwt`, e sua janela de 15 minutos
existe para limitar replay de quem tiver um id de pedido vazado (`index.ts:34-36`). O
webhook não precisa passar por essa porta: ele já validou `x-signature` e já consultou o
MP. Mandar direto resolve a herança nº 1 da Fase 2 — pedido pago no minuto 18 seria
descartado em silêncio — **sem enfraquecer a trava para todo mundo**.

De quebra, o texto passa a distinguir venda de lixo em formação. "Novo pedido" virou
sinônimo de lixo neste projeto; "pedido pago" é a informação que o lojista quer.

---

## Reconciliação — e a correção da spec anterior

A spec de 06/08 chamava a reconciliação de `reconciliar_pagamentos()`, função de banco.
**Isso não fecha: plpgsql não fala com a API do Mercado Pago.**

O desenho corrigido separa selecionar de decidir:

- **`pagamentos_a_reconciliar()`** — função SQL. Só seleciona candidatos:
  `payment_status = 'expirado'`, com `gateway_payment_id`, `paid_at` nulo, expirados nas
  últimas 24 h. **Não decide nada.**
- **`reconciliar-pagamentos`** — edge function. Pega cada candidato, pergunta ao MP via
  `consultarPagamento`, e chama **a mesma `confirmar_pagamento`**.

**O ponto que faz isso valer:** a reconciliação não é uma segunda implementação. É o
mesmo gatilho de decisão com outra origem. Se ela decidisse por conta própria,
existiriam dois códigos movendo estoque a partir de status de pagamento — e eles
divergiriam em três meses.

**Gatilho: `pg_cron` + `pg_net`.** Mesma máquina que já roda a expiração, mesmo lugar
para olhar quando algo não rodou. Custo aceito: habilitar `pg_net` em produção, o que
entra na migration com ensaio de `ROLLBACK` como o resto. A alternativa — GitHub Actions
com cron — exigiria a `service_role` como secret do CI, e este repositório já teve
`service_role` no histórico; aumentar a superfície da credencial que a #126 está
tentando aposentar seria andar para trás.

---

## Modelo de dados

**Coluna nova:** `paid_at timestamptz`. É o carimbo que a fila de atenção e a
reconciliação leem. Sem ele, "quando o dinheiro entrou" só existe no MP.

**Funções novas** (migration sem `BEGIN`/`COMMIT` — o `db-apply.cjs` abre a transação):

| função | papel |
| --- | --- |
| `confirmar_pagamento(uuid, text, text) → text` | a decisão sob trava; `SECURITY DEFINER`, `search_path` fixo, `REVOKE` de `PUBLIC`, `anon`, `authenticated` |
| `pagamentos_a_reconciliar() → setof` | só seleciona candidatos |

Nenhuma coluna de `payment_status` nova: a CHECK da Fase 1 já reserva os seis valores,
`pago_apos_expirar` incluído.

---

## Componentes

**Edge functions**

| arquivo | `verify_jwt` | papel |
| --- | --- | --- |
| `webhook-mercadopago/index.ts` | **`false`** | recebe a confirmação; o MP não manda JWT |
| `reconciliar-pagamentos/index.ts` | **`false`** | varre candidatos; chamada pelo `pg_cron` via `pg_net` |

**Correção feita em 07/08 ao escrever o plano.** Esta linha dizia `true`. Não fecha: o
`pg_net` precisa de credencial para chamar a função, e com `verify_jwt = true` essa
credencial seria a `service_role` — passando a viver dentro do banco, o que mina metade
do motivo de ter escolhido `pg_cron` em vez de GitHub Actions. A função roda com
`verify_jwt = false` e valida um **`RECONCILIACAO_SECRET` próprio**, guardado no Vault.
Se ele vazar, o pior caso é alguém disparar uma reconciliação — que é idempotente e só
pergunta ao MP.

**`_shared/mercadopago.ts`** ganha uma função, e só uma:
`validarAssinatura({ xSignature, xRequestId, dataId, segredo })` — **pura**, HMAC-SHA256
no formato do MP. Pura porque é o que permite testá-la com vetores conhecidos, sem
servidor. `consultarPagamento` e `mapearStatus` já existem e não mudam — esta fase é o
primeiro consumidor de `mapearStatus`.

**Segredo novo:** `MP_WEBHOOK_SECRET`, só no ambiente das functions. **Nunca no `.env` do
front**, que vai para o bundle.

**`notification_url`** passa a ir no corpo do pagamento, derivada do `SUPABASE_URL`.
Resolve a herança nº 4: sem isso o webhook depende de configuração no painel do MP —
que ninguém percebe quando some, e nenhum teste pega.

**Admin:** o mínimo que a decisão de `pago_apos_expirar` exige. Filtro por
`payment_status` na tela de pedidos que já existe, com destaque para
`pago_apos_expirar` e `estornado`. Painel completo de pagamento continua sendo a Fase 4
(#110).

**Front:** nada. A tela de "aguardando pagamento" da Fase 2 já faz polling; quando o
webhook marcar `pago`, ela reflete sozinha.

---

## `supabase/config.toml` — a primeira tarefa, e a armadilha

Hoje **só `send-otp-email` e `notify-new-order` rodam sem JWT**, e isso vive na cabeça de
quem digita o deploy (`DEPLOYMENT.md:52` e `:57`), não no repositório. É a #162.

**Correção medida em 07/08/2026, ao executar a Task 1.** Esta seção afirmava que função
fora do arquivo herda `verify_jwt = true` no próximo deploy. **Está errado.** A precedência
real do CLI é `--no-verify-jwt` (flag) > `verify_jwt` no `config.toml` > **preserva o que
já está no servidor** — três fontes do código do CLI concordam, com comentário explícito do
mantenedor. Logo: omitir uma função não a derruba, e **este arquivo não protege contra a
flag**, que continua ganhando de tudo.

O que se ganha, então, é menor do que esta spec prometia, mas é real: a configuração passa
a ser revisável em PR, e um deploy sem flag aplica o que está escrito no arquivo em vez de
depender do que sobrou no servidor de um deploy anterior. O risco de fato aberto continua
sendo **a flag digitada à mão** — e fechá-lo é outra conversa, não esta.

**Regra:** o arquivo enumera as **oito** funções (`calculate-shipping`,
`criar-pagamento`, `notify-new-order`, `reconciliar-pagamentos`, `send-order-whatsapp`,
`send-otp-email`, `send-push`, `webhook-mercadopago`), cada uma com o `verify_jwt` que
tem hoje em produção, **conferido contra o painel antes de o arquivo existir**.
`send-otp-email`, `notify-new-order`, `webhook-mercadopago` e `reconciliar-pagamentos`
em `false`; as demais em `true`. Nenhuma omissão.

O comportamento exato do CLI aqui **se confirma na documentação na hora de implementar**,
não de memória. É o tipo de detalhe que já custou caro.

---

## Modos de falha

| falha | resposta |
| --- | --- |
| assinatura inválida | `401`, sem tocar o banco |
| MP fora do ar na consulta | `500` — é quando reenviar ajuda |
| webhook nunca chega | reconciliação pega em até 24 h |
| status que `mapearStatus` não conhece | `200`, log alto, reconciliação revisita |
| `gateway_payment_id` não bate | `200`, log alto, fila de atenção — não escreve |
| varredura e webhook no mesmo pedido | a trava; sai `pago_apos_expirar` |
| webhook chega duas vezes | segunda encontra `ja_pago`, `200` sem efeito |

**`in_mediation` nesta fase:** não entra em `mapearStatus`. Cai no ramo de status
desconhecido — `200`, log alto, fila de atenção — que é comportamento seguro: não move
estoque nem dinheiro. O mapeamento explícito é Fase 3.5, junto com o cartão, que é onde
contestação de fato acontece.

---

## Como se prova

**Três camadas:**

1. **`validarAssinatura`** — vetores conhecidos, **incluindo os negativos**: segredo
   errado, `ts` remontado, corpo adulterado com assinatura antiga. É a única
   autenticação que a função tem; passar só nos casos felizes não prova nada.
2. **Webhook contra servidor HTTP local**, no padrão que a `send-push` já usa. MP falso
   devolvendo `approved`, `rejected`, `pending`, status desconhecido e timeout —
   verificando o **código HTTP** de cada um, porque aqui o código é a decisão de
   retentativa.
3. **`confirmar_pagamento` por script de prova com `ROLLBACK`**, cobrindo as seis linhas
   da tabela de decisão.

**O que os testes NÃO provam, dito agora e não depois:** a corrida real entre a varredura
e o webhook exige duas sessões de banco simultâneas. O script prova o *resultado* — um
pedido já `expirado` recebendo confirmação vira `pago_apos_expirar` — mas não o
entrelaçamento das travas. A garantia ali vem do `FOR UPDATE` e da releitura, não de um
teste. **Quem revisar precisa olhar o código com esse olho.**

E os sete comandos do CI, com a saída colada antes de qualquer commit.

---

## Onde a fase para

**Decisão do Gabriel: código pronto, flag ligada só no Preview.** A loja em produção
continua sem cobrar quando a fase fechar. Ligar lá é decisão separada, com o caminho já
observado funcionando.

**Dois portões que são do Gabriel, e vêm antes do código ser ligado:**

1. **`vercel env ls`.** Se o Preview apontar para o Supabase de produção — comportamento
   já conhecido deste projeto —, o PIX de teste **reserva estoque real** e só volta pelo
   `pg_cron` 35 minutos depois. Este portão vem primeiro.
2. **Task 0, nunca feita.** Confirmar escopo de PIX na conta do MP via API, aceitar que
   o dinheiro passa a cair no saldo do MP (não direto no banco), e gerar as credenciais
   de **TESTE**. Sem elas, nada da Fase 2 foi exercitado contra um Mercado Pago real.

**Ordem depois dos portões:** `config.toml` conferido contra o painel → migration →
webhook → reconciliação → Brick restrito a PIX → flag ligada só no Preview → um PIX de
teste percorrendo `pagamento → webhook → pago → push`.

---

## O que esta fase NÃO entrega

- **Cartão.** Desligado no Brick e recusado na `criar-pagamento`. É a Fase 3.5.
- **A loja em produção cobrando.** A flag fica desligada lá.
- **Painel com status de pagamento.** É a Fase 4 (#110). Aqui só o filtro mínimo.
- **E-mail de confirmação** (#106) e **status em `notificacoes`** (#107).
- **Cupom devolvido em pedido expirado.** É a #116 (CUPOM-030), já no board. A
  `expirar_pedidos_vencidos` devolve estoque e não decrementa `usage_count`; o mecanismo
  é anterior a esta fase.

---

## As sete heranças da Fase 2, e onde cada uma cai

| # | herança | destino |
| --- | --- | --- |
| 1 | `notify-new-order` descarta pedido com mais de 15 min | **resolvida:** webhook manda o push direto |
| 2 | pedido impagável após recusa de cartão | Fase 3.5 — cartão desligado aqui |
| 3 | cartão aprovado sem tela de sucesso | Fase 3.5 |
| 4 | `notification_url` fora do corpo | **resolvida:** vai no corpo, derivada do `SUPABASE_URL` |
| 5 | `in_mediation` vira `null` em silêncio | ramo de desconhecido + fila de atenção; mapeamento explícito na 3.5 |
| 6 | não existe `supabase/config.toml` (#162) | **primeira tarefa desta fase** |
| 7 | cupom queimado por pedido abandonado (#116) | fora de escopo, segue no board |
