# Bootstrap da identidade real de uma loja — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** uma ferramenta de linha de comando que, para UMA loja, sobe os arquivos do kit A6a para o bucket `branding`, grava a identidade por `save_store_identity` e prova pela porta do consumidor (as mesmas funcoes do build) que o build em modo `database` vai passar de `parseStoreIdentity`.

**Architecture:** logica pura + portas injetaveis em `scripts/identidadeBootstrap.ts` (kit → identidade desejada → plano → execucao com ordem fixa subir → conferir → gravar → provar); lancador `scripts/identidade-bootstrap.mjs` que empacota o `.ts` em memoria com o esbuild ja instalado (padrao do `validar.mjs` do kit) e injeta as portas reais (`pg` pela `DATABASE_URL`, CLI `supabase storage` do dono ja logado, `fetch`). Nenhuma validacao e' reimplementada: `parseStoreIdentity`, `downloadIdentityAssets` e `readPublicStoreIdentity` vem de `src/lib/`.

**Tech Stack:** Node 25 (ESM), TypeScript 5.9, vitest 4, esbuild 0.27.2 (ja instalado), `pg` (ja instalado), Supabase CLI via `npx supabase` (ja usado no repo), sharp (fixture). Nenhuma dependencia nova.

**Spec:** `docs/superpowers/specs/2026-09-10-identidade-bootstrap-design.md` (ler inteira antes). Contexto: `C:/Users/Gabriel/equipe/entregas/20260909-codex-investigacao-ikcous/central/tarefa-A10-diretor.md` e `tarefa-A10-preview-vercel-causa.md`.

## Global Constraints

- Worktree `C:/Users/Gabriel/worktrees-ikcous/app-identidade-20260909`, branch `codex/identidade-unica`. Ninguem alem do root commita; commit por caminho com `LEFTHOOK_BIN="C:/Users/Gabriel/worktrees-ikcous/app-identidade-20260909/node_modules/lefthook-windows-x64/bin/lefthook.exe"`. Proibido ao executor: `git add -A`, `stash`, `checkout`, `reset`, apagar untracked, `npm ci`/`install`, tocar `deno.lock`, ler `.env`, tocar banco ou Storage real, rodar `npm run build`.
- Escopo de commit (enum do `.commitlintrc.json`): `tooling`.
- Nenhuma credencial em log, relatorio, teste ou codigo: a ferramenta nunca imprime `DATABASE_URL` nem chave; mascarar `postgres(ql)?://[^\s]+` em qualquer erro repassado.
- Ordem de efeitos e' contrato: **subir objetos → conferir pela URL publica → gravar no banco → provar pela porta do consumidor**. Gravar antes de conferir e' defeito (a loja no ar leria logo que ainda nao existe).
- Fim de linha LF: arquivo novo escrito com `Write` → `npx biome check --write <arquivo>` e conferir `python -c "print(open(P,'rb').read().count(b'\r\n'))"` = 0.
- eslint com `eslint-plugin-security` em `.ts` novo: nada de `obj[variavel]` (usar `Map`/`.get`), nem `new RegExp(variavel)`, nem fs com caminho nao literal sem o comentario de desabilitacao que `scripts/prepareIdentity.ts` usa.
- Verificacao minima por tarefa (colar a saida): `npx vitest run tests/front/identidade-bootstrap.test.ts`; `npx tsc -b --force`; `npx eslint scripts/identidadeBootstrap.ts scripts/identidade-bootstrap.mjs tests/front/identidade-bootstrap.test.ts`; `npx biome check` nos mesmos.
- Nomes em portugues; comentarios explicam o PORQUE.

---

## Mapa de arquivos

- Create `scripts/identidadeBootstrap.ts` — tipos, `lerKit`, `montarIdentidade`, `planejar`, `executar`, `desfazer`, `lerArgumentos`, `CODIGOS_DE_SAIDA`. Sem efeito de modulo (nada roda ao importar).
- Create `scripts/identidade-bootstrap.mjs` — lancador: bundle em memoria + portas reais + relatorio + exit code.
- Create `tests/front/identidade-bootstrap.test.ts` — vitest, kit sintetico em `mkdtemp`, portas falsas.

---

### Task 1: Kit → identidade desejada → plano (puro, sem rede)

**Files:**
- Create: `scripts/identidadeBootstrap.ts`
- Test: `tests/front/identidade-bootstrap.test.ts`

**Interfaces (Produces):**

```ts
export type Loja = "ikcous" | "savy";
export interface ObjetoDoKit { readonly path: string; readonly arquivo: string; readonly sha256: string; readonly bytes: number; readonly mime: string; }
export interface Kit { readonly loja: Loja; readonly assets: BrandingAssets; readonly objetos: ReadonlyMap<string, ObjetoDoKit>; } // chave = path (v1/<sha>/<nome>)
export interface Valores { readonly store_name: string; readonly primary_color: string; readonly secondary_color: string; readonly accent_color: string; readonly store_city: string | null; readonly store_state: string | null; }
export type LinhaIdentidade = { readonly [K in "store_name"|"store_city"|"store_state"|"primary_color"|"secondary_color"|"accent_color"|"logo_url"]: string | null } & { readonly branding_assets: BrandingAssets | null };
export interface IdentidadeLida { readonly revision: string; readonly identity: LinhaIdentidade; }
export type Plano =
  | { readonly acao: "bootstrap"; readonly desired: LinhaIdentidade; readonly atual: IdentidadeLida; readonly objetos: readonly ObjetoDoKit[] }
  | { readonly acao: "nada"; readonly motivo: string }
  | { readonly acao: "recusa"; readonly motivo: string };
export class BootstrapError extends Error { readonly code: "KIT" | "VALORES" | "ESTADO" | "UPLOAD" | "CONFERENCIA" | "CONFLITO" | "PROVA"; }
export async function lerKit(dir: string, loja: Loja): Promise<Kit>;
export function montarIdentidade(kit: Kit, valores: Valores, supabaseUrl: string): LinhaIdentidade;
export function planejar(desired: LinhaIdentidade, atual: IdentidadeLida, kit: Kit): Plano;
```

- [ ] **Step 1: Escrever os testes que falham (kit sintetico)**

O kit sintetico reproduz o layout do kit A6a: `<dir>/manifesto.json` (so `{ "scope": "local-preparation" }` basta para esta ferramenta), `<dir>/<loja>/branding-assets.json` (o mapa de 8 papeis + `originals`, formato de `BrandingAssets`), `<dir>/objetos/<sha256>/<nome-original>` (bytes; um diretorio por sha, com o nome original dentro). Gere os bytes com `createIdentityBuildFixture("aurora")` de `scripts/identityBuildFixture.ts` (devolve `files[]` com `path`, `bytes`, `sha256`, `mediaType` e `identity.assets`), e grave cada `files[i].bytes` em `objetos/<sha256>/<nome-original>`.

```ts
// tests/front/identidade-bootstrap.test.ts
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createIdentityBuildFixture } from "../../scripts/identityBuildFixture";
import { BootstrapError, lerKit, montarIdentidade, planejar } from "../../scripts/identidadeBootstrap";
import type { IdentidadeLida, Valores } from "../../scripts/identidadeBootstrap";

const SUPABASE_URL = "https://abcdefghijklmnopqrst.supabase.co";
const valores: Valores = { store_name: "Loja Ensaio", primary_color: "#18181B", secondary_color: "#059669", accent_color: "#F4F4F5", store_city: null, store_state: null };
const linhaNula: IdentidadeLida = { revision: "0", identity: { store_name: null, store_city: null, store_state: null, primary_color: null, secondary_color: null, accent_color: null, logo_url: null, branding_assets: null } };

let dir: string;
async function kitSintetico(loja: "ikcous" | "savy" = "ikcous") {
  const fixture = await createIdentityBuildFixture("aurora");
  await fs.mkdir(path.join(dir, "objetos"), { recursive: true });
  await fs.mkdir(path.join(dir, loja), { recursive: true });
  await fs.writeFile(path.join(dir, "manifesto.json"), JSON.stringify({ scope: "local-preparation" }));
  await fs.writeFile(path.join(dir, loja, "branding-assets.json"), JSON.stringify(fixture.identity.assets));
  for (const file of fixture.files) await fs.writeFile(path.join(dir, "objetos", file.sha256, file.path.split("/")[2]), file.bytes);
  return fixture;
}
beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), "kit-a6-")); });
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

describe("lerKit", () => {
  it("le o mapa de papeis e resolve cada objeto pelo sha256 do path", async () => {
    const fixture = await kitSintetico();
    const kit = await lerKit(dir, "ikcous");
    expect(kit.loja).toBe("ikcous");
    expect(kit.objetos.size).toBe(new Set(fixture.files.map((f) => f.path)).size);
    const header = kit.objetos.get(fixture.identity.assets.header.path);
    expect(header?.sha256).toBe(fixture.identity.assets.header.sha256);
    expect(header?.mime).toBe(fixture.identity.assets.header.media_type);
  });
  it("recusa objeto cujo conteudo nao bate com o sha256 do path", async () => {
    const fixture = await kitSintetico();
    await fs.writeFile(path.join(dir, "objetos", fixture.identity.assets.header.sha256), "corrompido");
    await expect(lerKit(dir, "ikcous")).rejects.toMatchObject({ code: "KIT" });
  });
  it("recusa loja ausente no kit", async () => {
    await kitSintetico("ikcous");
    await expect(lerKit(dir, "savy")).rejects.toMatchObject({ code: "KIT" });
  });
});

describe("montarIdentidade", () => {
  it("monta a linha com logo_url apontando para o header no bucket branding e passa no parseStoreIdentity do build", async () => {
    const fixture = await kitSintetico();
    const kit = await lerKit(dir, "ikcous");
    const linha = montarIdentidade(kit, valores, SUPABASE_URL);
    expect(linha.logo_url).toBe(`${SUPABASE_URL}/storage/v1/object/public/branding/${fixture.identity.assets.header.path}`);
    expect(linha.store_name).toBe("Loja Ensaio");
    expect(linha.store_city).toBeNull();
    expect(Object.keys(linha).sort()).toEqual(["accent_color","branding_assets","logo_url","primary_color","secondary_color","store_city","store_name","store_state"]);
  });
  it("recusa valores que o build recusaria (primaria preta, nome vazio)", async () => {
    await kitSintetico();
    const kit = await lerKit(dir, "ikcous");
    expect(() => montarIdentidade(kit, { ...valores, primary_color: "#000000" }, SUPABASE_URL)).toThrow(BootstrapError);
    expect(() => montarIdentidade(kit, { ...valores, store_name: "   " }, SUPABASE_URL)).toThrowError(expect.objectContaining({ code: "VALORES" }));
  });
});

describe("planejar", () => {
  it("banco toda NULL -> bootstrap com todos os objetos unicos do kit", async () => {
    await kitSintetico();
    const kit = await lerKit(dir, "ikcous");
    const desired = montarIdentidade(kit, valores, SUPABASE_URL);
    const plano = planejar(desired, linhaNula, kit);
    expect(plano.acao).toBe("bootstrap");
    if (plano.acao === "bootstrap") expect(plano.objetos.map((o) => o.path).sort()).toEqual([...kit.objetos.keys()].sort());
  });
  it("banco identico ao desejado -> nada", async () => {
    await kitSintetico();
    const kit = await lerKit(dir, "ikcous");
    const desired = montarIdentidade(kit, valores, SUPABASE_URL);
    expect(planejar(desired, { revision: "7", identity: desired }, kit).acao).toBe("nada");
  });
  it("banco com identidade diferente -> recusa (nunca sobrescreve)", async () => {
    await kitSintetico();
    const kit = await lerKit(dir, "ikcous");
    const desired = montarIdentidade(kit, valores, SUPABASE_URL);
    const outra = { revision: "3", identity: { ...linhaNula.identity, store_name: "Outra Loja" } };
    expect(planejar(desired, outra, kit)).toMatchObject({ acao: "recusa" });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/front/identidade-bootstrap.test.ts`
Expected: FAIL por modulo `../../scripts/identidadeBootstrap` inexistente.

- [ ] **Step 3: Implementar `scripts/identidadeBootstrap.ts` (parte pura)**

```ts
/* eslint-disable security/detect-non-literal-fs-filename -- Caminhos vem do kit local validado por sha256; nenhum vem de rede. */
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { IdentityError, identityAssetDescriptors, normalizeSupabaseOrigin, parseBrandingAssets, parseStoreIdentity } from "../src/lib/storeIdentity";
import type { BrandingAssets } from "../src/lib/storeIdentity";

export type Loja = "ikcous" | "savy";
export interface ObjetoDoKit { readonly path: string; readonly arquivo: string; readonly sha256: string; readonly bytes: number; readonly mime: string; }
export interface Kit { readonly loja: Loja; readonly assets: BrandingAssets; readonly objetos: ReadonlyMap<string, ObjetoDoKit>; }
export interface Valores { readonly store_name: string; readonly primary_color: string; readonly secondary_color: string; readonly accent_color: string; readonly store_city: string | null; readonly store_state: string | null; }
type Textual = "store_name" | "store_city" | "store_state" | "primary_color" | "secondary_color" | "accent_color" | "logo_url";
export type LinhaIdentidade = { readonly [K in Textual]: string | null } & { readonly branding_assets: BrandingAssets | null };
export interface IdentidadeLida { readonly revision: string; readonly identity: LinhaIdentidade; }
export type Plano =
  | { readonly acao: "bootstrap"; readonly desired: LinhaIdentidade; readonly atual: IdentidadeLida; readonly objetos: readonly ObjetoDoKit[] }
  | { readonly acao: "nada"; readonly motivo: string }
  | { readonly acao: "recusa"; readonly motivo: string };
export type CodigoErro = "KIT" | "VALORES" | "ESTADO" | "UPLOAD" | "CONFERENCIA" | "CONFLITO" | "PROVA";
export class BootstrapError extends Error {
  constructor(readonly code: CodigoErro, message: string) { super(message); this.name = "BootstrapError"; }
}
const LOJAS: ReadonlySet<string> = new Set(["ikcous", "savy"]);
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
// jsonb compara por valor: a ordem das chaves e' irrelevante no banco, mas a comparacao local usa forma canonica.
export function canonico(valor: unknown): string {
  if (Array.isArray(valor)) return `[${valor.map(canonico).join(",")}]`;
  if (valor !== null && typeof valor === "object")
    return `{${Object.entries(valor).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${JSON.stringify(k)}:${canonico(v)}`).join(",")}}`;
  return JSON.stringify(valor);
}

export async function lerKit(dir: string, loja: Loja): Promise<Kit> {
  if (!LOJAS.has(loja)) throw new BootstrapError("KIT", "loja desconhecida");
  const mapa = path.join(dir, loja, "branding-assets.json");
  let bruto: unknown;
  try { bruto = JSON.parse(await fs.readFile(mapa, "utf8")); }
  catch { throw new BootstrapError("KIT", `kit sem ${loja}/branding-assets.json`); }
  let assets: BrandingAssets;
  try { assets = parseBrandingAssets(bruto); }
  catch (error) { throw new BootstrapError("KIT", `branding-assets.json invalido: ${error instanceof IdentityError ? error.code : "?"}`); }
  const objetos = new Map<string, ObjetoDoKit>();
  for (const asset of identityAssetDescriptors(assets)) {
    if (objetos.has(asset.path)) continue;
    const arquivo = path.join(dir, "objetos", asset.sha256);
    let bytes: Uint8Array;
    try { bytes = await fs.readFile(arquivo); }
    catch { throw new BootstrapError("KIT", `objeto ausente: ${asset.sha256}`); }
    if (sha(bytes) !== asset.sha256 || bytes.length !== asset.bytes)
      throw new BootstrapError("KIT", `objeto divergente do path: ${asset.path}`);
    objetos.set(asset.path, { path: asset.path, arquivo, sha256: asset.sha256, bytes: bytes.length, mime: asset.media_type });
  }
  return { loja, assets, objetos };
}

export function montarIdentidade(kit: Kit, valores: Valores, supabaseUrl: string): LinhaIdentidade {
  const origin = normalizeSupabaseOrigin(supabaseUrl);
  const linha: LinhaIdentidade = {
    store_name: valores.store_name, store_city: valores.store_city, store_state: valores.store_state,
    primary_color: valores.primary_color, secondary_color: valores.secondary_color, accent_color: valores.accent_color,
    logo_url: `${origin}/storage/v1/object/public/branding/${kit.assets.header.path}`,
    branding_assets: kit.assets,
  };
  // A mesma guarda do build: se ela recusa aqui, o build recusaria depois de gravar.
  try { parseStoreIdentity(linha, supabaseUrl); }
  catch (error) { throw new BootstrapError("VALORES", `o build recusaria esta linha: ${error instanceof IdentityError ? error.code : "?"}`); }
  return linha;
}

const NULA = (identity: LinhaIdentidade) => Object.values(identity).every((v) => v === null);

export function planejar(desired: LinhaIdentidade, atual: IdentidadeLida, kit: Kit): Plano {
  if (canonico(atual.identity) === canonico(desired)) return { acao: "nada", motivo: `identidade ja gravada (revisao ${atual.revision})` };
  if (!NULA(atual.identity)) return { acao: "recusa", motivo: "o banco ja tem identidade diferente da desejada; esta ferramenta nunca sobrescreve" };
  return { acao: "bootstrap", desired, atual, objetos: [...kit.objetos.values()] };
}
```

- [ ] **Step 4: Rodar e ver passar; typecheck e lint**

Run: `npx vitest run tests/front/identidade-bootstrap.test.ts` → 8 passed. `npx tsc -b --force` → sem erro. `npx eslint scripts/identidadeBootstrap.ts tests/front/identidade-bootstrap.test.ts` → limpo. `npx biome check` nos dois → so CRLF, se algum.

- [ ] **Step 5: Relatorio parcial (sem commit; root commita por caminho ao fim da Task 2)**

---

### Task 2: `executar` e `desfazer` com portas injetaveis, ordem fixa e prova pelo consumidor

**Files:**
- Modify: `scripts/identidadeBootstrap.ts` (acrescentar)
- Test: `tests/front/identidade-bootstrap.test.ts` (acrescentar)

**Interfaces (Produces):**

```ts
export interface PortaBanco {
  ler(): Promise<IdentidadeLida>;                       // read_store_identity()
  gravar(expectedRevision: string, expected: LinhaIdentidade, desired: LinhaIdentidade): Promise<IdentidadeLida>; // save_store_identity; lanca BootstrapError("CONFLITO") em P0001/IDENTITY_CONFLICT
}
export interface PortaStorage {
  subir(objeto: ObjetoDoKit): Promise<void>;            // supabase storage cp
  remover(paths: readonly string[]): Promise<void>;     // supabase storage rm
}
export interface Portas { banco: PortaBanco; storage: PortaStorage; fetchImpl: typeof fetch; supabaseUrl: string; chavePublica: string; }
export interface Relatorio { readonly acao: Plano["acao"] | "desfeito"; readonly subidos: readonly string[]; readonly pulados: readonly string[]; readonly revisao: string | null; readonly prova: "ok" | "nao-rodou"; }
export async function executar(plano: Plano, portas: Portas, opcoes?: { aplicar?: boolean }): Promise<Relatorio>;
export async function desfazer(kit: Kit, valores: Valores, portas: Portas, opcoes?: { aplicar?: boolean }): Promise<Relatorio>;
```

Regras de `executar` (bootstrap):
1. Para cada objeto: `GET <origin>/storage/v1/object/public/branding/<path>` com `portas.fetchImpl`. 200 com sha igual → `pulados`; 200 com sha diferente → `BootstrapError("UPLOAD", ...)` ANTES de subir qualquer coisa; 400/404 → candidato a subir. Sem `aplicar`: parar aqui e devolver o relatorio com `revisao: null`.
2. `storage.subir` para cada candidato.
3. Conferir TODOS os objetos com `downloadIdentityAssets(parseStoreIdentity(desired, supabaseUrl), { fetchImpl })` — a funcao do build. Falha → `BootstrapError("CONFERENCIA")`, e NAO gravar.
4. `banco.gravar(atual.revision, atual.identity, desired)`; comparar `canonico(retorno.identity) === canonico(desired)` senao `BootstrapError("PROVA")`.
5. Prova final: `readPublicStoreIdentity({ supabaseUrl, publicKey: chavePublica, fetchImpl })` seguido de `downloadIdentityAssets(..., { fetchImpl })`; falha → `BootstrapError("PROVA")` (o banco JA esta gravado — o relatorio diz isso).

Regras de `desfazer`: le a atual; exige `canonico(atual.identity) === canonico(montarIdentidade(kit, valores, supabaseUrl))` senao `ESTADO`; sem `aplicar` para aqui; `banco.gravar(atual.revision, atual.identity, LINHA_NULA)`; depois `storage.remover([...kit.objetos.keys()])`. Banco primeiro, objetos depois.

- [ ] **Step 1: Testes que falham (portas falsas em memoria)**

```ts
import { downloadIdentityAssets } from "../../src/lib/publicStoreIdentity";
import { desfazer, executar } from "../../scripts/identidadeBootstrap";
import type { LinhaIdentidade, Portas, Relatorio } from "../../scripts/identidadeBootstrap";

// Servidor falso: objetos "no bucket" + a linha da view publica, tudo em memoria.
function portasFalsas(kit: Awaited<ReturnType<typeof lerKit>>, inicial: IdentidadeLida) {
  const bucket = new Map<string, { bytes: Uint8Array; mime: string }>();
  let linha = inicial;
  const chamadas: string[] = [];
  const origin = SUPABASE_URL;
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.pathname.startsWith("/storage/v1/object/public/branding/")) {
      const objeto = bucket.get(url.pathname.slice("/storage/v1/object/public/branding/".length));
      if (!objeto) return new Response("nao existe", { status: 404 });
      return new Response(objeto.bytes, { status: 200, headers: { "content-type": objeto.mime, "content-length": String(objeto.bytes.length) } });
    }
    if (url.pathname === "/rest/v1/v_store_config") {
      const { identity } = linha;
      return new Response(JSON.stringify([identity]), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response("rota inesperada " + url.pathname, { status: 500 });
  };
  const portas: Portas = {
    supabaseUrl: origin,
    chavePublica: "sb_publishable_fixture_only",
    fetchImpl,
    banco: {
      async ler() { chamadas.push("ler"); return linha; },
      async gravar(rev, expected, desired) {
        chamadas.push("gravar");
        if (rev !== linha.revision || canonico(expected) !== canonico(linha.identity)) throw new BootstrapError("CONFLITO", "IDENTITY_CONFLICT");
        linha = { revision: String(Number(linha.revision) + 1), identity: desired };
        return linha;
      },
    },
    storage: {
      async subir(objeto) { chamadas.push(`subir:${objeto.path}`); bucket.set(objeto.path, { bytes: await fs.readFile(objeto.arquivo), mime: objeto.mime }); },
      async remover(paths) { chamadas.push(`remover:${paths.length}`); for (const p of paths) bucket.delete(p); },
    },
  };
  return { portas, bucket, chamadas, linha: () => linha };
}

describe("executar", () => {
  it("sem --aplicar nao chama nenhuma porta de escrita", async () => {
    await kitSintetico(); const kit = await lerKit(dir, "ikcous");
    const desired = montarIdentidade(kit, valores, SUPABASE_URL);
    const f = portasFalsas(kit, linhaNula);
    const r = await executar(planejar(desired, linhaNula, kit), f.portas);
    expect(r.revisao).toBeNull();
    expect(f.chamadas.filter((c) => c.startsWith("subir") || c === "gravar" || c.startsWith("remover"))).toEqual([]);
  });
  it("ordem: sobe -> confere -> grava -> prova; devolve revisao nova", async () => {
    await kitSintetico(); const kit = await lerKit(dir, "ikcous");
    const desired = montarIdentidade(kit, valores, SUPABASE_URL);
    const f = portasFalsas(kit, linhaNula);
    const r = await executar(planejar(desired, linhaNula, kit), f.portas, { aplicar: true });
    expect(r.acao).toBe("bootstrap"); expect(r.revisao).toBe("1"); expect(r.prova).toBe("ok");
    expect(r.subidos.length).toBe(kit.objetos.size);
    const idxGravar = f.chamadas.indexOf("gravar");
    expect(f.chamadas.slice(0, idxGravar).filter((c) => c.startsWith("subir")).length).toBe(kit.objetos.size);
    expect(canonico(f.linha().identity)).toBe(canonico(desired));
  });
  it("objeto ja no bucket com o mesmo sha e' pulado; com sha diferente recusa antes de subir", async () => {
    await kitSintetico(); const kit = await lerKit(dir, "ikcous");
    const desired = montarIdentidade(kit, valores, SUPABASE_URL);
    const header = kit.objetos.get(kit.assets.header.path)!;
    const f = portasFalsas(kit, linhaNula);
    f.bucket.set(header.path, { bytes: await fs.readFile(header.arquivo), mime: header.mime });
    const r = await executar(planejar(desired, linhaNula, kit), f.portas, { aplicar: true });
    expect(r.pulados).toEqual([header.path]);
    const g = portasFalsas(kit, linhaNula);
    g.bucket.set(header.path, { bytes: new TextEncoder().encode("<svg/>"), mime: header.mime });
    await expect(executar(planejar(desired, linhaNula, kit), g.portas, { aplicar: true })).rejects.toMatchObject({ code: "UPLOAD" });
    expect(g.chamadas.filter((c) => c.startsWith("subir") || c === "gravar")).toEqual([]);
  });
  it("conferencia publica com MIME errado falha e NAO grava", async () => {
    await kitSintetico(); const kit = await lerKit(dir, "ikcous");
    const desired = montarIdentidade(kit, valores, SUPABASE_URL);
    const f = portasFalsas(kit, linhaNula);
    const subirOriginal = f.portas.storage.subir;
    f.portas.storage.subir = async (objeto) => { await subirOriginal(objeto); f.bucket.set(objeto.path, { ...f.bucket.get(objeto.path)!, mime: "text/plain" }); };
    await expect(executar(planejar(desired, linhaNula, kit), f.portas, { aplicar: true })).rejects.toMatchObject({ code: "CONFERENCIA" });
    expect(f.chamadas).not.toContain("gravar");
  });
  it("conflito de revisao no banco vira CONFLITO (nada mais e' feito)", async () => {
    await kitSintetico(); const kit = await lerKit(dir, "ikcous");
    const desired = montarIdentidade(kit, valores, SUPABASE_URL);
    const f = portasFalsas(kit, { ...linhaNula, revision: "5" });
    const plano = planejar(desired, linhaNula, kit); // plano lido com revisao 0; banco ja esta em 5
    await expect(executar(plano, f.portas, { aplicar: true })).rejects.toMatchObject({ code: "CONFLITO" });
  });
});

describe("desfazer", () => {
  it("exige que o banco tenha exatamente a identidade do kit; grava NULL antes de remover objetos", async () => {
    await kitSintetico(); const kit = await lerKit(dir, "ikcous");
    const desired = montarIdentidade(kit, valores, SUPABASE_URL);
    const f = portasFalsas(kit, linhaNula);
    await executar(planejar(desired, linhaNula, kit), f.portas, { aplicar: true });
    const antes = f.chamadas.length;
    const r = await desfazer(kit, valores, f.portas, { aplicar: true });
    expect(r.acao).toBe("desfeito");
    expect(Object.values(f.linha().identity).every((v) => v === null)).toBe(true);
    const depois = f.chamadas.slice(antes);
    expect(depois.indexOf("gravar")).toBeLessThan(depois.findIndex((c) => c.startsWith("remover")));
    expect(f.bucket.size).toBe(0);
  });
  it("banco com outra identidade -> ESTADO, sem escrita", async () => {
    await kitSintetico(); const kit = await lerKit(dir, "ikcous");
    const f = portasFalsas(kit, { revision: "2", identity: { ...linhaNula.identity, store_name: "Outra" } });
    await expect(desfazer(kit, valores, f.portas, { aplicar: true })).rejects.toMatchObject({ code: "ESTADO" });
    expect(f.chamadas).toEqual(["ler"]);
  });
});
```

Se `parseStoreIdentity`/`readPublicStoreIdentity` exigirem `fetch` com `redirect: "error"`/`credentials` no `Response`, o `fetchImpl` falso acima ja devolve `Response` real do Node; `readPublicStoreIdentity` valida `url.searchParams` (`select`, `id=eq.1`, `limit=2`) — o falso ignora os parametros e responde a linha, o que basta.

- [ ] **Step 2: Rodar e ver falhar** — `executar`/`desfazer` inexistentes.

- [ ] **Step 3: Implementar**

```ts
import { downloadIdentityAssets, readPublicStoreIdentity } from "../src/lib/publicStoreIdentity";
export interface PortaBanco { ler(): Promise<IdentidadeLida>; gravar(expectedRevision: string, expected: LinhaIdentidade, desired: LinhaIdentidade): Promise<IdentidadeLida>; }
export interface PortaStorage { subir(objeto: ObjetoDoKit): Promise<void>; remover(paths: readonly string[]): Promise<void>; }
export interface Portas { banco: PortaBanco; storage: PortaStorage; fetchImpl: typeof fetch; supabaseUrl: string; chavePublica: string; }
export interface Relatorio { readonly acao: Plano["acao"] | "desfeito"; readonly subidos: readonly string[]; readonly pulados: readonly string[]; readonly revisao: string | null; readonly prova: "ok" | "nao-rodou"; }
export const LINHA_NULA: LinhaIdentidade = { store_name: null, store_city: null, store_state: null, primary_color: null, secondary_color: null, accent_color: null, logo_url: null, branding_assets: null };

async function estadoNoBucket(objeto: ObjetoDoKit, portas: Portas): Promise<"ausente" | "igual" | "diferente"> {
  const origin = normalizeSupabaseOrigin(portas.supabaseUrl);
  const resposta = await portas.fetchImpl(`${origin}/storage/v1/object/public/branding/${objeto.path}`, { redirect: "error" });
  if (resposta.status === 404 || resposta.status === 400) { await resposta.body?.cancel(); return "ausente"; }
  if (!resposta.ok) throw new BootstrapError("UPLOAD", `status ${resposta.status} ao consultar ${objeto.path}`);
  const bytes = new Uint8Array(await resposta.arrayBuffer());
  return sha(bytes) === objeto.sha256 ? "igual" : "diferente";
}

async function provarPeloConsumidor(portas: Portas): Promise<void> {
  const publica = await readPublicStoreIdentity({ supabaseUrl: portas.supabaseUrl, publicKey: portas.chavePublica, fetchImpl: portas.fetchImpl });
  await downloadIdentityAssets(publica, { fetchImpl: portas.fetchImpl });
}

export async function executar(plano: Plano, portas: Portas, opcoes: { aplicar?: boolean } = {}): Promise<Relatorio> {
  if (plano.acao !== "bootstrap") return { acao: plano.acao, subidos: [], pulados: [], revisao: null, prova: "nao-rodou" };
  const pulados: string[] = []; const candidatos: ObjetoDoKit[] = [];
  for (const objeto of plano.objetos) {
    const estado = await estadoNoBucket(objeto, portas);
    if (estado === "diferente") throw new BootstrapError("UPLOAD", `objeto ${objeto.path} ja existe com conteudo diferente; path e' enderecado por conteudo`);
    (estado === "igual" ? pulados : candidatos).push(estado === "igual" ? objeto.path : (objeto as never));
  }
  if (!opcoes.aplicar) return { acao: "bootstrap", subidos: candidatos.map((o) => o.path), pulados, revisao: null, prova: "nao-rodou" };
  for (const objeto of candidatos) await portas.storage.subir(objeto);
  try { await downloadIdentityAssets(parseStoreIdentity(plano.desired, portas.supabaseUrl), { fetchImpl: portas.fetchImpl }); }
  catch (error) { throw new BootstrapError("CONFERENCIA", `objeto publico recusado pelo leitor do build: ${error instanceof IdentityError ? error.code : String(error)}`); }
  const gravado = await portas.banco.gravar(plano.atual.revision, plano.atual.identity, plano.desired);
  if (canonico(gravado.identity) !== canonico(plano.desired)) throw new BootstrapError("PROVA", "o banco devolveu identidade diferente da gravada");
  try { await provarPeloConsumidor(portas); }
  catch (error) { throw new BootstrapError("PROVA", `BANCO JA GRAVADO (revisao ${gravado.revision}); a leitura publica falhou: ${error instanceof IdentityError ? error.code : String(error)}`); }
  return { acao: "bootstrap", subidos: candidatos.map((o) => o.path), pulados, revisao: gravado.revision, prova: "ok" };
}

export async function desfazer(kit: Kit, valores: Valores, portas: Portas, opcoes: { aplicar?: boolean } = {}): Promise<Relatorio> {
  const desired = montarIdentidade(kit, valores, portas.supabaseUrl);
  const atual = await portas.banco.ler();
  if (canonico(atual.identity) !== canonico(desired)) throw new BootstrapError("ESTADO", "o banco nao tem exatamente a identidade deste kit; desfazer so' desfaz o que esta ferramenta gravou");
  if (!opcoes.aplicar) return { acao: "desfeito", subidos: [], pulados: [], revisao: null, prova: "nao-rodou" };
  const gravado = await portas.banco.gravar(atual.revision, atual.identity, LINHA_NULA);
  await portas.storage.remover([...kit.objetos.keys()]);
  return { acao: "desfeito", subidos: [], pulados: [], revisao: gravado.revision, prova: "nao-rodou" };
}
```

Atencao ao `push` com `as never` acima: escreva de forma legivel (dois `if`), o trecho e' so' para caber aqui. O `plano.objetos` do `Plano` ja carrega `ObjetoDoKit` — nao reler o kit.

- [ ] **Step 4: Rodar e ver passar; mutantes obrigatorios (colar saida)**

`npx vitest run tests/front/identidade-bootstrap.test.ts` → 15 passed. Mutante A: mover `banco.gravar` para ANTES de `downloadIdentityAssets` → o teste "MIME errado ... NAO grava" tem de cair. Mutante B: em `estadoNoBucket`, devolver `"igual"` sem comparar sha → o teste "sha diferente recusa" tem de cair. Desfazer os mutantes e rodar de novo (15 passed). `npx tsc -b --force`, eslint e biome limpos.

- [ ] **Step 5: Relatorio** — `C:/Users/Gabriel/equipe/entregas/20260909-codex-investigacao-ikcous/central/tarefa-A11-bootstrap-nucleo-relatorio.md` com RED/GREEN, mutantes, `git diff --stat` e `git diff | sha256sum`. Sem commit (root: `feat(tooling): bootstrap da identidade real de uma loja a partir do kit A6a`).

---

### Task 3: Lancador `scripts/identidade-bootstrap.mjs` com as portas reais

**Files:**
- Create: `scripts/identidade-bootstrap.mjs`
- Modify: `scripts/identidadeBootstrap.ts` (acrescentar `lerArgumentos` e `CODIGOS_DE_SAIDA`)
- Test: `tests/front/identidade-bootstrap.test.ts` (acrescentar testes de `lerArgumentos`)

**Interfaces (Produces):**

```ts
export interface Argumentos { readonly kit: string; readonly loja: Loja; readonly valores: string; readonly workdirSupabase: string; readonly aplicar: boolean; readonly desfazer: boolean; readonly saida: string | null; readonly subidos: string | null; } // saida: onde o relatorio de um --aplicar de bootstrap e' gravado (obrigatorio nesse ramo); subidos: relatorio de um --aplicar anterior, de onde o lancador le .subidos para virar removerPaths de desfazer()
export function lerArgumentos(argv: readonly string[]): Argumentos; // lanca BootstrapError("VALORES") em falta/duplicata/flag desconhecida
export const CODIGOS_DE_SAIDA: Readonly<Record<"ok" | "recusa" | "upload" | "conflito" | "entrada" | "inesperado" | "prova", number>> = { ok: 0, inesperado: 1, recusa: 2, upload: 3, conflito: 4, entrada: 5, prova: 6 }; // achado C3 da revisao A11: PROVA (banco JA gravado) nunca pode sair como UPLOAD/CONFERENCIA
```

Uso: `node scripts/identidade-bootstrap.mjs --kit <dir> --loja ikcous|savy --valores <json> --workdir-supabase <dir linkado> [--desfazer [--subidos <arquivo>]] [--aplicar [--saida <arquivo>]]`. `--aplicar` e `--desfazer` sao independentes: a MESMA regra do bootstrap vale para o desfazer — sem `--aplicar` e' dry-run de verdade (nada gravado nem removido), inclusive no `--desfazer`; `--desfazer --aplicar` executa (grava NULL, remove so' o que `--subidos` apontar). Ambiente obrigatorio: `DATABASE_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (a hub injeta por lancador; a ferramenta nunca le `.env`).

- [ ] **Step 1: Testes de `lerArgumentos`** (3 casos: completo; `--aplicar` e `--desfazer` juntos → `{ aplicar: true, desfazer: true }` — sao independentes, a mesma regra de dry-run do bootstrap vale para o desfazer; flag desconhecida → VALORES) — adicionar ao arquivo de teste, rodar, ver falhar, implementar com um `for` sobre `argv` e um `Map` de flags, rodar e ver passar.

- [ ] **Step 2: Escrever o lancador**

```js
#!/usr/bin/env node
// Bootstrap da identidade real de UMA loja. Empacota scripts/identidadeBootstrap.ts em memoria
// (esbuild ja instalado; padrao do validar.mjs do kit A6a) porque o Node nao roda .ts com imports
// sem extensao. Nunca imprime DATABASE_URL nem chave.
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import esbuild from "esbuild";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mascarar = (texto) => String(texto).replace(/postgres(ql)?:\/\/[^\s'"]+/g, "<url-mascarada>");

async function carregarNucleo() {
  const bundle = await esbuild.build({
    entryPoints: [path.join(raiz, "scripts", "identidadeBootstrap.ts")],
    bundle: true, write: false, platform: "node", format: "esm", target: "node22",
    external: ["@supabase/supabase-js", "zod", "sharp"],
  });
  const arquivo = path.join(raiz, "node_modules", ".identidade-bootstrap-tmp", `nucleo-${process.pid}.mjs`);
  await fs.mkdir(path.dirname(arquivo), { recursive: true });
  await fs.writeFile(arquivo, bundle.outputFiles[0].text);
  try { return await import(pathToFileURL(arquivo).href); }
  finally { await fs.rm(arquivo, { force: true }); }
}

function portaBanco(databaseUrl, nucleo) {
  return {
    async ler() { return chamar("SELECT public.read_store_identity() AS r", []); },
    async gravar(rev, expected, desired) {
      try { return await chamar("SELECT public.save_store_identity($1, $2::jsonb, $3::jsonb) AS r", [rev, JSON.stringify(expected), JSON.stringify(desired)]); }
      catch (error) {
        if (error?.code === "P0001" && /IDENTITY_CONFLICT/.test(error.message)) throw new nucleo.BootstrapError("CONFLITO", "IDENTITY_CONFLICT");
        throw error;
      }
    },
  };
  async function chamar(sql, params) {
    const { Client } = await import("pg");
    const client = new Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });
    await client.connect();
    try {
      await client.query("BEGIN");
      // is_admin() autoriza service_role/postgres pelo current_setting('role'); LOCAL morre com a transacao (pooler).
      await client.query("SET LOCAL ROLE service_role");
      const { rows } = await client.query(sql, params);
      await client.query("COMMIT");
      return rows[0].r;
    } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
    finally { await client.end(); }
  }
}

function portaStorage(workdir, nucleo) {
  const cli = (args) => {
    const r = spawnSync("npx", ["supabase", ...args, "--linked", "--experimental", "--workdir", workdir], { encoding: "utf8", shell: process.platform === "win32" });
    if (r.status !== 0) throw new nucleo.BootstrapError("UPLOAD", `supabase ${args[0]} ${args[1]} falhou: ${mascarar(r.stderr || r.stdout)}`);
    return r.stdout;
  };
  return {
    async subir(objeto) { cli(["storage", "cp", objeto.arquivo, `ss:///branding/${objeto.path}`, "--content-type", objeto.mime, "--cache-control", "public, max-age=31536000, immutable"]); },
    async remover(paths) { if (paths.length) cli(["storage", "rm", ...paths.map((p) => `ss:///branding/${p}`)]); },
  };
}

async function principal() {
  const nucleo = await carregarNucleo();
  const { BootstrapError, CODIGOS_DE_SAIDA } = nucleo;
  let argumentos;
  try { argumentos = nucleo.lerArgumentos(process.argv.slice(2)); }
  catch (error) { console.error(mascarar(error.message)); return CODIGOS_DE_SAIDA.entrada; }
  const { DATABASE_URL, VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY } = process.env;
  if (!DATABASE_URL || !VITE_SUPABASE_URL || !VITE_SUPABASE_ANON_KEY) { console.error("faltam DATABASE_URL, VITE_SUPABASE_URL ou VITE_SUPABASE_ANON_KEY no ambiente"); return CODIGOS_DE_SAIDA.entrada; }
  const portas = { banco: portaBanco(DATABASE_URL, nucleo), storage: portaStorage(argumentos.workdirSupabase, nucleo), fetchImpl: globalThis.fetch, supabaseUrl: VITE_SUPABASE_URL, chavePublica: VITE_SUPABASE_ANON_KEY };
  try {
    const kit = await nucleo.lerKit(argumentos.kit, argumentos.loja);
    const valores = JSON.parse(await fs.readFile(argumentos.valores, "utf8"));
    let relatorio;
    if (argumentos.desfazer) relatorio = await nucleo.desfazer(kit, valores, portas, { aplicar: argumentos.aplicar });
    else {
      const desired = nucleo.montarIdentidade(kit, valores, VITE_SUPABASE_URL);
      const atual = await portas.banco.ler();
      const plano = nucleo.planejar(desired, atual, kit);
      console.log(`plano: ${plano.acao}${plano.acao === "bootstrap" ? "" : ` — ${plano.motivo}`} (revisao atual ${atual.revision})`);
      if (plano.acao === "recusa") return CODIGOS_DE_SAIDA.recusa;
      relatorio = await nucleo.executar(plano, portas, { aplicar: argumentos.aplicar });
    }
    console.log(JSON.stringify({ ...relatorio, modo: argumentos.aplicar ? "APLICADO" : "DRY-RUN (nada gravado)" }, null, 2));
    return CODIGOS_DE_SAIDA.ok;
  } catch (error) {
    if (error instanceof BootstrapError) {
      console.error(`${error.code}: ${mascarar(error.message)}`);
      return error.code === "CONFLITO" ? CODIGOS_DE_SAIDA.conflito : error.code === "ESTADO" ? CODIGOS_DE_SAIDA.recusa : error.code === "PROVA" ? CODIGOS_DE_SAIDA.prova : ["UPLOAD", "CONFERENCIA"].includes(error.code) ? CODIGOS_DE_SAIDA.upload : CODIGOS_DE_SAIDA.entrada;
    }
    console.error("inesperado:", mascarar(error?.stack ?? error));
    return CODIGOS_DE_SAIDA.inesperado;
  }
}
process.exitCode = await principal();
```

Confira antes de fixar: (a) o `external` do esbuild — `@supabase/supabase-js` e `zod` sao dependencias do app e resolvem de `node_modules` em runtime; (b) se `readPublicStoreIdentity` importar algo que o bundle `platform: node` nao aceite, mover o item para `external`; (c) o arquivo temporario fica em `node_modules/.identidade-bootstrap-tmp/` (ignorado pelo git) e e' removido no `finally`; (d) o `spawnSync` de `npx` no Windows exige `shell: true`; nunca passar a URL do banco por argumento.

- [ ] **Step 3: Prova sem rede do lancador** — `node --check scripts/identidade-bootstrap.mjs`; `node scripts/identidade-bootstrap.mjs` sem argumentos → exit 5 com a mensagem de uso; com argumentos mas sem `DATABASE_URL` → exit 5. Colar as saidas. NAO rodar com banco real: isso e' da hub.

- [ ] **Step 4: Lint/typecheck/biome nos tres arquivos; relatorio** `central/tarefa-A11-bootstrap-lancador-relatorio.md`. Sem commit.

---

### Task 4: Conferir o conjunto (`diretor`, depois da prova viva pela hub)

Entrada: este plano, a spec, os relatorios A11, a revisao Opus (Task 2 e 3 sao dado de cliente + producao + Storage: Opus obrigatorio), a saida do `--dry-run` nas duas lojas, a decisao do `socio`/Gabriel sobre os valores, e — depois de `--aplicar` — a fotografia `read_store_identity()` de cada loja, o build local com o env POBRE do preview passando de `parseStoreIdentity` (`dist/version.json` com `source: database`), e o status da Vercel no SHA do topo.

Perguntas: (a) a identidade gravada em cada loja e' byte a byte o kit revisado (A6a) e os valores aprovados? (b) o que o cliente da loja no ar viu mudar (medir `curl` da vitrine e do `/version.json` antes/depois; o front 1.26.0 le do banco por realtime)? (c) o preview da Vercel ficou verde no SHA do topo — e se nao, a falha e' DEPOIS de `parseStoreIdentity` (conserto nesta branch) ou ainda antes? (d) o que fica sem prova (ramo publishable so' em producao; Savy publica pelo clone). Veredito SEGUE / CORRIGE / PARA; com SEGUE, o passo seguinte e' `gh pr merge 522 --merge`.
