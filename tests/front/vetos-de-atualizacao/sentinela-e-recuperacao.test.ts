// @vitest-environment jsdom
import { marcarOperacaoSensivel } from "@/lib/atualizacao/operacao-sensivel";
import {
  haRecargaPendente,
  limparRecargaPendente,
} from "@/lib/atualizacao/recarga-pendente";
import { definirAvaliadorDeMomentoSeguro } from "@/lib/atualizacao/veto-de-recarga";
import {
  CHAVE_RECUPERACAO_CHUNK,
  JANELA_RECUPERACAO_CHUNK_MS,
  assumirServiceWorkerNovoERecarregar,
  executarRecuperacaoChunk,
  pedirRecargaSubordinada,
  reportarErroChunk,
} from "@/lib/recuperacao-chunk";
import { recuperarPulsoPerdido } from "@/pwa-sentinel";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { adiar } from "./apoio";

const reload = vi.fn();
const replace = vi.fn();
let desmarcar: (() => void) | undefined;
function instalarSW(comWaiting = true) {
  const registro = {
    waiting: comWaiting ? { postMessage: vi.fn() } : null,
    unregister: vi.fn(async () => true),
  };
  const sw = Object.assign(new EventTarget(), {
    getRegistration: vi.fn(async () => registro),
    getRegistrations: vi.fn(async () => [registro]),
  });
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: sw,
  });
  return {
    registro,
    sw,
    registros: [registro as unknown as ServiceWorkerRegistration],
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1000);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  reload.mockClear();
  replace.mockClear();
  const armazenamento = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (chave: string) => armazenamento.get(chave) ?? null,
    setItem: (chave: string, valor: string) => armazenamento.set(chave, valor),
    removeItem: (chave: string) => armazenamento.delete(chave),
  });
  sessionStorage.clear();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { reload, replace, pathname: "/", search: "" },
  });
  definirAvaliadorDeMomentoSeguro(null);
  limparRecargaPendente();
});
afterEach(() => {
  desmarcar?.();
  desmarcar = undefined;
  limparRecargaPendente();
  definirAvaliadorDeMomentoSeguro(null);
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("sentinela e ciclo do worker respeitam o veto compartilhado", () => {
  it.each([false, true])(
    "operação em voo impede ativação e desregistro (waiting=%s)",
    async (waiting) => {
      const { registro, registros } = instalarSW(waiting);
      desmarcar = marcarOperacaoSensivel("gravacao-teste");
      await recuperarPulsoPerdido(registros);
      if (registro.waiting)
        expect(registro.waiting.postMessage).not.toHaveBeenCalled();
      expect(registro.unregister).not.toHaveBeenCalled();
      expect(reload).not.toHaveBeenCalled();
      expect(localStorage.getItem(CHAVE_RECUPERACAO_CHUNK)).toBeNull();
    },
  );

  it("reconfere o veto depois de consultar o registro antes de ativar ou desregistrar", async () => {
    const { registro, sw, registros } = instalarSW();
    sw.getRegistration.mockImplementation(async () => {
      desmarcar = marcarOperacaoSensivel("gravacao-teste");
      return registro;
    });
    await recuperarPulsoPerdido(registros);
    expect(registro.waiting?.postMessage).not.toHaveBeenCalled();
    expect(registro.unregister).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it("operação iniciada enquanto o worker assume veta o reload e o deixa pendente", async () => {
    const { registro, sw } = instalarSW();
    const resultado = assumirServiceWorkerNovoERecarregar({
      motivo: "recuperacao-sentinela",
      prazoMs: 2500,
    });
    await Promise.resolve();
    expect(registro.waiting?.postMessage).toHaveBeenCalledWith({
      type: "SKIP_WAITING",
    });
    desmarcar = marcarOperacaoSensivel("gravacao-teste");
    sw.dispatchEvent(new Event("controllerchange"));
    // O evento foi tratado; o chamador não deve cair no desregistro de reserva.
    expect(await resultado).toBe(true);
    expect(reload).not.toHaveBeenCalled();
    expect(haRecargaPendente()).toBe(true);
    expect(localStorage.getItem("pwa_reload_reason")).toBeNull();
    desmarcar();
    await vi.advanceTimersByTimeAsync(3000);
    expect(reload).not.toHaveBeenCalled();
  });

  it("operação iniciada durante o desregistro veta a recarga final do sentinela", async () => {
    const { registro, registros } = instalarSW(false);
    const desregistro = adiar<boolean>();
    registro.unregister.mockReturnValue(desregistro.promessa);
    const resultado = recuperarPulsoPerdido(registros);
    await Promise.resolve();
    await Promise.resolve();
    expect(registro.unregister).toHaveBeenCalledOnce();
    desmarcar = marcarOperacaoSensivel("gravacao-teste");
    desregistro.resolver(true);
    await resultado;
    expect(reload).not.toHaveBeenCalled();
    expect(haRecargaPendente()).toBe(true);
  });

  it("sem veto e sem waiting mantém desregistro e uma única recarga", async () => {
    const { registro, registros } = instalarSW(false);
    await recuperarPulsoPerdido(registros);
    expect(registro.unregister).toHaveBeenCalledOnce();
    expect(reload).toHaveBeenCalledOnce();
    expect(localStorage.getItem("pwa_reload_reason")).toBe(
      "recuperacao-sentinela",
    );
  });

  it("worker assumido com veto não leva o sentinela ao desregistro de reserva", async () => {
    const { registro, sw, registros } = instalarSW();
    const resultado = recuperarPulsoPerdido(registros);
    await Promise.resolve();
    desmarcar = marcarOperacaoSensivel("gravacao-teste");
    sw.dispatchEvent(new Event("controllerchange"));
    await resultado;
    expect(registro.unregister).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    expect(haRecargaPendente()).toBe(true);
  });

  it("purga de chunk não começa com operação sensível mesmo com rede verificada", async () => {
    const { registro, sw } = instalarSW(false);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ version: "1.5.32" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    desmarcar = marcarOperacaoSensivel("gravacao-teste");
    expect(await executarRecuperacaoChunk({ dono: true, acao: "purge" })).toBe(
      "recusado",
    );
    expect(sw.getRegistrations).not.toHaveBeenCalled();
    expect(registro.unregister).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it("o reload seco da recuperação de chunk também fica pendente durante gravação", async () => {
    instalarSW(false);
    desmarcar = marcarOperacaoSensivel("gravacao-teste");
    expect(
      await executarRecuperacaoChunk({ dono: true, acao: "ciclo-sw" }),
    ).toBe("recusado");
    expect(reload).not.toHaveBeenCalled();
    expect(haRecargaPendente()).toBe(true);
  });
});

describe("recarga subordinada consome a mesma trava anti-repetição", () => {
  it("a primeira conta, a repetição imediata recusa e a terceira fora da janela também", () => {
    expect(pedirRecargaSubordinada(1000)).toBe(true);
    expect(
      JSON.parse(localStorage.getItem(CHAVE_RECUPERACAO_CHUNK) ?? "null").count,
    ).toBe(1);
    expect(pedirRecargaSubordinada(1001)).toBe(false);
    expect(pedirRecargaSubordinada(1000 + JANELA_RECUPERACAO_CHUNK_MS)).toBe(
      true,
    );
    expect(
      JSON.parse(localStorage.getItem(CHAVE_RECUPERACAO_CHUNK) ?? "null").count,
    ).toBe(2);
    expect(
      pedirRecargaSubordinada(1000 + 2 * JANELA_RECUPERACAO_CHUNK_MS),
    ).toBe(false);
  });

  it("uma tentativa do chunk e uma subordinada esgotam juntas as duas tentativas", () => {
    expect(reportarErroChunk(1000, true).dono).toBe(true);
    expect(pedirRecargaSubordinada(1000 + JANELA_RECUPERACAO_CHUNK_MS)).toBe(
      true,
    );
    expect(
      reportarErroChunk(1000 + 2 * JANELA_RECUPERACAO_CHUNK_MS, true).dono,
    ).toBe(false);
  });
});
