// @vitest-environment jsdom
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { useDevolucaoAdmin } from "@/hooks/useDevolucoesAdmin";

const { rpc, createSignedUrl } = vi.hoisted(() => ({
  rpc: vi.fn(),
  createSignedUrl: vi.fn(),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: { rpc, storage: { from: () => ({ createSignedUrl }) } },
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

const OITO_MIN = 8 * 60 * 1000;

const COM_FOTOS = {
  id: "dev-a",
  protocolo: "DV-A",
  order_id: "pedido-a",
  tipo: "arrependimento",
  motivo: "tamanho_pequeno",
  detalhe: null,
  resolucao_desejada: "troca",
  resolucao_final: null,
  modalidade: "local",
  metodo_retorno: "entrega_na_loja",
  status: "recebida",
  valor_itens: 100,
  valor_frete_ida: 0,
  valor_reembolso: null,
  refund_id: null,
  reembolso_manual: false,
  fotos: ["a.jpg", "b.jpg"],
  codigo_rastreio: null,
  codigo_postagem: null,
  me_reverse_id: null,
  etiqueta_url: null,
  coleta_em: null,
  mensagem_loja: null,
  observacao_inspecao: null,
  entregue_em: "2026-10-15T10:00:00Z",
  prazo_ate: "2026-10-22",
  politica: null,
  created_at: "2026-10-16T10:00:00Z",
  aprovada_em: "2026-10-16T11:00:00Z",
  postada_em: null,
  recebida_em: "2026-10-16T12:00:00Z",
  concluida_em: null,
  encerrada_em: null,
  itens: [],
  eventos: [],
  pedido: null,
};

let raiz: Root;
let hospedeiro: HTMLDivElement;
let leitura: ReturnType<typeof useDevolucaoAdmin>;
let geracao = 0;

function Sonda({ id }: { id: string | null }) {
  const lida = useDevolucaoAdmin(id);
  useEffect(() => {
    leitura = lida;
  });
  return null;
}

/** Cada assinatura devolve um endereço novo: `<caminho>?v=<n-da-chamada>`. */
function assinaturasNumeradas() {
  createSignedUrl.mockImplementation((caminho: string) =>
    Promise.resolve({
      data: { signedUrl: `https://foto.test/${caminho}?v=${++geracao}` },
      error: null,
    }),
  );
}

async function passar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function abrir(ficha: unknown, id = "dev-a") {
  rpc.mockResolvedValue({ data: ficha, error: null });
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
  await act(async () => raiz.render(<Sonda id={id} />));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  geracao = 0;
  assinaturasNumeradas();
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("uma assinatura pendurada não deixa todas as fotos carregando", async () => {
  createSignedUrl.mockImplementationOnce(() => new Promise(() => undefined));
  await abrir(COM_FOTOS);
  expect(leitura.fotos.has("a.jpg")).toBe(false);

  await passar(20_000);

  expect(leitura.fotos.get("a.jpg")).toBeNull();
  expect(leitura.fotos.get("b.jpg")).toBe("https://foto.test/b.jpg?v=1");
  expect(leitura.carregando).toBe(false);
});

it("na renovação, preserva a foto sem resposta e atualiza a outra", async () => {
  await abrir(COM_FOTOS);
  const fotoAnterior = leitura.fotos.get("a.jpg");
  createSignedUrl.mockImplementationOnce(() => new Promise(() => undefined));

  await passar(OITO_MIN + 20_000);

  expect(leitura.fotos.get("a.jpg")).toBe(fotoAnterior);
  expect(leitura.fotos.get("b.jpg")).toBe("https://foto.test/b.jpg?v=3");
});
