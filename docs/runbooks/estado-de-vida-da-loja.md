# Estado de vida da loja — pôr para dormir, acordar e encerrar (plano L8, Lote 4)

Cada loja da caderneta da frota (`public.frota_lojas`, no banco onde a caderneta de produção mora,
`IKCOUS_FROTA_URL`) tem um estado:

| Estado | O que a cliente da loja vê | Quem decide |
|---|---|---|
| `ativa` | a loja normal | — |
| `adormecida` | página "<Nome da loja> está fechada no momento." (HTTP 503) | a regra de cobrança (assinatura vencida e não paga) |
| `encerrada` | página "<Nome da loja> não está mais no ar." (HTTP 410) | **só com ordem ESCRITA do dono** |

As páginas de loja fechada são do porteiro do Lote 2 do L8. Antes dele estar no ar, loja fora de
`ativa` responde como endereço desconhecido (a `resolver_loja` antiga a ignora).

**IKCOUS (`cafkrminfnokvgjqtkle`) e Savy (`gnjsrucsmjkajijrakzr`) nunca dormem**
(`scripts/frota/politica.json` → `lojasQueNuncaDormem`): o comando recusa e o banco recusa, até
pela porta.

## Como funciona (e por que o comando só IMPRIME)

- A caderneta de produção mora num banco que só a sessão alcança, pelo MCP do Supabase; nenhum
  workflow escreve lá.
- O comando `scripts/frota/estado-da-loja.mjs` confere tudo o que dá para conferir daqui e imprime
  **uma** instrução `select * from public.frota_mudar_estado(...)`. Quem a roda é a sessão, pelo MCP,
  no banco da caderneta.
- No banco (migration `20261470000000`), a porta `frota_mudar_estado` confere de novo: estado atual,
  release, confirmação, validade. Um gatilho recusa qualquer `UPDATE` direto do estado. Cada mudança
  grava uma linha em `public.frota_estado_historico` (quem, quando, de, para, release, motivo).
- **Quem fez vai no motivo.** A coluna `quem` do histórico é o usuário do banco que rodou a instrução,
  e pelo MCP ele é sempre `postgres`: ela não diz quem decidiu. Por isso o comando só aceita motivo
  que começa com o autor, no formato `por <nome>: <motivo>` (ex.: `por Gabriel: assinatura vencida em
  20/11`). Sem isso ele sai com `2` e não imprime nada.
- **Só sai do ar a loja que consegue voltar.** O `--acordar` precisa do canal de backend da loja em
  `scripts/frota/canais-de-backend.json` (é por ele que confere e conserta o banco dela). Sem canal, o
  comando recusa as três ações com a mesma mensagem, para nunca deixar fora do ar uma loja que
  pagou e não consegue acordar. Loja só de front (`politica.json` → `lojasSemBackendGerenciado`)
  não precisa de canal.
- A instrução impressa vale **30 minutos**. Passou disso, gere outra.
- Saída do comando: `0` = instrução impressa; `1` = recusado ou loja não pronta; `2` = uso errado.

## Antes da primeira vez

A migration `20261470000000_a_loja_muda_de_estado_so_pela_porta.sql` tem de estar no banco da
caderneta (e em cada banco do canal). Pelo MCP, no banco da caderneta: consulta
`183b-antes-a-loja-muda-de-estado-so-pela-porta-ausente` (todas as linhas `ok = true`), a migration,
e depois `183a-conferir-a-loja-muda-de-estado-so-pela-porta-aplicado` (9 linhas, todas `ok = true`).

## Ver o estado de todas as lojas (só leitura)

```powershell
node scripts/frota/estado-da-loja.mjs --ver
```

Para uma loja só:

```powershell
node scripts/frota/estado-da-loja.mjs --ver --loja "<id da loja>"
```

Rode o `select` impresso pelo MCP. Ele devolve as lojas (sem URL nem chave do banco delas) e as 20
últimas mudanças. Anote o `estado_sha` da loja: é a `--base` para acordá-la. Ele é a release em
que a loja **saiu do ar** e não muda entre `adormecida` e `encerrada` (adormecida na release A e
encerrada depois na B continua com `estado_sha` = A). Só muda quando a loja sai de `ativa` ou volta
a ela. A linha do histórico guarda sempre a release do momento de cada mudança.

## A release que está no ar

Todo comando que muda o estado exige `--sha` = a release que a produção serve agora. Para ver:

```powershell
(Invoke-WebRequest -UseBasicParsing "https://ickous-marketplace.vercel.app/version.json").Content
```

O valor é o `codeSha`. Se você passar outro, o comando recusa e diz qual é o certo.

## Regra decidida para mensalidade atrasada (26/11/2026) — AINDA NÃO IMPLEMENTADA

A regra fecha a **entrada** e deixa a **saída** aberta. A loja para de aceitar pedido novo, e
quem recusa é o servidor. O painel da lojista continua aberto, para ela entregar, estornar e
pagar. "Dia 0" é o vencimento da mensalidade ou o fim do teste.

| Quando | Cliente final | Lojista |
|---|---|---|
| Teste: dia 0 a 3. Pagante: dia 0 a 10 | Loja normal | Tudo normal e uma faixa "suas vendas pausam em DD/MM" |
| Vendas pausadas | A loja abre, mas recusa pedido novo e mostra o contato da loja | Painel inteiro: entrega, estorno, devolução, o que deve e como pagar |
| A partir do dia 30, com as quatro consultas zeradas | Página "fechada" (`--adormecer`) | Nada pendente |
| Encerrar | "Não está mais no ar" | Só com ordem escrita do dono, depois do dia 60, com a cópia dos dados oferecida |
| Pagou | Volta a vender no próximo pedido | A faixa some |

- Nunca pausar na sexta, no sábado ou no domingo: a pausa passa para a segunda seguinte.
- Pausar é manual, com um clique numa lista que o sistema monta.
- Reabrir é automático, quando o pagamento é registrado.
- A Savy fica fora da pausa até o dono dizer o contrário.
- **Enquanto a "pausa de vendas" não existir no servidor**, a loja adormecida continua aceitando
  pedido de quem já estava com ela aberta ou com o app guardado no aparelho, e perde o painel.
  Por isso, hoje, adormecer exige as quatro consultas zeradas, e isso vale também para encerrar.

## Quando adormecer uma loja de teste que não pagou

- **Quem avisa e quando.** O app de gestão de assinantes mostra a loja no grupo "Testes vencidos
  sem pagamento", com a frase "fecha em DD/MM (se não houver pedido em aberto)". O dia de fechar é
  o fim do teste + 3 dias. Antes dele, não se adormece.
- **Quem roda.** Nesse dia, quem opera (a sessão, por ordem do dono, ou o dono) roda o
  `--adormecer` da seção seguinte com `--motivo "por <nome>: teste vencido sem pagamento"`.
- **Antes, conferir que não há pedido em aberto.** O comando não olha os pedidos (ele só fala com
  a caderneta). Pelo MCP, no banco **da loja** (o `--ref` dela, não o da caderneta), rode esta
  consulta, só leitura:

```sql
select status, payment_status, count(*) as pedidos, min(created_at) as mais_antigo
  from public.marketplace_orders
 where status not in ('cancelled', 'delivered')
 group by status, payment_status
 order by status, payment_status;
```

"Em aberto" é o mesmo corte do filtro "Em Aberto" da tela de Pedidos do painel
(`get_admin_orders_paged` com `p_status = 'open'`, migration `20260911000000`): todo pedido que não
está `cancelled` nem `delivered`. Isso pega o pedido pago ainda não entregue ou retirado
(`processing`, `shipping` — a retirada pronta também é `shipping`) e o pedido com pagamento
pendente (`pending` com `payment_status = 'aguardando'`; a reserva vencida vira `cancelled` sozinha
pelo `expirar_pedidos_vencidos`).

Rode também estas três, no mesmo banco. A consulta de cima não vê o que a loja ainda deve à
cliente depois que o pedido fecha, e a loja adormecida tira o painel da lojista:

```sql
-- dinheiro recebido em pedido cancelado que ainda não virou "estornado"
-- (estorno pedido, em andamento, que falhou ou recusado: olha o resultado, não a etapa)
select payment_status, count(*) as pedidos, min(created_at) as mais_antigo
  from public.marketplace_orders
 where status = 'cancelled'
   and payment_status in ('pago', 'pago_apos_expirar', 'recebido_na_entrega')
 group by payment_status
 order by payment_status;
```

```sql
-- devolução que a cliente abriu e ainda não terminou (prazo legal correndo)
select status, count(*) as devolucoes, min(created_at) as mais_antiga
  from public.devolucoes
 where status in ('solicitada', 'aprovada', 'em_transito', 'recebida')
 group by status
 order by status;
```

```sql
-- reembolso de devolução já concluída que ainda não chegou à cliente
-- (o pedido segue "delivered" e "pago"; o refund_id aponta sempre o reembolso que vale agora)
select r.status, count(*) as reembolsos, min(r.created_at) as mais_antigo
  from public.devolucoes d
  join public.order_refunds r on r.id = d.refund_id
 where d.status = 'concluida'
   and r.status <> 'concluido'
 group by r.status
 order by r.status;
```

- **Nenhuma linha nas quatro:** pode adormecer.
- **Alguma linha em qualquer uma:** **não adormeça.** Adie até o pedido fechar (entregue, retirado
  ou cancelado), o dinheiro voltar à cliente e a devolução terminar, e rode as quatro de novo antes
  de tentar outra vez.

## Pôr uma loja para dormir

```powershell
node scripts/frota/estado-da-loja.mjs --adormecer --loja "<id>" --ref "<ref de 20 letras>" --sha "<codeSha>" --motivo "por <seu nome>: assinatura vencida em 20/11 sem pagamento"
```

O motivo começa com `por <seu nome>: ` e aceita letras, números, espaço e `. , : ; ( ) / -`, de 3 a
200 caracteres no total. Rode a instrução
impressa pelo MCP. Ela devolve a loja com `estado = adormecida`.

## Acordar uma loja

```powershell
node scripts/frota/estado-da-loja.mjs --acordar --loja "<id>" --ref "<ref>" --base "<estado_sha do --ver>" --sha "<codeSha>" --motivo "por <seu nome>: pagamento confirmado em 26/11"
```

Antes de imprimir, o comando confere se o banco **daquela loja** está pronto para a release atual,
com a mesma régua do `publicar-release.mjs`: migrations no ledger, prova de objetos fresca de cada
migration nova desde a release em que ela dormiu (`--base`) e functions iguais às da release.

- **Pronta:** imprime a instrução. Rode pelo MCP.
- **Não pronta:** NÃO imprime a instrução. Imprime o motivo e os comandos de conserto **só daquela
  loja** (`gh workflow run ...`), um passo por vez. Rode o primeiro, espere terminar
  (`gh run watch <id>`) e rode o `--acordar` de novo. Repita até sair a instrução.
- Sem canal de backend em `scripts/frota/canais-de-backend.json`, a loja não acorda: cadastre o
  canal antes.

**Três cuidados, porque a porta do banco não sabe qual release está no ar:**

1. **Não acorde loja com publicação em andamento** (`publicar-release.mjs` rodando). Espere ela
   terminar.
2. **Se a release em produção mudou depois de gerar a instrução, jogue a instrução fora** e gere
   outra com o `--acordar` (ele confere o banco para a release nova).
3. **Depois de rodar a instrução, o passo pós-acordar é obrigatório.** A própria mensagem do
   `--acordar` traz o comando pronto:

```powershell
node scripts/frota/estado-da-loja.mjs --depois-de-acordar --loja "<id>" --ref "<ref>" --sha "<o mesmo --sha da instrução>" --base "<a mesma --base da instrução>"
```

- **Saída `0`:** a produção ainda serve a release da instrução, ou mudou e o banco da loja está
  pronto para a nova. Tudo certo.
- **Saída `1` com `CRÍTICO`:** a loja está no ar com o banco atrasado para a release que está no
  ar. Faça o conserto que ele imprime (um passo por vez) e rode o passo de novo até sair `0`. Se o
  conserto for demorar, ponha a loja para dormir de novo com o `--adormecer` que ele mostra.

Se a publicação pegar uma loja que acordou no meio dela, o relatório do `publicar-release.mjs`
mostra "PRIORIDADE ALTA — loja que acordou durante a publicação" com este mesmo comando. Isso é
só uma rede de segurança (o porteiro pode levar até 60 s para mostrar a loja acordada): o passo
pós-acordar continua obrigatório.

## Encerrar uma loja (só com ordem ESCRITA do dono)

Sem a ordem escrita do dono (mensagem dele dizendo qual loja encerrar), **não rode**. Cite a ordem no
motivo.

**Antes, as mesmas quatro consultas de "Quando adormecer" (pedido em aberto, dinheiro a devolver,
estorno pendente, devolução aberta), no banco da loja.** Nenhuma linha nas quatro: pode encerrar.
Alguma linha: **não encerre**, nem com a ordem do dono — avise o dono do que falta, com os números.
Encerrar tira o painel da lojista de vez; vale ainda mais quando a loja está `ativa` (`--de ativa`),
porque aí ela pode ter vendido até agora. O comando não olha os pedidos.

```powershell
node scripts/frota/estado-da-loja.mjs --encerrar --loja "<id>" --ref "<ref>" --sha "<codeSha>" --motivo "por <seu nome>: ordem escrita do dono em 26/11, encerrar" --confirmar "ENCERRAR <id>"
```

Por padrão encerra uma loja `adormecida`. Para encerrar uma `ativa`, acrescente `--de ativa`.
A frase de `--confirmar` tem de ser exatamente `ENCERRAR ` seguido do id.

## Reabrir uma loja encerrada

```powershell
node scripts/frota/estado-da-loja.mjs --acordar --loja "<id>" --ref "<ref>" --base "<estado_sha do --ver>" --sha "<codeSha>" --motivo "por <seu nome>: voltou a assinar" --confirmar "REABRIR <id>"
```

Mesma conferência de prontidão do "Acordar".

## Conferir no ar (depois de 60 segundos)

O porteiro guarda a decisão por até 60 s. Espere 1 minuto e confira:

```powershell
curl.exe -sI "https://<domínio da loja>/"
```

| Depois de | Esperado |
|---|---|
| adormecer | `HTTP/1.1 503`, `x-ikcous-porteiro: adormecida`, `x-ikcous-estado: adormecida`, `x-ikcous-ref: <ref>` |
| encerrar | `HTTP/1.1 410`, `x-ikcous-porteiro: encerrada`, `x-ikcous-estado: encerrada`, `x-ikcous-ref: <ref>` |
| acordar ou reabrir | `HTTP/1.1 200`, `x-ikcous-caderneta: hit` |

Se vier diferente depois de 2 minutos, rode o `--ver` e confira o estado gravado.

## Se a porta recusar

| Mensagem começa com | O que fazer |
|---|---|
| `FROTA_ESTADO_INSTRUCAO_VENCIDA` | passaram 30 min: gere a instrução de novo |
| `FROTA_ESTADO_DIVERGENTE` | a loja não está no estado que o comando supôs: rode o `--ver` e use o comando certo |
| `FROTA_ESTADO_BASE_DIVERGENTE` | a `--base` não é o `estado_sha` da loja: rode o `--ver` e acorde com a base certa |
| `FROTA_ESTADO_LOJA_NAO_ENCONTRADA` | id e ref não batem com a caderneta |
| `FROTA_ESTADO_LOJA_QUE_NUNCA_DORME` | é a IKCOUS ou a Savy: não se faz |
| `FROTA_ESTADO_ENCERRAR_SEM_CONFIRMACAO` / `..._REABRIR_SEM_CONFIRMACAO` | falta a frase exata |
| `FROTA_ESTADO_SO_PELA_PORTA` | alguém tentou `UPDATE` direto: use o comando |

## Desfazer uma mudança errada

Faça a mudança inversa pela porta (adormeceu por engano → `--acordar`; encerrou por engano →
reabrir). O histórico guarda as duas linhas. Nunca apague linha do histórico.

## O banco da caderneta: a vitrine antiga sem escrita anônima

O banco onde a caderneta mora hoje é o projeto antigo `dekxabvqdsuukijblazl`. Ele não recebe as
migrations dos canais, e a view `public.vw_produtos_public` dele ficou aberta para escrita com a chave
pública (nas lojas, a 20260821000100 e a 20261090000000 já a fecharam). O conserto é um script à
parte, **não** migration, em `scripts/frota/banco-da-caderneta/`. Pelo MCP, **só** com `execute_sql`
no `dekxabvqdsuukijblazl` (nunca `apply_migration`, que grava uma versão falsa no histórico de
migrations do projeto):

1. **Antes (só leitura):** `scripts/frota/banco-da-caderneta/vitrine-antiga-sem-escrita-anonima-conferir.sql`.
   Esperado: 5 linhas; a da ACL mostra no `vivo` a ACL medida em 26/11 (`anon=arwdDxtm/postgres`).
2. **Aplicar, numa transação só:** `begin;` + o conteúdo de
   `scripts/frota/banco-da-caderneta/vitrine-antiga-sem-escrita-anonima.sql` + `commit;`, na mesma
   chamada. O pré-voo recusa com `B1_BASELINE_DIVERGENT` (e nada é gravado) se o banco não tiver a
   caderneta semeada (`frota_lojas` e `frota_segredo` com linha: é o que separa o dekxab de uma loja,
   que tem as tabelas vazias e a mesma ACL da view) ou se a ACL não for a medida nem a já aplicada; o
   pós-voo recusa com `POSVOO_VITRINE_ANTIGA` se o resultado não for o esperado. O rollback tem a mesma
   trava do banco certo.
3. **Depois:** a mesma consulta do passo 1. Esperado: as 5 linhas com `ok = true`.

**Desfazer:** `begin;` + `scripts/frota/banco-da-caderneta/rollback-manual-vitrine-antiga-sem-escrita-anonima.sql`
+ `commit;`, pelo `execute_sql`. Ele devolve a ACL medida, byte a byte, e **reabre o furo**; depois
dele, a consulta do passo 1 volta a mostrar o retrato de antes.

## Rollback das migrations (ordem)

1. Parar de usar este comando.
2. `rollback-manual-20261470000000_a_loja_muda_de_estado_so_pela_porta.sql` (comum): tira a porta e o
   gatilho e **preserva** o histórico.
3. Se for preciso tirar também o estado de vida: reverter antes o porteiro do Lote 2 e rodar
   `rollback-manual-20261460000000_a_loja_tem_estado_de_vida.sql` (comum).
4. Destrutivos, **só com o dono**: `rollback-manual-destrutivo-20261470000000_...` (apaga o
   histórico; confirmação `APAGAR`) e, só depois do comum da 20261470, o
   `rollback-manual-destrutivo-20261460000000_...` (tira as colunas; o Postgres recusa enquanto o
   gatilho existir).

Veja também: [produção — fonte única](producao-unica-fonte.md) ·
[modo manutenção da loja](modo-manutencao-da-loja.md) ·
[rotação de credenciais do Supabase](rotacao-credenciais-supabase.md).
