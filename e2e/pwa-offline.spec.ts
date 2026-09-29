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

  // O precache pronto (acima) NÃO prova que o SW já é o CONTROLADOR desta
  // página: `caches.open` do `install` termina antes de `activate` rodar
  // `clients.claim()` — mesma ressalva já documentada em
  // pwa-boota-com-sw-ativo.spec.ts ("o controller chega um instante depois
  // do activate — espera com prazo, não leitura única"), mas que faltava
  // aqui. Sem esperar o controller, o reload abaixo corre à frente da
  // ativação, cai direto na rede (sem passar pelo fetch handler) e NUNCA
  // grava a entrada exata da rota no cache — a navegação offline então vem
  // de um cache vazio (503) ou sem SW nenhum no controle
  // (net::ERR_INTERNET_DISCONNECTED). Corrida pré-existente (reproduzida
  // igualmente nos dois lados de #666 — sw.ts e este spec intocados no
  // diff), não regressão do PR.
  await expect
    .poll(
      () => page.evaluate(() => navigator.serviceWorker.controller !== null),
      { timeout: 30_000, message: "o clients.claim() assumiu a página" },
    )
    .toBe(true);

  // 2º carregamento: já controlado pelo SW — grava a navegação no cache.
  await page.reload();
  await esperarBootLimpo(page);

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
