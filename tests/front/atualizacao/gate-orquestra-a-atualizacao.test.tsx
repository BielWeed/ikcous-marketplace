// @vitest-environment jsdom
//
// O PWAUpdateGate ORQUESTRA a atualização (não desenha nada). Aqui:
//   · o VETO LOCAL por aba: quando o service worker novo assume (onNeedReload
//     do plugin), esta aba só recarrega num momento seguro, e grava a SUA
//     origem antes;
//   · a versão obrigatória (minAppVersion): ponto de parada satisfeito no boot,
//     mas com os vetos de pagamento/venda valendo;
//   · o estado público (aguardando/instalando) que a ilha lê;
//   · a limpeza ao desmontar.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: null }),
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
import { JANELA_DE_CONSULTA_MS } from "@/lib/atualizacao/coordenacao-entre-abas";
import {
  definirEstadoDaAtualizacao,
  obterEstadoDaAtualizacao,
} from "@/lib/atualizacao/estado-da-atualizacao";
import { GRACA_DE_INICIALIZACAO_MS } from "@/lib/atualizacao/instalador";
import { marcarOperacaoSensivel } from "@/lib/atualizacao/operacao-sensivel";
import {
  limparRecargaPendente,
  marcarRecargaPendente,
} from "@/lib/atualizacao/recarga-pendente";
import {
  CHAVE_MOTIVO_DE_RECARGA,
  CHAVE_ORIGEM_DE_ATUALIZACAO,
} from "@/lib/motivo-de-recarga";
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

describe("PWAUpdateGate orquestra a atualização", () => {
  let container: HTMLDivElement;
  let root: Root;
  let aplicar: ReturnType<typeof vi.fn>;
  let recarregar: ReturnType<typeof vi.fn>;

  function hook(parcial: Record<string, unknown> = {}) {
    useUpdateCheckMock.mockReturnValue({
      checkUpdate: vi.fn(),
      updateAvailable: false,
      newVersion: null,
      isMandatory: false,
      performNuclearPurge: aplicar,
      ...parcial,
    });
  }

  function montar(view: string, adminDirty = false) {
    act(() => {
      root.render(
        <PWAUpdateManager currentView={view as View} adminDirty={adminDirty} />,
      );
    });
  }
  async function esperar(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }
  const passarAGraca = () => esperar(GRACA_DE_INICIALIZACAO_MS + 100);
  async function navegarPara(view: string, adminDirty = false) {
    montar(view, adminDirty);
    await esperar(JANELA_DE_CONSULTA_MS + 50);
  }

  beforeEach(() => {
    vi.useFakeTimers();
    local.clear();
    sessao.clear();
    vi.stubGlobal("localStorage", stub(local));
    vi.stubGlobal("sessionStorage", stub(sessao));
    vi.stubGlobal("BroadcastChannel", undefined);
    limparRecargaPendente();
    definirEstadoDaAtualizacao({ fase: "nenhuma", versaoNova: null });
    recarregar = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, reload: recarregar },
    });
    aplicar = vi.fn();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    limparRecargaPendente();
    definirEstadoDaAtualizacao({ fase: "nenhuma", versaoNova: null });
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe("estado público", () => {
    it("update esperando: 'aguardando' com a versão limpa; ao instalar: 'instalando'", async () => {
      hook({ updateAvailable: true, newVersion: "1.32.0-sha.2526bdd" });
      montar("home");
      expect(obterEstadoDaAtualizacao()).toEqual({
        fase: "aguardando",
        versaoNova: "1.32.0",
      });
      await passarAGraca();
      await navegarPara("favorites");
      expect(aplicar).toHaveBeenCalledTimes(1);
      expect(obterEstadoDaAtualizacao().fase).toBe("instalando");
      expect(obterEstadoDaAtualizacao().versaoNova).toBe("1.32.0");
    });

    it("sem update: a fase continua 'nenhuma'", async () => {
      hook({ updateAvailable: false });
      montar("home");
      await passarAGraca();
      expect(obterEstadoDaAtualizacao().fase).toBe("nenhuma");
    });

    it("desmontar o gate solta a fase (não deixa 'aguardando' fantasma para a ilha)", () => {
      hook({ updateAvailable: true, newVersion: "1.32.0" });
      montar("home");
      expect(obterEstadoDaAtualizacao().fase).toBe("aguardando");
      act(() => root.unmount());
      expect(obterEstadoDaAtualizacao().fase).toBe("nenhuma");
      expect(vi.getTimerCount()).toBe(0);
      root = createRoot(container);
    });

    it("a fase 'concluida' (do boot, Onda 2) não é pisada pelo gate", async () => {
      hook({ updateAvailable: false });
      montar("home");
      definirEstadoDaAtualizacao({ fase: "concluida" });
      await passarAGraca();
      expect(obterEstadoDaAtualizacao().fase).toBe("concluida");
    });
  });

  describe("veto local: o service worker novo assumiu (onNeedReload)", () => {
    it("a aba NÃO recarrega na hora, no meio de uma tela parada", async () => {
      hook({ updateAvailable: false });
      montar("home");
      await passarAGraca();
      act(() => marcarRecargaPendente());
      await esperar(60_000);
      expect(recarregar).not.toHaveBeenCalled();
      expect(aplicar).not.toHaveBeenCalled(); // o SW já assumiu: não se aciona de novo
    });

    it("recarrega no próximo ponto de parada seguro, gravando a SUA origem e o motivo", async () => {
      hook({ updateAvailable: false });
      montar("home");
      await passarAGraca();
      act(() => marcarRecargaPendente());
      await navegarPara("favorites");
      expect(recarregar).toHaveBeenCalledTimes(1);
      expect(sessao.get(CHAVE_ORIGEM_DE_ATUALIZACAO)).toBe("1.31.0-sha.abcdef");
      expect(local.get(CHAVE_MOTIVO_DE_RECARGA)).toBe("atualizacao-aplicada");
      expect(aplicar).not.toHaveBeenCalled();
    });

    it("o SW já assumiu: a aba recarrega MESMO com a trava de tentativas esgotada e sem gastar tentativa (a trava é do 'acionar', não do 'recarregar')", async () => {
      local.set(
        "pwa_atualizacao_tentativas",
        JSON.stringify({
          alvo: "desconhecida-de-1.31.0-sha.abcdef",
          count: 2,
          ultimaEm: 1,
        }),
      );
      hook({ updateAvailable: true, newVersion: null });
      montar("home");
      await passarAGraca();
      act(() => marcarRecargaPendente());
      await navegarPara("favorites");
      expect(recarregar).toHaveBeenCalledTimes(1);
      expect(
        JSON.parse(local.get("pwa_atualizacao_tentativas") ?? "{}").count,
      ).toBe(2);
      expect(local.get("pwa_instalando")).toBeUndefined();
    });

    it("com a aba no CHECKOUT, ADIA — mesmo trocando de tela até lá e com o app em segundo plano", async () => {
      hook({ updateAvailable: false });
      montar("home");
      await passarAGraca();
      act(() => marcarRecargaPendente());
      await navegarPara("checkout");
      vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
      await act(async () => {
        document.dispatchEvent(new Event("visibilitychange"));
        await vi.advanceTimersByTimeAsync(JANELA_DE_CONSULTA_MS + 50);
      });
      expect(recarregar).not.toHaveBeenCalled();
    });

    it("...e recarrega quando a compra acaba e a pessoa troca de tela (controle)", async () => {
      hook({ updateAvailable: false });
      montar("home");
      await passarAGraca();
      act(() => marcarRecargaPendente());
      await navegarPara("checkout");
      expect(recarregar).not.toHaveBeenCalled();
      await navegarPara("home");
      expect(recarregar).toHaveBeenCalledTimes(1);
    });

    it("com PDV sujo ou operação sensível, ADIA", async () => {
      hook({ updateAvailable: false });
      montar("admin-pdv", true);
      await passarAGraca();
      act(() => marcarRecargaPendente());
      await navegarPara("admin-orders", true);
      expect(recarregar).not.toHaveBeenCalled();

      const desmarcar = marcarOperacaoSensivel("upload-de-imagem");
      await navegarPara("admin-dashboard", false);
      expect(recarregar).not.toHaveBeenCalled();
      desmarcar();
      await navegarPara("admin-orders", false);
      expect(recarregar).toHaveBeenCalledTimes(1);
    });

    it("aba que já estava em segundo plano quando o SW assumiu recarrega logo (passada a graça)", async () => {
      hook({ updateAvailable: false });
      montar("home");
      await passarAGraca();
      vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
      await act(async () => {
        marcarRecargaPendente();
        await vi.advanceTimersByTimeAsync(JANELA_DE_CONSULTA_MS + 50);
      });
      expect(recarregar).toHaveBeenCalledTimes(1);
    });
  });

  describe("versão mínima obrigatória (minAppVersion)", () => {
    it("no boot, em tela segura: o ponto de parada já está satisfeito — instala sozinho depois da graça", async () => {
      hook({ updateAvailable: true, isMandatory: true });
      montar("home");
      await passarAGraca();
      expect(aplicar).toHaveBeenCalledTimes(1);
    });

    it("no boot DENTRO do checkout: NÃO corta o pagamento; instala quando a pessoa sai", async () => {
      hook({ updateAvailable: true, isMandatory: true });
      montar("checkout");
      await passarAGraca();
      expect(aplicar).not.toHaveBeenCalled();
      await navegarPara("home");
      expect(aplicar).toHaveBeenCalledTimes(1);
    });

    it("no boot com PDV sujo: NÃO corta a venda", async () => {
      hook({ updateAvailable: true, isMandatory: true });
      montar("admin-pdv", true);
      await passarAGraca();
      expect(aplicar).not.toHaveBeenCalled();
    });

    it("no boot com operação sensível em andamento: NÃO instala", async () => {
      const desmarcar = marcarOperacaoSensivel("fila-offline");
      hook({ updateAvailable: true, isMandatory: true });
      montar("home");
      await passarAGraca();
      expect(aplicar).not.toHaveBeenCalled();
      desmarcar();
    });

    it("a trava de tentativas vale também para a versão obrigatória: o apply que falha 2x desiste", async () => {
      aplicar.mockImplementation(() => {
        throw new Error("a purga não pegou");
      });
      hook({ updateAvailable: true, isMandatory: true, newVersion: "2.0.0" });
      montar("home");
      await passarAGraca();
      expect(aplicar).toHaveBeenCalledTimes(1);
      await navegarPara("favorites");
      expect(aplicar).toHaveBeenCalledTimes(2);
      await navegarPara("home");
      expect(aplicar).toHaveBeenCalledTimes(2); // desistiu em silêncio
      expect(obterEstadoDaAtualizacao().fase).toBe("nenhuma");
    });
  });

  describe("teto por build de origem (a chave do alvo muda; a origem não)", () => {
    it("com 2 tentativas já gastas saindo DESTE build, um alvo NOVO e virgem não instala (o gate passa a origem à trava)", async () => {
      local.set(
        "pwa_atualizacao_tentativas_origem",
        JSON.stringify({
          origem: "1.31.0-sha.abcdef",
          count: 2,
          primeiraEm: Date.now(),
          ultimaEm: Date.now(),
        }),
      );
      hook({ updateAvailable: true, newVersion: "9.9.9-sha.novo" });
      montar("home");
      await passarAGraca();
      await navegarPara("favorites");
      await navegarPara("home");
      expect(aplicar).not.toHaveBeenCalled();
      expect(local.get("pwa_instalando")).toBeUndefined();
      expect(obterEstadoDaAtualizacao().fase).toBe("nenhuma");
    });

    it("controle: origem DIFERENTE esgotada não impede este build de tentar", async () => {
      local.set(
        "pwa_atualizacao_tentativas_origem",
        JSON.stringify({
          origem: "1.20.0-sha.velho",
          count: 2,
          primeiraEm: Date.now(),
          ultimaEm: Date.now(),
        }),
      );
      hook({ updateAvailable: true, newVersion: "9.9.9-sha.novo" });
      montar("home");
      await passarAGraca();
      await navegarPara("favorites");
      expect(aplicar).toHaveBeenCalledTimes(1);
    });
  });

  describe("o apply que falha não prende a fase", () => {
    it("performNuclearPurge que REJEITA: a fase volta a 'aguardando'", async () => {
      aplicar.mockImplementation(() => Promise.reject(new Error("sem rede")));
      hook({ updateAvailable: true, newVersion: "1.32.0" });
      montar("home");
      await passarAGraca();
      await navegarPara("favorites");
      await esperar(0);
      expect(aplicar).toHaveBeenCalledTimes(1);
      expect(obterEstadoDaAtualizacao().fase).toBe("aguardando");
    });
  });
});
