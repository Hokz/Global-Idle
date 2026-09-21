/**
 * Canonical content keys (§10.1).
 *
 * Lowercase, dot-separated, and IMMUTABLE once published: a key is how a
 * pinned bundle and a persisted row agree about what they mean, so renaming
 * one silently rewrites history.
 */
export type ContentKey = string & { readonly __contentKey: unique symbol };

const KEY_PATTERN = /^[a-z0-9]+(?:[-_][a-z0-9]+)*(?:\.[a-z0-9]+(?:[-_][a-z0-9]+)*)+$/;

export function isContentKey(value: string): boolean {
  return KEY_PATTERN.test(value);
}

export function contentKey(value: string): ContentKey {
  if (!isContentKey(value)) {
    throw new Error(
      `Invalid content key "${value}". Keys are lowercase, dot-separated segments, ` +
        'for example creature.rookgaard.rat (§10.1).',
    );
  }
  return value as ContentKey;
}

/** The leading segment, which names the kind of thing the key points at. */
export function keyNamespace(key: ContentKey): string {
  return key.split('.')[0] as string;
}
