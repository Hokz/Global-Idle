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
export interface PlaceholderAsset {
  readonly fill: string;
  readonly stroke: string;
  readonly label: string;
}

const MANIFEST: Record<string, PlaceholderAsset> = {
  'atlas.region.rookgaard': { fill: '#2f4a3c', stroke: '#5f8f72', label: 'Rookgaard' },
  'atlas.region.locked': { fill: '#26282d', stroke: '#3c4048', label: 'Locked' },
  'marker.hunt': { fill: '#c2703a', stroke: '#f0a163', label: 'Hunt' },
  'portrait.character': { fill: '#3a3f4b', stroke: '#6b7385', label: 'Character' },
};

const FALLBACK: PlaceholderAsset = { fill: '#3a3f4b', stroke: '#6b7385', label: 'Asset' };

export const asset = (id: string): PlaceholderAsset => MANIFEST[id] ?? FALLBACK;

/** Build-time content validation checks every authored id against this list,
 *  so a typo fails the build rather than the browser. */
export const KNOWN_ASSET_IDS = Object.keys(MANIFEST);
