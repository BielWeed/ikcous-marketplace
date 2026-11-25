// @vitest-environment jsdom
//
// Caça por mutação em `src/pwa-sentinel.ts` (25/11/2026), a recuperação do
// pulso perdido. Os testes vizinhos provam QUE o worker novo é chamado e que o
// desregistro é o último recurso, mas deixavam passar duas trocas:
//
//   1. o prazo que o worker novo tem para assumir (2,5 s) mudar ou sumir
//      (`prazoMs: 0` faria o sentinela desistir do caminho gentil na hora e
//      desregistrar um service worker que ia assumir sozinho);
//   2. um desregistro que FALHA virar exceção: `throw e` no lugar do aviso
//      derrubava a recuperação inteira — o registro seguinte não era
//      desregistrado e a página nunca recarregava, justo quando o sentinela
//      existe para tirar a cliente de um service worker travado.
//
// A recuperação em si (chave única, veto de gravação, waiting pronto) já tem
// teste próprio; aqui os vizinhos são dublados só para olhar o que o sentinela
// PEDE a eles.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dobles = vi.hoisted(() => ({
  assumir: vi.fn(async (_opcoes: unknown) => false),
  recarregarSeSeguro: vi.fn((acao: () => void) => acao()),
  gravaMotivo: vi.fn(),
}));

vi.mock("@/lib/recuperacao-chunk", () => ({
  assumirServiceWorkerNovoERecarregar: dobles.assumir,
  pedirRecargaSubordinada: () => true,
}));
vi.mock("@/lib/atualizacao/veto-de-recarga", () => ({
  momentoSeguroAgora: () => true,
  recarregarSeSeguro: dobles.recarregarSeSeguro,
}));
vi.mock("@/lib/motivo-de-recarga", () => ({
  gravaMotivoDeRecarga: dobles.gravaMotivo,
}));

import { initSentinel, recuperarPulsoPerdido } from "@/pwa-sentinel";

const reload = vi.fn();
let aviso: ReturnType<typeof vi.spyOn>;

function registro(unregister: () => Promise<boolean>) {
  return {
    unregister: vi.fn(unregister),
  } as unknown as ServiceWorkerRegistration & {
    unregister: ReturnType<typeof vi.fn>;
  };
}

beforeEach(() => {
  dobles.assumir.mockClear();
  dobles.recarregarSeSeguro.mockClear();
  dobles.gravaMotivo.mockClear();
  reload.mockClear();
  aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { reload },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("recuperarPulsoPerdido — o caminho gentil tem prazo de 2,5 s", () => {
  it("pede ao worker novo, com o motivo da recuperação, 2500 ms para assumir", async () => {
    await recuperarPulsoPerdido([]);

    expect(dobles.assumir).toHaveBeenCalledTimes(1);
    expect(dobles.assumir).toHaveBeenCalledWith({
      motivo: "recuperacao-sentinela",
      prazoMs: 2500,
    });
  });
});

describe("recuperarPulsoPerdido — desregistro que falha não derruba a recuperação", () => {
  it("o primeiro registro falha, o segundo ainda é desregistrado e a página recarrega com o motivo certo", async () => {
    const quebrado = registro(() => Promise.reject(new Error("falhou")));
    const bom = registro(() => Promise.resolve(true));

    await expect(
      recuperarPulsoPerdido([quebrado, bom]),
    ).resolves.toBeUndefined();

    expect(quebrado.unregister).toHaveBeenCalledTimes(1);
    expect(bom.unregister).toHaveBeenCalledTimes(1);
    expect(aviso).toHaveBeenCalledWith(
      "[PWA Sentinel] Falha ao desregistrar:",
      expect.any(Error),
    );
    expect(dobles.recarregarSeSeguro).toHaveBeenCalledTimes(1);
    expect(dobles.gravaMotivo).toHaveBeenCalledWith("recuperacao-sentinela");
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("sem nenhum registro, ainda assim recarrega uma vez (último recurso)", async () => {
    await recuperarPulsoPerdido([]);

    expect(dobles.recarregarSeSeguro).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("o worker novo assumiu: nenhum desregistro e nenhum reload por conta do sentinela", async () => {
    dobles.assumir.mockResolvedValueOnce(true);
    const intacto = registro(() => Promise.resolve(true));

    await recuperarPulsoPerdido([intacto]);

    expect(intacto.unregister).not.toHaveBeenCalled();
    expect(dobles.recarregarSeSeguro).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });
});

describe("initSentinel — quem é desregistrado são os registros que o navegador devolveu", () => {
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("5,5 min sem sinal e sem worker novo pronto: o registro de getRegistrations é desregistrado", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    const doNavegador = registro(() => Promise.resolve(true));
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        addEventListener: () => {},
        getRegistrations: vi.fn().mockResolvedValue([doNavegador]),
        controller: { postMessage: vi.fn() },
      },
    });

    initSentinel();
    await vi.advanceTimersByTimeAsync(330_000);

    expect(dobles.assumir).toHaveBeenCalledTimes(1);
    expect(doNavegador.unregister).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
