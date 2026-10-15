// @vitest-environment jsdom
//
// Foto que falha numa rede ruim (celular no 3G, sinal oscilando): o LazyImage
// desistia na PRIMEIRA falha de verdade -- a vitrine ficava com o quadrado
// "Erro ao carregar" ate a cliente recarregar a pagina inteira, mesmo com a
// rede voltando um segundo depois. O conserto faz ate 2 novas tentativas
// automaticas (espera curta e crescente, nunca laco infinito), e so depois
// mostra um aviso discreto com toque para tentar de novo.
import { LazyImage } from "@/components/LazyImage";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const URL_FOTO =
  "https://loja.supabase.co/storage/v1/object/public/produtos/camisa.png";

// @ts-expect-error flag interna do React, sem tipo publico.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root;
let hospedeiro: HTMLDivElement;

function imagem(): HTMLImageElement | null {
  return hospedeiro.querySelector("img");
}

function falhar(img: HTMLImageElement | null) {
  expect(img).not.toBeNull();
  act(() => {
    img?.dispatchEvent(new Event("error"));
  });
}

function carregar(img: HTMLImageElement | null) {
  expect(img).not.toBeNull();
  act(() => {
    img?.dispatchEvent(new Event("load"));
  });
}

async function avancar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function montar(props: Partial<React.ComponentProps<typeof LazyImage>> = {}) {
  act(() => {
    raiz.render(
      <LazyImage src={URL_FOTO} alt="Camisa azul" priority {...props} />,
    );
  });
}

function botaoDeNovaTentativa(): HTMLButtonElement | null {
  return hospedeiro.querySelector("button");
}

beforeEach(() => {
  vi.useFakeTimers();
  // Meio da faixa de variacao das esperas (fator 1,0): os testes de tempo
  // exato valem; a variacao em si tem seu proprio teste.
  vi.spyOn(Math, "random").mockReturnValue(0.5);
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

describe("LazyImage — rede fraca", () => {
  it("falhou uma vez: NAO mostra erro, espera e pede a foto de novo (outro elemento, URL com marca de nova tentativa)", async () => {
    montar();
    const primeira = imagem();
    expect(primeira?.getAttribute("src")).toBe(URL_FOTO);

    falhar(primeira);
    expect(botaoDeNovaTentativa()).toBeNull();
    expect(hospedeiro.textContent).not.toContain("Erro ao carregar");

    await avancar(1_500);

    const segunda = imagem();
    expect(segunda).not.toBeNull();
    expect(segunda).not.toBe(primeira);
    expect(segunda?.getAttribute("src")).toContain("_r=1");
    expect(segunda?.getAttribute("src")).toContain(URL_FOTO);
  });

  it("a nova tentativa carrega: a foto aparece e nenhum aviso de erro existe", async () => {
    montar();
    falhar(imagem());
    await avancar(1_500);
    carregar(imagem());

    expect(imagem()?.className).toContain("opacity-100");
    expect(botaoDeNovaTentativa()).toBeNull();
    await avancar(60_000);
    expect(botaoDeNovaTentativa()).toBeNull();
  });

  it("com tamanho pedido (sizes): a nova tentativa marca src e srcset", async () => {
    montar({ sizes: "50vw" });
    // 1a falha cai na original (comportamento que ja existia)...
    falhar(imagem());
    expect(imagem()?.getAttribute("src")).toBe(URL_FOTO);
    // ...a 2a esgota a sequencia e agenda a nova tentativa
    falhar(imagem());
    await avancar(1_500);

    const img = imagem();
    // a nova rodada recomeca pela foto pequena (3G paga caro pela original)
    expect(img?.getAttribute("src")).toContain("/render/image/public/");
    expect(img?.getAttribute("src")).toContain("_r=1");
    for (const candidata of (img?.getAttribute("srcset") ?? "").split(",")) {
      expect(candidata).toContain("_r=1");
    }
    expect(img?.getAttribute("sizes")).toBe("50vw");
  });

  it("falhando sempre: 2 novas tentativas com espera crescente e depois PARA, mostrando o toque para tentar de novo", async () => {
    montar();
    falhar(imagem());
    await avancar(1_499);
    expect(imagem()?.getAttribute("src")).toBe(URL_FOTO);
    await avancar(1);
    expect(imagem()?.getAttribute("src")).toContain("_r=1");

    falhar(imagem());
    await avancar(2_999);
    expect(imagem()?.getAttribute("src")).toContain("_r=1");
    await avancar(1);
    expect(imagem()?.getAttribute("src")).toContain("_r=2");

    falhar(imagem());
    const ultima = imagem();
    expect(botaoDeNovaTentativa()).not.toBeNull();

    // muito tempo depois: nada de laco, o mesmo elemento segue la
    await avancar(10 * 60_000);
    expect(imagem()).toBe(ultima);
    expect(ultima?.getAttribute("src")).toContain("_r=2");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("depois de esgotar, o aviso e um botao discreto com nome acessivel que cita a foto", async () => {
    montar();
    falhar(imagem());
    await avancar(1_500);
    falhar(imagem());
    await avancar(3_000);
    falhar(imagem());

    const botao = botaoDeNovaTentativa();
    expect(botao).not.toBeNull();
    expect(botao?.getAttribute("type")).toBe("button");
    expect(botao?.getAttribute("aria-label")).toContain("Camisa azul");
    expect(botao?.textContent).toContain("Toque para tentar de novo");
    expect(hospedeiro.textContent).not.toContain("Erro ao carregar");
  });

  it("toque no botao: tenta na hora (sem esperar), e ganha novo folego se falhar de novo", async () => {
    montar();
    falhar(imagem());
    await avancar(1_500);
    falhar(imagem());
    await avancar(3_000);
    falhar(imagem());
    expect(botaoDeNovaTentativa()).not.toBeNull();

    act(() => {
      botaoDeNovaTentativa()?.click();
    });
    expect(botaoDeNovaTentativa()).toBeNull();
    const nova = imagem();
    expect(nova?.getAttribute("src")).toContain("_r=3");

    // novo folego: 2 automaticas de novo antes do botao voltar
    falhar(nova);
    expect(botaoDeNovaTentativa()).toBeNull();
    await avancar(1_500);
    expect(imagem()?.getAttribute("src")).toContain("_r=4");
  });

  it("o toque no botao NAO vaza para o card em volta (nao abre o produto)", async () => {
    const aoClicarNoCard = vi.fn();
    act(() => {
      raiz.render(
        // O cartao so existe para observar o clique que sobe.
        // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
        <div onClick={aoClicarNoCard}>
          <LazyImage src={URL_FOTO} alt="Camisa azul" priority />
        </div>,
      );
    });
    falhar(imagem());
    await avancar(1_500);
    falhar(imagem());
    await avancar(3_000);
    falhar(imagem());

    act(() => {
      botaoDeNovaTentativa()?.click();
    });
    expect(aoClicarNoCard).not.toHaveBeenCalled();
  });

  it("o botao fica POR CIMA da foto invisivel (z-10): sem isso o toque cai na <img> e abre o produto", async () => {
    // O jsdom nao calcula empilhamento -- `button.click()` passa mesmo com a
    // <img> (opacity-0, camada propria, depois no DOM) pintada por cima do
    // botao. Quem prova o toque de verdade e o Chromium (elementFromPoint); aqui
    // so se trava a classe que decide a ordem, para ninguem tirar sem ver.
    montar();
    falhar(imagem());
    await avancar(1_500);
    falhar(imagem());
    await avancar(3_000);
    falhar(imagem());

    const botao = botaoDeNovaTentativa();
    expect(botao?.className.split(/\s+/)).toContain("z-10");
    // e a foto invisivel continua la, sem z-index proprio acima do botao
    expect(imagem()?.className).toContain("opacity-0");
    expect(imagem()?.className.split(/\s+/)).not.toContain("z-10");
  });

  it("o toque no botao nao navega (preventDefault), caso a foto more dentro de um link", async () => {
    montar();
    falhar(imagem());
    await avancar(1_500);
    falhar(imagem());
    await avancar(3_000);
    falhar(imagem());

    const clique = new MouseEvent("click", { bubbles: true, cancelable: true });
    act(() => {
      botaoDeNovaTentativa()?.dispatchEvent(clique);
    });
    expect(clique.defaultPrevented).toBe(true);
  });

  it("as esperas variam ±20%: nao saem todas no mesmo instante numa grade de fotos", async () => {
    // sorteio no minimo: 1,2 s
    vi.spyOn(Math, "random").mockReturnValue(0);
    montar();
    falhar(imagem());
    await avancar(1_199);
    expect(imagem()?.getAttribute("src")).toBe(URL_FOTO);
    await avancar(1);
    expect(imagem()?.getAttribute("src")).toContain("_r=1");

    // sorteio no maximo: 1,8 s
    act(() => raiz.unmount());
    raiz = createRoot(hospedeiro);
    vi.spyOn(Math, "random").mockReturnValue(1);
    montar();
    falhar(imagem());
    await avancar(1_799);
    expect(imagem()?.getAttribute("src")).toBe(URL_FOTO);
    await avancar(1);
    expect(imagem()?.getAttribute("src")).toContain("_r=1");
  });

  it("foto que carregou de primeira nao e pedida de novo e nao deixa relogio nenhum", async () => {
    montar();
    const primeira = imagem();
    carregar(primeira);
    await avancar(60_000);

    expect(imagem()).toBe(primeira);
    expect(primeira?.getAttribute("src")).toBe(URL_FOTO);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("sair da tela com a nova tentativa pendente cancela o relogio", async () => {
    montar();
    falhar(imagem());
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    act(() => raiz.unmount());
    expect(vi.getTimerCount()).toBe(0);
    // afterEach desmonta de novo -- recria a raiz para nao duplicar o unmount
    raiz = createRoot(hospedeiro);
  });

  it("preserva o que ja existia: alt, prioridade da primeira imagem e objectFit", async () => {
    montar({ objectFit: "contain" });
    const img = imagem();
    expect(img?.getAttribute("alt")).toBe("Camisa azul");
    expect(img?.getAttribute("fetchpriority")).toBe("high");
    expect(img?.getAttribute("loading")).toBe("eager");
    expect(img?.style.objectFit).toBe("contain");

    falhar(img);
    await avancar(1_500);
    const nova = imagem();
    expect(nova?.getAttribute("alt")).toBe("Camisa azul");
    expect(nova?.getAttribute("fetchpriority")).toBe("high");
    expect(nova?.style.objectFit).toBe("contain");
  });

  it("URL que nao e http(s) (data:, blob:) volta intacta: nao ganha marca de tentativa", async () => {
    const dados = "data:image/gif;base64,R0lGODlhAQABAAAAACw=";
    montar({ src: dados });
    falhar(imagem());
    await avancar(1_500);

    expect(imagem()?.getAttribute("src")).toBe(dados);
  });

  it("trocar a foto (src novo) depois do erro final limpa o aviso e recomeca", async () => {
    montar();
    falhar(imagem());
    await avancar(1_500);
    falhar(imagem());
    await avancar(3_000);
    falhar(imagem());
    expect(botaoDeNovaTentativa()).not.toBeNull();

    montar({ src: `${URL_FOTO}?outra=1` });
    expect(botaoDeNovaTentativa()).toBeNull();
    falhar(imagem());
    // folego novo: continua tentando, nao mostra o botao de cara
    expect(botaoDeNovaTentativa()).toBeNull();
  });
});
