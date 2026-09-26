import { expect, test } from "@playwright/test";
import { URL_DO_SERVIDOR, abrirLojaPwa, esperarBootLimpo } from "./pwa-kit";

/**
 * CRITÉRIO (b) do despacho CI-PWA: página visitada carrega em modo OFFLINE.
 *
 * É o incidente #504/#515 (tela branca ao abrir/recarregar a PWA sem
 * internet) sendo caçado no CI a cada PR, no build real:
 *  · 1º carregamento online: o SW registra, instala o precache;
 *  · 2º carregamento (reload, agora CONTROLADO pelo SW): o handler de
 *    navegação do sw.ts grava o HTML da rota no `app-cache-*` (revalidação);
 *  · rede CORTADA (`context.setOffline(true)`) e reload: a navegação é
 *    respondida DO CACHE — o reload resolve 200 (sem SW de cache-first ele
 *    morreria com net::ERR_INTERNET_DISCONNECTED) e o app boota inteiro.
 */

test("a página visitada carrega sem rede, servida pelo cache do service worker", async ({
  page,
  request,
  context,
}) => {
  await request.post(`${URL_DO_SERVIDOR}/__pwa__/resetar`, {
    data: { dist: "dist-v1" },
  });

  // 1º carregamento: boot online, SW ativo, precache pronto.
  await abrirLojaPwa(page);
  await expect
    .poll(
      async () =>
        page.evaluate(
          async () =>
            (await caches.keys()).filter((n) => n.startsWith("app-cache-"))
              .length,
        ),
      { timeout: 30_000 },
    )
    .toBe(1);

  // 2º carregamento: confirme que o SW já controla a página antes do reload.
  await expect
    .poll(() =>
      page.evaluate(() => Boolean(navigator.serviceWorker.controller)),
    )
    .toBe(true);
  await page.reload();
  await esperarBootLimpo(page);
  // O cache existir não garante que a navegação já foi gravada nele.
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const nome = (await caches.keys()).find((n) =>
            n.startsWith("app-cache-"),
          );
          if (!nome) return undefined;
          const cache = await caches.open(nome);
          return (await cache.match(location.href))?.status;
        }),
      { timeout: 10_000 },
    )
    .toBe(200);

  // Corta a rede de verdade e recarrega: a resposta TEM de vir do cache.
  await context.setOffline(true);
  const resposta = await page.reload();
  expect(
    resposta?.status(),
    "a navegação offline foi respondida pelo service worker",
  ).toBe(200);

  // O app boota inteiro offline: estrutura montada, guardian saiu, nenhum
  // portão de ambiente preso — a tela branca do #504 não existe aqui.
  await esperarBootLimpo(page);
  await expect(page.locator("#root > *").first()).toBeVisible();

  // E o cache segue de pé para a próxima visita.
  const cachesOffline = await page.evaluate(
    async () =>
      (await caches.keys()).filter((n) => n.startsWith("app-cache-")).length,
  );
  expect(cachesOffline).toBe(1);
});
