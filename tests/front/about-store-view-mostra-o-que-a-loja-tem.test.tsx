// @vitest-environment jsdom
//
// Peça 24: a página "Sobre a Loja" lê a FONTE ÚNICA (useStore → StoreConfig)
// e mostra o que a loja já tem de verdade: nome, logo, cidade/UF, horário de
// atendimento e WhatsApp. Regra de degradação da casa (migration
// 20261033000000): dado que a loja não preencheu → o bloco NÃO existe na
// tela — nunca "undefined", nunca erro.
//
// O setup global (tests/front/setup-build-identity.ts) instala a fixture
// "Aurora": com storeName nulo, o nome exibido cai no branding.appName, igual
// ao cabeçalho (nome-da-loja.ts).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type ConfigDeTeste = Record<string, unknown>;

let configAtual: ConfigDeTeste = {};

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: configAtual }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);
vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);

const LOJA_COMPLETA: ConfigDeTeste = {
  storeName: "Ateliê da Serra",
  logoUrl: "https://cdn.example/atelie/logo.png",
  storeCity: "Monte Carmelo",
  storeState: "MG",
  businessHours: "Seg-Sex: 8h às 19h",
  whatsappNumber: "(34) 99999-9999",
  storeDescription:
    '<p>Peças de decoração escolhidas a dedo, direto do ateliê para a sua casa.</p><p><strong>Lançamento da semana</strong> já disponível.</p><img src="https://cdn.example/atelie/foto.png" alt="foto" /><img src="x" onerror="alert(1)" /><script>alert(1)</script>',
  originCep: "38500-000",
};

const LOJA_VAZIA: ConfigDeTeste = {
  storeName: null,
  logoUrl: null,
  storeCity: null,
  storeState: null,
  businessHours: null,
  whatsappNumber: null,
  storeDescription: null,
};

describe("AboutStoreView — a página mostra o que a loja tem e omite o resto", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal("open", vi.fn());
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
  });

  async function renderizarPagina() {
    const { AboutStoreView } = await import("@/views/customer/AboutStoreView");
    await act(async () => {
      raiz.render(<AboutStoreView />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    return hospedeiro.textContent ?? "";
  }

  function botaoWhatsapp() {
    return hospedeiro.querySelector<HTMLButtonElement>(
      "button[aria-label='Falar com a loja no WhatsApp']",
    );
  }

  it("loja completa: nome, logo, local, horário e contato — nada inventado", async () => {
    configAtual = LOJA_COMPLETA;

    const texto = await renderizarPagina();

    expect(texto).toContain("Ateliê da Serra");
    expect(texto).toContain("Monte Carmelo, MG");
    expect(texto).toContain("Seg-Sex: 8h às 19h");
    expect(texto).toContain("Horário de atendimento");

    // Descrição RICA da loja (campo do dono — quando existir no banco):
    // texto, negrito e imagem renderizam; conteúdo malicioso NÃO.
    expect(texto).toContain("Peças de decoração escolhidas a dedo");
    expect(
      [...hospedeiro.querySelectorAll("strong")].some(
        (s) => s.textContent === "Lançamento da semana",
      ),
    ).toBe(true);
    expect(
      hospedeiro.querySelector(
        "img[src='https://cdn.example/atelie/foto.png']",
      ),
    ).not.toBeNull();
    // Sanitização (DOMPurify): script some e handler de evento some — a
    // imagem do ataque até sobrevive, mas INERTE (sem onerror).
    expect(hospedeiro.querySelector("script")).toBeNull();
    expect(hospedeiro.querySelector("[onerror]")).toBeNull();

    // Mapa real embutido DENTRO do cartão da marca (ordem do dono: entre o
    // nome e a cidade), clicável → o link inteiro abre o Google Maps.
    const mapa = hospedeiro.querySelector<HTMLIFrameElement>(
      "iframe[title^='Mapa da loja']",
    );
    expect(mapa).not.toBeNull();
    expect(mapa!.getAttribute("src")).toBe(
      "https://maps.google.com/maps?q=38500-000&z=15&output=embed",
    );
    const abrirMaps = hospedeiro.querySelector<HTMLAnchorElement>(
      "a[aria-label='Abrir no Google Maps']",
    );
    expect(abrirMaps).not.toBeNull();
    expect(
      abrirMaps!.querySelector("iframe[title^='Mapa da loja']"),
    ).not.toBeNull();
    expect(abrirMaps!.getAttribute("href")).toBe(
      "https://www.google.com/maps/search/?api=1&query=38500-000",
    );
    expect(abrirMaps!.textContent?.toLowerCase()).toContain(
      "abre no google maps",
    );

    // Pin da CASA: gota PRETA sólida (corpo #18181b) e o ÍCONE DO APP
    // (icon_192 — o mesmo do manifest do PWA), NUNCA a logo larga do
    // cabeçalho (evita o borrão preto reportado pelo dono, 28/09/2026), e o
    // aviso honesto de localização aproximada enquanto o dado é o CEP.
    const corpoDoPin = hospedeiro.querySelector(
      "[data-pino-do-mapa] svg path[data-pino-corpo]",
    ) as SVGPathElement | null;
    expect(corpoDoPin).not.toBeNull();
    expect(corpoDoPin!.getAttribute("fill")).toBe("#18181b");
    expect(
      hospedeiro.querySelector(
        "svg image[href='/identity/aurora/icon-192.png']",
      ),
    ).not.toBeNull();
    // Regressão do borrão: o pin NUNCA usa a logo larga do cabeçalho.
    expect(
      hospedeiro.querySelector(
        "svg image[href='https://cdn.example/atelie/logo.png']",
      ),
    ).toBeNull();
    expect(texto).toContain("Localização aproximada");

    const logo = hospedeiro.querySelector<HTMLImageElement>(
      "img[alt^='Logo da loja']",
    );
    expect(logo).not.toBeNull();
    expect(logo!.getAttribute("src")).toBe(
      "https://cdn.example/atelie/logo.png",
    );

    // Título da aba vem do useDocumentMeta com o nome da fonte única.
    expect(document.title).toContain("Sobre a loja");
    expect(document.title).toContain("Ateliê da Serra");
  });

  it("pin: a logo vai num CÍRCULO com anel PRETO (não mais quadrado de moldura branca)", async () => {
    configAtual = LOJA_COMPLETA;

    await renderizarPagina();

    // Pedido do dono (14/10/2026): o quadrado branco "não combinava" com o
    // pino arredondado. A logo agora é recortada num círculo, e o anel em
    // volta é o próprio corpo PRETO do pino — os dois redondos.
    const recorte = hospedeiro.querySelector("clipPath circle");
    expect(recorte).not.toBeNull();
    expect(hospedeiro.querySelector("clipPath rect")).toBeNull();
    // Nada de moldura branca quadrada: o único branco é o fundo do círculo.
    expect(hospedeiro.querySelector("[data-pino-do-mapa] svg rect")).toBeNull();

    // O anel preto tem ~2px: raio do corpo (cabeça, o arco `A r,r` do
    // caminho) menos raio do recorte.
    const corpo = hospedeiro.querySelector("[data-pino-corpo]");
    const raioDoRecorte = Number(recorte!.getAttribute("r"));
    const raioDaCabeca = Number(
      /A([\d.]+),/.exec(corpo!.getAttribute("d") ?? "")?.[1],
    );
    expect(raioDaCabeca - raioDoRecorte).toBeGreaterThanOrEqual(2);
    expect(raioDaCabeca - raioDoRecorte).toBeLessThanOrEqual(3);

    // O ícone fica dentro do círculo (mesmo centro do recorte).
    const imagem = hospedeiro.querySelector(
      "[data-pino-do-mapa] svg image",
    ) as SVGImageElement | null;
    expect(imagem).not.toBeNull();
    const diametro = raioDoRecorte * 2;
    expect(Number(imagem!.getAttribute("width"))).toBe(diametro);
    expect(Number(imagem!.getAttribute("height"))).toBe(diametro);
  });

  it("pin: é PEQUENO (≤ 32 de largura, ≤ 40 de altura) — o de 60x73 cobria quarteirões", async () => {
    configAtual = LOJA_COMPLETA;

    await renderizarPagina();

    const svg = hospedeiro.querySelector(
      "[data-pino-do-mapa] svg[role='img']",
    ) as SVGSVGElement | null;
    expect(svg).not.toBeNull();
    expect(Number(svg!.getAttribute("width"))).toBeLessThanOrEqual(32);
    expect(Number(svg!.getAttribute("width"))).toBeGreaterThanOrEqual(28);
    expect(Number(svg!.getAttribute("height"))).toBeLessThanOrEqual(40);
    // Sem esticar o desenho: a escala é 1:1 com o viewBox.
    const [, , vw, vh] = svg!.getAttribute("viewBox")!.split(/\s+/).map(Number);
    expect(Number(svg!.getAttribute("width"))).toBe(vw);
    expect(Number(svg!.getAttribute("height"))).toBe(vh);
  });

  it("pin: segue nomeado para leitor de tela, não rouba o toque do mapa e o iframe segue preguiçoso", async () => {
    configAtual = LOJA_COMPLETA;

    await renderizarPagina();

    const camada = hospedeiro.querySelector(
      "[data-pino-do-mapa]",
    ) as HTMLElement;
    expect(camada.classList.contains("pointer-events-none")).toBe(true);
    const svg = camada.querySelector("svg") as SVGSVGElement;
    expect(svg.getAttribute("role")).toBe("img");
    expect(svg.getAttribute("aria-label")).toBe(
      "Local da loja Ateliê da Serra",
    );
    const iframe = hospedeiro.querySelector(
      "iframe[title^='Mapa da loja']",
    ) as HTMLIFrameElement;
    expect(iframe.getAttribute("loading")).toBe("lazy");
    expect(iframe.classList.contains("pointer-events-none")).toBe(true);
  });

  it("pin: a PONTA fica no centro do MESMO retângulo do iframe (não do cartão recortado)", async () => {
    configAtual = LOJA_COMPLETA;

    await renderizarPagina();

    // Achado de 14/10/2026 medido no Chromium: o iframe sobe 56px para
    // esconder o chip do Google, então o centro do MAPA fica 28px acima do
    // centro do cartão — e o pino ancorado no centro do cartão apontava
    // ~22px para o sul do lugar certo. A correção: o pino mora numa camada
    // com a MESMA caixa do iframe (mesmas classes de recorte), e a ponta
    // (base do SVG) é o centro dessa camada.
    const iframe = hospedeiro.querySelector(
      "iframe[title^='Mapa da loja']",
    ) as HTMLIFrameElement;
    const camada = hospedeiro.querySelector(
      "[data-pino-do-mapa]",
    ) as HTMLElement | null;
    expect(camada).not.toBeNull();
    expect(iframe.parentElement).toBe(camada!.parentElement);
    for (const token of [
      "absolute",
      "left-0",
      "top-[-56px]",
      "h-[calc(100%+56px)]",
      "w-full",
    ]) {
      expect(iframe.classList.contains(token)).toBe(true);
      expect(camada!.classList.contains(token)).toBe(true);
    }
    // A ponta: o ancoradouro está a 50% (+2px, o 1–2px que o marcador do
    // Google desce abaixo do centro, medido) da camada e sobe pela altura
    // inteira do SVG (a ponta é a BASE do desenho, sem sobra).
    const ancora = camada!.firstElementChild as HTMLElement;
    expect(ancora.classList.contains("left-1/2")).toBe(true);
    expect(ancora.classList.contains("top-[calc(50%+2px)]")).toBe(true);
    expect(ancora.classList.contains("-translate-y-full")).toBe(true);
    expect(ancora.classList.contains("-translate-x-1/2")).toBe(true);
    const corpo = ancora.querySelector("[data-pino-corpo]")!;
    const svg = ancora.querySelector("svg")!;
    // O vértice de baixo do corpo (o `M x,y` do caminho) encosta no fundo
    // do viewBox, no meio da largura — nenhuma sobra entre a ponta e a base.
    const ponta = /^M([\d.]+),([\d.]+)/.exec(corpo.getAttribute("d") ?? "");
    expect(ponta).not.toBeNull();
    expect(Number(ponta![1])).toBe(Number(svg.getAttribute("width")) / 2);
    expect(Number(ponta![2])).toBe(Number(svg.getAttribute("height")));
  });

  it("loja sem nada: blocos somem, nome cai na marca do build, zero 'undefined'", async () => {
    configAtual = LOJA_VAZIA;

    const texto = await renderizarPagina();

    // A página continua de pé: título em SVG vetorial nomeado + nome da
    // marca do build.
    expect(
      hospedeiro.querySelector("svg[aria-label='Sobre a Loja']"),
    ).not.toBeNull();
    expect(texto).toContain("Aurora");

    // O que a loja não preencheu NÃO vira bloco vazio.
    expect(texto).not.toContain("Horário de atendimento");
    expect(texto).not.toContain("Monte Carmelo");
    expect(texto).not.toContain("Peças de decoração escolhidas a dedo");
    expect(
      hospedeiro.querySelector("a[aria-label='Abrir no Google Maps']"),
    ).toBeNull();
    expect(
      hospedeiro.querySelector("iframe[title^='Mapa da loja']"),
    ).toBeNull();
    // Sem endereço/CEP/cidade não há mapa — e portanto NENHUM pino solto.
    expect(hospedeiro.querySelector("[data-pino-do-mapa]")).toBeNull();
    expect(
      hospedeiro.querySelector("svg[aria-label^='Local da loja']"),
    ).toBeNull();
    // Sem WhatsApp, nem o botão ancorado existe.
    expect(botaoWhatsapp()).toBeNull();

    // Nem liço de renderização: nenhum "undefined"/"null" vaza para a tela.
    expect(texto).not.toContain("undefined");
    expect(texto).not.toContain("null");
  });

  it("logo do banco quebrada cai na LOGO DO BUILD; só quando ela também falha vem a inicial — o pin (ícone do app) não se move", async () => {
    configAtual = {
      ...LOJA_COMPLETA,
      logoUrl: "https://cdn.example/quebrado.png",
    };

    await renderizarPagina();

    const logo = hospedeiro.querySelector<HTMLImageElement>(
      "img[alt^='Logo da loja']",
    );
    expect(logo).not.toBeNull();
    expect(logo!.getAttribute("src")).toBe("https://cdn.example/quebrado.png");

    // O pin usa o ÍCONE DO APP (icon_192), não a logo do cabeçalho — a
    // cascata banco→build→inicial da logo grande não afeta o pin.
    const iconeDoPin = () =>
      hospedeiro.querySelector(
        "svg image[href='/identity/aurora/icon-192.png']",
      );
    expect(iconeDoPin()).not.toBeNull();

    // 1ª falha (logo do banco): avança para a logo do build (fixture Aurora),
    // NÃO para a inicial — o pin continua com o MESMO ícone do app.
    await act(async () => {
      logo!.dispatchEvent(new globalThis.Event("error"));
    });
    const logoDoBuild = hospedeiro.querySelector<HTMLImageElement>(
      "img[alt^='Logo da loja']",
    );
    expect(logoDoBuild).not.toBeNull();
    expect(logoDoBuild!.getAttribute("src")).toBe(
      "/identity/aurora/header.webp",
    );
    expect(iconeDoPin()).not.toBeNull();

    // 2ª falha (logo do build também quebrada): aí sim a inicial entra no
    // CARTÃO — sem "undefined" e sem erro de render. O pin, de novo, não é
    // afetado: continua com o ícone do app.
    await act(async () => {
      logoDoBuild!.dispatchEvent(new globalThis.Event("error"));
    });
    expect(hospedeiro.querySelector("img[alt^='Logo da loja']")).toBeNull();
    expect(hospedeiro.textContent).toContain("Ateliê da Serra");
    expect(iconeDoPin()).not.toBeNull();
  });

  it("ícone do pin: falha de rede cai na inicial, sem borrão — independente da logo do cabeçalho", async () => {
    configAtual = LOJA_COMPLETA;

    await renderizarPagina();

    const iconeDoPin = hospedeiro.querySelector(
      "svg image[href='/identity/aurora/icon-192.png']",
    );
    expect(iconeDoPin).not.toBeNull();

    await act(async () => {
      iconeDoPin!.dispatchEvent(new globalThis.Event("error"));
    });

    // O <image> some do pin e a inicial aparece no lugar dele, DENTRO do
    // balão — sem quebrar o resto da página (a logo grande do cartão segue
    // intacta, ela não muda nesta tarefa).
    expect(
      hospedeiro.querySelector(
        "svg image[href='/identity/aurora/icon-192.png']",
      ),
    ).toBeNull();
    const balaoDoPin = hospedeiro.querySelector("[data-pino-corpo]");
    expect(balaoDoPin).not.toBeNull();
    // A inicial entra DENTRO do círculo (mesmo recorte do ícone), não
    // solta: o texto mora no grupo recortado pelo círculo.
    const inicial = [
      ...hospedeiro.querySelectorAll("[data-pino-do-mapa] svg text"),
    ].find((t) => t.textContent === "A");
    expect(inicial).toBeDefined();
    expect(inicial!.closest("g")?.getAttribute("clip-path") ?? "").toContain(
      "pin-icone-recorte",
    );
    expect(hospedeiro.querySelector("clipPath circle")).not.toBeNull();
    expect(
      hospedeiro.querySelector<HTMLImageElement>("img[alt^='Logo da loja']")
        ?.src,
    ).toContain("atelie/logo.png");
  });

  it("a fonte da logo mudando no ar reinicia a cascata do começo", async () => {
    configAtual = {
      ...LOJA_COMPLETA,
      logoUrl: "https://cdn.example/velha.png",
    };

    await renderizarPagina();

    let logo = hospedeiro.querySelector<HTMLImageElement>(
      "img[alt^='Logo da loja']",
    );
    expect(logo).not.toBeNull();
    expect(logo!.getAttribute("src")).toBe("https://cdn.example/velha.png");

    // Banco quebra → build assume.
    await act(async () => {
      logo!.dispatchEvent(new globalThis.Event("error"));
    });
    logo = hospedeiro.querySelector<HTMLImageElement>(
      "img[alt^='Logo da loja']",
    );
    expect(logo!.getAttribute("src")).toBe("/identity/aurora/header.webp");

    // O lojista troca a logo no painel: a logo nova do banco volta a ser a
    // candidata — a cascata NÃO fica presa na falha antiga.
    configAtual = {
      ...LOJA_COMPLETA,
      logoUrl: "https://cdn.example/nova.png",
    };
    await renderizarPagina();

    logo = hospedeiro.querySelector<HTMLImageElement>(
      "img[alt^='Logo da loja']",
    );
    expect(logo).not.toBeNull();
    expect(logo!.getAttribute("src")).toBe("https://cdn.example/nova.png");

    // E a logo nova quebrada cai no build normalmente.
    await act(async () => {
      logo!.dispatchEvent(new globalThis.Event("error"));
    });
    logo = hospedeiro.querySelector<HTMLImageElement>(
      "img[alt^='Logo da loja']",
    );
    expect(logo!.getAttribute("src")).toBe("/identity/aurora/header.webp");
  });

  it("WhatsApp: clique abre wa.me com prefixo 55 e sem quebrar em número formatado", async () => {
    configAtual = LOJA_COMPLETA;

    await renderizarPagina();

    // Botão ANCORADO (FAB): identificado por aria-label, não por texto.
    const botao = botaoWhatsapp();
    expect(botao).not.toBeNull();
    expect(botao!.querySelector("svg")).not.toBeNull();
    await act(async () => {
      botao!.click();
    });

    const open = vi.mocked(globalThis.open);
    expect(open).toHaveBeenCalledTimes(1);
    const url = String(open.mock.calls[0]?.[0]);
    // "(34) 99999-9999" → 34999999999 (11 dígitos) → prefixo 55.
    expect(url).toContain("https://wa.me/5534999999999");
    // A8-d/L12: a aba do WhatsApp não pode herdar `window.opener` do app.
    expect(open.mock.calls[0]?.[1]).toBe("_blank");
    expect(open.mock.calls[0]?.[2]).toBe("noopener,noreferrer");
  });
});
