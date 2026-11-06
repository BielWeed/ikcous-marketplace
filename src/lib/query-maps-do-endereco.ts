// Query de LOCAL para o Google Maps, a mesma para o cartão de endereço do
// Perfil e para o "Ver no Maps" do pedido no painel. Endereço completo (rua,
// cidade e UF): rua+número, cidade, UF e, só se for específico, o CEP no fim.
// Incompleto: rua+número, bairro, cidade, UF, CEP e Brasil — o que houver,
// como localizador de reserva.
// Dados privados — destinatário, complemento, referência e apelido — NUNCA
// saem para o Google. Sem rua e sem CEP não há como apontar o mapa: devolve
// null (a query é texto; o Google geocodifica sozinho — nada de coordenada
// inventada nem precisão prometida).
//
// No endereço completo o bairro e o "Brasil" ficam de fora (medido no embed
// real): um nome de bairro que lembra nome de comércio faz o Google listar
// dezenas de comércios (vários pinos) em vez de apontar UM endereço. Sem o
// bairro o mesmo endereço dá um pino só. O CEP volta no fim apenas quando é
// de rua (8 dígitos e NÃO terminado em 000): ele desempata rua repetida em
// cidade grande. CEP geral da cidade (terminado em 000) não localiza nada.

export interface EnderecoParaOMapa {
  street?: string | null;
  number?: string | null;
  neighborhood?: string | null;
  city?: string | null;
  state?: string | null;
  cep?: string | null;
}

function cepEspecificoDoEndereco(cep: string | null | undefined) {
  const digitos = (cep ?? "").replace(/\D/g, "");
  if (digitos.length !== 8 || digitos.endsWith("000")) return null;
  return `${digitos.slice(0, 5)}-${digitos.slice(5)}`;
}

// O número entra sempre, a menos que a rua JÁ TERMINE nele ("Rua das Flores,
// 123" + 123). Só "contém" não serve: "Rua 15 de Novembro" contém o 15 e
// perderia o número da casa.
function ruaComNumero(street: string, number: string) {
  // Número órfão (rua vazia) nunca entra sozinho.
  if (!street || !number) return street;
  const ultimoToken = street.split(/[\s,]+/).pop() ?? "";
  if (ultimoToken.toLowerCase() === number.toLowerCase()) return street;
  return `${street}, ${number}`;
}

/** A busca em texto puro (sem `encodeURIComponent`), ou null sem rua e sem CEP. */
export function buscaDoMapaDoEndereco(
  endereco: EnderecoParaOMapa,
): string | null {
  const street = endereco.street?.trim() ?? "";
  // Guarda DIRETA em street ou CEP: um número órfão (rua vazia) não monta
  // query — sem um dos dois não há como apontar o mapa.
  if (!street && !endereco.cep?.trim()) return null;
  const rua = ruaComNumero(street, endereco.number?.trim() ?? "");
  // A simplificação exige rua PRESENTE: sem rua, bairro e CEP são os únicos
  // localizadores e não podem sair.
  const enderecoCompleto = Boolean(
    street && endereco.city?.trim() && endereco.state?.trim(),
  );
  const partes = enderecoCompleto
    ? [
        rua,
        endereco.city?.trim(),
        endereco.state?.trim(),
        cepEspecificoDoEndereco(endereco.cep),
      ]
    : [
        rua,
        endereco.neighborhood?.trim(),
        endereco.city?.trim(),
        endereco.state?.trim(),
        endereco.cep?.trim(),
        "Brasil",
      ];
  return partes.filter(Boolean).join(", ");
}

export function queryMapsDoEndereco(
  endereco: EnderecoParaOMapa,
): string | null {
  const busca = buscaDoMapaDoEndereco(endereco);
  return busca === null ? null : encodeURIComponent(busca);
}
