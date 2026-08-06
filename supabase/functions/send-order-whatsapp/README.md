# `send-order-whatsapp` — publicada, morta, e agora versionada

**Não edite o `index.ts` desta pasta.** Ele é uma cópia **byte a byte** do que
está publicado em produção, e o valor dele está exatamente nisso: rodar
`supabase functions download send-order-whatsapp` e comparar prova se algo
mudou no ar sem passar por aqui. Um cabeçalho de comentário quebraria essa
propriedade — por isso a explicação está neste README e não no fonte.

Baixada em **06/08/2026** (`INFRA-330`, #167), da versão **v8** publicada em
20/04/2026 no projeto `cafkrminfnokvgjqtkle`.

## Ela avisa o CLIENTE, não o lojista

```js
const customerWhatsapp = record.customer_data?.whatsapp
...
`Olá *${customerName}*, recebemos seu pedido *#${orderId.slice(-6)}* com sucesso!`
```

Isso importa porque circulava a leitura de que ela barateava a `PEDIDO-020` (#89,
"avisar o lojista quando entra pedido novo"). **Não barateava** — avisaria o
comprador, o oposto do que aquela issue pede. O aviso ao lojista virou a
`notify-new-order`, escrita do zero.

Pelo conteúdo, ela seria candidata à `PEDIDO-070` (#106, confirmação de pedido
para o cliente), só que por WhatsApp em vez de e-mail.

## Ela está morta, e não por acidente

Ela consulta `store_config.whatsapp_api_url`, `whatsapp_api_key` e
`whatsapp_api_instance`. **As três colunas não existem.** O `configError` sobe,
cai no catch, e a função devolve **500 em toda invocação**.

O motivo está no repositório, e a reconciliação do ledger (#42/#112) o encontrou:
`supabase/migrations/20260601000001_remove_whatsapp_infrastructure.sql` **está
aplicada**, e faz exatamente isto:

```sql
DROP TRIGGER IF EXISTS on_order_created_whatsapp ON public.marketplace_orders;
DROP FUNCTION IF EXISTS public.handle_new_order_whatsapp();
ALTER TABLE public.store_config DROP COLUMN IF EXISTS whatsapp_api_url;
ALTER TABLE public.store_config DROP COLUMN IF EXISTS whatsapp_api_key;
ALTER TABLE public.store_config DROP COLUMN IF EXISTS whatsapp_api_instance;
```

A integração de WhatsApp foi **desativada de propósito em 01/06/2026**: trigger,
função de trigger e as três colunas de configuração. A edge function foi a única
peça que ninguém despublicou.

Isso também corrige a auditoria de 29/07, que registrou que o trigger
`on_order_created_whatsapp` "nunca chegou a produção". Chegou — e foi removido.
Mesmo observável, história oposta.

## Por que ela foi versionada se está morta

Porque era a **única** das cinco edge functions publicadas sem fonte no
repositório, e `supabase functions deploy` **sem nome de função publica todas as
do diretório**. Enquanto ela não estivesse aqui, um deploy em massa a partir de
outra cópia do projeto podia substituí-la por qualquer coisa, sem que ninguém
conseguisse reconstruir o original.

Agora dá.

## O que falta decidir

Despublicar ou não. A evidência aponta para **sim**: reconstruí-la exigiria
recriar três colunas que uma migration aplicada removeu de propósito.

**O que não está escrito em lugar nenhum é o PORQUÊ da desativação.** A migration
não tem comentário. Se houve motivo de negócio — custo da Evolution API, número
banido, mudança de canal — ele não sobreviveu. Isso é argumento para não apagar o
código sem antes perguntar a quem estava lá.
