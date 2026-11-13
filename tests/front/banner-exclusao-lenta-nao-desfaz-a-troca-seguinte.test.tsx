// @vitest-environment jsdom
//
// Excluir um banner dispara a "arrumação" das posições no banco (lê a ordem e
// grava cada posição numa gravação separada), sem a tela esperar por ela. Com
// rede lenta a lojista já troca dois banners de lugar (uma RPC só) enquanto a
// arrumação antiga ainda grava — e, se ela termina por último, devolve a ordem
// de antes da troca. Aqui a arrumação fica presa, a troca é pedida e só depois
// as gravações antigas chegam: a ordem final tem de ser a da TROCA.
import { useBanners } from "@/hooks/useBanners";
import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const banco = vi.hoisted(() => ({
  linhas: [] as {
    id: string;
    order: number;
    position: string;
    title: string;
    image_url: string;
    active: boolean;
  }[],
  // Enquanto houver uma promessa aqui, as gravações de `order` ficam presas.
  seguraAsGravacoes: null as Promise<void> | null,
  gravacaoFalha: false,
  chamadasDaRpc: [] as string[],
}));
const toasts = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: (_colunas: string) => ({
        order: () =>
          Promise.resolve({
            data: banco.linhas.map((b) => ({ ...b })),
            error: null,
          }),
        eq: (_campo: string, pos: string) => ({
          order: () => ({
            order: () =>
              Promise.resolve({
                data: banco.linhas
                  .filter((b) => b.position === pos)
                  .map((b) => ({ id: b.id, order: b.order }))
                  .sort(
                    (a, b) => a.order - b.order || a.id.localeCompare(b.id),
                  ),
                error: null,
              }),
          }),
        }),
      }),
      update: (dados: { order: number }) => ({
        eq: (_campo: string, id: string) =>
          (banco.seguraAsGravacoes ?? Promise.resolve()).then(() => {
            if (banco.gravacaoFalha) return { error: { message: "boom" } };
            Object.assign(banco.linhas.find((b) => b.id === id)!, dados);
            return { error: null };
          }),
      }),
      delete: () => ({
        eq: (_campo: string, id: string) => ({
          select: () => {
            banco.linhas = banco.linhas.filter((b) => b.id !== id);
            return Promise.resolve({ data: [{ id }], error: null });
          },
        }),
      }),
    }),
    rpc: (
      _nome: string,
      args: { p_banner_id_1: string; p_banner_id_2: string },
    ) => {
      banco.chamadasDaRpc.push(`${args.p_banner_id_1}<->${args.p_banner_id_2}`);
      const um = banco.linhas.find((b) => b.id === args.p_banner_id_1)!;
      const dois = banco.linhas.find((b) => b.id === args.p_banner_id_2)!;
      [um.order, dois.order] = [dois.order, um.order];
      return Promise.resolve({ error: null });
    },
    storage: { from: () => ({ remove: () => Promise.resolve({}) }) },
  },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isAdmin: true }) }));
vi.mock("@/hooks/useDataVault", () => ({ useSyncListener: () => {} }));
vi.mock("@/lib/dataVault", () => ({
  DataVault: {
    init: vi.fn().mockResolvedValue({
      getAll: vi.fn().mockResolvedValue([]),
      replaceAll: vi.fn().mockResolvedValue(undefined),
      setLastSync: vi.fn(),
    }),
  },
}));
vi.mock("sonner", () => ({ toast: toasts }));
// @ts-expect-error flag interna do React.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let atual: ReturnType<typeof useBanners>;
const host = document.createElement("div");
let raiz: ReturnType<typeof createRoot>;
function Sonda() {
  const resultado = useBanners(true);
  useEffect(() => {
    atual = resultado;
  });
  return (
    <p>
      {resultado.banners
        .slice()
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        .map((b) => b.id)
        .join(",")}
    </p>
  );
}

const ordemNoBanco = () =>
  banco.linhas
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((b) => b.id)
    .join(",");

const umTurno = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

beforeEach(async () => {
  banco.linhas = ["a-primeiro", "b-segundo", "c-terceiro"].map((id, i) => ({
    id,
    order: i + 1,
    position: "home_top",
    title: id,
    image_url: "https://loja.test/banner.jpg",
    active: true,
  }));
  banco.seguraAsGravacoes = null;
  banco.gravacaoFalha = false;
  banco.chamadasDaRpc = [];
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  document.body.appendChild(host);
  raiz = createRoot(host);
  await act(async () => raiz.render(<Sonda />));
  await act(async () => atual.refreshBanners(false, true));
});
afterEach(() => {
  act(() => raiz.unmount());
  host.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const t of Object.values(toasts)) t.mockClear();
});

describe("excluir banner e trocar outro logo depois", () => {
  it("a arrumação lenta da exclusão não desfaz a troca feita depois", async () => {
    let soltar!: () => void;
    banco.seguraAsGravacoes = new Promise<void>((resolve) => {
      soltar = resolve;
    });

    await act(async () => atual.deleteBanner("a-primeiro"));
    expect(host.textContent).toBe("b-segundo,c-terceiro");

    let troca!: Promise<void>;
    await act(async () => {
      troca = atual.reorderBanners("c-terceiro", "b-segundo");
      await umTurno();
    });
    expect(host.textContent).toBe("c-terceiro,b-segundo");

    // A rede "destrava": as gravações antigas chegam depois da troca pedida.
    await act(async () => {
      soltar();
      await troca;
      await umTurno();
    });

    expect(banco.chamadasDaRpc).toEqual(["c-terceiro<->b-segundo"]);
    expect(ordemNoBanco()).toBe("c-terceiro,b-segundo");
    expect(host.textContent).toBe("c-terceiro,b-segundo");
  });

  it("controle: excluir sem troca arruma as posições no banco", async () => {
    await act(async () => atual.deleteBanner("a-primeiro"));
    await act(async () => umTurno());

    expect(banco.linhas.map((b) => [b.id, b.order])).toEqual([
      ["b-segundo", 1],
      ["c-terceiro", 2],
    ]);
    expect(host.textContent).toBe("b-segundo,c-terceiro");
    expect(toasts.success).toHaveBeenCalledWith("Banner excluído com sucesso!");
  });

  it("controle: trocar sem excluir chama a RPC uma vez e troca no banco", async () => {
    await act(async () => atual.reorderBanners("c-terceiro", "a-primeiro"));

    expect(banco.chamadasDaRpc).toEqual(["c-terceiro<->a-primeiro"]);
    expect(ordemNoBanco()).toBe("c-terceiro,b-segundo,a-primeiro");
    expect(host.textContent).toBe("c-terceiro,b-segundo,a-primeiro");
    expect(toasts.error).not.toHaveBeenCalled();
  });

  it("controle: erro na arrumação continua só no console, sem aviso nem travar a próxima troca", async () => {
    banco.gravacaoFalha = true;
    await act(async () => atual.deleteBanner("a-primeiro"));
    await act(async () => umTurno());

    expect(console.error).toHaveBeenCalledWith(
      "[Banners] Error normalizing banners order:",
      { message: "boom" },
    );
    expect(toasts.error).not.toHaveBeenCalled();
    expect(toasts.success).toHaveBeenCalledWith("Banner excluído com sucesso!");

    banco.gravacaoFalha = false;
    await act(async () => atual.reorderBanners("c-terceiro", "b-segundo"));
    expect(banco.chamadasDaRpc).toEqual(["c-terceiro<->b-segundo"]);
    expect(toasts.error).not.toHaveBeenCalled();
  });

  it("arrumação pendurada para sempre não prende a troca: passados 20 s ela segue", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    banco.seguraAsGravacoes = new Promise<void>(() => {});

    await act(async () => atual.deleteBanner("a-primeiro"));
    let troca!: Promise<void>;
    await act(async () => {
      troca = atual.reorderBanners("c-terceiro", "b-segundo");
      await vi.advanceTimersByTimeAsync(19_000);
    });
    expect(banco.chamadasDaRpc).toEqual([]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
      await troca;
    });
    expect(banco.chamadasDaRpc).toEqual(["c-terceiro<->b-segundo"]);
  });
});
