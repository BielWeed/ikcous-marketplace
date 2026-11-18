import { dataLocal } from "@/lib/data-local-csv";
import { hojeEmSaoPaulo } from "@/lib/financeiro";
import type { Product } from "@/types";

export type CelulaDoProduto = string | number;
export async function lerCatalogoInteiro(
  lerPagina: (
    pagina: number,
  ) => Promise<{ products: Product[]; total: number }>,
): Promise<Product[]> {
  const produtos: Product[] = [];
  const ids = new Set<string>();
  let total: number | undefined;
  for (let pagina = 0; ; pagina++) {
    const resposta = await lerPagina(pagina);
    total ??= resposta.total;
    if (
      !Number.isSafeInteger(total) ||
      total < 0 ||
      total !== resposta.total ||
      (resposta.products.length === 0 && produtos.length < total)
    ) {
      throw new Error("O catálogo mudou durante a leitura. Tente novamente.");
    }
    for (const produto of resposta.products) {
      if (!produto.id || ids.has(produto.id))
        throw new Error("O catálogo mudou durante a leitura. Tente novamente.");
      ids.add(produto.id);
      produtos.push(produto);
    }
    if (produtos.length === total) return produtos;
    if (produtos.length > total)
      throw new Error("Não foi possível conferir o catálogo.");
  }
}

interface OpcoesDaPlanilha {
  conta: string;
  nomeLoja: string;
  comCustos: boolean;
  sinal: AbortSignal;
  podeContinuar: () => boolean;
}

export async function exportarProdutosPlanilha(
  opcoes: OpcoesDaPlanilha,
): Promise<"xlsx" | "csv"> {
  const [
    { supabase },
    { mapProductFromDB },
    { aguardarComPrazo, PRAZO_DA_CONSULTA_DO_PAINEL_MS },
    { sessaoAindaEhDoDono },
  ] = await Promise.all([
    import("@/lib/supabase"),
    import("@/lib/mappers"),
    import("@/lib/prazo-da-requisicao"),
    import("@/lib/sessao-ainda-e-do-dono"),
  ]);
  const conferir = async () => {
    const sessaoValida = await aguardarComPrazo(
      sessaoAindaEhDoDono(opcoes.conta),
      PRAZO_DA_CONSULTA_DO_PAINEL_MS,
      () => new Error("A sessão não respondeu."),
    );
    opcoes.sinal.throwIfAborted();
    if (!opcoes.podeContinuar() || !sessaoValida)
      throw new Error("A sessão mudou.");
  };
  const produtos = await lerCatalogoInteiro(async (pagina) => {
    await conferir();
    const { data, error } = await aguardarComPrazo(
      Promise.resolve(
        supabase
          .rpc("get_admin_products_paged", {
            p_search: "",
            p_category: "all",
            p_status: "all",
            p_stock: "all",
            p_page: pagina,
            p_page_size: 200,
          })
          .abortSignal(opcoes.sinal),
      ),
      PRAZO_DA_CONSULTA_DO_PAINEL_MS,
      () => new Error("A leitura demorou demais."),
    );
    if (error) throw error;
    const resposta = data as { data: unknown[]; total_count: number } | null;
    if (
      !resposta ||
      !Array.isArray(resposta.data) ||
      resposta.total_count == null
    )
      throw new Error("Catálogo indisponível.");
    return {
      products: resposta.data.map(mapProductFromDB),
      total: Number(resposta.total_count),
    };
  });
  let formato: "xlsx" | "csv" = "xlsx";
  let blob: Blob;
  try {
    const { gerarXlsx } = await import("./planilha-xlsx");
    blob = new Blob(
      [gerarXlsx(linhasDosProdutos(produtos, opcoes.comCustos, "xlsx"))],
      {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
    );
  } catch {
    formato = "csv";
    blob = new Blob([produtosEmCsv(produtos, opcoes.comCustos)], {
      type: "text/csv;charset=utf-8",
    });
  }
  await conferir();
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.href = url;
  const loja =
    opcoes.nomeLoja
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80) || "loja";
  link.download = `produtos-${loja}-${hojeEmSaoPaulo()}.${formato}`;
  document.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }
  return formato;
}

export function produtosEmCsv(produtos: Product[], comCustos: boolean): string {
  const linhas = linhasDosProdutos(produtos, comCustos);
  const cabecalho = linhas[0];
  const conteudo = linhas
    .map((linha) =>
      linha
        .map((valor, i) => {
          if (typeof valor === "number") {
            const decimal =
              String(cabecalho.at(i)).includes("(R$)") ||
              cabecalho.at(i) === "Margem (%)";
            return (decimal ? valor.toFixed(2) : String(valor)).replace(
              ".",
              ",",
            );
          }
          return `"${valor.replace(/"/g, '""')}"`;
        })
        .join(";"),
    )
    .join("\r\n");
  return `${String.fromCharCode(0xfeff)}${conteudo}`;
}

const COLUNAS_DE_CUSTO = ["Custo (R$)", "Lucro por unidade (R$)", "Margem (%)"];

/**
 * Só texto recebe apóstrofo: valores numéricos negativos continuam números.
 * Defesa do CSV, onde o Excel interpreta o conteúdo; no XLSX o inlineStr já é texto puro.
 */
function textoSeguro(valor: CelulaDoProduto): CelulaDoProduto {
  return typeof valor === "string" && /^[\t\r\n]|^\s*[=+@-]/.test(valor)
    ? `'${valor}`
    : valor;
}

/** `formato` padrão é "csv" (protegido): só o XLSX, que não executa texto, pede o dado cru. */
export function linhasDosProdutos(
  produtos: Product[],
  comCustos: boolean,
  formato: "xlsx" | "csv" = "csv",
): CelulaDoProduto[][] {
  const cabecalho = [
    "Código/SKU",
    "Nome",
    "Categoria",
    "Status",
    "Preço (R$)",
    "Preço original (R$)",
    ...(comCustos ? COLUNAS_DE_CUSTO : []),
    "Estoque",
    "Variante",
    "SKU da variante",
    "Variante ativa",
    "Código de barras",
    "Código de barras da variante",
    "Peso (kg)",
    "Largura (cm)",
    "Altura (cm)",
    "Comprimento (cm)",
    "Descrição",
    "Fotos",
    "Foto da variante",
    "Destaque",
    "Frete grátis",
    "Etiquetas",
    "Vendidos",
    "Estoque mínimo",
    "ID do produto",
    "ID da variante",
    "Criado em",
    "Atualizado em",
  ];
  return [
    cabecalho,
    ...produtos.flatMap((p) => {
      const variantes = p.variants?.length ? p.variants : [undefined];
      return variantes.map((v) => {
        const preco = v?.priceOverride ?? p.price;
        const custo = p.costPrice;
        const lucro =
          custo == null ? "" : Math.round((preco - custo) * 100) / 100;
        const margem =
          typeof lucro === "number" && preco > 0
            ? Math.round((lucro / preco) * 10000) / 100
            : "";
        return [
          p.sku ?? "",
          p.name,
          p.category,
          !p.isActive ? "Offline" : p.stock > 0 ? "Em Operação" : "Esgotado",
          preco,
          p.originalPrice ?? "",
          ...(comCustos ? [custo ?? "", lucro, margem] : []),
          v ? v.stockIncrement : p.stock,
          v ? `${v.name}: ${v.value}` : "",
          v?.sku ?? "",
          v ? (v.active ? "Sim" : "Não") : "",
          p.codigoBarras ?? "",
          v?.codigoBarras ?? "",
          p.weightKg ?? "",
          p.widthCm ?? "",
          p.heightCm ?? "",
          p.lengthCm ?? "",
          p.description,
          p.images
            .filter((url) => {
              try {
                return new URL(url).hostname !== "placehold.co";
              } catch {
                return true;
              }
            })
            .join("\n"),
          v?.imageUrl ?? "",
          p.isBestseller ? "Sim" : "Não",
          p.freeShipping ? "Sim" : "Não",
          p.tags?.join(", ") ?? "",
          p.sold,
          p.estoqueMinimo ?? "",
          p.id,
          v?.id ?? "",
          formato === "csv" ? dataLocal(p.createdAt ?? "") : p.createdAt,
          formato === "csv"
            ? dataLocal(p.updatedAt ?? "")
            : (p.updatedAt ?? ""),
        ].map((celula) => (formato === "csv" ? textoSeguro(celula) : celula));
      });
    }),
  ];
}
