# `send-order-whatsapp` — despublicada, morta, e versionada

**Não edite o `index.ts` desta pasta.** O valor dele está em registrar o que
esteve publicado em produção — não em ser byte a byte idêntico ao que o CLI
devolve. Um cabeçalho de comentário quebraria a comparação normalizada que
prova essa equivalência (nenhuma das etapas descritas abaixo remove
comentário) — por isso a explicação está neste README e não no fonte.

Baixada em **06/08/2026** (`INFRA-330`, #167), da versão **v8** documentada,
publicada em 20/04/2026 no projeto `cafkrminfnokvgjqtkle` — mas medida em
11/08/2026, antes da remoção, a função já estava em **v14**. Isso **não** foi
deploy. Contra a tabela que a #167 mediu em 05/08/2026, as quatro functions
publicadas naquela data subiram **exatamente +6 versões juntas** —
`send-push` 12→18, `send-otp-email` 9→15, `calculate-shipping` 11→17 e a
própria `send-order-whatsapp` 8→14. É rebuild de plataforma do Supabase.

**O sinal que presta é o `UPDATED_AT`, não o `VERSION`** — e o próprio
intervalo mostra por quê. O `UPDATED_AT` da `send-order-whatsapp` nunca mudou:
`2026-04-20 20:14` na tabela antiga do `DEPLOYMENT.md` e o mesmo valor na
medição de 11/08. Já o da `send-otp-email` mudou no meio do caminho
(`2026-08-05 12:31` naquela tabela, `2026-08-05 20:24:02` depois) — e é por
isso que ela aparece em v8 numa medição de 05/08 e em v9 em outra do mesmo
dia: teve deploy de verdade entre as duas. O número de versão sozinho não
distingue rebuild de deploy; o `UPDATED_AT` distingue.

## O `index.ts` é o fonte; o download é a saída transpilada

Em 06/08 este arquivo afirmava que o `index.ts` era cópia **byte a byte** do
publicado. Era verdade naquele dia, e **não é mais literalmente verdade**: o
`supabase functions download` passou a devolver o **bundle transpilado**, não
o fonte. Comparado em 11/08/2026, o diff acusava 73 inserções e 78 remoções
ignorando espaço em branco — **medidas entre o `index.ts` cru e o download
cru**, antes de qualquer `deno fmt`. O download cru não foi guardado, então
esse par específico não é mais reproduzível; refeita entre os dois lados já
formatados, a mesma comparação dá **57/48**. Em qualquer das medições, as
diferenças são todas de transpilação: ponto e vírgula inserido,
`(req: Request)` virando `(req)` e `catch (error: any)` virando
`catch (error)` (anotação de tipo apagada), literais de objeto quebrados em
várias linhas, vírgula terminal.

A equivalência foi provada assim: primeiro, os dois lados passaram por
`deno fmt`. Sozinho ele **não basta** — preserva a escolha de quebra de linha
de cada lado e não reconcilia anotação de tipo — mas é ele que normaliza o
`;` que a transpilação insere: o `index.ts` cru, como está no repositório,
tem **1** ponto e vírgula; depois do `deno fmt`, os dois lados passam a ter
**36**, e é essa igualdade que faz o `cmp` fechar mais adiante. Só depois de
formatados os dois arquivos é que entram as outras etapas: remover anotações
de tipo, todo espaço em branco e todas as vírgulas, e comparar com `cmp` —
saída **0, fluxo de caracteres idêntico**. A sequência completa, na ordem que
de fato rodou — **no Git Bash**, porque o terminal padrão deste projeto é o
PowerShell 5.1, onde `sed` e `tr` não existem:

```
deno fmt no-repo.ts no-ar.ts
sed 's/: any//g; s/: Request//g' ARQUIVO | tr -d '[:space:]' | tr -d ','
cmp   # saida 0
```

Os números, para não confundir um artefato com outro: o `index.ts` cru do
repositório tem **45** vírgulas; o mesmo arquivo, depois do `deno fmt`, tem
**57**; o bundle baixado, também depois do `deno fmt`, tem **72**. A
diferença de **15 vírgulas terminais** é entre os dois lados já formatados
(57 contra 72) — exatamente o número de literais que o transpilador expandiu
em várias linhas. Quem tentar conferir o 57 contra o `index.ts` do
repositório sem passar pelo `deno fmt` primeiro encontra 45, não 57 — o
número certo, mas do artefato errado.

Conclusão: o `index.ts` versionado é o **fonte**, e é o registro **melhor**
que o download, que é a saída. Quem for comparar no futuro precisa saber
disso — senão vê dezenas de remoções fantasma e acha que o código mudou no ar.

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
peça que ninguém despublicou **até 11/08/2026**.

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

## Despublicada

A decisão foi **despublicar**, tomada em 11/08/2026 na #167 e rastreada pela
#187. Executada no mesmo dia:

```
supabase functions delete send-order-whatsapp --project-ref cafkrminfnokvgjqtkle --yes
Deleted Function send-order-whatsapp from project cafkrminfnokvgjqtkle.
```

Antes eram 8 functions publicadas; agora são 7. O `index.ts` desta pasta
continua sendo o único registro do que esteve no ar — não é para reativar.

**A pasta continua no repositório de propósito**, e isso tem uma consequência
nova: um `supabase functions deploy` sem nome de função publica todas as do
diretório (ver `DEPLOYMENT.md`), incluindo esta — e a contagem volta a 8.
Verificado: isso **não** é regressão de segurança. Sem entrada em
`supabase/config.toml` e sem a flag `--no-verify-jwt` (que é opt-in), o pior
caso de uma republicação acidental é a verificação de JWT ficar **ligada**,
nunca `false`.

**O que não está escrito em lugar nenhum é o PORQUÊ da desativação de
01/06/2026.** A migration não tem comentário. Se houve motivo de negócio —
custo da Evolution API, número banido, mudança de canal — ele não sobreviveu.
Isso continua sem resposta; a despublicação da edge function não muda esse
fato, só encerra a peça que ainda estava no ar sem uso.
