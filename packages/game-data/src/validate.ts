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
import {
  atlasMarkerSchema,
  bundleSourceSchema,
  huntSchema,
  regionSchema,
  type BundleSource,
} from './schema.js';

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

  // ── Phase 1 kinds (spec §10.2) ──────────────────────────────────────────
  // A definition whose `kind` names a Phase 1 shape must satisfy that shape,
  // and its pointers must point at the RIGHT KIND. "Resolves" is not enough:
  // a marker targeting a region instead of a hunt resolves perfectly and is
  // still wrong, and the client would discover it at render time.
  const kindOf = new Map(source.definitions.map((d) => [d.key, d.kind]));
  const schemaFor = {
    region: regionSchema,
    'atlas-marker': atlasMarkerSchema,
    hunt: huntSchema,
  } as const;

  for (const definition of source.definitions) {
    const schema = schemaFor[definition.kind as keyof typeof schemaFor];
    if (!schema) continue;
    const typed = schema.safeParse(definition);
    if (!typed.success) {
      for (const issue of typed.error.issues) {
        issues.push({
          severity: 'error',
          check: `kind-conformance:${definition.kind}`,
          message: `${definition.key}.${issue.path.join('.') || '(root)'}: ${issue.message}`,
        });
      }
      continue;
    }

    const expect = (pointer: string, field: string, wanted: string): void => {
      const actual = kindOf.get(pointer);
      if (actual !== undefined && actual !== wanted) {
        issues.push({
          severity: 'error',
          check: 'reference-kind',
          message: `${definition.key}.${field} points at ${pointer}, which is a ${actual}, not a ${wanted}`,
        });
      }
    };

    if (typed.data.kind === 'atlas-marker') {
      expect(typed.data.region, 'region', 'region');
      expect(typed.data.target, 'target', 'hunt');
      const region = source.definitions.find((d) => d.key === typed.data.region);
      const regionTyped = region ? regionSchema.safeParse(region) : undefined;
      if (regionTyped?.success) {
        const { x, y, width, height } = regionTyped.data.atlas;
        const p = typed.data.position;
        if (p.x < x || p.x > x + width || p.y < y || p.y > y + height) {
          issues.push({
            severity: 'error',
            check: 'marker-bounds',
            message: `${definition.key} sits at (${p.x}, ${p.y}), outside ${regionTyped.data.key}`,
          });
        }
      }
    }

    if (typed.data.kind === 'hunt') expect(typed.data.region, 'region', 'region');

    if (typed.data.kind === 'region' && typed.data.minZoom > typed.data.maxZoom) {
      issues.push({
        severity: 'error',
        check: 'region-zoom',
        message: `${definition.key}: minZoom ${typed.data.minZoom} exceeds maxZoom ${typed.data.maxZoom}`,
      });
    }
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
