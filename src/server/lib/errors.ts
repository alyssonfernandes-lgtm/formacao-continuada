export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const notFound = (msg = 'Registro não encontrado.') => new AppError(404, 'nao_encontrado', msg);
export const forbidden = (msg = 'Você não tem permissão para esta ação.') => new AppError(403, 'sem_permissao', msg);
export const badRequest = (msg: string, code = 'requisicao_invalida') => new AppError(400, code, msg);
export const conflict = (msg: string, code = 'conflito') => new AppError(409, code, msg);
