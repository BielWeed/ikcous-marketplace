import {
  AlertTriangle,
  Camera,
  Check,
  CheckCircle,
  ChevronLeft,
  Copy,
  Loader2,
  MapPin,
  Minus,
  Plus,
  X,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { DadosDaSolicitacao, Desfecho } from "@/hooks/useDevolucaoCliente";
import { copiarParaClipboard } from "@/lib/copiar-para-clipboard";
import {
  GRUPOS_DE_MOTIVO,
  MAXIMO_DE_FOTOS,
  devolveFreteDeIda,
  erroDaResolucao,
  erroDoMotivo,
  erroDosItens,
  explicacaoMetodo,
  explicacaoResolucao,
  formatarDia,
  formatarReais,
  fotosObrigatorias,
  porqueMotivoIndisponivel,
  resolucoesPermitidas,
  rotuloMetodo,
  rotuloMotivo,
  rotuloResolucao,
  tipoPrevisto,
  valorDaSelecao,
} from "@/lib/devolucao";
import { cn } from "@/lib/utils";
import type {
  ElegibilidadeDevolucao,
  MetodoDevolucao,
  MotivoDevolucao,
  ResolucaoDevolucao,
  ResultadoSolicitacao,
} from "@/types/devolucao";
import { haptic } from "@/utils/haptic";

interface SolicitarDevolucaoSheetProps {
  readonly aberto: boolean;
  readonly onAbertoMudou: (aberto: boolean) => void;
  readonly elegibilidade: ElegibilidadeDevolucao;
  readonly userId: string;
  readonly enderecoDaLoja: string | null;
  readonly horarioDaLoja: string | null;
  readonly solicitar: (
    dados: DadosDaSolicitacao,
  ) => Promise<Desfecho<ResultadoSolicitacao>>;
  readonly enviarFoto: (
    arquivo: File,
    userId: string,
  ) => Promise<Desfecho<string>>;
}

type Passo = 1 | 2 | 3 | 4;

const TITULO_DO_PASSO = new Map<Passo, string>([
  [1, "O que vai voltar?"],
  [2, "Por que vai devolver?"],
  [3, "Como resolver"],
  [4, "Confira e confirme"],
]);

interface FotoEscolhida {
  chave: string;
  arquivo: File;
  previa: string;
  /** Caminho no bucket depois de enviada (reenvio não sobe de novo). */
  caminho: string | null;
}

const previaDe = (arquivo: File) =>
  typeof URL !== "undefined" && typeof URL.createObjectURL === "function"
    ? URL.createObjectURL(arquivo)
    : "";

const soltarPrevia = (previa: string) => {
  if (previa && typeof URL.revokeObjectURL === "function") {
    URL.revokeObjectURL(previa);
  }
};

/**
 * Pedido de devolução/troca do cliente: folha de baixo no celular, diálogo
 * centralizado a partir de 640px. Quatro passos — itens, motivo (+ fotos),
 * resolução e forma de devolver, revisão com a nota legal — e a tela de
 * protocolo (Decreto 7.962/2013: confirmação imediata, no mesmo canal).
 *
 * O que a tela oferece é o espelho do que a RPC aceita (`src/lib/devolucao`);
 * quando mesmo assim ela recusa, a mensagem do servidor aparece como veio.
 */
export function SolicitarDevolucaoSheet(props: SolicitarDevolucaoSheetProps) {
  const { aberto, onAbertoMudou } = props;
  return (
    <Sheet open={aberto} onOpenChange={onAbertoMudou}>
      <SheetContent
        side="bottom"
        data-testid="folha-devolucao"
        className={cn(
          "mx-auto flex max-h-[92dvh] flex-col gap-0 rounded-t-3xl bg-white p-0 text-zinc-900",
          "sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:max-h-[85dvh] sm:w-full sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-3xl sm:border",
          "sm:data-[state=closed]:slide-out-to-left-1/2 sm:data-[state=open]:slide-in-from-left-1/2",
        )}
      >
        <FluxoDaDevolucao {...props} />
      </SheetContent>
    </Sheet>
  );
}

function FluxoDaDevolucao({
  onAbertoMudou,
  elegibilidade,
  userId,
  enderecoDaLoja,
  horarioDaLoja,
  solicitar,
  enviarFoto,
}: SolicitarDevolucaoSheetProps) {
  const { itens, janelas, politica, prazos, metodos } = elegibilidade;
  const itensDisponiveis = itens.filter((item) => item.disponivel > 0);

  const [passo, setPasso] = useState<Passo>(1);
  const [selecao, setSelecao] = useState<ReadonlyMap<string, number>>(() => {
    // Um item só, com uma unidade: já vem marcado — é o caso mais comum.
    const unico = itensDisponiveis.length === 1 ? itensDisponiveis[0] : null;
    return new Map(
      unico && unico.disponivel === 1 ? [[unico.order_item_id, 1]] : [],
    );
  });
  const [motivo, setMotivo] = useState<MotivoDevolucao | null>(null);
  const [detalhe, setDetalhe] = useState("");
  const [fotos, setFotos] = useState<FotoEscolhida[]>([]);
  const [resolucao, setResolucao] = useState<ResolucaoDevolucao | null>(null);
  const [metodo, setMetodo] = useState<MetodoDevolucao | null>(
    metodos.length === 1 ? metodos[0] : null,
  );
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [progresso, setProgresso] = useState("");
  const [resultado, setResultado] = useState<ResultadoSolicitacao | null>(null);
  const entradaDeFotoRef = useRef<HTMLInputElement>(null);
  const fotosRef = useRef(fotos);

  useEffect(() => {
    fotosRef.current = fotos;
  }, [fotos]);
  // As prévias são URLs de objeto: soltam a memória quando a folha fecha.
  useEffect(
    () => () => {
      for (const foto of fotosRef.current) soltarPrevia(foto.previa);
    },
    [],
  );

  const tipo = motivo ? tipoPrevisto(motivo, janelas) : null;
  const permitidas = resolucoesPermitidas(motivo, janelas, politica);
  const exigeFotos = fotosObrigatorias(motivo, politica);
  const valor = valorDaSelecao(itens, selecao);
  const comFrete = devolveFreteDeIda(tipo, itens, selecao);
  const enderecoParaEntregar =
    politica.endereco_devolucao?.trim() || enderecoDaLoja?.trim() || null;

  // Motivo novo pode tirar do ar a resolução já escolhida (ex.: troca de
  // política não aceita reembolso) — a escolha velha não pode sobreviver.
  const resolucaoValida =
    resolucao && permitidas.includes(resolucao) ? resolucao : null;

  function erroDoPasso(p: Passo): string | null {
    if (p === 1) return erroDosItens(selecao);
    if (p === 2) {
      return erroDoMotivo({
        motivo,
        detalhe,
        quantidadeDeFotos: fotos.length,
        janelas,
        politica,
      });
    }
    if (p === 3) {
      return erroDaResolucao({
        resolucao: resolucaoValida,
        metodo,
        permitidas,
        metodos,
      });
    }
    return null;
  }

  function avancar() {
    const problema = erroDoPasso(passo);
    setErro(problema);
    if (problema) {
      haptic.light();
      return;
    }
    if (passo < 4) setPasso((passo + 1) as Passo);
  }

  function voltar() {
    setErro(null);
    if (passo > 1) setPasso((passo - 1) as Passo);
  }

  function mudarQuantidade(orderItemId: string, qtd: number) {
    setSelecao((antes) => {
      const proxima = new Map(antes);
      if (qtd <= 0) proxima.delete(orderItemId);
      else proxima.set(orderItemId, qtd);
      return proxima;
    });
    setErro(null);
  }

  function adicionarFotos(lista: FileList | null) {
    if (!lista || lista.length === 0) return;
    const vagas = MAXIMO_DE_FOTOS - fotos.length;
    const novas = Array.from(lista)
      .slice(0, Math.max(vagas, 0))
      .map((arquivo) => ({
        chave: `${arquivo.name}-${arquivo.size}-${Math.random()}`,
        arquivo,
        previa: previaDe(arquivo),
        caminho: null,
      }));
    if (lista.length > vagas) {
      toast.info(`Envie no máximo ${MAXIMO_DE_FOTOS} fotos.`);
    }
    setFotos((antes) => [...antes, ...novas]);
    setErro(null);
    if (entradaDeFotoRef.current) entradaDeFotoRef.current.value = "";
  }

  function removerFoto(chave: string) {
    setFotos((antes) => {
      const alvo = antes.find((f) => f.chave === chave);
      if (alvo) soltarPrevia(alvo.previa);
      return antes.filter((f) => f.chave !== chave);
    });
  }

  async function confirmar() {
    if (enviando || !motivo || !resolucaoValida || !metodo) return;
    setEnviando(true);
    setErro(null);
    try {
      const caminhos: string[] = [];
      for (const [indice, foto] of fotos.entries()) {
        if (foto.caminho) {
          caminhos.push(foto.caminho);
          continue;
        }
        setProgresso(`Enviando fotos (${indice + 1} de ${fotos.length})…`);
        const envio = await enviarFoto(foto.arquivo, userId);
        if (!envio.ok) {
          setErro(envio.erro);
          return;
        }
        caminhos.push(envio.valor);
        setFotos((antes) =>
          antes.map((f) =>
            f.chave === foto.chave ? { ...f, caminho: envio.valor } : f,
          ),
        );
      }

      setProgresso("Registrando o pedido…");
      const desfecho = await solicitar({
        itens: Array.from(selecao.entries())
          .filter(([, qtd]) => qtd > 0)
          .map(([order_item_id, quantidade]) => ({
            order_item_id,
            quantidade,
          })),
        motivo,
        detalhe,
        resolucao: resolucaoValida,
        metodo,
        fotos: caminhos,
      });
      if (!desfecho.ok) {
        setErro(desfecho.erro);
        return;
      }
      haptic.medium();
      setResultado(desfecho.valor);
    } finally {
      setEnviando(false);
      setProgresso("");
    }
  }

  if (resultado) {
    return (
      <Sucesso resultado={resultado} onFechar={() => onAbertoMudou(false)} />
    );
  }

  return (
    <>
      <SheetHeader className="shrink-0 border-b border-zinc-100 px-5 pb-3 pr-12 pt-5">
        <p className="text-[11px] font-semibold text-zinc-500">
          Devolução ou troca · Passo {passo} de 4
        </p>
        <SheetTitle className="text-lg font-black tracking-tight text-zinc-950">
          {TITULO_DO_PASSO.get(passo)}
        </SheetTitle>
        <SheetDescription className="sr-only">
          Pedido de devolução ou troca de produtos deste pedido.
        </SheetDescription>
        <div className="mt-1 flex gap-1" aria-hidden>
          {[1, 2, 3, 4].map((p) => (
            <span
              key={p}
              className={cn(
                "h-1 flex-1 rounded-full",
                p <= passo ? "bg-zinc-900" : "bg-zinc-200",
              )}
            />
          ))}
        </div>
      </SheetHeader>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-5 py-4">
        {passo === 1 && (
          <>
            <Prazos elegibilidade={elegibilidade} />
            <div className="space-y-2.5" data-testid="passo-itens">
              {itensDisponiveis.map((item) => {
                const qtd = selecao.get(item.order_item_id) ?? 0;
                const nome = item.product_name || "Produto";
                return (
                  <div
                    key={item.order_item_id}
                    className={cn(
                      "flex items-center gap-3 rounded-2xl border p-3 transition-colors",
                      qtd > 0
                        ? "border-zinc-900 bg-zinc-50"
                        : "border-zinc-100 bg-white",
                    )}
                  >
                    <div className="size-14 shrink-0 overflow-hidden rounded-xl border border-zinc-100 bg-zinc-50">
                      {item.image_url && (
                        <img
                          src={item.image_url}
                          alt=""
                          className="size-full object-cover"
                        />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold text-zinc-900">
                        {nome}
                      </p>
                      <p className="text-xs text-zinc-500">
                        {formatarReais(item.valor_unitario)} · pode devolver{" "}
                        {item.disponivel}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        aria-label={`Diminuir ${nome}`}
                        disabled={qtd === 0}
                        onClick={() =>
                          mudarQuantidade(item.order_item_id, qtd - 1)
                        }
                        className="flex size-11 items-center justify-center rounded-xl border border-zinc-200 text-zinc-700 transition-colors active:scale-95 disabled:opacity-40"
                      >
                        <Minus className="size-4" />
                      </button>
                      <span
                        className="w-6 text-center text-sm font-black tabular-nums"
                        aria-live="polite"
                      >
                        {qtd}
                      </span>
                      <button
                        type="button"
                        aria-label={`Aumentar ${nome}`}
                        disabled={qtd >= item.disponivel}
                        onClick={() =>
                          mudarQuantidade(item.order_item_id, qtd + 1)
                        }
                        className="flex size-11 items-center justify-center rounded-xl border border-zinc-200 text-zinc-700 transition-colors active:scale-95 disabled:opacity-40"
                      >
                        <Plus className="size-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {passo === 2 && (
          <div className="space-y-4" data-testid="passo-motivo">
            {GRUPOS_DE_MOTIVO.map((grupo) => (
              <fieldset key={grupo.titulo} className="space-y-2">
                <legend className="mb-1 text-xs font-bold text-zinc-500">
                  {grupo.titulo}
                </legend>
                {grupo.motivos.map((m) => {
                  const disponivel = tipoPrevisto(m, janelas) !== null;
                  return (
                    <OpcaoDeRadio
                      key={m}
                      nome="motivo"
                      valor={m}
                      marcado={motivo === m}
                      desabilitado={!disponivel}
                      titulo={rotuloMotivo(m)}
                      explicacao={
                        disponivel ? undefined : porqueMotivoIndisponivel(m)
                      }
                      onEscolher={() => {
                        setMotivo(m);
                        setErro(null);
                      }}
                    />
                  );
                })}
              </fieldset>
            ))}

            <div className="space-y-1.5">
              <label
                htmlFor="devolucao-detalhe"
                className="text-xs font-bold text-zinc-500"
              >
                {motivo === "outro"
                  ? "Conte o que aconteceu"
                  : "Quer contar mais? (opcional)"}
              </label>
              <textarea
                id="devolucao-detalhe"
                value={detalhe}
                maxLength={1000}
                rows={3}
                onChange={(e) => setDetalhe(e.target.value)}
                placeholder="Ex.: a costura abriu na primeira lavagem."
                className="w-full rounded-2xl border border-zinc-200 bg-white p-3 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-zinc-900"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-bold text-zinc-500">
                  Fotos{" "}
                  {exigeFotos ? (
                    <span className="text-red-700">
                      (obrigatório para problema no produto)
                    </span>
                  ) : (
                    "(opcional)"
                  )}
                </p>
                <span className="text-xs tabular-nums text-zinc-500">
                  {fotos.length}/{MAXIMO_DE_FOTOS}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {fotos.map((foto) => (
                  <div
                    key={foto.chave}
                    className="relative aspect-square overflow-hidden rounded-xl border border-zinc-100 bg-zinc-100"
                  >
                    {foto.previa && (
                      <img
                        src={foto.previa}
                        alt="Foto escolhida"
                        className="size-full object-cover"
                      />
                    )}
                    <button
                      type="button"
                      aria-label="Remover foto"
                      onClick={() => removerFoto(foto.chave)}
                      className="absolute right-1 top-1 flex size-8 items-center justify-center rounded-full bg-black/60 text-white"
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                ))}
                {fotos.length < MAXIMO_DE_FOTOS && (
                  <button
                    type="button"
                    onClick={() => entradaDeFotoRef.current?.click()}
                    className="flex aspect-square flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-zinc-300 text-xs font-bold text-zinc-600 transition-colors hover:border-zinc-400 active:scale-95"
                  >
                    <Camera className="size-5" />
                    Adicionar
                  </button>
                )}
              </div>
              <input
                ref={entradaDeFotoRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                data-testid="entrada-fotos-devolucao"
                className="sr-only"
                tabIndex={-1}
                aria-hidden
                onChange={(e) => adicionarFotos(e.target.files)}
              />
            </div>
          </div>
        )}

        {passo === 3 && (
          <div className="space-y-5" data-testid="passo-resolucao">
            <fieldset className="space-y-2">
              <legend className="mb-1 text-xs font-bold text-zinc-500">
                Como prefere resolver?
              </legend>
              {tipo === "troca" && (
                <p className="rounded-2xl bg-zinc-50 p-3 text-xs leading-relaxed text-zinc-600">
                  O prazo de arrependimento terminou: pela política da loja,
                  este pedido pode ser trocado ou virar vale-troca.
                </p>
              )}
              {permitidas.map((r) => (
                <OpcaoDeRadio
                  key={r}
                  nome="resolucao"
                  valor={r}
                  marcado={resolucaoValida === r}
                  titulo={rotuloResolucao(r)}
                  explicacao={explicacaoResolucao(r)}
                  onEscolher={() => {
                    setResolucao(r);
                    setErro(null);
                  }}
                />
              ))}
            </fieldset>

            <fieldset className="space-y-2">
              <legend className="mb-1 text-xs font-bold text-zinc-500">
                Como o produto volta para a loja?
              </legend>
              {metodos.map((m) => (
                <OpcaoDeRadio
                  key={m}
                  nome="metodo"
                  valor={m}
                  marcado={metodo === m}
                  titulo={rotuloMetodo(m)}
                  explicacao={explicacaoMetodo(m)}
                  onEscolher={() => {
                    setMetodo(m);
                    setErro(null);
                  }}
                >
                  {m === "entrega_na_loja" &&
                    (enderecoParaEntregar || horarioDaLoja) && (
                      <span className="mt-2 flex gap-2 rounded-xl bg-zinc-50 p-2.5 text-xs text-zinc-600">
                        <MapPin className="mt-0.5 size-3.5 shrink-0" />
                        <span>
                          {enderecoParaEntregar}
                          {enderecoParaEntregar && horarioDaLoja && <br />}
                          {horarioDaLoja && `Horário: ${horarioDaLoja}`}
                        </span>
                      </span>
                    )}
                </OpcaoDeRadio>
              ))}
            </fieldset>
          </div>
        )}

        {passo === 4 && motivo && (
          <div className="space-y-4" data-testid="passo-revisao">
            <div className="space-y-2 rounded-2xl border border-zinc-100 p-4">
              {itens
                .filter((item) => (selecao.get(item.order_item_id) ?? 0) > 0)
                .map((item) => (
                  <div
                    key={item.order_item_id}
                    className="flex justify-between gap-3 text-sm"
                  >
                    <span className="min-w-0 truncate text-zinc-700">
                      {selecao.get(item.order_item_id)}× {item.product_name}
                    </span>
                    <span className="shrink-0 font-bold tabular-nums">
                      {formatarReais(
                        (selecao.get(item.order_item_id) ?? 0) *
                          item.valor_unitario,
                      )}
                    </span>
                  </div>
                ))}
              <div className="border-t border-dashed border-zinc-200 pt-2">
                <LinhaDeRevisao rotulo="Motivo" valor={rotuloMotivo(motivo)} />
                {resolucaoValida && (
                  <LinhaDeRevisao
                    rotulo="Resolução"
                    valor={rotuloResolucao(resolucaoValida)}
                  />
                )}
                {metodo && (
                  <LinhaDeRevisao
                    rotulo="Devolução"
                    valor={rotuloMetodo(metodo)}
                  />
                )}
                {fotos.length > 0 && (
                  <LinhaDeRevisao
                    rotulo="Fotos"
                    valor={`${fotos.length} ${fotos.length === 1 ? "foto" : "fotos"}`}
                  />
                )}
                <LinhaDeRevisao
                  rotulo="Valor dos itens"
                  valor={formatarReais(valor)}
                />
              </div>
            </div>

            <NotaLegal
              tipo={tipo}
              comFrete={comFrete}
              prazoArrependimento={politica.prazo_arrependimento_dias}
              prazoAte={
                tipo === "arrependimento"
                  ? prazos.arrependimento_ate
                  : tipo === "vicio"
                    ? prazos.vicio_ate
                    : prazos.troca_ate
              }
            />

            {politica.texto_politica && (
              <details className="rounded-2xl bg-zinc-50 p-3 text-xs text-zinc-600">
                <summary className="cursor-pointer font-bold text-zinc-700">
                  Ler a política de trocas da loja
                </summary>
                <p className="mt-2 whitespace-pre-line leading-relaxed">
                  {politica.texto_politica}
                </p>
              </details>
            )}
          </div>
        )}

        {erro && (
          <p
            role="alert"
            className="flex gap-2 rounded-2xl border border-red-100 bg-red-50 p-3 text-sm font-semibold text-red-700"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            {erro}
          </p>
        )}
      </div>

      <div className="flex shrink-0 gap-2 border-t border-zinc-100 bg-white px-5 pb-[calc(0.75rem+var(--safe-area-bottom,env(safe-area-inset-bottom,0px)))] pt-3">
        {passo > 1 && (
          <button
            type="button"
            onClick={voltar}
            disabled={enviando}
            className="flex h-12 items-center justify-center gap-1 rounded-2xl border border-zinc-200 px-4 text-sm font-bold text-zinc-700 transition-all active:scale-95 disabled:opacity-50"
          >
            <ChevronLeft className="size-4" />
            Voltar
          </button>
        )}
        {passo < 4 ? (
          <button
            type="button"
            onClick={avancar}
            className="flex h-12 flex-1 items-center justify-center rounded-2xl bg-zinc-900 text-sm font-bold text-white transition-all active:scale-[0.98]"
          >
            Continuar
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void confirmar()}
            disabled={enviando}
            className="flex h-12 flex-1 items-center justify-center gap-2 rounded-2xl bg-zinc-900 text-sm font-bold text-white transition-all active:scale-[0.98] disabled:opacity-60"
          >
            {enviando && <Loader2 className="size-4 animate-spin" />}
            {enviando ? progresso || "Enviando…" : "Confirmar devolução"}
          </button>
        )}
      </div>
    </>
  );
}

function Prazos({
  elegibilidade,
}: Readonly<{ elegibilidade: ElegibilidadeDevolucao }>) {
  const { prazos, janelas, politica } = elegibilidade;
  const linhas: Array<{ rotulo: string; ate: string | null; aberta: boolean }> =
    [];
  if (prazos.arrependimento_ate) {
    linhas.push({
      rotulo: `Desistir da compra (${politica.prazo_arrependimento_dias} dias)`,
      ate: prazos.arrependimento_ate,
      aberta: janelas.arrependimento,
    });
  }
  if (prazos.troca_ate) {
    linhas.push({
      rotulo: "Troca por tamanho ou gosto",
      ate: prazos.troca_ate,
      aberta: janelas.troca,
    });
  }
  if (prazos.vicio_ate) {
    linhas.push({
      rotulo: "Problema no produto",
      ate: prazos.vicio_ate,
      aberta: janelas.vicio,
    });
  }
  if (linhas.length === 0) return null;
  return (
    <ul className="space-y-1.5 rounded-2xl bg-zinc-50 p-3" aria-label="Prazos">
      {linhas.map((linha) => (
        <li
          key={linha.rotulo}
          className="flex items-center justify-between gap-3 text-xs"
        >
          <span className="text-zinc-600">{linha.rotulo}</span>
          <span
            className={cn(
              "shrink-0 font-bold tabular-nums",
              linha.aberta ? "text-emerald-700" : "text-zinc-500 line-through",
            )}
          >
            até {formatarDia(linha.ate)}
            {!linha.aberta && <span className="sr-only"> (encerrado)</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

function OpcaoDeRadio({
  nome,
  valor,
  marcado,
  desabilitado = false,
  titulo,
  explicacao,
  onEscolher,
  children,
}: Readonly<{
  nome: string;
  valor: string;
  marcado: boolean;
  desabilitado?: boolean;
  titulo: string;
  explicacao?: string;
  onEscolher: () => void;
  children?: ReactNode;
}>) {
  return (
    <label
      className={cn(
        "flex min-h-11 cursor-pointer gap-3 rounded-2xl border p-3 transition-colors focus-within:ring-2 focus-within:ring-zinc-900/20",
        marcado ? "border-zinc-900 bg-zinc-50" : "border-zinc-100 bg-white",
        desabilitado && "cursor-not-allowed opacity-50",
      )}
    >
      <input
        type="radio"
        name={nome}
        value={valor}
        checked={marcado}
        disabled={desabilitado}
        onChange={onEscolher}
        className="sr-only"
      />
      <span
        aria-hidden
        className={cn(
          "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border",
          marcado
            ? "border-zinc-900 bg-zinc-900 text-white"
            : "border-zinc-300",
        )}
      >
        {marcado && <Check className="size-3" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold text-zinc-900">{titulo}</span>
        {explicacao && (
          <span className="mt-0.5 block text-xs leading-relaxed text-zinc-500">
            {explicacao}
          </span>
        )}
        {children}
      </span>
    </label>
  );
}

function LinhaDeRevisao({
  rotulo,
  valor,
}: Readonly<{ rotulo: string; valor: string }>) {
  return (
    <div className="flex justify-between gap-3 py-0.5 text-sm">
      <span className="text-zinc-500">{rotulo}</span>
      <span className="text-right font-semibold text-zinc-900">{valor}</span>
    </div>
  );
}

function NotaLegal({
  tipo,
  comFrete,
  prazoArrependimento,
  prazoAte,
}: Readonly<{
  tipo: ReturnType<typeof tipoPrevisto>;
  comFrete: boolean;
  prazoArrependimento: number;
  prazoAte: string | null;
}>) {
  const ate = prazoAte ? ` (até ${formatarDia(prazoAte)})` : "";
  let texto: string;
  if (tipo === "arrependimento") {
    texto = `Compra pela internet pode ser desfeita em até ${prazoArrependimento} dias da entrega, sem precisar explicar o motivo (Código de Defesa do Consumidor, art. 49)${ate}.`;
  } else if (tipo === "vicio") {
    texto = `Produto com problema tem garantia legal (Código de Defesa do Consumidor, arts. 18 e 26)${ate}: a loja confere e resolve com troca, reembolso ou vale.`;
  } else {
    texto = `Troca por tamanho ou gosto segue a política da loja${ate}.`;
  }
  const frete =
    tipo === "arrependimento" || tipo === "vicio"
      ? comFrete
        ? " Como o pedido volta inteiro, o frete que você pagou também é devolvido."
        : " O frete de ida só é devolvido quando o pedido volta inteiro."
      : "";
  return (
    <p className="rounded-2xl border border-emerald-100 bg-emerald-50 p-3 text-xs leading-relaxed text-emerald-900">
      {texto}
      {frete}
    </p>
  );
}

function Sucesso({
  resultado,
  onFechar,
}: Readonly<{ resultado: ResultadoSolicitacao; onFechar: () => void }>) {
  async function copiar() {
    const ok = await copiarParaClipboard(resultado.protocolo);
    if (ok) toast.success("Protocolo copiado!");
    else toast.error("Não foi possível copiar. Anote o protocolo.");
  }
  return (
    <div
      className="flex flex-col items-center gap-3 px-6 pb-[calc(1.25rem+var(--safe-area-bottom,env(safe-area-inset-bottom,0px)))] pt-8 text-center"
      data-testid="devolucao-sucesso"
    >
      <div className="flex size-14 items-center justify-center rounded-full bg-emerald-50">
        <CheckCircle className="size-7 text-emerald-700" />
      </div>
      <SheetTitle className="text-xl font-black tracking-tight text-zinc-950">
        Pedido de devolução enviado
      </SheetTitle>
      <SheetDescription className="text-sm leading-relaxed text-zinc-600">
        Guarde o protocolo. A resposta da loja aparece aqui no pedido e nas suas
        notificações.
      </SheetDescription>
      <button
        type="button"
        onClick={() => void copiar()}
        className="mt-1 flex min-h-11 items-center gap-2 rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-2 font-mono text-lg font-black tracking-wider text-zinc-900"
        aria-label={`Copiar protocolo ${resultado.protocolo}`}
      >
        {resultado.protocolo}
        <Copy className="size-4 text-zinc-500" />
      </button>
      <button
        type="button"
        onClick={onFechar}
        className="mt-3 flex h-12 w-full items-center justify-center rounded-2xl bg-zinc-900 text-sm font-bold text-white transition-all active:scale-[0.98]"
      >
        Fechar
      </button>
    </div>
  );
}
