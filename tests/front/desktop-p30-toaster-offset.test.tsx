// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import type { ToasterProps } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classesDoCelular } from "./classes-do-celular";

const capturar = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({
  Toaster: (props: ToasterProps) => {
    capturar(props);
    return null;
  },
}));
vi.mock("next-themes", () => ({
  useTheme: () => ({ theme: "system" }),
}));

import { Toaster } from "@/components/ui/sonner";

// @ts-expect-error flag interna do ambiente de testes React
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const cabecalho = readFileSync(
  "src/components/desktop/CabecalhoDoComputador.tsx",
  "utf8",
);
const alturaDoCabecalho = Number(cabecalho.match(/lg:min-h-\[(\d+)px\]/)?.[1]);
const recuoEsperado = { top: alturaDoCabecalho + 16 };
let host: HTMLDivElement;
let root: Root;
let largura = 320;
const ouvintes = new Set<() => void>();

beforeEach(() => {
  capturar.mockClear();
  largura = 320;
  ouvintes.clear();
  vi.stubGlobal(
    "matchMedia",
    vi.fn((consulta: string) => ({
      media: consulta,
      matches: consulta === "(min-width: 1024px)" && largura >= 1024,
      addEventListener: (_: string, ouvinte: () => void) =>
        ouvintes.add(ouvinte),
      removeEventListener: (_: string, ouvinte: () => void) =>
        ouvintes.delete(ouvinte),
    })),
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

function propsAtuais(): ToasterProps {
  const ultima = capturar.mock.calls.at(-1);
  expect(ultima, "o wrapper precisa renderizar o Sonner").toBeDefined();
  return ultima?.[0] as ToasterProps;
}

describe("P30 — offset público do Sonner só no computador", () => {
  it.each([320, 600, 601, 768, 1023, 1024, 1440])(
    "%i px: preserva o celular/tablet e afasta o aviso do cabeçalho no PC",
    (pixels) => {
      largura = pixels;
      act(() => root.render(createElement(Toaster)));
      const props = propsAtuais();
      expect(Number.isFinite(alturaDoCabecalho)).toBe(true);
      expect(props.offset).toEqual(pixels >= 1024 ? recuoEsperado : undefined);
      expect(props.mobileOffset).toEqual({
        top: "calc(var(--safe-area-top, 0px) + 64px)",
      });
      expect(props.position).toBe("top-center");
      expect(props.duration).toBe(4500);
      // Literal de className da base 251753360, gerado por gera-literais.cjs.
      expect(classesDoCelular(props.className ?? "")).toBe("toaster group");
    },
  );

  it("acompanha a troca de largura nos dois sentidos sem remontar o Toaster", () => {
    act(() => root.render(createElement(Toaster)));
    expect(propsAtuais().offset).toBeUndefined();
    act(() => {
      largura = 1440;
      for (const notificar of ouvintes) notificar();
    });
    expect(propsAtuais().offset).toEqual(recuoEsperado);
    act(() => {
      largura = 768;
      for (const notificar of ouvintes) notificar();
    });
    expect(propsAtuais().offset).toBeUndefined();
  });

  it("mantém a precedência das props explícitas de quem chama", () => {
    largura = 1440;
    act(() =>
      root.render(
        createElement(Toaster, { offset: 40, position: "bottom-right" }),
      ),
    );
    expect(propsAtuais().offset).toBe(40);
    expect(propsAtuais().position).toBe("bottom-right");
  });
});
