// @vitest-environment jsdom
//
// Onda L · L2 (frete-e-identidade): alvos de toque de 44px nos painéis
// recolhíveis, nos blocos do Frete e nos botões da Identidade da loja; campo de
// CEP h-11; círculos de check em 11px — sem mudar nenhum comportamento.
//
// O jsdom não aplica CSS: a prova é sobre a CLASSE (estática, lendo a fonte) e,
// onde há harness barato, sobre o DOM renderizado. A medida em pixels é do
// render do integrador.
/* eslint-disable security/detect-non-literal-fs-filename, security/detect-unsafe-regex --
   leitura dos próprios arquivos-fonte do repositório (caminhos constantes deste teste, não entrada de usuário); regex constantes */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const RAIZ = join(__dirname, "..", "..");
const lerFonte = (caminho: string): string =>
  readFileSync(join(RAIZ, caminho), "utf8");

const PASTA = "src/components/admin/shipping/";
const RECOLHIVEL = `${PASTA}PainelRecolhivel.tsx`;
const PRIMITIVAS = `${PASTA}primitivas-direcao-d.tsx`;
const LOCAL = `${PASTA}FreteLocalBloco.tsx`;
const NACIONAL = `${PASTA}FreteNacionalBloco.tsx`;
const GRATIS = `${PASTA}FreteGratisBloco.tsx`;
const ESTRATEGIA = `${PASTA}EstrategiaNacionalBloco.tsx`;
const CARTAO = "src/components/admin/settings/TransportadorasCard.tsx";
const FRETE = "src/views/admin/AdminShippingView.tsx";
const IDENTIDADE = "src/components/admin/settings/IdentitySettingsSection.tsx";

/** A tag de abertura inteira (`<button … >`), respeitando `{}` e aspas. */
function tagDeAbertura(fonte: string, inicio: number): string {
  let profundidade = 0;
  let aspas: string | null = null;
  for (let i = inicio; i < fonte.length; i++) {
    const c = fonte.charAt(i);
    if (aspas) {
      if (c === aspas) aspas = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") aspas = c;
    else if (c === "{") profundidade++;
    else if (c === "}") profundidade--;
    else if (c === ">" && profundidade === 0) return fonte.slice(inicio, i + 1);
  }
  throw new Error("tag sem fechamento");
}

/** Todas as aberturas `<tag …>` do arquivo (`<Button` não casa `<ButtonX`). */
function aberturas(
  fonte: string,
  tag: "button" | "Button" | "input",
): string[] {
  // Só as tags que este teste usa; regex literal (sem RegExp dinâmico).
  const re =
    tag === "button"
      ? /<button(?=[\s>])/g
      : tag === "Button"
        ? /<Button(?=[\s>])/g
        : /<input(?=[\s>])/g;
  return [...fonte.matchAll(re)].map((m) => tagDeAbertura(fonte, m.index));
}

/** Abertura do `<button` que contém `onClick={…}` com o trecho dado. */
function botaoComClique(fonte: string, clique: string): string {
  const achada = aberturas(fonte, "button").find((t) => t.includes(clique));
  expect(achada, `botão com ${clique} ausente`).toBeDefined();
  return achada as string;
}

const semComentarios = (fonte: string): string =>
  fonte
    .split("\n")
    .map((linha) => {
      const l = linha.trim();
      return l.startsWith("//") || l.startsWith("*") || l.startsWith("/*")
        ? ""
        : linha;
    })
    .join("\n");

const TEXTO_MIUDO = /text-\[(?:[6-9]|10)(?:\.\d+)?px\]/;
const MIN_H_11 = /\bmin-h-11\b/;

describe("L2 · painéis e chave do Frete (estático)", () => {
  it("o cabeçalho do PainelRecolhivel (botão aria-expanded) tem min-h-11", () => {
    const [botao] = aberturas(lerFonte(RECOLHIVEL), "button");
    expect(botao).toContain("aria-expanded={aberta}");
    expect(botao).toMatch(MIN_H_11);
    // O desenho da linha fica: borda de baixo e respiro.
    expect(botao).toContain("border-b");
    expect(botao).toContain("pb-3.5");
  });

  it("a Chave (role=switch) tem min-h-11 e mantém role, aria-checked e aria-label", () => {
    const botao = aberturas(lerFonte(PRIMITIVAS), "button").find((t) =>
      t.includes('role="switch"'),
    );
    expect(botao).toBeDefined();
    expect(botao).toMatch(MIN_H_11);
    expect(botao).toContain("aria-checked={ligada}");
    expect(botao).toContain("aria-label={rotulo}");
  });
});

describe("L2 · blocos do Frete (estático)", () => {
  it("o campo de CEP do FreteLocalBloco é h-11 (não h-10)", () => {
    const fonte = lerFonte(LOCAL);
    const campos = aberturas(fonte, "input");
    expect(campos.length).toBeGreaterThan(0);
    for (const campo of campos) {
      expect(campo).not.toMatch(/\bh-10\b/);
    }
    expect(campos.some((c) => /\bh-11\b/.test(c))).toBe(true);
  });

  it.each([
    ["FreteLocalBloco", LOCAL],
    ["FreteNacionalBloco", NACIONAL],
    ["FreteGratisBloco", GRATIS],
    ["EstrategiaNacionalBloco", ESTRATEGIA],
  ])("todo <button> do %s tem min-h-11", (_nome, caminho) => {
    const botoes = aberturas(lerFonte(caminho), "button");
    expect(botoes.length).toBeGreaterThan(0);
    for (const botao of botoes) expect(botao).toMatch(MIN_H_11);
  });

  it("os radios de frete grátis e das estratégias seguem role=radio com min-h-11", () => {
    for (const caminho of [GRATIS, ESTRATEGIA]) {
      const radios = aberturas(lerFonte(caminho), "button").filter((t) =>
        t.includes('role="radio"'),
      );
      expect(radios.length).toBeGreaterThan(0);
      for (const radio of radios) {
        expect(radio).toMatch(MIN_H_11);
        expect(radio).toContain("aria-checked={ativo}");
      }
    }
    // Três <button role="radio"> na fonte: cartões da estratégia, tipo do
    // desconto e alcance (o .map repete cada um).
    const pilulas = aberturas(lerFonte(ESTRATEGIA), "button").filter((t) =>
      t.includes('role="radio"'),
    );
    expect(pilulas).toHaveLength(3);
  });

  it("'Limitar à mais barata' e 'Conectar transportadora' têm min-h-11", () => {
    expect(
      botaoComClique(lerFonte(ESTRATEGIA), 'onAlcance("mais_barata")'),
    ).toMatch(MIN_H_11);
    expect(
      botaoComClique(lerFonte(FRETE), "onClick={abrirTransportadoras}"),
    ).toMatch(MIN_H_11);
  });

  it("'Salvar provedores' do cartão de transportadoras tem min-h-11", () => {
    expect(botaoComClique(lerFonte(CARTAO), "onClick={salvarLigados}")).toMatch(
      MIN_H_11,
    );
  });

  it("os círculos ✓ de check ficam size-5 com text-[11px]", () => {
    for (const caminho of [GRATIS, ESTRATEGIA]) {
      const fonte = lerFonte(caminho);
      const i = fonte.indexOf("✓");
      expect(i, `✓ ausente em ${caminho}`).toBeGreaterThan(-1);
      const abertura = fonte.lastIndexOf("<span", i);
      const tag = tagDeAbertura(fonte, abertura);
      expect(tag).toMatch(/\bsize-5\b/);
      expect(tag).toContain("text-[11px]");
      expect(tag).not.toMatch(/size-\[17px\]/);
    }
  });

  it.each([
    ["PainelRecolhivel", RECOLHIVEL],
    ["primitivas-direcao-d", PRIMITIVAS],
    ["FreteLocalBloco", LOCAL],
    ["FreteNacionalBloco", NACIONAL],
    ["FreteGratisBloco", GRATIS],
    ["EstrategiaNacionalBloco", ESTRATEGIA],
  ])("%s não tem texto abaixo de 11px", (_nome, caminho) => {
    expect(semComentarios(lerFonte(caminho))).not.toMatch(TEXTO_MIUDO);
  });
});

describe("L2 · Identidade da loja (estático)", () => {
  it("todo <Button> da IdentitySettingsSection pede min-h-11", () => {
    const botoes = aberturas(lerFonte(IDENTIDADE), "Button");
    // Tentar novamente, Retirar referência, Guardar como fonte, Cancelar envio,
    // Conferir configuração, par do conflito (2), Salvar, Descartar, Sim e
    // Continuar editando.
    expect(botoes).toHaveLength(11);
    for (const botao of botoes) {
      expect(botao).toMatch(/className="[^"]*\bmin-h-11\b/);
    }
  });
});

// --- Render: a Chave continua sendo um switch que liga/desliga -------------------

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("L2 · Chave e PainelRecolhivel (render)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.restoreAllMocks();
  });

  it("a Chave com onToggle é um botão switch de 44px que dispara o clique", async () => {
    const { Chave } = await import(
      "@/components/admin/shipping/primitivas-direcao-d"
    );
    const aoAlternar = vi.fn();
    await act(async () => {
      raiz.render(
        <Chave ligada={false} rotulo="Ligar teste" onToggle={aoAlternar} />,
      );
    });
    const chave = hospedeiro.querySelector<HTMLElement>(
      '[role="switch"][aria-label="Ligar teste"]',
    );
    expect(chave).not.toBeNull();
    expect(chave?.className).toMatch(MIN_H_11);
    await act(async () => {
      chave?.click();
    });
    expect(aoAlternar).toHaveBeenCalledTimes(1);
  });

  it("o cabeçalho do PainelRecolhivel renderizado tem min-h-11 e alterna", async () => {
    const { PainelRecolhivel } = await import(
      "@/components/admin/shipping/PainelRecolhivel"
    );
    const aoAlternar = vi.fn();
    await act(async () => {
      raiz.render(
        <PainelRecolhivel
          id="painel-x"
          titulo="Painel X"
          aberta={false}
          onToggle={aoAlternar}
        >
          conteúdo
        </PainelRecolhivel>,
      );
    });
    const cabecalho = hospedeiro.querySelector<HTMLElement>(
      "button[aria-expanded]",
    );
    expect(cabecalho?.className).toMatch(MIN_H_11);
    await act(async () => {
      cabecalho?.click();
    });
    expect(aoAlternar).toHaveBeenCalledTimes(1);
  });
});
