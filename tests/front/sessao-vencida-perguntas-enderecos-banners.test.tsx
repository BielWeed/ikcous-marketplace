import { useAddresses } from "@/hooks/useAddresses";
import { useBanners } from "@/hooks/useBanners";
import { useQuestions } from "@/hooks/useQuestions";
// @vitest-environment jsdom
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  erro: { message: "JWT expired", status: 401 } as unknown,
  toast: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: "conta-teste" },
    profile: null,
    isAdmin: true,
  }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
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
  toast: { error: h.toast, success: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: h.rpc,
    from: () => {
      let escrita = false;
      const cadeia: any = {
        insert: () => {
          escrita = true;
          return cadeia;
        },
        update: () => {
          escrita = true;
          return cadeia;
        },
        select: () => cadeia,
        single: () => cadeia,
        eq: () => cadeia,
        order: () => cadeia,
        // biome-ignore lint/suspicious/noThenProperty: o cliente do banco é "thenable" de propósito
        then: (resolve: (r: unknown) => unknown) =>
          Promise.resolve({
            data: escrita ? null : [],
            error: escrita ? h.erro : null,
          }).then(resolve),
      };
      return cadeia;
    },
  },
}));
// @ts-expect-error flag interna do React.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let raiz: Root;
let alvo: HTMLDivElement;
beforeEach(() => {
  h.erro = { message: "JWT expired", status: 401 };
  h.rpc.mockImplementation(async () => ({ error: h.erro }));
  h.toast.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
  localStorage.clear();
  alvo = document.createElement("div");
  raiz = createRoot(alvo);
});
afterEach(() => {
  act(() => raiz.unmount());
  alvo.remove();
  localStorage.clear();
  vi.restoreAllMocks();
});
async function montar<T>(usar: () => T): Promise<() => T> {
  let atual!: T;
  function Sonda() {
    const hook = usar();
    useEffect(() => {
      atual = hook;
    });
    return null;
  }
  await act(async () => raiz.render(<Sonda />));
  return () => atual;
}
it("pergunta: explica sessão vencida sem confirmar o envio", async () => {
  const hook = await montar(useQuestions);
  let resultado: unknown;
  await act(async () => {
    resultado = await hook().addQuestion({
      productId: "p",
      question: "Tem azul?",
    });
  });
  expect(resultado).toBeNull();
  expect(h.toast).toHaveBeenCalledWith(
    "Sua sessão expirou. Se a pergunta ainda estiver na tela, copie o texto antes de entrar de novo. Depois, envie a pergunta.",
  );
});
it("resposta silenciosa: mantém booleano e entrega a causa ao chamador", async () => {
  const hook = await montar(useQuestions);
  const onError = vi.fn();
  let resultado: unknown;
  await act(async () => {
    resultado = await hook().addAnswer(
      { questionId: "q", answer: "Sim" },
      { silent: true, onError },
    );
  });
  expect(resultado).toBe(false);
  expect(onError).toHaveBeenCalledWith(h.erro);
  expect(h.toast).not.toHaveBeenCalled();
});
it.each(["adicionar", "atualizar"])(
  "endereço: %s explica sessão vencida",
  async (acao) => {
    const hook = await montar(useAddresses);
    await act(async () => {
      if (acao === "atualizar")
        await hook().updateAddress("e", { street: "Rua Teste" });
      else
        await hook().addAddress({
          name: "Casa",
          recipient_name: "Pessoa Teste",
          cep: "38500-000",
          street: "Rua Teste",
          number: "1",
          complement: null,
          neighborhood: "Centro",
          city: "Cidade",
          state: "MG",
          reference: null,
          is_default: false,
        });
    });
    expect(h.toast).toHaveBeenCalledWith(
      "Sua sessão expirou. Se os dados do endereço ainda estiverem na tela, copie o que digitou antes de entrar de novo. Depois, salve o endereço outra vez.",
    );
  },
);
it("banner: criação explica sessão vencida e preserva a causa", async () => {
  const hook = await montar(() => useBanners(true));
  await act(async () => {
    await expect(
      hook().addBanner({
        imageUrl: "https://example.com/banner.png",
        title: "Teste",
        position: "home_top",
        active: true,
        order: 1,
      }),
    ).rejects.toBe(h.erro);
  });
  expect(h.toast).toHaveBeenCalledWith(
    "Sua sessão expirou. Se os dados do banner ainda estiverem na tela, copie o que digitou antes de entrar de novo. Depois, salve o banner outra vez.",
  );
});
it("controle: falha comum na pergunta conserva a mensagem anterior", async () => {
  h.erro = { message: "Falha de rede" };
  const hook = await montar(useQuestions);
  await act(async () => {
    await hook().addQuestion({ productId: "p", question: "Tem azul?" });
  });
  expect(h.toast).toHaveBeenCalledWith("Erro ao enviar pergunta.");
});
