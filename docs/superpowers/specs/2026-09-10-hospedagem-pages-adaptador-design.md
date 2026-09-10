# A7c — Adaptador de hospedagem Cloudflare Pages gerado na finalização do build

Data: 2026-09-10. Autor: sessão Claude 07c8d02e (root). Estado: desenho técnico fechado; plano executivo a escrever com `superpowers:writing-plans`. Nada implementado.

## 1. O que é, para quem, e o que não é

**Para o lojista e o cliente da loja:** a mesma entrega (`dist`) que hoje sobe na Vercel passa a carregar, junto, os arquivos que a Cloudflare Pages precisa para servir a loja igual — abrir qualquer tela pelo endereço, atualizar o aplicativo instalado, e mostrar a prévia certa do produto quando alguém compartilha um link no WhatsApp. Nada muda no que a loja faz.

**O que não é:** não é publicação, não é conta na Cloudflare, não é troca de endereço, não é migração de domínio, não mexe em pagamento nem em autenticação. Tudo isso continua parado no Gabriel (decisão do sócio em `hospedagem-decisao-socio.md`). Também não muda `vercel.json`: a Vercel continua recebendo o mesmo build, e os arquivos novos ficam inertes lá (só configuração pública).

## 2. Decisões herdadas (não se reabrem aqui)

| Decisão | Fonte |
|---|---|
| Cloudflare Pages Free, modo avançado com `_worker.js` único, Direct Upload; função só para o compartilhamento de produto | `central/hospedagem-decisao-adaptador-local.md` |
| Entradas explícitas (36 telas + 18 aliases, com e sem barra final) com `200`, `404.html` = documento da loja, `_routes.json` só `/product-detail`, sem fallback universal | `central/hospedagem-decisao-rotas-preservadas.md`, provado no A7a3 (`hospedagem-rotas-explicitas-relatorio.md`, revisão PASSA) |
| Configuração pública chega pelo `PreparedStoreDelivery` (contrato v1 em `plugin.api`), capturado síncrono e conferido tardio; chave classificada; nada de `process.env`, Host ou fallback da principal no adaptador | `central/hospedagem-decisao-configuracao-compartilhada.md`, implementado no A7b2 |
| Sequência: guardas atuais → build → precache → **arquivos de hospedagem** → conferência → `version.json` por último; falha tardia deixa a saída sem marcador | mesma decisão do adaptador |

## 3. Arquitetura

```
buildStore.mjs
  ├─ (existente) captura síncrona do PreparedStoreDelivery no configResolved
  ├─ (existente) await build(...)  → Vite → vite-plugin-pwa closeBundle gera sw.js + precache
  ├─ (existente) guardas: SNAPSHOT_CHANGED, DELIVERY_CHANGED, WRITE, OUTPUT, MARKER_UNEXPECTED
  ├─ NOVO  gerarHospedagem(outDir, capturedDelivery)   ← scripts/hospedagem.mjs
  │        escreve (flag "wx"): _routes.json, _redirects, _headers, 404.html, _worker.js
  └─ (existente) version.json.<uuid>.tmp → rename atômico → version.json
```

- **Ponto de inserção:** `scripts/buildStore.mjs`, entre `if (await statOrMissing(marker)) throw failure("MARKER_UNEXPECTED");` e a escrita do temporário (mapa §1.4). Motivo: depois do `closeBundle` do PWA (arquivos novos **não** entram no precache; `vite.config.ts:83` capturaria `404.html` e `_worker.js` se estivessem em `public/`), depois das guardas de caminho, e antes do marcador (qualquer falha = sem `version.json`, invariante já existente).
- **Nunca em `public/`:** `tests/identity-real-kit-build/run.mjs:280` reprova escrita em `public/`, `src/` ou `scripts/` durante o build, e o precache pegaria o worker.
- **Módulos novos:**
  - `scripts/hospedagem.mjs` — gerador puro (JS, sem loader): funções `redirects(telas)`, `routes()`, `headers(vercelJson)`, `cabecalhosDeFuncao(vercelJson)`, `configDoWorker(delivery)`, `compilarWorker(config)`, e `gerarHospedagem(outDir, delivery)` que orquestra e escreve. Espelho literal das 36 telas (precedente: `deliveryContract` em `buildStore.mjs:15-26`).
  - `src/config/rotas.ts` — **declaração única** das telas de entrada: `export const TELAS_DE_ENTRADA = [...] as const satisfies readonly View[]` (36). `src/App.tsx:1498` passa a importá-la no lugar do literal `validViews`; a normalização de `App.tsx:1486-1495` não muda.
  - `src/hospedagem/contrato.ts` — tipo `HospedagemConfig` (o que vai embutido no worker).
  - `src/hospedagem/compartilhamento.ts` — lógica pura e testável do worker: `ehRobo`, `idValido`, `montarConsulta`, `montarHtml`, `escaparHtml`, `imagemPermitida`, `criarWorker(config)`.
  - `src/hospedagem/worker.ts` — entrada de 3 linhas: `declare const __IKCOUS_HOSPEDAGEM__: HospedagemConfig; export default criarWorker(__IKCOUS_HOSPEDAGEM__);`
  - Por que `src/`: `tsc -b` (lib DOM: `Request`, `Response`, `Headers`, `URL`, `AbortSignal.timeout`) e o eslint (`**/*.{ts,tsx}`, com `eslint-plugin-security`) cobrem de graça; `src/main.tsx` não importa nada disso, então fica fora do bundle do navegador — o mesmo mecanismo pelo qual `src/config/storeDeliveryContract.ts` fica fora (mapa §5.6).

## 4. Os cinco arquivos gerados

| Arquivo | Conteúdo | Fonte da verdade |
|---|---|---|
| `_routes.json` | `{"version":1,"include":["/product-detail"],"exclude":[]}` (exato, como no A7a3) | literal no gerador |
| `_redirects` | 108 linhas `/<forma> / 200`: para cada uma das 36 telas, `/<tela>` e `/<tela>/`; para cada tela `admin-<x>` (18), `/admin/<x>` e `/admin/<x>/`. Raiz sem regra. Ordem alfabética estável. | `src/config/rotas.ts` via espelho + teste de confronto |
| `_headers` | Tradução **fechada** dos três blocos de `vercel.json`: (1) `/(sw\.js\|service-worker\.js\|sw\.ts\|version\.json\|index\.html)` → uma regra por nome, com o `Cache-Control` do bloco; (2) `/assets/(.*)` → `/assets/*` com `immutable`; (3) `/(.*)` → `/*` com os dez cabeçalhos de segurança e **sem `Cache-Control`** (regras coincidentes concatenam valores no Pages). Qualquer `source` que o tradutor não reconheça → erro `HOSTING_HEADERS_UNKNOWN_SOURCE` (falha fechada). Linha > 2000 caracteres → erro. | `vercel.json` (lido no ato) |
| `404.html` | Bytes idênticos a `outDir/index.html` depois do build (o documento já transformado pela identidade). | `outDir/index.html` |
| `_worker.js` | `esbuild` 0.27.2 (`await import("esbuild")`, já instalado como dependência do Vite): `entryPoints: [src/hospedagem/worker.ts]`, `bundle: true`, `format: "esm"`, `platform: "browser"`, `target: "es2022"`, `write: false`, `define: { __IKCOUS_HOSPEDAGEM__: JSON.stringify(config) }` (se o `define` recusar objeto, `banner` com `const __IKCOUS_HOSPEDAGEM__ = …;` e `declare` no TS). Saída escrita pelo gerador com `wx`. | `PreparedStoreDelivery` + `vercel.json` |

Todos com `flag: "wx"`: arquivo pré-existente = falha (o `npm run build` real esvazia o `outDir`; nos testes o `mkdtemp` é novo). Cada escrita é relida e conferida por bytes antes de seguir (molde `verifiedWrite` de `prepareIdentity.ts:210-219`).

## 5. `HospedagemConfig` — o que o worker sabe

```ts
interface HospedagemConfig {
  readonly versao: 1;
  readonly publicUrl: string;              // snapshot.publicUrl (HTTPS, raiz)
  readonly storeName: string;              // snapshot.identity.storeName
  readonly conexao:
    | { kind: "database"; origin: string; key: string; keyClass: "publishable" | "anon-jwt" }
    | { kind: "none" };                    // fixture-none e fixture-synthetic → none
  readonly hostsDeImagem: readonly string[]; // extraídos do img-src do CSP em vercel.json (sem esquemas/curingas: "*.supabase.co" vira sufixo)
  readonly cabecalhos: Readonly<Record<string, string>>; // os dez do bloco "/*"
  readonly deliveryVersion: string;        // snapshot.deliveryVersion (aparece num comentário do worker e no header x-ikcous-delivery)
}
```

A chave pública **é** embutida no worker em modo database — é a mesma chave que já vai no bundle do app. Em fixture (A6, testes, CI) a conexão é `none`: o worker nunca consulta. `fixture-synthetic` (bancada A6) também vira `none`: a origem sintética não existe e o worker não pode sair para a rede.

## 6. Comportamento do worker

Só recebe pedidos que casem com `_routes.json`; mesmo assim confere o caminho.

1. `url.pathname` não é `/product-detail` nem `/product-detail/` → `env.ASSETS.fetch(request)` sem tocar (cabeçalho `x-ikcous-og: passa`).
2. Não é robô (mesma regex de `middleware.ts:61-64`: `whatsapp|facebookexternalhit|twitterbot|telegrambot|slackbot|googlebot|bingbot|baiduspider|yandexbot`, sem distinção de caixa) → **documento da loja**: `env.ASSETS.fetch(new Request(new URL("/", url.origin), { method, headers }))`, preservando a URL vista pelo navegador (é o que o A7a3 provou: sem `Location`, query e fragmento intactos), `x-ikcous-og: passa`.
3. Robô, mas `id` ausente ou fora do formato UUID (`produtos.id` é `uuid`) ou `conexao.kind === "none"` → documento da loja com `x-ikcous-og: sem-produto`. Sem consulta.
4. Robô com UUID e conexão: `GET {origin}/rest/v1/vw_produtos_public?id=eq.<uuid>&select=id,nome,descricao,preco_venda,imagem_url,imagem_urls&limit=1`, cabeçalhos `apikey: <key>`, `Accept: application/json`, e `Authorization: Bearer <key>` **somente** se `keyClass === "anon-jwt"` (publishable não vira JWT — decisão do sócio, doc do Supabase), `signal: AbortSignal.timeout(2500)`, sem seguir redirecionamento (`redirect: "manual"`; qualquer 3xx conta como falha — o runtime de Workers não aceita `"error"`), corpo lido até 64 KiB (acima disso, trata como falha). Falha, `!ok`, lista vazia, JSON inválido, timeout → documento da loja com `sem-produto` (regressão do defeito original: nunca vira `produto`).
5. Produto: HTML de prévia (mesmas metas de `middleware.ts:143-170`: title, description, `og:title` com preço, `og:description`, `og:type=product`, `og:url`, `og:image` + dimensões, Twitter card, `<h1>`, `<p>`, `<img>`), com: `escaparHtml` que também escapa `'` (`&#39;`, como `scripts/identityBuildConfig.ts:48-55`); `og:url` = `publicUrl + "/product-detail?id=" + encodeURIComponent(id)` (nunca `request.url`/Host); imagem só `https:` com host permitido por `hostsDeImagem` (sufixo para `*.`), senão `publicUrl + "/og-image.png"`; nome da loja = `storeName`. Resposta `200`, `content-type: text/html; charset=utf-8`, os dez cabeçalhos de segurança, `Cache-Control: no-store`, `x-ikcous-og: produto`, `x-ikcous-delivery: <deliveryVersion>`.

Nada de `HEAD` especial: o Pages trata `HEAD` do estático; para a função, `HEAD` de robô segue o mesmo caminho e devolve sem corpo (`new Response(null, …)` quando `request.method === "HEAD"`).

## 7. Erros e invariantes

- Qualquer erro do gerador (tradução, esbuild, escrita, releitura) lança `failure("HOSTING_*")` antes do `version.json` → saída sem marcador, como hoje para qualquer falha tardia.
- `emptyOutDir` continua a cargo do Vite; o gerador não apaga nada.
- O gerador **não lê** `process.env`, `.env`, `Host` nem `import.meta.env`; recebe só `outDir`, `capturedDelivery` (já validado por `delivery()`), e o caminho de `vercel.json` na raiz.
- `sources changed during build` (kit A6) continua verdadeiro: nada é escrito fora do `outDir`.
- `promotable` continua descrevendo a origem da preparação; não muda por causa dos arquivos de hospedagem.

## 8. Testes (TDD, um comportamento por vez)

- `tests/front/hospedagem-rotas.test.ts`: confronto do espelho de `scripts/hospedagem.mjs` com `src/config/rotas.ts` (igualdade e ordem); `redirects()` produz 108 linhas, contém `/admin/orders/ / 200`, não contém `/admin/ / 200` nem regra para `/`; um controle negativo (mutilar uma tela) derruba o confronto.
- `tests/front/hospedagem-headers.test.ts`: `headers(vercelJson real)` produz exatamente as regras esperadas; `source` desconhecido lança; linha > 2000 lança; `cabecalhosDeFuncao` devolve os dez nomes sem `Cache-Control`; `hostsDeImagem` extraído do CSP bate com a lista lida a olho.
- `tests/front/hospedagem-compartilhamento.test.ts` (puro, `fetch` e `ASSETS` fictícios): porta os 18 casos de `tests/link_do_whatsapp_test.ts` (robô com produto; 42501 → sem-produto; navegador → passa; robô fora do caminho → passa; nome com aspas e `<`; sem imagem → og-image; id com `&` e `,`), mais: `/product-detail/` também entra; id não-UUID não consulta; timeout → sem-produto; corpo > 64 KiB → sem-produto; imagem em host fora da lista → og-image; `publishable` manda só `apikey`; `anon-jwt` manda `apikey` + `Bearer`; `conexao none` nunca chama `fetch`; `HEAD` devolve sem corpo; `og:url` usa `publicUrl` mesmo com Host diferente; `'` escapado.
- `tests/front/identity-build-finalization.test.ts`, `describe` novo ("arquivos de hospedagem"), `setup([], true)` com VitePWA real, fixture E database (molde `databaseTransport()`), `60000` em cada `it`: os cinco arquivos existem no `outDir`; nenhum deles aparece no manifesto de precache de `sw.js`; `404.html` == `index.html` byte a byte; `_redirects` tem 108 linhas; `_routes.json` exato; `_headers` == `headers(vercelJson)`; `_worker.js` contém a chave **só** em database e nunca `sb_secret`; falha simulada de escrita de um dos cinco → sem `version.json` (padrão de espionagem de `writeFile` do arquivo, linhas ~419-441); `version.json` continua com 6 campos.
- Mutação obrigatória na revisão: apagar a chamada `gerarHospedagem` (os testes de existência caem), trocar `"wx"` por `"w"` (o teste de pré-existência cai), remover o `limit=1` (o teste da consulta cai), tirar a condição `keyClass` (o teste do publishable cai).
- Depois de integrado: UMA execução de `tests/identity-real-kit-build/run.mjs` (fixture, `vite.config.ts` real; correção (3) do diretor para o A7b2 vale aqui também) e o ensaio no runtime congelado do A7a2 (Wrangler 4.130.0 em `C:/Users/Gabriel/recuperacao-ikcous/20260909-ecossistema/controle/pages-rotas-20260909-a7a2-91de/runtime/`) sobre o `dist-test` real: repetir a matriz do A7a3 (109 entradas GET/HEAD, 5 queries, ausentes 404/no-store, desconhecidos, testemunha só nas duas formas de produto, V1→V2, reinício) como bancada opt-in em `tests/hospedagem-pages/` — sem rede (worker `none`).

## 9. A conta dos dois lados

- **Melhora:** a loja pode ser servida por outra hospedagem com o mesmo pacote, sem cópia por cliente, mantendo os links, a atualização e a prévia de produto; e o compartilhamento passa a usar a chave classificada e a origem do contrato, em vez de `process.env` com fallback da loja principal (defeito real do `middleware.ts:24`).
- **Pode piorar:** o build fica com um passo a mais e uma dependência a mais em tempo de build (`esbuild`, já instalada); um erro no tradutor de cabeçalhos ou no worker reprova o build inteiro (por desenho: melhor sem marcador que marcador errado). Na Vercel, `/_worker.js`, `/404.html`, `/_headers`, `/_redirects` e `/_routes.json` passam a existir como arquivos públicos — só configuração pública, mas existem.
- **Conserto:** reverter o commit do gerador devolve o `dist` de hoje; nada fora do repositório muda até alguém publicar no Pages.
- **Bem maior:** abrir a loja certa, atualizar o app instalado e comprar. Nada aqui altera o SW, o precache, o `version.json` ou o `index.html`.

## 10. Fora de escopo, com nome

Publicação, conta, domínio, cotas, `wrangler` no repositório, transição do `.vercel.app`, ensaio com banco real (portão da publicação), correção das três views fora de `validViews` (`product`, `admin-sros`, `referral` — documentar, não mexer), `_headers` para `/store-identity/*` (o padrão do Pages revalida; não há regra em `vercel.json` para traduzir), e qualquer mudança em `vercel.json`, `middleware.ts` ou no SW.
