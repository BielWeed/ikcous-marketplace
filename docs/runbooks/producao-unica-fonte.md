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
   3. **Prova com `ok=false`** = diagnostico antes de qualquer apply: `8a`, `8b`, `8c` (so
      leitura). Apply SO quando a `8a` prova o lote inteiro AUSENTE, `8b`/`8c` estao `ok=true` e o
      ledger nao registra nenhuma versao dele: `aplicar-migrations.yml` com as migrations NA
      ORDEM, sem a 201 (o apply grava o ledger na mesma transacao). Depois do apply, a prova de
      novo. E o caminho esperado da Savy.
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
