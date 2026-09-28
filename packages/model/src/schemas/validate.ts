import { Validator } from '@cfworker/json-schema';
import type { EntityType } from '../entities.js';
import { BUILTIN_SCHEMAS } from './builtin.js';

export interface ValidationIssue {
  /** Where in the data: `/title/he`, `/lines/3/text`. */
  path: string;
  message: string;
}

export type ValidationResult = { ok: true } | { ok: false; issues: ValidationIssue[] };

/**
 * The entity types and their schemas as of some catalog commit. The
 * store builds one from its `schema` entities; the built-in schemas are
 * the registry of an empty catalog. Validation never compiles code, so it
 * runs unchanged on Cloudflare Workers.
 */
export class SchemaRegistry {
  private readonly validators = new Map<string, Validator>();

  constructor(private readonly schemas: ReadonlyMap<string, Record<string, unknown>>) {}

  static builtin(): SchemaRegistry {
    return new SchemaRegistry(new Map(Object.entries(BUILTIN_SCHEMAS)));
  }

  /** The built-in schemas with any stored ones laid over them. */
  static withOverrides(overrides: Iterable<[string, Record<string, unknown>]>): SchemaRegistry {
    const merged = new Map<string, Record<string, unknown>>(Object.entries(BUILTIN_SCHEMAS));
    for (const [type, schema] of overrides) merged.set(type, schema);
    return new SchemaRegistry(merged);
  }

  types(): string[] {
    return [...this.schemas.keys()];
  }

  has(type: string): boolean {
    return this.schemas.has(type);
  }

  schemaFor(type: string): Record<string, unknown> | undefined {
    return this.schemas.get(type);
  }

  validate(type: EntityType | string, data: unknown): ValidationResult {
    const schema = this.schemas.get(type);
    if (!schema) return { ok: false, issues: [{ path: '', message: `unknown entity type "${type}"` }] };
    let validator = this.validators.get(type);
    if (!validator) {
      validator = new Validator(structuredClone(schema) as never, '2020-12', false);
      this.validators.set(type, validator);
    }
    const result = validator.validate(data);
    if (result.valid) return { ok: true };
    // The validator reports each failure and every schema keyword above it;
    // the innermost (longest instance path) ones are what a person can fix.
    const issues = result.errors
      .filter((e) => !['properties', 'allOf', '$ref', 'items'].includes(e.keyword))
      .map((e) => ({ path: e.instanceLocation.replace(/^#/, ''), message: e.error }));
    return { ok: false, issues: dedupe(issues.length > 0 ? issues : result.errors.map((e) => ({ path: e.instanceLocation.replace(/^#/, ''), message: e.error }))) };
  }
}

function dedupe(issues: ValidationIssue[]): ValidationIssue[] {
  const seen = new Set<string>();
  return issues.filter((i) => {
    const key = `${i.path}\u0000${i.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
