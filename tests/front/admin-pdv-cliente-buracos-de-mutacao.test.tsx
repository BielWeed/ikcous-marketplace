// @vitest-environment jsdom
//
// Buracos que a caça por mutação achou na seção "cliente" do caixa
// (ClienteDaVenda). Cada caso nasceu de um defeito de UMA linha plantado no
// componente que os testes vizinhos deixaram passar. O componente é montado
// direto, com `buscarClientes` e `despachar` dublados, e todos os dados são
// inventados:
//  · a frase "Nenhum cliente encontrado" some quando a lojista apaga o termo;
//  · a resposta (ou o erro) de uma busca velha não mexe na busca mais nova;
//  · cliente sem nome vira "Cliente"; o contato mostrado é o telefone, e só
//    sem telefone o e-mail;
//  · escolher cliente / confirmar "sem cliente" / confirmar avulso leva de
//    volta ao cupom;
//  · nome avulso é aparado; nome só de espaços tira o avulso, mas nunca derruba
//    um cliente cadastrado;
//  · o aviso de WhatsApp: vazio não avisa, o campo já entrega dígitos nacionais (DDD 55 não é código do país);
//  · a tela abre no modo certo e com os campos preenchidos conforme o cliente
//    que já está na venda;
//  · os atrasos do campo (300 ms na busca, 200 ms no avulso).
import {
  ClienteDaVenda,
  type LinhaDeClienteEncontrado,
  type PaginaDeClientesEncontrados,
} from "@/components/admin/pdv/ClienteDaVenda";
import type { ClienteDaVenda as ClienteDoEstado } from "@/hooks/useVendaPresencial";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ID_BUSCA = "busca-de-cliente-do-balcao";
const ID_NOME = "nome-do-cliente-avulso";
const ID_FONE = "whatsapp-do-cliente-avulso";
const AVISO_FONE = "Número inválido: não abre conversa no WhatsApp";

const SEM_RESULTADO = "Nenhum cliente encontrado";

const ANA: LinhaDeClienteEncontrado = {
  id: "u-ana",
  full_name: "Ana Prova",
  email: "ana@prova.teste",
  phone: "11999990000",
};

describe("ClienteDaVenda: buracos de mutação", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  const buscar =
    vi.fn<(termo: string) => Promise<PaginaDeClientesEncontrados>>();
  const despachar = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    buscar.mockReset();
    despachar.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });
  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  async function montar(
    cliente: ClienteDoEstado = { tipo: "sem_cliente" },
  ): Promise<void> {
    await act(async () => {
      raiz.render(
        <ClienteDaVenda
          cliente={cliente}
          despachar={despachar}
          buscarClientes={buscar}
        />,
      );
    });
  }

  function botao(texto: string): HTMLButtonElement {
    const achado = [...hospedeiro.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === texto,
    );
    if (!achado) throw new Error(`botão "${texto}" não achado`);
    return achado;
  }

  async function clicar(texto: string): Promise<void> {
    await act(async () => {
      botao(texto).click();
    });
  }

  function campo(id: string): HTMLInputElement {
    return document.getElementById(id) as HTMLInputElement;
  }

  /** Digita e espera `ms` (o atraso do campo): o texto sai pelo tempo, com o
   * foco ainda no campo, como a lojista que digita e espera. */
  async function digitar(id: string, valor: string, ms = 400): Promise<void> {
    const el = campo(id);
    await act(async () => {
      el.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(el, valor);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  const texto = () => hospedeiro.textContent ?? "";
  const avisoDeFone = () => texto().includes(AVISO_FONE);
  const botaoDaAna = () =>
    [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Ana Prova"),
    );

  describe("busca", () => {
    it("apagar o termo para menos de 2 letras tira a frase 'Nenhum cliente encontrado' da tela", async () => {
      buscar.mockResolvedValueOnce({ clientes: [], total: 0 });
      await montar();
      await clicar("Buscar cliente");
      await digitar(ID_BUSCA, "Zuleica");
      expect(texto()).toContain(SEM_RESULTADO);

      await digitar(ID_BUSCA, "z");
      expect(texto()).not.toContain(SEM_RESULTADO);
      expect(buscar).toHaveBeenCalledTimes(1);
    });

    it("o erro de uma busca VELHA não derruba a lista da busca nova", async () => {
      let falharA!: (erro: Error) => void;
      buscar.mockReturnValueOnce(
        new Promise<PaginaDeClientesEncontrados>((_, rejeitar) => {
          falharA = rejeitar;
        }),
      );
      buscar.mockResolvedValueOnce({ clientes: [ANA], total: 1 });
      await montar();
      await clicar("Buscar cliente");
      await digitar(ID_BUSCA, "an");
      await digitar(ID_BUSCA, "ana");
      expect(botaoDaAna()).toBeDefined();

      await act(async () => {
        falharA(new Error("rede velha"));
      });

      expect(botaoDaAna()).toBeDefined();
      expect(hospedeiro.querySelector('[role="alert"]')).toBeNull();
    });

    it("a resposta de uma busca VELHA não apaga o 'Buscando…' da busca nova que ainda espera", async () => {
      let resolverA!: (pagina: PaginaDeClientesEncontrados) => void;
      buscar.mockReturnValueOnce(
        new Promise<PaginaDeClientesEncontrados>((resolve) => {
          resolverA = resolve;
        }),
      );
      buscar.mockReturnValueOnce(new Promise(() => {}));
      await montar();
      await clicar("Buscar cliente");
      await digitar(ID_BUSCA, "an");
      await digitar(ID_BUSCA, "ana");
      expect(texto()).toContain("Buscando…");

      await act(async () => {
        resolverA({ clientes: [ANA], total: 1 });
      });

      expect(texto()).toContain("Buscando…");
      expect(botaoDaAna()).toBeUndefined();
    });

    it("busca que falha registra o erro no console (a lojista vê o aviso e o suporte vê a causa)", async () => {
      const erro = new Error("rede caiu");
      buscar.mockRejectedValueOnce(erro);
      await montar();
      await clicar("Buscar cliente");
      await digitar(ID_BUSCA, "ana");
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining("buscar cliente"),
        erro,
      );
    });

    it("só avisa 'Mostrando N de M' quando M é MAIOR que N: total menor que a lista não avisa", async () => {
      buscar.mockResolvedValueOnce({ clientes: [ANA], total: 0 });
      await montar();
      await clicar("Buscar cliente");
      await digitar(ID_BUSCA, "ana");
      expect(botaoDaAna()).toBeDefined();
      expect(texto()).not.toContain("Mostrando");
    });

    it("a busca só sai depois de 300 ms parado no campo", async () => {
      buscar.mockResolvedValue({ clientes: [], total: 0 });
      await montar();
      await clicar("Buscar cliente");
      await digitar(ID_BUSCA, "ana", 299);
      expect(buscar).not.toHaveBeenCalled();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(buscar).toHaveBeenCalledWith("ana");
    });

    it("cliente sem nome aparece como 'Cliente' e é vinculado com esse nome; sem telefone usa o e-mail", async () => {
      buscar.mockResolvedValueOnce({
        clientes: [
          {
            id: "u-sem-nome",
            full_name: null,
            email: "sem.nome@prova.teste",
            phone: null,
          },
        ],
        total: 1,
      });
      await montar();
      await clicar("Buscar cliente");
      await digitar(ID_BUSCA, "sem");
      const linha = [...hospedeiro.querySelectorAll("li button")][0];
      expect(linha?.textContent).toContain("Cliente");
      expect(linha?.textContent).toContain("sem.nome@prova.teste");

      await act(async () => {
        (linha as HTMLButtonElement).click();
      });
      expect(despachar).toHaveBeenNthCalledWith(1, {
        tipo: "cliente_definido",
        cliente: {
          tipo: "cadastrado",
          userId: "u-sem-nome",
          nome: "Cliente",
          whatsapp: null,
        },
      });
    });

    it("com telefone E e-mail a linha mostra o telefone; escolher leva de volta ao cupom", async () => {
      buscar.mockResolvedValueOnce({ clientes: [ANA], total: 1 });
      await montar();
      await clicar("Buscar cliente");
      await digitar(ID_BUSCA, "ana");
      expect(botaoDaAna()?.textContent).toContain("11999990000");
      expect(botaoDaAna()?.textContent).not.toContain("ana@prova.teste");

      await act(async () => {
        botaoDaAna()!.click();
      });
      expect(despachar).toHaveBeenCalledTimes(2);
      expect(despachar).toHaveBeenNthCalledWith(2, {
        tipo: "etapa_pedida",
        etapa: "cupom",
      });
    });
  });

  describe("sem cliente e voltar", () => {
    it("'Confirmar sem cliente' desvincula e volta ao cupom, nessa ordem", async () => {
      await montar();
      await clicar("Sem cliente");
      await clicar("Confirmar sem cliente");
      expect(despachar.mock.calls).toEqual([
        [{ tipo: "cliente_definido", cliente: { tipo: "sem_cliente" } }],
        [{ tipo: "etapa_pedida", etapa: "cupom" }],
      ]);
    });

    it("'Voltar à venda' só volta ao cupom: não mexe no cliente", async () => {
      await montar({ tipo: "sem_cliente" });
      await clicar("Voltar à venda");
      expect(despachar.mock.calls).toEqual([
        [{ tipo: "etapa_pedida", etapa: "cupom" }],
      ]);
    });

    it("com cliente cadastrado na venda, o aviso nomeia a pessoa; sem cliente, diz que não há ninguém", async () => {
      await montar({
        tipo: "cadastrado",
        userId: "u-ana",
        nome: "Ana Prova",
        whatsapp: null,
      });
      await clicar("Sem cliente");
      expect(texto()).toContain(
        "A venda ainda está com Ana Prova — confirme para desvincular.",
      );
    });

    it("sem cliente na venda, o aviso diz que a venda entra sem ninguém", async () => {
      await montar({ tipo: "sem_cliente" });
      await clicar("Sem cliente");
      expect(texto()).toContain("A venda entra sem nenhum cliente vinculado.");
      expect(texto()).not.toContain("A venda ainda está com");
    });
  });

  describe("modo de abertura e campos preenchidos", () => {
    it("cliente avulso na venda abre direto no avulso, com nome e WhatsApp preenchidos", async () => {
      await montar({
        tipo: "avulso",
        nome: "Beto Prova",
        whatsapp: "11999990000",
      });
      expect(campo(ID_NOME).value).toBe("Beto Prova");
      expect(campo(ID_FONE).value).toBe("(11) 99999-0000");
      expect(campo(ID_BUSCA)).toBeNull();
      expect(botao("Cliente avulso").getAttribute("aria-pressed")).toBe("true");
      expect(botao("Buscar cliente").getAttribute("aria-pressed")).toBe(
        "false",
      );
      expect(botao("Sem cliente").getAttribute("aria-pressed")).toBe("false");
    });

    it("cliente cadastrado na venda abre direto na busca", async () => {
      await montar({
        tipo: "cadastrado",
        userId: "u-ana",
        nome: "Ana Prova",
        whatsapp: null,
      });
      expect(campo(ID_BUSCA)).not.toBeNull();
      expect(campo(ID_NOME)).toBeNull();
      expect(botao("Buscar cliente").getAttribute("aria-pressed")).toBe("true");
    });

    it("sem cliente na venda abre no 'continuar sem identificar'", async () => {
      await montar({ tipo: "sem_cliente" });
      expect(texto()).toContain("Continuar sem identificar?");
      expect(botao("Sem cliente").getAttribute("aria-pressed")).toBe("true");
      expect(campo(ID_BUSCA)).toBeNull();
      expect(campo(ID_NOME)).toBeNull();
    });
  });

  describe("cliente avulso", () => {
    it("o nome sai aparado e o WhatsApp vai junto; só depois de 200 ms parado", async () => {
      await montar();
      await clicar("Cliente avulso");
      await digitar(ID_NOME, "  Beto Prova  ", 199);
      expect(despachar).not.toHaveBeenCalled();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(despachar).toHaveBeenCalledTimes(1);
      expect(despachar).toHaveBeenCalledWith({
        tipo: "cliente_definido",
        cliente: { tipo: "avulso", nome: "Beto Prova", whatsapp: "" },
      });

      despachar.mockClear();
      await digitar(ID_FONE, "11999990000", 199);
      expect(despachar).not.toHaveBeenCalled();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(despachar).toHaveBeenLastCalledWith({
        tipo: "cliente_definido",
        cliente: {
          tipo: "avulso",
          nome: "Beto Prova",
          whatsapp: "11999990000",
        },
      });
    });

    it("trocar só o WhatsApp mantém o nome; trocar só o nome mantém o WhatsApp", async () => {
      await montar({
        tipo: "avulso",
        nome: "Beto Prova",
        whatsapp: "11999990000",
      });
      await digitar(ID_FONE, "21999990000", 200);
      expect(despachar).toHaveBeenLastCalledWith({
        tipo: "cliente_definido",
        cliente: {
          tipo: "avulso",
          nome: "Beto Prova",
          whatsapp: "21999990000",
        },
      });
      await digitar(ID_NOME, "Beto Novo", 200);
      expect(despachar).toHaveBeenLastCalledWith({
        tipo: "cliente_definido",
        cliente: { tipo: "avulso", nome: "Beto Novo", whatsapp: "21999990000" },
      });
    });

    it("nome só de espaços tira o avulso da venda (vira sem cliente)", async () => {
      await montar({ tipo: "avulso", nome: "Beto Prova", whatsapp: "" });
      await digitar(ID_NOME, "   ", 200);
      expect(despachar).toHaveBeenCalledTimes(1);
      expect(despachar).toHaveBeenCalledWith({
        tipo: "cliente_definido",
        cliente: { tipo: "sem_cliente" },
      });
    });

    it("nome só de espaços NÃO derruba um cliente cadastrado nem um sem cliente", async () => {
      await montar({
        tipo: "cadastrado",
        userId: "u-ana",
        nome: "Ana Prova",
        whatsapp: null,
      });
      await clicar("Cliente avulso");
      await digitar(ID_NOME, "   ", 200);
      expect(despachar).not.toHaveBeenCalled();
    });

    it("o botão de confirmar fica desabilitado com o nome vazio ou só de espaços", async () => {
      await montar();
      await clicar("Cliente avulso");
      expect(botao("Confirmar cliente avulso").disabled).toBe(true);
      await digitar(ID_NOME, "   ", 200);
      expect(botao("Confirmar cliente avulso").disabled).toBe(true);
      await digitar(ID_NOME, "Beto", 200);
      expect(botao("Confirmar cliente avulso").disabled).toBe(false);
    });

    it("confirmar o avulso grava o cliente e volta ao cupom, nessa ordem", async () => {
      await montar({
        tipo: "avulso",
        nome: "Beto Prova",
        whatsapp: "11999990000",
      });
      await clicar("Confirmar cliente avulso");
      expect(despachar.mock.calls).toEqual([
        [
          {
            tipo: "cliente_definido",
            cliente: {
              tipo: "avulso",
              nome: "Beto Prova",
              whatsapp: "11999990000",
            },
          },
        ],
        [{ tipo: "etapa_pedida", etapa: "cupom" }],
      ]);
    });
  });

  describe("aviso de WhatsApp do avulso", () => {
    it("campo vazio não avisa nada", async () => {
      await montar({ tipo: "avulso", nome: "Beto Prova", whatsapp: "" });
      expect(avisoDeFone()).toBe(false);
      expect(campo(ID_FONE).getAttribute("aria-invalid")).toBeNull();
    });

    it("número curto avisa, ligando o campo ao aviso; número completo não avisa", async () => {
      await montar({ tipo: "avulso", nome: "Beto Prova", whatsapp: "" });
      await digitar(ID_FONE, "119999", 200);
      expect(avisoDeFone()).toBe(true);
      expect(campo(ID_FONE).getAttribute("aria-invalid")).toBe("true");
      expect(campo(ID_FONE).getAttribute("aria-describedby")).toBe(
        "aviso-whatsapp-avulso",
      );

      await digitar(ID_FONE, "11999990000", 200);
      expect(avisoDeFone()).toBe(false);
      expect(campo(ID_FONE).getAttribute("aria-invalid")).toBeNull();
      expect(campo(ID_FONE).getAttribute("aria-describedby")).toBeNull();
    });

    it("o campo avulso já entrega dígitos nacionais: DDD 55 (Rio Grande do Sul) é DDD, não código do país", async () => {
      // Fixo de 10 dígitos com DDD 55: relido como "55 + 8 dígitos" viraria
      // número curto demais e a lojista veria um aviso falso.
      await montar({
        tipo: "avulso",
        nome: "Beto Prova",
        whatsapp: "5532221111",
      });
      expect(avisoDeFone()).toBe(false);
    });

    it("número com 55 de código do país NÃO é aceito como nacional (13 dígitos avisa)", async () => {
      await montar({
        tipo: "avulso",
        nome: "Beto Prova",
        whatsapp: "5511999990000",
      });
      expect(avisoDeFone()).toBe(true);
    });

    it("a região de aviso é sempre a mesma: fica invisível (sr-only) sem erro e visível com erro", async () => {
      await montar({ tipo: "avulso", nome: "Beto Prova", whatsapp: "" });
      const regiao = document.getElementById("aviso-whatsapp-avulso")!;
      expect(regiao.className).toContain("sr-only");
      await digitar(ID_FONE, "119999", 200);
      expect(regiao.className).not.toContain("sr-only");
    });
  });
});
