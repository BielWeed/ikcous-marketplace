// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  esperarServiceWorkerControlando,
  esperarServiceWorkerEmEspera,
} from "../../e2e/pwa-esperas";
import specDoIncidente from "../../e2e/pwa-recuperacao-chunk.spec.ts?raw";

type Estado = {
  active?: { state: string } | null;
  waiting?: { state: string } | null;
};
type Pagina = Parameters<typeof esperarServiceWorkerControlando>[0];

async function condicao(
  esperar: typeof esperarServiceWorkerControlando,
  registro: Estado | undefined,
  controlador: object | null = null,
): Promise<unknown> {
  vi.stubGlobal("navigator", {
    serviceWorker: {
      getRegistration: vi.fn().mockResolvedValue(registro),
      controller: controlador,
    },
  });
  const predicados: Array<() => Promise<unknown>> = [];
  const waitForFunction = vi.fn(
    async (
      predicado: () => Promise<unknown>,
      argumento: unknown,
      opcoes: { timeout: number },
    ) => {
      predicados.push(predicado);
      expect(argumento).toBeUndefined();
      expect(opcoes.timeout).toBe(30_000);
    },
  );
  await esperar({ waitForFunction } as unknown as Pagina);
  expect(waitForFunction).toHaveBeenCalledTimes(1);
  const predicado = predicados.at(-1);
  if (!predicado)
    throw new Error("A espera deve consultar o estado do navegador.");
  return predicado();
}

afterEach(() => vi.unstubAllGlobals());

describe("preparação do incidente PWA — espera estado, não existência de cache", () => {
  it("sem registro não libera a troca de arquivos", async () => {
    expect(await condicao(esperarServiceWorkerControlando, undefined)).toBe(
      false,
    );
  });

  it("registro ainda instalando sem active não libera o deploy", async () => {
    expect(await condicao(esperarServiceWorkerControlando, {})).toBe(false);
    expect(
      await condicao(esperarServiceWorkerControlando, { active: null }),
    ).toBe(false);
  });

  it("active ainda ativando não libera o deploy, mesmo sendo o controller", async () => {
    const active = { state: "activating" };
    expect(
      await condicao(esperarServiceWorkerControlando, { active }, active),
    ).toBe(false);
  });

  it("ativo sem controlar esta aba não libera o deploy", async () => {
    const active = { state: "activated" };
    expect(await condicao(esperarServiceWorkerControlando, { active })).toBe(
      false,
    );
    expect(
      await condicao(esperarServiceWorkerControlando, { active }, {}),
    ).toBe(false);
  });

  it("só libera quando o ativo também é o controlador da aba", async () => {
    const active = { state: "activated" };
    expect(
      await condicao(esperarServiceWorkerControlando, { active }, active),
    ).toBe(true);
  });

  it("registro ou waiting ausente nunca contam como atualização pronta", async () => {
    expect(await condicao(esperarServiceWorkerEmEspera, undefined)).toBe(false);
    expect(await condicao(esperarServiceWorkerEmEspera, {})).toBe(false);
    expect(
      await condicao(esperarServiceWorkerEmEspera, { waiting: null }),
    ).toBe(false);
  });

  it("worker novo só está pronto quando o waiting terminou de instalar", async () => {
    expect(
      await condicao(esperarServiceWorkerEmEspera, {
        waiting: { state: "installing" },
      }),
    ).toBe(false);
    expect(
      await condicao(esperarServiceWorkerEmEspera, {
        waiting: { state: "installed" },
      }),
    ).toBe(true);
  });

  it("o incidente espera controle antes do deploy e waiting antes de perder o chunk", () => {
    const spec = specDoIncidente;
    const controle = spec.indexOf(
      "await esperarServiceWorkerControlando(page)",
    );
    const deploy = spec.indexOf("/__pwa__/trocar");
    const waiting = spec.indexOf("await esperarServiceWorkerEmEspera(page)");
    const incidente = spec.indexOf("void import(arquivo)");
    expect(controle).toBeGreaterThan(0);
    expect(deploy).toBeGreaterThan(controle);
    expect(waiting).toBeGreaterThan(deploy);
    expect(incidente).toBeGreaterThan(waiting);
  });
});
