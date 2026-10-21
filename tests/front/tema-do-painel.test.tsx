// @vitest-environment jsdom
//
// Temas do painel (Escuro, Claro, Confortável): escolha no aparelho, aplicação
// antes da pintura, isolamento da vitrine e contraste medido.
//
//   a. padrão Escuro; valor inválido no storage cai para Escuro; storage que
//      lança (modo privado) não quebra nem a leitura nem a escolha;
//   b. a escolha persiste e aplica `data-admin-tema` na <html> (Escuro = sem atributo);
//   c. o hook do AdminLayout liga `admin-mode` + tema e, ao sair do painel, tira
//      os DOIS: nada do painel vaza para a vitrine;
//   d. todo seletor dos CSS de tema exige `html.admin-mode[data-admin-tema…]`
//      (sem a classe do painel nenhuma regra vale) e nenhum toca :root/body/--background
//      fora desse escopo;
//   e. texto >= 7:1 e texto suave >= 4,5:1 sobre cartão E elevado, nos 3 temas;
//      a amostra do seletor repete os tokens do CSS.
/* eslint-disable security/detect-non-literal-fs-filename, security/detect-object-injection --
   lê o código-fonte do próprio repositório (caminho constante); só leitura */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "postcss";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AparenciaDoPainel } from "@/components/admin/settings/AparenciaDoPainel";
import {
  CHAVE_DO_TEMA_DO_PAINEL,
  lerTemaDoPainel,
  useTemaDoPainelNaRaiz,
} from "@/components/admin/temaDoPainel";

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão dos outros testes de componente.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const raizHtml = document.documentElement;
const CSS_SELETOR = readFileSync(
  resolve(
    process.cwd(),
    "src/components/admin/settings/aparencia-do-painel.css",
  ),
  "utf8",
);

beforeEach(() => {
  localStorage.clear();
  raizHtml.removeAttribute("data-admin-tema");
  raizHtml.classList.remove("admin-mode");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("tema do painel — leitura do que está guardado", () => {
  it("sem nada guardado o painel é Escuro", () => {
    expect(lerTemaDoPainel()).toBe("escuro");
  });

  it("valor inválido no storage cai para Escuro", () => {
    for (const lixo of ["roxo", "", "CLARO", "null", "{}", "claro "]) {
      localStorage.setItem(CHAVE_DO_TEMA_DO_PAINEL, lixo);
      expect(lerTemaDoPainel()).toBe("escuro");
    }
  });

  it("lê Claro e Confortável guardados", () => {
    localStorage.setItem(CHAVE_DO_TEMA_DO_PAINEL, "claro");
    expect(lerTemaDoPainel()).toBe("claro");
    localStorage.setItem(CHAVE_DO_TEMA_DO_PAINEL, "confortavel");
    expect(lerTemaDoPainel()).toBe("confortavel");
  });
});

describe("tema do painel — AdminLayout liga e desliga na <html>", () => {
  let hospedeiro: HTMLDivElement;
  let raiz: Root;

  function Casca() {
    useTemaDoPainelNaRaiz();
    return <p>painel</p>;
  }

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  it("entra no painel: admin-mode + tema guardado, já na primeira pintura (layout effect)", () => {
    localStorage.setItem(CHAVE_DO_TEMA_DO_PAINEL, "confortavel");
    act(() => raiz.render(<Casca />));
    expect(raizHtml.classList.contains("admin-mode")).toBe(true);
    expect(raizHtml.dataset.adminTema).toBe("confortavel");
  });

  it("sai do painel: tira admin-mode E o tema (a vitrine nunca fica tingida)", () => {
    localStorage.setItem(CHAVE_DO_TEMA_DO_PAINEL, "claro");
    act(() => raiz.render(<Casca />));
    expect(raizHtml.dataset.adminTema).toBe("claro");
    act(() => raiz.unmount());
    expect(raizHtml.classList.contains("admin-mode")).toBe(false);
    expect(raizHtml.hasAttribute("data-admin-tema")).toBe(false);
    // O storage continua: a escolha vale na próxima entrada no painel.
    expect(localStorage.getItem(CHAVE_DO_TEMA_DO_PAINEL)).toBe("claro");
    raiz = createRoot(hospedeiro);
  });

  it("padrão: entra sem atributo (Escuro)", () => {
    act(() => raiz.render(<Casca />));
    expect(raizHtml.classList.contains("admin-mode")).toBe(true);
    expect(raizHtml.hasAttribute("data-admin-tema")).toBe(false);
  });
});

describe("seletor Aparência do painel", () => {
  let hospedeiro: HTMLDivElement;
  let raiz: Root;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  const opcoes = () => [
    ...hospedeiro.querySelectorAll<HTMLButtonElement>('[role="radio"]'),
  ];

  it("mostra as 3 opções em português, com Escuro marcado por padrão", () => {
    act(() => raiz.render(<AparenciaDoPainel />));
    expect(opcoes().map((o) => o.textContent)).toEqual([
      expect.stringContaining("Escuro"),
      expect.stringContaining("Claro"),
      expect.stringContaining("Confortável"),
    ]);
    expect(opcoes().map((o) => o.getAttribute("aria-checked"))).toEqual([
      "true",
      "false",
      "false",
    ]);
  });

  it("clicar escolhe, marca, aplica e guarda no aparelho", () => {
    act(() => raiz.render(<AparenciaDoPainel />));
    act(() => opcoes()[1].click());
    expect(opcoes().map((o) => o.getAttribute("aria-checked"))).toEqual([
      "false",
      "true",
      "false",
    ]);
    expect(raizHtml.dataset.adminTema).toBe("claro");
    expect(localStorage.getItem(CHAVE_DO_TEMA_DO_PAINEL)).toBe("claro");
  });

  it("escolher aplica na <html> e persiste o mesmo valor que o AdminLayout lê; Escuro tira o atributo", () => {
    act(() => raiz.render(<AparenciaDoPainel />));
    act(() => opcoes()[1].click());
    expect(raizHtml.dataset.adminTema).toBe("claro");
    expect(localStorage.getItem(CHAVE_DO_TEMA_DO_PAINEL)).toBe("claro");
    expect(lerTemaDoPainel()).toBe("claro");
    act(() => opcoes()[2].click());
    expect(raizHtml.dataset.adminTema).toBe("confortavel");
    expect(lerTemaDoPainel()).toBe("confortavel");
    act(() => opcoes()[0].click());
    expect(raizHtml.hasAttribute("data-admin-tema")).toBe(false);
    expect(localStorage.getItem(CHAVE_DO_TEMA_DO_PAINEL)).toBe("escuro");
    expect(lerTemaDoPainel()).toBe("escuro");
  });

  it("storage indisponível: escolher não lança e vale na sessão; ler dá Escuro", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("negado", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("cheio", "QuotaExceededError");
    });
    expect(lerTemaDoPainel()).toBe("escuro");
    act(() => raiz.render(<AparenciaDoPainel />));
    expect(() => act(() => opcoes()[1].click())).not.toThrow();
    expect(raizHtml.dataset.adminTema).toBe("claro");
    expect(opcoes()[1].getAttribute("aria-checked")).toBe("true");
  });

  it("abre já marcando o tema que está valendo", () => {
    raizHtml.dataset.adminTema = "confortavel";
    act(() => raiz.render(<AparenciaDoPainel />));
    expect(opcoes().map((o) => o.getAttribute("aria-checked"))).toEqual([
      "false",
      "false",
      "true",
    ]);
  });

  it("cada opção tem alvo de toque de 44px (o desenho mora no CSS do seletor)", () => {
    act(() => raiz.render(<AparenciaDoPainel />));
    expect(opcoes()).toHaveLength(3);
    for (const o of opcoes()) expect(o.className).toBe("tema-opcao");
    expect(CSS_SELETOR).toMatch(/\.tema-opcao \{[^}]*min-height: 2\.75rem/);
    expect(CSS_SELETOR).toContain('.tema-opcao[aria-checked="true"]::after');
  });
});

// ---------------------------------------------------------------------------
// CSS: isolamento e contraste
// ---------------------------------------------------------------------------

const lerFonte = (caminho: string) =>
  readFileSync(resolve(process.cwd(), caminho), "utf8");

const CSS_TOKENS = lerFonte("src/components/layouts/temas-do-painel.css");
const CSS_CORES = lerFonte("src/components/layouts/temas-do-painel-cores.css");
const CSS_BASE = lerFonte("src/index.css");

describe("tema do painel — a vitrine não recebe nem sofre o tema", () => {
  const semComentarios = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

  it("todo seletor de temas-do-painel.css exige admin-mode e delimita o tema", () => {
    const seletores = [...semComentarios(CSS_TOKENS).matchAll(/([^{}]+)\{/g)]
      .map((m) => m[1].trim())
      .filter(Boolean);
    expect(seletores.length).toBeGreaterThan(4);
    for (const s of seletores) {
      expect(s, s).toMatch(
        /^(?:html\.admin-mode\[data-admin-tema|:where\(html\.admin-mode(?:\[data-admin-tema(?:="(?:claro|confortavel|escuro)")?\]|:not\(\[data-admin-tema\]\))\))/,
      );
    }
  });

  it("toda regra gerada de cor exige o mesmo escopo (dentro de :where, peso zero)", () => {
    const linhas = semComentarios(CSS_CORES)
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    expect(linhas.length).toBeGreaterThan(200);
    for (const l of linhas) {
      const regra = l.replace(/^@media [^{]+\{/, "");
      const prefixos = [
        ":where(html.admin-mode[data-admin-tema]) ",
        ':where(html.admin-mode[data-admin-tema="claro"]) ',
        ':where(html.admin-mode[data-admin-tema="confortavel"]) ',
        ":where(html.admin-mode:not([data-admin-tema])) ",
      ];
      expect(
        prefixos.some((p) => regra.startsWith(p)),
        l.slice(0, 120),
      ).toBe(true);
    }
  });

  it("os temas não mexem em :root, body nem html sem admin-mode", () => {
    for (const css of [CSS_TOKENS, CSS_CORES]) {
      const limpo = semComentarios(css);
      expect(limpo).not.toMatch(/(^|\n)\s*(:root|body|html)\s*[{,]/);
      expect(limpo).not.toMatch(/(^|\n)\s*html(?!\.admin-mode)[.[:\s]/);
    }
  });

  it("o CSS do tema só é carregado pelo painel (AdminLayout), não pela vitrine", () => {
    expect(lerFonte("src/components/layouts/AdminLayout.tsx")).toContain(
      'import "./temas-do-painel.css"',
    );
    for (const f of ["src/index.css", "src/main.tsx", "src/App.tsx"]) {
      expect(lerFonte(f)).not.toContain("temas-do-painel");
    }
  });
});

function hslParaRgb(canais: string): [number, number, number] {
  const [h, s, l] = canais
    .trim()
    .split(/\s+/)
    .map((n) => Number.parseFloat(n));
  const sf = s / 100;
  const lf = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sf * Math.min(lf, 1 - lf);
  const f = (n: number) =>
    lf - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)].map((x) => Math.round(x * 255)) as [
    number,
    number,
    number,
  ];
}

function hexParaRgb(hex: string): [number, number, number] {
  const n = hex.replace("#", "");
  return [0, 2, 4].map((i) => Number.parseInt(n.slice(i, i + 2), 16)) as [
    number,
    number,
    number,
  ];
}

const linear = (c: number) => {
  const x = c / 255;
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
};
const luminancia = ([r, g, b]: readonly number[]) =>
  0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
function contraste(a: readonly number[], b: readonly number[]): number {
  const [claro, escuro] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (claro + 0.05) / (escuro + 0.05);
}

/** Valor do token (canais HSL) dentro do bloco do tema. */
function tokenDe(css: string, bloco: string, token: string): string {
  const inicio = css.indexOf(bloco);
  expect(inicio, bloco).toBeGreaterThan(-1);
  const fim = css.indexOf("}", inicio);
  const m = new RegExp(`--admin-${token}:\\s*([^;]+);`).exec(
    css.slice(inicio, fim),
  );
  expect(m, `${bloco} --admin-${token}`).not.toBeNull();
  return (m as RegExpExecArray)[1];
}

const BLOCO = {
  claro: 'html.admin-mode[data-admin-tema="claro"] {',
  confortavel: 'html.admin-mode[data-admin-tema="confortavel"] {',
} as const;

describe("tema do painel — contraste medido", () => {
  const cor = (tema: "claro" | "confortavel", token: string) =>
    hslParaRgb(tokenDe(CSS_TOKENS, BLOCO[tema], token));

  // Escuro: tokens de superfície vêm do index.css; texto/suave são os do mockup.
  const escuro = {
    surface: hslParaRgb(tokenDe(CSS_BASE, ":root {", "surface")),
    raised: hslParaRgb(tokenDe(CSS_BASE, ":root {", "raised")),
    text: hexParaRgb("#F4F4F6"),
    soft: hexParaRgb("#A1A1AD"),
  };

  const temas = {
    escuro,
    claro: {
      surface: cor("claro", "surface"),
      raised: cor("claro", "raised"),
      text: cor("claro", "text"),
      soft: cor("claro", "text-soft"),
    },
    confortavel: {
      surface: cor("confortavel", "surface"),
      raised: cor("confortavel", "raised"),
      text: cor("confortavel", "text"),
      soft: cor("confortavel", "text-soft"),
    },
  } as const;

  for (const [nome, t] of Object.entries(temas)) {
    it(`${nome}: texto >= 7:1 e suave >= 4,5:1 sobre cartão e elevado`, () => {
      expect(contraste(t.text, t.surface)).toBeGreaterThanOrEqual(7);
      expect(contraste(t.text, t.raised)).toBeGreaterThanOrEqual(7);
      expect(contraste(t.soft, t.surface)).toBeGreaterThanOrEqual(4.5);
      expect(contraste(t.soft, t.raised)).toBeGreaterThanOrEqual(4.5);
    });
  }

  it("Escuro: zinc-400 a 700 usam texto suave AA nas superfícies reais, sem clarear títulos", () => {
    raizHtml.classList.add("admin-mode");
    const folha = parse(CSS_TOKENS);
    const cores = parse(CSS_CORES);
    const fundos = [
      [9, 9, 11], // Ficha do cliente: bg-zinc-950.
      [30, 30, 35], // Minha loja e Frete: superfície observada na tela.
      ...["surface", "raised", "hover", "nav"].map((nome) =>
        hslParaRgb(tokenDe(CSS_BASE, ":root {", nome)),
      ),
    ];
    const antigos = {
      "text-zinc-400": "#a1a1aa",
      "text-zinc-500": "#71717a",
      "text-zinc-600": "#52525b",
      "text-zinc-700": "#3f3f46",
      "text-zinc-500/50": "#71717a",
      "text-zinc-700/50": "#3f3f46",
    };
    const tokenNaRaiz = (): string | undefined => {
      let valor: string | undefined;
      folha.walkRules((regra) => {
        if (raizHtml.matches(regra.selector)) {
          regra.walkDecls("--admin-text-soft", (d) => {
            valor = d.value;
          });
        }
      });
      return valor;
    };

    for (const [classe, antiga] of Object.entries(antigos)) {
      const el = document.createElement("span");
      el.className = classe;
      document.body.appendChild(el);
      try {
        let tinta = hexParaRgb(antiga);
        let alfa = classe.endsWith("/50") ? 0.5 : 1;
        cores.walkRules((regra) => {
          if (regra.parent?.type !== "root" || !el.matches(regra.selector))
            return;
          regra.walkDecls("color", (d) => {
            if (d.value === "hsl(var(--admin-text-soft))") {
              const canais = tokenNaRaiz();
              expect(canais, "token suave definido no Escuro").toBeDefined();
              tinta = hslParaRgb(canais as string);
              alfa = 1;
            }
          });
        });
        for (const fundo of fundos) {
          const composta = tinta.map(
            (v, i) => v * alfa + fundo[i] * (1 - alfa),
          );
          expect(
            contraste(composta, fundo),
            `${classe} sobre rgb(${fundo.join(",")})`,
          ).toBeGreaterThanOrEqual(4.5);
        }
        expect(luminancia(tinta)).toBeLessThan(luminancia(escuro.text));
      } finally {
        el.remove();
      }
    }
  });

  it("o remapeamento Escuro não alcança vitrine, outros temas nem tema fixo", () => {
    const folha = parse(CSS_CORES);
    const el = document.createElement("span");
    el.className = "text-zinc-500";
    const fixo = document.createElement("div");
    fixo.setAttribute("data-tema-fixo", "");
    document.body.append(fixo, el);
    const regrasEscuras: string[] = [];
    folha.walkRules((regra) => {
      if (regra.selector.includes("html.admin-mode:not([data-admin-tema])")) {
        regrasEscuras.push(regra.selector);
        expect(regra.selector).toContain(
          ":not([data-tema-fixo], [data-tema-fixo] *)",
        );
      }
    });
    const alcancado = () => regrasEscuras.some((s) => el.matches(s));
    try {
      expect(regrasEscuras.length).toBeGreaterThan(0);
      expect(alcancado()).toBe(false); // Vitrine.
      raizHtml.classList.add("admin-mode");
      expect(alcancado()).toBe(true);
      for (const tema of ["claro", "confortavel"]) {
        raizHtml.dataset.adminTema = tema;
        expect(alcancado()).toBe(false);
      }
      raizHtml.removeAttribute("data-admin-tema");
      el.setAttribute("data-tema-fixo", "");
      expect(alcancado()).toBe(false);
      el.removeAttribute("data-tema-fixo");
      fixo.appendChild(el);
      expect(alcancado()).toBe(false);
      const grupo = document.createElement("div");
      grupo.className = "[&_.text-zinc-500]:text-zinc-400";
      document.body.appendChild(grupo);
      try {
        grupo.appendChild(fixo);
        expect(alcancado()).toBe(false); // Variante ancestral também respeita o alvo fixo.
      } finally {
        grupo.remove();
      }
    } finally {
      el.remove();
      fixo.remove();
    }
  });

  it("claro e confortável: destaque dourado >= 4,5:1 sobre cartão e elevado", () => {
    for (const nome of ["claro", "confortavel"] as const) {
      const ouro = cor(nome, "gold");
      expect(contraste(ouro, temas[nome].surface)).toBeGreaterThanOrEqual(4.5);
      expect(contraste(ouro, temas[nome].raised)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("claro: cartão de verdade acima do fundo e borda visível sobre o cartão", () => {
    const fundo = cor("claro", "bg");
    const borda = cor("claro", "border");
    expect(luminancia(temas.claro.surface)).toBeGreaterThan(luminancia(fundo));
    expect(contraste(borda, temas.claro.surface)).toBeGreaterThanOrEqual(1.3);
  });

  it("a amostra do seletor repete os tokens do CSS (texto, destaque, cartão, fundo)", () => {
    const hex = (rgb: readonly number[]) =>
      `#${rgb.map((n) => n.toString(16).padStart(2, "0")).join("")}`;
    const proximo = (a: string, b: string) => {
      const [x, y] = [hexParaRgb(a), hexParaRgb(b)];
      return x.every((v, i) => Math.abs(v - y[i]) <= 1);
    };
    const opcoesDoCss = () =>
      [
        ...CSS_SELETOR.matchAll(/data-tema-opcao="(\w+)"\] \.tema-amostra/g),
      ].map((m) => m[1]);
    const amostra = (id: string): string[] => {
      const m = new RegExp(
        String.raw`data-tema-opcao="${id}"\] \.tema-amostra \{\s*background:([^;]+);`,
      ).exec(CSS_SELETOR);
      expect(m, id).not.toBeNull();
      return [...(m as RegExpExecArray)[1].matchAll(/#[0-9a-f]{6}/g)]
        .map((x) => x[0])
        .filter((_, i) => i % 2 === 0);
    };
    // Cada camada repete a cor no gradiente (cor, cor): fica 1 de cada 2, e o fundo no fim.
    expect(opcoesDoCss()).toEqual(["escuro", "claro", "confortavel"]);
    for (const id of ["claro", "confortavel"] as const) {
      const [texto, destaque, cartao, fundo] = amostra(id);
      expect(proximo(texto, hex(cor(id, "text"))), `${id} texto`).toBe(true);
      expect(proximo(destaque, hex(cor(id, "gold"))), `${id} destaque`).toBe(
        true,
      );
      expect(proximo(cartao, hex(cor(id, "surface"))), `${id} cartão`).toBe(
        true,
      );
      expect(proximo(fundo, hex(cor(id, "bg"))), `${id} fundo`).toBe(true);
    }
    const [, , cartaoEscuro, fundoEscuro] = amostra("escuro");
    expect(
      proximo(
        cartaoEscuro,
        hex(hslParaRgb(tokenDe(CSS_BASE, ":root {", "surface"))),
      ),
    ).toBe(true);
    expect(
      proximo(fundoEscuro, hex(hslParaRgb(tokenDe(CSS_BASE, ":root {", "bg")))),
    ).toBe(true);
  });
});

describe("tema do painel — cores soltas dos CSS do painel", () => {
  const ARQUIVOS = [
    "src/components/admin/settings/ajustes.css",
    "src/components/admin/metricas-do-painel.css",
    "src/components/admin/products/formulario-produto.css",
    "src/components/admin/products/catalogo-produtos.css",
    "src/components/admin/pdv/pdv.css",
  ];
  const usos = ARQUIVOS.flatMap((f) =>
    [
      ...lerFonte(f).matchAll(
        /var\(--lit-([tb])-([0-9a-f]+), #([0-9a-fA-F]+)\)/g,
      ),
    ].map((m) => ({ arquivo: f, categoria: m[1], chave: m[2], reserva: m[3] })),
  );

  it("o Escuro não muda: a reserva de cada var é EXATAMENTE o hex que estava escrito", () => {
    // O PDV migrou superfícies e texto para --admin-*. Restam 76 usos
    // legados nos cinco CSS; a guarda de reserva e o contraste não mudam.
    expect(usos.length).toBeGreaterThanOrEqual(76);
    for (const u of usos) {
      expect(u.reserva.toLowerCase(), `${u.arquivo} ${u.chave}`).toBe(u.chave);
    }
  });

  it("todo var --lit-* usado tem valor no tema Claro (e nenhum fica sem uso)", () => {
    const bloco = CSS_TOKENS.slice(
      CSS_TOKENS.indexOf(BLOCO.claro),
      CSS_TOKENS.indexOf(BLOCO.confortavel),
    );
    const definidos = new Set(
      [...bloco.matchAll(/--lit-([tb])-([0-9a-f]+):/g)].map(
        (m) => `${m[1]}-${m[2]}`,
      ),
    );
    const usados = new Set(usos.map((u) => `${u.categoria}-${u.chave}`));
    expect([...usados].filter((k) => !definidos.has(k))).toEqual([]);
    expect([...definidos].filter((k) => !usados.has(k))).toEqual([]);
  });

  it("nenhum CSS de painel guarda texto claro fixo que o Claro não trocaria", () => {
    for (const f of ARQUIVOS) {
      const css = lerFonte(f);
      // Texto quase branco literal (fora de var(--lit-…)) ficaria invisível no Claro.
      const soltos = [
        ...css.matchAll(/(?<![-\w(,] ?)color:\s*(#f[0-9a-f]{5}|#fff)\b/gi),
      ];
      expect(
        soltos.map((m) => m[0]),
        f,
      ).toEqual([]);
    }
  });
});
