'use client';

/**
 * The System UI surface.
 *
 * A route of its own, beside the Atlas and the Game Window, because it is a
 * different job: the Atlas navigates, the Game Window watches, and this one
 * manages. Keeping it separate is what stops the Hunt screen growing an
 * inventory panel it has no business owning.
 */
import { useParams } from 'next/navigation';
import { SystemWindow } from '../../_components/SystemWindow';

export default function System() {
  const params = useParams<{ characterId: string }>();
  return <SystemWindow characterId={params.characterId} />;
}
