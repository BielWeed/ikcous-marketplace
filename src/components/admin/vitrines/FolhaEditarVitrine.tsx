import { LocalBufferedInput } from "@/components/admin/LocalBufferedInput";
import { OPCOES_MAX_ITENS_CARROSSEL } from "@/config/carrossel";
import { cn, formatCurrency, normalizeText } from "@/lib/utils";
import type { Product } from "@/types";
import { Hand, Search, Sparkles, Tag, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { FolhaInferior } from "./FolhaInferior";
import { QUANTIDADE_PADRAO, type SecaoDaHome, tipoDaVitrine } from "./tipos";

/**
 * O painel de UMA vitrine: nome, quantidade e escolha dos produtos no mesmo
 * lugar. Não grava nada sozinho — cada mudança sobe pelo callback e quem
 * grava é a tela, pelo mesmo caminho de sempre.
 *
 * O nome grava ao sair do campo, e clicar em "Concluir" já tira o foco dele.
 * O texto só existe no campo, então fechar o painel sem a gravação confirmada
 * o jogaria fora: "Concluir" espera a gravação e só fecha se ela foi
 * confirmada. Se falhou, o painel fica aberto com o texto digitado e o botão
 * tenta de novo o mesmo nome. Fechar (X, véu, Esc) segue descartando.
 */
export function FolhaEditarVitrine({
  secao,
  posicao,
  produtos,
  idsEmExibicao,
  aoFechar,
  aoRenomear,
  aoMudarQuantidade,
  aoAlternarProduto,
  aoVoltarAoAutomatico,
  aoEscolherManualmente,
  aoPedirExclusao,
}: {
  readonly secao: SecaoDaHome;
  readonly posicao: number;
  readonly produtos: readonly Product[];
  /** Ids que aparecem hoje na loja: os escolhidos, ou os do modo automático. */
  readonly idsEmExibicao: readonly string[];
  readonly aoFechar: () => void;
  /** Devolve `true` quando o nome já está gravado (ou nada mudou). */
  readonly aoRenomear: (titulo: string) => Promise<boolean>;
  readonly aoMudarQuantidade: (quantidade: number) => void;
  readonly aoAlternarProduto: (idDoProduto: string) => void;
  readonly aoVoltarAoAutomatico: () => void;
  readonly aoEscolherManualmente: () => void;
  /** Só existe para vitrine personalizada (as de fábrica não se excluem). */
  readonly aoPedirExclusao?: () => void;
}) {
  const [busca, setBusca] = useState("");
  const manual = (secao.productIds?.length ?? 0) > 0;
  const maximo = secao.maxItems ?? QUANTIDADE_PADRAO;
  const { rotulo } = tipoDaVitrine(secao);

  // Escolhidos primeiro, na ordem em que aparecem na loja; depois o resto.
  // A busca ignora acento ("alianca" acha "Aliança"), como a busca da loja.
  const lista = useMemo(() => {
    let candidatos = produtos;
    if (busca.trim()) {
      const q = normalizeText(busca);
      candidatos = produtos.filter(
        (p) =>
          normalizeText(p.name).includes(q) ||
          normalizeText(p.category).includes(q),
      );
    }
    const porId = new Map(candidatos.map((p) => [p.id, p]));
    const escolhidos: Product[] = [];
    for (const id of idsEmExibicao) {
      const p = porId.get(id);
      if (p) escolhidos.push(p);
    }
    const emExibicao = new Set(idsEmExibicao);
    return [...escolhidos, ...candidatos.filter((p) => !emExibicao.has(p.id))];
  }, [produtos, busca, idsEmExibicao]);

  const idDoCampoDeNome = `vitrine-title-${secao.id}`;

  // Último nome que subiu e ainda não foi confirmado (`null` = nada a perder).
  const nomePendente = useRef<string | null>(null);
  // A gravação do nome em andamento (a do blur ou a de uma nova tentativa).
  const gravandoNome = useRef<Promise<boolean> | null>(null);
  // Resultado da última gravação já terminada que nenhum "Concluir" usou ainda:
  // o toque que vem junto da perda de foco usa ESTE resultado, em vez de gravar
  // (e avisar) uma segunda vez. Só o toque seguinte tenta de novo.
  const resultadoSemUso = useRef<boolean | null>(null);
  const [falhouNome, setFalhouNome] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const aberta = useRef(true);
  useEffect(() => {
    aberta.current = true;
    return () => {
      aberta.current = false;
    };
  }, []);

  const gravarNome = (titulo: string): Promise<boolean> => {
    nomePendente.current = titulo;
    const gravacao = aoRenomear(titulo).then(
      (salvou) => salvou,
      () => false,
    );
    gravandoNome.current = gravacao;
    void gravacao.then((salvou) => {
      if (gravandoNome.current !== gravacao) return; // já existe uma mais nova
      gravandoNome.current = null;
      resultadoSemUso.current = salvou;
      if (salvou) nomePendente.current = null;
      if (aberta.current) setFalhouNome(!salvou);
    });
    return gravacao;
  };

  const concluir = async () => {
    // Em andamento (o blur do clique acabou de disparar): espera essa mesma.
    // Já terminada e ainda não usada: vale o resultado dela. Senão, se sobrou
    // um nome por gravar, é um toque seguinte: tenta outra vez.
    let salvou = true;
    setSalvando(true);
    try {
      if (gravandoNome.current) {
        salvou = await gravandoNome.current;
      } else if (resultadoSemUso.current !== null) {
        salvou = resultadoSemUso.current;
      } else if (nomePendente.current !== null) {
        salvou = await gravarNome(nomePendente.current);
      }
      resultadoSemUso.current = null;
    } finally {
      if (aberta.current) setSalvando(false);
    }
    // Só fecha se não surgiu um nome MAIS NOVO durante a espera (gravação em
    // andamento ou texto ainda por gravar): senão ele se perderia. Fica aberta
    // e o toque seguinte resolve.
    const haNomeMaisNovo =
      gravandoNome.current !== null || nomePendente.current !== null;
    if (salvou && !haNomeMaisNovo && aberta.current) aoFechar();
  };

  return (
    <FolhaInferior
      titulo="Editar vitrine"
      descricao={
        secao.active
          ? `${rotulo} · ${posicao}ª da lista`
          : `${rotulo} · oculta da loja`
      }
      aoFechar={aoFechar}
      rodape={
        <>
          {aoPedirExclusao ? (
            <button
              type="button"
              onClick={aoPedirExclusao}
              className="flex h-12 items-center gap-2 rounded-[14px] bg-rose-500/10 px-4 text-sm font-semibold text-rose-400 transition-colors hover:bg-rose-500/20"
            >
              <Trash2 className="size-4" />
              Excluir
            </button>
          ) : null}
          <button
            type="button"
            onClick={concluir}
            disabled={salvando}
            className="h-12 flex-1 rounded-[14px] bg-admin-gold text-[15px] font-extrabold text-zinc-950 transition-colors hover:bg-admin-gold/90 active:scale-[0.99] disabled:opacity-60"
          >
            {salvando ? "Salvando…" : "Concluir"}
          </button>
        </>
      }
    >
      <label
        htmlFor={idDoCampoDeNome}
        className="mb-1.5 mt-3 block px-0.5 text-xs font-semibold text-zinc-400"
      >
        Nome que o cliente vê
      </label>
      <LocalBufferedInput
        id={idDoCampoDeNome}
        name="title"
        value={secao.title || ""}
        // Somente leitura (e não desabilitado) enquanto "Concluir" espera: o
        // campo não desmonta nem perde o foco/valor, mas nada novo entra numa
        // janela em que a folha está prestes a fechar.
        readOnly={salvando}
        onFlush={(titulo) => void gravarNome(titulo)}
        placeholder="Título da vitrine"
        useShadcn={true}
        className="h-12 rounded-[14px] border-white/10 bg-zinc-900 px-3.5 text-[15px] font-semibold text-white placeholder:text-zinc-600 focus-visible:border-admin-gold focus-visible:ring-admin-gold/20"
      />
      {falhouNome ? (
        <p role="alert" className="mt-1.5 px-0.5 text-xs text-rose-400">
          Não deu para salvar o nome. Toque em Concluir para tentar de novo, ou
          feche para descartar.
        </p>
      ) : null}

      <p className="mb-1.5 mt-4 px-0.5 text-xs font-semibold text-zinc-400">
        Quantos produtos mostrar
      </p>
      <fieldset
        aria-label="Quantos produtos mostrar"
        className="grid auto-cols-fr grid-flow-col gap-1 rounded-[14px] border border-white/5 bg-zinc-900 p-1"
      >
        {OPCOES_MAX_ITENS_CARROSSEL.map((quantidade) => (
          <button
            key={quantidade}
            type="button"
            aria-pressed={maximo === quantidade}
            onClick={() => aoMudarQuantidade(quantidade)}
            className={cn(
              "h-9 rounded-[11px] text-[13px] font-semibold transition-colors",
              maximo === quantidade
                ? "bg-zinc-50 font-bold text-zinc-950"
                : "text-zinc-400 hover:text-white",
            )}
          >
            {quantidade}
          </button>
        ))}
      </fieldset>

      <p className="mb-1.5 mt-4 px-0.5 text-xs font-semibold text-zinc-400">
        Quais produtos
      </p>
      <fieldset
        aria-label="Quais produtos"
        className="grid auto-cols-fr grid-flow-col gap-1 rounded-[14px] border border-white/5 bg-zinc-900 p-1"
      >
        <button
          type="button"
          aria-pressed={!manual}
          onClick={aoVoltarAoAutomatico}
          className={cn(
            "flex h-9 items-center justify-center gap-1.5 rounded-[11px] text-[13px] font-semibold transition-colors",
            !manual
              ? "bg-zinc-50 font-bold text-zinc-950"
              : "text-zinc-400 hover:text-white",
          )}
        >
          <Sparkles className="size-3.5" />
          Automático
        </button>
        <button
          type="button"
          aria-pressed={manual}
          onClick={aoEscolherManualmente}
          className={cn(
            "flex h-9 items-center justify-center gap-1.5 rounded-[11px] text-[13px] font-semibold transition-colors",
            manual
              ? "bg-zinc-50 font-bold text-zinc-950"
              : "text-zinc-400 hover:text-white",
          )}
        >
          <Hand className="size-3.5" />
          Escolher
        </button>
      </fieldset>
      <p className="mt-2 px-0.5 text-xs leading-snug text-zinc-500">
        {manual
          ? 'Aparecem na ordem em que você marcar. "Automático" volta a loja a escolher sozinha.'
          : idsEmExibicao.length === 0 && produtos.length > 0
            ? "Nenhum produto aparece nesta vitrine agora. Toque em um produto da lista para escolher."
            : "Hoje a loja escolhe sozinha. Toque em um produto para passar a escolher você."}
      </p>

      <div className="relative mt-3">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-zinc-500" />
        <input
          type="text"
          value={busca}
          onChange={(evento) => setBusca(evento.target.value)}
          placeholder="Buscar por nome ou categoria"
          aria-label="Buscar produto"
          className="h-11 w-full rounded-[14px] border border-white/10 bg-zinc-900 pl-10 pr-9 text-sm font-medium text-white placeholder:text-zinc-600 focus:border-admin-gold focus:outline-none"
        />
        {busca ? (
          <button
            type="button"
            aria-label="Limpar busca"
            onClick={() => setBusca("")}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white"
          >
            <X className="size-4" />
          </button>
        ) : null}
      </div>

      <div className="mt-1">
        {lista.length === 0 ? (
          <p className="py-8 text-center text-sm text-zinc-500">
            Nenhum produto encontrado na busca.
          </p>
        ) : (
          lista.map((produto) => {
            const posicaoNaVitrine = idsEmExibicao.indexOf(produto.id);
            const marcado = posicaoNaVitrine !== -1;
            return (
              <button
                key={produto.id}
                type="button"
                data-produto-id={produto.id}
                aria-pressed={marcado}
                onClick={() => aoAlternarProduto(produto.id)}
                className="flex w-full items-center gap-3 border-b border-white/5 py-2.5 text-left transition-colors hover:bg-white/[0.02]"
              >
                <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-[12px] border border-white/5 bg-zinc-800">
                  {produto.images?.[0] ? (
                    <img
                      src={produto.images[0]}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="size-full object-cover"
                    />
                  ) : (
                    <Tag className="size-4 text-zinc-600" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-white">
                    {produto.name}
                  </span>
                  <span className="block text-xs tabular-nums text-zinc-500">
                    <span className="font-semibold text-zinc-300">
                      {formatCurrency(produto.price)}
                    </span>
                    {produto.category ? ` · ${produto.category}` : ""}
                  </span>
                </span>
                <span
                  aria-hidden="true"
                  className={cn(
                    "flex size-[26px] shrink-0 items-center justify-center rounded-[9px] border-[1.5px] text-xs font-extrabold tabular-nums",
                    marcado
                      ? "border-admin-gold bg-admin-gold text-zinc-950"
                      : "border-zinc-700 text-transparent",
                  )}
                >
                  {marcado ? posicaoNaVitrine + 1 : null}
                </span>
              </button>
            );
          })
        )}
      </div>
    </FolhaInferior>
  );
}
