// Ponto de encaixe do centro da barra, usado quando não há busca
// ("address-form" e "checkout"). ID estável: o Checkout porta aqui o gatilho
// do resumo, sem o cabeçalho conhecer carrinho, frete ou total.
// Módulo mínimo para os cabeçalhos não importarem um ao outro.
export const HEADER_CENTER_SLOT_ID = "checkout-header-center-slot";
