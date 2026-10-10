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
      o caso da IKCOUS (CAF), que recebeu 92..202 sem registro. A `8e` aceita, funcao por funcao, o
      corpo da `20261199000000` OU o das sucessoras dela (`20261212000000` em `painel_inicio`,
      `20261214000000` em `get_admin_analytics_v2`, do lote 17, item 15): a loja que ja recebeu o
      lote 17 segue com a `8e` POSITIVA e o backfill nao trava. Limite conhecido: a pre-checagem e
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
      `ikcous-publicada` e `savy` saem as cinco financeiras mais a `send-order-confirmation`
      (desde 09/10/2026: o comprovante do balcao divide `_shared/pedido.ts` e `comprovante.ts`
      com `criar-pagamento`, `webhook-mercadopago`, `reconciliar-pagamentos` e a propria
      `send-order-confirmation`, entao a release travaria se esses arquivos mudassem sem poder
      publicar a function do e-mail). Essa lista e `functionsPublicaveis` em
      `canais-de-backend.json`, o que o workflow aceita (um teste exige que as duas concordem).
      **Desfazer a `send-order-confirmation`:** NAO e disparar o workflow no SHA antigo (o
      workflow daquele commit recusa a function nas duas lojas). E `git revert` dos commits do
      texto num commit NOVO do ramo principal e publicar esse SHA pelo caminho normal. So a
      IKCOUS guarda o retrato "ANTES"; na Savy, anote a versao no ar antes de publicar.
      **Se a release mudar outra function**
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

  11. **Lote de DUAS migrations, de apply normal: `20261205000000` + `20261206000000` (o cupom
      preso diz quando a vaga volta; a vaga do pedido nunca cobrado volta em cerca de 1 h).** Sem
      `backfillLedger` e sem `nuncaAplicar`; vale nas duas lojas assinantes (IKCOUS e Savy). A
      20261205 cria a RPC `vaga_do_cupom_presa(text)` (a tela pergunta quando a vaga do cupom
      volta) e o auxiliar `cupom__vaga_volta_em(...)`; a 20261206 reescreve a varredura
      `devolver_cupons_de_pedidos_mortos()` e o auxiliar. As duas vao JUNTAS e em ordem (a 20261206
      exige a 20261205 no banco). Duas consultas, so leitura e de ROL FECHADO (so valem com
      `rol=ok`), sobre o catalogo e o agendador (`cron.job`: so `jobname`, `schedule` e `active`):
      - **`12a-conferir-cupom-preso-aplicado`** (a consulta do lote, 24 linhas) prova as TRES
        funcoes DEPOIS do apply: uma sobrecarga so de cada, corpo com o sha256 das migrations (LF ou
        CRLF), a RPC `SECURITY DEFINER` com `search_path=public` e `EXECUTE` so para authenticated, o
        auxiliar sem `EXECUTE` para PUBLIC, anon, authenticated e service_role, a varredura sem
        `EXECUTE` para PUBLIC, anon e authenticated; o DONO da varredura e o DONO da RPC com
        `EXECUTE` no auxiliar (se divergirem e nao tiverem, a varredura falha em TODO ciclo e as
        vagas deixam de voltar, sem erro visivel); `devolver_uso_cupom(uuid)` e `auth.uid()`
        existem; e o job `devolver-cupons-de-pedidos-mortos` agendado a cada 15 minutos e ATIVO.
      - **`12b-antes-cupom-preso-funcoes-ausentes`** (`ausenciaConfirmadaPor`, 10 linhas) prova o
        ANTES, as mesmas condicoes dos pre-voos das duas migrations: auxiliar e RPC ausentes, a
        varredura com UMA sobrecarga e o corpo da 20260970000000 (sha256), as dependencias, as
        tabelas e colunas que as funcoes leem, e o job agendado e ativo.
      - **Caminho, uma loja por vez, e ordem com o front:** ledger sem as versoes e sem evidencia →
        `12a` (sai NEGATIVA: as migrations ainda nao estao no banco) → `12b` MAIS NOVA que a `12a` e
        POSITIVA → UM comando `aplicar-migrations.yml` com os DOIS arquivos, `20261205000000_...sql`
        e `20261206000000_...sql` nesta ordem (cada apply grava o ledger na mesma transacao) → o
        ensaio pede a `12a` DE NOVO, que tem de sair POSITIVA → so entao o front desta release (o
        banco novo de CADA loja primeiro; com o banco novo e o front velho a tela segue como
        estava, porque a RPC so e chamada pela tela nova, e so muda a varredura, abaixo). `12a` POSITIVA com as versoes fora do ledger e
        PARAR (sem backfill: registrar a mao e decisao do dono). `12a` e `12b` NEGATIVAS, ou so a
        20261205 aplicada (a `12b` reprova porque o auxiliar ja existe): PARAR, diagnostico com o
        dono, nenhum apply.
      - **`NAO VERIFICAVEL` na linha do job:** o `cron.job` tem RLS, e um papel que SOFRE essa RLS
        pode ver zero jobs mesmo com o job rodando. So quando a RLS vale para o papel
        (`row_security_active('cron.job')`) E ele ve zero jobs, a linha diz `NAO VERIFICAVEL` nas
        duas colunas e fica `ok`. **A release passa em silencio com essa linha**, porque
        `publicar-release.mjs` so conta `ok_false`. Quando a linha sai assim, conferir a mao o job
        `devolver-cupons-de-pedidos-mortos` no painel do Supabase (Database -> Cron): ativo e
        `*/15 * * * *`. Um papel que atravessa a RLS (BYPASSRLS, como o `supabase_read_only_user`)
        com zero jobs REPROVA a linha como `AUSENTE`; um papel que ve o job e estrito (ausente,
        inativo ou fora de `*/15` reprova). A consulta nao le o comando do job.
      - **MUDANCA DE COMPORTAMENTO (acontece no apply da 20261206, nao no front):** a varredura
        passa a devolver a vaga do cupom de um pedido NUNCA cobrado (sem id de cobranca gravado e
        zero tentativas de pagamento) 45 minutos depois de `expires_at`, em vez de 24 h depois — para
        o cliente, cerca de 1 h em vez de cerca de 1 dia. Pedido que chegou a ser cobrado segue com
        as 24 h, e pedido pago, enviado ou ja devolvido nunca devolve. O apply so CRIA/REESCREVE
        funcoes (nenhuma linha de dado muda ao aplicar), mas o PROXIMO ciclo do job (a cada 15 min)
        ja usa a regra nova. Essa pista rapida so e segura porque, com a vaga de cobranca vazia,
        `confirmar_pagamento` devolve `divergente`; depende de dois pontos de codigo das edge
        functions que o banco NAO prova: `criar-pagamento` nunca manda cartao ao Mercado Pago sem
        ocupar a vaga, e `webhook-mercadopago` so adota cobranca para cartao (teste no
        `index_test.ts` do webhook). Se um dia o webhook passar a adotar PIX, essa pista precisa ser
        revista.
      - **Depois do lote 16 (PIX anulado, item 14) a `12a` aceita TAMBEM o estado que ele deixa:** o
        auxiliar de 13 parametros e os tres corpos da `20261210000000`, todos do mesmo estado (misturar
        reprova). Sem isso a loja que recebesse o lote 16 ficaria com a prova deste lote vermelha para
        sempre e o portao bloquearia a release.
      - **Depois do merge:** mudar `conferir-banco.cjs` ou o workflow invalida a evidencia antiga:
        rodar a `12a` e a `12b` DEPOIS da ultima mudanca nesses arquivos.
      - **Limites:** `tests/banco/cupom-preso-portao-viva.cjs` (Postgres 17 efemero, no
        `rpc-ci.yml`) prova que as consultas DECIDEM certo, nao que a IKCOUS ou a Savy estao no estado
        A ou B; o `supabase_read_only_user`, o pg_cron real e o Postgres 15 da Supabase nao foram
        medidos ali (o stub local do cron nao tem `active`; a prova o acrescenta).

  12. **Lote de UMA migration, de apply normal: `20261207000000` (a coluna duplicada de contagem de
      uso do cupom, `coupons.used_count`, e apagada; politica P4 do dono).** Sem `backfillLedger` e sem
      `nuncaAplicar`; vale nas duas lojas assinantes (IKCOUS e Savy). O dono aprovou apagar
      CONDICIONADO a medir tudo zero (consulta `13a`, so leitura, ja medida em 09/10/2026: nenhum
      valor diferente de zero, nenhum nulo, nenhum dependente). A coluna e uma copia morta de
      `usage_count`, que e quem conta os usos; nenhuma RPC, gatilho, edge ou tela a escreve ou le.
      Duas consultas, so leitura e de ROL FECHADO (so valem com `rol=ok`):
      - **`14a-conferir-contador-duplicado-apagado`** (a consulta do lote, 4 linhas) prova DEPOIS do
        apply: `public.coupons` presente; `used_count` AUSENTE; `usage_count` segue la na forma do
        baseline (`integer`, aceita NULL, `DEFAULT 0`). Ela **nao** trava corpo de funcao: a migration
        nao toca funcao nenhuma, e a `10a` e a `12a` ja travam o corpo de `validate_coupon_secure_v2`
        e de `devolver_cupons_de_pedidos_mortos` nos lotes delas (travar o mesmo hash aqui deixaria
        este lote vermelho a cada migration futura que mudasse essas funcoes).
      - **`14b-antes-contador-duplicado-coluna-presente-e-zerada`** (`ausenciaConfirmadaPor`, 13
        linhas) prova o ANTES, as mesmas condicoes do pre-voo da migration. **Atencao: aqui o "antes"
        e o CONTRARIO do item 11 (12b):** a coluna tem de estar PRESENTE (nao ausente), na forma do
        baseline (integer, aceita NULL, DEFAULT 0), `usage_count` na MESMA forma (e o contador que
        fica e o que a `14a` cobra depois: sem isso a loja passaria na `14b`, apagaria e a `14a` sairia
        NEGATIVA), com ZERO linhas de valor diferente de 0 (NULL conta), a seguranca por linha sem esconder cupom do papel que mede, ZERO dependentes da
        coluna (visao, politica, gatilho, indice, constraint, coluna GERADA que a cita; so o DEFAULT
        da propria coluna fica de fora), a coluna SEM permissao propria por coluna e SEM comentario
        (o `DROP COLUMN` apaga os dois e o rollback so recria a coluna: por isso a recusa) e nenhuma funcao de QUALQUER schema que nao seja do sistema (fora
        `pg_catalog`, `information_schema` e `pg_toast`; recusa conservadora: se um schema da
        plataforma tiver o texto, a medicao mostra e nada se perde), politica, gatilho ou visao de
        `public` que a cite. O portao so exige que a consulta do antes seja POSITIVA (da mesma janela ou mais nova
        que a do lote NEGATIVA); nao interpreta o que ela mede.
      - **Caminho, uma loja por vez, e ordem com o front:** ledger sem a versao e sem evidencia →
        `14a` (sai NEGATIVA: a coluna ainda existe) → `14b` MAIS NOVA que a `14a` e POSITIVA → UM
        comando `aplicar-migrations.yml` com `20261207000000_o_contador_duplicado_do_cupom_morre.sql`
        (o apply grava o ledger na mesma transacao) → o ensaio pede a `14a` DE NOVO, que tem de sair
        POSITIVA. `14b` NEGATIVA (valor diferente de 0, NULL ou dependente): **PARAR, e o dono decide**
        (nada e apagado: a migration refaz a mesma condicao dentro da transacao e recusa). `14a`
        POSITIVA com a versao fora do ledger: PARAR (sem backfill). Banco novo com front velho nao
        quebra (o front le `coupons` com `select *`); o front desta release so deixa de ter a coluna
        nos tipos gerados.
      - **O que o apply faz e nao faz:** APAGA UMA COLUNA; nenhuma linha de `coupons` muda e nenhum
        `usage_count` e tocado. A migration trava a tabela em `ACCESS EXCLUSIVE` ANTES de conferir e
        ate o `COMMIT` (a leitura de cupom no checkout espera; e `ACCESS EXCLUSIVE`, e nao
        `SHARE ROW EXCLUSIVE`, porque um pedido em andamento segura a linha do cupom e so depois grava
        nela: com a trava mais fraca havia deadlock e o pedido podia morrer) e usa `lock_timeout` de
        5 s: se alguem, por exemplo um pedido que pegou a linha do cupom, segurar a tabela por mais
        que isso ela FALHA sem gravar (erro 55P03) e basta repetir. Sem `CASCADE`. Desfazer:
        `rollback-manual-20261207000000_o_contador_duplicado_do_cupom_morre.sql` recria a coluna
        igual a do baseline com 0 em todas as linhas (e como so apagou com tudo 0, e o estado exato
        de antes); executar pelo WORKFLOW `aplicar-migrations.yml` com esse arquivo (secao Rollback >
        Banco: ele apaga a linha da versao do ledger na mesma transacao), NUNCA por `psql` direto: a
        coluna voltaria com o ledger ainda dizendo "aplicada" e o portao PARARIA; ninguem tem
        credencial `psql` direta nas lojas.
      - **Quanto tempo a tabela fica travada (aplicar FORA DO HORARIO DE PICO):** a trava exclusiva
        do `DROP COLUMN` fica ate o `COMMIT`, e no envelope do workflow isso inclui a impressao digital
        DEPOIS (md5 de 11 tabelas do dinheiro; `coupons` nao e uma delas, mas a trava segue ate o
        `COMMIT` do mesmo jeito): validar cupom no checkout ESPERA todo esse tempo, nao so a fracao
        de segundo do `DROP`. O `statement_timeout` de 30 s da migration vale
        ate o fim da transacao e tambem limita cada comando seguinte do envelope: se algum passar
        disso o apply FALHA sem gravar nada e basta repetir.
      - **Depois do merge:** mudar `conferir-banco.cjs` ou o workflow invalida a evidencia antiga:
        rodar a `14a` e a `14b` DEPOIS da ultima mudanca nesses arquivos.
      - **Limites:** `tests/banco/contador-duplicado-portao-viva.cjs` e
        `tests/banco/contador-duplicado-viva.cjs` (Postgres 17 efemero, no `rpc-ci.yml`) provam que as
        consultas DECIDEM certo e que a migration recusa/aplica como descrito, nao que a IKCOUS ou a
        Savy estao no estado A ou B. Uma gravacao em `used_count` entre a `14b` e o apply nao e vista
        pela `14b`: quem a fecha e o pre-voo da migration, assim: a trava (`ACCESS EXCLUSIVE`)
        impede quem le ou grava DEPOIS do `LOCK`; o workflow aplica em transacao `REPEATABLE READ` e tira a
        foto da impressao digital ANTES do `LOCK`, entao o pre-voo faz `FOR SHARE` nas linhas, e sob
        esse nivel QUALQUER `UPDATE` posterior a foto faz a migration RECUSAR (erro `40001`, o
        workflow mostra `ESTADO DESCONHECIDO`; nada e gravado e basta repetir). **Risco residual
        aceito:** um `INSERT` com `used_count` explicito diferente de zero, gravado nos segundos entre
        a foto e o `LOCK`, nao e visto; ninguem grava essa coluna (nenhuma RPC, gatilho, edge ou tela).

  13. **Lote de UMA migration, de apply normal: `20261208000000` (o checkout mostra os cupons da
      cliente).** Sem `backfillLedger` e sem `nuncaAplicar`; vale nas duas lojas assinantes (IKCOUS e
      Savy). A migration CRIA: `coupons.alcance` (`text NOT NULL DEFAULT 'codigo'`, com CHECK dos
      tres valores), a tabela `cupom_clientes` (RLS ligada, UMA politica de leitura que exige o admin
      ATUAL), tres funcoes (`cupons_do_checkout(numeric)` para anon e authenticated;
      `admin_cupom_clientes(uuid)` e `admin_cupom_definir_clientes(uuid, uuid[])` so para
      authenticated), o gatilho `tr_pedido_com_cupom_so_nasce_para_a_lista` (com a funcao dele, sem
      EXECUTE para ninguem) e TROCA o corpo de `validate_coupon_secure_v2`, partindo do corpo da
      `20261203000000` (cupons desligados, #777). Duas consultas, so leitura e de ROL FECHADO (so
      valem com `rol=ok`; o numero 16 e do PIX):
      - **`15a-conferir-cupons-do-checkout-aplicado`** (a consulta do lote, 37 linhas) prova DEPOIS do
        apply, cada linha com o nome do objeto que reprovou: a coluna `alcance` (tipo, NOT NULL,
        default) e o CHECK validado; `cupom_clientes` (colunas, RLS, politicas, regra da politica,
        privilegios de authenticated, anon e PUBLIC); para CADA uma das 5 funcoes a quantidade de
        sobrecargas, a forma (linguagem, volatilidade, SECURITY DEFINER, `search_path`, retorno), o
        corpo (sha256 de 10 hashes recalculados do arquivo da migration, LF e CRLF) e o EXECUTE por
        papel; o gatilho (existe, BEFORE INSERT, habilitado, WHEN, funcao executada) e a ORDEM dele
        depois de `tr_pedido_com_cupom_exige_a_chave_ligada` (gatilhos do mesmo tipo disparam em
        ordem de nome); e o indice unico da chave de compra. Uma migration futura que troque o corpo
        de `validate_coupon_secure_v2` precisa atualizar o hash da `15a`.
      - **`15b-antes-cupons-do-checkout-pecas-ausentes`** (`ausenciaConfirmadaPor`, 15 linhas) prova o
        ANTES, as condicoes do pre-voo da migration: NENHUMA das pecas novas existe (coluna, CHECK,
        tabela, as 4 funcoes, o gatilho: em qualquer assinatura e qualquer estado), e o que ela PRECISA
        ja existe: as 16 colunas que as pecas leem, `is_admin`, `is_admin_atual` e `rls_admin_atual`, o
        gatilho `tr_pedido_com_cupom_exige_a_chave_ligada` ATIVO (BEFORE INSERT), o indice unico da
        chave de compra e o corpo vivo de `validate_coupon_secure_v2` igual ao da `20261203000000`.
        **Por isso o lote so fecha depois que a `20261203000000` esta no banco da loja** (senao a
        `15b` sai NEGATIVA e o portao PARA).
      - **Caminho, uma loja por vez:** ledger sem a versao e sem evidencia → `15a` (sai NEGATIVA: a
        migration ainda nao esta) → `15b` MAIS NOVA que a `15a` e POSITIVA → UM comando
        `aplicar-migrations.yml` com `20261208000000_o_checkout_mostra_os_cupons_da_cliente.sql`
        (o apply grava o ledger na mesma transacao) → o ensaio pede a `15a` DE NOVO, que tem de sair
        POSITIVA. `15b` NEGATIVA (meia migration, gatilho da 20261203 ausente, corpo da validacao fora
        do da 20261203): **PARAR, e o dono decide** (nada e aplicado). `15a` POSITIVA com a versao
        fora do ledger: PARAR (sem backfill).
      - **O que o apply faz e nao faz com o que ja existe:** ADITIVO. Nenhuma linha de cupom, de
        pedido ou de cliente e lida nem reescrita (`ADD COLUMN ... DEFAULT 'codigo'` e constante) e
        todo cupom que ja existe passa a valer `'codigo'`, o que ele ja era (so quem tem o codigo).
        Duas diferencas visiveis num cupom ANTIGO, ambas so de texto ou de instante: a recusa por
        minimo agora diz quanto falta e o cupom vence NO instante de `valid_until`. O unico `DROP` e
        o da politica da tabela nova, recriada na hora. Rodar duas vezes e o mesmo que rodar uma (o
        pre-voo aceita o corpo da 20261203 OU o que a migration deixa).
      - **Trava e horario:** o pre-voo trava `coupons` (ACCESS EXCLUSIVE), `profiles` e
        `marketplace_orders` (SHARE ROW EXCLUSIVE) com `lock_timeout` de 5 s: um pedido em andamento
        que segure a linha do cupom faz a migration FALHAR sem gravar nada (55P03) e basta repetir.
        Cancelamento e pedido pegam `coupons` e `marketplace_orders` em ordem oposta: se um
        cancelamento em andamento cruzar com a trava, o Postgres desfaz UM dos dois (40P01, ou a
        migration, e basta repetir, ou o cancelamento, e a tela pede para tentar de novo). **Aplicar
        FORA DO HORARIO DE PICO.**
      - **Ordem com o front:** o banco de CADA loja primeiro, o site novo logo depois. Banco novo com
        front velho nada muda para quem compra. **NAO marcar "Clientes escolhidos" num cupom antes do
        site novo estar no ar:** o painel antigo nao mostra nem preserva a lista (e o checkout antigo
        guarda o codigo no rascunho sem dizer de quem ele e).
      - **Desfazer (decisao do DONO, nunca automatica):**
        `rollback-manual-20261208000000_o_checkout_mostra_os_cupons_da_cliente.sql`, pelo
        `aplicar-migrations.yml` (secao Rollback > Banco: apaga a linha da versao do ledger na mesma
        transacao). **APAGA dado da lojista:** a lista de clientes de cada cupom exclusivo e a coluna
        `alcance` (quem escolheu "todos os clientes" ou "clientes escolhidos" perde a escolha). DESATIVA
        todo cupom exclusivo ANTES de apagar a coluna (a volta nunca abre um exclusivo para quem tiver o
        codigo); os de "todos os clientes" voltam a ser secretos (somem do checkout, o codigo continua
        valendo). Devolve `validate_coupon_secure_v2` ao corpo da 20261203 byte a byte e nao toca o
        gatilho da chave desligada. Reativar um ex-exclusivo depois o torna publico para quem tiver o
        codigo: so reative o que pode ser publico. Depois do rollback a `15b` volta a ser POSITIVA e a
        `15a` NEGATIVA (provado em `tests/banco/cupons-do-checkout-portao-viva.cjs`).
      - **Depois do merge:** mudar `conferir-banco.cjs` ou o workflow invalida a evidencia antiga:
        rodar a `15a` e a `15b` DEPOIS da ultima mudanca nesses arquivos.
      - **Limites:** `tests/banco/cupons-do-checkout-portao-viva.cjs` e
        `tests/banco/cupons-do-checkout-viva.cjs` (Postgres 17 efemero, no `rpc-ci.yml`) provam que as
        consultas DECIDEM certo (cada defeito reprova a PROPRIA linha, 34 mutantes do texto das
        consultas ficam vermelhos, ida, volta e ida) e que a migration aplica e desfaz como descrito;
        nao provam que a IKCOUS ou a Savy estao no estado A ou B (so o run da consulta contra o ref de
        cada loja diz). O `supabase_read_only_user` real e o Postgres 15 da Supabase nao foram medidos
        ali. A `15a` nao le dado: nao prova que cupons antigos continuam `'codigo'` (quem garante e o
        `NOT NULL DEFAULT`). PK, chaves estrangeiras e MAINTAIN de `cupom_clientes` nao sao medidos.
        O passo-a-passo para o dono esta em [publicar-cupons-no-checkout.md](publicar-cupons-no-checkout.md).

  14. **Lote de DUAS migrations, de apply normal: `20261209000000` (a foto da cobranca no
      cancelamento) e `20261210000000` (a vaga do cupom do PIX anulado volta em minutos).** Sem
      `backfillLedger` e sem `nuncaAplicar`; valem as duas lojas assinantes (IKCOUS e Savy). As duas
      vao JUNTAS e EM ORDEM (a segunda exige a foto da primeira); sao ADITIVAS (nenhuma tabela,
      coluna ou linha de dado existente e apagada; a segunda so apaga a funcao de 9 parametros que
      ela mesma recria com 13). A `20261209000000` CRIA a tabela `pedido_cobranca_ao_cancelar` (RLS
      ligada, nenhuma politica, nenhum privilegio para PUBLIC/anon/authenticated/service_role), a
      funcao `pedido__foto_da_cobranca_ao_cancelar()` (SECURITY DEFINER, sem EXECUTE para ninguem) e o
      gatilho `tr_pedido_foto_da_cobranca_ao_cancelar` (AFTER UPDATE OF status, WHEN o pedido vira
      `cancelled`): grava a foto da cobranca no instante do cancelamento. A `20261210000000` TROCA tres
      funcoes para lerem a foto: o auxiliar `cupom__vaga_volta_em` (de 9 para 13 parametros), a RPC
      `vaga_do_cupom_presa` e a varredura `devolver_cupons_de_pedidos_mortos`. Duas consultas, so
      leitura e de ROL FECHADO (so valem com `rol=ok`):
      - **`16a-conferir-pix-anulado-aplicado`** (a consulta do lote, 32 linhas) prova DEPOIS do apply:
        a tabela da foto (colunas com tipo, NOT NULL e default; chave primaria; chave estrangeira com
        CASCADE; RLS ligada; nenhuma politica; nenhum privilegio, de tabela ou de coluna, para os 4
        papeis); a funcao da foto (sobrecargas, forma, corpo sha256, sem EXECUTE); o gatilho (existe,
        AFTER UPDATE OF status por linha, habilitado, WHEN, funcao executada); o auxiliar so de 13
        parametros (a de 9 sumiu); a RPC e a varredura com os corpos da `20261210000000` (sha256, LF e
        CRLF), forma e EXECUTE; os donos da varredura e da RPC com EXECUTE no auxiliar;
        `devolver_uso_cupom` e o job de 15 em 15 minutos ativo. Uma migration futura que troque o
        corpo de uma dessas funcoes precisa atualizar os hashes da `16a`.
      - **`16b-antes-pix-anulado-foto-ausente`** (`ausenciaConfirmadaPor`, 14 linhas) prova o ANTES,
        as condicoes dos pre-voos: a tabela, a funcao (qualquer sobrecarga) e o gatilho da foto NAO
        existem; as 12 colunas de `marketplace_orders` que as pecas leem existem (as seis da foto com
        o tipo); o auxiliar e o de 9 parametros e a RPC e a varredura tem os corpos de
        `20261205000000`/`20261206000000`, uma sobrecarga cada; `devolver_uso_cupom` existe e o job
        esta ativo. **Por isso o lote so fecha depois que a `20261205`/`20261206` estao no banco da
        loja** (senao a `16b` sai NEGATIVA e o portao PARA).
      - **Caminho, uma loja por vez:** ledger sem as versoes e sem evidencia → `16a` (sai NEGATIVA: as
        migrations ainda nao estao) → `16b` MAIS NOVA que a `16a` e POSITIVA → UM comando
        `aplicar-migrations.yml` com os DOIS arquivos, `20261209000000_a_foto_da_cobranca_no_cancelamento.sql`
        e `20261210000000_a_vaga_do_cupom_do_pix_anulado_volta_em_minutos.sql`, nessa ordem (cada apply
        grava o ledger na mesma transacao) → o ensaio pede a `16a` DE NOVO, que tem de sair POSITIVA.
        `16b` NEGATIVA (a foto ja existe, so a `20261209` aplicada, corpo de uma funcao diferente):
        **PARAR, e o dono decide** (nada e aplicado). `16a` POSITIVA com a versao fora do ledger:
        PARAR (sem backfill). Banco com so a `20261209` aplicada (a segunda falhou ou nao rodou): as
        duas consultas reprovam e e PARAR, para diagnostico.
      - **A `12a` (lote do cupom preso) aceita os DOIS estados.** Com a loja servindo dois SHAs o
        portao exige a prova de TODO lote; depois da `20261210000000` o auxiliar tem 13 parametros e
        as tres funcoes trocam de corpo, e a `12a` antiga ficaria vermelha para sempre e bloquearia a
        release. Agora a `12a` decide o estado pelo auxiliar (13 parametros = `20261210`, senao
        `20261206`) e exige os tres corpos do MESMO estado; estado misturado reprova na linha do corpo
        que destoa (nao funciona: a varredura chamaria o auxiliar com a assinatura errada). Provado em
        `tests/banco/cupom-preso-portao-viva.cjs`.
      - **MUDANCA DE COMPORTAMENTO (acontece no apply da `20261210`, nao no front):** o cupom de um
        pedido cancelado com o PIX gerado volta quando o prazo do PIX acaba (`expires_at`, ate ~45 min
        depois da criacao do pedido; nunca antes, porque o admin pode reativar um pedido cancelado) mais
        o ciclo de 15 min da varredura, em vez de 24 h depois, SE E SOMENTE SE a foto prova que nunca
        houve cartao (id de PIX na vaga, zero tentativas, metodo `pix`, `aguardando`) e agora o pedido
        esta cancelado, `aguardando`, com a vaga vazia e exatamente uma tentativa. No instante do clique
        NAO volta. Pedido cancelado ANTES da `20261209` nao tem foto e segue com o prazo de 24 h; pedido
        pago, enviado ou ja devolvido nunca devolve.
      - **PRE-CONDICAO DA PUBLICACAO (o banco NAO prova): medir a versao das FUNCTIONS no ar em CADA
        loja (IKCOUS e Savy)**, nao so o `version.json` do front. A pista rapida so e segura porque
        `criar-pagamento` nunca manda cartao ao Mercado Pago sem ocupar antes a vaga de cobranca
        (reserva antes do POST, de 02/10/2026) e `webhook-mercadopago` so adota cobranca para cartao
        (teste no ramo `test/pix-anulado-webhook-20261009`, `supabase/functions/webhook-mercadopago/index_test.ts`).
        Se a data no ar for anterior a do SHA da release, publicar essas functions ANTES do apply do
        banco. Como medir, passo a passo, em
        [publicar-pix-anulado-devolve-cupom.md](publicar-pix-anulado-devolve-cupom.md). O portao nao
        impoe esta ordem (banco → functions → front): e passo do operador.
      - **Ordem:** o banco de CADA loja primeiro (IKCOUS, depois Savy, FORA DO HORARIO DE PICO), o
        site logo depois. Banco novo com site velho nada muda para quem compra. A `20261209` pega
        `marketplace_orders` em `SHARE ROW EXCLUSIVE` sem ficar na fila (tenta e dorme, ate 4 s): se um
        pedido em andamento nao terminar, ela FALHA sem gravar (55P03) e basta repetir. A `20261210`
        nao pede trava de tabela.
      - **Desfazer (decisao do DONO, nunca automatica), nesta ordem:**
        `rollback-manual-20261210000000_a_vaga_do_cupom_do_pix_anulado_volta_em_minutos.sql` e DEPOIS
        `rollback-manual-20261209000000_a_foto_da_cobranca_no_cancelamento.sql`, cada um pelo
        `aplicar-migrations.yml` (secao Rollback > Banco: apaga a linha da versao do ledger na mesma
        transacao). O da `20261210` devolve as tres funcoes aos corpos antigos byte a byte e NAO toca
        dado (o cupom ja devolvido continua devolvido). O da `20261209` APAGA as fotos ja gravadas
        (so servem para antecipar a vaga; nenhum pedido, cupom ou pagamento e tocado) e recusa
        enquanto as funcoes da `20261210` citarem a tabela. Depois dos dois a `16b` volta a ser
        POSITIVA e a `16a` NEGATIVA (provado em `tests/banco/cupom-pix-anulado-portao-viva.cjs`).
      - **Depois do merge:** mudar `conferir-banco.cjs` ou o workflow invalida a evidencia antiga:
        rodar a `16a` e a `16b` DEPOIS da ultima mudanca nesses arquivos.
      - **Limites:** `tests/banco/cupom-pix-anulado-portao-viva.cjs` e
        `tests/banco/cupom-pix-anulado-viva.cjs` (Postgres 17 efemero, no `rpc-ci.yml`) provam que as
        consultas DECIDEM certo (cada defeito reprova a PROPRIA linha; mutantes do texto das consultas
        ficam vermelhos; ida e volta pelos dois rollbacks) e que as migrations aplicam e desfazem como
        descrito; nao provam que a IKCOUS ou a Savy estao no estado A ou B (so o run da consulta contra
        o ref de cada loja diz). O `supabase_read_only_user` real, o pg_cron real e o Postgres 15 da
        Supabase nao foram medidos ali. A linha de EXECUTE da varredura nao cobre `service_role` (como a
        `12a`). A `16a`/`16b` nao leem dado: nao dizem se ha pedido com cupom, pedido cancelado ou foto.
        O passo-a-passo para o dono esta em
        [publicar-pix-anulado-devolve-cupom.md](publicar-pix-anulado-devolve-cupom.md).

  15. **Lote de TRES migrations INDEPENDENTES, de apply normal: `20261212000000` (o Inicio conta
      estoque baixo pela regra da loja), `20261213000000` (o filtro de estoque baixo do admin segue a
      regra) e `20261214000000` (o lucro do estoque so conta produto com custo).** Sem
      `backfillLedger` e sem `nuncaAplicar`; valem as duas lojas assinantes (IKCOUS e Savy). Cada uma
      so troca o CORPO de UMA funcao (`CREATE OR REPLACE` atras do pre-voo `B1_BASELINE_DIVERGENT`):
      a `20261212000000` o de `painel_inicio()`, a `20261213000000` o de
      `get_admin_products_paged(text,text,text,text,integer,integer)` e a `20261214000000` o de
      `get_admin_analytics_v2(integer)`. Dono, ACL, assinatura, SECURITY DEFINER e search_path ficam
      iguais; nenhuma linha de dado e lida ou reescrita ao aplicar; nenhuma trava de tabela; nenhuma
      edge function depende delas. Duas consultas, so leitura, so catalogo e de ROL FECHADO (so valem
      com `rol=ok`):
      - **`17a-conferir-estoque-do-painel-aplicado`** (a consulta do lote, 14 linhas) prova DEPOIS do
        apply, funcao por funcao: UMA sobrecarga, a forma (linguagem, volatilidade, SECURITY DEFINER,
        search_path e retorno), o corpo do lote (sha256, LF ou CRLF) e o EXECUTE `PUBLIC=nao anon=nao
        authenticated=sim`, mais as 10 colunas de `produtos` e `product_variants` que os trechos novos
        leem. A proxima migration que redefinir uma dessas tres funcoes precisa atualizar a `17a`
        (senao, depois do apply dela, a `17a` fica NEGATIVA e o portao PARA).
      - **`17b-antes-estoque-do-painel-corpos-vigentes`** (`ausenciaConfirmadaPor`, 11 linhas) prova
        o ANTES, as condicoes dos pre-voos: os tres corpos VIGENTES (o da `20261199000000` para
        `painel_inicio` e `get_admin_analytics_v2`, o da baseline para `get_admin_products_paged`),
        UMA sobrecarga, o mesmo EXECUTE (o `CREATE OR REPLACE` preserva a ACL: loja fora dele PARA
        aqui, antes de escrever) e as mesmas colunas.
      - **Caminho, uma loja por vez:** ledger sem as versoes e sem evidencia → `17a` (sai NEGATIVA:
        as migrations ainda nao estao) → `17b` MAIS NOVA que a `17a` e POSITIVA → UM comando
        `aplicar-migrations.yml` com os TRES arquivos,
        `20261212000000_o_inicio_conta_estoque_baixo_pela_regra_da_loja.sql`,
        `20261213000000_o_filtro_de_estoque_baixo_do_admin_segue_a_regra.sql` e
        `20261214000000_o_lucro_do_estoque_so_conta_produto_com_custo.sql`, na ordem 12, 13, 14 (sao
        independentes: a ordem nao muda o resultado; cada apply grava o ledger na mesma transacao) →
        o ensaio pede a `17a` DE NOVO, que tem de sair POSITIVA. `17a` POSITIVA com as versoes fora do
        ledger: PARAR (sem backfill; registrar a versao a mao e decisao do dono).
      - **ESTADO PARCIAL** (so parte das tres no banco ou no ledger): a `17a` reprova o corpo das que
        faltam e a `17b` o das que entraram, e o portao PARA (nunca reaplica pela metade). As duas
        saidas, com o dono: (a) o rollback-manual do que entrou e o lote inteiro de novo; ou (b)
        aplicar a mao as que faltam pelo `aplicar-migrations.yml` e rodar a `17a`.
      - **A `8e` (lote 92-202) aceita os DOIS estados.** Funcao por funcao, a `8e` aceita o corpo da
        `20261199000000` OU o da sucessora (`20261212000000` para `painel_inicio`, `20261214000000`
        para `get_admin_analytics_v2`; `get_admin_products_paged` nao e das 61): ela segue POSITIVA
        antes, durante e depois deste lote, e a frase das migrations "Aplicar numa loja SO depois do
        backfill 92-202" vira precaucao. Provado em `tests/banco/portao-8e-aceita-sucessoras-viva.cjs`
        e, em todos os estados deste lote (inclusive os mistos e o CRLF), em
        `tests/banco/estoque-do-painel-portao-viva.cjs`.
      - **Ordem:** o banco de CADA loja primeiro (IKCOUS, depois Savy, fora do horario de pico) e o
        front desta release logo depois. Banco novo com front velho: os numeros ja saem pela regra da
        loja (o estoque baixo do Inicio e do filtro, e o lucro do estoque menor e honesto), so o rotulo
        de `AdminProductsView` ainda nao diz "So com custo". Front novo com banco velho:
        `AdminProductsView` diz "So com custo" mas o banco ainda soma o valor de venda de produto sem
        custo (o lucro sai inflado), por isso o banco vem antes.
      - **Desfazer (decisao do DONO, nunca automatica):** os tres rollback-manual
        (`rollback-manual-20261212000000_o_inicio_conta_estoque_baixo_pela_regra_da_loja.sql`,
        `rollback-manual-20261213000000_o_filtro_de_estoque_baixo_do_admin_segue_a_regra.sql` e
        `rollback-manual-20261214000000_o_lucro_do_estoque_so_conta_produto_com_custo.sql`), cada um
        pelo `aplicar-migrations.yml` (secao Rollback > Banco: apaga a linha da versao do ledger na
        mesma transacao), NUNCA por `psql` direto (o cabecalho do rollback-manual diz `psql -1 -f`;
        nao siga): o ledger ficaria com a versao e o portao pula o lote sem pedir a `17a`. Com o
        ledger completo e o lote ja no SHA que a loja serve, o portao nem chega a decidir o lote
        (`publicar-release.mjs`: `!faltam.length && !exigeProva`, sem consulta nenhuma): o front novo
        e promovido sobre o banco velho, `AdminProductsView` diz "So com custo" enquanto o banco volta
        a somar o valor de venda de produto sem custo (o lucro do estoque sai inflado) e nenhum alarme
        dispara. Os tres sao independentes entre si (qualquer ordem), devolvem cada corpo ao de antes
        byte a byte e nao tocam dado. TODOS vem ANTES do rollback da `20261199000000` (que recusa
        enquanto houver redefinicao posterior no ar). Depois deles a `17b` volta a ser POSITIVA e a
        `17a` NEGATIVA (provado em `tests/banco/estoque-do-painel-portao-viva.cjs`).
      - **Depois do merge:** mudar `conferir-banco.cjs` ou o workflow invalida a evidencia antiga:
        rodar a `17a` e a `17b` DE NOVO, DEPOIS da ultima mudanca nesses arquivos.
      - **Limites:** `tests/banco/estoque-do-painel-portao-viva.cjs` (Postgres 17 efemero, no
        `rpc-ci.yml`) prova que as consultas DECIDEM certo (cada defeito reprova a PROPRIA linha;
        mutantes do texto das consultas ficam vermelhos; ida e volta pelos tres rollbacks; ponta a
        ponta com o lote real); `tests/banco/estoque-baixo-uma-regra-viva.cjs` e
        `tests/banco/inventario-so-com-custo-viva.cjs` provam o comportamento das migrations. Nao
        provam que a IKCOUS ou a Savy estao no estado de antes ou de depois (so o run da consulta
        contra o ref de cada loja diz). O `supabase_read_only_user` real, a ACL real das lojas e o
        Postgres 15 da Supabase nao foram medidos ali. As consultas nao conferem o dono das funcoes nem
        o EXECUTE de `service_role` (nenhuma migration do lote os muda), e nao leem dado: nao dizem
        quantos produtos estao com estoque baixo.

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

`ikcous-publicada` e `savy` aceitam nas functions as cinco financeiras mais a
`send-order-confirmation` (desde 09/10/2026; a Almeida e o apelido `cobranca` seguem so nas
cinco) e exigem `expected_sha` igual ao SHA do run. O destino `loja` das functions (`dekxabvqdsuukijblazl`) e o projeto antigo
da principal; nos workflows de banco `loja` aponta para a CAF sem as travas da CAF explicita
(achado registrado, fora deste escopo).

## Rollback integral da configuracao do repositorio

- Ignore step: `commandForIgnoringBuildStep = null`.
- Ruleset: remover `producao-unica-fonte` (id 24166103).
