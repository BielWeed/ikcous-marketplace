// @vitest-environment jsdom
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { IlhaDeAtualizacao } from "@/components/pwa/IlhaDeAtualizacao";
import {
  anunciarAtualizacaoConcluida,
  definirEstadoDaAtualizacao,
} from "@/lib/atualizacao/estado-da-atualizacao";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("ilha da atualização", () => {
  let host: HTMLDivElement;
  let raiz: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    definirEstadoDaAtualizacao({ fase: "nenhuma", versaoNova: null });
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    definirEstadoDaAtualizacao({ fase: "nenhuma", versaoNova: null });
    host.remove();
    vi.useRealTimers();
  });

  it("mantém a região de anúncio vazia quando não há atualização", () => {
    act(() => raiz.render(<IlhaDeAtualizacao />));
    expect(host.textContent).toBe("");
    expect(host.querySelector('[role="status"]')).not.toBeNull();
  });

  it("o comprador não vê a espera nem novidades da versão", () => {
    definirEstadoDaAtualizacao({
      fase: "aguardando",
      versaoNova: "1.5.31",
    });
    act(() => raiz.render(<IlhaDeAtualizacao />));
    expect(host.textContent).toBe("");
    expect(host.querySelector("button")).toBeNull();
  });

  it("o painel informa que vai instalar ao terminar, sem oferecer botão", () => {
    definirEstadoDaAtualizacao({ fase: "aguardando" });
    act(() => raiz.render(<IlhaDeAtualizacao variante="painel" />));
    expect(host.textContent).toBe("Atualização pronta");
    expect(host.querySelector("button")).toBeNull();
  });

  it("anuncia a instalação com educação e não toma o foco", () => {
    const entrada = document.createElement("input");
    document.body.appendChild(entrada);
    entrada.focus();
    act(() => raiz.render(<IlhaDeAtualizacao />));
    act(() => definirEstadoDaAtualizacao({ fase: "instalando" }));
    const status = host.querySelector('[role="status"]');
    expect(status?.textContent).toBe("Atualizando o app…");
    expect(status?.getAttribute("aria-live")).toBe("polite");
    expect(status?.getAttribute("aria-atomic")).toBe("true");
    expect(host.querySelector("button, [tabindex]")).toBeNull();
    expect(document.activeElement).toBe(entrada);
    expect(status?.querySelector('[aria-hidden="true"]')).not.toBeNull();
    entrada.remove();
  });

  it("a conclusão some ao fim dos três segundos da store, sem timer paralelo", () => {
    act(() => raiz.render(<IlhaDeAtualizacao />));
    act(() => anunciarAtualizacaoConcluida());
    expect(host.textContent).toBe("Pronto! App atualizado");
    act(() => vi.advanceTimersByTime(2999));
    expect(host.textContent).toBe("Pronto! App atualizado");
    act(() => vi.advanceTimersByTime(1));
    expect(host.textContent).toBe("");
  });

  it("a conclusão anunciada no boot espera a ilha montar: os 3 s contam da tela, não do boot", () => {
    // Boot anuncia (como `aoIniciarAposAtualizacao`), mas a barra do painel
    // só monta depois de conferir o acesso — aqui, 5 s depois.
    act(() => anunciarAtualizacaoConcluida({ duracaoMs: 15_000 }));
    act(() => vi.advanceTimersByTime(5000));
    act(() => raiz.render(<IlhaDeAtualizacao variante="painel" />));
    expect(host.textContent).toBe("Pronto! App atualizado");
    act(() => vi.advanceTimersByTime(2999));
    expect(host.textContent).toBe("Pronto! App atualizado");
    act(() => vi.advanceTimersByTime(1));
    expect(host.textContent).toBe("");
  });

  it("o movimento é só de CSS e respeita 'menos movimento' (motion-safe), sem framer-motion", () => {
    definirEstadoDaAtualizacao({ fase: "instalando" });
    act(() => raiz.render(<IlhaDeAtualizacao />));
    expect(host.textContent).toBe("Atualizando o app…");
    const capsula = host.querySelector('[role="status"] > span')!;
    expect(capsula.className).toContain("motion-safe:animate-in");
    expect(capsula.getAttribute("style") ?? "").toBe("");
    expect(
      host.querySelector('[class~="motion-safe:animate-spin"]'),
    ).not.toBeNull();
    expect(host.querySelector(".animate-spin")).toBeNull();
    act(() => definirEstadoDaAtualizacao({ fase: "concluida" }));
    expect(host.textContent).toBe("Pronto! App atualizado");
  });
});
