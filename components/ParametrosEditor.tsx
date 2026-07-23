"use client";

import { CdManager, ModeloTransferencia, Parametros } from "./CdManager";
import { rotuloMes } from "@/lib/format";

/**
 * Editor único dos parâmetros de negócio (modelo de transferência + CDs +
 * alíquotas + fator de segurança + limite de cobertura + horizonte).
 * Compartilhado entre a aba "Parâmetros" (onde é salvo e vira versão oficial) e
 * o "Simulador" (onde é usado como cenário what-if). Evita a duplicação dos
 * mesmos campos em duas telas.
 */
export function ParametrosEditor({
  params,
  disponiveis,
  onChange,
}: {
  params: Parametros;
  disponiveis: number[];
  onChange: (p: Parametros) => void;
}) {
  const setP = (patch: Partial<Parametros>) => onChange({ ...params, ...patch });
  const objetivoMode = params.modelo === "estoque_objetivo";

  return (
    <div>
      <ModeloSelector modelo={params.modelo} onChange={(modelo) => setP({ modelo })} />

      <CdManager params={params} disponiveis={disponiveis} onChange={onChange} />

      <div className="mt-4 grid grid-cols-2 gap-2">
        <label className="text-sm">
          <span className="label">Fator segurança imediata</span>
          <input
            type="number" step="0.1" min="0" className="input mt-1 w-full"
            value={params.fatorSegurancaImediata}
            onChange={(e) => setP({ fatorSegurancaImediata: Number(e.target.value) })}
          />
        </label>
        <label className="text-sm">
          <span className="label">Limite cobertura (dias)</span>
          <input
            type="number" min="1" className="input mt-1 w-full"
            value={params.limiteCoberturaDias}
            onChange={(e) => setP({ limiteCoberturaDias: Number(e.target.value) })}
          />
        </label>
      </div>

      <label className="mt-3 block text-sm">
        <span className="label">Horizonte (meses AAAA_MM)</span>
        <input
          className="input mt-1 w-full"
          value={params.horizonteMeses.join(", ")}
          onChange={(e) => setP({ horizonteMeses: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
        />
        <div className="mt-1 text-xs text-slate-400">
          {objetivoMode
            ? "No modelo Estoque Objetivo o horizonte só define as colunas mês a mês (que saem zeradas na base de acompanhamento)."
            : params.horizonteMeses.map(rotuloMes).join(" · ")}
        </div>
      </label>
    </div>
  );
}

/** Seletor do modelo de transferência (modelo híbrido). */
function ModeloSelector({ modelo, onChange }: { modelo: ModeloTransferencia; onChange: (m: ModeloTransferencia) => void }) {
  const opcoes: { valor: ModeloTransferencia; titulo: string; desc: string; icone: string }[] = [
    { valor: "drp", titulo: "DRP (pedidos)", desc: "Distribui o excesso pelos pedidos projetados, mês a mês por CD.", icone: "📅" },
    { valor: "estoque_objetivo", titulo: "Estoque objetivo", desc: "Envia o excesso para atender o saldo de estoque objetivo de cada CD (sem quebra mensal).", icone: "🎯" },
  ];
  return (
    <div className="mb-4">
      <span className="label">Modelo de transferência</span>
      <div className="mt-1 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {opcoes.map((o) => {
          const ativo = modelo === o.valor;
          return (
            <button
              key={o.valor}
              type="button"
              onClick={() => onChange(o.valor)}
              className={`rounded-lg border p-2.5 text-left transition-colors ${
                ativo ? "border-brand-500 bg-brand-50 ring-1 ring-brand-500" : "border-slate-200 bg-white hover:bg-slate-50"
              }`}
            >
              <div className={`flex items-center gap-1.5 text-sm font-semibold ${ativo ? "text-brand-700" : "text-slate-700"}`}>
                <span>{o.icone}</span>
                {o.titulo}
                {ativo && <span className="ml-auto text-[11px] font-medium text-brand-600">● ativo</span>}
              </div>
              <div className="mt-1 text-[11px] leading-snug text-slate-500">{o.desc}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
