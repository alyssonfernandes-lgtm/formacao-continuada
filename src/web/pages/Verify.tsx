import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { useTitle } from '../lib/app';
import { fmtLong } from '../lib/format';
import { Alert, Spinner, TextInput } from '../components/ui';
import { Icon } from '../components/Icon';

interface Cert {
  status: 'valido' | 'substituido' | 'revogado';
  number: string;
  verificationCode: string;
  participantName: string;
  eventTitle: string;
  period: string;
  hours: string;
  issuedAt: string;
  invalidatedAt: string | null;
  replacedByCode: string | null;
  department: string;
}

export function Verify() {
  useTitle('Verificar certificado');
  const { code } = useParams();
  const nav = useNavigate();
  const [input, setInput] = useState(code ?? '');
  const [cert, setCert] = useState<Cert | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!code) return;
    setLoading(true);
    setError('');
    setCert(null);
    api<Cert>(`/api/public/certificates/${encodeURIComponent(code)}`)
      .then(setCert)
      .catch((e: ApiError) => setError(e.message))
      .finally(() => setLoading(false));
  }, [code]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const c = input.trim().toUpperCase();
    if (c) nav(`/verificar/${encodeURIComponent(c)}`);
  };
  return (
    <div className="mx-auto max-w-xl">
      <h1 className="text-2xl font-bold">Verificar autenticidade de certificado</h1>
      <p className="mt-2 text-slate-700">Informe o código de verificação impresso no certificado (formato XXXX-XXXX-XXXX-XXXX) ou leia o QR Code do documento.</p>
      <form onSubmit={submit} className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1"><TextInput label="Código de verificação" value={input} onChange={(e) => setInput(e.target.value)} autoComplete="off" autoCapitalize="characters" /></div>
        <button className="btn-primary">Verificar</button>
      </form>
      <div className="mt-6" aria-live="polite">
        {loading && <Spinner label="Verificando…" />}
        {error && <Alert tone="error" title="Certificado não encontrado">{error} Confira se o código foi digitado corretamente.</Alert>}
        {cert && (
          <div className={`card p-5 ring-2 ${cert.status === 'valido' ? 'ring-emerald-500' : 'ring-red-500'}`}>
            <div className={`flex items-center gap-2 font-semibold ${cert.status === 'valido' ? 'text-emerald-700' : 'text-red-700'}`}>
              <Icon name={cert.status === 'valido' ? 'check' : 'ban'} className="h-6 w-6" />
              {cert.status === 'valido' ? 'Certificado válido' : cert.status === 'substituido' ? 'Certificado substituído (não é mais válido)' : 'Certificado revogado (não é válido)'}
            </div>
            <dl className="mt-4 grid gap-2 text-sm">
              <div><dt className="text-slate-600">Participante</dt><dd className="font-medium">{cert.participantName}</dd></div>
              <div><dt className="text-slate-600">Evento</dt><dd>{cert.eventTitle}</dd></div>
              <div><dt className="text-slate-600">Realização</dt><dd>{cert.period}</dd></div>
              <div><dt className="text-slate-600">Carga horária</dt><dd>{cert.hours}</dd></div>
              <div><dt className="text-slate-600">Número</dt><dd className="font-mono">{cert.number}</dd></div>
              <div><dt className="text-slate-600">Emitido em</dt><dd>{fmtLong(cert.issuedAt)} por {cert.department}</dd></div>
            </dl>
            {cert.status === 'valido' && <a className="btn-secondary mt-4" href={`/api/public/certificates/${cert.verificationCode}/pdf`} target="_blank" rel="noopener">Abrir PDF</a>}
            {cert.replacedByCode && <p className="mt-4 text-sm">Este documento foi substituído. <Link className="underline" to={`/verificar/${cert.replacedByCode}`}>Ver o certificado atual</Link>.</p>}
          </div>
        )}
      </div>
    </div>
  );
}
