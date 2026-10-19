import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { useApp, useTitle } from '../lib/app';
import { fmtDate, fmtTime, fmtHours } from '../lib/format';
import type { EventDto } from '../lib/types';
import { Alert, Empty, PhaseBadge, Spinner } from '../components/ui';
import { Icon } from '../components/Icon';

export function EventCard({ e }: { e: EventDto }) {
  return (
    <article className="card flex flex-col p-5">
      <div className="flex flex-wrap items-center gap-2">
        <PhaseBadge phase={e.phase} />
        {e.full && <span className="text-xs font-semibold text-red-700">Vagas esgotadas</span>}
        {e.spotsLeft !== null && !e.full && <span className="text-xs text-slate-600">{e.spotsLeft} vagas restantes</span>}
      </div>
      <h2 className="mt-3 text-lg font-semibold leading-snug">
        <Link to={`/eventos/${e.id}`} className="hover:underline">{e.title}</Link>
      </h2>
      <dl className="mt-3 grid gap-1 text-sm text-slate-700">
        <div className="flex gap-2"><dt className="sr-only">Data</dt><Icon name="calendar" className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" /><dd>{e.startsAt ? `${fmtDate(e.startsAt)}, ${fmtTime(e.startsAt)}` : 'Data a definir'}{e.sessions.length > 1 ? ` (${e.sessions.length} encontros)` : ''}</dd></div>
        <div className="flex gap-2"><dt className="sr-only">Local</dt><Icon name="pin" className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" /><dd>{e.location} · {e.modality}</dd></div>
        <div className="flex gap-2"><dt className="sr-only">Carga horária</dt><Icon name="clock" className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" /><dd>{fmtHours(e.workloadHours)}</dd></div>
        {e.registrationOpen && <div className="flex gap-2"><dt className="sr-only">Prazo</dt><dd>Inscrições até {fmtDate(e.registrationClosesAt)} às {fmtTime(e.registrationClosesAt)}</dd></div>}
      </dl>
      <div className="mt-auto pt-4">
        <Link to={`/eventos/${e.id}`} className={e.registrationOpen ? 'btn-primary w-full sm:w-auto' : 'btn-secondary w-full sm:w-auto'}>
          {e.registrationOpen ? 'Ver detalhes e inscrever-se' : 'Ver detalhes'}
        </Link>
      </div>
    </article>
  );
}

export function EventsList() {
  useTitle('Eventos');
  const { settings } = useApp();
  const [events, setEvents] = useState<EventDto[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api<EventDto[]>('/api/public/events').then(setEvents).catch((e: ApiError) => setError(e.message));
  }, []);
  const open = events?.filter((e) => e.registrationOpen) ?? [];
  const others = events?.filter((e) => !e.registrationOpen) ?? [];
  return (
    <div>
      <h1 className="text-2xl font-bold sm:text-3xl">Formação continuada</h1>
      <p className="mt-2 max-w-2xl text-slate-700">Cursos, encontros, seminários e palestras promovidos pela {settings?.department ?? 'Secretaria Municipal de Educação'}. Escolha um evento para ver os detalhes e fazer sua inscrição.</p>
      {error && <div className="mt-6"><Alert tone="error" title="Não foi possível carregar os eventos.">{error}</Alert></div>}
      {!events && !error && <Spinner />}
      {events && (
        <>
          <section aria-labelledby="abertas" className="mt-8">
            <h2 id="abertas" className="mb-4 text-lg font-semibold">Inscrições abertas</h2>
            {open.length ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{open.map((e) => <EventCard key={e.id} e={e} />)}</div> : <Empty>Nenhum evento com inscrições abertas no momento.</Empty>}
          </section>
          {others.length > 0 && (
            <section aria-labelledby="outros" className="mt-10">
              <h2 id="outros" className="mb-4 text-lg font-semibold">Outros eventos programados</h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{others.map((e) => <EventCard key={e.id} e={e} />)}</div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
