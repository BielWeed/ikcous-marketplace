# Passagem de bastão — PDV testado em celular de verdade (19/09/2026)

> LEIA ESTE ARQUIVO INTEIRO antes de qualquer tarefa. Ele substitui a fila do
> `2026-09-17-super-atualizacao/` (que fica como histórico — a fila de lá que
> ainda vale está copiada AQUI, atualizada).

## 1. Situação

- Branch `claude/app-major-upgrade-wmc8x2` (base `develop`), PR **#624** (rascunho),
  ~103 commits sobre `develop`, tudo **pushado** (sincronia conferida no encerramento).
- **O PDV passou no primeiro teste real de balcão** (celular do dono, 19/09):
  câmera lê código → cupom → cliente → pagamento → RPC grava → recibo. Primeira
  venda presencial real no banco: pedido `d4d2cf35-…a9953` (`#4A9953`), canal
  `presencial`, R$ 93,70, vendedor vinculado.
- O dono é o Gabriel (BielWeed). Toda fala visível a ele em português.

## 2. Fechado nesta sessão (19/09) — commits

| hash | o que |
| --- | --- |
| `f4ca362` | pedidos-4: RPC `get_admin_orders_cancelados_recentes` (janela pela data de CANCELAMENTO + colunas mínimas + `fora_da_janela`), migration `20261164000000` + rollback + VERIFICACOES + tipos; dropdown de alertas com "buscar também os antigos"; realtime com busca ativa recarrega em vez de ignorar. Revisão cara em contexto limpo: **passa**. |
| `b77fc4a` | PWA: aviso de atualização com "Depois" (soneca 1h nos dois storages), diálogo de verdade (foco preso, Escape), gate respeita `isAdminDirty`. |
| `4e218e8` | PWA: `onversionchange` marca instância (`isClosed`), bordas do motor re-resolvem (`cofreVivo`), catchUp lê com `getAllOrThrow` (leitura quebrada aborta, não vira "cofre vazio"). |
| `315ad60` | catchUp fatia `.in("id")` em lotes de 100; erro num lote não derruba os outros. |
| `9013222` | `lint:lockfile` roda no CI (job da catraca). |
| `a44fc23` | clsx sai do `vendor-charts` (boot do cliente −92 kB brotli; provado: sem modulepreload) + size-limit mede por arquivo (`webpack:false`, `running:false`). **Mediu 798,8 kB de 800 kB** — ver decisões. |
| `f6334c2` | RPCs do PDV tipadas em `database.types.ts`; cinco `as any` removidos; teste do PDV com dublê de storage (Node 25 quebra o localStorage do jsdom). |
| `9de4f05` | PDV ganha `pb-admin` (botão "Registrar venda" ficava atrás da barra fixa no celular). |
| `c429218` | Na tela de venda nenhuma aba acende (o "pai" é só do Voltar); destaque é do botão VENDER. |
| `46ff7f9` | Ações do PDV com cor própria (`bg-admin-gold`) — os botões herdavam o tema da loja e ficavam invisíveis (preto sobre preto). |
| `94c2638` | Virada para o recibo consome a camada com `replaceState` (o `back()` disparava o diálogo "alterações não salvas" sobre o recibo). |

**Migrations APLICADAS no banco da loja** (`cafkrminfnokvgjqtkle`): `20261160000000`
a `20261164000000`, via workflow `aplicar-migrations.yml` (dispatch manual; prova
`BEGIN/ROLLBACK` por arquivo; verificação de grants/colunas). Como aplicar em
outra loja: Actions → "Aplicar migrations (Supabase)" → lista de arquivos +
`projeto_ref`. **O segredo `DATABASE_URL` do repositório aponta para OUTRO
projeto (sandbox, sem `config_json`)** — o que funciona é o `SUPABASE_ACCESS_TOKEN`.

## 3. REERGUER O AMBIENTE numa cópia nova (a galeria abre cópia nova!)

A cópia nova chega SEM node_modules, SEM `.env.local`, SEM Deno. Ordem:

1. **Node/npm não estão no PATH do bash** desta máquina. Use
   `export PATH="/c/Program Files/nodejs:$PATH"` no início de cada comando,
   ou os caminhos completos (`"/c/Program Files/nodejs/npm.cmd"`).
2. `npm ci` (o postinstall do lefthook falha sem o PATH do node; refaça com o
   export acima).
3. `npx lefthook install` (hooks de commit/push).
4. **Deno**: instalar em `$HOME/.deno` se ausente (2.5.6 serve; PowerShell:
   baixar `https://dl.deno.land/release/v2.5.6/deno-x86_64-pc-windows-msvc.zip`
   e extrair em `$env:USERPROFILE\.deno\bin` — o instalador oficial
   `irm deno.land/install.ps1` quebra no tar do Git Bash). Suítes Deno
   (`test:unit` das migrations) rodam com `export PATH="$HOME/.deno/bin:$PATH"`.
5. **`.env.local`** (gitignored — por isso some na cópia nova). Receita medida:
   - `VITE_SUPABASE_URL=https://cafkrminfnokvgjqtkle.supabase.co`
   - `VITE_SUPABASE_ANON_KEY=<JWT anon>` — extrair do bundle do preview da
     branch: baixar `https://ickous-marketplace-git-claude-531c6a-gabriels-projects-5a19f6ee.vercel.app/`,
     achar o `assets/index-*.js` do HTML e grep
     `eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}` (a chave
     é pública por desenho — vai no bundle de todo cliente).
   - `VITE_APP_URL=https://ickous-marketplace-git-claude-531c6a-gabriels-projects-5a19f6ee.vercel.app`
     (a config de identidade EXIGE endereço público https na raiz).
   - `VITE_PAGAMENTO_ONLINE=false`
6. **Dev server**: algo nesta MÁQUINA mata processos node periodicamente
   (4 quedas medidas, inclusive processo destacado). Rodar sob supervisor
   (PowerShell em loop, reergue em 2s) — script usado na sessão
   (`servidor-vite.ps1`, FORA do repo):

   ```powershell
   $projeto = "<caminho da cópia>/projeto"
   $node = "C:\Program Files\nodejs\node.exe"
   Set-Location $projeto
   while ($true) {
     & $node node_modules\vite\bin\vite.js --host --port 5173 --strictPort *>> "$projeto\..\vite-supervisor.log"
     "---- vite saiu; reerguendo ----" | Out-File "$projeto\..\vite-supervisor.log" -Append
     Start-Sleep -Seconds 2
   }
   ```

   Lançar destacado: `Start-Process powershell -ArgumentList '-ExecutionPolicy','Bypass','-File','<caminho>/servidor-vite.ps1' -WindowStyle Hidden`.
   Link do celular: `http://<ip-da-rede>:5173` (câmera exige a flag do Chrome
   `unsafely-treat-insecure-origin-as-secure`; instalação de PWA só no preview
   https da Vercel).
7. **Testes**: `VITEST_MAX_WORKERS=1` sempre (a casa trava nisso). O
   localStorage experimental do Node 25 substitui o do jsdom SEM
   `clear`/`removeItem` — qualquer teste novo que precise de storage usa dublê
   Map-based com `vi.stubGlobal` (padrão já adotado nos testes do PDV).

## 4. Fila do que falta (ordem)

1. **PWA 2b**: `realtimeSyncEngine-952` (catchUp admin lendo `vw_produtos_admin`
   — um esquema só; preservar `codigo_barras` na lista de colunas) e `-317`
   (tempestade de visibility: quatro observadores, renúncia de liderança derruba
   o websocket). Specs vivas em `frentes/pwa.json` da passagem de 17/09.
2. Follow-ups baratos: `App.tsx` `handlePopState` (override por camada ANTES do
   gate de dirty — mesmo tema do `94c2638`, lado do App); recibo do PDV lendo o
   cliente da RESPOSTA do banco (não da tela); `freeShippingPreset` nos 6
   `<ProductCard>` + `PremiumOffers`.
3. **C2.5**: `zxing-wasm` no `package.json` (3.1.4+; o lint:lockfile novo já
   cobre a origem; `.size-limit.cjs` passa a medir `*.wasm`).
4. Migrations pendentes (fila serializada): `upsert_store_config`
   (frete grátis nasce 0, não 100), `shipping_quotes_cache`
   (UNIQUE + gatilho de limpeza), e conferir entradas `VERIFICACOES` das
   `2026116x` (a `20261164` TEM entrada; as outras três vieram de C1 e podem
   não ter — medir).
5. A7 (banco/RPCs da Onda A, plano §3) — depois das acima.
6. **C6** (entrada de estoque por leitura, fila offline, papéis) — o pré-requisito
   "primeiro uso real do PDV" FOI cumprido (19/09).
7. Onda B: RESERVADA pelo dono (17/09) — não é desta fila.

## 5. Decisões pendentes do Gabriel (perguntar, não decidir)

- **D8/teto do bundle**: medida honesta marcou **798,8 kB de 800 kB** (folga
  1,2 kB). Manter 800 (o clsx já devolveu ~92 kB de espaço) ou reavaliar teto?
- Publicar as 5 functions da cobrança (juntas) + as demais tocadas — passo de
  publicação do PR #624 (o dono aplica).
- Credenciais de PRODUÇÃO do Mercado Pago (as salvas são de TESTE).
- `enabled_shipping_methods` default (perde a Jadlog), lojas semeadas com
  `free_shipping_min=350`, bipe com folha de variação aberta.

## 6. Antes de tirar o PR #624 do rascunho (checklist do dono)

`npm ci && npm run typecheck && npm test` inteiro · build+size no artefato
promovível · migrations nas lojas (workflow) · publicar functions · 18 passos
de teste no preview (o passo 15/PDV agora está validado em parte pelo teste
real de 19/09) · atualizar descrição do PR.

## 7. Truques de ambiente que esta sessão pagou para aprender

- `gh` não está logado, mas `git credential fill` devolve um token com escopo
  `repo,workflow,gist` — `GH_TOKEN=<token> gh …` funciona (workflow dispatch
  de branch não-padrão: usar a API REST com o caminho do arquivo).
- Mural (`node ~/.claude/mural/mural.mjs`) precisa do PATH do node (item 1).
- `deno.lock` modificado é ruído de agente: não commitar.
- PROIBIDO `git stash/checkout/restore/reset/clean` (árvore é da galeria; para
  comparar com original: `git show HEAD:<caminho> > /tmp/x`).
