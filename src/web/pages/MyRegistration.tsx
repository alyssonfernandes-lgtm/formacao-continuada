import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { useApp, useTitle } from '../lib/app';
import { fmtLong, fmtTime, fmtHours, fmtDateTime } from '../lib/format';
import { Alert, Badge, EmailBadge, Spinner } from '../components/ui';

interface Reg {
  protocol: string;
  status: string;
  createdAt: string;
  name: string;
  school: string;
  emailStatus: string | null;
  event: { id: string; title: string; location: string; modality: string; workloadHours: number; sessions: { id: string; title: string; startsAt: string; endsAt: string }[] } | null;
}

export function MyRegistration() {
  useTitle('Minha inscrição');
  const { token } = useParams();
  const { settings } = useApp();
  const [r, setR] = useState<Reg | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api<Reg>(`/api/public/registrations/${token}`).then(setR).catch((e: ApiError) => setError(e.message));
  }, [token]);
  if (error) return <Alert tone="error" title="Inscrição não localizada">{error}</Alert>;
  if (!r) return <Spinner />;
  const cancelled = r.status !== 'confirmada';
  return (
    <div className="mx-auto max-w-lg">
      <div className="card overflow-hidden">
        <div className="bg-primary px-5 py-4 text-primary-fg">
          <p className="text-xs opacity-90">Comprovante de inscrição</p>
          <h1 className="text-lg font-bold">{r.event?.title}</h1>
        </div>
        <div className="p-5">
          {cancelled ? (
            <Alert tone="error" title="Inscrição cancelada">Esta inscrição não é mais válida para o credenciamento.</Alert>
          ) : (
            <img src={`/api/public/registrations/${token}/qr.svg`} alt={`QR Code da inscrição ${r.protocol}`} className="mx-auto w-64 max-w-full rounded-lg bg-white p-2 ring-1 ring-slate-200" />
          )}
          <dl className="mt-5 grid gap-2 text-sm">
            <div className="flex justify-between gap-4"><dt className="text-slate-600">Participante</dt><dd className="text-right font-medium">{r.name}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-slate-600">Escola</dt><dd className="text-right">{r.school}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-slate-600">Protocolo</dt><dd className="font-mono font-semibold">{r.protocol}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-slate-600">Situação</dt><dd>{cancelled ? <Badge color="red">Cancelada</Badge> : <Badge color="green">Confirmada</Badge>}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-slate-600">Inscrito em</dt><dd>{fmtDateTime(r.createdAt)}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-slate-600">E-mail de confirmação</dt><dd><EmailBadge status={r.emailStatus} /></dd></div>
            {r.event && (
              <>
                <div className="flex justify-between gap-4"><dt className="text-slate-600">Local</dt><dd className="text-right">{r.event.location} · {r.event.modality}</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-slate-600">Carga horária</dt><dd>{fmtHours(r.event.workloadHours)}</dd></div>
                <div><dt className="text-slate-600">Data e horário</dt>
                  <dd className="mt-1">{r.event.sessions.map((s) => <span key={s.id} className="block">{fmtLong(s.startsAt)}, {fmtTime(s.startsAt)} às {fmtTime(s.endsAt)}</span>)}</dd>
                </div>
              </>
            )}
          </dl>
          {!cancelled && <p className="mt-5 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">No credenciamento, mostre este QR Code com o brilho da tela alto. Para corrigir dados, procure a {settings?.department}{settings?.contactEmail ? ` pelo e-mail ${settings.contactEmail}` : ''}.</p>}
          <button className="btn-secondary mt-4 w-full print:hidden" onClick={() => window.print()}>Imprimir</button>
        </div>
      </div>
      <p className="mt-4 text-center text-sm"><Link className="underline" to="/">Ver outros eventos</Link></p>
    </div>
  );
}
