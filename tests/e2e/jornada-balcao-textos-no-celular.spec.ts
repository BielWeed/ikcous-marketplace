// Balcão no celular estreito com a fonte do sistema em 130%: o total, a janela
// de confirmação e a pergunta "Limpar a tela da venda?" mostram o que dizem.
//
// Defeitos medidos (27/11/2026, Chromium real, bancada `bancada-balcao-barra/`):
// 1. Rodapé (prateleira da barra de baixo): em 320 px com o texto do Android
//    em 130%, o valor "12.345,67" do total entrava 19 px por baixo do botão
//    "Fechar venda" (a coluna do total tinha 104 px e o número pedia 132).
// 2. Janela "Apagar a venda em andamento?" (R$ 12.345,67): o botão
//    "Apagar e começar outra" não quebrava linha e a janela rolava de lado
//    sem barra visível: 40 px a mais com a raiz em 130%, 70 px com o texto do
//    Android em 130%; o próprio texto da pergunta saía cortado.
// 3. Pergunta "Limpar a tela da venda?" em 320 x 568: o aviso tinha 157 px de
//    altura para 294 de conteúdo, e o foco no "Voltar" rolava o aviso até os
//    botões, escondendo o título, a pergunta e a explicação — já em 100%.
//
// Dois jeitos de "fonte 130%": a RAIZ em 130% (o que move rem: Tailwind) e o
// texto do ANDROID (Chrome com o tamanho de fonte do sistema maior multiplica
// TODO texto, px incluído — o balcão é todo em px). O segundo se imita aqui
// multiplicando o tamanho calculado de cada elemento por 1,3, uma vez, depois
// que a tela que se mede já está aberta.
//
// Não passa pelo build da loja: o spec sobe um Vite SÓ dele com a bancada
// (sem banco, sem login e sem rede), como a jornada do desconto do balcão.
import os from "node:os";
import path from "node:path";
import { type Page, expect, test } from "@playwright/test";
import react from "@vitejs/plugin-react";
import { type ViteDevServer, createServer } from "vite";

const RAIZ = path.resolve(import.meta.dirname, "../..");
const BANCADA = path.join(import.meta.dirname, "bancada-balcao-barra");

let servidor: ViteDevServer;
let endereco: string;

test.beforeAll(async () => {
  servidor = await createServer({
    configFile: false,
    root: BANCADA,
    // Nenhum `.env` é lido (a pasta da bancada não tem): nada de chave real.
    envDir: BANCADA,
    cacheDir: path.join(os.tmpdir(), "ikcous-bancada-balcao-barra-vite"),
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

type Fonte = "normal" | "raiz" | "android";

async function abrir(page: Page, fonte: Fonte, busca = ""): Promise<void> {
  if (fonte === "raiz") {
    await page.addInitScript(() => {
      document.addEventListener("DOMContentLoaded", () => {
        document.documentElement.style.fontSize = "130%";
      });
    });
  }
  await page.goto(`${endereco}${busca}`);
  await expect(page.locator(".pdv-footer")).toBeVisible();
}

/** Espera as animações terminarem (a janela abre com zoom e esmaecer): medir
 * no meio delas dava a caixa fora do lugar e o tamanho de letra de antes. */
async function assentar(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await Promise.all(
      document.getAnimations().map((a) => a.finished.catch(() => undefined)),
    );
    await new Promise((pronto) =>
      requestAnimationFrame(() => requestAnimationFrame(pronto)),
    );
  });
}

/** Texto do Android em 130%: cada elemento fica com 1,3x o tamanho que tem
 * agora. Chamar UMA vez, com a tela a medir já aberta. */
async function crescerTextoDoAndroid(page: Page): Promise<void> {
  await assentar(page);
  await page.evaluate(() => {
    // Lê todos os tamanhos ANTES de mudar algum: senão o filho herdaria o
    // tamanho já crescido do pai e cresceria duas vezes.
    const pares = [...document.querySelectorAll<HTMLElement>("body *")].map(
      (el) => [el, Number.parseFloat(getComputedStyle(el).fontSize)] as const,
    );
    for (const [el, tamanho] of pares) {
      el.style.setProperty("font-size", `${tamanho * 1.3}px`, "important");
    }
  });
}

for (const largura of [320, 360]) {
  for (const fonte of ["raiz", "android"] as const) {
    for (const { busca, etapa } of [
      { busca: "", etapa: "cupom" },
      { busca: "?etapa=fechamento", etapa: "fechamento" },
    ]) {
      test(`${largura} px, fonte ${fonte}, ${etapa}: o total não entra por baixo do botão`, async ({
        page,
      }) => {
        await page.setViewportSize({ width: largura, height: 640 });
        await abrir(page, fonte, busca);
        if (fonte === "android") await crescerTextoDoAndroid(page);
        await assentar(page);
        const medida = await page.locator(".pdv-footer").evaluate((rodape) => {
          const valor = rodape.querySelector(
            ":scope > .pdv-total:not(.pdv-muted) > strong",
          ) as HTMLElement;
          const botao = rodape.querySelector(
            ":scope > .pdv-sale-action",
          ) as HTMLElement;
          const trecho = document.createRange();
          trecho.selectNodeContents(valor);
          const texto = trecho.getBoundingClientRect();
          const caixa = botao.getBoundingClientRect();
          return {
            valor: valor.textContent,
            fimDoValor: Math.round(texto.right),
            inicioDoBotao: Math.round(caixa.left),
            fimDoBotao: Math.round(caixa.right),
            fimDaTela: document.documentElement.clientWidth,
          };
        });
        console.log(`${largura} px ${fonte} ${etapa} rodapé`, medida);

        expect(medida.valor).toBe("R$ 12.345,67");
        expect(medida.fimDoValor).toBeLessThanOrEqual(medida.inicioDoBotao);
        expect(medida.fimDoBotao).toBeLessThanOrEqual(medida.fimDaTela);
      });
    }

    test(`${largura} px, fonte ${fonte}: a janela de apagar a venda cabe sem rolar de lado`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: largura, height: 640 });
      await abrir(page, fonte, "?etapa=fechamento");
      await page.getByRole("button", { name: "Registrar venda" }).click();
      await page
        .getByRole("button", { name: "Começar uma venda nova" })
        .click();
      const janela = page.getByTestId("confirmar-acao");
      await expect(janela).toContainText("R$ 12.345,67");
      if (fonte === "android") await crescerTextoDoAndroid(page);
      await assentar(page);
      const medida = await janela.evaluate((caixa) => {
        const borda = caixa.getBoundingClientRect();
        return {
          scrollWidth: caixa.scrollWidth,
          clientWidth: caixa.clientWidth,
          fimDaJanela: Math.round(borda.right),
          fimDosBotoes: Math.max(
            ...[...caixa.querySelectorAll("button")].map((b) =>
              Math.round(b.getBoundingClientRect().right),
            ),
          ),
          botoesQueVazam: [...caixa.querySelectorAll("button")]
            .filter((b) => b.scrollWidth > b.clientWidth)
            .map((b) => b.textContent),
        };
      });
      console.log(`${largura} px ${fonte} janela`, medida);

      expect(medida.scrollWidth).toBeLessThanOrEqual(medida.clientWidth);
      expect(medida.fimDosBotoes).toBeLessThanOrEqual(medida.fimDaJanela);
      expect(medida.botoesQueVazam).toEqual([]);
    });
  }
}

// Telefone baixo: o aviso abre do topo (o título à vista), os dois botões
// aparecem, e a pergunta também — onde cabe. LIMITE MEDIDO: em 320 x 568 com
// a fonte em 130%, título + pergunta + os dois botões pedem ~275 px e sobram
// ~250 entre o cabeçalho e a barra de baixo; ali a pergunta fica por trás dos
// botões e aparece rolando o texto (antes, o aviso abria rolado até os botões
// e nem o título aparecia). Caber inteiro pede tirar algo da tela (a barra ou
// o título), o que não é correção de layout.
for (const { largura, altura } of [
  { largura: 320, altura: 568 },
  { largura: 360, altura: 640 },
]) {
  for (const fonte of ["normal", "raiz", "android"] as const) {
    test(`${largura} x ${altura}, fonte ${fonte}: "Limpar a tela da venda?" não some acima dos botões`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: largura, height: altura });
      await abrir(page, fonte);
      await page
        .getByRole("button", { name: "Limpar a tela da venda" })
        .click();
      const aviso = page.getByRole("group", { name: "Limpar a tela da venda" });
      const voltar = aviso.getByRole("button", { name: "Voltar" });
      await expect(voltar).toBeFocused();
      if (fonte === "android") {
        // Como se o aviso abrisse já com o texto grande: do topo, e o foco
        // chegando ao "Voltar" de novo (é ele quem rola o aviso).
        await crescerTextoDoAndroid(page);
        await aviso.evaluate((caixa) => {
          caixa.scrollTop = 0;
        });
        await voltar.evaluate((botao) => {
          (botao as HTMLElement).blur();
          (botao as HTMLElement).focus();
        });
      }
      await assentar(page);
      const medida = await aviso.evaluate((caixa) => {
        const borda = caixa.getBoundingClientRect();
        const barra = document
          .querySelector('nav[aria-label="Navegação inferior do painel"]')
          ?.getBoundingClientRect();
        const pergunta = [...caixa.querySelectorAll("p")].find(
          (p) => p.textContent === "Limpar a tela da venda?",
        ) as HTMLElement;
        const titulo = caixa.querySelector(
          ":scope > .pdv-heading",
        ) as HTMLElement;
        const voltar = [...caixa.querySelectorAll("button")].find(
          (b) => b.textContent === "Voltar",
        ) as HTMLElement;
        const dentro = (el: HTMLElement) => {
          const r = el.getBoundingClientRect();
          return r.top >= borda.top - 1 && r.bottom <= borda.bottom + 1;
        };
        // Os botões podem ficar POR CIMA do texto (presos embaixo do aviso):
        // a pergunta só aparece se termina antes do botão mais alto.
        const topoDosBotoes = Math.min(
          ...[...caixa.querySelectorAll("button")].map(
            (b) => b.getBoundingClientRect().top,
          ),
        );
        const fimDaPergunta = pergunta.getBoundingClientRect().bottom;
        const fimDoTitulo = titulo.getBoundingClientRect().bottom;
        return {
          altura: Math.round(borda.height),
          conteudo: caixa.scrollHeight,
          rolado: caixa.scrollTop,
          fimDaPergunta: Math.round(fimDaPergunta),
          topoDosBotoes: Math.round(topoDosBotoes),
          perguntaAparece:
            dentro(pergunta) && fimDaPergunta <= topoDosBotoes + 1,
          tituloAparece: dentro(titulo) && fimDoTitulo <= topoDosBotoes + 1,
          voltarAparece: dentro(voltar),
          fimDoAviso: Math.round(borda.bottom),
          topoDaBarra: Math.round(barra?.top ?? Number.POSITIVE_INFINITY),
        };
      });
      console.log(`${largura} x ${altura} ${fonte} aviso`, medida);

      expect(medida.rolado).toBe(0);
      expect(medida.tituloAparece).toBe(true);
      expect(medida.voltarAparece).toBe(true);
      if (largura > 320 || fonte === "normal") {
        expect(medida.perguntaAparece).toBe(true);
      }
      expect(medida.fimDoAviso).toBeLessThanOrEqual(medida.topoDaBarra);
    });
  }
}
