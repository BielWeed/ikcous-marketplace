// @vitest-environment jsdom
//
// Enviar pergunta (`addQuestion`, useQuestions): o id da pergunta é gerado no
// aparelho e GUARDADO quando o envio fica sem resposta (rede pendurada) ou o
// banco devolve chave primária repetida. O reenvio reaproveita o mesmo id, e é
// isso que impede a pergunta de ir duas vezes ao banco. Caça por mutação
// (24/11/2026): dois pontos desse mecanismo sobreviviam à suíte vizinha
// (perguntas-e-avaliacoes-rede-pendurada):
//  1. O id guardado SAI da lista quando o envio vale. Sem isso, a mesma
//     pergunta (mesmo texto, mesmo produto) feita DEPOIS reaproveitava o id
//     velho, batia na chave primária e a cliente via "enviada" sem que nada
//     novo fosse gravado.
//  2. "Chave primária repetida" exige as DUAS coisas: código 23505 E o nome da
//     chave `questions_pkey`. Outra restrição única (código 23505 de outra
//     chave), ou texto de chave sem o código, é erro comum: aviso de erro, não
//     o aviso de "conexão lenta, pode ter sido recebida".
import { useQuestions } from "@/hooks/useQuestions";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

type LinhaEnviada = {
  id?: string;
  product_id: string;
  user_id: string;
  question: string;
};

const h = vi.hoisted(() => ({
  gravarPergunta: null as ((linha: LinhaEnviada) => unknown) | null,
  idsEnviados: [] as (string | undefined)[],
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "comprador-ficticio" }, isAdmin: false }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      let envio = false;
      let linha: LinhaEnviada | undefined;
      const b: any = {};
      for (const nome of [
        "select",
        "eq",
        "order",
        "in",
        "maybeSingle",
        "single",
        "abortSignal",
        "limit",
      ]) {
        // eslint-disable-next-line security/detect-object-injection -- nomes fixos do builder de teste
        b[nome] = () => b;
      }
      b.insert = (nova: LinhaEnviada) => {
        linha = nova;
        envio = true;
        h.idsEnviados.push(nova.id);
        return b;
      };
      // biome-ignore lint/suspicious/noThenProperty: builder Supabase simulado
      b.then = (
        resolve: (valor: unknown) => unknown,
        reject: (motivo: unknown) => unknown,
      ) => {
        const resposta =
          envio && tabela === "questions" && h.gravarPergunta && linha
            ? h.gravarPergunta(linha)
            : { data: [], error: null };
        return Promise.resolve(resposta).then(resolve, reject);
      };
      return b;
    },
  },
}));

// @ts-expect-error flag interna do React
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root;
let host: HTMLDivElement;
let questions: ReturnType<typeof useQuestions>;
function Sonda() {
  const q = useQuestions();
  useEffect(() => {
    questions = q;
  });
  return null;
}

const gravada = (linha: LinhaEnviada) => ({
  data: { ...linha, created_at: "2026-11-07T00:00:00Z" },
  error: null,
});

beforeEach(async () => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  h.gravarPergunta = null;
  h.idsEnviados = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
  host = document.createElement("div");
  raiz = createRoot(host);
  await act(async () => {
    raiz.render(<Sonda />);
  });
});
afterEach(() => {
  act(() => raiz.unmount());
  host.remove();
  window.localStorage.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const erroDoToast = () =>
  vi.mocked(toast.error).mock.calls.map(([mensagem]) => String(mensagem));

it("o id guardado de um envio sem resposta serve ao reenvio e SAI da lista quando o envio vale", async () => {
  const pergunta = { productId: "produto-id", question: "Tem azul?" };
  let primeiraTentativa = true;
  h.gravarPergunta = (linha) => {
    if (primeiraTentativa) {
      primeiraTentativa = false;
      return new Promise(() => {});
    }
    return gravada(linha);
  };

  // 1) envio sem resposta: nada confirmado, id guardado
  await act(async () => {
    void questions.addQuestion(pergunta);
    await vi.advanceTimersByTimeAsync(15001);
  });
  // 2) reenvio: mesmo id, e agora vale
  await act(async () => {
    expect(await questions.addQuestion(pergunta)).toBeTruthy();
  });
  // 3) a MESMA pergunta, feita de novo depois: id NOVO
  await act(async () => {
    expect(await questions.addQuestion(pergunta)).toBeTruthy();
  });

  expect(h.idsEnviados).toHaveLength(3);
  const [primeiro, segundo, terceiro] = h.idsEnviados;
  expect(primeiro).toEqual(expect.any(String));
  expect(segundo).toBe(primeiro);
  expect(terceiro).toEqual(expect.any(String));
  expect(terceiro).not.toBe(primeiro);
});

it.each([
  [
    "código 23505 de OUTRA restrição única",
    {
      code: "23505",
      message:
        'duplicate key value violates unique constraint "questions_x_key"',
    },
  ],
  [
    "texto da chave primária sem o código 23505",
    { code: "XX000", message: 'violates "questions_pkey"' },
  ],
  ["erro sem código e sem texto conhecido", { message: "boom" }],
])(
  "%s: é erro comum, não 'conexão lenta, pode ter sido recebida'",
  async (_nome, erro) => {
    h.gravarPergunta = () => ({ data: null, error: erro });

    let resultado: unknown = "ainda não";
    await act(async () => {
      resultado = await questions.addQuestion({
        productId: "produto-erro",
        question: "Tem azul?",
      });
    });

    expect(resultado).toBeNull();
    expect(erroDoToast()).toEqual(["Erro ao enviar pergunta."]);
    expect(vi.mocked(toast.success)).not.toHaveBeenCalled();
  },
);

it("controle: chave primária repetida de verdade (23505 + questions_pkey) sem a linha na releitura segue como 'conexão lenta'", async () => {
  h.gravarPergunta = () => ({
    data: null,
    error: { code: "23505", message: 'violates "questions_pkey"' },
  });

  let resultado: unknown = "ainda não";
  await act(async () => {
    resultado = await questions.addQuestion({
      productId: "produto-pkey",
      question: "Tem azul?",
    });
  });

  // Quem manda é a conferência: sem a linha na releitura, não há confirmação.
  expect(resultado).toBeNull();
  expect(erroDoToast()).toEqual([
    "A conexão está lenta. Sua pergunta pode ter sido recebida. Confira antes de tentar de novo.",
  ]);
});
