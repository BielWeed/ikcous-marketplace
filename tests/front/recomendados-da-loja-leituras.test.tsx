// @vitest-environment jsdom
//
// As duas leituras que alimentam os passos recomendados do Início (30/10/2026):
// o status do e-mail e as transportadoras ligadas. Provas: é a MESMA leitura que
// Ajustes e Frete fazem (nenhuma consulta nova), não lê com a aba fora de vista,
// repete ao voltar só depois de 30 s, leitura que falha vira "não sei" (null)
// e a régua de "transportadora ligada" é a do Frete.
import type { ProvedorFrete } from "@/components/admin/settings/TransportadorasCard";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const buscarConfiguracaoDeFrete = vi.fn();
const recarregar = vi.fn();
let estadoDoEmail: { carga: string; status: unknown } = {
  carga: "pronto",
  status: null,
};

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
  useEmailDaLoja: () => ({ ...estadoDoEmail, recarregar }),
}));

const { nomesDasTransportadorasLigadas } = await import(
  "@/components/admin/settings/TransportadorasCard"
);
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

beforeEach(() => {
  vi.useFakeTimers();
  buscarConfiguracaoDeFrete.mockReset();
  recarregar.mockReset();
  estadoDoEmail = { carga: "pronto", status: null };
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

describe("useRecomendadosDaLoja", () => {
  it("lê as transportadoras uma vez ao montar à vista e entrega os nomes ligados", async () => {
    buscarConfiguracaoDeFrete.mockResolvedValue(
      resposta(
        ["melhor_envio"],
        [["melhor_envio", { tem_chave: true, sandbox: false, servicos: null }]],
      ),
    );
    await montar(true);
    expect(buscarConfiguracaoDeFrete).toHaveBeenCalledTimes(1);
    expect(ultimo.nomesLigados).toEqual(["Melhor Envio"]);
    // O e-mail já se lê sozinho ao montar: o hook não repete a leitura.
    expect(recarregar).not.toHaveBeenCalled();
  });

  it("aba fora de vista (active=false): não lê nada", async () => {
    await montar(false);
    expect(buscarConfiguracaoDeFrete).not.toHaveBeenCalled();
    expect(ultimo.nomesLigados).toBeNull();
  });

  it("leitura que falha vira 'não sei' (null), nunca lista vazia", async () => {
    buscarConfiguracaoDeFrete.mockResolvedValue({ ok: false });
    await montar(true);
    expect(ultimo.nomesLigados).toBeNull();
  });

  it("ao voltar à vista: repete só depois de 30 s", async () => {
    buscarConfiguracaoDeFrete.mockResolvedValue(resposta([], []));
    await montar(true);
    await montar(false);
    await montar(true);
    expect(buscarConfiguracaoDeFrete).toHaveBeenCalledTimes(1);
    expect(recarregar).not.toHaveBeenCalled();

    await montar(false);
    vi.advanceTimersByTime(31_000);
    await montar(true);
    expect(buscarConfiguracaoDeFrete).toHaveBeenCalledTimes(2);
    expect(recarregar).toHaveBeenCalledTimes(1);
  });

  it("e-mail sem remetente vira 'nao_configurado'; leitura indisponível, 'desconhecido'", async () => {
    buscarConfiguracaoDeFrete.mockResolvedValue(resposta([], []));
    estadoDoEmail = {
      carga: "pronto",
      status: {
        usuario: null,
        senhaGuardada: false,
        ultimoTeste: null,
        origem: "nenhuma",
        cofrePronto: true,
        registroIlegivel: false,
        falha: null,
      },
    };
    await montar(true);
    expect(ultimo.email).toBe("nao_configurado");

    estadoDoEmail = { carga: "indisponivel", status: null };
    await montar(true);
    expect(ultimo.email).toBe("desconhecido");
  });
});

describe("nomesDasTransportadorasLigadas — a régua do Frete", () => {
  const completa = { tem_chave: true, sandbox: false, servicos: null };

  it("ligada com chave: conta", () => {
    expect(
      nomesDasTransportadorasLigadas({
        ligados: ["melhor_envio"],
        provedores: new Map([["melhor_envio", completa]]),
      }),
    ).toEqual(["Melhor Envio"]);
  });

  it("ligada sem chave salva: não conta", () => {
    expect(
      nomesDasTransportadorasLigadas({
        ligados: ["frenet"],
        provedores: new Map([["frenet", { ...completa, tem_chave: false }]]),
      }),
    ).toEqual([]);
  });

  it("SuperFrete sem e-mail de contato válido: incompleta, não conta", () => {
    expect(
      nomesDasTransportadorasLigadas({
        ligados: ["superfrete"],
        provedores: new Map([["superfrete", completa]]),
      }),
    ).toEqual([]);
    expect(
      nomesDasTransportadorasLigadas({
        ligados: ["superfrete"],
        provedores: new Map([
          ["superfrete", { ...completa, contato_email: "a@loja.com.br" }],
        ]),
      }),
    ).toEqual(["SuperFrete"]);
  });

  it("chave salva mas desligada: não conta", () => {
    expect(
      nomesDasTransportadorasLigadas({
        ligados: [],
        provedores: new Map([["melhor_envio", completa]]),
      }),
    ).toEqual([]);
  });
});
