export type Role = 'admin' | 'coordenacao' | 'credenciamento' | 'consulta';

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Administrador do sistema',
  coordenacao: 'Coordenação pedagógica',
  credenciamento: 'Equipe de credenciamento',
  consulta: 'Consulta gerencial',
};

export type Permission =
  | 'settings.manage'
  | 'users.manage'
  | 'events.manage'
  | 'registrations.view'
  | 'registrations.manage'
  | 'checkin.any'
  | 'checkin.assigned'
  | 'attendance.correct'
  | 'certificates.manage'
  | 'reports.summary'
  | 'reports.detailed'
  | 'emails.view'
  | 'audit.view';

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  admin: [
    'settings.manage', 'users.manage', 'events.manage', 'registrations.view', 'registrations.manage',
    'checkin.any', 'attendance.correct', 'certificates.manage', 'reports.summary', 'reports.detailed',
    'emails.view', 'audit.view',
  ],
  coordenacao: [
    'events.manage', 'registrations.view', 'registrations.manage', 'checkin.any', 'attendance.correct',
    'certificates.manage', 'reports.summary', 'reports.detailed', 'emails.view',
  ],
  credenciamento: ['checkin.assigned'],
  consulta: ['reports.summary'],
};

export const can = (role: Role, p: Permission) => ROLE_PERMISSIONS[role].includes(p);

export type CheckinResult =
  | 'registrado'
  | 'ja_registrado'
  | 'qr_invalido'
  | 'inscricao_cancelada'
  | 'nao_localizada'
  | 'outro_evento'
  | 'evento_nao_autorizado'
  | 'fora_da_janela';

export type EventPhase =
  | 'rascunho'
  | 'publicado'
  | 'inscricoes_abertas'
  | 'inscricoes_encerradas'
  | 'em_andamento'
  | 'concluido'
  | 'cancelado';

export const PHASE_LABELS: Record<EventPhase, string> = {
  rascunho: 'Rascunho',
  publicado: 'Publicado',
  inscricoes_abertas: 'Inscrições abertas',
  inscricoes_encerradas: 'Inscrições encerradas',
  em_andamento: 'Em andamento',
  concluido: 'Concluído',
  cancelado: 'Cancelado',
};
