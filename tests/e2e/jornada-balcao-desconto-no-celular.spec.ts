// Fechamento do balcão no celular: o valor do desconto cabe INTEIRO no campo.
//
// Defeito medido (27/11/2026, Chromium real): em tela de até 900 px de altura
// o desconto e o motivo dividem a linha, e o rótulo "Desconto (R$)" ficava ao
// LADO do campo. Em 320 px o campo sobrava com 44 px (32 px de área de texto):
// R$ 50,00 e R$ 150,00 já não cabiam, e no iPhone (campos forçados a 16 px) o
// começo do valor sumia. A lojista não via o desconto que estava dando.
//
// Não passa pelo build da loja: o spec sobe um Vite SÓ dele com a bancada
// `bancada-balcao/` (o `FechamentoDaVenda` de verdade, com pdv.css e Tailwind),
// sem banco, sem login e sem rede. O servidor de preview da config continua
// subindo, mas esta jornada não o usa.
import os from "node:os";
import path from "node:path";
import { type Page, expect, test } from "@playwright/test";
import react from "@vitejs/plugin-react";
import { type ViteDevServer, createServer } from "vite";

const RAIZ = path.resolve(import.meta.dirname, "../..");
const BANCADA = path.join(import.meta.dirname, "bancada-balcao");

let servidor: ViteDevServer;
let endereco: string;

test.beforeAll(async () => {
  servidor = await createServer({
    configFile: false,
    root: BANCADA,
    // Nenhum `.env` é lido (a pasta da bancada não tem): nada de chave real.
    envDir: BANCADA,
    cacheDir: path.join(os.tmpdir(), "ikcous-bancada-balcao-vite"),
    // O postcss.config.js da raiz liga o Tailwind (que acha o próprio config
    // e o `content` a partir da raiz: rodar o Playwright da raiz).
    css: { postcss: RAIZ },
    plugins: [react()],
    resolve: { alias: { "@": path.join(RAIZ, "src") } },
    logLevel: "warn",
    server: {
      host: "127.0.0.1",
      port: 0,
      hmr: false,
      fs: { allow: [RAIZ] },
    },
  });
  await servidor.listen();
  const local = servidor.resolvedUrls?.local[0];
  if (!local) throw new Error("o Vite da bancada não informou o endereço");
  endereco = local;
});

test.afterAll(async () => {
  await servidor?.close();
});

/** Digita o desconto como a lojista (só dígitos: a máscara põe a vírgula),
 * espera o cartão do motivo nascer e sai do campo. */
async function darDesconto(page: Page, digitos: string): Promise<void> {
  await page.goto(endereco);
  const campo = page.locator("#desconto-da-venda");
  await campo.click();
  await campo.pressSequentially(digitos);
  // O motivo só aparece depois que o desconto vira estado (~200 ms): é
  // quando o cartão do desconto perde a metade da linha.
  await expect(page.locator("#motivo-do-desconto")).toBeVisible();
  await campo.blur();
}

async function medirCampo(page: Page) {
  return page.locator("#desconto-da-venda").evaluate((campo) => {
    const input = campo as HTMLInputElement;
    return {
      valor: input.value,
      largura: Math.round(input.getBoundingClientRect().width),
      clientWidth: input.clientWidth,
      scrollWidth: input.scrollWidth,
    };
  });
}

// Altura 640: cai no `@media (max-height: 900px)`, o desenho compacto.
for (const largura of [320, 360]) {
  for (const { digitos, esperado } of [
    { digitos: "15000", esperado: "150,00" },
    { digitos: "9999999", esperado: "99.999,99" },
  ]) {
    for (const aparelho of ["Android", "iPhone"] as const) {
      test(`${largura} px, ${aparelho}: desconto de R$ ${esperado} aparece inteiro`, async ({
        page,
      }) => {
        await page.setViewportSize({ width: largura, height: 640 });
        if (aparelho === "iPhone") {
          // A regra do index.css que o iOS liga (`-webkit-touch-callout`):
          // todo campo com pelo menos 16 px, para o Safari não dar zoom.
          await page.addInitScript(() => {
            document.addEventListener("DOMContentLoaded", () => {
              const estilo = document.createElement("style");
              estilo.textContent =
                "input { font-size: max(16px, 1rem) !important; }";
              document.head.append(estilo);
            });
          });
        }
        await darDesconto(page, digitos);
        const medida = await medirCampo(page);
        console.log(`${largura} px ${aparelho}`, medida);

        expect(medida.valor).toBe(esperado);
        expect(medida.scrollWidth).toBeLessThanOrEqual(medida.clientWidth);
      });
    }
  }
}
