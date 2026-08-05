/**
 * VOR (Verified Observation Runtime) - Truth Gate G17
 * Garante a integridade lógica dos dados no domínio do marketplace.
 */

export interface VerificationReceipt {
  hash: string;
  timestamp: string;
  status: "VERIFIED" | "ABORTED";
  violations: string[];
  warnings?: string[];
}

/**
 * Serialização canônica: a mesma entrada lógica sempre produz a mesma string,
 * independente da ordem das chaves. Sem isto o hash do recibo mudaria à toa
 * conforme a ordem em que os campos foram montados.
 */
function canonicalize(value: unknown, seen: WeakSet<object>): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";

  const type = typeof value;
  if (type === "string") return JSON.stringify(value);
  if (type === "number") {
    // NaN e Infinity não sobrevivem ao JSON; precisam de marca própria para
    // não colidirem com null.
    return Number.isFinite(value as number)
      ? String(value)
      : `#${String(value)}`;
  }
  if (type === "boolean" || type === "bigint") return String(value);
  if (type === "function" || type === "symbol") return `#${type}`;

  const obj = value as object;
  if (seen.has(obj)) return "#circular";
  seen.add(obj);
  try {
    if (obj instanceof Date) return `#date(${obj.toISOString()})`;
    if (Array.isArray(obj)) {
      return `[${obj.map((item) => canonicalize(item, seen)).join(",")}]`;
    }
    // `entries` em vez de `keys` + acesso indexado: mesma saída, sem o acesso
    // dinâmico que o eslint marca como object-injection.
    const entries = Object.entries(obj as Record<string, unknown>)
      // Comparação crua de code units, não `localeCompare`: a ordenação tem
      // que ser idêntica em qualquer locale para o hash ser reproduzível.
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(
        ([key, item]) => `${JSON.stringify(key)}:${canonicalize(item, seen)}`,
      );
    return `{${entries.join(",")}}`;
  } finally {
    // Liberar permite que a mesma referência apareça duas vezes em ramos
    // irmãos sem ser confundida com ciclo.
    seen.delete(obj);
  }
}

/** FNV-1a de 32 bits. `Math.imul` mantém a multiplicação em 32 bits. */
function fnv1a(input: string, seed: number): number {
  let hash = seed;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Digest de 64 bits (16 hex) do conteúdo, síncrono e sem dependência de
 * runtime. Duas passadas FNV-1a com semente e sufixo distintos.
 *
 * Deliberadamente NÃO é criptográfico: `crypto.subtle.digest` é assíncrono
 * (obrigaria `verifyProductAxiom` a virar async) e exige secure context. Como
 * o recibo não tem segredo nem verificador, SHA-256 não daria evidência de
 * adulteração aqui — quem forja o payload recalcula o hash do mesmo jeito.
 * O que o recibo precisa é identificar sem ambiguidade O QUE foi validado.
 */
function digest(input: string): string {
  const a = fnv1a(input, 0x811c9dc5);
  const b = fnv1a(`${input}vor-g17`, 0x9e3779b1);
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}

type AxiomSubject = "product" | "variant";

/**
 * Coage para número finito, ou `null` se o valor não representa um número.
 *
 * Aceita string numérica de propósito: as comparações antigas já coagiam
 * (`"-5" < 0` é verdadeiro) e mudar isso quebraria qualquer caller que mande
 * campo de formulário cru. O que precisa cair fora é `null`, `NaN`, `""` e
 * texto — esses passavam batido pelas comparações e chegavam ao banco como
 * `null`, deixando o produto sem preço ou sem estoque.
 */
function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Emite o recibo, registra no console para a auditoria do enxame e aborta se
 * houver violação. Compartilhado por todos os verificadores para que produto e
 * variante não divirjam no formato do recibo nem na regra de abortagem.
 */
function issueReceipt(
  subject: AxiomSubject,
  payload: unknown,
  violations: string[],
  warnings: string[],
): VerificationReceipt {
  const status = violations.length === 0 ? "VERIFIED" : "ABORTED";
  const timestamp = new Date().toISOString();

  // O recibo tem que provar O QUE foi validado, não só que algo passou por
  // aqui: o digest cobre o payload inteiro mais o veredito e o instante.
  // `subject` entra junto para um produto e uma variante de campos
  // coincidentes não gerarem o mesmo recibo.
  const hash = digest(
    canonicalize(
      { subject, payload, status, violations, warnings, timestamp },
      new WeakSet<object>(),
    ),
  );

  const receipt: VerificationReceipt = {
    hash,
    timestamp,
    status,
    violations,
    warnings,
  };

  // Protocolo SROS: Registro de recibo para auditoria de enxame
  console.log(
    "%c[VOR-G17] Receipt Generated (%s): %s",
    "color: #10b981; font-weight: bold;",
    subject,
    hash,
    receipt,
  );

  if (status === "ABORTED") {
    console.error("[VOR-G17] Execution ABORTED due to violations", violations);
    // Ternário em vez de mapa indexado: o acesso dinâmico dispara o
    // security/detect-object-injection do eslint sem ganho nenhum aqui.
    const label = subject === "product" ? "Produto" : "Variante";
    throw new Error(`Validação de ${label} Falhou: ${violations.join(", ")}`);
  }

  return receipt;
}

export const TruthGate = {
  /**
   * Verifica axiomas fundamentais de um produto.
   * VOR Implementation: Prova ou Abortagem.
   */
  verifyProductAxiom: (
    product: any,
    context?: { mode?: "create" | "patch" },
  ): VerificationReceipt => {
    const violations: string[] = [];
    const warnings: string[] = [];
    const isCreate = context?.mode === "create";

    const price = toFiniteNumber(product.price);
    const stock = toFiniteNumber(product.stock);
    const costPrice = toFiniteNumber(product.costPrice);
    const originalPrice = toFiniteNumber(product.originalPrice);

    // Axioma 0: na criação o produto tem que nascer inteiro.
    // Num patch, campo ausente quer dizer "não mexe nesse" — na criação quer
    // dizer produto sem nome, sem preço ou sem estoque entrando no catálogo.
    // Só `undefined` é testado aqui: valor presente porém inválido (null, NaN)
    // cai nas checagens abaixo, para o mesmo defeito não virar duas violações.
    if (isCreate) {
      if (product.name === undefined) {
        violations.push("Axiom violation: identity_required");
      }
      if (product.price === undefined) {
        violations.push("Axiom violation: price_required");
      }
      if (product.stock === undefined) {
        violations.push("Axiom violation: stock_required");
      }
    }

    // Axioma 0b: valor presente tem que ser número. `null`, `NaN` e texto
    // escapavam das comparações (`NaN < 0` é falso) e eram gravados como null.
    if (product.price !== undefined && price === null) {
      violations.push("Axiom violation: price_not_numeric");
    }
    if (product.stock !== undefined && stock === null) {
      violations.push("Axiom violation: stock_not_numeric");
    }
    if (product.costPrice !== undefined && costPrice === null) {
      violations.push("Axiom violation: cost_price_not_numeric");
    }
    if (product.originalPrice !== undefined && originalPrice === null) {
      violations.push("Axiom violation: original_price_not_numeric");
    }

    // Axioma 1: Preço não pode ser negativo
    if (price !== null && price < 0) {
      violations.push("Axiom violation: price_non_negative");
    }

    // Axioma 2: Estoque dentro do limite termodinâmico
    if (stock !== null && stock > 10000) {
      violations.push("Axiom violation: stock_limit_exceeded");
    }

    // Axioma 2b: ...e o limite tem piso. O banco tem CHECK equivalente
    // (migration 20260307000000); validar aqui dá erro legível antes do 400.
    if (stock !== null && stock < 0) {
      violations.push("Axiom violation: stock_negative");
    }

    // Axioma 3: Nome do produto é mandatório (Identidade)
    if (
      product.name !== undefined &&
      (!product.name || String(product.name).trim().length === 0)
    ) {
      violations.push("Axiom violation: identity_null_error");
    }

    // Axioma 4: Validação Financeira
    if (costPrice !== null && costPrice < 0) {
      violations.push("Axiom violation: cost_price_negative");
    }
    // Sem a guarda `price > 0` de antes, que fazia preço zero com custo 50
    // passar sem aviso nenhum. `costPrice > 0` evita o falso positivo de um
    // brinde com custo zero avisar prejuízo contra si mesmo.
    if (
      costPrice !== null &&
      costPrice > 0 &&
      price !== null &&
      costPrice >= price
    ) {
      warnings.push(
        "Axiom warning: price_margin_negative (Prejuízo detectado)",
      );
    }

    // Axioma 5: Preço original (De:) deve ser maior que o preço de venda (Por:) se definido
    if (originalPrice !== null && price !== null && originalPrice <= price) {
      violations.push(
        "Axiom violation: original_price_must_be_greater_than_promo_price",
      );
    }

    return issueReceipt("product", product, violations, warnings);
  },

  /**
   * Verifica axiomas de uma variante.
   *
   * Códigos de violação próprios, e não os do produto: a variante guarda
   * `priceOverride`/`stockIncrement`, então um recibo dizendo
   * "price_non_negative" mentiria sobre o que foi de fato validado.
   *
   * `context.costPrice` é o custo do produto pai, usado só para o axioma de
   * margem. Quando não é informado, a checagem de prejuízo é omitida — as
   * violações, que são o que aborta a persistência, não dependem dele.
   */
  verifyVariantAxiom: (
    variant: any,
    context?: { costPrice?: number | null },
  ): VerificationReceipt => {
    const violations: string[] = [];
    const warnings: string[] = [];

    const price = variant.priceOverride;
    const stock = variant.stockIncrement;

    // Axioma 1: Override de preço não pode ser negativo
    if (price !== undefined && price !== null && price < 0) {
      violations.push("Axiom violation: variant_price_override_negative");
    }

    // Axioma 2: Estoque da variante dentro do limite termodinâmico
    if (stock !== undefined && stock !== null && stock > 10000) {
      violations.push("Axiom violation: variant_stock_limit_exceeded");
    }

    // Axioma 3: Estoque da variante não pode ser negativo. `stock_increment`
    // alimenta direto a checagem de disponibilidade da RPC de pedido, e o
    // banco tem CHECK equivalente — validar aqui dá erro legível antes do 400.
    if (stock !== undefined && stock !== null && stock < 0) {
      violations.push("Axiom violation: variant_stock_negative");
    }

    // Axioma 4: Identidade — nome e valor são o que distinguem a variante
    if (
      variant.name !== undefined &&
      (!variant.name || String(variant.name).trim().length === 0)
    ) {
      violations.push("Axiom violation: variant_identity_null_error");
    }
    if (
      variant.value !== undefined &&
      (!variant.value || String(variant.value).trim().length === 0)
    ) {
      violations.push("Axiom violation: variant_value_null_error");
    }

    // Axioma 5: Margem — override abaixo do custo do pai é prejuízo. Warning e
    // não violação, para acompanhar o axioma equivalente do produto.
    const cost = context?.costPrice;
    if (
      cost !== undefined &&
      cost !== null &&
      price !== undefined &&
      price !== null &&
      price > 0 &&
      cost >= price
    ) {
      warnings.push(
        "Axiom warning: variant_price_margin_negative (Prejuízo detectado)",
      );
    }

    return issueReceipt("variant", variant, violations, warnings);
  },
};
