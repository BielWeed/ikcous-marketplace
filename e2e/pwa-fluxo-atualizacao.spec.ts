import { expect, test } from "@playwright/test";
import {
  URL_DO_SERVIDOR,
  abrirLojaPwa,
  contarBoots,
  lerBoots,
} from "./pwa-kit";

/**
 * CRITÉRIO (d) do despacho CI-PWA — O FLUXO DE ATUALIZAÇÃO, com DOIS builds
 * de produção de verdade: v1 no ar → deploy v2 → o app detecta → o overlay
 * aparece → instala → o app rodando na v2, SEM pendurar.
 *
 * É a prova real-build da dor que o dono viveu na pele em 14/09 (print
 * fila-despacho/anexos/tela-atualizando-pendurada-5174.png): a tela
 * "ATUALIZANDO O APLICATIVO" ficou eterna e a versão aparecia como código
 * estranho. Aqui o portão tem `/version.json` JSON REAL (servido do dist,
 * como na produção) — em dev/preview o mesmo caminho devolvia HTML, que é
 * a causa-raiz que a peça em voo está consertando (recado 20260914-0525).
 *
 * O gatilho do teste é o MESMO gesto do poll de produção: o useUpdateCheck
 * chama `registration.update()` a cada 3 min — o teste chama uma vez, sem
 * flag nem atalho de teste.
 */

test("deploy v1→v2: overlay aparece, instala e o app acorda na v2 sem pendurar", async ({
  page,
  request,
}) => {
  await request.post(`${URL_DO_SERVIDOR}/__pwa__/resetar`, {
    data: { dist: "dist-v1" },
  });
  await contarBoots(page);
  // O app CONSUME o motivo nominal de recarga no boot (lerMotivoDeRecarga
  // apaga a chave) — para provar o motivo DEPOIS da recarga de instalação, o
  // teste fotografa o localStorage no nascimento de cada documento.
  await page.addInitScript(() => {
    const motivo = localStorage.getItem("pwa_reload_reason");
    if (motivo) {
      sessionStorage.setItem("__pwa_motivo_visto", motivo);
    }
  });

  // ── v1 no ar: boot limpo, SW ativo, precache da versão 1 ──────────────
  const errosNoFim = await abrirLojaPwa(page);
  const nomeCacheV1 = await page.evaluate(async () => {
    const nomes = (await caches.keys()).filter((n) =>
      n.startsWith("app-cache-"),
    );
    return nomes[0] ?? "";
  });
  expect(nomeCacheV1).toContain("app-cache-");

  const versionV1 = await request.get(`${URL_DO_SERVIDOR}/version.json`);
  const versaoV1 = (await versionV1.json()) as { version: string };

  // ── O deploy: dist-v2 entra no ar com version.json NOVO ───────────────
  await request.post(`${URL_DO_SERVIDOR}/__pwa__/trocar`, {
    data: { dist: "dist-v2" },
  });
  const versionV2 = await request.get(`${URL_DO_SERVIDOR}/version.json`);
  const versaoV2 = (await versionV2.json()) as { version: string };
  expect(
    versaoV2.version,
    "o deploy trocou a versão servida de verdade",
  ).not.toBe(versaoV1.version);

  // ── Detecção: o mesmo gesto do poll do useUpdateCheck ────────────────
  await page.evaluate(async () => {
    const registro = await navigator.serviceWorker.getRegistration();
    await registro?.update();
  });

  // O overlay do app (UpdateNotification) aparece com a versão nova esperando.
  await expect(
    page.getByText("Nova Versão Disponível"),
    "o overlay de atualização nasceu do ciclo do service worker",
  ).toBeVisible({ timeout: 30_000 });

  // ── Instalação: o gesto do usuário no botão do app ────────────────────
  await page.getByRole("button", { name: "Atualizar Agora" }).click();

  // SKIP_WAITING → activate (purga o cache v1) → controllerchange → reload.
  // O app recarrega SOZINHO, sem toque do teste.
  await expect
    .poll(
      async () => {
        try {
          return await lerBoots(page);
        } catch {
          return 0; // contexto morrendo no reload: tenta de novo
        }
      },
      { timeout: 30_000, message: "o app recarregou para instalar a v2" },
    )
    .toBeGreaterThan(1);

  // ── App na v2, SEM pendurar ────────────────────────────────────────────
  await expect(
    page.getByText("Atualizando o Aplicativo"),
    "a tela 'Atualizando o Aplicativo' não pode ficar eterna",
  ).toHaveCount(0);
  await expect(page.getByText("Nova Versão Disponível")).toHaveCount(0);

  // E nenhum erro de página no caminho inteiro.
  expect(errosNoFim()).toEqual([]);

  // A prova da versão, por dentro: a sonda que o próprio app usa
  // (/version.json, cache no-store) agora responde a v2…
  const versaoVistaPeloApp = await page.evaluate(async () => {
    const resposta = await fetch("/version.json", { cache: "no-store" });
    return (await resposta.json()) as { version: string };
  });
  expect(versaoVistaPeloApp.version).toBe(versaoV2.version);

  // …o motivo nominal da recarga foi o do fluxo de atualização (fotografado
  // antes do app consumir)…
  const motivoVisto = await page.evaluate(() =>
    sessionStorage.getItem("__pwa_motivo_visto"),
  );
  expect(motivoVisto).toBe("atualizacao-aplicada");

  // …e o precache que ficou de pé é o da versão NOVA: o activate do SW v2
  // purgou o cache da v1 — o app rodando está sobre o build novo.
  const cachesFim = await page.evaluate(async () =>
    (await caches.keys()).filter((n) => n.startsWith("app-cache-")),
  );
  expect(cachesFim).toHaveLength(1);
  expect(
    cachesFim[0],
    "o cache da v1 foi purgado pelo activate da v2",
  ).not.toBe(nomeCacheV1);
});
