// ---------------------------------------------------------------------------
// BENCHMARK DE ACEITE — totais de referência da planilha original
// (aba RESUMO de "Transferencias_Saindo_CD10b.xlsb"), visão "Total".
//
// O motor TypeScript deste projeto foi executado contra a base real
// (79.313 SKUs / 130.608 células de pedido) e reproduziu ESTES números
// ao centavo, gerando 8.926 linhas de plano em ~250 ms. Mantidos aqui como
// referência de não-regressão do modelo. Apenas agregados de negócio —
// nenhum dado de SKU/preço individual é versionado no repositório.
//
// NOTA (valorImediata / qtdImediata): estes agregados refletem a quantidade
// imediata TEÓRICA da planilha original. A partir da regra de caixa fechada,
// o valor da transferência imediata do plano passou a ser o valor das UNIDADES
// efetivamente transferidas (caixas fechadas, arredondadas para baixo), então
// o agregado atual do motor fica ligeiramente ABAIXO destes valores teóricos.
// ---------------------------------------------------------------------------

export const REFERENCIA_RESUMO = {
  meses: ["2026_07", "2026_08", "2026_09"],
  linhasPlano: 8926,
  excessoSimplesRs: 73_964_064.68, // "EXCESSO EM STK (R$)" — headline ~R$ 74 mi
  excessoTransferivelRs: 58_947_857.41, // "EXCESSOS + PEND (R$)" — base da alocação
  porCd: {
    1: { transf: [464999, 83159, 53120], valorImediata: 8_274_573.15, qtdImediata: 347267, impactoFiscal: 635_843.38, aliquota: 0.052 },
    9: { transf: [352330, 154198, 129381], valorImediata: 6_343_740.81, qtdImediata: 294526, impactoFiscal: 215_464.30, aliquota: 0.015 },
    2: { transf: [217775, 131265, 116933], valorImediata: 4_194_047.79, qtdImediata: 166242.5, impactoFiscal: 0, aliquota: null },
    8: { transf: [66736, 48396, 41065], valorImediata: 1_259_270.28, qtdImediata: 53360.5, impactoFiscal: 0, aliquota: null },
    7: { transf: [0, 0, 0], valorImediata: 0, qtdImediata: 0, impactoFiscal: 0, aliquota: null },
  },
  totais: {
    transfMes: [1_101_840, 417_018, 340_499],
    valorTransfMes: [27_437_557.41, 9_648_297.85, 5_607_118.90],
    valorTransfTotal: 42_692_974.16,
    qtdImediata: 861396,
    valorImediata: 20_071_632.03,
    impactoFiscal: 851_307.68,
  },
} as const;
