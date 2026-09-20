import { LocalBufferedInput } from "@/components/admin/LocalBufferedInput";
import { cn } from "@/lib/utils";
import type { ProductVariant } from "@/types";
import {
  MAX_ATRIBUTOS_DA_GRADE,
  type AtributoDaGrade,
  gerarGrade,
  primeiroSkuEmColisao,
  skusDaGrade,
} from "@/utils/grade-de-combinacoes";
import { SEPARADOR_DE_ATRIBUTOS, dividirEmAtributos } from "@/utils/variante-composta";
import { Layers, Plus, X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";

/**
 * Modal "Nova variante em grade" (peça 21, desenho A aprovado pelo dono em
 * 14/09/2026). PASSO 1: um grupo por atributo, com os valores JÁ USADOS no
 * produto aparecendo prontos como chips (o pedido literal do dono: "a parte
 * do tamanho a gente já tinha selecionado no outro, fica salvo o valor") —
 * toca nos valores, digita os novos, e "Gerar grade" monta o cartesiano.
 * PASSO 2: só as combinações que AINDA NÃO EXISTEM, cada uma com estoque,
 * preço e SKU editáveis, com "Aplicar para todas" para o 90% do lote.
 *
 * O modal NÃO grava nada no banco: efetivar devolve as linhas pelo
 * `onEfetivar` e elas entram na lista de variantes do formulário como linhas
 * comuns (`temp-`), gravadas pelo MESMO `upsertVariants` de sempre quando o
 * produto é salvo — zero caminho novo de persistência, zero migration.
 * Cancelar e Voltar não deixam rastro nenhum.
 *
 * A trava de um grupo por produto (`um-grupo-de-variacao.ts`) é respeitada
 * DUAS vezes: aqui no "Gerar" (falha cedo, antes do lojista preencher o
 * passo 2) e de novo no efetivar, dentro da tela dona do estado. Produto
 * legado de outro grupo recebe o diagnóstico e a grade NÃO converte nada
 * por conta própria.
 */

/** Linha pronta que o modal entrega para o formulário, na ordem da grade. */
export interface LinhaProntaDaGrade {
  name: string;
  value: string;
  stockIncrement: number;
  /** `undefined` = usa o preço padrão do produto (o "Auto" da casa). */
  priceOverride?: number;
  sku?: string;
  /** Grade nasce ATIVA — quem tira da loja é a desativação (peça 21). */
  active: true;
}

interface ModalVarianteGradeProps {
  aberto: boolean;
  onFechar: () => void;
  /** TODAS as linhas do produto — ativas e desativadas (desativada existe:
   *  a grade não recria em dobro nem reativa por trás do lojista). */
  variantesExistentes: ProductVariant[];
  /** Sugestões de nome de atributo (os grupos comuns da casa). */
  sugestoesDeAtributo: string[];
  /** O grupo em uso no produto, quando ele já tem variante — a trava de um
   *  grupo compara com o nome da grade no "Gerar". */
  grupoUnicoEmUso: string | null;
  /** SKUs de TODA a loja (a UNIQUE do banco é global, não por produto).
   *  Melhor esforço: pode vir vazio se a lista de produtos não carregou —
   *  aí a guarda final é a UNIQUE do banco, que falha alto no salvar. */
  skusDaLoja: string[];
  onEfetivar: (linhas: LinhaProntaDaGrade[]) => void;
}

interface GrupoNoForm {
  chave: string;
  nome: string;
  /** Valores escolhidos para entrar na grade, na ordem do toque. */
  selecionados: string[];
  /** Valores digitados nesta abertura (novos ou usados), para os chips. */
  adicionados: string[];
  rascunho: string;
}

let contadorDeGrupos = 0;
const grupoNovo = (nome = ""): GrupoNoForm => {
  contadorDeGrupos += 1;
  return {
    chave: `grupo-${contadorDeGrupos}`,
    nome,
    selecionados: [],
    adicionados: [],
    rascunho: "",
  };
};

const chaveMinuscula = (texto: string): string =>
  texto.trim().toLocaleLowerCase();

/** Os nomes de atributo que abrem o passo 1: os da grade do produto quando
 *  ele já tem uma ("completar grade"), o grupo legado quando tem um só, ou
 *  um grupo vazio num produto novo. */
function gruposIniciais(variantes: ProductVariant[]): GrupoNoForm[] {
  const composta = variantes
    .map((v) => dividirEmAtributos(v.name, v.value))
    .find((pares) => pares.length > 1);
  if (composta) {
    return composta
      .slice(0, MAX_ATRIBUTOS_DA_GRADE)
      .map((par) => grupoNovo(par.name));
  }
  const legado = variantes[0]?.name.trim();
  if (legado) {
    return [grupoNovo(legado)];
  }
  return [grupoNovo()];
}

/** Os valores que aparecem prontos como chips do grupo: os JÁ USADOS no
 *  produto para esse atributo (com a marca "já usado") seguidos dos que o
 *  lojista digitou nesta abertura. */
function valoresDoGrupo(grupo: GrupoNoForm, variantes: ProductVariant[]) {
  const usados: string[] = [];
  if (grupo.nome.trim() !== "") {
    for (const variante of variantes) {
      for (const par of dividirEmAtributos(variante.name, variante.value)) {
        const valor = par.value.trim();
        if (
          chaveMinuscula(par.name) === chaveMinuscula(grupo.nome) &&
          valor !== "" &&
          !usados.some((u) => chaveMinuscula(u) === chaveMinuscula(valor))
        ) {
          usados.push(valor);
        }
      }
    }
  }
  const digitados = grupo.adicionados.filter(
    (valor) => !usados.some((u) => chaveMinuscula(u) === chaveMinuscula(valor)),
  );
  return [
    ...usados.map((valor) => ({ valor, usado: true })),
    ...digitados.map((valor) => ({ valor, usado: false })),
  ];
}

// Mesma limpeza do preço do modal unitário ("89,90" → "89.90"): o valor
// digitado só vira número na hora de efetivar, não a cada tecla.
const limparNumero = (val: string): string => {
  if (!val) return "";
  let clean = val.replace(",", ".").replace(/[^\d.-]/g, "");
  const parts = clean.split(".");
  if (parts.length > 2) {
    clean = `${parts[0]}.${parts.slice(1).join("")}`;
  }
  return clean;
};

const precoDaLinha = (bruto: string): number | undefined => {
  const limpo = limparNumero(bruto);
  if (!limpo) return undefined;
  const numero = Number.parseFloat(limpo);
  return Number.isNaN(numero) ? undefined : Math.max(0, numero);
};

const estoqueDaLinha = (bruto: string): number =>
  Number.parseInt(bruto.replace(/\D/g, "")) || 0;

interface LinhaNoPasso2 {
  name: string;
  value: string;
  estoque: string;
  preco: string;
}

export function ModalVarianteGrade({
  aberto,
  onFechar,
  variantesExistentes,
  sugestoesDeAtributo,
  grupoUnicoEmUso,
  skusDaLoja,
  onEfetivar,
}: ModalVarianteGradeProps) {
  const [passo, setPasso] = useState<1 | 2>(1);
  const [grupos, setGrupos] = useState<GrupoNoForm[]>([grupoNovo()]);
  const [linhas, setLinhas] = useState<LinhaNoPasso2[]>([]);
  const [aplicarEstoque, setAplicarEstoque] = useState("");
  const [aplicarPreco, setAplicarPreco] = useState("");
  const [skuBase, setSkuBase] = useState("");

  // Abrir o modal é começar limpo: o estado anterior (de uma grade efetivada
  // ou cancelada) nunca vaza para a próxima abertura.
  useEffect(() => {
    if (aberto) {
      setGrupos(gruposIniciais(variantesExistentes));
      setPasso(1);
      setLinhas([]);
      setAplicarEstoque("");
      setAplicarPreco("");
      setSkuBase("");
    }
    // O estado inicial lê as variantes NO MOMENTO de abrir; mudanças depois
    // disso não podem resetar o que o lojista está digitando.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto]);

  const atualizarGrupo = (chave: string, mudancas: Partial<GrupoNoForm>) => {
    setGrupos((prev) =>
      prev.map((g) => (g.chave === chave ? { ...g, ...mudancas } : g)),
    );
  };

  const alternarValor = (grupo: GrupoNoForm, valor: string) => {
    const existe = grupo.selecionados.some(
      (s) => chaveMinuscula(s) === chaveMinuscula(valor),
    );
    atualizarGrupo(grupo.chave, {
      selecionados: existe
        ? grupo.selecionados.filter(
            (s) => chaveMinuscula(s) !== chaveMinuscula(valor),
          )
        : [...grupo.selecionados, valor],
    });
  };

  const adicionarValorDigitado = (grupo: GrupoNoForm) => {
    const valor = grupo.rascunho.trim();
    if (valor === "") return;
    if (valor.includes("/")) {
      toast.error(
        `O valor "${valor}" não pode conter "/" — ele é o separador entre atributos.`,
      );
      return;
    }
    const jaTemChip = valoresDoGrupo(grupo, variantesExistentes).some(
      (chip) => chaveMinuscula(chip.valor) === chaveMinuscula(valor),
    );
    atualizarGrupo(grupo.chave, {
      rascunho: "",
      adicionados: jaTemChip
        ? grupo.adicionados
        : [...grupo.adicionados, valor],
      // Digitar valor que já existe em chip simplesmente o seleciona —
      // a mesma resposta do protótipo aprovado.
      selecionados: grupo.selecionados.some(
        (s) => chaveMinuscula(s) === chaveMinuscula(valor),
      )
        ? grupo.selecionados
        : [...grupo.selecionados, valor],
    });
  };

  const gerar = () => {
    // Trava de um grupo, falha cedo e ANTES de exigir valores: o diagnóstico
    // é sobre os NOMES dos atributos — misturar um atributo novo no produto
    // legado viraria o segundo grupo que mente no estoque, no carrinho e no
    // pedido (ver `um-grupo-de-variacao.ts`). Diagnóstico e retorno — a grade
    // NÃO converte o legado por conta própria.
    const nomesDosGrupos = grupos
      .map((g) => g.nome.trim())
      .filter((nome) => nome !== "");
    if (grupoUnicoEmUso && nomesDosGrupos.length > 0) {
      const nomeDaGrade = nomesDosGrupos.join(SEPARADOR_DE_ATRIBUTOS);
      if (chaveMinuscula(nomeDaGrade) !== chaveMinuscula(grupoUnicoEmUso)) {
        toast.error(`Este produto já usa "${grupoUnicoEmUso}"`, {
          description:
            "Cada produto aceita um tipo de variação só. Para montar a " +
            "grade, use o atributo que o produto já tem — ou crie as " +
            "combinações dele num produto novo.",
          duration: 10000,
        });
        return;
      }
    }

    const atributos: AtributoDaGrade[] = grupos.map((g) => ({
      name: g.nome,
      valores: g.selecionados,
    }));
    const resultado = gerarGrade(
      atributos,
      variantesExistentes.map((v) => ({ name: v.name, value: v.value })),
    );
    if (resultado.erro) {
      toast.error(resultado.erro);
      return;
    }

    if (resultado.linhas.length === 0) {
      toast.info("Essas combinações já existem — nada a criar.");
      return;
    }
    setLinhas(
      resultado.linhas.map((linha) => ({
        name: linha.name,
        value: linha.value,
        estoque: "0",
        preco: "",
      })),
    );
    setPasso(2);
  };

  const aplicarParaTodas = () => {
    setLinhas((prev) =>
      prev.map((linha) => ({
        ...linha,
        estoque: aplicarEstoque.replace(/\D/g, "") || linha.estoque,
        preco: limparNumero(aplicarPreco) || linha.preco,
      })),
    );
    toast.info(
      `Aplicado para as ${linhas.length} linhas — ajuste aí embaixo só a que precisar.`,
    );
  };

  const efetivar = () => {
    const identidades = linhas.map((linha) => ({
      name: linha.name,
      value: linha.value,
    }));
    const skus = skusDaGrade(skuBase, identidades);
    const colisao = primeiroSkuEmColisao(skus, [
      ...skusDaLoja,
      ...variantesExistentes.map((v) => v.sku ?? ""),
    ]);
    if (colisao) {
      toast.error(`O SKU "${colisao}" já existe na loja`, {
        description:
          "SKU é único em TODA a loja, não só neste produto. Ajuste o SKU " +
          "base para a grade nascer com códigos livres.",
      });
      return;
    }
    onEfetivar(
      linhas.map((linha, i) => {
        // `.at(i)` em vez de `skus[i]`: a indexação dinâmica acende o warning
        // de object injection da catraca (teto de warnings do repo não sobe).
        const sku = skus.at(i) ?? "";
        return {
          name: linha.name,
          value: linha.value,
          stockIncrement: estoqueDaLinha(linha.estoque),
          priceOverride: precoDaLinha(linha.preco),
          sku: sku === "" ? undefined : sku,
          active: true as const,
        };
      }),
    );
  };

  const titulo =
    variantesExistentes.length > 0
      ? "Completar Grade"
      : "Nova Variante em Grade";
  const skusPrevistos = skusDaGrade(
    skuBase,
    linhas.map((linha) => ({ name: linha.name, value: linha.value })),
  );

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {aberto && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
        >
          <motion.div
            initial={{ scale: 0.9, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            className="gpu-accelerated flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-[2.5rem] border border-white/10 bg-zinc-900 shadow-2xl"
          >
            <div className="relative z-10 flex shrink-0 items-center gap-4 border-b border-white/5 bg-zinc-900 p-8 pb-5">
              <div className="flex size-12 items-center justify-center rounded-2xl border border-emerald-500/20 bg-emerald-500/10">
                <Layers className="size-6 text-emerald-500" />
              </div>
              <div>
                <h3 className="text-xl font-black tracking-tight">
                  {titulo}
                </h3>
                <p className="mt-1 text-[10px] font-bold uppercase leading-none tracking-widest text-zinc-500">
                  {passo === 1
                    ? "passo 1 de 2 — escolha os valores de cada atributo"
                    : `passo 2 de 2 — estoque e preço das ${linhas.length} combinações novas`}
                </p>
              </div>
            </div>

            <div className="scrollbar-hide flex-1 space-y-6 overflow-y-auto p-8 py-6">
              {passo === 1 &&
                grupos.map((grupo, indice) => {
                  const chips = valoresDoGrupo(grupo, variantesExistentes);
                  return (
                    <div key={grupo.chave} className="space-y-2">
                      <div className="flex items-center gap-2">
                        <label
                          htmlFor={`grade-nome-${indice}`}
                          className="ml-1 flex-1 text-[10px] font-black uppercase tracking-widest text-zinc-500"
                        >
                          Atributo {indice + 1} (ex: Cor, Tamanho)
                        </label>
                        {grupos.length > 1 && (
                          <button
                            type="button"
                            aria-label={`Remover atributo da grade ${indice + 1}`}
                            onClick={() =>
                              setGrupos((prev) =>
                                prev.filter((g) => g.chave !== grupo.chave),
                              )
                            }
                            className="flex size-8 items-center justify-center rounded-xl border border-white/5 bg-zinc-950 text-zinc-500 transition-all hover:border-red-500/30 hover:text-red-500 active:scale-95"
                          >
                            <X className="size-4" />
                          </button>
                        )}
                      </div>
                      <LocalBufferedInput
                        id={`grade-nome-${indice}`}
                        name={`grade-nome-${indice}`}
                        type="text"
                        value={grupo.nome}
                        onFlush={(val) => atualizarGrupo(grupo.chave, { nome: val })}
                        className="w-full rounded-2xl border border-white/5 bg-zinc-950 px-5 py-4 text-sm font-bold transition-all focus:border-emerald-500/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                        placeholder="Ex: Cor"
                      />
                      {sugestoesDeAtributo.length > 0 && (
                        <div className="ml-1 mt-1.5 flex flex-wrap gap-1.5">
                          {sugestoesDeAtributo.map((attr) => (
                            <button
                              key={attr}
                              type="button"
                              onClick={() =>
                                atualizarGrupo(grupo.chave, { nome: attr })
                              }
                              className={cn(
                                "px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest border transition-all active:scale-95",
                                grupo.nome === attr
                                  ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-400"
                                  : "bg-zinc-950 border-white/5 text-zinc-500 hover:text-zinc-300 hover:border-white/10",
                              )}
                            >
                              {attr}
                            </button>
                          ))}
                        </div>
                      )}
                      {chips.length > 0 && (
                        <div className="ml-1 flex flex-wrap gap-1.5 pt-1">
                          {chips.map((chip) => {
                            const selecionado = grupo.selecionados.some(
                              (s) =>
                                chaveMinuscula(s) ===
                                chaveMinuscula(chip.valor),
                            );
                            return (
                              <button
                                key={chip.valor}
                                type="button"
                                aria-pressed={selecionado}
                                onClick={() => alternarValor(grupo, chip.valor)}
                                className={cn(
                                  "px-3 py-1.5 rounded-full text-[11px] font-bold border transition-all active:scale-95",
                                  selecionado
                                    ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-400"
                                    : "bg-zinc-950 border-white/5 text-zinc-400 hover:border-white/10",
                                )}
                              >
                                {chip.valor}
                                {chip.usado && !selecionado && (
                                  <span className="ml-1.5 text-[8px] font-black uppercase tracking-widest text-zinc-600">
                                    já usado
                                  </span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      )}
                      <div className="flex items-center gap-2 pt-1">
                        <LocalBufferedInput
                          id={`grade-valor-${indice}`}
                          name={`grade-valor-${indice}`}
                          type="text"
                          aria-label={`Novo valor do atributo ${indice + 1}`}
                          value={grupo.rascunho}
                          onFlush={(val) =>
                            atualizarGrupo(grupo.chave, { rascunho: val })
                          }
                          className="w-full rounded-2xl border border-white/5 bg-zinc-950 px-5 py-3.5 text-sm font-bold transition-all focus:border-emerald-500/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                          placeholder={`Novo valor de ${grupo.nome.trim() || "atributo"}…`}
                        />
                        <button
                          type="button"
                          aria-label={`Adicionar valor do atributo ${indice + 1}`}
                          onClick={() => adicionarValorDigitado(grupo)}
                          className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-emerald-500/20 bg-emerald-500/10 text-emerald-500 transition-all hover:bg-emerald-500 hover:text-emerald-950 active:scale-95"
                        >
                          <Plus className="size-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}

              {passo === 1 && grupos.length < MAX_ATRIBUTOS_DA_GRADE && (
                <button
                  type="button"
                  onClick={() => setGrupos((prev) => [...prev, grupoNovo()])}
                  className="w-full rounded-2xl border border-dashed border-white/10 bg-zinc-950/60 px-5 py-3 text-[10px] font-black uppercase tracking-widest text-zinc-400 transition-all hover:border-emerald-500/30 hover:text-emerald-500 active:scale-95"
                >
                  + Atributo
                </button>
              )}

              {passo === 1 && (
                <p className="ml-1 text-[10px] font-medium leading-relaxed text-zinc-500">
                  Toque nos valores que entram na grade — os marcados
                  <span className="mx-1 font-black uppercase tracking-widest text-zinc-400">
                    já usado
                  </span>
                  vieram das variantes deste produto. Só as combinações que
                  AINDA NÃO EXISTEM serão criadas, até
                  {" "}
                  {MAX_ATRIBUTOS_DA_GRADE}
                  {" "}
                  atributos e 60 linhas por produto.
                </p>
              )}

              {passo === 2 && (
                <>
                  <div className="space-y-2 rounded-2xl border border-dashed border-amber-500/30 bg-amber-500/5 p-4">
                    <span className="ml-1 block text-[10px] font-black uppercase tracking-widest text-amber-400">
                      Aplicar para todas
                    </span>
                    <div className="grid grid-cols-2 gap-3">
                      <LocalBufferedInput
                        id="grade-aplicar-estoque"
                        name="grade-aplicar-estoque"
                        type="number"
                        aria-label="Estoque para todas as linhas"
                        value={aplicarEstoque}
                        onFlush={setAplicarEstoque}
                        className="w-full rounded-2xl border border-white/5 bg-zinc-950 px-4 py-3.5 text-sm font-black transition-all focus:border-emerald-500/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                        placeholder="estoque"
                      />
                      <div className="relative flex items-center">
                        <span className="absolute left-4 text-xs font-black text-zinc-600">
                          R$
                        </span>
                        <LocalBufferedInput
                          id="grade-aplicar-preco"
                          name="grade-aplicar-preco"
                          mask="currency"
                          aria-label="Preço para todas as linhas"
                          value={aplicarPreco}
                          onFlush={setAplicarPreco}
                          className="w-full rounded-2xl border border-white/5 bg-zinc-950 py-3.5 pl-10 pr-4 text-sm font-black transition-all focus:border-emerald-500/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                          placeholder="preço"
                        />
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={aplicarParaTodas}
                      className="w-full rounded-2xl border border-white/10 bg-zinc-950/60 px-5 py-3 text-[10px] font-black uppercase tracking-widest text-emerald-500 transition-all hover:border-emerald-500/30 active:scale-95"
                    >
                      Aplicar para todas
                    </button>
                    <p className="ml-1 text-[10px] leading-tight text-zinc-500">
                      Deixa o preço vazio para todas usarem o preço padrão do
                      produto — o mesmo "Auto" do modal de uma variante.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <label
                      htmlFor="grade-sku-base"
                      className="ml-1 text-[10px] font-black uppercase tracking-widest text-zinc-500"
                    >
                      SKU base (o sufixo por valor é automático)
                    </label>
                    <LocalBufferedInput
                      id="grade-sku-base"
                      name="grade-sku-base"
                      type="text"
                      value={skuBase}
                      onFlush={setSkuBase}
                      className="w-full rounded-2xl border border-white/5 bg-zinc-950 px-5 py-4 font-mono text-sm font-bold uppercase transition-all focus:border-emerald-500/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                      placeholder="Ex: BLU — vazio nasce sem SKU"
                    />
                  </div>

                  <p
                    className="ml-1 text-[10px] font-black uppercase tracking-widest text-emerald-500"
                    data-testid="contador-da-grade"
                  >
                    Só as {linhas.length} novas — as{" "}
                    {variantesExistentes.length} existentes não são tocadas
                  </p>

                  {linhas.map((linha, i) => (
                    <div
                      key={`${linha.name}|${linha.value}`}
                      className="space-y-2 rounded-2xl border border-white/5 bg-zinc-950/60 p-4"
                    >
                      <span
                        className="block text-sm font-black uppercase italic tracking-tight text-white"
                        data-testid="linha-da-grade"
                      >
                        {linha.value}
                      </span>
                      <div className="grid grid-cols-2 gap-3">
                        <LocalBufferedInput
                          id={`grade-linha-estoque-${i}`}
                          name={`grade-linha-estoque-${i}`}
                          type="number"
                          aria-label={`Estoque de ${linha.value}`}
                          value={linha.estoque}
                          onFlush={(val) =>
                            setLinhas((prev) =>
                              prev.map((l, j) =>
                                j === i ? { ...l, estoque: val } : l,
                              ),
                            )
                          }
                          className="w-full rounded-2xl border border-white/5 bg-zinc-950 px-4 py-3 text-sm font-black transition-all focus:border-emerald-500/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                        />
                        <div className="relative flex items-center">
                          <span className="absolute left-4 text-xs font-black text-zinc-600">
                            R$
                          </span>
                          <LocalBufferedInput
                            id={`grade-linha-preco-${i}`}
                            name={`grade-linha-preco-${i}`}
                            mask="currency"
                            aria-label={`Preço de ${linha.value}`}
                            value={linha.preco}
                            onFlush={(val) =>
                              setLinhas((prev) =>
                                prev.map((l, j) =>
                                  j === i ? { ...l, preco: val } : l,
                                ),
                              )
                            }
                            className="w-full rounded-2xl border border-white/5 bg-zinc-950 py-3 pl-10 pr-4 text-sm font-black transition-all focus:border-emerald-500/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                            placeholder="Auto"
                          />
                        </div>
                      </div>
                      <span
                        className="block font-mono text-[10px] text-zinc-500"
                        data-testid="sku-da-linha"
                      >
                        {skusPrevistos.at(i) || "sem SKU"}
                      </span>
                    </div>
                  ))}
                </>
              )}
            </div>

            <div className="relative z-10 flex shrink-0 gap-4 border-t border-white/5 bg-zinc-950/40 p-8 pt-5">
              {passo === 2 ? (
                <button
                  type="button"
                  onClick={() => setPasso(1)}
                  className="flex-1 py-4 text-xs font-black uppercase tracking-widest text-zinc-500 transition-colors hover:text-white"
                >
                  ← Voltar
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onFechar}
                  className="flex-1 py-4 text-xs font-black uppercase tracking-widest text-zinc-500 transition-colors hover:text-white"
                >
                  Cancelar
                </button>
              )}
              {passo === 1 ? (
                <button
                  type="button"
                  onClick={gerar}
                  className="flex-[2] rounded-2xl bg-emerald-500 py-4 text-xs font-black uppercase tracking-widest text-emerald-950 shadow-[0_10px_30px_rgba(16,185,129,0.3)] transition-all hover:scale-105 active:scale-95"
                >
                  Gerar grade
                </button>
              ) : (
                <button
                  type="button"
                  onClick={efetivar}
                  className="flex-[2] rounded-2xl bg-emerald-500 py-4 text-xs font-black uppercase tracking-widest text-emerald-950 shadow-[0_10px_30px_rgba(16,185,129,0.3)] transition-all hover:scale-105 active:scale-95"
                >
                  Efetivar {linhas.length}{" "}
                  {linhas.length === 1 ? "variante" : "variantes"}
                </button>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
