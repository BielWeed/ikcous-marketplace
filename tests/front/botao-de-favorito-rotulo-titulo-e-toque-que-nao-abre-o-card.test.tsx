// @vitest-environment jsdom
//
// Caça por mutação (25/11/2026), BotaoDeFavorito. O teste vizinho (botao-de-favorito-centrado)
// prende a geometria; faltava o comportamento:
//  - o nome falado: "Adicionar <produto> aos favoritos" / "Remover <produto> dos favoritos",
//    ou o rótulo próprio de quem usa a peça (a tela que já mostra o nome);
//  - o mesmo texto vai no `title` (dica do mouse);
//  - o coração é decorativo (escondido do leitor) e só fica PREENCHIDO quando é favorito;
//  - dentro de um formulário o botão NÃO envia o formulário (tipo `button`);
//  - o toque favorita e NÃO sobe até o card (favoritar não pode abrir o produto).
import { BotaoDeFavorito } from "@/components/ui/custom/BotaoDeFavorito";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("BotaoDeFavorito: nome falado, título, preenchimento e toque", () => {
  let raiz: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
  });
  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    host.remove();
  });

  const botao = () => host.querySelector("button") as HTMLButtonElement;
  const coracao = () => botao().querySelector("svg") as SVGElement;

  function desenhar(
    props: Partial<Parameters<typeof BotaoDeFavorito>[0]> = {},
    pai?: { onClickDoCard?: () => void; onSubmit?: () => void },
  ) {
    act(() => {
      raiz.render(
        <div role="presentation" onClick={pai?.onClickDoCard}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              pai?.onSubmit?.();
            }}
          >
            <BotaoDeFavorito
              nome="Blusa Azul"
              favorito={false}
              onClick={() => {}}
              {...props}
            />
          </form>
        </div>,
      );
    });
  }

  it("nome falado e título dizem o que o toque faz, com o nome do produto", () => {
    desenhar({ favorito: false });
    expect(botao().getAttribute("aria-label")).toBe(
      "Adicionar Blusa Azul aos favoritos",
    );
    expect(botao().getAttribute("title")).toBe(
      "Adicionar Blusa Azul aos favoritos",
    );
    desenhar({ favorito: true });
    expect(botao().getAttribute("aria-label")).toBe(
      "Remover Blusa Azul dos favoritos",
    );
    expect(botao().getAttribute("title")).toBe(
      "Remover Blusa Azul dos favoritos",
    );
  });

  it("rótulo próprio vence o gerado; nome vazio cai no rótulo genérico (sem espaço duplo)", () => {
    desenhar({ rotulo: "Favoritar este item" });
    expect(botao().getAttribute("aria-label")).toBe("Favoritar este item");
    expect(botao().getAttribute("title")).toBe("Favoritar este item");
    desenhar({ nome: "" });
    expect(botao().getAttribute("aria-label")).toBe("Adicionar aos favoritos");
  });

  it("o coração é decorativo e só é preenchido quando o produto é favorito", () => {
    desenhar({ favorito: false });
    expect(coracao().getAttribute("aria-hidden")).toBe("true");
    expect(coracao().classList.contains("fill-current")).toBe(false);
    desenhar({ favorito: true });
    expect(coracao().getAttribute("aria-hidden")).toBe("true");
    expect(coracao().classList.contains("fill-current")).toBe(true);
  });

  it("marca o botão para as folhas de estilo de tela e é do tipo `button`", () => {
    desenhar();
    expect(botao().hasAttribute("data-botao-favorito")).toBe(true);
    expect(botao().getAttribute("type")).toBe("button");
  });

  it("dentro de um formulário, tocar não envia o formulário", () => {
    const onSubmit = vi.fn();
    desenhar({}, { onSubmit });
    act(() => {
      botao().click();
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("o toque chama onClick com o evento e NÃO sobe até o card", () => {
    const onClick = vi.fn();
    const onClickDoCard = vi.fn();
    desenhar({ onClick }, { onClickDoCard });
    act(() => {
      botao().click();
    });
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClick.mock.calls[0]?.[0]).toHaveProperty("type", "click");
    expect(onClickDoCard).not.toHaveBeenCalled();
  });
});
