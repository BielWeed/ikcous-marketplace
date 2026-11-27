// @vitest-environment jsdom
//
// Enviar pergunta (`addQuestion`, useQuestions) quando a conexão CAI no meio
// (27/11/2026). No iPhone, trocar de app durante o envio derruba o fetch na
// hora: o supabase-js não lança, devolve `{ error: { message: "TypeError:
// Load failed", code: "" } }` (postgrest-js 2.117.2). O servidor PODE já ter
// gravado. Antes, só o prazo esgotado guardava o id para o reenvio: na queda
// rápida a tela dizia "Erro ao enviar pergunta.", a cliente tocava de novo e o
// reenvio saía com id NOVO — pergunta duplicada (`questions` não tem trava
// única além da chave primária).
import { useQuestions } from "@/hooks/useQuestions";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

type LinhaEnviada = {
  id: string;
  product_id: string;
  user_id: string;
  question: string;
};

type Desfecho = "grava-e-cai" | "cai-sem-gravar" | "responde-502" | "grava";

const h = vi.hoisted(() => ({
  banco: [] as LinhaEnviada[],
  idsEnviados: [] as string[],
  desfechos: [] as Desfecho[],
  leituraCai: false,
}));

// A forma EXATA do `.catch` do `PostgrestBuilder.then` quando o fetch rejeita.
const quedaDoFetch = () => ({
  data: null,
  error: {
    message: "TypeError: Load failed",
    details: "TypeError: Load failed",
    hint: "",
    code: "",
  },
});

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
        return b;
      };
      const responder = () => {
        if (tabela !== "questions") return { data: [], error: null };
        if (!linha) {
          if (h.leituraCai) return quedaDoFetch();
          return {
            data: h.banco.map((l) => ({
              ...l,
              created_at: "2026-11-27T00:00:00Z",
              answers: [],
            })),
            error: null,
          };
        }
        h.idsEnviados.push(linha.id);
        if (h.banco.some((l) => l.id === linha?.id)) {
          return {
            data: null,
            error: {
              code: "23505",
              message:
                'duplicate key value violates unique constraint "questions_pkey"',
            },
          };
        }
        const desfecho = h.desfechos.shift() ?? "grava";
        if (desfecho === "responde-502") {
          return {
            data: null,
            error: { message: "Bad Gateway", details: "", hint: "", code: "" },
          };
        }
        if (desfecho !== "cai-sem-gravar") h.banco.push(linha);
        if (desfecho !== "grava") return quedaDoFetch();
        return {
          data: { ...linha, created_at: "2026-11-27T00:00:00Z" },
          error: null,
        };
      };
      // biome-ignore lint/suspicious/noThenProperty: builder Supabase simulado
      b.then = (
        resolve: (valor: unknown) => unknown,
        reject: (motivo: unknown) => unknown,
      ) => Promise.resolve(responder()).then(resolve, reject);
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

beforeEach(async () => {
  vi.clearAllMocks();
  h.banco = [];
  h.idsEnviados = [];
  h.desfechos = [];
  h.leituraCai = false;
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
  vi.restoreAllMocks();
});

const pergunta = { productId: "produto-id", question: "Tem azul?" };
const AVISO_DA_QUEDA =
  "A conexão caiu. Sua pergunta pode ter sido recebida. Confira antes de tentar de novo.";
const erroDoToast = () =>
  vi.mocked(toast.error).mock.calls.map(([mensagem]) => String(mensagem));

async function enviar() {
  let resultado: unknown = "ainda não";
  await act(async () => {
    resultado = await questions.addQuestion(pergunta);
  });
  return resultado;
}

it("o servidor gravou e a conexão caiu: a releitura acha a pergunta e não há segunda gravação", async () => {
  h.desfechos = ["grava-e-cai"];

  const resultado = await enviar();

  expect(resultado).toMatchObject({ id: h.banco[0]?.id });
  expect(h.banco).toHaveLength(1);
  expect(h.idsEnviados).toHaveLength(1);
  expect(erroDoToast()).not.toContain("Erro ao enviar pergunta.");
});

it("gravou, caiu e a releitura TAMBÉM caiu: o reenvio usa o MESMO id e o banco fica com uma pergunta só", async () => {
  h.desfechos = ["grava-e-cai"];
  h.leituraCai = true;

  expect(await enviar()).toBeNull();
  expect(erroDoToast()).toEqual([AVISO_DA_QUEDA]);

  // A cliente toca de novo com a rede de volta.
  h.leituraCai = false;
  const segunda = await enviar();

  expect(h.idsEnviados).toHaveLength(2);
  expect(h.idsEnviados[1]).toBe(h.idsEnviados[0]);
  expect(h.banco).toHaveLength(1);
  expect(segunda).toMatchObject({ id: h.idsEnviados[0] });
  expect(vi.mocked(toast.success)).toHaveBeenCalledWith(
    "Pergunta enviada com sucesso!",
  );
});

it("caiu ANTES de gravar: avisa para conferir e o reenvio grava uma vez com o mesmo id", async () => {
  h.desfechos = ["cai-sem-gravar"];

  expect(await enviar()).toBeNull();
  expect(erroDoToast()).toEqual([AVISO_DA_QUEDA]);

  const segunda = await enviar();

  expect(h.idsEnviados[1]).toBe(h.idsEnviados[0]);
  expect(h.banco).toHaveLength(1);
  expect(segunda).toBeTruthy();
});

it("controle: erro HTTP com corpo e sem código continua 'Erro ao enviar pergunta.' e não guarda o id", async () => {
  // Um 502 de gateway: o servidor RESPONDEU (com corpo), só que sem código.
  h.desfechos = ["responde-502"];

  expect(await enviar()).toBeNull();
  expect(erroDoToast()).toEqual(["Erro ao enviar pergunta."]);

  await enviar();
  expect(h.idsEnviados).toHaveLength(2);
  expect(h.idsEnviados[1]).not.toBe(h.idsEnviados[0]);
});
