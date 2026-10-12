// @vitest-environment jsdom
//
// Onda K · K-D (frete-e-minha-loja): alvos de toque de 44px e letra >= 11px em
// Frete (cartão de transportadoras, ajuda e Salvar) e em Minha loja (Salvar,
// prévia do mapa, identidade) — sem mudar nenhum comportamento.
//
// O jsdom não aplica CSS: a prova de toque/layout é sobre a CLASSE (estática,
// lendo a fonte pelo marcador de texto, ou no DOM renderizado). A medida real
// em pixels é do render do integrador.
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

const CARTAO = "src/components/admin/settings/TransportadorasCard.tsx";
const FRETE = "src/views/admin/AdminShippingView.tsx";
const RECOLHIVEL = "src/components/admin/shipping/PainelRecolhivel.tsx";
const SOBRE = "src/views/admin/AdminAboutStoreView.tsx";
const IDENTIDADE = "src/components/admin/settings/IdentitySettingsSection.tsx";

/** Posição da última abertura de `<tag` antes de `indice` (-1 se não houver). */
function ultimaAbertura(fonte: string, tag: string, indice: number): number {
  const abertura = `<${tag}`;
  for (let i = fonte.lastIndexOf(abertura, indice); i >= 0; ) {
    // `<p` não pode casar `<path`: o caractere seguinte tem de ser espaço ou `>`.
    if (/[\s>]/.test(fonte.charAt(i + abertura.length))) return i;
    i = i === 0 ? -1 : fonte.lastIndexOf(abertura, i - 1);
  }
  return -1;
}

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

/** Abertura do elemento `tag` que envolve o marcador de texto/código. */
function aberturaQueEnvolve(fonte: string, marcador: string, tag: string) {
  const indice = fonte.indexOf(marcador);
  expect(indice, `marcador ausente: ${marcador}`).toBeGreaterThan(-1);
  const inicio = ultimaAbertura(fonte, tag, indice);
  expect(inicio, `<${tag}> não envolve ${marcador}`).toBeGreaterThan(-1);
  return { inicio, tag: tagDeAbertura(fonte, inicio), indice };
}

/** Aberturas de `<label` cujo corpo (até `</label>`) contém `trecho`. */
function labelsCom(fonte: string, trecho: string): string[] {
  const achadas: string[] = [];
  const re = /<label(?=[\s>])/g;
  for (let m = re.exec(fonte); m; m = re.exec(fonte)) {
    const fim = fonte.indexOf("</label>", m.index);
    if (fonte.slice(m.index, fim).includes(trecho)) {
      achadas.push(tagDeAbertura(fonte, m.index));
    }
  }
  return achadas;
}

/** Cada `<HelpCircle` dentro de um `<button`: devolve a tag do botão. */
function botoesDeAjuda(fonte: string): string[] {
  const achadas: string[] = [];
  const re = /<HelpCircle(?=[\s/>])/g;
  for (let m = re.exec(fonte); m; m = re.exec(fonte)) {
    const abertura = ultimaAbertura(fonte, "button", m.index);
    const fechamento = fonte.lastIndexOf("</button>", m.index);
    if (abertura > fechamento) achadas.push(tagDeAbertura(fonte, abertura));
  }
  return achadas;
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

describe("K-D · Frete: cartão de transportadoras com alvos de 44px (estático)", () => {
  const fonte = lerFonte(CARTAO);

  it("(a) 'Ver serviços da conta' / 'Atualizar lista' tem min-h-11", () => {
    const { tag } = aberturaQueEnvolve(
      fonte,
      ': "Ver serviços da conta"',
      "button",
    );
    expect(tag).toContain("onClick={onCarregarServicos}");
    expect(tag).toMatch(/\bmin-h-11\b/);
  });

  it("(b) a linha 'Modo de teste' é um <label> de 44px com o Switch dentro", () => {
    const marcador = ">Modo de teste</span>";
    const { inicio, tag, indice } = aberturaQueEnvolve(
      fonte,
      marcador,
      "label",
    );
    const fim = fonte.indexOf("</label>", inicio);
    expect(indice).toBeLessThan(fim);
    expect(tag).toMatch(/\bmin-h-11\b/);
    expect(fonte.slice(inicio, fim)).toContain("<Switch");
  });

  it("(c) as linhas com caixa de seleção são <label> com min-h-11 e caixa size-5", () => {
    const labels = labelsCom(fonte, 'type="checkbox"');
    expect(labels).toHaveLength(2);
    for (const tag of labels) expect(tag).toMatch(/\bmin-h-11\b/);
    const caixas = fonte.match(
      /type="checkbox"[\s\S]{0,260}?className="([^"]*)"/g,
    );
    expect(caixas).toHaveLength(2);
    for (const caixa of caixas ?? []) expect(caixa).toMatch(/\bsize-5\b/);
  });

  it("(d) nenhum campo ficou com h-9", () => {
    expect(semComentarios(fonte)).not.toMatch(/\bh-9\b/);
  });

  it("(e) Testar, Tentar de novo e Salvar do cartão têm min-h-11", () => {
    const testar = aberturaQueEnvolve(fonte, "onClick={onTestar}", "button");
    const salvar = aberturaQueEnvolve(fonte, "onClick={onSalvar}", "button");
    const tentar = aberturaQueEnvolve(
      fonte,
      "          Tentar de novo\n",
      "button",
    );
    for (const { tag } of [testar, salvar, tentar]) {
      expect(tag).toMatch(/\bmin-h-11\b/);
    }
  });
});

describe("K-D · Frete: tela com ajuda e Salvar de 44px (estático)", () => {
  const fonte = lerFonte(FRETE);

  it("o botão de ajuda tem min-h-11 min-w-11 (desenho de size-7 no <span>)", () => {
    const botoes = botoesDeAjuda(fonte);
    expect(botoes).toHaveLength(1);
    for (const tag of botoes) {
      expect(tag).toMatch(/\bmin-h-11\b/);
      expect(tag).toMatch(/\bmin-w-11\b/);
    }
    const { inicio } = aberturaQueEnvolve(fonte, "<HelpCircle", "button");
    const fim = fonte.indexOf("</button>", inicio);
    expect(fonte.slice(inicio, fim)).toMatch(/<span[^>]*\bsize-7\b/);
  });

  it("o botão Salvar tem min-h-11", () => {
    const { tag } = aberturaQueEnvolve(fonte, "onClick={handleSave}", "button");
    expect(tag).toMatch(/\bmin-h-11\b/);
  });
});

describe("K-D · Minha loja e painel recolhível: letra >= 11px e tokens (estático)", () => {
  it("PainelRecolhivel não tem texto abaixo de 11px", () => {
    expect(semComentarios(lerFonte(RECOLHIVEL))).not.toMatch(TEXTO_MIUDO);
  });

  it("(g) Salvar de Minha loja: min-h-11, 11px e tokens no lugar de hex", () => {
    const { tag } = aberturaQueEnvolve(
      lerFonte(SOBRE),
      "onClick={() => void handleSubmit()}",
      "button",
    );
    expect(tag).toMatch(/\bmin-h-11\b/);
    expect(tag).toContain("text-[11px]");
    expect(tag).not.toMatch(/\bh-10\b/);
    expect(tag).not.toMatch(TEXTO_MIUDO);
    expect(tag).not.toMatch(/#e3c25e|#09090b/i);
    expect(tag).toContain("hover:bg-admin-gold/90");
    expect(tag).toContain("focus-visible:ring-offset-admin-bg");
  });

  it("(g) 'Prévia do que o cliente vê' está em 11px", () => {
    const { tag } = aberturaQueEnvolve(
      lerFonte(SOBRE),
      "Prévia do que o cliente vê",
      "p",
    );
    expect(tag).toContain("text-[11px]");
    expect(tag).not.toMatch(TEXTO_MIUDO);
  });

  it("(f) identidade: os <Input> pedem h-11 e a linha 'Usar também na abertura' é de 44px", () => {
    const fonteId = lerFonte(IDENTIDADE);
    const inputs = [...fonteId.matchAll(/<Input(?=[\s>])/g)].map((m) =>
      tagDeAbertura(fonteId, m.index),
    );
    expect(inputs).toHaveLength(2);
    for (const tag of inputs) expect(tag).toMatch(/className="[^"]*\bh-11\b/);
    const [linha] = labelsCom(fonteId, "Usar também na abertura");
    expect(linha).toMatch(/\bmin-h-11\b/);
    const caixa = aberturaQueEnvolve(fonteId, "checked={alsoOpening}", "input");
    expect(caixa.tag).toMatch(/\bsize-5\b/);
  });
});

// --- Render: tocar no TEXTO "Modo de teste" liga/desliga o mesmo Switch -------

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({ select: () => Promise.resolve({ data: [], error: null }) }),
    functions: {
      invoke: (...args: unknown[]) => invoke(...(args as [any, any])),
    },
  },
}));
vi.mock("@/lib/revisao-do-frete", () => ({
  descartarCacheDeFreteDoNavegador: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const esperar = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

// Melhor Envio sem chave: nasce ABERTO, com o interruptor "Modo de teste".
const RESPOSTA_SEM_CHAVES = {
  success: true,
  modo: "multi",
  ligados: [],
  provedores: {
    melhor_envio: { tem_chave: false, sandbox: false, servicos: null },
    superfrete: { tem_chave: false, sandbox: false, servicos: null },
    frenet: { tem_chave: false, sandbox: false, servicos: null },
  },
};

describe("K-D · Frete: 'Modo de teste' pelo texto (render)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    invoke.mockImplementation((_n: string, opcoes: any) =>
      Promise.resolve({
        data:
          opcoes?.body?.action === "ler_configuracao_frete"
            ? RESPOSTA_SEM_CHAVES
            : { success: true },
        error: null,
      }),
    );
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

  it("o texto 'Modo de teste' está num <label> min-h-11 com o Switch; clicar no texto liga o Switch", async () => {
    const { TransportadorasSection } = await import(
      "@/components/admin/settings/TransportadorasCard"
    );
    await act(async () => {
      raiz.render(<TransportadorasSection />);
    });
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        await esperar();
      });
    }
    const texto = [...hospedeiro.querySelectorAll("span")].find(
      (s) => s.textContent === "Modo de teste",
    );
    expect(texto).toBeDefined();
    const linha = texto?.closest("label");
    expect(linha).not.toBeNull();
    expect(linha?.className).toMatch(/\bmin-h-11\b/);
    const interruptor = linha?.querySelector<HTMLElement>(
      'button[role="switch"]',
    );
    expect(interruptor).not.toBeNull();
    expect(interruptor?.getAttribute("aria-checked")).toBe("false");

    await act(async () => {
      texto?.click();
    });
    expect(interruptor?.getAttribute("aria-checked")).toBe("true");
  });
});
