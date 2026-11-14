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

O hash é **por loja**, então não cabe em migration (a mesma lista de arquivos vai
para qualquer loja e o ledger recusa reaplicar), e nem `aplicar-migrations.yml` nem
`conferir-banco-da-loja.yml` aceitam SQL com parâmetro. O caminho é o workflow
[`instalar-chave-da-loja.yml`](../../.github/workflows/instalar-chave-da-loja.yml)
(`workflow_dispatch`, script
[`instalar-chave-da-loja.cjs`](../../scripts/publicacao/instalar-chave-da-loja.cjs),
teste `tests/ci_instalar_chave_da_loja_test.ts`). **A chave em texto puro nunca passa
por ele**: o app de gestão gera a chave dentro dele e mostra só o **hash**
(SHA-256, 64 hex minúsculos); é esse hash que se cola.

**Pré-condição:** a migration `20261399998000` já aplicada na loja (sem ela a função
não existe e o run falha na leitura prévia, sem gravar nada).

**Entradas:**

| entrada | o que é |
|---|---|
| `projeto` | `ikcous-publicada` (a CAF) ou `savy` — só as duas lojas reais; nunca Almeida, Brand Meliz, Space, `loja` nem `sandbox` |
| `hash` | só o hash, 64 hex **minúsculos** (maiúscula, espaço ou quebra de linha são recusados antes de qualquer rede; o valor, certo ou errado, é mascarado no log antes da validação e a mensagem de recusa não o repete) |
| `substituir` | desmarcado (padrão): recusa se já há chave. Marcado: **rotação** (troca a chave que já existe) |
| `expected_sha` | o SHA completo (40 hex) do commit do run, como nos outros workflows de loja real |

**Rodar** (uma loja por vez; o 2º pedido na mesma loja espera a vez, não cancela o
primeiro):

```powershell
gh workflow run instalar-chave-da-loja.yml --repo BielWeed/ikcous-marketplace --ref <ramo> -f projeto=savy -f hash=<64 hex minúsculos> -f expected_sha=<SHA completo do topo do ramo>
```

Rotação: acrescente `-f substituir=true`. O título do run é `instalar chave em
<projeto> (nova|rotacao)` (o hash não entra no título).

**O que o run faz, em ordem** (só o passo 3 grava):

1. valida projeto, `expected_sha` e hash antes do checkout e de qualquer segredo;
2. lê se já existe chave (só para o veredito dizer a verdade);
3. executa exatamente `select public.assinatura_da_loja_definir_chave('<hash>', <true|false>)`;
4. confere por leitura: a tabela tem exatamente 1 linha e o hash guardado é o enviado
   (só um booleano volta). O hash **não** passa por `env:` (o GitHub imprime esse bloco
   no log de cada passo): vem do arquivo do evento, é **mascarado** (`::add-mask::`,
   aparece como `***` no log) antes mesmo da validação, e o resumo do run mostra só os 8
   primeiros caracteres.

O run termina com
`VEREDITO-INSTALAR-CHAVE projeto=<x> sha=<y> definida=<true|false> substituiu=<true|false>`:
`definida=true` só quando a conferência bateu; `definida=false` quando o banco recusou
por já haver chave (nada mudou); `substituiu=true` só se havia chave antes **e** o
pedido foi de substituição. Sem essa linha o run falhou — leia a mensagem.

**Se algo sair diferente:**

- **"já existe chave nesta loja: use substituir=true para rotacionar"**: a loja já tem
  hash. Se o objetivo é trocar a chave, rode de novo com `substituir=true`; se não, não
  faça nada (nada foi alterado).
- **"sem acesso legítimo … bloqueio concreto"** (401/403): o segredo da loja
  (`SUPABASE_ACCESS_TOKEN_IKCOUS` ou `SUPABASE_ACCESS_TOKEN_SAVY`) não vale ou falta;
  o run para sem tentar outro. Nada foi gravado.
- **"ESTADO DESCONHECIDO"** (rede, timeout, 5xx na gravação, ou a conferência não
  pôde ser lida): o banco pode ter gravado. Repetir com `substituir=true` é seguro
  (a mesma gravação; só `criada_em` é renovada). Não repita sem `substituir`: se a
  primeira já tinha gravado, ela recusa e confunde.
- **"a conferência por leitura não confirmou o hash"**: outro hash ficou gravado (ou
  alguém gravou ao mesmo tempo). Confira no SQL Editor da loja o `chave_hash` e rode de
  novo com `substituir=true`.

**Rotação de chave** (a antiga **deixa de abrir a porta no mesmo instante** em que o
hash novo é gravado): gere a chave nova no app de gestão, instale o hash novo aqui com
`substituir=true` e só então troque a chave que o app usa. Entre uma coisa e outra o
app de gestão falha com `nao_autorizado` — rode as duas coisas juntas.

**Limites assumidos:** a gravação é uma instrução só (atômica); as três consultas são
requisições separadas, então a leitura prévia pode ficar velha se duas pessoas
instalarem na mesma loja ao mesmo tempo (a fila por loja serializa os runs desta
Action, não alguém que grave por outro caminho). O hash não abre a porta, mas o campo
`hash` aparece no painel do run; se colar o valor errado, apague o run.

## Conferir na loja

No SQL Editor do projeto da loja: `SELECT * FROM public.assinatura_da_loja;`
— `atualizado_em` mostra a última sincronização. Se estiver velho, o hub
mostra o erro em "Falhas de sincronização" no Painel.
