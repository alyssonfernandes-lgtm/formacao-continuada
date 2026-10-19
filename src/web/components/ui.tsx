import { useEffect, useId, useRef, type ReactNode, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { PHASE_LABELS, type EventPhase } from '../../shared/types';

export function Spinner({ label = 'Carregando…' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-3 py-8 text-slate-600">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-primary" aria-hidden />
      <span>{label}</span>
    </div>
  );
}

type Tone = 'info' | 'success' | 'warning' | 'error';
const toneCls: Record<Tone, string> = {
  info: 'bg-sky-50 text-sky-900 ring-sky-200',
  success: 'bg-emerald-50 text-emerald-900 ring-emerald-200',
  warning: 'bg-amber-50 text-amber-900 ring-amber-200',
  error: 'bg-red-50 text-red-900 ring-red-200',
};
export function Alert({ tone = 'info', title, children }: { tone?: Tone; title?: string; children?: ReactNode }) {
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`rounded-lg p-4 text-sm ring-1 ${toneCls[tone]}`}>
      {title && <p className="font-semibold">{title}</p>}
      {children && <div className={title ? 'mt-1' : ''}>{children}</div>}
    </div>
  );
}

const badgeCls: Record<string, string> = {
  gray: 'bg-slate-100 text-slate-700 ring-slate-300',
  blue: 'bg-sky-50 text-sky-800 ring-sky-300',
  green: 'bg-emerald-50 text-emerald-800 ring-emerald-300',
  amber: 'bg-amber-50 text-amber-900 ring-amber-300',
  red: 'bg-red-50 text-red-800 ring-red-300',
  violet: 'bg-violet-50 text-violet-800 ring-violet-300',
};
export function Badge({ color = 'gray', children }: { color?: keyof typeof badgeCls; children: ReactNode }) {
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${badgeCls[color]}`}>{children}</span>;
}

const phaseColor: Record<EventPhase, keyof typeof badgeCls> = {
  rascunho: 'gray', publicado: 'blue', inscricoes_abertas: 'green', inscricoes_encerradas: 'amber', em_andamento: 'violet', concluido: 'gray', cancelado: 'red',
};
export const PhaseBadge = ({ phase }: { phase: EventPhase }) => <Badge color={phaseColor[phase]}>{PHASE_LABELS[phase]}</Badge>;

const emailMap: Record<string, [string, keyof typeof badgeCls]> = {
  pendente: ['Pendente', 'amber'], enviando: ['Enviando', 'blue'], enviado: ['Enviado', 'green'], falhou: ['Falhou', 'red'],
};
export const EmailBadge = ({ status }: { status: string | null }) => {
  if (!status) return <Badge>—</Badge>;
  const [l, c] = emailMap[status] ?? [status, 'gray'];
  return <Badge color={c}>{l}</Badge>;
};

interface FieldProps {
  label: string;
  error?: string;
  hint?: string;
  required?: boolean;
  children: (p: { id: string; 'aria-invalid': boolean; 'aria-describedby'?: string; required?: boolean }) => ReactNode;
}
export function Field({ label, error, hint, required, children }: FieldProps) {
  const id = useId();
  const desc = [hint && `${id}-h`, error && `${id}-e`].filter(Boolean).join(' ') || undefined;
  return (
    <div>
      <div className="flex gap-1">
        <label htmlFor={id} className="label">{label}</label>
        {required && <span className="text-sm text-red-700" aria-hidden>*</span>}
      </div>
      {children({ id, 'aria-invalid': Boolean(error), 'aria-describedby': desc, required })}
      {hint && <p id={`${id}-h`} className="mt-1 text-xs text-slate-600">{hint}</p>}
      {error && <p id={`${id}-e`} className="mt-1 text-sm font-medium text-red-700">{error}</p>}
    </div>
  );
}

export const TextInput = ({ label, error, hint, required, ...rest }: Omit<FieldProps, 'children'> & InputHTMLAttributes<HTMLInputElement>) => (
  <Field label={label} error={error} hint={hint} required={required}>
    {(p) => <input className="input" {...p} {...rest} />}
  </Field>
);
export const TextArea = ({ label, error, hint, required, ...rest }: Omit<FieldProps, 'children'> & TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <Field label={label} error={error} hint={hint} required={required}>
    {(p) => <textarea className="input min-h-[96px]" {...p} {...rest} />}
  </Field>
);
export const SelectInput = ({ label, error, hint, required, children, ...rest }: Omit<FieldProps, 'children'> & SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) => (
  <Field label={label} error={error} hint={hint} required={required}>
    {(p) => (
      <select className="input" {...p} {...rest}>
        {children}
      </select>
    )}
  </Field>
);

/** Diálogo acessível baseado no elemento nativo <dialog> (foco preso, Esc fecha). */
export function Modal({ open, title, onClose, children, footer }: { open: boolean; title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} onClose={onClose} aria-labelledby="modal-title" className="w-[min(560px,calc(100vw-32px))] rounded-xl p-0 shadow-xl backdrop:bg-slate-900/50">
      {open && (
        <div className="p-5">
          <h2 id="modal-title" className="text-lg font-semibold">{title}</h2>
          <div className="mt-3 text-sm">{children}</div>
          {footer && <div className="mt-5 flex flex-wrap justify-end gap-2">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">{title}</h1>
        {subtitle && <div className="mt-1 text-sm text-slate-600">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-600">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900">{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="card p-8 text-center text-sm text-slate-600">{children}</div>;
}
