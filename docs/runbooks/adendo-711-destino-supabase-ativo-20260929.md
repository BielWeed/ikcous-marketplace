# Adendo A — Destino Supabase ativo e publicação segura da release #711

> Arquivo de adendo (29/09/2026, ordem do dono): evidência nova em arquivo
> próprio, sem editar seções congeladas do runbook. Companheiro do §6.1 de
> `release-correcoes-pagamentos-2026-09.md`.

## 1. Destino ativo — o que está PROVADO (somente leitura)

| Fato | Prova |
|---|---|
| Front de produção fala com o projeto NOVO | Bundle público de `brandmeliz.vercel.app` contém `dekxabvqdsuukijblazl.supabase.co` |
| Projeto ANTIGO morto | `supabase projects list`: `cafkrminfnokvgjqtkle` = `INACTIVE` (pausado por fatura, 28/09) |
| Token da conta antiga NÃO publica no novo | ~~`functions list` → **403**~~ **SUPERADO (29/09)**: PAT escopado novo no secret `SUPABASE_ACCESS_TOKEN`; workflow "Prova de acesso" (PR #715, merged) rodou **SUCCESS** — GET projeto **200** (`ACTIVE_HEALTHY`) e GET functions **200** (11 functions `ACTIVE`). Acesso de LEITURA provado; publicar ainda é outra coisa (cofre/webhook/cron abaixo) |
| As 3 functions financeiras EXISTEM no novo | Lista real do run da prova: `criar-pagamento`, `reconciliar-pagamentos`, `webhook-mercadopago`, `estornar-pagamento` etc. — 11 `ACTIVE`, implantadas em massa em **28/09 ~06:00Z** (timestamps sequenciais do deploy roteirizado da migração; `send-order-whatsapp` ficou de fora) |
| Segredos/configuração delas = PENDENTES/DESCONHECIDOS | Runbook da migração (PR #671, `migrar-banco-da-loja.md`, §"E agora?"): partes **f** (functions + segredos, incl. RECOLETAR cofre MP do lojista), **h** (Auth/SMTP), **i** (webhook MP), **j** (segredos Actions) listadas como faltantes |

**Conclusão**: o destino ativo é `dekxabvqdsuukijblazl`, mas o pipeline de
publicação (token, cofre, webhook, cron) ainda não está comprovado lá. Publicar
as 10 correções hoje seria publicar sobre configuração não verificada.

## 2. Questão aberta: qual GERAÇÃO de código roda nas functions do projeto novo

As sondas públicas não distinguem (ambas as gerações respondem igual nos gates
de auth). Dois cenários possíveis:

- **Cenário A — functions da geração NOVA (linha claude/PR #666)**: a release
  #711 é upgrade compatível (mesma geração; só corrija e publique).
- **Cenário B — functions da geração ANTIGA (linha develop)**: o sistema vivo é
  consistente (front antigo + functions antigas) e a #711 pertence à linha do
  major upgrade ainda não promovida — publicar as functions novas SOZINHAS
  misturaria gerações (front antigo chamando edge nova com contratos novos,
  ex.: coluna `tentativas_de_pagamento` e `config_pagamento_cartao` exigidas
  pelas migrations 20261175-80 do PR #666).

**Como distinguir NO MOMENTO da publicação (com o token j no lugar), sem
achismo**:
1. `supabase functions list --project-ref dekxabvqdsuukijblazl` — timestamps de
   deploy: comparar com as datas dos runs de `publicar-functions` e dos merges
   (PR #666 em 26/09; migração de banco em 28/09).
2. Pedido de teste do checklist (§4 do runbook): a resposta da `criar-pagamento`
   da geração nova carrega `statusPagamento`/`paymentId` no formato Orders API
   (`ORD…`); a antiga, formato Payments (`pay…`/QR clássico).
3. **Objetos REAIS do schema, não o ledger**: o `aplicar-migrations.yml`
   NÃO grava `supabase_migrations.schema_migrations` (AGENTS.md) — presença
   de `20261175`–`20261180` no ledger é só **indício** (aplicação parcial
   não prova linha completa; ausência não prova schema antigo). A decisão
   A/B é por objetos concretos: `information_schema.tables` para
   `devolucoes` e `config_pagamento_cartao` (só existem no PR #666), RPCs
   `fin_*`/devolução em `information_schema.routines`, colunas novas em
   `marketplace_orders` (`tentativas_de_pagamento`, `metodo_online`,
   `estorno_manual_registrado_em`). O workflow "Diagnóstico de pagamentos"
   (PR #716, somente leitura) já consulta exatamente esses objetos.

**Regra de segurança enquanto não distinguido**: tratar como **Cenário B** (o
mais conservador) — a publicação da #711 acompanha a promoção da linha claude
(decisão de release maior do dono), não vai sozinha para a loja viva.

## 3. Sequência de publicação segura (ordem final, sem etapas implícitas)

1. **(j)** `SUPABASE_ACCESS_TOKEN` da org nova no GitHub + `DATABASE_URL` novo.
2. Distinguir geração (§2) e CONFIRMAR migrations 20261175-80 aplicadas no
   banco novo (senão: `aplicar-migrations.yml` arquivo por arquivo, com os runs
   separados — regra do repo).
3. **(f)** Lojista recadastra credenciais MP (token + chave de assinatura) em
   Ajustes contra o app do projeto novo; segredos `MP_*`/`RECONCILIACAO_SECRET`/
   `MP_CHAVES_ENCRYPTION_KEY` presentes.
4. **(i)** Webhook do MP apontando para `dekxabvqdsuukijblazl` com a chave da
   loja; notificação de teste chega e valida assinatura (log da function).
5. Reconciliador provado (pg_cron + job + logs + secret) — sem isso, PIX fica
   desligado (§5 do runbook).
6. `publicar-functions.yml` (projeto=loja) com as 5 de cobrança da release →
   checklist por loja (§4) → front → monitoração 24 h → rollback por function
   se qualquer confirmação real falhar (§6).
