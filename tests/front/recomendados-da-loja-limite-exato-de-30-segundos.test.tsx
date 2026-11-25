// @vitest-environment jsdom
//
// `useRecomendadosDaLoja`: ao voltar à vista o Início relê o e-mail e as
// transportadoras no máximo uma vez a cada 30 s. A régua é "pelo menos 30 s":
// com 29,999 s ainda não relê; com exatamente 30 s relê.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const buscarConfiguracaoDeFrete = vi.hoisted(() =>
  vi.fn<() => Promise<unknown>>(),
);
const recarregar = vi.hoisted(() => vi.fn<() => void>());

vi.mock(
  "@/components/admin/settings/TransportadorasCard",
  async (original) => ({
    ...(await original<
      typeof import("@/components/admin/settings/TransportadorasCard")
    >()),
    buscarConfiguracaoDeFrete: () => buscarConfiguracaoDeFrete(),
  }),
);
vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke: vi.fn() } },
}));
vi.mock("@/hooks/useEmailDaLoja", () => ({
  useEmailDaLoja: () => ({ carga: "pronto", status: null, recarregar }),
}));

import { useRecomendadosDaLoja } from "@/hooks/useRecomendadosDaLoja";

let ultimo: ReturnType<typeof useRecomendadosDaLoja>;
function Sonda({ active }: Readonly<{ active: boolean }>) {
  const lidos = useRecomendadosDaLoja(active);
  useEffect(() => {
    ultimo = lidos;
  });
  return null;
}

let hospedeiro: HTMLDivElement;
let raiz: Root;
async function montar(active: boolean) {
  await act(async () => {
    raiz.render(<Sonda active={active} />);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  buscarConfiguracaoDeFrete.mockReset();
  buscarConfiguracaoDeFrete.mockResolvedValue({
    ok: true,
    config: { modo: "multi", ligados: [], provedores: new Map() },
  });
  recarregar.mockReset();
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => {
    raiz.unmount();
  });
  hospedeiro.remove();
  vi.useRealTimers();
});

describe("useRecomendadosDaLoja — o limite exato dos 30 s", () => {
  it("voltar à vista com 29,999 s não relê; com exatamente 30 s relê o e-mail e o frete", async () => {
    await montar(true);
    expect(buscarConfiguracaoDeFrete).toHaveBeenCalledTimes(1);
    expect(ultimo.nomesLigados).toEqual([]);

    await montar(false);
    vi.advanceTimersByTime(29_999);
    await montar(true);
    expect(buscarConfiguracaoDeFrete).toHaveBeenCalledTimes(1);
    expect(recarregar).not.toHaveBeenCalled();

    await montar(false);
    vi.advanceTimersByTime(1);
    await montar(true);
    expect(buscarConfiguracaoDeFrete).toHaveBeenCalledTimes(2);
    expect(recarregar).toHaveBeenCalledTimes(1);
  });
});
