# Prova ponta a ponta do porteiro, com hosts de verdade

T6 do brief `equipe/entregas/20260911-brief-escala-etapa2-site-por-host.md`
(ADENDO D). O que este ensaio prova: um build ÚNICO
(`dist-test/`, "a loja de ninguém") servindo lojas DIFERENTES por HOST,
através do `middleware()` REAL — a mesma função exportada por
`middleware.ts` que a Vercel Edge chama em produção.

## Pré-requisito: `dist-test/` tem de existir

```
IKCOUS_IDENTITY_MODE=fixture npm run build
```

Sem isso, `porteiro-dois-hosts.test.ts` FALHA no carregamento do módulo, com
uma mensagem que diz exatamente este comando — nunca "pula" em silêncio
(regra estrita do ADENDO B). No CI, o job `build` já roda esse comando antes
de chamar este ensaio (ver `.github/workflows/ci.yml`, passo logo depois de
"Build de teste com identidade fictícia").

## Como rodar

```
npx vitest run --config vitest.porteiro.config.ts
```

Não entra em `npm run test:front` (que só varre `tests/front/` — ver
`vitest.config.ts`) porque `dist-test/` não existe naquele job (`test`),
só no job `build`.

## As seis fichas

| Host | Caminho do porteiro | O que prova |
|---|---|---|
| `loja-a.localhost` | (b) ambiente do próprio projeto | Ficha própria, positivo, roda ANTES das negativas |
| `loja-b.localhost` | (b) ambiente do próprio projeto | Ficha DIFERENTE de A, mesmo build assado |
| `loja-c.localhost` | (a) caderneta central dublada, hit | O caminho (a) também funciona ponta a ponta |
| `loja-d.localhost` (só na forma `loja-d.localhost.`, ponto final de FQDN) | (b) ambiente do próprio projeto | Host DEDICADO (rodada D, achado 1): nenhum outro teste toca `loja-d.localhost`, então o cache do porteiro começa vazio para ele — só assim o teste discrimina se `servidor.ts` normalizou o host com a MESMA regra do produto (`normalizarHost`) antes de escolher o `process.env` |
| `loja-trocada.localhost` | (a) caderneta dublada, hit — de PROPÓSITO ERRADO | Negativo central: a caderneta devolve o banco de B para este host; `decidirConcordancia` recusa (503 `discorda`), e o corpo não carrega nenhum byte da ficha de B |
| `loja-desconhecida.localhost` | nenhum dos dois tem banco | Negativo: 503 `sem-loja` |

## O que este ensaio NÃO prova (fora do escopo desta tarefa)

- **Nada de rede real, banco real, nem Vercel real.** `globalThis.fetch` é
  substituído por um dublê em memória (`servidor.ts`) — isto prova a
  COMPOSIÇÃO do porteiro por host, não a disponibilidade do Supabase ou da
  Vercel.
- **O Service Worker de verdade (`navigator.serviceWorker.ready`,
  `caches.has("ikcous-identidade")`) só é observável num NAVEGADOR de
  verdade** — o servidor deste ensaio serve os arquivos certos
  (`/sw.js`, `/identidade.json`) para isso funcionar, mas o próprio Vitest
  roda em Node (`environment: "node"`, sem `navigator`/`caches`/SW). Essa
  parte da prova (T6, seção "Prova no navegador") foi colhida à mão, fora
  desta suíte automatizada, com o `Claude_Browser` apontado para o servidor
  SOZINHO (`servir.ts`, ver seção abaixo) — a evidência mora em
  **`PROVA-NO-NAVEGADOR.md`**, neste mesmo diretório (rodada D, achado 2 —
  a afirmação anterior deste README, de que a evidência tinha sido colada
  no relatório da tarefa, estava ERRADA: não tinha sido colhida ainda).

## Subir o servidor SOZINHO (fora do Vitest), para a prova no navegador

```
IKCOUS_IDENTITY_MODE=fixture npm run build   # se dist-test/ não existir ou estiver velho
PORTA=4310 node tests/porteiro-dois-hosts/servir.ts
```

Node v25 tem type-stripping (apagar tipos TypeScript) ligado por padrão, mas
ele NÃO resolve import relativo sem extensão — e `src/hospedagem/porteiro.ts`
importa vários módulos de `src/` assim (o estilo comum do repositório). Rodar
`node tests/porteiro-dois-hosts/servir.ts` direto falha com
`ERR_MODULE_NOT_FOUND`. O caminho que funciona (medido em 11/09/2026,
`esbuild` 0.27.2, já em `node_modules/.bin`, sem instalar nada):

```
./node_modules/.bin/esbuild tests/porteiro-dois-hosts/servir.ts \
  --bundle --platform=node --format=esm --alias:@=./src \
  --outfile=dist-test/servir.mjs
PORTA=4310 node dist-test/servir.mjs
```

`PORTA` é opcional — sem ela, o SO escolhe uma porta livre e `servir.ts`
imprime qual foi. Ctrl+C encerra (ou `SIGTERM`). `servir.ts` NUNCA tem
sufixo `.test.ts` — não é um teste, nem `vitest` nem `deno test` o
descobrem.

## Quatro decisões sobre o estado que valem a pena repetir aqui

1. **O host é resolvido com `normalizarHost` (`src/hospedagem/porteiro.ts`),
   NUNCA por uma cópia própria da regra.** Achado do revisor na rodada C:
   uma versão anterior deste servidor computava o host com
   `cabecalhoHost.split(":")[0]!.toLowerCase()`, que preserva o PONTO FINAL
   de FQDN (`loja-a.localhost.` ≠ `loja-a.localhost` para essa conta, embora
   sejam a mesma loja) — divergindo da regra do produto justamente na classe
   de entrada que `normalizarHost` existe para tratar (T3b item 3). O teste
   dedicado (`loja-d.localhost.`, ver "As seis fichas" acima) prova isso —
   um host DEDICADO, que nenhum outro teste toca, porque o cache de módulo
   do porteiro (60 s, chaveado por `normalizarHost`) mascarava a diferença
   quando o teste usava `loja-a.localhost.` (já aquecido por um teste
   anterior ao mesmo host): a resposta vinha do cache, então o teste passava
   mesmo com a normalização QUEBRADA no servidor de ensaio (rodada D,
   achado 1 — a versão anterior deste README ainda descrevia o teste
   antigo, que não discriminava nada na suíte completa).
2. **A mutação de `process.env` por HOST não é segura para requisições de
   hosts DIFERENTES em voo ao mesmo tempo** — cada requisição muta o
   `process.env` do processo inteiro antes de chamar `middleware()`. REGRA:
   **um HOST por vez**; requisições concorrentes do MESMO host SÃO seguras
   (ver o próximo item). Isto simula "cada isolate da Vercel Edge tem o seu
   próprio `process.env`, fixo por projeto" o suficiente para provar a
   composição por host; não é um servidor de produção.
3. **`globalThis.fetch` é instalado UMA VEZ, na vida inteira do servidor —
   NUNCA por requisição** (rodada D, achado 5, correção sobre a versão
   anterior). Antes: cada requisição trocava `globalThis.fetch` pelo dublê e
   restaurava o original no `finally`; com DUAS requisições em voo para o
   MESMO host (o que o Chrome de verdade faz — `/`, `/sw.js`,
   `/identidade.json`, `/manifest.webmanifest` e os assets, tudo de uma vez
   ao carregar a página), a primeira a terminar restaurava o `fetch` REAL
   enquanto a segunda ainda estava dentro de `middleware()`, que saía para
   `https://<hash>.supabase.co` de verdade e caía em 503
   `banco-indisponivel`. Agora o dublê é instalado em
   `iniciarServidorDoisHosts` e só é restaurado em `fechar()` — é o que torna
   a regra do item 2 ("um host por vez; requisições concorrentes do MESMO
   host são seguras") verdadeira.
4. **O `Host` das requisições de teste NÃO viaja por `fetch()`.** Medido em
   11/09/2026: `fetch(url, { headers: { Host: "x" } })` do Node ignora o
   `Host` passado (é um "forbidden header name" do Fetch spec — o servidor
   recebe o `Host` real da conexão) e `*.localhost` não resolve por DNS no
   Node (`getaddrinfo ENOTFOUND`, só o Chrome resolve isso sozinho). Por
   isso `porteiro-dois-hosts.test.ts` fala `node:http` diretamente,
   conectando por IP (`127.0.0.1`) e escrevendo o `Host` desejado na própria
   requisição — a técnica padrão para simular hosts virtuais localmente sem
   tocar `/etc/hosts`.
