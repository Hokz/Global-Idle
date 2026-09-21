/**
 * The asset manifest (spec §11).
 *
 * Content names an `assetId`; only this file knows what a file is called. That
 * is the whole point: when the Product Owner supplies real art, this map
 * changes and no content key, gameplay rule or component does.
 *
 * Phase 1 ships NEUTRAL PLACEHOLDERS drawn inline — no binary assets to import
 * and nothing to bulk-load. An unknown id falls back visibly rather than
 * rendering a broken image.
 */
import { ASSET_IDS, type KnownAssetId } from '@global-idle/shared';

export interface PlaceholderAsset {
  readonly fill: string;
  readonly stroke: string;
  readonly label: string;
}

/**
 * Typed by `KnownAssetId`, so a new id in the shared vocabulary is a TYPE
 * ERROR here until it has a placeholder — and content validation refuses an
 * id that is not in that vocabulary. The two directions together are what
 * makes "a missing asset fails the build, not the browser" true (§11).
 */
const MANIFEST: Record<KnownAssetId, PlaceholderAsset> = {
  'atlas.region.rookgaard': { fill: '#2f4a3c', stroke: '#5f8f72', label: 'Rookgaard' },
  'atlas.region.locked': { fill: '#26282d', stroke: '#3c4048', label: 'Locked' },
  'marker.hunt': { fill: '#c2703a', stroke: '#f0a163', label: 'Hunt' },
  'portrait.character': { fill: '#3a3f4b', stroke: '#6b7385', label: 'Character' },
};

const FALLBACK: PlaceholderAsset = { fill: '#3a3f4b', stroke: '#6b7385', label: 'Asset' };

export const asset = (id: string): PlaceholderAsset => MANIFEST[id as KnownAssetId] ?? FALLBACK;

/** The ids content is allowed to name. Content validation checks every
 *  authored `*AssetId` against this same list at BUILD time (§10.2). */
export const KNOWN_ASSET_IDS: readonly string[] = ASSET_IDS;
