// @vitest-environment jsdom
// Bordas da decisão "este aparelho está velho demais?" do useUpdateCheck, que o
// teste de patches (207/208/209) não alcança: major e minor diferentes, 1.5.9
// contra 1.5.10, versão ilegível, a trava de 2 tentativas, a trava corrompida e
// a versão que chega pelo canal realtime. O hook é o REAL, compilado do fonte;
// só o módulo virtual do PWA e a loja são dublês (mesmo método de
// versao-minima-compara-patches).
import { runInThisContext } from "node:vm";
import * as React from "react";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import * as sonner from "sonner";
import { ModuleKind, transpileModule } from "typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import fonte from "@/hooks/useUpdateCheck?raw";

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
  newVersion: string | null;
  checkUpdate: (versaoDoRealtime?: string) => Promise<void>;
};

const CHAVE_DA_TRAVA = "pwa_mandatory_purge_guard";

type OpcoesDoRegistro = {
  onRegisteredSW?: (url: string, registro: unknown) => void;
};

function carregarHook(
  versaoLocal: string,
  minAppVersion: string | undefined,
  capturadas: { opcoes?: OpcoesDoRegistro } = {},
) {
  const compilado = transpileModule(
    fonte.replaceAll("import.meta.env.DEV", "false"),
    { compilerOptions: { module: ModuleKind.CommonJS } },
  ).outputText;
  const exports: { useUpdateCheck?: () => Estado } = {};
  const requerer = (nome: string) => {
    if (nome === "react") return React;
    if (nome === "sonner") return sonner;
    if (nome === "@/contexts/StoreContext") {
      return { useStore: () => ({ config: { minAppVersion } }) };
    }
    if (nome === "virtual:pwa-register/react") {
      return {
        useRegisterSW: (opcoes: OpcoesDoRegistro) => {
          capturadas.opcoes = opcoes;
          return {
            offlineReady: [false, vi.fn()],
            needRefresh: [false, vi.fn()],
            updateServiceWorker: vi.fn(),
          };
        },
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

describe("useUpdateCheck — limites da versão mínima e da trava", () => {
  let raiz: Root;
  let elemento: HTMLDivElement;
  let buscar: ReturnType<typeof vi.fn>;
  let conexao: { mockReturnValue: (valor: boolean) => unknown };

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    conexao = vi.spyOn(navigator, "onLine", "get");
    conexao.mockReturnValue(true);
    // O console do hook é ruidoso e não é o que se prova aqui.
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
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

  /** Renderiza o hook real, sem nenhuma leitura de versão ainda. */
  async function renderizar(
    local: string,
    minima: string | undefined,
    versaoDoServidor = "1.5.208",
  ) {
    buscar = vi.fn(
      async () =>
        new Response(JSON.stringify({ version: versaoDoServidor }), {
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", buscar);
    const capturadas: { opcoes?: OpcoesDoRegistro } = {};
    const useUpdateCheck = carregarHook(local, minima, capturadas);
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
    return {
      estado: () => {
        if (!estado) throw new Error("hook não montou");
        return estado;
      },
      capturadas,
    };
  }

  /** Monta o hook, deixa a leitura de /version.json provar a rede e devolve o estado. */
  async function montar(
    local: string,
    minima: string | undefined,
    versaoDoServidor = "1.5.208",
    versaoDoRealtime?: string,
  ): Promise<() => Estado> {
    const { estado } = await renderizar(local, minima, versaoDoServidor);
    await act(async () => estado().checkUpdate(versaoDoRealtime));
    return estado;
  }

  describe("quem está velho demais", () => {
    it.each([
      // [local, mínima, obrigatória]
      ["1.5.9-sha.aaa", "1.5.10", true],
      ["1.5.10-sha.aaa", "1.5.9", false],
      ["1.4.999-sha.aaa", "1.5.0", true],
      ["1.6.0-sha.aaa", "1.5.99", false],
      ["1.99.99-sha.aaa", "2.0.0", true],
      ["2.0.0-sha.aaa", "1.99.99", false],
      ["2.0.0-sha.aaa", "2.0.0", false],
      ["2.0.0+build.7", "2.0.0-sha.outro", false],
    ])(
      "local %s com mínima %s: obrigatória=%s",
      async (local, minima, obrigatoria) => {
        const estado = await montar(local, minima);
        expect(estado().isMandatory).toBe(obrigatoria);
        expect(estado().updateAvailable).toBe(obrigatoria);
      },
    );

    it.each([
      ["versão local ilegível", "desconhecida", "1.5.0"],
      ["mínima ilegível", "1.5.0-sha.aaa", "qualquer-coisa"],
      ["mínima ausente", "1.5.0-sha.aaa", undefined],
      ["mínima vazia", "1.5.0-sha.aaa", ""],
    ])("dúvida nunca força atualização: %s", async (_caso, local, minima) => {
      const estado = await montar(local, minima);
      expect(estado().isMandatory).toBe(false);
      expect(estado().updateAvailable).toBe(false);
    });

    it("versão local que é carimbo de tempo de desenvolvimento nunca é tratada como velha", async () => {
      // 13 dígitos: o carimbo de build local. Contra uma mínima absurda ele
      // pareceria velho, e forçaria purga no ambiente de desenvolvimento.
      const estado = await montar("1700000000000", "2000000000000.0.0");
      expect(estado().isMandatory).toBe(false);
    });
  });

  describe("a trava de 2 tentativas da purga", () => {
    function gravarTrava(valor: unknown) {
      localStorage.setItem(
        CHAVE_DA_TRAVA,
        typeof valor === "string" ? valor : JSON.stringify(valor),
      );
    }

    it("com 1 tentativa gasta para a mesma mínima, ainda tenta de novo", async () => {
      gravarTrava({ required: "1.5.208", count: 1 });
      const estado = await montar("1.5.207-sha.aaa", "1.5.208");
      expect(estado().isMandatory).toBe(true);
    });

    it("com 2 tentativas gastas para a mesma mínima, desiste (não prende a cliente em loop)", async () => {
      gravarTrava({ required: "1.5.208", count: 2 });
      const estado = await montar("1.5.207-sha.aaa", "1.5.208");
      expect(estado().isMandatory).toBe(false);
      expect(estado().updateAvailable).toBe(false);
    });

    it("mais do que 2 também desiste", async () => {
      gravarTrava({ required: "1.5.208", count: 7 });
      const estado = await montar("1.5.207-sha.aaa", "1.5.208");
      expect(estado().isMandatory).toBe(false);
    });

    it("tentativas gastas para OUTRA mínima não valem para esta", async () => {
      gravarTrava({ required: "1.5.100", count: 2 });
      const estado = await montar("1.5.207-sha.aaa", "1.5.208");
      expect(estado().isMandatory).toBe(true);
    });

    it.each([
      ["texto que não é JSON", "{quebrado"],
      ["JSON sem a mínima", { count: 2 }],
      ["contagem ilegível", { required: "1.5.208", count: "muitas" }],
    ])(
      "trava corrompida (%s) conta como primeira tentativa",
      async (_caso, valor) => {
        gravarTrava(valor);
        const estado = await montar("1.5.207-sha.aaa", "1.5.208");
        expect(estado().isMandatory).toBe(true);
      },
    );

    it("a trava esgota DEPOIS de a atualização já estar marcada: a marcação some e a cliente não fica presa", async () => {
      gravarTrava({ required: "1.5.208", count: 1 });
      const { estado } = await renderizar("1.5.207-sha.aaa", "1.5.208");
      await act(async () => estado().checkUpdate());
      expect(estado().isMandatory).toBe(true);

      // A purga gastou a última tentativa e o app voltou velho.
      gravarTrava({ required: "1.5.208", count: 2 });
      await act(async () => estado().checkUpdate());

      expect(estado().isMandatory).toBe(false);
      expect(estado().updateAvailable).toBe(false);
    });

    it("sem rede provada não marca como obrigatória; quando a rede volta, marca", async () => {
      conexao.mockReturnValue(false);
      const { estado } = await renderizar("1.5.207-sha.aaa", "1.5.208");
      await act(async () => estado().checkUpdate());
      expect(buscar).toHaveBeenCalled();
      expect(estado().isMandatory).toBe(false);
      expect(estado().updateAvailable).toBe(false);

      conexao.mockReturnValue(true);
      await act(async () => estado().checkUpdate());
      expect(estado().isMandatory).toBe(true);
    });

    it("aparelho que já está em dia apaga a trava, para não bloquear uma atualização futura", async () => {
      gravarTrava({ required: "1.5.208", count: 2 });
      await montar("1.5.208-sha.aaa", "1.5.208");
      expect(localStorage.getItem(CHAVE_DA_TRAVA)).toBeNull();
    });

    it("em dia e sem tentativas gastas, não inventa trava", async () => {
      await montar("1.5.208-sha.aaa", "1.5.208");
      expect(localStorage.getItem(CHAVE_DA_TRAVA)).toBeNull();
    });
  });

  describe("versão nova avisada pelo canal realtime", () => {
    it("versão legível do realtime vale sem consultar o servidor", async () => {
      const estado = await montar(
        "1.5.300-sha.local",
        "1.5.208",
        "9.9.9",
        "1.5.301-sha.nova",
      );
      expect(estado().newVersion).toBe("1.5.301-sha.nova");
      expect(buscar).not.toHaveBeenCalled();
    });

    it("lixo do realtime é ignorado e a versão vem do servidor", async () => {
      const estado = await montar(
        "1.5.300-sha.local",
        "1.5.208",
        "1.5.302-sha.servidor",
        "binary-v24",
      );
      expect(buscar).toHaveBeenCalledTimes(1);
      expect(estado().newVersion).toBe("1.5.302-sha.servidor");
    });

    it("a versão que o servidor devolve ser a mesma deste aparelho não cria aviso", async () => {
      const estado = await montar(
        "1.5.300-sha.local",
        "1.5.208",
        "1.5.300-sha.local",
      );
      expect(estado().newVersion).toBeNull();
    });

    describe("ao voltar para o app (aba visível de novo)", () => {
      const registro = () => ({ update: vi.fn(async () => {}) });

      async function voltarParaOApp(local: string, versaoDoServidor: string) {
        const { estado, capturadas } = await renderizar(
          local,
          "1.5.208",
          versaoDoServidor,
        );
        const sw = registro();
        await act(async () => capturadas.opcoes?.onRegisteredSW?.("sw.js", sw));
        vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
        await act(async () => {
          document.dispatchEvent(new Event("visibilitychange"));
          await new Promise((resolver) => setTimeout(resolver, 0));
        });
        return { estado, sw };
      }

      it("servidor com versão diferente da deste aparelho avisa e pede ao service worker que se atualize", async () => {
        const { estado, sw } = await voltarParaOApp(
          "1.5.300-sha.local",
          "1.5.301-sha.nova",
        );
        expect(estado().newVersion).toBe("1.5.301-sha.nova");
        expect(sw.update).toHaveBeenCalledTimes(1);
      });

      it("servidor com a MESMA versão deste aparelho não avisa nada, mas ainda confere o service worker", async () => {
        const { estado, sw } = await voltarParaOApp(
          "1.5.300-sha.local",
          "1.5.300-sha.local",
        );
        expect(estado().newVersion).toBeNull();
        expect(sw.update).toHaveBeenCalledTimes(1);
      });
    });

    it("servidor sem versão legível (HTML/404) não inventa aviso", async () => {
      buscar = vi.fn(
        async () =>
          new Response("<html></html>", {
            headers: { "content-type": "text/html" },
          }),
      );
      vi.stubGlobal("fetch", buscar);
      const useUpdateCheck = carregarHook("1.5.300-sha.local", "1.5.208");
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
      await act(async () => estado?.checkUpdate());
      expect(buscar).toHaveBeenCalled();
      expect(estado?.newVersion).toBeNull();
      expect(estado?.updateAvailable).toBe(false);
    });
  });
});
