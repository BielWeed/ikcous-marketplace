// @vitest-environment jsdom
// ProductQA e useQuestions reais: o finally da consulta cancelada não pode
// encerrar o carregamento de outra consulta ainda pendente do mesmo produto.
import { ProductQA } from "@/components/ui/custom/ProductQA";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

type Resultado = {
  data: unknown;
  error: { name: string; message: string } | null;
};
type Consulta = {
  produto: string;
  signal: AbortSignal | null;
  respondeu: boolean;
  terminar: (resultado: Resultado) => void;
};
const h = vi.hoisted(() => {
  class CanalFalso {
    postMessage() {}
    addEventListener() {}
    removeEventListener() {}
    close() {}
  }
  vi.stubGlobal("BroadcastChannel", CanalFalso);
  return {
    CanalFalso,
    consultas: [] as Consulta[],
    handlers: new Map<string, (payload: unknown) => void>(),
  };
});

function builder(promessa: Promise<Resultado>, consulta?: Consulta) {
  const b = {
    select: () => b,
    order: () => b,
    in: () => b,
    maybeSingle: () => b,
    eq: (coluna: string, valor: string) => {
      if (consulta && coluna === "product_id") consulta.produto = valor;
      return b;
    },
    abortSignal: (signal: AbortSignal) => {
      if (consulta) {
        consulta.signal = signal;
        const cancelar = () =>
          consulta.terminar({
            data: null,
            error: { name: "AbortError", message: "aborted" },
          });
        if (signal.aborted) cancelar();
        else signal.addEventListener("abort", cancelar, { once: true });
      }
      return b;
    },
    // biome-ignore lint/suspicious/noThenProperty: builder Supabase simulado
    then: (
      resolve: (resultado: Resultado) => unknown,
      reject?: (erro: unknown) => unknown,
    ) => promessa.then(resolve, reject),
  };
  return b;
}

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: null, isAdmin: false, profile: null }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: true }),
}));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      if (tabela === "vw_questions_public") {
        let resolver!: (resultado: Resultado) => void;
        const promessa = new Promise<Resultado>((resolve) => {
          resolver = resolve;
        });
        const consulta: Consulta = {
          produto: "",
          signal: null,
          respondeu: false,
          terminar: (resultado) => {
            if (consulta.respondeu) return;
            consulta.respondeu = true;
            resolver(resultado);
          },
        };
        h.consultas.push(consulta);
        return builder(promessa, consulta);
      }
      if (tabela === "vw_produtos_public") {
        return builder(
          Promise.resolve({
            data: { nome: "Produto fictício", imagem_url: null },
            error: null,
          }),
        );
      }
      if (tabela === "answers") {
        return builder(Promise.resolve({ data: [], error: null }));
      }
      throw new Error(`Consulta inesperada: ${tabela}`);
    },
    channel: () => {
      const canal = {
        on: (
          _evento: string,
          config: { table: string },
          handler: (payload: unknown) => void,
        ) => {
          h.handlers.set(config.table, handler);
          return canal;
        },
        subscribe: () => canal,
      };
      return canal;
    },
    removeChannel: vi.fn(() => Promise.resolve()),
  },
}));

let raiz: Root;
let host: HTMLDivElement;
beforeEach(() => {
  h.consultas = [];
  h.handlers.clear();
  vi.stubGlobal("BroadcastChannel", h.CanalFalso);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  host = document.createElement("div");
  document.body.appendChild(host);
  raiz = createRoot(host);
});
afterEach(async () => {
  await act(async () => {
    raiz.unmount();
    for (const consulta of h.consultas) {
      consulta.terminar({ data: [], error: null });
    }
  });
  host.remove();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function abrir(produto: string) {
  await act(async () => {
    raiz.render(<ProductQA productId={produto} />);
  });
}
// O visitante sem login (o `useAuth` acima) não abre canal de tempo real: a
// "mudança que acorda a página" é VOLTAR À ABA depois do intervalo mínimo (30 s).
// Ela chama a mesma releitura que o evento do canal chamava, que é o que este
// teste prova (a segunda carga cancela a primeira sem mostrar vazio).
async function eventoDePergunta(_produto: string) {
  expect(h.handlers.get("questions")).toBeUndefined();
  vi.spyOn(Date, "now").mockReturnValue(Date.now() + 31_000);
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
    // A tarefa seguinte vem depois das continuações do abort já resolvido,
    // inclusive catch/finally da primeira carga; a segunda segue pendente.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
}
function conferirSobreposicao(primeiroProduto: string, segundoProduto: string) {
  expect(h.consultas).toHaveLength(2);
  expect(h.consultas.map((consulta) => consulta.produto)).toEqual([
    primeiroProduto,
    segundoProduto,
  ]);
  expect(h.consultas[0].signal?.aborted).toBe(true);
  expect(h.consultas[0].respondeu).toBe(true);
  expect(h.consultas[1].signal?.aborted).toBe(false);
  expect(h.consultas[1].respondeu).toBe(false);
}
async function responderSegunda(produto: string, texto: string) {
  await act(async () => {
    h.consultas[1].terminar({
      data: [
        {
          id: `pergunta-${produto}`,
          product_id: produto,
          question: texto,
          created_at: "2026-11-15T12:00:00Z",
          author_name: "Pessoa fictícia",
          author_avatar_url: null,
        },
      ],
      error: null,
    });
  });
}

it("evento do mesmo produto cancela a primeira carga sem mostrar vazio enquanto a segunda está pendente", async () => {
  const produto = "qa-recarga-sem-cache";
  await abrir(produto);
  expect(h.consultas).toHaveLength(1);
  expect(host.textContent).toContain("Sincronizando conversas...");
  await eventoDePergunta(produto);
  conferirSobreposicao(produto, produto);

  expect(host.textContent).not.toContain("Sem perguntas ainda");
  expect(host.textContent).toContain("Sincronizando conversas...");
  await responderSegunda(produto, "A pergunta chegou na segunda consulta?");
  expect(host.textContent).toContain("A pergunta chegou na segunda consulta?");
  expect(host.textContent).not.toContain("Sincronizando conversas...");
  expect(host.textContent).not.toContain("Sem perguntas ainda");
});

it("CONTROLE: com cache, a sobreposição preserva o conteúdo guardado até a segunda resposta", async () => {
  const produto = "qa-recarga-com-cache";
  localStorage.setItem(
    `ikcous_questions_cache_${produto}:pub`,
    JSON.stringify([
      {
        id: "pergunta-guardada",
        productId: produto,
        customerName: "Pessoa fictícia",
        question: "Pergunta já guardada no aparelho",
        createdAt: "2026-11-15T11:00:00Z",
        answers: [],
      },
    ]),
  );
  await abrir(produto);
  expect(host.textContent).toContain("Pergunta já guardada no aparelho");
  await eventoDePergunta(produto);
  conferirSobreposicao(produto, produto);
  expect(host.textContent).toContain("Pergunta já guardada no aparelho");
  expect(host.textContent).not.toContain("Sem perguntas ainda");
  await responderSegunda(produto, "Pergunta atualizada pela rede");
  expect(host.textContent).toContain("Pergunta atualizada pela rede");
  expect(host.textContent).not.toContain("Pergunta já guardada no aparelho");
});

it.each(["vazia", "erro"] as const)(
  "CONTROLE: a segunda consulta ativa encerra o carregamento com resposta %s",
  async (desfecho) => {
    const produto = `qa-recarga-segunda-${desfecho}`;
    if (desfecho === "erro") {
      vi.spyOn(console, "error").mockImplementation(() => {});
    }
    await abrir(produto);
    await eventoDePergunta(produto);
    conferirSobreposicao(produto, produto);
    expect(host.textContent).toContain("Sincronizando conversas...");
    expect(host.textContent).not.toContain("Sem perguntas ainda");

    await act(async () => {
      h.consultas[1].terminar(
        desfecho === "vazia"
          ? { data: [], error: null }
          : {
              data: null,
              error: {
                name: "Error",
                message: "Falha fictícia da segunda carga",
              },
            },
      );
    });
    expect(h.consultas[1].signal?.aborted).toBe(false);
    expect(host.textContent).not.toContain("Sincronizando conversas...");
    if (desfecho === "vazia") {
      expect(host.textContent).toContain("Sem perguntas ainda");
      expect(host.textContent).not.toContain("Não conseguimos carregar");
    } else {
      expect(host.textContent).toContain(
        "Não conseguimos carregar as perguntas",
      );
      expect(host.textContent).toContain("Tentar de novo");
      expect(host.textContent).not.toContain("Sem perguntas ainda");
    }
  },
);

it("CONTROLE: trocar de produto mantém o segundo carregando e mostra somente sua resposta", async () => {
  const primeiro = "qa-troca-primeiro";
  const segundo = "qa-troca-segundo";
  await abrir(primeiro);
  await abrir(segundo);
  conferirSobreposicao(primeiro, segundo);
  expect(host.textContent).toContain("Sincronizando conversas...");
  expect(host.textContent).not.toContain("Sem perguntas ainda");
  await responderSegunda(segundo, "Pergunta do segundo produto");
  expect(host.textContent).toContain("Pergunta do segundo produto");
  expect(host.textContent).not.toContain("Sincronizando conversas...");
  expect(host.textContent).not.toContain("Sem perguntas ainda");
});
