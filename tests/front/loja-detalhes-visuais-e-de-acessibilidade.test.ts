//
// Lote 201 (Caça 7): detalhes visuais e de acessibilidade do lado do cliente.
//
// jsdom não vê CSS nem tamanho em pixel, então este contrato lê o FONTE e
// confere as classes exatas. O que só o navegador prova (alvo de 44 px
// medido, anel girando, janela acima da barra de baixo) não é provado aqui.
import { describe, expect, it } from "vitest";

const FONTES = import.meta.glob<string>(
  [
    "/src/App.tsx",
    "/src/components/ui/sonner.tsx",
    "/src/components/ui/dialog.tsx",
    "/src/components/ui/custom/GlobalErrorBoundary.tsx",
    "/src/components/ui/custom/ImageAdjuster.tsx",
    "/src/components/ui/custom/PremiumOffers.tsx",
    "/src/components/ui/custom/ProductCard.tsx",
    "/src/components/ui/custom/CartReminder.tsx",
    "/src/components/ui/custom/AddressList.tsx",
    "/src/components/account/PrivacidadeEMeusDados.tsx",
    "/src/components/devolucao/SolicitarDevolucaoSheet.tsx",
    "/src/views/customer/CheckoutView.tsx",
    "/src/views/customer/ProductView.tsx",
    "/src/views/customer/AccountSettingsView.tsx",
    "/src/views/customer/ProfileView.tsx",
    "/src/views/customer/UserProfileView.tsx",
    "/src/views/customer/OrderDetailsView.tsx",
    "/src/views/shared/AuthView.tsx",
  ],
  { query: "?raw", import: "default", eager: true },
);

function fonte(caminho: string): string {
  const texto = new Map(Object.entries(FONTES)).get(caminho);
  expect(texto, `falta o fonte de ${caminho}`).toBeDefined();
  return (texto as string).replace(/\r\n/g, "\n");
}

/** Do início da âncora até `tamanho` caracteres depois. */
function trecho(arquivo: string, ancora: string, tamanho = 700): string {
  const codigo = fonte(arquivo);
  const i = codigo.indexOf(ancora);
  expect(i, `trecho "${ancora}" sumiu de ${arquivo}`).toBeGreaterThan(-1);
  return codigo.slice(i, i + tamanho);
}

describe("anel de carregando", () => {
  it.each([
    "/src/App.tsx",
    "/src/components/ui/custom/GlobalErrorBoundary.tsx",
    "/src/views/customer/CheckoutView.tsx",
    "/src/components/ui/custom/ImageAdjuster.tsx",
    "/src/views/customer/ProductView.tsx",
  ])("%s não usa border-3, que não existe no Tailwind 3.4", (arquivo) => {
    expect(fonte(arquivo)).not.toMatch(/\bborder-3\b/);
    expect(fonte(arquivo)).toContain("animate-spin");
  });
});

describe("bolinhas do carrossel de ofertas", () => {
  const bolinhas = trecho(
    "/src/components/ui/custom/PremiumOffers.tsx",
    "Hero Offer Pagination Dots",
    1400,
  );
  it("têm alvo de toque de 44 px, foco visível e aria-current", () => {
    expect(bolinhas).toContain("size-11");
    expect(bolinhas).toContain("focus-visible:ring-2");
    expect(bolinhas).not.toContain("focus:outline-none");
    expect(bolinhas).toContain("aria-current");
  });
  it("a bolinha inativa não é o cinza quase invisível", () => {
    expect(bolinhas).not.toContain("bg-zinc-200/80");
    expect(bolinhas).toContain("bg-zinc-400");
  });
});

describe("avisos", () => {
  it("ficam 4,5 s na tela por padrão", () => {
    expect(fonte("/src/components/ui/sonner.tsx")).toContain("duration={4500}");
  });
});

describe("texto de apoio legível", () => {
  it("ajuda do CPF e variação do item no checkout em zinc-600", () => {
    expect(
      trecho(
        "/src/views/customer/CheckoutView.tsx",
        'id="ajuda-checkout-cpf"',
        120,
      ),
    ).toContain("text-zinc-600");
    expect(
      trecho(
        "/src/views/customer/CheckoutView.tsx",
        "{item.variantNames && (",
        120,
      ),
    ).toContain("text-zinc-600");
  });
  it("avisos do envio de foto em zinc-600 e sem 8 px", () => {
    const conta = fonte("/src/views/customer/AccountSettingsView.tsx");
    expect(conta).not.toContain(
      "text-[8px] font-bold uppercase leading-normal tracking-tight text-slate-400",
    );
    expect(conta).not.toContain(
      "text-center text-[10px] font-semibold leading-relaxed text-zinc-400",
    );
    expect(conta).not.toContain(
      "px-4 text-[10px] font-semibold leading-normal text-zinc-400",
    );
  });
  it("selo Padrão do endereço em verde escuro", () => {
    const sel = trecho(
      "/src/components/ui/custom/AddressList.tsx",
      "address.is_default && (",
      500,
    );
    expect(sel).not.toContain("text-emerald-500");
  });
});

describe("selos do card de produto", () => {
  const card = fonte("/src/components/ui/custom/ProductCard.tsx");
  it("nenhum selo usa letra de 8 px", () => {
    expect(card).not.toContain("text-[8px] font-black");
  });
  it("o selo de frete grátis encolhe em vez de estourar o card", () => {
    expect(card).toMatch(
      /flex min-w-0 max-w-full items-center gap-1 rounded-md border border-emerald-100\/50/,
    );
  });
  it("a frase do selo quebra em duas linhas em vez de ser cortada", () => {
    expect(card).toMatch(
      /<span className="min-w-0 break-words leading-tight">\s*\{fraseDoSelo\}/,
    );
    expect(card).not.toMatch(/<span className="truncate">\s*\{fraseDoSelo\}/);
  });
});

describe("lembrete do carrinho", () => {
  const lembrete = fonte("/src/components/ui/custom/CartReminder.tsx");
  it("textos em verde escuro, nunca emerald-500", () => {
    expect(lembrete).not.toMatch(/(tracking-\S+|italic) text-emerald-500/);
  });
  it("anuncia o aviso e tem botão com alvo de 44 px", () => {
    expect(lembrete).toContain('aria-live="polite"');
    const botao = trecho(
      "/src/components/ui/custom/CartReminder.tsx",
      "group/btn",
      260,
    );
    expect(botao).toContain("after:-inset-y-1.5");
    // Lote 211: o texto do botao subiu de 10 px para 12 px (text-xs).
    expect(botao).toContain("text-xs");
  });
});

describe("tela de entrada", () => {
  const auth = fonte("/src/views/shared/AuthView.tsx");
  it("olho de mostrar senha com contraste e alvo de 44 px", () => {
    const olho = trecho(
      "/src/views/shared/AuthView.tsx",
      "aria-pressed={showPassword}",
      300,
    );
    expect(olho).toContain("size-11");
    expect(olho).toContain("text-zinc-500");
    expect(olho).not.toContain("text-zinc-300");
  });
  it("Explorar marketplace tem a área ampliada dos vizinhos", () => {
    const botao = auth.slice(
      auth.lastIndexOf("<button", auth.indexOf("Explorar marketplace")),
      auth.indexOf("Explorar marketplace"),
    );
    expect(botao).toContain("after:-inset-y-3.5");
    expect(botao).not.toContain("text-zinc-400");
  });
});

describe("abas do perfil público", () => {
  const perfil = fonte("/src/views/customer/UserProfileView.tsx");
  it("são abas de verdade, com 44 px e a inativa legível", () => {
    expect(perfil).toContain('role="tablist"');
    expect(perfil.match(/role="tab"/g)).toHaveLength(2);
    expect(perfil).toContain('aria-selected={activeTab === "reviews"}');
    expect(perfil).toContain('aria-selected={activeTab === "questions"}');
    expect(perfil).toContain("relative flex h-11 flex-1");
    expect(perfil).not.toContain('"text-zinc-400"}`}');
  });
});

describe("alvos de toque pequenos", () => {
  const pedido = fonte("/src/views/customer/OrderDetailsView.tsx");
  it("copiar rastreio, Rastrear e fechar avaliação ganham área de 44 px", () => {
    expect(
      trecho(
        "/src/views/customer/OrderDetailsView.tsx",
        '"relative flex size-9 flex-shrink-0',
        200,
      ),
    ).toContain("after:-inset-1 ");
    expect(
      trecho(
        "/src/views/customer/OrderDetailsView.tsx",
        '"relative flex h-9 flex-shrink-0',
        260,
      ),
    ).toContain("after:-inset-y-1");
    expect(pedido).toMatch(
      /relative flex size-8[^"]*after:-inset-1\.5[^"]*"\s*>\s*✕/,
    );
  });
  it("remover foto da devolução tem botão de 44 px com o círculo de 32 dentro", () => {
    const foto = trecho(
      "/src/components/devolucao/SolicitarDevolucaoSheet.tsx",
      'aria-label="Remover foto"',
      400,
    );
    expect(foto).toContain("size-11");
    expect(foto).toContain("size-8");
  });
});

describe("janelas de confirmação ficam acima da barra de baixo", () => {
  it("Dialog aceita a classe do véu, como o AlertDialog", () => {
    expect(fonte("/src/components/ui/dialog.tsx")).toContain(
      "overlayClassName",
    );
  });
  it.each([
    ["/src/views/customer/AccountSettingsView.tsx", "<DialogContent", 2],
    ["/src/views/customer/ProfileView.tsx", "<DialogContent", 2],
    ["/src/components/ui/custom/AddressList.tsx", "<AlertDialogContent", 1],
    [
      "/src/components/account/PrivacidadeEMeusDados.tsx",
      "<AlertDialogContent",
      2,
    ],
    [
      "/src/views/customer/OrderDetailsView.tsx",
      "Descartar o que você escreveu?",
      1,
    ],
  ] as const)(
    "%s sobe véu e conteúdo para z-[130]",
    (arquivo, ancora, vezes) => {
      const codigo = fonte(arquivo);
      let achados = 0;
      let de = 0;
      for (;;) {
        const i = codigo.indexOf(ancora, de);
        if (i < 0) break;
        const inicio = ancora.startsWith("<")
          ? i
          : codigo.lastIndexOf("<AlertDialogContent", i);
        const cabeca = codigo.slice(inicio, inicio + 420);
        if (
          cabeca.includes('overlayClassName="z-[130]"') &&
          cabeca.split("z-[130]").length - 1 >= 2
        )
          achados++;
        de = i + ancora.length;
      }
      expect(achados).toBe(vezes);
    },
  );
});
