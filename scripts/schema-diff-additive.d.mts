export function classifySchemaDiff(sql: string): {
  additive: boolean;
  offending: string | null;
};
