import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
// @vitest-environment jsdom
//
// P50: no computador as faixas de ofertas que rolam para o lado (Lateral, Lateral em duas fileiras
// e Compacto) ganham setas para o mouse. Elas usam o Embla (nao ha scroll nativo para `scrollBy`):
// `canScrollPrev/canScrollNext` dizem se ha conteudo escondido na direcao e `scrollPrev/scrollNext`
// avancam uma pagina. No celular (< 1024 px) nada muda: nenhuma seta no DOM e as classes das
// fileiras e dos cartoes ficam congeladas aqui, como literais (sem ler o historico do git).
/* eslint-disable security/detect-non-literal-fs-filename -- caminhos fixos do proprio repositorio, montados de import.meta.url */
import OfertasCompactas from "@/components/ui/custom/OfertasCompactas";
import OfertasLateral from "@/components/ui/custom/OfertasLateral";
import OfertasLateralDuplo from "@/components/ui/custom/OfertasLateralDuplo";
import { SetasDaFaixaDeOfertas } from "@/components/ui/custom/SetasDaFaixaDeOfertas";
import type { Product } from "@/types";
import { type ComponentType, act } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// @ts-expect-error flag interna do React, sem tipo publico.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { enableReviews: false } }),
}));
vi.mock("@/hooks/usePrefetchOnHover", () => ({
  usePrefetchOnHover: () => ({ prefetchView: () => {} }),
}));
vi.mock("@/utils/cartAnimation", () => ({
  triggerFlyingCartAnimation: () => {},
}));
vi.mock("@/utils/haptic", () => ({
  haptic: { light() {}, medium() {}, heavy() {} },
}));
vi.mock("@/components/LazyImage", () => ({
  LazyImage: ({
    src,
    alt,
    className,
  }: { src: string; alt: string; className: string }) => (
    <img src={src} alt={alt} className={className} />
  ),
}));

// O Embla de mentira: o jsdom nao calcula layout, entao quem diz "ha mais para os lados" e o teste.
const embla = vi.hoisted(() => {
  const ouvintes = new Map<string, Array<() => void>>();
  return {
    ouvintes,
    estado: { voltar: false, avancar: false },
    selectedScrollSnap: vi.fn(() => 0),
    canScrollPrev: vi.fn(() => embla.estado.voltar),
    canScrollNext: vi.fn(() => embla.estado.avancar),
    scrollPrev: vi.fn(),
    scrollNext: vi.fn(),
    on: vi.fn((evento: string, f: () => void) => {
      ouvintes.set(evento, [...(ouvintes.get(evento) ?? []), f]);
    }),
    off: vi.fn((evento: string, f: () => void) => {
      ouvintes.set(
        evento,
        (ouvintes.get(evento) ?? []).filter((x) => x !== f),
      );
    }),
  };
});
vi.mock("embla-carousel-react", () => ({
  default: vi.fn(() => [() => {}, embla]),
}));

const produto = (id: string): Product =>
  ({
    id,
    name: id,
    price: 50,
    originalPrice: 100,
    images: ["https://exemplo.test/a.png"],
    description: "",
    category: "Teste",
    stock: 20,
    isActive: true,
  }) as Product;
const SEIS = ["a", "b", "c", "d", "e", "f"].map((id) => produto(id));

let host: HTMLDivElement;
let root: Root;

function telaDe(computador: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((consulta: string) => ({
      matches: consulta.includes("min-width: 1024px") ? computador : false,
      addEventListener: () => {},
      removeEventListener: () => {},
    })),
  );
}
const avisarEmbla = (evento: string) =>
  act(() => {
    for (const f of embla.ouvintes.get(evento) ?? []) f();
  });
async function montar(Faixa: ComponentType<Record<string, unknown>>) {
  await act(async () => {
    root.render(
      <Faixa
        products={SEIS}
        favorites={[]}
        onAddToCart={() => {}}
        onProductClick={() => {}}
        onToggleFavorite={() => {}}
        title="Ofertas Imperdíveis"
      />,
    );
  });
}
const anterior = () =>
  host.querySelector<HTMLButtonElement>(
    'button[aria-label="Ver ofertas anteriores"]',
  );
const seguinte = () =>
  host.querySelector<HTMLButtonElement>(
    'button[aria-label="Ver ofertas seguintes"]',
  );
const clicar = (el: Element | null) => act(() => (el as HTMLElement).click());

beforeEach(() => {
  vi.clearAllMocks();
  embla.ouvintes.clear();
  embla.estado.voltar = false;
  embla.estado.avancar = false;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const comoFaixa = (c: unknown) => c as ComponentType<Record<string, unknown>>;

const FAIXAS: Array<[string, ComponentType<Record<string, unknown>>]> = [
  ["OfertasLateral", comoFaixa(OfertasLateral)],
  ["OfertasLateralDuplo", comoFaixa(OfertasLateralDuplo)],
  ["OfertasCompactas", comoFaixa(OfertasCompactas)],
];

describe.each(FAIXAS)("%s no computador (>= 1024 px)", (_nome, Faixa) => {
  beforeEach(() => telaDe(true));

  it("sem nada escondido, nenhuma seta", async () => {
    await montar(Faixa);
    expect(anterior()).toBeNull();
    expect(seguinte()).toBeNull();
  });

  it("no comeco: so a seta de avancar, e ela avanca uma pagina", async () => {
    embla.estado.avancar = true;
    await montar(Faixa);
    expect(anterior()).toBeNull();
    const botao = seguinte();
    expect(botao).not.toBeNull();
    expect(botao?.getAttribute("type")).toBe("button");
    clicar(botao);
    expect(embla.scrollNext).toHaveBeenCalledTimes(1);
    expect(embla.scrollPrev).not.toHaveBeenCalled();
  });

  it("no meio: as duas setas, e a da esquerda volta", async () => {
    embla.estado.voltar = true;
    embla.estado.avancar = true;
    await montar(Faixa);
    expect(seguinte()).not.toBeNull();
    clicar(anterior());
    expect(embla.scrollPrev).toHaveBeenCalledTimes(1);
    expect(embla.scrollNext).not.toHaveBeenCalled();
  });

  it("no fim: so a seta de voltar; ao rolar, as setas acompanham", async () => {
    embla.estado.avancar = true;
    await montar(Faixa);
    expect(seguinte()).not.toBeNull();
    expect(anterior()).toBeNull();
    // o usuario arrastou ate o fim
    embla.estado.voltar = true;
    embla.estado.avancar = false;
    avisarEmbla("select");
    expect(seguinte()).toBeNull();
    expect(anterior()).not.toBeNull();
    // a janela mudou de tamanho e agora cabe tudo
    embla.estado.voltar = false;
    avisarEmbla("reInit");
    expect(anterior()).toBeNull();
    expect(seguinte()).toBeNull();
  });

  it("a seta tem alvo de pelo menos 40 px e foco visivel (so no computador)", async () => {
    embla.estado.avancar = true;
    await montar(Faixa);
    const classes = seguinte()?.className ?? "";
    expect(classes).toContain("size-10");
    expect(classes).toContain("focus-visible:ring-2");
  });

  it("o titulo reserva o canto das setas so no computador", async () => {
    await montar(Faixa);
    const cabecalho = host.querySelector("h2")?.parentElement as HTMLElement;
    expect(cabecalho.className).toBe(
      "mb-5 flex min-h-6 items-center justify-between gap-3 px-5 lg:px-0 lg:pr-28",
    );
  });

  it("quem pediu menos movimento recebe o salto, sem animacao", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn((consulta: string) => ({
        matches: true,
        media: consulta,
        addEventListener: () => {},
        removeEventListener: () => {},
      })),
    );
    embla.estado.avancar = true;
    await montar(Faixa);
    clicar(seguinte());
    expect(embla.scrollNext).toHaveBeenCalledWith(true);
  });

  it("ao sair da tela, as setas soltam os ouvintes do Embla", async () => {
    embla.estado.avancar = true;
    await montar(Faixa);
    act(() => root.unmount());
    const ainda = Array.from(embla.ouvintes.values()).flat().length;
    // sobram so os ouvintes da propria faixa (paginacao), que a faixa solta tambem
    expect(ainda).toBe(0);
    root = createRoot(host);
  });
});

describe.each(FAIXAS)("%s no celular (< 1024 px)", (_nome, Faixa) => {
  beforeEach(() => {
    telaDe(false);
    embla.estado.voltar = true;
    embla.estado.avancar = true;
  });

  it("nenhuma seta no DOM, mesmo com conteudo escondido", async () => {
    await montar(Faixa);
    expect(anterior()).toBeNull();
    expect(seguinte()).toBeNull();
    expect(host.querySelector('button[aria-label^="Ver ofertas"]')).toBeNull();
    // so os botoes que ja existiam: um de comprar e um de abrir por oferta
    expect(host.querySelectorAll("button[data-compra-oferta]")).toHaveLength(6);
  });

  it("a fileira e a moldura ficam com as classes de sempre", async () => {
    await montar(Faixa);
    const trilho = host.querySelector<HTMLElement>("div.flex.gap-2\\.5");
    expect(trilho?.className).toBe("flex gap-2.5 py-1");
    const viewport = trilho?.parentElement as HTMLElement;
    expect(viewport.className).toBe(
      "ml-3 overflow-hidden min-[360px]:ml-5 lg:ml-0 lg:mr-0",
    );
    const cabecalho = host.querySelector("h2")?.parentElement as HTMLElement;
    expect(cabecalho.className).toBe(
      "mb-5 flex min-h-6 items-center justify-between gap-3 px-5 lg:px-0",
    );
  });
});

describe("classes dos cartoes no celular (congeladas)", () => {
  beforeEach(() => telaDe(false));

  it("Lateral", async () => {
    await montar(comoFaixa(OfertasLateral));
    const cartao = host.querySelector<HTMLElement>("[data-oferta-lateral]");
    expect(cartao?.className).toBe(
      "relative flex min-w-0 overflow-hidden rounded-[20px] border border-solid border-zinc-200 bg-white shrink-0 basis-[88%] lg:basis-[calc((100%-32px)/3)] lg:min-w-[300px] lg:max-w-[440px]",
    );
  });

  it("Lateral em duas fileiras", async () => {
    await montar(comoFaixa(OfertasLateralDuplo));
    const coluna = host.querySelector<HTMLElement>("[data-coluna-ofertas]");
    expect(coluna?.className).toBe(
      "flex min-w-0 flex-col gap-2 shrink-0 basis-[88%] lg:basis-[calc((100%-32px)/3)] lg:min-w-[300px] lg:max-w-[440px]",
    );
  });

  it("Compacto", async () => {
    await montar(comoFaixa(OfertasCompactas));
    const cartao = host.querySelector<HTMLElement>("[data-oferta-compacta]");
    expect(cartao?.className).toBe(
      "relative flex min-h-[290px] min-w-0 max-w-full rounded-[20px] border border-zinc-200 bg-white lg:!w-[calc((100%-30px)/4)] xl:!w-[calc((100%-40px)/5)] lg:max-w-[280px] flex-col shrink-0 max-[359px]:!w-[145px]",
    );
  });
});

// --- Controle: o teste precisa derrubar versoes erradas da seta. ---------------------------------
// Cada mutante e uma COPIA do componente real com uma unica troca; o mesmo conjunto de afirmacoes
// roda contra a copia e tem de FALHAR (e contra o original e tem de passar).
const ORIGEM = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "src",
  "components",
  "ui",
  "custom",
  "SetasDaFaixaDeOfertas.tsx",
);
const PASTA_MUTANTES = join(
  dirname(fileURLToPath(import.meta.url)),
  ".mutantes-p50-tmp",
);
afterAll(() => rmSync(PASTA_MUTANTES, { recursive: true, force: true }));

async function provarSetas(
  Setas: ComponentType<{ api: typeof embla }>,
): Promise<void> {
  const verifica = (condicao: boolean, msg: string) => {
    if (!condicao) throw new Error(msg);
  };
  telaDe(true);
  const montarSetas = async () => {
    await act(async () => {
      root.render(<Setas api={embla} />);
    });
  };
  // nada escondido: sem setas
  embla.estado.voltar = false;
  embla.estado.avancar = false;
  await montarSetas();
  verifica(!anterior() && !seguinte(), "sem nada escondido nao ha seta");
  // so ha mais para a direita
  embla.estado.avancar = true;
  avisarEmbla("select");
  verifica(!anterior() && !!seguinte(), "so a seta da direita");
  // so ha mais para a esquerda
  embla.estado.voltar = true;
  embla.estado.avancar = false;
  avisarEmbla("select");
  verifica(!!anterior() && !seguinte(), "so a seta da esquerda");
  // sinais
  embla.estado.avancar = true;
  avisarEmbla("select");
  embla.scrollNext.mockClear();
  embla.scrollPrev.mockClear();
  clicar(seguinte());
  verifica(
    embla.scrollNext.mock.calls.length === 1 &&
      embla.scrollPrev.mock.calls.length === 0,
    "a seta da direita chama scrollNext",
  );
  embla.scrollNext.mockClear();
  clicar(anterior());
  verifica(
    embla.scrollPrev.mock.calls.length === 1 &&
      embla.scrollNext.mock.calls.length === 0,
    "a seta da esquerda chama scrollPrev",
  );
}

describe("controle: o teste derruba versoes erradas da seta", () => {
  it("a versao real passa nas afirmacoes", async () => {
    await expect(
      provarSetas(
        SetasDaFaixaDeOfertas as unknown as ComponentType<{
          api: typeof embla;
        }>,
      ),
    ).resolves.toBeUndefined();
  });

  const MUTANTES: Array<[string, string, string]> = [
    ["sinal invertido no clique", "api.scrollNext(", "api.scrollPrev("],
    ["seta da direita sempre aparece", "podeAvancar &&", "true &&"],
    ["seta da esquerda sempre aparece", "podeVoltar &&", "true &&"],
  ];
  it.each(MUTANTES)("mutante: %s", async (nome, de, para) => {
    const fonte = readFileSync(ORIGEM, "utf8");
    expect(fonte).toContain(de); // mutante NULO nao vale
    const mutada = fonte.replace(de, para);
    expect(mutada).not.toBe(fonte);
    mkdirSync(PASTA_MUTANTES, { recursive: true });
    const arquivo = join(PASTA_MUTANTES, `${nome.replace(/\W+/g, "-")}.tsx`);
    writeFileSync(arquivo, mutada);
    const modulo = (await import(/* @vite-ignore */ arquivo)) as {
      SetasDaFaixaDeOfertas: ComponentType<{ api: typeof embla }>;
    };
    await expect(provarSetas(modulo.SetasDaFaixaDeOfertas)).rejects.toThrow(
      /seta/,
    );
  });
});
