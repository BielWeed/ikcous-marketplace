// Temas do painel (Escuro, Claro, Confortável): toda cor solta do painel tem
// destino em cada tema, e o CSS gerado está em dia com o código.
//
// O painel foi desenhado para fundo escuro. Em vez de reescrever o JSX, cada
// classe solta (`text-white`, `bg-white/5`, `text-red-300`…) vira UMA regra de
// CSS em src/components/layouts/temas-do-painel-cores.css (gerada). Esta guarda:
//   1. varre src/views/admin, src/components/admin e src/components/layouts;
//   2. reprova classe solta de cor que NÃO tem regra e NÃO está na lista
//      MANTIDAS (cor mantida de propósito, com o motivo);
//   3. reprova o CSS gerado desatualizado (rode GERAR_TEMAS=1 para regravar);
//   4. reprova entrada de MANTIDAS que sumiu do código (a lista só desce).
//
// Regenerar:  GERAR_TEMAS=1 npx vitest run tests/front/temas-do-painel-cobertura.test.ts
/* eslint-disable security/detect-non-literal-fs-filename, security/detect-object-injection --
   varredura da própria árvore do repositório (caminhos vêm do disco, não de entrada de usuário) */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type ClasseSolta,
  FORA_DO_SIMULADOR,
  type Regra,
  classesSoltasDe,
  emitirCss,
  lerClasse,
  paresDeTextoBranco,
  regrasDaClasse,
} from "./temas-do-painel-gerador";

const RAIZ = join(__dirname, "..", "..");
const PASTAS_VARRIDAS = [
  "src/views/admin",
  "src/components/admin",
  "src/components/layouts",
];
const CSS_GERADO = join(
  RAIZ,
  "src/components/layouts/temas-do-painel-cores.css",
);

/**
 * Telas inteiras com tema PRÓPRIO: o simulador do celular da cliente (a vitrine
 * dela tem claro/escuro seus) e o recibo impresso. A raiz de cada uma leva
 * `data-tema-fixo`, e as regras do tema não chegam lá dentro.
 */
const BLOCOS_DE_TEMA_FIXO = [
  "src/components/admin/minha-loja/MensagemDeCompartilhar.tsx",
  "src/views/admin/AdminPushView.tsx",
  "src/views/admin/AdminBannersView.tsx",
  "src/components/admin/users/CartaoCliente.tsx",
  "src/views/admin/AdminProductsView.tsx",
];
const ARQUIVOS_DE_TEMA_FIXO = [
  "src/components/admin/PhoneSimulator.tsx",
  "src/components/admin/orders/OrderReceipt.tsx",
];

function arquivosDe(pasta: string): string[] {
  const achados: string[] = [];
  for (const nome of readdirSync(pasta)) {
    const caminho = join(pasta, nome);
    if (statSync(caminho).isDirectory()) achados.push(...arquivosDe(caminho));
    else if (/\.tsx?$/.test(nome) && !/\.test\./.test(nome))
      achados.push(caminho);
  }
  return achados;
}

function varrer(): { classes: Map<string, ClasseSolta>; regras: Regra[] } {
  const classes = new Map<string, ClasseSolta>();
  const regras: Regra[] = [];
  for (const pasta of PASTAS_VARRIDAS) {
    for (const arquivo of arquivosDe(join(RAIZ, pasta))) {
      const texto = readFileSync(arquivo, "utf8");
      if (
        ARQUIVOS_DE_TEMA_FIXO.includes(
          relative(RAIZ, arquivo).split(sep).join("/"),
        )
      )
        continue;
      for (const c of classesSoltasDe(texto)) classes.set(c.bruta, c);
      regras.push(...paresDeTextoBranco(texto));
    }
  }
  for (const c of classes.values()) {
    const r = regrasDaClasse(c);
    if (Array.isArray(r)) regras.push(...r);
  }
  return { classes, regras };
}

/**
 * Famílias que EXIGEM decisão: neutros (branco, preto, cinzas), matizes de texto
 * claros demais para fundo branco (200–500) e hex solto em texto/fundo/borda.
 * Matiz em fundo (`bg-red-500/10`) é tinta de estado e funciona nos três temas.
 */
function exigeDecisao(c: ClasseSolta): boolean {
  if (c.cor === "admin-gold") return c.util === "bg";
  if (/^(?:white|black|(?:zinc|slate|gray|neutral|stone)-\d+)$/.test(c.cor))
    return [
      "text",
      "bg",
      "border",
      "ring",
      "outline",
      "divide",
      "fill",
      "stroke",
      "placeholder",
      "from",
      "via",
      "to",
    ].some((u) => c.util === u || c.util.startsWith("border-"));
  const hex = /^\[#([0-9a-fA-F]{6})\]$/.exec(c.cor)?.[1];
  if (hex) {
    // Pastel de texto (claro demais para fundo branco) e fundo/degradê quase preto.
    const [r, g, b] = [0, 2, 4].map((i) =>
      Number.parseInt(hex.slice(i, i + 2), 16),
    );
    const luz = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    if (c.util === "text") return luz > 0.6 && !/^ff[bf]/i.test(hex);
    if (["bg", "from", "to", "via"].includes(c.util)) return luz < 0.3;
    return false;
  }
  const m = /^[a-z]+-(\d+)$/.exec(c.cor);
  if (m && /^(?:text|fill|stroke)$/.test(c.util)) {
    const n = Number(m[1]);
    return n >= 200 && n <= 500;
  }
  return false;
}

/**
 * Cor que FICA IGUAL nos três temas, de propósito. Chave = classe como escrita.
 * Cada motivo explica por que o valor escuro/saturado continua certo no claro.
 */
const ESCURO_SOBRE_CLARO =
  "texto/ícone escuro sobre preenchimento claro ou vivo (botão dourado, pílula branca): serve nos três temas";
const SOMBRA = "véu escuro translúcido: escurece em qualquer tema";
const CORTINA = "cortina de modal: escurece o fundo em qualquer tema";
const INEXISTENTE = "tom que não existe no Tailwind do projeto: sem efeito";
const SERIE = "cor de série de gráfico/legenda: identidade, não superfície";
const MEDALHA =
  "medalha prateada (1º/2º lugar) com texto escuro: identidade, igual nos três temas";
const PREVIA_ESCURA =
  "pré-visualização de banner sem imagem: bloco escuro marcado com data-tema-fixo";
const CINZA_NEUTRO = "cinza médio translúcido: legível sobre claro e escuro";
const PREVIA_DE_APARELHO =
  "prévia do WhatsApp/celular (bloco com data-tema-fixo): imita um aparelho escuro, fora do tema";
const CLARO_SOLIDO =
  "preenchimento claro sólido (miolo de interruptor, selo claro) com texto escuro por cima: fica claro nos três temas";
const MANTIDAS = new Map<string, string>([
  ["bg-zinc-100", CLARO_SOLIDO],
  ["hover:bg-zinc-200", CLARO_SOLIDO],
  ["bg-[#BE123C]", "ação negativa sólida com texto branco AA nos três temas"],
  [
    "hover:bg-[#BE123C]",
    "ação negativa sólida com texto branco AA nos três temas",
  ],
  ["bg-zinc-50", CLARO_SOLIDO],
  ["[&_[data-slot=switch-thumb]]:bg-zinc-50", CLARO_SOLIDO],
  ["bg-[#0b141a]", PREVIA_DE_APARELHO],
  ["bg-[#005c4b]", PREVIA_DE_APARELHO],
  ["bg-[#013c32]", PREVIA_DE_APARELHO],
  ["bg-[#1f2c34]", PREVIA_DE_APARELHO],
  ["from-[#2A2A33]", PREVIA_DE_APARELHO],
  ["bg-[#B82243]", "selo carmim sólido com texto branco: vivo nos três temas"],
  ["hover:text-[#53bdeb]/80", PREVIA_DE_APARELHO],
  ["text-[#25d366]", PREVIA_DE_APARELHO],
  ["text-[#53bdeb]", PREVIA_DE_APARELHO],
  ["text-[#aebac1]", PREVIA_DE_APARELHO],
  ["text-[#e9edef]", PREVIA_DE_APARELHO],
  ["to-[#0D0D11]", PREVIA_DE_APARELHO],
  ["text-black", ESCURO_SOBRE_CLARO],
  ["hover:text-black", ESCURO_SOBRE_CLARO],
  ["text-zinc-950", ESCURO_SOBRE_CLARO],
  ["fill-black", ESCURO_SOBRE_CLARO],
  ["fill-zinc-950", ESCURO_SOBRE_CLARO],
  ["border-black/20", ESCURO_SOBRE_CLARO],
  ["border-zinc-950", ESCURO_SOBRE_CLARO],
  ["border-zinc-950/25", ESCURO_SOBRE_CLARO],
  ["border-t-zinc-950", ESCURO_SOBRE_CLARO],
  ["bg-black", SOMBRA],
  ["bg-black/10", SOMBRA],
  ["bg-black/20", SOMBRA],
  ["bg-black/80", CORTINA],
  ["border-zinc-955", INEXISTENTE],
  ["bg-zinc-300", SERIE],
  ["bg-zinc-400", SERIE],
  ["data-[state=checked]:bg-zinc-300", SERIE],
  ["from-zinc-300", MEDALHA],
  ["via-zinc-400", MEDALHA],
  ["disabled:from-zinc-300", MEDALHA],
  ["disabled:to-zinc-400", MEDALHA],
  ["via-zinc-900", PREVIA_ESCURA],
  ["to-black", PREVIA_ESCURA],
  [
    "via-zinc-900/30",
    "véu decorativo a ~15% efetivo (opacity-50): some sozinho no claro",
  ],
  ["[&_.bg-admin-gold]:bg-zinc-300", SERIE],
  ["border-zinc-500/20", CINZA_NEUTRO],
  ["border-zinc-500/30", CINZA_NEUTRO],
]);

describe("mapa das cores soltas do painel", () => {
  it("troca texto branco e cinzas pelos tokens de texto, em ambos os temas", () => {
    const c = lerClasse("text-white");
    expect(c && regrasDaClasse(c)).toEqual([
      expect.objectContaining({
        escopo: "ambos",
        seletor: `.text-white${FORA_DO_SIMULADOR}`,
        declaracao: "color:hsl(var(--admin-text))",
        ordem: 0,
      }),
    ]);
    const soft = lerClasse("text-zinc-400");
    expect(soft && regrasDaClasse(soft)).toEqual([
      expect.objectContaining({
        declaracao: "color:hsl(var(--admin-text-soft))",
      }),
    ]);
  });

  it("branco translúcido vira tinta do texto do tema (no claro, escurece em vez de clarear)", () => {
    const c = lerClasse("bg-white/5");
    expect(c && regrasDaClasse(c)).toEqual([
      expect.objectContaining({
        declaracao: "background-color:hsl(var(--admin-text) / 0.05)",
      }),
    ]);
    const arb = lerClasse("hover:bg-white/[0.06]");
    expect(arb && regrasDaClasse(arb)).toEqual([
      expect.objectContaining({
        seletor: `.hover\\:bg-white\\/\\[0\\.06\\]:hover${FORA_DO_SIMULADOR}`,
        declaracao: "background-color:hsl(var(--admin-text) / 0.06)",
        ordem: 3,
      }),
    ]);
  });

  it("variante vence a base na mesma ordem do Tailwind (hover < focus < disabled < group)", () => {
    const ordem = (t: string) => {
      const c = lerClasse(t);
      const r = c && regrasDaClasse(c);
      return Array.isArray(r) ? r[0].ordem : -1;
    };
    expect(ordem("text-white")).toBeLessThan(ordem("hover:text-white"));
    expect(ordem("hover:text-white")).toBeLessThan(ordem("focus:text-white"));
    expect(ordem("focus:text-white")).toBeLessThan(
      ordem("disabled:text-zinc-400"),
    );
    expect(ordem("disabled:text-zinc-400")).toBeLessThan(
      ordem("group-hover:text-white"),
    );
  });

  it("group-hover, placeholder e data-state viram o seletor certo", () => {
    const g = lerClasse("group-hover:text-white");
    expect(g && regrasDaClasse(g)).toEqual([
      expect.objectContaining({
        seletor: `.group:hover .group-hover\\:text-white${FORA_DO_SIMULADOR}`,
      }),
    ]);
    const p = lerClasse("placeholder:text-zinc-600");
    expect(p && regrasDaClasse(p)).toEqual([
      expect.objectContaining({
        seletor: `.placeholder\\:text-zinc-600${FORA_DO_SIMULADOR}::placeholder`,
      }),
    ]);
    const d = lerClasse("data-[state=checked]:bg-zinc-700");
    expect(d && regrasDaClasse(d)).toEqual([
      expect.objectContaining({
        seletor: `.data-\\[state\\=checked\\]\\:bg-zinc-700[data-state="checked"]${FORA_DO_SIMULADOR}`,
      }),
    ]);
  });

  it("verde/vermelho/laranja de texto: só o Claro ganha tom escuro; o Confortável não muda", () => {
    const c = lerClasse("text-emerald-300");
    const r = c && regrasDaClasse(c);
    expect(r).toEqual([
      expect.objectContaining({
        escopo: "claro",
        declaracao: "color:#065f46",
      }),
    ]);
    const aviso = lerClasse("text-amber-300");
    expect(aviso && regrasDaClasse(aviso)).toEqual([
      expect.objectContaining({
        escopo: "claro",
        declaracao: "color:hsl(var(--admin-text))",
      }),
    ]);
  });

  it("fundo sólido dourado usa o preenchimento vivo; texto dourado usa o token do tema", () => {
    const fundo = lerClasse("bg-admin-gold/10");
    expect(fundo && regrasDaClasse(fundo)).toEqual([
      expect.objectContaining({
        declaracao: "background-color:hsl(var(--admin-gold-fill) / 0.1)",
      }),
    ]);
    const hex = lerClasse("text-[#FFBF00]");
    expect(hex && regrasDaClasse(hex)).toEqual([
      expect.objectContaining({
        declaracao: "color:hsl(var(--admin-gold))",
      }),
    ]);
  });

  it("campo escuro translúcido (bg-black/40) vira o fundo do tema; cortina (bg-black/80) fica", () => {
    const campo = lerClasse("bg-black/40");
    expect(campo && regrasDaClasse(campo)).toEqual([
      expect.objectContaining({
        declaracao: "background-color:hsl(var(--admin-bg))",
      }),
    ]);
    const cortina = lerClasse("bg-black/80");
    expect(cortina && regrasDaClasse(cortina)).toBeNull();
  });

  it("texto branco sobre botão colorido sólido continua branco", () => {
    const regras = paresDeTextoBranco(
      'const x = "bg-red-600 hover:bg-red-700 px-3 text-white";',
    );
    expect(regras.map((r) => r.seletor).sort()).toEqual([
      ".bg-red-600.text-white",
      ".hover\\:bg-red-700:hover.text-white",
    ]);
    expect(regras.every((r) => r.declaracao === "color:#fff")).toBe(true);
  });
});

describe("cobertura do painel", () => {
  it("as telas de tema próprio declaram data-tema-fixo na raiz", () => {
    for (const caminho of [...ARQUIVOS_DE_TEMA_FIXO, ...BLOCOS_DE_TEMA_FIXO]) {
      expect(readFileSync(join(RAIZ, caminho), "utf8")).toContain(
        'data-tema-fixo=""',
      );
    }
  });

  const { classes, regras } = varrer();

  it("toda cor solta de neutro/matiz claro tem regra ou está em MANTIDAS", () => {
    const semDestino = [...classes.values()]
      .filter(exigeDecisao)
      .filter(
        (c) => regrasDaClasse(c) === null || regrasDaClasse(c) === "variante",
      )
      .map((c) => c.bruta)
      .filter((b) => !MANTIDAS.has(b))
      .sort();
    expect(
      semDestino,
      `Classes de cor sem destino nos temas claros. Ou ensine o gerador (tests/front/temas-do-painel-gerador.ts) ou, se o valor escuro serve mesmo no claro, ponha em MANTIDAS com o motivo:\n${semDestino.join("\n")}`,
    ).toEqual([]);
  });

  it("MANTIDAS só tem classe que ainda existe e ainda não tem regra (a lista só desce)", () => {
    const sobras = [...MANTIDAS.keys()].filter((k) => {
      const c = classes.get(k);
      return (
        !c || (regrasDaClasse(c) !== null && regrasDaClasse(c) !== "variante")
      );
    });
    expect(sobras).toEqual([]);
  });

  it("o CSS gerado está em dia com o código (GERAR_TEMAS=1 regrava)", () => {
    const esperado = emitirCss(regras);
    if (process.env.GERAR_TEMAS === "1") writeFileSync(CSS_GERADO, esperado);
    const atual = readFileSync(CSS_GERADO, "utf8");
    expect(
      atual === esperado,
      `${relative(RAIZ, CSS_GERADO).split(sep).join("/")} desatualizado: rode GERAR_TEMAS=1 npx vitest run tests/front/temas-do-painel-cobertura.test.ts`,
    ).toBe(true);
  });
});
