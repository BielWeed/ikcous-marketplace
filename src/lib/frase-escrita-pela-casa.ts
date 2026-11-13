// Quando a frase de um erro do banco pode chegar ao lojista como está.
//
// As recusas do balcão (`registrar_venda_presencial`, `anular_venda_presencial`
// — migrations 20261162/20261204/20261280) são `RAISE EXCEPTION` em português,
// escritos para o lojista, com `ERRCODE` 22023 ou 42501; as recusas que vêm do
// `pedido__mudar_status`, chamado pela anulação, são `RAISE` sem código (P0001
// ou P0002), também em português. Só essas a casa escreveu.
//
// O problema: 42501 e 22023 (e P0001) também são códigos NATIVOS do Postgres.
// "permission denied for function registrar_venda_presencial" chega com
// 42501; "invalid parameter value" com 22023. Casar só pelo código repassaria
// esse texto à tela. Uma lista de erros técnicos nunca fecha, então o critério
// é por LÍNGUA e por FORMA, não por catálogo:
//
//  1. o código tem de ser um que a casa usa em RAISE próprio;
//  2. as frases com NOME DE PRODUTO dentro (nome é texto livre do lojista:
//     "KIT_BASICO" parece identificador técnico) são reconhecidas pelo molde
//     que a migration escreve;
//  3. a frase não pode ter forma de texto técnico (identificador snake_case,
//     `ERROR:`, `SQLSTATE`, "permission denied", "violates", "JWT"...);
//  4. só passa frase com sinal de PORTUGUÊS (acento, ou palavra que não existe
//     em inglês) — vale mesmo com nome de produto em inglês dentro. Sem esse
//     sinal a frase é tratada como do banco: perder uma frase da casa custa
//     pouco (cai na frase própria da tela, também em português), deixar passar
//     texto do banco custa o lojista ler "canceling statement ...".
//
// Quem chama decide o que mostrar no lugar (`null` = frase da própria tela).

/** Os códigos que a casa usa nos `RAISE` do balcão e da anulação. */
const CODIGOS_DA_CASA: ReadonlySet<string> = new Set([
  "42501",
  "22023",
  "P0001",
  "P0002",
]);

/** Os três moldes dos `RAISE` do balcão que carregam o nome do produto. */
const MOLDE_COM_NOME_DE_PRODUTO =
  /^(?:Produto [^\n]+ não disponível\.|Estoque insuficiente para o produto [^\n]+|Escolha uma variação para o produto [^\n]+\.)$/;

/** Forma de texto técnico — vale mesmo se houver uma palavra portuguesa solta. */
const FORMA_TECNICA =
  /\b[a-z]+_[a-z_0-9]+\b|\bpublic\.|\bERROR:|\bSQLSTATE\b|\bPGRST\d|\bJWT\b|permission denied|row-level|violates|statement timeout|permiss[ãa]o negada|\bfun[çc][ãa]o\b/i;

/** Acento ou palavra que não existe em inglês. */
const SINAL_DE_PORTUGUES =
  /[áàâãéêíóôõúç]|\b(?:n[ãa]o|para|uma?|este|esta|esse|essa|j[áa]|s[óo]|com|por|que|dos|das|ao|ou|se|nos|nas|pelo|pela|venda|pedido|loja|produto|motivo|informe|escolha|estoque|acesso|negado|autorizado|falha)\b/i;

/**
 * A frase do banco, se a CASA a escreveu e a tela pode mostrá-la como está;
 * `null` caso contrário (texto técnico, código que a casa não usa, vazio).
 */
export function fraseEscritaPelaCasa(
  codigo: string,
  mensagem: string | null,
): string | null {
  if (!CODIGOS_DA_CASA.has(codigo)) return null;
  if (mensagem === null) return null;
  if (MOLDE_COM_NOME_DE_PRODUTO.test(mensagem)) return mensagem;
  if (FORMA_TECNICA.test(mensagem)) return null;
  return SINAL_DE_PORTUGUES.test(mensagem) ? mensagem : null;
}
