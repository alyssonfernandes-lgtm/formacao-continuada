import type { EventPhase } from '../../shared/types';

export interface SessionDto {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  hours: number;
}

export interface EventDto {
  id: string;
  title: string;
  description: string;
  objectives: string;
  targetAudience: string;
  syllabus: string;
  location: string;
  modality: string;
  instructor: string;
  promoter: string;
  workloadHours: number;
  capacity: number | null;
  registrationOpensAt: string;
  registrationClosesAt: string;
  status: 'rascunho' | 'publicado' | 'concluido' | 'cancelado';
  phase: EventPhase;
  full: boolean;
  spotsLeft: number | null;
  registrationOpen: boolean;
  certificateInfo: string;
  certCriterion?: 'todas_sessoes' | 'percentual_minimo';
  certMinPercent?: number;
  certHoursMode?: 'integral' | 'proporcional';
  certSignerName?: string;
  certSignerRole?: string;
  certificatesReleasedAt?: string | null;
  startsAt: string | null;
  endsAt: string | null;
  sessions: SessionDto[];
}
