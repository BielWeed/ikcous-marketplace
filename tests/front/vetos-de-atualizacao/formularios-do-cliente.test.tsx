// @vitest-environment jsdom
import { useDevolucaoCliente } from "@/hooks/useDevolucaoCliente";
import { useQuestions } from "@/hooks/useQuestions";
import { useReviews } from "@/hooks/useReviews";
import {
  haOperacaoSensivel,
  motivosDeOperacaoSensivel,
} from "@/lib/atualizacao/operacao-sensivel";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { adiar } from "./apoio";

const rede = vi.hoisted(() => ({
  rpc: vi.fn(),
  insert: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: rede.rpc,
    storage: {
      from: () => ({ upload: rede.upload, remove: rede.remove }),
    },
    from: () => ({
      insert: () => ({ select: () => ({ single: rede.insert }) }),
      select: () => {
        // As releituras após gravar respondem imediatamente com lista vazia.
        const resposta = { data: [], error: null };
        const consulta = Promise.resolve(resposta) as Promise<
          typeof resposta
        > & {
          eq: () => typeof consulta;
          order: () => typeof consulta;
          maybeSingle: () => typeof consulta;
          abortSignal: () => typeof consulta;
        };
        consulta.eq = () => consulta;
        consulta.order = () => consulta;
        consulta.maybeSingle = () => consulta;
        consulta.abortSignal = () => consulta;
        return consulta;
      },
    }),
  },
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "cliente-1" }, isAdmin: false }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("@/lib/redimensiona-imagem", () => ({
  redimensionarImagem: async (arquivo: File) => arquivo,
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.hoisted(() => {
  if (typeof globalThis.BroadcastChannel === "undefined") {
    Object.assign(globalThis, {
      BroadcastChannel: class {
        postMessage() {}
        addEventListener() {}
        removeEventListener() {}
        close() {}
      },
    });
  }
});

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let devolucao: ReturnType<typeof useDevolucaoCliente>;
let avaliacoes: ReturnType<typeof useReviews>;
let perguntas: ReturnType<typeof useQuestions>;
function Sonda() {
  const d = useDevolucaoCliente("pedido-1", false);
  const a = useReviews();
  const p = useQuestions();
  useEffect(() => {
    devolucao = d;
    avaliacoes = a;
    perguntas = p;
  });
  return null;
}

const casos = [
  {
    ponto: "solicitação de devolução",
    motivo: "solicitacao-de-devolucao",
    duble: rede.rpc,
    chamar: () =>
      devolucao.solicitar({
        itens: [{ order_item_id: "item-1", quantidade: 1 }],
        motivo: "defeito",
        detalhe: "defeito",
        resolucao: "troca",
        metodo: "envio_proprio",
        fotos: [],
      }),
    data: { id: "dev-1", protocolo: "D1", tipo: "vicio", status: "solicitada" },
  },
  {
    ponto: "foto de devolução",
    motivo: "foto-de-devolucao",
    duble: rede.upload,
    chamar: () =>
      devolucao.enviarFoto(
        new File(["foto"], "f.jpg", { type: "image/jpeg" }),
        "cliente-1",
      ),
    data: null,
  },
  {
    ponto: "descarte de foto de devolução",
    motivo: "descarte-de-fotos-de-devolucao",
    duble: rede.remove,
    chamar: () => devolucao.descartarFotos(["cliente-1/pedido-1/f.jpg"]),
    data: [],
  },
  {
    ponto: "cancelamento de devolução",
    motivo: "cancelamento-de-devolucao",
    duble: rede.rpc,
    chamar: () => devolucao.cancelar("dev-1"),
    data: { id: "dev-1", status: "cancelada" },
  },
  {
    ponto: "envio de devolução",
    motivo: "envio-de-devolucao",
    duble: rede.rpc,
    chamar: () => devolucao.informarEnvio("dev-1", "BR123"),
    data: { id: "dev-1", status: "em_transito" },
  },
  {
    ponto: "avaliação",
    motivo: "envio-de-avaliacao",
    duble: rede.insert,
    chamar: () =>
      avaliacoes.addReview({
        productId: "produto-1",
        rating: 5,
        comment: "Gostei",
      }),
    data: { id: "review-1" },
  },
  {
    ponto: "pergunta",
    motivo: "envio-de-pergunta",
    duble: rede.insert,
    chamar: () =>
      perguntas.addQuestion({
        productId: "produto-1",
        question: "Qual o tamanho?",
      }),
    data: { id: "pergunta-1" },
  },
];

describe("formulários do cliente vetam atualização durante gravações", () => {
  let raiz: Root;
  let host: HTMLDivElement;
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
    await act(async () => {
      raiz.render(<Sonda />);
    });
  });
  afterEach(() => {
    act(() => raiz.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  describe.each(casos)("$ponto", ({ motivo, duble, chamar, data }) => {
    it.each(["sucesso", "erro", "rejeicao"])(
      "veta enquanto pendente e libera após %s",
      async (desfecho) => {
        const envio = adiar<{ data: unknown; error: unknown }>();
        duble.mockReturnValue(envio.promessa);
        let resultado!: Promise<unknown>;
        await act(async () => {
          resultado = chamar();
        });
        try {
          expect(duble).toHaveBeenCalledTimes(1);
          expect(haOperacaoSensivel()).toBe(true);
          expect(motivosDeOperacaoSensivel()).toEqual([motivo]);
        } finally {
          await act(async () => {
            if (desfecho === "rejeicao") {
              envio.rejeitar(new Error("falha simulada"));
            } else {
              envio.resolver({
                data,
                error:
                  desfecho === "erro" ? { message: "falha simulada" } : null,
              });
            }
            await resultado;
          });
        }
        expect(haOperacaoSensivel()).toBe(false);
      },
    );
  });
});
