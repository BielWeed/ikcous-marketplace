// @vitest-environment jsdom
import { chaveSobreviveAPurga } from "@/lib/localStoragePurgeWhitelist";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/novidades/notas-das-versoes.json", () => ({
  default: {
    "1.5.32": {
      titulo: "Pedidos mais claros",
      novidades: [],
      correcoes: ["Os pedidos abrem com mais facilidade."],
      melhorias: [],
    },
    "1.5.33": {
      titulo: "Mais facilidade no dia a dia",
      novidades: [],
      correcoes: [],
      melhorias: ["Encontre seus produtos mais rápido."],
    },
  },
}));

const CHAVE_ULTIMA_VISTA = "notificacoes-ultima-versao-vista-do-app-v1";
let ilha: typeof import("@/components/pwa/ao-iniciar-apos-atualizacao");
let armazenamento: typeof import("@/lib/novidades/armazenamento-local");
let estado: typeof import("@/lib/atualizacao/estado-da-atualizacao");

beforeEach(async () => {
  vi.resetModules();
  localStorage.clear();
  sessionStorage.clear();
  ilha = await import("@/components/pwa/ao-iniciar-apos-atualizacao");
  armazenamento = await import("@/lib/novidades/armazenamento-local");
  estado = await import("@/lib/atualizacao/estado-da-atualizacao");
});

afterEach(() => {
  estado.definirEstadoDaAtualizacao({ fase: "nenhuma", versaoNova: null });
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

describe("novidades no boot sem prova de recarga", () => {
  it("registra de 1.5.31 a 1.5.32 com sessionStorage vazio e sem anunciar Pronto", () => {
    localStorage.setItem(CHAVE_ULTIMA_VISTA, "1.5.31");
    expect(sessionStorage.length).toBe(0);

    expect(ilha.aoIniciarAposAtualizacao("1.5.32-sha.novo")).toBeNull();

    expect(armazenamento.listarNovidades()).toEqual([
      expect.objectContaining({
        versao: "1.5.32",
        titulo: "Pedidos mais claros",
        lida: false,
      }),
    ]);
    expect(localStorage.getItem(CHAVE_ULTIMA_VISTA)).toBe("1.5.32");
    expect(estado.obterEstadoDaAtualizacao().fase).toBe("nenhuma");
  });

  it("no primeiro boot só grava o núcleo atual, sem inventar novidades", () => {
    ilha.aoIniciarAposAtualizacao("1.5.32+build.primeiro");

    expect(localStorage.getItem(CHAVE_ULTIMA_VISTA)).toBe("1.5.32");
    expect(armazenamento.listarNovidades()).toEqual([]);
  });

  it("primeiro boot com prova de recarga anuncia Pronto e usa a origem provada para as novidades", async () => {
    const { gravaOrigemDeAtualizacao } = await import(
      "@/lib/motivo-de-recarga"
    );
    gravaOrigemDeAtualizacao("1.5.31-sha.antigo");

    ilha.aoIniciarAposAtualizacao("1.5.32-sha.novo");

    expect(estado.obterEstadoDaAtualizacao().fase).toBe("concluida");
    expect(localStorage.getItem(CHAVE_ULTIMA_VISTA)).toBe("1.5.32");
    // O aparelho vinha da 1.5.31, que nunca gravou a "última versão vista":
    // a origem provada pela própria atualização supre a chave.
    expect(armazenamento.listarNovidades().map((n) => n.versao)).toEqual([
      "1.5.32",
    ]);
  });

  it("origem ilegível ou sem prova de troca de build continua sem inventar histórico", async () => {
    const { gravaOrigemDeAtualizacao } = await import(
      "@/lib/motivo-de-recarga"
    );
    gravaOrigemDeAtualizacao("lixo");

    ilha.aoIniciarAposAtualizacao("1.5.32-sha.novo");

    expect(armazenamento.listarNovidades()).toEqual([]);
  });

  it("a mesma versão em outro build não duplica nem reabre notas lidas", () => {
    localStorage.setItem(CHAVE_ULTIMA_VISTA, "1.5.31");
    ilha.aoIniciarAposAtualizacao("1.5.32-sha.primeiro");
    armazenamento.marcarNovidadeComoLida("1.5.32");
    const antes = JSON.stringify(armazenamento.listarNovidades());

    ilha.aoIniciarAposAtualizacao("1.5.32-sha.segundo");

    expect(armazenamento.listarNovidades()).toHaveLength(1);
    expect(JSON.stringify(armazenamento.listarNovidades())).toBe(antes);
  });

  it("repetir uma faixa já registrada mantém a idempotência por versão", () => {
    localStorage.setItem(CHAVE_ULTIMA_VISTA, "1.5.31");
    ilha.aoIniciarAposAtualizacao("1.5.32");
    armazenamento.marcarNovidadeComoLida("1.5.32");
    const antes = JSON.stringify(armazenamento.listarNovidades());
    // Uma escrita interrompida pode deixar a última versão vista para trás.
    localStorage.setItem(CHAVE_ULTIMA_VISTA, "1.5.31");

    ilha.aoIniciarAposAtualizacao("1.5.32");

    expect(JSON.stringify(armazenamento.listarNovidades())).toBe(antes);
    expect(localStorage.getItem(CHAVE_ULTIMA_VISTA)).toBe("1.5.32");
  });

  it("registra todas as notas entre a última versão vista e a atual", () => {
    localStorage.setItem(CHAVE_ULTIMA_VISTA, "1.5.31");

    ilha.aoIniciarAposAtualizacao("1.5.33");

    expect(armazenamento.listarNovidades().map(({ versao }) => versao)).toEqual(
      ["1.5.33", "1.5.32"],
    );
  });

  it("origem ilegível só é substituída e destino ilegível não apaga a origem", () => {
    localStorage.setItem(CHAVE_ULTIMA_VISTA, "ilegível");
    ilha.aoIniciarAposAtualizacao("1.5.32");
    expect(localStorage.getItem(CHAVE_ULTIMA_VISTA)).toBe("1.5.32");
    expect(armazenamento.listarNovidades()).toEqual([]);

    ilha.aoIniciarAposAtualizacao("ilegível");
    expect(localStorage.getItem(CHAVE_ULTIMA_VISTA)).toBe("1.5.32");
  });

  it("a chave da última versão vista usa notificacoes- e sobrevive à purga", () => {
    ilha.aoIniciarAposAtualizacao("1.5.32");

    expect(CHAVE_ULTIMA_VISTA.startsWith("notificacoes-")).toBe(true);
    expect(chaveSobreviveAPurga(CHAVE_ULTIMA_VISTA)).toBe(true);
    expect(localStorage.getItem(CHAVE_ULTIMA_VISTA)).toBe("1.5.32");
  });

  it.each(["getItem", "setItem"] as const)(
    "localStorage.%s lançando não quebra o boot",
    (metodo) => {
      const real = window.localStorage;
      const lancar = () => {
        throw new DOMException("Armazenamento indisponível", "SecurityError");
      };
      vi.spyOn(window, "localStorage", "get").mockReturnValue({
        getItem: metodo === "getItem" ? lancar : real.getItem.bind(real),
        setItem: metodo === "setItem" ? lancar : real.setItem.bind(real),
        removeItem: real.removeItem.bind(real),
        clear: real.clear.bind(real),
        key: real.key.bind(real),
        length: 0,
      } as Storage);

      expect(() => ilha.aoIniciarAposAtualizacao("1.5.32")).not.toThrow();
    },
  );

  it("acessar o próprio localStorage lançando não quebra o boot", () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new DOMException("Armazenamento indisponível", "SecurityError");
    });

    expect(() => ilha.aoIniciarAposAtualizacao("1.5.32")).not.toThrow();
  });
});
