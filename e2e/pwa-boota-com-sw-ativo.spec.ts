import { expect, test } from "@playwright/test";
import {
  PRODUTO_ROUPAS,
  URL_DO_SERVIDOR,
  abrirLojaPwa,
  contarBoots,
  lerBoots,
} from "./pwa-kit";

/**
 * CRITÉRIO (a) do despacho CI-PWA: o app DE PRODUÇÃO boota com o service
 * worker REGISTRADO e ATIVO.
 *
 * Provas de verdade, não de fachada:
 *  · `navigator.serviceWorker.ready` resolve (o ciclo install→activate
 *    inteiro do sw.ts v29 rodou no navegador);
 *  · o worker ativo é o `/sw.js` do build e ele CONTROLA a página (o
 *    `clients.claim()` do activate rodou);
 *  · o precache workbox existe com o nome da versão (`app-cache-…`, nome
 *    derivado de `__APP_VERSION__` assado no sw.ts) e está CHEIO de assets —
 *    é a matéria-prima do modo offline que o spec seguinte prova.
 */

test("app de produção boota com o service worker registrado, ativo e controlando", async ({
  page,
  request,
}) => {
  await request.post(`${URL_DO_SERVIDOR}/__pwa__/resetar`, {
    data: { dist: "dist-v1" },
  });
  await contarBoots(page);

  const errosNoFim = await abrirLojaPwa(page);

  // O ciclo inteiro do SW rodou: install (precache) → activate (claim).
  const sw = await page.evaluate(async () => {
    const registro = await navigator.serviceWorker.ready;
    return {
      scriptURL: registro.active?.scriptURL ?? null,
      escopo: registro.scope,
      esperando: registro.waiting !== null,
    };
  });

  expect(sw.scriptURL, "o worker ativo é o sw.js deste build").toContain(
    "/sw.js",
  );
  expect(sw.escopo, "o escopo cobre o app inteiro").toBe(`${URL_DO_SERVIDOR}/`);
  expect(sw.esperando, "não há versão pendurada no boot limpo").toBe(false);

  // O claim é assíncrono na página que registrou: o controller chega um
  // instante depois do activate — espera com prazo, não leitura única.
  await expect
    .poll(
      () => page.evaluate(() => navigator.serviceWorker.controller !== null),
      { timeout: 30_000, message: "o clients.claim() assumiu a página" },
    )
    .toBe(true);

  // O precache da versão existe e veio cheio (install cacheou os assets).
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const nomes = (await caches.keys()).filter((n) =>
            n.startsWith("app-cache-"),
          );
          if (nomes.length !== 1) return 0;
          const cache = await caches.open(nomes[0]);
          return (await cache.keys()).length;
        }),
      { timeout: 30_000, message: "precache app-cache-* pronto e cheio" },
    )
    .toBeGreaterThan(10);

  // E nada disso custou um erro de página: a jornada inteira fica limpa.
  await expect(page.getByText(PRODUTO_ROUPAS).first()).toBeVisible();
  expect(await lerBoots(page)).toBe(1);
  expect(errosNoFim()).toEqual([]);
});
