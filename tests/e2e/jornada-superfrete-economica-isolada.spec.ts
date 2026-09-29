import fs from "node:fs";
import path from "node:path";
import {
  type Page,
  type TestInfo,
  devices,
  expect,
  test,
} from "@playwright/test";
import {
  type EnderecoFixtura,
  PRODUTO_ROUPAS,
  abrirLoja,
  instalarLojaFixtura,
  instalarSessaoClienteFixtura,
} from "./kit-jornadas";

/**
 * VALIDAÇÃO VISUAL ISOLADA — SuperFrete 1.5.6 ("Entrega econômica" = PAC ou
 * Mini Envios, o mais barato). ISOLADA: loja fixture do kit, cliente logado
 * FALSO, produtos de TESTE fictícios, nenhuma rede externa, nenhum banco,
 * nada gravado e nada cobrado. Não é o carrinho de nenhuma loja real.
 *
 * As respostas de `calculate-shipping` abaixo NÃO foram escritas à mão: saíram
 * do handler REAL da edge 1.5.6 (worktree), alimentado com as respostas BRUTAS
 * da API da SuperFrete gravadas na auditoria de 22/09/2026
 * (Temp/ikcous-superfrete-auditoria/), com dublês locais de banco e de fetch
 * (script `Temp/ikcous-superfrete-mini/visual/gerar-respostas-da-edge.ts`):
 *   - tênis de teste 10×10×6, 0,1 kg -> resposta real B (6 cm, SEM o Mini):
 *     econômica = PAC 25,31 (8 dias) + expressa SEDEX 52,59 (4 dias);
 *   - estojo de teste 16×11×4, 0,1 kg -> resposta real "controle-16x11x4":
 *     econômica = Mini Envios 19,01 (11 dias) + expressa SEDEX 52,59.
 * As mesmas respostas reais são fixtures do index_test.ts da edge.
 *
 * Screenshots vão para `IKCOUS_E2E_EVIDENCIAS` se definido; senão, para a
 * pasta de saída do teste.
 */

test.use({ ...devices["Pixel 5"], viewport: { width: 390, height: 844 } });

const TENIS = "Tênis de Teste 6 cm";
const ESTOJO = "Estojo de Teste 4 cm";

/** Saída do handler real da edge 1.5.6 (ver cabeçalho). */
const RESPOSTA_DA_EDGE: Record<string, unknown> = {
  "teste-tenis-6cm": {
    options: [
      {
        id: "superfrete-1",
        name: "Entrega econômica",
        price: 25.31,
        deliveryDays: 8,
        provider: "superfrete",
        cotacaoSf: 2,
      },
      {
        id: "superfrete-2",
        name: "Entrega expressa",
        price: 52.59,
        deliveryDays: 4,
        provider: "superfrete",
        cotacaoSf: 2,
      },
    ],
    cotacaoIncompleta: false,
  },
  "teste-estojo-4cm": {
    options: [
      {
        id: "superfrete-17",
        name: "Entrega econômica",
        price: 19.01,
        deliveryDays: 11,
        provider: "superfrete",
        cotacaoSf: 2,
      },
      {
        id: "superfrete-2",
        name: "Entrega expressa",
        price: 52.59,
        deliveryDays: 4,
        provider: "superfrete",
        cotacaoSf: 2,
      },
    ],
    cotacaoIncompleta: false,
  },
};

// Endereço FICTÍCIO fora da cidade da loja (a cotação é de transportadora).
const ENDERECO_DE_FORA: EnderecoFixtura[] = [
  {
    id: "00000000-0000-4000-8000-0000000ad156",
    name: "Casa",
    cep: "01015-070",
    street: "Rua Fictícia de Teste",
    number: "10",
    neighborhood: "Bairro Inventado",
    city: "São Paulo",
    state: "SP",
    is_default: true,
  },
];

const IMAGEM = `https://jornadase2efixture01.supabase.co/storage/v1/object/public/branding/v1/${"a".repeat(64)}/header.png`;

function produtoDeTeste(id: string, nome: string, preco: number) {
  return {
    id,
    nome,
    descricao: "Produto FICTÍCIO de teste da validação visual 1.5.6.",
    preco_venda: preco,
    categoria: "Roupas",
    estoque: 5,
    ativo: true,
    frete_gratis: false,
    is_bestseller: false,
    data_cadastro: "2026-09-22T00:00:00.000Z",
    ultima_atualizacao: "2026-09-22T00:00:00.000Z",
    imagem_urls: [IMAGEM],
    sold: 0,
    rating: 5,
    review_count: 0,
    tags: [],
    product_variants: [],
  };
}

function pastaDeEvidencias(testInfo: TestInfo): string {
  const pasta = process.env.IKCOUS_E2E_EVIDENCIAS ?? testInfo.outputDir;
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- pasta de evidências do próprio teste (env do operador ou outputDir do Playwright), nunca entrada de usuário.
  fs.mkdirSync(pasta, { recursive: true });
  return pasta;
}

async function prepararLoja(page: Page) {
  await instalarLojaFixtura(page);
  await instalarSessaoClienteFixtura(page, { enderecos: ENDERECO_DE_FORA });
  // Registradas POR ÚLTIMO = têm precedência sobre as rotas do kit.
  // Sem `rota.fetch()`: ele sairia para a rede. A camiseta do kit entra de
  // novo aqui porque `abrirLoja` espera vê-la no boot.
  await page.route("**/rest/v1/vw_produtos_public*", async (rota) => {
    await rota.fulfill({
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify([
        produtoDeTeste("jornada-produto-roupas", PRODUTO_ROUPAS, 50),
        produtoDeTeste("teste-tenis-6cm", TENIS, 59.9),
        produtoDeTeste("teste-estojo-4cm", ESTOJO, 39.9),
      ]),
    });
  });
  await page.route("**/functions/v1/calculate-shipping", async (rota) => {
    const corpo = rota.request().postDataJSON() as {
      cart?: Array<{ product?: { id?: string }; productId?: string }>;
    } | null;
    const id =
      corpo?.cart?.[0]?.product?.id ?? corpo?.cart?.[0]?.productId ?? "";
    const resposta = new Map(Object.entries(RESPOSTA_DA_EDGE)).get(id) ?? {
      options: [],
      cotacaoIncompleta: false,
    };
    await rota.fulfill({
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(resposta),
    });
  });
}

async function levarAoCarrinho(page: Page, produto: string) {
  const card = page
    .locator("div.group")
    .filter({ has: page.getByRole("button", { name: produto, exact: true }) })
    .first();
  await card.getByTestId("product-card-action").click();
  await page
    .getByRole("navigation", { name: "Navegação principal" })
    .getByRole("button", { name: /Carrinho/ })
    .click();
  await expect(page.getByText("Entrega para Casa").first()).toBeVisible({
    timeout: 30_000,
  });
}

async function fotografarFrete(
  page: Page,
  testInfo: TestInfo,
  arquivo: string,
) {
  const economica = page.getByText("Entrega econômica").first();
  await economica.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await page.screenshot({
    path: path.join(pastaDeEvidencias(testInfo), arquivo),
    fullPage: false,
  });
}

test("ISOLADA — tênis de teste 6 cm: econômica PAC R$ 25,31 + expressa R$ 52,59", async ({
  page,
}, testInfo) => {
  await prepararLoja(page);
  const errosNoFim = await abrirLoja(page);
  await expect(page.getByText(PRODUTO_ROUPAS).first()).toBeVisible();
  await levarAoCarrinho(page, TENIS);

  await expect(page.getByText("Entrega econômica").first()).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText("Entrega expressa").first()).toBeVisible();
  await expect(page.getByText(/25,31/).first()).toBeVisible();
  await expect(page.getByText(/52,59/).first()).toBeVisible();
  await expect(
    page.getByText("Entrega em até 8 dias úteis").first(),
  ).toBeVisible();
  // Uma econômica só — nunca PAC e Mini lado a lado.
  await expect(page.getByText("Entrega econômica")).toHaveCount(1);
  await expect(page.getByText(/19,01/)).toHaveCount(0);

  await fotografarFrete(page, testInfo, "isolada-tenis-6cm-pac-25-31.png");
  expect(errosNoFim().erros).toEqual([]);
});

test("ISOLADA — estojo de teste 4 cm: econômica Mini R$ 19,01 em 11 dias + expressa R$ 52,59", async ({
  page,
}, testInfo) => {
  await prepararLoja(page);
  const errosNoFim = await abrirLoja(page);
  await levarAoCarrinho(page, ESTOJO);

  await expect(page.getByText("Entrega econômica").first()).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText("Entrega expressa").first()).toBeVisible();
  await expect(page.getByText(/19,01/).first()).toBeVisible();
  await expect(
    page.getByText("Entrega em até 11 dias úteis").first(),
  ).toBeVisible();
  await expect(page.getByText(/52,59/).first()).toBeVisible();
  await expect(page.getByText("Entrega econômica")).toHaveCount(1);
  // O nome do serviço não aparece para a cliente (ela vê "Entrega econômica").
  await expect(page.getByText("Mini Envios")).toHaveCount(0);
  await expect(page.getByText(/25,31/)).toHaveCount(0);

  await fotografarFrete(page, testInfo, "isolada-estojo-4cm-mini-19-01.png");
  expect(errosNoFim().erros).toEqual([]);
});
