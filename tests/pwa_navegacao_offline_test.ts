// RÉGUA DE REGRESSÃO DA PWA (laudo ofensiva 3108, achados N4 e N5).
//
// N4: o ramo de navegação do service worker era network-first com o
// fetch() DENTRO do respondWith — offline, tela branca com todos os
// subrecursos em net::ERR_FAILED, 3 reproduções em build de produção. A
// cura é a ORDEM das chamadas dentro do ramo: `caches.match` ANTES de
// `fetch(`. Sabotar de volta (trocar a ordem) reabre a tela branca com a
// bateria verde — por isso a ordem é asserção, não comentário.
//
// N5: o silent-guardian apagava TODOS os caches, desregistrava TODOS os
// service workers e forçava reload com parâmetro de purge na primeira
// visita de cada cliente. Após o conserto, nenhum destes movimentos pode
// voltar ao arquivo.
import { fromFileUrl } from "https://deno.land/std@0.177.0/path/mod.ts";
import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const DIR = fromFileUrl(new URL(".", import.meta.url));
const sw = Deno.readTextFileSync(`${DIR}../src/sw/sw.ts`);
const guardian = Deno.readTextFileSync(`${DIR}../public/silent-guardian.js`);

const norm = (s: string) => s.replace(/\s+/g, " ");

Deno.test("SW - o ramo de navegacao procura o cache ANTES de falar com a rede", () => {
  const inicio = sw.indexOf('event.request.mode === "navigate"');
  assert(inicio > -1, "ramo de navegacao sumiu do sw.ts");
  const fim = sw.indexOf("// Se for Supabase");
  const trecho = norm(sw.slice(inicio, fim));
  const posCache = trecho.indexOf("caches.match(event.request)");
  const posRede = trecho.indexOf("fetch(event.request)");
  assert(posCache > -1, "navegacao deixou de olhar o cache");
  assert(posRede > -1, "navegacao deixou de falar com a rede");
  assert(
    posCache < posRede,
    `cache tem de vir ANTES da rede no ramo de navegacao (cache=${posCache}, rede=${posRede}) - inverter aqui e a tela branca offline de volta`,
  );
});

Deno.test("SW - a revalidacao de rede roda fora do respondWith (event.waitUntil)", () => {
  const inicio = sw.indexOf('event.request.mode === "navigate"');
  const fim = sw.indexOf("// Se for Supabase");
  assertStringIncludes(norm(sw.slice(inicio, fim)), "event.waitUntil");
});

Deno.test("SW - o fallback offline do index.html sobrevive a mudanca", () => {
  assertStringIncludes(sw, 'caches.match("/index.html")');
});

Deno.test("silent-guardian - NAO desregistra SW nem apaga caches (N5)", () => {
  assert(!guardian.includes("getRegistrations"));
  assert(!guardian.includes("caches.delete"));
});

Deno.test("silent-guardian - NAO forca reload com parametro de purge (N5)", () => {
  assert(!guardian.includes("gp_v11_4"));
  assert(!guardian.includes("location.replace"));
});

Deno.test("SW - a revalidacao NAO grava HTML novo com update pendente (ressalva 1a do #375)", () => {
  const inicio = sw.indexOf('event.request.mode === "navigate"');
  const fim = sw.indexOf("// Se for Supabase");
  const trecho = norm(sw.slice(inicio, fim));
  const posGuard = trecho.indexOf("if (sw.registration.waiting) return;");
  const posPut = trecho.indexOf("cache.put(event.request, copy)");
  assert(
    posGuard > -1,
    "a guarda de update pendente sumiu do ramo de revalidacao",
  );
  assert(posPut > -1, "o cache.put da revalidacao sumiu");
  assert(
    posGuard < posPut,
    "a guarda de waiting tem de vir ANTES do cache.put da revalidacao - sem ela, HTML novo entra no cache velho com chunks velhos (janela de ChunkLoadError)",
  );
});

Deno.test("useUpdateCheck - purge nuclear nao roda sem internet (ressalva 1b do #375)", () => {
  const u = Deno.readTextFileSync(`${DIR}../src/hooks/useUpdateCheck.ts`);
  const trecho = u.slice(u.indexOf("ChunkLoadError auto-recovery"));
  const posGuard = trecho.indexOf("navigator.onLine === false");
  const posPurge = trecho.indexOf("performNuclearPurge(true)");
  assert(
    posGuard > -1,
    "a guarda de offline sumiu do handler de ChunkLoadError",
  );
  assert(posPurge > -1);
  assert(
    posGuard < posPurge,
    "a guarda de offline tem de vir ANTES do purge nuclear - offline, o purge apagaria o cache que mantem a loja de pe",
  );
});

Deno.test("CheckoutView - o cupom revalida quando a conexao volta (ressalva 2 do #374)", () => {
  const cv = Deno.readTextFileSync(
    `${DIR}../src/views/customer/CheckoutView.tsx`,
  );
  assertStringIncludes(
    norm(cv),
    "[codigoDoCupom, subtotal, validateCoupon, isOffline]",
  );
});
