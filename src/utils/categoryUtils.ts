export const getCategoryFromDescription = (description: string): string => {
  const desc = description.toLowerCase();
  
  if (desc.includes('mercado') || desc.includes('supermercado') || desc.includes('padaria') || desc.includes('restaurante')) {
    return 'Alimentação';
  }
  if (desc.includes('combustível') || desc.includes('uber') || desc.includes('transporte') || desc.includes('ônibus')) {
    return 'Transporte';
  }
  if (desc.includes('remédio') || desc.includes('farmácia') || desc.includes('médico') || desc.includes('hospital')) {
    return 'Saúde';
  }
  if (desc.includes('salário') || desc.includes('freelance') || desc.includes('pagamento')) {
    return 'Trabalho';
  }
  if (desc.includes('aluguel') || desc.includes('luz') || desc.includes('água') || desc.includes('internet')) {
    return 'Contas';
  }
  
  return 'Outros';
};