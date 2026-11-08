// @vitest-environment jsdom
import { act, useEffect, useState } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type DadosDaSolicitacao,
  type DevolucaoDoCliente,
  useDevolucaoCliente,
} from "@/hooks/useDevolucaoCliente";

const { rpc, upload, remove, redimensionar } = vi.hoisted(() => ({
  rpc: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
  redimensionar: vi.fn(),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: { rpc, storage: { from: () => ({ upload, remove }) } },
}));
vi.mock("@/lib/redimensiona-imagem", () => ({
  redimensionarImagem: redimensionar,
}));

type Resposta = { data: unknown; error: unknown };
function pendente() {
  let resolver!: (resposta: Resposta) => void;
  const promessa = new Promise<Resposta>((resolve) => {
    resolver = resolve;
  });
  return { promessa, resolver };
}

const DADOS: DadosDaSolicitacao = {
  itens: [{ order_item_id: "oi-1", quantidade: 1 }],
  motivo: "desisti",
  detalhe: "",
  resolucao: "reembolso",
  metodo: "envio_proprio",
  fotos: [],
};
const ELEGIBILIDADE = {
  pode: true,
  modalidade: "nacional",
  janelas: {},
  itens: [],
  politica: {
    prazo_arrependimento_dias: 7,
    prazo_troca_dias: 30,
    prazo_vicio_dias: 90,
  },
};
const DEVOLUCAO = {
  id: "d-1",
  protocolo: "DV1",
  order_id: "o-1",
  tipo: "arrependimento",
  motivo: "desisti",
  resolucao_desejada: "reembolso",
  modalidade: "nacional",
  metodo_retorno: "envio_proprio",
  status: "solicitada",
  itens: [],
};
const ACOES = [
  "solicitar_devolucao",
  "cancelar_devolucao",
  "informar_envio_devolucao",
] as const;
type Acao = (typeof ACOES)[number];

let raiz: Root;
let hospedeiro: HTMLDivElement;
let leitura: DevolucaoDoCliente;
let lista: unknown[];
let consultasPendentes: boolean;
let detalhePendente: ReturnType<typeof pendente> | null;

function executar(acao: Acao) {
  if (acao === "solicitar_devolucao") return leitura.solicitar(DADOS);
  if (acao === "cancelar_devolucao") return leitura.cancelar("d-1");
  return leitura.informarEnvio("d-1", "BR12345");
}

// O estado de espera segue o mesmo contrato das telas: só libera o botão
// quando a ação do hook real termina. Só a rede é dublada.
function Sonda({ acao }: { acao: Acao }) {
  const lida = useDevolucaoCliente("o-1", true);
  useEffect(() => {
    leitura = lida;
  });
  const [enviando, setEnviando] = useState(false);
  const [mensagem, setMensagem] = useState("");
  return (
    <>
      <button
        type="button"
        disabled={enviando}
        onClick={async () => {
          setEnviando(true);
          const r = await executar(acao);
          setMensagem(r.ok ? "Concluído" : r.erro);
          setEnviando(false);
        }}
      >
        Confirmar
      </button>
      <p role="alert">{mensagem}</p>
    </>
  );
}

async function montar(acao: Acao = "solicitar_devolucao") {
  await act(async () => raiz.render(<Sonda acao={acao} />));
}
async function avancar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
const botao = () => hospedeiro.querySelector("button") as HTMLButtonElement;
const mensagem = () => hospedeiro.querySelector('[role="alert"]')?.textContent;
const chamadas = (nome: string) =>
  rpc.mock.calls.filter(([n]) => n === nome).length;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("crypto", { randomUUID: () => "foto-1" });
  vi.resetAllMocks();
  lista = [];
  consultasPendentes = false;
  detalhePendente = null;
  rpc.mockImplementation((nome: string) => {
    if (consultasPendentes && !ACOES.includes(nome as Acao))
      return new Promise(() => {});
    if (nome === "devolucao_detalhe" && detalhePendente)
      return detalhePendente.promessa;
    return Promise.resolve({
      data:
        nome === "devolucao_elegibilidade"
          ? ELEGIBILIDADE
          : nome === "devolucoes_do_pedido"
            ? lista
            : DEVOLUCAO,
      error: null,
    });
  });
  upload.mockResolvedValue({ data: { path: "x" }, error: null });
  remove.mockResolvedValue({ data: [], error: null });
  redimensionar.mockImplementation(async (arquivo: File) => arquivo);
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});
afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("devolução com rede conectada e sem resposta", () => {
  it.each(ACOES)(
    "%s libera o botão, relê o pedido e não anuncia sucesso tardio",
    async (acao) => {
      await montar(acao);
      const resposta = pendente();
      rpc.mockImplementationOnce(() => resposta.promessa);
      await act(async () => botao().click());
      expect(botao().disabled).toBe(true);

      await avancar(20_000);

      expect(botao().disabled).toBe(false);
      expect(mensagem()).toContain("Sem resposta da rede.");
      expect(mensagem()).toContain("antes de tentar de novo");
      expect(chamadas("devolucoes_do_pedido")).toBeGreaterThan(1);
      const aviso = mensagem();
      lista = [
        {
          ...DEVOLUCAO,
          status: acao === "cancelar_devolucao" ? "cancelada" : "solicitada",
        },
      ];
      await act(async () =>
        resposta.resolver({ data: DEVOLUCAO, error: null }),
      );
      expect(mensagem()).toBe(aviso);
      expect(leitura.devolucoes).toHaveLength(1);
    },
  );

  it.each(ACOES)(
    "%s também termina quando a releitura posterior não responde",
    async (acao) => {
      await montar(acao);
      consultasPendentes = true;
      await act(async () => botao().click());

      await avancar(12_000);

      expect(botao().disabled).toBe(false);
      expect(mensagem()).toBe("Concluído");
      expect(leitura.erro).toBe(true);
      expect(leitura.carregando).toBe(false);
    },
  );

  it("pedido registrado: o protocolo volta na hora, sem esperar a releitura do pedido", async () => {
    await montar();
    consultasPendentes = true;
    let desfecho: unknown;
    await act(async () => {
      void leitura.solicitar(DADOS).then((r) => {
        desfecho = r;
      });
    });

    // Nenhum relógio andou: antes, a cliente esperava até 12 s em
    // "Registrando o pedido…" por causa da releitura que vinha depois.
    expect(desfecho).toMatchObject({ ok: true, valor: { protocolo: "DV1" } });

    // A releitura em segundo plano que pendura vira erro de leitura, mas o
    // protocolo já entregue não se perde.
    await avancar(12_000);
    expect(leitura.erro).toBe(true);
    expect(leitura.carregando).toBe(false);
    expect(desfecho).toMatchObject({ ok: true, valor: { protocolo: "DV1" } });
  });

  it("pedido registrado: a releitura segue em segundo plano e atualiza o pedido", async () => {
    await montar();
    expect(leitura.devolucoes).toHaveLength(0);
    lista = [DEVOLUCAO];
    await act(async () => {
      await leitura.solicitar(DADOS);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(chamadas("devolucoes_do_pedido")).toBeGreaterThan(1);
    expect(leitura.devolucoes).toHaveLength(1);
    expect(leitura.erro).toBe(false);
  });

  it("a leitura inicial termina em erro em vez de manter o giro", async () => {
    consultasPendentes = true;
    await montar();
    expect(leitura.carregando).toBe(true);
    await avancar(12_000);
    expect(leitura.carregando).toBe(false);
    expect(leitura.erro).toBe(true);
  });

  it("o prazo cobre também o detalhe e não aceita a leitura atrasada", async () => {
    lista = [DEVOLUCAO];
    detalhePendente = pendente();
    await montar();
    await avancar(12_000);
    expect(leitura.carregando).toBe(false);
    expect(leitura.erro).toBe(true);
    await act(async () =>
      detalhePendente?.resolver({ data: DEVOLUCAO, error: null }),
    );
    expect(leitura.atual).toBeNull();
    expect(leitura.erro).toBe(true);
  });

  it.each([
    "ativa",
    "concluida",
    "antiga",
    "falha",
    "pendurada",
    "vazia",
  ] as const)(
    "após solicitar sem resposta, consulta a lista %s antes de reenviar",
    async (situacao) => {
      if (situacao === "antiga")
        lista = [{ ...DEVOLUCAO, status: "cancelada" }];
      await montar();
      const resposta = pendente();
      rpc.mockImplementationOnce(() => resposta.promessa);
      await act(async () => botao().click());
      await avancar(20_000);
      expect(botao().disabled).toBe(false);
      if (situacao === "ativa") lista = [DEVOLUCAO];
      if (situacao === "concluida")
        lista = [{ ...DEVOLUCAO, status: "concluida" }];
      if (situacao === "falha")
        rpc.mockResolvedValueOnce({ data: null, error: { message: "rede" } });
      if (situacao === "pendurada") consultasPendentes = true;
      const antes = chamadas("devolucoes_do_pedido");
      const inicioDaTentativa = rpc.mock.calls.length;

      await act(async () => botao().click());
      if (situacao === "pendurada") await avancar(12_000);

      expect(rpc.mock.calls.at(inicioDaTentativa)?.[0]).toBe(
        "devolucoes_do_pedido",
      );
      expect(chamadas("devolucoes_do_pedido")).toBeGreaterThan(antes);
      expect(chamadas("solicitar_devolucao")).toBe(
        situacao === "vazia" || situacao === "antiga" ? 2 : 1,
      );
      expect(botao().disabled).toBe(false);
      if (situacao !== "vazia" && situacao !== "antiga")
        expect(mensagem()).not.toBe("Concluído");
    },
  );

  it.each(["cancelada", "recusada"] as const)(
    "a devolução gravada após o estouro e depois %s não impede um novo pedido",
    async (status) => {
      await montar();
      rpc.mockImplementationOnce(() => pendente().promessa);
      await act(async () => botao().click());
      lista = [DEVOLUCAO];

      await avancar(20_000);

      expect(leitura.devolucoes.at(0)?.status).toBe("solicitada");
      lista = [{ ...DEVOLUCAO, status }];
      if (status === "cancelada") {
        rpc.mockResolvedValueOnce({ data: { id: "d-1", status }, error: null });
        await act(async () => {
          await leitura.cancelar("d-1");
        });
      } else {
        await act(async () => {
          await leitura.recarregar();
        });
      }
      expect(leitura.devolucoes.at(0)?.status).toBe(status);
      const inicio = rpc.mock.calls.length;

      await act(async () => botao().click());

      expect(rpc.mock.calls.at(inicio)?.[0]).toBe("solicitar_devolucao");
      expect(chamadas("solicitar_devolucao")).toBe(2);
      expect(mensagem()).toBe("Concluído");
    },
  );

  it("a conferência que encontrou a devolução resolve a incerteza mesmo se a releitura pendurar", async () => {
    await montar();
    rpc.mockImplementationOnce(() => pendente().promessa);
    await act(async () => botao().click());
    await avancar(20_000);
    rpc.mockResolvedValueOnce({ data: [DEVOLUCAO], error: null });
    consultasPendentes = true;
    await act(async () => botao().click());
    expect(chamadas("solicitar_devolucao")).toBe(1);

    // A loja recusou D1 enquanto a releitura não respondeu.
    consultasPendentes = false;
    lista = [{ ...DEVOLUCAO, status: "recusada" }];
    const inicio = rpc.mock.calls.length;
    await act(async () => botao().click());

    expect(rpc.mock.calls.at(inicio)?.[0]).toBe("solicitar_devolucao");
    expect(chamadas("solicitar_devolucao")).toBe(2);
  });

  it("a resposta atrasada resolve a incerteza mesmo se a releitura pendurar", async () => {
    await montar();
    const resposta = pendente();
    rpc.mockImplementationOnce(() => resposta.promessa);
    await act(async () => botao().click());
    await avancar(20_000);
    consultasPendentes = true;

    await act(async () => resposta.resolver({ data: DEVOLUCAO, error: null }));
    await avancar(12_000);
    expect(leitura.erro).toBe(true);
    expect(mensagem()).toContain("Sem resposta da rede.");
    consultasPendentes = false;
    lista = [{ ...DEVOLUCAO, status: "cancelada" }];
    const inicio = rpc.mock.calls.length;

    await act(async () => botao().click());

    expect(rpc.mock.calls.at(inicio)?.[0]).toBe("solicitar_devolucao");
    expect(chamadas("solicitar_devolucao")).toBe(2);
  });

  it("uma devolução ativa já conhecida também impede reenviar após o estouro", async () => {
    lista = [DEVOLUCAO];
    await montar();
    rpc.mockImplementationOnce(() => pendente().promessa);
    await act(async () => botao().click());
    await avancar(20_000);

    await act(async () => botao().click());

    expect(chamadas("solicitar_devolucao")).toBe(1);
    expect(mensagem()).toContain("Sem resposta da rede.");
  });

  it("foto WEBP que leva 30 segundos para subir não estoura o prazo", async () => {
    await montar();
    const resposta = pendente();
    upload.mockReturnValueOnce(resposta.promessa);
    let desfecho: unknown;
    await act(async () => {
      void leitura
        .enviarFoto(new File(["x"], "foto.webp", { type: "image/webp" }), "u-1")
        .then((r) => {
          desfecho = r;
        });
    });

    await avancar(30_000);
    expect(desfecho).toBeUndefined();
    await act(async () =>
      resposta.resolver({ data: { path: "u-1/o-1/foto-1.webp" }, error: null }),
    );

    expect(desfecho).toEqual({ ok: true, valor: "u-1/o-1/foto-1.webp" });
    expect(remove).not.toHaveBeenCalled();
  });

  it("foto que só termina após o prazo é descartada, sem transformar erro em sucesso", async () => {
    await montar();
    const resposta = pendente();
    upload.mockReturnValueOnce(resposta.promessa);
    let desfecho: unknown;
    await act(async () => {
      void leitura
        .enviarFoto(new File(["x"], "foto.jpg", { type: "image/jpeg" }), "u-1")
        .then((r) => {
          desfecho = r;
        });
    });
    await avancar(89_000);
    expect(desfecho).toBeUndefined();
    await avancar(6_000);
    expect(desfecho).toEqual({
      ok: false,
      erro: expect.stringContaining("Sem resposta da rede."),
    });
    const falha = desfecho;
    expect(remove).not.toHaveBeenCalled();

    await act(async () =>
      resposta.resolver({ data: { path: "u-1/o-1/foto-1.jpg" }, error: null }),
    );

    expect(remove).toHaveBeenCalledWith(["u-1/o-1/foto-1.jpg"]);
    expect(desfecho).toBe(falha);
  });

  it("foto que falhou depois do prazo não pede descarte", async () => {
    await montar();
    const resposta = pendente();
    upload.mockReturnValueOnce(resposta.promessa);
    let desfecho: unknown;
    await act(async () => {
      void leitura
        .enviarFoto(new File(["x"], "foto.jpg", { type: "image/jpeg" }), "u-1")
        .then((r) => {
          desfecho = r;
        });
    });
    await avancar(95_000);
    expect(desfecho).toEqual({
      ok: false,
      erro: expect.stringContaining("Sem resposta da rede."),
    });
    await act(async () =>
      resposta.resolver({ data: null, error: { message: "rede" } }),
    );
    expect(remove).not.toHaveBeenCalled();
  });

  it("redimensionamento sem resposta termina sem começar upload tardio", async () => {
    await montar();
    let resolver!: (arquivo: File) => void;
    redimensionar.mockReturnValueOnce(
      new Promise<File>((resolve) => {
        resolver = resolve;
      }),
    );
    const arquivo = new File(["x"], "foto.jpg", { type: "image/jpeg" });
    let desfecho: unknown;
    await act(async () => {
      void leitura.enviarFoto(arquivo, "u-1").then((r) => {
        desfecho = r;
      });
    });
    await avancar(20_000);
    expect(desfecho).toEqual({
      ok: false,
      erro: expect.stringContaining("Sem resposta da rede."),
    });
    await act(async () => resolver(arquivo));
    expect(upload).not.toHaveBeenCalled();
  });
});
