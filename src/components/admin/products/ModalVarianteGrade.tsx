import {
  type LinhaNoPasso2,
  LinhasDaGrade,
} from "@/components/admin/products/LinhasDaGrade";
import {
  SeletorDeAtributo,
  tipoDoNome,
} from "@/components/admin/products/SeletorDeAtributo";
import { cn } from "@/lib/utils";
import type { ProductVariant } from "@/types";
import { erroDoEstoqueDaVariacao } from "@/utils/estoque-da-variacao";
import {
  type AtributoDaGrade,
  MAX_ATRIBUTOS_DA_GRADE,
  MAX_LINHAS_DA_GRADE,
  contarCombinacoesDaGrade,
  gerarGrade,
  primeiroSkuEmColisao,
  skusDaGrade,
} from "@/utils/grade-de-combinacoes";
import { preencherComSegurado } from "@/utils/grade-valor-segurado";
import {
  precoPositivoOuVazio,
  resolverPrecoDaGrade,
} from "@/utils/preco-da-grade";
import {
  SEPARADOR_DE_ATRIBUTOS,
  dividirEmAtributos,
} from "@/utils/variante-composta";
import { AnimatePresence, motion } from "framer-motion";
import { Layers } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";

/**
 * Modal "Nova variante em grade" — o lojista escolhe as camadas (Cor, Tamanho,
 * Material: até 3), o sistema gera TODAS as combinações de uma vez e ele
 * ajusta preço, estoque e SKU de cada linha antes de confirmar.
 *
 * PASSO 1 (este arquivo): um grupo por atributo, com os valores JÁ USADOS no
 * produto aparecendo prontos como chips ("fica salvo o valor") — toca nos
 * valores, digita os novos, e "Gerar grade" monta o cartesiano.
 * PASSO 2 (`LinhasDaGrade.tsx`): só as combinações que AINDA NÃO EXISTEM, com
 * "Aplicar para todas" para o 90% do lote.
 *
 * O modal NÃO grava nada no banco: efetivar devolve as linhas pelo
 * `onEfetivar` e elas entram na lista de variantes do formulário como linhas
 * comuns (`temp-`), gravadas pelo MESMO `upsertVariants` de sempre quando o
 * produto é salvo — zero caminho novo de persistência. Cancelar e Voltar não
 * deixam rastro nenhum.
 *
 * A trava de um grupo por produto (`um-grupo-de-variacao.ts`) é respeitada
 * DUAS vezes: aqui no "Gerar" (falha cedo, antes do lojista preencher o
 * passo 2) e de novo no efetivar, dentro da tela dona do estado. Produto
 * legado de outro grupo recebe o diagnóstico e a grade NÃO converte nada
 * por conta própria. Combinação DESLIGADA continua existindo: a grade não a
 * recria nem a religa por trás do lojista.
 */

/** Linha pronta que o modal entrega para o formulário, na ordem da grade. */
export interface LinhaProntaDaGrade {
  name: string;
  value: string;
  stockIncrement: number;
  /** `undefined` = usa o preço padrão do produto (o "Auto" da casa). */
  priceOverride?: number;
  sku?: string;
  /** A grade nasce LIGADA — quem tira da loja é o botão de desligar da linha. */
  active: true;
}

interface ModalVarianteGradeProps {
  aberto: boolean;
  onFechar: () => void;
  /** TODAS as linhas do produto — ligadas e desligadas (a desligada existe:
   *  a grade não recria em dobro nem religa por trás do lojista). */
  variantesExistentes: ProductVariant[];
  /** Os grupos que o produto já usa (ou os comuns da casa, se não usa nenhum):
   *  o seletor só oferece as peças deles. */
  sugestoesDeAtributo: string[];
  /** O grupo em uso no produto, quando ele já tem variante — a trava de um
   *  grupo compara com o nome da grade no "Gerar". */
  grupoUnicoEmUso: string | null;
  /** SKUs de TODA a loja (a UNIQUE do banco é global, não por produto).
   *  Melhor esforço: pode vir vazio se a lista de produtos não carregou —
   *  aí a guarda final é a conferência do salvar e a UNIQUE do banco. */
  skusDaLoja: string[];
  /** Base do código interno que a grade já traz preenchida ao abrir (hoje: o
   *  código automático do produto). Vazio/ausente = a base nasce vazia, como
   *  sempre. A colisão com a loja continua sendo conferida no "Efetivar". */
  skuBaseSugerida?: string;
  /** O campo Preço de Venda do formulário, como está agora (vazio = a lojista
   *  ainda não preencheu). Decide se o preço digitado na grade vira o do
   *  produto (campo vazio) ou vale só para as combinações novas (já tem). */
  precoDoProduto: string;
  /** Entrega as linhas ao formulário. Devolve `true` se ele as aceitou (o
   *  modal então fecha e não aceita um segundo "Efetivar") e `false` se
   *  recusou (o modal fica aberto para o lojista corrigir). O segundo
   *  argumento é o Preço de Venda que a grade dá ao produto (só quando o
   *  campo estava vazio e todas as linhas tinham preço): as linhas iguais a
   *  ele já vão em Auto. */
  onEfetivar: (
    linhas: LinhaProntaDaGrade[],
    precoDoProduto?: number,
  ) => boolean;
}

interface GrupoNoForm {
  chave: string;
  nome: string;
  /** Valores escolhidos para entrar na grade, na ordem do toque. */
  selecionados: string[];
  /** Valores digitados nesta abertura (novos ou usados), para os chips. */
  adicionados: string[];
  rascunho: string;
  /** Nasceu do atalho "+ Outro": abre com o campo do nome aberto. */
  outro: boolean;
}

let contadorDeGrupos = 0;
const grupoNovo = (nome = "", outro = false): GrupoNoForm => {
  contadorDeGrupos += 1;
  return {
    chave: `grupo-${contadorDeGrupos}`,
    nome,
    selecionados: [],
    adicionados: [],
    rascunho: "",
    outro,
  };
};

/** "3 cores", "1 tamanho": o substantivo do tipo, no singular ou no plural. */
const SUBSTANTIVOS = new Map<string, [string, string]>([
  ["Cor", ["cor", "cores"]],
  ["Tamanho", ["tamanho", "tamanhos"]],
  ["Voltagem", ["voltagem", "voltagens"]],
]);
const contagemComSubstantivo = (n: number, nome: string): string =>
  `${n} ${(SUBSTANTIVOS.get(tipoDoNome(nome) ?? "") ?? ["valor", "valores"]).at(n === 1 ? 0 : 1)}`;

/** Os tipos que um atalho "+ Tamanho / + Voltagem / + Outro" pode criar. */
const TIPOS_DOS_ATALHOS = ["Tamanho", "Voltagem", "Outro"] as const;
const EXEMPLO_DO_ATALHO = new Map<string, string>([
  ["Tamanho", "ex.: P, M, G"],
  ["Voltagem", "ex.: 110 V, 220 V"],
]);

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
  const legado = variantes.at(0)?.name.trim();
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

// Chega aqui já validado por `erroDoEstoqueDaVariacao` (inteiro, zero ou mais);
// vazio vale 0.
const estoqueDaLinha = (bruto: string): number =>
  Number.parseInt(bruto.trim(), 10) || 0;

export function ModalVarianteGrade({
  aberto,
  onFechar,
  variantesExistentes,
  sugestoesDeAtributo,
  grupoUnicoEmUso,
  skusDaLoja,
  skuBaseSugerida = "",
  precoDoProduto,
  onEfetivar,
}: ModalVarianteGradeProps) {
  const [passo, setPasso] = useState<1 | 2>(1);
  const [grupos, setGrupos] = useState<GrupoNoForm[]>([grupoNovo()]);
  const [linhas, setLinhas] = useState<LinhaNoPasso2[]>([]);
  const [aplicarEstoque, setAplicarEstoque] = useState("");
  const [aplicarPreco, setAplicarPreco] = useState("");
  const [skuBase, setSkuBase] = useState("");
  // Depois que o formulário aceitou as linhas, um segundo clique em "Efetivar"
  // (duplo clique, ou o que chega durante a animação de saída do modal) não
  // pode entregar o mesmo lote de novo.
  const jaEfetivouRef = useRef(false);

  // Abrir o modal é começar limpo: o estado anterior (de uma grade efetivada
  // ou cancelada) nunca vaza para a próxima abertura.
  useEffect(() => {
    if (aberto) {
      setGrupos(gruposIniciais(variantesExistentes));
      setPasso(1);
      setLinhas([]);
      setAplicarEstoque("");
      setAplicarPreco("");
      setSkuBase(skuBaseSugerida);
      jaEfetivouRef.current = false;
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
      // Digitar valor que já existe em chip simplesmente o seleciona.
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
    const erroDoEstoque = erroDoEstoqueDaVariacao(aplicarEstoque);
    if (erroDoEstoque) {
      toast.error(erroDoEstoque);
      return;
    }
    const estoqueAplicado = aplicarEstoque.trim();
    setLinhas((prev) =>
      prev.map((linha) => ({
        ...linha,
        estoque: estoqueAplicado || linha.estoque,
        // Aplicar é a lojista decidindo o estoque de TODAS as linhas: o
        // segurado de depois não passa por cima.
        estoqueEditado: linha.estoqueEditado || estoqueAplicado !== "",
        // Só preço maior que zero: "0.00" é texto não vazio e zerava as linhas.
        preco: precoPositivoOuVazio(aplicarPreco) || linha.preco,
      })),
    );
    // O que foi aplicado deixa de ser "segurado": sem isto o mesmo valor voltava
    // a preencher, ao salvar, a linha que a lojista esvaziou para deixar em
    // "Auto" (preço) ou ainda por decidir (estoque). Só volta a valer se ela
    // digitar de novo nos campos.
    setAplicarEstoque("");
    setAplicarPreco("");
    toast.info(
      `Aplicado para as ${linhas.length} linhas — ajuste aí embaixo só a que precisar.`,
    );
  };

  const mudarLinha = (
    indice: number,
    campo: "estoque" | "preco",
    valor: string,
  ) => {
    setLinhas((prev) =>
      prev.map((linha, j) => {
        if (j !== indice) return linha;
        // O campo entrega o valor também ao sair dele sem digitar nada: só
        // conta como "mexeu no estoque" se o valor de fato mudou.
        const mexeuNoEstoque = campo === "estoque" && valor !== linha.estoque;
        return {
          ...linha,
          [campo]: valor,
          estoqueEditado: linha.estoqueEditado || mexeuNoEstoque,
        };
      }),
    );
  };

  // O valor digitado em "Aplicar para todas" e não aplicado fica SEGURADO e
  // preenche as linhas vazias ao efetivar (`grade-valor-segurado.ts`).
  const { linhas: linhasEfetivas, preencheu: valorSeguradoPendente } =
    preencherComSegurado(linhas, aplicarEstoque, aplicarPreco);

  const efetivar = () => {
    if (jaEfetivouRef.current) return;
    // O estoque segurado em "Aplicar para todas" também preenche linhas ao
    // salvar: inválido avisa aqui, antes de qualquer linha nascer.
    // O campo "Aplicar para todas" vem primeiro: se o erro está nele, o aviso
    // diz QUAL campo é (a lojista não apertou Aplicar, então não sabe que o
    // valor segurado ali também vale ao salvar).
    const erroDoAplicar = erroDoEstoqueDaVariacao(aplicarEstoque);
    if (erroDoAplicar) {
      toast.error(erroDoAplicar, {
        description:
          'O erro está no campo de estoque de "Aplicar para todas". Corrija ou apague esse valor.',
      });
      return;
    }
    const erroDoEstoque = linhasEfetivas
      .map((linha) => erroDoEstoqueDaVariacao(linha.estoque))
      .find((erro) => erro !== null);
    if (erroDoEstoque) {
      toast.error(erroDoEstoque);
      return;
    }
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
      toast.error(`O código interno "${colisao}" já existe na loja`, {
        description:
          "O código interno é único em TODA a loja, não só neste produto. " +
          "Ajuste o código interno base para a grade nascer com códigos livres.",
      });
      return;
    }
    // Preço e estoque saem das linhas EFETIVAS (com o valor segurado já
    // preenchido): uma fonte só para o que vai nas variantes e para o Preço de
    // Venda que a grade dá ao produto.
    const { precos, precoDoProduto: precoParaOProduto } = resolverPrecoDaGrade(
      precoDoProduto,
      linhasEfetivas.map((linha) => linha.preco),
    );
    const aceitou = onEfetivar(
      linhasEfetivas.map((linha, i) => {
        // `.at(i)` em vez de `skus[i]`: a indexação dinâmica acende o warning
        // de object injection da catraca (o teto de warnings do repo não sobe).
        const sku = skus.at(i) ?? "";
        return {
          name: linha.name,
          value: linha.value,
          stockIncrement: estoqueDaLinha(linha.estoque),
          priceOverride: precos.at(i),
          sku: sku === "" ? undefined : sku,
          active: true as const,
        };
      }),
      precoParaOProduto,
    );
    if (aceitou) jaEfetivouRef.current = true;
  };

  // A sugestão do passo 2: só um preço de produto que já vale (maior que zero).
  // "Sem preço" é a MESMA conta da regra (`resolverPrecoDaGrade`): campo vazio.
  // Um "0,00" digitado não é vazio — a grade não escreve por cima dele.
  const produtoSemPreco = precoDoProduto.trim() === "";
  const precoDoProdutoNumero = Number.parseFloat(precoDoProduto);
  const precoDoProdutoValido =
    precoDoProdutoNumero > 0 ? precoDoProdutoNumero : undefined;

  // A conta ao vivo do passo 1: só as combinações NOVAS (as que já existem não
  // contam, como em `gerarGrade`). O botão e o resumo leem os mesmos números.
  const { porAtributo, novas } = contarCombinacoesDaGrade(
    grupos.map((g) => ({ name: g.nome, valores: g.selecionados })),
    variantesExistentes.map((v) => ({ name: v.name, value: v.value })),
  );
  const varios = grupos.length > 1;
  const faltaEscolher = porAtributo.some((n) => n === 0);
  const passouDoLimite =
    !faltaEscolher && variantesExistentes.length + novas > MAX_LINHAS_DA_GRADE;
  const palavraDoTotal = (n: number) =>
    varios
      ? n === 1
        ? "combinação"
        : "combinações"
      : n === 1
        ? "opção"
        : "opções";
  const rotuloDoGerar =
    faltaEscolher || passouDoLimite || novas === 0
      ? "Gerar grade"
      : `Gerar ${novas} ${palavraDoTotal(novas)}`;

  // Atalhos para o segundo atributo: só os tipos que nenhum cartão usa ainda. Um
  // produto que já grava um grupo não ganha atalho: a trava de um grupo por
  // produto recusaria o "Gerar".
  const tiposEmUso = grupos.map((g) =>
    g.outro ? "Outro" : tipoDoNome(g.nome),
  );
  const atalhosLivres = TIPOS_DOS_ATALHOS.filter(
    (t) => !tiposEmUso.includes(t),
  );
  const mostrarAtalhos =
    !grupoUnicoEmUso &&
    tiposEmUso.some(Boolean) &&
    grupos.length < MAX_ATRIBUTOS_DA_GRADE &&
    atalhosLivres.length > 0;
  const criarAtalho = (tipo: (typeof TIPOS_DOS_ATALHOS)[number]) =>
    setGrupos((prev) => [
      ...prev,
      tipo === "Outro" ? grupoNovo("", true) : grupoNovo(tipo),
    ]);
  const botaoDoAtalho = (
    tipo: (typeof TIPOS_DOS_ATALHOS)[number],
    grande: boolean,
  ) => (
    <button
      key={tipo}
      type="button"
      onClick={() => criarAtalho(tipo)}
      className={cn(
        "min-h-11 rounded-2xl border border-dashed border-admin-border bg-admin-bg/60 px-4 font-bold text-zinc-300 transition-all hover:border-admin-border-strong hover:text-foreground active:scale-95",
        grande ? "flex-1 py-3 text-base" : "text-sm",
      )}
    >
      + {tipo}
      {grande && EXEMPLO_DO_ATALHO.has(tipo) && (
        <>
          {" "}
          <span className="block text-xs font-normal text-zinc-500">
            {EXEMPLO_DO_ATALHO.get(tipo)}
          </span>
        </>
      )}
    </button>
  );

  const titulo =
    variantesExistentes.length > 0
      ? "Completar grade"
      : "Nova variação em grade";
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
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-0 backdrop-blur-sm sm:p-5"
        >
          <motion.div
            initial={{ scale: 0.9, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="titulo-da-grade"
            className="produto-modal gpu-accelerated flex h-dvh max-h-dvh w-full max-w-lg flex-col overflow-hidden rounded-none border border-admin-border shadow-2xl sm:h-auto sm:max-h-[90dvh] sm:rounded-3xl"
          >
            <div className="relative z-10 flex shrink-0 items-center gap-4 border-b border-admin-border bg-admin-bg p-5">
              <div className="flex size-12 items-center justify-center rounded-2xl border border-violet-400/20 bg-violet-400/10">
                <Layers className="size-6 text-violet-300" />
              </div>
              <div>
                <h3 id="titulo-da-grade" className="text-xl font-bold">
                  {titulo}
                </h3>
                <p className="mt-1 text-[11px] font-bold uppercase leading-none tracking-wider text-zinc-500">
                  {passo === 1
                    ? "grade de variações — passo 1 de 2"
                    : `grade de variações — passo 2 de 2 · ${linhas.length} combinações novas`}
                </p>
              </div>
            </div>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
              {passo === 1 && (
                <p className="text-sm leading-relaxed text-zinc-400">
                  {
                    "Escolha o que muda no produto. Para cor e tamanho juntos, toque em '+ Adicionar outro atributo'."
                  }
                </p>
              )}

              {passo === 1 &&
                grupos.map((grupo, indice) => (
                  <div
                    key={grupo.chave}
                    className="rounded-[22px] border border-admin-border bg-admin-surface p-4"
                  >
                    <SeletorDeAtributo
                      modo="multiplo"
                      numero={indice + 1}
                      idDoNome={`grade-nome-${indice}`}
                      idDoValor={`grade-valor-${indice}`}
                      nome={grupo.nome}
                      onNome={(nome) => atualizarGrupo(grupo.chave, { nome })}
                      sugestoes={sugestoesDeAtributo}
                      iniciarEmOutro={grupo.outro}
                      tiposOcupados={grupos.flatMap((outro) => {
                        const tipo = tipoDoNome(outro.nome);
                        return outro.chave === grupo.chave || !tipo
                          ? []
                          : [tipo];
                      })}
                      selecionados={grupo.selecionados}
                      chips={valoresDoGrupo(grupo, variantesExistentes).map(
                        (chip) => ({ valor: chip.valor, usado: chip.usado }),
                      )}
                      onAlternar={(valor) => alternarValor(grupo, valor)}
                      rascunho={grupo.rascunho}
                      onRascunho={(rascunho) =>
                        atualizarGrupo(grupo.chave, { rascunho })
                      }
                      onAdicionar={() => adicionarValorDigitado(grupo)}
                      onLimpar={() =>
                        atualizarGrupo(grupo.chave, {
                          selecionados: [],
                          adicionados: [],
                          rascunho: "",
                        })
                      }
                      aoRemover={
                        grupos.length > 1
                          ? () =>
                              setGrupos((prev) =>
                                prev.filter((g) => g.chave !== grupo.chave),
                              )
                          : undefined
                      }
                      rotuloDoRemover={`Remover atributo da grade ${indice + 1}`}
                    />
                  </div>
                ))}

              {passo === 1 && grupos.length < MAX_ATRIBUTOS_DA_GRADE && (
                <button
                  type="button"
                  onClick={() => setGrupos((prev) => [...prev, grupoNovo()])}
                  className="min-h-11 w-full rounded-2xl border border-dashed border-admin-border bg-admin-bg/60 px-5 py-3 text-sm font-bold text-zinc-300 transition-all hover:border-admin-border-strong hover:text-foreground active:scale-95"
                >
                  + Adicionar outro atributo
                </button>
              )}

              {passo === 1 &&
                mostrarAtalhos &&
                (varios ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-zinc-500">Sugestão:</span>
                    {atalhosLivres.map((tipo) => botaoDoAtalho(tipo, false))}
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-sm text-zinc-400">
                      Este produto também varia em outra coisa? Ex.: tamanho.
                    </p>
                    <div className="flex gap-3">
                      {atalhosLivres
                        .filter((tipo) => tipo !== "Outro")
                        .map((tipo) => botaoDoAtalho(tipo, true))}
                    </div>
                    {atalhosLivres.includes("Outro") &&
                      botaoDoAtalho("Outro", false)}
                  </div>
                ))}

              {passo === 1 && (
                <div
                  data-testid="resumo-da-grade"
                  className="space-y-1.5 rounded-[22px] border border-solid border-amber-400/30 bg-admin-surface p-4"
                >
                  <p className="text-[11px] font-black tracking-widest text-amber-400">
                    RESUMO
                  </p>
                  {faltaEscolher ? (
                    <p className="text-base text-zinc-300">
                      Escolha pelo menos uma opção em cada atributo.
                    </p>
                  ) : (
                    <>
                      {varios && (
                        <p className="text-sm text-zinc-400">
                          {porAtributo
                            .map((n, i) =>
                              contagemComSubstantivo(
                                n,
                                grupos.at(i)?.nome ?? "",
                              ),
                            )
                            .join(" × ")}
                        </p>
                      )}
                      <p className="text-2xl font-bold text-foreground">
                        {varios
                          ? ""
                          : `${contagemComSubstantivo(porAtributo.at(0) ?? 0, grupos.at(0)?.nome ?? "")} `}
                        = {novas} {palavraDoTotal(novas)}
                      </p>
                      {passouDoLimite && (
                        <p className="text-sm text-red-300">
                          Passou do limite de {MAX_LINHAS_DA_GRADE} combinações:
                          tire alguma opção.
                        </p>
                      )}
                      <p className="text-xs leading-relaxed text-zinc-400">
                        Cada {varios ? "combinação" : "opção"} terá o seu
                        próprio estoque. No próximo passo você coloca a
                        quantidade de cada uma.
                      </p>
                    </>
                  )}
                </div>
              )}

              {passo === 2 && (
                <LinhasDaGrade
                  linhas={linhas}
                  quantasExistentes={variantesExistentes.length}
                  precoDoProduto={precoDoProdutoValido}
                  produtoSemPreco={produtoSemPreco}
                  skusPrevistos={skusPrevistos}
                  skuBase={skuBase}
                  onSkuBase={setSkuBase}
                  aplicarEstoque={aplicarEstoque}
                  onAplicarEstoque={setAplicarEstoque}
                  aplicarPreco={aplicarPreco}
                  onAplicarPreco={setAplicarPreco}
                  onAplicarParaTodas={aplicarParaTodas}
                  valorSeguradoPendente={valorSeguradoPendente}
                  onMudarLinha={mudarLinha}
                />
              )}
            </div>

            <div className="relative z-10 flex shrink-0 flex-wrap gap-3 border-t border-admin-border bg-admin-surface p-5">
              <p className="w-full text-xs text-zinc-400">
                Alterações ainda não salvas
              </p>
              {passo === 2 && (
                <button
                  type="button"
                  onClick={onFechar}
                  className="min-h-11 w-full rounded-xl border border-admin-border px-3 text-sm text-zinc-300"
                >
                  Cancelar
                </button>
              )}
              {passo === 2 ? (
                <button
                  type="button"
                  onClick={() => setPasso(1)}
                  className="min-h-14 flex-1 rounded-2xl border border-admin-border bg-admin-raised p-3 text-sm font-bold text-white"
                >
                  ← Voltar
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onFechar}
                  className="min-h-14 flex-1 rounded-2xl border border-admin-border bg-admin-raised p-3 text-sm font-bold text-white"
                >
                  Cancelar
                </button>
              )}
              {passo === 1 ? (
                <button
                  type="button"
                  onClick={gerar}
                  className="min-h-14 flex-[2] rounded-2xl bg-gradient-to-b from-[#f8d658] to-[#e3ac16] p-3 text-sm font-bold text-[#211a07]"
                >
                  {rotuloDoGerar}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={efetivar}
                  className="min-h-14 flex-[2] rounded-2xl bg-gradient-to-b from-[#f8d658] to-[#e3ac16] p-3 text-sm font-bold text-[#211a07]"
                >
                  Salvar {linhas.length}{" "}
                  {linhas.length === 1 ? "variação" : "variações"}
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
