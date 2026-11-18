// @vitest-environment jsdom
import { runInThisContext } from "node:vm";
import * as React from "react";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import * as sonner from "sonner";
import { ModuleKind, transpileModule } from "typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import fonte from "@/hooks/useUpdateCheck?raw";

// O módulo virtual do PWA não resolve neste runner (ver use-update-check-contrato).
// Compilamos o hook INTEIRO, sem extrair/reimplementar sua comparação. Só o
// import virtual e o contexto da loja são dublês; React, leitura de version.json
// e prova de rede continuam reais. DEV=false equivale ao build publicado.
const dependencias = import.meta.glob(
  [
    "/src/lib/atualizacao/autorizar-purga.ts",
    "/src/lib/atualizacao/recarga-pendente.ts",
    "/src/lib/atualizacao/rede-para-purga.ts",
    "/src/lib/atualizacao/veto-de-recarga.ts",
    "/src/lib/localStoragePurgeWhitelist.ts",
    "/src/lib/motivo-de-recarga.ts",
    "/src/lib/recuperacao-chunk.ts",
    "/src/lib/versao-do-servidor.ts",
  ],
  { eager: true },
);

type Estado = {
  isMandatory: boolean;
  updateAvailable: boolean;
  checkUpdate: () => Promise<void>;
};

function carregarHook(versaoLocal: string) {
  const compilado = transpileModule(
    fonte.replaceAll("import.meta.env.DEV", "false"),
    { compilerOptions: { module: ModuleKind.CommonJS } },
  ).outputText;
  const exports: { useUpdateCheck?: () => Estado } = {};
  const requerer = (nome: string) => {
    if (nome === "react") return React;
    if (nome === "sonner") return sonner;
    if (nome === "@/contexts/StoreContext") {
      return { useStore: () => ({ config: { minAppVersion: "1.5.208" } }) };
    }
    if (nome === "virtual:pwa-register/react") {
      return {
        useRegisterSW: () => ({
          offlineReady: [false, vi.fn()],
          needRefresh: [false, vi.fn()],
          updateServiceWorker: vi.fn(),
        }),
      };
    }
    const dependencia = dependencias[`${nome.replace("@/", "/src/")}.ts`];
    if (!dependencia) throw new Error(`Dependência não mapeada: ${nome}`);
    return dependencia;
  };
  const executar = runInThisContext(
    `(function(require, exports, __APP_VERSION__) { ${compilado}\n})`,
    { filename: "useUpdateCheck.compilado-para-teste.cjs" },
  );
  executar(requerer, exports, versaoLocal);
  if (!exports.useUpdateCheck) throw new Error("Hook não foi exportado");
  return exports.useUpdateCheck;
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("versão mínima compara patches", () => {
  let raiz: Root;
  let elemento: HTMLDivElement;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    elemento = document.createElement("div");
    document.body.appendChild(elemento);
    raiz = createRoot(elemento);
  });

  afterEach(async () => {
    await act(async () => raiz.unmount());
    elemento.remove();
    localStorage.clear();
    sessionStorage.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each([
    ["1.5.207-sha.aaa", true],
    ["1.5.208-sha.aaa", false],
    ["1.5.209-sha.aaa", false],
  ])(
    "local %s, mínima 1.5.208: obrigatória=%s com rede provada",
    async (local, obrigatoria) => {
      const buscar = vi.fn(
        async () =>
          new Response(JSON.stringify({ version: "1.5.208" }), {
            headers: { "content-type": "application/json" },
          }),
      );
      vi.stubGlobal("fetch", buscar);
      const useUpdateCheck = carregarHook(local);
      let estado: Estado | undefined;
      function Sonda({ aoLer }: { aoLer: (valor: Estado) => void }) {
        aoLer(useUpdateCheck());
        return null;
      }

      await act(async () =>
        raiz.render(
          <Sonda
            aoLer={(valor) => {
              estado = valor;
            }}
          />,
        ),
      );
      // Inclusive nos controles em dia: a leitura real prova a rede para todos,
      // não apenas para o caso que o boot já identifica como antigo.
      await act(async () => estado?.checkUpdate());

      expect(buscar).toHaveBeenCalledWith("/version.json", {
        cache: "no-store",
        signal: expect.any(AbortSignal),
      });
      expect(estado?.isMandatory).toBe(obrigatoria);
      expect(estado?.updateAvailable).toBe(obrigatoria);
    },
  );
});
