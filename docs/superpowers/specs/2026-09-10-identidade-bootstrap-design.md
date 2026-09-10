# Bootstrap da identidade real de uma loja — design

Data: 10/09/2026. Autor: hub Claude (sessao cb211f31). Contexto: PR #522, `diretor` = CORRIGE
(`central/tarefa-A10-diretor.md`): o build em modo `database` recusa loja sem identidade
gravada, e nenhuma das duas lojas tem identidade no banco. A tela de identidade que viaja no PR
nao pode fazer a primeira gravacao (ovo e galinha: ela so' existe no build que recusa o dado
ausente; o build `fixture` nao alcanca banco real). Falta a peca de PROVISIONAMENTO.

## O que melhora, e para quem

O dono consegue construir e publicar a proxima versao da loja (a principal e a da cliente
Savy), porque cada loja passa a ter nome, cores, logo e arquivos de icone/compartilhamento
gravados no proprio banco e Storage — o que o app novo exige. Depois disso, a tela de
identidade do painel passa a funcionar para mudar tudo isso sem programador.

## O que pode piorar, e o conserto

Gravar identidade muda o que o cliente ve NO ATO (o front 1.26.0 no ar le nome, logo e cor do
banco com precedencia). Conserto: (1) os bytes gravados sao os mesmos que a loja ja mostra
(kit A6a preserva byte a byte); (2) cidade/UF ficam como o `socio`/Gabriel decidirem (NULL
preserva a tela de hoje); (3) `--desfazer` devolve a linha a NULL pela mesma RPC e apaga os
objetos — a loja volta a usar as reservas locais, como hoje. O bem maior — a loja no ar
vendendo — nao muda de comportamento alem da fonte da imagem.

## Escopo

Uma ferramenta de linha de comando no repositorio do app, `scripts/identidade-bootstrap.mjs`
(lancador) + `scripts/identidadeBootstrap.ts` (logica testavel), que para UMA loja:

1. Le o kit local (`--kit <dir>`: `manifesto.json`, `<loja>/branding-assets.json`, `objetos/`)
   e o arquivo de valores (`--valores <json>`: `store_name`, `primary_color`,
   `secondary_color`, `accent_color`, `store_city`, `store_state`), e monta a linha
   `desired_identity` (8 chaves) com `logo_url = <origin>/storage/v1/object/public/branding/<header.path>`.
2. Valida TUDO offline antes de tocar rede: sha256 de cada objeto == segmento do path;
   `bytes` bate; `parseStoreIdentity(desired, supabaseUrl)` — a MESMA funcao do build — aceita a
   linha (importada de `src/lib/storeIdentity.ts`, nunca reimplementada).
3. Le a identidade atual por `read_store_identity()` (DATABASE_URL, `SET LOCAL ROLE
   service_role`; `is_admin()` autoriza esse papel) e exige um de dois estados: toda NULL
   (bootstrap) ou identica a `desired` (idempotente: nada a fazer).
4. Sobe cada objeto unico do kit para o bucket `branding` pelo CLI da Supabase ja logado na
   conta do dono (`supabase storage cp <arquivo> ss:///branding/<path> --content-type <mime>
   --cache-control "public, max-age=31536000, immutable" --linked --experimental --workdir
   <dir-linkado>`), com `ls` antes: objeto existente com mesmo sha e' pulado; com sha diferente
   e' recusa (path e' enderecado por conteudo: nunca sobrescrever).
5. Confere cada objeto pela URL publica com a MESMA funcao do build (`downloadIdentityAssets`
   de `src/lib/publicStoreIdentity.ts`): status, MIME, tamanho e sha256.
6. Grava por `save_store_identity(expected_revision, expected_identity, desired_identity)` com a
   revisao e a identidade lidas no passo 3 (conflito = alguem gravou no meio: recusa).
7. Prova final pela porta do consumidor: `readPublicStoreIdentity({supabaseUrl, publicKey:
   <anon>})` + `downloadIdentityAssets` — exatamente o que `scripts/identityBuildConfig.ts`
   roda no build — tem de passar.
8. `--desfazer`: le a atual, exige que seja igual ao `desired` calculado do kit, grava a linha
   toda NULL pela mesma RPC (o `upsert_store_config` grava NULL explicito; a CHECK de logo
   aceita `branding_assets` NULL), depois `supabase storage rm` dos objetos do kit. Ordem:
   banco primeiro (a loja volta a reserva local), objetos depois.

Sem `--aplicar` o comando e' `--dry-run` de verdade: roda 1, 2, 3 e imprime o plano (objetos a
subir, valores a gravar, revisao atual) sem nenhuma escrita — nem arquivo local.

## Fora do escopo

- Gerar ou transformar imagem (o kit A6a ja e' o produto final e revisado; "nunca executar o
  preparador de novo por rotina").
- Segunda loja em um comando so': uma loja por execucao; o lote e' quem chama (a hub), com
  `DATABASE_URL` e workdir linkado por loja.
- Integrar ao Gerenciador: a ferramenta e' do app (provisionamento de loja nova = dado +
  infraestrutura); o Gerenciador chama depois, quando existir o motor de sincronizacao.
- Trocar a spec do build (continua recusando identidade incompleta).

## Componentes

- `scripts/identidadeBootstrap.ts` — funcoes puras + efeitos injetados:
  - `lerKit(dir, loja)` → `{ assets, objetos: Map<path, {arquivo, sha256, bytes, mime}> }`;
    recusa manifesto sem a loja, objeto ausente, sha divergente.
  - `montarIdentidade(kit, valores, supabaseUrl)` → `desired_identity` (8 chaves, JSON
    canonico) + `parseStoreIdentity` como guarda.
  - `planejar(desired, atual)` → `{ acao: 'bootstrap' | 'nada' | 'recusa', motivo }`.
  - `executar(plano, deps)` com `deps = { rpc, storage: { listar, subir, remover }, publico:
    { baixar } }` — as tres portas sao injetaveis para teste; a producao usa `pg` (DATABASE_URL),
    `spawnSync` do CLI e `fetch`.
- `scripts/identidade-bootstrap.mjs` — lancador: parse de argumentos, bundle em memoria do
  `.ts` com o esbuild ja instalado (padrao de `validar.mjs` do kit), injeta as portas reais,
  imprime o relatorio e sai com codigo distinto por estado (0 aplicado/nada a fazer, 2
  recusa por estado do banco, 3 falha de upload/conferencia, 4 conflito de revisao, 5 sem
  DATABASE_URL/kit, 1 erro inesperado). Nunca imprime URL de banco nem chave.
- Testes (`tests/front/identidade-bootstrap.test.ts`, vitest): kit sintetico em `mkdtemp` com
  PNG/SVG deterministicos (reusar `createIdentityBuildFixture` de
  `scripts/identityBuildFixture.ts`), portas falsas em memoria. Casos: kit integro passa
  `parseStoreIdentity`; sha divergente recusa antes de rede; dry-run nao chama nenhuma porta de
  escrita; banco toda-NULL → sobe so' os ausentes, grava com `expected_revision` lido; banco
  igual ao desired → 'nada' sem escrita; banco diferente → recusa; objeto existente com sha
  diferente → recusa antes de gravar; conferencia publica com MIME errado → falha 3 e NAO grava
  (ordem: subir → conferir → gravar); `--desfazer` grava NULL antes de remover; conflito P0001
  → 4. Mutantes obrigatorios na revisao: trocar a ordem conferir/gravar; ignorar sha no `ls`.
- Prova viva (hub, fora dos testes): `--dry-run` nas duas lojas; depois `--aplicar` na ordem
  que o `socio`/Gabriel decidirem; depois `node scripts/buildStore.mjs` local com o env POBRE
  do preview (`scratchpad/com-env-preview-main.cjs`) tem de passar de `parseStoreIdentity` e
  gravar `dist/version.json` com `source: database`; depois o preview da Vercel no SHA do topo.

## Dados e contratos que a ferramenta consome (nao redefine)

- `rowSchema`/`parseStoreIdentity`/`downloadIdentityAssets`/`readPublicStoreIdentity`:
  `src/lib/storeIdentity.ts`, `src/lib/publicStoreIdentity.ts`.
- Validadores SQL `branding_a2_*` e CHECKs: migration `20261121000000` (aplicada nas 2 lojas).
- RPCs `read_store_identity()` / `save_store_identity(text,jsonb,jsonb)`: migration
  `20261122000000` (aplicada nas 2 lojas); `is_admin()` aceita `service_role`/`postgres`.
- Bucket `branding` (public, 20 MiB) com policies `branding_a2_public_select` e
  `branding_a2_admin_insert`; o CLI do dono grava pela API do Storage com a chave de servico que
  o proprio CLI obtem — nenhuma chave passa pela ferramenta.
- Kit A6a: `manifesto.json` (procedencia), `ikcous/branding-assets.json`,
  `savy/branding-assets.json` (17 objetos por sha256 em `objetos/`).

## Riscos nomeados

- `supabase storage cp` e' `--experimental`: a versao do CLI pode mudar a interface. Mitigacao: a
  porta `storage` e' injetavel; a conferencia publica (passo 5) e' quem prova o resultado, nao o
  exit do CLI.
- Content-Type: o CLI auto-detecta por extensao; passamos explicito do manifesto e conferimos na
  resposta HTTP (o build recusa MIME errado com `IDENTITY_ASSET_MIME`).
- Realtime: a gravacao chega ao front 1.26.0 aberto em segundos. Por isso a decisao de valores e'
  do dono, e a ferramenta nao tem modo "so' um pedaco".
- `SET LOCAL ROLE service_role` pelo pooler em transaction mode: e' `LOCAL`, morre com a
  transacao; a leitura ja foi feita assim em 10/09 (fotografia A10).

## Ordem de entrega

1. Spec (este arquivo) → plano (`docs/superpowers/plans/2026-09-10-identidade-bootstrap.md`).
2. Executor denso implementa por TDD; revisor Opus (dado de cliente + producao + Storage).
3. Hub: dry-run nas duas lojas; `socio` → Gabriel (valores e ordem); `--aplicar`; prova viva;
   preview da Vercel; `diretor`; merge do #522.
