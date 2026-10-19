import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { useTitle } from '../lib/app';
import { fmtDate, fmtDateTime, fmtHours, fmtLong, fmtTime } from '../lib/format';
import type { EventDto } from '../lib/types';
import { Alert, EmailBadge, PhaseBadge, SelectInput, Spinner, TextInput } from '../components/ui';
import { Icon } from '../components/Icon';
import { formatCpf, formatPhone, isValidCpf, isValidPhone, onlyDigits, registrationSchema } from '../../shared/validation';

interface School {
  id: string;
  name: string;
}
interface FormData {
  fullName: string;
  cpf: string;
  schoolId: string;
  schoolOther: string;
  email: string;
  phone: string;
  privacyAck: boolean;
}
const empty: FormData = { fullName: '', cpf: '', schoolId: '', schoolOther: '', email: '', phone: '', privacyAck: false };

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  if (!children) return null;
  return (
    <section className="mt-6">
      <h2 className="text-base font-semibold text-slate-900">{title}</h2>
      <div className="mt-1 whitespace-pre-line text-slate-700">{children}</div>
    </section>
  );
}

export function EventDetail() {
  const { id } = useParams();
  const [ev, setEv] = useState<EventDto | null>(null);
  const [error, setError] = useState('');
  useTitle(ev?.title ?? 'Evento');
  useEffect(() => {
    api<EventDto>(`/api/public/events/${id}`).then(setEv).catch((e: ApiError) => setError(e.message));
  }, [id]);
  if (error) return <Alert tone="error" title="Evento não encontrado.">{error} <Link className="underline" to="/">Voltar aos eventos</Link></Alert>;
  if (!ev) return <Spinner />;
  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_420px]">
      <article>
        <Link to="/" className="text-sm text-slate-600 underline">← Todos os eventos</Link>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <PhaseBadge phase={ev.phase} />
          {ev.full && <span className="text-sm font-semibold text-red-700">Vagas esgotadas</span>}
        </div>
        <h1 className="mt-2 text-2xl font-bold sm:text-3xl">{ev.title}</h1>
        <dl className="mt-5 grid gap-3 rounded-xl bg-white p-4 text-sm ring-1 ring-slate-200 sm:grid-cols-2">
          <div>
            <dt className="font-medium text-slate-600">Data e horário</dt>
            <dd className="mt-0.5 text-slate-900">
              {ev.sessions.map((s) => (
                <span key={s.id} className="block">{fmtLong(s.startsAt)}, {fmtTime(s.startsAt)} às {fmtTime(s.endsAt)}{s.title ? ` (${s.title})` : ''}</span>
              ))}
            </dd>
          </div>
          <div><dt className="font-medium text-slate-600">Local</dt><dd className="mt-0.5">{ev.location} · {ev.modality}</dd></div>
          <div><dt className="font-medium text-slate-600">Carga horária</dt><dd className="mt-0.5">{fmtHours(ev.workloadHours)}</dd></div>
          <div><dt className="font-medium text-slate-600">Prazo de inscrição</dt><dd className="mt-0.5">{fmtDateTime(ev.registrationOpensAt)} a {fmtDateTime(ev.registrationClosesAt)}</dd></div>
          {ev.capacity !== null && <div><dt className="font-medium text-slate-600">Vagas</dt><dd className="mt-0.5">{ev.capacity} ({ev.spotsLeft} disponíveis)</dd></div>}
          {ev.instructor && <div><dt className="font-medium text-slate-600">Formador(a) / responsável</dt><dd className="mt-0.5">{ev.instructor}</dd></div>}
          {ev.promoter && <div><dt className="font-medium text-slate-600">Promoção</dt><dd className="mt-0.5">{ev.promoter}</dd></div>}
        </dl>
        <Section title="Descrição">{ev.description}</Section>
        <Section title="Objetivos">{ev.objectives}</Section>
        <Section title="Público-alvo">{ev.targetAudience}</Section>
        <Section title="Conteúdo programático">{ev.syllabus}</Section>
        <Section title="Certificado">{ev.certificateInfo || 'O certificado é emitido somente para quem cumprir o critério de presença definido para o evento, após o seu encerramento.'}</Section>
      </article>
      <aside>
        <div className="card p-5 lg:sticky lg:top-6">
          {ev.registrationOpen ? <RegistrationFlow ev={ev} /> : <Alert tone="warning" title={ev.full ? 'Vagas esgotadas' : 'Inscrições indisponíveis'}>{ev.full ? 'Todas as vagas deste evento foram preenchidas.' : ev.phase === 'publicado' ? `As inscrições abrem em ${fmtDateTime(ev.registrationOpensAt)}.` : 'O período de inscrições deste evento está encerrado.'}</Alert>}
          <ResendBox eventId={ev.id} />
        </div>
      </aside>
    </div>
  );
}

function RegistrationFlow({ ev }: { ev: EventDto }) {
  const [step, setStep] = useState<'form' | 'review' | 'done'>('form');
  const [data, setData] = useState<FormData>(empty);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [schools, setSchools] = useState<School[]>([]);
  const [submitError, setSubmitError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ protocol: string; token: string; emailStatus: string } | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    api<School[]>('/api/public/schools').then(setSchools).catch(() => setSchools([]));
  }, []);
  useEffect(() => headingRef.current?.focus(), [step]);

  const set = (k: keyof FormData) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    let v: string | boolean = e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value;
    if (k === 'cpf') v = formatCpf(String(v));
    if (k === 'phone') v = formatPhone(String(v));
    setData((d) => ({ ...d, [k]: v }));
    setErrors((er) => ({ ...er, [k]: '' }));
  };

  const payload = () => ({
    fullName: data.fullName,
    cpf: onlyDigits(data.cpf),
    schoolId: data.schoolId && data.schoolId !== 'outra' ? data.schoolId : null,
    schoolOther: data.schoolId === 'outra' || !schools.length ? data.schoolOther : null,
    email: data.email,
    phone: onlyDigits(data.phone),
    privacyAck: data.privacyAck,
  });

  const validate = (e: FormEvent) => {
    e.preventDefault();
    const r = registrationSchema.safeParse(payload());
    if (!r.success) {
      const errs: Record<string, string> = {};
      for (const i of r.error.issues) errs[String(i.path[0])] ??= i.message;
      setErrors(errs);
      const first = document.querySelector<HTMLElement>('[aria-invalid="true"]');
      first?.focus();
      return;
    }
    setStep('review');
  };

  const submit = async () => {
    setBusy(true);
    setSubmitError(null);
    try {
      const r = await api(`/api/public/events/${ev.id}/registrations`, { body: payload() });
      setResult(r);
      setStep('done');
    } catch (e) {
      const err = e as ApiError;
      setSubmitError(err);
      if (err.code === 'validacao') {
        setErrors(err.fields);
        setStep('form');
      }
    } finally {
      setBusy(false);
    }
  };

  const schoolName = data.schoolId && data.schoolId !== 'outra' ? schools.find((s) => s.id === data.schoolId)?.name : data.schoolOther;

  if (step === 'done' && result) return <Success ev={ev} result={result} headingRef={headingRef} />;

  if (step === 'review')
    return (
      <div>
        <h2 ref={headingRef} tabIndex={-1} className="text-lg font-semibold outline-none">Confira seus dados</h2>
        <p className="mt-1 text-sm text-slate-600">Verifique antes de confirmar. O certificado sairá com o nome exatamente como abaixo.</p>
        <dl className="mt-4 divide-y divide-slate-100 rounded-lg ring-1 ring-slate-200">
          {[
            ['Nome completo', data.fullName.trim()],
            ['CPF', data.cpf],
            ['Escola/instituição', schoolName],
            ['E-mail', data.email.trim().toLowerCase()],
            ['Telefone', data.phone],
          ].map(([k, v]) => (
            <div key={k} className="grid grid-cols-[120px_1fr] gap-2 px-3 py-2 text-sm"><dt className="text-slate-600">{k}</dt><dd className="break-words font-medium">{v}</dd></div>
          ))}
        </dl>
        {submitError && <div className="mt-4"><Alert tone="error" title="Inscrição não realizada">{submitError.message}</Alert></div>}
        <div className="mt-5 flex flex-col gap-2 sm:flex-row-reverse">
          <button className="btn-primary" onClick={submit} disabled={busy}>{busy ? 'Enviando…' : 'Confirmar inscrição'}</button>
          <button className="btn-secondary" onClick={() => setStep('form')} disabled={busy}>Corrigir dados</button>
        </div>
      </div>
    );

  return (
    <form onSubmit={validate} noValidate>
      <h2 ref={headingRef} tabIndex={-1} className="text-lg font-semibold outline-none">Inscrição</h2>
      <p className="mt-1 text-sm text-slate-600">Todos os campos são obrigatórios.</p>
      <div className="mt-4 grid gap-4">
        <TextInput label="Nome completo" required autoComplete="name" value={data.fullName} onChange={set('fullName')} error={errors.fullName} maxLength={200} />
        <TextInput
          label="CPF" required inputMode="numeric" autoComplete="off" placeholder="000.000.000-00" value={data.cpf} onChange={set('cpf')}
          error={errors.cpf || (onlyDigits(data.cpf).length === 11 && !isValidCpf(data.cpf) ? 'CPF inválido: confira os dígitos.' : undefined)}
          hint="Usado apenas para evitar inscrição duplicada e identificar você no certificado."
        />
        {schools.length > 0 ? (
          <SelectInput label="Escola ou instituição em que atua" required value={data.schoolId} onChange={set('schoolId')} error={errors.schoolId}>
            <option value="">Selecione…</option>
            {schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            <option value="outra">Outra instituição (informar)</option>
          </SelectInput>
        ) : null}
        {(data.schoolId === 'outra' || schools.length === 0) && (
          <TextInput label={schools.length ? 'Nome da instituição' : 'Escola ou instituição em que atua'} required value={data.schoolOther} onChange={set('schoolOther')} error={errors.schoolOther || (schools.length ? undefined : errors.schoolId)} maxLength={200} />
        )}
        <TextInput label="E-mail" required type="email" autoComplete="email" inputMode="email" value={data.email} onChange={set('email')} error={errors.email} hint="A confirmação e o certificado serão enviados para este endereço." />
        <TextInput label="Telefone com DDD" required type="tel" autoComplete="tel" inputMode="tel" placeholder="(00) 00000-0000" value={data.phone} onChange={set('phone')} error={errors.phone || (onlyDigits(data.phone).length >= 10 && !isValidPhone(data.phone) ? 'Telefone inválido.' : undefined)} />
        <div>
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" className="mt-1 h-5 w-5 shrink-0 rounded border-slate-400" checked={data.privacyAck} onChange={set('privacyAck')} aria-invalid={Boolean(errors.privacyAck)} />
            <span>Li o <Link to="/privacidade" target="_blank" className="underline">aviso de privacidade</Link> e estou ciente de como meus dados serão tratados.</span>
          </label>
          {errors.privacyAck && <p className="mt-1 text-sm font-medium text-red-700">{errors.privacyAck}</p>}
        </div>
      </div>
      <button type="submit" className="btn-primary mt-5 w-full">Revisar dados</button>
    </form>
  );
}

function Success({ ev, result, headingRef }: { ev: EventDto; result: { protocol: string; token: string; emailStatus: string }; headingRef: React.RefObject<HTMLHeadingElement> }) {
  const [emailStatus, setEmailStatus] = useState(result.emailStatus);
  useEffect(() => {
    let n = 0;
    const t = setInterval(async () => {
      n++;
      try {
        const r = await api(`/api/public/registrations/${result.token}`);
        setEmailStatus(r.emailStatus);
        if (r.emailStatus === 'enviado' || r.emailStatus === 'falhou' || n > 10) clearInterval(t);
      } catch {
        clearInterval(t);
      }
    }, 3000);
    return () => clearInterval(t);
  }, [result.token]);
  return (
    <div>
      <div className="flex items-center gap-2 text-emerald-700">
        <Icon name="check" className="h-6 w-6" />
        <h2 ref={headingRef} tabIndex={-1} className="text-lg font-semibold outline-none">Inscrição confirmada</h2>
      </div>
      <p className="mt-2 text-sm">Protocolo: <strong className="font-mono text-base">{result.protocol}</strong></p>
      <p className="mt-1 text-sm text-slate-700">{ev.title} · {ev.startsAt ? fmtDate(ev.startsAt) : ''}</p>
      <img src={`/api/public/registrations/${result.token}/qr.svg`} alt={`QR Code da inscrição ${result.protocol}`} className="mx-auto mt-4 w-56 rounded-lg bg-white p-2 ring-1 ring-slate-200" />
      <p className="mt-3 text-sm">Apresente este QR Code no credenciamento. Ele é pessoal: não compartilhe.</p>
      <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm" aria-live="polite">
        <span className="mr-2">E-mail de confirmação:</span>
        <EmailBadge status={emailStatus} />
        <p className="mt-1 text-slate-600">
          {emailStatus === 'enviado' && 'O servidor de e-mail aceitou a mensagem. Verifique também a caixa de spam.'}
          {(emailStatus === 'pendente' || emailStatus === 'enviando') && 'O e-mail está na fila de envio. Enquanto isso, guarde o link abaixo.'}
          {emailStatus === 'falhou' && 'Não conseguimos enviar o e-mail. Sua inscrição está confirmada; guarde o link abaixo e contate a Secretaria se precisar.'}
        </p>
      </div>
      <Link to={`/i/${result.token}`} className="btn-secondary mt-4 w-full">Abrir minha inscrição (salve este link)</Link>
    </div>
  );
}

function ResendBox({ eventId }: { eventId: string }) {
  const [open, setOpen] = useState(false);
  const [cpf, setCpf] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr('');
    setMsg('');
    if (!isValidCpf(cpf)) return setErr('CPF inválido.');
    try {
      const r = await api(`/api/public/events/${eventId}/resend`, { body: { cpf: onlyDigits(cpf) } });
      setMsg(r.message);
    } catch (e) {
      setErr((e as ApiError).message);
    }
  };
  return (
    <div className="mt-6 border-t border-slate-200 pt-4 text-sm">
      <button className="font-medium text-slate-700 underline" onClick={() => setOpen(!open)} aria-expanded={open}>Já se inscreveu e não recebeu o e-mail?</button>
      {open && (
        <form onSubmit={submit} className="mt-3 grid gap-3" noValidate>
          <TextInput label="CPF" inputMode="numeric" value={cpf} onChange={(e) => setCpf(formatCpf(e.target.value))} error={err} />
          <button className="btn-secondary">Reenviar confirmação ao e-mail cadastrado</button>
          {msg && <Alert tone="info">{msg}</Alert>}
        </form>
      )}
    </div>
  );
}
