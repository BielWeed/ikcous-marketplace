// @vitest-environment jsdom
//
// O "Ao vivo" do cabeçalho do Início diz a verdade sobre a conexão, e a ORDEM
// dos avisos é o que decide qual verdade aparece quando duas são verdadeiras
// ao mesmo tempo: sem internet ganha de tudo; atualizando ganha de falha;
// falha ganha de lento; só então "Ao vivo · lento", e "Ao vivo" quando nada
// está errado. Antes, nenhum teste prendia a ordem nem a medição "lenta"
// (caça por mutação, 24/11/2026).
import {
  type EstadoDeOperacao,
  EstadoDeOperacaoProvider,
} from "@/components/admin/PontoDeOperacao";
import { EstadoDaConexao } from "@/components/admin/inicio/EstadoDaConexao";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let raiz: Root;
let hospedeiro: HTMLDivElement;

const medicao = (quality: EstadoDeOperacao["quality"]): EstadoDeOperacao => ({
  isOffline: quality === "offline",
  quality,
  latency: 0,
  showSyncFlash: false,
});

async function montar(
  props: { offline: boolean; carregando: boolean; falhou: boolean },
  qualidade?: EstadoDeOperacao["quality"],
) {
  await act(async () => {
    raiz.render(
      qualidade ? (
        <EstadoDeOperacaoProvider value={medicao(qualidade)}>
          <EstadoDaConexao {...props} />
        </EstadoDeOperacaoProvider>
      ) : (
        <EstadoDaConexao {...props} />
      ),
    );
  });
}

function leitura() {
  const visivel = Array.from(hospedeiro.querySelectorAll("span:not(.sr-only)"))
    .map((s) => s.textContent ?? "")
    .find((t) => t.trim().length > 0);
  return {
    visivel: visivel?.trim(),
    falado: hospedeiro.querySelector(".sr-only")?.textContent,
  };
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.unstubAllGlobals();
});

describe("EstadoDaConexao: qual aviso vence quando há mais de um", () => {
  it("nada errado: 'Ao vivo' e, para o leitor de tela, 'conectado'", async () => {
    await montar({ offline: false, carregando: false, falhou: false });
    expect(leitura()).toEqual({ visivel: "Ao vivo", falado: " · conectado" });
    expect(hospedeiro.querySelector('[role="status"]')).not.toBeNull();
  });

  it("sem internet ganha de atualizando, de falha e de conexão lenta", async () => {
    await montar({ offline: true, carregando: true, falhou: true }, "slow");
    expect(leitura().visivel).toBe("Sem internet");
    expect(leitura().falado).toContain("desatualizados");
  });

  it("atualizando ganha de falha e de conexão lenta", async () => {
    await montar({ offline: false, carregando: true, falhou: true }, "slow");
    expect(leitura()).toEqual({
      visivel: "Atualizando",
      falado: " sua loja",
    });
  });

  it("falha ao atualizar ganha de conexão lenta: não diz 'ao vivo' com número velho", async () => {
    await montar({ offline: false, carregando: false, falhou: true }, "slow");
    expect(leitura().visivel).toBe("Sem atualizar");
    expect(leitura().falado).toContain("não foi possível atualizar");
  });

  it("só a medição lenta (sem nada mais) diz 'Ao vivo · lento'", async () => {
    await montar({ offline: false, carregando: false, falhou: false }, "slow");
    expect(leitura()).toEqual({
      visivel: "Ao vivo · lento",
      falado: " · conexão lenta",
    });
  });

  it("conexão boa, excelente, ou sem medição: nada de 'lento'", async () => {
    for (const qualidade of ["good", "excellent"] as const) {
      await montar(
        { offline: false, carregando: false, falhou: false },
        qualidade,
      );
      expect(leitura().visivel).toBe("Ao vivo");
    }
    await montar({ offline: false, carregando: false, falhou: false });
    expect(leitura().visivel).toBe("Ao vivo");
  });
});
