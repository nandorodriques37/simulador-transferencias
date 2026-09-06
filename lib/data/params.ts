import { ParametrosRede } from "@/lib/engine/types";

/**
 * Valida e normaliza os parâmetros de uma análise vindos da UI.
 * Compartilhado por `/api/params` (salvar) e `/api/analise` (rodar).
 */
export function normalizarParametros(
  body: Partial<ParametrosRede>,
): { erro?: string; params?: ParametrosRede } {
  if (body.modoDemanda !== "saldo_ideal" && body.modoDemanda !== "pedidos")
    return { erro: "modoDemanda inválido (use 'saldo_ideal' ou 'pedidos')" };
  if (!Array.isArray(body.origens) || body.origens.length === 0)
    return { erro: "selecione ao menos um CD de origem" };
  if (!Array.isArray(body.destinos) || body.destinos.length === 0)
    return { erro: "selecione ao menos um CD de destino" };

  const origens = body.origens.map(Number).filter((n) => !isNaN(n));
  const destinos = body.destinos.map(Number).filter((n) => !isNaN(n));
  // Um CD pode ser origem e destino; só não pode transferir para si mesmo — o
  // que só bloqueia a análise quando não sobra nenhum par válido.
  const temRota = origens.some((o) => destinos.some((d) => d !== o));
  if (!temRota) return { erro: "não há rota possível: os destinos são os próprios CDs de origem" };

  if (body.modoDemanda === "pedidos" && (!Array.isArray(body.horizonteMeses) || body.horizonteMeses.length === 0))
    return { erro: "informe ao menos um mês no horizonte para o modo Pedidos" };
  if (typeof body.fatorSegurancaImediata !== "number" || body.fatorSegurancaImediata < 0)
    return { erro: "fator de segurança inválido" };
  if (typeof body.limiteCoberturaDias !== "number" || body.limiteCoberturaDias <= 0)
    return { erro: "limite de cobertura inválido" };

  const num = (v: unknown, padrao = 0) => {
    const n = Number(v);
    return isNaN(n) || n < 0 ? padrao : n;
  };
  const coberturaMax = num(body.coberturaMaxDestinoDias);
  const coberturaMin = num(body.coberturaMinDestinoDias);
  if (coberturaMax > 0 && coberturaMin > coberturaMax)
    return { erro: "o piso de cobertura do destino não pode ser maior que o teto" };
  if (body.estrategiaDestino && body.estrategiaDestino !== "prioridade" && body.estrategiaDestino !== "nivelar_cobertura")
    return { erro: "estratégia de destino inválida" };

  return {
    params: {
      modoDemanda: body.modoDemanda,
      origens,
      destinos,
      horizonteMeses: body.horizonteMeses ?? [],
      aliquotas: Object.fromEntries(
        Object.entries(body.aliquotas ?? {}).map(([k, v]) => [k, Number(v) || 0]),
      ),
      fatorSegurancaImediata: Number(body.fatorSegurancaImediata),
      limiteCoberturaDias: Number(body.limiteCoberturaDias),
      considerarAprovadas: body.considerarAprovadas !== false,
      considerarPendenteOrigem: body.considerarPendenteOrigem !== false,
      coberturaMaxDestinoDias: coberturaMax,
      coberturaMinDestinoDias: coberturaMin,
      estrategiaDestino: body.estrategiaDestino === "nivelar_cobertura" ? "nivelar_cobertura" : "prioridade",
      arredondarCaixaFechada: body.arredondarCaixaFechada === true,
      minUnidadesLinha: num(body.minUnidadesLinha),
      minValorLinha: num(body.minValorLinha),
      minValorRota: num(body.minValorRota),
    },
  };
}
