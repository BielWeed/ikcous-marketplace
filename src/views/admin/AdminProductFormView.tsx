import { LazyImage } from "@/components/LazyImage";
import { AdminHelpModal } from "@/components/admin/AdminHelpModal";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import {
  LocalBufferedInput,
  LocalBufferedTextarea,
} from "@/components/admin/LocalBufferedInput";
import { PhoneSimulator } from "@/components/admin/PhoneSimulator";
import { CampoDeCategoria } from "@/components/admin/products/CampoDeCategoria";
import { CodigoDoProduto } from "@/components/admin/products/CodigoDoProduto";
import { DicaExpansivel } from "@/components/admin/products/DicaExpansivel";
import { InterruptorDoProduto } from "@/components/admin/products/InterruptorDoProduto";
import {
  AnelDoProgresso,
  BarraDoProgresso,
} from "@/components/admin/products/ProgressoDoProduto";
import { SecaoDoProduto } from "@/components/admin/products/SecaoDoProduto";
import { useTopoCompacto } from "@/components/admin/products/useTopoCompacto";
import { AcaoDaBarra } from "@/components/layouts/AcaoDaBarra";
import "@/components/admin/products/formulario-produto.css";
import {
  type LinhaProntaDaGrade,
  ModalVarianteGrade,
} from "@/components/admin/products/ModalVarianteGrade";
import {
  SeletorDeAtributo,
  tipoDoNome,
} from "@/components/admin/products/SeletorDeAtributo";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ImageAdjuster } from "@/components/ui/custom/ImageAdjuster";
import { Skeleton } from "@/components/ui/skeleton";
import { NOMES_DO_PAINEL } from "@/config/nomes-do-painel";
import { useStore } from "@/contexts/StoreContext";
import { useAoMudarCategoria } from "@/hooks/useAoMudarCategoria";
import { useCategories } from "@/hooks/useCategories";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useProducts } from "@/hooks/useProducts";
// Só o TIPO da resposta da RPC do PDV — import "type" some da build, então
// não puxa `useVendaPresencial.ts` (nem o cliente Supabase) para este chunk.
import type { RespostaDoCodigo } from "@/hooks/useVendaPresencial";
import { arquivoDaImagemRecortada } from "@/lib/arquivo-da-imagem-recortada";
import { marcarOperacaoSensivel } from "@/lib/atualizacao/operacao-sensivel";
import { normalizarCodigoBarras } from "@/lib/codigo-de-barras";
import { CLASSE_PRECO_PROMOCIONAL_FUNDO_ESCURO } from "@/lib/cor-do-preco-promocional";
import { descartarFotosDoProduto } from "@/lib/descartar-fotos-do-produto";
import {
  type ConfigDeFrete,
  produtoTemFreteGratisPrometido,
  promessasDeFrete,
} from "@/lib/estrategias-de-frete";
import { soFotosReais } from "@/lib/foto-do-produto";
import {
  categoriaExisteNaLista,
  mesmaCategoria,
} from "@/lib/gestao-de-categorias";
import {
  AVISO_ESTOQUE_NAO_RESTAURADO,
  AVISO_PRODUTO_ALTERADO_DEPOIS,
  chaveDoRascunhoDoProduto,
  estoqueDoRascunhoDifereDoBanco,
  lerRascunhoVigenteDoProduto,
  rascunhoSobreOBancoDeHoje,
  serializarRascunhoDoProduto,
  variacoesDoRascunhoComEstoqueDoBanco,
} from "@/lib/rascunho-do-produto";
import { recusaDeFoto } from "@/lib/recusa-de-foto";
import { cn, formatCurrency } from "@/lib/utils";
import type { Product, ProductVariant, View } from "@/types";
import {
  camposQueMudaram,
  variacoesQueMudaram,
} from "@/utils/campos-mexidos-do-produto";
import { PrazoEsgotado, comPrazo } from "@/utils/com-prazo";
import { erroDoEstoqueDaVariacao } from "@/utils/estoque-da-variacao";
import {
  estoqueDoProdutoFoiMexido,
  formComVariacoes,
  variacoesSoComEstoqueMexido,
} from "@/utils/estoque-das-variacoes";
import {
  chaveDaIdentidade,
  recadoDoTetoDeVariacoes,
} from "@/utils/grade-de-combinacoes";
import {
  camposQueFaltam,
  fraseCurtaDoBloqueio,
  fraseCurtaDoEnvioDeFotos,
  motivoDoBloqueioDoProduto,
  motivoDoEnvioDeFotos,
} from "@/utils/motivo-do-bloqueio-do-produto";
import { precoProprioDaVariacao } from "@/utils/preco-da-variacao";
import { avisarProdutoNovoCadastrado } from "@/utils/produto-recem-cadastrado";
import {
  montarCodigoAutomatico,
  prefixoDoCodigo,
  sufixoLivre,
} from "@/utils/sku-automatico";
import {
  gruposDeVariacao,
  temGrupoDemais,
  travaDeUmGrupoSo,
} from "@/utils/um-grupo-de-variacao";
import {
  type ParDeAtributo,
  SEPARADOR_DE_ATRIBUTOS,
  alinharPelaOrdemGravada,
  dividirEmAtributos,
  juntarAtributos,
  validarAtributos,
} from "@/utils/variante-composta";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  Camera,
  Check,
  ChevronDown,
  DollarSign,
  Edit2,
  HelpCircle,
  Image as ImageIcon,
  Info,
  Layers,
  Loader2,
  Minus,
  Package,
  Plus,
  Power,
  Scissors,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  lazy,
  Suspense,
} from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";

// C5.2 — formato aceito para o código de barras (decisão do lote pdv-c5,
// §5.6): depois de aparar e remover espaços INTERNOS, só letras, números e
// hífen, de 4 a 64 caracteres. EAN/UPC/GTIN são dígitos, mas Code 128/39 têm
// letras — por isso não restringe a dígitos, e não valida dígito
// verificador (fora do escopo deste lote).
const REGEX_CODIGO_BARRAS = /^[A-Za-z0-9-]{4,64}$/;
const MSG_CODIGO_BARRAS_FORMATO_INVALIDO =
  "Só letras, números e hífen, de 4 a 64 caracteres.";
const MSG_CODIGO_BARRAS_DUPLICADO_NA_TELA =
  "Este código já está em outra variação deste produto.";

/** O campo "Preço diferente nesta variação" está com um valor, e esse valor é
 * zero ("0,00", "0.00", "0"). Vazio NÃO conta: vazio é "use o preço do
 * produto". Olha só os algarismos, sem interpretar vírgula ou ponto. */
function precoDaVariacaoEhZero(texto: string): boolean {
  return /\d/.test(texto) && !/[1-9]/.test(texto);
}

/** Percentual com 1 casa, em pt-BR ("33,3%", nunca "33.3%") — a mesma grafia
 * da lista de produtos. */
function percentualComUmaCasa(valor: number): string {
  return `${valor.toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`;
}

// C5.3 — o leitor de câmera (LeitorDeCodigo, componente de C2) só entra no
// chunk desta tela quando o lojista realmente clica em "Ler com a câmera":
// import DINÂMICO via `React.lazy`, do mesmo jeito que `conferirCodigoNoBanco`
// (acima) já faz com o cliente Supabase. Estático puxaria o decodificador de
// código de barras (e a câmera) para todo carregamento do formulário.
const LeitorDeCodigo = lazy(() =>
  import("@/components/admin/pdv/LeitorDeCodigo").then((modulo) => ({
    default: modulo.LeitorDeCodigo,
  })),
);

// A tela "Gerenciar categorias" só é baixada quando a lojista a abre (pelo
// mesmo motivo do leitor acima): fora dela o formulário não precisa dela.
const GerenciarCategorias = lazy(() =>
  import("@/components/admin/categorias/GerenciarCategorias").then(
    (modulo) => ({ default: modulo.GerenciarCategorias }),
  ),
);

// A folha "Nova categoria" (com a galeria de ícones) só é baixada quando a
// lojista a abre, como a tela acima: o formulário não paga por ela no pacote.
const FolhaDeNovaCategoria = lazy(() =>
  import("@/components/admin/products/FolhaDeNovaCategoria").then((modulo) => ({
    default: modulo.FolhaDeNovaCategoria,
  })),
);

// C5.3 — sem câmera (desktop sem webcam, navegador sem suporte) o botão
// some: quem lê o código ali é o leitor FÍSICO USB, que digita direto no
// campo (dispensa o modal). Chamada a cada render de propósito — é barata e
// `navigator.mediaDevices` pode mudar entre uma leitura e outra (permissão
// revogada, por exemplo).
function temCameraDisponivel(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function"
  );
}

/**
 * Prazo de UMA foto, da compressão ao fim do upload. Existe porque o botão
 * Publicar fica desligado enquanto há foto subindo e nenhuma das duas etapas
 * tinha prazo: em rede lenta uma promessa que nunca responde segurava a tela
 * para sempre (cliente pagante, 03/10/2026, selo "SLOW" na barra).
 *
 * Por que 90 s: depois da compressão (JPEG 1200 px, ~150-400 KB) o envio de
 * 400 KB a 100 kbps (o patamar "muito lenta" de celular) leva ~32 s; a
 * decodificação/compressão em celular de entrada soma 10-15 s. 90 s cobre esse
 * pior caso REAL com folga, e ainda é curto o bastante para a lojista não
 * esperar mais de um minuto e meio por foto antes de ver "Tentar de novo".
 */
const PRAZO_POR_FOTO_MS = 90_000;

/**
 * Prazo da conferência de um código de barras no SALVAR. A busca é uma consulta
 * curta; passar disto é rede ruim, e estourar vale como "não consegui conferir"
 * (aviso discreto, não bloqueia) -- o índice único do banco fecha a colisão real.
 */
const PRAZO_DO_CODIGO_NO_SALVAR_MS = 10_000;

/** Um só import do cliente do banco, mesmo com várias conferências ao mesmo tempo. */
let importDoClienteDoBanco:
  | Promise<typeof import("@/lib/supabase")>
  | undefined;
function clienteDoBanco() {
  importDoClienteDoBanco ??= import("@/lib/supabase").catch((erro) => {
    importDoClienteDoBanco = undefined;
    throw erro;
  });
  return importDoClienteDoBanco;
}

/**
 * Depois de "Excluir" ou "Tornar principal" as ações da foto em foco ficam
 * travadas por este tempo. As ações são sempre da foto que está em foco, e
 * depois do 1º toque a foto seguinte passa a ocupar o mesmo lugar da tela: um
 * 2º toque rápido (toque duplo) cairia no mesmo botão, já ligado à foto nova, e
 * apagaria uma segunda foto. 400 ms cobre um toque duplo e ainda é curto para
 * quem quer mesmo excluir a próxima.
 */
const TRAVA_DAS_ACOES_DE_FOTO_MS = 400;

/** Uma foto que não subiu: guarda o arquivo para "Tentar de novo". */
interface FotoComFalha {
  id: string;
  file: File;
  motivo: "demorou demais" | "não foi enviada";
}

// Exportado só para o teste chamar direto (não passa pelo componente inteiro)
// — continua sendo um detalhe interno desta tela, não uma API pública. Nome
// `compressProductImage` (não `compressImage`) de propósito: já existe um
// `compressImage` em `src/utils/avatars.ts` (assinatura incompatível,
// `string` → `Promise<string>`), e o TypeScript pega o auto-import errado
// quando os dois se chamam igual.
/** A foto não pôde ser lida (formato que o aparelho não abre, arquivo ruim). */
class FotoIlegivel extends Error {}

export const compressProductImage = (
  file: File,
  maxWidth = 1200,
  maxHeight = 1200,
  quality = 0.85,
): Promise<File> => {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/") || file.size < 100 * 1024) {
      resolve(file);
      return;
    }

    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      let width = img.width;
      let height = img.height;

      if (width > height) {
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
      } else {
        if (height > maxHeight) {
          width = Math.round((width * maxHeight) / height);
          height = maxHeight;
        }
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        URL.revokeObjectURL(objectUrl);
        resolve(file);
        return;
      }

      // JPEG não tem canal alfa: sem pintar um fundo antes, a área
      // transparente de um PNG (produto recortado, sem fundo) é composta
      // sobre PRETO por padrão do canvas no `toBlob` abaixo — a foto que
      // vende o produto na vitrine aparece com um retângulo preto atrás.
      // Mesmo conserto de `src/utils/avatars.ts`/`src/utils/covers.ts`:
      // branco, ANTES do `drawImage`, mantendo `image/jpeg` (o upload e o
      // resto do app já esperam esse tipo).
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob(
        (blob) => {
          URL.revokeObjectURL(objectUrl);
          if (blob) {
            const compressedFile = new File([blob], file.name, {
              type: "image/jpeg",
              lastModified: Date.now(),
            });
            resolve(compressedFile);
          } else {
            resolve(file);
          }
        },
        "image/jpeg",
        quality,
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new FotoIlegivel());
    };

    img.src = objectUrl;
  });
};

/** Par de atributo enquanto está no formulário, com chave estável de render:
 *  remover um par do meio não pode fazer o React reaproveitar a instância do
 *  vizinho com o rascunho que o `LocalBufferedInput` ainda guarda no debounce. */
type ParNoForm = ParDeAtributo & { chave: string };

let contadorDePares = 0;
const parNovo = (): ParNoForm => {
  contadorDePares += 1;
  return { chave: `par-${contadorDePares}`, name: "", value: "" };
};

/** Pares que vieram de fora (edição de linha gravada) ganham chave de render. */
const comChaveDeRender = (pares: ParDeAtributo[]): ParNoForm[] =>
  pares.map((par) => ({ ...parNovo(), ...par }));

interface AdminProductFormViewProps {
  productId?: string;
  onNavigate: (view: View, id?: string, bypassDirtyCheck?: boolean) => void;
  onSetDirty?: (dirty: boolean) => void;
  /** Registra o que o Voltar do celular faz (fechar a camada aberta). */
  onSetBackOverride?: (fn: (() => void) | null) => void;
  /**
   * L10 — uid de quem está no formulário: o rascunho (com custo e margem do
   * produto) vive em `ikcous_product_form_draft:<uid>` /
   * `ikcous_product_form_draft_edit_<id>:<uid>`. Sem uid a tela não lê nem
   * grava rascunho — nunca cai numa chave compartilhada entre admins.
   */
  userId?: string;
}

const ESTOQUE_MAXIMO_DO_PRODUTO = 10000;
const ID_DO_AVISO_DA_GRADE_PENDENTE = "rascunho-da-grade-pendente";

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
      delayChildren: 0.2,
    },
  },
};

// const itemVariants = {
//   hidden: { opacity: 0, y: 20 },
//   visible: { opacity: 1, y: 0 }
// };

interface ProductFormFields {
  name: string;
  description: string;
  price: string;
  costPrice: string;
  originalPrice: string;
  stock: string;
  /** Texto do campo "Avisar quando o estoque chegar a". Vazio = padrão (5). */
  estoqueMinimo: string;
  category: string;
  images: string[];
  freeShipping: boolean;
  isBestseller: boolean;
  isActive: boolean;
  metaTitle: string;
  metaDescription: string;
  sku: string;
  codigoBarras: string;
  variants: ProductVariant[];
  weightKg: string;
  widthCm: string;
  heightCm: string;
  lengthCm: string;
}

/**
 * Os campos do formulário a partir do produto como o banco o devolveu. É o que
 * a abertura da edição usa — e o que o salvar usa para RELER o banco quando um
 * salvar termina pela metade (ver `naoApagadas` em `handleSubmit`).
 */
function camposDoFormularioDoProduto(product: Product): ProductFormFields {
  return {
    name: product.name,
    description: product.description,
    price: product.price.toString(),
    costPrice: product.costPrice?.toString() || "",
    originalPrice: product.originalPrice?.toString() || "",
    stock: product.stock.toString(),
    // Zero é escolha da lojista: só `null`/ausente vira campo vazio.
    estoqueMinimo:
      product.estoqueMinimo == null ? "" : String(product.estoqueMinimo),
    category: product.category,
    // Só fotos de verdade: o "Sem Imagem" que a exibição inventa para produto
    // sem foto não entra no formulário (nem, por ele, no banco).
    images: soFotosReais(product.images),
    freeShipping: product.freeShipping,
    isBestseller: product.isBestseller,
    isActive: product.isActive,
    metaTitle: product.metaTitle || "",
    metaDescription: product.metaDescription || "",
    sku: product.sku || "",
    codigoBarras: product.codigoBarras || "",
    variants: product.variants || [],
    weightKg: product.weightKg?.toString() || "",
    widthCm: product.widthCm?.toString() || "",
    heightCm: product.heightCm?.toString() || "",
    lengthCm: product.lengthCm?.toString() || "",
  };
}

// 2147483647 é o maior número que a coluna (inteiro de 32 bits) guarda. O
// teto continua valendo, mas a tela não mostra esse número (onda J): são
// duas mensagens, uma para o que não é inteiro e outra para o grande demais.
const ESTOQUE_MINIMO_MAXIMO = 2147483647;
const MENSAGEM_ESTOQUE_MINIMO_INVALIDO =
  "Use um número inteiro: 0, 1, 2… (sem vírgula nem sinal de menos).";
const MENSAGEM_ESTOQUE_MINIMO_GRANDE_DEMAIS =
  "Número grande demais. Use um valor menor.";

/**
 * Lê o campo "Avisar quando o estoque chegar a". Vazio vira `null` (volta ao
 * padrão do projeto, 5); só dígitos viram o número, zero incluído (zero é
 * escolha da lojista). Qualquer outra coisa — negativo, decimal, texto ou
 * acima do que a coluna guarda — vira erro do campo, nunca NaN nem estouro
 * indo para o banco.
 */
function lerEstoqueMinimo(texto: string): {
  valor: number | null;
  erro: string;
} {
  const limpo = texto.trim();
  if (limpo === "") return { valor: null, erro: "" };
  if (!/^\d+$/.test(limpo)) {
    return { valor: null, erro: MENSAGEM_ESTOQUE_MINIMO_INVALIDO };
  }
  const numero = Math.max(0, Math.trunc(Number(limpo)));
  if (!Number.isSafeInteger(numero) || numero > ESTOQUE_MINIMO_MAXIMO) {
    return { valor: null, erro: MENSAGEM_ESTOQUE_MINIMO_GRANDE_DEMAIS };
  }
  return { valor: numero, erro: "" };
}

const limparNumeroDoCampo = (val: string) => {
  if (!val) return "";
  let clean = val.replace(",", ".").replace(/[^\d.-]/g, "");
  const parts = clean.split(".");
  if (parts.length > 2) {
    clean = `${parts[0]}.${parts.slice(1).join("")}`;
  }
  return clean;
};

/** Texto de número do formulário -> número, ou `undefined` se vazio/ilegível. */
const numeroOpcionalDoCampo = (val: string): number | undefined => {
  const limpo = limparNumeroDoCampo(val);
  if (!limpo) return undefined;
  const numero = Number.parseFloat(limpo);
  return Number.isNaN(numero) ? undefined : numero;
};

/**
 * O que o formulário grava no produto (sem a lista de variações), a partir dos
 * textos dos campos. É a MESMA função para o formulário de agora e para o que a
 * tela leu ao abrir: a edição compara os dois resultados e manda só o que
 * mudou (ver `campos-mexidos-do-produto.ts`), então a normalização de número,
 * código e foto não pode divergir entre os dois lados.
 *
 * CAMPO VAZIO VAI COMO `null`, NUNCA COMO `undefined` (ADMIN-050, #96).
 * `undefined` significaria "não mexi": a guarda `updates.X !== undefined` do
 * useProducts descarta a chave, o UPDATE sai sem a coluna, o valor antigo
 * sobrevive — e a tela confirma "Salvo". Era assim que desmarcar "Produto em
 * Promoção" mantinha o preço riscado na loja. `null` atravessa a guarda e apaga
 * de verdade. A comparação da edição preserva isso: vazio que mudou vai `null`.
 */
function dadosDoProdutoDoFormulario(
  form: ProductFormFields,
  opcoes: { promocaoLigada: boolean; entregaLocal: boolean },
) {
  const pPrice = numeroOpcionalDoCampo(form.price) || 0;
  const pCost = numeroOpcionalDoCampo(form.costPrice);
  const pOriginal = numeroOpcionalDoCampo(form.originalPrice);
  const pStock = Number(form.stock) || 0;
  const pWeight = numeroOpcionalDoCampo(form.weightKg);
  const pWidth = numeroOpcionalDoCampo(form.widthCm);
  const pHeight = numeroOpcionalDoCampo(form.heightCm);
  const pLength = numeroOpcionalDoCampo(form.lengthCm);

  const sanitizedSku = form.sku
    ? form.sku.trim().toUpperCase().replace(/\s+/g, "-")
    : undefined;
  const sanitizedCodigoBarras = form.codigoBarras
    ? normalizarCodigoBarras(form.codigoBarras)
    : undefined;

  // As dimensões são a ÚNICA exceção à regra do cabeçalho, e de propósito: com
  // entrega local a tela nem mostra esses campos, então `undefined` ali é
  // literalmente "não mexi" — é o que impede que ligar entrega local apague
  // peso e medidas que a lojista já tinha cadastrado para o Melhor Envio. Com
  // entrega nacional a tela mostra os campos, e aí vazio quer dizer limpar.
  const medida = (valor: number | undefined) =>
    opcoes.entregaLocal
      ? undefined
      : valor !== undefined
        ? Math.max(0, valor)
        : null;

  const dados = {
    name: form.name.trim(),
    description: form.description.trim(),
    price: Math.max(0, pPrice),
    costPrice: pCost !== undefined ? Math.max(0, pCost) : null,
    originalPrice:
      opcoes.promocaoLigada && pOriginal !== undefined
        ? Math.max(0, pOriginal)
        : null,
    // `stock` e `sold` NÃO estão aqui: o número que a tela leu ao abrir fica
    // velho quando uma venda o desconta no banco, e mandá-lo de volta
    // devolvia a peça vendida à prateleira. Na edição o estoque só vai se a
    // lojista mexeu (ver `estoqueDoProdutoFoiMexido`) e o vendido nunca vai;
    // no produto novo os dois vão no `addProduct`.
    // Vazio = `null` (volta ao padrão, 5); número inteiro >= 0 vai como está.
    // Texto inválido já bloqueou o salvar, então aqui nunca é NaN.
    estoqueMinimo: lerEstoqueMinimo(form.estoqueMinimo).valor,
    category: form.category,
    // Nunca o marcador "Sem Imagem" (placehold.co): a vitrine mostra
    // `images[0]`, e foto de verdade não pode ficar atrás dele. Sem foto, a
    // lista vai vazia e a exibição põe o marcador por conta própria.
    images: soFotosReais(form.images),
    freeShipping: form.freeShipping,
    isBestseller: form.isBestseller,
    isActive: form.isActive,
    metaTitle: form.metaTitle.trim(),
    metaDescription: form.metaDescription.trim(),
    sku: sanitizedSku || null,
    codigoBarras: sanitizedCodigoBarras || null,
    weightKg: medida(pWeight),
    widthCm: medida(pWidth),
    heightCm: medida(pHeight),
    lengthCm: medida(pLength),
  };
  return { dados, estoque: pStock };
}

// Dinheiro compara pelo valor: tocar no campo e sair devolve "100.00" onde o
// produto abriu como "100" — o mesmo preço, que não é alteração.
const mesmoDinheiro = (a: string, b: string) =>
  a === b || (a !== "" && b !== "" && Number(a) === Number(b));

function isProductFormDirty(
  a: ProductFormFields,
  b: ProductFormFields,
): boolean {
  if (a.name !== b.name) return true;
  if (a.description !== b.description) return true;
  if (!mesmoDinheiro(a.price, b.price)) return true;
  if (!mesmoDinheiro(a.costPrice, b.costPrice)) return true;
  if (!mesmoDinheiro(a.originalPrice, b.originalPrice)) return true;
  if (a.stock !== b.stock) return true;
  if (a.estoqueMinimo !== b.estoqueMinimo) return true;
  if (a.category !== b.category) return true;
  if (a.freeShipping !== b.freeShipping) return true;
  if (a.isBestseller !== b.isBestseller) return true;
  if (a.isActive !== b.isActive) return true;
  if (a.metaTitle !== b.metaTitle) return true;
  if (a.metaDescription !== b.metaDescription) return true;
  if (a.sku !== b.sku) return true;
  if (a.codigoBarras !== b.codigoBarras) return true;
  if (a.weightKg !== b.weightKg) return true;
  if (a.widthCm !== b.widthCm) return true;
  if (a.heightCm !== b.heightCm) return true;
  if (a.lengthCm !== b.lengthCm) return true;

  if (a.images.length !== b.images.length) return true;
  for (let i = 0; i < a.images.length; i++) {
    if (a.images[i] !== b.images[i]) return true;
  }

  if (a.variants.length !== b.variants.length) return true;
  for (let i = 0; i < a.variants.length; i++) {
    const vA = a.variants[i];
    const vB = b.variants[i];
    if (
      vA.id !== vB.id ||
      vA.productId !== vB.productId ||
      vA.sku !== vB.sku ||
      vA.codigoBarras !== vB.codigoBarras ||
      vA.name !== vB.name ||
      vA.value !== vB.value ||
      vA.stockIncrement !== vB.stockIncrement ||
      vA.stock !== vB.stock ||
      vA.priceOverride !== vB.priceOverride ||
      vA.active !== vB.active ||
      vA.imageUrl !== vB.imageUrl
    )
      return true;
  }

  return false;
}

const FormularioDoProduto = React.memo(function FormularioDoProduto({
  productId,
  onNavigate,
  onSetDirty,
  onSetBackOverride,
  userId,
}: AdminProductFormViewProps) {
  const {
    addProduct,
    updateProduct,
    salvarProdutoComGrade,
    upsertVariants,
    deleteVariants,
    uploadProductImages,
    fetchProduct,
    // `= []`: consumidor que não expõe a lista (testes de contrato da tela)
    // deixa a checagem de SKU global degenerar para o produto atual.
    products = [],
  } = useProducts({ autoFetch: false });

  // O SKU da variação é UNIQUE na loja INTEIRA, não por produto. A grade gera
  // códigos previsíveis (base reaproveitada, sufixo por valor), então a
  // checagem do modal precisa enxergar a loja, não só este produto. Melhor
  // esforço: se a lista de produtos ainda não carregou, a checagem degenera
  // para o produto atual — e o salvar confere de novo (`upsertVariants`).
  const skusDaLoja = useMemo(
    () =>
      products.flatMap((p: { variants?: ProductVariant[] }) =>
        (p.variants ?? []).map((v) => v.sku ?? ""),
      ),
    [products],
  );
  const {
    categories: dbCategories,
    addCategory,
    updateCategory,
    isLoading: carregandoCategorias,
  } = useCategories();
  const isOffline = useOnlineStatus();
  const { config } = useStore();
  const isLocalShipping = config?.shippingCoverage === "local";
  const {
    marca: marcaDoTopo,
    topo: topoRef,
    compacto: topoCompacto,
  } = useTopoCompacto();

  const [isLoading, setIsLoading] = useState(!!productId);
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    price: "",
    costPrice: "",
    originalPrice: "",
    stock: "",
    estoqueMinimo: "",
    category: "",
    images: [] as string[],
    freeShipping: false,
    isBestseller: false,
    isActive: true,
    metaTitle: "",
    metaDescription: "",
    sku: "",
    codigoBarras: "",
    variants: [] as ProductVariant[],
    weightKg: "",
    widthCm: "",
    heightCm: "",
    lengthCm: "",
  });

  const [initialData, setInitialData] = useState({
    name: "",
    description: "",
    price: "",
    costPrice: "",
    originalPrice: "",
    stock: "",
    estoqueMinimo: "",
    category: "",
    images: [] as string[],
    freeShipping: false,
    isBestseller: false,
    isActive: true,
    metaTitle: "",
    metaDescription: "",
    sku: "",
    codigoBarras: "",
    variants: [] as ProductVariant[],
    weightKg: "",
    widthCm: "",
    heightCm: "",
    lengthCm: "",
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  // Um salvar terminou pela metade COM variação nova já gravada e a releitura
  // do banco falhou: o formulário ainda guarda o id provisório (`temp-…`) dela,
  // e salvar de novo a inseriria outra vez. Só recarregar a tela resolve.
  const [precisaRecarregar, setPrecisaRecarregar] = useState(false);
  const [draftChecked, setDraftChecked] = useState(false);
  const [showVariantForm, setShowVariantForm] = useState(false);
  // Grade de combinações: o modal de lote ao lado do unitário.
  const [showGradeForm, setShowGradeForm] = useState(false);
  // O Preço de Venda que a grade preencheu (campo estava vazio): a frase "veio
  // da grade" fica sob o campo até a lojista mudar o valor. Não vai para o
  // rascunho — é só um recado da tela, o preço em si fica no `formData`.
  const [precoVeioDaGrade, setPrecoVeioDaGrade] = useState(false);
  const [editingVariant, setEditingVariant] = useState<ProductVariant | null>(
    null,
  );
  // Uma variante é UMA OU MAIS duplas atributo+valor ("Cor"+"Branca" ou
  // "Cor"+"Branca" com "Tamanho"+"PP") que viram UMA linha de variante com
  // estoque próprio — ver `variante-composta.ts`. O modal nasce com um par;
  // "+ Outra coisa que muda" empilha os demais.
  const [variantFormData, setVariantFormData] = useState<{
    pares: ParNoForm[];
    sku: string;
    codigoBarras: string;
    stockIncrement: string;
    priceOverride: string;
    active: boolean;
    imageUrl: string;
  }>({
    pares: [parNovo()],
    sku: "",
    codigoBarras: "",
    stockIncrement: "0",
    priceOverride: "",
    active: true,
    imageUrl: "",
  });
  const [currentProduct, setCurrentProduct] = useState<any>(null);
  const [showCategoryForm, setShowCategoryForm] = useState(false);
  const [gerenciandoCategorias, setGerenciandoCategorias] = useState(false);
  // A folha "Categoria" (o campo a controla; o formulário só precisa saber se
  // está aberta, para o Voltar do celular fechá-la).
  const [escolhendoCategoria, setEscolhendoCategoria] = useState(false);
  // A lojista renomeou ou apagou a categoria que está escolhida AQUI: o campo
  // acompanha. O banco já trocou o nome no produto salvo; sem isto, salvar com o
  // nome velho no campo devolveria o produto à categoria que não existe mais.
  useAoMudarCategoria((mudanca) => {
    if (mudanca.tipo === "renomeada") {
      setFormData((prev) =>
        mesmaCategoria(prev.category ?? "", mudanca.de)
          ? { ...prev, category: mudanca.para }
          : prev,
      );
    } else if (mudanca.tipo === "apagada") {
      setFormData((prev) =>
        mesmaCategoria(prev.category ?? "", mudanca.nome)
          ? { ...prev, category: "" }
          : prev,
      );
    }
  });
  // A categoria que um RASCUNHO restaurado trouxe, ainda por conferir. O rascunho
  // fica guardado no aparelho por até 7 dias; nesse tempo a lojista pode ter
  // renomeado ou apagado a categoria (em "Gerenciar categorias" ou em outro
  // aparelho), e salvar com o nome velho deixaria o produto órfão da vitrine.
  // Depois que a lista de categorias chega, o nome que não existe mais sai do
  // campo e a lojista é avisada de que precisa escolher de novo.
  const [categoriaDoRascunho, setCategoriaDoRascunho] = useState<string | null>(
    null,
  );
  const [categoriaDoRascunhoSumiu, setCategoriaDoRascunhoSumiu] = useState<
    string | null
  >(null);
  useEffect(() => {
    if (categoriaDoRascunho === null) return;
    // Lista ainda chegando (ou vazia por falha de leitura): não dá para afirmar nada.
    if (carregandoCategorias || dbCategories.length === 0) return;
    setCategoriaDoRascunho(null);
    if (categoriaExisteNaLista(categoriaDoRascunho, dbCategories)) return;
    setCategoriaDoRascunhoSumiu(categoriaDoRascunho);
    setFormData((prev) =>
      mesmaCategoria(prev.category ?? "", categoriaDoRascunho)
        ? { ...prev, category: "" }
        : prev,
    );
    toast.warning(
      `A categoria “${categoriaDoRascunho}” do rascunho não existe mais. Escolha a categoria de novo.`,
    );
  }, [categoriaDoRascunho, carregandoCategorias, dbCategories]);
  const [deletedVariantIds, setDeletedVariantIds] = useState<string[]>([]);
  const [variantToDelete, setVariantToDelete] = useState<string | null>(null);
  const [isPromoActive, setIsPromoActive] = useState(false);
  // `key` da seção "Variações": muda UMA vez quando um RASCUNHO com variações
  // é aplicado depois da montagem (o `abertaInicial` da seção só vale na
  // montagem, e o rascunho chega por efeito/toast, já com o corpo montado).
  // Sai no mesmo lote do `setFormData` do rascunho; edições normais não mexem.
  const [chaveDasVariacoes, setChaveDasVariacoes] = useState(0);

  const [skuError, setSkuError] = useState("");
  // Código interno AUTOMÁTICO (ver `utils/sku-automatico.ts`). O valor mora em
  // `formData.sku`, como sempre — estas três peças só decidem QUEM o escreve:
  // `skuAutomatico` liga o gerador; `skuManualGuardado` é o que a lojista tinha
  // (digitado ou já salvo) para voltar se ela desligar; `sufixoAuto` é o final
  // aleatório do código (o começo acompanha a categoria).
  const [skuAutomatico, setSkuAutomatico] = useState(false);
  const [sufixoAuto, setSufixoAuto] = useState("");
  const skuManualGuardado = useRef("");
  // C5.2 — três estados para o código de barras do PRODUTO: `ErroLocal`
  // (formato + duplicidade DENTRO da tela, sem rede) e `ErroRede`
  // (duplicidade no CATÁLOGO inteiro, achada pela RPC no blur) ficam
  // separados de propósito — se fossem um só, editar qualquer variação
  // (que recalcula o `ErroLocal`) apagaria sozinho o aviso de rede que o
  // blur tinha acabado de encontrar. `AvisoRede` é a falha de conexão, que
  // NUNCA bloqueia o salvar (só avisa). Ver `codigoBarrasError` mais abaixo,
  // que combina os dois primeiros para o render e o `isValid`.
  const [codigoBarrasErroLocal, setCodigoBarrasErroLocal] = useState("");
  const [codigoBarrasErroRede, setCodigoBarrasErroRede] = useState("");
  const [codigoBarrasAvisoRede, setCodigoBarrasAvisoRede] = useState("");
  // Código de barras da VARIANTE em edição no modal: só formato local +
  // duplicidade no catálogo (a duplicidade DENTRO da tela é uma conta do
  // produto inteiro, recalculada quando a variante entra em
  // `formData.variants` — ver o efeito do produto acima).
  const [variantCodigoBarrasError, setVariantCodigoBarrasError] = useState("");
  const [variantCodigoBarrasAvisoRede, setVariantCodigoBarrasAvisoRede] =
    useState("");
  // C5.3 — qual campo o leitor de câmera está preenchendo agora (`null` =
  // fechado). Só um de cada vez: o modal de variação já cobre o campo do
  // produto, então não há como os dois estarem abertos ao mesmo tempo.
  const [leitorAberto, setLeitorAberto] = useState<
    "produto" | "variacao" | null
  >(null);
  const [priceError, setPriceError] = useState("");
  const [costError, setCostError] = useState("");
  const [originalPriceError, setOriginalPriceError] = useState("");
  const [stockError, setStockError] = useState("");
  const [previewMode, setPreviewMode] = useState<"card" | "page">("card");
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [activeDetailTab, setActiveDetailTab] = useState<
    "description" | "reviews" | "questions"
  >("description");
  const [previewImgIndex, setPreviewImgIndex] = useState(0);
  const [previewSelectedVariants, setPreviewSelectedVariants] = useState<
    Record<string, string>
  >({});

  // Image Adjustment and Quality state variables
  const [imageMetadata, setImageMetadata] = useState<
    Record<
      string,
      {
        width: number;
        height: number;
        status:
          | "loading"
          | "excellent"
          | "warning_aspect"
          | "warning_res"
          | "good"
          | "erro";
      }
    >
  >({});
  const evaluatedImagesRef = useRef<Set<string>>(new Set());
  // #98 (ADMIN-060): guarda o setTimeout de navegação pós-sucesso para poder
  // cancelá-lo se o admin sair da tela antes dos 1,5s — sem isto, onNavigate
  // dispara mesmo com o componente já desmontado.
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isAdjusterOpen, setIsAdjusterOpen] = useState(false);
  const [adjustingImgUrl, setAdjustingImgUrl] = useState("");
  const [adjustingImgIndex, setAdjustingImgIndex] = useState<number | null>(
    null,
  );
  const [isUploadingAdjusted, setIsUploadingAdjusted] = useState(false);
  const [isUploadingImages, setIsUploadingImages] = useState(false);
  // "Foto 1 de 3" do lote em andamento, para o aviso do botão desligado.
  const [progressoDoEnvio, setProgressoDoEnvio] = useState<{
    atual: number;
    total: number;
  } | null>(null);
  // Fotos que estouraram o prazo ou falharam: ficam na tela com "Tentar de
  // novo"/"Remover" e NUNCA entram em `isValid` -- não impedem salvar.
  const [fotosComFalha, setFotosComFalha] = useState<FotoComFalha[]>([]);
  // Ligado quando o produto novo JÁ foi criado e a lojista está sendo levada
  // para a edição dele (a grade não gravou). Daí em diante o auto-save não pode
  // mais escrever na chave de produto novo: recuperaria o rascunho sem id e o
  // próximo "Publicar" criaria um segundo produto idêntico.
  const produtoNovoJaCriadoRef = useRef(false);
  // O produto foi criado, mas as variações não gravaram: elas só existem no
  // rascunho. Enquanto não restaura (ou descarta), Salvar não finge sucesso e o
  // salvamento automático não troca o rascunho por um sem a grade.
  const [variacoesPendentes, setVariacoesPendentes] = useState(false);
  const restaurarPendenteRef = useRef<(() => void) | null>(null);
  // A grade do rascunho pendente AINDA não está no banco, mesmo depois de
  // "Restaurar" (que só a devolve ao formulário). Enquanto o formulário tiver
  // variação nova (`temp-…`) vinda dela, o salvamento automático regrava o
  // rascunho com a marca `variacoesPendentes`; sem isso, sair sem salvar e voltar
  // (ou tocar Salvar sem restaurar) perdia a grade. Cai ao descartar ou quando a
  // grade grava (o salvar apaga o rascunho e a tela segue).
  const gradeDoRascunhoPendenteRef = useRef(false);
  // A chave do rascunho que o salvamento automático gravou NESTA abertura: só
  // ele pode apagá-la ao voltar ao que está no banco (o rascunho que já estava
  // lá antes fica esperando a decisão dela).
  const gravouRascunhoRef = useRef<string | null>(null);
  // O produto NOVO abriu com um rascunho recuperado: nesse caso `initialData`
  // é o próprio rascunho, e "voltar a igualar initialData" quer dizer "voltou
  // ao que foi recuperado" -- não "não tem mais nada a guardar". Enquanto ela
  // não salva nem toca em Descartar, o rascunho fica (guardado o que está na
  // tela, que é o recuperado).
  const rascunhoRecuperadoRef = useRef<string | null>(null);
  // Um salvar desta tela JÁ gravou o produto no caminho de duas etapas (produto,
  // depois grade) e pode ter terminado pela metade. O banco então já tem valores
  // que a tela não registrou em `initialData`: voltar um campo ao valor de
  // abertura não é "não mexi". Ligado, o próximo salvar manda tudo (como antes
  // de mandar só o que mudou) em vez de comparar com a abertura.
  const salvarAnteriorGravouProdutoRef = useRef(false);
  const [imageUploadStep, setImageUploadStep] = useState<
    "compressing" | "uploading" | "idle"
  >("idle");
  const isImageUploading = isUploadingImages || isUploadingAdjusted;
  const [isDragging, setIsDragging] = useState(false);

  const [showPhotoGuide, setShowPhotoGuide] = useState(false);
  const [expandedHelp, setExpandedHelp] = useState<Record<string, boolean>>({});

  // Voltar do celular com leitor, prévia, recorte, ajuda ou uma janela do
  // formulário (variação, grade, categoria) aberto fecha SÓ a camada (mesmo
  // esquema da tela de Banners): ao abrir empurra uma entrada de histórico na
  // mesma URL; fechar por qualquer caminho a consome, a não ser que o próprio
  // navegador já tenha feito isso (Voltar físico).
  const camadaAberta =
    leitorAberto !== null ||
    isPreviewOpen ||
    isAdjusterOpen ||
    showHelpModal ||
    showVariantForm ||
    showGradeForm ||
    showCategoryForm ||
    gerenciandoCategorias ||
    escolhendoCategoria;
  // Fechar a janela de variação pelo Voltar é o mesmo que o botão Cancelar:
  // o rascunho do modal permanece, mas veredito e aviso de código de barras
  // são da checagem passada e não sobrevivem ao fechar.
  const cancelarVariacao = useCallback(() => {
    setVariantCodigoBarrasError("");
    setVariantCodigoBarrasAvisoRede("");
    setLeitorAberto(null);
    setShowVariantForm(false);
    setEditingVariant(null);
  }, []);
  const entradaDaCamadaRef = useRef(false);
  // Fechar pelo botão da camada devolve a entrada com `history.back()`, e o
  // `popstate` dele chega DEPOIS. Se o desvio do Voltar já tivesse sido zerado,
  // o App trataria esse Voltar como "sair do cadastro" e, com o formulário
  // mexido, abriria "Alterações Não Salvas" (cujo "Descartar" apaga o rascunho).
  // Por isso, até o `popstate` chegar fica registrado um desvio de uso único que
  // só engole esse Voltar e se desfaz. `engolidorRef` guarda qual é o vigente:
  // o prazo e a reabertura só desfazem ELE, nunca um desvio de camada nova.
  const engolidorRef = useRef<(() => void) | null>(null);
  const prazoDoEngolidorRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const onSetBackOverrideRef = useRef(onSetBackOverride);
  onSetBackOverrideRef.current = onSetBackOverride;
  const soltarEngolidor = useCallback(() => {
    if (prazoDoEngolidorRef.current !== null) {
      clearTimeout(prazoDoEngolidorRef.current);
      prazoDoEngolidorRef.current = null;
    }
    engolidorRef.current = null;
  }, []);
  useEffect(() => {
    if (camadaAberta) {
      // Reabriu antes do `popstate` da devolução anterior: o desvio da camada
      // nova (abaixo) toma o lugar do engolidor, que não pode mais agir.
      soltarEngolidor();
      // Uma entrada serve ao conjunto de camadas. Mas um Voltar físico a
      // consome mesmo com outra camada por baixo (o leitor abre DENTRO da
      // janela de variação): nesse caso o topo já não é nosso e a camada que
      // sobrou precisa de entrada nova, senão o Voltar seguinte sairia da tela.
      if (
        !entradaDaCamadaRef.current ||
        window.history.state?.modal !== "produto"
      ) {
        window.history.pushState(
          { ...window.history.state, modal: "produto" },
          "",
          window.location.pathname + window.location.search,
        );
        entradaDaCamadaRef.current = true;
      }
      onSetBackOverride?.(() => () => {
        // A de cima primeiro: leitor, recorte, prévia, as janelas do
        // formulário e por fim a ajuda.
        if (leitorAberto !== null) setLeitorAberto(null);
        else if (isAdjusterOpen) {
          setIsAdjusterOpen(false);
          setAdjustingImgIndex(null);
        } else if (isPreviewOpen) setIsPreviewOpen(false);
        else if (showVariantForm) cancelarVariacao();
        else if (showGradeForm) setShowGradeForm(false);
        else if (showCategoryForm) setShowCategoryForm(false);
        else if (gerenciandoCategorias) setGerenciandoCategorias(false);
        else if (escolhendoCategoria) setEscolhendoCategoria(false);
        else setShowHelpModal(false);
      });
      return;
    }
    if (entradaDaCamadaRef.current) {
      entradaDaCamadaRef.current = false;
      if (window.history.state?.modal === "produto") {
        // A entrada ainda é nossa: devolvê-la com o desvio que engole o Voltar.
        if (onSetBackOverride) {
          const engolidor = () => {
            soltarEngolidor();
            onSetBackOverride(null);
          };
          engolidorRef.current = engolidor;
          onSetBackOverride(() => engolidor);
          // Rede de segurança: se o `popstate` nunca chegar, o engolidor não
          // pode ficar preso para engolir um Voltar FUTURO.
          prazoDoEngolidorRef.current = setTimeout(() => {
            prazoDoEngolidorRef.current = null;
            if (engolidorRef.current !== engolidor) return;
            engolidorRef.current = null;
            onSetBackOverride(null);
          }, 1500);
        }
        window.history.back();
        return;
      }
      // O Voltar físico já consumiu a entrada (e o desvio da camada rodou):
      // nada a devolver, é só desfazer o desvio.
    }
    onSetBackOverride?.(null);
  }, [
    camadaAberta,
    leitorAberto,
    isAdjusterOpen,
    isPreviewOpen,
    showVariantForm,
    showGradeForm,
    showCategoryForm,
    gerenciandoCategorias,
    escolhendoCategoria,
    cancelarVariacao,
    onSetBackOverride,
    soltarEngolidor,
  ]);
  // Sair da tela: nada de desvio (nem engolidor) sobrando no App.
  useEffect(
    () => () => {
      soltarEngolidor();
      onSetBackOverrideRef.current?.(null);
    },
    [soltarEngolidor],
  );

  const toggleHelp = (key: string) => {
    setExpandedHelp((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  // Um produto so pode ter UM grupo de variacao -- ver `um-grupo-de-variacao.ts`.
  // Enquanto nao ha nenhuma variante, sugerir os grupos comuns ajuda; a partir
  // da primeira, sugerir "Tamanho" a quem ja escolheu "Cor" seria convidar
  // para o estado que a trava logo abaixo recusa.
  const gruposJaUsados = formData.variants.map((v) => v.name).filter(Boolean);
  const suggestedAttributes = Array.from(
    new Set(
      gruposJaUsados.length > 0
        ? gruposJaUsados
        : ["Cor", "Tamanho", "Voltagem", "Capacidade", "Material"],
    ),
  ).filter(Boolean);
  // Os valores que OUTRAS linhas do produto já gravam para um atributo ("azul",
  // em "cor"): ao TOCAR uma bolinha, o seletor usa essa grafia, porque a loja
  // compara o texto exato e "azul" + "Azul" viram duas cores. A linha em edição
  // não conta (senão não haveria caminho para corrigir a caixa dela).
  const valoresGravadosDoAtributo = (atributo: string): string[] => {
    const chave = atributo.trim().toLowerCase();
    if (chave === "") return [];
    return formData.variants
      .filter((v) => !editingVariant || v.id !== editingVariant.id)
      .flatMap((v) => dividirEmAtributos(v.name, v.value))
      .filter((par) => par.name.trim().toLowerCase() === chave)
      .map((par) => par.value.trim())
      .filter((valor) => valor !== "");
  };
  const produtoTemGrupoDemais = temGrupoDemais(formData.variants);
  // O rótulo do botão que empilha mais uma dimensão. O exemplo é a outra
  // metade da dupla mais comum e só aparece DEPOIS de a lojista escolher a
  // primeira (antes disso o "Tamanho" já está à vista nas peças de cima).
  const nomeDoUltimoAtributo = variantFormData.pares.at(-1)?.name ?? "";
  const exemploDoProximoAtributo =
    tipoDoNome(nomeDoUltimoAtributo) === "Tamanho" ? "Cor" : "Tamanho";
  const rotuloDoMaisUmAtributo =
    nomeDoUltimoAtributo.trim() === ""
      ? "+ Outra coisa que muda"
      : `+ Outra coisa que muda (ex.: ${exemploDoProximoAtributo})`;

  useEffect(() => {
    formData.images.forEach((url) => {
      if (evaluatedImagesRef.current.has(url)) return;
      evaluatedImagesRef.current.add(url);

      setImageMetadata((prev) => ({
        ...prev,
        [url]: { width: 0, height: 0, status: "loading" },
      }));

      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        const w = img.naturalWidth;
        const h = img.naturalHeight;
        const ratio = w / h;
        const res = w * h;

        let status: "excellent" | "warning_aspect" | "warning_res" | "good" =
          "good";

        if (res < 600 * 600) {
          status = "warning_res";
        } else if (
          (ratio < 0.7 || ratio > 0.9) &&
          (ratio < 0.95 || ratio > 1.05)
        ) {
          status = "warning_aspect";
        } else if (res >= 1000 * 1000) {
          status = "excellent";
        }

        setImageMetadata((prev) => ({
          ...prev,
          [url]: { width: w, height: h, status },
        }));
      };
      img.onerror = () => {
        setImageMetadata((prev) => ({
          ...prev,
          [url]: { width: 0, height: 0, status: "erro" },
        }));
      };
      img.src = url;
    });
  }, [formData.images]);

  // Lock body scroll when variant or category forms are open
  useEffect(() => {
    if (showVariantForm || showCategoryForm || showGradeForm) {
      document.body.classList.add("admin-modal-open");
      return () => {
        document.body.classList.remove("admin-modal-open");
      };
    }
  }, [showVariantForm, showCategoryForm, showGradeForm]);

  const openAdjuster = (url: string, index: number) => {
    setAdjustingImgUrl(url);
    setAdjustingImgIndex(index);
    setIsAdjusterOpen(true);
  };

  const handleAdjustConfirm = async (croppedBlob: Blob) => {
    if (adjustingImgIndex === null) return;
    setIsUploadingAdjusted(true);

    const file = arquivoDaImagemRecortada(croppedBlob, "product-image-");
    const loadingToast = toast.loading("Enviando imagem recortada...");

    const fim = marcarOperacaoSensivel("upload-de-foto-do-produto");
    try {
      // Mesmo prazo das fotos novas: o botão Publicar fica desligado enquanto
      // este envio roda, e um upload que nunca responde o prenderia.
      // Se o upload terminar DEPOIS do prazo, a tela já deu o envio por falha:
      // o objeto que ele gravou é apagado (não fica órfão no armazenamento).
      const urls = await comPrazo(
        uploadProductImages([file]),
        PRAZO_POR_FOTO_MS,
        undefined,
        (urlsTardias) => {
          void descartarFotosDoProduto(urlsTardias ?? []);
        },
      );
      if (urls && urls.length > 0) {
        const newUrl = urls[0];
        setFormData((prev) => {
          const newImages = [...prev.images];
          newImages[adjustingImgIndex] = newUrl;
          return {
            ...prev,
            images: newImages,
          };
        });

        // Pre-evaluate the newly cropped image immediately
        const img = new Image();
        img.onload = () => {
          setImageMetadata((prev) => ({
            ...prev,
            [newUrl]: {
              width: img.naturalWidth,
              height: img.naturalHeight,
              status: "excellent",
            },
          }));
        };
        img.src = newUrl;

        toast.success("Imagem ajustada com sucesso!", { id: loadingToast });
        setIsAdjusterOpen(false);
        setAdjustingImgIndex(null);
      } else {
        throw new Error("Upload returned empty list");
      }
    } catch (error) {
      console.error("Error uploading adjusted image:", error);
      toast.error("Erro ao salvar imagem ajustada", {
        id: loadingToast,
        description:
          error instanceof PrazoEsgotado
            ? "O envio demorou demais. Confira a conexão e tente de novo."
            : undefined,
      });
    } finally {
      fim();
      setIsUploadingAdjusted(false);
    }
  };

  useEffect(() => {
    if (productId) {
      const loadProduct = async () => {
        setIsLoading(true);
        // PAINEL-06: distinguir "não existe" de "não consegui carregar".
        // Antes: fetchProduct engolia erro de rede e devolvia null —
        // a view dizia "não encontrado" e expulsava o lojista.
        let product: ReturnType<typeof fetchProduct> extends Promise<infer T>
          ? T
          : never = null;
        try {
          product = await fetchProduct(productId);
        } catch (err) {
          console.error("[ProductForm] Erro ao carregar produto:", err);
          toast.error("Erro ao carregar produto. Verifique a conexão.");
          setIsLoading(false);
          // B3 da 2a revisao: SEM isto, o formulario vazio renderizava
          // normalmente — e Salvar com currentProduct null chamava
          // updateProduct com o objeto inteiro, APAGANDO os dados do
          // produto real (imagem_urls=[], custo=null, sold=0).
          // B3: currentProduct ja esta null (produto nao carregou) —
          // handleSubmit usa currentProduct para decidir update vs insert,
          // entao um save daqui seria um INSERT vazio, nao um UPDATE
          // destrutivo. Mas para nao deixar o lojista parado num form que
          // parece editavel, a tela de erro deve ocupar o render inteiro.
          return;
        }
        if (product) {
          const productFields = camposDoFormularioDoProduto(product);
          setFormData(productFields);
          setInitialData(productFields);
          setIsPromoActive(!!product.originalPrice);
          setCurrentProduct(product);
          salvarAnteriorGravouProdutoRef.current = false;
        } else {
          toast.error("Produto não encontrado");
          onNavigate("admin-products");
        }
        setIsLoading(false);
      };
      loadProduct();
    }
  }, [productId, fetchProduct, onNavigate]);
  // Draft recovery on mount for new products
  useEffect(() => {
    if (!productId) {
      const chaveDoRascunho = chaveDoRascunhoDoProduto(userId);
      // Rascunho com mais de 7 dias já sai daqui descartado (vira `null`).
      const savedDraft = chaveDoRascunho
        ? lerRascunhoVigenteDoProduto(chaveDoRascunho)
        : null;
      if (savedDraft && chaveDoRascunho) {
        try {
          const parsed = JSON.parse(savedDraft);
          const draftFields = {
            name: parsed.name || "",
            description: parsed.description || "",
            price: parsed.price || "",
            costPrice: parsed.costPrice || "",
            originalPrice: parsed.originalPrice || "",
            stock: parsed.stock || "",
            estoqueMinimo: parsed.estoqueMinimo || "",
            category: parsed.category || "",
            images: soFotosReais(parsed.images),
            freeShipping: !!parsed.freeShipping,
            isBestseller: !!parsed.isBestseller,
            isActive: parsed.isActive !== false,
            metaTitle: parsed.metaTitle || "",
            metaDescription: parsed.metaDescription || "",
            sku: parsed.sku || "",
            codigoBarras: parsed.codigoBarras || "",
            variants: parsed.variants || [],
            weightKg: parsed.weightKg || "",
            widthCm: parsed.widthCm || "",
            heightCm: parsed.heightCm || "",
            lengthCm: parsed.lengthCm || "",
          };
          setFormData(draftFields);
          setInitialData(draftFields);
          rascunhoRecuperadoRef.current = chaveDoRascunho;
          if (draftFields.category)
            setCategoriaDoRascunho(draftFields.category);
          setIsPromoActive(!!parsed.originalPrice);
          if (draftFields.variants.length > 0) {
            setChaveDasVariacoes((chave) => chave + 1);
          }

          toast.success("Rascunho recuperado automaticamente!", {
            description:
              "Você pode continuar editando o produto de onde parou.",
            action: {
              label: "Descartar",
              onClick: () => {
                rascunhoRecuperadoRef.current = null;
                localStorage.removeItem(chaveDoRascunho);
                const emptyFields = {
                  name: "",
                  description: "",
                  price: "",
                  costPrice: "",
                  originalPrice: "",
                  stock: "",
                  estoqueMinimo: "",
                  category: "",
                  images: [] as string[],
                  freeShipping: false,
                  isBestseller: false,
                  isActive: true,
                  metaTitle: "",
                  metaDescription: "",
                  sku: "",
                  codigoBarras: "",
                  variants: [] as ProductVariant[],
                  weightKg: "",
                  widthCm: "",
                  heightCm: "",
                  lengthCm: "",
                };
                setFormData(emptyFields);
                setInitialData(emptyFields);
                setIsPromoActive(false);
                toast.info("Rascunho descartado.");
              },
            },
            duration: 6000,
          });
        } catch (e) {
          console.error("[AdminProductFormView] Failed to parse draft:", e);
        }
      }
      setDraftChecked(true);
    }
  }, [productId, userId]);

  // Draft recovery on mount for existing products
  useEffect(() => {
    if (productId && !isLoading) {
      const draftKey = chaveDoRascunhoDoProduto(userId, productId);
      // Rascunho com mais de 7 dias já sai daqui descartado (vira `null`).
      const savedDraft = draftKey
        ? lerRascunhoVigenteDoProduto(draftKey)
        : null;
      if (savedDraft && draftKey) {
        try {
          // O que ela não editou fica como está no banco de hoje (ver
          // `rascunhoSobreOBancoDeHoje`): restaurar não desfaz o que outra
          // pessoa mudou depois.
          const { campos: parsed, bancoMudou } = rascunhoSobreOBancoDeHoje(
            JSON.parse(savedDraft),
            initialData,
          );

          // ESTOQUE NÃO SE RESTAURA. O número de estoque (do produto e de cada
          // variação) que o rascunho guardou ficou velho no dia em que uma
          // venda o descontou no banco; restaurá-lo e salvar devolvia a peça
          // vendida à prateleira. O estoque vem sempre de `initialData` (o
          // banco de hoje); o resto do rascunho volta. Variação NOVA (`temp-…`)
          // mantém o que foi digitado — não há estoque de banco para ela.
          const estoqueDoRascunhoDiferia = estoqueDoRascunhoDifereDoBanco(
            parsed,
            initialData,
          );

          // Only prompt if the draft actually contains modified data compared to DB (initialData)
          const draftFields = {
            name: parsed.name ?? initialData.name,
            description: parsed.description ?? initialData.description,
            price: parsed.price ?? initialData.price,
            costPrice: parsed.costPrice ?? initialData.costPrice,
            originalPrice: parsed.originalPrice ?? initialData.originalPrice,
            stock: initialData.stock,
            estoqueMinimo: parsed.estoqueMinimo ?? initialData.estoqueMinimo,
            category: parsed.category ?? initialData.category,
            images: soFotosReais(parsed.images ?? initialData.images),
            freeShipping:
              parsed.freeShipping !== undefined
                ? !!parsed.freeShipping
                : initialData.freeShipping,
            isBestseller:
              parsed.isBestseller !== undefined
                ? !!parsed.isBestseller
                : initialData.isBestseller,
            isActive:
              parsed.isActive !== undefined
                ? !!parsed.isActive
                : initialData.isActive,
            metaTitle: parsed.metaTitle ?? initialData.metaTitle,
            metaDescription:
              parsed.metaDescription ?? initialData.metaDescription,
            sku: parsed.sku ?? initialData.sku,
            codigoBarras: parsed.codigoBarras ?? initialData.codigoBarras,
            variants: Array.isArray(parsed.variants)
              ? variacoesDoRascunhoComEstoqueDoBanco(
                  parsed.variants,
                  initialData.variants,
                )
              : initialData.variants,
            weightKg: parsed.weightKg ?? initialData.weightKg,
            widthCm: parsed.widthCm ?? initialData.widthCm,
            heightCm: parsed.heightCm ?? initialData.heightCm,
            lengthCm: parsed.lengthCm ?? initialData.lengthCm,
          };

          const isDraftDifferent = isProductFormDirty(draftFields, initialData);

          if (isDraftDifferent) {
            // Grade que só existe neste rascunho (o produto foi criado e as
            // variações não gravaram): o aviso fica até ela decidir.
            const pendente = parsed.variacoesPendentes === true;
            const restaurar = () => {
              setVariacoesPendentes(false);
              restaurarPendenteRef.current = null;
              setFormData(draftFields);
              // A categoria que o rascunho trouxe e o produto já não tem: confere.
              if (
                draftFields.category &&
                !mesmaCategoria(draftFields.category, initialData.category)
              ) {
                setCategoriaDoRascunho(draftFields.category);
              }
              setIsPromoActive(!!draftFields.originalPrice);
              if (draftFields.variants.length > 0) {
                setChaveDasVariacoes((chave) => chave + 1);
              }
              toast.success(
                "Rascunho restaurado!",
                estoqueDoRascunhoDiferia
                  ? { description: AVISO_ESTOQUE_NAO_RESTAURADO }
                  : undefined,
              );
            };
            setVariacoesPendentes(pendente);
            gradeDoRascunhoPendenteRef.current = pendente;
            restaurarPendenteRef.current = pendente ? restaurar : null;
            toast.info("Rascunho não salvo encontrado para este produto", {
              description: `Deseja restaurar as alterações que você fez anteriormente?${
                estoqueDoRascunhoDiferia
                  ? ` ${AVISO_ESTOQUE_NAO_RESTAURADO}`
                  : ""
              }${bancoMudou ? ` ${AVISO_PRODUTO_ALTERADO_DEPOIS}` : ""}`,
              action: { label: "Restaurar", onClick: restaurar },
              cancel: {
                label: "Descartar",
                onClick: () => {
                  setVariacoesPendentes(false);
                  gradeDoRascunhoPendenteRef.current = false;
                  restaurarPendenteRef.current = null;
                  localStorage.removeItem(draftKey);
                  toast.info("Rascunho descartado.");
                },
              },
              duration: pendente ? Number.POSITIVE_INFINITY : 10000,
              ...(pendente ? { id: ID_DO_AVISO_DA_GRADE_PENDENTE } : {}),
            });
          } else {
            // Draft matches database state, clean it up
            setVariacoesPendentes(false);
            gradeDoRascunhoPendenteRef.current = false;
            localStorage.removeItem(draftKey);
          }
        } catch (e) {
          console.error(
            "[AdminProductFormView] Failed to parse edit draft:",
            e,
          );
        }
      }
      setDraftChecked(true);
    }
  }, [productId, isLoading, initialData, userId]);

  // O aviso que não some sozinho (grade pendente) não sobrevive à tela.
  useEffect(
    () => () => {
      if (restaurarPendenteRef.current) {
        toast.dismiss(ID_DO_AVISO_DA_GRADE_PENDENTE);
      }
    },
    [],
  );

  // Prevent leaving with unsaved changes
  useEffect(() => {
    if (!onSetDirty) return;
    const isDirty = isProductFormDirty(formData, initialData);
    onSetDirty(isDirty);
    return () => {
      onSetDirty(false);
    };
  }, [formData, initialData, onSetDirty]);

  useEffect(() => {
    // Validar SKU
    if (formData.sku) {
      const hasSpecialChars = /[^A-Z0-9-]/i.test(formData.sku);
      if (hasSpecialChars) {
        setSkuError(
          "O código interno deve conter apenas letras, números e hífens.",
        );
      } else {
        setSkuError("");
      }
    } else {
      setSkuError("");
    }
  }, [formData.sku]);

  useEffect(() => {
    // C5.2: formato do código de barras do PRODUTO e duplicidade DENTRO da
    // tela (o próprio código contra o de cada variação, e as variações
    // entre si) — sem rede. A duplicidade contra o CATÁLOGO inteiro mora em
    // `conferirCodigoNoBanco` (chamada no blur), que escreve em
    // `codigoBarrasErroRede`, um estado À PARTE: se estivesse aqui,
    // qualquer mudança em `formData.variants` (editar o estoque de uma
    // variação, por exemplo) apagaria sozinha o aviso "já está em outro
    // produto" que o blur tinha acabado de achar.
    const normalizado = normalizarCodigoBarras(formData.codigoBarras);
    if (normalizado && !REGEX_CODIGO_BARRAS.test(normalizado)) {
      setCodigoBarrasErroLocal(MSG_CODIGO_BARRAS_FORMATO_INVALIDO);
      return;
    }
    const vistos = new Set<string>();
    if (normalizado) vistos.add(normalizado);
    let duplicadoNaTela = false;
    for (const variante of formData.variants) {
      const codigoVariante = normalizarCodigoBarras(
        variante.codigoBarras || "",
      );
      if (!codigoVariante) continue;
      if (vistos.has(codigoVariante)) {
        duplicadoNaTela = true;
        break;
      }
      vistos.add(codigoVariante);
    }
    setCodigoBarrasErroLocal(
      duplicadoNaTela ? MSG_CODIGO_BARRAS_DUPLICADO_NA_TELA : "",
    );
  }, [formData.codigoBarras, formData.variants]);

  useEffect(() => {
    // O código do produto mudou: o veredito de rede anterior (achado no
    // blur de ANTES) ficou velho. Só um blur novo decide de novo — ver
    // `conferirCodigoNoBanco`.
    setCodigoBarrasErroRede("");
    setCodigoBarrasAvisoRede("");
  }, [formData.codigoBarras]);

  useEffect(() => {
    // Mesmo formato acima, para o código de barras da VARIANTE em edição no
    // modal. A duplicidade dela contra o produto e as outras variações só
    // aparece depois de "Efetivar Variante" (quando ela entra em
    // `formData.variants` e o efeito de cima recalcula) — este efeito cobre
    // só o formato, e o mesmo estado é reaproveitado por
    // `conferirCodigoNoBanco` para o achado de rede (alvo "variacao").
    const normalizado = normalizarCodigoBarras(variantFormData.codigoBarras);
    setVariantCodigoBarrasError(
      normalizado && !REGEX_CODIGO_BARRAS.test(normalizado)
        ? MSG_CODIGO_BARRAS_FORMATO_INVALIDO
        : "",
    );
    setVariantCodigoBarrasAvisoRede("");
  }, [variantFormData.codigoBarras]);

  // C5.2: duplicidade pelo CATÁLOGO inteiro, pela MESMA RPC que o PDV usa
  // para bipar no balcão (AdminPdvView.tsx:170-179) — chamada ao sair do
  // campo (blur) e, mais tarde (C5.3), depois de uma leitura pela câmera.
  // Import DINÂMICO de propósito: esta view não tinha outro motivo para
  // carregar o cliente Supabase (os hooks de dados fazem isso por trás), e
  // um import ESTÁTICO aqui derrubaria os sete testes desta tela que não
  // mockam "@/lib/supabase" — o módulo real lança sem as variáveis de
  // ambiente do Supabase (`src/lib/env.ts`), medido nesta tarefa.
  // Devolve "" quando o código está livre (ou é o próprio registro conferido,
  // ou a rede falhou — nada que bloqueie) e a MENSAGEM de duplicado quando a
  // RPC o encontra em outro produto/variação. Escreve nos estados de erro
  // para o blur continuar tendo o mesmo efeito de sempre; o retorno é quem
  // permite ao handleSubmit ESPERAR o veredito antes de gravar (ressalva da
  // revisão: sem isso, salvar durante uma checagem em voo gravava antes da
  // resposta). `idDaVariacao` é o id do registro conferido quando o alvo é
  // variação: no modal, `editingVariant?.id`; no salvar, o id de cada
  // variação do formulário.
  async function conferirCodigoNoBanco(
    codigoNormalizado: string,
    alvo: "produto" | "variacao",
    idDaVariacao?: string,
    prazoMs?: number,
  ): Promise<string> {
    const setErroDeRede =
      alvo === "produto"
        ? setCodigoBarrasErroRede
        : setVariantCodigoBarrasError;
    const setAviso =
      alvo === "produto"
        ? setCodigoBarrasAvisoRede
        : setVariantCodigoBarrasAvisoRede;

    setAviso("");
    if (!codigoNormalizado) {
      setErroDeRede("");
      return "";
    }

    try {
      const { supabase } = await clienteDoBanco();
      const consulta = supabase.rpc("buscar_por_codigo_barras", {
        p_codigo: codigoNormalizado,
      });
      // Com prazo, estourar cai no `catch` abaixo, igual a uma rede que falhou.
      const { data, error } = prazoMs
        ? await comPrazo(Promise.resolve(consulta), prazoMs)
        : await consulta;
      if (error) throw error;
      const resposta = data as unknown as RespostaDoCodigo;

      if (!resposta.encontrado || !resposta.produto) {
        setErroDeRede("");
        return "";
      }

      // O próprio produto/variação conferido nunca conta como duplicado —
      // mas só na direção certa: um código que já é o do PRODUTO não deixa
      // de ser duplicado só porque estamos conferindo o campo da VARIAÇÃO
      // (e vice-versa). Ver pdv-c5.json, decisão (c).
      // A variação que ela acabou de apagar nesta tela ainda existe no banco
      // até o salvar. No campo de uma VARIAÇÃO ela não conta como dona do código
      // (o salvar a apaga antes de gravar as variações). No campo do PRODUTO
      // conta: a função de salvar grava o produto ANTES de apagar variações, e o
      // gatilho do banco recusa um código de produto que ainda é de variação.
      if (
        alvo === "variacao" &&
        resposta.origem === "variante" &&
        deletedVariantIds.includes(resposta.variante?.variant_id ?? "")
      ) {
        setErroDeRede("");
        return "";
      }

      const idDoProprio = alvo === "produto" ? productId : idDaVariacao;
      const ehOProprio =
        alvo === "produto"
          ? resposta.origem === "produto" &&
            !!idDoProprio &&
            resposta.produto.id === idDoProprio
          : resposta.origem === "variante" &&
            idDoProprio != null &&
            resposta.variante?.variant_id === idDoProprio;

      if (ehOProprio) {
        setErroDeRede("");
        return "";
      }

      let mensagem = `Este código já está em ${resposta.produto.nome}`;
      if (resposta.origem === "variante" && resposta.variante) {
        mensagem += `, variação ${resposta.variante.nome}: ${resposta.variante.valor}`;
      }
      setErroDeRede(mensagem);
      return mensagem;
    } catch (erro) {
      // Rede/RPC fora do ar: NÃO há veredito, então NÃO bloqueia — o índice
      // único do banco só cobre a COLISÃO na hora de gravar (23505 vira
      // mensagem amigável pela C5.1), não esta checagem em voo; quem fecha a
      // corrida com o salvar é o await no início do handleSubmit. Só avisa,
      // discreto, para o lojista tentar de novo.
      console.warn(
        "[AdminProductFormView] Não consegui conferir o código de barras agora:",
        erro,
      );
      setAviso("Não consegui conferir agora.");
      return "";
    }
  }

  function aoSairDoCampoDeCodigoDeBarras(
    valorBruto: string,
    alvo: "produto" | "variacao",
    idDaVariacao?: string,
  ): void {
    const normalizado = normalizarCodigoBarras(valorBruto);
    // Formato inválido já tem o próprio erro (efeito acima); chamar a RPC
    // aqui só teria a resposta assíncrona chegando depois e sobrescrevendo
    // esse erro local, sem nenhuma corrida clara para decidir quem venceu.
    if (!normalizado || !REGEX_CODIGO_BARRAS.test(normalizado)) return;
    void conferirCodigoNoBanco(normalizado, alvo, idDaVariacao);
  }

  // C5.3 — a câmera achou um código: preenche o campo do alvo certo (o
  // produto ou a variação em edição no modal), fecha o leitor e dispara a
  // MESMA checagem de duplicidade do onBlur (C5.2) — uma leitura é, para
  // este formulário, equivalente a digitar o código e sair do campo.
  function aoLerCodigoDeBarras(leitura: { codigo: string }): void {
    const normalizado = normalizarCodigoBarras(leitura.codigo);
    if (leitorAberto === "produto") {
      setFormData((prev) => ({ ...prev, codigoBarras: normalizado }));
    } else if (leitorAberto === "variacao") {
      setVariantFormData((prev) => ({ ...prev, codigoBarras: normalizado }));
    }
    const alvo = leitorAberto ?? "produto";
    setLeitorAberto(null);
    aoSairDoCampoDeCodigoDeBarras(
      normalizado,
      alvo,
      alvo === "variacao" ? editingVariant?.id : undefined,
    );
  }

  useEffect(() => {
    // Validar Preço de Venda
    const price = Number.parseFloat(formData.price);
    if (formData.price && (Number.isNaN(price) || price <= 0)) {
      setPriceError("Preço de venda deve ser maior que zero.");
    } else {
      setPriceError("");
    }
  }, [formData.price]);

  useEffect(() => {
    // Validar Preço de Custo
    const price = Number.parseFloat(formData.price) || 0;
    const cost = Number.parseFloat(formData.costPrice);
    if (formData.costPrice && !Number.isNaN(cost)) {
      if (cost < 0) {
        setCostError("Preço de custo não pode ser negativo.");
      } else if (price > 0 && cost >= price) {
        setCostError(
          "Aviso: Preço de custo é maior ou igual ao preço de venda (prejuízo!).",
        );
      } else {
        setCostError("");
      }
    } else {
      setCostError("");
    }
  }, [formData.costPrice, formData.price]);

  useEffect(() => {
    // Validar Preço Original (De:)
    const price = Number.parseFloat(formData.price) || 0;
    const orig = Number.parseFloat(formData.originalPrice);
    if (isPromoActive && formData.originalPrice && !Number.isNaN(orig)) {
      if (orig <= price) {
        setOriginalPriceError(
          'Preço de antes ("De") deve ser maior que o preço de venda.',
        );
      } else {
        setOriginalPriceError("");
      }
    } else {
      setOriginalPriceError("");
    }
  }, [formData.originalPrice, formData.price, isPromoActive]);

  useEffect(() => {
    // Validar Estoque
    const stock = Number(formData.stock);
    if (
      formData.stock &&
      (!/^\d+$/.test(formData.stock) ||
        !Number.isSafeInteger(stock) ||
        stock < 0)
    ) {
      setStockError("O estoque deve ser maior ou igual a zero.");
    } else if (
      stock > ESTOQUE_MAXIMO_DO_PRODUTO &&
      (!productId || estoqueDoProdutoFoiMexido(formData, initialData))
    ) {
      // O mesmo teto do salvar. Produto que já está acima dele e cujo estoque
      // ela não mexeu segue editável: só o estoque NOVO esbarra no teto.
      setStockError(
        "O estoque total não pode passar de 10.000 unidades. Reduza o estoque do produto ou das variações.",
      );
    } else {
      setStockError("");
    }
  }, [formData, initialData, productId]);

  // Sync stock dynamically if there are active variants
  useEffect(() => {
    const activeVariants = formData.variants.filter((v) => v.active);
    if (activeVariants.length > 0) {
      const sum = activeVariants.reduce(
        (acc, v) => acc + (v.stockIncrement || 0),
        0,
      );
      if (formData.stock !== sum.toString()) {
        setFormData((prev) => ({ ...prev, stock: sum.toString() }));
      }
    }
  }, [formData.variants, formData.stock]);

  // Draft auto-save on changes
  //
  // #98 (ADMIN-060): este efeito NÃO remove o rascunho que já estava lá ao
  // abrir — só o que ELE mesmo gravou (`gravouRascunhoRef`), quando o formulário
  // volta a ser igual ao banco. Antes do conserto, o
  // `else` chamava `localStorage.removeItem(draftKey)` sempre que
  // formData === initialData — que é EXATAMENTE o estado em que o formulário
  // nasce ao abrir um produto para edição (os dois vêm do mesmo `product`
  // carregado). Resultado: 1s depois de abrir a tela, o rascunho pendente
  // era apagado sozinho, enquanto o toast de recuperação ainda prometia 10s
  // para restaurar. Remoção só acontece por decisão explícita do usuário —
  // Restaurar ou Descartar, no efeito de verificação acima.
  //
  // #99 (revisão): uma versão anterior deste efeito também parava de SALVAR
  // enquanto o toast de rascunho pendente estivesse aberto (guarda
  // `draftResolvedRef.current`). O toast tem `duration: 10000` e nenhum
  // `onAutoClose`/`onDismiss` — se o admin não clicasse em Restaurar/
  // Descartar, a flag ficava presa em `false` pelo resto da sessão de edição
  // e o auto-save morria: as próximas edições nunca eram gravadas. Isso
  // trocava a perda de trabalho da #98 (rascunho velho apagado) por outra
  // (edições novas nunca salvas), no mesmo caminho.
  //
  // A guarda foi removida porque não defendia nada que já não estivesse
  // defendido: o botão "Restaurar" aplica `draftFields`, uma variável
  // capturada no closure do toast, não uma releitura do `localStorage` — o
  // auto-save pode sobrescrever a chave enquanto o toast está aberto sem
  // quebrar o Restaurar.
  useEffect(() => {
    if (isLoading || !draftChecked) return;

    const timer = setTimeout(() => {
      // Produto novo já criado (grade não gravou): o rascunho já foi para a
      // chave de edição dele, e esta chave NÃO pode ser recriada.
      if (!productId && produtoNovoJaCriadoRef.current) return;
      // Formulário com id provisório já gravado: um rascunho dele restauraria
      // a variação em dobro.
      if (precisaRecarregar) return;
      // Salvar em andamento: o formulário ainda não é o que vai ficar (pode
      // ser trocado pela releitura do banco), então nada dele vira rascunho.
      if (isSubmitting) return;
      // A grade que não gravou só existe no rascunho: não troca por outro.
      if (variacoesPendentes) return;
      const isDirty = isProductFormDirty(formData, initialData);
      const draftKey = chaveDoRascunhoDoProduto(userId, productId);
      if (isDirty && draftKey) {
        // Com o carimbo de quando foi guardado: o rascunho vence em 7 dias. Na
        // edição, com o produto-base: restaurar depois só usa o que ela editou.
        const gradePendente =
          gradeDoRascunhoPendenteRef.current &&
          formData.variants.some((v) => v.id.startsWith("temp-"));
        localStorage.setItem(
          draftKey,
          serializarRascunhoDoProduto({
            ...formData,
            ...(productId ? { baseDoRascunho: initialData } : {}),
            ...(gradePendente ? { variacoesPendentes: true } : {}),
          }),
        );
        gravouRascunhoRef.current = draftKey;
      } else if (draftKey && gravouRascunhoRef.current === draftKey) {
        // Voltou a ser igual ao banco: o rascunho que ESTA abertura gravou não
        // tem mais o que oferecer.
        gravouRascunhoRef.current = null;
        if (
          rascunhoRecuperadoRef.current === draftKey &&
          localStorage.getItem(draftKey) !== null
        ) {
          // ...exceto o recuperado que ainda não foi salvo nem descartado
          // (salvar e Descartar já apagaram a chave: aí não há o que guardar).
          localStorage.setItem(
            draftKey,
            serializarRascunhoDoProduto({ ...formData }),
          );
        } else {
          localStorage.removeItem(draftKey);
        }
      }
    }, 1000);

    return () => clearTimeout(timer);
  }, [
    formData,
    initialData,
    productId,
    isLoading,
    draftChecked,
    userId,
    precisaRecarregar,
    isSubmitting,
    variacoesPendentes,
  ]);

  const processAndUploadImages = useCallback(
    async (arquivos: File[]) => {
      let files = arquivos;
      if (files.length === 0) return;

      // O tamanho conta por foto ORIGINAL; o total não, porque cada uma é
      // reduzida antes de subir. A quantidade entra até o máximo de 10.
      const legiveis = files.filter((file) => {
        const recusa = recusaDeFoto(file);
        if (recusa) toast.error(recusa);
        return !recusa;
      });
      const vagas = Math.max(0, 10 - formData.images.length);
      if (legiveis.length > vagas) {
        toast.error(
          vagas === 0
            ? "Limite de imagens atingido: o produto já tem 10 fotos. Remova uma para adicionar outra."
            : `${legiveis.length - vagas} ${legiveis.length - vagas === 1 ? "foto ficou" : "fotos ficaram"} de fora: o máximo é 10 fotos por produto.`,
        );
      }
      files = legiveis.slice(0, vagas);
      if (files.length === 0) return;

      setIsUploadingImages(true);
      setImageUploadStep("compressing");
      setProgressoDoEnvio({ atual: 1, total: files.length });
      const loadingToast = toast.loading(
        `Comprimindo ${files.length} ${files.length === 1 ? "imagem" : "imagens"}...`,
      );
      const falhas: FotoComFalha[] = [];
      let enviadas = 0;
      const fim = marcarOperacaoSensivel("upload-de-foto-do-produto");
      try {
        // Uma foto por vez, cada uma com o próprio prazo: a que trava não
        // arrasta as outras, e a lojista vê "N de M" andar.
        for (const [indice, file] of files.entries()) {
          setProgressoDoEnvio({ atual: indice + 1, total: files.length });
          setImageUploadStep("compressing");
          // Marca o estouro para a continuação ATRASADA não iniciar o upload
          // de uma foto que a tela já deu por falha (evita arquivo órfão no
          // armazenamento e um estado "uploading" depois do fim).
          let estourou = false;
          try {
            const url = await comPrazo(
              (async () => {
                const comprimida = await compressProductImage(file);
                if (estourou) throw new PrazoEsgotado(PRAZO_POR_FOTO_MS);
                setImageUploadStep("uploading");
                toast.loading(
                  `Enviando foto ${indice + 1} de ${files.length}...`,
                  { id: loadingToast },
                );
                const urls = await uploadProductImages([comprimida]);
                if (!urls || urls.length === 0) {
                  throw new Error("Falha no upload.");
                }
                return urls[0];
              })(),
              PRAZO_POR_FOTO_MS,
              () => {
                estourou = true;
              },
              // O upload (que ninguém cancela) terminou depois de a tela dar a
              // foto por falha: apaga o objeto que ELE gravou.
              (urlTardia) => {
                void descartarFotosDoProduto([urlTardia]);
              },
            );
            setFormData((prev) => ({
              ...prev,
              images: [...prev.images, url],
            }));
            enviadas += 1;
          } catch (error) {
            console.error("[Upload] Process error:", error, file.name);
            if (error instanceof FotoIlegivel) {
              toast.error(
                `Não conseguimos abrir a foto "${file.name}". Salve como JPG ou PNG e tente de novo.`,
              );
              continue;
            }
            falhas.push({
              id: `${Date.now()}-${indice}-${file.name}`,
              file,
              motivo:
                error instanceof PrazoEsgotado
                  ? "demorou demais"
                  : "não foi enviada",
            });
          }
        }

        if (falhas.length === 0) {
          toast.success("Imagens processadas e enviadas com sucesso!", {
            id: loadingToast,
          });
        } else {
          setFotosComFalha((prev) => [...prev, ...falhas]);
          toast.error(
            enviadas > 0
              ? `${falhas.length} de ${files.length} fotos não subiram.`
              : "Erro ao processar ou enviar imagens.",
            {
              id: loadingToast,
              description:
                "Veja o aviso abaixo das fotos: dá para tentar de novo, remover, ou publicar sem elas.",
            },
          );
        }
      } finally {
        fim();
        // Sempre volta ao normal -- é isto que garante que o botão nunca
        // fica preso por um envio que acabou (ou estourou).
        setIsUploadingImages(false);
        setImageUploadStep("idle");
        setProgressoDoEnvio(null);
      }
    },
    [formData.images.length, uploadProductImages],
  );

  const tentarFotoDeNovo = useCallback(
    async (id: string) => {
      const falha = fotosComFalha.find((f) => f.id === id);
      if (!falha || isOffline) return;
      if (formData.images.length >= 10) {
        // Mesma regra do envio: não some com a foto da lista sem ela caber.
        toast.error(
          "O produto já tem 10 fotos. Remova uma foto antes de tentar de novo.",
        );
        return;
      }
      setFotosComFalha((prev) => prev.filter((f) => f.id !== id));
      await processAndUploadImages([falha.file]);
    },
    [fotosComFalha, isOffline, formData.images.length, processAndUploadImages],
  );

  const descartarFotoComFalha = useCallback((id: string) => {
    setFotosComFalha((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const handleImageUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      // Lê os arquivos ANTES de esvaziar o campo, e esvazia sempre: se o campo
      // guarda a escolha, escolher o MESMO arquivo de novo (apagou a foto e
      // quer reenviar) não dispara `change` no Chrome e nada acontece.
      const input = e.currentTarget;
      const files = Array.from(input.files || []);
      input.value = "";
      if (isOffline) {
        toast.error("Não é possível enviar imagens em modo offline.");
        return;
      }
      await processAndUploadImages(files);
    },
    [processAndUploadImages, isOffline],
  );

  // Depois de excluir ou de "Tornar principal" o botão tocado é desmontado (a
  // ação é de outra foto agora): o foco vai para a primeira ação da foto em
  // foco, em vez de cair no <body> e fazer quem usa teclado ou leitor de tela
  // perder o lugar.
  const focarNasAcoesRef = useRef(false);

  // Pela foto, não pela posição: no 2º toque rápido o cartão que está saindo
  // ainda existe na tela, e a posição dele já é de outra foto.
  const removeImage = useCallback((imagem: string) => {
    focarNasAcoesRef.current = true;
    setFormData((prev) => ({
      ...prev,
      images: prev.images.filter((u) => u !== imagem),
    }));
  }, []);

  // `images[0]` é a foto do cartão da vitrine (e vira `imagem_url` ao salvar),
  // então "principal" é só "primeira do array". A foto sai do lugar e vai para
  // o começo; as outras mantêm a ordem entre si. Nada é reenviado: as URLs são
  // as mesmas, só a ordem muda.
  //
  // A foto EM FOCO (a grande, com as ações dela) é guardada pela URL, não pela
  // posição: "Tornar principal" move a foto para o começo e ela continua em
  // foco sozinha. Se a foto em foco sai da lista (excluída), o foco fica na
  // mesma posição — a seguinte, ou a anterior quando era a última.
  const fotoEmFocoRef = useRef<HTMLDivElement>(null);
  const faixaDeFotosRef = useRef<HTMLDivElement>(null);
  const travaDasAcoesAteRef = useRef(0);
  // Chamada no começo de cada ação da foto em foco: `false` = ainda travada
  // pelo toque anterior, ignore. `travar` liga a trava (ações que mudam a
  // lista de fotos).
  const acaoDeFotoLiberada = (travar: boolean) => {
    const agora = Date.now();
    if (agora < travaDasAcoesAteRef.current) return false;
    if (travar)
      travaDasAcoesAteRef.current = agora + TRAVA_DAS_ACOES_DE_FOTO_MS;
    return true;
  };
  const [urlEmFoco, setUrlEmFoco] = useState<string | null>(null);
  const indiceAnteriorDoFocoRef = useRef(0);
  const achadoDoFoco = urlEmFoco ? formData.images.indexOf(urlEmFoco) : 0;
  const indiceEmFoco =
    formData.images.length === 0
      ? 0
      : achadoDoFoco >= 0
        ? achadoDoFoco
        : Math.min(indiceAnteriorDoFocoRef.current, formData.images.length - 1);
  useEffect(() => {
    indiceAnteriorDoFocoRef.current = indiceEmFoco;
    if (formData.images.length === 0) {
      if (urlEmFoco !== null) setUrlEmFoco(null);
    } else if (achadoDoFoco < 0) {
      setUrlEmFoco(formData.images.at(indiceEmFoco) ?? null);
    }
  }, [indiceEmFoco, achadoDoFoco, formData.images, urlEmFoco]);

  // A faixa de miniaturas só rola de lado quando as fotos não cabem: a frase
  // "Deslize para o lado" só aparece nesse caso (antes aparecia com 3 fotos,
  // mesmo quando todas cabiam).
  const [faixaRola, setFaixaRola] = useState(false);
  useEffect(() => {
    const faixa = faixaDeFotosRef.current;
    if (!faixa || formData.images.length === 0) {
      setFaixaRola(false);
      return;
    }
    const medir = () => setFaixaRola(faixa.scrollWidth > faixa.clientWidth + 1);
    medir();
    if (typeof ResizeObserver === "undefined") return;
    const observador = new ResizeObserver(medir);
    observador.observe(faixa);
    return () => observador.disconnect();
  }, [formData.images.length, isUploadingImages]);

  const tornarPrincipal = useCallback((index: number) => {
    if (index <= 0) return;
    focarNasAcoesRef.current = true;
    setFormData((prev) => {
      const [escolhida] = prev.images.slice(index, index + 1);
      if (!escolhida) return prev;
      return {
        ...prev,
        images: [escolhida, ...prev.images.filter((_, i) => i !== index)],
      };
    });
    toast.success(`Foto ${index + 1} agora é a principal.`);
  }, []);
  useEffect(() => {
    // Roda quando a lista muda (`formData.images`); só age se foi "Excluir" ou
    // "Tornar principal" quem mudou.
    if (!focarNasAcoesRef.current) return;
    focarNasAcoesRef.current = false;
    fotoEmFocoRef.current?.querySelector<HTMLElement>("button")?.focus();
  }, [formData.images]);

  const atualizarParDeAtributo = (
    indice: number,
    campo: "name" | "value",
    valor: string,
  ) => {
    setVariantFormData((p) => ({
      ...p,
      pares: p.pares.map((par, i) =>
        i === indice ? { ...par, [campo]: valor } : par,
      ),
    }));
  };

  // O − e o + do estoque da variação. O que não é número inteiro (o lojista
  // digitou "1,5" ou apagou) conta como 0 antes de somar, e o − para em 0.
  const somarEstoqueDaVariacao = (passo: 1 | -1) => {
    setVariantFormData((p) => {
      const texto = p.stockIncrement.trim();
      const atual = /^\d+$/.test(texto) ? Number(texto) : 0;
      return { ...p, stockIncrement: String(Math.max(0, atual + passo)) };
    });
  };

  const handleVariantSubmit = () => {
    const erroDosPares = validarAtributos(variantFormData.pares);
    if (erroDosPares) {
      toast.error(erroDosPares);
      return;
    }

    // A combinação inteira vira UMA linha: "Cor"+"Branca" com "Tamanho"+"PP"
    // grava name="Cor / Tamanho", value="Branca / PP", com o estoque deste
    // formulário — a branca PP tem o estoque DELA. Um par só sai cru, igual
    // ao caso simples de hoje. Ver `variante-composta.ts`.
    // Produto que já grava "Cor / Tamanho": montar Tamanho e depois Cor grava
    // na ordem antiga (a trava abaixo compara o nome inteiro e NÃO muda).
    const gruposDasOutras = gruposDeVariacao(
      formData.variants.filter((v) => v.id !== editingVariant?.id),
    );
    const { name: nomeComposto, value: valorComposto } = juntarAtributos(
      alinharPelaOrdemGravada(
        variantFormData.pares,
        gruposDasOutras.length === 1 ? gruposDasOutras[0] : undefined,
      ),
    );

    // Um grupo por produto. Com dois, o estoque passa a ser somado em dobro, o
    // carrinho funde combinacoes diferentes numa linha so e o pedido guarda
    // metade da escolha -- quem compra um P e um M recebe dois P. O porque
    // inteiro, medido, esta em `src/utils/um-grupo-de-variacao.ts`. A variante
    // composta respeita a trava de casa: todas as linhas compostas do produto
    // compartilham o mesmo `name`, logo um grupo so.
    const trava = travaDeUmGrupoSo(
      formData.variants,
      editingVariant?.id ?? null,
      nomeComposto,
    );
    if (trava.bloqueia) {
      toast.error(`Este produto já usa "${trava.grupoEmUso}"`, {
        description: trava.grupoEmUso.includes(SEPARADOR_DE_ATRIBUTOS)
          ? `Cada produto aceita um conjunto de atributos só. Para criar outra opção, use os mesmos atributos das que já existem (${trava.grupoEmUso}).`
          : "Cada produto aceita um tipo de variação só. Para vender cor e " +
            "tamanho juntos, crie as opções combinadas dentro do mesmo tipo " +
            '(ex: "Rosa P", "Rosa M") — assim o estoque e o pedido saem certos.',
        duration: 10000,
      });
      return;
    }

    // A mesma combinação não entra duas vezes (o estoque da peça dobraria na
    // lista): mesma chave que a grade usa. Trocar a própria variação sem mudar
    // a combinação nunca é repetição — nem num produto que já veio repetido.
    const identidadeNova = { name: nomeComposto, value: valorComposto };
    const combinacaoMudou =
      !editingVariant ||
      chaveDaIdentidade(editingVariant) !== chaveDaIdentidade(identidadeNova);
    if (
      combinacaoMudou &&
      formData.variants.some(
        (v) =>
          v.id !== editingVariant?.id &&
          chaveDaIdentidade(v) === chaveDaIdentidade(identidadeNova),
      )
    ) {
      toast.error("Essa combinação já existe.", {
        description: "Mude o valor, ou edite a variação que já está na lista.",
      });
      return;
    }

    if (variantCodigoBarrasError) {
      toast.error(variantCodigoBarrasError);
      return;
    }

    const cleanNumberString = (val: string) => {
      if (!val) return "";
      let clean = val.replace(",", ".").replace(/[^\d.-]/g, "");
      const parts = clean.split(".");
      if (parts.length > 2) {
        clean = `${parts[0]}.${parts.slice(1).join("")}`;
      }
      return clean;
    };

    const sanitizedVarPrice = cleanNumberString(variantFormData.priceOverride);
    // O sinal de menos era arrancado em silêncio ("-5" virava 5, e o estoque
    // aparecia a mais). Estoque é número inteiro, zero ou mais: o que não for
    // isso avisa e não cria a variação.
    const textoDoEstoque = variantFormData.stockIncrement.trim();
    const erroDoEstoque = erroDoEstoqueDaVariacao(textoDoEstoque);
    if (erroDoEstoque) {
      toast.error(erroDoEstoque);
      return;
    }
    const sanitizedVarStock = textoDoEstoque;

    // Zero não é preço próprio (a máscara de moeda nunca esvazia: o campo
    // apagado chega como "0.00" e a loja cobraria R$ 0,00). Só a variação que
    // já estava salva com zero mantém o zero. Ver `preco-da-variacao.ts`.
    const parsedPriceOverride = precoProprioDaVariacao(
      sanitizedVarPrice,
      editingVariant?.priceOverride === 0,
    );
    const sanitizedVarSku = variantFormData.sku
      ? variantFormData.sku.trim().toUpperCase().replace(/\s+/g, "-")
      : undefined;
    const sanitizedVarCodigoBarras = variantFormData.codigoBarras
      ? normalizarCodigoBarras(variantFormData.codigoBarras)
      : undefined;

    // O SKU da variação é único na loja inteira (product_variants_sku_key):
    // dois iguais NESTE produto são recusados pelo banco na hora de gravar,
    // sem dizer qual. Aqui a lojista lê qual é, antes de perder o cadastro.
    // Compara do jeito que será gravado (`sanitizedVarSku` já é maiúsculo e
    // sem espaço; os já salvos passam pela mesma conta no envio).
    if (sanitizedVarSku) {
      const dona = formData.variants.find(
        (v) =>
          v.id !== editingVariant?.id &&
          !!v.sku &&
          v.sku.trim().toUpperCase().replace(/\s+/g, "-") === sanitizedVarSku,
      );
      if (dona) {
        toast.error(
          `O código interno "${sanitizedVarSku}" já está em outra variação deste produto (${dona.name}: ${dona.value}).`,
          {
            description:
              "Cada variação precisa de um código interno diferente — ou deixe o código interno em branco.",
            duration: 8000,
          },
        );
        return;
      }
    }

    const vData = {
      productId: productId || "",
      name: nomeComposto,
      value: valorComposto,
      sku: sanitizedVarSku || undefined,
      codigoBarras: sanitizedVarCodigoBarras || undefined,
      stockIncrement: Number.parseInt(sanitizedVarStock) || 0,
      priceOverride: parsedPriceOverride,
      active: variantFormData.active,
      imageUrl: variantFormData.imageUrl || undefined,
    };

    // A lista passa por `formComVariacoes`: desligar a última variação ligada
    // zera o estoque do produto (uma vez), em vez de deixar a soma velha no
    // campo que acaba de destravar. Ver `estoque-das-variacoes.ts`.
    if (editingVariant) {
      setFormData((prev) =>
        formComVariacoes(
          prev,
          prev.variants.map((v) =>
            v.id === editingVariant.id ? { ...v, ...vData } : v,
          ),
        ),
      );
    } else {
      setFormData((prev) =>
        formComVariacoes(prev, [
          ...prev.variants,
          {
            ...vData,
            id: `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          } as any,
        ]),
      );
    }

    setShowVariantForm(false);
    setEditingVariant(null);
    setVariantFormData({
      pares: [parNovo()],
      sku: "",
      codigoBarras: "",
      stockIncrement: "0",
      priceOverride: "",
      active: true,
      imageUrl: "",
    });
  };

  const handleDeleteVariant = useCallback((vId: string) => {
    setVariantToDelete(vId);
  }, []);

  const handleEditVariant = useCallback((v: ProductVariant) => {
    // Ressalva da revisão da C5.2: erros/avisos de código de barras da
    // edição ANTERIOR não podem atravessar para esta — se o código não
    // mudar entre uma abertura e outra, o efeito que valida não dispara e
    // o erro velho ficaria preso no modal.
    setVariantCodigoBarrasError("");
    setVariantCodigoBarrasAvisoRede("");
    setEditingVariant(v);
    setVariantFormData({
      // Reabre a linha em pares ("Cor / Tamanho"+"Branca / PP" volta a ser
      // Cor/Branca e Tamanho/PP); linha que não desmonta limpo abre como um
      // par com o texto bruto — e round-tripa idêntico. Ver
      // `dividirEmAtributos` em `variante-composta.ts`.
      pares: comChaveDeRender(dividirEmAtributos(v.name, v.value)),
      sku: v.sku || "",
      codigoBarras: v.codigoBarras || "",
      stockIncrement: v.stockIncrement.toString(),
      priceOverride: v.priceOverride?.toString() || "",
      active: v.active,
      imageUrl: v.imageUrl || "",
    });
    setShowVariantForm(true);
  }, []);

  // O Preço de Venda como texto: um rascunho restaurado pode trazer o preço
  // como número (rascunho de produto copiado do banco), e `.trim()` em número
  // derrubava a tela inteira na restauração.
  const precoDoProdutoTexto = String(formData.price ?? "");

  /**
   * Grade: as linhas que o modal entregou entram na lista como variantes
   * comuns com id `temp-` — o MESMO caminho da variante unitária. A gravação
   * em lote é o `upsertVariants` de sempre, no salvar do produto; nada de
   * caminho novo de persistência. A trava de um grupo é conferida AQUI de
   * novo (o modal já bloqueou no "Gerar") porque o estado do formulário é
   * dono deste lado da parede.
   */
  const handleEfetivarGrade = (
    linhas: LinhaProntaDaGrade[],
    precoDaGrade?: number,
  ): boolean => {
    if (linhas.length === 0) return false;

    const trava = travaDeUmGrupoSo(formData.variants, null, linhas[0].name);
    if (trava.bloqueia) {
      toast.error(`Este produto já usa "${trava.grupoEmUso}"`, {
        description:
          "Cada produto aceita um tipo de variação só. A grade precisa usar " +
          "o atributo que o produto já tem.",
        duration: 10000,
      });
      return false;
    }

    // Defesa em profundidade contra o mesmo lote entregue duas vezes: só
    // entra a combinação que a lista, NO MOMENTO de gravar o estado, ainda
    // não tem (comparada pela chave da grade, não pelo texto).
    //
    // O Preço de Venda que a grade deu ao produto entra NA MESMA atualização das
    // linhas (as iguais a ele já vêm em Auto) e só se o campo ainda estiver
    // vazio: o lote entregue de novo, ou um preço digitado no meio, nunca é
    // sobrescrito. A trava de cima já recusou antes de chegar aqui, então
    // recusa não deixa preço pela metade.
    const aplicaPrecoDaGrade =
      precoDaGrade !== undefined && precoDoProdutoTexto.trim() === "";
    setFormData((prev) => {
      const jaTem = new Set(prev.variants.map((v) => chaveDaIdentidade(v)));
      const novas = linhas.filter(
        (linha) => !jaTem.has(chaveDaIdentidade(linha)),
      );
      const comVariacoes = formComVariacoes(prev, [
        ...prev.variants,
        ...novas.map(
          (linha) =>
            ({
              ...linha,
              id: `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            }) as any,
        ),
      ]);
      return aplicaPrecoDaGrade &&
        precoDaGrade !== undefined &&
        String(prev.price ?? "").trim() === ""
        ? { ...comVariacoes, price: precoDaGrade.toFixed(2) }
        : comVariacoes;
    });
    if (aplicaPrecoDaGrade) setPrecoVeioDaGrade(true);
    setShowGradeForm(false);
    toast.success(
      linhas.length === 1
        ? "Variante da grade criada — ela entra na loja quando o produto for salvo."
        : `${linhas.length} variantes da grade criadas — elas entram na loja quando o produto for salvo.`,
    );
    return true;
  };

  // Desligar/religar na própria linha: a variação segue existindo (SKU,
  // estoque e cadastro guardados) mas some da loja enquanto estiver desligada.
  // O aviso só vem ao DESLIGAR, e diz o que acontece com quem compra. A lista
  // passa por `formComVariacoes`: desligar a última ligada zera o estoque do
  // produto (ver `estoque-das-variacoes.ts`). Nada vai para `deletedVariantIds`.
  const handleToggleVariantActive = useCallback((v: ProductVariant) => {
    setFormData((prev) =>
      formComVariacoes(
        prev,
        prev.variants.map((x) =>
          x.id === v.id ? { ...x, active: !x.active } : x,
        ),
      ),
    );
    if (v.active) {
      toast.info(
        `${v.name}: ${v.value} desligada. Ela deixa de aparecer na loja depois que você salvar o produto e volta quando você religar.`,
      );
    }
  }, []);

  const confirmDeleteVariant = () => {
    if (!variantToDelete) return;
    if (!variantToDelete.startsWith("temp-")) {
      setDeletedVariantIds((prev) => [...prev, variantToDelete]);
    }
    setFormData((prev) =>
      formComVariacoes(
        prev,
        prev.variants.filter((v) => v.id !== variantToDelete),
      ),
    );
    setVariantToDelete(null);
  };

  // Primeiro campo com erro que BLOQUEIA o salvar, na ordem em que a tela os
  // mostra (básico, com a promoção logo abaixo de preço e estoque; depois
  // "Custo e lucro", depois "Códigos e câmera"). O AVISO de
  // custo maior que o preço não entra: não bloqueia. Mesma lista do `isValid`.
  // Promoção ligada e o "De:" vazio: o salvar gravaria o produto SEM promoção
  // (preço original nulo) e diria "Salvo". Bloqueia e diz o que fazer.
  const promocaoSemPrecoOriginal =
    isPromoActive && String(formData.originalPrice ?? "").trim() === "";

  const idDoPrimeiroCampoComErro = (): string | null => {
    if (priceError) return "product-sale-price";
    if (stockError) return "product-stock";
    if (originalPriceError || promocaoSemPrecoOriginal)
      return "product-original-price";
    if (costError && !costError.startsWith("Aviso"))
      return "product-cost-price";
    if (skuError) return "product-sku";
    if (codigoBarrasError) return "product-codigo-barras";
    if (estoqueMinimoError) return "product-estoque-minimo";
    return null;
  };

  // Para onde a frase "falta preencher" e o Publicar cinza levam: o primeiro
  // obrigatório vazio, na ordem da tela; sem vazio, o primeiro com erro.
  const idDoCampoDoBloqueio = (): string | null =>
    camposQueFaltam(formData)[0]?.id ?? idDoPrimeiroCampoComErro();

  // Mostra o campo e põe o foco nele. Se está dentro de uma SecaoRecolhivel
  // que a lojista FECHOU com o erro lá dentro, o `temErro` dela já era
  // verdadeiro (não muda, então não reabre sozinha): a gente aperta o
  // cabeçalho dela, o mesmo gesto da lojista. Nada desmonta. O foco vai depois
  // do commit (`requestAnimationFrame`), quando a seção já saiu do `hidden`.
  const mostrarEFocarCampo = (id: string) => {
    const painel = document
      .getElementById(id)
      ?.closest<HTMLElement>("[hidden]");
    if (painel?.id) {
      for (const cabecalho of document.querySelectorAll<HTMLButtonElement>(
        "button[aria-controls]",
      )) {
        if (cabecalho.getAttribute("aria-controls") === painel.id) {
          cabecalho.click();
        }
      }
    }
    requestAnimationFrame(() => {
      const campo = document.getElementById(id);
      campo?.focus();
      // O cabeçalho agora prende: centralizar impede que ele cubra o erro.
      campo?.scrollIntoView?.({ block: "center" });
    });
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    // #98 (ADMIN-060): showSuccess também bloqueia reentrada. Entre o
    // sucesso e a navegação (1,5s) `isSubmitting` já voltou a false mas o
    // botão ainda mostra "Salvo" — sem checar showSuccess aqui, um segundo
    // clique nessa janela reentrava e criava um produto duplicado.
    if (isSubmitting || showSuccess || precisaRecarregar) return;
    if (isOffline) {
      toast.error("Não é possível salvar alterações em modo offline.");
      return;
    }
    // Produto criado, variações ainda só no rascunho: salvar agora não grava
    // nada e apagaria o rascunho com a grade.
    if (variacoesPendentes) {
      toast.error(
        "As variações ainda não foram salvas. Restaure o rascunho para tentar de novo.",
        {
          duration: 10000,
          action: {
            label: "Restaurar",
            onClick: () => restaurarPendenteRef.current?.(),
          },
        },
      );
      return;
    }
    // Rede de segurança: com erro bloqueante num campo não grava e leva até ele
    // (abre a seção recolhida, se for o caso). Pela tela este ponto não é
    // alcançável — o botão de salvar fica desligado nesse estado e o <form>
    // não tem botão de envio; quem leva a lojista ao campo é o motivo do
    // bloqueio, que vira botão (acima). Vale para um submit sintético.
    const campoComErro = idDoPrimeiroCampoComErro();
    if (campoComErro) {
      mostrarEFocarCampo(campoComErro);
      return;
    }
    setIsSubmitting(true);

    // Ressalva da revisão da C5.2: o salvar ESPERA a checagem de duplicidade.
    // Sem este trecho, um clique durante uma checagem em voo (o blur do campo
    // acabou de disparar a RPC) gravava antes do veredito chegar. A checagem
    // aqui é nova — não lê o estado que o blur escreveu — e cobre o produto
    // e cada variação com código. O `isSubmitting` já está true: re-cliques
    // caem na guarda acima enquanto se espera. Falha de rede NÃO bloqueia
    // (conferirCodigoNoBanco devolve "" sem veredito); a colisão real que
    // escapar vira 23505 traduzido pela C5.1.
    const codigoDoProdutoNoSubmit = normalizarCodigoBarras(
      formData.codigoBarras,
    );
    // Só os códigos de variação NOVOS ou TROCADOS precisam de conferência: o
    // que já está salvo é do próprio registro. Salvar anterior que gravou pela
    // metade deixa `initialData` atrás do banco -- aí confere tudo.
    const codigoSalvoDaVariacao = new Map(
      initialData.variants.map((v) => [
        v.id,
        normalizarCodigoBarras(v.codigoBarras || ""),
      ]),
    );
    const conferirTodos = !productId || salvarAnteriorGravouProdutoRef.current;
    const aConferir: Array<{
      alvo: "produto" | "variacao";
      codigo: string;
      id?: string;
    }> = [];
    if (codigoDoProdutoNoSubmit) {
      aConferir.push({ alvo: "produto", codigo: codigoDoProdutoNoSubmit });
    }
    for (const variante of formData.variants) {
      const codigoDaVariante = normalizarCodigoBarras(
        variante.codigoBarras || "",
      );
      if (!codigoDaVariante) continue;
      if (
        !conferirTodos &&
        codigoSalvoDaVariacao.get(variante.id) === codigoDaVariante
      ) {
        continue;
      }
      aConferir.push({
        alvo: "variacao",
        codigo: codigoDaVariante,
        id: variante.id,
      });
    }
    // Em paralelo; a primeira recusa NA ORDEM da tela (produto, depois cada
    // variação) é a que a lojista lê, como era quando a fila era em série.
    const mensagens = await Promise.all(
      aConferir.map((c) =>
        conferirCodigoNoBanco(
          c.codigo,
          c.alvo,
          c.id,
          PRAZO_DO_CODIGO_NO_SALVAR_MS,
        ),
      ),
    );
    const recusa = mensagens.find((m) => m);
    if (recusa) {
      toast.error(recusa);
      setIsSubmitting(false);
      return;
    }

    // O que o formulário grava no produto (campo vazio = `null`, medidas com
    // entrega local = `undefined`: ver `dadosDoProdutoDoFormulario`).
    const { dados: dadosDoFormulario, estoque: pStock } =
      dadosDoProdutoDoFormulario(formData, {
        promocaoLigada: isPromoActive,
        entregaLocal: isLocalShipping,
      });
    const productData = { ...dadosDoFormulario, variants: formData.variants };

    const fim = marcarOperacaoSensivel("salvar-produto");
    try {
      if (productId) {
        // 1. Atualizar produto principal. O estoque só vai se a lojista mexeu
        // nele (ou nas variações que o compõem); senão fica o do banco.
        const mexeuNoEstoqueDoProduto = estoqueDoProdutoFoiMexido(
          formData,
          initialData,
        );
        // Uma variação desligada também tem estoque próprio: ela não entra
        // na soma do produto, mas não pode sobrescrever uma edição mais nova.
        const mexeuNoEstoque =
          mexeuNoEstoqueDoProduto ||
          variacoesSoComEstoqueMexido(
            formData.variants,
            initialData.variants,
          ).some((v) => "stockIncrement" in v);
        // SÓ O QUE MUDOU (ver `campos-mexidos-do-produto.ts`): duas pessoas no
        // mesmo produto não podem desfazer o preço, o "ativo" e as fotos uma da
        // outra com a cópia velha de cada campo que a tela leu ao abrir. Depois
        // de um salvar que gravou o produto e terminou pela metade, a
        // comparação com a abertura não vale mais (o banco já tem outro valor
        // que a tela não registrou): aí manda tudo, como antes.
        const mandarTudo = salvarAnteriorGravouProdutoRef.current;
        const variantesAMandar = mandarTudo
          ? formData.variants
          : variacoesQueMudaram(formData.variants, initialData.variants);
        // Produto antigo gravado com o marcador "Sem Imagem" NA FRENTE de fotos
        // reais: o formulário já o tirou da tela, e qualquer salvar o tira do
        // banco (a vitrine mostra `images[0]`). Produto sem foto nenhuma não
        // entra: o marcador ali é só o da exibição, o banco está vazio.
        const fotosDoBanco: unknown = currentProduct?.images;
        const bancoTemMarcadorNaFrenteDeFotos =
          Array.isArray(fotosDoBanco) &&
          soFotosReais(fotosDoBanco).length > 0 &&
          soFotosReais(fotosDoBanco).length !== fotosDoBanco.length;
        const camposQueMudaramNaTela = mandarTudo
          ? dadosDoFormulario
          : camposQueMudaram(
              dadosDoFormulario,
              dadosDoProdutoDoFormulario(initialData, {
                promocaoLigada:
                  (numeroOpcionalDoCampo(initialData.originalPrice) ?? 0) > 0,
                entregaLocal: isLocalShipping,
              }).dados,
            );
        const camposDoProduto = bancoTemMarcadorNaFrenteDeFotos
          ? { ...camposQueMudaramNaTela, images: dadosDoFormulario.images }
          : camposQueMudaramNaTela;
        const variantsWithSanitizedSku = variacoesSoComEstoqueMexido(
          variantesAMandar,
          initialData.variants,
        ).map((v) => ({
          ...v,
          sku: v.sku
            ? v.sku.trim().toUpperCase().replace(/\s+/g, "-")
            : undefined,
          codigoBarras: v.codigoBarras
            ? normalizarCodigoBarras(v.codigoBarras)
            : undefined,
        }));
        // O mesmo critério do `updateProduct` (que só enfileira com `!navigator.onLine`): a sonda de rede
        // (`isOffline`) pode dizer "fora" por até 15 s com o navegador online, e aí o caminho antigo gravaria
        // produto e grade em requisições separadas — a janela que esta RPC fecha.
        const salvarEmTransacao =
          navigator.onLine &&
          (formData.variants.length > 0 || deletedVariantIds.length > 0);
        const updates = {
          ...camposDoProduto,
          variants: productData.variants,
          ...(mexeuNoEstoqueDoProduto ? { stock: Math.max(0, pStock) } : {}),
        };
        // Um UPDATE sem coluna nenhuma não é um pedido válido: sem campo mudado
        // (e sem estoque), o caminho de duas etapas nem chama o banco.
        const haCampoParaGravar =
          Object.keys(camposDoProduto).length > 0 || mexeuNoEstoqueDoProduto;
        const conferencia = mexeuNoEstoque
          ? { baseUpdatedAt: currentProduct?.updatedAt }
          : undefined;
        let naoApagadas: string[] = [];
        let produtoSalvo: Product | undefined | null;
        if (salvarEmTransacao) {
          const retorno = await salvarProdutoComGrade(productId, updates, {
            ...conferencia,
            variantes: variantsWithSanitizedSku,
            apagar: deletedVariantIds,
          });
          if (!retorno) {
            setIsSubmitting(false);
            return;
          }
          produtoSalvo = retorno.produto;
          naoApagadas = retorno.recusadas;
        } else if (haCampoParaGravar) {
          produtoSalvo = await updateProduct(productId, updates, conferencia);
          if (produtoSalvo !== undefined) {
            salvarAnteriorGravouProdutoRef.current = true;
          }
        }
        // O produto já foi gravado mesmo se a grade falhar depois. A próxima
        // tentativa deve usar a versão devolvida pelo banco, não a da abertura.
        if (produtoSalvo) setCurrentProduct(produtoSalvo);

        // 2. Deletar variantes que foram excluídas localmente — UMA por vez: o
        // banco recusa apagar variação que já está num pedido (23503), e num
        // lote só a vendida seguraria as que podiam sair. A recusa não pode
        // impedir o passo 3: o produto já foi gravado e perder aqui o estoque e
        // o preço das outras variações era o salvar pela metade.
        if (!salvarEmTransacao && deletedVariantIds.length > 0) {
          try {
            await deleteVariants(deletedVariantIds);
          } catch (erroAoApagar) {
            // O hook já avisou o motivo (toast) e diz quais ficaram no banco
            // (`recusadas`); sem essa lista, nenhuma pode ser dada como apagada.
            console.warn(
              "[AdminProductFormView] Variação não apagada:",
              erroAoApagar,
            );
            const recusadas = (erroAoApagar as { recusadas?: unknown })
              ?.recusadas;
            naoApagadas = Array.isArray(recusadas)
              ? recusadas.map(String)
              : [...deletedVariantIds];
          }
        }
        let formAposRecusas = formData;
        if (deletedVariantIds.length > 0) {
          // As apagadas de verdade saem da fila; as recusadas voltam para a
          // lista (para a lojista poder DESLIGAR a variação) e também saem dela.
          setDeletedVariantIds([]);
        }
        const devolvidas = initialData.variants.filter((v) =>
          naoApagadas.includes(v.id),
        );
        if (devolvidas.length > 0) {
          formAposRecusas = formComVariacoes(formData, [
            ...formData.variants,
            ...devolvidas,
          ]);
          setFormData(formAposRecusas);
        }

        // Só o caminho antigo (offline) grava a grade separadamente.
        // Online, produto, exclusões e grade já foram gravados pela RPC.
        if (!salvarEmTransacao && variantsWithSanitizedSku.length > 0) {
          await upsertVariants(productId, variantsWithSanitizedSku);
        }

        // O resto foi salvo, mas alguma variação não pôde ser excluída: dizer
        // qual, e NÃO sair para a lista como se tudo tivesse dado certo. O
        // formulário passa a ser o que está no banco (recusadas de volta).
        if (naoApagadas.length > 0) {
          // A variação NOVA deste salvar já foi inserida e ganhou id de
          // verdade, mas o formulário ainda a guarda com o id provisório
          // (`temp-…`): um segundo Salvar a inseriria de novo (duas linhas no
          // banco, o dobro à venda). Por isso o formulário RELÊ o banco.
          let doBanco: Product | null = null;
          try {
            doBanco = await fetchProduct(productId);
          } catch (erroDaReleitura) {
            console.warn(
              "[AdminProductFormView] Não consegui reler o produto:",
              erroDaReleitura,
            );
          }
          if (doBanco) {
            const campos = camposDoFormularioDoProduto(doBanco);
            setFormData(campos);
            setInitialData(campos);
            setCurrentProduct(doBanco);
            setIsPromoActive(!!doBanco.originalPrice);
          } else if (formData.variants.some((v) => v.id.startsWith("temp-"))) {
            setPrecisaRecarregar(true);
            toast.error(
              "As variações novas já foram gravadas, mas não consegui reler o produto. Recarregue a tela antes de salvar de novo: salvar agora repetiria essas variações.",
              { duration: 30000 },
            );
          } else {
            setInitialData(formAposRecusas);
          }
          // O rascunho só sai DEPOIS da releitura e do formulário já trocado: o
          // salvamento automático agendado antes não pode regravá-lo, no meio da
          // espera, com a variação nova ainda como `temp-…` (restaurá-lo
          // inseriria a variação de novo).
          const chaveDoRascunho = chaveDoRascunhoDoProduto(userId, productId);
          if (chaveDoRascunho) localStorage.removeItem(chaveDoRascunho);
          const quais =
            devolvidas.length > 0
              ? devolvidas.map((v) => `${v.name}: ${v.value}`).join(", ")
              : "uma variação";
          toast.error(
            `O produto e as outras variações foram salvos, mas não consegui excluir ${quais}. Se ela já tem vendas, desligue-a no botão de ligar/desligar da linha em vez de excluir.`,
            { duration: 15000 },
          );
          setIsSubmitting(false);
          return;
        }

        // Gravar a grade também muda a versão do produto pelo gatilho. Não
        // guardar a versão anterior à grade como base do próximo salvar.
        if (
          !salvarEmTransacao &&
          (formData.variants.length > 0 || deletedVariantIds.length > 0)
        ) {
          try {
            const relido = await fetchProduct(productId);
            if (relido) setCurrentProduct(relido);
            else setCurrentProduct({ ...produtoSalvo, updatedAt: undefined });
          } catch {
            setCurrentProduct({ ...produtoSalvo, updatedAt: undefined });
          }
        }
      } else {
        // Este formulário já criou o produto e a ida para a edição não
        // aconteceu (o App descarta uma navegação a menos de 400 ms de outra).
        // Um segundo addProduct seria a cópia que a trava existe para impedir.
        if (produtoNovoJaCriadoRef.current) {
          toast.error(
            "Este produto já foi criado. Abra-o na lista de produtos para terminar a edição.",
          );
          setIsSubmitting(false);
          return;
        }
        const variantsWithSanitizedSku = formData.variants.map((v) => ({
          ...v,
          sku: v.sku
            ? v.sku.trim().toUpperCase().replace(/\s+/g, "-")
            : undefined,
          codigoBarras: v.codigoBarras
            ? normalizarCodigoBarras(v.codigoBarras)
            : undefined,
        }));
        const criado = await addProduct({
          ...productData,
          stock: Math.max(0, pStock),
          sold: 0,
          variants: variantsWithSanitizedSku,
        });
        // A lista de produtos lembra busca, categoria e página: avisa que há um
        // produto novo para ela abrir na página 1, sem filtro, e mostrá-lo.
        if (criado) avisarProdutoNovoCadastrado();

        // O produto foi criado mas a grade NÃO gravou (o hook já avisou por
        // toast). Dar "Salvo" e sair para a lista esconderia isso -- e ficar
        // nesta tela deixaria o id do produto só no estado dela: recarregar o
        // app, ou voltar em "Novo produto", recuperaria o rascunho SEM id e o
        // "Publicar" criaria uma segunda cópia. Por isso o rascunho vai para a
        // chave de EDIÇÃO do produto criado e a lojista é levada para a edição
        // dele, onde "Salvar" atualiza a linha e regrava a grade.
        if (criado?.variantesNaoSalvas) {
          // ORDEM: primeiro trava o auto-save (um timer de 1 s pode estar
          // agendado e reescreveria a chave de produto novo), depois move.
          produtoNovoJaCriadoRef.current = true;
          try {
            const chaveDeEdicao = chaveDoRascunhoDoProduto(userId, criado.id);
            if (chaveDeEdicao) {
              localStorage.setItem(
                chaveDeEdicao,
                serializarRascunhoDoProduto({
                  ...formData,
                  variacoesPendentes: true,
                }),
              );
            }
          } catch (erroDeCota) {
            // Sem rascunho a lojista perde só a digitação da grade; com a chave
            // de produto novo de pé ela criaria a cópia. Apagar vence.
            console.warn(
              "[AdminProductFormView] Não consegui guardar o rascunho de edição:",
              erroDeCota,
            );
          }
          const chaveDoNovo = chaveDoRascunhoDoProduto(userId);
          if (chaveDoNovo) localStorage.removeItem(chaveDoNovo);
          const motivo = criado.variantesNaoSalvas.motivo;
          toast.error(
            `O produto foi criado, mas as variações NÃO foram salvas.${
              motivo ? ` ${motivo}` : ""
            } Você está na edição dele: corrija e toque em Salvar para tentar de novo -- isso atualiza este produto, não cria outro.`,
            { duration: 30000 },
          );
          setIsSubmitting(false);
          onSetDirty?.(false);
          onNavigate("admin-product-form", criado.id, true);
          return;
        }
      }

      setIsSubmitting(false);
      setShowSuccess(true);
      // Achado da re-revisão da #98: iguala formData/initialData depois de
      // publicar, para o auto-save já agendado (efeito acima) encontrar
      // isDirty=false e não regravar a chave que a linha abaixo acabou de
      // remover — sem isto, o timer pendente na última edição publica o
      // rascunho de volta ~1s depois.
      setInitialData(formData);
      const chaveParaApagar = chaveDoRascunhoDoProduto(userId, productId);
      if (chaveParaApagar) localStorage.removeItem(chaveParaApagar);

      // #98 (ADMIN-060): guardado em ref e cancelado no unmount (efeito
      // logo abaixo) — sem isto, sair da tela na janela de "Salvo" ainda
      // deixava esta navegação disparar 1,5s depois, com o componente já
      // desmontado.
      successTimerRef.current = setTimeout(() => {
        successTimerRef.current = null;
        onSetDirty?.(false);
        onNavigate("admin-products", undefined, true);
      }, 1500);
    } catch (error) {
      if ((error as { gradeGravada?: boolean })?.gradeGravada) {
        setPrecisaRecarregar(true);
        const chaveDoRascunho = chaveDoRascunhoDoProduto(userId, productId);
        if (chaveDoRascunho) localStorage.removeItem(chaveDoRascunho);
      }
      const atual = (error as { produtoAtual?: Product })?.produtoAtual;
      if (atual) {
        const { stock, variants } = camposDoFormularioDoProduto(atual);
        setCurrentProduct(atual);
        setInitialData({ ...initialData, stock, variants });
        setFormData(
          formComVariacoes(
            { ...formData, stock, variants },
            variacoesDoRascunhoComEstoqueDoBanco(formData.variants, variants),
          ),
        );
      }
      setIsSubmitting(false);
      console.error("Erro ao salvar produto:", error);
      // Laudo 0109 (A12): o toast ficou no hook (useProducts traduz o erro
      // com mensagemAmigavelErroProduto e já avisou) — a tela não repete
      // com um aviso genérico por cima (era o "dois toasts empilhados").
    } finally {
      fim();
    }
  };

  // #98 (ADMIN-060): cancela o setTimeout de navegação pós-sucesso se o
  // componente desmontar antes dele disparar (ex.: admin clica em Voltar
  // logo depois de salvar).
  useEffect(() => {
    return () => {
      if (successTimerRef.current) clearTimeout(successTimerRef.current);
    };
  }, []);

  // --- Código interno automático -------------------------------------------
  // Códigos que a loja já usa (os das variações são ÚNICOS na loja; os dos
  // produtos podem repetir, mas evitar também deixa tudo mais legível), para o
  // automático não nascer igual a um existente. Melhor esforço: a lista pode
  // não ter chegado — a grade e o salvar conferem de novo.
  const codigosOcupados = useMemo(
    () => [
      ...skusDaLoja,
      ...products.map((p: { sku?: string | null }) => p.sku ?? ""),
    ],
    [skusDaLoja, products],
  );
  const prefixoAuto = prefixoDoCodigo(formData.category ?? "", formData.name);
  const codigoAuto =
    skuAutomatico && sufixoAuto !== ""
      ? montarCodigoAutomatico(prefixoAuto, sufixoAuto)
      : "";

  const alternarSkuAutomatico = () => {
    if (skuAutomatico) {
      // Desligar devolve o que ela tinha (digitado ou já salvo).
      setSkuAutomatico(false);
      setFormData((prev) => ({ ...prev, sku: skuManualGuardado.current }));
      return;
    }
    skuManualGuardado.current = formData.sku;
    setSufixoAuto(sufixoLivre(prefixoAuto, codigosOcupados));
    setSkuAutomatico(true);
  };
  const gerarOutroSku = () =>
    setSufixoAuto(sufixoLivre(prefixoAuto, codigosOcupados));

  // Enquanto o automático está ligado, o código vale no formulário (e por isso
  // vai no rascunho, no "tem alteração" e no salvar, sem caminho próprio).
  // Só roda por ação dela: desligado, nunca escreve em `formData.sku`.
  useEffect(() => {
    if (codigoAuto === "") return;
    setFormData((prev) =>
      prev.sku === codigoAuto ? prev : { ...prev, sku: codigoAuto },
    );
  }, [codigoAuto]);

  // A marca "frete grátis" do produto só vale com a regra "Só produtos
  // marcados" em algum canal (cidade ou Brasil). Sem a configuração da loja
  // carregada (ou em teste), não afirma nada.
  const freteDeProdutoSemEfeito = useMemo(
    () =>
      typeof config?.freeShippingMin === "number" &&
      !produtoTemFreteGratisPrometido(
        promessasDeFrete(config as ConfigDeFrete),
        true,
      ),
    [config],
  );

  // Combina os dois estados de erro do código de barras do produto (ver o
  // comentário perto das declarações de estado, acima) para o render e para
  // este gate — a duplicidade de REDE não bloqueia sozinha por mais tempo do
  // que o campo continuar com o mesmo valor que a gerou.
  const codigoBarrasError = codigoBarrasErroLocal || codigoBarrasErroRede;

  // "Avisar quando o estoque chegar a": derivado do texto, sem estado próprio —
  // o erro some no instante em que o texto volta a ser válido.
  const estoqueMinimoError = lerEstoqueMinimo(formData.estoqueMinimo).erro;

  const isValid =
    formData.name &&
    formData.description &&
    formData.price &&
    formData.stock &&
    formData.category !== "" &&
    Number.parseFloat(formData.price) > 0 &&
    Number(formData.stock) >= 0 &&
    !skuError &&
    !codigoBarrasError &&
    !priceError &&
    (!costError || costError.startsWith("Aviso")) &&
    !originalPriceError &&
    !promocaoSemPrecoOriginal &&
    !estoqueMinimoError &&
    !stockError;

  // UMA conta para o botão e para o aviso (se fossem duas, divergiriam: um
  // botão cinza sem frase, ou uma frase sobre um botão ligado). `null` = nada
  // impede publicar por validação/envio de foto. Offline tem banner próprio.
  // Enquanto envia foto, a frase é a do envio; passado o envio, a de
  // validação -- e uma foto que FALHOU nunca entra aqui (não bloqueia).
  const temErroNoCampo = !!(
    skuError ||
    codigoBarrasError ||
    priceError ||
    (costError && !costError.startsWith("Aviso")) ||
    originalPriceError ||
    estoqueMinimoError ||
    stockError
  );
  const motivoDoBloqueio: string | null = isOffline
    ? null
    : isImageUploading
      ? motivoDoEnvioDeFotos(progressoDoEnvio, isUploadingAdjusted)
      : isValid
        ? null
        : motivoDoBloqueioDoProduto(
            formData,
            temErroNoCampo,
            !!productId,
            promocaoSemPrecoOriginal,
          );
  // A mesma causa, em poucas palavras, para a linha única da barra de baixo.
  const fraseCurtaDaBarra = isImageUploading
    ? fraseCurtaDoEnvioDeFotos(progressoDoEnvio, isUploadingAdjusted)
    : fraseCurtaDoBloqueio(formData, temErroNoCampo, promocaoSemPrecoOriginal);
  const botaoDeSalvarDesligado =
    isSubmitting ||
    showSuccess ||
    precisaRecarregar ||
    isOffline ||
    motivoDoBloqueio !== null;

  // B3 da 2a revisao: produto pediu para editar mas nao carregou —
  // formulario vazio editavel e armadilha (save destrutivo). Erro na tela.
  if (productId && !isLoading && !currentProduct) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center bg-admin-bg px-5 text-center text-white">
        <div className="flex size-16 items-center justify-center rounded-full border border-red-500/20 bg-red-500/10">
          <AlertTriangle className="size-8 text-rose-300" />
        </div>
        <p className="mt-6 text-lg font-bold text-rose-300">
          Não foi possível carregar este produto
        </p>
        <p className="mt-2 text-sm leading-relaxed text-zinc-300">
          Verifique a conexão — o formulário fica bloqueado para proteger os
          dados
        </p>
        <button
          onClick={() => window.location.reload()}
          className="mt-4 min-h-11 rounded-lg border border-admin-border bg-white/5 px-4 py-2 text-[11px] font-black uppercase tracking-widest text-white hover:border-amber-500/30"
        >
          Recarregar
        </button>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen animate-pulse select-none bg-zinc-950 pb-12 text-white">
        {/* Background Decor */}
        <div className="pointer-events-none fixed inset-0 overflow-hidden">
          <div className="absolute right-0 top-0 h-[500px] w-[500px] rounded-full bg-emerald-500/5 blur-[120px]" />
          <div className="absolute bottom-0 left-0 h-[500px] w-[500px] rounded-full bg-blue-500/5 blur-[120px]" />
        </div>

        <header className="sticky top-0 z-30 border-b border-admin-border bg-zinc-950/80 px-4 py-3 backdrop-blur-md md:px-6 md:py-4">
          <div className="mx-auto flex max-w-5xl items-center justify-between">
            <div className="flex items-center gap-3 md:gap-4">
              <div className="size-9 rounded-xl border border-admin-border bg-white/5 md:size-10" />
              <div className="space-y-1.5">
                <Skeleton className="h-4 w-32 rounded bg-white/5" />
                <Skeleton className="hidden h-3 w-48 rounded bg-white/5 sm:block" />
              </div>
            </div>
            <Skeleton className="h-10 w-24 rounded-xl border border-admin-border bg-white/5" />
          </div>
        </header>

        <div className="mx-auto max-w-screen-xl space-y-8 p-6">
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
            {/* Left Column */}
            <div className="space-y-8 lg:col-span-8">
              {/* Photos section */}
              <div className="space-y-6 rounded-[2.5rem] border border-admin-border bg-zinc-900/20 p-6">
                <div className="flex items-center justify-between">
                  <Skeleton className="h-4.5 w-24 rounded bg-white/5" />
                </div>
                <div className="flex gap-6">
                  <Skeleton className="size-36 shrink-0 rounded-3xl bg-white/5" />
                  <Skeleton className="size-36 shrink-0 rounded-3xl bg-white/5" />
                </div>
              </div>

              {/* General Data section */}
              <div className="space-y-6 rounded-[2.5rem] border border-admin-border bg-zinc-900/20 p-6">
                <Skeleton className="h-4.5 w-32 rounded bg-white/5" />
                <div className="space-y-3">
                  <Skeleton className="h-3 w-20 rounded bg-white/5" />
                  <Skeleton className="h-14 w-full rounded-2xl bg-white/5" />
                </div>
                <div className="space-y-3">
                  <Skeleton className="h-3 w-28 rounded bg-white/5" />
                  <Skeleton className="h-32 w-full rounded-3xl bg-white/5" />
                </div>
              </div>
            </div>

            {/* Right Column */}
            <div className="space-y-8 lg:col-span-4">
              <div className="space-y-6 rounded-[2.5rem] border border-admin-border bg-zinc-900/20 p-6">
                <Skeleton className="h-4.5 w-24 rounded bg-white/5" />
                {[1, 2, 3].map((i) => (
                  <div key={i} className="flex items-center justify-between">
                    <div className="space-y-1">
                      <Skeleton className="h-3 w-16 rounded bg-white/5" />
                      <Skeleton className="h-2 w-24 rounded bg-white/5" />
                    </div>
                    <Skeleton className="h-6 w-10 rounded-full bg-white/5" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const priceVal = Number.parseFloat(formData.price) || 0;
  const costPriceVal = Number.parseFloat(formData.costPrice) || 0;
  const originalPriceVal = Number.parseFloat(formData.originalPrice) || 0;
  // O selo "-X%" da prévia da promoção: a mesma conta do selo "% OFF" do
  // card da loja (`ProductCard`), arredondada.
  const descontoDaPromocao =
    originalPriceVal > priceVal
      ? Math.round(((originalPriceVal - priceVal) / originalPriceVal) * 100)
      : 0;
  const marginPct =
    priceVal > 0 ? ((priceVal - costPriceVal) / priceVal) * 100 : 0;
  // Quatro rótulos em palavras simples: prejuízo, sem lucro, lucro baixo
  // (< 30%) e lucro bom.
  const [analiseDoLucro, corDoLucro] =
    marginPct < 0
      ? ["Prejuízo", "text-rose-300"]
      : marginPct === 0
        ? ["Sem lucro", "text-amber-300"]
        : marginPct < 30
          ? ["Lucro baixo (menos de 30%)", "text-amber-300"]
          : ["Lucro bom", "text-emerald-300"];
  // Frete (PAC/SEDEX) vai até 30 kg: acima disso, quem pensa em gramas digitou 350.
  const pesoVal = Number.parseFloat(formData.weightKg);
  const pesoEmGramasTalvez =
    pesoVal > 30
      ? {
          kg: (pesoVal / 1000).toLocaleString("pt-BR", {
            minimumFractionDigits: 3,
            maximumFractionDigits: 3,
          }),
          g: pesoVal.toLocaleString("pt-BR"),
        }
      : null;
  const hasActiveVariants = formData.variants.some((v) => v.active);
  // Indicadores de apresentação, a partir dos mesmos campos da validação.
  const preenchidos = [
    formData.name,
    formData.description,
    formData.category,
    formData.price,
    formData.stock,
  ].filter(Boolean).length;
  const variacoesAtivas = formData.variants.filter((v) => v.active).length;
  // O aviso da seção "Custo e lucro" é só do custo. O erro do "De" aparece
  // junto do campo, no básico, e entra à parte na frase "há avisos" do topo.
  const avisoDeCusto =
    costError && !costError.startsWith("Aviso") ? costError : "";
  const avisoDosCodigos = skuError || codigoBarrasError || estoqueMinimoError;

  // O "?" do guia de fotos: mora na linha da dica quando o cartão está vazio e
  // no canto do cartão quando há fotos (nunca os dois ao mesmo tempo).
  const botaoGuiaDeFotos = (classe: string) => (
    <button
      type="button"
      onClick={() => setShowPhotoGuide((prev) => !prev)}
      aria-label="Guia de Fotos do Produto"
      title="Ajuda / Guia de Fotos"
      className={cn("min-h-11 min-w-11", classe)}
    >
      <HelpCircle className="size-5" />
    </button>
  );

  return (
    <div className="produto-formulario pb-admin relative h-auto min-h-full overflow-x-clip text-white lg:pb-12">
      {gerenciandoCategorias && (
        <Suspense fallback={null}>
          <GerenciarCategorias
            aberta
            onFechar={() => setGerenciandoCategorias(false)}
          />
        </Suspense>
      )}

      {showCategoryForm && (
        <Suspense fallback={null}>
          <FolhaDeNovaCategoria
            categoriasDaLoja={dbCategories}
            adicionar={addCategory}
            atualizarIcone={updateCategory}
            aoCriada={(nome) =>
              setFormData((prev) => ({ ...prev, category: nome }))
            }
            aoFechar={() => setShowCategoryForm(false)}
          />
        </Suspense>
      )}

      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {showVariantForm && (
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
                  aria-labelledby="titulo-da-variacao"
                  className="produto-modal gpu-accelerated flex h-dvh max-h-dvh w-full max-w-lg flex-col overflow-hidden rounded-none border border-admin-border shadow-2xl sm:h-auto sm:max-h-[90dvh] sm:rounded-3xl"
                >
                  <div className="relative z-10 flex shrink-0 items-center gap-4 border-b border-admin-border bg-admin-bg p-5">
                    <div className="flex size-12 items-center justify-center rounded-2xl border border-violet-400/20 bg-violet-400/10">
                      <Layers className="size-6 text-violet-300" />
                    </div>
                    <div>
                      <h3 id="titulo-da-variacao" className="text-xl font-bold">
                        {editingVariant ? "Editar variação" : "Nova variação"}
                      </h3>
                      <p className="mt-1 text-[11px] font-bold uppercase leading-none tracking-wider text-zinc-500">
                        Variação única
                      </p>
                    </div>
                  </div>

                  <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
                    {/* O que muda nesta variação. Cada par é uma dimensão
                        (Tamanho, Cor…) que o lojista ESCOLHE tocando; "+
                        Atributo" empilha outra e as duas viram UMA combinação
                        com estoque próprio — ver `variante-composta.ts`. O que
                        é gravado segue sendo o nome e o valor em texto. */}
                    {variantFormData.pares.map((par, indice) => (
                      <div
                        key={par.chave}
                        className="rounded-[22px] border border-admin-border bg-admin-surface p-4"
                      >
                        <SeletorDeAtributo
                          modo="unico"
                          numero={indice + 1}
                          idDoNome={
                            indice === 0
                              ? "variant-name"
                              : `variant-name-${indice}`
                          }
                          idDoValor={
                            indice === 0
                              ? "variant-value"
                              : `variant-value-${indice}`
                          }
                          compacto={variantFormData.pares.length > 1}
                          titulo={
                            indice === 0 ? "O que muda" : "O que mais muda?"
                          }
                          nome={par.name}
                          onNome={(val) =>
                            atualizarParDeAtributo(indice, "name", val)
                          }
                          valor={par.value}
                          onValor={(val) =>
                            atualizarParDeAtributo(indice, "value", val)
                          }
                          sugestoes={suggestedAttributes}
                          nomesOcupados={variantFormData.pares
                            .filter((_, j) => j !== indice)
                            .map((outro) => outro.name)}
                          valoresEmUso={valoresGravadosDoAtributo(par.name)}
                          aoRemover={
                            indice > 0
                              ? () =>
                                  setVariantFormData((p) => ({
                                    ...p,
                                    pares: p.pares.filter(
                                      (_, j) => j !== indice,
                                    ),
                                  }))
                              : undefined
                          }
                          rotuloDoRemover={`Remover atributo ${indice + 1}`}
                        />
                      </div>
                    ))}

                    {/* Mais uma dimensão da combinação (ex: além de Cor,
                        Tamanho). A trava de um grupo por produto vale para o
                        resultado inteiro, não por par. */}
                    <button
                      type="button"
                      onClick={() =>
                        setVariantFormData((p) => ({
                          ...p,
                          pares: [...p.pares, parNovo()],
                        }))
                      }
                      className="min-h-11 w-full rounded-2xl border border-dashed border-admin-border bg-admin-bg/60 px-5 py-3 text-sm font-bold text-zinc-400 transition-all hover:border-admin-border-strong hover:text-foreground active:scale-95"
                    >
                      {rotuloDoMaisUmAtributo}
                    </button>

                    {/* Estoque e preço desta variação. */}
                    <div className="space-y-3 rounded-[22px] border border-admin-border bg-admin-surface p-4">
                      <p className="text-base font-bold text-foreground">
                        Estoque e preço
                      </p>
                      <div className="grid grid-cols-1 gap-3 min-[380px]:grid-cols-2">
                        <div className="min-w-0 space-y-1.5">
                          <label
                            htmlFor="variant-stock"
                            className="ml-1 text-xs text-zinc-400"
                          >
                            Quantidade
                          </label>
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              aria-label="Diminuir estoque"
                              onClick={() => somarEstoqueDaVariacao(-1)}
                              className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-admin-raised text-foreground transition-all active:scale-95"
                            >
                              <Minus className="size-4" />
                            </button>
                            <LocalBufferedInput
                              id="variant-stock"
                              name="variant-stock"
                              type="number"
                              value={variantFormData.stockIncrement}
                              onFlush={(val) =>
                                setVariantFormData((p) => ({
                                  ...p,
                                  stockIncrement: val,
                                }))
                              }
                              className="w-full px-1 text-center text-base font-black transition-all focus:border-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                            />
                            <button
                              type="button"
                              aria-label="Aumentar estoque"
                              onClick={() => somarEstoqueDaVariacao(1)}
                              className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-admin-raised text-foreground transition-all active:scale-95"
                            >
                              <Plus className="size-4" />
                            </button>
                          </div>
                        </div>
                        <div className="min-w-0 space-y-1.5">
                          <label
                            htmlFor="variant-price"
                            className="ml-1 text-xs text-zinc-400"
                          >
                            Preço desta variação
                          </label>
                          <div className="relative flex items-center">
                            <span className="absolute left-4 text-xs font-black text-zinc-600">
                              R$
                            </span>
                            <LocalBufferedInput
                              id="variant-price"
                              name="variant-price"
                              mask="currency"
                              zeroVazio
                              value={variantFormData.priceOverride}
                              onFlush={(val) =>
                                setVariantFormData((p) => ({
                                  ...p,
                                  priceOverride: val,
                                }))
                              }
                              className="w-full rounded-2xl border border-admin-border bg-zinc-950 py-4 pl-10 pr-3 text-sm font-black transition-all focus:border-emerald-500/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                              placeholder="Auto"
                            />
                          </div>
                        </div>
                      </div>
                      <span className="ml-1 block text-xs leading-tight text-zinc-500">
                        Em branco = preço do produto.
                        {editingVariant?.priceOverride === 0 &&
                          " Esta variação está salva a R$ 0,00 (de graça na loja): apague o campo para voltar ao preço padrão."}
                      </span>
                      {/* O 0 é gravado como preço próprio e vale no lugar do
                          preço do produto: a variação sai de graça. Só
                          avisa; não bloqueia nem muda o valor gravado. */}
                      {precoDaVariacaoEhZero(variantFormData.priceOverride) && (
                        <span
                          data-testid="aviso-variacao-de-graca"
                          className="ml-1 block text-[11px] font-bold leading-tight text-amber-400"
                        >
                          Com R$ 0,00 esta variação será vendida de graça. Para
                          usar o preço do produto, deixe o campo vazio.
                        </span>
                      )}
                    </div>

                    <button
                      id="variant-status"
                      role="switch"
                      aria-checked={variantFormData.active}
                      type="button"
                      onClick={() =>
                        setVariantFormData((p) => ({
                          ...p,
                          active: !p.active,
                        }))
                      }
                      className="flex min-h-14 w-full select-none items-center gap-3 rounded-[22px] border border-solid border-admin-border bg-admin-surface px-4 py-3 text-left transition-all active:scale-[0.99]"
                    >
                      <span className="flex-1 text-base font-bold text-foreground">
                        Aparece na loja
                      </span>
                      <span
                        className={cn(
                          "text-sm font-bold",
                          variantFormData.active
                            ? "text-emerald-400"
                            : "text-zinc-500",
                        )}
                      >
                        {variantFormData.active ? "Ativo" : "Inativo"}
                      </span>
                      <span
                        aria-hidden="true"
                        className={cn(
                          "flex h-8 w-14 shrink-0 items-center rounded-full p-1 transition-colors",
                          variantFormData.active
                            ? "bg-emerald-500"
                            : "bg-admin-border-strong",
                        )}
                      >
                        <span
                          className={cn(
                            "size-6 rounded-full bg-white shadow transition-transform",
                            variantFormData.active
                              ? "translate-x-6"
                              : "translate-x-0",
                          )}
                        />
                      </span>
                    </button>
                    {/* Foto da variação — APONTA uma das imagens do produto
                        (pedido do Gabriel, 02/09: o upload era ineficiente;
                        a imagem já foi enviada quando o produto a recebeu, a
                        variante só referencia a URL). */}
                    <div className="space-y-3 rounded-[22px] border border-admin-border bg-admin-surface p-4">
                      <p className="text-base font-bold text-foreground">
                        Foto desta variação
                      </p>
                      {formData.images.length === 0 &&
                      !variantFormData.imageUrl ? (
                        <p className="rounded-2xl border border-admin-border bg-admin-bg/60 px-4 py-3 text-[11px] font-bold leading-relaxed text-zinc-500">
                          Adicione imagens ao produto primeiro — a variante
                          aponta para uma delas em vez de enviar arquivo novo.
                        </p>
                      ) : (
                        <div className="custom-scrollbar-hidden flex w-full snap-x gap-3 overflow-x-auto p-1">
                          {/* Imagem gravada na variante que não pertence mais
                              ao produto (foi removida depois): segue visível
                              para poder ser mantida ou trocada. */}
                          {variantFormData.imageUrl &&
                            !formData.images.includes(
                              variantFormData.imageUrl,
                            ) && (
                              <button
                                type="button"
                                data-testid="foto-da-variacao"
                                aria-pressed="true"
                                title="Imagem atual da variante — toque para remover"
                                onClick={() =>
                                  setVariantFormData((p) => ({
                                    ...p,
                                    imageUrl: "",
                                  }))
                                }
                                className="relative size-16 shrink-0 snap-start overflow-hidden rounded-2xl border-2 border-solid border-foreground ring-2 ring-foreground transition-all"
                              >
                                <img
                                  src={variantFormData.imageUrl}
                                  alt=""
                                  className="size-full object-cover"
                                />
                                <span className="absolute inset-x-0 bottom-0 bg-foreground py-0.5 text-center text-[11px] font-black text-background">
                                  Atual
                                </span>
                              </button>
                            )}
                          {formData.images.map((url) => {
                            const selecionada =
                              variantFormData.imageUrl === url;
                            return (
                              <button
                                key={url}
                                type="button"
                                data-testid="foto-da-variacao"
                                aria-pressed={selecionada}
                                title={
                                  selecionada
                                    ? "Selecionada — toque para remover"
                                    : "Usar esta imagem na variante"
                                }
                                onClick={() =>
                                  setVariantFormData((p) => ({
                                    ...p,
                                    imageUrl: selecionada ? "" : url,
                                  }))
                                }
                                className={cn(
                                  "relative size-16 shrink-0 snap-start overflow-hidden rounded-2xl border border-solid transition-all",
                                  selecionada
                                    ? "border-2 border-foreground ring-2 ring-foreground"
                                    : "border-admin-border hover:border-admin-border-strong",
                                )}
                              >
                                <img
                                  src={url}
                                  alt=""
                                  className="size-full object-cover"
                                />
                                {selecionada && (
                                  <span className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-foreground text-background">
                                    <Check
                                      data-marca="selecionado"
                                      strokeWidth={3}
                                      className="size-3.5"
                                    />
                                  </span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      )}
                      <span className="block text-xs leading-tight text-zinc-500">
                        Toque na foto que mostra esta variação. É uma das fotos
                        do produto — nada é enviado de novo.
                      </span>
                    </div>
                    <details className="group rounded-[22px] border border-admin-border bg-admin-surface">
                      <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-4 text-base font-bold [&::-webkit-details-marker]:hidden">
                        <span className="flex-1">Códigos e câmera</span>
                        <span className="text-sm font-normal text-zinc-500">
                          Opcional
                        </span>
                        <ChevronDown className="size-5 text-zinc-500 transition-transform group-open:rotate-180" />
                      </summary>
                      <div className="space-y-4 p-3 pt-0">
                        <div className="space-y-2">
                          <label
                            htmlFor="variant-sku"
                            className="ml-1 text-[11px] font-black uppercase tracking-widest text-zinc-500"
                          >
                            Código interno (SKU)
                          </label>
                          <LocalBufferedInput
                            id="variant-sku"
                            name="variant-sku"
                            type="text"
                            value={variantFormData.sku}
                            onFlush={(val) =>
                              setVariantFormData((p) => ({
                                ...p,
                                sku: val
                                  .trim()
                                  .toUpperCase()
                                  .replace(/\s+/g, "-"),
                              }))
                            }
                            className="w-full rounded-2xl border border-admin-border bg-zinc-950 px-5 py-4 font-mono text-sm font-bold uppercase transition-all focus:border-emerald-500/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                            placeholder="Ex: COR-TAM"
                          />
                        </div>
                        {/* Código de Barras (C5.2) — a caixa da PP tem um código
                        diferente da caixa da M: cada variação leva o seu.
                        O botão "Ler com a câmera" (C5.3) usa o slot
                        reservado ao lado do input. */}
                        <div className="space-y-2">
                          <label
                            htmlFor="variant-codigo-barras"
                            className="ml-1 text-[11px] font-black uppercase tracking-widest text-zinc-500"
                          >
                            Código de barras
                          </label>
                          {/* No celular o botão desce para baixo do campo: lado a
                          lado, os 13 dígitos não cabiam (onda J). */}
                          <div className="flex flex-col gap-2 xs:flex-row">
                            <LocalBufferedInput
                              id="variant-codigo-barras"
                              name="variant-codigo-barras"
                              type="text"
                              inputMode="numeric"
                              data-testid="codigo-barras-variacao"
                              value={variantFormData.codigoBarras}
                              onFlush={(val) =>
                                setVariantFormData((p) => ({
                                  ...p,
                                  codigoBarras: normalizarCodigoBarras(val),
                                }))
                              }
                              onBlur={(e) =>
                                aoSairDoCampoDeCodigoDeBarras(
                                  e.target.value,
                                  "variacao",
                                  editingVariant?.id,
                                )
                              }
                              className="w-full rounded-2xl border border-admin-border bg-zinc-950 px-5 py-4 font-mono text-sm font-bold transition-all focus:border-emerald-500/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                              placeholder="Ex: 7891234567890"
                            />
                            {/* C5.3 — some sem câmera: o leitor físico USB digita
                            direto no campo acima, sem precisar deste botão. */}
                            {temCameraDisponivel() && (
                              <button
                                type="button"
                                onClick={() => setLeitorAberto("variacao")}
                                className="flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 text-[11px] font-black uppercase tracking-widest text-emerald-500 transition-all hover:bg-emerald-500 hover:text-emerald-950 active:scale-95"
                                title="Ler com a câmera"
                              >
                                <Camera className="size-4" />
                                Ler com a câmera
                              </button>
                            )}
                          </div>
                          <span className="ml-1 mt-1 block text-[11px] leading-tight text-zinc-500">
                            Opcional. É o código impresso na embalagem desta
                            variação; a tela Vender lê ele pela câmera.
                          </span>
                          {variantCodigoBarrasError && (
                            <span className="ml-1 mt-1 block text-[11px] font-bold text-red-500">
                              {variantCodigoBarrasError}
                            </span>
                          )}
                          {!variantCodigoBarrasError &&
                            variantCodigoBarrasAvisoRede && (
                              <span className="ml-1 mt-1 block text-[11px] font-bold text-amber-500">
                                {variantCodigoBarrasAvisoRede}
                              </span>
                            )}
                        </div>
                      </div>
                    </details>
                  </div>

                  <div className="relative z-10 flex shrink-0 gap-4 border-t border-admin-border bg-admin-surface p-5">
                    <button
                      type="button"
                      // Ressalva da revisão da C5.2: o rascunho do modal
                      // permanece (reabrir recupera o que estava digitado),
                      // mas veredito e aviso de rede morrem, e o leitor de
                      // câmera aberto também (sem órfão na página).
                      onClick={cancelarVariacao}
                      className="min-h-14 flex-1 rounded-2xl border border-admin-border bg-admin-raised p-3 text-sm font-bold text-white"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      onClick={async (e) => {
                        e.preventDefault();
                        await handleVariantSubmit();
                      }}
                      className="min-h-14 flex-[2] rounded-2xl bg-gradient-to-b from-[#f8d658] to-[#e3ac16] p-3 text-sm font-bold text-[#211a07]"
                    >
                      Salvar variação
                    </button>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}

      {/* Modal da grade de combinações. Ele não grava nada: efetivar entrega
          as linhas e elas entram na lista de variantes abaixo, gravadas pelo
          upsertVariants de sempre no salvar. Ele mesmo se põe no body. */}
      <ModalVarianteGrade
        aberto={showGradeForm}
        onFechar={() => setShowGradeForm(false)}
        variantesExistentes={formData.variants}
        sugestoesDeAtributo={suggestedAttributes}
        grupoUnicoEmUso={gruposDeVariacao(formData.variants).at(0) ?? null}
        skusDaLoja={skusDaLoja}
        skuBaseSugerida={skuAutomatico ? formData.sku : ""}
        precoDoProduto={precoDoProdutoTexto}
        onEfetivar={handleEfetivarGrade}
      />

      {/* O topo: a linha do título cola no alto e encolhe ao rolar (só o
          estilo muda, a altura da linha é a mesma). A conta "N de 5" e a barra
          fina ficam logo abaixo, no fluxo, e saem da tela rolando. */}
      <div ref={marcaDoTopo} aria-hidden="true" className="h-0" />
      <header
        ref={topoRef}
        data-compacto={topoCompacto}
        className="produto-topo sticky top-0 z-30 bg-admin-bg/95 px-5 backdrop-blur-md"
      >
        <div className="produto-topo-linha mx-auto flex max-w-3xl items-center gap-3">
          <div className="min-w-0 flex-1 [&_h1>span>span]:not-italic [&_h1>span]:whitespace-normal [&_h1]:normal-case [&_h1]:leading-tight">
            <AdminPageHeader
              titulo={`${productId ? "Editar" : "Novo"} ${NOMES_DO_PAINEL["admin-product-form"].toLowerCase()}`}
            />
          </div>
          <AnelDoProgresso preenchidos={preenchidos} total={5} />
          <button
            type="button"
            onClick={() => setShowHelpModal(true)}
            aria-label="Como cadastrar um produto"
            title="Guia de Cadastro e Ajuda"
            className="flex size-11 min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full border border-solid border-admin-border bg-zinc-900 text-zinc-300"
          >
            <HelpCircle className="size-5" />
          </button>
        </div>
      </header>
      <div className="mx-auto max-w-3xl px-5 py-1">
        <p data-testid="progresso-do-produto" className="text-xs text-zinc-400">
          {preenchidos} de 5 essenciais prontos
          {avisoDeCusto ||
          originalPriceError ||
          avisoDosCodigos ||
          priceError ||
          stockError
            ? " · há avisos"
            : ""}
        </p>
        <div className="mt-3">
          <BarraDoProgresso preenchidos={preenchidos} total={5} />
        </div>
      </div>

      <motion.form
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        onSubmit={handleSubmit}
        className="gpu-accelerated mx-auto max-w-3xl space-y-4 p-4 sm:px-5"
      >
        {isOffline && (
          <div className="flex select-none items-center gap-3 rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-xs font-bold uppercase tracking-wider text-red-400 duration-300 animate-in fade-in slide-in-from-top-2">
            <AlertTriangle className="size-5 shrink-0 animate-pulse text-red-500" />
            <span>
              Você está offline. O salvamento e alteração de produtos estão
              temporariamente suspensos.
            </span>
          </div>
        )}
        {/* Os mesmos controles de envio, agora à vista no cartão de fotos. */}
        <section
          className="produto-fotos relative"
          aria-label="Fotos do produto"
        >
          <div className="group/fotos">
            <div
              className={cn(
                "produto-fotos-titulo flex min-h-12 items-center gap-3 pb-2 pr-14",
                formData.images.length === 0 && "sr-only",
              )}
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-admin-border bg-admin-raised text-zinc-300">
                <Camera className="size-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-base font-bold">
                  Fotos do Produto
                </span>
                <span className="mt-1 block text-xs text-zinc-400">
                  {formData.images.length
                    ? `${formData.images.length} de 10 · Proporção ideal: 4:5`
                    : "Opcional · até 10 fotos"}
                </span>
              </span>
            </div>
            <div className="w-full">
              {formData.images.length === 0 ? (
                <div className="produto-fotos-vazio">
                  {/* A CAPA: o quadrado grande é o mesmo `<label>` de sempre
                    (aponta para o input de galeria, que fica SEM `capture`) e
                    leva o arraste de arquivos. O label TEM texto visível ("Capa") e o
                    input casado está dentro dele: pôr `aria-label` aqui
                    pioraria a acessibilidade, trocando esse texto pelo rótulo
                    curto no nome acessível. */}
                  <label
                    htmlFor="product-image-upload"
                    onDragOver={(e) => {
                      e.preventDefault();
                      setIsDragging(true);
                    }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={async (e) => {
                      e.preventDefault();
                      setIsDragging(false);
                      if (isOffline) {
                        toast.error("Não é possível enviar imagens offline.");
                        return;
                      }
                      if (isImageUploading) return;
                      const files = Array.from(e.dataTransfer.files || []);
                      await processAndUploadImages(files);
                    }}
                    className={cn(
                      "produto-fotos-envio relative flex cursor-pointer select-none flex-col items-center justify-center gap-1 overflow-hidden transition-all",
                      isDragging
                        ? "border-emerald-500 bg-emerald-500/10"
                        : "border-admin-border bg-zinc-900/30 hover:bg-emerald-500/5 hover:border-emerald-500/30",
                      (isSubmitting || isImageUploading) &&
                        "opacity-40 pointer-events-none",
                    )}
                  >
                    <span className="sr-only">
                      Adicionar fotos do produto.{" "}
                    </span>
                    <Plus aria-hidden="true" className="size-7" />
                    <span className="text-sm font-medium">
                      {isDragging ? "Solte aqui" : "Capa"}
                    </span>
                    <input
                      id="product-image-upload"
                      name="product-images"
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={handleImageUpload}
                      className="hidden"
                      disabled={isSubmitting || isImageUploading}
                    />
                  </label>
                  {/* Só o contorno de onde as próximas fotos vão aparecer. */}
                  <div className="produto-fotos-miniaturas" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                  </div>
                  <div className="produto-fotos-dica">
                    <p className="min-w-0 flex-1 text-[11px] text-zinc-400">
                      Até 10 · a primeira é a capa
                    </p>
                    {botaoGuiaDeFotos(
                      "-mx-1.5 -my-3.5 flex size-11 shrink-0 items-center justify-center rounded-full text-zinc-400",
                    )}
                  </div>
                  <div className="produto-fotos-botoes">
                    {/* C5.3 — "Tirar foto": um SEGUNDO input, com `capture`,
                    fora do label da capa. O input de galeria fica SEM
                    `capture` de propósito — com `capture` o celular deixa de
                    oferecer a galeria e só abre a câmera. Os dois chamam o
                    MESMO `handleImageUpload`: a origem do arquivo (câmera ou
                    galeria) não muda o que a tela faz com ele. */}
                    <label
                      htmlFor="product-image-capture"
                      className={cn(
                        "produto-fotos-camera flex min-h-11 min-w-0 flex-1 cursor-pointer items-center justify-center whitespace-nowrap rounded-full px-3 text-[13px] font-bold transition-all",
                        (isSubmitting || isImageUploading) &&
                          "opacity-40 pointer-events-none",
                      )}
                    >
                      Tirar foto
                      <input
                        id="product-image-capture"
                        name="product-image-capture"
                        type="file"
                        accept="image/*"
                        capture="environment"
                        onChange={handleImageUpload}
                        className="hidden"
                        disabled={isSubmitting || isImageUploading}
                      />
                    </label>
                    <label
                      htmlFor="product-image-upload"
                      className={cn(
                        "produto-fotos-galeria flex min-h-11 min-w-0 flex-1 cursor-pointer items-center justify-center rounded-full border border-solid border-admin-border-strong px-3 text-[13px] font-bold",
                        (isSubmitting || isImageUploading) &&
                          "opacity-40 pointer-events-none",
                      )}
                    >
                      Galeria
                    </label>
                  </div>
                </div>
              ) : (
                <div className="produto-fotos-cheio">
                  {/* A foto EM FOCO, grande, com as ações DELA ao lado. A
                      primeira é a principal (capa da vitrine); tocar numa
                      miniatura da faixa abaixo muda a foto em foco. */}
                  <div
                    ref={fotoEmFocoRef}
                    role="group"
                    aria-label={`Foto ${indiceEmFoco + 1} de ${formData.images.length}`}
                    data-testid="foto-em-foco"
                    data-foto-principal={indiceEmFoco === 0 ? "" : undefined}
                    className="produto-foto-foco"
                  >
                    {(() => {
                      const image = formData.images.at(indiceEmFoco) ?? "";
                      const meta = imageMetadata[image];
                      const isCover = indiceEmFoco === 0;
                      return (
                        <>
                          <React.Fragment key={image}>
                            <div className="produto-foto-foco-coluna">
                              <div className="produto-foto-foco-imagem">
                                <img src={image} alt="" />
                                <div
                                  data-tema-fixo=""
                                  className="produto-foto-selo text-[11px] font-bold"
                                >
                                  {isCover
                                    ? "Principal"
                                    : `Foto ${indiceEmFoco + 1}`}
                                </div>
                              </div>
                              {meta &&
                                meta.status !== "loading" &&
                                meta.status !== "erro" && (
                                  <p
                                    className={`mt-2 text-xs ${meta.status === "warning_aspect" || meta.status === "warning_res" ? "text-orange-300" : "text-zinc-400"}`}
                                  >
                                    {meta.status === "excellent"
                                      ? "Excelente!"
                                      : meta.status === "warning_aspect"
                                        ? "Ajuste para 4:5."
                                        : meta.status === "warning_res"
                                          ? "Resolução baixa."
                                          : "Boa qualidade."}
                                    <span className="block text-[11px] text-zinc-400">
                                      {meta.width} × {meta.height} px
                                    </span>
                                  </p>
                                )}
                            </div>
                            <div className="produto-foto-foco-acoes">
                              <button
                                type="button"
                                onClick={() => {
                                  if (!acaoDeFotoLiberada(false)) return;
                                  openAdjuster(image, indiceEmFoco);
                                }}
                                className="flex min-h-11 w-full items-center gap-1.5 whitespace-nowrap rounded-xl border border-solid border-admin-border bg-admin-raised px-2.5 text-xs font-bold text-zinc-200"
                                title="Ajustar e Cortar"
                              >
                                <Scissors className="size-4 shrink-0" />
                                Ajustar e Cortar
                              </button>
                              {/* "Excluir" fica SEMPRE no mesmo lugar: "Tornar
                                principal" (que some quando a foto é a capa)
                                vem depois dele. Se viesse antes, o Excluir
                                subiria para baixo do dedo no momento em que
                                a foto vira capa. */}
                              <button
                                type="button"
                                onClick={() => {
                                  if (!acaoDeFotoLiberada(true)) return;
                                  removeImage(image);
                                }}
                                className="flex min-h-11 w-full items-center gap-1.5 rounded-xl bg-rose-400/10 px-2.5 text-xs font-bold text-rose-300"
                                title="Excluir"
                              >
                                <Trash2 className="size-4 shrink-0" />
                                Excluir
                              </button>
                              {!isCover && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (!acaoDeFotoLiberada(true)) return;
                                    tornarPrincipal(indiceEmFoco);
                                  }}
                                  disabled={isImageUploading || isSubmitting}
                                  aria-label={`Tornar principal: foto ${indiceEmFoco + 1} de ${formData.images.length}`}
                                  className="min-h-11 w-full rounded-xl border border-solid border-admin-border px-2.5 text-xs font-bold text-zinc-200 disabled:opacity-40"
                                >
                                  Tornar principal
                                </button>
                              )}
                            </div>
                          </React.Fragment>
                        </>
                      );
                    })()}
                  </div>
                  {/* A faixa de miniaturas (50 px): uma por foto, na ordem; a
                      que está em foco fica marcada. Rola de lado quando as
                      fotos não cabem. */}
                  <div
                    ref={faixaDeFotosRef}
                    role="group"
                    aria-label="Galeria de fotos do produto"
                    className="produto-fotos-faixa"
                  >
                    {formData.images.map((image, index) => (
                      <button
                        key={image}
                        type="button"
                        aria-pressed={index === indiceEmFoco}
                        aria-label={`Ver foto ${index + 1} de ${formData.images.length}${index === 0 ? " (principal)" : ""}`}
                        onClick={() => setUrlEmFoco(image)}
                      >
                        <img src={image} alt="" />
                      </button>
                    ))}
                    {isUploadingImages && (
                      <div role="status" className="produto-fotos-enviando">
                        <Loader2 className="size-5 animate-spin text-emerald-400" />
                        <span>
                          {imageUploadStep === "compressing"
                            ? "Comprimindo..."
                            : "Enviando..."}
                        </span>
                      </div>
                    )}
                  </div>

                  {faixaRola && (
                    <span className="mt-1 flex select-none items-center gap-1.5 text-[11px] font-bold text-zinc-500">
                      ↔ Deslize para o lado para ver mais fotos
                    </span>
                  )}
                </div>
              )}
              {fotosComFalha.length > 0 && (
                <ul data-testid="fotos-com-falha" className="mt-3 space-y-2">
                  {fotosComFalha.map((falha) => (
                    <li
                      key={falha.id}
                      className="flex flex-col gap-2 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-xs font-bold text-red-300 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <span className="min-w-0">
                        A foto "{falha.file.name}" {falha.motivo}. Ela não vai
                        no produto — tente de novo, remova, ou publique sem ela.
                      </span>
                      <span className="flex shrink-0 gap-2">
                        <button
                          type="button"
                          onClick={() => void tentarFotoDeNovo(falha.id)}
                          disabled={isImageUploading || isOffline}
                          className="min-h-11 rounded-xl border border-admin-border bg-admin-raised px-3 py-2 text-[11px] font-bold text-white disabled:opacity-40"
                        >
                          Tentar de novo
                        </button>
                        <button
                          type="button"
                          onClick={() => descartarFotoComFalha(falha.id)}
                          className="min-h-11 rounded-lg border border-admin-border px-3 py-1.5 text-[11px] font-black uppercase tracking-wider text-zinc-300"
                        >
                          Remover
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {formData.images.length > 0 && (
              <div className="flex items-center gap-2">
                {/* C5.3 — "Tirar foto": SEGUNDO input, com `capture`, para
                    não tirar a galeria do celular do input de cima (ver
                    comentário completo no estado vazio, abaixo). */}
                <label
                  htmlFor="product-image-capture"
                  className={cn(
                    "produto-fotos-camera flex min-h-11 w-full min-w-0 cursor-pointer items-center justify-center gap-2 rounded-full px-3 text-[13px] font-bold",
                    (isSubmitting || isImageUploading) &&
                      "opacity-40 pointer-events-none",
                  )}
                  title="Tirar Foto"
                >
                  <Camera className="size-5" /> Tirar foto
                  <input
                    id="product-image-capture"
                    name="product-image-capture"
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={handleImageUpload}
                    className="hidden"
                    disabled={isSubmitting || isImageUploading}
                  />
                </label>
                <label
                  htmlFor="product-image-upload"
                  className={cn(
                    "produto-fotos-galeria flex min-h-11 w-full min-w-0 cursor-pointer items-center justify-center gap-2 rounded-full border border-solid border-admin-border-strong px-3 text-[13px] font-bold",
                    (isSubmitting || isImageUploading) &&
                      "opacity-40 pointer-events-none",
                  )}
                  title="Adicionar Mais Imagens"
                >
                  <Plus className="size-5" /> Mais fotos
                  <input
                    id="product-image-upload"
                    name="product-images"
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handleImageUpload}
                    className="hidden"
                    disabled={isSubmitting || isImageUploading}
                  />
                </label>
              </div>
            )}
            {formData.images.length > 0 && (
              <p className="mt-3 text-[11px] text-zinc-400">
                Máx. 10 fotos · 12 MB cada. A ordem não muda por arraste.
              </p>
            )}
          </div>
          {formData.images.length > 0 &&
            botaoGuiaDeFotos(
              "absolute right-2 top-2 flex size-11 items-center justify-center rounded-full text-zinc-400",
            )}
        </section>

        {/* Guide Section */}
        <AnimatePresence>
          {showPhotoGuide && (
            <AdminHelpModal
              isOpen={true}
              onClose={() => setShowPhotoGuide(false)}
              title="Guia de Fotos do Produto"
              icon={Camera}
            >
              <div className="space-y-4 rounded-2xl border border-admin-border bg-zinc-950/40 p-5">
                <p className="text-[11px] font-medium leading-relaxed text-zinc-400">
                  Imagens de alta qualidade aumentam a conversão de vendas. Siga
                  as orientações recomendadas:
                </p>
                <ul className="list-disc space-y-2 pl-4 text-[11px] font-medium text-zinc-500">
                  <li>
                    <b className="text-zinc-350">Proporção 4:5 (Card):</b>{" "}
                    Essencial para que os produtos caibam no card da vitrine sem
                    cortes laterais automáticos. Use o enquadramento "Vitrine".
                  </li>
                  <li>
                    <b className="text-zinc-350">Proporção 1:1 (Detalhe):</b>{" "}
                    Ideal para a galeria interna do produto. Mantém a
                    consistência visual em carrosséis.
                  </li>
                  <li>
                    <b className="text-zinc-350">Resolução Recomendada:</b>{" "}
                    Imagens com pelo menos 800px a 1200px de altura garantem
                    nitidez no zoom.
                  </li>
                  <li>
                    <b className="text-zinc-350">Fundo e Contraste:</b> Fundos
                    neutros (branco/cinza) e produtos bem iluminados destacam os
                    detalhes e transmitem profissionalismo.
                  </li>
                </ul>
                <div className="flex items-center justify-between gap-3 border-t border-admin-border pt-3 text-[11px] font-black uppercase tracking-wider text-emerald-400">
                  <span>Proporção ideal: 4:5 ou 1:1</span>
                  <span>Res: &gt; 800px</span>
                </div>
              </div>
            </AdminHelpModal>
          )}
        </AnimatePresence>

        {/* Content Section */}
        <section className="produto-dados space-y-2">
          <div className="flex items-center gap-3">
            <h2 className="produto-rotulo-secao">Essencial</h2>
            <button
              type="button"
              onClick={() => toggleHelp("productData")}
              className="-my-3 ml-auto flex min-h-11 min-w-11 shrink-0 touch-manipulation select-none items-center justify-center rounded-full text-zinc-300 active:scale-95"
              title="Ajuda / Guia de Dados do Produto"
              aria-label="Guia de Cadastro e Informações"
            >
              {/* O botão é a área de toque de 44px; o círculo de 32px é só o desenho. */}
              <span
                aria-hidden="true"
                className={cn(
                  "flex size-8 items-center justify-center rounded-full border text-xs font-black transition-all",
                  expandedHelp.productData
                    ? "bg-blue-500 border-blue-400 text-blue-950 shadow-md shadow-blue-500/10 scale-110"
                    : "bg-zinc-950/50 border-admin-border text-zinc-400",
                )}
              >
                ?
              </span>
            </button>
          </div>

          {/* Data Guide Section */}
          <AnimatePresence>
            {expandedHelp.productData && (
              <AdminHelpModal
                isOpen={true}
                onClose={() => toggleHelp("productData")}
                title="Guia de Cadastro e Informações"
                icon={Info}
              >
                <div className="space-y-4 rounded-2xl border border-admin-border bg-zinc-950/40 p-5">
                  <p className="text-[11px] font-medium leading-relaxed text-zinc-400">
                    O preenchimento correto dos dados melhora a indexação do
                    produto e facilita a decisão do cliente.
                  </p>
                  <ul className="list-none space-y-3 pl-0 text-[11px] font-medium text-zinc-500">
                    <li className="flex items-start gap-2.5">
                      <div className="mt-1.5 size-1.5 shrink-0 rounded-full bg-blue-500" />
                      <span>
                        <b className="text-zinc-300">Nome do Produto:</b> Seja
                        claro, indicando o tipo do item, a marca e a
                        característica principal (ex:{" "}
                        <i>Camiseta Algodão Egípcio Slim - Preta</i>). Evite
                        excesso de adjetivos promocionais.
                      </span>
                    </li>
                    <li className="flex items-start gap-2.5">
                      <div className="mt-1.5 size-1.5 shrink-0 rounded-full bg-blue-500" />
                      <span>
                        <b className="text-zinc-350">Descrição Detalhada:</b>{" "}
                        Informe materiais, dimensões, tabelas de medidas,
                        garantia e cuidados de conservação. Uma boa descrição
                        reduz as dúvidas no WhatsApp e diminui devoluções.
                      </span>
                    </li>
                    <li className="flex items-start gap-2.5">
                      <div className="mt-1.5 size-1.5 shrink-0 rounded-full bg-blue-500" />
                      <span>
                        <b className="text-zinc-350">Categoria:</b> Classifique
                        adequadamente para que o produto seja filtrado na
                        vitrine da loja e apareça nas categorias corretas do
                        catálogo.
                      </span>
                    </li>
                    <li className="flex items-start gap-2.5">
                      <div className="mt-1.5 size-1.5 shrink-0 rounded-full bg-blue-500" />
                      <span>
                        <b className="text-zinc-350">Código interno:</b>{" "}
                        Referência sua, livre de repetir — útil para controle e
                        identificação ágil (fica em Códigos e câmera). Quem
                        precisa ser único é o código interno de cada variação.
                      </span>
                    </li>
                    <li className="flex items-start gap-2.5">
                      <div className="mt-1.5 size-1.5 shrink-0 rounded-full bg-blue-500" />
                      <span>
                        <b className="text-zinc-350">Código de Barras:</b>{" "}
                        Opcional — é o código impresso na EMBALAGEM física (o
                        dos produtos de mercado ou o do seu fornecedor),
                        diferente do código interno (que é uso interno seu).
                        Precisa ser único no catálogo inteiro: o mesmo código
                        não pode estar em outro produto ou variação. É o que a
                        tela Vender lê no balcão. Se o produto tem variações,
                        cadastre o código em CADA variação — a caixa da PP é
                        diferente da caixa da M.
                      </span>
                    </li>
                    <li className="flex items-start gap-2.5">
                      <div className="mt-1.5 size-1.5 shrink-0 rounded-full bg-blue-500" />
                      <span>
                        <b className="text-zinc-350">Estoque Base:</b>{" "}
                        Quantidade física disponível quando o produto não tem
                        variação ativa. Com qualquer variação ativa, o estoque
                        do produto passa a ser a SOMA das variações ativas e
                        este campo fica travado.
                      </span>
                    </li>
                    <li className="flex items-start gap-2.5">
                      <div className="mt-1.5 size-1.5 shrink-0 rounded-full bg-blue-500" />
                      <span>
                        <b className="text-zinc-350">Em promoção:</b> Ligue para
                        mostrar na loja o preço de antes, riscado, ao lado do
                        preço de venda (ex: de R$ 100,00 por R$ 79,90). A loja
                        também mostra o desconto em porcentagem. A prévia logo
                        abaixo mostra como o cliente vai ver.
                      </span>
                    </li>
                  </ul>
                </div>
              </AdminHelpModal>
            )}
          </AnimatePresence>

          <div className="grid grid-cols-2 gap-3">
            <div className="produto-campo col-span-2 space-y-1">
              <label
                htmlFor="product-name"
                className="ml-1 text-[11px] font-black uppercase tracking-widest text-zinc-500"
              >
                Nome do Produto *
              </label>
              <LocalBufferedInput
                id="product-name"
                name="product-name"
                type="text"
                value={formData.name}
                onFlush={(val) =>
                  setFormData((prev) => ({ ...prev, name: val }))
                }
                placeholder="Ex: Camiseta básica preta"
                className="w-full rounded-xl border border-admin-border bg-zinc-950/50 px-4 py-3 text-sm font-black text-white transition-all placeholder:text-zinc-800 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 sm:rounded-2xl sm:px-6 sm:py-5 sm:text-base"
              />
            </div>

            <div className="produto-campo col-span-2 space-y-1">
              <label
                htmlFor="product-description"
                className="ml-1 text-[11px] font-black uppercase tracking-widest text-zinc-500"
              >
                Descrição do Produto *
              </label>
              <LocalBufferedTextarea
                id="product-description"
                name="product-description"
                value={formData.description}
                onFlush={(val) =>
                  setFormData((prev) => ({ ...prev, description: val }))
                }
                placeholder="Conte como é o produto..."
                rows={3}
                className="w-full resize-none rounded-2xl border border-admin-border bg-zinc-950/50 px-4 py-3.5 text-sm font-medium leading-relaxed text-zinc-300 transition-all placeholder:text-zinc-800 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 sm:rounded-3xl sm:px-6 sm:py-5"
              />
            </div>

            {/* Galeria de categorias: só as que aparecem na loja (as escondidas
                saem da escolha; o produto que já tem uma delas continua com o
                nome à vista). Contrato no comentário de `CampoDeCategoria`. */}
            <CampoDeCategoria
              valor={formData.category || ""}
              nomes={dbCategories
                .filter((c) => c.isActive !== false)
                .map((c) => ({
                  id: c.id,
                  nome: c.name,
                  icone: c.icone,
                  iconeForma: c.iconeForma,
                }))}
              aoEscolher={(nome) =>
                setFormData((prev) => ({ ...prev, category: nome }))
              }
              aberta={escolhendoCategoria}
              aoMudarAberta={setEscolhendoCategoria}
              aoCriar={() => setShowCategoryForm(true)}
              aoGerenciar={() => setGerenciandoCategorias(true)}
              categoriaDoRascunhoQueSumiu={categoriaDoRascunhoSumiu}
            />

            {/* Preço de venda: sobe da antiga "Precificação" para o básico —
                é o que toda lojista preenche. Só mudou de lugar no JSX; o
                estado, o `id` e a validação (`priceError`) são os de sempre. */}
            <div className="produto-campo space-y-1">
              <label
                htmlFor="product-sale-price"
                className="ml-1 block cursor-pointer text-[11px] font-black uppercase tracking-widest text-zinc-500"
              >
                Preço de Venda *
              </label>
              <div className="group relative">
                <span className="absolute left-0 top-1/2 -translate-y-1/2 text-sm text-zinc-300">
                  R$
                </span>
                <LocalBufferedInput
                  id="product-sale-price"
                  placeholder="0,00"
                  aria-invalid={!!priceError}
                  aria-describedby={
                    priceError ? "product-price-error" : undefined
                  }
                  name="price"
                  mask="currency"
                  value={formData.price}
                  onFlush={(val) => {
                    // Sair do campo sem mexer também chama o onFlush: só
                    // um valor DIFERENTE tira a frase "veio da grade".
                    if (val !== formData.price) setPrecoVeioDaGrade(false);
                    setFormData((prev) => ({ ...prev, price: val }));
                  }}
                  className="w-full rounded-xl border border-emerald-500/20 bg-zinc-950 py-3 pl-11 pr-4 text-base font-black tabular-nums text-emerald-500 shadow-inner transition-all focus:outline-none focus:ring-4 focus:ring-emerald-500/10 sm:rounded-2xl sm:py-5 sm:pl-14 sm:pr-6 sm:text-lg"
                />
              </div>
              {priceError && (
                <span
                  id="product-price-error"
                  className="ml-1 mt-1 block text-[11px] font-bold text-red-500"
                >
                  {priceError}
                </span>
              )}
              {!priceError &&
                precoVeioDaGrade &&
                precoDoProdutoTexto.trim() !== "" &&
                formData.variants.length > 0 && (
                  <span
                    data-testid="preco-veio-da-grade"
                    className="ml-1 mt-1 block text-[11px] font-bold text-emerald-500"
                  >
                    Este preço veio da grade — as variações sem preço próprio
                    usam ele.
                  </span>
                )}
              {!priceError &&
                precoDoProdutoTexto.trim() === "" &&
                formData.variants.some((v) => v.priceOverride == null) && (
                  <DicaExpansivel
                    testId="preco-das-variacoes-sem-preco"
                    rotulo="Variações sem preço usam este"
                  >
                    As variações sem preço usam este.
                  </DicaExpansivel>
                )}
            </div>

            <div className="produto-campo space-y-1">
              <label
                htmlFor="product-stock"
                className="ml-1 block cursor-pointer text-[11px] font-black uppercase tracking-widest text-zinc-500"
              >
                Estoque *
              </label>
              <div className="group relative">
                <LocalBufferedInput
                  id="product-stock"
                  placeholder="Ex: 24"
                  aria-invalid={!!stockError}
                  aria-describedby={
                    hasActiveVariants
                      ? "product-stock-info"
                      : stockError
                        ? "product-stock-error"
                        : undefined
                  }
                  name="stock"
                  type="number"
                  min="0"
                  value={formData.stock}
                  onFlush={(val) =>
                    setFormData((prev) => ({ ...prev, stock: val }))
                  }
                  disabled={hasActiveVariants}
                  className="w-full rounded-xl border border-admin-border bg-zinc-950/50 px-4 py-3 text-sm font-black tabular-nums text-white transition-all focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 disabled:cursor-not-allowed disabled:text-zinc-400 disabled:opacity-50 sm:rounded-2xl sm:px-6 sm:py-5"
                />
                <div className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 text-zinc-400">
                  <Package className="size-5" />
                </div>
              </div>
              {hasActiveVariants ? (
                <DicaExpansivel
                  idDoTexto="product-stock-info"
                  rotulo={`Estoque vem das variações · ${formData.stock} un`}
                >
                  O estoque deste produto é a soma das variações ativas (
                  {formData.stock} un). Para mudar a quantidade, edite o estoque
                  de cada variação.
                </DicaExpansivel>
              ) : (
                stockError && (
                  <span
                    id="product-stock-error"
                    className="ml-1 mt-1 block text-[11px] font-bold text-red-500"
                  >
                    {stockError}
                  </span>
                )
              )}
              {hasActiveVariants && stockError && (
                <span
                  id="product-stock-error"
                  role="alert"
                  className="ml-1 mt-1 block text-[11px] font-bold text-red-500"
                >
                  {stockError}
                </span>
              )}
            </div>

            {/* Promoção (De/Por): a única parte do preço que o CLIENTE vê, por
                isso mora aqui, junto do Preço de venda, e não no cartão
                privado "Custo e lucro". Preço e Estoque dividem a linha de
                cima; este bloco ocupa a linha inteira logo abaixo deles. O
                estado (`isPromoActive`), o `id` e a validação
                (`originalPriceError`) são os de sempre: só mudou de lugar. */}
            <h2 className="produto-rotulo-secao col-span-2 -mb-1 mt-3">
              Promoção
            </h2>
            <div className="col-span-2 space-y-3">
              <label
                htmlFor="product-promo-active"
                className="flex min-h-11 cursor-pointer select-none items-center justify-between gap-3 rounded-xl border border-admin-border bg-zinc-900/40 p-2.5 transition-all hover:border-emerald-500/10 sm:rounded-2xl sm:p-3.5"
              >
                <div className="min-w-0 space-y-0.5">
                  <span className="block text-sm font-bold text-white">
                    Em promoção
                  </span>
                  <span className="block text-[11px] font-medium text-zinc-500">
                    Mostra na loja o preço de antes, riscado
                  </span>
                </div>
                <input
                  id="product-promo-active"
                  name="isPromoActive"
                  type="checkbox"
                  aria-label="Produto em Promoção"
                  checked={isPromoActive}
                  onChange={(e) => {
                    setIsPromoActive(e.target.checked);
                    if (!e.target.checked) {
                      setFormData((prev) => ({
                        ...prev,
                        originalPrice: "",
                      }));
                    }
                  }}
                  className="size-5 cursor-pointer rounded border-admin-border bg-zinc-950 text-emerald-500 transition-all focus:ring-emerald-500/20"
                />
              </label>

              {isPromoActive && (
                <div className="produto-campo space-y-1 duration-300 animate-in fade-in slide-in-from-top-2">
                  <label
                    htmlFor="product-original-price"
                    className="ml-1 block cursor-pointer text-[11px] font-black uppercase tracking-widest text-zinc-500"
                  >
                    Preço de antes ("De")
                  </label>
                  <div className="group relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm font-bold text-zinc-600 sm:left-6">
                      R$
                    </span>
                    <LocalBufferedInput
                      id="product-original-price"
                      aria-invalid={!!originalPriceError}
                      aria-describedby={
                        originalPriceError
                          ? "product-original-error"
                          : undefined
                      }
                      name="originalPrice"
                      mask="currency"
                      value={formData.originalPrice}
                      onFlush={(val) =>
                        setFormData((prev) => ({
                          ...prev,
                          originalPrice: val,
                        }))
                      }
                      placeholder="Ex: 99,90"
                      className="w-full rounded-xl border border-admin-border bg-zinc-950/50 py-3 pl-11 pr-4 text-base font-black tabular-nums text-white transition-all focus:outline-none focus:ring-2 focus:ring-emerald-500/20 sm:rounded-2xl sm:py-5 sm:pl-14 sm:pr-6 sm:text-lg"
                    />
                  </div>
                  {originalPriceError && (
                    <span
                      id="product-original-error"
                      className="ml-1 mt-1 block text-[11px] font-bold text-red-500"
                    >
                      {originalPriceError}
                    </span>
                  )}
                </div>
              )}

              {/* A prévia sai dos MESMOS números do card da loja (mesma
                  conta do selo: `Math.round((De - Por) / De * 100)`); sem
                  "De" maior que o preço, não há promoção para mostrar. */}
              {isPromoActive && priceVal > 0 && originalPriceVal > priceVal && (
                <div
                  data-testid="previa-promocao"
                  className="rounded-xl border border-admin-border bg-admin-raised px-3 py-2.5"
                >
                  <p className="text-[11px] font-medium text-zinc-500">
                    Na loja o cliente vai ver
                  </p>
                  <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span
                      className={cn(
                        "text-xl font-bold tabular-nums",
                        CLASSE_PRECO_PROMOCIONAL_FUNDO_ESCURO,
                      )}
                    >
                      {formatCurrency(priceVal)}
                    </span>
                    <span className="text-sm tabular-nums text-zinc-500 line-through">
                      {formatCurrency(originalPriceVal)}
                    </span>
                    {descontoDaPromocao > 0 && (
                      <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-bold text-emerald-300">
                        -{descontoDaPromocao}%
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>

            {formData.name && (
              <div
                data-testid="resumo-do-produto"
                className="col-span-2 mt-4 flex items-center gap-4 rounded-[20px] border border-admin-border bg-admin-raised p-3"
              >
                {formData.images[0] ? (
                  <img
                    src={formData.images[0]}
                    alt="Foto principal do produto"
                    className="h-20 w-16 shrink-0 rounded-xl object-cover"
                  />
                ) : (
                  <span className="flex h-20 w-16 shrink-0 flex-col items-center justify-center gap-1 rounded-xl bg-zinc-800 text-[11px] text-zinc-300">
                    <ImageIcon className="size-6" />
                    Sem foto
                  </span>
                )}
                <div className="min-w-0 space-y-1">
                  <p className="break-words text-base font-bold">
                    {formData.name}
                  </p>
                  <p className="text-2xl font-bold tabular-nums">
                    {formatCurrency(priceVal)}
                  </p>
                  <p className="text-xs text-zinc-400">
                    {formData.variants.length}{" "}
                    {formData.variants.length === 1 ? "variação" : "variações"}{" "}
                    · {formData.stock || "0"} un. no total
                  </p>
                </div>
              </div>
            )}

            {/* Variações (H1): MONTADA e FECHADA — o conteúdo nunca desmonta
                (SecaoRecolhivel só aplica `hidden`), então estado e botões
                seguem vivos com a seção fechada. `abertaInicial` só vale na
                montagem, e aqui basta: com `productId` o formulário mostra o
                esqueleto (`isLoading`, mais abaixo) e só monta este corpo
                DEPOIS que o produto chegou — `formData.variants` já está
                cheio na primeira montagem. Produto com variações abre
                expandido; sem variações, fechado. */}
            <h2 className="produto-rotulo-secao col-span-2 -mb-1 mt-3">
              Mais detalhes
            </h2>
            <div className="col-span-2">
              <SecaoDoProduto
                key={chaveDasVariacoes}
                titulo="Variações"
                resumo={
                  formData.variants.length === 0
                    ? "tamanho, cor, voltagem"
                    : `${variacoesAtivas} ${variacoesAtivas === 1 ? "ativa" : "ativas"} · ${formData.stock} un. · ${formData.variants.length - variacoesAtivas} ${formData.variants.length - variacoesAtivas === 1 ? "desligada" : "desligadas"}`
                }
                abertaInicial={formData.variants.length > 0}
              >
                <div className="relative space-y-4">
                  <div className="flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => toggleHelp("productVariants")}
                      className="flex min-h-11 min-w-11 shrink-0 touch-manipulation select-none items-center justify-center rounded-full active:scale-95"
                      title="Ajuda / Guia de Variações"
                    >
                      {/* O botão é a área de toque de 44px; o círculo de 32px é só o desenho. */}
                      <span
                        aria-hidden="true"
                        className={cn(
                          "flex size-8 items-center justify-center rounded-full border text-xs font-black transition-all",
                          expandedHelp.productVariants
                            ? "bg-emerald-500 border-emerald-400 text-emerald-950 shadow-md shadow-emerald-500/10 scale-110"
                            : "bg-zinc-950/50 border-admin-border text-zinc-400",
                        )}
                      >
                        ?
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        // O mesmo teto de 60 da grade vale para o "+ Novo": sem isto
                        // o 61º chegava por clique avulso. Ver `grade-de-combinacoes.ts`.
                        const recadoDoTeto = recadoDoTetoDeVariacoes(
                          formData.variants.length,
                        );
                        if (recadoDoTeto) {
                          toast.error(recadoDoTeto);
                          return;
                        }
                        setEditingVariant(null);
                        // Achado ANTES DE CRESCER da revisão: o gate do SALVAR pode
                        // ter escrito erro/aviso de duplicidade no estado do modal
                        // com ele FECHADO (a checagem das variações no submit). O
                        // reset do form abaixo não dispara o efeito limpador quando
                        // o código já estava vazio — limpar aqui garante que uma
                        // variação nova e inocente nunca abra bloqueada.
                        setVariantCodigoBarrasError("");
                        setVariantCodigoBarrasAvisoRede("");
                        setVariantFormData({
                          pares: [parNovo()],
                          sku: "",
                          codigoBarras: "",
                          stockIncrement: "0",
                          priceOverride: "",
                          active: true,
                          imageUrl: "",
                        });
                        setShowVariantForm(true);
                      }}
                      className="ml-auto mr-2 min-h-11 flex-1 rounded-2xl border border-admin-border bg-admin-raised p-3 text-sm font-bold text-white"
                    >
                      + Novo
                    </button>
                    {/* Grade de combinações: gera Cor × Tamanho (até 3 camadas) de uma
                        vez, reaproveitando os valores já usados. O "+ Novo" de uma
                        combinação só continua ao lado, intacto. */}
                    <button
                      type="button"
                      data-testid="abrir-grade"
                      onClick={() => setShowGradeForm(true)}
                      className="min-h-11 flex-1 rounded-2xl border border-admin-border bg-admin-raised p-3 text-sm font-bold text-white"
                    >
                      + Grade
                    </button>
                  </div>

                  {/* O produto ja esta no estado que mente: dois grupos de variacao.
                      A trava impede chegar aqui, mas produto antigo pode ja estar --
                      e nesse caso o numero de estoque na tela acima esta errado. Dizer
                      isso e' melhor que somar em silencio. */}
                  {produtoTemGrupoDemais && (
                    <div className="space-y-2 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
                      <p className="text-[11px] font-black uppercase tracking-widest text-amber-400">
                        Este produto tem tipos de variação demais
                      </p>
                      <p className="text-[11px] font-medium leading-relaxed text-amber-200/80">
                        Cada produto aceita <b>um tipo só</b> de variação. Com
                        mais de um, o estoque mostrado acima soma as opções em
                        dobro e o pedido do cliente guarda só metade da escolha
                        — quem pedir um P e um M recebe dois P.
                      </p>
                      <p className="text-[11px] font-medium leading-relaxed text-amber-200/80">
                        Para consertar, edite as variações abaixo e junte tudo
                        num tipo só, com as opções combinadas (ex: <i>Rosa P</i>
                        , <i>Rosa M</i>).
                      </p>
                    </div>
                  )}

                  {/* Variants Guide Section */}
                  <AnimatePresence>
                    {expandedHelp.productVariants && (
                      <AdminHelpModal
                        isOpen={true}
                        onClose={() => toggleHelp("productVariants")}
                        title="Como usar as Variações"
                        icon={Layers}
                      >
                        <div className="space-y-3 rounded-2xl border border-admin-border bg-zinc-950/40 p-4">
                          <p className="text-[11px] font-medium leading-relaxed text-zinc-400">
                            Variações permitem vender o mesmo produto com
                            diferentes opções — tamanho, cor, voltagem. Cada
                            produto aceita{" "}
                            <b className="text-zinc-350">um tipo só</b>: para
                            vender tamanho e cor juntos, combine os dois no
                            valor da opção (ex: Nome: <i>Modelo</i>, Valores:{" "}
                            <i>Rosa P</i>, <i>Rosa M</i>).
                          </p>
                          <ul className="list-none space-y-2 pl-0 text-[11px] font-medium text-zinc-500">
                            <li className="flex items-start gap-2.5">
                              <div className="mt-1.5 size-1.5 shrink-0 rounded-full bg-emerald-500" />
                              <span>
                                <b className="text-zinc-350">
                                  Atributo (Nome e Valor):
                                </b>{" "}
                                Defina a característica (ex: Nome:{" "}
                                <i>Tamanho</i>, Valor: <i>G</i>; ou Nome:{" "}
                                <i>Cor</i>, Valor: <i>Azul</i>).
                              </span>
                            </li>
                            <li className="flex items-start gap-2.5">
                              <div className="mt-1.5 size-1.5 shrink-0 rounded-full bg-emerald-500" />
                              <span>
                                <b className="text-zinc-350">
                                  Ajuste de Preço (Opcional):
                                </b>{" "}
                                Se uma variante custar mais caro (ex: tamanho
                                especial ou material premium), preencha o campo
                                de preço substituto. Se deixar em branco, o
                                preço principal do produto será usado.
                              </span>
                            </li>
                            <li className="flex items-start gap-2.5">
                              <div className="mt-1.5 size-1.5 shrink-0 rounded-full bg-emerald-500" />
                              <span>
                                <b className="text-zinc-350">
                                  Estoque da Variação:
                                </b>{" "}
                                Informe o estoque físico real desta variação —
                                não é um extra somado ao estoque do produto.
                                Assim que qualquer variação estiver ativa, o
                                estoque do produto acima passa a ser a{" "}
                                <b>soma</b> de todas as variações ativas, e o
                                campo dele fica travado enquanto isso.
                              </span>
                            </li>
                            <li className="flex items-start gap-2.5">
                              <div className="mt-1.5 size-1.5 shrink-0 rounded-full bg-emerald-500" />
                              <span>
                                <b className="text-zinc-350">
                                  Foto da Variante:
                                </b>{" "}
                                Vincule uma foto específica da variação. Quando
                                o comprador selecioná-la na página do produto, o
                                carrossel exibirá automaticamente a foto
                                correspondente.
                              </span>
                            </li>
                          </ul>
                        </div>
                      </AdminHelpModal>
                    )}
                  </AnimatePresence>

                  <div className="space-y-3">
                    {formData.variants.length === 0 ? (
                      <div className="rounded-[20px] border border-admin-border bg-admin-surface p-5 text-center">
                        <p className="text-sm font-bold text-zinc-300">
                          Nenhuma Variação Adicionada
                        </p>
                      </div>
                    ) : (
                      formData.variants.map((v) => (
                        <VariantItem
                          key={v.id}
                          variant={v}
                          onEdit={handleEditVariant}
                          onDelete={handleDeleteVariant}
                          onToggleActive={handleToggleVariantActive}
                        />
                      ))
                    )}
                  </div>
                </div>
              </SecaoDoProduto>
            </div>

            <div className="col-span-2">
              {/* Custo e lucro (H1): o Preço de venda subiu para o básico; aqui
            ficam só o custo e a análise de lucro (a promoção De/Por, que o
            CLIENTE vê, mora junto do Preço de venda). MONTADA e
            FECHADA; um erro de validação dentro dela a abre sozinha. O AVISO
            de custo maior que o preço não é erro (não bloqueia o salvar), por
            isso não força a abertura. */}
              <SecaoDoProduto
                titulo="Custo e lucro"
                aviso={avisoDeCusto}
                resumo={
                  priceVal > 0 && costPriceVal > 0
                    ? `Lucro ${formatCurrency(priceVal - costPriceVal)} · margem ${percentualComUmaCasa(marginPct)}`
                    : "opcional"
                }
                temErro={!!costError && !costError.startsWith("Aviso")}
              >
                <div className="relative space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => toggleHelp("productPricing")}
                        className="flex min-h-11 min-w-11 shrink-0 touch-manipulation select-none items-center justify-center rounded-full active:scale-95"
                        title="Ajuda / Guia de Precificação"
                      >
                        {/* O botão é a área de toque de 44px; o círculo de 32px é só o desenho. */}
                        <span
                          aria-hidden="true"
                          className={cn(
                            "flex size-8 items-center justify-center rounded-full border text-xs font-black transition-all",
                            expandedHelp.productPricing
                              ? "bg-emerald-500 border-emerald-400 text-emerald-950 shadow-md shadow-emerald-500/10 scale-110"
                              : "bg-zinc-950/50 border-admin-border text-zinc-400",
                          )}
                        >
                          ?
                        </span>
                      </button>
                    </div>
                  </div>

                  {/* Pricing Guide Section */}
                  <AnimatePresence>
                    {expandedHelp.productPricing && (
                      <AdminHelpModal
                        isOpen={true}
                        onClose={() => toggleHelp("productPricing")}
                        title="Guia de Custos e Margens"
                        icon={DollarSign}
                      >
                        <div className="space-y-4 rounded-2xl border border-admin-border bg-zinc-950/40 p-5">
                          <p className="text-[11px] font-medium leading-relaxed text-zinc-400">
                            Configure os preços de forma estratégica. O sistema
                            calcula a lucratividade automaticamente em tempo
                            real.
                          </p>
                          <ul className="list-none space-y-3 pl-0 text-[11px] font-medium text-zinc-500">
                            <li className="flex items-start gap-2.5">
                              <div className="mt-1.5 size-1.5 shrink-0 rounded-full bg-emerald-500" />
                              <span>
                                <b className="text-zinc-350">
                                  Preço de Custo (Opcional):
                                </b>{" "}
                                O valor total que você pagou para adquirir ou
                                fabricar o produto. Esse dado é estritamente
                                confidencial e é usado apenas pelo sistema para
                                calcular a margem e o lucro exibidos abaixo.
                              </span>
                            </li>
                            <li className="flex items-start gap-2.5">
                              <div className="mt-1.5 size-1.5 shrink-0 rounded-full bg-emerald-500" />
                              <span>
                                <b className="text-zinc-350">Preço de Venda:</b>{" "}
                                O preço final cobrado do cliente. Pense em
                                embutir custos fixos, impostos e taxas para
                                manter sua operação saudável.
                              </span>
                            </li>
                            <li className="flex items-start gap-2.5">
                              <div className="mt-1.5 size-1.5 shrink-0 rounded-full bg-emerald-500" />
                              <span>
                                <b className="text-zinc-350">
                                  Painel de Lucratividade:
                                </b>{" "}
                                O sistema analisa a diferença entre o preço de
                                venda e o preço de custo. É recomendada uma
                                margem de lucro de pelo menos 30%. Abaixo disso
                                aparece “Lucro baixo”; com custo igual ao preço,
                                “Sem lucro”; com custo maior que o preço,
                                “Prejuízo”.
                              </span>
                            </li>
                          </ul>
                        </div>
                      </AdminHelpModal>
                    )}
                  </AnimatePresence>

                  <div className="grid grid-cols-1 gap-3">
                    <div className="produto-campo space-y-1.5">
                      <label
                        htmlFor="product-cost-price"
                        className="ml-1 block cursor-pointer text-[11px] font-black uppercase tracking-widest text-zinc-500"
                      >
                        Preço de Custo
                      </label>
                      <div className="group relative">
                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm font-bold text-zinc-600 sm:left-6">
                          R$
                        </span>
                        <LocalBufferedInput
                          id="product-cost-price"
                          aria-invalid={
                            !!costError && !costError.startsWith("Aviso")
                          }
                          aria-describedby={
                            costError ? "product-cost-error" : undefined
                          }
                          name="costPrice"
                          mask="currency"
                          zeroVazio
                          value={formData.costPrice}
                          onFlush={(val) =>
                            setFormData((prev) => ({ ...prev, costPrice: val }))
                          }
                          className="w-full rounded-xl border border-admin-border bg-zinc-950/50 py-3 pl-11 pr-4 text-base font-black tabular-nums text-white transition-all focus:outline-none focus:ring-2 focus:ring-emerald-500/20 sm:rounded-2xl sm:py-5 sm:pl-14 sm:pr-6 sm:text-lg"
                        />
                      </div>
                      {costError && (
                        <span
                          id="product-cost-error"
                          className={cn(
                            "text-[11px] font-bold mt-1 ml-1 block",
                            costError.includes("Aviso")
                              ? "text-amber-500"
                              : "text-red-500",
                          )}
                        >
                          {costError}
                        </span>
                      )}
                    </div>
                  </div>

                  {priceVal > 0 && costPriceVal > 0 && (
                    <div className="space-y-4 rounded-[20px] border border-admin-border bg-admin-raised p-4">
                      <div
                        className={cn(
                          "flex flex-wrap items-end justify-between gap-3",
                          corDoLucro,
                        )}
                      >
                        <div>
                          <p className="text-xs text-zinc-400">
                            Lucro por unidade
                          </p>
                          <p className="mt-1 text-xl font-bold tabular-nums">
                            {formatCurrency(priceVal - costPriceVal)}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs text-zinc-400">Margem</p>
                          <p className="mt-1 text-xl font-bold tabular-nums">
                            {percentualComUmaCasa(marginPct)}
                          </p>
                        </div>
                      </div>
                      <div
                        className="h-2 overflow-hidden rounded-full bg-zinc-800"
                        aria-hidden="true"
                      >
                        <div
                          className={`h-full rounded-full ${marginPct >= 30 ? "bg-emerald-400" : "bg-orange-400"}`}
                          style={{
                            width: `${Math.min(100, Math.max(0, marginPct))}%`,
                          }}
                        />
                      </div>
                      <p className={`text-xs ${corDoLucro}`}>
                        Análise do Sistema · {analiseDoLucro}
                      </p>
                    </div>
                  )}
                </div>
              </SecaoDoProduto>
            </div>

            {/* Peso e medidas (H1): MONTADA e FECHADA. Com entrega local a
                seção nem existe — como o campo já não existia. */}
            {!isLocalShipping && (
              <div className="col-span-2">
                <SecaoDoProduto
                  titulo="Peso e medidas"
                  resumo={
                    formData.weightKg &&
                    formData.widthCm &&
                    formData.heightCm &&
                    formData.lengthCm
                      ? `${formData.weightKg} kg · ${formData.widthCm} × ${formData.heightCm} × ${formData.lengthCm} cm`
                      : "para o frete"
                  }
                >
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                      <div className="space-y-1">
                        <label
                          htmlFor="product-weight"
                          className="ml-1 block cursor-pointer text-[11px] font-black uppercase tracking-wider text-zinc-500"
                        >
                          Peso (kg)
                        </label>
                        <LocalBufferedInput
                          id="product-weight"
                          name="weightKg"
                          type="number"
                          step="0.001"
                          min="0"
                          placeholder="Ex.: 0,350"
                          value={formData.weightKg}
                          onFlush={(val) =>
                            setFormData((prev) => ({ ...prev, weightKg: val }))
                          }
                          className="w-full rounded-lg border border-admin-border bg-zinc-950/50 px-3 py-2.5 text-xs font-bold text-white transition-all focus:outline-none focus:ring-2 focus:ring-emerald-500/20 sm:rounded-xl sm:px-4 sm:py-3.5"
                        />
                        {pesoEmGramasTalvez && (
                          <span
                            id="product-weight-aviso"
                            role="status"
                            className="ml-1 block text-[11px] font-medium text-amber-300"
                          >
                            Isso é mais de 30 kg. Se você quis dizer gramas,
                            digite {pesoEmGramasTalvez.kg} para{" "}
                            {pesoEmGramasTalvez.g} g.
                          </span>
                        )}
                      </div>
                      <div className="space-y-1">
                        <label
                          htmlFor="product-width"
                          className="ml-1 block cursor-pointer text-[11px] font-black uppercase tracking-wider text-zinc-500"
                        >
                          Largura (cm)
                        </label>
                        <LocalBufferedInput
                          id="product-width"
                          name="widthCm"
                          type="number"
                          min="0"
                          placeholder="Ex: 15"
                          value={formData.widthCm}
                          onFlush={(val) =>
                            setFormData((prev) => ({ ...prev, widthCm: val }))
                          }
                          className="w-full rounded-lg border border-admin-border bg-zinc-950/50 px-3 py-2.5 text-xs font-bold text-white transition-all focus:outline-none focus:ring-2 focus:ring-emerald-500/20 sm:rounded-xl sm:px-4 sm:py-3.5"
                        />
                      </div>
                      <div className="space-y-1">
                        <label
                          htmlFor="product-height"
                          className="ml-1 block cursor-pointer text-[11px] font-black uppercase tracking-wider text-zinc-500"
                        >
                          Altura (cm)
                        </label>
                        <LocalBufferedInput
                          id="product-height"
                          name="heightCm"
                          type="number"
                          min="0"
                          placeholder="Ex: 15"
                          value={formData.heightCm}
                          onFlush={(val) =>
                            setFormData((prev) => ({ ...prev, heightCm: val }))
                          }
                          className="w-full rounded-lg border border-admin-border bg-zinc-950/50 px-3 py-2.5 text-xs font-bold text-white transition-all focus:outline-none focus:ring-2 focus:ring-emerald-500/20 sm:rounded-xl sm:px-4 sm:py-3.5"
                        />
                      </div>
                      <div className="space-y-1">
                        <label
                          htmlFor="product-length"
                          className="ml-1 block cursor-pointer text-[11px] font-black uppercase tracking-wider text-zinc-500"
                        >
                          Comprimento (cm)
                        </label>
                        <LocalBufferedInput
                          id="product-length"
                          name="lengthCm"
                          type="number"
                          min="0"
                          placeholder="Ex: 15"
                          value={formData.lengthCm}
                          onFlush={(val) =>
                            setFormData((prev) => ({ ...prev, lengthCm: val }))
                          }
                          className="w-full rounded-lg border border-admin-border bg-zinc-950/50 px-3 py-2.5 text-xs font-bold text-white transition-all focus:outline-none focus:ring-2 focus:ring-emerald-500/20 sm:rounded-xl sm:px-4 sm:py-3.5"
                        />
                      </div>
                    </div>
                    <span className="block text-[11px] font-medium leading-normal text-zinc-400">
                      * O peso e as dimensões da embalagem individual são
                      utilizados para a cotação de frete automática
                      (Correios/Melhor Envio/Frenet). Se não informados, o
                      sistema utilizará valores padrão (0,3 kg e 15x15x15 cm).
                    </span>
                  </div>
                </SecaoDoProduto>
              </div>
            )}
            <div className="col-span-2">
              {/* Códigos e câmera: código interno, código de barras e aviso de estoque
            — raros no dia a dia, mas nada se apaga. MONTADA e FECHADA; erro
            em qualquer um dos três (formato, duplicidade ou número inválido)
            a abre sozinha. */}
              <SecaoDoProduto
                titulo="Códigos e câmera"
                aviso={avisoDosCodigos}
                resumo={
                  formData.sku
                    ? `${formData.sku} · aviso em ${formData.estoqueMinimo || "5"} un.`
                    : "Código interno, código de barras e aviso de estoque"
                }
                temErro={
                  !!skuError || !!codigoBarrasError || !!estoqueMinimoError
                }
              >
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-6">
                  <CodigoDoProduto
                    automatico={skuAutomatico}
                    onAlternar={alternarSkuAutomatico}
                    codigoGerado={codigoAuto}
                    onOutro={gerarOutroSku}
                    valorManual={formData.sku}
                    onManual={(val) =>
                      setFormData((prev) => ({ ...prev, sku: val }))
                    }
                    erro={skuError}
                    rotuloDoCampo="Código interno (SKU)"
                  />

                  <div className="space-y-1.5 md:space-y-3">
                    <label
                      htmlFor="product-codigo-barras"
                      className="ml-1 text-[11px] font-black uppercase tracking-widest text-zinc-500"
                    >
                      Código de barras
                    </label>
                    {/* No celular o botão desce para baixo do campo: lado a lado,
                  os 13 dígitos não cabiam (onda J). */}
                    <div className="flex flex-col gap-2 xs:flex-row">
                      <LocalBufferedInput
                        id="product-codigo-barras"
                        aria-invalid={!!codigoBarrasError}
                        aria-describedby={
                          codigoBarrasError
                            ? "product-barcode-error"
                            : undefined
                        }
                        name="product-codigo-barras"
                        type="text"
                        inputMode="numeric"
                        data-testid="codigo-barras-produto"
                        value={formData.codigoBarras}
                        onFlush={(val) =>
                          setFormData((prev) => ({
                            ...prev,
                            codigoBarras: normalizarCodigoBarras(val),
                          }))
                        }
                        onBlur={(e) =>
                          aoSairDoCampoDeCodigoDeBarras(
                            e.target.value,
                            "produto",
                          )
                        }
                        placeholder="Ex: 7891234567890"
                        className="w-full rounded-xl border border-admin-border bg-zinc-950/50 px-4 py-3 font-mono text-sm font-black tabular-nums text-white transition-all placeholder:text-zinc-800 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 sm:rounded-2xl sm:px-6 sm:py-5"
                      />
                      {/* C5.3 — some sem câmera: o leitor físico USB digita direto
                    no campo acima, sem precisar deste botão. */}
                      {temCameraDisponivel() && (
                        <button
                          type="button"
                          onClick={() => setLeitorAberto("produto")}
                          className="flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 text-[11px] font-black uppercase tracking-widest text-emerald-500 transition-all hover:bg-emerald-500 hover:text-emerald-950 active:scale-95 sm:rounded-2xl"
                          title="Ler com a câmera"
                        >
                          <Camera className="size-4" />
                          Ler com a câmera
                        </button>
                      )}
                    </div>
                    <span className="ml-1 mt-1 block text-[11px] leading-tight text-zinc-400">
                      Opcional. É o código impresso na embalagem; a tela Vender
                      lê ele pela câmera.
                    </span>
                    {codigoBarrasError && (
                      <span
                        id="product-barcode-error"
                        className="ml-1 mt-1 block text-[11px] font-bold text-red-500"
                      >
                        {codigoBarrasError}
                      </span>
                    )}
                    {!codigoBarrasError && codigoBarrasAvisoRede && (
                      <span className="ml-1 mt-1 block text-[11px] font-bold text-amber-500">
                        {codigoBarrasAvisoRede}
                      </span>
                    )}
                  </div>

                  <div className="space-y-1.5 md:space-y-3">
                    <label
                      htmlFor="product-estoque-minimo"
                      className="ml-1 text-[11px] font-black uppercase tracking-widest text-zinc-500"
                    >
                      Avisar quando o estoque chegar a
                    </label>
                    <LocalBufferedInput
                      id="product-estoque-minimo"
                      name="product-estoque-minimo"
                      type="number"
                      min="0"
                      step="1"
                      inputMode="numeric"
                      value={formData.estoqueMinimo}
                      onFlush={(val) =>
                        setFormData((prev) => ({ ...prev, estoqueMinimo: val }))
                      }
                      placeholder="Ex: 5"
                      aria-invalid={estoqueMinimoError ? true : undefined}
                      aria-describedby={
                        estoqueMinimoError
                          ? "product-estoque-minimo-dica product-estoque-minimo-erro"
                          : "product-estoque-minimo-dica"
                      }
                      className="w-full rounded-xl border border-admin-border bg-zinc-950/50 px-4 py-3 text-sm font-black text-white transition-all placeholder:text-zinc-800 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 sm:rounded-2xl sm:px-6 sm:py-5"
                    />
                    <span
                      id="product-estoque-minimo-dica"
                      className="ml-1 mt-1 block text-[11px] leading-tight text-zinc-400"
                    >
                      Vazio usa o padrão (5). Com variações, vale para a soma.
                    </span>
                    {estoqueMinimoError && (
                      <span
                        id="product-estoque-minimo-erro"
                        className="ml-1 mt-1 block text-[11px] font-bold text-red-500"
                      >
                        {estoqueMinimoError}
                      </span>
                    )}
                  </div>
                </div>
              </SecaoDoProduto>
            </div>

            <div className="col-span-2">
              {/* Na loja: três chaves que o modelo já tinha e o salvar já gravava
            (`ativo`, `is_bestseller`, `frete_gratis`) — só não tinham tela.
            MONTADA e FECHADA, como as outras. */}
              <SecaoDoProduto
                titulo="Na loja"
                resumo={[
                  formData.isActive ? "Aparece na loja" : "Escondido da loja",
                  formData.isBestseller ? "Em destaque" : null,
                  formData.freeShipping ? "Frete grátis" : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              >
                <div className="space-y-1">
                  <InterruptorDoProduto
                    rotulo="Aparece na loja"
                    descricao="Desligue para guardar o produto sem mostrar aos clientes."
                    ligado={formData.isActive}
                    onAlternar={() =>
                      setFormData((prev) => ({
                        ...prev,
                        isActive: !prev.isActive,
                      }))
                    }
                  />
                  <InterruptorDoProduto
                    rotulo="Em destaque"
                    descricao="Mostra o selo “Em alta” e põe o produto na vitrine de destaques."
                    ligado={formData.isBestseller}
                    onAlternar={() =>
                      setFormData((prev) => ({
                        ...prev,
                        isBestseller: !prev.isBestseller,
                      }))
                    }
                  />
                  <InterruptorDoProduto
                    rotulo="Frete grátis neste produto"
                    descricao="Marca o produto para a regra “Só produtos marcados” do frete."
                    ligado={formData.freeShipping}
                    onAlternar={() =>
                      setFormData((prev) => ({
                        ...prev,
                        freeShipping: !prev.freeShipping,
                      }))
                    }
                  >
                    {formData.freeShipping && freteDeProdutoSemEfeito ? (
                      <p
                        data-testid="aviso-frete-por-produto"
                        role="status"
                        className="mt-2 flex items-start gap-2 px-1 text-xs text-amber-300"
                      >
                        <AlertTriangle
                          aria-hidden="true"
                          className="mt-0.5 size-4 shrink-0"
                        />
                        Hoje a loja não usa “Só produtos marcados”. A marca fica
                        guardada, mas só vale quando você escolher essa regra em{" "}
                        {NOMES_DO_PAINEL["admin-shipping"]}.
                      </p>
                    ) : null}
                  </InterruptorDoProduto>
                </div>
              </SecaoDoProduto>
            </div>
          </div>
        </section>
        {/* O guia "Como cadastrar um produto" já tem o botão "?" do
            cabeçalho (o mesmo `setShowHelpModal`): aqui só resta o ID. */}
        {productId && (
          <p className="break-all text-[11px] text-zinc-400">
            Número no sistema · {productId}
          </p>
        )}
      </motion.form>

      {/* Image Cropper Modal */}
      <AnimatePresence>
        {isAdjusterOpen && (
          <ImageAdjuster
            isOpen={isAdjusterOpen}
            onClose={() => {
              setIsAdjusterOpen(false);
              setAdjustingImgIndex(null);
            }}
            imageUrl={adjustingImgUrl}
            onConfirm={handleAdjustConfirm}
            isSubmitting={isUploadingAdjusted}
          />
        )}
      </AnimatePresence>

      <AcaoDaBarra aria-label="Ações do produto">
        <div className="produto-acoes mx-auto w-full max-w-3xl space-y-1.5">
          {precisaRecarregar && (
            <p
              data-testid="precisa-recarregar"
              role="status"
              className="produto-status flex flex-wrap items-center gap-x-2 px-1 text-xs font-medium text-amber-300"
            >
              <AlertTriangle className="size-4 shrink-0 text-amber-400" />
              <span>Recarregue a tela antes de salvar de novo.</span>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="min-h-11 rounded-full bg-admin-raised px-4 text-xs font-bold text-white"
              >
                Recarregar
              </button>
            </p>
          )}
          {motivoDoBloqueio && !precisaRecarregar && (
            <p
              data-testid="motivo-do-bloqueio"
              role="status"
              className="produto-status flex items-center gap-2 px-1 text-xs font-bold text-amber-300"
            >
              <AlertTriangle className="size-4 shrink-0 text-amber-400" />
              {/* UMA frase curta na tela; a frase completa (com a lista do que
                falta) fica no texto só-para-leitor de tela e no título. Com
                erro num CAMPO (e não foto subindo), a frase vira um botão que
                leva até o campo — abre a seção recolhida onde o erro ficou
                escondido e põe o foco nele. O botão de salvar continua
                desligado; isto só mostra o caminho. */}
              {!isImageUploading && idDoCampoDoBloqueio() ? (
                <button
                  type="button"
                  title={motivoDoBloqueio}
                  onClick={() => {
                    const id = idDoCampoDoBloqueio();
                    if (id) mostrarEFocarCampo(id);
                  }}
                  className="-my-3.5 min-h-11 min-w-0 truncate text-left font-bold"
                >
                  <span className="sr-only">{motivoDoBloqueio}</span>
                  <span aria-hidden="true">
                    {fraseCurtaDaBarra} · toque para ver
                  </span>
                </button>
              ) : (
                <span title={motivoDoBloqueio} className="min-w-0 truncate">
                  <span className="sr-only">{motivoDoBloqueio}</span>
                  <span aria-hidden="true">{fraseCurtaDaBarra}</span>
                </span>
              )}
            </p>
          )}
          {!motivoDoBloqueio && !isOffline && !precisaRecarregar && (
            <p
              className="produto-status flex items-center gap-2 px-1 text-xs font-bold text-emerald-300"
              role="status"
            >
              <Check aria-hidden="true" className="size-4 shrink-0" />
              {showSuccess
                ? "Salvo · voltando à lista"
                : isSubmitting
                  ? "Salvando alterações…"
                  : productId
                    ? "Alterações prontas para salvar"
                    : "Tudo pronto para publicar"}
            </p>
          )}
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
            {/* O botão cinza não recebe toque (pointer-events: none): o toque
                cai neste invólucro e leva ao primeiro campo que falta. Pelo
                teclado, o caminho é a frase acima (botão de verdade). */}
            <div
              role="presentation"
              className="min-w-0"
              onClick={() => {
                if (!botaoDeSalvarDesligado || isImageUploading) return;
                const id = idDoCampoDoBloqueio();
                if (id) mostrarEFocarCampo(id);
              }}
            >
              <button
                type="button"
                onClick={() => handleSubmit()}
                disabled={botaoDeSalvarDesligado}
                className="produto-salvar flex min-h-11 w-full min-w-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-3 text-base font-bold transition-colors disabled:pointer-events-none"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="size-5 animate-spin" />
                    Salvando...
                  </>
                ) : showSuccess ? (
                  <>
                    <Check className="size-5" />
                    Salvo
                  </>
                ) : isOffline ? (
                  <>
                    <AlertTriangle className="size-5" />
                    Offline
                  </>
                ) : (
                  <>
                    {productId ? (
                      <Check className="size-5" />
                    ) : (
                      <Plus className="size-5" />
                    )}
                    {productId ? "Salvar alterações" : "Publicar"}
                  </>
                )}
              </button>
            </div>
            <button
              type="button"
              onClick={() => setIsPreviewOpen(true)}
              className="produto-prever flex min-h-11 min-w-11 items-center justify-center rounded-full border border-solid border-admin-border-strong bg-admin-surface px-4 text-sm font-bold"
            >
              Ver app
            </button>
          </div>
        </div>
      </AcaoDaBarra>

      {/* Live Preview Fullscreen Modal */}
      <AnimatePresence>
        {isPreviewOpen && (
          <PhoneSimulator
            onClose={() => setIsPreviewOpen(false)}
            formData={formData}
            previewMode={previewMode}
            setPreviewMode={setPreviewMode}
            previewImgIndex={previewImgIndex}
            setPreviewImgIndex={setPreviewImgIndex}
            previewSelectedVariants={previewSelectedVariants}
            setPreviewSelectedVariants={setPreviewSelectedVariants}
            activeDetailTab={activeDetailTab}
            setActiveDetailTab={setActiveDetailTab}
          />
        )}
      </AnimatePresence>
      {/* Modal de Ajuda */}
      <AdminHelpModal
        isOpen={showHelpModal}
        onClose={() => setShowHelpModal(false)}
        title="Como cadastrar um produto"
      >
        <div className="space-y-4">
          <p className="text-xs leading-relaxed text-zinc-400">
            Nesta tela você pode cadastrar novos produtos ou editar produtos
            existentes no catálogo da sua loja. Preencha os campos com atenção
            para garantir a melhor experiência para os compradores.
          </p>

          <div className="space-y-3">
            <h4 className="border-l-2 border-blue-400 pl-2 text-xs font-bold text-zinc-400">
              Estrutura do Formulário
            </h4>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1 rounded-2xl border border-admin-border bg-zinc-900/40 p-4">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
                  <Package className="size-4 text-emerald-500" />
                  Informações Básicas & Código interno
                </div>
                <p className="text-xs text-zinc-400">
                  Nome do produto, descrição detalhada e o{" "}
                  <strong className="text-white">Código interno</strong>{" "}
                  (referência livre, em Códigos e câmera; só o código interno de
                  cada variação precisa ser único). O{" "}
                  <strong className="text-white">Código de Barras</strong> é
                  opcional, identifica a embalagem física, precisa ser único no
                  catálogo inteiro e é o que a tela Vender lê no balcão.
                </p>
              </div>

              <div className="space-y-1 rounded-2xl border border-admin-border bg-zinc-900/40 p-4">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
                  <DollarSign className="size-4 text-emerald-300" />
                  Custo e lucro
                </div>
                <p className="text-xs text-zinc-400">
                  Configure o preço de venda e o custo unitário. O sistema
                  calcula automaticamente o lucro (preço de venda menos custo) e
                  a margem.
                </p>
              </div>

              <div className="space-y-1 rounded-2xl border border-admin-border bg-zinc-900/40 p-4">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
                  <Layers className="size-4 text-sky-500" />
                  Variações
                </div>
                <p className="text-xs text-zinc-400">
                  Adicione variantes (como cores, tamanhos ou voltagens) com
                  estoques separados e possíveis acréscimos ou descontos de
                  preço.
                </p>
              </div>

              <div className="space-y-1 rounded-2xl border border-admin-border bg-zinc-900/40 p-4">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
                  <ShieldCheck className="size-4 text-purple-500" />
                  Fotos
                </div>
                <p className="text-xs text-zinc-400">
                  Adicione fotos e organize a galeria de imagens para a vitrine
                  do produto.
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <h4 className="border-l-2 border-blue-400 pl-2 text-xs font-bold text-zinc-400">
              Dicas para um Cadastro de Sucesso
            </h4>
            <ul className="list-inside list-disc space-y-2 text-xs text-zinc-400">
              <li>
                Use fotos de alta qualidade com fundo claro ou neutro (formato
                4:5; use o recorte Vitrine).
              </li>
              <li>
                Descreva detalhadamente o produto, incluindo dimensões,
                materiais e políticas de garantia.
              </li>
              <li>
                O código interno do produto é livre — a loja não te impede de
                repetir (é só uma referência sua). Já o código interno de cada
                VARIAÇÃO precisa ser único: o sistema recusa salvar um que já
                exista em qualquer outra variação já cadastrada (inclusive de
                produtos excluídos).
              </li>
              <li>
                O Código de Barras (opcional) identifica a EMBALAGEM física do
                produto — diferente do código interno, que é uso interno seu.
                Ele precisa ser único no catálogo inteiro (o mesmo código não
                pode estar em outro produto ou variação) e é o que a tela Vender
                lê no balcão. Se o produto tem variações, cadastre o código em
                CADA variação: a caixa da PP tem um código diferente da caixa da
                M.
              </li>
            </ul>
          </div>
        </div>
      </AdminHelpModal>

      {/* Diálogo de Confirmação de Exclusão de Variante */}
      <AlertDialog
        open={variantToDelete !== null}
        onOpenChange={(open) => !open && setVariantToDelete(null)}
      >
        <AlertDialogContent className="max-w-md rounded-3xl border border-admin-border bg-zinc-950">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-lg font-bold text-white">
              Excluir variante?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-xs text-zinc-400">
              Tem certeza que deseja excluir esta variante? Ela será removida da
              lista. Para guardar essa alteração no sistema, você precisa salvar
              o formulário do produto.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-4 gap-2">
            <AlertDialogCancel className="min-h-11 rounded-xl border border-0 border-admin-border bg-white/5 px-4 py-2 text-xs font-bold text-zinc-400 hover:bg-white/10 hover:text-white">
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeleteVariant}
              className="min-h-11 rounded-xl border-0 bg-red-600 px-4 py-2 text-xs font-bold text-white hover:bg-red-700"
            >
              Excluir Variante
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* C5.3 — o leitor só existe no DOM enquanto está aberto, e entra num
          OVERLAY FIXO acima dos modais desta tela (z-[120] vence o z-[110]
          do modal de categoria e o z-[100] do modal de variação). Sem isto o
          painel nasceria no fim do fluxo da página — fora da vista no alvo
          produto e ATRÁS do overlay do modal de variação, invisível e
          inclicável (achado BLOQUEIA da revisão em contexto limpo; o jsdom
          não faz empilhamento, por isso a prova é o teste estrutural do
          container). O `Suspense` segura o import dinâmico, com
          `fallback={null}` porque a abertura já é o clique do lojista. */}
      {leitorAberto !== null && (
        <div
          data-testid="container-do-leitor"
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/80 p-4"
        >
          <Suspense fallback={null}>
            <LeitorDeCodigo
              aberto
              modo="unico"
              titulo="Ler o código de barras"
              dica="Aponte para o código da embalagem"
              aoLer={aoLerCodigoDeBarras}
              aoFechar={() => setLeitorAberto(null)}
            />
          </Suspense>
        </div>
      )}
    </div>
  );
});

/**
 * Uma instância do formulário POR produto (`productId` na `key`). O painel
 * troca "novo" por "edição de p-1" na mesma view, sem desmontar: sem a `key`,
 * os estados de produto novo (formulário preenchido, `isLoading` falso, rascunho
 * já "checado") vazariam para a edição e a checagem de rascunho de edição
 * compararia com o formulário velho -- e apagaria o rascunho recém-movido.
 */
export const AdminProductFormView = React.memo(function AdminProductFormView(
  props: AdminProductFormViewProps,
) {
  return <FormularioDoProduto key={props.productId ?? "novo"} {...props} />;
});

interface VariantItemProps {
  readonly variant: ProductVariant;
  readonly onEdit: (v: ProductVariant) => void;
  readonly onDelete: (id: string) => void;
  readonly onToggleActive: (v: ProductVariant) => void;
}

const VariantItem = React.memo(function VariantItem({
  variant,
  onEdit,
  onDelete,
  onToggleActive,
}: VariantItemProps) {
  return (
    <div className="group relative flex flex-wrap items-center gap-3 rounded-[20px] border border-admin-border bg-admin-surface p-3">
      <div className="flex w-full min-w-0 items-center gap-3 pr-12">
        {variant.imageUrl && (
          <div className="h-16 w-12 shrink-0 overflow-hidden rounded-xl border border-admin-border">
            <LazyImage
              src={variant.imageUrl}
              alt={`${variant.name}: ${variant.value}`}
              className="size-full object-cover"
            />
          </div>
        )}
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span
              data-testid="variante-cadastrada"
              className="min-w-0 break-words text-sm font-bold text-white"
            >
              {variant.name}: {variant.value}
            </span>
            {!variant.active && (
              <span className="rounded border border-admin-border bg-zinc-800 px-1.5 py-0.5 text-[11px] font-black uppercase text-zinc-500">
                Desligada
              </span>
            )}
            {variant.active && (
              <span className="text-xs text-emerald-300">Ativa</span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] font-black uppercase tracking-tighter text-zinc-500">
            <span className="flex items-center gap-1.5 rounded-md border border-admin-border bg-white/5 px-2 py-1">
              <Package className="size-3 text-zinc-400" />
              <span className="text-zinc-300">
                {variant.stockIncrement} un.
              </span>
            </span>
            {/* `!= null`, não verdade: o 0 é um preço próprio (brinde) e
                `{0 && ...}` desenharia só o algarismo solto. */}
            {variant.priceOverride != null && (
              <span
                data-testid="preco-proprio-da-variacao"
                className={cn(
                  "flex items-center gap-1.5 rounded-md border px-2 py-1",
                  variant.priceOverride === 0
                    ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
                    : "border-emerald-500/20 bg-emerald-500/10 text-emerald-500",
                )}
              >
                <DollarSign className="size-3" />
                {variant.priceOverride === 0
                  ? "R$ 0,00 — de graça na loja"
                  : formatCurrency(Number(variant.priceOverride))}
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="flex w-full items-center gap-2">
        <button
          type="button"
          onClick={() => onEdit(variant)}
          aria-label={`Editar variação ${variant.value}`}
          className="absolute right-3 top-3 flex size-11 items-center justify-center rounded-2xl border border-admin-border bg-blue-400/10 text-blue-300"
        >
          <Edit2 className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={() => onToggleActive(variant)}
          aria-label={`${variant.active ? "Desligar" : "Religar"} variação ${variant.value}`}
          title={
            variant.active
              ? "Desligar: deixa de aparecer na loja, volta quando religar"
              : "Religar: volta a aparecer na loja"
          }
          className={cn(
            "flex size-11 min-h-11 flex-1 items-center justify-center gap-2 rounded-2xl border border-admin-border bg-admin-raised px-2 text-xs font-bold",
            variant.active
              ? "text-zinc-300 hover:text-white"
              : "text-zinc-600 hover:text-white",
          )}
        >
          <Power className="size-4 shrink-0" />
          {variant.active ? "Desligar" : "Religar"}
        </button>
        <button
          type="button"
          onClick={() => onDelete(variant.id)}
          aria-label={`Excluir variação ${variant.value}`}
          className="flex size-11 min-h-11 flex-1 items-center justify-center gap-2 rounded-2xl border border-admin-border bg-admin-raised px-2 text-xs font-bold text-rose-300"
        >
          <Trash2 className="size-4 shrink-0" />
          Excluir variação
        </button>
      </div>
    </div>
  );
});
