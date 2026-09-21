/**
 * Build-time validation (§10.2). BLOCKING, except where the table says
 * otherwise.
 *
 * | Check                   | Catches                                        |
 * | Schema conformance      | missing or mistyped fields                     |
 * | Key uniqueness / format | duplicates, malformed keys                     |
 * | Reference resolution    | a pointer to a definition that does not exist  |
 * | Range sanity            | negative magnitude, probability outside 0..1   |
 * | Unlock-set cardinality  | a set not containing EXACTLY FIVE keys         |
 * | Orphan detection        | WARNING ONLY — content is often authored ahead |
 */
import { bundleSourceSchema, type BundleSource } from './schema.js';

export const POWERFUL_IMBUEMENT_SET_SIZE = 5;

export interface ValidationIssue {
  readonly severity: 'error' | 'warning';
  readonly check: string;
  readonly message: string;
}

export interface ValidationResult {
  readonly valid: boolean;
  readonly issues: readonly ValidationIssue[];
  readonly source?: BundleSource;
}

export function validateBundleSource(input: unknown): ValidationResult {
  const issues: ValidationIssue[] = [];

  const parsed = bundleSourceSchema.safeParse(input);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      issues.push({
        severity: 'error',
        check: 'schema-conformance',
        message: `${issue.path.join('.') || '(root)'}: ${issue.message}`,
      });
    }
    return { valid: false, issues };
  }

  const source = parsed.data;
  const defined = new Set<string>();

  for (const definition of source.definitions) {
    if (defined.has(definition.key)) {
      issues.push({
        severity: 'error',
        check: 'key-uniqueness',
        message: `Duplicate definition key: ${definition.key}`,
      });
    }
    defined.add(definition.key);
  }

  for (const definition of source.definitions) {
    for (const reference of definition.references) {
      if (!defined.has(reference)) {
        issues.push({
          severity: 'error',
          check: 'reference-resolution',
          message: `${definition.key} references ${reference}, which is not defined`,
        });
      }
    }
  }

  for (const set of source.unlockSets) {
    if (set.members.length !== POWERFUL_IMBUEMENT_SET_SIZE) {
      issues.push({
        severity: 'error',
        check: 'unlock-set-cardinality',
        message:
          `Unlock set ${set.key} has ${set.members.length} members; ` +
          `it must have exactly ${POWERFUL_IMBUEMENT_SET_SIZE}`,
      });
    }
    for (const member of set.members) {
      if (!defined.has(member)) {
        issues.push({
          severity: 'error',
          check: 'reference-resolution',
          message: `Unlock set ${set.key} names ${member}, which is not defined`,
        });
      }
    }
  }

  // Orphan detection is a WARNING: content is often authored ahead of its
  // consumer, and failing the build for that would make authoring impossible.
  const referenced = new Set<string>([
    ...source.definitions.flatMap((definition) => definition.references),
    ...source.unlockSets.flatMap((set) => set.members),
  ]);
  for (const definition of source.definitions) {
    if (!referenced.has(definition.key) && definition.references.length === 0) {
      issues.push({
        severity: 'warning',
        check: 'orphan-detection',
        message: `${definition.key} is not referenced by anything yet`,
      });
    }
  }

  return { valid: !issues.some((issue) => issue.severity === 'error'), issues, source };
}
