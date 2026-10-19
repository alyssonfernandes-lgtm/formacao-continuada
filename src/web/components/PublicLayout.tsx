import { Link, NavLink, Outlet } from 'react-router-dom';
import { useApp } from '../lib/app';
import { Logo } from './Logo';

export function PublicLayout() {
  const { settings } = useApp();
  const nav = ({ isActive }: { isActive: boolean }) => `rounded-md px-3 py-2 text-sm font-medium ${isActive ? 'bg-white/20' : 'hover:bg-white/10'}`;
  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#conteudo" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:p-2">Ir para o conteúdo</a>
      <header className="bg-primary text-primary-fg">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4">
          <Link to="/" className="flex min-w-0 items-center gap-3">
            <Logo className="h-11" />
            <span className="min-w-0">
              <span className="block truncate text-xs opacity-90">{[settings?.department, settings?.municipality].filter(Boolean).join(' · ')}</span>
              <span className="block truncate text-lg font-bold leading-tight">{settings?.platformName ?? 'Formação Continuada'}</span>
            </span>
          </Link>
          <nav aria-label="Principal" className="flex flex-wrap gap-1">
            <NavLink to="/" end className={nav}>Eventos</NavLink>
            <NavLink to="/verificar" className={nav}>Verificar certificado</NavLink>
            <NavLink to="/admin" className={nav}>Área restrita</NavLink>
          </nav>
        </div>
      </header>
      <main id="conteudo" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        <Outlet />
      </main>
      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto grid max-w-6xl gap-4 px-4 py-6 text-sm text-slate-600 sm:grid-cols-2">
          <div>
            <p className="font-semibold text-slate-800">{settings?.department}</p>
            {settings?.municipality && <p>{settings.municipality}</p>}
            {settings?.contactAddress && <p>{settings.contactAddress}</p>}
          </div>
          <div className="sm:text-right">
            {settings?.contactEmail && <p>E-mail: <a className="underline" href={`mailto:${settings.contactEmail}`}>{settings.contactEmail}</a></p>}
            {settings?.contactPhone && <p>Telefone: {settings.contactPhone}</p>}
            <p><Link className="underline" to="/privacidade">Aviso de privacidade</Link></p>
          </div>
        </div>
      </footer>
    </div>
  );
}
