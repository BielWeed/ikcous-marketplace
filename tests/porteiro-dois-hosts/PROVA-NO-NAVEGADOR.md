# Prova no navegador — T6, ADENDO D, achado 2

Registro à mão da prova ponta a ponta OBSERVADA por um navegador de verdade
(`Claude_Browser`), fora do Vitest — o Vitest roda em `environment: "node"`
(sem `navigator`/`caches`/Service Worker), então esta parte da prova (título,
cor, data block, cache do SW e o próprio SW) só é observável assim. Ver
README.md, seção "As seis fichas", para o que o ensaio automatizado
(`porteiro-dois-hosts.test.ts`) já prova sem navegador.

## Como o servidor foi subido

```
IKCOUS_IDENTITY_MODE=fixture npm run build      # dist-test/ já existia (11:32Z, sw.js 13.055 bytes) — não foi refeito
./node_modules/.bin/esbuild tests/porteiro-dois-hosts/servir.ts \
  --bundle --platform=node --format=esm --alias:@=./src \
  --outfile=dist-test/servir.mjs
PORTA=4310 node dist-test/servir.mjs
```

`node tests/porteiro-dois-hosts/servir.ts` DIRETO (sem empacotar) foi tentado
primeiro — Node v25.8.2 tem type-stripping ligado por padrão, mas ele só
apaga TIPOS, não resolve import RELATIVO sem extensão. Falhou em
`src/hospedagem/porteiro.ts`, que importa `../config/fichaDaLojaContract`
(sem `.ts`) — erro `ERR_MODULE_NOT_FOUND`. O `esbuild` (0.27.2, já em
`node_modules/.bin`) resolve e empacota essa cadeia inteira num arquivo só;
funcionou de primeira. Registrado: **esbuild foi o caminho que funcionou**;
Node puro não, pela mesma razão que o brief já antecipava (imports sem
extensão em `src/`).

Durante o empacotamento apareceu um efeito colateral que exigiu correção em
`servidor.ts` (dentro do escopo desta tarefa): `DIST_TEST_DIR` era calculado
a partir de `import.meta.url` do PRÓPRIO módulo — correto quando cada
arquivo mantém sua localização real (Vitest transforma no lugar), mas um
bundle de arquivo ÚNICO colapsa TODO `import.meta.url` para a URL do bundle
(`dist-test/servir.mjs`), e a conta relativa (`"../../dist-test"`) passou a
apontar duas pastas ACIMA da raiz do repositório inteiro. Corrigido trocando
para `path.resolve(process.cwd(), "dist-test")` — seguro porque os DOIS
contextos (Vitest e `node dist-test/servir.mjs`) sempre rodam com o cwd na
raiz do repositório (documentado no cabeçalho de `servidor.ts` e em
`servir.ts`). `npx vitest run --config vitest.porteiro.config.ts` continuou
verde (10/10) depois da troca.

Porta: `PORTA=4310` (fixa, via env — `servir.ts` lê `process.env.PORTA`).

## Hora (UTC)

- Início da coleta: `2026-09-11 15:46:36Z` (primeira resposta curl medida)
- Loja A: `2026-09-11 15:48:14Z`
- Loja B: `2026-09-11 15:48:31Z`

## Loja A — `http://loja-a.localhost:4310/`

Valores colhidos por `javascript_tool`:

```json
{
  "title": "Loja A",
  "primaryColor": "#111111",
  "fichaHost": "loja-a.localhost",
  "fichaStoreName": "Loja A",
  "fichaSupabaseUrl": "https://aaaaaaaaaaaaaaaaaaaa.supabase.co",
  "temCacheIdentidade": false
}
```

Screenshot: cabeçalho "Loja A" com o círculo do logo em tom escuro
(consistente com `--primary-color: #111111`), busca "Buscar produtos", grade
de produto em skeleton de carregamento (ESPERADO — o app cliente fala
DIRETO com `https://aaaaaaaaaaaaaaaaaaaa.supabase.co`, uma origem fictícia
que não resolve por DNS de verdade; só o `fetch` DENTRO do processo Node do
servidor de ensaio é substituído pelo dublê — README.md, "O que este ensaio
NÃO prova"), e a barra de navegação inferior (Início/Favoritos/Carrinho/
Perfil).

`caches.has("ikcous-identidade")` → `false` (ver seção "Service Worker" abaixo
— o cache só existe se o `install` do SW rodar, e o SW não chegou a instalar).

## Loja B — `http://loja-b.localhost:4310/`

```json
{
  "title": "Loja B",
  "primaryColor": "#222222",
  "fichaHost": "loja-b.localhost",
  "fichaStoreName": "Loja B",
  "fichaSupabaseUrl": "https://bbbbbbbbbbbbbbbbbbbb.supabase.co",
  "temCacheIdentidade": false
}
```

Screenshot: cabeçalho "Loja B" (título e cor DIFERENTES de A — mesmo build,
`dist-test/`, servido para os dois hosts), mesmo layout (busca, skeleton de
carregamento, barra de navegação).

Os dois hosts confirmam a composição por HOST a partir do MESMO build: título,
cor (`--primary-color`), `host` e `supabaseUrl` do data block (`#ikcous-loja`)
divergem exatamente como o banco de brinquedo de cada host determina — a
mesma prova que `porteiro-dois-hosts.test.ts` já faz sem navegador, agora
observada por um navegador de verdade.

## Service Worker — FALHA, diagnosticada

`await navigator.serviceWorker.ready` NUNCA resolveu (timeout de 8s aplicado
na coleta) nos dois hosts. `caches.has("ikcous-identidade")` → `false` nos
dois — consequência direta: sem `install` bem-sucedido, não há cache.

### O erro

```
TypeError: Failed to register a ServiceWorker for scope ('http://loja-a.localhost:4310/')
with script ('http://loja-a.localhost:4310/sw.js'): An unknown error occurred when fetching the script.
```

(idêntico em Loja B, só o host muda). Console da página (log automático do
app, `[PWA] Service Worker registration error`) confirma a mesma falha —
colado abaixo, junto com o resto do console relevante de Loja A:

```
[error] Failed to load resource: net::ERR_NAME_NOT_RESOLVED   (x12 — chamadas do app a *.supabase.co fictício, não relacionado ao SW)
[error] An unknown error occurred when fetching the script.
[error] [PWA] Service Worker registration error: {stack: TypeError: Failed to register a ServiceWorker for … unknown error occurred when fetching the script., message: Failed to register a ServiceWorker for scope ('htt… unknown error occurred when fetching the script.}
```

### Diagnóstico (isolando a causa antes de apontar um dono)

1. **`/sw.js` está íntegro e serve corretamente.** `curl -H "Host:
   loja-a.localhost" http://127.0.0.1:4310/sw.js` → `200`, `content-type:
   text/javascript; charset=utf-8`, corpo completo (13.055 bytes, igual ao
   `dist-test/sw.js` medido pela hub). `fetch('/sw.js')` DENTRO da página
   também devolve o corpo completo e correto (13.051 caracteres de texto).
   **O arquivo não é o problema.**
2. **Hipótese testada e DESCARTADA — ausência de `Content-Length`:** o
   servidor original só mandava `Transfer-Encoding: chunked` (sem
   `Content-Length`) para arquivos estáticos, um padrão conhecido por
   causar falhas de registro de SW em alguns navegadores. Corrigido em
   `servirEstatico` (`servidor.ts`) para sempre mandar `content-length`
   explícito — correção legítima e mantida (é uma prática melhor para
   qualquer servidor de arquivo estático), mas **não resolveu o erro**: o
   mesmo `TypeError` apareceu depois da correção, com `/sw.js` já servindo
   `content-length: 13055`.
3. **Teste decisivo — um Service Worker TRIVIAL, no mesmo servidor, falha
   IGUAL:** foi criado um arquivo mínimo
   (`self.addEventListener('install', () => self.skipWaiting());`) servido
   de `dist-test/assets/` (fora do matcher do porteiro, passthrough puro,
   `200` confirmado por `curl`) e registrado com
   `navigator.serviceWorker.register('/assets/sw-trivial-diagnostico.js',
   { scope: '/assets/' })`. Resultado: o MESMO erro genérico ("An unknown
   error occurred when fetching the script."). Um script mínimo, correto,
   servido com os cabeçalhos certos, falha exatamente como `/sw.js` —
   **a causa não pode estar em `src/sw/sw.ts` nem no build fixture**,
   porque nem um arquivo completamente alheio a eles consegue registrar.
4. **A rede nunca chega a ver a requisição do SW.** `read_network_requests`
   (o log de rede desta ferramenta) não registrou NENHUMA chamada a
   `/sw.js` originada pelo mecanismo interno de registro de Service Worker
   do Chrome — só a chamada explícita que eu fiz via `fetch()` comum
   aparece no log. Isso indica que a falha acontece DENTRO do processo do
   navegador, antes mesmo de uma requisição HTTP sair — coerente com uma
   limitação da instrumentação/automação deste navegador embutido
   (Chromium sob controle CDP), não com o servidor ou o conteúdo servido.
5. Uma busca rápida (nível "rápida" da pesquisa, doc oficial + relatos)
   confirma que "An unknown error occurred when fetching the script" é uma
   mensagem genérica do Chromium para falhas do pipeline de busca do
   script do Service Worker, com causas conhecidas que vão de
   certificado/TLS a peculiaridades de automação via CDP (haveria até um
   issue aberto no rastreador do Chromium especificamente sobre CDP e
   Service Workers). Não achei um relato que reproduza exatamente este
   ambiente (Claude Browser), mas a família de causa é consistente com
   "ambiente de automação", não com o código do produto.

### Veredito e dono

**NÃO é `src/sw/sw.ts`, NÃO é o build fixture (`dist-test/`), NÃO é
`middleware.ts`/`porteiro.ts`, e não é `servidor.ts`/`servir.ts`** — o teste
do item 3 acima isola isso com um script trivial e alheio a todo o código do
produto, e ele falha do mesmo jeito. A causa mais provável, pelas evidências
acima, é uma limitação do NAVEGADOR EMBUTIDO desta ferramenta
(`Claude_Browser`, Chromium sob CDP) em completar o registro de QUALQUER
Service Worker, não deste produto especificamente.

`dono: hub` — não porque haja algo para corrigir no código (não há: os
quatro pontos acima descartam todo arquivo do produto e do meu escopo), mas
porque só a hub/Gabriel podem decidir como fechar esta parte específica da
evidência: repetir esta mesma coleta num Chrome de desktop de verdade (fora
desta ferramenta), ou aceitar as evidências indiretas já coletadas (SW
"instalado" no build — `dist-test/sw.js` de 13.055 bytes, medido pela hub
antes desta rodada; o servidor entrega o arquivo certo com os cabeçalhos
certos; a suíte automatizada não pode observar isto de forma alguma, dado
que roda em Node) como suficientes para fechar o item.

### O que NÃO falhou

Título, `--primary-color`, o data block (`#ikcous-loja`, com `host` e
`conexao.supabaseUrl` corretos por loja) e a composição do build único por
host — tudo isso foi observado e confirmado nos dois hosts, num navegador de
verdade. Só o passo específico "o navegador de verdade completa o registro
do Service Worker" ficou sem fechar, e por um motivo que as evidências acima
apontam para fora do código desta tarefa.

## Prova da hub no Chrome de verdade (11/09/2026, 15:58Z-15:59Z) — o SW FECHA

A hub repetiu a coleta acima num **Chrome de desktop de verdade** (o do dono,
pela extensão "Claude in Chrome" — fora do navegador embutido da ferramenta),
com o MESMO servidor e o MESMO build (`dist-test/`, `sw.js` de 13.055 bytes):

```
./node_modules/.bin/esbuild tests/porteiro-dois-hosts/servir.ts --bundle --platform=node --format=esm --alias:@=./src --outfile=dist-test/servir-hub.mjs
PORTA=4311 node dist-test/servir-hub.mjs
```

Loja A — `http://loja-a.localhost:4311/` (15:58Z):

```json
{"title":"Loja A","primaryColor":"#111111","fichaHost":"loja-a.localhost",
 "fichaStoreName":"Loja A","fichaSupabase":"https://aaaaaaaaaaaaaaaaaaaa.supabase.co",
 "swSuportado":true,
 "swReady":{"scope":"http://loja-a.localhost:4311/","active":"activated","scriptURL":"http://loja-a.localhost:4311/sw.js"},
 "temCacheIdentidade":true,"fichaNoCache":"loja-a.localhost",
 "chavesCache":["app-cache-1.28.0-sha.6feb1f3-identity.ddc95050…","ikcous-identidade","supabase-images-cache"]}
```

Loja B — `http://loja-b.localhost:4311/` (15:59:36Z):

```json
{"title":"Loja B","primaryColor":"#222222","fichaHost":"loja-b.localhost",
 "fichaStoreName":"Loja B","fichaSupabase":"https://bbbbbbbbbbbbbbbbbbbb.supabase.co",
 "swReady":{"scope":"http://loja-b.localhost:4311/","active":"activated","scriptURL":"http://loja-b.localhost:4311/sw.js"},
 "temCacheIdentidade":true,"fichaNoCache":{"host":"loja-b.localhost","storeName":"Loja B"},
 "chavesCache":["app-cache-1.28.0-sha.6feb1f3-identity.ddc95050…","ikcous-identidade","supabase-images-cache"]}
```

Console (os dois hosts): `[EnvGuard] Chave do Supabase resolvida a partir de
ficha.` e `[PWA] Service Worker registered: /sw.js`. Os erros
`ERR_NAME_NOT_RESOLVED`/`Config fetch error` são as chamadas do app cliente às
origens fictícias `*.supabase.co` (esperado, ver acima). Screenshots: cabeçalho
"Loja A" e "Loja B", catálogo vazio ("Nenhum produto agora"), mesmo layout.

Conclusão: o Service Worker do produto INSTALA e ATIVA num Chrome de verdade,
e o cache `ikcous-identidade` guarda a ficha do PRÓPRIO host (A guarda A, B
guarda B) — o que a T2/T2b prometeram. A falha registrada na seção anterior é
do navegador embutido da ferramenta, como o diagnóstico do executor apontou:
mesmo servidor, mesmo build, navegador diferente, resultado diferente.
