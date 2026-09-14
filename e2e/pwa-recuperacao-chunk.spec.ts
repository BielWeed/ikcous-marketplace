import { expect, test } from "@playwright/test";
import {
  URL_DO_SERVIDOR,
  abrirLojaPwa,
  contarBoots,
  esperarBootLimpo,
  lerBoots,
} from "./pwa-kit";

/**
 * CRITÉRIO (c) do despacho CI-PWA: RECUPERAÇÃO DE CHUNK (#565).
 *
 * Reprodução fiel do caso real: uma aba viva rodando o build v1; um deploy
 * novo entra no ar; o chunk que a aba pede NÃO EXISTE mais no servidor
 * (hash velho sumido). O que a casa promete (src/lib/recuperacao-chunk.ts):
 * o canal global de erro engaja a ESCADA — 1º degrau é o ciclo NATURAL do
 * service worker (update() → waiting novo → SKIP_WAITING → controllerchange
 * → reload), e quem cura o mismatch é o SW novo assumindo, nunca o cache
 * vazio. O pendurar do dono (tela "Atualizando o Aplicativo" eterna) é o
 * que NÃO pode acontecer.
 *
 * O chunk vítima é um `assets/Admin*.js`: lazy, sob demanda — o boot não o
 * pede, então o desenho do teste isola o erro num único import() natural.
 */

test("aba velha com chunk sumido se recupera sozinha pelo ciclo do service worker", async ({
  page,
  request,
}) => {
  await request.post(`${URL_DO_SERVIDOR}/__pwa__/resetar`, {
    data: { dist: "dist-v1" },
  });
  await contarBoots(page);

  // Boot v1 com SW ativo e precache da versão.
  await abrirLojaPwa(page);
  const nomeCacheV1 = await page.evaluate(async () => {
    const nomes = (await caches.keys()).filter((n) =>
      n.startsWith("app-cache-"),
    );
    return nomes[0] ?? "";
  });
  expect(nomeCacheV1, "precache da v1 existia antes do incidente").toContain(
    "app-cache-",
  );

  // O deploy: dist-v2 entra no ar e o chunk escolhido SOME dele.
  const arquivos = await request.get(`${URL_DO_SERVIDOR}/__pwa__/arquivos`);
  const lista = (await arquivos.json()).arquivos as string[];
  const alvo = lista.find((arquivo) => /^\/assets\/Admin.*\.js$/.test(arquivo));
  expect(
    alvo,
    "o build tem um chunk Admin lazy para ser a vítima",
  ).toBeTruthy();

  await request.post(`${URL_DO_SERVIDOR}/__pwa__/trocar`, {
    data: { dist: "dist-v2" },
  });
  await request.post(`${URL_DO_SERVIDOR}/__pwa__/esconder`, {
    data: { arquivo: alvo },
  });

  // No caso real (#565) o poll do useUpdateCheck (a cada 3 min na aba aberta)
  // já deixou o SW novo WAITING antes do erro acontecer. Mesmo gesto aqui:
  // update() e espera o waiting nascer — é o estado do mundo quando o chunk
  // falha para o usuário de verdade.
  await page.evaluate(async () => {
    const registro = await navigator.serviceWorker.getRegistration();
    await registro?.update();
  });
  await expect
    .poll(
      () =>
        page.evaluate(
          async () =>
            (await navigator.serviceWorker.getRegistration())?.waiting !== null,
        ),
      { timeout: 30_000, message: "o SW da v2 está waiting (poll prévio)" },
    )
    .toBe(true);

  // A aba v1 pede o chunk que sumiu — um import() dinâmico real, lançado
  // FORA da promessa do evaluate para virar unhandledrejection DA PÁGINA,
  // exatamente o canal que o main.tsx instala no boot. O caminho é o da
  // lista do servidor ("/assets/…"): o import resolve contra a origem.
  await page.evaluate((arquivo) => {
    setTimeout(() => {
      void import(arquivo);
    }, 0);
  }, alvo);

  // A escada engajou: a página RECARREGA SOZINHA (ciclo do SW — controllerchange
  // → reload) sem nenhuma interação do teste.
  await expect
    .poll(
      async () => {
        try {
          return await lerBoots(page);
        } catch {
          return 0; // contexto morrendo no reload: tenta de novo
        }
      },
      { timeout: 30_000, message: "a página recarregou sozinha" },
    )
    .toBeGreaterThan(1);

  // E o boot de depois do reload é limpo — a tela do dono NÃO fica presa.
  await esperarBootLimpo(page);
  await expect(page.getByText("Atualizando o Aplicativo")).toHaveCount(0);

  // Estado da escada: a chave única gravou o engajamento (1 = ciclo do SW,
  // 2 = purge seletivo — ambos se recuperam; o que não pode é estourar).
  const guardado = await page.evaluate(() =>
    localStorage.getItem("pwa_chunk_recovery"),
  );
  expect(guardado, "a escada de recuperação engajou").toBeTruthy();
  const estado = JSON.parse(guardado ?? "{}") as { count?: number };
  expect(estado.count ?? 0).toBeGreaterThanOrEqual(1);
  expect(estado.count ?? 0).toBeLessThanOrEqual(2);

  // Quem assumiu foi o SW NOVO: o activate dele purga o cache velho — só
  // sobra UM cache app-cache-*, e ele NÃO é o da v1 (app rodando sobre v2).
  const cachesFim = await page.evaluate(async () =>
    (await caches.keys()).filter((n) => n.startsWith("app-cache-")),
  );
  expect(cachesFim).toHaveLength(1);
  expect(cachesFim[0]).not.toBe(nomeCacheV1);

  // E o que a escada promete NÃO apagar sobreviveu (aceite 7 da issue #92):
  // a ficha da loja em cache está de pé para o fallback offline.
  const identidadeViva = await page.evaluate(() =>
    caches.has("ikcous-identidade"),
  );
  expect(identidadeViva).toBe(true);
});
