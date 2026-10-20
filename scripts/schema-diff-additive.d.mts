export function classifySchemaDiff(sql: string): {
  additive: boolean;
  offending: string | null;
};
export function findDropStatements(sql: string): string[];
