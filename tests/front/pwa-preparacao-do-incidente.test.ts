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
  const evaluate = vi.fn((predicado: () => Promise<boolean>) => predicado());
  let resultado: boolean | undefined;
  const toBe = vi.fn(async (esperado: boolean) => {
    expect(esperado).toBe(true);
  });
  const poll = vi.fn(
    (ler: () => Promise<boolean>, opcoes: { timeout: number }) => {
      expect(opcoes.timeout).toBe(30_000);
      return {
        toBe: async (esperado: boolean) => {
          resultado = await ler();
          await toBe(esperado);
        },
      };
    },
  );
  await esperar({ evaluate } as Pagina, { poll });
  expect(poll).toHaveBeenCalledTimes(1);
  expect(evaluate).toHaveBeenCalledTimes(1);
  expect(toBe).toHaveBeenCalledTimes(1);
  return resultado;
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

  it.each([
    { nome: "controle", esperar: esperarServiceWorkerControlando },
    { nome: "waiting", esperar: esperarServiceWorkerEmEspera },
  ])("repete false assíncrono na espera de $nome", async ({ esperar }) => {
    let registro: Estado = {};
    const active = { state: "activated" };
    let avisarSegundaConsulta!: () => void;
    const segundaConsulta = new Promise<void>((resolve) => {
      avisarSegundaConsulta = resolve;
    });
    const getRegistration = vi.fn(async () => {
      if (getRegistration.mock.calls.length === 2) avisarSegundaConsulta();
      return registro;
    });
    const serviceWorker = {
      getRegistration,
      controller: null as object | null,
    };
    vi.stubGlobal("navigator", { serviceWorker });
    const page = {
      evaluate: (predicado: () => Promise<boolean>) => predicado(),
      // Semântica do Page.waitForFunction na versão do CI: a Promise já é
      // truthy e é adotada no resultado, mesmo quando resolve false.
      waitForFunction: async (predicado: () => Promise<boolean>) => predicado(),
    };
    let terminou = false;
    const verificar = {
      poll: (ler: () => Promise<boolean>) =>
        expect.poll(ler, { timeout: 3000, interval: 10 }),
    };
    const execucao = esperar(page, verificar).then(() => {
      terminou = true;
    });
    try {
      // A própria consulta sinaliza a nova tentativa. Se a espera terminar
      // sem repetir a leitura, a contagem abaixo denuncia o erro.
      await Promise.race([segundaConsulta, execucao]);
      expect(getRegistration.mock.calls.length).toBeGreaterThanOrEqual(2);
      expect(terminou).toBe(false);
    } finally {
      registro = { active, waiting: { state: "installed" } };
      serviceWorker.controller = active;
      await execucao;
    }
    expect(terminou).toBe(true);
  });

  it("o incidente espera controle antes do deploy e waiting antes de perder o chunk", () => {
    const spec = specDoIncidente;
    const controle = spec.indexOf(
      "await esperarServiceWorkerControlando(page, expect)",
    );
    const deploy = spec.indexOf("/__pwa__/trocar");
    const waiting = spec.indexOf(
      "await esperarServiceWorkerEmEspera(page, expect)",
    );
    const incidente = spec.indexOf("void import(arquivo)");
    expect(controle).toBeGreaterThan(0);
    expect(deploy).toBeGreaterThan(controle);
    expect(waiting).toBeGreaterThan(deploy);
    expect(incidente).toBeGreaterThan(waiting);
  });

  it("o incidente exige ausência real do chunk sem fabricar uma remoção", () => {
    const ausencia = specDoIncidente.indexOf(
      "o chunk antigo não está em nenhum cache",
    );
    const incidente = specDoIncidente.indexOf("void import(arquivo)");
    expect(ausencia).toBeGreaterThan(0);
    expect(incidente).toBeGreaterThan(ausencia);
    expect(specDoIncidente).toContain("caches.match(arquivo)");
    expect(specDoIncidente).not.toContain("cache.delete(");
  });
});
