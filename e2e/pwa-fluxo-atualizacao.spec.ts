import {
  type APIRequestContext,
  type Page,
  expect,
  test,
} from "@playwright/test";
import {
  PRODUTO_ROUPAS,
  URL_DO_SERVIDOR,
  abrirLojaPwa,
  contarBoots,
  lerBoots,
} from "./pwa-kit";

/** Dois builds reais: publica v2, detecta pelo ciclo do SW e instala apenas
 * no ponto de parada. Nenhum teste clica em atualizar nem envia SKIP_WAITING:
 * ativar o worker e recarregar continuam sendo responsabilidade do app. */
const INSTALANDO = "Atualizando o app…";
const CONCLUIDA = "Pronto! App atualizado";
// Cobre a graça inicial de 8 s e o fallback de recarga de 1,2 s. Esta espera
// é a janela de observação NEGATIVA, não uma tentativa de adivinhar o boot.
const JANELA_SEM_RECARGA_MS = 10_000;

test.setTimeout(120_000);

async function abrirVersaoUm(page: Page, request: APIRequestContext) {
  const reset = await request.post(`${URL_DO_SERVIDOR}/__pwa__/resetar`, {
    data: { dist: "dist-v1" },
  });
  expect(reset.ok()).toBe(true);
  await contarBoots(page);
  await page.addInitScript(() => {
    const motivo = localStorage.getItem("pwa_reload_reason");
    if (motivo) sessionStorage.setItem("__pwa_motivo_visto", motivo);

    // O controllerchange pode recarregar antes do próximo poll do Playwright.
    // Fotografa o texto renderizado por role, inclusive durante a instalação,
    // sem atrasar o SW nem alterar estado/timers do app. O registro atravessa
    // o reload; o observador nasce novamente em cada documento.
    const registrar = (chave: string, texto: string) => {
      const vistos = JSON.parse(
        sessionStorage.getItem(chave) ?? "[]",
      ) as string[];
      if (!vistos.includes(texto)) {
        sessionStorage.setItem(chave, JSON.stringify([...vistos, texto]));
      }
    };
    const observar = () => {
      for (const regiao of document.querySelectorAll('[role="status"]')) {
        const texto = regiao.textContent?.trim();
        if (
          texto !== "Atualizando o app…" &&
          texto !== "Pronto! App atualizado"
        ) {
          continue;
        }
        // A região usa display:contents; mede o conteúdo, não o wrapper.
        const faixa = document.createRange();
        faixa.selectNodeContents(regiao);
        const caixa = faixa.getBoundingClientRect();
        if (
          caixa.width > 0 &&
          caixa.height > 0 &&
          getComputedStyle(regiao).visibility !== "hidden"
        )
          registrar("__pwa_ilhas_vistas", texto);
      }
      for (const botao of document.querySelectorAll(
        'button, [role="button"]',
      )) {
        const nome = (
          botao.getAttribute("aria-label") ??
          botao.textContent ??
          ""
        )
          .replace(/\s+/g, " ")
          .trim();
        if (
          /^(?:agora não|depois|mais tarde|adiar(?: atualização)?|recusar(?: atualização)?|não atualizar|atualizar(?: agora)?)[.!…]?$/i.test(
            nome,
          )
        ) {
          registrar("__pwa_botoes_removidos", nome);
        }
      }
    };
    new MutationObserver(observar).observe(document, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });
  });

  const errosNoFim = await abrirLojaPwa(page);
  // Precache criado não basta: aguarda activate/clients.claim antes do deploy.
  await expect
    .poll(
      () => page.evaluate(() => navigator.serviceWorker.controller !== null),
      { timeout: 30_000, message: "o SW da v1 controla esta aba" },
    )
    .toBe(true);
  const resposta = await request.get(`${URL_DO_SERVIDOR}/version.json`);
  expect(resposta.ok()).toBe(true);
  const { version: versao } = (await resposta.json()) as { version: string };
  await expect
    .poll(() => page.evaluate(() => caches.keys()), { timeout: 30_000 })
    .toContain(`app-cache-${versao}`);
  await page.evaluate(() => {
    const janela = window as typeof window & { __pwa_sem_recarga?: string };
    janela.__pwa_sem_recarga = "documento-da-v1";
  });
  expect(await lerBoots(page)).toBe(1);
  return { versao, errosNoFim };
}

async function abrirProduto(page: Page) {
  await page
    .getByRole("button", { name: PRODUTO_ROUPAS, exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("button", { name: "Adicionar ao Carrinho" }),
  ).toBeVisible({ timeout: 30_000 });
}

async function voltarAoInicio(page: Page) {
  await page
    .getByRole("button", { name: "Ir para o Início", exact: true })
    .click();
}

async function aquecerProduto(page: Page) {
  // O servidor troca o dist inteiro. Abre o lazy da v1 ANTES do deploy, para
  // a navegação não virar um teste de recuperação de chunk velho ausente.
  await abrirProduto(page);
  await voltarAoInicio(page);
  await expect(
    page.getByRole("button", { name: PRODUTO_ROUPAS, exact: true }).first(),
  ).toBeVisible();
}

async function publicarVersaoDois(
  page: Page,
  request: APIRequestContext,
  versaoUm: string,
) {
  const troca = await request.post(`${URL_DO_SERVIDOR}/__pwa__/trocar`, {
    data: { dist: "dist-v2" },
  });
  expect(troca.ok()).toBe(true);
  const resposta = await request.get(`${URL_DO_SERVIDOR}/version.json`);
  expect(resposta.ok()).toBe(true);
  const { version: versao } = (await resposta.json()) as { version: string };
  expect(versao).not.toBe(versaoUm);

  // O mesmo gesto do poll de produção: não força a ativação do SW.
  await page.evaluate(async () => {
    const registro = await navigator.serviceWorker.getRegistration();
    if (!registro?.active) throw new Error("SW da v1 não está ativo");
    await registro.update();
  });
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const registro = await navigator.serviceWorker.getRegistration();
          return registro?.waiting?.state === "installed";
        }),
      {
        timeout: 30_000,
        message: "a v2 está pronta, esperando o ponto de parada",
      },
    )
    .toBe(true);
  return versao;
}

async function exigirInterfaceUnica(page: Page) {
  await expect(
    page.getByText("Há uma versão nova do app.", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText(/nova versão disponível/i)).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: /^(?:atualizar(?: agora)?|agora não|depois|mais tarde|adiar(?: atualização)?|recusar(?: atualização)?|não atualizar)[.!…]?$/i,
      includeHidden: true,
    }),
  ).toHaveCount(0);
}

async function exigirQueNaoRecarregou(page: Page) {
  expect(await lerBoots(page), "o mesmo documento da v1 continua vivo").toBe(1);
  expect(
    await page.evaluate(() => {
      const janela = window as typeof window & { __pwa_sem_recarga?: string };
      return janela.__pwa_sem_recarga;
    }),
  ).toBe("documento-da-v1");
  await expect(
    page.getByRole("status").filter({ hasText: INSTALANDO }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("status").filter({ hasText: CONCLUIDA }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(() => sessionStorage.getItem("__pwa_ilhas_vistas")),
  ).toBeNull();
  expect(
    await page.evaluate(
      async () =>
        (await navigator.serviceWorker.getRegistration())?.waiting?.state,
    ),
  ).toBe("installed");
  await exigirInterfaceUnica(page);
}

async function mudarVisibilidade(page: Page, estado: DocumentVisibilityState) {
  // Apenas nesta vida do documento: o reload volta à visibilidade real.
  await page.evaluate((visibilidade) => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: visibilidade,
    });
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: visibilidade === "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  }, estado);
}

async function exigirInstalacao(page: Page, versaoDois: string) {
  await expect
    .poll(
      async () => {
        try {
          return await lerBoots(page);
        } catch {
          return 0;
        } // O contexto pode estar morrendo no reload.
      },
      {
        timeout: 30_000,
        message: "o app recarregou sozinho no ponto de parada",
      },
    )
    .toBeGreaterThan(1);

  await expect(
    page.getByRole("status").filter({ hasText: CONCLUIDA }),
  ).toBeVisible({ timeout: 45_000 });
  const ilhasVistas = await page.evaluate(
    () =>
      JSON.parse(
        sessionStorage.getItem("__pwa_ilhas_vistas") ?? "[]",
      ) as string[],
  );
  // A fase "Atualizando…" pode durar menos que um quadro antes da recarga: o
  // que o fluxo promete é a confirmação depois do boot novo.
  expect(ilhasVistas, "a ilha confirmou o novo boot").toContain(CONCLUIDA);
  expect(
    await page.evaluate(() => sessionStorage.getItem("__pwa_motivo_visto")),
  ).toBe("atualizacao-aplicada");

  // /version.json sozinho só prova o servidor. O cache nomeado pelo build
  // prova que o SW novo assumiu, e a ilha confirma a troca de build no app.
  const cachesFim = await page.evaluate(async () =>
    (await caches.keys()).filter((nome) => nome.startsWith("app-cache-")),
  );
  expect(cachesFim).toEqual([`app-cache-${versaoDois}`]);
  const versaoVistaPeloApp = await page.evaluate(async () => {
    const resposta = await fetch("/version.json", { cache: "no-store" });
    return (await resposta.json()) as { version: string };
  });
  expect(versaoVistaPeloApp.version).toBe(versaoDois);
  await exigirInterfaceUnica(page);

  // A conclusão dura cerca de 3 s; tolerância larga para máquinas de CI.
  await expect(
    page.getByRole("status").filter({ hasText: CONCLUIDA }),
  ).toHaveCount(0, { timeout: 12_000 });
  await expect(
    page.getByRole("status").filter({ hasText: INSTALANDO }),
  ).toHaveCount(0);
  await expect(page.getByText("Atualizando o Aplicativo")).toHaveCount(0);
}

test("versão nova espera a troca de tela e a ilha confirma a atualização", async ({
  page,
  request,
}) => {
  const { versao, errosNoFim } = await abrirVersaoUm(page, request);
  await aquecerProduto(page);
  const versaoDois = await publicarVersaoDois(page, request, versao);

  await page.waitForTimeout(JANELA_SEM_RECARGA_MS);
  await exigirQueNaoRecarregou(page);
  // Um clique de navegação SPA, sem goto/reload feito pelo teste.
  await page
    .getByRole("button", { name: PRODUTO_ROUPAS, exact: true })
    .first()
    .click();
  await exigirInstalacao(page, versaoDois);
  expect(errosNoFim()).toEqual([]);
});

test("versão nova instala quando o app vai para segundo plano", async ({
  page,
  request,
}) => {
  const { versao, errosNoFim } = await abrirVersaoUm(page, request);
  const versaoDois = await publicarVersaoDois(page, request, versao);
  await page.waitForTimeout(JANELA_SEM_RECARGA_MS);
  await exigirQueNaoRecarregou(page);

  await mudarVisibilidade(page, "hidden");
  await exigirInstalacao(page, versaoDois);
  expect(errosNoFim()).toEqual([]);
});

test("checkout preserva o documento ao alternar visibilidade e instala ao sair", async ({
  page,
  request,
}) => {
  const { versao, errosNoFim } = await abrirVersaoUm(page, request);
  // Fixture PWA sem variações: compra sintética até a tela, sem criar pedido.
  await abrirProduto(page);
  await page.getByRole("button", { name: "Adicionar ao Carrinho" }).click();
  await page
    .getByRole("navigation", { name: "Navegação principal" })
    .getByRole("button", { name: /Carrinho/ })
    .click();
  await page.getByRole("button", { name: "Continuar como Convidado" }).click();
  const dadosDaCompra = page.getByRole("button", {
    name: "Seus dados e entrega",
  });
  await expect(dadosDaCompra).toBeVisible({ timeout: 30_000 });

  const versaoDois = await publicarVersaoDois(page, request, versao);
  await page.waitForTimeout(JANELA_SEM_RECARGA_MS);
  await exigirQueNaoRecarregou(page);
  await mudarVisibilidade(page, "hidden");
  await page.waitForTimeout(JANELA_SEM_RECARGA_MS);
  await exigirQueNaoRecarregou(page);
  await mudarVisibilidade(page, "visible");
  await page.waitForTimeout(2_000);
  await exigirQueNaoRecarregou(page);
  await expect(dadosDaCompra).toBeVisible();

  await voltarAoInicio(page);
  await exigirInstalacao(page, versaoDois);
  expect(errosNoFim()).toEqual([]);
});

test("não oferece botão de recusar em nenhuma fase da atualização", async ({
  page,
  request,
}) => {
  const { versao, errosNoFim } = await abrirVersaoUm(page, request);
  await aquecerProduto(page);
  await exigirInterfaceUnica(page);
  const versaoDois = await publicarVersaoDois(page, request, versao);
  await page.waitForTimeout(JANELA_SEM_RECARGA_MS);
  await exigirQueNaoRecarregou(page);

  await page
    .getByRole("button", { name: PRODUTO_ROUPAS, exact: true })
    .first()
    .click();
  await exigirInstalacao(page, versaoDois);
  await exigirInterfaceUnica(page);
  // A observação contínua cobre também a fase curta de instalação, entre
  // as asserções, e não apenas o estado final depois de tudo desaparecer.
  expect(
    await page.evaluate(() =>
      JSON.parse(sessionStorage.getItem("__pwa_botoes_removidos") ?? "[]"),
    ),
  ).toEqual([]);
  expect(errosNoFim()).toEqual([]);
});
