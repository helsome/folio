import type { ConversationBranch, Message } from '@finagent/core';

/**
 * Materialize one branch from append-only artifacts.  A child branch inherits
 * its parent transcript only through `forkMessageId`; its own messages are
 * then appended.  Missing branch ids are treated as legacy Main-branch data.
 */
export function materializeBranchMessages(
  messages: Message[],
  branches: ConversationBranch[],
  branchId: string
): Message[] {
  const byId = new Map(branches.map((branch) => [branch.id, branch]));
  const rootId = branches.find((branch) => !branch.parentBranchId)?.id;
  const normalized = messages.map((message) => ({
    ...message,
    branchId: message.branchId ?? rootId,
  }));

  const visit = (currentId: string, stack: Set<string>): Message[] => {
    if (stack.has(currentId)) {
      throw new Error(`Conversation branch cycle detected at ${currentId}.`);
    }
    const branch = byId.get(currentId);
    if (!branch) return normalized.filter((message) => message.branchId === currentId);

    const nextStack = new Set(stack);
    nextStack.add(currentId);
    let inherited: Message[] = [];
    if (branch.parentBranchId) {
      inherited = visit(branch.parentBranchId, nextStack);
      if (branch.forkMessageId === null) {
        inherited = [];
      } else if (branch.forkMessageId !== undefined) {
        const forkIndex = inherited.findIndex((message) => message.id === branch.forkMessageId);
        inherited = forkIndex >= 0 ? inherited.slice(0, forkIndex + 1) : [];
      }
    }

    return [
      ...inherited,
      ...normalized.filter((message) => message.branchId === branch.id),
    ];
  };

  return visit(branchId, new Set());
}
