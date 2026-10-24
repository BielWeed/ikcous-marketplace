//
// Celular estreito (288-320 px): rodape do carrinho, contraste do texto
// pequeno, area de toque dos botoes e movimento reduzido.
//
// Le o FONTE (mesma decisao dos contratos de acessibilidade em
// `acess-onda3-invisivel-contrato.test.tsx`): as telas arrastam hooks,
// supabase e framer-motion, e o que se prova aqui e a marcacao e o CSS.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const FONTES = import.meta.glob<string>(
  [
    "/src/views/customer/CheckoutView.tsx",
    "/src/components/ui/custom/CartFooterSummary.tsx",
    "/src/components/ui/custom/BottomNav.tsx",
    "/src/components/ui/custom/QuantitySelector.tsx",
    "/src/components/ui/custom/CartItemsList.tsx",
  ],
  { query: "?raw", import: "default", eager: true },
);

const MAPA_FONTES = new Map(Object.entries(FONTES));

function fonte(caminho: string): string {
  const texto = MAPA_FONTES.get(caminho);
  expect(texto, `falta o fonte de ${caminho}`).toBeDefined();
  return texto as string;
}

const CHECKOUT = fonte("/src/views/customer/CheckoutView.tsx");
const RODAPE = fonte("/src/components/ui/custom/CartFooterSummary.tsx");
const NAV = fonte("/src/components/ui/custom/BottomNav.tsx");
const QTD = fonte("/src/components/ui/custom/QuantitySelector.tsx");
const ITENS = fonte("/src/components/ui/custom/CartItemsList.tsx");
// eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho fixo do proprio repositorio
const CSS = readFileSync(
  new URL("../../src/index.css", import.meta.url),
  "utf8",
).replace(/\r\n/g, "\n");

// ---- contraste (WCAG 2.x) -------------------------------------------------
// Paleta do Tailwind v3 usada pelo projeto.
const PALETA = new Map<string, string>(
  Object.entries({
    "zinc-400": "#a1a1aa",
    "zinc-500": "#71717a",
    "zinc-600": "#52525b",
    "red-500": "#ef4444",
    "red-700": "#b91c1c",
    white: "#ffffff",
    "zinc-50": "#fafafa",
  }),
);

function canal(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}
function luminancia(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  return (
    0.2126 * canal((n >> 16) & 255) +
    0.7152 * canal((n >> 8) & 255) +
    0.0722 * canal(n & 255)
  );
}
function contraste(a: string, b: string): number {
  const [x, y] = [
    luminancia(PALETA.get(a) as string),
    luminancia(PALETA.get(b) as string),
  ];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

describe("a funcao de contraste confere com valores conhecidos", () => {
  it("preto sobre branco = 21, zinc-400 sobre branco abaixo de 3", () => {
    expect(contraste("white", "white")).toBeCloseTo(1, 5);
    expect(contraste("zinc-400", "white")).toBeLessThan(3);
    expect(contraste("red-500", "white")).toBeLessThan(4.5);
  });
});

describe("cores novas passam de 4,5:1 sobre branco e sobre zinc-50", () => {
  for (const cor of ["zinc-500", "zinc-600", "red-700"]) {
    for (const fundo of ["white", "zinc-50"]) {
      it(`${cor} sobre ${fundo}`, () => {
        expect(contraste(cor, fundo)).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
});

// ---- (1) rodape do carrinho ----------------------------------------------
describe("rodape do carrinho quebra linha em vez de sobrepor o preco", () => {
  it("a linha com justify-between tem flex-wrap", () => {
    const linha = RODAPE.split("\n").find((l) => l.includes("max-w-screen-xl"));
    expect(linha, "linha do rodape nao achada").toBeDefined();
    expect(linha).toMatch(/\bflex-wrap\b/);
    expect(linha).toMatch(/\bjustify-between\b/);
  });

  it("o botao Finalizar tambem quebra para a linha de baixo (zoom 200%: o botao saia pela direita)", () => {
    // Redesenho Tinta (24/10/2026): o Frete foi para baixo do Total e o botao
    // virou filho direto da linha com flex-wrap. Ele cresce (`flex-1`) a partir
    // de uma base minima (`basis-[...]`): sem espaco ao lado do Total, desce
    // para a linha de baixo em vez de sair pela direita.
    const i = RODAPE.indexOf("{/* Main Action */}");
    expect(i).toBeGreaterThan(-1);
    const botao = RODAPE.slice(
      i,
      RODAPE.indexOf(">", RODAPE.indexOf("className=", i)),
    );
    expect(botao).toMatch(/\bflex-1\b/);
    expect(botao).toMatch(/\bbasis-\[\d+px\]/);
    expect(botao).toMatch(/\bmin-w-0\b/);
  });
});

// ---- (2) contraste ---------------------------------------------------------
function rotuloDe(fonteTsx: string, ancora: string): string {
  const i = fonteTsx.indexOf(ancora);
  expect(i, `ancora nao achada: ${ancora}`).toBeGreaterThan(-1);
  return fonteTsx.slice(i, fonteTsx.indexOf(">", i + ancora.length));
}

describe("checkout: texto pequeno sem zinc-400 / red-500", () => {
  for (const id of ["checkout-name", "checkout-tel", "checkout-cpf"]) {
    it(`rotulo ${id} usa zinc-500`, () => {
      const tag = rotuloDe(CHECKOUT, `htmlFor="${id}"`);
      expect(tag).not.toMatch(/text-zinc-400/);
      expect(tag).toMatch(/text-zinc-500/);
    });
  }

  it("linha do Subtotal usa zinc-600 pelo CSS do resumo", () => {
    const i = CHECKOUT.lastIndexOf("<span>Subtotal</span>");
    expect(i).toBeGreaterThan(-1);
    const grupo = CHECKOUT.lastIndexOf('className="checkout-values"', i);
    expect(grupo).toBeGreaterThan(-1);
    const linha = CHECKOUT.slice(grupo, i);
    expect(linha).not.toMatch(/text-zinc-400/);
    const regra = CSS.match(
      /\.checkout-values > div:first-child\s*\{([^}]+)\}/,
    )?.[1];
    expect(regra).toBeDefined();
    expect(regra).toMatch(/text-zinc-600/);
    expect(regra).not.toMatch(/text-zinc-400/);
    expect(contraste("zinc-600", "white")).toBeGreaterThanOrEqual(4.5);
  });

  it("os 4 avisos vermelhos de 11px usam red-700, nenhum red-500", () => {
    // Eram 5. O aviso de frete deixou de ser vermelho (pedido do dono,
    // 22/10/2026: a espera do frete não é erro e a barra não pode crescer):
    // a espera virou texto cinza na linha Entrega, os motivos moram na seção de
    // entrega e o leitor de tela os ouve na região `status` da barra. Sobram
    // pagamento indisponível, forma desligada, sem conexão e o "como destravar"
    // da recusa. A checagem de "nenhum red-500" segue valendo.
    const base =
      "mx-auto mt-1.5 flex max-w-md items-start gap-1.5 text-[11px] font-bold uppercase";
    expect(CHECKOUT.split(`${base} text-red-500`).length - 1).toBe(0);
    expect(CHECKOUT.split(`${base} text-red-700`).length - 1).toBe(4);
  });
});

// Redesenho Tinta (24/10/2026): o texto secundario do rodape deixou de usar
// zinc-500 fixo e passou para `text-muted-foreground`, que muda com o tema.
// A troca so e honesta se o token medir o MESMO que o zinc-500 que ela
// substitui (>= 4,5:1) nos dois temas -- por isso a medicao abaixo le o valor
// dos tokens em index.css em vez de presumir.
function hslParaHex(h: number, s: number, l: number): string {
  const sat = s / 100;
  const luz = l / 100;
  const a = sat * Math.min(luz, 1 - luz);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const v = luz - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(v * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function tokenHsl(bloco: "root" | "dark", nome: string): string {
  const abre = bloco === "root" ? "  :root {" : "  .dark {";
  const ini = CSS.indexOf(abre);
  expect(ini, `bloco ${bloco} nao achado em index.css`).toBeGreaterThan(-1);
  const corpo = CSS.slice(ini, CSS.indexOf("}", ini));
  const m = corpo.match(
    // eslint-disable-next-line security/detect-non-literal-regexp -- `nome` é um token fixo do próprio teste, nunca entrada externa
    new RegExp(`--${nome}:\\s*([\\d.]+)\\s+([\\d.]+)%\\s+([\\d.]+)%`),
  );
  expect(m, `--${nome} nao achado no bloco ${bloco}`).not.toBeNull();
  return hslParaHex(Number(m?.[1]), Number(m?.[2]), Number(m?.[3]));
}

describe("rodape do carrinho: rotulos Total/Frete/Seu Carrinho", () => {
  it("linha do Frete: cinza do tema quando cotado/a calcular, verde 700 quando gratis, nunca zinc-400", () => {
    // O rotulo "Frete" herda a cor do paragrafo que o envolve.
    const i = RODAPE.indexOf("<span>Frete</span>");
    expect(i).toBeGreaterThan(-1);
    const paragrafo = RODAPE.slice(RODAPE.lastIndexOf("<p", i), i);
    expect(paragrafo).not.toMatch(/text-zinc-400/);
    expect(paragrafo).toMatch(/\btext-muted-foreground\b/);
    expect(paragrafo).toMatch(/\btext-emerald-700\b/);
  });

  for (const rotulo of ["Seu Carrinho", "Total"]) {
    it(`rotulo ${rotulo} sem zinc-400, com o token secundario do tema`, () => {
      const m = RODAPE.match(
        // eslint-disable-next-line security/detect-non-literal-regexp -- `rotulo` vem da lista fixa acima, nunca de entrada externa
        new RegExp(`<span([^>]*)>\\s*${rotulo}\\s*</span>`),
      );
      expect(m, `rotulo ${rotulo} nao achado`).not.toBeNull();
      const tag = m?.[1] as string;
      expect(tag).not.toMatch(/text-zinc-400/);
      expect(tag).toMatch(/\btext-muted-foreground\b/);
      expect(tag).not.toMatch(/text-muted-foreground\//);
    });
  }

  for (const [bloco, fundo] of [
    ["root", "background"],
    ["dark", "background"],
  ] as const) {
    it(`o token muted-foreground passa de 4,5:1 sobre o fundo no tema ${bloco}`, () => {
      PALETA.set("token-texto", tokenHsl(bloco, "muted-foreground"));
      PALETA.set("token-fundo", tokenHsl(bloco, fundo));
      expect(contraste("token-texto", "token-fundo")).toBeGreaterThanOrEqual(
        4.5,
      );
    });
  }
});

describe("BottomNav: aba inativa legivel", () => {
  it("nao usa zinc-400 nem opacity-60 na aba inativa", () => {
    expect(NAV).not.toMatch(/text-zinc-400/);
    expect(NAV).not.toMatch(/opacity-60/);
  });
  it("aba inativa usa zinc-500", () => {
    expect(NAV).toMatch(/: "text-zinc-500 hover:text-zinc-700/);
  });
});

// ---- (3) area de toque -----------------------------------------------------
// Tailwind: w-7 = 1.75rem = 28px; before:-inset-2 = 0.5rem = 8px por lado.
function px(token: string): number {
  return Number(token) * 4;
}

describe("area de toque invisivel >= 44px", () => {
  it("QuantitySelector sm: botao 28px + before:-inset-2 nos dois botoes", () => {
    expect(QTD).toMatch(/"w-7 h-7 relative/);
    const lado = px("7") + 2 * px("2");
    expect(lado).toBeGreaterThanOrEqual(44);
    expect(QTD).toMatch(/before:-inset-2/);
    expect(QTD).toMatch(/before:absolute/);
    // os dois botoes (- e +) usam a mesma classe de botao
    const usos = QTD.split("${buttonSize} ").length - 1;
    expect(usos).toBe(2);
  });

  it("os botoes - e + nao se sobrepoem: 2 x 8px < 32px do numero entre eles", () => {
    // numero central do sm = w-8 (32px); cada area invade 8px dele.
    expect(QTD).toMatch(/size === "sm" \? "h-7 w-8"/);
    expect(2 * px("2")).toBeLessThan(px("8"));
  });

  it("botao Remover do carrinho: size-7 (28px) + after/before -inset-2", () => {
    const i = ITENS.indexOf('aria-label="Remover item"');
    const tag = ITENS.slice(ITENS.lastIndexOf("<button", i), i);
    expect(tag).toMatch(/\bsize-7\b/);
    expect(px("7") + 2 * px("2")).toBeGreaterThanOrEqual(44);
    expect(tag).toMatch(/\brelative\b/);
    expect(tag).toMatch(/before:absolute/);
    expect(tag).toMatch(/before:-inset-2/);
  });
});

// ---- (4) reduzir movimento -------------------------------------------------
describe("prefers-reduced-motion zera tambem a transicao de visao", () => {
  const ini = CSS.indexOf("@media (prefers-reduced-motion: reduce)");
  it("o bloco existe", () => {
    expect(ini).toBeGreaterThan(-1);
  });
  const bloco = (() => {
    let prof = 0;
    let fim = ini;
    for (let k = CSS.indexOf("{", ini); k < CSS.length; k++) {
      if (CSS.charAt(k) === "{") prof++;
      if (CSS.charAt(k) === "}") {
        prof--;
        if (prof === 0) {
          fim = k;
          break;
        }
      }
    }
    return CSS.slice(ini, fim + 1);
  })();

  const pseudos: [string, RegExp][] = [
    ["group", /::view-transition-group\(\*\)[^{}]*\{[^}]*\}/s],
    ["old", /::view-transition-old\(\*\)[^{}]*\{[^}]*\}/s],
    ["new", /::view-transition-new\(\*\)[^{}]*\{[^}]*\}/s],
  ];
  for (const [parte, regra] of pseudos) {
    it(`::view-transition-${parte}(*) tem animation: none`, () => {
      const m = bloco.match(regra);
      expect(m, `falta ::view-transition-${parte}(*) no bloco`).not.toBeNull();
      expect(m?.[0]).toMatch(/animation:\s*none\s*!important/);
    });
  }
});
