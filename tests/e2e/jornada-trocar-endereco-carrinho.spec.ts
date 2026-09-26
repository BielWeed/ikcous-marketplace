import fs from "node:fs";
import path from "node:path";
import {
  type Locator,
  type Page,
  type TestInfo,
  devices,
  expect,
  test,
} from "@playwright/test";
import {
  PRODUTO_ACESSORIOS,
  PRODUTO_ROUPAS,
  abrirLoja,
  enderecosFixtura,
  instalarLojaFixtura,
  instalarSessaoClienteFixtura,
} from "./kit-jornadas";

/**
 * JORNADA "TROCAR O ENDEREÇO NO CARRINHO" NO CELULAR (22/09/2026, relato da
 * cliente): carrinho rolado até o fim, card "Entrega para Casa", toca TROCAR
 * — e os outros endereços e o "Novo endereço" ficavam atrás do rodapé fixo
 * Total/Finalizar e da navegação. O jsdom não pegou o defeito (não faz
 * layout); esta jornada prova a GEOMETRIA com navegador de verdade:
 *
 *  - a folha e o "Cadastrar novo endereço" ficam DENTRO da viewport;
 *  - no centro de cada endereço e do botão, o elemento que o navegador
 *    acerta (`elementFromPoint`) é o PRÓPRIO elemento — não o rodapé nem a
 *    navegação. O Radix trava `pointer-events` no body enquanto a folha está
 *    aberta, e o hit-test pula quem tem `pointer-events: none` (o rodapé e a
 *    nav herdariam isso e "sumiriam" do teste): a medição LIBERA o body só
 *    durante a leitura, para o rodapé e a nav concorrerem de verdade.
 *
 * Cliente logado FALSO (kit: sessão fictícia, endereços inventados, cotação
 * fake por CEP). Nada é gravado, nada é cobrado.
 *
 * Evidências (screenshots + medidas em JSON) vão para
 * `IKCOUS_E2E_EVIDENCIAS` se definido; senão, para a pasta de saída do teste.
 */

test.use({ ...devices["Pixel 5"], viewport: { width: 390, height: 844 } });

function pastaDeEvidencias(testInfo: TestInfo): string {
  const pasta = process.env.IKCOUS_E2E_EVIDENCIAS ?? testInfo.outputDir;
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- pasta de evidências do próprio teste (env do operador ou outputDir do Playwright), nunca entrada de usuário.
  fs.mkdirSync(pasta, { recursive: true });
  return pasta;
}

async function prepararCarrinho(page: Page, quantidadeDeEnderecos: number) {
  await instalarLojaFixtura(page);
  await instalarSessaoClienteFixtura(page, {
    enderecos: enderecosFixtura(quantidadeDeEnderecos),
  });
  const errosNoFim = await abrirLoja(page);

  // DOIS itens (o Boné entra direto; a Camiseta pela folha de opções): o
  // carrinho passa da altura da tela, como no relato — o card de frete só
  // chega à vista rolando até o fim.
  const cardDo = (nome: string) =>
    page
      .locator("div.group")
      .filter({ has: page.getByRole("button", { name: nome, exact: true }) })
      .first();
  await cardDo(PRODUTO_ACESSORIOS).getByTestId("product-card-action").click();
  await cardDo(PRODUTO_ROUPAS).getByTestId("product-card-action").click();
  const folhaDeOpcoes = page.getByTestId("product-card-options-sheet");
  await expect(folhaDeOpcoes).toBeVisible();
  await folhaDeOpcoes.getByRole("button", { name: "M", exact: true }).click();
  await page.getByTestId("product-card-options-add").click();
  await folhaDeOpcoes.getByTestId("product-card-options-handle").click();
  await expect(folhaDeOpcoes).toBeHidden();

  await page
    .getByRole("navigation", { name: "Navegação principal" })
    .getByRole("button", { name: /Carrinho/ })
    .click();
  await expect(page.getByText("Entrega para Casa").first()).toBeVisible({
    timeout: 30_000,
  });
  // Cotação fake do CEP principal: entrega local de R$ 10.
  await expect(page.getByText("Entrega local").first()).toBeVisible({
    timeout: 30_000,
  });
  // No celular o rodapé fixo diz só "Finalizar".
  await expect(page.getByRole("button", { name: /^Finalizar/ })).toBeVisible({
    timeout: 30_000,
  });
  return errosNoFim;
}

async function rolarAteOFim(page: Page) {
  await page.evaluate(() => {
    window.scrollTo(0, document.documentElement.scrollHeight);
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("*"))) {
      const estilo = getComputedStyle(el);
      if (
        /(auto|scroll)/.test(estilo.overflowY) &&
        el.scrollHeight > el.clientHeight
      ) {
        el.scrollTop = el.scrollHeight;
      }
    }
  });
  // Deixa o scroll assentar antes do toque.
  await page.waitForTimeout(300);
}

function seletorDeEndereco(page: Page): Locator {
  return page.getByRole("dialog", { name: "Entregar em" });
}

async function esperarFolhaParada(folha: Locator) {
  await expect(folha).toBeVisible();
  await folha.evaluate((el) =>
    Promise.all(
      el
        .getAnimations({ subtree: true })
        .map((a) => a.finished.catch(() => {})),
    ),
  );
}

type Caixa = { x: number; y: number; w: number; h: number; bottom: number };
type Acerto = {
  alvo: string;
  caixa: Caixa;
  dentroDaViewport: boolean;
  elementoNoTopoEOProprio: boolean;
  quemEstaNoTopo: string;
};
type Medidas = {
  viewport: { w: number; h: number };
  folha: Caixa | null;
  areaQueRola: {
    caixa: Caixa;
    scrollHeight: number;
    clientHeight: number;
  } | null;
  rodapeTotalFinalizar: Caixa | null;
  navegacao: Caixa | null;
  acertos: Acerto[];
};

/**
 * Mede a folha aberta: caixas, e o hit-test no centro de cada endereço e do
 * botão de cadastrar. `pointer-events` do body é liberado SÓ durante a
 * leitura (ver cabeçalho) e restaurado em seguida.
 */
async function medirFolha(page: Page): Promise<Medidas> {
  return page.evaluate(() => {
    const vh = window.innerHeight;
    const caixa = (el: Element | null | undefined): Caixa | null => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height, bottom: r.bottom };
    };
    const descrever = (el: Element | null) =>
      el
        ? `${el.tagName.toLowerCase()}${el.getAttribute("data-slot") ? `[data-slot=${el.getAttribute("data-slot")}]` : ""} "${(el.textContent ?? "").trim().slice(0, 40)}"`
        : "nada";

    const pointerEventsAntes = document.body.style.pointerEvents;
    document.body.style.pointerEvents = "auto";
    try {
      const folha = document.querySelector('[role="dialog"]');
      const lista = folha?.querySelector<HTMLElement>(
        '[data-testid="seletor-endereco-lista"]',
      );
      const alvos: { nome: string; el: Element }[] = [
        ...Array.from(folha?.querySelectorAll('[role="button"]') ?? []).map(
          (el) => ({
            nome: `endereço ${(el.textContent ?? "").slice(0, 20)}`,
            el,
          }),
        ),
        ...Array.from(folha?.querySelectorAll("button") ?? [])
          .filter((b) => b.textContent?.includes("Cadastrar novo endereço"))
          .map((el) => ({ nome: "cadastrar novo endereço", el })),
      ];
      const acertos = alvos
        .map(({ nome, el }) => {
          const c = caixa(el) as Caixa;
          const cx = c.x + c.w / 2;
          const cy = c.y + c.h / 2;
          const dentro = c.y >= 0 && c.bottom <= vh;
          // Centro fora da parte visível da área que rola não conta como
          // "coberto": é a lista rolável funcionando (medido à parte).
          const visivelNaLista =
            !lista ||
            !lista.contains(el) ||
            (cy >= lista.getBoundingClientRect().top &&
              cy <= lista.getBoundingClientRect().bottom);
          if (!visivelNaLista) return null;
          const topo = document.elementFromPoint(cx, cy);
          return {
            alvo: nome,
            caixa: c,
            dentroDaViewport: dentro,
            elementoNoTopoEOProprio:
              !!topo && (topo === el || el.contains(topo)),
            quemEstaNoTopo: descrever(topo),
          };
        })
        .filter((a): a is Acerto => a !== null);

      const rodape = Array.from(
        document.querySelectorAll(".bottom-docked-navigation"),
      ).find((e) => e.textContent?.includes("Finalizar"));
      return {
        viewport: { w: window.innerWidth, h: vh },
        folha: caixa(folha),
        areaQueRola: lista
          ? {
              caixa: caixa(lista) as Caixa,
              scrollHeight: lista.scrollHeight,
              clientHeight: lista.clientHeight,
            }
          : null,
        rodapeTotalFinalizar: caixa(rodape),
        navegacao: caixa(
          document.querySelector('nav[aria-label="Navegação principal"]'),
        ),
        acertos,
      };
    } finally {
      document.body.style.pointerEvents = pointerEventsAntes;
    }
  });
}

function exigirFolhaPorCima(medidas: Medidas, enderecosEsperados: number) {
  const { viewport, folha, acertos } = medidas;
  expect(folha).not.toBeNull();
  expect(folha?.y ?? -1).toBeGreaterThanOrEqual(0);
  expect(folha?.bottom ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(
    viewport.h + 0.5,
  );
  const cadastrar = acertos.find((a) => a.alvo === "cadastrar novo endereço");
  expect(cadastrar, "o botão de cadastrar tem de ser medido").toBeDefined();
  expect(acertos.filter((a) => a.alvo.startsWith("endereço")).length).toBe(
    enderecosEsperados,
  );
  for (const acerto of acertos) {
    expect(acerto.dentroDaViewport, `${acerto.alvo} dentro da tela`).toBe(true);
    expect(
      acerto.elementoNoTopoEOProprio,
      `${acerto.alvo}: no topo está ${acerto.quemEstaNoTopo}`,
    ).toBe(true);
  }
}

function gravarMedidas(pasta: string, nome: string, dados: unknown) {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- mesmo caminho de evidências acima, com nome fixo por caso.
  fs.writeFileSync(
    path.join(pasta, `medidas-${nome}.json`),
    JSON.stringify(dados, null, 2),
  );
}

test("UM endereço: Trocar abre a folha por cima dos rodapés, com o endereço e o 'Cadastrar novo endereço'", async ({
  page,
}, testInfo) => {
  const pasta = pastaDeEvidencias(testInfo);
  const errosNoFim = await prepararCarrinho(page, 1);

  await rolarAteOFim(page);
  await page.screenshot({ path: path.join(pasta, "antes-do-toque.png") });

  const trocar = page.getByRole("button", { name: "Trocar", exact: true });
  await expect(trocar).toHaveAttribute("aria-haspopup", "dialog");
  await trocar.tap();
  const folha = seletorDeEndereco(page);
  await esperarFolhaParada(folha);
  await page.screenshot({ path: path.join(pasta, "sheet-1-endereco.png") });

  const medidas = await medirFolha(page);
  gravarMedidas(pasta, "sheet-1-endereco", medidas);
  exigirFolhaPorCima(medidas, 1);

  // Cadastrar a partir da folha leva ao formulário de endereço (a folha
  // fecha antes). Nada é preenchido nem salvo.
  await folha.getByRole("button", { name: /Cadastrar novo endereço/ }).tap();
  await expect(folha).toBeHidden();
  await expect(page.getByText("Novo Endereço").first()).toBeVisible({
    timeout: 30_000,
  });

  expect(errosNoFim().erros).toEqual([]);
});

test("TRÊS endereços: fechar e reabrir; escolher outro fecha a folha e o card recota para o novo CEP", async ({
  page,
}, testInfo) => {
  const pasta = pastaDeEvidencias(testInfo);
  const errosNoFim = await prepararCarrinho(page, 3);
  await rolarAteOFim(page);

  const trocar = page.getByRole("button", { name: "Trocar", exact: true });
  await trocar.tap();
  const folha = seletorDeEndereco(page);
  await esperarFolhaParada(folha);
  await page.screenshot({ path: path.join(pasta, "sheet-3-enderecos.png") });
  const medidas = await medirFolha(page);
  gravarMedidas(pasta, "sheet-3-enderecos", medidas);
  exigirFolhaPorCima(medidas, 3);

  // Fechar pelo X e reabrir.
  await folha.getByRole("button", { name: "Fechar" }).tap();
  await expect(folha).toBeHidden();
  await trocar.tap();
  await esperarFolhaParada(folha);
  await expect(folha.getByRole("button")).toHaveCount(3 + 2); // 3 cartões + cadastrar + X

  // Escolhe o Trabalho (CEP 01101-000 → PAC de R$ 21,00 na cotação fake).
  await folha.getByRole("button", { name: /^Trabalho/ }).tap();
  await expect(folha).toBeHidden();
  const regiao = page.getByRole("region", { name: "Entrega e frete" });
  await expect(regiao).toContainText("Entrega para Trabalho");
  await expect(regiao).toContainText("PAC");
  await expect(regiao).toContainText("R$ 21,00");
  await expect(regiao).not.toContainText("Entrega local");
  await page.screenshot({ path: path.join(pasta, "apos-selecao.png") });

  // Reabrir: o escolhido agora é o Trabalho.
  await trocar.tap();
  await esperarFolhaParada(folha);
  await expect(folha.getByRole("button", { name: /^Trabalho/ })).toContainText(
    "Selecionado",
  );

  expect(errosNoFim().erros).toEqual([]);
});

test("DOZE endereços: a lista rola dentro da folha e o 'Cadastrar novo endereço' segue visível e no topo sem rolar", async ({
  page,
}, testInfo) => {
  const pasta = pastaDeEvidencias(testInfo);
  const errosNoFim = await prepararCarrinho(page, 12);
  await rolarAteOFim(page);

  await page.getByRole("button", { name: "Trocar", exact: true }).tap();
  const folha = seletorDeEndereco(page);
  await esperarFolhaParada(folha);
  await page.screenshot({ path: path.join(pasta, "sheet-lista-longa.png") });

  const inicio = await medirFolha(page);
  expect(inicio.areaQueRola).not.toBeNull();
  // A lista é mais alta do que a área: ela ROLA (e a folha não passa da tela).
  expect(inicio.areaQueRola?.scrollHeight ?? 0).toBeGreaterThan(
    inicio.areaQueRola?.clientHeight ?? 0,
  );
  const cadastrarNoInicio = inicio.acertos.find(
    (a) => a.alvo === "cadastrar novo endereço",
  );
  expect(cadastrarNoInicio?.dentroDaViewport).toBe(true);
  expect(
    cadastrarNoInicio?.elementoNoTopoEOProprio,
    `no topo está ${cadastrarNoInicio?.quemEstaNoTopo}`,
  ).toBe(true);
  for (const acerto of inicio.acertos) {
    expect(
      acerto.elementoNoTopoEOProprio,
      `${acerto.alvo}: no topo está ${acerto.quemEstaNoTopo}`,
    ).toBe(true);
  }

  // Rola a LISTA até o fim: o último endereço aparece e o botão continua lá.
  await folha
    .getByTestId("seletor-endereco-lista")
    .evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await page.waitForTimeout(200);
  const fim = await medirFolha(page);
  const ultimo = fim.acertos.find((a) => a.alvo.includes("Depósito"));
  expect(
    ultimo,
    "o 12º endereço aparece depois de rolar a lista",
  ).toBeDefined();
  expect(ultimo?.elementoNoTopoEOProprio).toBe(true);
  const cadastrarNoFim = fim.acertos.find(
    (a) => a.alvo === "cadastrar novo endereço",
  );
  expect(cadastrarNoFim?.caixa.y).toBeCloseTo(
    cadastrarNoInicio?.caixa.y ?? 0,
    0,
  );
  expect(cadastrarNoFim?.elementoNoTopoEOProprio).toBe(true);
  gravarMedidas(pasta, "sheet-lista-longa", { inicio, fim });

  expect(errosNoFim().erros).toEqual([]);
});
