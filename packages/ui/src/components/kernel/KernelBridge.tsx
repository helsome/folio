import React, { useEffect } from 'react';
import { useAtom, useSetAtom } from 'jotai';
import type { FinagentClient } from '../../client';
import {
  activeSessionIdAtom,
  hydrateSessionsAtom,
  loadMessagesAtom,
  loadedSessionIdsAtom,
} from '../../atoms/sessionAtoms';
import { applyAgentEventAtom } from '../../atoms/runAtoms';

/**
 * Bridges the kernel's `agent:event` stream and persistence into Jotai state.
 *
 * Rendered once under the client provider: hydrates the session list from the
 * kernel, loads messages for the active session (and on session switches), and
 * feeds every kernel agent event through the run reducer.
 */
export const KernelBridge: React.FC<{ client: FinagentClient }> = ({ client }) => {
  const hydrate = useSetAtom(hydrateSessionsAtom);
  const loadMessages = useSetAtom(loadMessagesAtom);
  const applyEvent = useSetAtom(applyAgentEventAtom);
  const [activeSessionId] = useAtom(activeSessionIdAtom);
  const [loadedSessionIds] = useAtom(loadedSessionIdsAtom);

  useEffect(() => {
    void hydrate(client);

    return client.kernel.onAgentEvent((event) => {
      applyEvent(event);
    });
  }, [client, hydrate, applyEvent]);

  useEffect(() => {
    if (activeSessionId && !loadedSessionIds.has(activeSessionId)) {
      void loadMessages(client, activeSessionId);
    }
  }, [client, activeSessionId, loadedSessionIds, loadMessages]);

  return null;
};
