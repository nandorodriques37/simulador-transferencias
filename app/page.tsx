"use client";

import { useState } from "react";
import Link from "next/link";
import { Alert, Badge, Barra, Cd, Decisao, ErroCarga, Estado, Fonte, Insight, Kpi, Kpis, PageHeader, Pill, Ressalvas, Revalidando, Rolagem, Rota, Secao, Seg, Spinner } from "@/components/ui";
import { fmtCap, fmtInt, fmtPct, fmtRs, fmtRsCompacto, rotuloMes, rotuloRota } from "@/lib/format";
import { useApi } from "@/lib/useApi";

interface ResumoRota {
  cdOrigem: number; cdDestino: number; rota: string; aliquota: number; aliquotaDefinida: boolean;
  qtdMes: number[]; valorMes: number[]; qtd: number; valor: number;
  qtdImediata: number; valorImediata: number; impactoFiscal: number; linhas: number;
  capacidadeLimite: number; capacidadeComprometida: number; capacidadeUsada: number; bloqueadoPorCapacidade: number;
}
interface Capacidade { capacidadeLimite: number; capacidadeComprometida: number; capacidadeUsada: number; bloqueadoPorCapacidade: number }
interface ResumoOrigem extends Capacidade { cd: number; ordem: number; excessoQtd: number; excessoRs: number; transferidoQtd: number; transferidoRs: number; sobraQtd: number; sobraRs: number; skusComExcesso: number }
interface ResumoDestino extends Capacidade { cd: number; ordem: number; necessidadeBrutaQtd: number; necessidadeQtd: number; necessidadeRs: number; atendidoQtd: number; atendidoRs: number; aberto: number; cobertura: number }
interface DashResp {
  analise: { id: string; label: string; criadoEm: string; criadoPor: string; fonteBase: string };
  cobertura: "total" | "acima_limite";
  modoDemanda: "saldo_ideal" | "pedidos";
  meses: string[];
  sequenciaOrigens: number[];
  sequenciaDestinos: number[];
  consideraAprovadas: boolean;
  regras: {
    coberturaMaxDestinoDias: number;
    coberturaMinDestinoDias: number;
    estrategiaDestino: "prioridade" | "nivelar_cobertura";
    considerarPendenteOrigem: boolean;
    arredondarCaixaFechada: boolean;
    minValorRota: number;
    semRestricoes: boolean;
  };
  kpis: {
    excessoDisponivelRs: number; valorTransfTotal: number; qtdTransfTotal: number;
    necessidadeTotalRs: number; coberturaNecessidade: number; usoDoExcesso: number;
    valorImediata: number; impactoFiscalTotal: number; linhasPlano: number;
    skusDistintos: number; rotasAtivas: number; rotasSemAliquota: string[];
  };
  capacidade: {
    metrica: string;
    qtdBloqueada: number;
    valorBloqueado: number;
    skusSemFator: number;
    gargalos: { tipo: "origem" | "destino" | "rota"; id: string; bloqueado: number }[];
  };
  rotas: ResumoRota[];
  origens: ResumoOrigem[];
  destinos: ResumoDestino[];
  tempoMs: number;
  somenteResultado?: boolean;
  planoDisponivel?: boolean;
  aprovado?: { linhas: number; qtd: number; valor: number; em: string } | null;
  erro?: string;
  semAnalise?: boolean;
}

interface AnaliseHistorico {
  id: string; criadoEm: string; criadoPor: string; label: string; fonteBase: string;
  modoDemanda: string; origens: number[]; destinos: number[]; tempoMs: number;
  kpis: { valorTransfTotal: number; coberturaNecessidade: number; impactoFiscalTotal: number; linhasPlano: number };
  aprovado?: { linhas: number; qtd: number; valor: number; em: string };
}

/** Barra de utilização de capacidade: comprometido (carteira) + usado nesta análise. */
function Utilizacao({ limite, comprometido, usado }: { limite: number; comprometido: number; usado: number }) {
  if (limite <= 0) return <span className="text-xs text-ink-3">sem limite</span>;
  const comp = Math.min(100, (comprometido / limite) * 100);
  const uso = Math.min(100 - comp, (usado / limite) * 100);
  const total = (comprometido + usado) / limite;
  const estado = total >= 0.999 ? "alto" : total >= 0.85 ? "atencao" : undefined;
  return (
    <div className="util" data-estado={estado}>
      <div className="util__trilho">
        <span className="util__comp" style={{ width: `${comp}%` }} />
        <span className="util__uso" style={{ left: `${comp}%`, width: `${uso}%` }} />
      </div>
      <span className="util__v">{fmtPct(total, 0)}</span>
    </div>
  );
}

export default function Dashboard() {
  const [cobertura, setCobertura] = useState<"total" | "acima_limite">("total");
  const painel = useApi<DashResp>(`/api/dashboard?cobertura=${cobertura}`);
  const hist = useApi<{ analises: AnaliseHistorico[]; duravel: boolean }>("/api/analise");
  const data = painel.data;
  const historico = hist.data?.analises ?? [];
  const duravel = !!hist.data?.duravel;

  if (painel.carregando) return <Spinner label="Abrindo o dashboard…" />;
  if (painel.erro && !data) return <ErroCarga erro={painel.erro} onTentar={painel.recarregar} />;
  if (!data) return null;

  if (data.semAnalise || data.erro) {
    return (
      <>
        <PageHeader title="Nenhuma análise rodada ainda" subtitle="O dashboard mostra o resultado da última análise de rede desta instância." />
        <Estado
          icone="analise"
          rotulo="Dashboard"
          titulo="Defina origens e destinos e rode a primeira análise"
          texto="A base e o resultado ficam na memória do servidor. Depois de um novo deploy, ou de um período ocioso, é preciso importar a base e rodar a análise de novo. A carteira de sugestões aprovadas, essa sim, fica no banco."
          acoes={<Link href="/analise" className="pgm-botao">Nova análise</Link>}
        />
      </>
    );
  }

  const { kpis, rotas, origens, destinos, meses } = data;
  const modoPedidos = data.modoDemanda === "pedidos";

  // Matriz origem × destino (valor R$) na sequência escolhida pelo usuário.
  const valorRota = new Map(rotas.map((r) => [r.rota, r.valor]));
  const maxCelula = Math.max(1, ...rotas.map((r) => r.valor));
  // Calor em azul (série 1), de 8% a 72% de mistura. O valor está sempre escrito.
  const calor = (v: number) => 8 + 64 * (v / maxCelula);
  const totalPorOrigem = (o: number) => rotas.filter((r) => r.cdOrigem === o).reduce((a, r) => a + r.valor, 0);
  const totalPorDestino = (d: number) => rotas.filter((r) => r.cdDestino === d).reduce((a, r) => a + r.valor, 0);
  const temCapacidade =
    origens.some((o) => o.capacidadeLimite > 0) ||
    destinos.some((d) => d.capacidadeLimite > 0) ||
    rotas.some((r) => r.capacidadeLimite > 0);
  const unidadeCap = { unidades: "un", caixas: "cx", paletes: "pal", peso: "kg", volume: "m³", valor: "R$" }[
    data.capacidade?.metrica ?? "unidades"
  ] ?? "un";
  const rotasOrdenadas = [...rotas].sort((a, b) => b.valor - a.valor);
  const maxRota = Math.max(1, ...rotasOrdenadas.map((r) => r.valor));
  const gargalo = data.capacidade?.gargalos?.[0];
  // "a expedição do CD 10" · "o recebimento do CD 1" · "o transporte CD 10 → CD 8"
  const nomeGargalo = gargalo ? (gargalo.tipo === "rota" ? `transporte ${rotuloRota(gargalo.id)}` : `${gargalo.tipo === "origem" ? "expedição" : "recebimento"} do ${gargalo.id}`) : "";
  const artigo = gargalo?.tipo === "origem" ? "a" : "o";
  const linhasCap = [
    ...origens.filter((o) => o.capacidadeLimite > 0 || o.bloqueadoPorCapacidade > 0).map((o) => ({ chave: `o${o.cd}`, nome: <Cd n={o.cd} />, papel: "Expedição", ...o })),
    ...destinos.filter((d) => d.capacidadeLimite > 0 || d.bloqueadoPorCapacidade > 0).map((d) => ({ chave: `d${d.cd}`, nome: <Cd n={d.cd} />, papel: "Recebimento", ...d })),
    ...rotas.filter((r) => r.capacidadeLimite > 0 || r.bloqueadoPorCapacidade > 0).map((r) => ({ chave: `r${r.rota}`, nome: <Rota origem={r.cdOrigem} destino={r.cdDestino} />, papel: "Transporte", ...r })),
  ];
  const destinosAjustados = destinos.filter((d) => Math.abs(d.necessidadeBrutaQtd - d.necessidadeQtd) > 1).length;
  const emAberto = Math.max(0, kpis.necessidadeTotalRs - kpis.valorTransfTotal);
  const dataBase = data.analise.criadoEm ? new Date(data.analise.criadoEm).toLocaleDateString("pt-BR") : "";

  return (
    <>
      <PageHeader
        title={<>{fmtRsCompacto(kpis.valorTransfTotal)} cobrem {fmtPct(kpis.coberturaNecessidade, 0)} da necessidade da rede</>}
        subtitle={
          <>
            Análise {data.analise.id} · {modoPedidos ? "consumindo pedidos futuros" : "atendendo o saldo ideal"} ·{" "}
            {data.sequenciaOrigens.length} origem(ns) → {data.sequenciaDestinos.length} destino(s) · valores em R$
          </>
        }
        right={
          <>
            <Revalidando ativo={painel.revalidando} />
            <Seg
              label="Cobertura na origem"
              valor={cobertura}
              onChange={setCobertura}
              opcoes={[{ valor: "total", rotulo: "Total" }, { valor: "acima_limite", rotulo: "Estoque parado" }]}
            />
            <Link href="/analise" className="pgm-botao pgm-botao--secundario">Nova análise</Link>
            {data.planoDisponivel !== false && <Link href="/plano" className="pgm-botao">Abrir o plano</Link>}
          </>
        }
      />

      <div className="parametros" aria-label="Parâmetros desta análise">
        <span className="rot">Parâmetros</span>
        <Badge tom="azul">Origens: {data.sequenciaOrigens.map((c) => `CD ${c}`).join(" → ")}</Badge>
        <Badge tom="azul">Destinos: {data.sequenciaDestinos.map((c) => `CD ${c}`).join(" → ")}</Badge>
        <Badge>{modoPedidos ? `Pedidos · ${meses.map(rotuloMes).join(", ")}` : "Saldo ideal"}</Badge>
        {data.consideraAprovadas && <Badge>Desconta a carteira aprovada</Badge>}
        {(data.regras?.coberturaMaxDestinoDias > 0 || data.regras?.coberturaMinDestinoDias > 0) && (
          <Badge>
            {[data.regras.coberturaMaxDestinoDias > 0 && `Teto ${data.regras.coberturaMaxDestinoDias} d`, data.regras.coberturaMinDestinoDias > 0 && `Piso ${data.regras.coberturaMinDestinoDias} d`].filter(Boolean).join(" · ")}
          </Badge>
        )}
        {data.regras?.estrategiaDestino === "nivelar_cobertura" && <Badge>Nivelando cobertura</Badge>}
        {data.regras && !data.regras.considerarPendenteOrigem && <Badge>Excesso físico</Badge>}
        {data.regras?.arredondarCaixaFechada && <Badge>Caixa fechada</Badge>}
        {temCapacidade && <Badge>Capacidade em {unidadeCap}</Badge>}
        {data.regras?.semRestricoes && <Badge tom="good">Sem restrições</Badge>}
      </div>

      {(painel.erro || data.somenteResultado || (data.aprovado && data.aprovado.linhas > 0) || kpis.rotasSemAliquota.length > 0) && (
        <div className="flex flex-col gap-3">
          {painel.erro && (
            <Alert tom="erro" titulo="Falha ao atualizar" acao={<button onClick={painel.recarregar} className="pgm-botao pgm-botao--secundario" type="button">Tentar de novo</button>}>
              {painel.erro}. Os números abaixo são da última carga bem-sucedida.
            </Alert>
          )}
          {data.somenteResultado && (
            <Alert tom="info" titulo="Resultado salvo" acao={<Link href="/plano" className="pgm-botao pgm-botao--secundario">Abrir o plano</Link>}>
              KPIs e resumos por rota, origem e destino desta análise.{" "}
              {data.planoDisponivel ? "O detalhe por SKU está guardado: no Plano você filtra, exporta e aprova." : "O detalhe por SKU não está aqui; o Plano oferece recalculá-lo."}
            </Alert>
          )}
          {data.aprovado && data.aprovado.linhas > 0 && (
            <Alert tom="good" titulo="Carteira" acao={<Link href="/carteira" className="pgm-botao pgm-botao--secundario">Ver carteira</Link>}>
              Desta análise já saíram <b>{fmtInt(data.aprovado.linhas)} linhas</b> para a carteira: {fmtInt(data.aprovado.qtd)} un, {fmtRsCompacto(data.aprovado.valor)}. Elas seguem descontando origem e destino até o faturamento ser importado.
            </Alert>
          )}
          {kpis.rotasSemAliquota.length > 0 && (
            <Alert tom="warn" titulo={`${kpis.rotasSemAliquota.length} rota(s) sem alíquota`} acao={<Link href="/analise#p5" className="pgm-botao pgm-botao--secundario">Informar alíquota</Link>}>
              <b>{kpis.rotasSemAliquota.map(rotuloRota).join(" · ")}</b> entram com 0% no impacto fiscal, que fica subestimado.
            </Alert>
          )}
        </div>
      )}

      <Kpis label="Indicadores da análise">
        <Kpi titulo="Excesso nas origens" valor={fmtRsCompacto(kpis.excessoDisponivelRs)} sub={`${fmtPct(kpis.usoDoExcesso, 0)} aproveitado no plano`} />
        <Kpi titulo="Transferências planejadas" valor={fmtRsCompacto(kpis.valorTransfTotal)} sub={`${fmtInt(kpis.qtdTransfTotal)} un · ${fmtInt(kpis.linhasPlano)} linhas · ${fmtInt(kpis.skusDistintos)} SKUs`} />
        <Kpi titulo="Necessidade coberta" valor={fmtPct(kpis.coberturaNecessidade, 1)} sub={`de ${fmtRsCompacto(kpis.necessidadeTotalRs)} demandados · ${fmtRsCompacto(emAberto)} em aberto`} />
        <Kpi
          titulo="Impacto fiscal (ICMS)"
          valor={fmtRsCompacto(kpis.impactoFiscalTotal)}
          sub={`Saída imediata: ${fmtRsCompacto(kpis.valorImediata)}`}
          tom={kpis.rotasSemAliquota.length > 0 ? "warn" : "default"}
          badge={kpis.rotasSemAliquota.length > 0 ? `${kpis.rotasSemAliquota.length} rota(s) sem alíquota` : undefined}
        />
      </Kpis>

      <div className="flex flex-col gap-3">
        {gargalo ? (
          <>
            <Insight>
              {artigo === "a" ? "A" : "O"} <b>{nomeGargalo}</b> é o gargalo da rede: <b>{fmtInt(gargalo.bloqueado)} un</b> barradas
              {data.capacidade.valorBloqueado > 0 && <> ({fmtRsCompacto(data.capacidade.valorBloqueado)} no total)</>}. Ampliar esse ponto libera mais volume do que mudar a ordem dos destinos.
            </Insight>
            <Decisao>Ampliar {artigo} {nomeGargalo} ou aceitar que {fmtRsCompacto(data.capacidade.valorBloqueado)} sigam em aberto para a próxima análise.</Decisao>
          </>
        ) : (
          <Insight>
            O plano cobre <b>{fmtPct(kpis.coberturaNecessidade, 0)}</b> da necessidade com <b>{fmtPct(kpis.usoDoExcesso, 0)}</b> do excesso das origens.{" "}
            {emAberto > 0 ? <>Ficam <b>{fmtRsCompacto(emAberto)}</b> em aberto para a próxima análise.</> : "Nenhuma necessidade ficou em aberto."}
          </Insight>
        )}
      </div>

      {/* ------------------------- Matriz origem × destino ------------------------- */}
      <Secao titulo="Matriz origem → destino" desc="Valor transferido em cada rota, na sequência escolhida · R$">
        <Rolagem>
          <table className="mx">
            <caption className="sr-only">Valor transferido por origem e destino, em reais.</caption>
            <thead>
              <tr>
                <th scope="col">Origem \ destino</th>
                {data.sequenciaDestinos.map((d, i) => (
                  <th key={d} scope="col">CD {d}<small>{i + 1}º destino</small></th>
                ))}
                <th scope="col">Total<small>saída da origem</small></th>
              </tr>
            </thead>
            <tbody>
              {data.sequenciaOrigens.map((o, i) => (
                <tr key={o}>
                  <th scope="row">CD {o}<small style={{ display: "block", fontSize: 12, fontWeight: 500, color: "var(--ink-3)" }}>{i + 1}ª origem</small></th>
                  {data.sequenciaDestinos.map((d) => {
                    if (o === d) return <td key={d} className="mx-vazio">mesmo CD</td>;
                    const v = valorRota.get(`${o}>${d}`) ?? 0;
                    if (v <= 0) return <td key={d} className="mx-vazio">sem rota</td>;
                    const n = calor(v);
                    return (
                      <td key={d} style={{ ["--n" as string]: n }} data-forte={n > 55 ? "true" : undefined} title={`CD ${o} → CD ${d}: ${fmtRs(v)}`}>
                        {fmtRsCompacto(v)}
                      </td>
                    );
                  })}
                  <td className="mx-total">{fmtRsCompacto(totalPorOrigem(o))}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">Total recebido</th>
                {data.sequenciaDestinos.map((d) => <td key={d}>{fmtRsCompacto(totalPorDestino(d))}</td>)}
                <td>{fmtRsCompacto(kpis.valorTransfTotal)}</td>
              </tr>
            </tfoot>
          </table>
        </Rolagem>
        <div className="mx-leg">
          Menos <i style={{ ["--n" as string]: 10 }} /><i style={{ ["--n" as string]: 25 }} /><i style={{ ["--n" as string]: 40 }} /><i style={{ ["--n" as string]: 55 }} /><i style={{ ["--n" as string]: 70 }} /> mais
          <span>·</span>O valor está escrito em cada célula; a cor só ajuda a achar as maiores rotas.
        </div>
      </Secao>

      <div className="app-grade">
        {/* --------------------------- Origens --------------------------- */}
        <Secao flush titulo="Origens: quanto do excesso escoou" desc="Na ordem de análise · o que sobra continua parado no CD">
          <Rolagem>
            <table className="pgm-tabela">
              <thead>
                <tr><th>Origem</th><th className="pgm-num">Excesso</th><th className="pgm-num">Transferido</th><th>Aproveitado</th><th className="pgm-num">Fica parado</th></tr>
              </thead>
              <tbody>
                {origens.map((o) => (
                  <tr key={o.cd}>
                    <td><Cd n={o.cd} ordem={`${o.ordem}ª`} /></td>
                    <td className="pgm-num">{fmtRsCompacto(o.excessoRs)}</td>
                    <td className="pgm-num">{fmtRsCompacto(o.transferidoRs)}</td>
                    <td><Barra pct={o.excessoRs > 0 ? o.transferidoRs / o.excessoRs : 0} /></td>
                    <td className="pgm-num">{fmtRsCompacto(o.sobraRs)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>Rede</td>
                  <td className="pgm-num">{fmtRsCompacto(kpis.excessoDisponivelRs)}</td>
                  <td className="pgm-num">{fmtRsCompacto(kpis.valorTransfTotal)}</td>
                  <td><Barra pct={kpis.usoDoExcesso} /></td>
                  <td className="pgm-num">{fmtRsCompacto(Math.max(0, kpis.excessoDisponivelRs - kpis.valorTransfTotal))}</td>
                </tr>
              </tfoot>
            </table>
          </Rolagem>
        </Secao>

        {/* -------------------------- Destinos --------------------------- */}
        <Secao flush titulo="Destinos: quanto da necessidade foi coberto" desc="Na ordem de prioridade · bruta → considerada após teto e piso · o aberto segue para a próxima análise">
          <Rolagem>
            <table className="pgm-tabela">
              <thead>
                <tr><th>Destino</th><th className="pgm-num">Necessidade</th><th className="pgm-num">Coberto</th><th>Cobertura</th><th className="pgm-num">Em aberto</th></tr>
              </thead>
              <tbody>
                {destinos.map((d) => {
                  const ajustada = Math.abs(d.necessidadeBrutaQtd - d.necessidadeQtd) > 1;
                  return (
                    <tr key={d.cd}>
                      <td><Cd n={d.cd} ordem={`${d.ordem}º`} /></td>
                      <td className="pgm-num">
                        {ajustada ? (
                          <span className="de-para" title="Demanda bruta antes do teto e piso de cobertura → considerada">
                            <s>{fmtInt(d.necessidadeBrutaQtd)} un</s> → <b>{fmtInt(d.necessidadeQtd)} un</b>
                          </span>
                        ) : (
                          fmtRsCompacto(d.necessidadeRs)
                        )}
                        {ajustada && <span className="sub">{fmtRsCompacto(d.necessidadeRs)}</span>}
                      </td>
                      <td className="pgm-num">{fmtRsCompacto(d.atendidoRs)}</td>
                      <td><Barra pct={d.cobertura} tom={d.cobertura >= 0.999 ? "good" : "brand"} /></td>
                      <td className="pgm-num">{fmtRsCompacto(Math.max(0, d.necessidadeRs - d.atendidoRs))}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td>Rede</td>
                  <td className="pgm-num">{fmtRsCompacto(kpis.necessidadeTotalRs)}</td>
                  <td className="pgm-num">{fmtRsCompacto(kpis.valorTransfTotal)}</td>
                  <td><Barra pct={kpis.coberturaNecessidade} /></td>
                  <td className="pgm-num">{fmtRsCompacto(emAberto)}</td>
                </tr>
              </tfoot>
            </table>
          </Rolagem>
        </Secao>
      </div>

      {/* ----------------------- Capacidade operacional ------------------- */}
      {(temCapacidade || data.capacidade?.qtdBloqueada > 0) && (
        <Secao
          flush
          titulo="Capacidade operacional"
          desc={`Cada alocação consome expedição, recebimento e transporte ao mesmo tempo · métrica: ${unidadeCap} · sugestões aprovadas e não faturadas já ocupam capacidade`}
        >
          {(gargalo || data.capacidade?.skusSemFator > 0) && (
            <div className="flex flex-col gap-3" style={{ padding: "0 24px 16px" }}>
              {gargalo && (
                <Alert tom="erro" titulo="Gargalo da rede">
                  {data.capacidade.gargalos.slice(0, 3).map((g, i) => (
                    <span key={g.tipo + g.id}>
                      {i > 0 && " · "}
                      <b>{g.tipo === "rota" ? rotuloRota(g.id) : g.id}</b> ({g.tipo}) barrou {fmtInt(g.bloqueado)} un
                    </span>
                  ))}
                  . É onde ampliar capacidade libera mais transferência.
                </Alert>
              )}
              {data.capacidade?.skusSemFator > 0 && (
                <Alert tom="info" titulo={`${fmtInt(data.capacidade.skusSemFator)} SKU(s) sem fator`}>
                  Sem o dado de <b>{data.capacidade.metrica}</b> na base, eles não consomem capacidade: a utilização abaixo está subestimada.
                </Alert>
              )}
            </div>
          )}
          <Rolagem>
            <table className="pgm-tabela">
              <thead>
                <tr><th>Ponto</th><th>Papel</th><th className="pgm-num">Limite</th><th className="pgm-num">Comprometido</th><th className="pgm-num">Usado</th><th>Utilização</th><th className="pgm-num">Barrado (un)</th></tr>
              </thead>
              <tbody>
                {linhasCap.map((x) => {
                  const eGargalo = x.bloqueadoPorCapacidade > 0;
                  return (
                    <tr key={x.chave} className={eGargalo ? "gargalo" : undefined}>
                      <td>{x.nome}{eGargalo && <span className="pgm-status pgm-status--atrasado" style={{ marginLeft: 8 }}>Gargalo</span>}</td>
                      <td>{x.papel}</td>
                      <td className="pgm-num">{x.capacidadeLimite > 0 ? fmtCap(x.capacidadeLimite) : "sem limite"}</td>
                      <td className="pgm-num">{fmtCap(x.capacidadeComprometida)}</td>
                      <td className="pgm-num">{fmtCap(x.capacidadeUsada)}</td>
                      <td><Utilizacao limite={x.capacidadeLimite} comprometido={x.capacidadeComprometida} usado={x.capacidadeUsada} /></td>
                      <td className="pgm-num">{eGargalo ? <b>{fmtInt(x.bloqueadoPorCapacidade)}</b> : "0"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Rolagem>
          <div style={{ padding: "0 24px 20px" }}>
            <div className="util-leg">
              <span><i style={{ background: "var(--cinza-serie)", opacity: 0.55 }} />Comprometido pela carteira aprovada</span>
              <span><i style={{ background: "var(--serie-1)" }} />Usado nesta análise</span>
              <span><i style={{ background: "var(--coral)" }} />No limite</span>
            </div>
          </div>
        </Secao>
      )}

      {/* --------------------------- Rotas --------------------------- */}
      <Secao
        flush
        titulo="Rotas, da maior para a menor"
        desc={modoPedidos ? "Quebra mensal do que cada rota abate de pedidos · a barra mostra o valor transferido" : "Volume, saída imediata e impacto fiscal por rota · a barra mostra o valor transferido"}
        right={<Link href="/plano" className="app-card__lado">Abrir no plano →</Link>}
      >
        <Rolagem>
          <table className="pgm-tabela">
            <thead>
              <tr>
                <th>Rota</th>
                <th className="pgm-num">SKUs</th>
                <th className="pgm-num">Unidades</th>
                {modoPedidos && meses.map((m) => <th key={m} className="pgm-num">{rotuloMes(m)}</th>)}
                <th className="pgm-num">Valor</th>
                <th className="pgm-num">Imediata</th>
                <th className="pgm-num">ICMS</th>
                <th className="pgm-num">Alíquota</th>
              </tr>
            </thead>
            <tbody>
              {rotasOrdenadas.map((r) => (
                <tr key={r.rota}>
                  <td><Rota origem={r.cdOrigem} destino={r.cdDestino} /></td>
                  <td className="pgm-num">{fmtInt(r.linhas)}</td>
                  <td className="pgm-num">{fmtInt(r.qtd)}</td>
                  {modoPedidos && r.valorMes.map((v, i) => <td key={i} className="pgm-num">{fmtRsCompacto(v)}</td>)}
                  <td className="pgm-barra pgm-num">
                    <span className="pgm-barra__fundo" style={{ width: `${(r.valor / maxRota) * 100}%` }} />
                    <span className="pgm-barra__valor">{fmtRsCompacto(r.valor)}</span>
                  </td>
                  <td className="pgm-num">{fmtRsCompacto(r.valorImediata)}</td>
                  <td className="pgm-num">{fmtRsCompacto(r.impactoFiscal)}</td>
                  <td className="pgm-num">{r.aliquotaDefinida ? fmtPct(r.aliquota, 1) : <Pill tom="ambar" pequena>sem alíquota</Pill>}</td>
                </tr>
              ))}
              {rotasOrdenadas.length === 0 && (
                <tr><td colSpan={7 + (modoPedidos ? meses.length : 0)} style={{ textAlign: "center", color: "var(--ink-2)" }}>Nenhuma transferência sugerida com os filtros atuais.</td></tr>
              )}
            </tbody>
            {rotasOrdenadas.length > 0 && (
              <tfoot>
                <tr>
                  <td>{rotasOrdenadas.length} rota(s)</td>
                  <td className="pgm-num">{fmtInt(kpis.linhasPlano)}</td>
                  <td className="pgm-num">{fmtInt(kpis.qtdTransfTotal)}</td>
                  {modoPedidos && meses.map((_, i) => <td key={i} className="pgm-num">{fmtRsCompacto(rotas.reduce((a, r) => a + (r.valorMes[i] ?? 0), 0))}</td>)}
                  <td className="pgm-num">{fmtRsCompacto(kpis.valorTransfTotal)}</td>
                  <td className="pgm-num">{fmtRsCompacto(kpis.valorImediata)}</td>
                  <td className="pgm-num">{fmtRsCompacto(kpis.impactoFiscalTotal)}</td>
                  <td className="pgm-num"></td>
                </tr>
              </tfoot>
            )}
          </table>
        </Rolagem>
      </Secao>

      {/* --------------------------- Histórico --------------------------- */}
      {historico.length > 0 && (
        <Secao flush titulo="Histórico de análises" desc="O resultado de cada rodada fica guardado: parâmetros, KPIs e o que foi aprovado">
          <Rolagem>
            <table className="pgm-tabela">
              <thead>
                <tr><th>Análise</th><th>Rodada em</th><th>Demanda</th><th>Origens → destinos</th><th className="pgm-num">Transferido</th><th className="pgm-num">Cobertura</th><th className="pgm-num">Aprovado</th><th>Guardada</th></tr>
              </thead>
              <tbody>
                {historico.map((h) => (
                  <tr key={h.id} className={h.id === data.analise.id ? "sel" : undefined}>
                    <td>
                      <b>{h.id}</b>
                      {h.id === data.analise.id && <Badge tom="azul"><span style={{ marginLeft: 0 }}>Esta análise</span></Badge>}
                      {h.label && <span className="sub">{h.label}</span>}
                    </td>
                    <td>{new Date(h.criadoEm).toLocaleString("pt-BR")}</td>
                    <td>{h.modoDemanda === "pedidos" ? "Pedidos" : "Saldo ideal"}</td>
                    <td>{h.origens.join(", ")} → {h.destinos.join(", ")}</td>
                    <td className="pgm-num">{fmtRsCompacto(h.kpis?.valorTransfTotal ?? 0)}</td>
                    <td className="pgm-num">{fmtPct(h.kpis?.coberturaNecessidade ?? 0, 0)}</td>
                    <td className="pgm-num">{h.aprovado && h.aprovado.linhas > 0 ? fmtRsCompacto(h.aprovado.valor) : "—"}</td>
                    <td>{duravel ? <Badge tom="good">Persistida</Badge> : <Badge tom="warn">Só em memória</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Rolagem>
        </Secao>
      )}

      <div>
        <Ressalvas
          itens={[
            destinosAjustados > 0 && `Teto e piso mudaram a necessidade de ${destinosAjustados} destino(s)`,
            data.capacidade?.skusSemFator > 0 && `${fmtInt(data.capacidade.skusSemFator)} SKUs sem fator de ${data.capacidade.metrica} não consomem capacidade`,
            temCapacidade && !rotas.some((r) => r.capacidadeLimite > 0) && "Transporte por rota sem limite definido",
            kpis.rotasSemAliquota.length > 0 && `${kpis.rotasSemAliquota.map(rotuloRota).join(", ")} sem alíquota: ICMS em 0%`,
            cobertura === "acima_limite" && "Visão filtrada: só SKUs com estoque parado na origem",
          ]}
        />
        <Fonte>
          Fonte: {data.analise.fonteBase || "base de CDs importada"}{dataBase && ` · análise rodada em ${dataBase}`} · estoque objetivo, venda média de 3 meses e pendente da própria base · cálculo em {data.tempoMs} ms.
        </Fonte>
      </div>
    </>
  );
}
