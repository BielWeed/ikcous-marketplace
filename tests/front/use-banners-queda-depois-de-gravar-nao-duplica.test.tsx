// @vitest-environment jsdom
//
// A conexão cai DEPOIS de o banco gravar o banner novo: o supabase-js devolve
// `{ message: "TypeError: Failed to fetch", code: "" }`. A tela dizia "Erro ao
// adicionar banner." e não relia a lista; o segundo Salvar fazia outro INSERT,
// e todas as clientes viam o mesmo banner duas vezes. Agora o id do banner
// nasce no aparelho e vai no INSERT: a repetição com o mesmo id bate na chave
// primária (23505 `banners_pkey`), que quer dizer "já gravou" — sucesso, não
// cópia. Aqui o dublê é um banco de verdade em memória, que guarda a linha
// mesmo quando a resposta se perde.
import { useBanners } from "@/hooks/useBanners";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Linha = Record<string, unknown> & { id: string };

const h = vi.hoisted(() => ({
  banco: [] as Array<Record<string, unknown> & { id: string }>,
  // Como a próxima resposta do INSERT se comporta depois de o banco decidir.
  respostaDoInsert: "normal" as "normal" | "queda" | "recusa",
  inseridos: [] as unknown[],
  toastWarning: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  toastInfo: vi.fn(),
}));

const QUEDA = { message: "TypeError: Failed to fetch", code: "" };

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        order: () => ({
          order: async () => ({ data: [...h.banco], error: null }),
        }),
        // A releitura do banner recuperado é por id.
        eq: (_coluna: string, valor: string) => ({
          maybeSingle: async () => ({
            data: h.banco.find((l) => l.id === valor) ?? null,
            error: null,
          }),
          order: () => ({
            order: async () => ({ data: [], error: null }),
          }),
        }),
      }),
      insert: (linhas: Array<Record<string, unknown>>) => ({
        select: () => ({
          single: async () => {
            h.inseridos.push(linhas);
            if (h.respostaDoInsert === "recusa") {
              return {
                data: null,
                error: { code: "42501", message: "permission denied" },
              };
            }
            const nova = {
              ...linhas[0],
              id:
                (linhas[0].id as string | undefined) ??
                `gerado-${h.banco.length}`,
            };
            if (h.banco.some((l) => l.id === nova.id)) {
              return {
                data: null,
                error: {
                  code: "23505",
                  message:
                    'duplicate key value violates unique constraint "banners_pkey"',
                },
              };
            }
            h.banco.push(nova);
            if (h.respostaDoInsert === "queda") {
              return { data: null, error: QUEDA };
            }
            return { data: nova, error: null };
          },
        }),
      }),
      update: () => ({
        eq: () => ({ select: async () => ({ data: [], error: null }) }),
      }),
    }),
    rpc: vi.fn(),
    storage: { from: () => ({ remove: vi.fn() }) },
  },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isAdmin: true }) }));
vi.mock("@/hooks/useDataVault", () => ({ useSyncListener: () => {} }));
vi.mock("@/lib/dataVault", () => ({
  DataVault: {
    init: async () => ({
      getAll: async () => [],
      replaceAll: async () => {},
      setLastSync: vi.fn(),
    }),
  },
}));
vi.mock("sonner", () => ({
  toast: {
    success: h.toastSuccess,
    error: h.toastError,
    warning: h.toastWarning,
    info: h.toastInfo,
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const existente: Linha = {
  id: "existente",
  image_url: "https://exemplo.com/existente.png",
  title: "Existente",
  position: "home_top",
  active: true,
  order: 1,
};

const novoBanner = {
  imageUrl: "https://exemplo.com/novo.png",
  title: "Novo",
  position: "home_top" as const,
  active: true,
  order: 2,
};

const ID_DO_EDITOR = "6f1c2a4e-0b7d-4c1e-9a3f-2d5e8b7c9a10";

const novosNoBanco = () => h.banco.filter((l) => l.id !== "existente");

describe("banners: a conexão cai depois de o banner novo gravar", () => {
  const raizes: Root[] = [];
  const alvos: HTMLDivElement[] = [];
  let hook!: () => ReturnType<typeof useBanners>;

  async function montar() {
    let atual!: ReturnType<typeof useBanners>;
    function Sonda() {
      const valor = useBanners(true);
      useEffect(() => {
        atual = valor;
      });
      return null;
    }
    const alvo = document.createElement("div");
    document.body.appendChild(alvo);
    const raiz = createRoot(alvo);
    raizes.push(raiz);
    alvos.push(alvo);
    await act(async () => raiz.render(<Sonda />));
    hook = () => atual;
  }

  async function adicionar(opcoes?: { idDoFormulario?: string }) {
    let resultado: { rejeitou: boolean; erro?: unknown; valor?: unknown } = {
      rejeitou: false,
    };
    await act(async () => {
      try {
        resultado.valor = await (
          hook().addBanner as (
            b: typeof novoBanner,
            o?: { idDoFormulario?: string },
          ) => Promise<unknown>
        )(novoBanner, opcoes);
      } catch (erro) {
        resultado = { rejeitou: true, erro };
      }
      await new Promise((r) => setTimeout(r, 0));
    });
    return resultado;
  }

  beforeEach(async () => {
    vi.resetModules();
    h.banco = [{ ...existente }];
    h.respostaDoInsert = "normal";
    h.inseridos = [];
    h.toastWarning.mockReset();
    h.toastError.mockReset();
    h.toastSuccess.mockReset();
    h.toastInfo.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    await montar();
    await act(async () => hook().refreshBanners(false, true));
  });

  afterEach(async () => {
    for (const raiz of raizes.splice(0)) {
      await act(async () => raiz.unmount());
    }
    for (const alvo of alvos.splice(0)) alvo.remove();
    vi.restoreAllMocks();
  });

  it("gravou, caiu, toca Salvar de novo: o banco fica com UM banner novo", async () => {
    h.respostaDoInsert = "queda";
    const primeira = await adicionar({ idDoFormulario: ID_DO_EDITOR });
    expect(primeira.rejeitou).toBe(true);

    h.respostaDoInsert = "normal";
    const segunda = await adicionar({ idDoFormulario: ID_DO_EDITOR });

    // As duas tentativas levaram o MESMO id gerado no aparelho.
    expect(h.inseridos).toHaveLength(2);
    for (const linhas of h.inseridos) {
      expect((linhas as Linha[])[0].id).toBe(ID_DO_EDITOR);
    }
    // A repetição bateu na chave primária e virou sucesso, não cópia.
    expect(segunda.rejeitou).toBe(false);
    expect((segunda.valor as { id: string }).id).toBe(ID_DO_EDITOR);
    expect(novosNoBanco()).toHaveLength(1);
    expect(hook().banners.filter((b) => b.id === ID_DO_EDITOR)).toHaveLength(1);
  });

  it("na queda avisa que não se sabe e relê a lista (o banner gravado aparece)", async () => {
    h.respostaDoInsert = "queda";
    await adicionar({ idDoFormulario: ID_DO_EDITOR });

    expect(h.toastError).not.toHaveBeenCalled();
    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect(h.toastWarning).toHaveBeenCalledTimes(1);
    expect(String(h.toastWarning.mock.calls[0][0])).toBe(
      "A conexão caiu e não sabemos se o banner foi salvo. Conferimos a lista.",
    );
    expect(hook().banners.some((b) => b.id === ID_DO_EDITOR)).toBe(true);
  });

  it("controle: recusa real do banco (42501) continua dizendo que não salvou", async () => {
    h.respostaDoInsert = "recusa";
    const r = await adicionar({ idDoFormulario: ID_DO_EDITOR });

    expect(r.rejeitou).toBe(true);
    expect(h.toastWarning).not.toHaveBeenCalled();
    expect(h.toastError).toHaveBeenCalledTimes(1);
    expect(novosNoBanco()).toHaveLength(0);
  });
});
