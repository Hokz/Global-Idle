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
 * | Reference KIND          | a marker pointing at a region instead of a hunt |
 * | Marker bounds           | an Atlas position outside its own region        |
 * | Activity-type vocabulary| a hunt naming a type nothing can run            |
 * | Asset resolution        | an `assetId` the manifest has never heard of    |
 * | One AVAILABLE region    | Phase 1 only — see the check                   |
 */
import { ACTIVITY_TYPE_KEYS, ASSET_IDS } from '@global-idle/shared';
import {
  atlasMarkerSchema,
  bundleSourceSchema,
  combatProfileSchema,
  creatureSchema,
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
    creature: creatureSchema,
    'combat-profile': combatProfileSchema,
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

    if (typed.data.kind === 'hunt') {
      expect(typed.data.region, 'region', 'region');

      // §10.2: the content/registry reconciliation, extended. The domain
      // describes what an activity type DOES; this checks only that the name
      // is one it describes, and the domain refuses to boot if that list and
      // its descriptors ever disagree.
      if (!(ACTIVITY_TYPE_KEYS as readonly string[]).includes(typed.data.activityTypeKey)) {
        issues.push({
          severity: 'error',
          check: 'activity-type-vocabulary',
          message:
            `${definition.key}.activityTypeKey is "${typed.data.activityTypeKey}", ` +
            `which no activity type describes (known: ${ACTIVITY_TYPE_KEYS.join(', ')})`,
        });
      }

      // ── Phase 2: a Hunt a player can enter must be simulatable ─────────
      const { rooms, combatProfile } = typed.data;
      if (typed.data.availability === 'AVAILABLE' && (!rooms || rooms.length === 0)) {
        issues.push({
          severity: 'error',
          check: 'hunt-rooms',
          message: `${definition.key} is AVAILABLE but authors no rooms; there would be nothing to simulate`,
        });
      }
      if (typed.data.availability === 'AVAILABLE' && !combatProfile) {
        issues.push({
          severity: 'error',
          check: 'hunt-rooms',
          message: `${definition.key} is AVAILABLE but names no combatProfile`,
        });
      }
      if (combatProfile) expect(combatProfile, 'combatProfile', 'combat-profile');

      if (rooms && rooms.length > 0) {
        // Room numbers are 1..n with no gaps: a missing room is a run that
        // walks into nothing, and it is far cheaper to catch here.
        const numbers = rooms.map((room) => room.number).sort((a, b) => a - b);
        const contiguous = numbers.every((value, index) => value === index + 1);
        if (!contiguous) {
          issues.push({
            severity: 'error',
            check: 'hunt-rooms',
            message: `${definition.key} rooms are ${numbers.join(', ')}; they must be 1..${numbers.length} with no gaps`,
          });
        }

        // EXACTLY ONE endless room, and it must be the last. Two would make
        // progression ambiguous; none would make the Hunt end at room n with
        // nothing to do, which is not what §4 describes.
        const endless = rooms.filter((room) => room.endless);
        const last = Math.max(...numbers);
        if (endless.length !== 1 || endless[0]?.number !== last) {
          issues.push({
            severity: 'error',
            check: 'hunt-rooms',
            message:
              `${definition.key} must mark exactly one endless room and it must be the last (room ${last}); ` +
              `found ${endless.length} at ${endless.map((room) => room.number).join(', ') || 'none'}`,
          });
        }

        for (const room of rooms) {
          for (const entry of room.creatures)
            expect(entry.key, `rooms[${room.number}]`, 'creature');
        }
      }
    }

    if (typed.data.kind === 'creature') {
      // A creature that cannot be killed in finite time is a content bug, not
      // a difficulty setting: its minimum defence roll already exceeds any
      // attack the game can produce.
      if (typed.data.maxHealth <= 0) {
        issues.push({
          severity: 'error',
          check: 'creature-sanity',
          message: `${definition.key} has no health`,
        });
      }
    }

    // §11: every authored `*AssetId` resolves in the manifest. A typo here
    // is a blank rectangle in front of a player; caught at build time it is a
    // one-line diff.
    const assetIds: Array<readonly [string, string]> =
      typed.data.kind === 'region'
        ? [['backdropAssetId', typed.data.backdropAssetId]]
        : typed.data.kind === 'atlas-marker'
          ? [['iconAssetId', typed.data.iconAssetId]]
          : [];
    for (const [field, id] of assetIds) {
      if (!(ASSET_IDS as readonly string[]).includes(id)) {
        issues.push({
          severity: 'error',
          check: 'asset-resolution',
          message: `${definition.key}.${field} names "${id}", which the asset manifest does not define`,
        });
      }
    }

    if (typed.data.kind === 'region' && typed.data.minZoom > typed.data.maxZoom) {
      issues.push({
        severity: 'error',
        check: 'region-zoom',
        message: `${definition.key}: minZoom ${typed.data.minZoom} exceeds maxZoom ${typed.data.maxZoom}`,
      });
    }
  }

  // §10.2: EXACTLY ONE region is AVAILABLE in the Phase 1 bundle.
  //
  // This is the one rule here that is a PHASE assertion rather than a
  // structural one, and the specification says so: it is relaxed when a
  // second region opens. It earns its place meanwhile because "Rookgaard is
  // the only place you can go" is the phase's scope, and a stray AVAILABLE in
  // a placeholder region would put a player somewhere with no content.
  const regions = source.definitions
    .map((definition) => regionSchema.safeParse(definition))
    .flatMap((parsed) => (parsed.success ? [parsed.data] : []));
  if (regions.length > 0) {
    const available = regions.filter((region) => region.availability === 'AVAILABLE');
    if (available.length !== 1) {
      issues.push({
        severity: 'error',
        check: 'one-available-region',
        message:
          `${available.length} regions are AVAILABLE (${available.map((r) => r.key).join(', ') || 'none'}); ` +
          'the Phase 1 bundle must have exactly one',
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
