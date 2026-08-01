import type {
  ChannelSnapshot,
  PermissionOverwriteSnapshot,
  RestoreOperation,
  RoleSnapshot,
} from "./schema.js";

type DiffResource = "role" | "channel";
type DiffableSnapshot = RoleSnapshot | ChannelSnapshot;

export function diffRoles(before: RoleSnapshot[], after: RoleSnapshot[]): RestoreOperation[] {
  return diffSnapshots(
    "role",
    before,
    after,
    normalizeRole,
    (snapshot) => snapshot.name,
    (snapshot) => (snapshot.managed ? "managed role" : null),
  );
}

export function diffChannels(before: ChannelSnapshot[], after: ChannelSnapshot[]): RestoreOperation[] {
  return diffSnapshots(
    "channel",
    before,
    after,
    normalizeChannel,
    (snapshot) => `${snapshot.type}:${snapshot.name}`,
  );
}

function diffSnapshots<TSnapshot extends DiffableSnapshot>(
  resource: DiffResource,
  before: TSnapshot[],
  after: TSnapshot[],
  normalize: (snapshot: TSnapshot) => Record<string, unknown>,
  semanticIdentity: (snapshot: TSnapshot) => string,
  skipReason: (snapshot: TSnapshot) => string | null = () => null,
): RestoreOperation[] {
  const unmatchedAfter = new Set(after.map((_, index) => index));
  const operations: RestoreOperation[] = [];

  for (const beforeSnapshot of before) {
    const afterIndex = findMatchIndex(beforeSnapshot, after, unmatchedAfter, semanticIdentity);
    const afterSnapshot = afterIndex === undefined ? undefined : after[afterIndex];

    if (afterIndex !== undefined) {
      unmatchedAfter.delete(afterIndex);
    }

    const reason = skipReason(beforeSnapshot) ?? (afterSnapshot ? skipReason(afterSnapshot) : null);

    if (reason !== null) {
      operations.push({
        type: "skip",
        resource,
        key: beforeSnapshot.key,
        reason,
      });
      continue;
    }

    if (afterSnapshot === undefined) {
      operations.push({
        type: "delete",
        resource,
        key: beforeSnapshot.key,
        before: beforeSnapshot,
      });
      continue;
    }

    const changes = changedFields(normalize(beforeSnapshot), normalize(afterSnapshot));

    if (changes.length === 0) {
      operations.push({
        type: "skip",
        resource,
        key: beforeSnapshot.key,
        reason: "no changes",
      });
      continue;
    }

    operations.push({
      type: "update",
      resource,
      key: beforeSnapshot.key,
      before: beforeSnapshot,
      after: afterSnapshot,
      changes,
    });
  }

  for (const afterIndex of unmatchedAfter) {
    const afterSnapshot = after[afterIndex]!;
    const reason = skipReason(afterSnapshot);

    operations.push(
      reason === null
        ? {
            type: "create",
            resource,
            key: afterSnapshot.key,
            after: afterSnapshot,
          }
        : {
            type: "skip",
            resource,
            key: afterSnapshot.key,
            reason,
          },
    );
  }

  return operations;
}

function findMatchIndex<TSnapshot extends DiffableSnapshot>(
  beforeSnapshot: TSnapshot,
  after: TSnapshot[],
  unmatchedAfter: Set<number>,
  semanticIdentity: (snapshot: TSnapshot) => string,
): number | undefined {
  const candidates = [...unmatchedAfter];
  const idMatch = candidates.find((index) => after[index]?.id === beforeSnapshot.id);

  if (idMatch !== undefined) {
    return idMatch;
  }

  const keyMatch = candidates.find((index) => after[index]?.key === beforeSnapshot.key);

  if (keyMatch !== undefined) {
    return keyMatch;
  }

  const semanticKey = semanticIdentity(beforeSnapshot);
  const semanticMatches = candidates.filter(
    (index) => after[index] && semanticIdentity(after[index]) === semanticKey,
  );

  return semanticMatches.length === 1 ? semanticMatches[0] : undefined;
}

function normalizeRole(snapshot: RoleSnapshot): Record<string, unknown> {
  const { id: _id, key: _key, ...normalized } = snapshot;

  return normalized;
}

function normalizeChannel(snapshot: ChannelSnapshot): Record<string, unknown> {
  const { id: _id, key: _key, permissionOverwrites, ...normalized } = snapshot;

  return {
    ...normalized,
    permissionOverwrites: normalizeOverwrites(permissionOverwrites),
  };
}

function normalizeOverwrites(
  overwrites: PermissionOverwriteSnapshot[],
): PermissionOverwriteSnapshot[] {
  return [...overwrites].sort((left, right) => {
    const leftKey = `${left.type}:${left.id}`;
    const rightKey = `${right.type}:${right.id}`;

    return leftKey.localeCompare(rightKey);
  });
}

function changedFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changes: string[] = [];

  for (const key of keys) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      changes.push(key);
    }
  }

  return changes;
}
