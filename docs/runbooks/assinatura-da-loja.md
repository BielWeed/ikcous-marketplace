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

## A porta única (migration 20261399998000)

O hub pode gravar o cartão por UMA porta protegida por uma **chave própria da
loja**, em vez do upsert direto com a chave de serviço. A chave de serviço
continua abrindo o upsert direto até uma decisão posterior retirá-lo.

- **Tabela** `assinatura_da_loja_chave` (linha única `id = 1`): guarda só o
  **SHA-256 da chave** (64 hex minúsculos), nunca a chave. Selada: RLS ligada
  sem política e nenhum privilégio para ninguém de aplicação. Um hash vazado não
  abre a porta (a porta compara o hash do que chegou).
- **`assinatura_da_loja_definir_chave(p_hash, p_substituir default false)`**:
  só `service_role` executa (e o dono do banco). Sem `p_substituir`, recusa com
  `chave_ja_definida` (23505) se já há chave; com `p_substituir = true`, troca
  (rotação). Hash que não é 64 hex minúsculos: `hash_invalido`.
- **`assinatura_da_loja_gravar(p_chave, p_dados, p_simular default false)`**:
  `anon` e `authenticated` executam. A chave vai **sempre no corpo de um POST**
  (`/rest/v1/rpc/assinatura_da_loja_gravar`), **nunca na URL**: um GET chega a
  rodar função volátil e a URL fica em log. Quem protege isso é o chamador.
  - Autentica ANTES de olhar `p_dados`; qualquer falha (sem chave, errada, loja
    sem chave definida) é o mesmo erro `nao_autorizado` (42501).
  - `p_dados` é um objeto com **exatamente** estas 10 chaves: `plano`, `status`,
    `ciclo`, `valor_mensal`, `inicio_em`, `teste_ate`, `proxima_cobranca_em`,
    `suporte_whatsapp`, `gerenciar_url`, `atualizado_em`. Chave a mais:
    `campo_nao_permitido`; a menos: `campo_ausente`; valor fora da regra:
    `valor_invalido` (o `DETAIL` diz o campo). `null` apaga o valor nos campos
    que a tabela aceita nulo. **`recursos` e `observacao` nunca são tocados.**
  - `valor_mensal` é número JSON (nunca texto), até 2 casas: `49.995` é recusado,
    não arredondado.
  - `atualizado_em` mais velho que o gravado: não grava e devolve
    `{gravado:false, motivo:"mais_velho"}` (corrida entre duas conexões fica
    resolvida pelo banco). Mais de 1 dia no futuro: `valor_invalido`.
  - **`p_simular = true`** mostra o que mudaria (`mudaria` com `de`/`para` e o
    `atual`) **sem gravar**; rode a simulação primeiro em cada loja nova.
  - O resultado traz o nome da loja (`loja`), para o hub conferir que falou com
    a loja certa.
- **Desfazer:** `rollback-manual-20261399998000_...sql` apaga as duas funções e a
  tabela da chave. **O hash guardado se perde** (precisa definir de novo); o
  cartão não é tocado.

## Como o hash da chave entra no banco de cada loja

Não existe, no repositório, caminho pronto: `aplicar-migrations.yml` aplica
**arquivos de `supabase/migrations/`** (a mesma lista vai para qualquer loja, e o
ledger recusa reaplicar) e `conferir-banco-da-loja.yml` só roda **consultas fixas
de leitura**. Nenhum aceita SQL com parâmetro. O hash é **por loja**, então não
cabe em migration. O menor caminho, ainda NÃO construído (decisão pendente): um
`workflow_dispatch` fechado com `projeto` em lista fechada (as mesmas lojas dos
workflows acima, com `expected_sha` nas lojas reais), `hash` validado por regex
`^[0-9a-f]{64}$` e `substituir` booleano, que usa o segredo da loja **dentro** da
Action (como `aplicar-migrations.yml` já faz) para rodar só
`select public.assinatura_da_loja_definir_chave('<hash>', <substituir>)` pela
API de gestão. A chave em si nunca passa por lá: só o hash.

## Conferir na loja

No SQL Editor do projeto da loja: `SELECT * FROM public.assinatura_da_loja;`
— `atualizado_em` mostra a última sincronização. Se estiver velho, o hub
mostra o erro em "Falhas de sincronização" no Painel.
