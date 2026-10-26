// @vitest-environment jsdom
//
// Botão compartilhado "falar pelo WhatsApp" do lado do cliente (26/10/2026).
// Regra permanente do dono: ícone de marca = o glifo oficial exato; e botão
// bonito que ninguém consegue ler não serve — texto e glifo escuros sobre o
// verde oficial (branco sobre #25D366 dá ~2:1 e reprova a régua de 4,5:1).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import postcss from "postcss";
import selectorParser from "postcss-selector-parser";
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import tailwindcss from "tailwindcss";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { IconeWhatsapp } from "@/components/icons/IconeWhatsapp";
import { BotaoWhatsapp } from "@/components/ui/custom/BotaoWhatsapp";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const requisitar = createRequire(import.meta.url);

// ---- contraste (WCAG 2.x) -------------------------------------------------
function luminancia(hex: string): number {
  const canais = [1, 3, 5].map((i) => {
    const v = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * canais[0] + 0.7152 * canais[1] + 0.0722 * canais[2];
}
function contraste(a: string, b: string): number {
  const [x, y] = [luminancia(a), luminancia(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
function cor(classes: string, prefixo: string): string {
  const achada = classes
    .split(/\s+/)
    .find((c) => c.startsWith(`${prefixo}-[#`) && c.endsWith("]"));
  if (!achada) throw new Error(`classe ${prefixo}-[#......] ausente`);
  return achada.slice(prefixo.length + 2, -1);
}

describe("contraste: a conta que decide a cor do texto", () => {
  it("controle: branco sobre o verde oficial reprova (~2:1)", () => {
    expect(contraste("#25D366", "#FFFFFF")).toBeLessThan(2.1);
    expect(contraste("#25D366", "#FFFFFF")).toBeLessThan(4.5);
  });
  it("controle: preto sobre branco dá 21:1", () => {
    expect(contraste("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
  });
});

describe("BotaoWhatsapp", () => {
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
  });

  function montar(props: Record<string, unknown> = {}, rotulo = "WhatsApp") {
    act(() => {
      raiz.render(createElement(BotaoWhatsapp, props, rotulo));
    });
    return hospedeiro.querySelector("button") as HTMLButtonElement;
  }

  it("é um <button type=button> com o glifo OFICIAL à esquerda e o rótulo", () => {
    const botao = montar();
    expect(botao.tagName).toBe("BUTTON");
    expect(botao.type).toBe("button");
    expect(botao.textContent).toBe("WhatsApp");

    const referencia = document.createElement("div");
    const r2 = createRoot(referencia);
    act(() => {
      r2.render(<IconeWhatsapp />);
    });
    const oficial = referencia.querySelector("path")?.getAttribute("d");
    act(() => {
      r2.unmount();
    });
    const caminhos = [...botao.querySelectorAll("svg path")].map((p) =>
      p.getAttribute("d"),
    );
    expect(caminhos).toEqual([oficial]);
    // o glifo é o primeiro filho (à esquerda do rótulo) e é decorativo
    const primeiro = botao.firstElementChild;
    expect(primeiro?.tagName.toLowerCase()).toBe("svg");
    expect(primeiro?.getAttribute("aria-hidden")).toBe("true");
  });

  it("verde oficial #25D366, alvo >= 44 px (h-12), cantos da loja", () => {
    const classes = montar().className;
    expect(cor(classes, "bg")).toBe("#25D366");
    expect(classes).toMatch(/(^|\s)h-12(\s|$)/);
    expect(classes).toContain("rounded-2xl");
  });

  it("estados: hover, pressionado, foco visível com anel e desabilitado", () => {
    const classes = montar().className;
    expect(classes).toMatch(/hover:bg-\[#/);
    expect(classes).toMatch(/active:bg-\[#/);
    expect(classes).toContain("active:scale-");
    expect(classes).toContain("focus-visible:ring-2");
    expect(classes).toContain("focus-visible:ring-ring");
    expect(classes).toContain("focus-visible:ring-offset-2");
    expect(classes).toContain("focus-visible:ring-offset-background");
    expect(classes).toContain("disabled:opacity-50");
    expect(classes).toContain("disabled:pointer-events-none");
  });

  it("texto e glifo escuros: >= 4,5:1 sobre o fundo em TODOS os estados", () => {
    const classes = montar().className;
    const texto = cor(classes, "text");
    for (const [rotulo, fundo] of [
      ["repouso", cor(classes, "bg")],
      ["hover", cor(classes, "hover:bg")],
      ["pressionado", cor(classes, "active:bg")],
    ] as const) {
      const razao = contraste(texto, fundo);
      expect(
        razao,
        `${rotulo}: ${texto} sobre ${fundo} = ${razao}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
    // o glifo herda a cor do texto (currentColor): mesma razão
    expect(hospedeiro.querySelector("svg")?.getAttribute("fill")).toBe(
      "currentColor",
    );
  });

  it("repassa onClick, aria-label, className e disabled", () => {
    const aoClicar = vi.fn();
    const botao = montar({
      onClick: aoClicar,
      "aria-label": "WhatsApp — pedido #1",
      className: "h-[52px] fixed",
    });
    expect(botao.getAttribute("aria-label")).toBe("WhatsApp — pedido #1");
    // className do chamador vence a altura padrão (twMerge), sem perder o resto
    expect(botao.className).toContain("h-[52px]");
    expect(botao.className).not.toMatch(/(^|\s)h-12(\s|$)/);
    expect(botao.className).toContain("bg-[#25D366]");
    act(() => {
      botao.click();
    });
    expect(aoClicar).toHaveBeenCalledTimes(1);
  });

  it("desabilitado não dispara onClick", () => {
    const aoClicar = vi.fn();
    const botao = montar({ onClick: aoClicar, disabled: true });
    expect(botao.disabled).toBe(true);
    act(() => {
      botao.click();
    });
    expect(aoClicar).not.toHaveBeenCalled();
  });
});

// ---- onde ele pode (e não pode) aparecer -----------------------------------
function arquivosTsx(dir: string): string[] {
  const saida: string[] = [];
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- varredura do src/ do próprio repositório, sem entrada externa.
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- varredura do src/ do próprio repositório, sem entrada externa.
    if (statSync(caminho).isDirectory()) saida.push(...arquivosTsx(caminho));
    else if (caminho.endsWith(".tsx")) saida.push(caminho);
  }
  return saida;
}

function usos(fonte: string, nome: string) {
  const sf = ts.createSourceFile(
    nome,
    fonte,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const achados: { temOnClick: boolean; trocaOTipo: boolean }[] = [];
  const tem = (abertura: ts.JsxOpeningLikeElement, nomeDoAtributo: string) =>
    abertura.attributes.properties.some(
      (p) => ts.isJsxAttribute(p) && p.name.getText(sf) === nomeDoAtributo,
    );
  const visitar = (n: ts.Node) => {
    if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n)) {
      const abertura = ts.isJsxElement(n) ? n.openingElement : n;
      if (abertura.tagName.getText(sf) === "BotaoWhatsapp") {
        achados.push({
          temOnClick: tem(abertura, "onClick"),
          trocaOTipo: tem(abertura, "type"),
        });
      }
    }
    ts.forEachChild(n, visitar);
  };
  visitar(sf);
  return achados;
}

describe("BotaoWhatsapp só vive onde há AÇÃO de contato, nunca em campo de formulário", () => {
  const todos = arquivosTsx(resolve("src"))
    .map((c) => c.replaceAll("\\", "/"))
    .filter((c) => !c.endsWith("/BotaoWhatsapp.tsx"));
  const usuarios = todos.filter((c) =>
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- varredura do src/ do próprio repositório, sem entrada externa.
    readFileSync(c, "utf8").includes("<BotaoWhatsapp"),
  );

  it("os 7 pontos de contato por WhatsApp do cliente usam o botão original", () => {
    const esperados = [
      "components/checkout/VerificacaoDoPagamento.tsx",
      "components/politicas/ConteudoDaPolitica.tsx",
      "components/ui/custom/OrderSearch.tsx",
      "components/ui/custom/SaidaDaRecusa.tsx",
      "views/customer/AboutStoreView.tsx",
      "views/customer/CheckoutView.tsx",
      "views/customer/ProfileView.tsx",
    ];
    for (const e of esperados) {
      expect(
        usuarios.some((c) => c.endsWith(e)),
        e,
      ).toBe(true);
    }
  });

  it("é usado em pelo menos o cartão de pedido do Perfil", () => {
    expect(
      usuarios.some((c) => c.endsWith("views/customer/ProfileView.tsx")),
    ).toBe(true);
  });

  it("todo uso tem onClick (é botão de ação) e nenhum troca o type=button (nunca envia formulário)", () => {
    for (const caminho of usuarios) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- varredura do src/ do próprio repositório, sem entrada externa.
      for (const uso of usos(readFileSync(caminho, "utf8"), caminho)) {
        expect(uso.temOnClick, `${caminho}: sem onClick`).toBe(true);
        expect(uso.trocaOTipo, `${caminho}: troca o type`).toBe(false);
      }
    }
  });

  it("o tipo padrão é button: dentro de um <form> (ex.: rastrear pedido) clicar não envia o formulário", () => {
    const enviou = vi.fn((e: Event) => e.preventDefault());
    const host = document.createElement("div");
    document.body.appendChild(host);
    const r = createRoot(host);
    act(() => {
      r.render(
        createElement(
          "form",
          { onSubmit: (e: Event) => enviou(e) },
          createElement(BotaoWhatsapp, { onClick: () => {} }, "WhatsApp"),
        ),
      );
    });
    act(() => {
      host.querySelector("button")?.click();
    });
    expect(enviou).not.toHaveBeenCalled();
    act(() => {
      r.unmount();
    });
    host.remove();
  });

  it("telas de campo ('Seu WhatsApp', 'Adicionar WhatsApp') não importam o botão", () => {
    for (const c of todos.filter(
      (c) =>
        c.endsWith("views/customer/AccountSettingsView.tsx") ||
        c.endsWith("views/shared/AuthView.tsx") ||
        c.endsWith("components/ui/custom/AddressForm.tsx"),
    )) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- varredura do src/ do próprio repositório, sem entrada externa.
      expect(readFileSync(c, "utf8"), c).not.toContain("BotaoWhatsapp");
    }
  });

  it("nenhuma tela do painel (admin) usa o botão do cliente", () => {
    for (const c of usuarios) {
      expect(c, c).not.toMatch(/\/admin\/|Admin/);
    }
  });
});

// ---- as classes viram CSS de verdade (jsdom não calcula CSS) ----------------
async function geradas(candidatas: string[]): Promise<Set<string>> {
  const carregar = requisitar("tailwindcss/loadConfig") as (
    caminho: string,
  ) => Record<string, unknown>;
  const config = carregar(resolve("tailwind.config.js"));
  const css = readFileSync("src/index.css", "utf8");
  const resultado = await postcss([
    tailwindcss({
      ...config,
      content: [{ raw: candidatas.join(" "), extension: "html" }],
    }),
  ]).process(css, { from: "src/index.css" });
  const achadas = new Set<string>();
  resultado.root.walkRules((regra) => {
    selectorParser((seletores) => {
      seletores.walkClasses((c) => {
        achadas.add(c.value);
      });
    }).processSync(regra.selector);
  });
  return achadas;
}

describe("BotaoWhatsapp: toda classe usada gera CSS no Tailwind do projeto", () => {
  it("controle: classe inventada não gera CSS", async () => {
    const g = await geradas(["bg-whatsapp-verde-inventado", "rounded-2xl"]);
    expect(g.has("bg-whatsapp-verde-inventado")).toBe(false);
    expect(g.has("rounded-2xl")).toBe(true);
  }, 60_000);

  it("as classes do componente geram CSS", async () => {
    const host = document.createElement("div");
    const r = createRoot(host);
    act(() => {
      r.render(createElement(BotaoWhatsapp, {}, "WhatsApp"));
    });
    const classes = (host.querySelector("button")?.className ?? "")
      .split(/\s+/)
      .filter(Boolean);
    act(() => {
      r.unmount();
    });
    expect(classes.length).toBeGreaterThan(8);
    const g = await geradas(classes);
    // o seletor escapa variantes ("hover:bg-[#...]"): compara pela forma já sem escape
    const naoGeradas = classes.filter((c) => !g.has(c));
    expect(naoGeradas).toEqual([]);
  }, 60_000);
});
