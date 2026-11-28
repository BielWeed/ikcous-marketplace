/**
 * SW v29 — THE PHOENIX: ANTI-ZOMBIE PROTOCOL
 * Estratégia Nuclear de Cache e Revalidação.
 */

import type { FichaDaLoja } from "../config/fichaDaLojaContract";
import {
  BADGE_NEUTRO,
  CAMINHO_IDENTIDADE_JSON,
  FICHA_DA_LOJA_ID,
} from "../config/fichaDaLojaContract";
import {
  TIPO_ABRIR_PEDIDO_DO_AVISO,
  decidirToqueNoAviso,
} from "../lib/alvo-do-aviso";
import {
  TIPO_PURGAR_ARQUIVOS_PRIVADOS,
  ehArquivoPublicoDoStorage,
} from "../lib/arquivo-publico-do-storage";
import { TIPO_LOJA_FECHADA } from "../lib/aviso-da-loja-fechada";
import {
  avisoMaisNovoQue,
  carimboDoAviso,
} from "../lib/ordem-do-aviso-do-pedido";
import { TIPO_INSCRICAO_DE_PUSH_TROCOU } from "../lib/troca-da-inscricao-de-push";

const sw = self as any;

// Com um único build para toda a frota (etapa 2 da escala, 11/09/2026), o SW
// não tem `document` e não recebe `__STORE_IDENTITY__` por loja — a ficha da
// loja (marca + conexão) chega pelo mesmo JSON que o porteiro serve em
// CAMINHO_IDENTIDADE_JSON. Guardada aqui, num cache PRÓPRIO (nome que o
// `activate` abaixo NÃO apaga), para o `push` ler sem depender do build.
const IDENTIDADE_CACHE_NAME = "ikcous-identidade";

// ETAPA 3 da escala (11/09/2026, ADENDO A.8): o ícone de ÚLTIMO RECURSO
// deixou de vir de `__STORE_IDENTITY__` — aquele define é o build ASSADO da
// loja de UM projeto (etapa 1); num build ÚNICO compartilhado por N lojas
// (etapa 2), `__STORE_IDENTITY__` é o ícone de QUALQUER UMA delas (hoje, o
// da principal), nunca de ninguém em especial — servir esse ícone para uma
// notificação da Savy antes da ficha chegar ao cache seria mostrar a marca
// ERRADA. Em vez disso, um ícone NEUTRO do build.
//
// CORREÇÃO (rodada 1 desta etapa, achado do revisor): `public/icons/` — a
// FONTE no repositório — tem 5 arquivos, mas `scripts/prepareIdentity.ts`
// aposenta 3 deles (`icon-192x192.png`, `icon-512x512.png`,
// `icon-maskable-512x512.png`, ver `retiredPaths`) do `public/` que vira o
// build publicado: pedir um desses ao vivo cai no catch-all do `vercel.json`
// e devolve `/index.html` (200 text/html) em vez de imagem — notificação sem
// ícone. Medido nesta branch (`dist-test/icons`) e em produção
// (`GET /icons/icon-192x192.png` → 200 text/html). Só sobrevivem ao build
// `cart-96x96.png` e `heart-96x96.png` (medidos 200 image/png); SVG fica de
// fora de `showNotification` por inconsistência entre navegadores. Por isso
// o literal abaixo tem de sobreviver ao preparo — nunca um dos 3
// aposentados. O badge tem PNG próprio branco/alpha, também preservado.
// Continua sendo só o ÚLTIMO recurso: `resolverIconesDaLoja` abaixo sempre
// prefere a ficha da loja quando ela já está em cache.
const ICONE_ASSADO = "/icons/heart-96x96.png";

// A variável __APP_VERSION__ é injetada pelo Vite (definida em vite.config.ts)
declare const __APP_VERSION__: string;
const getVersion = () => {
  try {
    return __APP_VERSION__;
  } catch {
    return "fallback";
  }
};
const CACHE_NAME = `app-cache-${getVersion()}`;
const IMAGE_CACHE_NAME = "supabase-images-cache";
const MAX_IMAGE_ENTRIES = 100;

/**
 * Apaga da gaveta de imagens tudo que não é arquivo PÚBLICO do Storage (R12,
 * 04/10/2026). Duas portas chamam: o `activate` (limpa o que versões antigas
 * do SW guardaram — elas aceitavam endereço assinado e download autenticado)
 * e a mensagem de logout (`TIPO_PURGAR_ARQUIVOS_PRIVADOS`). Idempotente: rodar
 * de novo sobre a gaveta já limpa não apaga nada. Nunca rejeita — falha de
 * disco aqui não pode derrubar o `activate` nem virar unhandled rejection.
 */
async function purgarArquivosPrivadosDaGaveta(): Promise<void> {
  try {
    const cache = await caches.open(IMAGE_CACHE_NAME);
    const chaves = await cache.keys();
    for (const chave of chaves) {
      // Decide pelo Request INTEIRO, não só pela URL: o SW antigo também
      // gravava pedido de caminho público feito com `Authorization: Bearer`
      // (download do supabase-js), e o Cache devolve esse header em `keys()`.
      let manter = false;
      try {
        manter =
          ehArquivoPublicoDoStorage(new URL(chave.url)) &&
          !chave.headers.has("authorization");
      } catch {
        manter = false;
      }
      if (!manter) await cache.delete(chave);
    }
  } catch (e) {
    console.warn("[SW] Falha ao purgar arquivos privados da gaveta:", e);
  }
}

// self.__WB_MANIFEST is the injection point for the precache manifest
// We must include it even if we handle caching manually to satisfy Workbox.
//
// O manifesto NÃO leva o painel da lojista (lote 252, 28/10/2026): o build
// tira dele, pelo mesmo critério do portão de tamanho, tudo que só o painel
// usa (telas, gráficos, leitor de código de barras e seu .wasm). O Balcão não
// precisa funcionar sem internet (decisão do dono), então esses arquivos vão
// pela rede: o ramo "3. STALE-WHILE-REVALIDATE" do `fetch`, mais abaixo, os
// busca e os guarda na primeira vez que a lojista os pede. Visitante que só
// compra nunca os baixa.
declare const self: any;
const precacheManifest = self.__WB_MANIFEST || [];
console.log("[SW] Precache Manifest received:", precacheManifest.length);

/** Prazo dos pedidos de rede feitos no `activate`: enquanto ele não termina, o
 * navegador segura as requisições da página (a recarga incluída). Também é o
 * prazo da navegação a uma rota nunca visitada antes de abrir o app guardado
 * (`redeOuAppGuardado`). */
const PRAZO_DA_REDE_NO_SW_MS = 5000;

/** `AbortSignal.timeout` só existe a partir do iOS 16 / Safari 16. */
function sinalComPrazo(ms: number): AbortSignal {
  if (typeof AbortSignal.timeout === "function") return AbortSignal.timeout(ms);
  const controle = new AbortController();
  setTimeout(() => controle.abort(), ms);
  return controle.signal;
}

const urlsDoPrecache = Array.from(
  new Set(precacheManifest.map((entry: any) => entry.url)),
) as string[];

/** O caminho (sem host nem busca) com que o Cache Storage guarda um arquivo
 * do precache — a comparação entre "o que devia estar" e "o que está". */
function caminhoDoPrecache(url: string): string {
  return new URL(url, sw.location.origin).pathname;
}

/**
 * O NÚCLEO do precache (plano "a primeira visita deixa de baixar o app
 * inteiro", 26/11/2026). Cada arquivo que o `install` baixa é um pedido que a
 * Vercel conta (no Hobby, 1 milhão no mês estourado pausa o projeto e tira
 * TODAS as lojas do ar), e o app inteiro são ~140 arquivos no primeiro acesso
 * de todo visitante — inclusive de quem nunca volta. O build marca com
 * `nucleo: true` o que abre a vitrine e o produto sem internet
 * (`scripts/precacheNucleo.ts`); a 1ª instalação guarda só isso, e o resto
 * entra na volta, em segundo plano (`completarOAppEmSegundoPlano`).
 *
 * Manifesto sem NENHUMA marca (build anterior a este plano, plugin desligado)
 * = lista vazia = o app inteiro, como sempre foi (falha segura).
 */
const urlsDoNucleo = Array.from(
  new Set(
    precacheManifest
      .filter((entry: any) => entry?.nucleo === true)
      .map((entry: any) => entry.url),
  ),
) as string[];

/** Arquivo cujo nome carrega o hash do conteúdo (o Vite escreve assim tudo em
 * `/assets/`): mesmo nome = mesmo conteúdo, em qualquer versão. */
function temHashNoNome(caminho: string): boolean {
  return caminho.startsWith("/assets/");
}

function ehPagina(caminho: string): boolean {
  return /\.html?$/i.test(caminho);
}

/** Os caches de OUTRA versão do app neste aparelho (numa atualização, o da
 * versão anterior). `null` quando o Cache Storage não responde. */
async function cachesDoAppAnterior(): Promise<string[] | null> {
  try {
    return (await caches.keys()).filter(
      (nome) => nome.startsWith("app-cache-") && nome !== CACHE_NAME,
    );
  } catch {
    return null;
  }
}

/**
 * O que esta versão precisa ter guardado para valer: só o núcleo na PRIMEIRA
 * instalação (nenhum app de outra versão no aparelho); o app inteiro numa
 * atualização — quem já tinha o app continua com ele inteiro, como sempre.
 * O `install` e o `activate` perguntam a mesma coisa e chegam à mesma
 * resposta sem guardar estado entre os dois (o service worker pode ser
 * encerrado no meio). Em dúvida (sem marca, Cache Storage mudo), o app inteiro.
 */
async function listaDestaVersao(): Promise<string[]> {
  if (urlsDoNucleo.length === 0) return urlsDoPrecache;
  const anteriores = await cachesDoAppAnterior();
  if (anteriores === null || anteriores.length > 0) return urlsDoPrecache;
  return urlsDoNucleo;
}

/**
 * Numa atualização, copia do cache da versão anterior o que não mudou, em vez
 * de baixar de novo: SÓ arquivo de `/assets/` com o MESMO nome (o hash no nome
 * garante o mesmo conteúdo). Arquivo sem hash no nome (`loading.css`,
 * `silent-guardian.js`, ícones) vem SEMPRE da rede: a revalidação em segundo
 * plano do `fetch` regrava no cache da versão em uso a cópia que o servidor
 * tem agora, sem olhar a revisão — o cache anterior pode guardar, com o mesmo
 * nome, o conteúdo de uma versão que nunca ativou (revisão Opus do PR #1906).
 * Nunca página (HTML). Nunca cópia que é HTML no lugar do arquivo (o catch-all
 * da hospedagem). Devolve o que copiou; qualquer falha só faz baixar da rede,
 * como antes.
 */
async function aproveitarDoAppAnterior(
  cache: Cache,
  urls: string[],
): Promise<Set<string>> {
  const copiados = new Set<string>();
  try {
    for (const nome of (await cachesDoAppAnterior()) ?? []) {
      const anterior = await caches.open(nome);
      for (const url of urls) {
        if (copiados.has(url)) continue;
        const caminho = caminhoDoPrecache(url);
        if (ehPagina(caminho) || !temHashNoNome(caminho)) continue;
        const guardado = await anterior.match(url);
        if (!guardado?.ok) continue;
        const tipo = guardado.headers?.get("content-type") ?? "";
        if (tipo.includes("text/html")) continue;
        await cache.put(url, guardado);
        copiados.add(url);
      }
    }
  } catch (e) {
    console.warn("[SW] Falha ao aproveitar o cache da versão anterior:", e);
  }
  return copiados;
}

/**
 * O app novo só vale se chegou INTEIRO (revisão da 1.5.33, 16/10/2026).
 *
 * Antes, a falha do `addAll` era engolida: o `install` terminava "com
 * sucesso" com o cache novo pela metade, e o `activate` apagava o cache da
 * versão anterior — o app que funcionava offline passava a faltar arquivo.
 * Agora o `install` FALHA se faltar qualquer arquivo: o service worker novo
 * é descartado, o antigo e o cache dele seguem valendo, e o navegador tenta
 * de novo na próxima verificação de atualização (a cada 20 minutos com o app
 * aberto).
 *
 * `addAll` é tudo-ou-nada, então uma falha PASSAGEIRA em um só arquivo
 * derrubaria o lote: antes de desistir, cada arquivo ganha uma segunda
 * chance sozinho. Medido em 16/10/2026 contra a produção da 1.5.33: os 140
 * arquivos do precache respondem 200 sem redirecionamento — um erro
 * persistente aqui é build quebrado de verdade, e ficar na versão anterior
 * é o certo.
 *
 * "Inteiro" é a lista que recebe (`listaDestaVersao`): o núcleo na 1ª
 * instalação, o app todo numa atualização. Numa atualização, o que não mudou
 * é copiado do cache anterior antes de ir à rede (`aproveitarDoAppAnterior`).
 */
async function precachearOAppInteiro(urls: string[]): Promise<void> {
  console.log(
    "[SW] Caching precache manifest URLs (deduplicated):",
    urls.length,
  );
  const jaExistia = (await caches.keys()).includes(CACHE_NAME);
  const cache = await caches.open(CACHE_NAME);
  // Atualização: o que não mudou vem do cache da versão anterior, sem rede.
  const copiados = await aproveitarDoAppAnterior(cache, urls);
  const aBaixar = urls.filter((url) => !copiados.has(url));
  let faltaram: string[] = [];
  try {
    await cache.addAll(aBaixar);
  } catch (err) {
    console.warn(
      "[SW] Precache em lote falhou; tentando arquivo a arquivo:",
      err,
    );
    await Promise.all(
      aBaixar.map((url) =>
        cache.add(url).catch(() => {
          faltaram.push(url);
        }),
      ),
    );
  }
  if (faltaram.length === 0)
    faltaram = await arquivosQueVieramComoHtml(cache, urls);
  if (faltaram.length === 0) return;
  // Cache que ESTE install criou e ficou pela metade não pode ficar visível
  // para o `caches.match` do service worker antigo.
  if (!jaExistia) {
    await caches.delete(CACHE_NAME).catch(() => false);
  }
  throw new Error(
    `[SW] Precache incompleto: faltaram ${faltaram.length} de ${urls.length} arquivos (${faltaram.slice(0, 3).join(", ")}). O app anterior continua valendo.`,
  );
}

/**
 * Arquivo que não é página mas chegou como HTML: o catch-all do `vercel.json`
 * responde 200 com o `index.html` a qualquer caminho que não existe, e o
 * `cache.add` aceita esse 200. Sem esta conferência, um `/assets/x.js`
 * ausente do deploy passaria como baixado e, offline, o navegador receberia
 * HTML no lugar do JavaScript (o app não inicia).
 */
async function arquivosQueVieramComoHtml(
  cache: Cache,
  urls: string[],
): Promise<string[]> {
  const ruins: string[] = [];
  await Promise.all(
    urls
      .filter((url) => !/\.html?$/i.test(caminhoDoPrecache(url)))
      .map(async (url) => {
        const guardado = await cache.match(url);
        const tipo = guardado?.headers?.get("content-type") ?? "";
        if (tipo.includes("text/html")) ruins.push(url);
      }),
  );
  return ruins;
}

/** O HTML só usa arquivos de `/assets/` que o precache também baixou? */
function htmlUsaSoArquivosDoPrecache(html: string, urls: string[]): boolean {
  const noPrecache = new Set(urls.map(caminhoDoPrecache));
  for (const m of html.matchAll(/(?:src|href)="(\/assets\/[^"?#]+)/g)) {
    if (!noPrecache.has(m[1])) return false;
  }
  return true;
}

/**
 * Uma atualização do app está a caminho: `waiting` (já baixada, esperando
 * ativação) ou `installing` (sendo baixada agora)? Enquanto estiver, HTML novo
 * NÃO pode entrar no cache da versão que ainda manda: ele viria com pedaços de
 * JavaScript que este cache não tem, e a rota guardada abriria quebrada sem
 * internet. Vale para as três escritas de página: revalidação, primeira
 * visita e aquecimento (caça 7, 26/10/2026; estendido em 24/11/2026).
 */
function haAtualizacaoAChegar(): boolean {
  return Boolean(sw.registration?.waiting || sw.registration?.installing);
}

/**
 * O aquecimento pode guardar esta resposta? Só HTML está sujeito à regra: não
 * pode haver atualização a caminho, e a página só pode citar arquivos que o
 * precache DESTA versão tem — a mesma conferência que o `install` faz em `/`
 * (`guardarPaginaInicialComFicha`), que cobre também o deploy novo que o
 * navegador ainda não notou. Imagem e demais arquivos seguem como sempre.
 */
async function aquecimentoPodeGuardar(res: Response): Promise<boolean> {
  const tipo = res.headers?.get("content-type") ?? "";
  if (!tipo.includes("text/html")) return true;
  const texto = await res.clone().text();
  return (
    !haAtualizacaoAChegar() &&
    htmlUsaSoArquivosDoPrecache(texto, urlsDoPrecache)
  );
}

/**
 * A página inicial COM a ficha da loja, no cache novo (revisão da 1.5.33).
 *
 * O precache só traz o `/index.html` CRU (sem ficha), que o fallback de
 * navegação recusa. As páginas com ficha viviam no cache da versão anterior —
 * e o `activate` o apaga. Sem isto, abrir o app SEM rede logo depois de
 * atualizar caía em "Sem conexão" até a primeira visita online. Busca a
 * página inicial no próprio `install` (o porteiro injeta a ficha em
 * qualquer documento) e a guarda em `/`, que é a segunda opção do fallback.
 *
 * Só guarda se a resposta for uma página de verdade (200, sem redirecionamento,
 * com a ficha) e se usar só os arquivos que o precache acabou de baixar —
 * HTML de um deploy mais novo, com arquivos que este cache não tem, ficaria
 * quebrado offline. Nunca rejeita: em qualquer dúvida não guarda nada, como
 * sempre foi.
 */
async function guardarPaginaInicialComFicha(urls: string[]): Promise<void> {
  try {
    const cache = await caches.open(CACHE_NAME);
    if (await cache.match("/")) return;
    const resposta = await fetch("/", {
      cache: "no-store",
      signal: sinalComPrazo(PRAZO_DA_REDE_NO_SW_MS),
    });
    if (!resposta?.ok || resposta.redirected) return;
    const texto = await resposta.clone().text();
    if (!texto.includes(`id="${FICHA_DA_LOJA_ID}"`)) return;
    if (!htmlUsaSoArquivosDoPrecache(texto, urls)) {
      console.warn(
        "[SW] Página inicial usa arquivos fora do precache; não guardada.",
      );
      return;
    }
    await cache.put("/", resposta);
  } catch (e) {
    console.warn("[SW] Falha ao guardar a página inicial com ficha:", e);
  }
}

sw.addEventListener("install", (event: any) => {
  // 1ª instalação: só o núcleo; atualização: o app inteiro (`listaDestaVersao`).
  event.waitUntil(
    listaDestaVersao().then((urls) =>
      precachearOAppInteiro(urls).then(() =>
        guardarPaginaInicialComFicha(urls),
      ),
    ),
  );
  console.log(
    "[SW] Installing new version. Waiting for user/client activation signal...",
  );

  // A ficha da loja, fora do <head>: busca própria, sem bloquear o install
  // se o porteiro estiver fora do ar ou o build ainda for o antigo (que não
  // serve este caminho) — daí um waitUntil separado, com o erro contido nele.
  event.waitUntil(
    // Com prazo: conexão que conecta e não responde deixaria este waitUntil
    // aberto para sempre e o service worker novo "instalando" sem fim.
    fetch(CAMINHO_IDENTIDADE_JSON, {
      cache: "no-store",
      signal: sinalComPrazo(PRAZO_DA_REDE_NO_SW_MS),
    })
      .then((resposta: any) => {
        if (!resposta?.ok) return;
        return caches
          .open(IDENTIDADE_CACHE_NAME)
          .then((cache) => cache.put(CAMINHO_IDENTIDADE_JSON, resposta));
      })
      .catch((err: unknown) => {
        console.warn("[SW] Falha ao buscar a ficha da loja no install:", err);
      }),
  );
});

/** Quais arquivos do precache NÃO estão no cache desta versão? Em dúvida
 * (cache ilegível), todos. */
async function arquivosFaltando(urls: string[]): Promise<string[]> {
  if (urls.length === 0) return [];
  try {
    const cache = await caches.open(CACHE_NAME);
    const guardados = new Set(
      (await cache.keys()).map((req: Request) => new URL(req.url).pathname),
    );
    return urls.filter((url) => !guardados.has(caminhoDoPrecache(url)));
  } catch {
    return urls;
  }
}

/** O cache desta versão foi despejado em parte (entre o `install` e o
 * `activate`)? Baixa de novo só o que falta; arquivo que volta como HTML é
 * descartado de novo. Nunca rejeita. */
async function repararPrecache(urls: string[]): Promise<void> {
  try {
    const cache = await caches.open(CACHE_NAME);
    const faltando = await arquivosFaltando(urls);
    await Promise.all(
      faltando.map((url) =>
        fetch(url, { signal: sinalComPrazo(PRAZO_DA_REDE_NO_SW_MS) })
          .then((resposta) => {
            if (!resposta.ok) throw new TypeError(`bad-response ${url}`);
            return cache.put(url, resposta);
          })
          .catch(() => {}),
      ),
    );
    for (const url of await arquivosQueVieramComoHtml(cache, faltando)) {
      await cache.delete(url);
    }
  } catch (e) {
    console.warn("[SW] Falha ao refazer o precache despejado:", e);
  }
}

/**
 * Deleta os caches de versões anteriores — SÓ se o desta versão está inteiro.
 * O `install` já falha quando o download não completa, mas o navegador pode
 * despejar o cache entre o `install` e o `activate` (o service worker novo
 * pode esperar dias). Com o cache novo incompleto, o antigo é a única cópia
 * do app que funciona offline e fica onde está.
 */
async function purgarCachesAntigos(): Promise<void> {
  // Na 1ª instalação só o núcleo precisa estar inteiro: reparar a lista toda
  // aqui baixaria o app inteiro no primeiro acesso, que é o que o `install`
  // deixou de fazer. Numa atualização, o app inteiro, como sempre.
  const lista = await listaDestaVersao();
  if ((await arquivosFaltando(lista)).length > 0) {
    await repararPrecache(lista);
    if ((await arquivosFaltando(lista)).length > 0) {
      console.warn(
        "[SW] Cache desta versão incompleto; caches antigos mantidos.",
      );
      return;
    }
  }
  // O install pode não ter conseguido guardar a página inicial com ficha
  // (porteiro fora do ar naquele instante): tenta de novo agora, antes de
  // jogar fora as páginas com ficha do cache anterior. Se ainda assim não
  // der, a versão nova vale mesmo assim — o HTML antigo, servido primeiro por
  // `caches.match`, deixaria o app preso na versão velha.
  await guardarPaginaInicialComFicha(lista);
  const cacheNames = await caches.keys();
  const cachesToDelete = cacheNames.filter(
    (name) =>
      name !== CACHE_NAME &&
      name !== IMAGE_CACHE_NAME &&
      name !== IDENTIDADE_CACHE_NAME,
  );
  await Promise.all(
    cachesToDelete.map((name) => {
      console.log(`[SW] Purging old cache: ${name}`);
      return caches.delete(name);
    }),
  );
}

sw.addEventListener("activate", (event: any) => {
  event.waitUntil(
    Promise.all([
      // Assume o controle imediatamente
      sw.clients.claim(),
      purgarCachesAntigos(),
      purgarArquivosPrivadosDaGaveta(),
    ]),
  );
});

let networkQuality = "fast";

// Achado do revisor (rodada 2, 11/09/2026): o `install` precacheia
// `/index.html` CRU (`cache.addAll(urls)`, linha ~49 — `vite.config.ts`
// não exclui `html` do `globPatterns`). Esse HTML é o assado do build
// "idêntico para todas" (fixture da etapa 2), sem NENHUMA ficha dentro.
// O fallback de navegação abaixo (rota nunca visitada + rede fora do ar)
// caía nele sem checar — servindo o assado de ninguém como se fosse a
// loja, e violando "na dúvida, em manutenção" (o bem maior desta etapa).
// Por isso: antes de devolver um HTML tirado do cache de FALLBACK (não o
// da rota exata, que só chega ao cache vindo de uma resposta de rede real
// já passada pelo porteiro), confirmamos que ele carrega a tag da ficha.
async function respostaTemFichaDaLoja(resposta: any): Promise<boolean> {
  if (!resposta) return false;
  try {
    const texto = await resposta.clone().text();
    return texto.includes(`id="${FICHA_DA_LOJA_ID}"`);
  } catch (e) {
    console.warn("[SW] Falha ao checar a ficha no HTML de fallback:", e);
    return false;
  }
}

/**
 * Só recusas DURADOURAS do porteiro apagam a página guardada: `sem-loja`,
 * `discorda` e, desde L8 (26/11/2026), `adormecida` (503) e `encerrada`
 * (410) — a loja fora do ar não pode continuar aparecendo pela vitrine
 * guardada de quando estava aberta. `banco-indisponivel` e
 * `html-indisponivel` são falhas passageiras: preservamos o app, como o
 * porteiro preserva a última ficha boa quando o banco falha. Apagar a raiz
 * também tiraria o fallback offline. Cada motivo vale SÓ com o status da
 * página que o porteiro manda com ele. O SW não importa o porteiro; o teste
 * cobre todos os `MotivoManutencao` com respostas REAIS dele.
 * `sem-ficha-no-cache` é do próprio SW e nunca chega da rede.
 */
const STATUS_DA_RECUSA_DURADOURA: ReadonlyMap<string, number> = new Map([
  ["sem-loja", 503],
  ["discorda", 503],
  ["adormecida", 503],
  ["encerrada", 410],
]);

/**
 * A resposta de REDE é uma recusa DURADOURA do porteiro?
 * O marcador é o par status + `x-ikcous-porteiro: <motivo duradouro>`.
 * Falhas passageiras, 502/504 da hospedagem, 500, 503/410 sem o cabeçalho e
 * par trocado (ex.: 503 com `encerrada`) preservam a página guardada: uma
 * pane não pode apagar o app offline.
 */
function ehRecusaDoPorteiro(response: Response): boolean {
  // Status antes do cabeçalho, como antes do L8: resposta 200 (a imensa
  // maioria) nem consulta `headers`, então nenhum caminho comum muda.
  if (response.status !== 503 && response.status !== 410) return false;
  const statusEsperado = STATUS_DA_RECUSA_DURADOURA.get(
    response.headers.get("x-ikcous-porteiro") ?? "",
  );
  return statusEsperado !== undefined && response.status === statusEsperado;
}

/**
 * Lista PERMITIDA dos motivos PASSAGEIROS do porteiro (o banco ou o HTML da
 * loja falharam nesta tentativa; a loja continua aberta). Só eles, com 503,
 * deixam a rota NUNCA visitada abrir o app guardado — como a rota visitada já
 * abre (cache primeiro). Lista permitida de propósito: motivo novo ou
 * desconhecido, loja fechada, adormecida, encerrada, `sem-loja`, `discorda`
 * e o que não for exatamente estes valores passam como vieram. Na dúvida, a
 * loja fechada nunca reabre pelo app guardado.
 */
const MOTIVOS_PASSAGEIROS_DO_PORTEIRO: ReadonlySet<string> = new Set([
  "banco-indisponivel",
  "html-indisponivel",
]);

/** A resposta de REDE é o 503 de uma falha PASSAGEIRA do porteiro? Par
 * status 503 + `x-ikcous-porteiro` da lista permitida, nada mais. */
function ehFalhaPassageiraDoPorteiro(response: Response): boolean {
  if (response.status !== 503) return false;
  return MOTIVOS_PASSAGEIROS_DO_PORTEIRO.has(
    response.headers.get("x-ikcous-porteiro") ?? "",
  );
}

/**
 * A recusa é a da loja FORA DO AR (`adormecida`/`encerrada`, caça de
 * 26/11/2026)? Aí apagar só a rota não basta: as outras páginas guardadas
 * abriam a vitrine inteira e a cliente pagava o PIX direto no banco da loja,
 * num pedido que ninguém atende. Mesmo par status + marcador da recusa.
 */
function ehLojaForaDoAr(response: Response): boolean {
  if (!ehRecusaDoPorteiro(response)) return false;
  const motivo = response.headers.get("x-ikcous-porteiro");
  return motivo === "adormecida" || motivo === "encerrada";
}

/**
 * Apaga de TODOS os caches toda página guardada (resposta HTML): as rotas
 * visitadas, a `/` com ficha, a casca `/index.html` do precache e as de
 * versões anteriores. Fica a "sem internet" (`/offline.html`), que não abre a
 * loja. Assets, ícones, fotos e a ficha ficam. Idempotente. Devolve `false`
 * se algo falhou — e aí ninguém é avisado (`fecharALojaGuardada`).
 */
async function apagarTodasAsPaginasGuardadas(): Promise<boolean> {
  try {
    for (const nome of await caches.keys()) {
      const cache = await caches.open(nome);
      for (const chave of await cache.keys()) {
        if (new URL(chave.url).pathname === "/offline.html") continue;
        const guardada = await cache.match(chave);
        const tipo = guardada?.headers?.get("content-type") ?? "";
        if (tipo.toLowerCase().includes("text/html")) await cache.delete(chave);
      }
    }
    return true;
  } catch (e) {
    console.warn("[SW] Falha ao apagar as páginas da loja fechada:", e);
    return false;
  }
}

/**
 * A loja está fora do ar: apaga as páginas guardadas e, SÓ se deu certo, avisa
 * as abas para recarregar (`receptor-da-loja-fechada.ts`) — com página ainda
 * guardada, a recarga voltaria à vitrine e viraria laço. Avisa também a aba
 * que não é controlada por este SW (abriu antes dele) e a que está abrindo
 * agora: `clients.get(resultingClientId)` espera ela ficar pronta, senão a
 * resposta da rede podia chegar antes de ela existir. Nunca rejeita.
 */
async function fecharALojaGuardada(event: any): Promise<void> {
  if (!(await apagarTodasAsPaginasGuardadas())) return;
  try {
    const abas: any[] = await sw.clients.matchAll({
      type: "window",
      includeUncontrolled: true,
    });
    if (event.resultingClientId && typeof sw.clients.get === "function") {
      const daNavegacao = await sw.clients.get(event.resultingClientId);
      if (daNavegacao && !abas.some((aba) => aba.id === daNavegacao.id))
        abas.push(daNavegacao);
    }
    for (const aba of abas) {
      try {
        aba.postMessage({ tipo: TIPO_LOJA_FECHADA });
      } catch {
        // Uma aba que fechou no meio não impede o aviso às outras.
      }
    }
  } catch (e) {
    console.warn("[SW] Falha ao avisar as abas da loja fechada:", e);
  }
}

/** Página curta de "em manutenção" — mesma decisão de falha fechada do
 * porteiro (T3), reproduzida aqui porque o SW não pode importar código de
 * outra tarefa: nenhum byte de marca ou conexão sai quando não há ficha. */
function respostaEmManutencao(): Response {
  return new Response(
    // Mesmo padrão do 503 do porteiro e de public/offline.html: ajuste ao
    // celular, recarga sozinha a cada 10 s e um link para a própria página
    // como botão. Sem script (a CSP só libera 1 hash em script-src).
    '<!doctype html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta http-equiv="refresh" content="10"><title>Loja em manutenção</title><style>body{margin:0;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px;padding:24px;box-sizing:border-box;text-align:center;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;background:#fafafa;color:#18181b}p{margin:0;max-width:320px;font-size:16px;line-height:1.5}a{padding:14px 28px;border-radius:14px;background:#18181b;color:#fafafa;font-size:15px;font-weight:700;text-decoration:none}</style></head><body><p>Loja em manutenção. Tente novamente em instantes.</p><a href="">Tentar novamente</a></body></html>',
    {
      status: 503,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "retry-after": "60",
        "x-ikcous-porteiro": "sem-ficha-no-cache",
      },
    },
  );
}

/**
 * A página "Sem internet" (`public/offline.html`), guardada no precache. Só
 * serve para o caso em que a REDE falhou: quando a rede responde (inclusive
 * o 503 "sem ficha" do porteiro), a resposta passa como veio — mostrar "sem
 * internet" com a internet funcionando e a loja fora do ar de verdade seria
 * mentir para a cliente. É a mesma página para toda a frota: sem marca.
 *
 * Devolve `null` quando ela não está guardada (precache que falhou) ou o
 * cache não responde; quem chama cai no 503 de manutenção, como sempre foi.
 * Nunca rejeita: uma falha aqui viraria navegação sem resposta nenhuma.
 */
async function paginaSemInternet(): Promise<Response | null> {
  try {
    const pagina = await caches.match("/offline.html");
    return pagina?.ok ? pagina : null;
  } catch (e) {
    console.warn("[SW] Falha ao ler a página offline do cache:", e);
    return null;
  }
}

/**
 * A melhor página GUARDADA para abrir quando a rede não entregou: a da própria
 * rota, depois o `/index.html` e a `/` — esses dois só com a ficha da loja
 * (`respostaTemFichaDaLoja`). Devolve `null` quando nada serve; quem chama
 * decide o que fazer sem página (página "sem internet" ou continuar esperando).
 */
async function paginaGuardadaParaNavegacao(
  request: Request,
): Promise<Response | null> {
  const exata = await caches.match(request);
  if (exata) return exata;
  const indice = await caches.match("/index.html");
  if (indice && (await respostaTemFichaDaLoja(indice))) return indice;
  const raiz = await caches.match("/");
  if (raiz && (await respostaTemFichaDaLoja(raiz))) return raiz;
  return null;
}

/**
 * Rota nunca visitada: a rede tem `PRAZO_DA_REDE_NO_SW_MS` para responder.
 * Estourou E há página guardada útil -> abre o app guardado, sem a cliente
 * olhar tela parada (rede que conecta e não responde NÃO rejeita o `fetch`, e
 * o `.catch` de quem chama nunca roda). O `fetch` original segue vivo
 * (`waitUntil`) e, se chegar depois, a rotina de quem chama o guarda para a
 * próxima visita. SEM página guardada útil (primeira visita) nada abre por
 * lentidão: a rede continua sendo esperada, como sempre foi; só a REJEIÇÃO
 * dela leva à página "sem internet".
 */
function redeOuAppGuardado(
  rede: Promise<Response>,
  request: Request,
  event: any,
): Promise<Response> {
  let prazo: ReturnType<typeof setTimeout> | undefined;
  const appGuardado = new Promise<Response>((resolve) => {
    prazo = setTimeout(() => {
      paginaGuardadaParaNavegacao(request).then(
        (pagina) => {
          if (pagina) resolve(pagina);
        },
        () => {},
      );
    }, PRAZO_DA_REDE_NO_SW_MS);
  });
  const desarmar = () => clearTimeout(prazo);
  // Nunca rejeita: a rejeição da rede é tratada por quem recebe a corrida.
  event.waitUntil(rede.then(desarmar, desarmar));
  return Promise.race([rede, appGuardado]);
}

/** Espera depois da navegação antes de completar o app: a tela que a cliente
 * abriu pede os arquivos dela primeiro. */
const ESPERA_PARA_COMPLETAR_MS = 3000;
/** Quantos arquivos o completar pede de uma vez. */
const LOTE_DO_COMPLETAR = 6;
/** O completar em andamento: duas navegações seguidas não baixam duas vezes. */
let completando: Promise<void> | null = null;

/** Rede lenta, sem sinal ou economia de dados: completar o app espera outra
 * visita. Olha o aviso da página (`SET_NETWORK_QUALITY`), o cabeçalho
 * `Save-Data` da navegação e o que o navegador conta ao service worker. */
function redeNaoComportaCompletar(request: Request): boolean {
  if (networkQuality === "slow" || networkQuality === "offline") return true;
  if (request.headers?.get("save-data") === "on") return true;
  const conexao = sw.navigator?.connection;
  if (conexao?.saveData) return true;
  return (
    conexao?.effectiveType === "slow-2g" || conexao?.effectiveType === "2g"
  );
}

/** Baixa um arquivo que falta e o guarda no cache desta versão — só se veio
 * inteiro: 200, sem ser o HTML do catch-all no lugar do arquivo e, se for
 * página, sem citar arquivo que esta versão não tem (`aquecimentoPodeGuardar`,
 * a mesma regra do aquecimento). Nunca rejeita. */
async function completarUmArquivo(cache: Cache, url: string): Promise<void> {
  try {
    const resposta = await fetch(url, {
      signal: sinalComPrazo(PRAZO_DA_REDE_NO_SW_MS),
    });
    if (!resposta?.ok || resposta.redirected) return;
    const tipo = resposta.headers?.get("content-type") ?? "";
    if (tipo.includes("text/html") && !ehPagina(caminhoDoPrecache(url))) return;
    if (!(await aquecimentoPodeGuardar(resposta))) return;
    await cache.put(url, resposta);
  } catch {
    // Fica para a próxima volta.
  }
}

/**
 * A volta completa o app em segundo plano (plano de 26/11/2026). A 1ª
 * instalação guardou só o núcleo; quando a cliente VOLTA (navegação atendida
 * por este service worker), o resto entra aos poucos: 3 s depois, em lotes de
 * 6, parando se uma atualização estiver a caminho (o resto seria de uma versão
 * que vai sair) ou se a rede não comportar (lenta, sem sinal, economia de
 * dados) — a próxima volta continua de onde parou. Uma chamada no começo da
 * navegação, sem mudar como ela é respondida. Nunca rejeita.
 */
function completarOAppEmSegundoPlano(event: any): void {
  if (urlsDoNucleo.length === 0 || completando) return;
  const request: Request = event.request;
  completando = (async () => {
    await new Promise((resolve) =>
      setTimeout(resolve, ESPERA_PARA_COMPLETAR_MS),
    );
    // Uma versão nova pode ter ativado durante a espera e apagado o cache
    // desta: abri-lo o recriaria vazio e o completar baixaria o app inteiro
    // para um cache órfão (revisão Opus do PR #1906). Atualização a caminho:
    // o resto seria de uma versão que vai sair.
    if (!(await caches.has(CACHE_NAME)) || haAtualizacaoAChegar()) return;
    const faltando = await arquivosFaltando(urlsDoPrecache);
    if (faltando.length === 0) return;
    const cache = await caches.open(CACHE_NAME);
    for (let i = 0; i < faltando.length; i += LOTE_DO_COMPLETAR) {
      if (haAtualizacaoAChegar() || redeNaoComportaCompletar(request)) return;
      await Promise.all(
        faltando
          .slice(i, i + LOTE_DO_COMPLETAR)
          .map((url) => completarUmArquivo(cache, url)),
      );
    }
  })()
    .catch((e) => console.warn("[SW] Falha ao completar o app:", e))
    .finally(() => {
      completando = null;
    });
  event.waitUntil(completando);
}

sw.addEventListener("fetch", (event: any) => {
  const url = new URL(event.request.url);

  // Ignorar requisições de extensões do Chrome, DevTools e protocolos não-http
  if (!url.protocol.startsWith("http")) return;

  // 1. FILTRAGEM ESTRITA: Ignorar o que não deve ser cacheado
  // Ignorar requisições que não sejam GET (POST, PUT, etc)
  if (event.request.method !== "GET") return;

  // Ignorar serviços de logs e telemetria (causam erro de clone/stream)
  if (url.hostname.includes("vercel.app") && url.pathname.includes("logs"))
    return;
  if (url.hostname.includes("supabase.co") && url.pathname.includes("auth"))
    return;

  // `/version.json` é SONDA DE FRESCOR, não recurso cacheável: é ela que o
  // useUpdateCheck consulta a cada 20 minutos para descobrir se saiu versão
  // nova. Duas razões para não passar por aqui, e as duas custaram medição:
  //
  // (1) O catch-all lá embaixo grava POR URL. Como cada poll levava um
  //     carimbo diferente (`?t=<agora>`), 20 polls viraram 20 entradas
  //     distintas no cache `app-cache-<versao>` (medido em 08/09/2026, Cache
  //     Storage real) — ~20 por hora de app aberto, sem despejo, só limpas
  //     quando a versão muda. O cache do app instalado crescia sem limite.
  //
  // (2) E o catch-all é CACHE-FIRST (`return cachedResponse || fetchPromise`).
  //     Tirar o carimbo sem tirar a sonda daqui seria PIOR que o vazamento: o
  //     poll passaria a receber a versão VELHA do cache para sempre e o aviso
  //     de atualização morreria em silêncio.
  //
  // Dar `return` sem `respondWith` devolve o controle ao navegador, que busca
  // nativamente. O `cache: "no-store"` do useUpdateCheck cuida do cache HTTP.
  if (url.pathname === "/version.json") return;

  // `/identidade.json` pela PÁGINA é a mesma pergunta de frescor: a tela de
  // manutenção confere se a loja já voltou (`configuracao.manutencao`). O
  // catch-all abaixo é cache-first e o `caches.match` global acha a ficha que
  // o `install` guardou em `ikcous-identidade`: a pergunta seria respondida
  // com a ficha de MANUTENÇÃO velha para sempre. Vai direto à rede. O
  // `install` (busca do próprio SW, que não passa por este listener) e o
  // `push` (lê o cache próprio) continuam como eram.
  if (url.pathname === CAMINHO_IDENTIDADE_JSON) return;

  // O porteiro monta o manifesto com a marca atual da loja (5 min no cache do
  // navegador; no-store em manutenção). Como a ficha acima, ele vai à rede
  // nativa, sem passar pelo cache do SW.
  if (url.pathname === "/manifest.webmanifest") return;

  // Avisos de licenças são um arquivo estático, não uma página offline do app.
  if (url.pathname === "/THIRD_PARTY_NOTICES.txt") return;

  // 2. NAVEGAÇÃO: CACHE PRIMEIRO, REVALIDAÇÃO EM SEGUNDO PLANO
  // (laudo ofensiva 3108, achado N4)
  //
  // O DEFEITO PROVADO EM 31/08 (3 reproduções, build de produção): o ramo
  // era NETWORK-FIRST com fetch() DENTRO do respondWith — offline, o fetch
  // interno morria, o fallback entregava o HTML do cache, mas TODOS os
  // subrecursos (módulos e CSS) falhavam com net::ERR_FAILED: tela branca
  // ao abrir/recarregar a PWA sem internet, MESMO com o precache cheio e o
  // SW ativo (fetches DENTRO da página offline devolviam 200 do cache — o
  // cache estava lá; o quebrado era este fluxo de navegação).
  //
  // A cura: a resposta vem DO CACHE na hora; a rede entra por
  // `event.waitUntil` (fora da promessa respondWith) só para REVALIDAR a
  // cópia para a próxima visita. Com `registerType: "prompt"` +
  // useUpdateCheck, versão nova de app continua avisando pelo ciclo de
  // update do SW — a revalidação em segundo plano não contorna o aviso.
  if (event.request.mode === "navigate") {
    completarOAppEmSegundoPlano(event);
    // A busca global pode achar uma versão antiga antes da ativa.
    const paginaExata = caches
      .match(event.request, { cacheName: CACHE_NAME })
      .then((atual) => atual ?? caches.match(event.request));
    event.respondWith(
      paginaExata.then((cached) => {
        if (cached) {
          event.waitUntil(
            fetch(event.request)
              .then((response) => {
                // Loja fora do ar: some TODA página guardada e as abas
                // recarregam (a de agora inclusive) — só a rota não basta.
                if (ehLojaForaDoAr(response)) return fecharALojaGuardada(event);
                // O porteiro recusou por motivo duradouro: a página
                // guardada é de ANTES e esconderia a tela de manutenção até
                // o cache sumir. Apaga só esta rota, para a próxima abertura
                // ir à rede e mostrar o 503. A abertura de agora já foi
                // respondida (cache-primeiro, de propósito: rede fora do ar
                // não pode virar tela branca). Só uma RESPOSTA do porteiro
                // chega aqui — rede que falha cai no `.catch` e não apaga.
                if (ehRecusaDoPorteiro(response))
                  return caches
                    .open(CACHE_NAME)
                    .then((cache) => cache.delete(event.request))
                    .then(() => undefined);
                if (response.ok && response.status === 200) {
                  // Pílula da revisão do PR #375 (ressalva 1a): com um
                  // update PENDENTE (waiting), NÃO gravar HTML novo no
                  // cache VELHO — a revalidação não pode misturar HTML
                  // novo com chunks velhos enquanto o SW novo espera
                  // ativação (a janela de ChunkLoadError da ressalva). O
                  // `installing` (atualização sendo baixada AGORA) abre a mesma
                  // janela: a guarda olha os dois (caça 7, 26/10/2026).
                  if (haAtualizacaoAChegar()) return;
                  try {
                    const copy = response.clone();
                    // O try/catch aqui é SÍNCRONO: ele não pega rejeição de
                    // promessa. Sem este .catch, um put que falha (cota de
                    // disco estourada) vira unhandled rejection dentro do SW.
                    caches
                      .open(CACHE_NAME)
                      .then((cache) => cache.put(event.request, copy))
                      .catch((err) =>
                        console.warn(
                          "[SW] Failed to cache navigation response:",
                          err,
                        ),
                      );
                  } catch (e) {
                    console.warn(
                      "[SW] Failed to clone navigation response:",
                      e,
                    );
                  }
                }
              })
              .catch(() => {}),
          );
          return cached;
        }
        const rede = fetch(event.request).then(async (response) => {
          // Rota sem página guardada e loja fora do ar: a página fechada passa
          // como veio, e as OUTRAS rotas guardadas também saem. O try: um
          // `waitUntil` recusado não pode trocar a página fechada pela de
          // "sem internet" (o `.catch` abaixo trata a rede que falhou).
          if (ehLojaForaDoAr(response)) {
            const fechando = fecharALojaGuardada(event);
            try {
              event.waitUntil(fechando);
            } catch {
              // A limpeza segue mesmo sem prolongar a vida do SW.
            }
          }
          // Primeira visita: com atualização a caminho a cliente recebe o HTML
          // da rede, mas ele NÃO é gravado no cache da versão velha (a mesma
          // guarda da revalidação acima).
          if (
            response.ok &&
            response.status === 200 &&
            !haAtualizacaoAChegar()
          ) {
            try {
              const copy = response.clone();
              // Mesma razão do .catch da revalidação acima: o try/catch
              // síncrono não alcança a rejeição da promessa do put.
              caches
                .open(CACHE_NAME)
                .then((cache) => cache.put(event.request, copy))
                .catch((err) =>
                  console.warn(
                    "[SW] Failed to cache navigation response:",
                    err,
                  ),
                );
            } catch (e) {
              console.warn("[SW] Failed to clone navigation response:", e);
            }
          }
          // Falha PASSAGEIRA do porteiro (banco ou HTML da loja caíram nesta
          // tentativa) numa rota nunca visitada: abre o app guardado, como a
          // rota visitada já abre. Sem app guardado útil, ou se o cache
          // quebrar, a resposta passa como veio — a rede respondeu, então
          // "sem internet" (o `.catch` abaixo) seria mentira.
          if (ehFalhaPassageiraDoPorteiro(response)) {
            try {
              const guardada = await paginaGuardadaParaNavegacao(event.request);
              if (guardada) return guardada;
            } catch (e) {
              console.warn("[SW] Falha ao ler o app guardado:", e);
            }
          }
          return response;
        });
        return redeOuAppGuardado(rede, event.request, event).catch(
          async (err) => {
            console.log(
              "[SW] Navigation fetch failed, attempting cache/SPA fallback:",
              err,
            );
            const guardada = await paginaGuardadaParaNavegacao(event.request);
            if (guardada) return guardada;
            // Chegou até aqui por REDE FORA DO AR (o `fetch` lançou) e
            // nenhuma página guardada serve: a cliente está sem
            // internet, não a loja sem ficha. "Em manutenção" aqui
            // fazia a cliente achar que a loja fechou.
            return (await paginaSemInternet()) ?? respostaEmManutencao();
          },
        );
      }),
    );
    return;
  }

  // Se for Supabase, ignorar exceto se for arquivo PÚBLICO do Storage (R12,
  // 04/10/2026). Endereço assinado (`/object/sign/...?token=`), download
  // autenticado, transformação assinada, upload e qualquer outra forma vão
  // direto à rede, sem passar pela gaveta: a cópia sobreviveria ao logout e
  // seria servida por endereço a quem usasse o aparelho depois. Pedido com
  // `Authorization` também fica de fora — quem o assina é a sessão de alguém.
  if (url.hostname.includes("supabase.co")) {
    if (!ehArquivoPublicoDoStorage(url)) return;
    if (event.request.headers.has("authorization")) return;

    event.respondWith(
      caches.open(IMAGE_CACHE_NAME).then((cache) => {
        return cache.match(event.request).then((cachedResponse) => {
          const fetchPromise = buscarFotoDoStorage(event.request)
            .then((networkResponse) => {
              if (networkResponse?.status === 200) {
                const responseToCache = networkResponse.clone();
                // O .catch do fetchPromise (abaixo) não cobre este put: ele é
                // promessa SOLTA, e rejeitar aqui (cota cheia) viraria
                // unhandled rejection dentro do SW.
                cache
                  .put(event.request, responseToCache)
                  .catch((err: unknown) =>
                    console.warn("[SW] Failed to cache Supabase image:", err),
                  );
                cleanOldImageCache(cache);
              }
              return networkResponse;
            })
            .catch((err) => {
              console.warn("[SW] Supabase image fetch failed:", err);
              if (cachedResponse) return cachedResponse;
              throw err;
            });
          return cachedResponse || fetchPromise;
        });
      }),
    );
    return;
  }

  // GUARD DE ORIGEM: a partir daqui só sobra o catch-all de assets estáticos,
  // que faz stale-while-revalidate via fetch() manual dentro do SW. Esse
  // fetch() é regido pela CSP connect-src — NÃO pela script-src que liberou
  // a tag <script> na página (ex.: sdk.mercadopago.com está em script-src,
  // não em connect-src). Se deixarmos o catch-all reemitir uma requisição
  // cross-origin como fetch(), a CSP barra, o catch cai no throw e o SW
  // cancela o carregamento do script de terceiro (respondWith rejeitado).
  // Para requisição de outra origem, não interceptar: dar `return` sem
  // `respondWith` devolve o controle ao navegador, que busca nativamente
  // e não passa pelo filtro de connect-src do SW.
  if (url.origin !== sw.location.origin) return;

  // 3. STALE-WHILE-REVALIDATE: Assets estáticos (JS, CSS, Imagens)
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (
        cachedResponse &&
        (networkQuality === "slow" || networkQuality === "offline")
      ) {
        console.log(
          "[SW] Network is slow/offline. Serving from Cache only (no background fetch):",
          event.request.url,
        );
        return cachedResponse;
      }
      const fetchPromise = fetch(event.request)
        .then((networkResponse) => {
          // Só cachear se for uma resposta válida, de sucesso e do tipo basic/cors
          // Evitamos cachear respostas opaque (status 0) que podem estar corrompidas
          if (networkResponse?.status === 200) {
            try {
              // Robust cache update: only cache valid, successful responses
              const responseToCache = networkResponse.clone();
              // HTML aqui é a hospedagem devolvendo o índice do app no lugar de
              // um arquivo que não existe mais (chunk de release antiga): guardá-lo
              // trocaria o JavaScript bom pelo HTML. Mesma conferência da instalação
              // (`arquivosQueVieramComoHtml`) e do reparo do precache.
              const respostaEhHtml = (
                responseToCache?.headers?.get("content-type") ?? ""
              )
                .toLowerCase()
                .includes("text/html");
              if (
                responseToCache?.status === 200 &&
                !respostaEhHtml &&
                (responseToCache.type === "basic" ||
                  responseToCache.type === "cors")
              ) {
                // O try/catch que envolve este bloco é SÍNCRONO e não pega
                // rejeição de promessa: sem o .catch, um put que falha (cota
                // de disco estourada) vira unhandled rejection no SW.
                caches
                  .open(CACHE_NAME)
                  .then((cache) => cache.put(event.request, responseToCache))
                  .catch((err) =>
                    console.warn("[SW] Failed to cache asset response:", err),
                  );
              }
            } catch (e) {
              console.warn("[SW] Failed to cache asset response:", e);
            }
          }
          return networkResponse;
        })
        .catch((err) => {
          console.warn("[SW] Fetch failed for:", event.request.url, err);
          // IMPORTANTE: NÃO retornar um Response dummy (tipo 408) aqui.
          // Se retornar 408, o navegador acha que o chunk carregou mas está vazio/erro,
          // disparando o ChunkLoadError no frontend. Deixamos falhar naturalmente
          // para que o navegador tente outras estratégias ou o erro seja capturado corretamente.
          if (cachedResponse) return cachedResponse;
          throw err;
        });

      return cachedResponse || fetchPromise;
    }),
  );
});

// ETERNAL HEARTBEAT: Listen for pings to stay alive and confirm health.
// Safari antigo não tem BroadcastChannel: sem esta guarda o script inteiro do
// service worker falharia ao carregar e o app nunca instalaria o SW.
const heartbeatChannel =
  typeof BroadcastChannel === "undefined"
    ? null
    : new BroadcastChannel("sw-heartbeat");

sw.addEventListener("message", (event: any) => {
  if (event.data === "HEARTBEAT_PING") {
    // Responder ao Sentinel diretamente para evitar o reload de 5m
    if (event.source) {
      event.source.postMessage("HEARTBEAT_ACK");
    } else {
      heartbeatChannel?.postMessage("HEARTBEAT_ACK");
    }
  }

  // Workbox generic skipWaiting support
  if (event.data?.type === "SKIP_WAITING") {
    console.log("[SW] SKIP_WAITING received. Activating new version.");
    sw.skipWaiting();
  }

  // Logout (R12): a página pede para jogar fora da gaveta de imagens o que
  // não é público. Só o TIPO é lido — nenhuma URL que venha na mensagem é
  // buscada nem guardada.
  if (event.data?.type === TIPO_PURGAR_ARQUIVOS_PRIVADOS) {
    const purga = purgarArquivosPrivadosDaGaveta();
    event.waitUntil?.(purga);
  }

  // Manual cache purge support
  if (event.data?.type === "MANUAL_PURGE") {
    caches.keys().then((cacheNames) => {
      Promise.all(cacheNames.map((name) => caches.delete(name))).then(() => {
        if (typeof BroadcastChannel === "undefined") return;
        const bc = new BroadcastChannel("sw-messages");
        bc.postMessage({ type: "PURGE_COMPLETE" });
        bc.close();
      });
    });
  }

  async function warmSingleUrl(url: string, imgCache: Cache, appCache: Cache) {
    try {
      const parsedUrl = new URL(url, self.location.origin);
      const allowedHosts = [
        self.location.hostname,
        "images.unsplash.com",
        "placehold.co",
      ];
      const isSupabase =
        parsedUrl.hostname.endsWith(".supabase.co") ||
        parsedUrl.hostname === "supabase.co";

      if (!allowedHosts.includes(parsedUrl.hostname) && !isSupabase) {
        console.warn(
          "[SW] Blocked cache warming for untrusted host:",
          parsedUrl.hostname,
        );
        return;
      }
      // Mesma regra do ramo de fetch (R12): do Supabase, só arquivo PÚBLICO
      // do Storage entra na gaveta — nunca endereço assinado, autenticado ou
      // resposta de REST que a página tenha mandado aquecer.
      if (isSupabase && !ehArquivoPublicoDoStorage(parsedUrl)) {
        console.warn("[SW] Blocked cache warming for non-public storage URL");
        return;
      }

      const targetCache = isSupabase ? imgCache : appCache;
      const existing = await targetCache.match(url);
      if (existing) return;

      const res = await fetch(url); // ship-safe-ignore
      if (res.ok && res.status === 200) {
        if (!(await aquecimentoPodeGuardar(res))) {
          console.warn("[SW] Página aquecida não guardada:", url);
          return;
        }
        await targetCache.put(url, res);
        if (isSupabase) {
          cleanOldImageCache(imgCache);
        }
      }
    } catch (e) {
      console.warn("[SW] Warm fetch failed for:", url, e);
    }
  }

  if (event.data?.type === "WARM_CACHE") {
    const urls: string[] = event.data.urls || [];
    console.log("[SW] WARM_CACHE received. Warming:", urls.length, "URLs");

    Promise.all([caches.open(CACHE_NAME), caches.open(IMAGE_CACHE_NAME)]).then(
      async ([appCache, imgCache]) => {
        for (const url of urls) {
          await warmSingleUrl(url, imgCache, appCache);
        }
      },
    );
  }

  if (event.data?.type === "SET_NETWORK_QUALITY") {
    networkQuality = event.data.quality || "fast";
    console.log("[SW] Network quality updated to:", networkQuality);
  }
});

// Auto-ping a cada 30s para manter o worker ativo em alguns navegadores
setInterval(() => {
  // Keep alive logic
}, 30000);

// A imagem da notificação prefere a ficha renovada pela rede (ver
// `buscarFichaRenovada`), depois a FICHA guardada no install (loja
// resolvida por host, build compartilhado) e só cai no ícone assado
// (`buildIdentity`, comportamento de hoje) quando não há ficha em cache —
// build antigo, ou o `install` ainda não terminou de buscá-la. Qualquer falha
// na leitura do cache (inclusive `caches` sem `match`, ambiente antigo) cai
// no mesmo fallback: nunca deixa a notificação sem ícone.
//
// Lê pelo cache PRÓPRIO (`IDENTIDADE_CACHE_NAME`), não pelo `caches.match`
// de nível topo: um build compartilhado por toda a frota (etapa 2 da escala)
// pode ter, no mesmo Cache Storage, entradas de outra origem/loja para o
// MESMO caminho `/identidade.json` sobrevivendo entre trocas de host num
// mesmo dispositivo (SW não é limpo por navegação). Por isso, mesmo achando
// a ficha no cache próprio, só ela é aceita se `ficha.host` bater com
// `self.location.hostname` — senão, ícone assado (nunca a ficha de outra loja).
/** Prazo da busca da ficha nova quando um aviso chega: curto de propósito, o
 * aviso espera por ele e, estourando, sai com a cópia guardada. */
const PRAZO_DA_FICHA_NO_AVISO_MS = 1500;

function iconesDaFicha(ficha: FichaDaLoja): { icon: string; badge: string } {
  const urls = ficha?.identidade?.localUrls;
  return {
    icon: urls?.icon_192 || ICONE_ASSADO,
    // Ficha antiga: mantém o icon e usa reserva monocromática.
    // Nunca interpretar a imagem colorida como silhueta do Android.
    badge: urls?.badge_96 || BADGE_NEUTRO,
  };
}

/** Regrava a cópia da ficha (best-effort: ninguém espera por ela e o erro fica
 * aqui dentro). Se não gravar, o próximo aviso busca de novo. */
async function guardarFichaRenovada(copia: Response): Promise<void> {
  try {
    const cache = await caches.open(IDENTIDADE_CACHE_NAME);
    await cache.put(CAMINHO_IDENTIDADE_JSON, copia);
  } catch (e) {
    console.warn("[SW] Falha ao regravar a ficha da loja:", e);
  }
}

// A ficha guardada no `install` envelhece: a lojista troca o ícone e a URL da
// imagem muda (leva o hash do conteúdo). Quando um aviso chega, busca a ficha
// de agora, com prazo curto (o `signal` cobre o pedido e a leitura do corpo).
// Só vale ficha de ESTA loja e com as URLs das imagens; qualquer outra coisa
// (rede fora, prazo, erro do servidor, página no lugar da ficha) devolve null
// e o aviso segue com a cópia guardada — nunca perde nem atrasa além do prazo.
async function buscarFichaRenovada(): Promise<FichaDaLoja | null> {
  try {
    const resposta = await fetch(CAMINHO_IDENTIDADE_JSON, {
      cache: "no-store",
      signal: sinalComPrazo(PRAZO_DA_FICHA_NO_AVISO_MS),
    });
    if (!resposta?.ok) return null;
    const copia = resposta.clone();
    const ficha: FichaDaLoja = await resposta.json();
    if (ficha?.host !== sw.location.hostname) return null;
    if (!ficha?.identidade?.localUrls) return null;
    void guardarFichaRenovada(copia);
    return ficha;
  } catch {
    return null;
  }
}

async function resolverIconesDaLoja(): Promise<{
  icon: string;
  badge: string;
}> {
  const renovada = await buscarFichaRenovada();
  if (renovada) return iconesDaFicha(renovada);
  try {
    const cache = await caches.open(IDENTIDADE_CACHE_NAME);
    const resposta = await cache.match(CAMINHO_IDENTIDADE_JSON);
    if (resposta) {
      const ficha: FichaDaLoja = await resposta.json();
      if (ficha?.host === sw.location.hostname) return iconesDaFicha(ficha);
    }
  } catch (e) {
    console.warn("[SW] Falha ao ler a ficha da loja em cache:", e);
  }
  return { icon: ICONE_ASSADO, badge: BADGE_NEUTRO };
}

/** O aviso do mesmo pedido que já está na bandeja e é MAIS NOVO que `carimbo`, ou
 * `null` (nenhum, sem `getNotifications` ou leitura falhou: mostra-se como sempre). */
async function avisoMaisNovoNaBandeja(
  tag: string,
  carimbo: number,
): Promise<any | null> {
  try {
    if (typeof sw.registration?.getNotifications !== "function") return null;
    const naBandeja: any[] = await sw.registration.getNotifications({ tag });
    return avisoMaisNovoQue(carimbo, naBandeja);
  } catch {
    return null;
  }
}

sw.addEventListener("push", (event: any) => {
  if (!event.data) return;
  try {
    const payload = event.data.json();
    const title = payload.title || "Novidade!";
    // Aviso de status do pedido (a send-push grava `data.orderId`): a tag do
    // pedido faz o aviso novo SUBSTITUIR o anterior do mesmo pedido em vez de
    // empilhar, e `renotify` faz o aparelho avisar de novo na troca (sem ele a
    // troca seria silenciosa). Sem pedido (campanha, teste), nada muda.
    const orderId = payload.data?.orderId;
    const tagDoPedido =
      typeof orderId === "string" && orderId !== ""
        ? `pedido-${orderId}`
        : undefined;
    const doPedido = tagDoPedido ? { tag: tagDoPedido, renotify: true } : {};
    const carimbo = carimboDoAviso(payload.data);
    const notificar = async ({
      icon,
      badge,
    }: {
      icon: string;
      badge: string;
    }) => {
      // Aviso do pedido carimbado que chega DEPOIS de um mais novo do mesmo pedido
      // (a rede atrasou o primeiro): não o substitui. Todo push precisa terminar
      // numa notificação (sem ela o Chrome mostra um aviso genérico e o iOS
      // revoga a permissão), então em vez de calar o atrasado regrava-se, sem
      // avisar de novo, o conteúdo do mais novo. Lido aqui, logo antes de
      // mostrar, depois da espera pelo ícone. Qualquer falha na leitura da
      // bandeja = mostra como sempre.
      const maisNovo =
        carimbo !== null && tagDoPedido
          ? await avisoMaisNovoNaBandeja(tagDoPedido, carimbo)
          : null;
      if (maisNovo) {
        return sw.registration.showNotification(maisNovo.title, {
          body: maisNovo.body,
          icon: maisNovo.icon || icon,
          badge: maisNovo.badge || badge,
          tag: tagDoPedido,
          renotify: false,
          data: maisNovo.data,
        });
      }
      const options = {
        body: payload.body || "",
        icon,
        badge,
        ...doPedido,
        data: {
          url: payload.url || "/",
          ...payload.data,
        },
      };
      return sw.registration.showNotification(title, options);
    };
    // Sem a API de cache (ambiente sem `caches.match`), não há como ler a
    // ficha — segue direto para o ícone assado, exatamente como antes desta
    // mudança. Com a API disponível (todo SW real), a ficha tem preferência.
    if (typeof caches?.match !== "function") {
      event.waitUntil(notificar({ icon: ICONE_ASSADO, badge: BADGE_NEUTRO }));
    } else {
      event.waitUntil(resolverIconesDaLoja().then(notificar));
    }
  } catch (e) {
    console.error("[SW] Push parse error:", e);
    event.waitUntil(
      sw.registration.showNotification("Notificação", {
        body: event.data.text(),
        badge: BADGE_NEUTRO,
      }),
    );
  }
});

// Quanto o SW espera o app confirmar que recebeu o aviso de pedido novo antes
// de recarregar a janela. A resposta é imediata (um `postMessage` de volta);
// passar disto é app sem o receptor (versão anterior) ou aba travada.
const ESPERA_DA_RESPOSTA_DO_APP_MS = 1500;

/** Entrega ao app da janela o pedido do aviso e diz se ele CONFIRMOU o recebimento
 * (aberto por dentro, ou só avisado por ter texto não salvo). Nunca rejeita.
 * Vai junto o que a notificação dizia: o toque já a tirou da bandeja, e o app
 * que não pode trocar de pedido agora o repete na tela (pode ser contestação,
 * cancelamento, pagamento — não só "pedido novo"). App de antes ignora. */
function avisarOApp(
  client: any,
  pedidoId: string,
  notificacao: { title?: unknown; body?: unknown },
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    if (typeof client.postMessage !== "function") return resolve(false);
    let canal: MessageChannel;
    try {
      canal = new MessageChannel();
    } catch {
      return resolve(false);
    }
    const encerrar = (respondeu: boolean) => {
      clearTimeout(limite);
      canal.port1.onmessage = null;
      canal.port1.close();
      resolve(respondeu);
    };
    const limite = setTimeout(
      () => encerrar(false),
      ESPERA_DA_RESPOSTA_DO_APP_MS,
    );
    canal.port1.onmessage = () => encerrar(true);
    try {
      const mensagem: Record<string, string> = {
        tipo: TIPO_ABRIR_PEDIDO_DO_AVISO,
        pedidoId,
      };
      if (typeof notificacao.title === "string") {
        mensagem.titulo = notificacao.title;
      }
      if (typeof notificacao.body === "string") {
        mensagem.corpo = notificacao.body;
      }
      client.postMessage(mensagem, [canal.port2]);
    } catch {
      encerrar(false);
    }
  });
}

sw.addEventListener("notificationclick", (event: any) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "/";

  event.waitUntil(
    sw.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList: any) => {
        let absoluteUrl = new URL("/", sw.location.origin);
        try {
          const destino = new URL(targetUrl, absoluteUrl);
          if (destino.origin === absoluteUrl.origin) absoluteUrl = destino;
        } catch {
          // Endereço malformado: mantém a vitrine como destino.
        }
        // Laudo #2 (P-7): as janelas vivem em /?source=pwa (start_url do
        // manifest) e o alvo padrão é "/" — a comparação de URL inteira
        // nunca batia e TODO toque abria uma segunda janela da loja.
        // Comparar o CAMINHO (mesma origem) foca a janela que já existe.
        // Aviso de pedido (`/order-details?id=X`): janela já nesse caminho mas
        // com OUTRO pedido é navegada até o do aviso (só focar a deixava no
        // pedido errado). A decisão pura mora em `alvo-do-aviso.ts`.
        const janelas = clientList.filter((c: any) => "focus" in c);
        const decisao = decidirToqueNoAviso(
          absoluteUrl.href,
          janelas.map((c: any) => c.url),
        );
        const abrirJanelaNova = () =>
          sw.clients.openWindow
            ? sw.clients.openWindow(absoluteUrl.href)
            : undefined;
        if (decisao.acao === "focar") {
          return janelas[decisao.indice].focus();
        }
        const navegarJanela = (client: any) => {
          if (typeof client.navigate !== "function") return abrirJanelaNova();
          // `navigate` só vale para janela controlada por este SW; se
          // rejeitar, cai na janela nova (o mesmo destino, nunca a vitrine).
          return Promise.resolve(client.navigate(absoluteUrl.href)).then(
            (navegada: any) => (navegada ?? client).focus(),
            abrirJanelaNova,
          );
        };
        if (decisao.acao === "navegar") {
          return navegarJanela(janelas[decisao.indice]);
        }
        if (decisao.acao === "avisar-app") {
          // Painel de pedidos: navegar recarrega a janela e apaga a anotação
          // ou o rastreio digitados e ainda não salvos. Foca primeiro (o
          // `focus` só vale enquanto o toque está sendo tratado) e pede ao
          // APP que abra o pedido por dentro — ele decide se pode. Sem
          // resposta (app de antes desta mudança, aba travada), faz o que
          // sempre fez: navega.
          const client = janelas[decisao.indice];
          return Promise.resolve(client.focus())
            .catch(() => undefined)
            .then(() =>
              avisarOApp(client, decisao.pedidoId, event.notification),
            )
            .then((respondeu) =>
              respondeu ? undefined : navegarJanela(client),
            );
        }
        return abrirJanelaNova();
      }),
  );
});

/**
 * O navegador trocou a inscrição de push sozinho. Sem isto o próximo aviso ia
 * para o endereço velho, dava 410 e a linha era apagada no servidor: a
 * lojista ficava sem aviso até abrir o painel. Reinscreve com a MESMA chave
 * da inscrição antiga (o Firefox às vezes já entrega a nova pronta) e chama
 * as janelas abertas para GRAVAR — o SW não tem a sessão que a RLS de
 * `push_subscriptions` exige (ver `troca-da-inscricao-de-push.ts`). Sem a
 * chave antiga não se inventa outra: a janela inscreve com a chave da loja.
 * Nada aqui rejeita: falhar ao reinscrever ainda chama as janelas.
 */
async function renovarInscricaoDePush(event: any): Promise<void> {
  const chave = event.oldSubscription?.options?.applicationServerKey;
  if (!event.newSubscription && chave) {
    try {
      await sw.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: chave,
      });
    } catch (e) {
      console.warn("[SW] Não foi possível renovar a inscrição de push:", e);
    }
  }
  try {
    const janelas = await sw.clients.matchAll({
      type: "window",
      includeUncontrolled: true,
    });
    for (const janela of janelas) {
      try {
        janela.postMessage({ tipo: TIPO_INSCRICAO_DE_PUSH_TROCOU });
      } catch {
        // Janela fechando: as outras ainda são chamadas.
      }
    }
  } catch (e) {
    console.warn("[SW] Não foi possível chamar as janelas abertas:", e);
  }
}

sw.addEventListener("pushsubscriptionchange", (event: any) => {
  event.waitUntil(renovarInscricaoDePush(event));
});

/**
 * Busca a foto pública do Storage de um jeito que dê para GUARDAR
 * (pwa-performance-3, 23/10/2026).
 *
 * `<img>` sem `crossorigin` (a foto da vitrine, LazyImage) chega ao SW como
 * pedido `no-cors`, e `fetch(event.request)` devolve uma resposta OPACA
 * (`status` 0): o ramo do Storage só guarda `status === 200`, então quase
 * nenhuma foto entrava na gaveta e quem ficava sem sinal via a grade em
 * branco. Aqui o pedido é refeito em modo `cors` — o Storage público responde
 * `Access-Control-Allow-Origin: *` (medido nas duas lojas, objeto e render) —
 * SEM credenciais (com cookie o `*` não vale e o CORS falharia). O
 * `Request(request, init)` copia o resto, em especial o `Accept`: o endpoint
 * de render escolhe WebP/AVIF por ele. Uma resposta `cors` serve a um pedido
 * `no-cors` normalmente; o contrário (opaca para um pedido cors) é que o
 * navegador recusa.
 *
 * Só `<img>` (destination "image"): vídeo/áudio mandam `Range` e o 206 não se
 * guarda. Qualquer coisa que a via cors não entregue limpa (rede, CORS,
 * status != 200) cai no `fetch(request)` de sempre — o comportamento de antes,
 * nunca pior. A resposta opaca segue fora da gaveta (o `status === 200` do
 * chamador a barra): cada uma contaria ~7 MB da cota no Chrome.
 */
async function buscarFotoDoStorage(request: Request): Promise<Response> {
  if (request.mode === "no-cors" && request.destination === "image") {
    try {
      const comCors = await fetch(
        new Request(request, { mode: "cors", credentials: "omit" }),
      );
      if (comCors.status === 200 && comCors.type === "cors") return comCors;
    } catch (err) {
      console.warn("[SW] Foto via cors falhou, usando o pedido original:", err);
    }
  }
  return fetch(request);
}

async function cleanOldImageCache(cache: Cache) {
  try {
    const keys = await cache.keys();
    if (keys.length > MAX_IMAGE_ENTRIES) {
      const keysToDelete = keys.slice(0, keys.length - MAX_IMAGE_ENTRIES);
      for (const key of keysToDelete) {
        console.log("[SW] Cache limit reached. Deleting old image:", key.url);
        await cache.delete(key);
      }
    }
  } catch (e) {
    console.warn("[SW] Image cache cleaning failed:", e);
  }
}
