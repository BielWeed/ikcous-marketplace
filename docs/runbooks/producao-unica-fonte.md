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

**16/10/2026 — decisão do dono:** Almeida Store, Brand Meliz e Space Loja dos Kit foram
descontinuadas permanentemente e saíram da política de atualização, inclusive do front.
Permanecem IKCOUS e Savy; as menções anteriores às lojas de teste registram o histórico.

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

   Antes de publicar, a versão precisa ter título e ao menos uma novidade, correção ou melhoria em `src/novidades/notas-das-versoes.json`, escritas em linguagem de lojista leigo. A nota tem de estar **commitada no SHA da release** (nota só local não conta) e as três listas (`novidades`, `correcoes`, `melhorias`) precisam existir, mesmo vazias. Uma linha simples como "Correções de estabilidade." basta.

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
      e mais as cinco nomeadas abaixo (a `send-order-confirmation` desde 09/10/2026: o comprovante do balcao divide `_shared/pedido.ts` e `comprovante.ts`
      com `criar-pagamento`, `webhook-mercadopago`, `reconciliar-pagamentos` e a propria
      `send-order-confirmation`, entao a release travaria se esses arquivos mudassem sem poder
      publicar a function do e-mail). Essa lista e `functionsPublicaveis` em
      `canais-de-backend.json`, o que o workflow aceita (um teste exige que as duas concordem).
      **Desfazer a `send-order-confirmation`:** NAO e disparar o workflow no SHA antigo (o
      workflow daquele commit recusa a function nas duas lojas). E `git revert` dos commits do
      texto num commit NOVO do ramo principal e publicar esse SHA pelo caminho normal. So a
      IKCOUS guarda o retrato "ANTES"; na Savy, anote a versao no ar antes de publicar.
      **Mais cinco functions pelo nome (desde 13/10/2026, decisao do dono):** `calculate-shipping`,
      `notify-new-order`, `send-otp-email`, `melhor-envio-etiqueta` e `send-push` tambem estao em
      `functionsPublicaveis` e no workflow, **so na IKCOUS e na Savy e so pelo nome** (o apelido
      `cobranca` continua sendo so as cinco financeiras; a Almeida e qualquer outra loja cliente
      seguem so nas cinco; a `send-order-whatsapp` segue proibida em todo destino). Antes disso, se a
      release mudasse `calculate-shipping` ou `notify-new-order`, a loja ficava PARADA pelo nome e o
      portao da release travava; agora o ensaio imprime o comando de publicar-functions para elas,
      como para as financeiras (banco → functions → front). O workflow nunca passa
      `--no-verify-jwt`: o `verify_jwt` de cada uma e o de `supabase/config.toml` (a
      `notify-new-order` e `verify_jwt = false`; as outras quatro, `true`).
      **PRE-CONDICAO DE PUBLICACAO das cinco (e de qualquer function deste passo), em CADA loja,
      ANTES do primeiro comando:**
      1. Medir o que esta no ar na IKCOUS (`cafkrminfnokvgjqtkle`) E na Savy
         (`gnjsrucsmjkajijrakzr`): `supabase functions list --project-ref <ref>` com o token da
         propria loja (IKCOUS: `SUPABASE_ACCESS_TOKEN_IKCOUS`; Savy: `SUPABASE_ACCESS_TOKEN_SAVY`).
         Na IKCOUS o proprio workflow grava essa lista no resumo do run ("No ar ANTES"; o modo
         `functions=listar` mede sem publicar nada). **Na Savy o workflow NAO guarda foto do
         antes**: a medicao e a mao, e e dela que sai o desfazer.
      2. Anotar, por function e por loja, a **versao e o `updated_at`** que a lista mostra. Para o
         conteudo (o que de fato roda), quando o CLI deixar: `supabase functions download <nome>
         --project-ref <ref>` numa pasta temporaria FORA do repositorio, e anotar o sha256 dos
         arquivos baixados. Se o download nao for possivel naquela maquina, anote so versao e data
         e diga no registro que o conteudo nao foi medido (a lista sozinha nao identifica o
         bundle).
      3. So depois disso disparar o comando do ensaio. O desfazer de cada uma e o mesmo da
         `send-order-confirmation`: NAO e disparar o workflow no SHA antigo, e sim `git revert`
         num commit NOVO do ramo principal e publicar esse SHA pelo caminho normal; a versao
         anotada acima e o que se compara depois.
      **Se a release mudar qualquer OUTRA function** (fora das onze acima), a loja fica PARADA pelo
      nome, sem comando: o caminho central nao a publica, e como seguir (canal novo no workflow ou
      publicacao separada) e decisao do dono.
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

  16. **Lote de UMA migration, de apply normal: `20261215000000` (a politica de devolucao nao mostra
      quem a editou, achado L).** Sem `backfillLedger` e sem `nuncaAplicar`; valem as duas lojas
      assinantes (IKCOUS e Savy). So muda PRIVILEGIO de coluna em `public.politica_devolucao`: `anon` e
      `authenticated` perdem o SELECT da tabela inteira e passam a ler 15 das 16 colunas, sem
      `updated_by` (o uuid do admin que salvou por ultimo, antes legivel sem login). Nenhuma linha de
      dado e lida ou reescrita; nenhuma funcao, politica RLS, gatilho ou coluna muda; `service_role` e as
      funcoes `SECURITY DEFINER` seguem lendo a linha inteira. Um bloco `DO` no fim da propria migration
      aborta o apply se `anon` ou `authenticated` ainda lerem `updated_by` ou a tabela inteira. Duas
      consultas, so leitura, so catalogo e de ROL FECHADO de 9 linhas (so valem com `rol=ok`):
      - **`19a-conferir-politica-devolucao-aplicado`** (a consulta do lote) prova DEPOIS do apply: sem
        SELECT da tabela inteira e sem SELECT em `updated_by` para `anon` e `authenticated`, 15 de 16
        colunas legiveis, a RLS ligada com a politica publica de SELECT e `service_role` com SELECT.
      - **`19b-antes-politica-devolucao-grant-de-tabela`** (`ausenciaConfirmadaPor`) prova o ANTES: os
        mesmos itens com SELECT da tabela inteira e 16 de 16 colunas. Uma loja onde a tabela nao existe
        (a `20261175000000` nao foi aplicada) reprova em `AUSENTE`.
      - **Caminho, uma loja por vez:** ledger sem a versao e sem evidencia → `19a` (sai NEGATIVA) → `19b`
        MAIS NOVA que a `19a` e POSITIVA → UM comando `aplicar-migrations.yml` com
        `20261215000000_a_politica_de_devolucao_nao_mostra_quem_a_editou.sql` → o ensaio pede a `19a` DE
        NOVO, que tem de sair POSITIVA. `19a` POSITIVA com a versao fora do ledger: PARAR (sem backfill;
        registrar a versao a mao e decisao do dono).
      - **Ordem:** o banco de CADA loja primeiro (IKCOUS, depois Savy, fora do horario de pico) e o front
        logo depois. **Banco novo com front velho:** o front antigo le a tabela com `select("*")`, que o
        banco passa a negar; a tela Ajustes > Pos-venda > Trocas e devolucoes cai no estado de erro de
        leitura ate o admin aceitar a atualizacao do app (PWA com `registerType: "prompt"`; vale tambem
        para um rollback de deploy para uma versao anterior). Nenhum dado se perde e o cliente final nao
        e afetado, porque recebe a politica pelas RPCs. **Front novo com banco velho:** funciona (colunas
        explicitas). Para evitar a janela, publique o front numa release sozinha antes da migration.
      - **Desfazer (decisao do DONO, nunca automatica):**
        `rollback-manual-20261215000000_a_politica_de_devolucao_nao_mostra_quem_a_editou.sql` pelo
        `aplicar-migrations.yml` (apaga a linha da versao do ledger na mesma transacao), NUNCA por `psql`
        direto (o ledger ficaria com a versao e o portao pularia o lote sem pedir a `19a`). Devolve o
        SELECT da tabela inteira e reabre o achado L. Depois dele a `19b` volta a ser POSITIVA e a `19a`
        NEGATIVA (provado em `tests/banco/politica-devolucao-portao-viva.cjs`).
      - **Depois do merge:** mudar `conferir-banco.cjs` ou o workflow invalida a evidencia antiga: rodar
        a `19a` e a `19b` DE NOVO, DEPOIS da ultima mudanca nesses arquivos.
      - **Limites:** `tests/banco/politica-devolucao-portao-viva.cjs` (Postgres 17 efemero, no
        `rpc-ci.yml`) prova que as consultas DECIDEM certo (cada defeito reprova SO as suas linhas; ida e
        volta pelo rollback); `tests/banco/devolucoes-viva.cjs`, prova "(achado L)", prova o
        comportamento (`SELECT *` e `updated_by` negados a `anon` e `authenticated`). Nao provam que a
        IKCOUS ou a Savy estao no estado de antes ou de depois (so o run da consulta contra o ref de cada
        loja diz). O `supabase_read_only_user` real e a ACL real das lojas nao foram medidos ali, e nao
        ha mutantes do texto dos `.sql`. As consultas nao leem dado: nao dizem quem editou a politica.

  17. **Lote de UMA migration, de apply normal: `20261216000000` (o cliente apaga a foto de devolucao
      que nao usou).** Sem `backfillLedger` e sem `nuncaAplicar`; valem as duas lojas assinantes (IKCOUS e
      Savy). So cria a politica de RLS `devolucoes_cliente_delete_policy` em `storage.objects`: `DELETE`
      so para `authenticated`, no bucket `devolucoes`, na pasta do proprio cliente e so do objeto que
      nenhuma devolucao referencia. Nenhuma linha de dado e lida ou reescrita, nenhum objeto e apagado ao
      aplicar, e a foto de uma devolucao (em andamento, concluida ou recusada) nunca pode ser apagada pelo
      cliente. As fotos orfas que JA existem continuam la: varre-las no servidor e passo a parte. Duas
      consultas, so leitura, so catalogo (`pg_policies`) e de ROL FECHADO de 6 linhas (so valem com
      `rol=ok`):
      - **`20a-conferir-fotos-da-devolucao-aplicado`** (a consulta do lote) prova DEPOIS do apply que a
        politica existe, e so para `authenticated`, com as pecas que a fazem segura (bucket, pasta do
        cliente, foto fora de uso), que **nenhuma outra politica de `DELETE`/`ALL`** em `storage.objects` alcanca o
        bucket (as permissivas se somam por OR: uma mais larga anularia a condicao da nossa) e que as politicas
        de `INSERT` e `SELECT` do cliente seguem no lugar. A lista de buckets aceitos nas outras politicas e' fechada
        (banners, products, produtos, branding): uma politica de `DELETE` nova para outro bucket reprova a linha de
        proposito, e quem a criou atualiza a consulta.
      - **`20b-antes-fotos-da-devolucao-sem-delete`** (`ausenciaConfirmadaPor`) prova o ANTES: nenhuma
        politica nossa de `DELETE`, nenhuma outra alcancando o bucket e as de `INSERT`/`SELECT` presentes (a `20261175000000` esta
        aplicada).
      - **Caminho, uma loja por vez:** ledger sem a versao e sem evidencia → `20a` (sai NEGATIVA) → `20b`
        MAIS NOVA que a `20a` e POSITIVA → UM comando `aplicar-migrations.yml` com
        `20261216000000_o_cliente_apaga_a_foto_de_devolucao_que_nao_usou.sql` → o ensaio pede a `20a` DE
        NOVO, que tem de sair POSITIVA. `20a` POSITIVA com a versao fora do ledger: PARAR (sem backfill).
      - **Ordem:** o banco de CADA loja primeiro (IKCOUS, depois Savy, fora do horario de pico) e o front
        logo depois. Front novo com banco velho: o app tenta apagar a foto nao usada, a politica nega e o app
        ignora (a limpeza e o melhor possivel); as fotos ficam como estavam. Banco novo com front velho:
        nada muda.
      - **Desfazer (decisao do DONO, nunca automatica):**
        `rollback-manual-20261216000000_o_cliente_apaga_a_foto_de_devolucao_que_nao_usou.sql` pelo
        `aplicar-migrations.yml` (apaga a linha da versao do ledger na mesma transacao), NUNCA por `psql`
        direto (o ledger ficaria com a versao e o portao pularia o lote sem pedir a `20a`). Apaga so a
        politica. Depois dele a `20b` volta a ser POSITIVA e a `20a` NEGATIVA (provado em
        `tests/banco/fotos-da-devolucao-portao-viva.cjs`).
      - **Depois do merge:** mudar `conferir-banco.cjs` ou o workflow invalida a evidencia antiga: rodar a
        `20a` e a `20b` DE NOVO, DEPOIS da ultima mudanca nesses arquivos.
      - **Limites:** `tests/banco/fotos-da-devolucao-portao-viva.cjs` (Postgres 17 efemero, no `rpc-ci.yml`)
        prova que as consultas DECIDEM certo e o comportamento da politica (o cliente apaga a propria foto
        livre e nao a em uso, a alheia nem a de outro bucket). Nao prova que a IKCOUS ou a Savy estao no
        estado de antes ou de depois, nem a passagem pelo servico de Storage da Supabase (o `remove` pela
        API cai na mesma RLS, mas essa passagem nao e medida). As consultas medem o TEXTO da condicao da
        politica, nao o comportamento, e nao leem objeto algum.

  18. **Lote de UMA migration, de apply normal: `20261217000000` (o e-mail da loja tem teto e o codigo
      do convidado nao se queima).** Sem `backfillLedger` e sem `nuncaAplicar`; valem as duas lojas
      assinantes (IKCOUS e Savy). Cria a tabela `email_da_loja_contadores` (RLS ligada, nenhum privilegio
      para `anon`/`authenticated`) e duas funcoes de apoio so do servidor (`reservar_vaga_de_email`,
      `chave_do_destinatario`); troca o corpo de `generate_order_otp_v2` (tetos por pedido 5/24 h, por
      destinatario 10/24 h somando codigo e comprovante, e da loja 40 codigos/24 h), de
      `reivindicar_email_de_confirmacao` (mesma assinatura; teto da loja 40 comprovantes/24 h e o do
      destinatario; pedido PAGO conta mas nunca e recusado; 40 + 40 = 80 fica abaixo de ~100/dia, a cota
      provavel da conta de Gmail da loja, que e desconhecida; subir = migration nova) e de
      `get_orders_by_otp_v1` (deixa de devolver
      `restantes`); cria `get_orders_by_otp_v2` (o rastreio do convidado confere o codigo junto com o
      trio e-mail + WhatsApp + inicio do pedido). Nenhuma linha de pedido, codigo ou cliente e lida ou
      reescrita ao aplicar. Duas consultas, so leitura, so catalogo, de ROL FECHADO (14 e 8 linhas, so
      valem com `rol=ok`):
      - **`21a-conferir-teto-de-email-aplicado`** (a consulta do lote) prova DEPOIS do apply o corpo
        (sha256, LF ou CRLF) e o `EXECUTE` das seis funcoes e a tabela de contadores fechada.
      - **`21b-antes-teto-de-email-corpos-vigentes`** (`ausenciaConfirmadaPor`) prova o ANTES: os tres
        corpos VIGENTES (20260820000000, 20260821000000, 20261181000000), o `EXECUTE` de sempre e as
        colunas que os corpos novos leem.
      - **Caminho, uma loja por vez:** `21a` (sai NEGATIVA) → `21b` MAIS NOVA e POSITIVA → UM comando
        `aplicar-migrations.yml` com `20261217000000_o_email_da_loja_tem_teto_e_o_codigo_nao_se_queima.sql`
        → o ensaio pede a `21a` DE NOVO, que tem de sair POSITIVA. `21a` POSITIVA com a versao fora do
        ledger: PARAR (sem backfill).
      - **Ordem:** o banco de CADA loja primeiro (IKCOUS, depois Savy) e o front desta release logo
        depois. Banco novo com front velho: o rastreio do convidado segue pela v1 (so sem o "Restam N
        tentativa(s)"). Front novo com banco velho: a verificacao do codigo falha (a v2 nao existe), por
        isso o banco vem ANTES. Nenhuma edge function muda: com um teto atingido, `send-otp-email`
        responde o erro generico de envio que ja existe.
      - **Desfazer (decisao do DONO, nunca automatica):**
        `rollback-manual-20261217000000_o_email_da_loja_tem_teto_e_o_codigo_nao_se_queima.sql` pelo
        `aplicar-migrations.yml`. Devolve os TRES corpos vivos de antes byte a byte; a tabela, as funcoes
        de apoio e a `get_orders_by_otp_v2` FICAM (o front novo depende da v2 e o envelope recusa apagar
        tabela). Depois dele a `21b` volta a ser POSITIVA e a `21a` NEGATIVA (provado em
        `tests/banco/teto-de-email-portao-viva.cjs`), **desde que a `get_orders_by_otp_v1` esteja
        aberta** (a `21b` espera `anon=sim` nela). **ORDEM: numa loja que ja recebeu o corte do item 20
        (`20261220000000`), o rollback da 20261220 vem SEMPRE ANTES de qualquer rollback ou reaplicacao
        da 20261217** — a conferencia final da 20261217 exige `anon` e `authenticated` com `EXECUTE` na
        v1 e ABORTA com ela fechada. O pre-voo do `rollback-manual-20261217000000_*.sql` RECUSA
        (`B1_BASELINE_DIVERGENT`, "rode o rollback-manual-20261220000000 ... ANTES deste") quando a v1 esta
        fechada para `anon` ou `authenticated`; com a 20261217 sendo a ultima, nada muda.
      - **Depois do merge:** mudar `conferir-banco.cjs` ou o workflow invalida a evidencia antiga: rodar a
        `21a` e a `21b` DE NOVO.
      - **Limites:** `tests/banco/teto-de-email-viva.cjs` prova o comportamento (tetos, corrida de duas
        chamadas, pedido pago passa, v1/v2) num Postgres 17 efemero; nao prova a cota real do Gmail da
        loja (os numeros sao conservadores e ficam em constantes no topo de cada funcao).

  19. **Lote de TRES migrations, de apply normal: `20261218000000`, `20261218000100` e `20261219000000`
      (as portas pequenas do banco).** Sem `backfillLedger` e sem `nuncaAplicar`; valem as duas lojas
      assinantes (IKCOUS e Savy). A `20261218000000` cria o gatilho `tr_perfil_recusa_imagem_grande` em
      `profiles` (foto ate 128 KiB e capa ate 512 KiB, conferidas so quando a imagem muda; a imagem ja
      gravada fica como esta) e tira do visitante sem login o `EXECUTE` de `get_segmented_push_count` e
      tudo na view `vw_produtos_admin`. A `20261218000100` tira de `anon` e `authenticated` todo
      privilegio em `app_settings` e `otp_verifications` (so o servidor as usa; na IKCOUS e no-op). A
      `20261219000000` recria `public_profiles_select_policy` so para `authenticated`: a propria conta, o
      admin atual e quem escreveu avaliacao publicada ou pergunta. **A 20261218000100 e a 20261219000000
      NAO sao aditivas** (restringem leitura): o apply espera o SQL mostrado ao dono. Nenhuma linha de
      dado e lida ou reescrita ao aplicar. Duas consultas, so leitura, so catalogo, de ROL FECHADO (15 e
      11 linhas, so valem com `rol=ok`):
      - **`22a-conferir-portas-do-banco-aplicado`** (a consulta do lote) prova DEPOIS do apply a politica
        (papeis e md5 da condicao), o gatilho (definicao, ligado, corpo sha256 LF ou CRLF, `EXECUTE`
        fechado, sem SECURITY DEFINER), o `EXECUTE` da contagem do push, a view do painel e as duas
        tabelas do servidor fechadas com a `service_role` intacta.
      - **`22b-antes-portas-do-banco-estado-vigente`** (`ausenciaConfirmadaPor`) prova o ANTES: a
        politica `USING (true)` para PUBLIC, o gatilho ausente, o corpo e o `EXECUTE` de sempre da
        contagem do push, o `anon` lendo a view, a porta `rls_admin_atual` e as colunas que o lote le.
        Nao tem linha das duas tabelas do servidor (na IKCOUS o antes delas ja e o depois).
      - **Caminho, uma loja por vez:** `22a` (sai NEGATIVA) → `22b` MAIS NOVA e POSITIVA → UM comando
        `aplicar-migrations.yml` com os TRES arquivos, na ordem 18000000, 18000100, 19000000 → o ensaio
        pede a `22a` DE NOVO, que tem de sair POSITIVA. `22a` POSITIVA com as versoes fora do ledger:
        PARAR (sem backfill). Estado parcial (so parte das tres no banco ou no ledger): PARAR; com o
        dono, o rollback do que entrou e o lote inteiro de novo.
      - **Ordem:** o banco de CADA loja (IKCOUS, depois Savy). Nenhuma edge function e nenhum front
        mudam: o front ja le o autor das avaliacoes e perguntas pelas views e nunca leu as duas tabelas
        do servidor. So a imagem de perfil acima do teto passa a ser recusada (aviso generico da tela).
      - **Desfazer (decisao do DONO, nunca automatica), na ordem inversa, pelo `aplicar-migrations.yml`:**
        `rollback-manual-20261219000000_perfil_publico_so_de_quem_escreveu.sql` (a politica volta a
        `USING (true)` para PUBLIC); `rollback-manual-20261218000100_configuracoes_e_codigos_so_do_servidor.sql`
        (devolve `GRANT ALL` a `anon` e `authenticated`; NAO se aplica na IKCOUS, onde as tabelas nunca
        estiveram abertas); `rollback-manual-20261218000000_a_foto_do_perfil_tem_teto_e_o_painel_fecha_ao_visitante.sql`
        (apaga o gatilho e devolve o `EXECUTE` de PUBLIC/`anon` e o SELECT/REFERENCES de `anon` na view).
        Depois dos tres a `22b` volta a ser POSITIVA e a `22a` NEGATIVA (provado em
        `tests/banco/portas-do-banco-portao-viva.cjs`).
      - **Depois do merge:** mudar `conferir-banco.cjs` ou o workflow invalida a evidencia antiga: rodar a
        `22a` e a `22b` DE NOVO.
      - **Limites:** `tests/banco/portas-do-banco-viva.cjs` prova o comportamento (visitante sem linha,
        cliente logado ve a si e aos autores, admin atual ve todos, teto da imagem por UPDATE, RPC e
        INSERT, perfil antigo grande continua editavel, contagem do push e view so com login, as duas
        tabelas so pelo servidor) num Postgres 17 efemero com os papeis reais; nao prova o Postgres da
        Supabase nem o papel `supabase_read_only_user` de cada loja.

  20. **Lote de UMA migration, de apply normal: `20261220000000` (a consulta antiga de pedido por codigo
      fecha para o visitante; etapa 2 do achado A-1).** Sem `backfillLedger` e sem `nuncaAplicar`; valem
      as duas lojas assinantes (IKCOUS e Savy). Tira o `EXECUTE` de `get_orders_by_otp_v1` de PUBLIC,
      `anon` e `authenticated` (a porta do convidado e a `get_orders_by_otp_v2`, que o front novo, no ar
      desde 13/10/2026, ja chama). So muda a ACL de uma funcao: nenhum DROP, nenhum corpo novo, nenhuma
      linha de dado. **Exige o item 18 (`20261217000000`) aplicado** (sem a v2 o pre-voo recusa).
      Quem quebra: so um app antigo que ainda chame a v1 (a chamada e recusada, a tela mostra o aviso
      generico). Duas consultas, so leitura, so catalogo, de ROL FECHADO (5 e 5 linhas, so valem com
      `rol=ok`):
      - **`23a-conferir-consulta-antiga-de-pedido-fechada`** (a consulta do lote) prova DEPOIS do apply o
        corpo (md5) e o `EXECUTE` da v1 (fechada para `anon`/`authenticated`, `service_role` sim) e da v2
        (aberta).
      - **`23b-antes-consulta-antiga-de-pedido-aberta`** (`ausenciaConfirmadaPor`) prova o ANTES: a
        20261217000000 aplicada (corpos) e a v1 e a v2 abertas.
      - **Caminho, uma loja por vez:** `23a` (sai NEGATIVA) → `23b` MAIS NOVA e POSITIVA → UM comando
        `aplicar-migrations.yml` com
        `20261220000000_a_consulta_antiga_de_pedido_por_codigo_fecha_para_o_visitante.sql` → o ensaio pede
        a `23a` DE NOVO, que tem de sair POSITIVA. `23a` POSITIVA com a versao fora do ledger: PARAR (sem
        backfill). A `21a` continua certa depois do corte (a linha de `EXECUTE` da v1 vale aberta ou
        fechada).
      - **Desfazer (decisao do DONO, nunca automatica):**
        `rollback-manual-20261220000000_a_consulta_antiga_de_pedido_por_codigo_fecha_para_o_visitante.sql`
        pelo `aplicar-migrations.yml` (um `GRANT`; com ele volta o achado A-1). Depois dele a `23b` volta a
        ser POSITIVA e a `23a` NEGATIVA. **O rollback da 20261220 vem SEMPRE ANTES de qualquer rollback ou
        reaplicacao da 20261217** (item 18). **NUNCA** rodar o
        `rollback-manual-20261090500000_a_loja_clonada_nasce_com_os_mesmos_grants.sql` depois do corte: ele
        faz `GRANT EXECUTE ... get_orders_by_otp_v1 ... TO PUBLIC` e reabre a v1 para todos.
      - **Depois do merge:** mudar `conferir-banco.cjs` ou o workflow invalida a evidencia antiga: rodar a
        `23a` e a `23b` DE NOVO.
      - **Limites:** `tests/banco/consulta-antiga-de-pedido-viva.cjs` prova o comportamento (A-1
        reproduz antes e nao depois, so a ACL da v1 muda, dados intactos, rollback com a mesma ACL,
        pre-voo, conferencia, apply com uma verificacao em voo) num Postgres 17 efemero; nao prova o
        Postgres da Supabase nem o papel `supabase_read_only_user` de cada loja, e o `service_role` com
        `EXECUTE` na v1 de cada loja so a `23b` mede.

  21. **Lote de UMA migration, de apply normal: `20261221000000` (a media de avaliacoes e o voto "util"
      fecham para o visitante sem login; menor privilegio).** Sem `backfillLedger` e sem `nuncaAplicar`;
      valem as duas lojas assinantes (IKCOUS e Savy). Tira o `EXECUTE` de `get_reviews_metrics` e de
      `increment_helpful` de PUBLIC e `anon` e mantem o de `authenticated`. So muda a ACL de duas
      funcoes: nenhum DROP, nenhum corpo novo, nenhuma linha de dado; aditiva. Nenhuma edge function e
      nenhum front mudam. Quem quebra: so quem chamasse as duas SEM login (ninguem, pelo levantamento de
      14/10/2026). Duas consultas, so leitura, so catalogo, de ROL FECHADO (3 e 3 linhas, so valem com
      `rol=ok`):
      - **`24a-conferir-avaliacoes-fechadas-ao-visitante`** (a consulta do lote) prova DEPOIS do apply o
        `EXECUTE` das duas fechado para `anon` (`authenticated` e `service_role` sim, PUBLIC nao).
      - **`24b-antes-avaliacoes-abertas-ao-visitante`** (`ausenciaConfirmadaPor`) prova o ANTES: as duas
        abertas a `anon` e `authenticated`.
      - **Caminho, uma loja por vez:** `24a` (sai NEGATIVA) → `24b` MAIS NOVA e POSITIVA → UM comando
        `aplicar-migrations.yml` com
        `20261221000000_a_media_de_avaliacoes_e_o_voto_util_fecham_para_o_visitante.sql` → o ensaio pede
        a `24a` DE NOVO, que tem de sair POSITIVA. `24a` POSITIVA com a versao fora do ledger: PARAR (sem
        backfill).
      - **Desfazer (decisao do DONO, nunca automatica):**
        `rollback-manual-20261221000000_a_media_de_avaliacoes_e_o_voto_util_fecham_para_o_visitante.sql`
        pelo `aplicar-migrations.yml` (um `GRANT` a `anon` por funcao). Depois dele a `24b` volta a ser
        POSITIVA e a `24a` NEGATIVA. **NUNCA** rodar o
        `rollback-manual-20261090500000_a_loja_clonada_nasce_com_os_mesmos_grants.sql` depois do corte: ele
        faz `GRANT EXECUTE ... TO PUBLIC` nas duas funcoes e as reabre para todos.
      - **Depois do merge:** mudar `conferir-banco.cjs` ou o workflow invalida a evidencia antiga: rodar a
        `24a` e a `24b` DE NOVO.
      - **Limites:** `tests/banco/avaliacoes-fechadas-ao-visitante-viva.cjs` prova o comportamento (anon
        recusado com 42501, authenticated chega ao corpo, so a ACL das duas muda, dados intactos,
        rollback com a mesma ACL, pre-voo, conferencia, atomicidade entre as duas funcoes) num Postgres 17
        efemero; nao prova o Postgres da Supabase nem o papel `supabase_read_only_user` de cada loja.
      - **Pendencia registrada (nao e desta migration; resolvida pelo item 22):** o corpo de
        `get_reviews_metrics` nao checava admin: qualquer conta logada lia a media e as contagens de TODAS
        as avaliacoes (pendentes incluidas). O item 22 (`20261222000000`) exige `is_admin()` no corpo.

  22. **Lote de UMA migration, de apply normal: `20261222000000` (a media de avaliacoes so responde ao
      administrador; permissao).** Sem `backfillLedger` e sem `nuncaAplicar`; valem as duas lojas
      assinantes (IKCOUS e Savy), **depois do item 21** (o pre-voo recusa a loja sem a `20261221000000`).
      Troca o corpo de `get_reviews_metrics` por `CREATE OR REPLACE` com o MESMO corpo da baseline mais a
      guarda `IF NOT public.is_admin() THEN RAISE EXCEPTION`, a mesma da irma `get_admin_reviews_paged`:
      antes, qualquer conta LOGADA lia a media e as contagens de TODAS as avaliacoes (pendentes
      incluidas); depois, so o admin (JWT com `app_metadata.role = admin`, `auth.users` ou
      `service_role`). Um admin rebaixado continua lendo ate o JWT vencer (aceito: e media, nao dinheiro).
      Nao toca dado, assinatura, tipo de retorno, SECURITY DEFINER, VOLATILE, `search_path` nem ACL. Nenhuma
      edge function e nenhum front mudam (o admin ja usa `get_admin_reviews_paged`; o unico chamador, o ramo
      nao-admin de `getAllReviews`, so registra o erro no console). Quem quebra: so conta logada que NAO e
      admin e chamasse a funcao. Duas consultas, so leitura, so catalogo, de ROL FECHADO (5 e 4 linhas, so
      valem com `rol=ok`):
      - **`25a-conferir-media-de-avaliacoes-so-admin`** (a consulta do lote) prova DEPOIS do apply o corpo
        novo (md5), a guarda no corpo, os atributos de sempre e o `EXECUTE` fechado ao visitante.
      - **`25b-antes-media-de-avaliacoes-sem-guarda`** (`ausenciaConfirmadaPor`) prova o ANTES: o corpo da
        baseline, sem a guarda, com os atributos de sempre. **Nao mede a ACL** (e da `24a`). O md5 que ela
        espera vem do baseline, nao de uma loja: **rode a `25b` (e a `22m`) em CADA loja ANTES do apply** e
        compare o corpo vivo; corpo diferente do baseline e loja que ninguem mediu, e o pre-voo tambem para.
      - **Caminho, uma loja por vez:** `25a` (sai NEGATIVA) → `25b` MAIS NOVA e POSITIVA → UM comando
        `aplicar-migrations.yml` com
        `20261222000000_a_media_de_avaliacoes_so_responde_ao_administrador.sql` → o ensaio pede a `25a` DE
        NOVO, que tem de sair POSITIVA. `25a` POSITIVA com a versao fora do ledger: PARAR (sem backfill).
      - **Desfazer (decisao do DONO, nunca automatica):**
        `rollback-manual-20261222000000_a_media_de_avaliacoes_so_responde_ao_administrador.sql` pelo
        `aplicar-migrations.yml` (recria o corpo antigo, mesmo md5, sem tocar a ACL). Depois dele a `25b`
        volta a ser POSITIVA e a `25a` NEGATIVA. Se for preciso desfazer o item 21 tambem, o rollback do 22
        vem ANTES. **NUNCA** rodar o
        `rollback-manual-20261090500000_a_loja_clonada_nasce_com_os_mesmos_grants.sql` depois do corte: ele
        faz `GRANT EXECUTE ... TO PUBLIC` nesta funcao e a reabre para todos.
      - **Depois do merge:** mudar `conferir-banco.cjs` ou o workflow invalida a evidencia antiga: rodar a
        `25a` e a `25b` DE NOVO.
      - **Limites:** `tests/banco/media-de-avaliacoes-so-admin-viva.cjs` prova o comportamento (anon
        recusado com 42501, nao-admin recusado pela guarda, admin e service_role recebem a mesma linha de
        antes, so o corpo dessa funcao muda, rollback com o mesmo md5 do baseline, pre-voo, conferencia,
        concorrencia) num Postgres 17 efemero; nao prova o Postgres da Supabase, o papel
        `supabase_read_only_user` de cada loja nem o corpo vivo delas.

  23. **Lote de UMA migration, de apply normal: `20261223000000` (o voto "util" so vale em avaliacao que o
      publico ve; permissao).** Sem `backfillLedger` e sem `nuncaAplicar`; valem as duas lojas assinantes
      (IKCOUS e Savy), **depois do item 21** (o pre-voo recusa a loja sem a `20261221000000`). Troca o corpo de
      `increment_helpful` por `CREATE OR REPLACE` com o MESMO corpo da `20261050000000` (o voto com memoria no
      servidor) mais uma guarda logo depois da checagem de login: o voto so vale se a avaliacao existe com
      `status = 'publicada'` (a mesma condicao da vitrine `vw_reviews_public` e da policy
      `reviews_select_policy`); senao `RAISE EXCEPTION 'Avaliação não encontrada.'`. Antes, qualquer conta
      LOGADA votava "util" numa avaliacao PENDENTE (o contador subia antes de alguem a ver). Pendente e id
      inexistente (a avaliacao recusada e APAGADA; nao existe status "recusada") dao a MESMA excecao com a
      MESMA mensagem: o id inexistente deixa de ser no-op silencioso. O autor com avaliacao pendente tambem
      e recusado (regressao de UX aceita: toast "Erro ao marcar como util"). Nao toca dado, assinatura, tipo de
      retorno, SECURITY DEFINER, VOLATILE, `search_path` nem ACL. Nenhuma edge function e nenhum front mudam.
      Quem quebra: so conta logada que votasse em avaliacao pendente ou inexistente. Duas consultas, so
      leitura, so catalogo, de ROL FECHADO (5 e 4 linhas, so valem com `rol=ok`):
      - **`26a-conferir-voto-util-so-em-avaliacao-publica`** (a consulta do lote) prova DEPOIS do apply o corpo
        novo (md5), a guarda no corpo, os atributos de sempre e o `EXECUTE` fechado ao visitante.
      - **`26b-antes-voto-util-sem-guarda-de-status`** (`ausenciaConfirmadaPor`) prova o ANTES: o corpo da
        `20261050000000`, sem a guarda, com os atributos de sempre. **Nao mede a ACL** (e da `24a`). O md5 que ela
        espera vem do arquivo da migration, nao de uma loja: **rode a `26b` (e a `22m`) em CADA loja ANTES do
        apply** e compare o corpo vivo; corpo diferente e loja que ninguem mediu, e o pre-voo tambem para.
      - **Caminho, uma loja por vez:** `26a` (sai NEGATIVA) → `26b` MAIS NOVA e POSITIVA → UM comando
        `aplicar-migrations.yml` com `20261223000000_o_voto_util_so_em_avaliacao_que_o_publico_ve.sql` → o
        ensaio pede a `26a` DE NOVO, que tem de sair POSITIVA. `26a` POSITIVA com a versao fora do ledger:
        PARAR (sem backfill).
      - **Desfazer (decisao do DONO, nunca automatica):**
        `rollback-manual-20261223000000_o_voto_util_so_em_avaliacao_que_o_publico_ve.sql` pelo
        `aplicar-migrations.yml` (recria o corpo antigo, mesmo md5, sem tocar a ACL). Depois dele a `26b` volta
        a ser POSITIVA e a `26a` NEGATIVA. O rollback do 23 vem ANTES do da `20261221`. **NUNCA** rodar o
        `rollback-manual-20261090500000_a_loja_clonada_nasce_com_os_mesmos_grants.sql` depois do corte: ele faz
        `GRANT EXECUTE ... TO PUBLIC` nesta funcao e a reabre para todos.
      - **Depois do merge:** mudar `conferir-banco.cjs` ou o workflow invalida a evidencia antiga (a deste
        lote e a dos lotes 24 e 25): rodar a `24a`, `24b`, `25a`, `25b`, `26a` e `26b` DE NOVO.
      - **Limites:** `tests/banco/voto-util-so-em-avaliacao-publica-viva.cjs` prova o comportamento (anon
        recusado com 42501, pendente e inexistente com a mesma excecao e nada gravado, publicada vota, so o
        corpo dessa funcao muda, rollback com o mesmo md5, pre-voo, conferencia, concorrencia) num Postgres 17
        efemero; nao prova o Postgres da Supabase, o papel `supabase_read_only_user` de cada loja nem o corpo
        vivo delas.

  24. **Lote de UMA migration, de apply normal: `20261224000000` (a avaliacao nasce sem a resposta da loja;
      permissao e dado publico).** Sem `backfillLedger` e sem `nuncaAplicar`; valem as duas lojas assinantes
      (IKCOUS e Savy); exige a `20261197000000` (`rls_admin_atual`) e a `20261030000000` (o gatilho do selo) ja
      no banco (o pre-voo recusa sem elas). **CRIA** (nada existente muda) a funcao
      `avaliacao_nasce_sem_a_resposta_da_loja()` e o gatilho `tr_avaliacao_nasce_sem_a_resposta_da_loja`
      (BEFORE INSERT, por linha, em `public.reviews`), que **limpa** `merchant_reply`, `merchant_reply_at`,
      `helpful` (0) e `created_at` (agora) quando quem grava e cliente. Antes, qualquer cliente LOGADA gravava, pela
      API, a propria avaliacao ja com a "Resposta Oficial da Loja", 9999 uteis e data de 2030; se a loja aprovasse,
      o texto falso ficava PUBLICO. O gatilho nao recusa nada (a avaliacao entra, sem o forjado) e deixa gravar
      como veio: o administrador de agora (`rls_admin_atual()`), `service_role`/`postgres` e a sessao direta no
      banco (o `role` da sessao e `none`). A funcao nasce FECHADA (a lista L8 nao ganha entrada).
      `reply_review_atomic` (UPDATE) nao passa pelo gatilho. Nenhuma edge function e nenhum front mudam.
      **O apply NAO limpa o que ja foi forjado:** meca com a `27m-medir-avaliacao-forjada` (so leitura, rol
      aberto, nao e portao) nas duas lojas ANTES e DEPOIS; limpar o achado e decisao do dono, com a lista na mao.
      Duas consultas, so leitura, so catalogo, de ROL FECHADO (6 e 6 linhas, so valem com `rol=ok`):
      - **`27a-conferir-avaliacao-nasce-sem-resposta-da-loja`** (a consulta do lote) prova DEPOIS do apply o corpo
        (md5), a limpeza das quatro colunas so fora do administrador, os atributos de sempre, o `EXECUTE` fechado
        e o gatilho (BEFORE INSERT por linha, ligado, sem WHEN).
      - **`27b-antes-avaliacao-aceita-resposta-forjada`** (`ausenciaConfirmadaPor`) prova o ANTES: a funcao e o
        gatilho AUSENTES, e as quatro colunas, `rls_admin_atual()` e o gatilho irmao `tr_avaliacao_nasce_verificada`
        de pe.
      - **Caminho, uma loja por vez:** `27a` (sai NEGATIVA) -> `27b` MAIS NOVA e POSITIVA -> UM comando
        `aplicar-migrations.yml` com `20261224000000_a_avaliacao_nasce_sem_a_resposta_da_loja.sql` -> o ensaio pede
        a `27a` DE NOVO, que tem de sair POSITIVA. `27a` POSITIVA com a versao fora do ledger: PARAR (sem backfill).
      - **Trava:** o `CREATE TRIGGER` pega `SHARE ROW EXCLUSIVE` em `reviews`: espera uma gravacao de avaliacao em
        voo terminar (e a que chega durante a espera fica na fila e sai limpa). Rodar fora de horario de pico nao e
        exigido; uma avaliacao em voo no instante do apply nasce antes do gatilho e NAO e limpa.
      - **Desfazer (decisao do DONO, nunca automatica):**
        `rollback-manual-20261224000000_a_avaliacao_nasce_sem_a_resposta_da_loja.sql` pelo `aplicar-migrations.yml`
        (apaga o gatilho e a funcao; nada a restaurar). Depois dele a `27b` volta a ser POSITIVA e a `27a`
        NEGATIVA. **Ordem:** a funcao do gatilho chama `rls_admin_atual()`, entao a `20261224000000` e desfeita
        ANTES da `20261197000000` (ordem inversa da aplicacao): o rollback da 97 recusa enquanto qualquer funcao de
        fora ainda a usa (`B1_BASELINE_DIVERGENT`). As provas `admin-atual-viva` e `pagamentos-rpc-viva`, que
        desfazem a 97 numa lista fixa, a trazem como mais um passo.
      - **Depois do merge:** mudar `conferir-banco.cjs` ou o workflow invalida a evidencia: rodar a `27a` e a
        `27b` DE NOVO.
      - **Limites:** `tests/banco/avaliacao-nasce-sem-resposta-da-loja-viva.cjs` prova o comportamento (a
        forjada entra limpa, a normal e o selo seguem, admin/servico/sessao direta gravam como vieram, mutantes,
        pre-voo, conferencia, rollback, concorrencia e a `27m` rodada de verdade) num Postgres 17 efemero; nao
        prova o Postgres da Supabase, o papel `supabase_read_only_user` de cada loja nem o estado vivo delas.
  25. **Lote de UMA migration, de apply normal: `20261225000000` (o reembolso da devolucao so e "liberado" quando
      o dinheiro sai; dinheiro).** Sem `backfillLedger` e sem `nuncaAplicar`; valem as duas lojas assinantes
      (IKCOUS e Savy). Redefine `devolucao_avisa_o_cliente` (gatilho de aviso da devolucao, `CREATE OR REPLACE`,
      mesma ACL) para o aviso da conclusao dizer o estado REAL do reembolso, e cria a auxiliar interna
      `devolucao__avisar_reembolso` (um aviso por devolucao e por tipo; nem `service_role` a executa) e o gatilho
      `tr_order_refunds_avisa_reembolso_liberado` (em `order_refunds`, so na virada para `concluido`), que avisa
      "liberado" quando `concluir_estorno` confirma o dinheiro. Antes, a cliente lia "o reembolso foi liberado" no
      instante da conclusao, antes do Mercado Pago pagar, e se o MP recusasse de vez ela seguia esperando; depois:
      "em processamento" (linha `solicitado`/`em_processamento`), "ainda nao foi liberado" (`falhou`, `recusado` ou
      sem linha), "combinado com a loja" (reembolso manual) e "liberado" so quando o dinheiro sai, UMA vez. Nao
      toca dado, tabela, coluna nem assinatura existente; nenhuma edge function e nenhum front mudam. Quem
      quebra: ninguem. Duas consultas, so leitura, so catalogo, de ROL FECHADO (8 e 5 linhas, so valem com
      `rol=ok`):
      - **`28a-conferir-reembolso-da-devolucao-so-liberado-com-dinheiro`** (a consulta do lote) prova DEPOIS do
        apply os tres corpos (md5), o aviso pelo estado real, os atributos de sempre, o `EXECUTE` fechado e o
        gatilho novo ligado.
      - **`28b-antes-reembolso-da-devolucao-avisa-liberado-na-conclusao`** (`ausenciaConfirmadaPor`) prova o
        ANTES: o corpo da `20261175000000` (que avisa "liberado" na conclusao), os atributos de sempre e as duas
        funcoes e o gatilho novos ainda ausentes. O md5 que ela espera vem do arquivo da migration, nao de uma
        loja: **rode a `28b` (e a `22m`) em CADA loja ANTES do apply** e compare o corpo vivo; corpo diferente e
        loja que ninguem mediu, e o pre-voo tambem para.
      - **Caminho, uma loja por vez:** `28a` (sai NEGATIVA) → `28b` MAIS NOVA e POSITIVA → UM comando
        `aplicar-migrations.yml` com `20261225000000_o_reembolso_da_devolucao_so_e_liberado_quando_o_dinheiro_sai.sql` → o ensaio pede a `28a` DE NOVO, que tem de sair POSITIVA. `28a`
        POSITIVA com a versao fora do ledger: PARAR (sem backfill).
      - **Desfazer (decisao do DONO, nunca automatica):**
        `rollback-manual-20261225000000_o_reembolso_da_devolucao_so_e_liberado_quando_o_dinheiro_sai.sql` pelo
        `aplicar-migrations.yml` (recria o corpo antigo, mesmo md5, apaga o gatilho e as duas funcoes novas; nao
        toca tabela nem dado). Depois dele a `28b` volta a ser POSITIVA e a `28a` NEGATIVA, e a cliente volta a ler
        "liberado" na conclusao.
      - **Depois do merge:** mudar `conferir-banco.cjs` ou o workflow invalida a evidencia antiga (a deste lote e a
        dos lotes 24, 25 e 26): rodar a `24a`, `24b`, `25a`, `25b`, `26a`, `26b`, `28a` e `28b` DE NOVO.
      - **Limites:** `tests/banco/reembolso-da-devolucao-viva.cjs` prova o comportamento (aviso por estado real,
        "liberado" uma vez so mesmo com duas conexoes em corrida, aviso que falha nao desfaz o dinheiro, auxiliar
        fechada, so o corpo do gatilho de aviso muda, rollback com o mesmo md5, pre-voo, conferencia e mutantes)
        num Postgres 17 efemero; nao prova o Postgres da Supabase nem o corpo vivo de cada loja. Avisos
        "liberado" ja enviados para devolucoes cujo reembolso falhou ficam como estao (a cliente ja leu): a lista
        das afetadas esta no cabecalho da migration.

  26. **Lote de UMA migration, de apply normal: `20261226000000` (a reemissao do reembolso consulta o Mercado
      Pago antes de pagar de novo; dinheiro).** Sem `backfillLedger` e sem `nuncaAplicar`; valem as duas lojas
      assinantes (IKCOUS e Savy), e **o item 25 (a `28a` positiva) tem de estar aplicado antes**. Cria a tabela
      `order_refund_diagnostico` (so do servidor: RLS ligada, nenhuma policy, nenhum acesso de `anon` nem de
      `authenticated`) e tres funcoes: `registrar_diagnostico_do_estorno` e `reemitir_reembolso_da_devolucao` (so
      `service_role`; a segunda ou ADOTA o reembolso que o MP ja fez ou CRIA a tentativa nova, nunca as duas, e confere
      o ator como admin ATUAL em `auth.users` e `profiles`) e `admin_devolucao_reembolso_por_fora` ("Ja devolvi por
      fora", do lojista logado). Antes, "Tentar de novo" sobre reembolso `falhou` nao tinha caminho; reemitir sem
      saber POR QUE falhou pagaria duas vezes. Nao toca dado, nao muda funcao existente (a `admin_devolucao_reemitir_reembolso`
      antiga fica como esta). **Este lote so cria objetos que nada chama ainda**: a edge `estornar-pagamento` (acao
      `reemitir`) e o cron `reconciliar-pagamentos` que gravam o diagnostico e chamam estas funcoes vem em outro
      lote, depois do banco. Quem quebra: ninguem. Duas consultas, so leitura, so catalogo, de ROL FECHADO (9 e 5
      linhas, so valem com `rol=ok`):
      - **`29a-conferir-reemissao-do-reembolso-consulta-o-mp-antes`** (a consulta do lote) prova DEPOIS do apply os
        tres corpos (md5), os atributos, o `EXECUTE` por papel, a tabela fechada e a decisao da reemissao.
      - **`29b-antes-reemissao-do-reembolso-base-conhecida`** (`ausenciaConfirmadaPor`) prova o ANTES: as tres
        funcoes e a tabela ausentes e os corpos de `concluir_estorno`, `pedido__saldo_a_estornar` e
        `devolucao__avisar_reembolso` (da `20261225000000`) conhecidos. Os md5 vem dos arquivos das migrations, nao de
        uma loja: **rode a `29b` em CADA loja ANTES do apply**; corpo diferente e loja que ninguem mediu, e o pre-voo
        tambem para.
      - **Caminho, uma loja por vez:** `29a` (sai NEGATIVA) → `29b` MAIS NOVA e POSITIVA → UM comando
        `aplicar-migrations.yml` com `20261226000000_a_reemissao_do_reembolso_consulta_o_mercado_pago_antes_de_pagar_de_novo.sql` → o ensaio pede a `29a` DE NOVO, que tem de sair POSITIVA. `29a`
        POSITIVA com a versao fora do ledger: PARAR (sem backfill).
      - **Desfazer (decisao do DONO, nunca automatica):**
        `rollback-manual-20261226000000_a_reemissao_do_reembolso_consulta_o_mercado_pago_antes_de_pagar_de_novo.sql`
        pelo `aplicar-migrations.yml` (apaga as tres funcoes e a tabela; **recusa** se a tabela tiver linhas, ate o
        operador declarar `app.rollback_aceita_perder_diagnostico = sim` na sessao; sem o diagnostico toda linha
        `falhou` volta a ser incerta, o lado seguro). Depois dele a `29b` volta a ser POSITIVA e a `29a` NEGATIVA.
      - **Depois do merge:** mudar `conferir-banco.cjs` ou o workflow invalida a evidencia antiga (a deste lote e a
        dos lotes 24 a 27): rodar a `24a`, `24b`, `25a`, `25b`, `26a`, `26b`, `28a`, `28b`, `29a` e `29b` DE NOVO.
      - **Limites:** `tests/banco/reemissao-do-reembolso-viva.cjs` prova o comportamento (gate de "nada saiu", adotar so
        linha incerta, devolucao pelo painel do MP, saldo da funcao unica, duplo clique e duas conexoes em corrida,
        ator admin ATUAL, ACL, "por fora", diagnostico atomico, pre-voo, conferencia, rollback e mutantes) num Postgres
        17 efemero; nao prova o Postgres da Supabase, o corpo vivo de cada loja nem o comportamento do Mercado Pago.

  27. **Lote de DUAS migrations independentes, de apply normal: `20261227000000` e `20261228000000` (os
      numeros do painel; numeros, sem permissao nova).** Sem `backfillLedger` e sem `nuncaAplicar`; valem as
      duas lojas assinantes (IKCOUS e Savy), **depois do item 17** (o pre-voo do `painel_inicio` recusa a loja
      sem a `20261212000000`). Cada uma troca o corpo de UMA funcao por `CREATE OR REPLACE`, sem tocar dado,
      assinatura, tipo de retorno, SECURITY DEFINER, STABLE, `search_path`, ACL nem o formato do JSON:
      - **`20261227000000` (`crm_visao`)**: a "taxa de devolucao" do CRM falava de dois grupos diferentes (o
        numerador somava toda devolucao concluida no periodo; o denominador excluia o pedido estornado ou
        cancelado) e passava de 100%. Agora fala de UMA turma: as vendas pagas no periodo, inclusive as que
        depois foram estornadas ou canceladas, contra so as devolucoes DESSAS vendas (pedido estornado conta o
        total; senao o ledger mais o reembolso manual, nunca mais que o total). Resultado entre 0 e 100% sempre.
        **SIGNIFICADO que muda:** a devolucao entra na taxa do periodo da VENDA. Tambem corta o "vs. ontem"
        (periodo que termina hoje) na MESMA hora de agora.
      - **`20261228000000` (`painel_inicio`)**: a semana passada do "Hoje" do Inicio so entra ate a MESMA hora
        de hoje (relogio fixo de America/Sao_Paulo); antes comparava o dia de hoje (parcial) com o dia INTEIRO
        da semana passada e mostrava queda falsa de manha.
      - Quem quebra: ninguem (nenhuma assinatura muda). O front muda so TEXTO. Duas consultas, so leitura, so
        catalogo, de ROL FECHADO (9 e 7 linhas, so valem com `rol=ok`):
        - **`30a-conferir-numeros-do-painel-aplicado`** (a consulta do lote) prova DEPOIS do apply, nas DUAS
          funcoes, o corpo novo (md5), o corte na mesma hora, os atributos de sempre e o `EXECUTE` fechado ao
          visitante.
        - **`30b-antes-numeros-do-painel-corpos-vigentes`** (`ausenciaConfirmadaPor`) prova o ANTES: o corpo da
          `20261199000000` (`crm_visao`) e o da `20261212000000` (`painel_inicio`), sem o corte, com os atributos de
          sempre. **Nao mede a ACL.** O md5 vem dos arquivos das migrations, nao de uma loja: **rode a `30b` (e a
          `22m`) em CADA loja ANTES do apply** e compare o corpo vivo; corpo diferente e loja que ninguem mediu.
      - **Caminho, uma loja por vez:** `30a` (sai NEGATIVA) → `30b` MAIS NOVA e POSITIVA → UM comando
        `aplicar-migrations.yml` com as duas migrations, em ordem → o ensaio pede a `30a` DE NOVO, que tem de
        sair POSITIVA. `30a` POSITIVA com a versao fora do ledger: PARAR (sem backfill). Loja com SO UMA das
        duas aplicada: PARAR e medir (reprova nas duas consultas).
      - **A cadeia das sucessoras:** a `8e` (lote 92-202) aceita a `20261227000000` e a `20261228000000` como
        sucessoras do corpo da `20261199000000` (no `painel_inicio` a cadeia e 99, 12, 28) e a `17a` aceita o
        corpo da `20261228000000` ao lado do da `20261212000000`: as duas seguem POSITIVAS depois deste lote.
        Rodar a `8e` e a `17a` DE NOVO depois do apply.
      - **Desfazer (decisao do DONO, nunca automatica):** pelo `aplicar-migrations.yml`, **nesta ordem**:
        `rollback-manual-20261228000000_o_inicio_compara_ate_a_mesma_hora.sql` e
        `rollback-manual-20261227000000_o_crm_compara_o_que_e_comparavel.sql` (cada um recria o corpo antigo, mesmo
        md5, sem tocar a ACL, com pre-voo proprio). O da `20261228` vem ANTES do da `20261212` (lote 17) e o da
        `20261227` ANTES do da `20261199`: o rollback da 99 recusa enquanto houver redefinicao posterior no ar.
        Depois deles a `30b` volta a ser POSITIVA e a `30a` NEGATIVA.
      - **Depois do merge:** mudar `conferir-banco.cjs` ou o workflow invalida a evidencia antiga: rodar a `8e`,
        a `17a`, a `30a` e a `30b` DE NOVO.
      - **Limites:** `tests/banco/numeros-do-painel-viva.cjs` prova o comportamento (cada cenario da taxa,
        o corte na mesma hora com o relogio real do banco, formato, ACL, travas de admin, rollback, pre-voo
        que recusa sem escrever, mutantes) num Postgres 17 efemero; nao prova o Postgres da Supabase, o papel
        `supabase_read_only_user` de cada loja nem o corpo vivo delas. O relogio do banco nao e injetado: a
        prova monta os pedidos em torno do `now()` real (com guarda de virada do dia).

  28. **Lote de UMA migration, de apply normal: `20261229000000` (o endereco da compra fica no pedido; dado de
      cliente).** Sem `backfillLedger` e sem `nuncaAplicar`; valem as duas lojas assinantes (IKCOUS e Savy).
      Troca o corpo de `create_marketplace_order_v23` (compra na entrega) e de `create_marketplace_order_v24`
      (compra online) por `CREATE OR REPLACE` com o MESMO corpo vivo da `20261174000000` mais um bloco entre a
      trava de preco e o INSERT do pedido: quem tem conta, com `p_address_id`, sem endereco digitado e fora da
      retirada na loja, tem o endereco da conta COPIADO para `customer_data.address` no instante da compra (as
      mesmas chaves da convidada mais `reference`, sem chave nula). Antes, o pedido guardava so o ponteiro:
      editar o endereco no perfil mudava o pedido ja entregue e apagar o endereco o esvaziava. Dinheiro, estoque,
      cupom, frete e idempotencia nao mudam; assinatura, retorno, SECURITY DEFINER, VOLATILE, `search_path` e ACL
      tambem nao. **SEM backfill** (decisao do dono): os pedidos que ja existem continuam sem copia. O mapper do
      front, a edge `melhor-envio-etiqueta` e o antifraude **ja preferem a copia** ao endereco vivo e nao mudam. O
      **comprovante por e-mail** (`_shared/comprovante.ts`) nao preferia (lia a linha da conta e, apagada ela,
      mostrava `[object Object]`) e **passa a preferir neste PR**: publicar as edges que importam
      `comprovante.ts` (`send-order-confirmation` direto; `webhook-mercadopago`, `reconciliar-pagamentos` e
      `criar-pagamento` por `efeitos-do-pagamento.ts`) **ANTES** de aplicar a migration (o comprovante novo
      funciona com o banco antigo; o banco novo com o comprovante antigo mostra lixo). Duas consultas, so leitura, so catalogo, de ROL FECHADO (9 e
      7 linhas, so valem com `rol=ok`):
      - **`31a-conferir-endereco-da-compra-fica-no-pedido`** (a consulta do lote) prova DEPOIS do apply, por
        objeto, o corpo das duas funcoes (md5), a copia no corpo antes do INSERT do pedido, os atributos de sempre
        e o `EXECUTE` de sempre (PUBLIC nao; anon, authenticated e service_role sim).
      - **`31b-antes-endereco-da-compra-so-no-ponteiro`** (`ausenciaConfirmadaPor`) prova o ANTES: os dois
        corpos da `20261174000000`, sem a copia, com os atributos de sempre. **Nao mede a ACL** (e da `31a`). O
        md5 que ela espera vem do arquivo da migration, nao de uma loja: **rode a `31b` (e a `22m`) em CADA loja
        ANTES do apply** e compare o corpo vivo; corpo diferente e loja que ninguem mediu, e o pre-voo tambem para.
      - **Caminho, uma loja por vez:** `31a` (sai NEGATIVA) → `31b` MAIS NOVA e POSITIVA → UM comando
        `aplicar-migrations.yml` com `20261229000000_o_endereco_da_compra_fica_no_pedido.sql` → o ensaio pede a
        `31a` DE NOVO, que tem de sair POSITIVA. `31a` POSITIVA com a versao fora do ledger: PARAR (sem backfill).
      - **Desfazer (decisao do DONO, nunca automatica):**
        `rollback-manual-20261229000000_o_endereco_da_compra_fica_no_pedido.sql` pelo `aplicar-migrations.yml`
        (recria os dois corpos antigos, mesmo md5, sem tocar a ACL e sem reescrever os pedidos que ja ganharam a
        copia). Depois dele a `31b` volta a ser POSITIVA e a `31a` NEGATIVA.
      - **Depois do merge:** mudar `conferir-banco.cjs` ou o workflow invalida a evidencia antiga: rodar a `31a`
        e a `31b` DE NOVO (e as dos lotes anteriores que o merge tocar).
      - **Limites:** `tests/banco/endereco-no-pedido-viva.cjs` prova o comportamento (pelo caminho real do
        checkout, nas duas funcoes: copia, editar e apagar depois, endereco de outro usuario recusado, convidada,
        retirada, digitado, dinheiro e estoque identicos, pedido antigo intacto, so o corpo muda, rollback com o
        mesmo md5, pre-voo, conferencia, atomicidade, concorrencia, mutantes) num Postgres 17 efemero; nao prova o
        Postgres da Supabase, o papel `supabase_read_only_user` de cada loja nem o corpo vivo delas.

  32. **Lote de DUAS migrations independentes, de apply normal: `20261230000000` e `20261231000000` (a busca
      de clientes; DADO DE CLIENTE, nada se abre).** Sem `backfillLedger` e sem `nuncaAplicar`; valem as duas
      lojas assinantes (IKCOUS e Savy). Cada uma troca o corpo de UMA funcao SECURITY DEFINER do painel por
      `CREATE OR REPLACE`, com o corpo da `20261199000000` mais as trocas declaradas, sem tocar dado, assinatura,
      tipo de retorno, volatilidade, `search_path`, as travas de admin, a ACL nem o formato do JSON:
      - **`20261230000000` (`get_admin_customers_paged`)**: a busca da tela Clientes, do balcao (escolher o
        cliente da venda) e do cupom exclusivo comparava texto com texto, e o WhatsApp fica gravado mascarado
        (`(34) 99999-1234`): quem digitava so os numeros ou o numero colado do WhatsApp (`+55 34 99999-1234`) nao
        achava ninguem. Agora, com 4 ou mais digitos, o termo tambem compara so digitos (WhatsApp do perfil e
        telefone da conta); com 12 ou 13 digitos comecando por 55 o 55 sai; termo curto segue so texto.
      - **`20261231000000` (`crm_clientes`)**: a aba Clientes do CRM comparava o nome e o e-mail com acento
        (`joao` nao achava `Joao`). Agora compara sem acento nos dois lados (`public.f_unaccent`).
      - **SIGNIFICADO que muda:** o resultado so CRESCE (letras mais 4 digitos tambem comparam os digitos, a regra
        da busca de pedidos). O custo ACEITO: `f_unaccent` e mais lento que o `ILIKE` cru (a aba do CRM le a base
        inteira de clientes de qualquer jeito).
      - Quem quebra: ninguem (nenhuma assinatura muda). Nenhum front e nenhuma edge function mudam. Duas
        consultas, so leitura, so catalogo, de ROL FECHADO (9 e 7 linhas, so valem com `rol=ok`):
        - **`32a-conferir-busca-de-clientes-aplicado`** (a consulta do lote) prova DEPOIS do apply, nas DUAS
          funcoes, o corpo novo (md5), a regra no corpo, os atributos de sempre e o `EXECUTE` fechado ao visitante.
        - **`32b-antes-busca-de-clientes-corpos-vigentes`** (`ausenciaConfirmadaPor`) prova o ANTES: o corpo da
          `20261199000000` nas duas, sem a regra nova, com os atributos de sempre. **Nao mede a ACL.** O md5 vem do
          arquivo da migration, nao de uma loja: **rode a `32b` em CADA loja ANTES do apply** e compare o corpo
          vivo; corpo diferente e loja que ninguem mediu (a migration tambem recusa, `B1_BASELINE_DIVERGENT`).
      - **Medir antes (opcional, so leitura, nao e portao):** `32m-medir-busca-de-clientes` conta (so numeros,
        nenhum dado pessoal) quantos perfis tem WhatsApp mascarado, gravado com +55 ou nome acentuado: o tamanho do
        que a correcao destrava.
      - **Caminho, uma loja por vez:** `32a` (sai NEGATIVA) -> `32b` MAIS NOVA e POSITIVA -> UM comando
        `aplicar-migrations.yml` com as duas migrations, em ordem -> o ensaio pede a `32a` DE NOVO, que tem de sair
        POSITIVA. `32a` POSITIVA com a versao fora do ledger: PARAR (sem backfill). Loja com SO UMA das duas
        aplicada: PARAR e medir (reprova nas duas consultas).
      - **A cadeia das sucessoras:** a `8e` (lote 92-202) aceita os dois corpos novos como sucessores do da
        `20261199000000` e segue POSITIVA depois deste lote: rodar a `8e` DE NOVO depois do apply.
      - **Desfazer (decisao do DONO, nunca automatica):** pelo `aplicar-migrations.yml`, **nesta ordem**:
        `rollback-manual-20261231000000_a_busca_do_crm_ignora_acento.sql` e
        `rollback-manual-20261230000000_a_busca_de_clientes_acha_pelo_numero_do_whatsapp.sql` (cada um recria o corpo
        da `20261199000000`, mesmo md5, sem tocar a ACL, com pre-voo proprio; rodar o mesmo rollback duas vezes
        deixa o mesmo estado). Os dois vem ANTES do rollback da `20261199000000`: o da 99 recusa enquanto houver
        redefinicao posterior no ar. Depois deles a `32b` volta a ser POSITIVA e a `32a` NEGATIVA.
      - **Depois do merge:** mudar `conferir-banco.cjs` ou o workflow invalida a evidencia: rodar a `8e`, a `32a` e
        a `32b` DE NOVO.
      - **Limites:** `tests/banco/busca-de-clientes-viva.cjs` prova o comportamento (cada forma de digitar o
        numero, o corte do 55, termo curto, acento, o resto do JSON identico ao do corpo antigo, rollback, pre-voo
        que recusa sem escrever, concorrencia, mutantes) e `tests/banco/busca-de-clientes-portao-viva.cjs` prova a
        decisao das duas consultas, num Postgres 17 efemero; nao provam o Postgres da Supabase, o papel
        `supabase_read_only_user` de cada loja nem o corpo vivo delas.

  33. **Lote de UMA migration, de apply normal: `20261232000000` (a grade do CRM mede a recencia do mesmo
      instante da lista; numeros do painel, sem permissao nova).** **So pode ser APLICADO DEPOIS da
      20261227000000 (item 27), aplicada em 15/10/2026 (IKCOUS e Savy; runs 38680605921 e 38680852644):** o
      pre-voo recusa (`B1_BASELINE_DIVERGENT`) com o corpo da `20261199000000` no ar, e a `33b`
      reprova na linha do corpo. Sem `backfillLedger` e sem `nuncaAplicar`; valem as duas lojas assinantes (IKCOUS e
      Savy). Troca o corpo de UMA funcao (`crm_visao`) por `CREATE OR REPLACE`, com o corpo da `20261227000000` e UMA
      linha diferente (a ancora do periodo), sem tocar dado, assinatura, tipo de retorno, SECURITY DEFINER, STABLE,
      `search_path`, as travas de admin, ACL nem o formato do JSON:
      - **O defeito:** a grade de segmentos do CRM media cada cliente ate a MEIA-NOITE DE AMANHA e a lista de
        clientes ate AGORA. Com o periodo terminando hoje (toda a tela), a grade via cada cliente 1 dia mais velho:
        quem comprou ha 30 dias estava em "Novos" na lista e em "Promissores" na grade (o mesmo aos 60 e aos 120
        dias). Medido: lista {novos 2, hibernando 4} x grade {novos 1, hibernando 5}. Agora a ancora e o MENOR entre
        a meia-noite de amanha e agora, a mesma das quatro chamadas (`crm__vendas`, `crm__clientes_rfm`,
        `crm__pedidos_nao_pagos`, `crm__nunca_comprou`) e a que a lista ja usa.
      - **SIGNIFICADO que muda:** so a nota de recencia, e so com o periodo terminando hoje (ou no futuro): mudam
        `segmentos` e `kpis.receita_em_risco`. Periodo que terminou antes de hoje NAO muda (o JSON e identico, medido
        em 4 periodos). A virada de 240 dias muda a nota mas nao o segmento: a grade nao a mostra. Dado de verdade
        nunca tem data depois de agora; a unica diferenca de dado e que uma venda, um pedido ou um perfil com data
        futura (relogio adiantado de um gateway) deixa de entrar na grade, como ja nao entrava na lista.
      - Quem quebra: ninguem (nenhuma assinatura muda); nenhum front e nenhuma edge function mudam. Duas consultas,
        so leitura, so catalogo, de ROL FECHADO (5 e 4 linhas, so valem com `rol=ok`):
        - **`33a-conferir-grade-do-crm-aplicado`** (a consulta do lote) prova DEPOIS do apply o corpo novo (md5), a
          ancora de agora no corpo, os atributos de sempre e o `EXECUTE` fechado ao visitante.
        - **`33b-antes-grade-do-crm-corpo-vigente`** (`ausenciaConfirmadaPor`) prova o ANTES: o corpo da
          `20261227000000`, sem a ancora de agora, com os atributos de sempre. **Nao mede a ACL.** O md5 vem do
          arquivo da migration, nao de uma loja: **rode a `33b` em CADA loja ANTES do apply** e compare o corpo vivo;
          corpo diferente (inclusive o da `20261199000000`, sem a 27) e loja que ninguem mediu.
      - **Medir antes (opcional, so leitura, nao e portao):** `33m-medir-grade-do-crm` conta (so numeros, nenhum dado
        pessoal) quantos compradores estao EXATAMENTE nas viradas de 30, 60, 120 e 240 dias: o tamanho do que a
        correcao move.
      - **Caminho, uma loja por vez:** `33a` (sai NEGATIVA) → `33b` MAIS NOVA e POSITIVA → UM comando
        `aplicar-migrations.yml` com a migration → o ensaio pede a `33a` DE NOVO, que tem de sair POSITIVA. `33a`
        POSITIVA com a versao fora do ledger: PARAR (sem backfill).
      - **A cadeia das sucessoras:** a `8e` (lote 92-202) aceita a cadeia 99, 27, 32 de `crm_visao`, e a `30a` (lote
        do item 27) aceita os DOIS corpos (o da 27 e o da 32): as duas seguem POSITIVAS depois deste lote. Rodar a
        `8e` e a `30a` DE NOVO depois do apply.
      - **Desfazer (decisao do DONO, nunca automatica):** pelo `aplicar-migrations.yml`:
        `rollback-manual-20261232000000_a_grade_do_crm_mede_a_recencia_do_mesmo_instante_da_lista.sql` (recria o corpo
        da `20261227000000`, mesmo md5, sem tocar a ACL, com pre-voo proprio; rodar duas vezes deixa o mesmo estado).
        **Vem ANTES** do rollback da `20261227000000` (o dela recusa enquanto houver redefinicao posterior no ar) e do
        da `20261199000000`. Depois dele a `33b` volta a ser POSITIVA e a `33a` NEGATIVA.
      - **Dois aplicadores ao mesmo tempo (medido):** o segundo espera o primeiro confirmar e o Postgres o recusa
        (`tuple concurrently updated`) sem escrever nada; repetir o aplicador depois e seguro (no-op).
      - **Depois do merge:** mudar `conferir-banco.cjs` ou o workflow invalida a evidencia antiga: rodar a `8e`, a
        `30a`, a `33a` e a `33b` DE NOVO.
      - **Limites:** `tests/banco/a-grade-do-crm-mede-a-recencia-viva.cjs` prova o comportamento (cada virada de
        recencia, o conjunto de 12 compras, as outras tres chamadas, periodo que nao termina hoje identico, resto do
        corpo igual byte a byte, ACL, travas de admin, rollback, pre-voo que recusa sem escrever, dois aplicadores,
        mutantes) e `tests/banco/a-grade-do-crm-mede-a-recencia-portao-viva.cjs` prova a decisao das duas consultas,
        num Postgres 17 efemero; nao provam o Postgres da Supabase, o papel `supabase_read_only_user` de cada loja nem
        o corpo vivo delas. O relogio do banco e o REAL, e a prova se protege da hora do dia: a diferenca entre a
        ancora antiga (meia-noite de amanha) e a nova (o menor entre ela e agora) so existe entre agora e essa
        meia-noite, entao o dado "do futuro" fica SEMPRE no meio desse trecho (por construcao, conferido por
        assert) e todo o resto e "N dias" ou "N horas" ATRAS de agora; tudo numa transacao que sempre e desfeita
        (o instante e o mesmo nas duas telas). Para provar em qualquer hora, `GRADE_RELOGIO='2026-10-14 22:30:00-03'`
        injeta um relogio fixo nas provas que dependem da hora (medido em 13 horarios, 14/14 em todos, mutantes
        mortos em todos); so no microssegundo exato da meia-noite (de Sao Paulo ou UTC) um mutante e equivalente.

  34. **Migration de apply normal: `20261233000000` (o sino do pedido de retirada fala de retirada; DADO DE
      CLIENTE, nada se abre e nada se apaga).** Sem `backfillLedger` e sem `nuncaAplicar`; valem as duas lojas
      assinantes (IKCOUS e Savy). Troca por `CREATE OR REPLACE` o corpo de UMA funcao de gatilho,
      `notifica_cliente_de_mudanca_de_status` (a que acende o sino da cliente a cada mudanca de status do
      pedido), com o corpo da `20261026000000` mais o ramo da retirada, sem tocar dado, assinatura, tipo de
      retorno, volatilidade, `search_path`, a trigger `tr_pedido_avisa_o_cliente`, a tabela `notificacoes` nem a
      ACL:
      - **O defeito:** no pedido de RETIRADA na loja (`customer_data->>'shipping_option_id' = 'store-pickup'`), quando
        a lojista marcava "Pronto para retirar" o sino da cliente dizia "Pedido a caminho - saiu para entrega" e
        depois "Pedido entregue", contra o aviso do painel e a tela do pedido ("Pronto para retirar").
      - **Agora:** retirada + `shipping` = "Pedido pronto para retirar" / "Seu pedido esta pronto! Venha retirar na
        loja."; retirada + `delivered` = "Pedido retirado" / "Seu pedido foi retirado na loja. Obrigado por comprar
        com a gente!". Todo pedido que NAO e retirada, o preparo, o cancelamento, o convidado, o mesmo status de
        novo e a falha de aviso ficam byte a byte como hoje (provado em
        `tests/banco/o-sino-do-pedido-de-retirada-viva.cjs`).
      - **Dado que ja existe:** as notificacoes que ja nasceram com o texto da entrega num pedido de retirada FICAM
        (historico da cliente; nada e reescrito nem apagado); so as mudancas de status DEPOIS do apply usam o texto
        novo. Um pedido de retirada que JA esta em `shipping` no instante do apply nao e reavisado.
      - Quem quebra: ninguem (nenhuma assinatura muda). Nenhum front e nenhuma edge function mudam. Duas
        consultas, so leitura, so catalogo, de ROL FECHADO (7 e 6 linhas, so valem com `rol=ok`):
        - **`34a-conferir-sino-da-retirada-aplicado`** (a consulta do lote) prova DEPOIS do apply o corpo novo
          (md5), o texto da retirada E o da entrega no corpo, os atributos de sempre, a trigger ligada e a ACL de hoje.
        - **`34b-antes-sino-da-retirada-corpo-vigente`** (`ausenciaConfirmadaPor`) prova o ANTES: o corpo da
          `20261026000000`, sem o texto da retirada, com os atributos, a trigger e a ACL de hoje. O md5 vem do
          arquivo da migration, nao de uma loja: **rode a `34b` em CADA loja ANTES do apply** e compare o corpo
          vivo; corpo diferente e loja que ninguem mediu (a migration tambem recusa, `B1_BASELINE_DIVERGENT`).
      - **Medir antes (opcional, so leitura, nao e portao):** `34m-medir-sino-da-retirada` conta (so numeros,
        nenhum dado pessoal) os pedidos de retirada, os com conta, os hoje em `shipping` e `delivered`, se o id e o
        endereco da loja concordam (esperado 0 de diferenca) e quantos avisos antigos ficam como estao.
      - **Caminho, uma loja por vez:** `34a` (sai NEGATIVA) -> `34b` MAIS NOVA e POSITIVA -> UM comando
        `aplicar-migrations.yml` com a migration -> o ensaio pede a `34a` DE NOVO, que tem de sair POSITIVA. `34a`
        POSITIVA com a versao fora do ledger: PARAR (sem backfill).
      - **Desfazer (decisao do DONO, nunca automatica):** pelo `aplicar-migrations.yml`:
        `rollback-manual-20261233000000_o_sino_do_pedido_de_retirada_fala_de_retirada.sql` (recria o corpo da
        `20261026000000`, mesmo md5, sem tocar a ACL nem a trigger, com pre-voo proprio; rodar duas vezes deixa o
        mesmo estado; NAO apaga nenhuma notificacao). Depois dele a `34b` volta a ser POSITIVA e a `34a` NEGATIVA.
      - **Depois do merge:** mudar `conferir-banco.cjs` ou o workflow invalida a evidencia: rodar a `34a` e a `34b`
        DE NOVO.
      - **Limites:** `tests/banco/o-sino-do-pedido-de-retirada-viva.cjs` prova o comportamento (entrega x retirada,
        bordas do `customer_data`, idempotencia, convidado, varias linhas, falha de aviso, o aviso antigo que fica,
        rollback, pre-voo que recusa sem escrever, concorrencia, mutantes) e
        `tests/banco/o-sino-do-pedido-de-retirada-portao-viva.cjs` prova a decisao das duas consultas, num Postgres 17
        efemero; nao provam o Postgres da Supabase, o papel `supabase_read_only_user` de cada loja nem o corpo vivo
        delas.

  35. **Lote de UMA migration, de apply normal: `20261234000000` (o lucro so conta produto com custo; MUDA O
      NUMERO QUE A LOJISTA LE, nao muda dado).** Sem `backfillLedger` e sem `nuncaAplicar`; valem as duas lojas
      assinantes (IKCOUS e Savy). Troca o corpo de `get_admin_analytics_v2` (a RPC do CRM > Visao geral) por
      `CREATE OR REPLACE`, com o corpo da `20261214000000` mais quatro trocas declaradas, sem tocar assinatura,
      volatilidade, `search_path`, as travas de admin, a ACL, a receita nem outra chave do JSON:
      - **O defeito:** o grafico "Lucro acumulado" e o "Top 5 produtos mais lucrativos" contavam a venda de produto
        SEM custo cadastrado (`custo IS NULL`) como lucro = preco inteiro (margem de 100% inventada; medido: Brinco
        de R$ 30 sem custo, uma venda, aparecia com lucro de R$ 30 e empatado com a receita). A decisao do dono
        ("custo ausente nao pode virar margem 100%", `20261024000000`) so tinha chegado a lista de produtos e ao
        "Lucro se vender tudo" (`20261214000000`).
      - **A regra (a MESMA do resto do app):** tem custo = `produtos.custo IS NOT NULL`. Custo 0 e zero medido (o
        brinde) e CONTA. O lucro por dia e o top 5 so somam produto com custo; a receita (dia a dia, hoje, mes,
        executivo) nao muda; `cost_sold` nao muda. Chave nova e aditiva: `productsWithoutCost` (quantos produtos
        diferentes, nao apagados, tem venda reconhecida e ficaram fora por nao ter custo).
      - **SIGNIFICADO que muda (decisao do dono, ja registrada):** o lucro do grafico CAI para quem tem produto sem
        custo, e o ranking perde esse produto; numa loja onde NENHUM produto tem custo o ranking fica vazio ate a
        lojista cadastrar o custo. A tela ainda nao avisa disso (o campo novo e o que deixa a tela avisar, em PR
        proprio): **rode a `35m` e mostre o numero ao dono antes do apply.**
      - Quem quebra: ninguem (nenhuma assinatura muda; o front le as mesmas chaves e uma chave a mais nao quebra
        nada). Nenhuma edge function muda. Duas consultas, so leitura, so catalogo, de ROL FECHADO (6 e 5 linhas,
        so valem com `rol=ok`):
        - **`35a-conferir-lucro-so-com-custo-aplicado`** (a consulta do lote) prova DEPOIS do apply o corpo novo
          (md5), a regra no corpo, os atributos de sempre e o `EXECUTE` fechado ao visitante.
        - **`35b-antes-lucro-so-com-custo-corpo-vigente`** (`ausenciaConfirmadaPor`) prova o ANTES: o corpo da
          `20261214000000`, sem a regra nova, com os atributos de sempre. **Nao mede a ACL.** O md5 vem do arquivo
          da migration, nao de uma loja: **rode a `35b` em CADA loja ANTES do apply**; corpo diferente e loja que
          ninguem mediu (a migration tambem recusa, `B1_BASELINE_DIVERGENT`). Loja ainda no corpo da
          `20261199000000` reprova aqui: aplique o lote 17 antes.
      - **Medir antes (so leitura, nao e portao):** `35m-medir-lucro-so-com-custo` conta (so numeros e somas, nenhum
        dado pessoal) quantos produtos nao tem custo, quantos tem custo zero, e quanto das vendas e de produto sem
        custo: o tamanho do lucro inventado que sai do grafico.
      - **Caminho, uma loja por vez:** `35a` (sai NEGATIVA) -> `35b` MAIS NOVA e POSITIVA -> UM comando
        `aplicar-migrations.yml` com a migration -> o ensaio pede a `35a` DE NOVO, que tem de sair POSITIVA. `35a`
        POSITIVA com a versao fora do ledger: PARAR (sem backfill).
      - **A cadeia das sucessoras:** `get_admin_analytics_v2` passa a ser `20261199000000` -> `20261214000000` ->
        `20261234000000`. A `17a` (lote 17) e a `8e` (lote 92-202) aceitam o corpo novo ao lado do da
        `20261214000000` e seguem POSITIVAS: rodar a `17a` e a `8e` DE NOVO depois do apply.
      - **Desfazer (decisao do DONO, nunca automatica):** pelo `aplicar-migrations.yml`:
        `rollback-manual-20261234000000_o_lucro_so_conta_produto_com_custo.sql` (recria o corpo da `20261214000000`,
        mesmo md5, sem tocar a ACL, com pre-voo proprio; rodar duas vezes deixa o mesmo estado), ANTES do rollback da
        `20261214000000` (o da 14 recusa enquanto houver redefinicao posterior no ar). Depois dele a `35b` volta a
        ser POSITIVA e a `35a` NEGATIVA. O campo `productsWithoutCost` some do JSON (nenhuma tela o le ainda).
      - **Depois do merge:** mudar `conferir-banco.cjs` ou o workflow invalida a evidencia: rodar a `8e`, a `17a`, a
        `35a` e a `35b` DE NOVO.
      - **Limites:** `tests/banco/lucro-so-com-custo-viva.cjs` prova o comportamento (lucro e ranking antes e depois,
        custo zero, receita igual, produto com custo igual byte a byte, dia sem venda, fuso das 22h, pedido que nao
        conta, dado que ja existia, rollback, pre-voo que recusa sem escrever, leitura concorrente, mutantes) e
        `tests/banco/lucro-so-com-custo-portao-viva.cjs` prova a decisao das duas consultas, num Postgres 17
        efemero; nao provam o Postgres da Supabase, o papel `supabase_read_only_user` de cada loja nem o corpo vivo
        delas.
  36. **Lote de UMA migration, de apply normal: `20261235000000` (a venda repetida do balcao devolve a venda
      feita; DINHEIRO E ESTOQUE, nao muda dado).** Sem `backfillLedger` e sem `nuncaAplicar`; valem as duas lojas
      assinantes (IKCOUS e Savy). Troca o corpo de `registrar_venda_presencial` (a RPC do PDV) por
      `CREATE OR REPLACE`, com o corpo da `20261199000000` mais UMA trava, sem tocar assinatura, `SECURITY
      DEFINER`, volatilidade, `search_path`, dono, comentario, ACL nem nenhuma resposta:
      - **O defeito:** a chave de idempotencia existe para a retentativa honesta (a rede cai, o balconista nao ve
        a confirmacao e toca "finalizar" de novo com a MESMA chave) receber o pedido que JA nasceu
        (`ja_existia = true`). A conferencia da chave era feita ANTES de qualquer trava: a repeticao que chegava
        antes de a primeira commitar nao achava nada, parava na trava de linha do estoque e, se a primeira levou a
        ULTIMA unidade, recebia "Estoque insuficiente" de uma venda que existe (a venda feita e o estoque baixado
        ficam; so a resposta mente, e o balconista tende a devolver o dinheiro de uma venda feita). Com estoque
        sobrando a repeticao ja caia no indice unico e devolvia `ja_existia`: o defeito so aparece na ultima
        unidade.
      - **A correcao:** `pg_advisory_xact_lock` sobre `hashtextextended('venda_presencial:' || chave, 0)`, tomada
        DEPOIS dos dois gates de admin e da checagem de sessao e ANTES de conferir a chave. A segunda chamada com a
        mesma chave ESPERA a primeira terminar e devolve `ja_existia` com o MESMO pedido, sem ler estoque; se a
        primeira desfez, a segunda segue como venda nova. Venda SEM chave nao toma trava; chaves DIFERENTES nao se
        serializam; a trava consultiva e a PRIMEIRA que a funcao toma (as de linha vem depois, na ordem de
        sempre): nenhum ciclo de espera novo.
      - Quem quebra: ninguem (nenhuma assinatura muda; o PDV, `useVendaPresencial`, ja trata `ja_existia`).
        Nenhuma edge function e nenhum front mudam. Duas consultas, so leitura, so catalogo, de ROL FECHADO (6 e 5
        linhas, so valem com `rol=ok`):
        - **`36a-conferir-venda-repetida-do-balcao-aplicado`** (a consulta do lote) prova DEPOIS do apply o corpo
          novo (md5), a trava pela chave no corpo, os atributos de sempre e o `EXECUTE` so para `authenticated`
          (PUBLIC, anon e service_role sem).
        - **`36b-antes-venda-repetida-do-balcao-corpo-vigente`** (`ausenciaConfirmadaPor`) prova o ANTES: o corpo
          da `20261199000000`, sem a trava, com os atributos de sempre. **Nao mede a ACL** (o pre-voo da migration
          a confere). O md5 vem do arquivo da migration, nao de uma loja: **rode a `36b` em CADA loja ANTES do
          apply**; corpo diferente e loja que ninguem mediu (a migration tambem recusa, `B1_BASELINE_DIVERGENT`).
      - **Medir antes:** nao ha `36m`. O lote muda concorrencia, nao o que a lojista le, e nenhuma contagem de loja
        diz com que frequencia a repeticao cai na ultima unidade.
      - **Caminho, uma loja por vez:** `36a` (sai NEGATIVA) -> `36b` MAIS NOVA e POSITIVA -> UM comando
        `aplicar-migrations.yml` com a migration -> o ensaio pede a `36a` DE NOVO, que tem de sair POSITIVA. `36a`
        POSITIVA com a versao fora do ledger: PARAR (sem backfill).
      - **A cadeia das sucessoras:** `registrar_venda_presencial` passa a ser `20261199000000` ->
        `20261235000000` -> `20261249000000` (item 52, motivo privado). A `8e` (lote 92-202) aceita os tres
        corpos medidos; a `36a` aceita os dois com trava, e a `36b` recusa ambos. A `9a` (lote 60-66,
        igualdade exata) exige agora o corpo FINAL da 249: so a 235 ja nao basta para ela.
        Rodar a `8e` e a `9a` DE NOVO depois do apply.
      - **Desfazer (decisao do DONO, nunca automatica):** se a 249 estiver no ar, desfaze-la PRIMEIRO pelo
        rollback do item 52 (preserva notas privadas); so depois, pelo `aplicar-migrations.yml`:
        `rollback-manual-20261235000000_a_venda_repetida_do_balcao_devolve_a_venda_feita.sql` (recria o corpo da
        `20261199000000`, mesmo md5, sem tocar a ACL nem o comentario, com pre-voo proprio; rodar duas vezes deixa o
        mesmo estado; NAO apaga nenhuma venda). Com ele **volta o defeito**. Depois dele a `36b` volta a ser
        POSITIVA e a `36a` NEGATIVA.
      - **Depois do merge:** mudar `conferir-banco.cjs` ou o workflow invalida a evidencia: rodar a `8e`, a `9a`, a
        `36a` e a `36b` DE NOVO.
      - **Limites:** `tests/banco/venda-balcao-mesma-chave-viva.cjs` prova o comportamento com DUAS conexoes reais
        (a corrida na ultima unidade, estoque sobrando, chaves diferentes e venda sem chave que nao se serializam,
        outro balconista e outro canal, permissao e gate antes da trava, controle com o corpo antigo que reproduz
        o defeito, rollback, pre-voo que recusa sem escrever, mutantes) e
        `tests/banco/venda-balcao-mesma-chave-portao-viva.cjs` prova a decisao das duas consultas, num Postgres 17
        efemero; nao provam o Postgres da Supabase, o papel `supabase_read_only_user` de cada loja nem o corpo vivo
        delas.

  37. **Lote de UMA migration, de apply normal: `20261236000000` (a compra que da R$ 0,00 nao se paga pelo app;
      DINHEIRO, ESTOQUE E CUPOM, nao muda dado; decisao do dono de 14/10/2026).** Sem `backfillLedger` e sem
      `nuncaAplicar`; valem as duas lojas assinantes (IKCOUS e Savy). Troca o corpo de
      `create_marketplace_order_v24` (so ela; a `v23`, da compra na entrega, NAO e tocada) por `CREATE OR REPLACE`,
      com o corpo da `20261229000000` mais UM bloco, sem tocar assinatura, `SECURITY DEFINER`, volatilidade,
      `search_path`, retorno `uuid` nem ACL:
      - **O defeito:** um cupom que zera a compra, com frete zero (retirada na loja, entrega local gratis ou o proprio
        desconto cobrindo o frete), deixava o total em R$ 0,00 e o pedido pelo app NASCIA: `aguardando`, com a reserva
        de 30 minutos, baixando o estoque e gastando a vaga do cupom (inclusive a do cupom de uso unico). Mas
        `criar-pagamento` recusa pedido de valor zero (nao existe cobranca de R$ 0,00 no Mercado Pago): a cliente nao
        tinha como pagar, e o pedido segurava estoque e cupom ate expirar.
      - **A correcao (bloco 6-ter):** `IF p_payment_method = 'online' AND round(v_calculated_total, 2) <= 0` recusa,
        com uma frase em portugues e o identificador `pedido_sem_valor_a_pagar_pelo_app` no DETAIL, ANTES do INSERT do
        pedido, da baixa do estoque e do uso do cupom. O total e o CALCULADO pelo servidor (nunca o `p_total_amount`
        do cliente), arredondado em 2 casas porque o pedido grava `numeric(10,2)`: R$ 0,01 em diante segue nascendo.
        So o meio `online` muda; `pix`, `card` e `cash` nao, e o pedido de R$ 0,00 na entrega continua nascendo pela
        `v23`.
      - **O que a cliente passa a ver:** a recusa com a frase, que o front (`src/lib/recusaDoPedido.ts`) traduz em
        "trocar a forma de pagamento". Banco antes ou depois do front da no mesmo (com o front antigo a recusa chega
        pelo toast com o texto do banco). **Pedido que ja nasceu com total zero pelo app (aguardando ou expirado)
        fica como esta**: a expiracao devolve estoque e cupom pelos caminhos de sempre.
      - Quem quebra: ninguem (nenhuma assinatura muda). Nenhuma edge function muda. Duas consultas, so leitura, so
        catalogo, de ROL FECHADO (6 e 5 linhas, so valem com `rol=ok`):
        - **`37a-conferir-compra-de-zero-reais-nao-se-paga-pelo-app-aplicado`** (a consulta do lote) prova DEPOIS do
          apply o corpo novo (md5), a recusa no corpo, os atributos de sempre e o `EXECUTE` de sempre (anon,
          authenticated e service_role sim; PUBLIC nao).
        - **`37b-antes-compra-de-zero-reais-nao-se-paga-pelo-app-corpo-vigente`** (`ausenciaConfirmadaPor`) prova o
          ANTES: o corpo da `20261229000000`, sem a recusa, com os atributos de sempre. **Nao mede a ACL** (o pre-voo
          da migration a confere). O md5 vem do arquivo da migration, nao de uma loja: **rode a `37b` em CADA loja
          ANTES do apply**. Loja ainda no corpo da `20261174000000` (o lote da 20261229000000 nao aplicado) reprova aqui e a
          migration recusa tambem (`B1_BASELINE_DIVERGENT`): aplique o lote da 20261229000000 antes.
      - **Medir antes:** nao ha `37m`; nenhuma contagem de loja e prova do que o lote muda (uma recusa nova, provada
        pelo comportamento).
      - **Caminho, uma loja por vez:** `37a` (sai NEGATIVA) -> `37b` MAIS NOVA e POSITIVA -> UM comando
        `aplicar-migrations.yml` com a migration -> o ensaio pede a `37a` DE NOVO, que tem de sair POSITIVA. `37a`
        POSITIVA com a versao fora do ledger: PARAR (sem backfill).
      - **A cadeia das sucessoras:** `create_marketplace_order_v24` passa a ser `20261174000000` ->
        `20261229000000` -> `20261236000000`. A `31a` (o lote da 20261229000000) aceita o corpo novo ao lado do da `20261229000000`
        (so na linha da `v24`) e segue POSITIVA; as provas vivas da 20261229000000 desfazem esta sucessora antes de medir.
        Rodar a `31a` DE NOVO depois do apply.
      - **Desfazer (decisao do DONO, nunca automatica):** pelo `aplicar-migrations.yml`:
        `rollback-manual-20261236000000_a_compra_que_da_zero_reais_nao_se_paga_pelo_app.sql` (recria o corpo da
        `20261229000000`, mesmo md5, sem tocar a ACL, com pre-voo proprio; rodar duas vezes deixa o mesmo estado),
        ANTES do rollback da `20261229000000` (o da 20261229000000 recusa enquanto houver redefinicao posterior no ar). Com ele
        **volta o beco sem saida**. Depois dele a `37b` volta a ser POSITIVA e a `37a` NEGATIVA.
      - **Depois do merge:** mudar `conferir-banco.cjs` ou o workflow invalida a evidencia: rodar a `31a`, a `37a` e
        a `37b` DE NOVO.
      - **Limites:** `tests/banco/a-compra-que-da-zero-reais-nao-se-paga-pelo-app-viva.cjs` prova o comportamento
        pelo caminho real do checkout (conta, convidada, retirada, cupom de 100%, cupom de uso unico), a ORDEM por
        uma sequencia movida por gatilhos (o rollback nao a desfaz), o zero na retirada/entrega nascendo como hoje,
        o positivo pelo app como hoje, o rollback, o pre-voo e os mutantes;
        `tests/banco/a-compra-que-da-zero-reais-nao-se-paga-pelo-app-portao-viva.cjs` prova a decisao das duas
        consultas, num Postgres 17 efemero. Nao provam o Postgres da Supabase, o papel `supabase_read_only_user` de
        cada loja nem o corpo vivo delas.
  38. **Migration de apply normal: `20261237000000` (a lojista renomeia e apaga categoria sem deixar produto
      orfao; PERMISSAO e REGRA DE DEVOLUCAO, nada se abre e nada se apaga no apply).** Sem `backfillLedger` e sem
      `nuncaAplicar`; valem as duas lojas assinantes (IKCOUS e Savy). So CRIA funcoes (`CREATE OR REPLACE`): as
      tres portas do painel, `renomear_categoria`, `apagar_categoria_vazia` e `categorias_com_uso`, e oito
      auxiliares internas `categoria__*`. Nenhuma tabela, coluna, politica de RLS, gatilho ou linha de dado muda
      no apply; so a lojista, usando a tela "Gerenciar categorias", troca dado:
      - **O defeito:** a categoria do produto e guardada pelo NOME, em quatro lugares (a linha de `categorias`,
        `produtos.categoria`, `banners.link` nos formatos codificado e cru, e `politica_devolucao.categorias_sem_troca`).
        Trocar o nome so na linha deixava o produto sumido da vitrine, o banner apontando para pagina vazia e a
        regra de "sem troca" apontando para um nome que nao existe mais (o produto voltava a ser trocavel).
      - **Agora:** `renomear_categoria` troca os quatro lugares numa transacao so (falha no meio nao deixa nada
        trocado), com a trava de admin ATUAL (`is_admin()` e `is_admin_atual()`), recusa nome repetido (maiuscula,
        acento ou pontuacao a mais) e vazio, e devolve quantos produtos, banners e regras trocou;
        `apagar_categoria_vazia` recusa com o motivo enquanto houver produto, banner ou regra apontando.
        "Esconder da vitrine" e a coluna `categorias.ativo`, que ja existia e que a vitrine ja respeita.
      - **Quem quebra:** ninguem (so a tela nova chama as funcoes). **ORDEM: o banco de CADA loja ANTES do front**,
        porque front novo contra banco sem as portas deixa a lojista sem renomear nem apagar categoria.
      - **Duas consultas**, so leitura, so catalogo, de ROL FECHADO (8 e 6 linhas, so valem com `rol=ok`):
        - **`38a-conferir-gestao-de-categorias-aplicado`** (a consulta do lote) prova DEPOIS do apply o corpo (md5)
          de cada uma das tres portas, os atributos, o EXECUTE so de `authenticated` e `service_role`, as oito
          auxiliares fechadas e o gatilho `set_ultima_atualizacao` do produto ligado.
        - **`38b-antes-gestao-de-categorias-funcoes-ausentes`** (`ausenciaConfirmadaPor`) prova o ANTES: as onze
          funcoes ainda ausentes, as colunas de que a migration depende de pe, `is_admin`, `is_admin_atual` e
          `f_unaccent` existindo e o gatilho do produto ligado. **Rode a `38b` em CADA loja ANTES do apply**
          (a migration tambem recusa, `B1_BASELINE_DIVERGENT`, se faltar dependencia).
      - **Caminho, uma loja por vez:** `38a` (sai NEGATIVA) -> `38b` MAIS NOVA e POSITIVA -> UM comando
        `aplicar-migrations.yml` com a migration -> o ensaio pede a `38a` DE NOVO, que tem de sair POSITIVA. `38a`
        POSITIVA com a versao fora do ledger: PARAR (sem backfill).
      - **Desfazer (decisao do DONO, nunca automatica):** pelo `aplicar-migrations.yml`:
        `rollback-manual-20261237000000_a_lojista_renomeia_e_apaga_categoria_sem_deixar_produto_orfao.sql` apaga as
        onze funcoes e so elas. **Nao desfaz nenhum renome ja feito:** os dados trocados ficam como estao (sao
        dado da lojista). Depois dele a `38b` volta a ser POSITIVA e a `38a` NEGATIVA.
      - **Depois do merge:** mudar `conferir-banco.cjs` ou o workflow invalida a evidencia: rodar a `38a` e a `38b`
        DE NOVO.
      - **Limites:** `tests/banco/categorias-gestao-viva.cjs` prova o comportamento (os quatro lugares, nome
        repetido, apagar com e sem uso, permissao de anon, logado comum e admin rebaixado, a codificacao do link,
        rollback, mutantes) e `tests/banco/categorias-gestao-portao-viva.cjs` prova a decisao das duas consultas,
        num Postgres 17 efemero; nao provam o Postgres da Supabase, o papel `supabase_read_only_user` de cada loja
        nem o corpo vivo delas. **Corrida conhecida:** uma aba de produto aberta ANTES de um renome, salva
        DEPOIS, grava o nome antigo no produto. O produto volta a ficar com um nome que nao existe mais na tabela
        `categorias`; a tela "Gerenciar categorias" NAO o mostra (la so existem as linhas de `categorias`, e esta
        nao tem linha), ele continua aparecendo em "Todas" na vitrine mas some do filtro da categoria. A lojista
        so o acha pela lista de produtos e corrige abrindo o produto e escolhendo a categoria de novo.
      - **Em aberto, declarado (nao e desta migration):**
        - **R5 (`UPDATE` e `DELETE` direto em `categorias`):** as politicas de RLS de `UPDATE` e de `DELETE` da tabela
          `categorias` ainda usam `is_admin()` (papel do JWT), nao o admin ATUAL. Por PostgREST um admin consegue
          trocar `nome` (deixa o produto orfao) e APAGAR a linha mesmo com produto, banner ou regra (o
          `apagar_categoria_vazia` so protege quem passa por ele). Tarefa separada: `rls_admin_atual` nas duas
          politicas, como a `20261202000000` fez nas do pedido.
        - **R6 (link de banner):** link com ENDERECO COMPLETO escrito a mao (`https://<loja>/?category=X`) e link
          sem a barra (`?category=X`) nao sao reconhecidos: renomear nao os troca (so `/?category=X`, o que o painel
          grava). O banner antigo continua abrindo uma pagina vazia ate a lojista trocar o link.
        - **Produto excluido:** conta como "em uso" e a lojista nao o ve nem o move; a categoria so pode ser apagada
          depois que ele sai dela (hoje, com ajuda do suporte). Se isso deve liberar o apagar, e decisao de produto.
        - **Nome "Todas"/"all":** recusado ao renomear (banco) e ao criar pela tela; o `INSERT` direto em
          `categorias` nao e barrado (pediria gatilho/`CHECK`, que muda o contrato da tabela).

  39. **Lote de UMA migration, de apply normal: `20261238000000` (a cliente pede a exclusao da conta e a correcao
      do e-mail; DADO DE CLIENTE e PERMISSAO (LGPD), ADITIVA: cria uma tabela e nao muda nada que ja exista).** Sem
      `backfillLedger` e sem `nuncaAplicar`; valem as duas lojas assinantes (IKCOUS e Savy). A migration NASCE
      `public.pedidos_de_privacidade` (o REGISTRO do pedido, que nasce vazio), a funcao de gatilho
      `pedidos_de_privacidade__carimbar()` e o gatilho `tr_pedidos_de_privacidade_carimbar`, com RLS ligada e tres
      politicas:
      - **Quem pode o que:** a cliente le so os pedidos dela e insere so em nome dela (so as colunas `user_id`,
        `tipo`, `email_novo`); no maximo UM pedido aberto por (cliente, tipo); so o admin de AGORA
        (`rls_admin_atual()`) le todos e decide (`situacao` e `observacao`), com quem e quando carimbados pelo
        gatilho; a chave estrangeira para `auth.users(id)` e SEM cascata; **ninguem apaga** (sem grant de DELETE nem
        para o `service_role`, sem politica de DELETE).
      - **NAO E REAPLICAVEL:** o pre-voo recusa (`B1_BASELINE_DIVERGENT`) se a tabela ou a funcao ja existirem, e se
        faltar `auth.users`, `auth.uid()` ou `public.rls_admin_atual()` (a `20261197000000` vem antes). Reaplicar
        depois de aplicada aborta no pre-voo: o estado se confere pela `39a`, nunca reaplicando. Um bloco `DO` no fim
        aborta o apply inteiro se a RLS, as politicas, os privilegios de tabela e de coluna, o indice unico parcial, o
        gatilho ou o `EXECUTE` da funcao nao forem os combinados.
      - **Ordem:** o banco de CADA loja (IKCOUS, depois Savy) ANTES do front que le a tabela (a tela "Privacidade e
        meus dados" da cliente e a secao "Pedidos de privacidade dos clientes" do painel dependem dela). Nenhuma edge
        function muda. Quem quebra: ninguem que ja exista.
      - **Duas consultas, so leitura, so catalogo, de ROL FECHADO (19 e 9 linhas, so valem com `rol=ok`):**
        - **`39a-conferir-pedidos-de-privacidade-aplicado`** (a consulta do lote) prova DEPOIS do apply a tabela
          inteira (colunas, as 8 constraints e a regra de cada CHECK, a chave sem cascata, os dois indices), a RLS ligada
          com as tres politicas e a expressao delas, os privilegios (PUBLIC e anon nenhum; authenticated so le a tabela
          e so escreve as colunas do pedido; service_role le, grava e decide, NAO apaga), a funcao do gatilho (corpo por
          md5, atributos, `EXECUTE` fechado a PUBLIC, anon e authenticated) e o gatilho. O `EXECUTE` do `service_role`
          nao e medido (a plataforma o concede por padrao e a migration nao o mexe).
        - **`39b-antes-pedidos-de-privacidade-objetos-ausentes`** (`ausenciaConfirmadaPor`) prova o ANTES: a tabela, os
          dois indices, a funcao e o gatilho AUSENTES; `auth.users`, `auth.uid()` e `rls_admin_atual()` presentes; e **o
          papel `postgres` (o que aplica pelo `aplicar-migrations.yml`) com `REFERENCES` em `auth.users`** — o privilegio
          que a chave estrangeira do pedido exige e que o pre-voo da migration nao confere. **Rode a `39b` em CADA loja
          ANTES do apply;** um `nao` na linha do `REFERENCES` e a loja onde o apply abortaria no meio (a transacao
          desfaz, mas e melhor saber antes). Loja com a migration pela metade reprova nas DUAS consultas: PARAR e medir.
      - **Medir (so leitura, nao e portao):** `39m-medir-privilegios-do-roteiro-de-privacidade` mostra, so por
        catalogo (nenhuma linha de nenhuma tabela e lida, nem a contagem), se o papel `postgres` da loja tem `UPDATE` e
        `DELETE` em `auth.users`, `auth.identities`, `auth.audit_log_entries`, `auth.sessions`,
        `auth.one_time_tokens` e `auth.mfa_factors`, as tabelas de login que o roteiro manual toca. Um `nao` no que o
        roteiro usa (a coluna `roteiro=` diz o que ele faz em cada tabela) quer dizer que o passo dele falharia nessa
        loja; nao e defeito da migration.
      - **O ROTEIRO MANUAL NAO ENTRA NESTE LOTE:** `docs/runbooks/atender-pedido-de-privacidade.md` (o bloco de SQL das
        linhas ~264-323: anonimizacao de uma conta, que atualiza e APAGA dado real de login) e do DONO, caso a caso,
        pedido por pedido, sempre depois do ensaio (`v_confirmar := false`). Nenhum workflow, consulta ou comando deste
        lote o executa; a `39m` so diz se ele esbarraria em falta de privilegio.
      - **Caminho, uma loja por vez:** `39a` (sai NEGATIVA) -> `39b` MAIS NOVA e POSITIVA -> UM comando
        `aplicar-migrations.yml` com a migration -> o ensaio pede a `39a` DE NOVO, que tem de sair POSITIVA. `39a`
        POSITIVA com a versao fora do ledger: PARAR (sem backfill).
      - **Desfazer (decisao do DONO, nunca automatica):** pelo `aplicar-migrations.yml`:
        `rollback-manual-20261238000000_a_cliente_pede_exclusao_da_conta_e_correcao_do_email.sql` (apaga o gatilho, a
        funcao, as tres politicas e a tabela). **RECUSA se houver QUALQUER pedido registrado:** e registro legal, e
        arquiva-lo por fora e decisao do dono; rodar duas vezes recusa no pre-voo (nada a desfazer). Depois dele a
        `39b` volta a ser POSITIVA e a `39a` NEGATIVA. Com o rollback o app volta a nao ter caminho para a cliente
        pedir a exclusao da conta ou a correcao do e-mail.
      - **Depois do merge:** mudar `conferir-banco.cjs` ou o workflow invalida a evidencia: rodar a `39a` e a `39b`
        DE NOVO.
      - **Limites:** `tests/banco/pedidos-de-privacidade-viva.cjs` prova o comportamento com a RLS real,
        `tests/banco/anonimizar-conta-ensaio-viva.cjs` ensaia o roteiro (com o esquema `auth` emulado) e
        `tests/banco/pedidos-de-privacidade-portao-viva.cjs` prova a decisao das duas consultas, num Postgres 17
        efemero; nao provam o Postgres da Supabase, o papel `supabase_read_only_user` de cada loja, o `REFERENCES` do
        `postgres` real (la ele e superusuario, e o numero que importa e o da `39b` na loja) nem o que ha em
        `auth.*` de cada uma.
  40. **Lote de UMA migration, de apply normal: `20261239000000` (a loja PODE declarar razao social, CNPJ/CPF e
      e-mail de atendimento; ADITIVA e OPCIONAL, nao muda dado).** Sem `backfillLedger` e sem `nuncaAplicar`; valem
      as duas lojas assinantes (IKCOUS e Savy). Acrescenta tres colunas NULAS e sem default em `store_config`
      (`store_legal_name`, `store_legal_document`, `store_support_email`), tres CHECK de forma, as tres colunas NO FIM
      da view `v_store_config` (por `CREATE OR REPLACE VIEW`: de 42 para 45 colunas, ACL e opcoes nao sao
      recriados) e as tres chaves novas na `upsert_store_config` (o corpo da `20261199000000` mais tres trocas
      declaradas; salvar um dos tres, ou qualquer outro campo, nao apaga os demais):
      - **O que muda para a lojista e para a cliente:** a lojista ganha o formulario "Dados da empresa" em Minha loja
        e a cliente le razao social, CNPJ/CPF e e-mail nos Termos, na Privacidade e no rodape. Quem nao preencher
        nada nao muda NADA para ninguem; a linha `id = 1` de `store_config` ganha `NULL/NULL/NULL`.
      - **ORDEM:** o banco de CADA loja (IKCOUS, depois Savy) ANTES de publicar o front desta branch: o front le e
        grava os tres campos, e front publicado antes do banco procura colunas que a loja ainda nao tem.
      - Quem quebra: ninguem (nenhuma assinatura muda; as tres chaves sao opcionais). Nenhuma edge function muda.
        Duas consultas, so leitura, so catalogo, de ROL FECHADO (11 e 10 linhas, so valem com `rol=ok`):
        - **`40a-conferir-identidade-legal-da-loja-aplicado`** (a consulta do lote) prova DEPOIS do apply o corpo da
          `upsert_store_config` (md5) com os tres CASE, os atributos e o `EXECUTE` fechado ao visitante, as tres
          colunas (text, nulas, sem default), as tres CHECK, as 45 colunas da view, as opcoes
          (`security_invoker=on`) e o ACL da view.
        - **`40b-antes-identidade-legal-da-loja-base-vigente`** (`ausenciaConfirmadaPor`) prova o ANTES: o corpo da
          `20261199000000` sem os tres CASE, as tres colunas e as tres CHECK ainda ausentes, a view de 42 colunas com
          as opcoes e o ACL. **Nao mede o `EXECUTE` da funcao.** O md5 vem do arquivo da migration, nao de uma loja:
          **rode a `40b` em CADA loja ANTES do apply**; corpo diferente e loja que ninguem mediu (a migration
          tambem recusa, `B1_BASELINE_DIVERGENT`).
      - **O ACL DA VIEW e' o que o DESFAZER precisa:** o rollback encolhe a view de 45 para 42 colunas, e o Postgres
        recusa `CREATE OR REPLACE VIEW` que encolha; por isso ele faz `DROP VIEW` + `CREATE VIEW` +
        `GRANT ALL ... TO anon, authenticated, service_role`. So devolve o estado vivo se o ACL de hoje for
        exatamente esse. As DUAS consultas medem a linha "ACL" da view (dono `postgres`; `anon`, `authenticated` e
        `service_role` com ALL; `PUBLIC` sem nada; nenhum outro papel; nenhum GRANT OPTION): **uma loja com ACL
        diferente reprova na `40b` e NAO recebe o apply** ate o dono decidir (a alternativa e outro rollback, nao
        afrouxar a consulta).
      - **Medir antes (so leitura, nao e portao):** `40m-medir-identidade-legal-da-loja` mostra o ACL CRU da view
        (`relacl`), o dono e as opcoes, quantos objetos dependem da view (o `DROP VIEW` do rollback recusa se algum
        depender), a linha unica de `store_config` e o corpo vivo da `upsert_store_config`. So nomes de papeis,
        letras de privilegio e contagens; nenhum valor de coluna de `store_config`.
      - **Caminho, uma loja por vez:** `40a` (sai NEGATIVA) -> `40b` MAIS NOVA e POSITIVA -> UM comando
        `aplicar-migrations.yml` com a migration -> o ensaio pede a `40a` DE NOVO, que tem de sair POSITIVA. `40a`
        POSITIVA com a versao fora do ledger: PARAR (sem backfill).
      - **A cadeia das sucessoras:** `upsert_store_config` passa a ser `20261199000000` -> `20261239000000`. A `8e`
        (lote 92-202) aceita o corpo novo como sucessor e segue POSITIVA; a `9a` (faixa 60-66) passou a exigir o
        corpo NOVO dessa funcao (ela prova sempre a migration mais nova que define cada funcao), entao numa loja que
        ainda nao recebeu este lote a `9a` sai NEGATIVA nessa linha (o `canais-de-backend.json` so a exige, e so na
        IKCOUS, quando o lote 60-66 e novo para a loja: confira o ledger da IKCOUS antes de assumir que nao e).
      - **Desfazer (decisao do DONO, nunca automatica):**
        `rollback-manual-20261239000000_a_loja_declara_quem_e_na_nota_e_como_falar_com_ela.sql` (recria o corpo da
        `20261199000000`, mesmo md5; recria a view de 42 colunas; derruba as tres colunas por ULTIMO; **RECUSA**
        com `DADO_DA_LOJA_NAO_SE_APAGA_SEM_QUERER` se a loja ja preencheu algum dos tres campos: apagar o que a
        lojista digitou e' ato deliberado, nunca efeito colateral; o cabecalho do arquivo diz como aplicar). Depois
        dele a `40b` volta a ser POSITIVA e a `40a` NEGATIVA.
      - **Depois do merge:** mudar `conferir-banco.cjs` ou o workflow invalida a evidencia: rodar a `8e`, a `9a`, a
        `40a` e a `40b` DE NOVO.
      - **Limites:** `tests/banco/loja-declara-quem-e-viva.cjs` prova o comportamento (salvar um campo nao apaga os
        outros, a forma recusada pelas CHECK, so o admin atual grava, o visitante le e nao escreve, ida e volta com o
        corpo da 99 e o ACL da view iguais, o rollback que recusa com dado) e
        `tests/banco/loja-declara-quem-e-portao-viva.cjs` prova a decisao das duas consultas, num Postgres 17
        efemero; nao provam o Postgres da Supabase, o papel `supabase_read_only_user` de cada loja nem o ACL vivo
        delas (isso so a `40b` e a `40m` rodadas contra o ref de cada loja).

  41. **Lote de UMA migration, de apply normal: `20261240000000` (a cliente e avisada quando a loja responde a
      pergunta dela; DADO DE CLIENTE: o sino e da cliente).** Sem `backfillLedger` e sem `nuncaAplicar`; valem as
      duas lojas assinantes (IKCOUS e Savy). Troca o corpo das DUAS sobrecargas de `answer_question_atomic` (a de 2
      argumentos, que o app usa, e a de 3) por `CREATE OR REPLACE`, sem tocar assinatura, `SECURITY DEFINER`,
      volatilidade, `search_path` nem ACL:
      - **O defeito:** a tela de perguntas do painel diz "Notificar Cliente", mas a resposta so gravava o texto e uma
        linha falsa em `push_notifications_log` (0 aparelhos): nenhum push saia e nada chegava ao sino da cliente (quem
        perguntou "tem no M?" nunca soube que a loja respondeu). A linha falsa ainda empurrava as campanhas reais para
        fora da lista de 20 do painel.
      - **O que muda:** a resposta cria UM aviso em `notificacoes` para quem perguntou (tipo `info`, titulo "Sua
        pergunta foi respondida", mensagem com o nome do produto, destino `/product-detail?id=<produto>`, nao lido) e
        PARA de gravar a linha falsa. Resposta repetida ou editada nao duplica (um aviso por pergunta; se a cliente
        dispensou e a loja edita, nasce um aviso novo). Pergunta ja respondida antes do apply NAO ganha aviso em
        massa: so se a loja editar a resposta. O aviso e best-effort: se falhar, a RESPOSTA nunca se perde. **Nao envia
        push** (exige a edge function e rede). O sino acende sozinho pelo realtime que o app ja escuta.
      - **O que NAO muda:** nenhum dado existente (as linhas falsas que ja estao em `push_notifications_log` FICAM no
        banco; apagar e decisao do dono, e o painel de campanhas as esconde do historico). `reply_review_atomic` (a
        resposta a AVALIACAO) NAO e tocada: a consulta `27m` usa a linha do log dela como rastro de resposta legitima.
      - **A MESMA release leva o front** (texto da caixa de resposta "Avisa a cliente no app" e o historico de
        campanhas sem as linhas da resposta da loja). **Ordem: o banco de CADA loja primeiro, o front depois** (o texto
        novo so e verdade com a migration aplicada). Quem quebra: ninguem (nenhuma assinatura muda).
      - Duas consultas, so leitura, so catalogo, de ROL FECHADO (10 e 8 linhas, so valem com `rol=ok`):
        - **`41a-conferir-pergunta-respondida-avisa-a-cliente-aplicado`** (a consulta do lote) prova DEPOIS do apply,
          nas DUAS sobrecargas, o corpo novo (md5), o aviso no sino sem o log de push, os atributos de sempre e o
          `EXECUTE` fechado ao visitante.
        - **`41b-antes-pergunta-respondida-corpos-vigentes`** (`ausenciaConfirmadaPor`) prova o ANTES: as duas
          sobrecargas (e so elas) com os corpos da `20261065000000` (2 args) e da `20261064000000` (3 args), sem
          gravar no sino. **Nao mede a ACL.** O md5 vem dos arquivos das migrations, nao de uma loja: **rode a `41b`
          em CADA loja ANTES do apply**; corpo diferente e loja que ninguem mediu (a migration tambem recusa,
          `B1_BASELINE_DIVERGENT`).
      - **Medir antes (so leitura, nao e portao):** `41m-medir-pergunta-respondida` conta (so numeros, nenhum dado
        pessoal) quantas perguntas ja foram respondidas sem aviso, quantas linhas falsas ja estao no log de push e se
        ja existe algum aviso de pergunta no sino (esperado zero).
      - **Caminho, uma loja por vez:** `41a` (sai NEGATIVA) -> `41b` MAIS NOVA e POSITIVA -> UM comando
        `aplicar-migrations.yml` com a migration -> o ensaio pede a `41a` DE NOVO, que tem de sair POSITIVA. `41a`
        POSITIVA com a versao fora do ledger: PARAR (sem backfill).
      - **NUNCA reaplicar a `20261064` nem a `20261065` depois desta.** Elas recriam o corpo ANTIGO de
        `answer_question_atomic` (a linha falsa no log de push, sem aviso no sino) por cima do novo, e o marcador
        `A10: log honesto` que o `db-apply` confere nelas deixou de existir nessa funcao (segue valendo em
        `reply_review_atomic`). Se for preciso desfazer, use o rollback abaixo, nunca essas duas.
      - **Desfazer (decisao do DONO, nunca automatica):** pelo `aplicar-migrations.yml`:
        `rollback-manual-20261240000000_a_cliente_e_avisada_quando_a_loja_responde_sua_pergunta.sql` (recria os dois
        corpos de antes, mesmo md5; os avisos ja criados em `notificacoes` FICAM, sao avisos verdadeiros). **Este
        rollback tem pre-voo e conferencia final proprios** (como os outros rollbacks da casa): recusa
        (`B1_BASELINE_DIVERGENT`) se `answer_question_atomic` nao tem exatamente as duas assinaturas ou se o corpo vivo
        de qualquer uma nao e o desta migration nem o de antes (alguem trocou o corpo de novo: desfazer por cima
        apagaria a trava nova em silencio) e, depois de recriar os corpos, aborta se algum nao voltou ao md5 de antes.
        Depois de desfazer, conferir a `41b` POSITIVA e a `41a` NEGATIVA. Desfazer volta o defeito (a linha falsa no
        log e nenhum aviso na cliente).
      - **Desfazer o banco EXIGE desfazer o FRONT junto, e o front vai PRIMEIRO.** Com o banco desfeito e o front
        desta release ainda no ar, a caixa de resposta do painel (`AdminQAView.tsx`) continua dizendo "Avisa a cliente
        no app" e isso volta a ser FALSO: a lojista acha que avisou e a cliente nao recebe nada. Ordem: (1) publicar
        de novo o front de ANTES desta release (ou um front sem essa frase) em TODAS as lojas e conferir
        `version.json` de cada uma; (2) so entao rodar o rollback do banco, loja por loja. Nunca o contrario. O front
        de antes funciona com o banco novo (nenhuma assinatura muda), entao desfazer o front primeiro e seguro.
      - **Depois do merge:** mudar `conferir-banco.cjs` ou o workflow invalida a evidencia: rodar a `41a` e a `41b` DE
        NOVO.
      - **Limites:** `tests/banco/pergunta-respondida-avisa-viva.cjs` prova o comportamento (defeito antes, aviso so
        para quem perguntou nas duas sobrecargas, um aviso por pergunta, permissao, falha do aviso sem perder a
        resposta, corrida de duas conexoes, rollback byte a byte, pre-voo que recusa sem escrever, mutantes) e
        `tests/banco/pergunta-respondida-avisa-portao-viva.cjs` prova a decisao das duas consultas, num Postgres 17
        efemero; nao provam o Postgres da Supabase, o papel `supabase_read_only_user` de cada loja nem o corpo vivo
        delas.

  43. **Lote de UMA migration, de apply normal: `20261241000000` (o reembolso em duvida prende o saldo; DINHEIRO;
      lote R1 do plano reembolso-ab de 15/10/2026).** Sem `backfillLedger` e sem `nuncaAplicar`; valem as duas lojas
      assinantes (IKCOUS e Savy). ADITIVA: uma tabela nova vazia (`order_refund_prova`, so do servidor), cinco funcoes
      novas e sete corpos trocados por `CREATE OR REPLACE` (assinatura, dono, ACL e atributos preservados):
      - **O defeito:** uma linha de reembolso `falhou`/`recusado` cujo dinheiro PODE ter saido no Mercado Pago (sem
        prova de que nada saiu) nao contava no saldo a devolver: a lojista podia pedir de novo e o cliente receber
        duas vezes. E uma linha presa em processamento nao tinha saida: o cliente esperava para sempre.
      - **O que muda:** o saldo (`pedido__saldo_a_estornar`, lido pelo pedir reembolso e pelo concluir devolucao)
        desconta o "em duvida" pela regra UNICA `order_refund__pode_ter_saido` (com a regra do legado: linha de antes
        da autorizacao marcada mais de uma vez PODE ter saido); a linha resolvida por fora sai da conta (nao desconta
        duas vezes). O painel le `pedido_reembolsos_e_saldo` (total, estornado, em voo, em duvida, manual,
        disponivel nunca negativo, `reservado_por_fora` = linha resolvida por fora que o Mercado Pago ainda nao
        respondeu, mantida fora do saldo e mostrada como "reservado" (nunca "tudo devolvido"), e as linhas com
        `pode_ter_saido`, `por_fora_liberado_em` = a MARCA,
        `por_fora_apos_espera_liberado` = a ESPERA de 7 dias passou (a porta ainda pode recusar por outro motivo; o
        front mostra a resposta dela) e `substituida_por_manual`). Duas
        saidas de 7 dias com a frase `DEVOLVI POR FORA` (`admin_devolucao_reembolso_por_fora_apos_espera`,
        `registrar_estorno_manual_apos_espera`) leem a MESMA espera do botao (`order_refund__liberavel_apos_espera`,
        relogio do banco), marcam a linha e respondem `risco_de_dobro`. A do pedido cancelado so marca o pedido como
        `estornado` quando a linha cobre TODO o saldo ainda a devolver; a linha PARCIAL so ganha a marca por fora,
        o pedido segue pago e o valor dela segue descontado no saldo como "por fora"; o `autorizar_post_do_estorno` recusa
        (`linha_mudou`) a linha liberada por fora: o robo nunca reenvia o que a loja pagou a mao. O aviso da
        devolucao em processamento diz que a loja esta confirmando com o Mercado Pago. A antiga
        `admin_devolucao_reemitir_reembolso` perde o `EXECUTE` do logado (nenhum chamador no front publicado).
      - **Medido antes (`42m`, 15/10/2026):** zero linhas `falhou`/`recusado` na IKCOUS e na Savy: NENHUM saldo
        existente muda no apply.
      - Duas consultas, so leitura, so catalogo, de ROL FECHADO (21 e 14 linhas, so valem com `rol=ok`):
        - **`43a-conferir-reembolso-em-duvida-aplicado`** (a consulta do lote) prova DEPOIS do apply os doze corpos
          (md5), os atributos, o `EXECUTE` de cada papel, a tabela de marcas so do servidor e os marcadores (o saldo
          desconta o em duvida; as duas saidas e o painel leem a mesma espera).
        - **`43b-antes-reembolso-em-duvida-base-vigente`** (`ausenciaConfirmadaPor`) prova o ANTES: a tabela e as
          cinco funcoes novas AUSENTES, os sete corpos vigentes, as funcoes de dinheiro chamadas com o corpo
          conhecido, a funcao antiga existindo e o gatilho do aviso ligado. **Nao mede a ACL.** Rode a `43b` em CADA
          loja ANTES do apply.
      - **Caminho, uma loja por vez (IKCOUS, depois Savy):** `43a` (sai NEGATIVA) -> `43b` MAIS NOVA e POSITIVA ->
        UM comando `aplicar-migrations.yml` com a migration -> o ensaio pede a `43a` DE NOVO, que tem de sair
        POSITIVA. `43a` POSITIVA com a versao fora do ledger: PARAR (sem backfill). A `8e`, a `28a` e a `29a` seguem
        POSITIVAS depois do apply (os corpos novos entram como sucessores conhecidos delas).
      - **ORDEM: o banco de CADA loja ANTES do front do R1** (a tela nova chama `pedido_reembolsos_e_saldo` e as
        duas saidas). O front de antes funciona com o banco novo (nenhuma assinatura muda).
      - **NUNCA reaplicar a `20261196`, a `20261197`, a `20261198`, a `20261225` nem a `20261226` depois desta.** O
        pre-voo delas recusa os corpos novos.
      - **Desfazer (decisao do DONO, nunca automatica):** pelo `aplicar-migrations.yml`:
        `rollback-manual-20261241000000_o_reembolso_em_duvida_prende_o_saldo.sql` (recria os sete corpos de antes,
        mesmo md5; apaga as cinco funcoes novas e a tabela; devolve o `EXECUTE` do logado a funcao antiga). **O
        rollback RECUSA (`MARCA_DE_REEMBOLSO_NAO_SE_APAGA_SEM_QUERER`) se `order_refund_prova` tiver qualquer
        linha:** apagar uma marca por fora deixaria o robo reenviar um reembolso ja pago a mao. Tambem recusa se algum
        corpo vivo nao for o desta nem o de antes. Depois, a `43b` volta POSITIVA e a `43a` NEGATIVA. **Desfazer o
        banco EXIGE desfazer o FRONT do R1 ANTES** (a tela nova chamaria funcao que nao existe mais).
      - **Depois do merge:** mudar `conferir-banco.cjs` ou o workflow invalida a evidencia: rodar a `8e`, a `43a` e
        a `43b` DE NOVO.
      - **Limites:** `tests/banco/reembolso-em-duvida-viva.cjs` prova o comportamento (saldo igual em pedido sem
        linha em duvida, o legado prende, a substituida solta, a espera antes/com 7 dias/depois/com a marca, o
        autorizar recusa, corrida de duas conexoes, ACL, aplicar 2x e CRLF, rollback, mutantes) e
        `tests/banco/reembolso-em-duvida-portao-viva.cjs` prova a decisao das duas consultas, num Postgres 17
        efemero; nao provam o Postgres da Supabase, o papel `supabase_read_only_user` de cada loja nem o corpo vivo
        delas.

  45. **Lote de UMA migration, de apply normal: `20261242000000` (o lucro usa o custo do dia da venda; DINHEIRO e
      DADO DE CLIENTE; decisao do dono de 15/10/2026).** Sem `backfillLedger` e sem `nuncaAplicar`; valem as duas
      lojas assinantes (IKCOUS e Savy). ADITIVA: uma tabela nova VAZIA (`marketplace_order_item_custo`, so do
      servidor), uma funcao de gatilho e o gatilho novos, e dois corpos trocados por `CREATE OR REPLACE`
      (`get_admin_analytics_v2` e `fin_dre`; assinatura, dono, ACL e atributos preservados):
      - **O que muda:** cada item que NASCE (loja, balcao, qualquer porta) ganha uma linha com o custo que o produto
        tinha naquele dia. O lucro do CRM, o Top 5 e o CMV da DRE leem esse custo e, se nao existe, o custo de hoje.
        A devolucao na DRE usa o custo do item ORIGINAL (juncao por `order_item_id`; nada e copiado para as tabelas
        da devolucao). O valor de ESTOQUE (inventario e alertas) segue com o custo de hoje. `cmv_estimado` deixa de
        ser constante: e `true` so quando algum item do periodo usou o custo de hoje.
      - **O que NAO muda no apply:** nenhum dado existente e lido nem reescrito (SEM backfill). Toda venda feita
        ANTES do apply, e toda venda feita com o produto SEM custo, segue com o custo de hoje: os numeros dos
        relatorios, com a tabela vazia, sao os mesmos de antes. So as vendas DEPOIS ganham o custo do dia.
      - **O gatilho nunca derruba a compra:** um erro vira aviso so com o `SQLSTATE` e o id do item (nunca o valor).
        Custo medido do bloco de tratamento de erro: uma venda de 200 itens gasta ~475 ms contra ~434 ms sem o
        gatilho (203 contra 3 transacoes internas), aceito de proposito. A `45m` (so leitura, rol aberto, NAO e
        portao) conta os itens nascidos depois do apply que ficaram SEM linha apesar de o produto ter custo: e o
        unico modo de saber se o gatilho esta falhando em silencio.
      - **APLICAR FORA DO HORARIO DE PICO.** A migration pega a trava de `marketplace_order_items` SEM entrar na fila
        (`LOCK ... NOWAIT` em laco, 4 s, com `lock_timeout` e `statement_timeout`): uma venda nova nunca espera por
        ela; se uma venda segura a tabela, o apply recusa (`55P03`) e basta repetir.
      - Duas consultas, so leitura, so catalogo, de ROL FECHADO (13 e 6 linhas, so valem com `rol=ok`):
        - **`45a-conferir-custo-do-dia-aplicado`** (a consulta do lote) prova DEPOIS do apply os tres corpos (md5),
          os atributos, o `EXECUTE` por papel (o gatilho fechado a todos), a tabela so do servidor (RLS ligada,
          sem `FORCE`, sem politica, sem acesso a PUBLIC/anon/authenticated/service_role), o gatilho ligado e a
          tabela fora do realtime.
        - **`45b-antes-custo-do-dia-base-vigente`** (`ausenciaConfirmadaPor`) prova o ANTES: os dois corpos vigentes
          (da `20261234000000` e da `20261199000000`) e o gatilho ausente. Rode a `45b` em CADA loja ANTES do apply.
      - **Caminho, uma loja por vez (IKCOUS, depois Savy):** `45a` (sai NEGATIVA) -> `45b` MAIS NOVA e POSITIVA ->
        UM comando `aplicar-migrations.yml` com a migration -> o ensaio pede a `45a` DE NOVO, que tem de sair
        POSITIVA. A `8e`, a `35a` e a `17a` seguem POSITIVAS depois do apply (os corpos novos entram como
        sucessores conhecidos delas).
      - **ORDEM: o banco de CADA loja ANTES do front desta mudanca** (o front so troca textos de ajuda).
      - **Desfazer, EM DOIS DEGRAUS (decisao do DONO, nunca automatica):**
        1. `rollback-manual-20261242000000_o_lucro_usa_o_custo_do_dia_da_venda.sql` devolve os dois corpos byte a
           byte e tira o gatilho e a funcao dele, mas DEIXA a tabela e os registros (o custo do dia nao se
           reconstroi: o custo do produto muda e o de ontem se perde). Reaplicar a migration depois aceita a tabela
           presente e os registros voltam a valer.
        2. `rollback-manual-destrutivo-20261242000000_o_lucro_usa_o_custo_do_dia_da_venda.sql` APAGA a tabela. SO COM
           O DONO, num psql, depois de guardar uma copia dos registros, e SO depois do primeiro degrau: exige
           `SET app.confirmo_apagar_o_custo_do_dia = 'APAGAR'` e recusa se o gatilho ou alguma funcao ainda cita a
           tabela.
      - **Depois do merge:** mudar `conferir-banco.cjs` ou o workflow invalida a evidencia: rodar a `8e`, a `35a`, a
        `17a`, a `45a` e a `45b` DE NOVO.
      - **Limites declarados (anotados, nao resolvidos):** custo errado congelado no dia (nao ha "ajuste de custo");
        venda feita sem custo no dia segue com o custo de hoje; carga em massa de itens passa pelo gatilho (para
        carregar sem ele, `session_replication_role = replica`, so o dono); o admin pode trocar o `product_id` do
        item (a linha segue com o custo do produto de antes); a DRE trata custo desconhecido como 0.
      - **Provas:** `tests/banco/custo-do-dia-viva.cjs` (comportamento) e `tests/banco/custo-do-dia-portao-viva.cjs`
        (as consultas), num Postgres 17 efemero; nao provam o Postgres da Supabase nem o corpo vivo de cada loja.

  46. **Lote de UMA migration, de apply normal: `20261243000000` (desfazer o recebimento recusa pedido com devolucao
      viva; DINHEIRO; ordem do dono de 15/10/2026).** Sem `backfillLedger` e sem `nuncaAplicar`; valem as duas
      lojas assinantes (IKCOUS e Savy). ADITIVA e SO DE FUNCAO: nenhuma tabela, coluna ou linha e criada, lida ou
      reescrita; um corpo trocado por `CREATE OR REPLACE` (`registrar_pagamento_recebido(uuid, boolean)`; assinatura,
      dono, ACL e atributos preservados):
      - **O que muda:** o botao "Desfazer recebimento" do pedido de entrega (e a venda do balcao) passa a RECUSAR, com a
        frase "Este pedido tem devolucao em andamento ou concluida. O recebimento so pode ser desfeito se a devolucao for recusada, cancelada ou reprovada na inspecao; devolucao concluida nao permite desfazer.", quando
        o pedido tem uma devolucao viva (qualquer uma que NAO seja recusada, cancelada nem reprovada: o criterio da
        anulacao do balcao e de `solicitar_devolucao`). Antes, o desfazer apagava o pagamento e a data, a venda sumia
        do Financeiro e a devolucao aberta ficava sem pagamento para devolver.
      - **O que NAO muda no apply:** nenhum dado existente e lido nem reescrito. Um pedido que JA foi desfeito com
        devolucao aberta, pelo defeito antigo, fica como esta: a lojista marca "Recebi" de novo e depois resolve a
        devolucao. O "Recebi", o desfazer que ja era no-op e a devolucao morta seguem como eram.
      - **Sem corrida:** a checagem vem DEPOIS da trava do pedido (`FOR UPDATE`) que a funcao ja tomava, e
        `solicitar_devolucao` trava o MESMO pedido antes de inserir. Nao e preciso aplicar fora do pico.
      - Duas consultas, so leitura, so catalogo, de ROL FECHADO (6 e 6 linhas, so valem com `rol=ok`):
        - **`46a-conferir-desfazer-recebimento-aplicado`** (a consulta do lote) prova DEPOIS do apply o corpo (md5), os
          atributos, o `EXECUTE` por papel (authenticated e service_role sim; PUBLIC e anon nao), a frase e o criterio
          da recusa no corpo e a checagem depois da trava do pedido.
        - **`46b-antes-desfazer-recebimento-base-vigente`** (`ausenciaConfirmadaPor`) prova o ANTES: o corpo vigente
          da `20261197000000` (md5), os atributos, o `EXECUTE` de hoje, `is_admin()` e `is_admin_atual()` de pe e as
          14 colunas que o corpo le ou grava. Rode a `46b` em CADA loja ANTES do apply.
        - Nao ha medicao `46m`: o lote nao le nem reescreve dado.
      - **Caminho, uma loja por vez (IKCOUS, depois Savy):** `46a` (sai NEGATIVA) -> `46b` MAIS NOVA e POSITIVA ->
        UM comando `aplicar-migrations.yml` com a migration -> o ensaio pede a `46a` DE NOVO, que tem de sair
        POSITIVA. A `8e` segue POSITIVA depois do apply (o corpo novo entra como sucessor conhecido dela).
      - **ORDEM: o banco de CADA loja ANTES do front desta mudanca** (o front nao muda neste lote).
      - **Desfazer:** `rollback-manual-20261243000000_desfazer_recebimento_recusa_com_devolucao.sql` devolve o corpo da
        `20261197000000` byte a byte e nao apaga dado. Os rollbacks da `20261197000000` e da `20261195000000` RECUSAM
        enquanto esta migration estiver no ar: desfazer ESTA primeiro.
      - **Depois do merge:** mudar `conferir-banco.cjs` ou o workflow invalida a evidencia: rodar a `8e`, a `46a` e a
        `46b` DE NOVO.
      - **Provas:** `tests/banco/desfazer-recebimento-viva.cjs` (comportamento, com a corrida real nos dois sentidos) e
        `tests/banco/desfazer-recebimento-portao-viva.cjs` (as consultas), num Postgres 17 efemero; nao provam o
        Postgres da Supabase nem o corpo vivo de cada loja.

  47. **Lote de UMA migration, de apply normal: `20261244000000` (a loja escolhe como entrega na cidade e em quantos
      dias; DINHEIRO e DADO DE CLIENTE; decisao do dono de 15/10/2026).** Sem `backfillLedger` e sem `nuncaAplicar`;
      valem as duas lojas assinantes (IKCOUS e Savy). ADITIVA: duas colunas novas com default constante, uma trava, tres
      corpos trocados por `CREATE OR REPLACE` (assinaturas, dono, ACL e atributos preservados) e a view com duas colunas
      no fim; nenhum dado existente e lido nem reescrito:
      - **O que muda:** a lojista passa a escolher "Entrego", "Entrego e retiro" ou "So retiro" e o prazo (em dias) da
        entrega propria. Em "So retiro" a entrega propria fica desligada: a retirada na loja vale para QUALQUER CEP e a
        opcao `local-delivery` e recusada pelas duas portas de compra (`create_marketplace_order_v23` e `_v24`) com a
        frase de sempre ("Opcao de entrega invalida..."). Nenhuma opcao de entrega muda de id nem de nome. Uma trigger
        (`store_config_so_retirada_exige_retirada`) recusa gravar "So retiro" sem a retirada ligada ou sem endereco.
      - **O que NAO muda no apply:** toda loja existente nasce com `local_delivery_enabled = true` e
        `local_delivery_days = 1` (o comportamento de hoje): nenhum pedido, preco ou frete muda ate a lojista escolher.
      - **Aplicar FORA DO HORARIO DE PICO:** a migration usa `SET LOCAL lock_timeout = '5s'` (desiste em vez de enfileirar
        a vitrine atras do `ALTER TABLE`); se recusar por tempo, rode de novo mais tarde.
      - Duas consultas, so leitura, so catalogo, de ROL FECHADO (9 e 9 linhas, so valem com `rol=ok`):
        - **`47a-conferir-a-loja-escolhe-como-entrega-aplicado`** (a consulta do lote) prova DEPOIS do apply os tres
          corpos (md5), os atributos e o `EXECUTE` por papel, as duas colunas e a CHECK do prazo, a trigger com a funcao
          dela e a view de 47 colunas.
        - **`47b-antes-a-loja-escolhe-como-entrega-base-vigente`** (`ausenciaConfirmadaPor`) prova o ANTES: os tres
          corpos vigentes (`20261229000000`, `20261236000000` e `20261239000000`), as colunas, a CHECK, a trigger e a
          funcao dela ainda ausentes e a view de 45 colunas. Rode a `47b` em CADA loja ANTES do apply.
        - Nao ha medicao `47m`: o lote nao le nem reescreve dado.
      - **Caminho, uma loja por vez (IKCOUS, depois Savy):** `47a` (sai NEGATIVA) -> `47b` MAIS NOVA e POSITIVA ->
        UM comando `aplicar-migrations.yml` com a migration -> o ensaio pede a `47a` DE NOVO, que tem de sair
        POSITIVA. A `8e`, a `9a`, a `31a`, a `37a` e a `40a` seguem POSITIVAS depois do apply (o corpo novo entra como
        sucessor conhecido delas).
      - **ORDEM: o banco de CADA loja ANTES da edge `calculate-shipping` e do front desta frente** (o front novo le as
        duas colunas; a edge le de forma tolerante).
      - **Desfazer:** em dois degraus. `rollback-manual-20261244000000_a_loja_escolhe_como_entrega_na_cidade.sql`
        devolve os tres corpos byte a byte, apaga a trigger e refaz a view de 45 colunas, mas DEIXA as colunas; ele
        RECUSA se alguma loja estiver em "So retiro" (devolva-a a "Entrego" ou "Entrego e retiro" de proposito).
        `rollback-manual-destrutivo-20261244000000_a_loja_escolhe_como_entrega_na_cidade.sql` apaga as colunas, so depois
        do primeiro, e RECUSA se alguma loja tiver "So retiro" ou prazo diferente de 1. Os rollbacks da
        `20261229000000`, da `20261236000000` e da `20261239000000` RECUSAM enquanto esta migration estiver no ar:
        desfazer ESTA primeiro.
      - **Depois do merge:** mudar `conferir-banco.cjs` ou o workflow invalida a evidencia: rodar a `8e`, a `47a` e a
        `47b` DE NOVO.
      - **Provas:** `tests/banco/a-loja-escolhe-como-entrega-viva.cjs` (comportamento: matriz das duas portas de compra x
        convidado/logado x CEP local/fora x tres modos, trigger, upsert, pre-voo, rollbacks e mutantes) e
        `tests/banco/a-loja-escolhe-como-entrega-portao-viva.cjs` (as consultas), num Postgres 17 efemero; nao provam o
        Postgres da Supabase nem o corpo vivo de cada loja.

   48. **Lote de UMA migration, de apply normal: `20261245000000` (o lucro desconta o cupom do pedido).**
       Muda só duas fórmulas de `get_admin_analytics_v2`: o lucro diário e o ranking descontam a parte proporcional
       de cada item sobre a soma de TODOS os itens do próprio pedido, com fração entre 0 e 1. Exemplo: venda 100,
       custo 60, desconto 30 → lucro 10 em vez de 40. Frete fica fora; item sem custo e a parte do desconto dele
       ficam fora. `cost_sold`, JSON, assinatura e ACL iguais. `fin_dre` já usa o total pago líquido e não muda.
       Depois da `20261242000000`, conferir `48a-conferir-lucro-com-desconto-aplicado`; se NEGATIVA, exigir
       `48b-antes-lucro-com-desconto-base-vigente` MAIS NOVA e POSITIVA antes de aplicar. São consultas de catálogo,
       rol fechado de quatro linhas, com hash, atributos e ACL. Corpo desconhecido exige parar. Depois, repetir
       a 48a: POSITIVA. A 45a, 35a, 17a e 8e aceitam o sucessor exato e continuam positivas. Nenhum front ou edge
       depende deste lote. Rollback `rollback-manual-20261245000000_o_lucro_desconta_o_cupom_do_pedido.sql` devolve
       a 42 byte a byte; desfazer a 45 ANTES da 42 ou de qualquer ancestral. Volta o defeito de lucro sem cupom.
       Provas e mutantes: `tests/banco/lucro-com-desconto-viva.cjs` (inclui 48a/48b); validação em Postgres 17
       efêmero pendente na entrega desta frente. Nada aqui comprova banco externo.

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

## Medicoes antes de escrever a migration (so leitura, nao e portao)

- **`42m-medir-saldo-em-duvida`** (reembolso A/B, tarefa T0, 15/10/2026): roda ANTES da migration que faz o
  saldo a estornar descontar as linhas `falhou`/`recusado` que PODEM TER SAIDO no Mercado Pago. Rodar nas duas
  lojas assinantes (IKCOUS e Savy) pelo `conferir-banco-da-loja.yml`, uma loja por run. So contagens e somas,
  por forma (cartao = credito/debito; pix = pix ou sem metodo), nenhum dado pessoal nem codigo do MP: linhas em
  duvida por passo da regra "pode ter saido", pedidos cujo saldo cai (e os que vao a zero ou menos), cancelados
  de cartao com `falhou` em duvida, linhas travadas ha 3 e 7 dias, linhas vivas que a autorizacao do POST
  passaria a recusar, a regra do legado (`tentativas > 1`), o risco de dobro (valor menor que o restante) e
  linhas em duvida de pedido com reembolso manual. **Ler a linha `controle` primeiro:** com a RLS valendo em
  `order_refund_diagnostico`, toda linha `falhou` parece "legado sem diagnostico" e o numero sai INFLADO; nas
  outras tabelas, sai baixo. `divergencias` tem de ser 0. Nao e portao: quem decide e quem le.
- **`44m-medir-pedidos-de-zero-e-desconto`** (15/10/2026): mede se vale corrigir os numeros do painel por causa
  de pedido de R$ 0,00 (cupom que zera a compra) e de desconto em geral, ANTES de qualquer migration. Rodar nas
  duas lojas assinantes (IKCOUS e Savy) pelo `conferir-banco-da-loja.yml`, uma loja por run. So contagens, somas
  e porcentagens, nenhum dado pessoal: pedidos de R$ 0 por janela (90 dias e total), por `payment_status` e por
  canal; clientes do CRM cuja unica compra e de R$ 0 e cujo PRIMEIRO pedido e de R$ 0; a superestimacao do lucro
  do painel (desconto concedido, inteiro e rateado aos itens com custo, sobre o lucro de `get_admin_analytics_v2`,
  com o filtro de status/`payment_status` IDENTICO ao da funcao) em 30 dias, 90 dias e total; e os pedidos de R$ 0
  entregues com `payment_status` nulo. **Ler a linha `controle` primeiro:** com a RLS valendo em qualquer das tres
  tabelas o numero sai baixo; a coerencia do desconto diz se a coluna `discount` e confiavel. Nao e portao.

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
`send-order-confirmation` (desde 09/10/2026) e mais `calculate-shipping`, `notify-new-order`,
`send-otp-email`, `melhor-envio-etiqueta` e `send-push` (desde 13/10/2026), todas pelo nome (a Almeida e o
apelido `cobranca` seguem so nas cinco; o passo 6 diz a pre-condicao de publicar cada uma) e exigem `expected_sha` igual ao SHA do run. O destino `loja` das functions (`dekxabvqdsuukijblazl`) e o projeto antigo
da principal; nos workflows de banco `loja` aponta para a CAF sem as travas da CAF explicita
(achado registrado, fora deste escopo).

## E-mail do login (Supabase Auth) por loja — medir sem abrir o painel

`medir-auth-da-loja.yml` faz UMA leitura (GET `/v1/projects/{ref}/config/auth`) da
configuracao de e-mail do login da loja e imprime, no log e no resumo do run, so uma lista
fechada de campos nao secretos: `mailer_autoconfirm`, `external_email_enabled`,
`disable_signup`, `smtp_host`, `smtp_port`, `smtp_admin_email`, `smtp_sender_name`,
`rate_limit_email_sent`, e `smtp_user`/`smtp_pass` apenas como "preenchido: sim/nao" (nunca o
valor). Serve para saber se a loja tem remetente proprio: sem ele, o envio padrao do Supabase so
entrega para a equipe do projeto e o cadastro de uma cliente que exige confirmacao por e-mail
nunca confirma.

- **Alvos:** `ikcous-publicada` (segredo `SUPABASE_ACCESS_TOKEN_IKCOUS`) e `savy` (segredo
  `SUPABASE_ACCESS_TOKEN_SAVY`) — os mesmos de `publicar-functions.yml`; nenhum segredo novo.
  Cada alvo enxerga so o seu; 401/403 param sem tentar outro.
- **Exige `expected_sha`** completo (40 hex) igual ao SHA do run, como as outras lojas explicitas.
- **Nao escreve nada:** o script so emite GET, e o corpo cru da resposta nunca vai para o log.
- **Como rodar** (um por loja):
  `gh workflow run medir-auth-da-loja.yml --repo BielWeed/ikcous-marketplace --ref <ramo> -f projeto=savy -f expected_sha=<SHA completo do topo>`
  e o mesmo com `-f projeto=ikcous-publicada`. O titulo do run e "medir auth em <projeto>".
- Teste: `tests/ci_medir_auth_da_loja_test.ts`.

## Rollback integral da configuracao do repositorio

- Ignore step: `commandForIgnoringBuildStep = null`.
- Ruleset: remover `producao-unica-fonte` (id 24166103).

49. **Lote de UMA migration, de apply normal: `20261246000000` — o lançamento repetido não duplica.**
    Consultas de catálogo `49a-conferir-lancamento-idempotente-aplicado` (depois) e
    `49b-antes-lancamento-idempotente-base-vigente` (antes), seis linhas cada, rol fechado.
    A 49b aceita a tabela ausente ou preservada na forma correta pelo rollback comum.
    **Ordem: banco antes do front.** A mensagem de tentar salvar de novo sem duplicar depende
    da proteção no servidor. Sem chave, o front antigo continua funcionando. Uma linha por
    tentativa criada, sem expurgo automático. Não há backfill nem job.
    **Desfazer:** retirar o front novo antes de executar
    `rollback-manual-20261246000000_o_lancamento_repetido_nao_duplica.sql`, que restaura o corpo
    da 99 e preserva os ids guardados. A tabela só é apagada pelo arquivo separado
    `rollback-manual-destrutivo-20261246000000_o_lancamento_repetido_nao_duplica.sql`, com o dono,
    confirmação de sessão e função antiga. Perder os registros permite duplicar uma tentativa
    antiga depois de reaplicar. A 8e aceita os hashes anterior e sucessor conhecidos; os
    rollbacks da 99/97 desfazem esta sucessora primeiro. Nenhum apply é feito por este roteiro.

50. **Lote de UMA migration, de apply normal: `20261247000000` — a anotação interna do pedido não chega à cliente.**
    Consultas de catálogo `50a-conferir-nota-interna-do-pedido-aplicado` (depois) e
    `50b-antes-nota-interna-do-pedido-base-vigente` (antes), seis linhas cada, rol fechado.
    A 50b aceita a tabela ausente ou preservada fechada (sem política e sem privilégios) pelo rollback comum.
    Cria `marketplace_order_internal_notes`, só do admin de agora (`rls_admin_atual()`); não toca
    `marketplace_orders.notes` e não copia nenhuma anotação existente (sem backfill).
    **Ordem: banco antes do front.** O front novo grava na tabela nova; o antigo continua funcionando.
    A coluna `notes` só perde o UPDATE do papel authenticated numa migration posterior, com o front no ar.
    **Desfazer:** retirar o front novo antes de executar
    `rollback-manual-20261247000000_a_nota_interna_do_pedido_nao_chega_a_cliente.sql`, que fecha a porta e
    preserva a tabela e as anotações (reaplicar a migration reabre). A tabela só é apagada pelo arquivo
    separado `rollback-manual-destrutivo-20261247000000_a_nota_interna_do_pedido_nao_chega_a_cliente.sql`,
    com o dono e confirmação de sessão; sem cópia, as anotações dos pedidos se perdem.
    Pedido de privacidade: o roteiro [`atender-pedido-de-privacidade.md`](atender-pedido-de-privacidade.md)
    também apaga as linhas desta tabela dos pedidos da cliente. Nenhum apply é feito por este roteiro.

51. **Lote de UMA migration, de apply normal: `20261248000000` — a coluna `notes` do pedido fecha para a gravação do painel.**
    Segunda metade da `20261247000000` (item 50). Sem `backfillLedger` e sem `nuncaAplicar`; valem as duas
    lojas assinantes, **IKCOUS primeiro e depois a Savy**. Só tira o `UPDATE` da **coluna**
    `marketplace_orders.notes` do papel `authenticated` (`REVOKE UPDATE (notes)`, nunca de tabela: o grant de
    coluna de `tracking_code` fica). Não toca RLS, gatilho, função, `INSERT`, `SELECT` nem nenhuma linha: as
    anotações antigas continuam em `notes`. O pré-voo recusa (`B1_BASELINE_DIVERGENT`) qualquer ACL que não seja
    a de antes (`authenticated` com `UPDATE` de coluna em `notes` e `tracking_code`) nem a de depois (só
    `tracking_code`), inclusive `UPDATE` de tabela inteira, `anon`/PUBLIC em coluna e `GRANT OPTION`; as colunas que o
    `authenticated` atualiza são medidas pelo privilégio **efetivo** (direto, PUBLIC ou herdado de outro papel),
    não só pela ACL direta; a
    conferência final aborta e desfaz tudo se `authenticated` ou `anon` ainda atualizam `notes`, se
    `authenticated` perdeu `tracking_code` ou se `service_role` perdeu `notes`.
    Consultas de catálogo `51a-conferir-notes-do-pedido-fechada-aplicado` (depois) e
    `51b-antes-notes-do-pedido-base-vigente` (antes), seis linhas cada, rol fechado e próprio de cada lado.
    **A 51b aceita só a ACL de antes e não prova a ausência do fechamento**; quem prova é a 51a.
    **Ordem: depois do front novo no ar nas duas lojas** (1.5.35 desde 17/10/2026). Antes dele, o painel antigo
    ainda grava a anotação em `notes`. **Caminho, uma loja por vez:** `51a` (sai NEGATIVA) → `51b` mais nova e
    POSITIVA → um comando `aplicar-migrations.yml` com
    `20261248000000_a_coluna_notes_do_pedido_fecha_para_gravacao_do_painel.sql` → `51a` de novo, que tem de sair
    POSITIVA.
    **O que quebra:** só um painel ANTIGO (anterior ao front novo) ao salvar a "Anotação interna": passa a
    receber erro de permissão (`42501`) até a lojista atualizar o app. O rastreio, o status, o checkout e a
    cliente não mudam. Busca de 17/10/2026: nenhum `UPDATE` de `notes` em `src/`, `supabase/functions` nem
    `supabase/migrations`; as RPCs gravam como `SECURITY DEFINER`.
    **Desfazer:** `rollback-manual-20261248000000_a_coluna_notes_do_pedido_fecha_para_gravacao_do_painel.sql`
    pelo `aplicar-migrations.yml` (um `GRANT UPDATE (notes)`; **reabre a porta** — a anotação de um painel antigo
    volta a chegar à cliente). Não toca dado. Nenhum apply é feito por este roteiro.
    Prova: `tests/banco/notes-do-pedido-fechada-viva.cjs` (PG 17, papéis reais, mutantes); não prova o Postgres
    da Supabase nem o papel de leitura de cada loja.

52. **Lote de UMA migration, de apply normal: `20261249000000` — o motivo do desconto do balcão não chega à cliente.**
    Sucede a `20261235000000` em `registrar_venda_presencial`: em venda NOVA o motivo de `p_observacao`
    fica em `marketplace_order_internal_notes` e `marketplace_orders.notes` recebe NULL. Preserva assinatura,
    retorno, ACL (EXECUTE só `authenticated`, sem GRANT OPTION), trava consultiva pela chave e idempotência.
    Repetir a venda devolve a existente, sem regravar o motivo. **Sem backfill:** motivos antigos em `notes`
    continuam visíveis à cliente; esta migration não copia nem apaga dado existente.
    **Ordem: banco ANTES do front**, depois da `20261235000000` e da tabela privada da `20261247000000`
    OPERACIONAL. A `20261248000000` é independente. O front antigo continua funcionando com a mesma assinatura;
    antecipar o front novo sem o banco ainda deixaria o motivo em `notes` nas vendas novas.
    Consultas somente de catálogo, com rol fechado de **11 linhas cada**:
    `52b-antes-motivo-do-balcao-base-vigente` antes do apply e
    `52a-conferir-motivo-do-balcao-privado-aplicado` depois. A 52b aceita o corpo medido da 235
    (`996caf02505ac16a8bded73bcf8900aa`) ou o já aplicado da 249
    (`796e0aaeb00b6f5133a54ce12f2df396`), como o pré-voo idempotente; **não prova ausência** nem aplicação.
    Só a 52a prova o corpo privado aplicado. As duas exigem os mesmos atributos/ACL da RPC, índice único válido
    da chave e tabela privada operacional: forma, restrições, defaults, RLS, política exata do admin atual,
    quatro privilégios só para `authenticated`, dono, gatilho/helper e ausência de publicação/ACL de coluna.
    Tabela ausente ou fechada pelo rollback da 247 reprova; corpo desconhecido exige parar e medir.
    **Caminho:** medir a 52a; se NEGATIVA, medir a 52b mais nova e POSITIVA; executar um apply normal pelo
    `aplicar-migrations.yml` com `20261249000000_o_motivo_do_desconto_do_balcao_nao_chega_a_cliente.sql`;
    conferir a 52a POSITIVA antes de promover o front. Sem `backfillLedger` nem `nuncaAplicar`; se a 52a já for
    POSITIVA e faltar a versão no ledger, parar para conferir a divergência, sem inferir apply pela 52b.
    **Desfazer:** `rollback-manual-20261249000000_o_motivo_do_desconto_do_balcao_nao_chega_a_cliente.sql`
    devolve o corpo exato da 235 e **preserva vendas e notas privadas**. Não desfaz a 247 nem a 248, e não apaga
    anotação: vendas NOVAS voltam a gravar o motivo em `notes`, visível à cliente (a porta de privacidade reabre).
    Prova de comportamento: `tests/banco/pdv-motivo-privado-viva.cjs` (PG 17 efêmero, papéis reais e mutantes).
    A 8e aceita os elos 99 → 235 → 249; a 9a exige a 249; a 36a continua provando a trava nos dois corpos
    medidos com trava, e a 36b recusa ambos. Evidência local não mede o banco remoto. Nenhum apply é feito por este roteiro.
