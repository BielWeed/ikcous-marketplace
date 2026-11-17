// @vitest-environment jsdom
import { useAjustesDesktop } from "@/components/admin/settings/NavegacaoDeAjustes";
// O desenho P11 (duas caixas de alturas acopladas) foi substituído pelo
// índice aprovado em 16/11. O contrato agora é a troca responsiva, não um
// hash de toda a fonte que reprovaria qualquer redesenho intencional.
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
let desktop: boolean;
const ouvintes = new Set<() => void>();
function Sonda() {
  return createElement(
    "output",
    null,
    useAjustesDesktop() ? "desktop" : "empilhado",
  );
}
beforeEach(() => {
  desktop = false;
  vi.stubGlobal("matchMedia", (query: string) => {
    expect(query).toBe("(min-width: 1280px)");
    return {
      matches: desktop,
      addEventListener: (_: string, cb: () => void) => ouvintes.add(cb),
      removeEventListener: (_: string, cb: () => void) => ouvintes.delete(cb),
    };
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  ouvintes.clear();
});
it("acompanha a largura nos dois sentidos sem remontar o consumidor", async () => {
  await act(async () => root.render(createElement(Sonda)));
  const output = host.querySelector("output");
  expect(output?.textContent).toBe("empilhado");
  await act(async () => {
    desktop = true;
    ouvintes.forEach((cb) => cb());
  });
  expect(output?.textContent).toBe("desktop");
  await act(async () => {
    desktop = false;
    ouvintes.forEach((cb) => cb());
  });
  expect(output?.textContent).toBe("empilhado");
  expect(host.querySelector("output")).toBe(output);
});
it("usa uma assinatura e a libera ao sair da tela", async () => {
  await act(async () => root.render(createElement(Sonda)));
  expect(ouvintes.size).toBe(1);
  await act(async () => root.render(null));
  expect(ouvintes.size).toBe(0);
});
it("sem matchMedia mantém o fluxo empilhado, sem exceção", async () => {
  vi.stubGlobal("matchMedia", undefined);
  await act(async () => root.render(createElement(Sonda)));
  expect(host.textContent).toBe("empilhado");
});
