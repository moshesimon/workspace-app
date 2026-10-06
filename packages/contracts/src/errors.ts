export class DomainError extends Error {
  constructor(public code: string, message: string, public details?: unknown) { super(message); this.name = 'DomainError'; }
}
export function errorRecord(error: unknown) { return error instanceof DomainError ? {code:error.code,message:error.message,details:error.details} : {code:'INTERNAL_ERROR',message:error instanceof Error ? error.message : String(error)}; }
export function assert(condition: unknown, code:string, message:string): asserts condition { if (!condition) throw new DomainError(code,message); }
