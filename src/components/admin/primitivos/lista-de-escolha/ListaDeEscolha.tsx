import { useTelaDeComputador } from "@/hooks/useTelaDeComputador";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import {
  type KeyboardEvent as EventoDeTecla,
  type RefObject,
  useCallback,
  useRef,
  useState,
} from "react";
import { CorpoDaLista, idDaListaDe } from "./CorpoDaLista";
import { FolhaDaLista } from "./FolhaDaLista";
import { PopoverDaLista } from "./PopoverDaLista";
import { buscaLigada } from "./busca";
import type { PropsDaListaDeEscolha } from "./tipos";

export const PLACEHOLDER_PADRAO = "Escolha uma opção";

/**
 * A lista de escolha com gatilho próprio (o chip do Extrato); o campo comum
 * é o `CampoDeEscolha`, que usa esta peça por baixo.
 *
 * No celular a lista sobe como folha (`FolhaDaLista`); no computador
 * (>= 1024px, `useTelaDeComputador` — nunca `useTelaLarga`, que arrastaria o
 * Financeiro para outros pacotes) abre colada no gatilho (`PopoverDaLista`).
 * O miolo é o mesmo (`CorpoDaLista`).
 *
 * Abrir e escolher acontecem no `click`, nunca no pointerdown: o dedo que
 * rola a tela não abre nada. Ao fechar, o foco volta ao gatilho.
 */
export function ListaDeEscolha<V extends string>(
  props: PropsDaListaDeEscolha<V>,
) {
  const { id, rotulo, opcoes, tituloDaLista, desabilitado, gatilho } = props;
  const computador = useTelaDeComputador();
  const [aberta, setAberta] = useState(false);
  const botaoRef = useRef<HTMLButtonElement | null>(null);
  const listaRef = useRef<HTMLDivElement | null>(null);
  const buscaRef = useRef<HTMLInputElement | null>(null);

  const valorAtual = props.modo === "acao" ? null : props.valor;
  const escolhida =
    valorAtual === null
      ? null
      : (opcoes.find((o) => o.valor === valorAtual) ?? null);
  const textoMostrado =
    escolhida?.rotulo ?? props.placeholder ?? PLACEHOLDER_PADRAO;
  const comBusca = buscaLigada(opcoes, props.busca);
  const titulo = tituloDaLista ?? rotulo;

  const fechar = useCallback(() => setAberta(false), []);

  function escolher(valor: V) {
    setAberta(false);
    if (props.modo === "acao") {
      // Ação: reaplicar a mesma combinação é de propósito.
      props.aoEscolher(valor);
    } else if (valor !== props.valor) {
      // Valor: a mesma opção não "muda" nada (como o `<select>` nativo).
      props.aoMudar(valor);
    }
  }

  function focarAoAbrir(conteudo: HTMLElement) {
    if (!comBusca) listaRef.current?.focus();
    // Computador: digitar já filtra. Celular: a busca NÃO ganha foco, senão o
    // teclado sobe e cobre a lista.
    else if (computador) buscaRef.current?.focus();
    else conteudo.focus();
  }

  function aoTeclarNoGatilho(evento: EventoDeTecla<HTMLButtonElement>) {
    if (evento.altKey || evento.ctrlKey || evento.metaKey) return;
    if (evento.key !== "ArrowDown" && evento.key !== "ArrowUp") return;
    evento.preventDefault();
    if (!desabilitado) setAberta(true);
  }

  const corpo = (
    <CorpoDaLista
      id={id}
      rotulo={titulo}
      opcoes={opcoes}
      valorEscolhido={valorAtual}
      comBusca={comBusca}
      variante={computador ? "popover" : "folha"}
      aoEscolher={escolher}
      listaRef={listaRef}
      buscaRef={buscaRef}
    />
  );

  return (
    <PopoverPrimitive.Root
      open={aberta && computador}
      onOpenChange={(abrir) => {
        if (!abrir) fechar();
      }}
      modal
    >
      {/* Âncora "virtual" no botão: o gatilho pode devolver mais de um
          elemento (o campo devolve rótulo + botão) e a lista mede o botão. */}
      <PopoverPrimitive.Anchor
        virtualRef={botaoRef as RefObject<HTMLButtonElement>}
      />
      {gatilho({
        botao: {
          ref: botaoRef,
          id,
          type: "button",
          "aria-haspopup": "listbox",
          "aria-expanded": aberta,
          "aria-controls": idDaListaDe(id),
          "data-valor": escolhida?.valor ?? "",
          disabled: desabilitado,
          onClick: () => {
            if (!desabilitado) setAberta((antes) => !antes);
          },
          onKeyDown: aoTeclarNoGatilho,
        },
        aberta,
        escolhida,
        textoMostrado,
      })}
      {computador ? (
        <PopoverDaLista
          titulo={titulo}
          botaoRef={botaoRef}
          aoFocarAoAbrir={focarAoAbrir}
        >
          {corpo}
        </PopoverDaLista>
      ) : (
        <FolhaDaLista
          aberta={aberta}
          aoFechar={fechar}
          titulo={titulo}
          botaoRef={botaoRef}
          aoFocarAoAbrir={focarAoAbrir}
        >
          {corpo}
        </FolhaDaLista>
      )}
    </PopoverPrimitive.Root>
  );
}
