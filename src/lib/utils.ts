import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const currencyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export const formatCurrency = (value: number) =>
  currencyFormatter.format(value);

export const getAvatarGradient = (name: string, defaultName = "Usuario") => {
  const colors = [
    "from-amber-500 to-orange-600",
    "from-emerald-500 to-teal-600",
    "from-rose-500 to-red-600",
    "from-blue-500 to-indigo-600",
    "from-purple-500 to-pink-600",
    "from-cyan-500 to-blue-600",
  ];
  let sum = 0;
  const cleanName = name || defaultName;
  for (let i = 0; i < cleanName.length; i++) {
    sum += cleanName.charCodeAt(i);
  }
  return colors[sum % colors.length];
};

/**
 * Texto pronto para comparação de busca: sem acento, sem cedilha, em caixa
 * baixa e sem espaço nas pontas (BUSCA-010, #20).
 *
 * POR QUE ISTO EXISTE
 *
 * A busca do cliente comparava só com `toLowerCase()`. Em catálogo brasileiro
 * isso quebra o caso mais comum que existe: teclado de celular não põe acento
 * sozinho, e ninguém para de digitar para procurar o cedilha. Quem digitava
 * "alianca" não achava a "Aliança" — produto ativo, em estoque, na vitrine.
 *
 * COMO FUNCIONA
 *
 * `normalize("NFD")` separa a letra do acento (á vira "a" + sinal), e a faixa
 * `\u0300-\u036f` é o bloco Unicode desses sinais soltos. Removidos eles, sobra
 * a letra. Mesma técnica que `useCategories.ts` já usava para gerar slug — o
 * repositório tinha a ferramenta e a busca não usava.
 *
 * REGRA DE USO: aplicar nos DOIS lados da comparação. Normalizar só o que a
 * pessoa digitou continua não achando o produto acentuado, e normalizar só o
 * produto não acha quem digitou com acento.
 *
 * Aceita `null`/`undefined` de propósito: `description` pode vir nula do banco,
 * e era exatamente isso que quebrava a busca por descrição na SearchBar.
 */
export const normalizeText = (texto: string | null | undefined): string =>
  (texto ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
