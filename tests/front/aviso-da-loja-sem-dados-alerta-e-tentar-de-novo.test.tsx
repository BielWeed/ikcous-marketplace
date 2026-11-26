// @vitest-environment jsdom
//
// Aviso "Não foi possível carregar os dados da loja" (Ajustes, Minha loja,
// Frete...): sem ele a tela abre com a configuração de fábrica e a lojista pode
// digitar tudo de novo por cima do que já existe. O aviso tem de (1) ser lido
// como alerta, (2) dizer que campo vazio não quer dizer "não cadastrou" e
// (3) oferecer "Tentar de novo" — um toque, uma leitura nova (nunca duas, nunca
// nenhuma).
import { AvisoDaLojaSemDados } from "@/components/admin/AvisoDaLojaSemDados";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("AvisoDaLojaSemDados", () => {
  it("é um alerta com a explicação de que campo vazio pode estar enganando", async () => {
    await act(async () =>
      root.render(<AvisoDaLojaSemDados onTentarDeNovo={() => {}} />),
    );
    const alerta = host.querySelector('[role="alert"]');
    expect(alerta).not.toBeNull();
    expect(alerta?.textContent).toContain(
      "Não foi possível carregar os dados da loja.",
    );
    expect(alerta?.textContent).toContain(
      "Os campos abaixo podem aparecer vazios mesmo com a loja já cadastrada.",
    );
    expect(alerta?.hasAttribute("data-aviso-loja-sem-dados")).toBe(true);
  });

  it("o único botão é 'Tentar de novo' e cada toque pede UMA leitura nova", async () => {
    const tentar = vi.fn();
    await act(async () =>
      root.render(<AvisoDaLojaSemDados onTentarDeNovo={tentar} />),
    );
    const botoes = host.querySelectorAll("button");
    expect(botoes).toHaveLength(1);
    const botao = botoes[0] as HTMLButtonElement;
    expect(botao.type).toBe("button");
    expect(botao.textContent?.trim()).toBe("Tentar de novo");
    expect(tentar).not.toHaveBeenCalled();
    await act(async () => botao.click());
    expect(tentar).toHaveBeenCalledTimes(1);
    await act(async () => botao.click());
    expect(tentar).toHaveBeenCalledTimes(2);
  });

  it("os ícones são decorativos (o leitor de tela só lê o texto)", async () => {
    await act(async () =>
      root.render(<AvisoDaLojaSemDados onTentarDeNovo={() => {}} />),
    );
    const icones = [...host.querySelectorAll("svg")];
    expect(icones).toHaveLength(2);
    for (const icone of icones) {
      expect(icone.getAttribute("aria-hidden")).toBe("true");
    }
  });
});
