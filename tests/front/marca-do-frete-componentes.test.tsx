// MARCA DO FRETE — componentes (peça 3 da tarefa "cart-frete-logos").
// @vitest-environment jsdom
//
// Sem @testing-library/react (não instalado neste projeto) — mesmo padrão
// dos outros testes de componente deste projeto (ver
// admin-kpi-carousel-compacto.test.tsx).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros testes de componente deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let hospedeiro: HTMLDivElement;
let raiz: Root;

async function montar(elemento: React.ReactElement) {
  await act(async () => {
    raiz.render(elemento);
  });
}

beforeEach(() => {
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => {
    raiz.unmount();
  });
  hospedeiro.remove();
});

describe("LogoDaTransportadora", () => {
  it("logo de texto BRANCO (Azul Cargo) ganha selo escuro; os demais seguem no selo branco", async () => {
    const { LogoDaTransportadora } = await import(
      "@/components/shipping/MarcaDoFrete"
    );
    await montar(
      <>
        <LogoDaTransportadora slug="azul-cargo" nome="Azul Cargo Express" />
        <LogoDaTransportadora slug="correios" nome="Correios" />
      </>,
    );
    const [azul, correios] = [...hospedeiro.querySelectorAll("img")].map(
      (img) => img.parentElement as HTMLElement,
    );
    expect(azul.className).toContain("bg-zinc-900");
    expect(azul.className).not.toMatch(/(^|\s)bg-white(\s|$)/);
    expect(correios.className).toContain("bg-white");
    expect(correios.className).not.toContain("bg-zinc-900");
  });

  it("com transportadora reconhecida, o img tem alt igual ao nome da marca", async () => {
    const { LogoDaTransportadora } = await import(
      "@/components/shipping/MarcaDoFrete"
    );
    await montar(<LogoDaTransportadora slug="correios" nome="Correios" />);

    const img = hospedeiro.querySelector("img");
    expect(img).toBeTruthy();
    expect(img?.getAttribute("alt")).toBe("Correios");
    expect(img?.getAttribute("loading")).toBe("lazy");
    expect(img?.getAttribute("decoding")).toBe("async");
    // Sem ícone de fallback visível enquanto o logo carrega normalmente.
    expect(hospedeiro.querySelector("svg")).toBeNull();
  });

  it("transportadora desconhecida (slug null) cai direto no ícone de fallback", async () => {
    const { LogoDaTransportadora } = await import(
      "@/components/shipping/MarcaDoFrete"
    );
    await montar(
      <LogoDaTransportadora slug={null} nome="Transportadora Nova Ltda" />,
    );

    expect(hospedeiro.querySelector("img")).toBeNull();
    const icone = hospedeiro.querySelector("svg");
    expect(icone).toBeTruthy();
    expect(icone?.getAttribute("aria-hidden")).toBe("true");
  });

  it("erro ao carregar o asset (onError) troca para o ícone de fallback", async () => {
    const { LogoDaTransportadora } = await import(
      "@/components/shipping/MarcaDoFrete"
    );
    await montar(<LogoDaTransportadora slug="jadlog" nome="Jadlog" />);

    const img = hospedeiro.querySelector("img");
    expect(img).toBeTruthy();

    await act(async () => {
      img!.dispatchEvent(new Event("error"));
    });

    expect(hospedeiro.querySelector("img")).toBeNull();
    const icone = hospedeiro.querySelector("svg");
    expect(icone).toBeTruthy();
    expect(icone?.getAttribute("aria-hidden")).toBe("true");
  });

  it("largura e altura do img são fixas (evita layout shift)", async () => {
    const { LogoDaTransportadora } = await import(
      "@/components/shipping/MarcaDoFrete"
    );
    await montar(
      <LogoDaTransportadora slug="loggi" nome="Loggi" tamanho={40} />,
    );

    const img = hospedeiro.querySelector("img");
    expect(img?.getAttribute("width")).toBeTruthy();
    expect(img?.getAttribute("height")).toBe("40");
  });
});

describe("SeloDoAgregador", () => {
  it("sempre mostra o texto 'via <Nome>', com o logo do agregador ao lado", async () => {
    const { SeloDoAgregador } = await import(
      "@/components/shipping/MarcaDoFrete"
    );
    await montar(<SeloDoAgregador slug="melhor-envio" nome="Melhor Envio" />);

    expect(hospedeiro.textContent).toContain("via Melhor Envio");
    const img = hospedeiro.querySelector("img");
    expect(img).toBeTruthy();
    // Decorativo: o texto já diz o nome, então alt vazio evita leitura dupla.
    expect(img?.getAttribute("alt")).toBe("");
  });

  it("agregador sem asset mapeado (slug desconhecido) ainda mostra o texto 'via <Nome>'", async () => {
    const { SeloDoAgregador } = await import(
      "@/components/shipping/MarcaDoFrete"
    );
    await montar(
      <SeloDoAgregador slug="provedor-sem-logo" nome="Provedor Sem Logo" />,
    );

    expect(hospedeiro.textContent).toContain("via Provedor Sem Logo");
    expect(hospedeiro.querySelector("img")).toBeNull();
  });

  it("erro ao carregar o logo do agregador remove o img mas mantém o texto", async () => {
    const { SeloDoAgregador } = await import(
      "@/components/shipping/MarcaDoFrete"
    );
    await montar(<SeloDoAgregador slug="frenet" nome="Frenet" />);

    const img = hospedeiro.querySelector("img");
    expect(img).toBeTruthy();

    await act(async () => {
      img!.dispatchEvent(new Event("error"));
    });

    expect(hospedeiro.querySelector("img")).toBeNull();
    expect(hospedeiro.textContent).toContain("via Frenet");
  });
});
