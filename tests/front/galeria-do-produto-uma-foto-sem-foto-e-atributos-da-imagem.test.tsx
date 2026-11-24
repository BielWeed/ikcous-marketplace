// @vitest-environment jsdom
//
// O que a cliente (e o leitor de tela dela) encontra na galeria de fotos da
// página do produto nos casos de borda, e o pedido que cada foto faz à rede
// (caça por mutação, 24/11):
//
//  - UMA foto só: sem setas, sem bolinhas, sem miniaturas, sem aviso falado e
//    sem a faixa virar "carrossel" (tabulável, com nome) -- nada para navegar.
//  - Duas fotos já são galeria (controles, bolinhas, "Foto 1 de 2", miniaturas
//    no computador), e tocar numa bolinha/miniatura vai para ESSA foto.
//  - Produto SEM foto (lista vazia ou entrada vazia): "Sem foto" no lugar, e
//    nenhum <img> com endereço vazio.
//  - O pedido de rede: só a primeira foto é pedida já e com prioridade; as
//    outras esperam; tamanhos e escada de larguras do `srcset`; a miniatura é
//    pequena e muda para o leitor de tela (o botão já tem nome).
//  - A MESMA URL repetida na lista não confunde a lista de React (chave única
//    por posição).
import { GaleriaDoProduto } from "@/components/ui/custom/GaleriaDoProduto";
import { act, useState } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  type Mock,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const SUPABASE = (nome: string) =>
  `https://abcdefghijklmnopqrst.supabase.co/storage/v1/object/public/produtos/${nome}.jpg`;
const FOTOS = [SUPABASE("a"), SUPABASE("b"), SUPABASE("c")];

let raiz: Root;
let hospedeiro: HTMLDivElement;
let aoMudar: Mock<(indice: number) => void>;

function Pai({
  fotos = FOTOS,
  inicial = 0,
}: {
  fotos?: string[];
  inicial?: number;
}) {
  const [indice, setIndice] = useState(inicial);
  return (
    <GaleriaDoProduto
      fotos={fotos}
      nome="Blusa"
      indice={indice}
      onMudarIndice={(novo) => {
        aoMudar(novo);
        setIndice(novo);
      }}
    />
  );
}

function montar(props: { fotos?: string[]; inicial?: number } = {}) {
  act(() => raiz.render(<Pai {...props} />));
}

function comoComputador() {
  vi.stubGlobal(
    "matchMedia",
    (consulta: string) =>
      ({
        matches: consulta.includes("min-width: 1024px"),
        media: consulta,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
      }) as unknown as MediaQueryList,
  );
}

const q = <T extends Element>(seletor: string) =>
  hospedeiro.querySelector<T>(seletor);
const qa = <T extends Element>(seletor: string) => [
  ...hospedeiro.querySelectorAll<T>(seletor),
];
const faixa = () => q<HTMLElement>(".scrollbar-hide");
const bolinhas = () =>
  qa<HTMLButtonElement>("button[aria-label^='Foto '][aria-label*=' de ']");
const miniaturas = () =>
  qa<HTMLButtonElement>("button[aria-label^='Ver foto']");
const fotosGrandes = () => qa<HTMLImageElement>("img.main-product-image");

beforeEach(() => {
  aoMudar = vi.fn<(indice: number) => void>();
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("GaleriaDoProduto — uma foto só", () => {
  beforeEach(() => {
    comoComputador();
    montar({ fotos: [SUPABASE("unica")] });
  });

  it("não tem setas, bolinhas, miniaturas nem aviso falado", () => {
    expect(q("button[aria-label='Foto anterior']")).toBeNull();
    expect(q("button[aria-label='Próxima foto']")).toBeNull();
    expect(bolinhas()).toHaveLength(0);
    expect(miniaturas()).toHaveLength(0);
    expect(q("[aria-label='Fotos do produto']")).toBeNull();
    expect(q("[aria-live]")).toBeNull();
    expect(fotosGrandes()).toHaveLength(1);
  });

  it("a faixa não vira carrossel: sem foco de teclado, sem papel e sem nome", () => {
    const el = faixa() as HTMLElement;
    expect(el.hasAttribute("tabindex")).toBe(false);
    expect(el.hasAttribute("role")).toBe(false);
    expect(el.hasAttribute("aria-roledescription")).toBe(false);
    expect(el.hasAttribute("aria-label")).toBe(false);
    const slide = el.firstElementChild as HTMLElement;
    expect(slide.hasAttribute("role")).toBe(false);
    expect(slide.hasAttribute("aria-roledescription")).toBe(false);
    expect(slide.hasAttribute("aria-label")).toBe(false);
  });
});

describe("GaleriaDoProduto — duas fotos já são galeria", () => {
  it("setas, duas bolinhas, aviso falado e faixa nomeada", () => {
    montar({ fotos: FOTOS.slice(0, 2) });
    expect(q("button[aria-label='Foto anterior']")).not.toBeNull();
    expect(q("button[aria-label='Próxima foto']")).not.toBeNull();
    expect(bolinhas()).toHaveLength(2);
    const aviso = q("[aria-live='polite']");
    expect(aviso?.textContent).toBe("Foto 1 de 2");
    const el = faixa() as HTMLElement;
    expect(el.getAttribute("tabindex")).toBe("0");
    expect(el.getAttribute("role")).toBe("region");
    expect(el.getAttribute("aria-roledescription")).toBe("carrossel");
    expect(el.getAttribute("aria-label")).toBe("Fotos de Blusa");
    const slide = el.firstElementChild as HTMLElement;
    expect(slide.getAttribute("role")).toBe("group");
    expect(slide.getAttribute("aria-roledescription")).toBe("foto");
    expect(slide.getAttribute("aria-label")).toBe("1 de 2");
  });

  it("o aviso falado acompanha a foto atual", () => {
    montar({ inicial: 2 });
    expect(q("[aria-live='polite']")?.textContent).toBe("Foto 3 de 3");
  });

  it("tocar na bolinha leva para ESSA foto", () => {
    montar();
    act(() => bolinhas()[2]?.click());
    expect(aoMudar).toHaveBeenLastCalledWith(2);
    expect(bolinhas()[2]?.getAttribute("aria-current")).toBe("true");
    expect(bolinhas()[0]?.hasAttribute("aria-current")).toBe(false);
    expect(bolinhas().map((b) => b.getAttribute("aria-label"))).toEqual([
      "Foto 1 de 3",
      "Foto 2 de 3",
      "Foto 3 de 3",
    ]);
  });

  it("no computador: miniaturas nomeadas, a atual marcada, e o toque vai para ESSA foto", () => {
    comoComputador();
    montar({ inicial: 1 });
    const ms = miniaturas();
    expect(ms.map((m) => m.getAttribute("aria-label"))).toEqual([
      "Ver foto 1 de 3",
      "Ver foto 2 de 3",
      "Ver foto 3 de 3",
    ]);
    expect(ms.map((m) => m.getAttribute("aria-current"))).toEqual([
      null,
      "true",
      null,
    ]);
    act(() => ms[2]?.click());
    expect(aoMudar).toHaveBeenLastCalledWith(2);
    expect(miniaturas()[2]?.getAttribute("aria-current")).toBe("true");
    expect(miniaturas()[1]?.hasAttribute("aria-current")).toBe(false);
  });

  it("no celular não há miniaturas", () => {
    montar();
    expect(miniaturas()).toHaveLength(0);
    expect(q("[aria-label='Fotos do produto']")).toBeNull();
  });
});

describe("GaleriaDoProduto — produto sem foto", () => {
  it.each([
    ["lista vazia", [] as string[]],
    ["entrada vazia", [""]],
  ])("%s: mostra 'Sem foto', nenhuma imagem e nenhum controle", (_n, fotos) => {
    montar({ fotos });
    expect(hospedeiro.textContent).toContain("Sem foto");
    expect(q("[aria-label='Blusa (sem foto)']")).not.toBeNull();
    expect(qa("img")).toHaveLength(0);
    expect(q("button[aria-label='Próxima foto']")).toBeNull();
    expect(bolinhas()).toHaveLength(0);
  });

  it("no computador, a miniatura de uma entrada vazia também é 'Sem foto' (nunca uma imagem com endereço vazio)", () => {
    comoComputador();
    montar({ fotos: ["", SUPABASE("boa")] });
    const [vazia, boa] = miniaturas();
    expect(vazia?.querySelector("img")).toBeNull();
    expect(vazia?.textContent).toBe("Sem foto");
    expect(boa?.querySelector("img")).not.toBeNull();
  });

  it("entrada vazia ao lado de foto boa: a vazia vira 'Sem foto' e a boa segue", () => {
    montar({ fotos: ["", SUPABASE("boa")] });
    expect(fotosGrandes()).toHaveLength(1);
    expect(hospedeiro.textContent).toContain("Sem foto");
    expect(bolinhas()).toHaveLength(2);
  });
});

describe("GaleriaDoProduto — o pedido de rede de cada foto", () => {
  it("só a primeira foto é pedida já e com prioridade; as outras esperam", () => {
    montar();
    const [primeira, segunda, terceira] = fotosGrandes();
    expect(primeira?.getAttribute("loading")).toBe("eager");
    expect(primeira?.getAttribute("fetchpriority")).toBe("high");
    for (const outra of [segunda, terceira]) {
      expect(outra?.getAttribute("loading")).toBe("lazy");
      expect(outra?.getAttribute("fetchpriority")).toBe("auto");
    }
  });

  it("src de 960 px, escada de 4 larguras, sizes e foto que não se arrasta", () => {
    montar();
    const primeira = fotosGrandes()[0] as HTMLImageElement;
    expect(primeira.getAttribute("src")).toContain(
      "/render/image/public/produtos/a.jpg?width=960&resize=contain&quality=80",
    );
    const larguras = (primeira.getAttribute("srcset") ?? "")
      .split(",")
      .map((c) => c.trim().split(/\s+/)[1]);
    expect(larguras).toEqual(["480w", "640w", "960w", "1280w"]);
    expect(primeira.getAttribute("srcset")).toContain(
      "width=1280&resize=contain&quality=80 1280w",
    );
    expect(primeira.getAttribute("sizes")).toBe(
      "(min-width: 1024px) 720px, 100vw",
    );
    expect(primeira.getAttribute("draggable")).toBe("false");
  });

  it("a miniatura do computador é pequena (200 px) e muda para o leitor de tela", () => {
    comoComputador();
    montar();
    const imagem = miniaturas()[0]?.querySelector("img") as HTMLImageElement;
    expect(imagem.getAttribute("src")).toContain(
      "width=200&resize=contain&quality=80",
    );
    expect(imagem.getAttribute("alt")).toBe("");
    expect(imagem.getAttribute("loading")).toBe("lazy");
  });
});

describe("GaleriaDoProduto — a mesma foto repetida na lista", () => {
  it("renderiza uma faixa por posição, sem aviso de chave repetida, e cada bolinha vai para a sua", () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    const A = SUPABASE("a");
    const B = SUPABASE("b");
    montar({ fotos: [A, B, A] });
    expect(fotosGrandes()).toHaveLength(3);
    expect(qa("[role='group'][aria-roledescription='foto']")).toHaveLength(3);
    act(() => bolinhas()[2]?.click());
    expect(aoMudar).toHaveBeenLastCalledWith(2);
    const avisos = erro.mock.calls.map((c) => String(c[0]));
    expect(avisos.filter((a) => /same key|unique "key"/i.test(a))).toEqual([]);
  });
});
