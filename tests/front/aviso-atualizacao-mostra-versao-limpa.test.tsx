// @vitest-environment jsdom
//
// DEFEITO A da peça "tela de atualização" (dono, 14/09): o selo "de → para" do
// aviso de atualização mostrava CÓDIGO ESTRANHO no lugar da versão (os últimos
// 6 caracteres do build, o hash). Reescrito em 16/10/2026 para o desenho da
// atualização única: o aviso agora é a ilha, que lê `versaoNova` do ESTADO da
// atualização — e o contrato de proteção é o mesmo:
//   · a versão do estado é o NÚCLEO semver limpo (nunca `526bdd`);
//   · versão ilegível (ex.: `binary-v24`, valor inventado do realtime) → NÃO
//     há versão (nulo), nunca um fragmento estranho;
//   · build novo com o MESMO núcleo semver → nulo: sem a seta mentirosa
//     "1.31.0 → 1.31.0".
//
// Molde: update-nao-interrompe-checkout.test.tsx (mesmos mocks).
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

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros testes de componente deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// O gate lê a versão UMA vez, no nível do módulo — o valor precisa existir
// ANTES do import. Imita a forma REAL da produção: núcleo + sufixo de hash.
vi.hoisted(() => {
  (globalThis as Record<string, unknown>).__APP_VERSION__ = "1.31.0-sha.abcdef";
});

import { PWAUpdateManager } from "@/components/pwa/PWAUpdateGate";
import {
  definirEstadoDaAtualizacao,
  obterEstadoDaAtualizacao,
} from "@/lib/atualizacao/estado-da-atualizacao";
import type { View } from "@/types";

const memoria = new Map<string, string>();
const stub = () => ({
  getItem: (k: string) => memoria.get(k) ?? null,
  setItem: (k: string, v: string) => {
    memoria.set(k, String(v));
  },
  removeItem: (k: string) => {
    memoria.delete(k);
  },
  get length() {
    return memoria.size;
  },
  key: (i: number) => Array.from(memoria.keys()).at(i) ?? null,
});

describe("a versão da atualização é limpa, nunca um código estranho", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    memoria.clear();
    vi.stubGlobal("localStorage", stub());
    vi.stubGlobal("sessionStorage", stub());
    vi.stubGlobal("BroadcastChannel", undefined);
    definirEstadoDaAtualizacao({ fase: "nenhuma", versaoNova: null });
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
    vi.clearAllMocks();
  });

  function montarComVersao(newVersion: string | null) {
    useUpdateCheckMock.mockReturnValue({
      checkUpdate: vi.fn(),
      updateAvailable: true,
      newVersion,
      isMandatory: false,
      performNuclearPurge: vi.fn(),
    });
    act(() => {
      root.render(<PWAUpdateManager currentView={"admin-dashboard" as View} />);
    });
  }

  it("`1.32.0-sha.2526bdd` vira `1.32.0` no estado, NUNCA o fragmento do hash", () => {
    montarComVersao("1.32.0-sha.2526bdd");
    const estado = obterEstadoDaAtualizacao();
    expect(estado.fase).toBe("aguardando");
    expect(estado.versaoNova).toBe("1.32.0");
    expect(JSON.stringify(estado)).not.toContain("526bdd");
    expect(JSON.stringify(estado)).not.toContain("abcdef");
  });

  it("versão ilegível do realtime (binary-v24) → NÃO há versão, sem inventar código", () => {
    montarComVersao("binary-v24");
    const estado = obterEstadoDaAtualizacao();
    expect(estado.fase).toBe("aguardando"); // a atualização existe; a versão não é legível
    expect(estado.versaoNova).toBeNull();
    expect(JSON.stringify(estado)).not.toContain("binary");
  });

  it("build novo com o MESMO núcleo semver → sem versão: nada de '1.31.0 → 1.31.0'", () => {
    // Peça 22/09: deploy de build novo (sha diferente) na MESMA release
    // (1.31.0). De→para igual é enganação — a atualização segue, a versão não.
    montarComVersao("1.31.0-sha.999999");
    const estado = obterEstadoDaAtualizacao();
    expect(estado.fase).toBe("aguardando");
    expect(estado.versaoNova).toBeNull();
  });

  it("controle: sem newVersion, a atualização existe e a versão é nula", () => {
    montarComVersao(null);
    const estado = obterEstadoDaAtualizacao();
    expect(estado.fase).toBe("aguardando");
    expect(estado.versaoNova).toBeNull();
  });

  it("a versão esperada gravada para o boot é o NÚCLEO (o boot compara núcleo com núcleo)", async () => {
    vi.useFakeTimers();
    try {
      const aplicar = vi.fn();
      useUpdateCheckMock.mockReturnValue({
        checkUpdate: vi.fn(),
        updateAvailable: true,
        newVersion: "1.32.0-sha.2526bdd",
        isMandatory: false,
        performNuclearPurge: aplicar,
      });
      act(() => {
        root.render(<PWAUpdateManager currentView={"home" as View} />);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(9000);
      });
      act(() => {
        root.render(<PWAUpdateManager currentView={"favorites" as View} />);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(400);
      });
      expect(aplicar).toHaveBeenCalledTimes(1);
      expect(memoria.get("pwa_update_expected_version")).toBe("1.32.0");
    } finally {
      vi.useRealTimers();
    }
  });
});
