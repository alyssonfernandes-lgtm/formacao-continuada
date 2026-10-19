import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../../lib/api';
import { useTitle } from '../../lib/app';
import { fmtDate, fmtHours, fromLocalInput, toLocalInput } from '../../lib/format';
import type { EventDto } from '../../lib/types';
import { Alert, Empty, PageHeader, PhaseBadge, SelectInput, Spinner, TextArea, TextInput } from '../../components/ui';
import { Icon } from '../../components/Icon';

export function EventsAdmin() {
  useTitle('Eventos');
  const [events, setEvents] = useState<EventDto[] | null>(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    api<EventDto[]>('/api/admin/events').then(setEvents).catch((e: ApiError) => setError(e.message));
  }, []);
  const list = events?.filter((e) => e.title.toLowerCase().includes(q.toLowerCase())) ?? [];
  return (
    <div>
      <PageHeader title="Eventos" subtitle="Cursos, encontros, seminários e palestras" actions={<Link to="/admin/eventos/novo" className="btn-primary"><Icon name="plus" />Novo evento</Link>} />
      {error && <Alert tone="error">{error}</Alert>}
      {!events && !error && <Spinner />}
      {events && (
        <>
          <div className="mb-4 max-w-sm"><TextInput label="Buscar por título" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          {list.length === 0 ? <Empty>Nenhum evento cadastrado. Use “Novo evento” para começar.</Empty> : (
            <div className="table-wrap">
              <table className="tbl">
                <thead><tr><th>Evento</th><th>Situação</th><th>Data</th><th>Carga</th><th>Vagas</th><th><span className="sr-only">Ações</span></th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {list.map((e) => (
                    <tr key={e.id}>
                      <td className="min-w-[220px] font-medium"><Link to={`/admin/eventos/${e.id}`} className="hover:underline">{e.title}</Link><div className="text-xs font-normal text-slate-500">{e.location}</div></td>
                      <td><PhaseBadge phase={e.phase} /></td>
                      <td className="whitespace-nowrap">{e.startsAt ? fmtDate(e.startsAt) : '—'}</td>
                      <td className="whitespace-nowrap">{fmtHours(e.workloadHours)}</td>
                      <td className="whitespace-nowrap">{e.capacity === null ? 'Sem limite' : `${e.capacity - (e.spotsLeft ?? 0)}/${e.capacity}`}</td>
                      <td className="whitespace-nowrap text-right"><Link to={`/admin/eventos/${e.id}`} className="btn-ghost">Gerenciar</Link><Link to={`/admin/eventos/${e.id}/editar`} className="btn-ghost">Editar</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

interface SessionForm {
  id?: string;
  title: string;
  startsAt: string;
  endsAt: string;
  hours: string;
}

const blank = {
  title: '', description: '', objectives: '', targetAudience: '', syllabus: '', location: '', modality: 'Presencial', instructor: '', promoter: '',
  workloadHours: '', capacity: '', registrationOpensAt: '', registrationClosesAt: '', status: 'rascunho', certificateInfo: '',
  certCriterion: 'todas_sessoes', certMinPercent: '75', certHoursMode: 'integral', certSignerName: '', certSignerRole: '',
};

export function EventForm() {
  const { id } = useParams();
  const editing = Boolean(id);
  useTitle(editing ? 'Editar evento' : 'Novo evento');
  const nav = useNavigate();
  const [f, setF] = useState<typeof blank>(blank);
  const [sessions, setSessions] = useState<SessionForm[]>([{ title: '', startsAt: '', endsAt: '', hours: '' }]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(editing);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!id) return;
    api<EventDto>(`/api/admin/events/${id}`)
      .then((e) => {
        setF({
          title: e.title, description: e.description, objectives: e.objectives, targetAudience: e.targetAudience, syllabus: e.syllabus, location: e.location,
          modality: e.modality, instructor: e.instructor, promoter: e.promoter, workloadHours: String(e.workloadHours), capacity: e.capacity === null ? '' : String(e.capacity),
          registrationOpensAt: toLocalInput(e.registrationOpensAt), registrationClosesAt: toLocalInput(e.registrationClosesAt), status: e.status,
          certificateInfo: e.certificateInfo, certCriterion: e.certCriterion ?? 'todas_sessoes', certMinPercent: String(e.certMinPercent ?? 75),
          certHoursMode: e.certHoursMode ?? 'integral', certSignerName: e.certSignerName ?? '', certSignerRole: e.certSignerRole ?? '',
        });
        setSessions(e.sessions.map((s) => ({ id: s.id, title: s.title, startsAt: toLocalInput(s.startsAt), endsAt: toLocalInput(s.endsAt), hours: String(s.hours) })));
      })
      .catch((e: ApiError) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  const set = (k: keyof typeof blank) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const setS = (i: number, k: keyof SessionForm, v: string) => setSessions(sessions.map((s, j) => (j === i ? { ...s, [k]: v } : s)));
  const sumHours = sessions.reduce((a, s) => a + (Number(s.hours.replace(',', '.')) || 0), 0);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setError('');
    const body = {
      ...f,
      workloadHours: Number(String(f.workloadHours).replace(',', '.')),
      capacity: f.capacity ? Number(f.capacity) : null,
      certMinPercent: Number(f.certMinPercent),
      registrationOpensAt: fromLocalInput(f.registrationOpensAt),
      registrationClosesAt: fromLocalInput(f.registrationClosesAt),
      sessions: sessions.map((s) => ({ id: s.id, title: s.title, startsAt: fromLocalInput(s.startsAt), endsAt: fromLocalInput(s.endsAt), hours: Number(s.hours.replace(',', '.')) })),
    };
    try {
      if (editing) {
        await api(`/api/admin/events/${id}`, { method: 'PUT', body });
        nav(`/admin/eventos/${id}`);
      } else {
        const r = await api('/api/admin/events', { body });
        nav(`/admin/eventos/${r.id}`);
      }
    } catch (err) {
      const a = err as ApiError;
      setErrors(a.fields);
      setError(a.message);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Spinner />;
  return (
    <form onSubmit={submit} noValidate className="max-w-4xl">
      <PageHeader title={editing ? 'Editar evento' : 'Novo evento'} />
      {error && <div className="mb-4"><Alert tone="error" title="Não foi possível salvar.">{error}</Alert></div>}
      <fieldset className="card grid gap-4 p-5 sm:grid-cols-2">
        <legend className="sr-only">Dados gerais</legend>
        <div className="sm:col-span-2"><TextInput label="Título" required value={f.title} onChange={set('title')} error={errors.title} /></div>
        <div className="sm:col-span-2"><TextArea label="Descrição" value={f.description} onChange={set('description')} error={errors.description} /></div>
        <TextArea label="Objetivos" value={f.objectives} onChange={set('objectives')} />
        <TextArea label="Público-alvo" value={f.targetAudience} onChange={set('targetAudience')} />
        <div className="sm:col-span-2"><TextArea label="Conteúdo programático (quando aplicável)" value={f.syllabus} onChange={set('syllabus')} /></div>
        <TextInput label="Local" required value={f.location} onChange={set('location')} error={errors.location} />
        <SelectInput label="Modalidade" value={f.modality} onChange={set('modality')}>
          <option>Presencial</option><option>On-line</option><option>Híbrido</option>
        </SelectInput>
        <TextInput label="Formador(a) ou responsável (quando aplicável)" value={f.instructor} onChange={set('instructor')} />
        <TextInput label="Órgão promotor" value={f.promoter} onChange={set('promoter')} hint="Se vazio, usa o nome da Secretaria configurado." />
        <TextInput label="Carga horária do evento (h)" required inputMode="decimal" value={f.workloadHours} onChange={set('workloadHours')} error={errors.workloadHours} hint={`Soma das sessões: ${sumHours} h`} />
        <TextInput label="Número máximo de participantes" inputMode="numeric" value={f.capacity} onChange={set('capacity')} error={errors.capacity} hint="Deixe vazio para não limitar." />
        <TextInput label="Abertura das inscrições" required type="datetime-local" value={f.registrationOpensAt} onChange={set('registrationOpensAt')} error={errors.registrationOpensAt} />
        <TextInput label="Prazo final de inscrição" required type="datetime-local" value={f.registrationClosesAt} onChange={set('registrationClosesAt')} error={errors.registrationClosesAt} />
        <SelectInput label="Situação" value={f.status} onChange={set('status')} hint="Publicado: visível ao público. As fases (inscrições abertas, em andamento etc.) são calculadas pelas datas.">
          <option value="rascunho">Rascunho</option><option value="publicado">Publicado</option><option value="concluido">Concluído</option><option value="cancelado">Cancelado</option>
        </SelectInput>
      </fieldset>

      <fieldset className="card mt-6 p-5">
        <legend className="px-1 text-base font-semibold">Sessões (encontros)</legend>
        <p className="text-sm text-slate-600">Cada sessão tem seu próprio credenciamento. A presença é registrada por sessão.</p>
        {errors.sessions && <p className="mt-2 text-sm font-medium text-red-700">{errors.sessions}</p>}
        <div className="mt-4 grid gap-4">
          {sessions.map((s, i) => (
            <div key={i} className="grid gap-3 rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200 sm:grid-cols-[1fr_1fr_1fr_100px_auto] sm:items-end">
              <TextInput label={`Título da sessão ${i + 1}`} value={s.title} onChange={(e) => setS(i, 'title', e.target.value)} />
              <TextInput label="Início" type="datetime-local" required value={s.startsAt} onChange={(e) => setS(i, 'startsAt', e.target.value)} error={errors[`sessions.${i}.startsAt`]} />
              <TextInput label="Término" type="datetime-local" required value={s.endsAt} onChange={(e) => setS(i, 'endsAt', e.target.value)} error={errors[`sessions.${i}.endsAt`]} />
              <TextInput label="Horas" inputMode="decimal" required value={s.hours} onChange={(e) => setS(i, 'hours', e.target.value)} error={errors[`sessions.${i}.hours`]} />
              <button type="button" className="btn-ghost text-red-700" disabled={sessions.length === 1} onClick={() => setSessions(sessions.filter((_, j) => j !== i))}>Remover</button>
            </div>
          ))}
        </div>
        <button type="button" className="btn-secondary mt-4" onClick={() => setSessions([...sessions, { title: '', startsAt: '', endsAt: '', hours: '' }])}><Icon name="plus" />Adicionar sessão</button>
      </fieldset>

      <fieldset className="card mt-6 grid gap-4 p-5 sm:grid-cols-2">
        <legend className="px-1 text-base font-semibold">Certificação</legend>
        <SelectInput label="Critério de presença" value={f.certCriterion} onChange={set('certCriterion')}>
          <option value="todas_sessoes">Presença em todas as sessões</option>
          <option value="percentual_minimo">Percentual mínimo da carga das sessões</option>
        </SelectInput>
        {f.certCriterion === 'percentual_minimo' ? (
          <>
            <TextInput label="Percentual mínimo (%)" inputMode="numeric" value={f.certMinPercent} onChange={set('certMinPercent')} error={errors.certMinPercent} />
            <SelectInput label="Carga horária certificada" value={f.certHoursMode} onChange={set('certHoursMode')}>
              <option value="integral">Carga integral do evento</option>
              <option value="proporcional">Proporcional às sessões presentes</option>
            </SelectInput>
          </>
        ) : (
          <div className="self-end"><Alert tone="info">{sessions.length === 1 ? 'Com uma única sessão, um check-in valerá como presença integral. Use este critério apenas se for adequado ao formato do evento.' : 'O certificado exige check-in em cada uma das sessões.'}</Alert></div>
        )}
        <TextInput label="Responsável pela emissão (nome)" value={f.certSignerName} onChange={set('certSignerName')} hint="Opcional. Se vazio, vale a assinatura padrão das Configurações." />
        <TextInput label="Cargo ou identificação institucional" value={f.certSignerRole} onChange={set('certSignerRole')} />
        <div className="sm:col-span-2"><TextArea label="Informações sobre o certificado (exibidas ao público)" value={f.certificateInfo} onChange={set('certificateInfo')} /></div>
      </fieldset>

      <div className="sticky bottom-0 mt-6 flex gap-2 border-t border-slate-200 bg-slate-50/95 py-4 backdrop-blur">
        <button className="btn-primary" disabled={busy}>{busy ? 'Salvando…' : 'Salvar evento'}</button>
        <button type="button" className="btn-secondary" onClick={() => nav(-1)}>Cancelar</button>
      </div>
    </form>
  );
}
