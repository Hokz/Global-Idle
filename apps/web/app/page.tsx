// The client renders; it never decides (CLIENT_SERVER_BOUNDARIES.md).
// It may import packages/shared and nothing else from the workspace (§5.2).
import { SHARED_PACKAGE } from '@global-idle/shared';

export default function Page() {
  return (
    <main>
      <h1>Global Idle</h1>
      <p>Phase 0B technical foundation. Contracts from {SHARED_PACKAGE}.</p>
    </main>
  );
}
