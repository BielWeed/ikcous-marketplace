import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import postcss from "postcss";
import selectorParser from "postcss-selector-parser";
import tailwindcss from "tailwindcss";
import { describe, expect, it } from "vitest";

const casos = [
  {
    nome: "carrinho",
    arquivo: "src/views/customer/CartView.tsx",
    trecho: /className="([^"]*)"\s*>\s*Entrar na conta\s*<ArrowRight/,
    novas: ["bg-foreground", "text-card"],
    antigas: ["text-background"],
  },
  {
    nome: "favoritos",
    arquivo: "src/views/customer/FavoritesView.tsx",
    trecho: /className="([^"]*)"\s*>\s*Ver produtos/,
    novas: ["bg-foreground", "text-card"],
    antigas: ["text-background"],
  },
  {
    nome: "título do erro de perfil",
    arquivo: "src/views/customer/UserProfileView.tsx",
    trecho:
      /<h3 className="([^"]*)"\s*>\s*Não conseguimos carregar este perfil/,
    novas: ["text-foreground"],
    antigas: ["text-zinc-900"],
  },
  {
    nome: "mensagem do erro de perfil",
    arquivo: "src/views/customer/UserProfileView.tsx",
    trecho: /<p className="([^"]*)"\s*>\s*Verifique sua conexão/,
    novas: ["text-muted-foreground"],
    antigas: ["text-zinc-500"],
  },
  {
    nome: "ação do erro de perfil",
    arquivo: "src/views/customer/UserProfileView.tsx",
    trecho:
      /onClick=\{\(\) => setTentativa\(\(t\) => t \+ 1\)\}\s*className="([^"]*)"\s*>\s*Tentar de novo/,
    novas: ["text-foreground", "hover:bg-muted"],
    antigas: ["text-zinc-900", "hover:bg-zinc-50"],
  },
  {
    nome: "título do perfil inexistente",
    arquivo: "src/views/customer/UserProfileView.tsx",
    trecho: /<h3 className="([^"]*)"\s*>\s*Usuário não encontrado/,
    novas: ["text-foreground"],
    antigas: ["text-zinc-900"],
  },
  {
    nome: "mensagem do perfil inexistente",
    arquivo: "src/views/customer/UserProfileView.tsx",
    trecho: /<p className="([^"]*)"\s*>\s*O perfil público solicitado/,
    novas: ["text-muted-foreground"],
    antigas: ["text-zinc-500"],
  },
  {
    nome: "ação do perfil inexistente",
    arquivo: "src/views/customer/UserProfileView.tsx",
    trecho: /className="([^"]*)"\s*>\s*<ArrowLeft[^>]*>\s*Voltar para o Início/,
    novas: ["text-foreground", "hover:bg-muted"],
    antigas: ["text-zinc-900", "hover:bg-zinc-50"],
  },
  {
    nome: "CEP",
    arquivo: "src/components/ui/custom/AddressForm.tsx",
    // eslint-disable-next-line security/detect-unsafe-regex -- roda só sobre o texto de um arquivo do repositório, de tamanho fixo e conhecido
    trecho: /id="cep"[\s\S]*?\bCAMPO,\s*(?:\/\/[^\n]*\s*)*"([^"]*)"/,
    novas: [
      "placeholder:text-muted-foreground/40",
      "[html[data-theme-mode=glass]_&]:bg-card",
      "[html[data-theme-mode=glass]_&]:placeholder:text-muted-foreground",
    ],
    antigas: ["placeholder:text-muted-foreground"],
  },
  {
    nome: "campo de resposta",
    arquivo: "src/views/admin/AdminReviewsView.tsx",
    trecho: /aria-label="Sua resposta"[\s\S]*?className="([^"]*)"/,
    novas: [
      "border-[hsl(var(--admin-text-soft))]",
      "focus-visible:outline",
      "focus-visible:outline-2",
    ],
    antigas: ["border-admin-border-strong"],
  },
  {
    nome: "superfície do vazio de favoritos",
    arquivo: "src/views/customer/FavoritesView.tsx",
    trecho:
      /<div className="(flex flex-col items-center px-6 pb-6 pt-10 text-center[^"]*)">\s*<div className="mb-6 grid size-28/,
    novas: ["[html[data-theme-mode=glass]_&]:bg-card"],
    antigas: [],
  },
  {
    nome: "superfície do erro de perfil",
    arquivo: "src/views/customer/UserProfileView.tsx",
    trecho: /if \(loadError\) \{\s*return \(\s*<div className="([^"]*)"/,
    novas: ["bg-card"],
    antigas: [],
  },
  {
    nome: "superfície do perfil inexistente",
    arquivo: "src/views/customer/UserProfileView.tsx",
    trecho: /if \(!profile\) \{\s*return \(\s*<div className="([^"]*)"/,
    novas: ["bg-card"],
    antigas: [],
  },
  {
    nome: "borda do CEP em repouso sem erro",
    arquivo: "src/components/ui/custom/AddressForm.tsx",
    trecho: /!cepAchado &&\s*!cepComProblema &&\s*!erros\.cep &&\s*"([^"]*)"/,
    novas: [
      "[html[data-theme-mode=glass]_&:not(:focus)]:border-muted-foreground",
    ],
    antigas: [],
  },
  {
    nome: "aviso de resposta offline fora do campo esmaecido",
    arquivo: "src/views/admin/AdminReviewsView.tsx",
    trecho:
      /\{isOffline && \(\s*<p\s+id=\{`avisoRespostaOffline\$\{reviewId\}`}\s+className="([^"]*)"\s*>\s*Você está offline\. Não é possível responder no momento\.\s*<\/p>\s*\)\}\s*<textarea/,
    novas: ["text-[hsl(var(--admin-text-soft))]"],
    antigas: [],
  },
  {
    nome: "nova tentativa de imagem",
    arquivo: "src/components/LazyImage.tsx",
    trecho: /<span className="([^"]*)"\s*>\s*Toque para tentar de novo/,
    novas: ["dark:text-zinc-400"],
    antigas: ["dark:text-zinc-500"],
  },
];

describe("contraste nos temas escuro e Glass", () => {
  it.each(casos)(
    "$nome usa as classes de contraste no trecho certo",
    (caso) => {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- Caminhos fixos da tabela de casos.
      const fonte = readFileSync(caso.arquivo, "utf8");
      const classes = fonte.match(caso.trecho)?.[1]?.split(/\s+/);
      expect(classes).toBeDefined();
      expect(classes).toEqual(expect.arrayContaining(caso.novas));
      for (const antiga of caso.antigas) expect(classes).not.toContain(antiga);
    },
  );

  it("o Tailwind do projeto emite seletores para as classes", async () => {
    const carregar = createRequire(import.meta.url)(
      "tailwindcss/loadConfig",
    ) as (caminho: string) => Record<string, unknown>;
    const classes = [...new Set(casos.flatMap((caso) => caso.novas))];
    const resultado = await postcss([
      tailwindcss({
        ...carregar(resolve("tailwind.config.js")),
        content: [...new Set(casos.map((caso) => caso.arquivo))],
      }),
    ]).process("@tailwind utilities;", { from: undefined });

    const geradas = new Set<string>();
    const coresGlass = new Set<string>();
    resultado.root.walkRules((regra) => {
      selectorParser((seletores) => {
        seletores.walkClasses((classe) => {
          geradas.add(classe.value);
        });
        seletores.walkAttributes((atributo) => {
          if (
            atributo.attribute !== "data-theme-mode" ||
            atributo.value !== "glass"
          )
            return;
          regra.walkDecls((declaracao) => {
            coresGlass.add(`${declaracao.prop}: ${declaracao.value}`);
          });
        });
      }).processSync(regra.selector);
    });
    expect([...geradas]).toEqual(expect.arrayContaining(classes));
    expect([...coresGlass]).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^background-color: hsl\(var\(--card\)/),
        expect.stringMatching(/^border-color: hsl\(var\(--muted-foreground\)/),
        expect.stringMatching(/^color: hsl\(var\(--muted-foreground\)/),
      ]),
    );
  });
});
