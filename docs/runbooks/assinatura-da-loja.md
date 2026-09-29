# Assinatura da loja — quem grava e como

O card **Plano da loja** do Início do painel lê `public.assinatura_da_loja`
(linha única `id = 1`, criada pela migration
[`20261177000000_o_financeiro_da_loja_nasce.sql`](../../supabase/migrations/20261177000000_o_financeiro_da_loja_nasce.sql))
pela RPC `assinatura_da_loja_ler()`. **O app nunca grava essa tabela** —
cobrança de mensalidade não é escopo do app (AGENTS.md).

Quem grava é o **hub de Gestão de Assinantes**, um projeto separado
(repositório `BielWeed/ikcous-ecosystem-suite`, pasta `gestao-de-assinantes/`,
contrato em `gestao-de-assinantes/docs/CONTRATO-DA-LOJA.md` daquele repositório),
com a chave de serviço do Supabase desta loja, cifrada no hub.

## O que a loja precisa ter

1. A migration `20261177000000` aplicada (sem ela o hub marca a loja como
   `desatualizada`).
2. A chave de serviço deste projeto cadastrada no hub (Ficha do assinante →
   Loja → Definir chave). Ao rotacionar a chave (ver
   [rotação de credenciais](rotacao-credenciais-supabase.md)), cadastre a nova
   no hub também — senão o hub marca `chave_invalida` e o card para de atualizar.

## O que o hub grava

Upsert `POST /rest/v1/assinatura_da_loja?on_conflict=id` com
`Prefer: resolution=merge-duplicates`. Campos:

| coluna | significado |
|---|---|
| `plano`, `status` | nome do plano; `ativa`/`teste`/`pendente`/`atrasada`/`suspensa`/`cancelada` |
| `valor_mensal` + `ciclo` | valor **por ciclo** (com `anual`, é o valor do ano — o card mostra `/ano`) |
| `inicio_em`, `teste_ate`, `proxima_cobranca_em` | datas; `proxima_cobranca_em` nula quando cancelada |
| `recursos` | lista exibida no card |
| `gerenciar_url` | link do Mercado Pago para a lojista regularizar o cartão (ou a URL padrão do hub) |
| `suporte_whatsapp` | só dígitos, 10–15 |
| `atualizado_em` | o hub manda explícito (não há gatilho) |

## Conferir na loja

No SQL Editor do projeto da loja: `SELECT * FROM public.assinatura_da_loja;`
— `atualizado_em` mostra a última sincronização. Se estiver velho, o hub
mostra o erro em "Falhas de sincronização" no Painel.
