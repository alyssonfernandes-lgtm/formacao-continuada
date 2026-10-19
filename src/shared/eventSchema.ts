import { z } from 'zod';

const isoDate = z
  .string()
  .min(1, 'Informe a data e o horário.')
  .refine((v) => !Number.isNaN(Date.parse(v)), 'Data inválida.');

export const sessionSchema = z
  .object({
    id: z.string().uuid().optional(),
    title: z.string().trim().max(200).default(''),
    startsAt: isoDate,
    endsAt: isoDate,
    hours: z.coerce.number().positive('A carga horária da sessão deve ser maior que zero.').max(999),
  })
  .refine((s) => Date.parse(s.endsAt) > Date.parse(s.startsAt), { message: 'O término deve ser posterior ao início.', path: ['endsAt'] });

export const eventSchema = z
  .object({
    title: z.string().trim().min(3, 'Informe o título.').max(200),
    description: z.string().trim().max(10000).default(''),
    objectives: z.string().trim().max(10000).default(''),
    targetAudience: z.string().trim().max(2000).default(''),
    syllabus: z.string().trim().max(20000).default(''),
    location: z.string().trim().min(2, 'Informe o local.').max(300),
    modality: z.enum(['Presencial', 'On-line', 'Híbrido']).default('Presencial'),
    instructor: z.string().trim().max(300).default(''),
    promoter: z.string().trim().max(300).default(''),
    workloadHours: z.coerce.number().positive('Informe a carga horária.').max(9999),
    capacity: z.coerce.number().int().positive().nullable().default(null),
    registrationOpensAt: isoDate,
    registrationClosesAt: isoDate,
    status: z.enum(['rascunho', 'publicado', 'concluido', 'cancelado']).default('rascunho'),
    certificateInfo: z.string().trim().max(2000).default(''),
    certCriterion: z.enum(['todas_sessoes', 'percentual_minimo']).default('todas_sessoes'),
    certMinPercent: z.coerce.number().int().min(1).max(100).default(75),
    certHoursMode: z.enum(['integral', 'proporcional']).default('integral'),
    certSignerName: z.string().trim().max(200).default(''),
    certSignerRole: z.string().trim().max(200).default(''),
    sessions: z.array(sessionSchema).min(1, 'Cadastre ao menos uma sessão (data e horário).').max(100),
  })
  .refine((e) => Date.parse(e.registrationClosesAt) > Date.parse(e.registrationOpensAt), {
    message: 'O prazo final deve ser posterior à abertura das inscrições.',
    path: ['registrationClosesAt'],
  });

export type EventInput = z.input<typeof eventSchema>;
