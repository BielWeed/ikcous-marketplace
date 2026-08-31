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
