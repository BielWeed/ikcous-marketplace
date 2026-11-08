import { describe, expect, it } from "vitest";

// Contrato de classes: jsdom não mede fonte ampliada nem transbordamento.
const FONTES = import.meta.glob<string>(
  [
    "/src/components/ui/custom/BottomNav.tsx",
    "/src/components/layouts/AdminLayout.tsx",
    "/src/components/ui/dialog.tsx",
    "/src/components/ui/alert-dialog.tsx",
  ],
  { query: "?raw", import: "default", eager: true },
);
const fontes = new Map(Object.entries(FONTES));

function fonte(caminho: string): string {
  const texto = fontes.get(caminho);
  expect(texto, caminho).toBeDefined();
  return texto as string;
}

describe("fonte grande no celular", () => {
  it("as quatro abas da loja podem encolher só quando falta espaço e seus rótulos não as alargam", () => {
    const nav = fonte("/src/components/ui/custom/BottomNav.tsx");
    const botao = nav.slice(nav.indexOf("<button"), nav.indexOf("</button>"));
    const classes = botao.match(/className=\{cn\(\s*"([^"]+)"/)?.[1];
    // Com a fonte normal o visual é o de antes: largura do conteúdo (px-3.5),
    // sem flex-1 (que alargaria a pílula da aba ativa em toda página da loja).
    expect(classes).not.toContain("flex-1");
    expect(classes).toContain("px-3.5");
    expect(classes).toContain("min-w-0");
    const rotulo = botao.slice(
      botao.lastIndexOf("<span"),
      botao.lastIndexOf("{item.label}"),
    );
    expect(rotulo).toContain("max-w-full");
    expect(rotulo).toContain("truncate");
  });

  it("as cinco abas do painel e Vender limitam o texto sem cortar a bolinha de pedidos", () => {
    const painel = fonte("/src/components/layouts/AdminLayout.tsx");
    const botao = painel.match(/const BOTAO_ABA_INFERIOR =\s*"([^"]+)"/)?.[1];
    expect(botao).toContain("min-w-0");
    expect(botao).not.toContain("min-w-11");
    // O badge absoluto sai por cima do botão: só o rótulo deve recortar.
    expect(botao).not.toContain("overflow-hidden");
    const abas = painel.slice(painel.indexOf("data-admin-abas"));
    const rotulos = [
      ...abas.matchAll(
        /<span\s+className=\{cn\(\s*"([^"]*text-\[11px\][^"]*)"/g,
      ),
    ];
    expect(rotulos).toHaveLength(2);
    for (const rotulo of rotulos) {
      expect(rotulo[1]).toContain("max-w-full");
      expect(rotulo[1]).toContain("truncate");
    }
  });

  for (const nome of ["dialog", "alert-dialog"]) {
    it(`${nome}: janela alta tem teto na tela e rolagem antes das classes de quem usa`, () => {
      const texto = fonte(`/src/components/ui/${nome}.tsx`);
      const conteudo = texto.slice(
        texto.indexOf(`data-slot="${nome}-content"`),
      );
      const classes = conteudo.match(
        /className=\{cn\(\s*"([^"]+)",\s*className/,
      )?.[1];
      expect(classes).toContain("max-h-[calc(100dvh-2rem)]");
      expect(classes).toContain("overflow-y-auto");
    });
  }
});
