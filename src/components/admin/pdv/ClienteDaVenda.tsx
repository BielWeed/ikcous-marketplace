// Seção "cliente" do caixa (tarefa C3.2, plano §5.3, decisão D2). Só TRÊS
// caminhos, e só três: sem cliente (padrão), cliente cadastrado (busca por
// nome/e-mail/WhatsApp) e cliente avulso (nome+WhatsApp digitados na hora).
// NÃO existe "criar conta para o cliente" aqui — D2 é explícita: isso é
// convite, tarefa de C6.
//
// Este arquivo NÃO chama Supabase: `buscarClientes` é injetada pela VIEW.

import { LocalBufferedInput } from "@/components/admin/LocalBufferedInput";
import { Button } from "@/components/ui/button";
import type {
  AcaoDaVenda,
  ClienteDaVenda as ClienteDaVendaEstado,
} from "@/hooks/useVendaPresencial";
import { linkWhatsappDoCliente } from "@/lib/whatsapp-do-cliente";
import {
  AlertTriangle,
  Search,
  UserCheck,
  UserRoundPlus,
  UserRoundX,
} from "lucide-react";
import { type ReactElement, useRef, useState } from "react";

/** Uma linha de `get_admin_customers_paged` (migration 20260823000000:56) —
 * só os campos que esta tela usa, medidos no consumidor
 * (AdminCustomersView.tsx). */
export interface LinhaDeClienteEncontrado {
  readonly id: string;
  readonly full_name: string | null;
  readonly whatsapp: string | null;
  readonly email: string | null;
}

export interface PropsDoClienteDaVenda {
  readonly cliente: ClienteDaVendaEstado;
  readonly despachar: (acao: AcaoDaVenda) => void;
  readonly buscarClientes: (
    termo: string,
  ) => Promise<readonly LinhaDeClienteEncontrado[]>;
}

type ModoDeEscolha = "sem_cliente" | "buscar" | "avulso";

function modoInicial(cliente: ClienteDaVendaEstado): ModoDeEscolha {
  if (cliente.tipo === "avulso") return "avulso";
  if (cliente.tipo === "cadastrado") return "buscar";
  return "sem_cliente";
}

export function ClienteDaVenda({
  cliente,
  despachar,
  buscarClientes,
}: PropsDoClienteDaVenda): ReactElement {
  const [modo, setModo] = useState<ModoDeEscolha>(() => modoInicial(cliente));
  const [termoDeBusca, setTermoDeBusca] = useState("");
  const [resultados, setResultados] = useState<
    readonly LinhaDeClienteEncontrado[]
  >([]);
  const [buscando, setBuscando] = useState(false);

  // Cliente avulso é montado de DOIS campos que chegam por flushes
  // separados do `LocalBufferedInput` — o estado local combina os dois
  // antes de despachar `cliente_definido`, senão o segundo flush apagaria o
  // primeiro campo.
  const [nomeAvulso, setNomeAvulso] = useState(
    cliente.tipo === "avulso" ? cliente.nome : "",
  );
  const [whatsappAvulso, setWhatsappAvulso] = useState(
    cliente.tipo === "avulso" ? cliente.whatsapp : "",
  );

  const rodadaRef = useRef(0);

  async function aoDigitarBusca(valor: string): Promise<void> {
    setTermoDeBusca(valor);
    const termoLimpo = valor.trim();
    if (termoLimpo.length < 2) {
      setResultados([]);
      return;
    }
    const rodada = ++rodadaRef.current;
    setBuscando(true);
    try {
      const linhas = await buscarClientes(termoLimpo);
      if (rodada !== rodadaRef.current) return;
      setResultados(linhas);
    } catch (erro) {
      if (rodada !== rodadaRef.current) return;
      console.error("Erro ao buscar cliente no balcão:", erro);
      setResultados([]);
    } finally {
      if (rodada === rodadaRef.current) setBuscando(false);
    }
  }

  function aoEscolherClienteCadastrado(linha: LinhaDeClienteEncontrado): void {
    despachar({
      tipo: "cliente_definido",
      cliente: {
        tipo: "cadastrado",
        userId: linha.id,
        nome: linha.full_name || "Cliente",
        whatsapp: linha.whatsapp,
      },
    });
    despachar({ tipo: "etapa_pedida", etapa: "cupom" });
  }

  function aoConfirmarSemCliente(): void {
    despachar({ tipo: "cliente_definido", cliente: { tipo: "sem_cliente" } });
    despachar({ tipo: "etapa_pedida", etapa: "cupom" });
  }

  function atualizarAvulso(nome: string, whatsapp: string): void {
    if (nome.trim() === "") return;
    despachar({
      tipo: "cliente_definido",
      cliente: { tipo: "avulso", nome: nome.trim(), whatsapp },
    });
  }

  const avisoWhatsappInvalido =
    whatsappAvulso.trim() !== "" &&
    linkWhatsappDoCliente(whatsappAvulso) === null;

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-white">Cliente da venda</h3>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => despachar({ tipo: "etapa_pedida", etapa: "cupom" })}
        >
          Voltar ao cupom
        </Button>
      </div>

      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={
            modo === "sem_cliente"
              ? "border-admin-gold/60 bg-admin-gold/10 text-admin-gold"
              : ""
          }
          onClick={() => setModo("sem_cliente")}
        >
          <UserRoundX className="mr-1 size-3.5" />
          Sem cliente
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={
            modo === "buscar"
              ? "border-admin-gold/60 bg-admin-gold/10 text-admin-gold"
              : ""
          }
          onClick={() => setModo("buscar")}
        >
          <UserCheck className="mr-1 size-3.5" />
          Buscar cliente
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={
            modo === "avulso"
              ? "border-admin-gold/60 bg-admin-gold/10 text-admin-gold"
              : ""
          }
          onClick={() => setModo("avulso")}
        >
          <UserRoundPlus className="mr-1 size-3.5" />
          Cliente avulso
        </Button>
      </div>

      {modo === "sem_cliente" && (
        <div className="flex flex-col gap-2">
          {/* A aba muda só o modo local; quem muda o estado é o Confirmar.
              Com um cliente já escolhido, o painel diz a verdade do estado
              em vez de afirmar o contrário (ressalva da revisão de C3.2). */}
          <p className="text-xs text-zinc-400">
            {cliente.tipo === "sem_cliente"
              ? "A venda entra sem nenhum cliente vinculado."
              : `A venda ainda está com ${cliente.nome} — confirme para desvincular.`}
          </p>
          <Button
            type="button"
            className="bg-admin-gold text-black hover:bg-admin-gold/90"
            onClick={aoConfirmarSemCliente}
          >
            Confirmar sem cliente
          </Button>
        </div>
      )}

      {modo === "buscar" && (
        <div className="flex flex-col gap-2">
          <label
            htmlFor="busca-de-cliente-do-balcao"
            className="flex items-center gap-2 text-xs font-semibold text-zinc-400"
          >
            <Search className="size-3.5" />
            Nome, e-mail ou WhatsApp
          </label>
          <LocalBufferedInput
            id="busca-de-cliente-do-balcao"
            value={termoDeBusca}
            onFlush={aoDigitarBusca}
            delay={300}
            placeholder="Ex.: Maria, 11999999999"
            className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white outline-none focus:border-zinc-500"
          />
          {buscando && <p className="text-xs text-zinc-500">Buscando…</p>}
          {resultados.length > 0 && (
            <ul className="flex flex-col gap-1.5">
              {resultados.map((linha) => (
                <li key={linha.id}>
                  <button
                    type="button"
                    onClick={() => aoEscolherClienteCadastrado(linha)}
                    className="flex w-full items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-left text-sm text-white"
                  >
                    <span className="truncate">
                      {linha.full_name || "Cliente"}
                    </span>
                    <span className="text-xs text-zinc-400">
                      {linha.whatsapp || linha.email || ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {modo === "avulso" && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label
              htmlFor="nome-do-cliente-avulso"
              className="text-xs font-semibold text-zinc-400"
            >
              Nome
            </label>
            <LocalBufferedInput
              id="nome-do-cliente-avulso"
              value={nomeAvulso}
              onFlush={(valor) => {
                setNomeAvulso(valor);
                atualizarAvulso(valor, whatsappAvulso);
              }}
              delay={200}
              className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white outline-none focus:border-zinc-500"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label
              htmlFor="whatsapp-do-cliente-avulso"
              className="text-xs font-semibold text-zinc-400"
            >
              WhatsApp
            </label>
            <LocalBufferedInput
              id="whatsapp-do-cliente-avulso"
              value={whatsappAvulso}
              mask="phone"
              onFlush={(valor) => {
                setWhatsappAvulso(valor);
                atualizarAvulso(nomeAvulso, valor);
              }}
              delay={200}
              className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white outline-none focus:border-zinc-500"
            />
            {avisoWhatsappInvalido && (
              <p className="flex items-center gap-1 text-[11px] text-amber-400">
                <AlertTriangle className="size-3" />
                Esse número não abre conversa no WhatsApp — o recibo não vai ter
                o botão de enviar, mas a venda segue normal.
              </p>
            )}
          </div>
          <Button
            type="button"
            disabled={nomeAvulso.trim() === ""}
            className="bg-admin-gold text-black hover:bg-admin-gold/90"
            onClick={() => {
              atualizarAvulso(nomeAvulso, whatsappAvulso);
              despachar({ tipo: "etapa_pedida", etapa: "cupom" });
            }}
          >
            Confirmar cliente avulso
          </Button>
        </div>
      )}
    </div>
  );
}
