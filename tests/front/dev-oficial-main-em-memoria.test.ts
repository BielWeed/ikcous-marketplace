// Caça por mutação em scripts/dev-oficial.mjs (25/11/2026): o teste vizinho
// (dev-oficial-so-sobe-no-banco-da-ikcous) só cobre as três funções puras;
// `main` — o que de fato decide subir o vite ligado ao banco certo — nunca
// rodava em teste. Aqui ele roda DE VERDADE, mas em memória: `fetch`, `spawn`
// e `process.exit` são dublês, então nada sai para a rede, nenhum vite sobe
// e nenhum `.env` é lido. A guarda de invocação (`process.argv[1]`) é o que
// impede o `import` do outro teste de subir o app; o último teste daqui prende
// essa guarda (sem ela, qualquer teste que só IMPORTA o módulo buscaria a
// página da loja e subiria o vite).
//
// Mutantes equivalentes (não há teste que os derrube, e não precisa):
//  - `([^}]*)` -> `([^}]+)` na regex da ficha: com chaves vazias o resultado
//    continua sendo "sem ficha utilizável" (null) nos dois casos.
//  - `.exec(String(html))` -> `.exec(html)`: RegExp.exec já converte para texto.
//  - tirar `if (!achado) return null;`: o `achado[1]` seguinte está DENTRO do
//    try/catch que já devolve null, então o TypeError é engolido e o resultado
//    é o mesmo null.
import { EventEmitter } from "node:events";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({
  spawn: spawnMock,
  default: { spawn: spawnMock },
}));

const SCRIPT = fileURLToPath(
  new URL("../../scripts/dev-oficial.mjs", import.meta.url),
);
const RAIZ = path.resolve(path.dirname(SCRIPT), "..");
const REF_OFICIAL = "cafkrminfnokvgjqtkle";
const REF_ANTIGO = "dekxabvqdsuukijblazl";
const CHAVE = "chave-publica-so-de-teste-123456789";

const ficha = (ref: string, chave = CHAVE) =>
  `<html><script>window.__F__={"conexao":{"supabaseUrl":"https://${ref}.supabase.co","publishableKey":"${chave}"}}</script></html>`;

const pagina = (html: string, ok = true, status = 200) => ({
  ok,
  status,
  text: async () => html,
});

type Dubles = {
  fetchMock: ReturnType<typeof vi.fn>;
  filho: EventEmitter & { kill: ReturnType<typeof vi.fn> };
  saidas: number[];
  logs: string[];
  erros: string[];
  sinais: Record<string, () => void>;
  modulo: Record<string, unknown>;
};

const argvOriginal = [...process.argv];
const sinaisOriginais = {
  SIGINT: process.listeners("SIGINT"),
  SIGTERM: process.listeners("SIGTERM"),
};

afterEach(() => {
  process.argv = [...argvOriginal];
  for (const nome of ["SIGINT", "SIGTERM"] as const) {
    for (const ouvinte of process.listeners(nome)) {
      // eslint-disable-next-line security/detect-object-injection -- `nome` vem do literal fechado ["SIGINT", "SIGTERM"] acima.
      if (!sinaisOriginais[nome].includes(ouvinte))
        process.removeListener(nome, ouvinte as () => void);
    }
  }
});

/** Roda o módulo como se fosse `node scripts/dev-oficial.mjs <args>`. */
async function subir(
  resposta: unknown | (() => Promise<unknown>),
  args: string[] = [],
  comoComando = true,
): Promise<Dubles> {
  vi.resetModules();
  const filho = Object.assign(new EventEmitter(), { kill: vi.fn() });
  spawnMock.mockReset();
  spawnMock.mockReturnValue(filho);
  const fetchMock = vi.fn(async () => {
    if (typeof resposta === "function")
      return (resposta as () => Promise<unknown>)();
    return resposta;
  });
  vi.stubGlobal("fetch", fetchMock);
  const saidas: number[] = [];
  vi.spyOn(process, "exit").mockImplementation(((codigo?: number) => {
    saidas.push(codigo ?? 0);
  }) as never);
  const logs: string[] = [];
  const erros: string[] = [];
  vi.spyOn(console, "log").mockImplementation((...a) => {
    logs.push(a.join(" "));
  });
  vi.spyOn(console, "error").mockImplementation((...a) => {
    erros.push(a.join(" "));
  });
  const antesInt = process.listeners("SIGINT");
  const antesTerm = process.listeners("SIGTERM");
  process.argv = [
    process.argv[0],
    comoComando ? SCRIPT : "/outro/comando.mjs",
    ...args,
  ];
  // @ts-expect-error Módulo JS nativo sem declaração (mesmo padrão dos testes vizinhos).
  const modulo = await import("../../scripts/dev-oficial.mjs");
  if (comoComando)
    await vi.waitFor(() =>
      expect(spawnMock.mock.calls.length + saidas.length).toBeGreaterThan(0),
    );
  const novo = (nome: "SIGINT" | "SIGTERM", antes: unknown[]) =>
    process.listeners(nome).find((ouvinte) => !antes.includes(ouvinte)) as
      | (() => void)
      | undefined;
  const sinais: Record<string, () => void> = {};
  const int = novo("SIGINT", antesInt);
  const term = novo("SIGTERM", antesTerm);
  if (int) sinais.SIGINT = int;
  if (term) sinais.SIGTERM = term;
  return { fetchMock, filho, saidas, logs, erros, sinais, modulo };
}

describe("dev-oficial: main roda em memória, sem rede nem vite de verdade", () => {
  it("caminho feliz: busca a página oficial, confere, e sobe o vite com a ficha no ambiente do processo", async () => {
    vi.stubEnv("DEV_OFICIAL_MARCADOR", "preservado");
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const d = await subir(pagina(ficha(REF_OFICIAL)), ["--port", "5199"]);

    expect(d.fetchMock).toHaveBeenCalledTimes(1);
    const [url, opcoesDoFetch] = d.fetchMock.mock.calls[0] as unknown as [
      string,
      { signal: AbortSignal },
    ];
    expect(url).toBe(d.modulo.PAGINA_OFICIAL);
    expect(opcoesDoFetch.signal).toBeInstanceOf(AbortSignal);
    expect(timeout).toHaveBeenCalledWith(20_000);

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [exe, argumentos, opcoes] = spawnMock.mock.calls[0];
    expect(exe).toBe(process.execPath);
    expect(path.basename(argumentos[0])).toBe("vite.js");
    expect(argumentos.slice(1)).toEqual(["--port", "5199"]);
    expect(path.resolve(opcoes.cwd)).toBe(RAIZ);
    expect(opcoes.stdio).toBe("inherit");
    expect(opcoes.env).toMatchObject({
      VITE_APP_URL: (d.modulo.PAGINA_OFICIAL as string).replace(/\/$/, ""),
      VITE_SUPABASE_URL: `https://${REF_OFICIAL}.supabase.co`,
      VITE_SUPABASE_PUBLISHABLE_KEY: CHAVE,
      VITE_SUPABASE_ANON_KEY: CHAVE,
      DEV_OFICIAL_MARCADOR: "preservado",
    });
    expect(opcoes.env.VITE_APP_URL.endsWith("/")).toBe(false);
    expect(d.saidas).toEqual([]);
    expect(d.erros).toEqual([]);
  });

  it("o endereço publicado é o da IKCOUS, com https e barra final", async () => {
    const d = await subir(pagina(ficha(REF_OFICIAL)));
    expect(d.modulo.PAGINA_OFICIAL).toBe(
      "https://ickous-marketplace.vercel.app/",
    );
  });

  it("a chave pública nunca é impressa; o host confirmado, sim", async () => {
    const d = await subir(pagina(ficha(REF_OFICIAL)));
    const tudo = [...d.logs, ...d.erros].join("\n");
    expect(tudo).not.toContain(CHAVE);
    expect(d.logs).toHaveLength(1);
    expect(d.logs[0]).toContain("[dev:oficial] banco oficial confirmado:");
    expect(d.logs[0]).toContain(`${REF_OFICIAL}.supabase.co`);
    expect(d.logs[0]).not.toContain("https://");
  });

  it("CTRL+C e término do sistema derrubam o vite filho", async () => {
    const d = await subir(pagina(ficha(REF_OFICIAL)));
    expect(typeof d.sinais.SIGINT).toBe("function");
    expect(typeof d.sinais.SIGTERM).toBe("function");
    d.sinais.SIGINT();
    expect(d.filho.kill).toHaveBeenCalledTimes(1);
    d.sinais.SIGTERM();
    expect(d.filho.kill).toHaveBeenCalledTimes(2);
  });

  it("o código de saída do vite passa adiante (falha do vite = falha do comando)", async () => {
    const d = await subir(pagina(ficha(REF_OFICIAL)));
    d.filho.emit("exit", 3);
    expect(d.saidas).toEqual([3]);
  });

  it("vite encerrado por sinal (código nulo) sai com 0", async () => {
    const d = await subir(pagina(ficha(REF_OFICIAL)));
    d.filho.emit("exit", null);
    expect(d.saidas).toEqual([0]);
  });

  it("controle negativo: página com o banco ANTIGO não sobe o vite e sai com 1", async () => {
    const d = await subir(pagina(ficha(REF_ANTIGO)));
    expect(spawnMock).not.toHaveBeenCalled();
    expect(d.saidas).toEqual([1]);
    expect(d.logs).toEqual([]);
    expect(d.erros).toHaveLength(1);
    expect(d.erros[0]).toContain("[dev:oficial] NAO subiu:");
    expect(d.erros[0]).toContain(`${REF_ANTIGO}.supabase.co`);
    expect(d.erros[0]).not.toContain(CHAVE);
  });

  it("página sem ficha da loja não sobe o vite", async () => {
    const d = await subir(pagina("<html>sem ficha</html>"));
    expect(spawnMock).not.toHaveBeenCalled();
    expect(d.saidas).toEqual([1]);
    expect(d.erros[0]).toContain("ficha");
  });

  it("HTTP de erro não sobe o vite, mesmo que o corpo traga uma ficha boa", async () => {
    const d = await subir(pagina(ficha(REF_OFICIAL), false, 503));
    expect(spawnMock).not.toHaveBeenCalled();
    expect(d.saidas).toEqual([1]);
    expect(d.erros[0]).toContain("HTTP 503");
    expect(d.erros[0]).toContain(d.modulo.PAGINA_OFICIAL as string);
  });

  it("rede caída (fetch rejeita) não sobe o vite e diz o motivo", async () => {
    const d = await subir(async () => {
      throw new Error("sem rede de mentira");
    });
    expect(spawnMock).not.toHaveBeenCalled();
    expect(d.saidas).toEqual([1]);
    expect(d.erros[0]).toBe("[dev:oficial] NAO subiu: sem rede de mentira");
  });

  it("sem argumentos extras o vite sobe só com o próprio caminho", async () => {
    await subir(pagina(ficha(REF_OFICIAL)));
    expect(spawnMock.mock.calls[0][1]).toHaveLength(1);
  });

  it("a guarda de invocação: importar o módulo por OUTRO comando não busca nem sobe nada", async () => {
    const d = await subir(pagina(ficha(REF_OFICIAL)), [], false);
    // dá tempo de qualquer main espúria andar até o fim
    await new Promise((fim) => setTimeout(fim, 50));
    expect(d.fetchMock).not.toHaveBeenCalled();
    expect(spawnMock).not.toHaveBeenCalled();
    expect(d.saidas).toEqual([]);
    expect(d.sinais.SIGINT).toBeUndefined();
  });
});

describe("dev-oficial: bordas das funções puras que o teste vizinho não pega", () => {
  const carregar = async () => {
    vi.resetModules();
    // Rede de segurança: se a guarda de invocação sumir, a main espúria bate
    // neste dublê (nunca na rede real) e a saída é interceptada.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("rede bloqueada neste teste");
      }),
    );
    vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    process.argv = [process.argv[0], "/outro/comando.mjs"];
    // @ts-expect-error Módulo JS nativo sem declaração (mesmo padrão dos testes vizinhos).
    return (await import("../../scripts/dev-oficial.mjs")) as unknown as {
      extrairConexaoDaFicha: (html: unknown) => unknown;
      refDoCanal: (canais: unknown, nome: string) => string | null;
      motivoDeRecusa: (conexao: unknown, ref: unknown) => string | null;
    };
  };
  const conexaoDe = (host: string) => ({
    supabaseUrl: `https://${host}`,
    publishableKey: "x",
  });

  it("aceita espaço e quebra de linha em volta dos dois-pontos da ficha", async () => {
    const { extrairConexaoDaFicha } = await carregar();
    const html = `{"conexao" :\n  {"supabaseUrl":"https://a.supabase.co","publishableKey":"k"}}`;
    expect(extrairConexaoDaFicha(html)).toEqual({
      supabaseUrl: "https://a.supabase.co",
      publishableKey: "k",
    });
  });

  it("devolve só os dois campos, mesmo que a ficha traga mais coisa", async () => {
    const { extrairConexaoDaFicha } = await carregar();
    const html = `{"conexao":{"supabaseUrl":"https://a.supabase.co","publishableKey":"k","segredo":"nao-sair"}}`;
    expect(extrairConexaoDaFicha(html)).toStrictEqual({
      supabaseUrl: "https://a.supabase.co",
      publishableKey: "k",
    });
  });

  it("JSON quebrado na ficha vira null, sem lançar", async () => {
    const { extrairConexaoDaFicha } = await carregar();
    expect(extrairConexaoDaFicha(`{"conexao":{"supabaseUrl":}}`)).toBeNull();
    expect(extrairConexaoDaFicha(`{"conexao":{}}`)).toBeNull();
  });

  it("campo com tipo errado ou vazio nunca passa como conexão", async () => {
    const { extrairConexaoDaFicha } = await carregar();
    const com = (url: unknown, chave: unknown) =>
      extrairConexaoDaFicha(
        `{"conexao":{"supabaseUrl":${JSON.stringify(url)},"publishableKey":${JSON.stringify(chave)}}}`,
      );
    expect(com("https://a.supabase.co", 5)).toBeNull();
    expect(com(5, "k")).toBeNull();
    expect(com("", "k")).toBeNull();
    expect(com("https://a.supabase.co", "")).toBeNull();
    expect(com("", "")).toBeNull();
    expect(com(null, "k")).toBeNull();
  });

  it("entrada que não é texto não derruba o extrator", async () => {
    const { extrairConexaoDaFicha } = await carregar();
    expect(extrairConexaoDaFicha(undefined)).toBeNull();
    expect(extrairConexaoDaFicha(null)).toBeNull();
    expect(extrairConexaoDaFicha(42)).toBeNull();
  });

  it("refDoCanal: canais ausentes ou sem a chave `canais` dão null, sem lançar", async () => {
    const { refDoCanal } = await carregar();
    expect(refDoCanal(null, "IKCOUS")).toBeNull();
    expect(refDoCanal(undefined, "IKCOUS")).toBeNull();
    expect(refDoCanal({}, "IKCOUS")).toBeNull();
    expect(refDoCanal({ canais: {} }, "IKCOUS")).toBeNull();
  });

  it("refDoCanal: entrada nula no meio não esconde o canal certo", async () => {
    const { refDoCanal } = await carregar();
    const canais = {
      canais: { aaa: null, bbb: { nome: "OUTRA" }, ccc: { nome: "IKCOUS" } },
    };
    expect(refDoCanal(canais, "IKCOUS")).toBe("ccc");
  });

  it("motivoDeRecusa: URL que não é URL tem motivo próprio, e nunca passa", async () => {
    const { motivoDeRecusa } = await carregar();
    const motivo = motivoDeRecusa(
      { supabaseUrl: "isto nao e url", publishableKey: "x" },
      REF_OFICIAL,
    );
    expect(motivo).not.toBeNull();
    expect(motivo).toContain("nao e valida");
  });

  it("motivoDeRecusa: ficha ausente tem motivo próprio (não o de URL inválida) e vence a falta de canal", async () => {
    const { motivoDeRecusa } = await carregar();
    expect(motivoDeRecusa(null, REF_OFICIAL)).toContain("nao trouxe a ficha");
    expect(motivoDeRecusa(undefined, REF_OFICIAL)).toContain(
      "nao trouxe a ficha",
    );
    expect(motivoDeRecusa(null, null)).toContain("nao trouxe a ficha");
  });

  it("motivoDeRecusa: o motivo do banco errado cita o host da ficha E o oficial esperado", async () => {
    const { motivoDeRecusa } = await carregar();
    const motivo = motivoDeRecusa(
      conexaoDe(`${REF_ANTIGO}.supabase.co`),
      REF_OFICIAL,
    );
    expect(motivo).toContain(`${REF_ANTIGO}.supabase.co`);
    expect(motivo).toContain(`${REF_OFICIAL}.supabase.co`);
  });

  it("motivoDeRecusa: host com prefixo enganoso, com porta ou com subdomínio é recusado", async () => {
    const { motivoDeRecusa } = await carregar();
    for (const host of [
      `x${REF_OFICIAL}.supabase.co`,
      `${REF_OFICIAL}.supabase.co:8443`,
      `a.${REF_OFICIAL}.supabase.co`,
      `${REF_OFICIAL}.supabase.com`,
    ])
      expect(motivoDeRecusa(conexaoDe(host), REF_OFICIAL)).not.toBeNull();
  });

  it("motivoDeRecusa: ref esperado vazio ou ausente = IKCOUS fora do canal; ok devolve null de verdade", async () => {
    const { motivoDeRecusa } = await carregar();
    const boa = conexaoDe(`${REF_OFICIAL}.supabase.co`);
    expect(motivoDeRecusa(boa, "")).toContain("canais-de-backend");
    expect(motivoDeRecusa(boa, undefined)).toContain("canais-de-backend");
    expect(motivoDeRecusa(boa, REF_OFICIAL)).toBeNull();
  });
});
