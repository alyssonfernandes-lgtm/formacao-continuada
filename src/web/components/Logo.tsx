import { useApp } from '../lib/app';

/** Logo oficial quando configurada; caso contrário, um espaço reservado neutro (sem símbolos inventados). */
export function Logo({ className = 'h-10' }: { className?: string }) {
  const { settings } = useApp();
  if (settings?.hasLogo) return <img src={`/api/public/logo?v=${settings.logoVersion}`} alt={`Logo — ${settings.department}`} className={`${className} w-auto object-contain`} />;
  return (
    <span className={`${className} inline-flex aspect-square items-center justify-center rounded-md border-2 border-dashed border-current/40 text-[10px] font-semibold uppercase leading-tight opacity-80`} title="Espaço reservado para a logo oficial do município">
      Logo
    </span>
  );
}
