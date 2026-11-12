// @vitest-environment jsdom
//
// Recomendados da loja (Início): duas consultas das transportadoras em voo ao
// mesmo tempo. A resposta ANTIGA (consulta A) que chega depois da NOVA (B) não
// pode sobrescrever o que B já entregou — senão o aviso "Ligar uma
// transportadora" reapareceria com informação velha. É a guarda
// `minha !== leituraDaVez.current` do hook; o teste de leituras nunca deixa
// duas consultas pendentes, então nada cobria essa ordem inversa.
import type { ProvedorFrete } from "@/components/admin/settings/TransportadorasCard";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const buscarConfiguracaoDeFrete = vi.fn();
const recarregar = vi.fn();

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

const { useRecomendadosDaLoja } = await import("@/hooks/useRecomendadosDaLoja");

type Lidos = ReturnType<typeof useRecomendadosDaLoja>;
let ultimo: Lidos;

function Sonda({ active }: Readonly<{ active?: boolean }>) {
  const lidos = useRecomendadosDaLoja(active);
  useEffect(() => {
    ultimo = lidos;
  });
  return null;
}

let hospedeiro: HTMLDivElement;
let raiz: Root;

async function montar(active?: boolean) {
  await act(async () => {
    raiz.render(<Sonda active={active} />);
  });
}

const resposta = (
  ligados: ProvedorFrete[],
  provedores: [ProvedorFrete, Record<string, unknown>][],
) => ({
  ok: true,
  config: {
    modo: "multi",
    ligados,
    provedores: new Map(provedores),
  },
});

const nenhumaLigada = () => resposta([], []);
const melhorEnvioLigada = () =>
  resposta(
    ["melhor_envio"],
    [["melhor_envio", { tem_chave: true, sandbox: false, servicos: null }]],
  );

/** Promessa que o teste resolve na hora que quiser (consulta "em voo"). */
function consultaSegura() {
  let resolver!: (valor: unknown) => void;
  const promessa = new Promise((resolve) => {
    resolver = resolve;
  });
  return { promessa, resolver };
}

async function responder(resolver: (valor: unknown) => void, valor: unknown) {
  await act(async () => {
    resolver(valor);
  });
}

/** Dispara A (segura) e, passados mais de 30 s fora de vista, B (segura). */
async function dispararAeB() {
  const a = consultaSegura();
  const b = consultaSegura();
  buscarConfiguracaoDeFrete
    .mockReturnValueOnce(a.promessa)
    .mockReturnValueOnce(b.promessa);
  await montar(true);
  expect(buscarConfiguracaoDeFrete).toHaveBeenCalledTimes(1);
  await montar(false);
  vi.advanceTimersByTime(31_000);
  await montar(true);
  expect(buscarConfiguracaoDeFrete).toHaveBeenCalledTimes(2);
  return { a, b };
}

beforeEach(() => {
  vi.useFakeTimers();
  buscarConfiguracaoDeFrete.mockReset();
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

describe("useRecomendadosDaLoja — duas consultas em voo", () => {
  it("resposta ANTIGA (nenhuma ligada) que chega depois da NOVA não a sobrescreve", async () => {
    const { a, b } = await dispararAeB();
    expect(ultimo.nomesLigados).toBeNull();

    await responder(b.resolver, melhorEnvioLigada());
    expect(ultimo.nomesLigados).toEqual(["Melhor Envio"]);

    await responder(a.resolver, nenhumaLigada());
    expect(ultimo.nomesLigados).toEqual(["Melhor Envio"]);
  });

  it("controle: na ordem normal (A e depois B) a lista final é a de B", async () => {
    const { a, b } = await dispararAeB();

    // A já nasceu velha (B saiu depois): descartada, nada muda até B responder.
    await responder(a.resolver, nenhumaLigada());
    expect(ultimo.nomesLigados).toBeNull();

    await responder(b.resolver, melhorEnvioLigada());
    expect(ultimo.nomesLigados).toEqual(["Melhor Envio"]);
  });
});
