// Gerador das regras de COR dos temas Claro e Confortável do painel.
//
// O painel foi escrito para fundo escuro: milhares de classes soltas
// (`text-white`, `text-zinc-400`, `bg-white/5`, `border-zinc-800`, `text-red-300`…).
// Em vez de reescrever o JSX (e inflar o pacote do painel, que está no teto), cada
// classe solta ganha UMA regra de CSS que só vale com `html.admin-mode[data-admin-tema]`
// e troca a cor por um token do tema. O tema Escuro (atributo ausente) não recebe
// regra nenhuma: o que já funciona não muda.
//
// A especificidade imita a do Tailwind (o prefixo vai dentro de `:where()` e pesa
// zero): `text-white` (0,1,0) segue perdendo para `hover:text-white` (0,2,0), e uma
// variante que NÃO ganhou regra continua vencendo a base, como no Tailwind. Isto
// depende do CSS do tema vir DEPOIS do CSS das utilitárias (vem: é importado pelo
// AdminLayout, que é um chunk carregado sob demanda).
//
// Quem usa: `temas-do-painel-cobertura.test.ts`. Regenerar o CSS:
//   GERAR_TEMAS=1 npx vitest run tests/front/temas-do-painel-cobertura.test.ts
/* eslint-disable security/detect-object-injection, security/detect-unsafe-regex --
   tabelas constantes e regex constantes deste arquivo (nenhuma entrada de usuário) */

export type Escopo = "ambos" | "claro" | "confortavel";

export interface ClasseSolta {
  /** Texto original, com variantes: `hover:bg-white/5`. */
  readonly bruta: string;
  readonly variantes: readonly string[];
  readonly util: string;
  readonly cor: string;
  /** Opacidade já normalizada (0–1) ou null. */
  readonly alfa: number | null;
}

export interface Regra {
  readonly escopo: Escopo;
  readonly seletor: string;
  readonly declaracao: string;
  /** Ordem de emissão: base antes das variantes, como no Tailwind. */
  readonly ordem: number;
  readonly media?: string;
}

const MATIZES =
  "red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
const UTILS =
  "text|bg|border|border-[trblxy]|ring|outline|divide|placeholder|fill|stroke|decoration|from|via|to";
const COR = `white|black|(?:zinc|slate|gray|neutral|stone)-\\d+|(?:${MATIZES})-\\d+|\\[#[0-9a-fA-F]{3,8}\\]|admin-gold`;
const BASE = new RegExp(`^(${UTILS})-(${COR})(?:/(\\[?[0-9.]+\\]?))?$`);

/** Separa `hover:focus:bg-white/5` em variantes e base, sem quebrar `[...]`. */
export function separarVariantes(token: string): {
  variantes: string[];
  base: string;
} {
  const partes: string[] = [];
  let profundidade = 0;
  let atual = "";
  for (const ch of token) {
    if (ch === "[") profundidade++;
    if (ch === "]") profundidade--;
    if (ch === ":" && profundidade === 0) {
      partes.push(atual);
      atual = "";
    } else atual += ch;
  }
  return { variantes: partes, base: atual };
}

function alfaDe(texto: string | undefined): number | null {
  if (texto === undefined) return null;
  const limpo = texto.replace(/^\[|\]$/g, "");
  const n = Number(limpo);
  if (Number.isNaN(n)) return null;
  return texto.startsWith("[") ? n : n / 100;
}

export function lerClasse(token: string): ClasseSolta | null {
  const { variantes, base } = separarVariantes(token.replace(/^!/, ""));
  const m = BASE.exec(base);
  if (!m) return null;
  return {
    bruta: token,
    variantes,
    util: m[1],
    cor: m[2],
    alfa: alfaDe(m[3]),
  };
}

/** Todas as classes soltas (com cor) de um texto de código. */
export function classesSoltasDe(texto: string): ClasseSolta[] {
  const achadas: ClasseSolta[] = [];
  for (const bruto of texto.split(/[\s"'`{}]+/)) {
    if (!bruto) continue;
    const c = lerClasse(bruto);
    if (c) achadas.push(c);
  }
  return achadas;
}

// ---------------------------------------------------------------------------
// Tabelas de troca
// ---------------------------------------------------------------------------

type Token = "text" | "text-2" | "text-soft";

const TEXTO_NEUTRO: Record<string, Token> = {
  white: "text",
  "zinc-50": "text",
  "zinc-100": "text",
  "zinc-200": "text",
  "zinc-300": "text-2",
  "zinc-350": "text-soft",
  "zinc-400": "text-soft",
  "zinc-500": "text-soft",
  "zinc-550": "text-soft",
  "zinc-600": "text-soft",
  "zinc-650": "text-soft",
  "zinc-700": "text-soft",
  "zinc-750": "text-soft",
  "zinc-800": "text-soft",
  "slate-300": "text-soft",
  "slate-400": "text-soft",
  "slate-500": "text-soft",
  "slate-600": "text-soft",
};

/** Fundo neutro sólido -> token de superfície. */
const FUNDO_NEUTRO: Record<string, string> = {
  "zinc-900": "bg",
  "zinc-950": "bg",
  "zinc-850": "raised",
  "zinc-800": "raised",
  "zinc-750": "hover",
  "zinc-700": "hover",
  "zinc-600": "border-strong",
  "zinc-500": "border-strong",
  "slate-800": "raised",
  "slate-900": "bg",
};

const BORDA_NEUTRA: Record<string, string> = {
  "zinc-50": "text",
  "zinc-400": "text-soft",
  "zinc-800": "border",
  "zinc-850": "border",
  "zinc-750": "border-strong",
  "zinc-700": "border-strong",
  "zinc-600": "border-strong",
};

const ESCURO_DE_MATIZ_NO_CLARO = (matiz: string): string =>
  matiz === "amber" || matiz === "yellow" ? "800" : "700";

const MATIZ_DE =
  /^(red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(\d+)$/;

function hsl(token: string, alfa: number | null): string {
  return alfa === null || alfa === 1
    ? `hsl(var(--admin-${token}))`
    : `hsl(var(--admin-${token}) / ${String(Number(alfa.toFixed(3)))})`;
}

/** Tailwind 3: paleta oficial de cada matiz (só o que o painel usa nos temas claros). */
const PALETA_700: Record<string, string> = {
  "red-700": "#b91c1c",
  "orange-700": "#9a3412",
  "amber-800": "#92400e",
  "yellow-800": "#854d0e",
  "lime-700": "#3f6212",
  "green-700": "#166534",
  "emerald-700": "#065f46",
  "teal-700": "#115e59",
  "cyan-700": "#155e75",
  "sky-700": "#075985",
  "blue-700": "#1d4ed8",
  "indigo-700": "#4338ca",
  "violet-700": "#6d28d9",
  "purple-700": "#7e22ce",
  "fuchsia-700": "#a21caf",
  "pink-700": "#be185d",
  "rose-700": "#be123c",
  "sky-600": "#0284c7",
  "red-600": "#dc2626",
  "orange-600": "#ea580c",
  "amber-600": "#d97706",
  "yellow-600": "#ca8a04",
  "lime-600": "#65a30d",
  "green-600": "#16a34a",
  "emerald-600": "#059669",
  "teal-600": "#0d9488",
  "cyan-600": "#0891b2",
  "blue-600": "#2563eb",
  "indigo-600": "#4f46e5",
  "violet-600": "#7c3aed",
  "purple-600": "#9333ea",
  "fuchsia-600": "#c026d3",
  "pink-600": "#db2777",
  "rose-600": "#e11d48",
};

export function hexDaPaleta(chave: string): string | undefined {
  return PALETA_700[chave];
}

/**
 * Hex solto do painel que precisa de outro valor nos temas claros.
 * Chave: `util|#hex` (minúsculo). Valor: [escopo, cor].
 *   - pastéis de TEXTO (feitos para fundo escuro) viram o tom 700 da mesma família
 *     no Claro;
 *   - o fundo da aba ativa (#3B3016) vira dourado vivo a 20% no Claro (o `#FFF2CC` do
 *     mockup); no Confortável o marrom escuro original já dá 6:1 com o dourado;
 *   - fundos escuros de alerta/cartão (rosé, violeta) viram o tom 50 da família.
 */
const HEX_CLARO: Record<string, readonly [Escopo, string, string?]> = {
  "text|#25d366": ["claro", "#166534"],
  "text|#ffa1b0": ["claro", "#be123c"],
  "text|#f5c1cc": ["claro", "#9f1239"],
  "text|#75dbff": ["claro", "#075985"],
  "text|#91abff": ["claro", "#1d4ed8"],
  "text|#c4a7ff": ["claro", "#6d28d9"],
  "text|#ffa1c6": ["claro", "#be185d"],
  "text|#6de0cf": ["claro", "#115e59"],
  "bg|#3b3016": ["claro", "hsl(var(--admin-gold-fill) / 0.2)"],
  "bg|#2b151d": ["claro", "#fff1f2"],
  "bg|#401a24": ["claro", "#ffe4e6"],
  "bg|#192a31": ["claro", "#e0f2fe", "hsl(var(--admin-raised))"],
  "from|#2c2838": ["claro", "#f5f3ff"],
  "from|#25191d": ["claro", "#fff1f2"],
  "to|#151115": ["claro", "#ffe4e6"],
  "from|#23171f": ["claro", "#fff1f2"],
};

interface Troca {
  readonly escopo: Escopo;
  readonly declaracoes: readonly string[];
  /** Mesma classe, outro valor em outro tema (ex.: Claro e Confortável diferem). */
  readonly tambem?: {
    readonly escopo: Escopo;
    readonly declaracoes: readonly string[];
  };
  /** Pseudo-elemento ou seletor extra sobre o elemento (ex.: ::placeholder). */
  readonly extra?: string;
  /** Quando o seletor muda de forma (divide). */
  readonly filhos?: boolean;
}

function propsDeCor(util: string, valor: string): string[] {
  switch (util) {
    case "text":
      return [`color:${valor}`];
    case "bg":
      return [`background-color:${valor}`];
    case "border":
      return [`border-color:${valor}`];
    case "border-t":
      return [`border-top-color:${valor}`];
    case "border-r":
      return [`border-right-color:${valor}`];
    case "border-b":
      return [`border-bottom-color:${valor}`];
    case "border-l":
      return [`border-left-color:${valor}`];
    case "border-x":
      return [`border-left-color:${valor}`, `border-right-color:${valor}`];
    case "border-y":
      return [`border-top-color:${valor}`, `border-bottom-color:${valor}`];
    case "ring":
      return [`--tw-ring-color:${valor}`];
    case "outline":
      return [`outline-color:${valor}`];
    case "fill":
      return [`fill:${valor}`];
    case "stroke":
      return [`stroke:${valor}`];
    case "decoration":
      return [`text-decoration-color:${valor}`];
    default:
      return [];
  }
}

const UTIL_DE_TEXTO = new Set(["text", "fill", "stroke", "decoration"]);
const UTIL_DE_BORDA = new Set([
  "border",
  "border-t",
  "border-r",
  "border-b",
  "border-l",
  "border-x",
  "border-y",
  "ring",
  "outline",
  "divide",
]);

/** O que fazer com uma classe solta. `null` = fica como está em todos os temas. */
export function trocaDaClasse(c: ClasseSolta): Troca | null {
  const { util, cor, alfa } = c;
  const matiz = MATIZ_DE.exec(cor);

  // ---- dourado do painel -------------------------------------------------
  if (cor === "admin-gold") {
    // O token --admin-gold passa a ser o dourado de TEXTO/borda do tema. O
    // preenchimento (fundo) mantém o dourado vivo: --admin-gold-fill.
    if (util === "bg") {
      return {
        escopo: "ambos",
        declaracoes: propsDeCor("bg", hsl("gold-fill", alfa)),
      };
    }
    return null;
  }
  if (/^\[#(?:ffbf00)\]$/i.test(cor)) {
    if (util === "text" || util === "border" || util === "ring") {
      return {
        escopo: "ambos",
        declaracoes: propsDeCor(util, hsl("gold", alfa)),
      };
    }
    return null;
  }
  if (/^\[#a1a1ad\]$/i.test(cor) && util === "text") {
    return {
      escopo: "ambos",
      declaracoes: propsDeCor("text", hsl("text-soft", alfa)),
    };
  }

  // ---- hex solto: pastéis de texto e fundos escuros do painel ------------------
  const hexSolto = /^\[(#[0-9a-fA-F]{6})\]$/.exec(cor)?.[1].toLowerCase();
  if (hexSolto) {
    const chave = `${util}|${hexSolto}`;
    const decl = HEX_CLARO[chave];
    if (decl) {
      const [escopo, valor, valorNoConfortavel] = decl;
      const declarar = (v: string): string[] =>
        util === "from" || util === "to"
          ? [`--tw-gradient-${util}:${v} var(--tw-gradient-${util}-position)`]
          : propsDeCor(util, v);
      return {
        escopo,
        declaracoes: declarar(valor),
        tambem: valorNoConfortavel
          ? { escopo: "confortavel", declaracoes: declarar(valorNoConfortavel) }
          : undefined,
      };
    }
  }

  // ---- branco e cinzas: texto -----------------------------------------------
  if (UTIL_DE_TEXTO.has(util) || util === "placeholder") {
    const token = TEXTO_NEUTRO[cor];
    if (token) {
      const prop = util === "placeholder" ? "text" : util;
      return {
        escopo: "ambos",
        declaracoes: propsDeCor(prop, hsl(token, alfa)),
        extra: util === "placeholder" ? "::placeholder" : undefined,
      };
    }
  }

  // ---- matizes (verde, vermelho…) em texto: só o Claro precisa de tom escuro
  if (matiz && (UTIL_DE_TEXTO.has(util) || util === "placeholder")) {
    const n = Number(matiz[2]);
    if (n >= 200 && n <= 500) {
      const nome = matiz[1];
      if ((nome === "amber" || nome === "yellow") && n <= 300) {
        return {
          escopo: "claro",
          declaracoes: propsDeCor(util, hsl("text", alfa)),
        };
      }
      const chave = `${nome}-${ESCURO_DE_MATIZ_NO_CLARO(nome)}`;
      const hex = PALETA_700[chave];
      if (hex) {
        return {
          escopo: "claro",
          declaracoes: propsDeCor(util, hex),
        };
      }
    }
    return null;
  }

  // ---- matizes em anel/contorno/borda sólidos: foco precisa ser visível no Claro
  if (matiz && UTIL_DE_BORDA.has(util) && alfa === null) {
    const n = Number(matiz[2]);
    if (n === 300 || n === 400) {
      const hex = PALETA_700[`${matiz[1]}-600`];
      if (hex) {
        return { escopo: "claro", declaracoes: propsDeCor(util, hex) };
      }
    }
    return null;
  }

  // ---- degradês: só troca o ponto de partida/chegada, o resto é do Tailwind -------
  if (util === "from" || util === "to") {
    const valor =
      cor === "white"
        ? hsl("text", alfa)
        : FUNDO_NEUTRO[cor]
          ? hsl(FUNDO_NEUTRO[cor], alfa)
          : null;
    if (valor) {
      return {
        escopo: "ambos",
        declaracoes: [
          `--tw-gradient-${util}:${valor} var(--tw-gradient-${util}-position)`,
        ],
      };
    }
    return null;
  }

  // ---- fundos ---------------------------------------------------------------
  if (util === "bg") {
    if (cor === "white") {
      if (alfa !== null && alfa < 1) {
        return {
          escopo: "ambos",
          declaracoes: propsDeCor("bg", hsl("text", alfa)),
        };
      }
      return {
        escopo: "confortavel",
        declaracoes: propsDeCor("bg", hsl("pill", null)),
      };
    }
    if (cor === "black") {
      // Campo/"poço" escuro sobre cartão (30–60%); acima disso é cortina.
      if (alfa !== null && alfa >= 0.3 && alfa <= 0.6) {
        return {
          escopo: "ambos",
          declaracoes: propsDeCor("bg", hsl("bg", null)),
        };
      }
      return null;
    }
    const token = FUNDO_NEUTRO[cor];
    if (token) {
      return {
        escopo: "ambos",
        declaracoes: propsDeCor("bg", hsl(token, alfa)),
      };
    }
    return null;
  }

  // ---- bordas, anéis, divisores ------------------------------------------------
  if (UTIL_DE_BORDA.has(util)) {
    if (cor === "white") {
      return {
        escopo: "ambos",
        declaracoes: propsDeCor(
          util === "divide" ? "border" : util,
          hsl("text", alfa ?? 1),
        ),
        filhos: util === "divide",
      };
    }
    const token =
      util === "divide" && /^zinc-(?:900|950)$/.test(cor)
        ? "border"
        : BORDA_NEUTRA[cor];
    if (token) {
      return {
        escopo: "ambos",
        declaracoes: propsDeCor(
          util === "divide" ? "border" : util,
          hsl(token, util === "divide" ? null : alfa),
        ),
        filhos: util === "divide",
      };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Seletores
// ---------------------------------------------------------------------------

export function escapar(classe: string): string {
  return classe.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`);
}

const ORDEM_DA_VARIANTE: Record<string, number> = {
  "focus-within": 2,
  hover: 3,
  focus: 4,
  "focus-visible": 5,
  active: 6,
  enabled: 7,
  disabled: 8,
};

const MEDIA: Record<string, string> = {
  sm: "(min-width:640px)",
  md: "(min-width:768px)",
  lg: "(min-width:1024px)",
};

/**
 * Elementos dentro de `[data-tema-fixo]` (o simulador do celular da cliente e o
 * recibo impresso) têm tema próprio e NUNCA recebem as regras. `:where` pesa zero.
 */
export const FORA_DO_SIMULADOR =
  ":where(:not([data-tema-fixo], [data-tema-fixo] *))";

interface Montado {
  readonly seletor: string;
  readonly ordem: number;
  readonly media?: string;
}

/** Monta o seletor da classe com as variantes; null se a variante não é suportada. */
export function montarSeletor(
  c: ClasseSolta,
  extra: string | undefined,
  filhos: boolean | undefined,
): Montado | null {
  let pseudo = "";
  let antes = "";
  let ordem = 0;
  let media: string | undefined;
  let elemento = extra ?? "";
  let descendente = "";
  for (const v of c.variantes) {
    if (ORDEM_DA_VARIANTE[v] !== undefined) {
      pseudo += `:${v}`;
      ordem = Math.max(ordem, ORDEM_DA_VARIANTE[v]);
    } else if (v === "disabled" || v === "enabled") {
      pseudo += `:${v}`;
    } else if (v === "aria-pressed") {
      pseudo += '[aria-pressed="true"]';
      ordem = Math.max(ordem, 1);
    } else if (v === "placeholder") {
      elemento = "::placeholder";
      ordem = Math.max(ordem, 1);
    } else if (v === "selection") {
      elemento = "::selection";
      ordem = Math.max(ordem, 1);
    } else if (v === "before" || v === "after") {
      elemento = `::${v}`;
      ordem = Math.max(ordem, 1);
    } else if (v === "dark") {
      ordem = Math.max(ordem, 1);
    } else if (v === "empty") {
      pseudo += ":empty";
      ordem = Math.max(ordem, 1);
    } else if (/^\[&.+\]$/.test(v)) {
      // Variante arbitrária: `[&_.x]:text-y` => descendente `.classe .x`.
      descendente = v.slice(2, -1).replaceAll("_", " ");
      ordem = Math.max(ordem, 1);
    } else if (v === "group-hover") {
      antes = ".group:hover ";
      ordem = Math.max(ordem, 9);
    } else if (v === "group-focus-within") {
      antes = ".group:focus-within ";
      ordem = Math.max(ordem, 9);
    } else if (/^group-hover\/[a-z-]+$/.test(v)) {
      const nome = v.split("/")[1];
      antes = `.group\\/${nome}:hover `;
      ordem = Math.max(ordem, 9);
    } else if (/^data-\[[a-z-]+=[a-z-]+\]$/.test(v)) {
      const m = /^data-\[([a-z-]+)=([a-z-]+)\]$/.exec(v);
      if (!m) return null;
      pseudo += `[data-${m[1]}="${m[2]}"]`;
      ordem = Math.max(ordem, 1);
    } else if (MEDIA[v]) {
      media = MEDIA[v];
      ordem = Math.max(ordem, 10);
    } else {
      return null;
    }
  }
  const alvo = `${antes}.${escapar(c.bruta.replace(/^!/, ""))}${pseudo}${FORA_DO_SIMULADOR}${descendente}`;
  const comFilhos = filhos ? `${alvo} > :not([hidden]) ~ :not([hidden])` : alvo;
  return { seletor: `${comFilhos}${elemento}`, ordem, media };
}

export function regrasDaClasse(c: ClasseSolta): Regra[] | "variante" | null {
  const troca = trocaDaClasse(c);
  if (!troca) return null;
  const m = montarSeletor(c, troca.extra, troca.filhos);
  if (!m) return "variante";
  const regras: Regra[] = [
    {
      escopo: troca.escopo,
      seletor: m.seletor,
      declaracao: troca.declaracoes.join(";"),
      ordem: m.ordem,
      media: m.media,
    },
  ];
  if (troca.tambem) {
    regras.push({
      escopo: troca.tambem.escopo,
      seletor: m.seletor,
      declaracao: troca.tambem.declaracoes.join(";"),
      ordem: m.ordem,
      media: m.media,
    });
  }
  return regras;
}

// ---------------------------------------------------------------------------
// Texto branco sobre fundo colorido sólido (botão vermelho, selo carmim…)
// ---------------------------------------------------------------------------

const FUNDO_SOLIDO_COLORIDO = new RegExp(
  `^bg-(?:(?:${MATIZES})-[4-9]00|\\[#[0-9a-fA-F]{6}\\])$`,
);
const TEXTO_CLARO = /^text-white$/;

function seletorSimples(
  token: string,
): { seletor: string; ordem: number } | null {
  const { variantes } = separarVariantes(token);
  let pseudo = "";
  let ordem = 0;
  for (const v of variantes) {
    if (ORDEM_DA_VARIANTE[v] === undefined) return null;
    pseudo += `:${v}`;
    ordem = Math.max(ordem, ORDEM_DA_VARIANTE[v]);
  }
  return { seletor: `.${escapar(token)}${pseudo}`, ordem };
}

/** Pares texto-branco + fundo colorido sólido dentro do mesmo literal de classe. */
export function paresDeTextoBranco(texto: string): Regra[] {
  const achadas = new Map<string, Regra>();
  for (const lit of texto.matchAll(/(["'`])((?:(?!\1)[^\n\\]|\\.)*)\1/g)) {
    const toks = lit[2].split(/\s+/).filter(Boolean);
    const textos = toks.filter((t) =>
      TEXTO_CLARO.test(separarVariantes(t).base),
    );
    const fundos = toks.filter((t) =>
      FUNDO_SOLIDO_COLORIDO.test(separarVariantes(t).base),
    );
    for (const f of fundos) {
      for (const t of textos) {
        const a = seletorSimples(f);
        const b = seletorSimples(t);
        if (!a || !b) continue;
        const seletor = `${a.seletor}${b.seletor}`;
        achadas.set(seletor, {
          escopo: "ambos",
          seletor,
          declaracao: "color:#fff",
          ordem: Math.max(a.ordem, b.ordem) + 20,
        });
      }
    }
  }
  return [...achadas.values()];
}

// ---------------------------------------------------------------------------
// Emissão do CSS
// ---------------------------------------------------------------------------

const PREFIXO: Record<Escopo, string> = {
  ambos: ":where(html.admin-mode[data-admin-tema])",
  claro: ':where(html.admin-mode[data-admin-tema="claro"])',
  confortavel: ':where(html.admin-mode[data-admin-tema="confortavel"])',
};

export const CABECALHO_DO_CSS_GERADO = `/* GERADO por tests/front/temas-do-painel-gerador.ts — NAO edite a mao.
 * Regenere: GERAR_TEMAS=1 npx vitest run tests/front/temas-do-painel-cobertura.test.ts
 * Cada regra troca UMA classe solta do painel (feita para fundo escuro) por um
 * token do tema Claro/Confortavel. Tema Escuro = nenhuma regra. O prefixo pesa
 * zero (:where) de proposito: a cascata fica igual a do Tailwind. */
`;

export function emitirCss(regras: readonly Regra[]): string {
  const unicas = new Map<string, Regra>();
  for (const r of regras) {
    unicas.set(`${r.escopo}|${r.media ?? ""}|${r.seletor}|${r.declaracao}`, r);
  }
  const ordenadas = [...unicas.values()].sort(
    (a, b) =>
      Number(a.media !== undefined) - Number(b.media !== undefined) ||
      a.ordem - b.ordem ||
      a.seletor.localeCompare(b.seletor) ||
      a.escopo.localeCompare(b.escopo),
  );
  const linhas: string[] = [];
  for (const r of ordenadas) {
    const regra = `${PREFIXO[r.escopo]} ${r.seletor}{${r.declaracao}}`;
    linhas.push(r.media ? `@media ${r.media}{${regra}}` : regra);
  }
  return `${CABECALHO_DO_CSS_GERADO}${linhas.join("\n")}\n`;
}
