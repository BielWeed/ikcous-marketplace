# A7c — Adaptador de hospedagem Cloudflare Pages — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a finalização do build passa a gravar, no `outDir` e antes do `version.json`, os cinco arquivos que a Cloudflare Pages precisa (`_routes.json`, `_redirects`, `_headers`, `404.html`, `_worker.js`), alimentados pelo `PreparedStoreDelivery` e por uma declaração única de rotas compartilhada com o `App.tsx`.

**Architecture:** um gerador puro em JS (`scripts/hospedagem.mjs`) é chamado por `scripts/buildStore.mjs` depois do `closeBundle` do PWA (precache já fechado) e antes do marcador; o worker é código TypeScript em `src/hospedagem/` (coberto por `tsc -b`, eslint e vitest, fora do bundle do navegador por não ser importado pelo app), compilado no ato pelo `esbuild` já instalado, com a configuração pública embutida por `define`. A lista de telas de entrada sai de `src/config/rotas.ts`, importada pelo `App.tsx`, com espelho literal no gerador e teste de confronto.

**Tech Stack:** Node 24, Vite 7.3.6, esbuild 0.27.2 (dependência transitiva já instalada; nada novo), vitest 4, TypeScript 5.9. Nenhuma ferramenta Cloudflare entra no repositório.

**Spec:** `docs/superpowers/specs/2026-09-10-hospedagem-pages-adaptador-design.md` (lido junto com `C:/Users/Gabriel/equipe/entregas/20260909-codex-investigacao-ikcous/hospedagem-mapa-para-plano-a7c.md`, que traz cada fato de código com `arquivo:linha`).

## Global Constraints

- Branch de trabalho: `codex/hospedagem-pages`, criada a partir de `codex/identidade-unica` **depois** de o PR dessa branch existir. Worktree `C:/Users/Gabriel/worktrees-ikcous/app-identidade-20260909` (a árvore principal em `Documents/` não se toca).
- **Ninguém além do root commita.** Cada tarefa termina com working tree pronto e relatório; o root revisa, commita **por caminho** (`git commit -- <arquivos>`) com `LEFTHOOK_BIN=".../node_modules/lefthook-windows-x64/bin/lefthook.exe"`. Proibidos: `git add -A`, `stash`, `checkout`, `reset`, apagar untracked.
- Escopo de commit vem da lista fechada de `.commitlintrc.json`: usar `tooling` para gerador/worker/build e `ui` para o `App.tsx`.
- Sem build do App inteiro (`npm run build`), sem rede, sem banco, sem `.env`, sem deploy, sem instalação. Custo zero. Os testes constroem builds mínimos em `mkdtemp` (molde já existente).
- Nada é escrito em `public/`, `src/` ou `scripts/` **durante o build**; só no `outDir`. `vercel.json`, `middleware.ts` e `src/sw/sw.ts` não mudam.
- `version.json` continua com 6 campos e por último; falha em qualquer arquivo de hospedagem = sem marcador.
- Fixtures de chave: nunca `sb_secret_` com sufixo de 16+ caracteres nem JWT literal em arquivo (o secretlint do CI acorda); usar `sb_publishable_fixture_only` e o JWT montado em runtime que `identity-build-finalization.test.ts:523-527` já usa.
- Fim de linha: editar arquivo existente com `Edit` (preserva LF); arquivo novo escrito com `Write` → rodar `npx biome check --write <arquivo>` e conferir `python -c "print(open(P,'rb').read().count(b'\r\n'))"` = 0 antes de entregar.
- Verificação mínima de cada tarefa (colar a saída): `npx vitest run <arquivos de teste da tarefa>`; `npx tsc -b --force` (typecheck inteiro, ~1 min); `npx eslint <arquivos .ts/.tsx tocados>`; Biome medido em LF nos arquivos novos/alterados (`tr -d '\r' < arquivo > <pasta curta>/<mesmo caminho>` numa cópia LF da árvore com `biome.json` sem `vcs`, depois `node_modules/.bin/biome check` lá). **Nunca** `npm run lint`/`lint:ratchet` (rodada fria de 40 min, disputa de cache).
- eslint tem `eslint-plugin-security`: em código novo `.ts`, nada de `obj[variavel]` (usar `Map`/`.get`) nem `new RegExp(variavel)`.
- Nomes em português, como o restante do repositório; comentários explicam o **porquê**, não o quê.

---

## Mapa de arquivos

| Arquivo | Responsabilidade | Tarefa |
|---|---|---|
| `src/config/rotas.ts` (novo) | declaração única das 36 telas de entrada, tipada contra `View` | 1 |
| `src/App.tsx:1498-1535` (modificar) | usar `TELAS_DE_ENTRADA` no lugar do literal | 1 |
| `tests/front/rotas-de-entrada.test.ts` (novo) | invariantes da lista e prova de que o `App.tsx` a importa | 1 |
| `scripts/hospedagem.mjs` (novo) | espelho das telas, `formasDeEntrada`, `redirects`, `routes`, `headers`, `cabecalhosDeFuncao`, `hostsDeImagem`, `configDoWorker`, `compilarWorker`, `gerarHospedagem` | 2, 3, 5 |
| `tests/front/hospedagem-rotas.test.ts` (novo) | confronto espelho × declaração; `_redirects`/`_routes.json` | 2 |
| `tests/front/hospedagem-headers.test.ts` (novo) | tradução fechada de `vercel.json` | 3 |
| `src/hospedagem/contrato.ts` (novo) | tipos `HospedagemConfig`, `AmbienteDaHospedagem`, `MotivoOg` | 4 |
| `src/hospedagem/compartilhamento.ts` (novo) | lógica pura do worker + `criarWorker` | 4 |
| `tests/front/hospedagem-compartilhamento.test.ts` (novo) | comportamento do worker com `fetch` e `ASSETS` fictícios | 4 |
| `src/hospedagem/worker.ts` (novo) | entrada compilada pelo esbuild | 5 |
| `scripts/buildStore.mjs` (modificar, ~linha 382) | chamar `gerarHospedagem` antes do marcador | 5 |
| `tests/front/identity-build-finalization.test.ts` (modificar) | `describe` "arquivos de hospedagem" | 5 |
| `tests/hospedagem-pages/run.mjs` + `README.md` (novos, opt-in) | ensaio no runtime congelado do A7a2 sobre o `dist-test` real | 7 |

---

### Task 1: Declaração única das telas de entrada

**Files:**
- Create: `src/config/rotas.ts`
- Modify: `src/App.tsx:1498-1535` (o array `validViews` dentro de `syncWithUrl`) e o bloco de imports (~linha 174, onde já está `import type { Product, SortOption, View } from "@/types";`)
- Test: `tests/front/rotas-de-entrada.test.ts`

**Interfaces:**
- Produces: `export const TELAS_DE_ENTRADA: readonly View[]` (36 nomes, **na ordem exata** de `App.tsx:1499-1534`) e `export type TelaDeEntrada`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/front/rotas-de-entrada.test.ts
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TELAS_DE_ENTRADA } from "../../src/config/rotas";

const appTsx = path.resolve(import.meta.dirname, "../../src/App.tsx");

describe("telas de entrada (declaração única)", () => {
  it("são 36 nomes únicos, com home e 18 administrativas", () => {
    expect(TELAS_DE_ENTRADA).toHaveLength(36);
    expect(new Set(TELAS_DE_ENTRADA).size).toBe(36);
    expect(TELAS_DE_ENTRADA[0]).toBe("home");
    expect(TELAS_DE_ENTRADA.filter((t) => t.startsWith("admin-"))).toHaveLength(18);
    expect(TELAS_DE_ENTRADA).toContain("admin"); // nominal sem hífen, sem alias
  });

  it("App.tsx lê a lista daqui, não de um literal próprio", () => {
    const fonte = fs.readFileSync(appTsx, "utf8");
    expect(fonte).toContain("TELAS_DE_ENTRADA");
    expect(fonte).not.toMatch(/const validViews: View\[\] = \[/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/front/rotas-de-entrada.test.ts`
Expected: FAIL — `Cannot find module '../../src/config/rotas'`.

- [ ] **Step 3: Write the module**

```ts
// src/config/rotas.ts
import type { View } from "../types";

// Declaração ÚNICA das telas que o leitor de endereço do App.tsx reconhece.
// A hospedagem (scripts/hospedagem.mjs) gera as entradas estáticas a partir
// do espelho desta lista; tests/front/hospedagem-rotas.test.ts confronta os
// dois lados. Ordem preservada do App.tsx para o diff de revisão ser legível.
// Fora daqui, de propósito: `product`, `admin-sros` e `referral` existem no
// tipo View mas nunca foram entradas reconhecidas — documentado, não corrigido.
export const TELAS_DE_ENTRADA = [
  "home",
  "cart",
  "product-detail",
  "checkout",
  "profile",
  "admin",
  "search",
  "auth",
  "login",
  "favorites",
  "notifications",
  "order-success",
  "orders",
  "order-details",
  "recently-viewed",
  "account-settings",
  "admin-dashboard",
  "admin-products",
  "admin-product-form",
  "admin-orders",
  "admin-coupons",
  "admin-coupon-form",
  "admin-banners",
  "admin-carousels",
  "admin-shipping",
  "admin-settings",
  "admin-reviews",
  "admin-qa",
  "admin-customers",
  "admin-user-detail",
  "admin-push",
  "admin-notifications",
  "admin-whatsapp-config",
  "address-form",
  "admin-login",
  "user-profile",
] as const satisfies readonly View[];

export type TelaDeEntrada = (typeof TELAS_DE_ENTRADA)[number];
```

Antes de escrever, **confira** os 36 nomes contra `src/App.tsx:1499-1534` — a lista acima foi copiada do mapa de fatos; se o `App.tsx` do HEAD divergir, o `App.tsx` manda.

- [ ] **Step 4: Trocar o literal no App.tsx**

No bloco de imports, junto de `import type { Product, SortOption, View } from "@/types";`, acrescentar:

```ts
import { TELAS_DE_ENTRADA } from "@/config/rotas";
```

Em `syncWithUrl`, substituir o bloco inteiro `const validViews: View[] = [ … ];` (linhas 1498-1535) por:

```ts
      const validViews: readonly View[] = TELAS_DE_ENTRADA;
```

A linha seguinte (`if (validViews.includes(path as View))`) não muda. A normalização de `App.tsx:1486-1495` não muda.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/front/rotas-de-entrada.test.ts tests/front/categoria-da-home-sobrevive-ao-voltar.test.tsx tests/front/bloqueio-admin-preserva-categoria.test.tsx tests/front/redirect-de-produto-inexistente-preserva-categoria.test.tsx`
Expected: todos PASS (os três últimos exercitam o leitor de rota pelo `history`).

- [ ] **Step 6: Verificação da tarefa**

`npx tsc -b --force` (exit 0; o `satisfies readonly View[]` reprova se algum nome não for `View`); `npx eslint src/config/rotas.ts src/App.tsx tests/front/rotas-de-entrada.test.ts` (0 erro, warnings não sobem — `App.tsx` já tem warnings antigos: comparar contagem antes/depois com `git show HEAD:src/App.tsx > <temp>`); Biome em LF nos 3 arquivos; CRLF = 0.

- [ ] **Step 7: Entregar**

Relatório em `central/tarefa-A7c-T1-relatorio.md` com RED/GREEN, saídas e SHA256 dos arquivos. Root revisa (Sonnet: interface/lista) e commita `refactor(ui): declarar as telas de entrada num modulo unico`.

---

### Task 2: Espelho das telas, `_redirects` e `_routes.json`

**Files:**
- Create: `scripts/hospedagem.mjs`
- Test: `tests/front/hospedagem-rotas.test.ts`

**Interfaces:**
- Consumes: `TELAS_DE_ENTRADA` de `src/config/rotas.ts` (só no teste).
- Produces (JS puro, `export`): `telasDeEntrada: readonly string[]`; `formasDeEntrada(telas = telasDeEntrada): string[]` (54 caminhos ordenados, sem barra final); `redirects(telas = telasDeEntrada): string` (108 linhas + `\n` final); `routes(): string`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/front/hospedagem-rotas.test.ts
import { describe, expect, it } from "vitest";
import { TELAS_DE_ENTRADA } from "../../src/config/rotas";
// Módulo JS sem declaração de tipos, mesmo padrão de store-delivery-contract.test.ts.
// @ts-expect-error
import * as hospedagem from "../../scripts/hospedagem.mjs";

describe("rotas da hospedagem", () => {
  it("o espelho JS é igual à declaração única, na mesma ordem", () => {
    expect([...hospedagem.telasDeEntrada]).toEqual([...TELAS_DE_ENTRADA]);
  });

  it("controle negativo: uma tela a menos derruba o confronto", () => {
    expect([...hospedagem.telasDeEntrada].slice(1)).not.toEqual([...TELAS_DE_ENTRADA]);
  });

  it("54 formas: 36 nominais + 18 aliases admin/<x>, ordenadas", () => {
    const formas = hospedagem.formasDeEntrada();
    expect(formas).toHaveLength(54);
    expect(formas).toEqual([...formas].sort());
    expect(formas).toContain("/admin/orders");
    expect(formas).toContain("/admin-orders");
    expect(formas).toContain("/home");
    expect(formas).not.toContain("/");
    expect(formas).not.toContain("/admin/"); // "admin" não ganha alias
  });

  it("_redirects tem 108 regras, cada forma com e sem barra final, alvo raiz 200", () => {
    const texto = hospedagem.redirects();
    expect(texto.endsWith("\n")).toBe(true);
    const linhas = texto.trimEnd().split("\n");
    expect(linhas).toHaveLength(108);
    expect(linhas).toContain("/admin/orders / 200");
    expect(linhas).toContain("/admin/orders/ / 200");
    expect(linhas).toContain("/product-detail / 200");
    expect(linhas).not.toContain("/ / 200");
    for (const linha of linhas) expect(linha).toMatch(/^\/[a-z-]+(\/[a-z-]+)?\/? \/ 200$/);
  });

  it("_routes.json é exatamente o do ensaio A7a3", () => {
    expect(JSON.parse(hospedagem.routes())).toEqual({
      version: 1,
      include: ["/product-detail"],
      exclude: [],
    });
    expect(hospedagem.routes().endsWith("\n")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/front/hospedagem-rotas.test.ts`
Expected: FAIL — módulo `scripts/hospedagem.mjs` não existe.

- [ ] **Step 3: Write the module**

```js
// scripts/hospedagem.mjs
// Gera, no outDir e antes do version.json, os arquivos que a Cloudflare Pages
// precisa para servir a MESMA entrega: entradas estáticas, roteamento da
// função, cabeçalhos, 404 com o documento da loja e o worker do
// compartilhamento. Decisões: central/hospedagem-decisao-adaptador-local.md
// e hospedagem-decisao-rotas-preservadas.md; ensaio aprovado: A7a3.

// Espelho literal de src/config/rotas.ts. Este arquivo é JS nativo sem
// loader; tests/front/hospedagem-rotas.test.ts confronta os dois lados.
export const telasDeEntrada = Object.freeze([
  "home",
  "cart",
  "product-detail",
  "checkout",
  "profile",
  "admin",
  "search",
  "auth",
  "login",
  "favorites",
  "notifications",
  "order-success",
  "orders",
  "order-details",
  "recently-viewed",
  "account-settings",
  "admin-dashboard",
  "admin-products",
  "admin-product-form",
  "admin-orders",
  "admin-coupons",
  "admin-coupon-form",
  "admin-banners",
  "admin-carousels",
  "admin-shipping",
  "admin-settings",
  "admin-reviews",
  "admin-qa",
  "admin-customers",
  "admin-user-detail",
  "admin-push",
  "admin-notifications",
  "admin-whatsapp-config",
  "address-form",
  "admin-login",
  "user-profile",
]);

const PREFIXO_ADMIN = "admin-";

// O leitor do App.tsx aceita `/admin/<x>` como alias de `/admin-<x>` e uma
// barra final em qualquer forma; a raiz não precisa de regra.
export function formasDeEntrada(telas = telasDeEntrada) {
  const formas = new Set();
  for (const tela of telas) {
    formas.add(`/${tela}`);
    if (tela.startsWith(PREFIXO_ADMIN))
      formas.add(`/admin/${tela.slice(PREFIXO_ADMIN.length)}`);
  }
  return [...formas].sort();
}

export function redirects(telas = telasDeEntrada) {
  const linhas = [];
  for (const forma of formasDeEntrada(telas))
    linhas.push(`${forma} / 200`, `${forma}/ / 200`);
  return `${linhas.join("\n")}\n`;
}

// Só o compartilhamento de produto invoca a função; tudo o mais é estático.
export function routes() {
  const rotas = { version: 1, include: ["/product-detail"], exclude: [] };
  return `${JSON.stringify(rotas)}\n`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/front/hospedagem-rotas.test.ts`
Expected: 5 PASS.

- [ ] **Step 5: Verificação da tarefa**

`node --check scripts/hospedagem.mjs`; `npx tsc -b --force`; `npx eslint tests/front/hospedagem-rotas.test.ts`; Biome LF nos 2 arquivos (o `@ts-expect-error` numa linha só; se o Biome quebrar o import e o TS reclamar, seguir o precedente de `store-delivery-contract.test.ts`); CRLF = 0.

- [ ] **Step 6: Entregar**

Relatório `central/tarefa-A7c-T2-relatorio.md`. Root revisa (Sonnet) e commita `feat(tooling): gerar entradas e rotas da hospedagem a partir das telas`.

---

### Task 3: Tradução fechada dos cabeçalhos do `vercel.json`

**Files:**
- Modify: `scripts/hospedagem.mjs` (acrescentar)
- Test: `tests/front/hospedagem-headers.test.ts`

**Interfaces:**
- Produces: `lerVercel(): object` (lê `vercel.json` **do repositório**, resolvido a partir do próprio módulo, nunca do `outDir` nem do root do build); `headers(vercel): string` (texto de `_headers`); `cabecalhosDeFuncao(vercel): Readonly<Record<string,string>>` (os dez do bloco `/(.*)`); `hostsDeImagem(vercel): readonly string[]`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/front/hospedagem-headers.test.ts
import { describe, expect, it } from "vitest";
// @ts-expect-error
import * as hospedagem from "../../scripts/hospedagem.mjs";

const vercel = hospedagem.lerVercel();

describe("_headers traduzido do vercel.json", () => {
  it("cinco nomes de atualização, assets immutable e o bloco global sem Cache-Control", () => {
    const texto = hospedagem.headers(vercel);
    const blocos = texto.trimEnd().split("\n\n");
    expect(blocos).toHaveLength(7);
    expect(blocos[0]).toBe(
      "/sw.js\n  Cache-Control: public, max-age=0, must-revalidate, no-cache, no-store",
    );
    expect(blocos.map((b) => b.split("\n")[0])).toEqual([
      "/sw.js",
      "/service-worker.js",
      "/sw.ts",
      "/version.json",
      "/index.html",
      "/assets/*",
      "/*",
    ]);
    expect(blocos[5]).toBe("/assets/*\n  Cache-Control: public, max-age=31536000, immutable");
    const global = blocos[6].split("\n");
    expect(global).toHaveLength(11); // caminho + dez cabeçalhos
    expect(global.some((l) => /^\s+Cache-Control:/i.test(l))).toBe(false);
    expect(global).toContain("  X-Frame-Options: DENY");
    expect(global.some((l) => l.startsWith("  Content-Security-Policy: default-src 'self';"))).toBe(true);
    for (const linha of texto.split("\n")) expect(linha.length).toBeLessThanOrEqual(2000);
    expect(texto.endsWith("\n")).toBe(true);
  });

  it("fonte desconhecida no vercel.json reprova em vez de traduzir por aproximação", () => {
    const alterado = structuredClone(vercel);
    alterado.headers.push({ source: "/api/(.*)", headers: [{ key: "X", value: "1" }] });
    expect(() => hospedagem.headers(alterado)).toThrow(/HOSTING_HEADERS_UNKNOWN_SOURCE/);
  });

  it("Cache-Control no bloco global reprova (regras coincidentes concatenam no Pages)", () => {
    const alterado = structuredClone(vercel);
    const global = alterado.headers.find((b: { source: string }) => b.source === "/(.*)");
    global.headers.push({ key: "Cache-Control", value: "no-store" });
    expect(() => hospedagem.headers(alterado)).toThrow(/HOSTING_HEADERS_GLOBAL_CACHE/);
    expect(() => hospedagem.cabecalhosDeFuncao(alterado)).toThrow(/HOSTING_HEADERS_GLOBAL_CACHE/);
  });

  it("linha acima de 2000 caracteres reprova", () => {
    const alterado = structuredClone(vercel);
    const global = alterado.headers.find((b: { source: string }) => b.source === "/(.*)");
    global.headers.push({ key: "X-Longo", value: "a".repeat(2001) });
    expect(() => hospedagem.headers(alterado)).toThrow(/HOSTING_HEADERS_LINE_TOO_LONG/);
  });

  it("cabeçalhos da função são os dez do bloco global", () => {
    const dez = hospedagem.cabecalhosDeFuncao(vercel);
    expect(Object.keys(dez).sort()).toEqual([
      "Content-Security-Policy",
      "Cross-Origin-Embedder-Policy",
      "Cross-Origin-Opener-Policy",
      "Cross-Origin-Resource-Policy",
      "Permissions-Policy",
      "Referrer-Policy",
      "Strict-Transport-Security",
      "X-Content-Type-Options",
      "X-Frame-Options",
      "X-XSS-Protection",
    ]);
    expect(Object.isFrozen(dez)).toBe(true);
  });

  it("hosts de imagem vêm do img-src do CSP", () => {
    expect(hospedagem.hostsDeImagem(vercel)).toEqual([
      "*.supabase.co",
      "images.unsplash.com",
      "placehold.co",
      "*.mlstatic.com",
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/front/hospedagem-headers.test.ts`
Expected: FAIL — `hospedagem.lerVercel is not a function`.

- [ ] **Step 3: Write the implementation** (acrescentar ao fim de `scripts/hospedagem.mjs`; imports no topo)

```js
import { readFileSync } from "node:fs";
import fs from "node:fs/promises"; // o MESMO import de buildStore.mjs:3 — o teste de falha espiona este objeto
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ_DO_REPOSITORIO = fileURLToPath(new URL("..", import.meta.url));
const LIMITE_DA_LINHA = 2000; // limite documentado do _headers do Pages

// As regras de hospedagem são do APP, não da loja: lidas do repositório, nunca
// do root do build (os testes constroem em mkdtemp sem vercel.json).
export function lerVercel() {
  return JSON.parse(
    readFileSync(path.join(RAIZ_DO_REPOSITORIO, "vercel.json"), "utf8"),
  );
}

const ehCacheControl = ({ key }) => key.toLowerCase() === "cache-control";

const regra = (caminho, cabecalhos) =>
  [caminho, ...cabecalhos.map(({ key, value }) => `  ${key}: ${value}`)].join("\n");

const FONTE_GLOBAL = "/(.*)";

// Tradução FECHADA: só as três fontes que o vercel.json tem hoje. Uma fonte
// nova reprova o build em vez de virar um glob aproximado em silêncio.
const TRADUCOES = new Map([
  [
    "/(sw\\.js|service-worker\\.js|sw\\.ts|version\\.json|index\\.html)",
    (cabecalhos) =>
      ["/sw.js", "/service-worker.js", "/sw.ts", "/version.json", "/index.html"].map(
        (caminho) => regra(caminho, cabecalhos),
      ),
  ],
  ["/assets/(.*)", (cabecalhos) => [regra("/assets/*", cabecalhos)]],
  [
    FONTE_GLOBAL,
    (cabecalhos) => {
      // Regras coincidentes se combinam e cabeçalhos repetidos concatenam
      // valores no Pages: um Cache-Control global misturaria com o de /assets/*.
      if (cabecalhos.some(ehCacheControl))
        throw new Error("HOSTING_HEADERS_GLOBAL_CACHE");
      return [regra("/*", cabecalhos)];
    },
  ],
]);

export function headers(vercel) {
  const blocos = [];
  for (const { source, headers: lista } of vercel.headers ?? []) {
    const traduzir = TRADUCOES.get(source);
    if (!traduzir) throw new Error(`HOSTING_HEADERS_UNKNOWN_SOURCE ${source}`);
    if (!Array.isArray(lista) || lista.length === 0)
      throw new Error(`HOSTING_HEADERS_EMPTY ${source}`);
    blocos.push(...traduzir(lista));
  }
  const texto = `${blocos.join("\n\n")}\n`;
  for (const linha of texto.split("\n"))
    if (linha.length > LIMITE_DA_LINHA)
      throw new Error("HOSTING_HEADERS_LINE_TOO_LONG");
  return texto;
}

// _headers só rege respostas estáticas; a função precisa repetir os mesmos
// cabeçalhos de segurança nas respostas que ela mesma gera.
export function cabecalhosDeFuncao(vercel) {
  const global = (vercel.headers ?? []).find((b) => b.source === FONTE_GLOBAL);
  if (!global) throw new Error("HOSTING_HEADERS_NO_GLOBAL");
  if (global.headers.some(ehCacheControl))
    throw new Error("HOSTING_HEADERS_GLOBAL_CACHE");
  return Object.freeze(
    Object.fromEntries(global.headers.map(({ key, value }) => [key, value])),
  );
}

// A prévia de produto só embute imagem de host que o CSP do app já permite.
export function hostsDeImagem(vercel) {
  const csp = cabecalhosDeFuncao(vercel)["Content-Security-Policy"];
  const diretiva = (csp ?? "")
    .split(";")
    .map((parte) => parte.trim())
    .find((parte) => parte.startsWith("img-src "));
  if (!diretiva) throw new Error("HOSTING_CSP_NO_IMG_SRC");
  return Object.freeze(
    diretiva
      .split(/\s+/)
      .slice(1)
      .filter((fonte) => fonte.startsWith("https://"))
      .map((fonte) => fonte.slice("https://".length)),
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/front/hospedagem-headers.test.ts tests/front/hospedagem-rotas.test.ts`
Expected: todos PASS.

- [ ] **Step 5: Verificação e entrega**

`node --check scripts/hospedagem.mjs`; `npx tsc -b --force`; `npx eslint tests/front/hospedagem-headers.test.ts`; Biome LF; CRLF = 0. Relatório `central/tarefa-A7c-T3-relatorio.md`. Root revisa (Opus: cabeçalhos de segurança são contrato) e commita `feat(tooling): traduzir os cabecalhos do vercel.json para a hospedagem`.

---

### Task 4: Lógica do worker de compartilhamento (pura, testável)

**Files:**
- Create: `src/hospedagem/contrato.ts`, `src/hospedagem/compartilhamento.ts`
- Test: `tests/front/hospedagem-compartilhamento.test.ts`
- Read first: `middleware.ts` inteiro (é o comportamento a preservar) e `tests/link_do_whatsapp_test.ts` (os 18 casos a portar).

**Interfaces:**
- Produces (`contrato.ts`): `HospedagemConfig`, `ConexaoDaHospedagem`, `AmbienteDaHospedagem`, `MotivoOg`, `ClasseDeChave`.
- Produces (`compartilhamento.ts`): `ehRobo(ua)`, `idValido(id)`, `escaparHtml(t)`, `hostPermitido(host, permitidos)`, `imagemPermitida(url, config)`, `montarConsulta(origin, id)`, `cabecalhosDaConsulta(conexao)`, `consultarProduto(config, id, opcoes?)`, `montarHtml(produto, id, config)`, `criarWorker(config, opcoes?)` → `{ fetch(request, env) }`. Constantes `PRAZO_MS = 2500`, `CORPO_MAXIMO = 65536`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/front/hospedagem-compartilhamento.test.ts
import { describe, expect, it, vi } from "vitest";
import {
  CORPO_MAXIMO,
  criarWorker,
  escaparHtml,
  idValido,
  imagemPermitida,
  montarConsulta,
} from "../../src/hospedagem/compartilhamento";
import type { AmbienteDaHospedagem, HospedagemConfig } from "../../src/hospedagem/contrato";

const ID = "3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const ORIGEM = "https://abcdefghijklmnopqrst.supabase.co";
const CHAVE = "sb_publishable_fixture_only";

function config(extra: Partial<HospedagemConfig> = {}): HospedagemConfig {
  return {
    versao: 1,
    publicUrl: "https://loja-exclusiva.invalid",
    storeName: "Loja & Cia",
    conexao: { kind: "database", origin: ORIGEM, key: CHAVE, keyClass: "publishable" },
    hostsDeImagem: ["*.supabase.co", "images.unsplash.com"],
    cabecalhos: { "X-Frame-Options": "DENY", "X-Content-Type-Options": "nosniff" },
    deliveryVersion: "1.26.0+a.b.c",
    ...extra,
  };
}

function ambiente() {
  const pedidos: Request[] = [];
  const env: AmbienteDaHospedagem = {
    ASSETS: {
      fetch: async (request) => {
        pedidos.push(request);
        return new Response(request.method === "HEAD" ? null : "<html>app</html>", {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8", etag: '"app"' },
        });
      },
    },
  };
  return { env, pedidos };
}

const ROBO = { "user-agent": "WhatsApp/2.23.20.0" };
const NAVEGADOR = { "user-agent": "Mozilla/5.0 Chrome/120" };
const produto = {
  id: ID,
  nome: 'Tênis "Aero" <novo>',
  descricao: "Leve & rápido",
  preco_venda: 199.9,
  imagem_url: "https://abc.supabase.co/storage/v1/object/public/p/1.jpg",
  imagem_urls: null,
};

function fetchComProduto(lista: unknown, init?: ResponseInit) {
  const chamadas: { url: string; init: RequestInit | undefined }[] = [];
  const impl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    chamadas.push({ url: String(url), init });
    return new Response(JSON.stringify(lista), { status: 200, ...init2(init) });
  });
  function init2(_: RequestInit | undefined) {
    return init ?? {};
  }
  return { impl, chamadas };
}

describe("funções puras", () => {
  it("escapa & < > \" e também a aspa simples", () => {
    expect(escaparHtml(`a&b<c>"d'e`)).toBe("a&amp;b&lt;c&gt;&quot;d&#39;e");
  });
  it("id só em formato UUID", () => {
    expect(idValido(ID)).toBe(true);
    expect(idValido("1 OR 1=1")).toBe(false);
    expect(idValido(null)).toBe(false);
    expect(idValido(`${ID}x`)).toBe(false);
  });
  it("consulta explícita: colunas fechadas, id codificado, limit=1", () => {
    expect(montarConsulta(ORIGEM, ID)).toBe(
      `${ORIGEM}/rest/v1/vw_produtos_public?id=eq.${ID}&select=id,nome,descricao,preco_venda,imagem_url,imagem_urls&limit=1`,
    );
  });
  it("imagem só https em host permitido ou na própria loja", () => {
    const c = config();
    expect(imagemPermitida("https://abc.supabase.co/x.jpg", c)).toBe(true);
    expect(imagemPermitida("https://loja-exclusiva.invalid/og.png", c)).toBe(true);
    expect(imagemPermitida("http://abc.supabase.co/x.jpg", c)).toBe(false);
    expect(imagemPermitida("https://evil.example/x.jpg", c)).toBe(false);
    expect(imagemPermitida("https://supabase.co/x.jpg", c)).toBe(false); // curinga exige subdomínio
    expect(imagemPermitida("não é url", c)).toBe(false);
  });
});

describe("worker", () => {
  it("fora de /product-detail passa o pedido intacto ao serviço de arquivos", async () => {
    const { env, pedidos } = ambiente();
    const { impl } = fetchComProduto([produto]);
    const worker = criarWorker(config(), { fetchImpl: impl });
    const pedido = new Request("https://loja.exemplo/cart?x=1", { headers: ROBO });
    await worker.fetch(pedido, env);
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0].url).toBe("https://loja.exemplo/cart?x=1");
    expect(impl).not.toHaveBeenCalled();
  });

  it("navegador em /product-detail recebe o documento da raiz, URL preservada, x-ikcous-og: passa", async () => {
    const { env, pedidos } = ambiente();
    const { impl } = fetchComProduto([produto]);
    const worker = criarWorker(config(), { fetchImpl: impl });
    const resposta = await worker.fetch(
      new Request(`https://loja.exemplo/product-detail?id=${ID}`, { headers: NAVEGADOR }),
      env,
    );
    expect(pedidos[0].url).toBe("https://loja.exemplo/");
    expect(resposta.headers.get("x-ikcous-og")).toBe("passa");
    expect(resposta.headers.get("x-ikcous-delivery")).toBe("1.26.0+a.b.c");
    expect(await resposta.text()).toBe("<html>app</html>");
    expect(impl).not.toHaveBeenCalled();
  });

  it.each(["/product-detail", "/product-detail/"])(
    "robô com produto em %s recebe a prévia com cabeçalhos de segurança e no-store",
    async (caminho) => {
      const { env } = ambiente();
      const { impl, chamadas } = fetchComProduto([produto]);
      const worker = criarWorker(config(), { fetchImpl: impl });
      const resposta = await worker.fetch(
        new Request(`https://loja.exemplo${caminho}?id=${ID}`, { headers: ROBO }),
        env,
      );
      expect(resposta.status).toBe(200);
      expect(resposta.headers.get("x-ikcous-og")).toBe("produto");
      expect(resposta.headers.get("cache-control")).toBe("no-store");
      expect(resposta.headers.get("x-frame-options")).toBe("DENY");
      expect(resposta.headers.get("content-type")).toBe("text/html; charset=utf-8");
      const html = await resposta.text();
      expect(html).toContain("Tênis &quot;Aero&quot; &lt;novo&gt;");
      expect(html).toContain("Leve &amp; rápido");
      expect(html).toContain("R$ 199,90");
      expect(html).toContain(`<title>Tênis &quot;Aero&quot; &lt;novo&gt; | Loja &amp; Cia</title>`);
      expect(html).toContain(
        `<meta property="og:url" content="https://loja-exclusiva.invalid/product-detail?id=${ID}">`,
      );
      expect(html).toContain('content="https://abc.supabase.co/storage/v1/object/public/p/1.jpg"');
      expect(chamadas).toHaveLength(1);
      expect(chamadas[0].url).toBe(montarConsulta(ORIGEM, ID));
    },
  );

  it("publishable manda só apikey; anon-jwt manda apikey e Bearer", async () => {
    const { env } = ambiente();
    const a = fetchComProduto([produto]);
    await criarWorker(config(), { fetchImpl: a.impl }).fetch(
      new Request(`https://loja.exemplo/product-detail?id=${ID}`, { headers: ROBO }),
      env,
    );
    const ha = new Headers(a.chamadas[0].init?.headers);
    expect(ha.get("apikey")).toBe(CHAVE);
    expect(ha.get("authorization")).toBeNull();
    expect(ha.get("accept")).toBe("application/json");

    const jwt = "anon.jwt.montado-em-runtime";
    const b = fetchComProduto([produto]);
    await criarWorker(
      config({ conexao: { kind: "database", origin: ORIGEM, key: jwt, keyClass: "anon-jwt" } }),
      { fetchImpl: b.impl },
    ).fetch(new Request(`https://loja.exemplo/product-detail?id=${ID}`, { headers: ROBO }), env);
    const hb = new Headers(b.chamadas[0].init?.headers);
    expect(hb.get("apikey")).toBe(jwt);
    expect(hb.get("authorization")).toBe(`Bearer ${jwt}`);
    expect(b.chamadas[0].init?.redirect).toBe("manual");
    expect(b.chamadas[0].init?.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([
    ["lista vazia", () => new Response("[]", { status: 200 })],
    ["permission denied 42501", () => new Response('{"code":"42501"}', { status: 401 })],
    ["redirecionamento", () => new Response(null, { status: 302, headers: { location: "https://x" } })],
    ["JSON inválido", () => new Response("<html>", { status: 200 })],
    ["corpo acima do limite", () => new Response(`[${"x".repeat(CORPO_MAXIMO + 1)}]`, { status: 200 })],
    ["rede caiu", () => Promise.reject(new TypeError("Failed to fetch"))],
  ])("%s → documento da loja com sem-produto, nunca produto", async (_, resposta) => {
    const { env, pedidos } = ambiente();
    const impl = vi.fn(async () => resposta());
    const r = await criarWorker(config(), { fetchImpl: impl }).fetch(
      new Request(`https://loja.exemplo/product-detail?id=${ID}`, { headers: ROBO }),
      env,
    );
    expect(r.headers.get("x-ikcous-og")).toBe("sem-produto");
    expect(pedidos[0].url).toBe("https://loja.exemplo/");
    expect(await r.text()).toBe("<html>app</html>");
  });

  it("prazo: consulta pendurada é abortada e cai em sem-produto", async () => {
    const { env } = ambiente();
    const impl = vi.fn(
      (_: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    );
    const inicio = Date.now();
    const r = await criarWorker(config(), { fetchImpl: impl, prazoMs: 30 }).fetch(
      new Request(`https://loja.exemplo/product-detail?id=${ID}`, { headers: ROBO }),
      env,
    );
    expect(r.headers.get("x-ikcous-og")).toBe("sem-produto");
    expect(Date.now() - inicio).toBeLessThan(2000);
  });

  it("id fora do formato não consulta; sem conexão nunca consulta", async () => {
    const { env } = ambiente();
    const { impl } = fetchComProduto([produto]);
    const r1 = await criarWorker(config(), { fetchImpl: impl }).fetch(
      new Request("https://loja.exemplo/product-detail?id=1%20OR%201=1", { headers: ROBO }),
      env,
    );
    expect(r1.headers.get("x-ikcous-og")).toBe("sem-produto");
    const r2 = await criarWorker(config({ conexao: { kind: "none" } }), { fetchImpl: impl }).fetch(
      new Request(`https://loja.exemplo/product-detail?id=${ID}`, { headers: ROBO }),
      env,
    );
    expect(r2.headers.get("x-ikcous-og")).toBe("sem-produto");
    expect(impl).not.toHaveBeenCalled();
  });

  it("imagem fora dos hosts permitidos cai no og-image da própria loja", async () => {
    const { env } = ambiente();
    const { impl } = fetchComProduto([{ ...produto, imagem_url: "https://evil.example/x.jpg" }]);
    const r = await criarWorker(config(), { fetchImpl: impl }).fetch(
      new Request(`https://loja.exemplo/product-detail?id=${ID}`, { headers: ROBO }),
      env,
    );
    const html = await r.text();
    expect(html).toContain('content="https://loja-exclusiva.invalid/og-image.png"');
    expect(html).not.toContain("evil.example");
  });

  it("produto sem nome e sem imagem usa os textos padrão da loja", async () => {
    const { env } = ambiente();
    const { impl } = fetchComProduto([{ id: ID }]);
    const html = await (
      await criarWorker(config(), { fetchImpl: impl }).fetch(
        new Request(`https://loja.exemplo/product-detail?id=${ID}`, { headers: ROBO }),
        env,
      )
    ).text();
    expect(html).toContain("Produto - Loja &amp; Cia");
    expect(html).toContain("Confira os detalhes do produto no Loja &amp; Cia.");
    expect(html).toContain("/og-image.png");
  });

  it("HEAD de robô com produto devolve os cabeçalhos e nenhum corpo", async () => {
    const { env } = ambiente();
    const { impl } = fetchComProduto([produto]);
    const r = await criarWorker(config(), { fetchImpl: impl }).fetch(
      new Request(`https://loja.exemplo/product-detail?id=${ID}`, { method: "HEAD", headers: ROBO }),
      env,
    );
    expect(r.headers.get("x-ikcous-og")).toBe("produto");
    expect(await r.text()).toBe("");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/front/hospedagem-compartilhamento.test.ts`
Expected: FAIL — módulos de `src/hospedagem/` não existem.

- [ ] **Step 3: Write `contrato.ts`**

```ts
// src/hospedagem/contrato.ts
// O que o worker de compartilhamento sabe em tempo de execução. É embutido
// no _worker.js pela finalização do build (scripts/hospedagem.mjs) a partir do
// PreparedStoreDelivery — nunca lido de process.env, de Host ou de um fallback.
export type ClasseDeChave = "publishable" | "anon-jwt";

export type ConexaoDaHospedagem =
  | {
      readonly kind: "database";
      readonly origin: string; // https://<ref>.supabase.co, sem barra final
      readonly key: string; // chave PÚBLICA, a mesma do bundle do app
      readonly keyClass: ClasseDeChave;
    }
  | { readonly kind: "none" }; // fixture: o worker nunca consulta

export interface HospedagemConfig {
  readonly versao: 1;
  readonly publicUrl: string; // snapshot.publicUrl (HTTPS, raiz, sem barra)
  readonly storeName: string;
  readonly conexao: ConexaoDaHospedagem;
  readonly hostsDeImagem: readonly string[]; // do img-src do CSP; "*.x" = sufixo
  readonly cabecalhos: Readonly<Record<string, string>>; // bloco "/*" do vercel.json
  readonly deliveryVersion: string;
}

export interface ServicoDeArquivos {
  fetch(request: Request): Promise<Response>;
}

export interface AmbienteDaHospedagem {
  readonly ASSETS: ServicoDeArquivos;
}

export type MotivoOg = "produto" | "sem-produto" | "passa";
```

- [ ] **Step 4: Write `compartilhamento.ts`**

```ts
// src/hospedagem/compartilhamento.ts
// Porta do middleware.ts (Vercel Edge) para uma Function do Pages, com o que a
// decisão do sócio exigiu a mais: id validado, seleção explícita e limit=1,
// prazo e corpo limitados, sem redirecionamento, origem vinda do contrato,
// chave publishable sem virar JWT, e imagem só de host permitido.
import type {
  AmbienteDaHospedagem,
  ConexaoDaHospedagem,
  HospedagemConfig,
  MotivoOg,
} from "./contrato";

export const PRAZO_MS = 2500;
export const CORPO_MAXIMO = 64 * 1024;

const ROBOS =
  /whatsapp|facebookexternalhit|twitterbot|telegrambot|slackbot|googlebot|bingbot|baiduspider|yandexbot/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CAMINHOS_DE_PRODUTO = new Set(["/product-detail", "/product-detail/"]);
const COLUNAS = "id,nome,descricao,preco_venda,imagem_url,imagem_urls";

type ConexaoComBanco = Extract<ConexaoDaHospedagem, { kind: "database" }>;

export interface ProdutoPublico {
  readonly nome?: unknown;
  readonly descricao?: unknown;
  readonly preco_venda?: unknown;
  readonly imagem_url?: unknown;
  readonly imagem_urls?: unknown;
}

export interface OpcoesDoWorker {
  readonly fetchImpl?: typeof fetch;
  readonly prazoMs?: number;
}

export function ehRobo(userAgent: string | null): boolean {
  return ROBOS.test(userAgent ?? "");
}

export function idValido(id: string | null): id is string {
  return id !== null && UUID.test(id);
}

export function escaparHtml(texto: string): string {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function hostPermitido(host: string, permitidos: readonly string[]): boolean {
  return permitidos.some((permitido) =>
    permitido.startsWith("*.")
      ? host.endsWith(permitido.slice(1)) && host.length > permitido.length - 1
      : host === permitido,
  );
}

export function imagemPermitida(url: string, config: HospedagemConfig): boolean {
  let candidata: URL;
  try {
    candidata = new URL(url);
  } catch {
    return false;
  }
  if (candidata.protocol !== "https:") return false;
  return (
    candidata.host === new URL(config.publicUrl).host ||
    hostPermitido(candidata.host, config.hostsDeImagem)
  );
}

export function montarConsulta(origin: string, id: string): string {
  return `${origin}/rest/v1/vw_produtos_public?id=eq.${encodeURIComponent(id)}&select=${COLUNAS}&limit=1`;
}

// Publishable vai só em apikey (não é JWT); o JWT anon legado ainda precisa
// do Bearer. Fonte: doc de chaves de API do Supabase citada na decisão.
export function cabecalhosDaConsulta(conexao: ConexaoComBanco): Headers {
  const cabecalhos = new Headers({ apikey: conexao.key, Accept: "application/json" });
  if (conexao.keyClass === "anon-jwt")
    cabecalhos.set("Authorization", `Bearer ${conexao.key}`);
  return cabecalhos;
}

async function lerCorpoLimitado(resposta: Response, maximo: number): Promise<string | null> {
  const leitor = resposta.body?.getReader();
  if (!leitor) return null;
  const partes: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximo) {
      await leitor.cancel();
      return null;
    }
    partes.push(value);
  }
  const junto = new Uint8Array(total);
  let posicao = 0;
  for (const parte of partes) {
    junto.set(parte, posicao);
    posicao += parte.byteLength;
  }
  return new TextDecoder().decode(junto);
}

export async function consultarProduto(
  config: HospedagemConfig,
  id: string,
  opcoes: OpcoesDoWorker = {},
): Promise<ProdutoPublico | null> {
  if (config.conexao.kind !== "database") return null;
  const fetchImpl = opcoes.fetchImpl ?? fetch;
  try {
    const resposta = await fetchImpl(montarConsulta(config.conexao.origin, id), {
      headers: cabecalhosDaConsulta(config.conexao),
      redirect: "manual",
      signal: AbortSignal.timeout(opcoes.prazoMs ?? PRAZO_MS),
    });
    if (!resposta.ok) return null;
    const texto = await lerCorpoLimitado(resposta, CORPO_MAXIMO);
    if (texto === null) return null;
    const lista: unknown = JSON.parse(texto);
    if (!Array.isArray(lista) || lista.length === 0) return null;
    const primeiro: unknown = lista[0];
    if (typeof primeiro !== "object" || primeiro === null) return null;
    return primeiro as ProdutoPublico;
  } catch {
    // Regressão do defeito original do middleware: falha NUNCA vira "produto".
    return null;
  }
}

const textoOuNulo = (valor: unknown): string | null =>
  typeof valor === "string" && valor.trim() !== "" ? valor : null;

export function montarHtml(produto: ProdutoPublico, id: string, config: HospedagemConfig): string {
  const loja = escaparHtml(config.storeName);
  const nome = escaparHtml(textoOuNulo(produto.nome) ?? `Produto - ${config.storeName}`);
  const descricao = escaparHtml(
    textoOuNulo(produto.descricao) ?? `Confira os detalhes do produto no ${config.storeName}.`,
  );
  const preco =
    typeof produto.preco_venda === "number"
      ? ` - R$ ${produto.preco_venda.toFixed(2).replace(".", ",")}`
      : "";
  const candidatas: unknown[] = Array.isArray(produto.imagem_urls)
    ? produto.imagem_urls
    : [produto.imagem_url];
  const imagemValida = candidatas.find(
    (item): item is string =>
      typeof item === "string" && item.trim() !== "" && imagemPermitida(item.trim(), config),
  );
  const imagem = escaparHtml(imagemValida?.trim() ?? `${config.publicUrl}/og-image.png`);
  const url = escaparHtml(`${config.publicUrl}/product-detail?id=${encodeURIComponent(id)}`);
  return [
    "<!DOCTYPE html>",
    '<html lang="pt-BR">',
    "<head>",
    '<meta charset="UTF-8">',
    `<title>${nome} | ${loja}</title>`,
    `<meta name="description" content="${descricao}">`,
    `<meta property="og:title" content="${nome}${escaparHtml(preco)}">`,
    `<meta property="og:description" content="${descricao}">`,
    '<meta property="og:type" content="product">',
    `<meta property="og:url" content="${url}">`,
    `<meta property="og:image" content="${imagem}">`,
    '<meta property="og:image:width" content="600">',
    '<meta property="og:image:height" content="400">',
    '<meta name="twitter:card" content="summary_large_image">',
    `<meta name="twitter:title" content="${nome}">`,
    `<meta name="twitter:description" content="${descricao}">`,
    `<meta name="twitter:image" content="${imagem}">`,
    "</head>",
    "<body>",
    `<h1>${nome}</h1>`,
    `<p>${descricao}</p>`,
    `<img src="${imagem}" alt="${nome}">`,
    "</body>",
    "</html>",
  ].join("\n");
}

function comCarimbo(cabecalhos: Headers, config: HospedagemConfig, motivo: MotivoOg): Headers {
  cabecalhos.set("x-ikcous-og", motivo);
  cabecalhos.set("x-ikcous-delivery", config.deliveryVersion);
  return cabecalhos;
}

// O documento da loja é pedido explicitamente na raiz ao serviço de arquivos;
// a URL que o navegador vê não muda (o A7a3 provou: sem Location, query e
// fragmento preservados). _redirects não rege pedidos que passam pela função.
async function documentoDaLoja(
  request: Request,
  env: AmbienteDaHospedagem,
  config: HospedagemConfig,
  motivo: MotivoOg,
): Promise<Response> {
  const raiz = new URL("/", new URL(request.url).origin);
  const origem = await env.ASSETS.fetch(
    new Request(raiz, { method: request.method, headers: request.headers }),
  );
  const cabecalhos = comCarimbo(new Headers(origem.headers), config, motivo);
  return new Response(request.method === "HEAD" ? null : origem.body, {
    status: origem.status,
    headers: cabecalhos,
  });
}

function previa(html: string, request: Request, config: HospedagemConfig): Response {
  const cabecalhos = comCarimbo(new Headers(config.cabecalhos), config, "produto");
  cabecalhos.set("content-type", "text/html; charset=utf-8");
  cabecalhos.set("Cache-Control", "no-store");
  return new Response(request.method === "HEAD" ? null : html, { status: 200, headers: cabecalhos });
}

export function criarWorker(config: HospedagemConfig, opcoes: OpcoesDoWorker = {}) {
  return {
    async fetch(request: Request, env: AmbienteDaHospedagem): Promise<Response> {
      const url = new URL(request.url);
      // _routes.json já restringe a função; conferir de novo custa nada e
      // protege contra uma regra de rota mais larga no futuro.
      if (!CAMINHOS_DE_PRODUTO.has(url.pathname)) return env.ASSETS.fetch(request);
      const robo = ehRobo(request.headers.get("user-agent"));
      if (!robo) return documentoDaLoja(request, env, config, "passa");
      const id = url.searchParams.get("id");
      if (!idValido(id) || config.conexao.kind !== "database")
        return documentoDaLoja(request, env, config, "sem-produto");
      const produto = await consultarProduto(config, id, opcoes);
      if (!produto) return documentoDaLoja(request, env, config, "sem-produto");
      return previa(montarHtml(produto, id, config), request, config);
    },
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/front/hospedagem-compartilhamento.test.ts`
Expected: todos PASS. Se o `it` do prazo falhar por o `AbortSignal.timeout` do Node não rejeitar dentro do `fetchImpl` fictício, o fictício está errado (ele precisa ouvir `abort`), não a implementação.

- [ ] **Step 6: Verificação da tarefa**

`npx tsc -b --force` (os dois arquivos entram pelo `include: ["src", "tests/front"]`; lib DOM dá `Request`/`Response`/`AbortSignal.timeout`); `npx eslint src/hospedagem/contrato.ts src/hospedagem/compartilhamento.ts tests/front/hospedagem-compartilhamento.test.ts` (0 erro; se `security/detect-object-injection` apontar algo, trocar o acesso — nunca desligar a regra); Biome LF nos 3; CRLF = 0; `npx secretlint src/hospedagem/compartilhamento.ts tests/front/hospedagem-compartilhamento.test.ts` (fixture `sb_publishable_fixture_only` e `anon.jwt.montado-em-runtime` não acordam regra). **Mutações a rodar e colar** (config `.mutante-*` na raiz do worktree, apagada depois, nunca `git add`): remover `&limit=1` → cai o teste da consulta; remover a condição `keyClass === "anon-jwt"` (Bearer sempre) → cai o do publishable; trocar `redirect: "manual"` por `"follow"` → cai o de redirecionamento se o fictício devolver 302 como `ok` (documentar se o fictício não distingue); apagar o `'` do `escaparHtml` → cai o de escape.

- [ ] **Step 7: Entregar**

Relatório `central/tarefa-A7c-T4-relatorio.md`. Root revisa com **Opus** (toca chave, consulta e HTML público) e commita `feat(tooling): worker de compartilhamento para a hospedagem em Pages`.

---

### Task 5: Compilar o worker e gravar os cinco arquivos antes do `version.json`

**Files:**
- Create: `src/hospedagem/worker.ts`
- Modify: `scripts/hospedagem.mjs` (acrescentar `configDoWorker`, `compilarWorker`, `gerarHospedagem`)
- Modify: `scripts/buildStore.mjs` — import no topo e a chamada entre `if (await statOrMissing(marker)) throw failure("MARKER_UNEXPECTED");` e `const temporary = path.join(output, \`version.json.${randomUUID()}.tmp\`);`
- Test: `tests/front/identity-build-finalization.test.ts` (novo `describe` ao fim)

**Interfaces:**
- Consumes: `capturedDelivery` (envelope congelado devolvido por `delivery()` em `buildStore.mjs:59-145`: `{ deliveryApiVersion, snapshot, publicDefines, connection }`), `output` (outDir absoluto).
- Produces: `configDoWorker(delivery, vercel): HospedagemConfig` (objeto JS congelado com a mesma forma do tipo de `src/hospedagem/contrato.ts`); `compilarWorker(config): Promise<string>`; `gerarHospedagem(outDir, delivery): Promise<readonly string[]>` (nomes gravados, na ordem).

- [ ] **Step 1: Write the failing tests** (acrescentar ao fim de `tests/front/identity-build-finalization.test.ts`; reaproveita `setup`, `databaseTransport`, `databaseOrigin`, `databasePublishable`, `databaseAnon` e `absent` já definidos no arquivo)

```ts
describe("arquivos de hospedagem (Cloudflare Pages) na finalização", () => {
  const nomes = ["_routes.json", "_redirects", "_headers", "404.html", "_worker.js"];

  it(
    "fixture: os cinco existem, fora do precache, 404 igual ao index, worker sem chave",
    async () => {
      const t = await setup([], true);
      await t.run();
      const saida = path.join(t.root, "dist-test");
      for (const nome of nomes) await fs.access(path.join(saida, nome));
      const sw = await fs.readFile(path.join(saida, "sw.js"), "utf8");
      for (const nome of nomes) expect(sw).not.toContain(nome);
      expect(sw).toContain("index.html"); // o precache continua vivo
      const indice = await fs.readFile(path.join(saida, "index.html"));
      const erro = await fs.readFile(path.join(saida, "404.html"));
      expect(erro.equals(indice)).toBe(true);
      const redirecionamentos = await fs.readFile(path.join(saida, "_redirects"), "utf8");
      expect(redirecionamentos.trimEnd().split("\n")).toHaveLength(108);
      expect(JSON.parse(await fs.readFile(path.join(saida, "_routes.json"), "utf8"))).toEqual({
        version: 1,
        include: ["/product-detail"],
        exclude: [],
      });
      const cabecalhos = await fs.readFile(path.join(saida, "_headers"), "utf8");
      expect(cabecalhos).toContain("/assets/*\n  Cache-Control: public, max-age=31536000, immutable");
      const worker = await fs.readFile(path.join(saida, "_worker.js"), "utf8");
      expect(worker).toContain('"kind":"none"');
      expect(worker).toContain("https://loja-ensaio.invalid");
      expect(worker).not.toContain("sb_publishable_");
      expect(worker).toMatch(/export\s*\{[^}]*as default\s*\}|export default/);
      const marcador = JSON.parse(await fs.readFile(t.marker, "utf8"));
      expect(Object.keys(marcador).sort()).toEqual([
        "codeSha",
        "codeVersion",
        "identityRevision",
        "promotable",
        "source",
        "version",
      ]);
    },
    60000,
  );

  it(
    "database: o worker embute a origem e a chave publishable classificada",
    async () => {
      vi.stubEnv("IKCOUS_IDENTITY_MODE", undefined);
      databaseTransport();
      const t = await setup([], true, { outDir: "dist" });
      await t.run({
        env: {
          IKCOUS_IDENTITY_MODE: undefined,
          VITE_APP_URL: "https://loja-exclusiva.invalid",
          VITE_SUPABASE_URL: databaseOrigin,
          VITE_SUPABASE_PUBLISHABLE_KEY: databasePublishable,
          VITE_SUPABASE_ANON_KEY: databaseAnon,
        },
        resolvePublicAddress: () => "https://loja-exclusiva.invalid",
      });
      const worker = await fs.readFile(path.join(t.root, "dist", "_worker.js"), "utf8");
      expect(worker).toContain(`"origin":"${databaseOrigin}"`);
      expect(worker).toContain(`"key":"${databasePublishable}"`);
      expect(worker).toContain('"keyClass":"publishable"');
      expect(worker).not.toContain(databaseAnon);
      expect(worker).toContain('"publicUrl":"https://loja-exclusiva.invalid"');
      const versao = await fs.readFile(path.join(t.root, "dist", "version.json"), "utf8");
      expect(versao).not.toContain(databasePublishable);
    },
    60000,
  );

  it(
    "falha ao gravar um arquivo de hospedagem deixa a saída sem version.json",
    async () => {
      const t = await setup([], true);
      const original = fs.writeFile;
      const espiao = vi.spyOn(fs, "writeFile").mockImplementation(async (destino, ...resto) => {
        if (String(destino).endsWith("_headers")) throw new Error("disco cheio");
        return original.call(fs, destino, ...resto);
      });
      try {
        await expect(t.run()).rejects.toThrow(/IDENTITY_HOSTING/);
      } finally {
        espiao.mockRestore();
      }
      await absent(t.marker);
      await fs.access(path.join(t.root, "dist-test", "_routes.json")); // o que veio antes ficou
    },
    60000,
  );

  it(
    "arquivo de hospedagem pré-existente na saída reprova (wx) em vez de sobrescrever",
    async () => {
      const t = await setup([], true);
      await fs.mkdir(path.join(t.root, "dist-test"), { recursive: true });
      await fs.writeFile(path.join(t.root, "dist-test", "_worker.js"), "velho");
      await expect(t.run()).rejects.toThrow(/IDENTITY_HOSTING/);
      await absent(t.marker);
    },
    60000,
  );
});
```

Conferir o **molde real** de como o arquivo já espiona `fs.writeFile`/`fs.rename` (~linhas 419-441) e seguir o mesmo mecanismo (`vi.spyOn` sobre o mesmo objeto `fs` que o `buildStore.mjs` importa). Se `setup` **não** devolver `root`, expor (`return { root, marker, run, ... }`) — ver o que ele já devolve.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/front/identity-build-finalization.test.ts -t hospedagem`
Expected: FAIL — `ENOENT` nos arquivos; os testes anteriores do arquivo continuam verdes.

- [ ] **Step 3: Write `worker.ts`**

```ts
// src/hospedagem/worker.ts
// Entrada do _worker.js. A configuração pública é injetada pelo esbuild na
// finalização do build (scripts/hospedagem.mjs); nada aqui lê ambiente.
import { criarWorker } from "./compartilhamento";
import type { HospedagemConfig } from "./contrato";

declare const __IKCOUS_HOSPEDAGEM__: HospedagemConfig;

export default criarWorker(__IKCOUS_HOSPEDAGEM__);
```

- [ ] **Step 4: Acrescentar ao `scripts/hospedagem.mjs`**

```js
const ENTRADA_DO_WORKER = fileURLToPath(
  new URL("../src/hospedagem/worker.ts", import.meta.url),
);

export function configDoWorker(delivery, vercel) {
  const { snapshot, connection } = delivery;
  const conexao =
    connection.kind === "database"
      ? {
          kind: "database",
          origin: connection.origin,
          key: connection.key,
          keyClass: connection.keyClass,
        }
      : { kind: "none" }; // fixture-none E fixture-synthetic: nunca sair para a rede
  return Object.freeze({
    versao: 1,
    publicUrl: snapshot.publicUrl,
    storeName: snapshot.identity.storeName,
    conexao,
    hostsDeImagem: hostsDeImagem(vercel),
    cabecalhos: cabecalhosDeFuncao(vercel),
    deliveryVersion: snapshot.deliveryVersion,
  });
}

// esbuild já vem com o Vite; compila TS e embute a config como constante JSON.
export async function compilarWorker(config) {
  const { build } = await import("esbuild");
  const resultado = await build({
    entryPoints: [ENTRADA_DO_WORKER],
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: "es2022",
    logLevel: "silent",
    define: { __IKCOUS_HOSPEDAGEM__: JSON.stringify(config) },
    banner: { js: `// IKCOUS hospedagem ${config.deliveryVersion}` },
  });
  if (resultado.errors.length > 0 || resultado.outputFiles?.length !== 1)
    throw new Error("HOSTING_WORKER_BUILD");
  return resultado.outputFiles[0].text;
}

// Depois do precache (closeBundle do PWA já fechou) e ANTES do version.json:
// qualquer falha aqui deixa a saída sem marcador. Só escreve no outDir.
export async function gerarHospedagem(outDir, delivery) {
  const vercel = lerVercel();
  const indice = await fs.readFile(path.join(outDir, "index.html"));
  const config = configDoWorker(delivery, vercel);
  const arquivos = [
    ["_routes.json", routes()],
    ["_redirects", redirects()],
    ["_headers", headers(vercel)],
    ["404.html", indice],
    ["_worker.js", await compilarWorker(config)],
  ];
  for (const [nome, conteudo] of arquivos) {
    const destino = path.join(outDir, nome);
    await fs.writeFile(destino, conteudo, { flag: "wx" });
    const relido = await fs.readFile(destino);
    if (!relido.equals(Buffer.from(conteudo)))
      throw new Error(`HOSTING_WRITE_MISMATCH ${nome}`);
  }
  return Object.freeze(arquivos.map(([nome]) => nome));
}
```

Conferido no HEAD: `buildStore.mjs:3` é `import fs from "node:fs/promises"`, e os espiões existentes do teste (`identity-build-finalization.test.ts:349,425,432`) fazem `vi.spyOn(fs, "writeFile"|"rename")` sobre esse mesmo default export. Por isso `hospedagem.mjs` usa exatamente `import fs from "node:fs/promises"` (Task 3) — com outro import o teste de falha não intercepta. `setup()` devolve `{ root, marker, options, run }` (`:114-118`).

- [ ] **Step 5: Ligar no `buildStore.mjs`**

Import (junto dos outros do topo):

```js
import { gerarHospedagem } from "./hospedagem.mjs";
```

Entre `if (await statOrMissing(marker)) throw failure("MARKER_UNEXPECTED");` e `const temporary = …`:

```js
  // Arquivos da hospedagem (Pages) entram depois do precache — o closeBundle
  // do PWA já rodou dentro de build() — e antes do marcador: falha aqui = saída
  // sem version.json, como qualquer falha tardia.
  try {
    await gerarHospedagem(output, capturedDelivery);
  } catch (error) {
    const razao = error instanceof Error ? error.message : String(error);
    throw failure(`HOSTING ${razao}`);
  }
```

(`failure` é `(code) => new Error(\`IDENTITY_${code}\`)`, linha 8 — a mensagem fica `IDENTITY_HOSTING HOSTING_WRITE_MISMATCH _headers`, e o CLI já imprime `IDENTITY_BUILD_FAILED`.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/front/identity-build-finalization.test.ts tests/front/identity-build-integration.test.ts tests/front/identity-build-config-delivery.test.ts tests/front/store-delivery-contract.test.ts`
Expected: todos PASS, inclusive os antigos (o `describe` novo não pode mudar os de antes).

- [ ] **Step 7: Verificação da tarefa**

`node --check scripts/hospedagem.mjs scripts/buildStore.mjs`; `npx tsc -b --force`; `npx eslint src/hospedagem/worker.ts tests/front/identity-build-finalization.test.ts`; Biome LF em todos os tocados; CRLF = 0; `npx secretlint` nos arquivos tocados. **Mutação obrigatória** (colar): comentar a chamada `gerarHospedagem` em `buildStore.mjs` → caem os 2 primeiros `it` novos; trocar `flag: "wx"` por `"w"` → cai o do pré-existente; mover a chamada para ANTES de `await build(...)` → cai o "fora do precache" (os arquivos não existem ainda → `ENOENT` de `index.html`; documentar que a ordem é protegida pelas duas pontas). Bancada A6: `node --test tests/browser-identity-app/contracts.spec.mjs` (3/3 — contrato do envelope não mudou).

- [ ] **Step 8: Entregar**

Relatório `central/tarefa-A7c-T5-relatorio.md`. Root revisa com **Opus** (toca chave e finalização do build) e commita `feat(tooling): gerar os arquivos da hospedagem em Pages antes do version.json`.

---

### Task 6: Conferência do conjunto e o kit real em fixture

**Files:** nenhum novo. Somente leitura e execução.

- [ ] **Step 1: Suíte inteira** — `npm run test:front` (esperado exit 0; anotar arquivos/testes; instabilidade de timeout nesta máquina é conhecida — repetir só o arquivo que falhar, isolado).
- [ ] **Step 2: Tipos e lint** — `npm run typecheck` (exit 0); `npx eslint src/config/rotas.ts src/hospedagem scripts/hospedagem.mjs tests/front/rotas-de-entrada.test.ts tests/front/hospedagem-*.test.ts tests/front/identity-build-finalization.test.ts src/App.tsx` (0 erro; contagem de warnings do `App.tsx` igual à de antes).
- [ ] **Step 3: Biome como o CI** — árvore LF inteira (`git -c core.autocrlf=false checkout-index -a -f --prefix=C:/Users/Gabriel/AppData/Local/Temp/lfh2/` numa pasta CURTA; `biome.json` sem `vcs`; `node_modules/.bin/biome check .` lá): erros ≤ 19 (o teto que o PR anterior abaixou) e 0 diagnósticos nos arquivos desta frente. Controle positivo na mesma rodada.
- [ ] **Step 4: Segredo** — `npx secretlint` nos arquivos novos, com controle positivo (um `sb_secret_` de 16+ num arquivo temporário fora do repo tem de acusar).
- [ ] **Step 5: Kit real em fixture** — `node tests/identity-real-kit-build/run.mjs` (fixture, `vite.config.ts` real, sem rede/Chrome/.env; só `.env.example` presente — a correção (3) do diretor do A7b2 vale aqui: as guardas novas rodam com a config real). Esperado: `A6B_PASS ikcous: 7 paths; 6 essential paths; fixture; promotable=false` e o mesmo para savy; o `dist-test` final tem os cinco arquivos e o `version.json` com 6 campos; `sources changed during build` NÃO dispara.
- [ ] **Step 6: Registrar** — `central/tarefa-A7c-T6-conferencia.md` com todas as saídas. Nenhum commit.

---

### Task 7: Ensaio no runtime congelado do A7a2 com o `dist-test` real (opt-in, fora do CI)

**Files:**
- Create: `tests/hospedagem-pages/run.mjs`, `tests/hospedagem-pages/README.md`
- Read first: `C:/Users/Gabriel/recuperacao-ikcous/20260909-ecossistema/controle/pages-rotas-explicitas-20260909-a7a3-36f2/measure.py`, `verify.py` (a matriz aprovada), e `…/pages-rotas-20260909-a7a2-91de/runtime/` (Wrangler 4.130.0 congelado; Node 24.19.0 embarcado). Nada disso entra no repositório.

**Interfaces:** o bench lê `IKCOUS_PAGES_RUNTIME` (pasta do runtime congelado) e `IKCOUS_PAGES_DIST` (o `dist-test` gerado pela Task 6); sem as duas variáveis, sai com `HOSPEDAGEM_PAGES_SKIPPED` e código 0.

- [ ] **Step 1: Escrever o README** com: o que o bench prova (as 109 entradas GET/HEAD com 200 e sem `Location`; as 5 classes de query preservadas; `/missing.js`, `/assets/missing.js`, `/store-identity/v1/inexistente/logo.svg` com 404 e `no-store`; `/catalogo/rota-profunda` e `/product-detail-extra` com 404 e o documento da loja; a função invocada SÓ em `/product-detail` e `/product-detail/` — medido pelo cabeçalho `x-ikcous-og`, que o worker real emite, e por ausência dele em todas as outras respostas; `_headers` em vigor: `/assets/*` immutable, `/version.json` no-store; robô com id UUID no fixture recebe `sem-produto` e o documento da loja, sem tráfego externo), o que NÃO prova (CDN, conta, banco real, atualização do app instalado — o worker em fixture nunca consulta), e como rodar.
- [ ] **Step 2: Escrever `run.mjs`**: sobe `wrangler pages dev <dist>` pelo caminho explícito do runtime congelado, com o mesmo ambiente de lista permitida do A7a3 (`environment-allowlist.json` como molde: perfil/config/cache/temp próprios, `send_metrics: false`, sem token), espera `READY`, roda a matriz por `fetch` local, grava `responses.json` e `checks.json` numa pasta nova em `central/controle/tarefa-A7c-<runId>/`, encerra o processo pelo PID e confere a porta fechada. Reprovação de qualquer check = exit 1 com a lista.
- [ ] **Step 3: Rodar** com o `dist-test` da Task 6. Esperado: `HOSPEDAGEM_PAGES_PASS checks=<n> rejections=0`. Se reprovar, o relatório negativo é resultado válido: **não** afrouxar check para passar; devolver ao root com a lista.
- [ ] **Step 4: Verificação** — `node --check`; Biome LF; CRLF = 0; nenhum processo próprio vivo ao final (`Get-CimInstance Win32_Process` filtrando `workerd|wrangler` com o runId).
- [ ] **Step 5: Entregar** — `central/tarefa-A7c-T7-relatorio.md`. Root revisa (Sonnet: bancada) e commita `test(tooling): ensaio opt-in da hospedagem em Pages sobre a entrega real`.

---

### Task 8: `diretor` — o conjunto ainda é o pedido?

Root despacha o `diretor` (Opus) com: o pedido original do Gabriel (seção "O que Gabriel quer" de `central/CONTINUAR-NO-CLAUDE-CODE.md`), as três decisões do sócio, a spec, este plano, os relatórios T1–T7 e os pareceres, e as perguntas: (a) os cinco arquivos nascem da MESMA entrega e do MESMO contrato que o app usa, sem ler ambiente? (b) nada entrou no precache, no `index.html`, no SW ou no `version.json`? (c) o worker é invocado só nas duas formas de produto, medido no runtime e não deduzido? (d) a chave embutida é a pública já presente no bundle, classificada, e publishable não virou Bearer? (e) o que continua NÃO provado (banco real, CDN, conta, atualização do app instalado) está escrito onde o Gabriel vai ler? (f) nenhum "provado" é mais velho que o código que cobre? Veredito `SEGUE`/`CORRIGE`/`PARA`; decisão do root; relatório leigo ao Gabriel.

---

## Self-review (feito ao escrever)

- **Cobertura da spec:** §3 arquitetura → T2/T3/T5; §4 os cinco arquivos → T2 (`_routes.json`, `_redirects`), T3 (`_headers`), T5 (`404.html`, `_worker.js`); §5 config → T4 (`contrato.ts`) + T5 (`configDoWorker`); §6 comportamento do worker → T4; §7 invariantes → T5 (falha bloqueia marcador, `wx`, releitura) e T6 (`sources changed`); §8 testes → T1–T5 + mutações, T6 kit real, T7 runtime; §10 fora de escopo → respeitado (nenhuma tarefa toca `vercel.json`, `middleware.ts`, SW).
- **Consistência de nomes:** `TELAS_DE_ENTRADA`/`telasDeEntrada`; `formasDeEntrada`, `redirects`, `routes`, `lerVercel`, `headers`, `cabecalhosDeFuncao`, `hostsDeImagem`, `configDoWorker`, `compilarWorker`, `gerarHospedagem`; `criarWorker(config, { fetchImpl, prazoMs })`; `HospedagemConfig.conexao.kind` ∈ `database|none`; erro do build `IDENTITY_HOSTING …`.
- **Pontos que o executor deve conferir no código real antes de copiar:** o import de `fs` em `buildStore.mjs` (promises ou não) para o espião do teste funcionar; o que `setup()` devolve; a assinatura de `it.each` com timeout no vitest 4 (terceiro argumento numérico, como já usado em `:148`).
