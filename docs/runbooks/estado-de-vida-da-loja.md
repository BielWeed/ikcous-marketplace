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

Rode também esta, no mesmo banco, para a devolução de dinheiro que ainda corre (um pedido
cancelado com estorno em andamento não aparece na consulta de cima, e a lojista precisa do painel
para acompanhar o estorno):

```sql
select status, count(*) as estornos, min(created_at) as mais_antigo
  from public.order_refunds
 where status in ('solicitado', 'em_processamento')
 group by status
 order by status;
```

- **Nenhuma linha nas duas:** pode adormecer.
- **Alguma linha em qualquer uma:** **não adormeça.** Adie até o pedido fechar (entregue, retirado
  ou cancelado) e o estorno terminar, e rode as consultas de novo antes de tentar outra vez.

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

## Encerrar uma loja (só com ordem ESCRITA do dono)

Sem a ordem escrita do dono (mensagem dele dizendo qual loja encerrar), **não rode**. Cite a ordem no
motivo.

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
