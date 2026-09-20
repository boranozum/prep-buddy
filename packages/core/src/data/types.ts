export type Severity = 'error' | 'warning';

export interface Violation {
  /** e.g. "ingredients/rice_white_long_raw", "recipes/chicken_pilaf:sear_chicken" */
  where: string;
  message: string;
  severity: Severity;
}

export function isError(v: Violation): boolean {
  return v.severity === 'error';
}
