import type { EstadoDeOperacao } from "@/components/admin/PontoDeOperacao";
// @vitest-environment jsdom
import { ConexaoDoPainel } from "@/components/layouts/ConexaoDoPainel";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("casca — detalhes da conexão sem nova consulta", () => {
  let host: HTMLDivElement;
  let root: Root;
  const normal: EstadoDeOperacao = {
    isOffline: false,
    quality: "good",
    latency: 120,
    showSyncFlash: false,
  };

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function montar(estado = normal) {
    act(() =>
      root.render(
        <ConexaoDoPainel
          estado={estado}
          nome="Ateliê das Marés & Casa Coleção Jardim das Dunas"
        />,
      ),
    );
    return host.querySelector<HTMLButtonElement>("button")!;
  }

  it("mostra o nome completo sem truncar e mantém Admin e Online", () => {
    const botao = montar();
    expect(botao.textContent).toContain(
      "Ateliê das Marés & Casa Coleção Jardim das Dunas",
    );
    expect(botao.textContent).toContain("Admin · Online");
    expect(botao.querySelector(".truncate, .line-clamp-1")).toBeNull();
    expect(botao.getAttribute("aria-expanded")).toBe("false");
    expect(botao.title).toBe("Conexão boa");
  });

  it.each([
    [normal, "Conexão boa", "A loja está conectada."],
    [
      { ...normal, quality: "slow" },
      "Conexão lenta",
      "As respostas podem demorar.",
    ],
    [
      { ...normal, isOffline: true, quality: "offline" },
      "Reconexão automática",
      "Aguarde o retorno do servidor.",
    ],
    [
      { ...normal, showSyncFlash: true },
      "Sincronização concluída!",
      "A conexão voltou a responder.",
    ],
  ] as const)("abre a explicação: %s", (estado, titulo, detalhe) => {
    const botao = montar(estado);
    act(() => botao.click());
    expect(botao.getAttribute("aria-expanded")).toBe("true");
    const painel = document.getElementById(
      botao.getAttribute("aria-controls")!,
    );
    expect(painel?.textContent).toContain(titulo);
    expect(painel?.textContent).toContain(detalhe);
    const fechar = painel!.querySelector<HTMLButtonElement>(
      'button[aria-label="Fechar detalhes da conexão"]',
    )!;
    expect(fechar.className).toContain("size-11");
    act(() => fechar.click());
    expect(botao.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(botao);
  });

  it("Escape fecha e devolve o foco à conexão", () => {
    const botao = montar();
    act(() => botao.click());
    act(() =>
      botao.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
    );
    expect(botao.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(botao);
  });
});
