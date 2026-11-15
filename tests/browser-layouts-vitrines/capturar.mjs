import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import puppeteer from "puppeteer";

// Saída é uma pasta temporária vazia indicada pelo operador, fora do repositório.
const saida = process.argv[2];
if (!saida || !path.isAbsolute(saida))
  throw new Error("Informe uma pasta de saída absoluta");
// eslint-disable-next-line security/detect-non-literal-fs-filename -- Saída absoluta explícita do operador; cria só o diretório do ensaio.
await fs.mkdir(saida, { recursive: true });
const browser = await puppeteer.launch({
  headless: true,
  userDataDir: path.join(saida, "perfil-descartavel"),
});
const resultado = [];
try {
  const page = await browser.newPage();
  const externos = new Set();
  const erros = [];
  page.on("pageerror", (erro) => erros.push(erro.message));
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const url = new URL(req.url());
    if (url.protocol === "data:" || url.hostname === "127.0.0.1")
      req.continue();
    else {
      externos.add(url.hostname);
      req.abort();
    }
  });
  for (const width of [390, 320]) {
    await page.setViewport({ width, height: 844, deviceScaleFactor: 1 });
    for (const layout of ["compacto", "lateral", "lateral-duplo"]) {
      for (const qtd of [1, 2]) {
        await page.evaluateOnNewDocument(
          (memoria) => {
            localStorage.setItem(
              "ikcous_home_memoria",
              JSON.stringify(memoria),
            );
          },
          {
            temBanner: false,
            temOfertas: false,
            temBestsellers: false,
            temLancamentos: true,
            gravadoEm: Date.now(),
            vitrines: { new_arrivals: { layout, qtd } },
          },
        );
        const url = `http://127.0.0.1:5197/tests/browser-layouts-vitrines/?layout=${layout}&qtd=${qtd}&atraso=1`;
        await page.goto(url, { waitUntil: "domcontentloaded" });
        await page.waitForSelector('[data-testid="esqueleto-vitrine"]');
        const antes = await page.evaluate(() => ({
          altura: document
            .querySelector('[data-testid="esqueleto-vitrine"]')
            .getBoundingClientRect().height,
          catalogoY: Array.from(document.querySelectorAll("h2"))
            .find((el) => el.textContent === "Catálogo")
            .getBoundingClientRect().y,
        }));
        await page.waitForSelector('[data-testid^="ofertas-"]');
        await page.evaluate(() => document.fonts.ready);
        const depois = await page.evaluate(() => {
          const faixa = document.querySelector('[data-testid^="ofertas-"]');
          return {
            altura: faixa.getBoundingClientRect().height,
            catalogoY: Array.from(document.querySelectorAll("h2"))
              .find((el) => el.textContent === "Catálogo")
              .getBoundingClientRect().y,
            largura: innerWidth,
            documento: document.documentElement.scrollWidth,
            titulo: faixa.querySelector("h2").textContent,
            promocaoFalsa:
              /OFF|Economiz|Super Descontos/.test(faixa.textContent) ||
              !!faixa.querySelector(".lucide-flame"),
            categorias: Array.from(
              faixa.querySelectorAll("[data-categoria-vitrine]"),
            ).map((el) => el.textContent),
          };
        });
        assert.equal(
          depois.documento,
          width,
          "home não pode rolar para os lados",
        );
        assert.equal(depois.promocaoFalsa, false);
        // Reúne TODAS as medições antes de reprovar: uma falha não esconde as outras larguras.
        const arquivo = path.join(saida, `${width}-${layout}-${qtd}.png`);
        await page.screenshot({ path: arquivo });
        resultado.push({ width, layout, qtd, antes, depois, arquivo });
      }
      await page.goto(
        `http://127.0.0.1:5197/tests/browser-layouts-vitrines/?layout=${layout}&qtd=2&semNome=1&id=personalizada`,
        { waitUntil: "networkidle0" },
      );
      const titulo = await page.$eval(
        '[data-testid^="ofertas-"] h2',
        (el) => el.textContent,
      );
      assert.equal(titulo, "Produtos selecionados");
      await page.screenshot({
        path: path.join(saida, `${width}-${layout}-sem-nome.png`),
      });
    }
  }
  assert.deepEqual(
    [...externos],
    [],
    "nenhuma fonte externa deve ser consultada",
  );
  assert.deepEqual(erros, [], "nenhum erro de JavaScript");
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Nome fechado dentro da pasta explícita de saída do ensaio.
  await fs.writeFile(
    path.join(saida, "medidas.json"),
    JSON.stringify(resultado, null, 2),
  );
  console.log(
    JSON.stringify(
      {
        capturas: 18,
        trocasSemSalto: resultado.filter(
          (r) => r.antes.catalogoY === r.depois.catalogoY,
        ).length,
        externos: [...externos],
        erros,
        resultado,
      },
      null,
      2,
    ),
  );
  for (const r of resultado) {
    assert.equal(
      r.depois.altura,
      r.antes.altura,
      `${r.width}/${r.layout}/${r.qtd}: altura esqueleto→real`,
    );
    assert.equal(r.depois.catalogoY, r.antes.catalogoY, "Catálogo não pula");
  }
} finally {
  await browser.close();
}
