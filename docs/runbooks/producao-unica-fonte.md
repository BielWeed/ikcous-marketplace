# Producao - uma publicacao central para a frota inteira (refeito 06/10/2026)

## Por que este runbook mudou

Em 05/10/2026 a release 1.5.18 foi ao ar so na IKCOUS (`ickous-marketplace.vercel.app`) e os
outros 9 enderecos do projeto (Savy, lojas de teste e enderecos auxiliares) ficaram na 1.5.17.
A publicacao parcial foi DELIBERADA, por coordenacao manual (plano `PLANO-PUBLICAR-SO-IKCOUS`
§7): o site novo cancela pedido online pela `criar-pagamento` nova, que depende das migrations
20261192..20261202, e a Savy ainda nao tinha esse banco. O defeito (checkpoint
`DISTRIBUICAO-FROTA-20261006.md`) e o que tornou essa excecao necessaria: NAO existia caminho
central de banco para a Savy, entao a saida foi publicar endereco por endereco
(`vercel --prod --skip-domain` + `vercel alias set` so na IKCOUS), e nenhuma conferencia da
frota mostrava quais enderecos ficaram para tras. A correcao e um portao unico: nada de alias
por endereco.

## Como funciona

- UM projeto Vercel (`ickous-marketplace`) serve TODAS as lojas. O porteiro (`middleware.ts`)
  escolhe a loja pelo endereco no cadastro oficial `frota_lojas` e serve a ficha dela (ref do
  Supabase, titulo, `publicUrl`), com `X-Ikcous-Caderneta: hit`.
- Banco e functions sao um projeto Supabase POR LOJA.
- `vercel promote <deployment>` leva TODOS os dominios de producao do projeto de uma vez, sem
  rebuild. E o unico jeito de publicar o front.
- Lojas ASSINANTES (backend gerenciado): IKCOUS (`cafkrminfnokvgjqtkle`) e Savy
  (`gnjsrucsmjkajijrakzr`), com canal em `scripts/frota/canais-de-backend.json`.
- Lojas de TESTE (Almeida, Brand Meliz, Space): banco e functions NAO se mexem (decisao do dono,
  03/10/2026, em `scripts/frota/politica.json`); recebem so o front, que e o mesmo.

## Publicar uma release (a sequencia inteira)

Quem roda: o DONO, no PowerShell, de uma worktree limpa do ramo `claude/app-major-upgrade-wmc8x2`
no SHA da release, com os CLIs `vercel` (instalado global pelo npm: no Windows o comando chama o
`node` com o `vercel/dist/vc.js` ao lado do `vercel.cmd`; `npx` não serve), `supabase` e `gh`
(`.exe`) logados. (As permissoes do projeto
negam ao agente `vercel deploy/promote/rollback/alias` e `supabase db push`.)

1. **Candidato (nao muda nenhum endereco).** Da worktree limpa, com `.vercel/project.json`:

   ```powershell
   vercel --prod --skip-domain --yes --scope gabriels-projects-5a19f6ee --build-env IKCOUS_CODE_SHA=<sha40> --build-env VERCEL_GIT_COMMIT_SHA=<sha40>
   ```

   Anotar o `dpl_...` do deployment criado.

2. **Ensaio do portao (so leitura).**

   ```powershell
   node scripts/frota/publicar-release.mjs --sha <sha40> --deployment <dpl_...>
   ```

   O comando:
   - confere o candidato: projeto certo, producao, READY, `version.json` no contrato e com o SHA;
   - monta o INVENTARIO OFICIAL: todos os aliases do projeto Vercel e a ficha que o porteiro
     serve em cada um. Loja nova aparece aqui sozinha;
   - roda a conferencia da frota sobre esse inventario e BLOQUEIA problema de identidade,
     isolamento, destino canonico ou build. Versao antiga e o esperado antes do promote;
   - para cada loja ASSINANTE: (a) toda migration da release no ledger dela; (b) para cada
     migration NOVA para aquela loja, a prova de objetos/corpos FRESCA (o run mais novo da
     consulta declarada em `provasDeObjetos`, daquela loja, do commit com as mesmas migrations,
     verde, sem `ok=false`, sem apply depois); (c) cada function com o conjunto de arquivos do SHA
     (inclusive `_shared` importados) e `verify_jwt` do `config.toml`.
   - BLOQUEADO: diz o alvo e imprime o PROXIMO PASSO SEGURO de cada loja, ja pronto para colar:
     `gh workflow run ...` com o SHA efetivo do topo do ramo em `expected_sha` e os nomes
     completos dos arquivos (nunca `<...>`). NADA foi promovido.

3. **Levar o backend a cada assinante que bloqueou: um passo por vez.** Colar o que o passo 2
   imprimiu, esperar cada run terminar verde (`gh run watch <id>`) e rodar o passo 2 de novo; ele
   imprime o passo seguinte. A regra que o comando aplica a cada lote de migrations
   (`provasDeObjetos` em `scripts/frota/canais-de-backend.json`):
   1. **Ledger com lacuna nunca vira apply direto.** Primeiro a prova de objetos/corpos (ex.:
      `8e-conferir-92-a-202-aplicado`), so leitura.
   2. **Prova verde** = os objetos ja estao no banco e falta so o REGISTRO: o unico comando e o
      backfill protegido do ledger (`gravar_ledger=92-202`, `confirmar=GRAVAR`; a pre-checagem da
      8e roda antes de gravar; so `ikcous-publicada` e `savy`). Nenhuma migration e reaplicada. E
      o caso da IKCOUS (CAF), que recebeu 92..202 sem registro. Limite conhecido: a pre-checagem e
      o INSERT sao duas requisicoes; o job divide o grupo `banco-da-loja` com o apply, mas escrita
      FORA dos workflows nessa janela nao e vista.
   3. **Prova com `ok=false`** = diagnostico antes de qualquer apply: `8a`, `8b`, `8k` (so
      leitura). Apply SO quando a `8a` prova o lote inteiro AUSENTE, `8b`/`8k` estao `ok=true` e o
      ledger nao registra nenhuma versao dele: `aplicar-migrations.yml` com as migrations NA
      ORDEM, sem a 201 (o apply grava o ledger na mesma transacao). Depois do apply, a prova de
      novo. E o caminho esperado da Savy.
      **A `8k` (`8k-subtotal-divergente-ou-vazia-provada`) e a `8c` com a prova de loja VAZIA.**
      A `8c` reprovava por construcao numa loja sem pedido (os dois controles de visibilidade leem
      0) e nao dava para distinguir "loja vazia" de "papel cego pela RLS" (Row Level Security, a
      regra do banco que decide quais linhas cada papel enxerga). A `8k` conta as MESMAS tabelas
      (`marketplace_orders` e `marketplace_order_items`) com a MESMA formula da `8c` (`subtotal` =
      soma de `quantity * price` dos itens, `IS DISTINCT FROM`) e decide assim:
      - **Em TODOS os ramos (com ou sem pedido), nas DUAS tabelas:** a `8k` exige tabela comum
        (`relkind = r`, achada no schema `public`, nao por `search_path`), SELECT de tabela inteira,
        `row_security_active = false` (e igual a derivacao do catalogo) e os tipos medidos (ids
        `uuid`, `subtotal` e `price` `numeric(10,2)`, `quantity` `integer`). Papel sem BYPASSRLS e
        com RLS ativa reprova SEMPRE, ate com dados: e o lado seguro (a `8c` aceitava a parte
        visivel). O papel de leitura do Supabase (`supabase_read_only_user`: BYPASSRLS +
        `pg_read_all_data`) passa. Cada item errado reprova na linha do proprio metadado.
      - **Com pedidos ou itens visiveis:** as mesmas regras da `8c`, sem afrouxar (controles
        "pedidos visiveis" e "itens de pedido visiveis" maiores que 0, divergentes = 0, divergentes
        sem item = 0).
      - **Sem nenhum pedido nem item (0 e 0):** so e positiva como **VAZIA PROVADA**: a pre-condicao
        acima vale para AS DUAS tabelas (a prova e conjunta). Sem ela o 0 nao prova nada (a RLS pode
        esconder pedidos) e a linha `vazia provada` diz `ZERO NAO PROVADO`.
      - **Falha alta:** tabela ausente (42P01), papel sem nenhum SELECT (42501) ou `row_security = off`
        com RLS aplicavel (42501) fazem a consulta INTEIRA falhar: o run termina vermelho, sem
        `VEREDITO-CONSULTA`, e o portao trata como SEM EVIDENCIA, nunca como positiva.
      - **Limites:** a prova local (Postgres 17 efemero, `tests/banco/subtotal-vazia-provada-viva.cjs`)
        prova que a consulta DECIDE certo, nao que a Savy esta vazia: so o run da `8k` na Savy diz
        isso, e so como o papel que leu. Com dados, o limite da `8c` continua para quem ve tudo
        (a soma e a das linhas visiveis). `ALTER ROLE ... BYPASSRLS` ou `GRANT` concorrente durante a
        consulta (exige um administrador agindo naquele instante) pode aparecer so num dos lados do
        statement. A janela entre a `8k` e o apply (ate `validadeDaEvidenciaHoras`) e a mesma
        limitacao que a `8c` tinha. O veredito so vale como evidencia com `rol=ok` (as 20 linhas
        exatas). A `8c` continua no menu como consulta legada; o portao nao a usa mais.
      - **Depois do merge, a ordem importa:** mudar `conferir-banco.cjs` e o workflow invalida a
        evidencia antiga (o portao compara a ferramenta do run com a do topo do ramo). Rodar PRIMEIRO
        a `8e`; depois `8a`, `8b` e `8k`, todas MAIS NOVAS que a `8e` (diagnostico mais velho que a
        prova negativa e descartado).
   4. **Qualquer `ok=false` no diagnostico, ou contradicao** (ledger parcial com a 8a dizendo
      ausente; ledger completo com a prova negativa): PARADO, sem comando — vai ao dono.
   5. **Versao ausente do ledger fora de qualquer lote declarado**: PARADA, sem comando
      automatico. Precisa de uma consulta de prova propria antes de entrar num lote.
   6. Banco pronto, entao `publicar-functions.yml` com o `projeto` da loja e as functions que o
      passo 2 apontou (o comando so aparece com o banco pronto: banco → functions → front). Por
      `ikcous-publicada` e `savy` so saem as cinco financeiras (`functionsPublicaveis` em
      `canais-de-backend.json`, o que o workflow aceita). **Se a release mudar outra function**
      (ex.: `send-otp-email`), a loja fica PARADA pelo nome, sem comando: o caminho central nao a
      publica, e como seguir (canal novo no workflow ou publicacao separada) e decisao do dono.
   7. Passo 2 de novo. So segue com PRONTO.
   8. **Faixa historica 20261160..20261166 (so a IKCOUS/CAF; lote com `nuncaAplicar`).** O
      ledger da CAF salta de 20261150 para 20261167, mas o efeito dessas 7 migrations JA ESTA no
      banco (achado de 21/09). Reaplicar e regressivo e destrutivo (a 63 faz `DROP FUNCTION` e
      recria o corpo antigo; a 62 e a 65 devolvem corpo velho; a 66 apaga duplicados e faz
      `ADD CONSTRAINT`/`CREATE INDEX`/`CREATE TRIGGER` sem `IF NOT EXISTS`). Por isso NUNCA se
      aplica: `aplicar-migrations.yml` RECUSA esses arquivos e os `rollback-manual-2026116[0-6]*`
      em `ikcous-publicada`, `loja` e `savy` (a Savy ja tem as 7 no banco e no ledger; reaplicar a
      62, 63 ou 64 troca o corpo pelo anterior a 20261199, sem a trava de admin atual), antes de
      qualquer requisicao. O caminho e so este:
      1. **Ordem.** Antes da 9a, a 8e da CAF tem de estar POSITIVA e o backfill 92-202 feito
         (os corpos que a 9a compara so batem com a 92..202 no banco).
      2. **9a (so leitura):** `conferir-banco-da-loja.yml` com `projeto=ikcous-publicada` e
         `consulta=9a-conferir-60-a-66-aplicado` (47 itens: objetos, ACL das funcoes 61..64,
         overload da `get_admin_orders_paged`, metadados das 7 funcoes - SECURITY, search_path,
         volatilidade, STRICT, dono, argumentos, retorno e linguagem -, vistas por
         colunas/opcoes/definicao, CHECK e defaults por lista fechada, restricao adiavel e
         collation/opclass do indice com o schema). Ela le o estado ATUAL: os corpos atuais valem so como verificacao do
         estado exigido; a evidencia de 62..64 e a ACL e o overload, nao o corpo.
      3. **9a POSITIVA** (todas as linhas ok=true, e o veredito traz `rol=ok`) = falta so o
         REGISTRO: o unico comando e o backfill `gravar_ledger=60-66` + `confirmar=GRAVAR`. O
         script le o ledger (150 e 167 presentes, nenhuma das 7), refaz a 9a (rol fechado), grava
         com UM INSERT guardado (UMA tentativa, sem retry) e rele o ledger: confere
         exatamente as 7 versoes com os nomes, a 150 e a 167. Se as 7 ja estiverem la, sai 0 com
         "ja registrado: nada a gravar" e NENHUMA escrita. Escrita com resultado desconhecido
         (timeout, rede, 5xx) NAO e repetida: o script faz UMA leitura de reconciliacao e diz
         REGISTRADO / NAO REGISTRADO / PARCIAL; so se tenta de novo se a leitura mostrar que nao esta
         la.
      4. **9a NEGATIVA** (qualquer `ok=false`, ou resposta que nao seja o rol exato) = PARAR.
         Nada se aplica; o que faltar vira migration NOVA para a frente, so com o objeto ausente.
      5. **Limites.** A prova foi feita num Postgres 17 local (`tests/banco/lote-60-66-viva.cjs`);
         a versao da CAF nao foi medida. O deparse de CHECK, default e vista depende da versao:
         se divergir, a 9a falha FECHADA (vira NEGATIVA, nunca uma POSITIVA falsa). A guarda do
         INSERT reduz o risco de gravar sobre uma forma inesperada, mas nao serializa (cada
         comando ve o proprio snapshot sob READ COMMITTED): a evidencia e a leitura posterior, e a
         exclusao contra um apply e o grupo de concorrencia `banco-da-loja` do workflow. O DONO das
         funcoes (`postgres`) foi medido so no banco local: se na CAF for outro, a 9a sai NEGATIVA e
         o backfill para (nao ha excecao por ambiente). `indnullsnotdistinct` exige PG 15 ou mais.
         Risco residual do privilegio de `produtos.codigo_barras`: a 9a prova o GRANT explicito da
         coluna ao authenticated e que a tabela NAO da SELECT ao authenticated nem a PUBLIC, direto
         ou herdado de outro papel (`has_table_privilege`). Ela NAO le GRANT de coluna das OUTRAS
         colunas (ex.: `custo`) nem papeis que nao sejam o authenticated: isso nao esta provado aqui.
   9. **Lote de UMA migration, de apply normal: `20261203000000` (cupons desligados nao dao
      desconto, issue #645).** Sem `backfillLedger` e sem `nuncaAplicar`; vale nas duas lojas
      assinantes (IKCOUS e Savy). A migration cria o gatilho `tr_pedido_com_cupom_exige_a_chave_ligada`
      em `marketplace_orders` (com a funcao dele) e troca o corpo de `validate_coupon_secure_v2`. As
      duas consultas, so leitura e de ROL FECHADO (so valem com `rol=ok` no veredito), leem o
      catalogo e nenhuma linha de pedido, cupom ou cliente:
      - **`10a-conferir-cupons-desligados-aplicado`** (a consulta do lote, 21 linhas) prova os OBJETOS
        e CORPOS DEPOIS do apply: gatilho `BEFORE INSERT FOR EACH ROW` habilitado (`O`) com
        `WHEN (new.coupon_id IS NOT NULL)` apontando para a funcao certa; funcao do gatilho
        `SECURITY DEFINER`, `search_path=public`, corpo com o sha256 da migration (LF ou CRLF, a
        mesma conta do pre-voo dela) e SEM `EXECUTE` para PUBLIC, anon e authenticated;
        `validate_coupon_secure_v2` com uma sobrecarga so, corpo novo, `SECURITY DEFINER`,
        `search_path=public`, sem `EXECUTE` para PUBLIC e com para authenticated; e o indice unico
        `marketplace_orders_chave_da_compra_unica` sobre `(idempotency_key)` parcial `IS NOT NULL` (o
        curto-circuito do gatilho depende desse predicado exato). Cada item errado reprova na PROPRIA
        linha.
      - **`10b-antes-cupons-desligados-gatilho-e-corpo`** (`ausenciaConfirmadaPor`, 6 linhas) prova o
        ANTES, as mesmas condicoes do pre-voo da migration: gatilho AUSENTE (mesmo desabilitado conta
        como presente), uma sobrecarga so de `validate_coupon_secure_v2` com o corpo do baseline (LF
        ou CRLF; o corpo novo reprova aqui de proposito), e as colunas `marketplace_orders.coupon_id` e
        `store_config.enable_coupons`.
      - **Caminho, uma loja por vez:** ledger sem a versao e sem evidencia → `10a` (ela sai NEGATIVA:
        a migration ainda nao esta no banco) → `10b` MAIS NOVA que a `10a` e POSITIVA → o comando
        `aplicar-migrations.yml` com o arquivo `20261203000000_cupons_desligados_nao_dao_desconto.sql`
        (o apply grava o ledger na mesma transacao) → o ensaio pede a `10a` DE NOVO, que tem de sair
        POSITIVA. `10a` POSITIVA com a versao fora do ledger e PARAR (sem backfill: registrar a mao e
        decisao do dono). `10a` e `10b` NEGATIVAS, ou ledger com a versao e `10a` NEGATIVA: PARAR,
        diagnostico com o dono, nenhum apply.
      - **Ordem com o front:** o banco novo de CADA loja primeiro e o front desta release logo
        depois. A regra `remover_cupom` de `src/lib/recusaDoPedido.ts` e quem troca o botao da recusa
        nova ("Os cupons estao desativados nesta loja."); com o banco novo e o front velho nenhum pedido
        com cupom nasce, so o botao e pior.
      - **Efeito no banco durante o apply:** `CREATE TRIGGER` pede um lock curto em
        `marketplace_orders` (bloqueia escrita por instantes); a migration nao le nem grava linha
        nenhuma e e idempotente (`CREATE OR REPLACE`, pre-voo que aceita o corpo antigo ou o novo).
      - **Depois do merge:** mudar `conferir-banco.cjs` ou o workflow invalida a evidencia antiga
        (o portao compara a ferramenta do run com a do topo do ramo): rodar a `10a` e a `10b` DEPOIS
        da ultima mudanca nesses arquivos.
      - **Limites:** `tests/banco/cupons-desligados-portao-viva.cjs` (Postgres 17 efemero, rodado no
        `rpc-ci.yml`) prova que as consultas DECIDEM certo, nao que a IKCOUS ou a Savy estao no
        estado A ou B: so o run contra o ref de cada loja diz. O papel de leitura da Supabase
        (`supabase_read_only_user`) e o deparse do `WHEN` em PG15 nao foram medidos aqui; o `WHEN` e
        comparado sem espacos nem parenteses, e qualquer divergencia reprova (lado seguro). A ACL de
        `anon` na `validate_coupon_secure_v2` nao e conferida (a migration nao a toca).

  10. **Lote de UMA migration, de apply normal: `20261204000000` (a venda do balcao se anula no
      mesmo dia).** Sem `backfillLedger` e sem `nuncaAplicar`; vale nas duas lojas assinantes (IKCOUS
      e Savy). A migration so CRIA a funcao `anular_venda_presencial(uuid, text)` (nenhum dado muda ao
      aplicar) e depende das migrations 20261175, 20261177, 20261197 e 20261198. Duas consultas, so
      leitura e de ROL FECHADO (so valem com `rol=ok`), sobre o catalogo:
      - **`11a-conferir-anular-venda-presencial-aplicado`** (a consulta do lote, 14 linhas) prova a
        funcao DEPOIS do apply: uma sobrecarga so, `SECURITY DEFINER`, `search_path=public`, plpgsql
        que devolve jsonb, corpo com o sha256 da migration (LF ou CRLF), SEM `EXECUTE` para PUBLIC, anon
        e service_role e COM para authenticated; e que as quatro dependencias existem.
      - **`11b-antes-anular-venda-presencial-funcao-ausente`** (`ausenciaConfirmadaPor`, 9 linhas) prova
        o ANTES, as mesmas condicoes do pre-voo da migration: funcao ausente, `is_admin()` (existe), `is_admin_atual()` e
        `pedido__mudar_status(...)` com o corpo que o pre-voo exige (md5), `devolver_estoque`,
        `fin__dia` e `fin__hoje`, as tabelas e as colunas que a funcao le e escreve.
      - **Caminho, uma loja por vez:** igual ao do item 9 (`11a` NEGATIVA → `11b` mais nova e POSITIVA →
        apply de `20261204000000_a_venda_do_balcao_se_anula_no_mesmo_dia.sql` → `11a` de novo, POSITIVA).
        `11a` POSITIVA com a versao fora do ledger e PARAR (sem backfill). `11a` e `11b` NEGATIVAS: PARAR.
      - **Ordem com o front:** o banco novo de CADA loja primeiro e o front desta release logo depois.
        Com o banco novo e o front velho nada muda para ninguem; com o front novo e o banco velho a
        tela mostra "A anulacao ainda nao esta liberada neste servidor".
      - **Depois do merge:** mudar `conferir-banco.cjs` ou o workflow invalida a evidencia antiga:
        rodar a `11a` e a `11b` DEPOIS da ultima mudanca nesses arquivos.
      - **Limites:** `tests/banco/anular-venda-portao-viva.cjs` (Postgres 17 efemero, no
        `rpc-ci.yml`) prova que as consultas DECIDEM certo, nao que a IKCOUS ou a Savy estao no estado
        A ou B. O corpo de `is_admin_atual` e `pedido__mudar_status` so e conferido ANTES (11b);
        depois do apply a 11a so exige que existam, para uma migration futura que as aperfeicoe nao
        reprovar a prova desta.

4. **Promover UM front e conferir a frota.**

   ```powershell
   node scripts/frota/publicar-release.mjs --sha <sha40> --deployment <dpl_...> --promover
   ```

   Ele repete todo o portao, chama `vercel promote` UMA vez e roda a conferencia da frota com o
   SHA (versao, isolamento e canonico de TODOS os enderecos, e a producao oficial = o deployment
   promovido). Saida 0 = publicado e conferido.

5. **Depois:** PR do ramo para `production` com merge commit (registro do que esta no ar).

## Conferir a frota a qualquer hora (so leitura)

```powershell
node scripts/frota/conferir-frota.mjs --sha <sha40> --vercel
```

Classes: `OK`, `ENDERECO_ANTIGO` (aponta para outro deployment: recuperar com o passo 4, nunca
`alias set`), `LOJA_TROCADA` / `SUSPEITA_ISOLAMENTO` (isolamento: rollback ja), `CANONICO_INVALIDO`,
`BUILD_DIVERGENTE`, `INALCANCAVEL`, `ESTADO_INESPERADO`. No GitHub: workflow `frota-conferir.yml`
(sem segredo; inventario PARCIAL porque o CI nao le a Vercel). Nao ha vigia agendado: o ramo
padrao do GitHub e `develop`, e agendamento so dispara de la.

## Loja assinante nova (sem lista por release)

O inventario vem do cadastro oficial (aliases da Vercel + ficha `frota_lojas`), entao a loja nova
entra na proxima publicacao sem ninguem editar lista. Se ela nao tiver canal de backend, o passo 2
BLOQUEIA com o nome dela. O cadastro de UMA vez, na entrada do cliente:

1. projeto Supabase da loja com a cadeia de migrations inteira; linha em `frota_lojas`;
   dominio no projeto Vercel;
2. segredo do token da conta dela no repositorio (o dono grava) e o alvo dela nos workflows
   `aplicar-migrations.yml`, `conferir-banco-da-loja.yml` e `publicar-functions.yml` (mesmas
   travas do alvo `savy`: ref fixo, segredo proprio, `expected_sha`);
3. uma linha em `scripts/frota/canais-de-backend.json`. Se for loja de TESTE, a linha vai em
   `scripts/frota/politica.json` (`lojasSemBackendGerenciado`).

## Fora da release, de proposito

- `20261201000000` so entra depois das edges novas e de >= 15 min de escoamento com 1 ciclo do
  cron (cabecalho da propria migration); conferencia `8f-conferir-201`. Ela esta em
  `politica.json` (`migrationsForaDaRelease`) para o portao nao exigi-la.

## Rollback

- Front (a frota inteira de uma vez): `vercel rollback <producao anterior> --yes --scope gabriels-projects-5a19f6ee` (o comando do
  passo 4 imprime o id exato). Depois de um rollback a atribuicao automatica de dominios fica
  desligada ate o proximo `vercel promote`.
- Functions: publicar de novo pelo workflow a partir do commit anterior.
- Banco: `rollback-manual-<versao>` pelo `aplicar-migrations.yml`, do mais novo para o mais
  antigo; ele apaga a linha da versao no ledger na mesma transacao.
- NUNCA `vercel alias set` por endereco: e o que criou a divergencia de 05/10. Se for inevitavel
  numa emergencia, a conferencia da frota acusa (`ENDERECO_ANTIGO`) ate o proximo promote.

## Edge functions por loja

| Loja | Banco | Canal |
|---|---|---|
| IKCOUS (`ickous-marketplace`) | `cafkrminfnokvgjqtkle` | `projeto=ikcous-publicada` (segredo `SUPABASE_ACCESS_TOKEN_IKCOUS`) |
| Savy | `gnjsrucsmjkajijrakzr` | `projeto=savy` (segredo `SUPABASE_ACCESS_TOKEN_SAVY`), banco e functions |
| Almeida, Brand Meliz, Space | — | lojas de teste: banco e functions nao se mexem |

`ikcous-publicada` e `savy` aceitam nas functions so as cinco financeiras e exigem `expected_sha`
igual ao SHA do run. O destino `loja` das functions (`dekxabvqdsuukijblazl`) e o projeto antigo
da principal; nos workflows de banco `loja` aponta para a CAF sem as travas da CAF explicita
(achado registrado, fora deste escopo).

## Rollback integral da configuracao do repositorio

- Ignore step: `commandForIgnoringBuildStep = null`.
- Ruleset: remover `producao-unica-fonte` (id 24166103).
