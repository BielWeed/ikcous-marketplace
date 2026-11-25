// @vitest-environment jsdom
//
// Caça por mutação (24/11/2026), território components: o `LazyImage` (a foto
// de produto, de banner e de oferta do app inteiro) tinha cobertas as novas
// tentativas na rede fraca e a reserva "Sem foto", mas estes pontos passavam
// com o defeito plantado:
//  - o NOME FALADO da foto de reserva: decorativa (alt vazio) fica escondida do
//    leitor de tela; com alt vira imagem com o nome; sem alt vira "Produto sem
//    foto";
//  - as medidas pedidas (largura e altura) chegam ao quadro da foto, e quando
//    não são pedidas o quadro não inventa medida nenhuma;
//  - o botão de "Toque para tentar de novo" (depois das tentativas automáticas)
//    pede a foto de novo e limpa o aviso; com `priorizarAvisoDeErro` o aviso
//    vira um cartão pequeno no topo e o quadro deixa o toque passar.
import { LazyImage } from "@/components/LazyImage";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo publico.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const RESERVA = "https://placehold.co/600x400?text=Sem+Imagem";
const FOTO = "https://loja.test/produto.webp";

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  vi.useFakeTimers();
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const quadro = () => hospedeiro.firstElementChild as HTMLElement;
function montar(props: Partial<Parameters<typeof LazyImage>[0]>) {
  act(() => {
    raiz.render(<LazyImage src={FOTO} alt="Camisa azul" priority {...props} />);
  });
}

describe("LazyImage — foto de reserva: nome falado", () => {
  it("alt vazio (foto decorativa, o nome está ao lado): escondida do leitor de tela", () => {
    montar({ src: RESERVA, alt: "" });
    expect(quadro().getAttribute("aria-hidden")).toBe("true");
    expect(quadro().hasAttribute("role")).toBe(false);
    expect(quadro().hasAttribute("aria-label")).toBe(false);
  });

  it("com alt: vira uma imagem com o nome do produto", () => {
    montar({ src: RESERVA, alt: "Camisa azul" });
    expect(quadro().getAttribute("role")).toBe("img");
    expect(quadro().getAttribute("aria-label")).toBe("Camisa azul");
    expect(quadro().hasAttribute("aria-hidden")).toBe(false);
  });

  it("sem alt nenhum: a imagem se chama 'Produto sem foto'", () => {
    montar({ src: RESERVA, alt: undefined as unknown as string });
    expect(quadro().getAttribute("role")).toBe("img");
    expect(quadro().getAttribute("aria-label")).toBe("Produto sem foto");
  });

  it("a reserva também respeita as medidas pedidas", () => {
    montar({ src: RESERVA, alt: "x", width: 120, height: "50%" });
    expect(quadro().style.width).toBe("120px");
    expect(quadro().style.height).toBe("50%");
  });
});

describe("LazyImage — medidas do quadro da foto", () => {
  it("largura e altura pedidas chegam ao quadro", () => {
    montar({ width: 200, height: 100 });
    expect(quadro().style.width).toBe("200px");
    expect(quadro().style.height).toBe("100px");
  });

  it("só a largura: a altura não é inventada (e vice-versa)", () => {
    montar({ width: 200 });
    expect(quadro().style.width).toBe("200px");
    expect(quadro().style.height).toBe("");
    montar({ width: undefined, height: 80 });
    expect(quadro().style.width).toBe("");
    expect(quadro().style.height).toBe("80px");
  });

  it("sem medidas: o quadro não leva largura nem altura", () => {
    montar({});
    expect(quadro().style.width).toBe("");
    expect(quadro().style.height).toBe("");
  });
});

describe("LazyImage — falha definitiva e 'Toque para tentar de novo'", () => {
  /** Falha a foto até acabarem as tentativas automáticas (1,5 s e 3 s, ±20%). */
  function falharAteDesistir() {
    for (let i = 0; i < 3; i++) {
      act(() => {
        hospedeiro.querySelector("img")?.dispatchEvent(new Event("error"));
      });
      act(() => {
        vi.advanceTimersByTime(4000);
      });
    }
  }
  const aviso = () => hospedeiro.querySelector("button");

  it("enquanto há tentativa automática: nenhum aviso de erro", () => {
    montar({});
    act(() => {
      hospedeiro.querySelector("img")?.dispatchEvent(new Event("error"));
    });
    expect(aviso()).toBeNull();
  });

  it("dois erros do mesmo pedido gastam UMA tentativa só (não antecipam o aviso)", () => {
    montar({});
    const falhar = () =>
      act(() => {
        hospedeiro.querySelector("img")?.dispatchEvent(new Event("error"));
      });
    const esperar = () =>
      act(() => {
        vi.advanceTimersByTime(4000);
      });
    falhar();
    falhar(); // o navegador avisou duas vezes da mesma foto
    esperar(); // 1ª tentativa automática
    falhar();
    esperar(); // 2ª tentativa automática
    expect(aviso()).toBeNull();
    falhar(); // acabaram as automáticas
    expect(aviso()).not.toBeNull();
  });

  it("depois das tentativas: aviso com o nome da foto; tocar pede a foto de novo e limpa o aviso", () => {
    montar({});
    falharAteDesistir();
    expect(aviso()).not.toBeNull();
    expect(aviso()?.getAttribute("aria-label")).toBe(
      'A foto "Camisa azul" não carregou. Toque para tentar de novo',
    );
    expect(aviso()?.textContent).toBe("Toque para tentar de novo");
    const imagemAntes = hospedeiro.querySelector("img");

    act(() => aviso()?.click());
    expect(aviso()).toBeNull();
    const imagemDepois = hospedeiro.querySelector("img");
    expect(imagemDepois).not.toBeNull();
    // Pedido novo: elemento novo, e a foto volta escondida até carregar.
    expect(imagemDepois).not.toBe(imagemAntes);
    expect(imagemDepois?.className).toContain("opacity-0");
  });

  it("sem alt: o aviso fala 'A foto não carregou' sem nome", () => {
    montar({ alt: "" });
    falharAteDesistir();
    expect(aviso()?.getAttribute("aria-label")).toBe(
      "A foto não carregou. Toque para tentar de novo",
    );
  });

  it("tocar em 'tentar de novo' não aciona o cartão clicável em volta", () => {
    const aoClicarNoCartao = vi.fn();
    act(() => {
      raiz.render(
        <div
          role="button"
          tabIndex={0}
          onClick={aoClicarNoCartao}
          onKeyDown={() => {}}
        >
          <LazyImage src={FOTO} alt="Camisa azul" priority />
        </div>,
      );
    });
    falharAteDesistir();
    act(() => aviso()?.click());
    expect(aoClicarNoCartao).not.toHaveBeenCalled();
  });

  it("padrão: o aviso cobre a foto inteira e o quadro tem fundo", () => {
    montar({});
    falharAteDesistir();
    expect(aviso()?.className).toContain("inset-0");
    expect(quadro().className).toContain("bg-zinc-100");
    expect(quadro().className).not.toContain("pointer-events-none");
  });

  it("com priorizarAvisoDeErro: o aviso é um cartão pequeno e o quadro deixa o toque passar", () => {
    montar({ priorizarAvisoDeErro: true });
    falharAteDesistir();
    expect(aviso()?.className).toContain("top-2");
    expect(aviso()?.className).not.toContain("inset-0");
    expect(quadro().className).toContain("pointer-events-none");
    expect(quadro().className).not.toContain("bg-zinc-100");
  });

  it("priorizarAvisoDeErro sem erro: o quadro é normal (só o aviso muda o quadro)", () => {
    montar({ priorizarAvisoDeErro: true });
    expect(quadro().className).not.toContain("pointer-events-none");
    expect(quadro().className).toContain("bg-zinc-100");
  });

  it("a foto que carrega some o esqueleto e aparece (opacity-100)", () => {
    montar({});
    act(() => {
      hospedeiro.querySelector("img")?.dispatchEvent(new Event("load"));
    });
    expect(hospedeiro.querySelector("img")?.className).toContain("opacity-100");
  });
});
