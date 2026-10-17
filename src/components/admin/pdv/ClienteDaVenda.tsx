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
  ChevronLeft,
  ChevronRight,
  Search,
  UserCheck,
  UserRoundPlus,
  UserRoundX,
} from "lucide-react";
import { type ReactElement, useRef, useState } from "react";
import "./pdv.css";

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
  const [erroDeBusca, setErroDeBusca] = useState(false);

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
    const rodada = ++rodadaRef.current;
    setTermoDeBusca(valor);
    setErroDeBusca(false);
    setResultados([]);
    const termoLimpo = valor.trim();
    if (termoLimpo.length < 2) {
      setBuscando(false);
      return;
    }
    setBuscando(true);
    try {
      const linhas = await buscarClientes(termoLimpo);
      if (rodada !== rodadaRef.current) return;
      setResultados(linhas);
    } catch (erro) {
      if (rodada !== rodadaRef.current) return;
      console.error("Erro ao buscar cliente no balcão:", erro);
      setResultados([]);
      setErroDeBusca(true);
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
    <section className="pdv-layer" aria-label="Identificação da venda">
      <div className="pdv-layer-heading">
        <h2>Cliente da venda</h2>
        <p className="pdv-muted">Opcional · toque no resultado para vincular</p>
      </div>
      <div className="pdv-stack">
        <div className="pdv-actions">
          <Button
            type="button"
            variant="outline"
            className="pdv-secondary pdv-choice"
            aria-pressed={modo === "buscar"}
            onClick={() => setModo("buscar")}
          >
            <UserCheck aria-hidden="true" className="pdv-blue size-5" />
            Buscar cliente
          </Button>
          <Button
            type="button"
            variant="outline"
            className="pdv-secondary pdv-choice"
            aria-pressed={modo === "avulso"}
            onClick={() => setModo("avulso")}
          >
            <UserRoundPlus aria-hidden="true" className="pdv-purple size-5" />
            Cliente avulso
          </Button>
        </div>
        {modo === "sem_cliente" && (
          <div className="pdv-card pdv-stack">
            <p className="pdv-heading">
              <UserRoundX aria-hidden="true" className="pdv-icon pdv-blue" />
              Continuar sem identificar?
            </p>
            <p className="pdv-muted">
              {cliente.tipo === "sem_cliente"
                ? "A venda entra sem nenhum cliente vinculado."
                : `A venda ainda está com ${cliente.nome} — confirme para desvincular.`}
            </p>
            <Button
              type="button"
              variant="outline"
              className="pdv-secondary pdv-confirm"
              onClick={aoConfirmarSemCliente}
            >
              Confirmar sem cliente
            </Button>
          </div>
        )}
        {modo === "buscar" && (
          <div className="pdv-stack">
            <label htmlFor="busca-de-cliente-do-balcao" className="pdv-heading">
              <Search aria-hidden="true" className="pdv-icon pdv-blue" />
              Nome, e-mail ou WhatsApp
            </label>
            <LocalBufferedInput
              id="busca-de-cliente-do-balcao"
              value={termoDeBusca}
              onFlush={aoDigitarBusca}
              delay={300}
              placeholder="Ex.: Maria, 11999999999"
              aria-describedby="busca-cliente-ajuda"
              className="pdv-field"
            />
            <p id="busca-cliente-ajuda" className="pdv-muted">
              Digite pelo menos 2 letras.
            </p>
            {buscando && (
              <p role="status" className="pdv-muted">
                Buscando…
              </p>
            )}
            {erroDeBusca && (
              <p role="alert" className="pdv-notice">
                Não foi possível buscar. Tente de novo.
              </p>
            )}
            {resultados.length > 0 && (
              <ul className="pdv-stack">
                {resultados.map((linha) => (
                  <li key={linha.id}>
                    <button
                      type="button"
                      onClick={() => aoEscolherClienteCadastrado(linha)}
                      className="pdv-result"
                    >
                      <UserCheck
                        aria-hidden="true"
                        className="pdv-icon pdv-purple"
                      />
                      <span>
                        <strong>{linha.full_name || "Cliente"}</strong>
                        <span className="pdv-muted">
                          {linha.whatsapp || linha.email || ""}
                        </span>
                      </span>
                      <ChevronRight
                        aria-hidden="true"
                        className="pdv-blue size-5"
                      />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {modo === "avulso" && (
          <div className="pdv-card pdv-stack">
            <h3 className="pdv-heading">
              <UserRoundPlus
                aria-hidden="true"
                className="pdv-icon pdv-purple"
              />
              Cliente avulso
            </h3>
            <div className="pdv-stack">
              <label htmlFor="nome-do-cliente-avulso" className="pdv-muted">
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
                className="pdv-field"
              />
            </div>
            <div className="pdv-stack">
              <label htmlFor="whatsapp-do-cliente-avulso" className="pdv-muted">
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
                className="pdv-field"
              />
              {avisoWhatsappInvalido && (
                <p className="pdv-muted flex items-start gap-2">
                  <AlertTriangle
                    aria-hidden="true"
                    className="pdv-orange size-4 shrink-0"
                  />
                  Esse número não abre conversa no WhatsApp — o recibo não vai
                  ter o botão de enviar disponível, mas a venda segue normal.
                </p>
              )}
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={nomeAvulso.trim() === ""}
              className="pdv-secondary pdv-confirm"
              onClick={() => {
                atualizarAvulso(nomeAvulso, whatsappAvulso);
                despachar({ tipo: "etapa_pedida", etapa: "cupom" });
              }}
            >
              Confirmar cliente avulso
            </Button>
          </div>
        )}
        <Button
          type="button"
          variant="outline"
          className="pdv-secondary pdv-choice"
          aria-pressed={modo === "sem_cliente"}
          onClick={() => setModo("sem_cliente")}
        >
          <UserRoundX aria-hidden="true" className="pdv-blue size-5" />
          Sem cliente
        </Button>
        <Button
          type="button"
          variant="outline"
          className="pdv-secondary"
          onClick={() => despachar({ tipo: "etapa_pedida", etapa: "cupom" })}
        >
          <ChevronLeft aria-hidden="true" className="pdv-blue size-5" />
          Voltar ao cupom
        </Button>
      </div>
    </section>
  );
}
