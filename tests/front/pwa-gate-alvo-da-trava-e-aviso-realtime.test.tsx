// @vitest-environment jsdom
//
// Duas ligações do PWAUpdateGate que nenhum teste provava (achadas por mutação):
//   · a chave da trava de tentativas é a versão-alvo que o servidor disse (e,
//     sem ela, "desconhecida-de-<versão instalada>"), e a origem é a versão
//     instalada — é isso que impede alternar de alvo para ganhar tentativas;
//   · o aviso em tempo real chega ao `checkUpdate` com a versão que veio nele,
//     e o canal é aberto para a pessoa logada.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "usuaria-123" } }),
}));

const useUpdateCheckMock = vi.fn();
vi.mock("@/hooks/useUpdateCheck", () => ({
  useUpdateCheck: () => useUpdateCheckMock(),
}));

vi.mock("@/hooks/useRealtimeUpdate", () => ({
  useRealtimeUpdate: vi.fn(),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.hoisted(() => {
  (globalThis as Record<string, unknown>).__APP_VERSION__ = "1.31.0-sha.abcdef";
});

import { PWAUpdateManager } from "@/components/pwa/PWAUpdateGate";
import { useRealtimeUpdate } from "@/hooks/useRealtimeUpdate";
import { JANELA_DE_CONSULTA_MS } from "@/lib/atualizacao/coordenacao-entre-abas";
import { definirEstadoDaAtualizacao } from "@/lib/atualizacao/estado-da-atualizacao";
import { GRACA_DE_INICIALIZACAO_MS } from "@/lib/atualizacao/instalador";
import {
  CHAVE_DA_TRAVA_DE_ATUALIZACAO,
  CHAVE_DA_TRAVA_POR_ORIGEM,
} from "@/lib/atualizacao/trava-anti-repeticao";
import type { View } from "@/types";

const local = new Map<string, string>();
const sessao = new Map<string, string>();
const stub = (m: Map<string, string>) => ({
  getItem: (k: string) => m.get(k) ?? null,
  setItem: (k: string, v: string) => {
    m.set(k, String(v));
  },
  removeItem: (k: string) => {
    m.delete(k);
  },
  get length() {
    return m.size;
  },
  key: (i: number) => Array.from(m.keys()).at(i) ?? null,
});

const VERSAO_INSTALADA = "1.31.0-sha.abcdef";

describe("PWAUpdateGate — trava e aviso em tempo real", () => {
  let container: HTMLDivElement;
  let root: Root;
  let aplicar: ReturnType<typeof vi.fn>;
  let checkUpdate: ReturnType<typeof vi.fn>;

  function hook(parcial: Record<string, unknown> = {}) {
    useUpdateCheckMock.mockReturnValue({
      checkUpdate,
      updateAvailable: false,
      newVersion: null,
      isMandatory: false,
      performNuclearPurge: aplicar,
      ...parcial,
    });
  }
  function montar(view: string) {
    act(() => {
      root.render(<PWAUpdateManager currentView={view as View} />);
    });
  }
  async function esperar(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }
  function lerJson(chave: string): Record<string, unknown> {
    return JSON.parse(local.get(chave) ?? "{}") as Record<string, unknown>;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    local.clear();
    sessao.clear();
    vi.stubGlobal("localStorage", stub(local));
    vi.stubGlobal("sessionStorage", stub(sessao));
    vi.stubGlobal("BroadcastChannel", undefined);
    definirEstadoDaAtualizacao({ fase: "nenhuma", versaoNova: null });
    aplicar = vi.fn();
    checkUpdate = vi.fn();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    definirEstadoDaAtualizacao({ fase: "nenhuma", versaoNova: null });
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe("chave da trava de tentativas", () => {
    async function instalarNumaTrocaDeTela() {
      montar("home");
      await esperar(GRACA_DE_INICIALIZACAO_MS + 100);
      montar("favorites");
      await esperar(JANELA_DE_CONSULTA_MS + 50);
      expect(aplicar).toHaveBeenCalledTimes(1);
    }

    it("com a versão do servidor conhecida, ela é o alvo e a versão instalada é a origem", async () => {
      hook({ updateAvailable: true, newVersion: "1.32.0-sha.2526bdd" });
      await instalarNumaTrocaDeTela();

      expect(lerJson(CHAVE_DA_TRAVA_DE_ATUALIZACAO)).toMatchObject({
        alvo: "1.32.0-sha.2526bdd",
        count: 1,
      });
      expect(lerJson(CHAVE_DA_TRAVA_POR_ORIGEM)).toMatchObject({
        origem: VERSAO_INSTALADA,
        count: 1,
      });
    });

    it("sem versão do servidor, o alvo é 'desconhecida-de-<instalada>' (nunca vazio)", async () => {
      hook({ updateAvailable: true, newVersion: null });
      await instalarNumaTrocaDeTela();

      expect(lerJson(CHAVE_DA_TRAVA_DE_ATUALIZACAO)).toMatchObject({
        alvo: `desconhecida-de-${VERSAO_INSTALADA}`,
        count: 1,
      });
    });
  });

  describe("aviso em tempo real", () => {
    function ouvinte() {
      const chamadas = vi.mocked(useRealtimeUpdate).mock.calls;
      const ultima = chamadas.at(-1);
      if (!ultima) throw new Error("useRealtimeUpdate não foi chamado");
      return ultima;
    }

    it("abre o canal para a pessoa logada", () => {
      hook();
      montar("home");
      expect(ouvinte()[1]).toBe("usuaria-123");
    });

    it("a versão que veio no aviso chega ao checkUpdate", () => {
      hook();
      montar("home");
      const [aoReceber] = ouvinte();

      aoReceber("1.5.40-sha.nova");

      expect(checkUpdate).toHaveBeenCalledExactlyOnceWith("1.5.40-sha.nova");
    });

    it("aviso sem versão chama o checkUpdate sem versão (a leitura vai ao servidor)", () => {
      hook();
      montar("home");
      const [aoReceber] = ouvinte();

      aoReceber();

      expect(checkUpdate).toHaveBeenCalledExactlyOnceWith(undefined);
    });
  });
});
