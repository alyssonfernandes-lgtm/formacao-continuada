import { useEffect, useState } from 'react';
import { api, ApiError, download } from '../../lib/api';
import { useApp, useTitle } from '../../lib/app';
import { fmtDate, fmtHours } from '../../lib/format';
import type { EventDto } from '../../lib/types';
import { Alert, PageHeader, SelectInput, Spinner, Stat, TextInput } from '../../components/ui';
import { Icon } from '../../components/Icon';

interface Indicators {
  totals: Record<string, number | null>;
  bySchool: { school: string; unit: string | null; confirmed: number; present: number; absent: number; unique_participants: number; certificates: number }[];
  byEvent: { event_id: string; event_title: string; first_start: string; workload_hours: number; confirmed: number; cancelled: number; present: number; absent: number; certificates: number; certificates_pending: number }[];
  byMonth: { month: string; events: number; confirmed: number; present: number }[];
  definitions: Record<string, string>;
}

export type Filters = Record<'eventId' | 'from' | 'to' | 'schoolId' | 'unit' | 'registrationStatus' | 'presenceStatus' | 'certificateStatus', string>;
const emptyFilters: Filters = { eventId: '', from: '', to: '', schoolId: '', unit: '', registrationStatus: '', presenceStatus: '', certificateStatus: '' };

function FiltersForm({ f, setF }: { f: Filters; setF: (f: Filters) => void }) {
  const [events, setEvents] = useState<EventDto[]>([]);
  const [schools, setSchools] = useState<{ id: string; name: string; unit: string | null }[]>([]);
  useEffect(() => {
    api('/api/admin/events').then(setEvents).catch(() => undefined);
    api('/api/admin/schools').then(setSchools).catch(() => undefined);
  }, []);
  const units = [...new Set(schools.map((s) => s.unit).filter(Boolean))] as string[];
  const set = (k: keyof Filters) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <fieldset className="card grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
      <legend className="sr-only">Filtros</legend>
      <SelectInput label="Evento" value={f.eventId} onChange={set('eventId')}>
        <option value="">Todos</option>
        {events.map((e) => <option key={e.id} value={e.id}>{e.title}{e.startsAt ? ` (${fmtDate(e.startsAt)})` : ''}</option>)}
      </SelectInput>
      <TextInput label="De (data do evento)" type="date" value={f.from} onChange={set('from')} />
      <TextInput label="Até" type="date" value={f.to} onChange={set('to')} />
      <SelectInput label="Escola" value={f.schoolId} onChange={set('schoolId')}>
        <option value="">Todas</option>
        {schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </SelectInput>
      {units.length > 0 && (
        <SelectInput label="Unidade administrativa" value={f.unit} onChange={set('unit')}>
          <option value="">Todas</option>
          {units.map((u) => <option key={u}>{u}</option>)}
        </SelectInput>
      )}
      <SelectInput label="Inscrição" value={f.registrationStatus} onChange={set('registrationStatus')}>
        <option value="">Todas</option><option value="confirmada">Confirmada</option><option value="cancelada">Cancelada</option>
      </SelectInput>
      <SelectInput label="Presença" value={f.presenceStatus} onChange={set('presenceStatus')}>
        <option value="">Todas</option><option value="presente">Presente</option><option value="ausente">Ausente</option><option value="aguardando">Aguardando início</option>
      </SelectInput>
      <SelectInput label="Certificado" value={f.certificateStatus} onChange={set('certificateStatus')}>
        <option value="">Todos</option><option value="emitido">Emitido</option><option value="pendente">Pendente</option><option value="nao_elegivel">Não elegível</option>
      </SelectInput>
      <div className="flex items-end"><button type="button" className="btn-ghost" onClick={() => setF(emptyFilters)}>Limpar filtros</button></div>
    </fieldset>
  );
}

const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${String(v).replace('.', ',')}%`);

export function Dashboard() {
  useTitle('Painel');
  const [f, setF] = useState<Filters>(emptyFilters);
  const [data, setData] = useState<Indicators | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
    api<Indicators>(`/api/admin/reports/indicators?${qs}`).then(setData).catch((e: ApiError) => setError(e.message));
  }, [f]);
  const t = data?.totals;
  const d = data?.definitions ?? {};
  return (
    <div>
      <PageHeader title="Painel gerencial" subtitle="Indicadores calculados diretamente das inscrições, presenças e certificados registrados." />
      <FiltersForm f={f} setF={setF} />
      {error && <div className="mt-4"><Alert tone="error">{error}</Alert></div>}
      {!data ? <Spinner /> : (
        <>
          <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Inscrições (total)" value={t!.totalRegistrations} hint={d.totalRegistrations} />
            <Stat label="Confirmadas" value={t!.confirmed} hint={d.confirmed} />
            <Stat label="Participantes únicos" value={t!.uniqueParticipants} hint={d.uniqueParticipants} />
            <Stat label="Presentes" value={t!.present} hint={d.present} />
            <Stat label="Ausentes" value={t!.absent} hint={d.absent} />
            <Stat label="Taxa de comparecimento" value={pct(t!.attendanceRate)} hint={d.attendanceRate} />
            <Stat label="Certificados emitidos" value={t!.certificatesIssued} hint={d.certificatesIssued} />
            <Stat label="Certificados pendentes" value={t!.certificatesPending} hint={d.certificatesPending} />
            <Stat label="E-mails pendentes" value={t!.emailsPending} hint={d.emailsPending} />
            <Stat label="E-mails com falha" value={t!.emailsFailed} hint={d.emailsFailed} />
            <Stat label="Carga horária ofertada" value={fmtHours(t!.workloadOffered ?? 0)} hint={d.workloadOffered} />
            <Stat label="Horas certificadas" value={fmtHours(t!.certifiedHours ?? 0)} hint={d.certifiedHours} />
          </div>
          <section className="mt-8">
            <h2 className="mb-3 text-lg font-semibold">Por evento</h2>
            <div className="table-wrap">
              <table className="tbl">
                <thead><tr><th>Evento</th><th>Data</th><th>Carga</th><th>Confirmadas</th><th>Presentes</th><th>Ausentes</th><th>Comparecimento</th><th>Certificados</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {data.byEvent.map((e) => (
                    <tr key={e.event_id}>
                      <td className="min-w-[200px] font-medium">{e.event_title}</td>
                      <td>{fmtDate(e.first_start)}</td>
                      <td>{fmtHours(e.workload_hours)}</td>
                      <td className="tabular-nums">{e.confirmed}</td>
                      <td className="tabular-nums">{e.present}</td>
                      <td className="tabular-nums">{e.absent}</td>
                      <td className="tabular-nums">{e.present + e.absent ? pct(Math.round((1000 * e.present) / (e.present + e.absent)) / 10) : '—'}</td>
                      <td className="tabular-nums">{e.certificates}{e.certificates_pending ? ` (+${e.certificates_pending} pend.)` : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <div className="mt-8 grid gap-8 lg:grid-cols-2">
            <section>
              <h2 className="mb-3 text-lg font-semibold">Participação por escola</h2>
              <div className="table-wrap">
                <table className="tbl">
                  <thead><tr><th>Escola</th><th>Confirmadas</th><th>Presentes</th><th>Pessoas</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.bySchool.map((s) => (
                      <tr key={s.school + s.unit}>
                        <td>{s.school}{s.unit && <div className="text-xs text-slate-500">{s.unit}</div>}</td>
                        <td className="tabular-nums">{s.confirmed}</td>
                        <td className="tabular-nums">{s.present}</td>
                        <td className="tabular-nums">{s.unique_participants}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
            <section>
              <h2 className="mb-3 text-lg font-semibold">Distribuição por período</h2>
              <div className="table-wrap">
                <table className="tbl">
                  <thead><tr><th>Mês</th><th>Eventos</th><th>Confirmadas</th><th>Presentes</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.byMonth.map((m) => (
                      <tr key={m.month}>
                        <td>{m.month.split('-').reverse().join('/')}</td>
                        <td className="tabular-nums">{m.events}</td>
                        <td className="tabular-nums">{m.confirmed}</td>
                        <td className="tabular-nums">{m.present}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        </>
      )}
    </div>
  );
}

export function Reports() {
  useTitle('Relatórios');
  const { can } = useApp();
  const detailedAllowed = can('reports.detailed');
  const [f, setF] = useState<Filters>(emptyFilters);
  const [kind, setKind] = useState(detailedAllowed ? 'inscritos' : 'resumo');
  const [format, setFormat] = useState('pdf');
  const [detailed, setDetailed] = useState(false);
  const [signature, setSignature] = useState(true);
  const [title, setTitle] = useState('');
  const [fields, setFields] = useState<{ key: string; label: string; personal: boolean }[]>([]);
  const [chosen, setChosen] = useState<string[]>(['protocolo', 'nome', 'escola', 'evento', 'situacao_inscricao', 'situacao_presenca', 'frequencia', 'situacao_certificado']);
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api('/api/admin/reports/fields').then(setFields).catch(() => undefined);
  }, []);
  const run = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const filters = Object.fromEntries(Object.entries(f).filter(([, v]) => v));
      await download('/api/admin/reports/export', { kind, format, detailed, signature, title: title || undefined, fields: kind === 'inscritos' ? chosen : undefined, filters });
      setMsg({ tone: 'success', text: 'Arquivo gerado. A exportação foi registrada na auditoria.' });
    } catch (e) {
      setMsg({ tone: 'error', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const visibleFields = fields.filter((x) => detailed || !x.personal);
  return (
    <div className="max-w-5xl">
      <PageHeader title="Relatórios e exportações" subtitle="Listas e resumos para acompanhamento institucional e prestação de contas." />
      <FiltersForm f={f} setF={setF} />
      <div className="card mt-6 grid gap-4 p-5 sm:grid-cols-2">
        <SelectInput label="Tipo de relatório" value={kind} onChange={(e) => setKind(e.target.value)}>
          {detailedAllowed && <option value="inscritos">Lista de inscritos</option>}
          {detailedAllowed && <option value="presencas">Lista de presença (registros de check-in)</option>}
          {detailedAllowed && <option value="certificados">Relação de certificados</option>}
          <option value="resumo">Resumo consolidado (sem dados pessoais)</option>
        </SelectInput>
        <SelectInput label="Formato" value={format} onChange={(e) => setFormat(e.target.value)}>
          <option value="pdf">PDF (impressão e arquivo institucional)</option>
          <option value="xlsx">XLSX (Excel)</option>
          <option value="csv">CSV (planilhas)</option>
        </SelectInput>
        <TextInput label="Título do relatório (opcional)" value={title} onChange={(e) => setTitle(e.target.value)} />
        <div className="grid content-end gap-2 text-sm">
          {detailedAllowed && kind !== 'resumo' && kind !== 'certificados' && (
            <label className="flex items-center gap-2"><input type="checkbox" className="h-5 w-5" checked={detailed} onChange={(e) => setDetailed(e.target.checked)} />Versão detalhada (inclui CPF, e-mail e telefone)</label>
          )}
          {format === 'pdf' && <label className="flex items-center gap-2"><input type="checkbox" className="h-5 w-5" checked={signature} onChange={(e) => setSignature(e.target.checked)} />Incluir campos de assinatura e validação</label>}
        </div>
        {kind === 'inscritos' && (
          <fieldset className="sm:col-span-2">
            <legend className="label">Campos do relatório</legend>
            <div className="grid gap-2 sm:grid-cols-3">
              {visibleFields.map((x) => (
                <label key={x.key} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" className="h-4 w-4" checked={chosen.includes(x.key)} onChange={(e) => setChosen(e.target.checked ? [...chosen, x.key] : chosen.filter((c) => c !== x.key))} />
                  {x.label}{x.personal && <span className="text-xs text-red-700">(dado pessoal)</span>}
                </label>
              ))}
            </div>
          </fieldset>
        )}
        {detailed && <div className="sm:col-span-2"><Alert tone="warning">Relatórios detalhados contêm dados pessoais. Use somente para a finalidade administrativa e não compartilhe sem fundamento legal. A exportação fica registrada com seu usuário.</Alert></div>}
        {msg && <div className="sm:col-span-2"><Alert tone={msg.tone}>{msg.text}</Alert></div>}
        <div className="sm:col-span-2"><button className="btn-primary" onClick={run} disabled={busy}><Icon name="download" />{busy ? 'Gerando…' : 'Gerar arquivo'}</button></div>
      </div>
      <p className="mt-4 text-sm text-slate-600">Os relatórios trazem identificação da Secretaria, critérios utilizados e data de geração. Verifique se o modelo atende às exigências específicas do órgão destinatário antes do envio.</p>
    </div>
  );
}
