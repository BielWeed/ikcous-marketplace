// @vitest-environment jsdom
//
// `useIconesPeloNome`: com o catálogo já em memória, o efeito acha o MESMO mapa que o componente já tem e não
// pode provocar um render extra (nem trocar o objeto devolvido).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type IconeSugerido,
  esquecerOsIconesPeloNome,
  useIconesPeloNome,
} from "@/hooks/useIconesPeloNome";
import { esquecerOCatalogoCarregado } from "@/lib/catalogo-de-icones";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const CATALOGO: unknown = JSON.parse(
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho fixo do próprio repositório
  readFileSync(
    join(__dirname, "..", "..", "public", "icons", "categorias.json"),
    "utf8",
  ),
);
const espera = () => new Promise<void>((r) => setTimeout(r, 0));

describe("useIconesPeloNome: render à toa", () => {
  let host: HTMLDivElement;
  let raiz: Root;
  const registro = vi.fn<(mapa: ReadonlyMap<string, IconeSugerido>) => void>();
  const renders = () => registro.mock.calls.length;
  const ultimo = () => registro.mock.calls.at(-1)?.[0];
  const categorias = [{ name: "Bolsas femininas" }, { name: "Tênis" }];

  function Sonda() {
    registro(useIconesPeloNome(categorias));
    return null;
  }

  beforeEach(() => {
    esquecerOCatalogoCarregado();
    esquecerOsIconesPeloNome();
    registro.mockReset();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => CATALOGO }),
    );
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
  });
  afterEach(() => {
    act(() => raiz.unmount());
    host.remove();
  });

  async function montar() {
    await act(async () => {
      raiz.render(<Sonda />);
    });
    await act(async () => {
      await espera();
    });
  }

  it("1ª vez: o catálogo chega e o mapa vem (1 render a mais, o necessário)", async () => {
    await montar();
    expect(ultimo()?.get("Bolsas femininas")).toBeDefined();
    expect(renders()).toBe(2);
  });

  it("catálogo já em memória: monta com o mapa pronto e o efeito não renderiza de novo", async () => {
    await montar();
    act(() => raiz.unmount());
    raiz = createRoot(host);
    registro.mockClear();
    await montar();
    expect(ultimo()?.get("Bolsas femininas")).toBeDefined();
    expect(renders()).toBe(1);
  });
});
