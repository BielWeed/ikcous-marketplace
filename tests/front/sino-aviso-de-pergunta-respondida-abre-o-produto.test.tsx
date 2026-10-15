// @vitest-environment jsdom
//
// O lado da CLIENTE do aviso "Sua pergunta foi respondida" (migration
// 20261240000000). O banco grava uma linha em `notificacoes` com a MESMA forma
// dos avisos de pedido (tipo, titulo, mensagem, dados) mais `acao.url` apontando
// para o produto. Este teste monta o sino de verdade (provider + tela) com o
// banco dublê devolvendo EXATAMENTE a linha que a migration cria, e prova o
// contrato: o aviso aparece, não lido, e o toque abre a tela do PRODUTO.
//
// O controle mostra por que o destino precisa ser `/product-detail?id=<id>`:
// a forma `/product/<id>` (a que a linha falsa do log de push carregava) cai na
// tela inicial — a cliente tocaria no aviso e não chegaria à resposta.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NotificationProvider } from "@/contexts/NotificationContext";
import { NotificationsView } from "@/views/customer/NotificationsView";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

const usuarioDeTeste = { user: { id: "cliente-1" } };
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => usuarioDeTeste,
}));

vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));

type Linha = Record<string, unknown>;
let linhasDaCliente: Linha[] = [];

function builderDeConsulta(linhas: Linha[]) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    is: vi.fn(() => builder),
    order: vi.fn(() => builder),
    // o toque também marca o aviso como lido em segundo plano
    update: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })),
    limit: vi.fn(async () => ({ data: linhas, error: null })),
  };
  return builder;
}

let chamadas = 0;
vi.mock("@/lib/supabase", () => ({
  supabase: {
    // 1ª chamada = avisos próprios (.eq usuario_id); 2ª = campanha (.is nulo)
    from: () => {
      chamadas += 1;
      return builderDeConsulta(chamadas % 2 === 1 ? linhasDaCliente : []);
    },
    channel: vi.fn(),
    removeChannel: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público — padrão da casa.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// A linha como a migration a cria (o `id`, `lida` e `created_at` são os defaults da tabela).
const avisoDaPergunta = (url: string): Linha => ({
  id: "aviso-pergunta-1",
  usuario_id: "cliente-1",
  tipo: "info",
  titulo: "Sua pergunta foi respondida",
  mensagem: "A loja respondeu sua pergunta sobre Camiseta Azul 40.",
  dados: { question_id: "q-1", product_id: "prod-1" },
  acao: { url },
  lida: false,
  created_at: new Date(2026, 9, 14, 12, 0).toISOString(),
});

describe("sino da cliente — aviso de pergunta respondida", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let onNavigate: ReturnType<typeof vi.fn<(view: any, id?: string) => void>>;

  beforeEach(() => {
    chamadas = 0;
    onNavigate = vi.fn<(view: any, id?: string) => void>();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  async function montar() {
    await act(async () => {
      raiz.render(
        <NotificationProvider>
          <NotificationsView onNavigate={onNavigate} />
        </NotificationProvider>,
      );
    });
    await act(async () => {});
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }

  function tocarNoAviso() {
    const titulo = Array.from(hospedeiro.querySelectorAll("h4")).find((h) =>
      h.textContent?.includes("Sua pergunta foi respondida"),
    );
    expect(titulo).toBeTruthy();
    act(() => {
      titulo!.click();
    });
  }

  it("o aviso aparece no sino, não lido, com o nome do produto e o convite para ver", async () => {
    linhasDaCliente = [avisoDaPergunta("/product-detail?id=prod-1")];
    await montar();

    const texto = hospedeiro.textContent ?? "";
    expect(texto).toContain("Sua pergunta foi respondida");
    expect(texto).toContain(
      "A loja respondeu sua pergunta sobre Camiseta Azul 40.",
    );
    expect(texto).toContain("Você tem 1 não lida");
    // há destino: o cartão mostra a chamada para abrir
    expect(texto).toContain("Ver Detalhes");
  });

  it("tocar no aviso abre a tela do PRODUTO", async () => {
    linhasDaCliente = [avisoDaPergunta("/product-detail?id=prod-1")];
    await montar();
    tocarNoAviso();

    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith("product-detail", "prod-1");
  });

  it("CONTROLE: o destino '/product/<id>' (o da linha falsa do log de push) cairia na tela inicial", async () => {
    linhasDaCliente = [avisoDaPergunta("/product/prod-1")];
    await montar();
    tocarNoAviso();

    expect(onNavigate).toHaveBeenCalledWith("home");
    expect(onNavigate).not.toHaveBeenCalledWith("product-detail", "prod-1");
  });
});
