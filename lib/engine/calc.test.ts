import { describe, expect, it } from "vitest";
import {
  calcularRede,
  cascataCumsum,
  cobertura,
  excessoTransferivel,
  indexarPedidos,
  necessidadeSaldoIdeal,
  nivelarPorCobertura,
  precoUnitario,
} from "./calc";
import {
  chaveCdProduto,
  Compromissos,
  compromissosVazios,
  LinhaBase,
  ParametrosRede,
  PedidoProjetado,
} from "./types";

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function linha(cd: number, codigo: number, over: Partial<LinhaBase> = {}): LinhaBase {
  return {
    idSku: `${cd}-${codigo}`,
    cd,
    codigoProduto: codigo,
    produto: `PROD ${codigo}`,
    estoqueDisponivel: 0,
    estoqueObjetivo: 0,
    quantidadePendente: 0,
    vendaMedia3m: 0,
    custoReposicao: 10,
    precoLista: 15,
    embCompra: 10,
    fornecedor: "F",
    comprador: "C",
    analista: "A",
    categoriaN1: "N1",
    categoriaN2: "N2",
    categoriaN3: "N3",
    categoriaN4: "N4",
    ...over,
  };
}

function params(over: Partial<ParametrosRede> = {}): ParametrosRede {
  return {
    modoDemanda: "saldo_ideal",
    origens: [10],
    destinos: [1, 2],
    horizonteMeses: ["2026_09", "2026_10"],
    aliquotas: {},
    fatorSegurancaImediata: 0.5,
    limiteCoberturaDias: 90,
    considerarAprovadas: true,
    considerarPendenteOrigem: true,
    coberturaMaxDestinoDias: 0,
    coberturaMinDestinoDias: 0,
    estrategiaDestino: "prioridade",
    arredondarCaixaFechada: false,
    minUnidadesLinha: 0,
    minValorLinha: 0,
    minValorRota: 0,
    ...over,
  };
}

const rodar = (
  base: LinhaBase[],
  p: ParametrosRede,
  pedidos: PedidoProjetado[] = [],
  comp: Compromissos = compromissosVazios(),
) => calcularRede(base, indexarPedidos(pedidos), p, comp);

// --------------------------------------------------------------------------

describe("regras unitárias", () => {
  it("preço usa o custo de reposição e cai para o preço de lista quando é 0", () => {
    expect(precoUnitario(linha(10, 1, { custoReposicao: 7, precoLista: 9 }))).toBe(7);
    expect(precoUnitario(linha(10, 1, { custoReposicao: 0, precoLista: 9 }))).toBe(9);
  });

  it("excesso transferível protege venda média e estoque objetivo", () => {
    const l = linha(10, 1, { estoqueDisponivel: 500, quantidadePendente: 100, vendaMedia3m: 200, estoqueObjetivo: 150 });
    expect(excessoTransferivel(l)).toBe(250);
  });

  it("excesso nunca é negativo", () => {
    const l = linha(10, 1, { estoqueDisponivel: 10, vendaMedia3m: 100, estoqueObjetivo: 50 });
    expect(excessoTransferivel(l)).toBe(0);
  });

  it("necessidade do destino é o que falta para o objetivo, já com o pendente", () => {
    expect(necessidadeSaldoIdeal(linha(1, 1, { estoqueObjetivo: 300, estoqueDisponivel: 100, quantidadePendente: 50 }))).toBe(150);
    expect(necessidadeSaldoIdeal(linha(1, 1, { estoqueObjetivo: 100, estoqueDisponivel: 400 }))).toBe(0);
  });

  it("cobertura em dias e status", () => {
    expect(cobertura(linha(10, 1, { estoqueDisponivel: 300, vendaMedia3m: 100 }), 90).dias).toBe(90);
    expect(cobertura(linha(10, 1, { estoqueDisponivel: 400, vendaMedia3m: 100 }), 90).status).toBe("Acima de 90 dias");
    expect(cobertura(linha(10, 1, { estoqueDisponivel: 10, vendaMedia3m: 0 }), 90).status).toBe("Sem giro");
  });

  it("cascata cumsum equivale ao laço guloso sequencial", () => {
    const demanda = [30, 40, 50];
    const transf = cascataCumsum(demanda, 60);
    expect(transf).toEqual([30, 30, 0]);
    let saldo = 60;
    const esperado = demanda.map((d) => {
      const t = Math.min(d, saldo);
      saldo -= t;
      return t;
    });
    expect(transf).toEqual(esperado);
  });
});

describe("rede — modo saldo ideal", () => {
  const base = [
    linha(10, 100, { estoqueDisponivel: 1000, vendaMedia3m: 0, estoqueObjetivo: 0 }), // excesso 1000
    linha(1, 100, { estoqueObjetivo: 400 }), // precisa de 400
    linha(2, 100, { estoqueObjetivo: 900 }), // precisa de 900
  ];

  it("atende os destinos na ordem de prioridade escolhida", () => {
    const r = rodar(base, params({ origens: [10], destinos: [1, 2] }));
    const cd1 = r.linhas.find((l) => l.cdDestino === 1)!;
    const cd2 = r.linhas.find((l) => l.cdDestino === 2)!;
    expect(cd1.transfSaldo).toBe(400); // destino 1 primeiro: atendido integralmente
    expect(cd2.transfSaldo).toBe(600); // sobra do excesso vai ao destino 2
  });

  it("inverter a ordem dos destinos muda quem é atendido primeiro", () => {
    const r = rodar(base, params({ origens: [10], destinos: [2, 1] }));
    expect(r.linhas.find((l) => l.cdDestino === 2)!.transfSaldo).toBe(900);
    expect(r.linhas.find((l) => l.cdDestino === 1)!.transfSaldo).toBe(100);
  });

  it("a sequência de origens define quem escoa primeiro (demanda é compartilhada)", () => {
    const b = [
      linha(10, 100, { estoqueDisponivel: 300 }),
      linha(9, 100, { estoqueDisponivel: 300 }),
      linha(1, 100, { estoqueObjetivo: 400 }),
    ];
    const r1 = rodar(b, params({ origens: [10, 9], destinos: [1] }));
    expect(r1.linhas.find((l) => l.cdOrigem === 10)!.transfSaldo).toBe(300);
    expect(r1.linhas.find((l) => l.cdOrigem === 9)!.transfSaldo).toBe(100);

    const r2 = rodar(b, params({ origens: [9, 10], destinos: [1] }));
    expect(r2.linhas.find((l) => l.cdOrigem === 9)!.transfSaldo).toBe(300);
    expect(r2.linhas.find((l) => l.cdOrigem === 10)!.transfSaldo).toBe(100);
  });

  it("um CD nunca transfere para si mesmo, mesmo estando nas duas listas", () => {
    const b = [
      linha(10, 100, { estoqueDisponivel: 1000 }),
      linha(1, 100, { estoqueDisponivel: 50, estoqueObjetivo: 600 }),
    ];
    const r = rodar(b, params({ origens: [10, 1], destinos: [10, 1] }));
    expect(r.linhas.every((l) => l.cdOrigem !== l.cdDestino)).toBe(true);
    expect(r.reconciliacao.autoTransferencias).toBe(0);
  });

  it("nenhum destino recebe mais que a necessidade e nenhuma origem envia mais que o excesso", () => {
    const r = rodar(base, params({ origens: [10], destinos: [1, 2] }));
    expect(r.reconciliacao.invarianteOk).toBe(true);
    expect(r.destinos.find((d) => d.cd === 1)!.atendidoQtd).toBeLessThanOrEqual(400);
    expect(r.origens[0].transferidoQtd).toBeLessThanOrEqual(r.origens[0].excessoQtd);
  });

  it("valoriza pelo preço da origem e calcula o impacto fiscal da rota", () => {
    const r = rodar(
      base,
      params({ origens: [10], destinos: [1], aliquotas: { "10>1": 0.05 } }),
    );
    const l = r.linhas[0];
    expect(l.precoUnitario).toBe(10);
    expect(l.valorTotal).toBe(4000);
    expect(l.impactoFiscal).toBeCloseTo(200, 6);
    expect(r.meta.impactoFiscalTotal).toBeCloseTo(200, 6);
  });

  it("aponta as rotas com transferência e sem alíquota definida", () => {
    const r = rodar(base, params({ origens: [10], destinos: [1, 2] }));
    expect(r.meta.rotasSemAliquota).toEqual(["10>1", "10>2"]);
  });
});

describe("rede — modo pedidos (cascata mês → destino)", () => {
  const base = [
    linha(10, 100, { estoqueDisponivel: 1000 }),
    linha(1, 100, {}),
    linha(2, 100, {}),
  ];
  const pedidos: PedidoProjetado[] = [
    { anoMes: "2026_09", cdDestino: 1, codigoProduto: 100, pedido: 300 },
    { anoMes: "2026_09", cdDestino: 2, codigoProduto: 100, pedido: 300 },
    { anoMes: "2026_10", cdDestino: 1, codigoProduto: 100, pedido: 300 },
    { anoMes: "2026_10", cdDestino: 2, codigoProduto: 100, pedido: 300 },
  ];

  it("consome o mês 1 de todos os destinos antes do mês 2", () => {
    const r = rodar(base, params({ modoDemanda: "pedidos", origens: [10], destinos: [1, 2] }), pedidos);
    const cd1 = r.linhas.find((l) => l.cdDestino === 1)!;
    const cd2 = r.linhas.find((l) => l.cdDestino === 2)!;
    // 1000 un: 300 (set/CD1) + 300 (set/CD2) + 300 (out/CD1) + 100 (out/CD2)
    expect(cd1.transfMes).toEqual([300, 300]);
    expect(cd2.transfMes).toEqual([300, 100]);
  });

  it("no modo pedidos o saldo ideal é ignorado (só pedidos futuros contam)", () => {
    const b = [linha(10, 100, { estoqueDisponivel: 1000 }), linha(1, 100, { estoqueObjetivo: 5000 })];
    const r = rodar(b, params({ modoDemanda: "pedidos", origens: [10], destinos: [1] }), []);
    expect(r.linhas).toHaveLength(0);
    expect(r.destinos[0].necessidadeQtd).toBe(0);
  });

  it("a transferência imediata sai do mês 1 e respeita o fator de segurança", () => {
    const b = [linha(10, 100, { estoqueDisponivel: 1000, vendaMedia3m: 400, embCompra: 10 }), linha(1, 100, {})];
    // excesso = 1000 - 400 = 600 ; disponível hoje = 1000 - 400*0,5 = 800
    const r = rodar(
      b,
      params({ modoDemanda: "pedidos", origens: [10], destinos: [1], horizonteMeses: ["2026_09"] }),
      [{ anoMes: "2026_09", cdDestino: 1, codigoProduto: 100, pedido: 500 }],
    );
    const l = r.linhas[0];
    expect(l.transfMes).toEqual([500]);
    expect(l.qtdImediata).toBe(500);
    expect(l.imediataCaixas).toBe(50);
    expect(l.qtdImediataArredondada).toBe(500);
  });
});

describe("transferência imediata em caixa fechada", () => {
  it("menos de uma caixa não sai (arredonda para baixo)", () => {
    const b = [linha(10, 100, { estoqueDisponivel: 100, embCompra: 50 }), linha(1, 100, { estoqueObjetivo: 30 })];
    const r = rodar(b, params({ origens: [10], destinos: [1] }));
    const l = r.linhas[0];
    expect(l.transfSaldo).toBe(30);
    expect(l.imediataCaixas).toBe(0);
    expect(l.valorImediata).toBe(0);
  });

  it("a capacidade imediata da origem é rateada entre os destinos na ordem", () => {
    const b = [
      linha(10, 100, { estoqueDisponivel: 1000, vendaMedia3m: 400, embCompra: 1 }),
      linha(1, 100, { estoqueObjetivo: 600 }),
      linha(2, 100, { estoqueObjetivo: 600 }),
    ];
    // excesso = 600 ; disponível hoje = 1000 - 200 = 800 (só cobre o 1º destino)
    const r = rodar(b, params({ origens: [10], destinos: [1, 2] }));
    const somaImediata = r.linhas.reduce((a, l) => a + l.qtdImediata, 0);
    expect(somaImediata).toBeLessThanOrEqual(800);
    expect(r.linhas.find((l) => l.cdDestino === 1)!.qtdImediata).toBe(600);
  });
});

describe("sugestões aprovadas em aberto (compromissos)", () => {
  const base = [
    linha(10, 100, { estoqueDisponivel: 1000 }),
    linha(1, 100, { estoqueObjetivo: 1000 }),
  ];

  it("descontam o excesso da origem e o trânsito do destino", () => {
    const comp = compromissosVazios();
    comp.saidaOrigem.set(chaveCdProduto(10, 100), 400);
    comp.entradaDestino.set(chaveCdProduto(1, 100), 400);
    const r = rodar(base, params({ origens: [10], destinos: [1] }), [], comp);
    expect(r.origens[0].excessoQtd).toBe(600);
    expect(r.destinos[0].necessidadeQtd).toBe(600);
    expect(r.linhas[0].transfSaldo).toBe(600);
  });

  it("podem ser ignorados quando a análise pede o cenário cheio", () => {
    const comp = compromissosVazios();
    comp.saidaOrigem.set(chaveCdProduto(10, 100), 400);
    comp.entradaDestino.set(chaveCdProduto(1, 100), 400);
    const r = rodar(base, params({ origens: [10], destinos: [1], considerarAprovadas: false }), [], comp);
    expect(r.linhas[0].transfSaldo).toBe(1000);
  });

  it("no modo pedidos o trânsito abate os meses mais próximos primeiro", () => {
    const comp = compromissosVazios();
    comp.entradaDestino.set(chaveCdProduto(1, 100), 250);
    const r = rodar(
      [linha(10, 100, { estoqueDisponivel: 1000 }), linha(1, 100, {})],
      params({ modoDemanda: "pedidos", origens: [10], destinos: [1] }),
      [
        { anoMes: "2026_09", cdDestino: 1, codigoProduto: 100, pedido: 200 },
        { anoMes: "2026_10", cdDestino: 1, codigoProduto: 100, pedido: 200 },
      ],
      comp,
    );
    // 250 em trânsito zeram set (200) e abatem 50 de out.
    expect(r.linhas[0].transfMes).toEqual([0, 150]);
  });
});

describe("resumos e cobertura da necessidade", () => {
  it("consolida origens, destinos e rotas", () => {
    const b = [
      linha(10, 100, { estoqueDisponivel: 500 }),
      linha(9, 100, { estoqueDisponivel: 500 }),
      linha(1, 100, { estoqueObjetivo: 300 }),
      linha(2, 100, { estoqueObjetivo: 400 }),
    ];
    const r = rodar(b, params({ origens: [10, 9], destinos: [1, 2] }));
    expect(r.origens.map((o) => o.cd)).toEqual([10, 9]);
    expect(r.destinos.map((d) => d.cd)).toEqual([1, 2]);
    // CD10 (500) atende CD1 (300) e parte do CD2 (200); o CD9 completa o CD2.
    expect(r.rotas.map((x) => x.rota).sort()).toEqual(["10>1", "10>2", "9>2"].sort());
    expect(r.destinos.every((d) => d.cobertura === 1)).toBe(true);
    // Origem 10 (500) cobre toda a necessidade (700)? Não: sobra 200 para o CD9.
    expect(r.origens[0].transferidoQtd).toBe(500);
    expect(r.origens[1].transferidoQtd).toBe(200);
  });

  it("necessidade sem oferta fica em aberto no destino", () => {
    const b = [linha(10, 100, { estoqueDisponivel: 100 }), linha(1, 100, { estoqueObjetivo: 500 })];
    const r = rodar(b, params({ origens: [10], destinos: [1] }));
    expect(r.destinos[0].aberto).toBe(400);
    expect(r.destinos[0].cobertura).toBeCloseTo(0.2, 6);
  });
});

describe("performance", () => {
  it("processa uma rede de 6 CDs × 20 mil produtos em menos de 10 s", () => {
    const cds = [10, 1, 2, 7, 8, 9];
    const base: LinhaBase[] = [];
    for (let i = 0; i < 20000; i++) {
      const codigo = 1000 + i;
      for (const cd of cds) {
        const sobra = cd === 10;
        base.push(
          linha(cd, codigo, {
            estoqueDisponivel: sobra ? 900 : 50,
            estoqueObjetivo: sobra ? 100 : 400,
            vendaMedia3m: 60,
            custoReposicao: 12.5,
            embCompra: 12,
          }),
        );
      }
    }
    const t0 = Date.now();
    const r = calcularRede(
      base,
      new Map(),
      params({ origens: [10], destinos: [1, 2, 7, 8, 9] }),
      compromissosVazios(),
    );
    const ms = Date.now() - t0;
    expect(r.linhas.length).toBeGreaterThan(0);
    expect(r.reconciliacao.invarianteOk).toBe(true);
    expect(ms).toBeLessThan(10000);
  });
});

// ---------------------------------------------------------------------------
// Regras de qualidade da necessidade, da oferta e do embarque
// ---------------------------------------------------------------------------

describe("teto e piso de cobertura no destino", () => {
  it("teto limita a necessidade a N dias de cobertura (saldo ideal)", () => {
    // CD1 vende 300/mês (10/dia) e tem objetivo inflado de 1000 un.
    const b = [
      linha(10, 100, { estoqueDisponivel: 5000 }),
      linha(1, 100, { estoqueObjetivo: 1000, vendaMedia3m: 300 }),
    ];
    const semTeto = rodar(b, params({ origens: [10], destinos: [1] }));
    expect(semTeto.linhas[0].transfSaldo).toBe(1000);

    const comTeto = rodar(b, params({ origens: [10], destinos: [1], coberturaMaxDestinoDias: 60 }));
    expect(comTeto.linhas[0].transfSaldo).toBe(600); // 10/dia × 60 dias
    expect(comTeto.destinos[0].necessidadeBrutaQtd).toBe(1000);
    expect(comTeto.destinos[0].necessidadeQtd).toBe(600);
  });

  it("teto corta os pedidos do mês mais distante para o mais próximo", () => {
    const b = [linha(10, 100, { estoqueDisponivel: 5000 }), linha(1, 100, { vendaMedia3m: 300 })];
    const r = rodar(
      b,
      params({ modoDemanda: "pedidos", origens: [10], destinos: [1], coberturaMaxDestinoDias: 60 }),
      [
        { anoMes: "2026_09", cdDestino: 1, codigoProduto: 100, pedido: 400 },
        { anoMes: "2026_10", cdDestino: 1, codigoProduto: 100, pedido: 400 },
      ],
    );
    // Teto de 600 un: mantém set (400) e corta out para 200.
    expect(r.linhas[0].transfMes).toEqual([400, 200]);
  });

  it("piso garante a demanda antirruptura quando o objetivo está zerado", () => {
    const b = [
      linha(10, 100, { estoqueDisponivel: 5000 }),
      linha(1, 100, { estoqueObjetivo: 0, estoqueDisponivel: 30, vendaMedia3m: 300 }),
    ];
    const semPiso = rodar(b, params({ origens: [10], destinos: [1] }));
    expect(semPiso.linhas).toHaveLength(0);

    const comPiso = rodar(b, params({ origens: [10], destinos: [1], coberturaMinDestinoDias: 30 }));
    expect(comPiso.linhas[0].transfSaldo).toBe(270); // 10/dia × 30 dias − 30 em casa
  });

  it("SKU sem giro no destino fica fora do teto e do piso", () => {
    const b = [
      linha(10, 100, { estoqueDisponivel: 1000 }),
      linha(1, 100, { estoqueObjetivo: 400, vendaMedia3m: 0 }),
    ];
    const r = rodar(b, params({ origens: [10], destinos: [1], coberturaMaxDestinoDias: 60, coberturaMinDestinoDias: 30 }));
    expect(r.linhas[0].transfSaldo).toBe(400);
  });
});

describe("excesso físico × excesso de planejamento", () => {
  const b = [
    linha(10, 100, { estoqueDisponivel: 100, quantidadePendente: 900 }),
    linha(1, 100, { estoqueObjetivo: 1000 }),
  ];

  it("por padrão o pendente entra no excesso", () => {
    const r = rodar(b, params({ origens: [10], destinos: [1] }));
    expect(r.origens[0].excessoQtd).toBe(1000);
    expect(r.linhas[0].transfSaldo).toBe(1000);
  });

  it("desligando o pendente, só o que está no CD é oferecido", () => {
    const r = rodar(b, params({ origens: [10], destinos: [1], considerarPendenteOrigem: false }));
    expect(r.origens[0].excessoQtd).toBe(100);
    expect(r.linhas[0].transfSaldo).toBe(100);
  });
});

describe("caixa fechada e materialidade", () => {
  it("transfere só múltiplos da embalagem e o resto segue para o próximo destino", () => {
    const b = [
      linha(10, 100, { estoqueDisponivel: 100, embCompra: 30 }),
      linha(1, 100, { estoqueObjetivo: 50 }),
      linha(2, 100, { estoqueObjetivo: 100 }),
    ];
    const r = rodar(b, params({ origens: [10], destinos: [1, 2], arredondarCaixaFechada: true }));
    const cd1 = r.linhas.find((l) => l.cdDestino === 1)!;
    const cd2 = r.linhas.find((l) => l.cdDestino === 2)!;
    expect(cd1.transfSaldo).toBe(30); // 1 caixa (pedia 50)
    expect(cd1.perdaCaixaFechada).toBe(20);
    expect(cd2.transfSaldo).toBe(60); // 2 caixas do saldo de 70
    expect(cd1.transfSaldo % 30).toBe(0);
    expect(cd2.transfSaldo % 30).toBe(0);
  });

  it("linha abaixo do mínimo de unidades não entra e libera o saldo", () => {
    const b = [
      linha(10, 100, { estoqueDisponivel: 300 }),
      linha(1, 100, { estoqueObjetivo: 50 }),
      linha(2, 100, { estoqueObjetivo: 200 }),
    ];
    const r = rodar(b, params({ origens: [10], destinos: [1, 2], minUnidadesLinha: 100 }));
    expect(r.linhas.map((l) => l.cdDestino)).toEqual([2]);
    expect(r.linhas[0].transfSaldo).toBe(200);
  });

  it("linha abaixo do mínimo em R$ não entra", () => {
    const b = [
      linha(10, 100, { estoqueDisponivel: 300, custoReposicao: 2 }),
      linha(1, 100, { estoqueObjetivo: 50 }),
    ];
    const r = rodar(b, params({ origens: [10], destinos: [1], minValorLinha: 500 }));
    expect(r.linhas).toHaveLength(0); // 50 × R$ 2 = R$ 100
  });

  it("rota abaixo da carga mínima é descartada do plano", () => {
    const b = [
      linha(10, 100, { estoqueDisponivel: 1000 }),
      linha(1, 100, { estoqueObjetivo: 900 }),
      linha(2, 100, { estoqueObjetivo: 5 }),
    ];
    const r = rodar(b, params({ origens: [10], destinos: [1, 2], minValorRota: 1000 }));
    // CD1 leva R$ 9.000; a rota 10>2 fica em R$ 50 e sai do plano.
    expect(r.rotas.map((x) => x.rota)).toEqual(["10>1"]);
    expect(r.linhas).toHaveLength(1);
    expect(r.meta.valorTransfTotal).toBe(9000);
  });
});

describe("nivelamento por dias de cobertura", () => {
  it("distribui proporcional ao giro quando os destinos partem da mesma cobertura", () => {
    expect(nivelarPorCobertura([600, 300], [0, 0], [10, 5], 300)).toEqual([200, 100]);
  });

  it("enche primeiro quem está mais descoberto", () => {
    // CD1 tem 10 dias de cobertura; CD2 está zerado. 50 un sobem o CD2 a 10 dias.
    expect(nivelarPorCobertura([600, 300], [100, 0], [10, 5], 50)).toEqual([0, 50]);
  });

  it("respeita o limite de necessidade de cada destino", () => {
    const r = nivelarPorCobertura([100, 300], [0, 0], [10, 5], 400);
    expect(r[0]).toBe(100);
    expect(r[1]).toBe(300);
  });

  it("na análise, evita que o último destino da fila fique sem nada", () => {
    const b = [
      linha(10, 100, { estoqueDisponivel: 300 }),
      linha(1, 100, { estoqueObjetivo: 600, vendaMedia3m: 300 }),
      linha(2, 100, { estoqueObjetivo: 300, vendaMedia3m: 150 }),
    ];
    const estrita = rodar(b, params({ origens: [10], destinos: [1, 2] }));
    expect(estrita.linhas.find((l) => l.cdDestino === 1)!.transfSaldo).toBe(300);
    expect(estrita.linhas.find((l) => l.cdDestino === 2)).toBeUndefined();

    const nivelado = rodar(b, params({ origens: [10], destinos: [1, 2], estrategiaDestino: "nivelar_cobertura" }));
    expect(nivelado.linhas.find((l) => l.cdDestino === 1)!.transfSaldo).toBe(200);
    expect(nivelado.linhas.find((l) => l.cdDestino === 2)!.transfSaldo).toBe(100);
    // Os dois terminam com a mesma cobertura (20 dias).
    expect(nivelado.meta.qtdTransfTotal).toBe(300);
  });

  it("nivelamento também respeita caixa fechada", () => {
    const b = [
      linha(10, 100, { estoqueDisponivel: 300, embCompra: 30 }),
      linha(1, 100, { estoqueObjetivo: 600, vendaMedia3m: 300 }),
      linha(2, 100, { estoqueObjetivo: 300, vendaMedia3m: 150 }),
    ];
    const r = rodar(
      b,
      params({ origens: [10], destinos: [1, 2], estrategiaDestino: "nivelar_cobertura", arredondarCaixaFechada: true }),
    );
    for (const l of r.linhas) expect(l.transfTotal % 30).toBe(0);
  });
});
