import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const busca = readFileSync("src/views/customer/SearchView.tsx", "utf8");
const conta = readFileSync(
  "src/views/customer/AccountSettingsView.tsx",
  "utf8",
);

describe("vitrine — texto legível sobre os fundos reais de cada tema", () => {
  it("a busca usa uma superfície opaca do tema e o título herda a tinta", () => {
    expect(busca).toMatch(
      /<div\s+className=\{cn\(\s*"pb-customer min-h-full bg-white selection:bg-black selection:text-white",\s*CONTRASTE_ESCURO\.fundo,?\s*\)\}/,
    );
    expect(busca).toContain('fundo: "dark:bg-card dark:text-foreground"');
    const titulo = busca.match(
      /<h2\s+className="([^"]*)"\s*>\s+Encontramos\s+/,
    );
    expect(titulo).not.toBeNull();
    expect(titulo?.[1].split(/\s+/)).not.toContain("text-zinc-900");
  });

  it("o modal de avatar usa a superfície do tema e sobrescreve a tinta e a opacidade do X", () => {
    const modal = conta.match(
      /<Dialog\s+open={isAvatarModalOpen}[^>]*>\s+<DialogContent\s+[\s\S]*?className="([^"]*)"/,
    );
    expect(modal?.[1].split(/\s+/)).toEqual(
      expect.arrayContaining([
        "bg-white",
        "dark:bg-card",
        "dark:text-foreground",
        "dark:[&>button[data-slot=dialog-close]]:text-foreground",
        "dark:[&>button[data-slot=dialog-close]]:opacity-100",
      ]),
    );
    expect(
      modal?.[1].split(/\s+/).filter((c) => !c.startsWith("dark:")),
    ).toEqual(
      "z-[130] max-h-[85dvh] max-w-xs overflow-y-auto overflow-x-hidden rounded-[2.5rem] border border-zinc-100 bg-white p-6 shadow-premium sm:max-w-md".split(
        " ",
      ),
    );
  });

  it("a superfície da busca e do modal continua branca no claro e opaca no glass", () => {
    const css = readFileSync("src/index.css", "utf8");
    expect(css.match(/:root\s*{([^}]+)}/)?.[1]).toMatch(/--card:\s*0 0% 100%;/);
    expect(css.match(/\.dark\s*{([^}]+)}/)?.[1]).toMatch(
      /--card:\s*240 10% 3\.9%;/,
    );
    const glass = css.match(/\[data-theme-mode="glass"\]\s*{([^}]+)}/)?.[1];
    expect(glass).toMatch(/--background:\s*transparent;/);
    expect(glass).not.toMatch(/--card\s*:/);
  });

  it("o campo de busca preserva a tinta do claro e usa o token sobre o fundo escuro", () => {
    const campo = busca.match(
      /<Input\s+id="search-input"[\s\S]*?className=\{cn\(\s*"([^"]*)",\s*CONTRASTE_ESCURO\.campo,?\s*\)\}/,
    );
    expect(campo?.[1].split(/\s+/)).toEqual(
      expect.arrayContaining(["text-zinc-900", "placeholder:text-zinc-500"]),
    );
    expect(busca).toMatch(
      /campo:\s*"dark:text-foreground dark:placeholder:text-muted-foreground"/,
    );
    expect(busca).toMatch(
      /<SearchIcon\s+className=\{cn\(\s*"[^"]*group-focus-within:text-zinc-900",\s*CONTRASTE_ESCURO\.lupa,?\s*\)\}/,
    );
    expect(busca).toContain('lupa: "dark:group-focus-within:text-foreground"');
  });

  it("as duas abas do modal usam superfícies e tintas temáticas no escuro", () => {
    const abas = conta
      .split("{/* Modal Tab Selector */}")[1]
      ?.split('<div className="relative space-y-4 py-2">')[0];
    expect(abas).toContain("bg-zinc-100/80 p-1 shadow-inner dark:bg-muted");
    expect(abas?.match(/"text-zinc-900 dark:text-foreground"/g)).toHaveLength(
      2,
    );
    expect(
      abas?.match(
        /"text-zinc-500 hover:text-zinc-900 dark:text-muted-foreground dark:hover:text-foreground"/g,
      ),
    ).toHaveLength(2);
    expect(abas?.match(/bg-white shadow-sm dark:bg-card/g)).toHaveLength(2);
  });

  it("o rótulo A partir de mantém o cinza do claro e acompanha o fundo do cartão no escuro", () => {
    const cartao = readFileSync(
      "src/components/ui/custom/ProductCard.tsx",
      "utf8",
    );
    const rotulo = cartao.match(
      /\{aPartirDe && \(\s*<span\s+className=\{cn\(\s*"([^"]*)"[\s\S]*?>\s*A partir de/,
    );
    expect(rotulo?.[1].split(/\s+/)).toEqual(
      expect.arrayContaining([
        "text-slate-600",
        "dark:bg-card",
        "dark:text-foreground",
        "dark:group-hover:bg-white",
        "dark:group-hover:text-slate-600",
      ]),
    );
  });

  it("o aviso de atualização só desativa o pulso e escurece a tinta em Escuro/Glass", () => {
    const aviso = conta.match(
      /<span className="([^"]*)"\s*>\s*Atualizando\.\.\./,
    );
    expect(aviso?.[1].split(/\s+/)).toEqual(
      "animate-pulse text-[10px] font-black uppercase tracking-wider text-zinc-500 dark:animate-none dark:text-zinc-900".split(
        " ",
      ),
    );
  });

  it("o placeholder da conta mantém 60% no Claro e usa o token opaco em Escuro/Glass", () => {
    const campo = conta.match(/const CAMPO\s*=\s*"([^"]*)"/);
    expect(campo).not.toBeNull();
    const classes = campo?.[1].split(/\s+/);
    expect(classes).toContain("placeholder:text-muted-foreground/60");
    expect(classes).not.toContain("placeholder:text-muted-foreground");
    expect(classes).toContain("dark:placeholder:text-muted-foreground");
    expect(classes).toContain("dark:bg-muted");
    expect(classes).toContain("dark:focus-visible:bg-card");
  });

  it("a tinta cheia passa de 4,5:1 sobre os fundos opacos do campo no Escuro/Glass", () => {
    const css = readFileSync("src/index.css", "utf8");
    const escuro = css.match(/\.dark\s*{([^}]+)}/)?.[1] ?? "";
    function rgb(nome: string): number[] {
      const cor = escuro.match(
        new RegExp(`--${nome}:\\s*([\\d.]+)\\s+([\\d.]+)%\\s+([\\d.]+)%`),
      );
      expect(cor).not.toBeNull();
      const [h, s, l] = cor!.slice(1).map(Number);
      const lum = l / 100;
      const a = (s / 100) * Math.min(lum, 1 - lum);
      return [0, 8, 4].map((n) => {
        const k = (n + h / 30) % 12;
        return lum - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
      });
    }
    const luminancia = (cor: number[]) =>
      cor.reduce((soma, canal, i) => {
        const linear =
          canal <= 0.04045 ? canal / 12.92 : ((canal + 0.055) / 1.055) ** 2.4;
        return soma + linear * [0.2126, 0.7152, 0.0722][i];
      }, 0);
    const tinta = luminancia(rgb("muted-foreground"));
    for (const fundo of ["muted", "card"]) {
      const contraste = (tinta + 0.05) / (luminancia(rgb(fundo)) + 0.05);
      expect(contraste, fundo).toBeGreaterThanOrEqual(4.5);
    }
  });
});
