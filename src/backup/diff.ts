import type {
  ChannelSnapshot,
  PermissionOverwriteSnapshot,
  RestoreOperation,
  RoleSnapshot,
} from "./schema.js";

type DiffResource = "role" | "channel";
type DiffableSnapshot = RoleSnapshot | ChannelSnapshot;

export function diffRoles(before: RoleSnapshot[], after: RoleSnapshot[]): RestoreOperation[] {
  return diffByKey("role", before, after, normalizeRole, (snapshot) =>
    snapshot.managed ? "managed role" : null,
  );
}

export function diffChannels(before: ChannelSnapshot[], after: ChannelSnapshot[]): RestoreOperation[] {
  return diffByKey("channel", before, after, normalizeChannel);
}

function diffByKey<TSnapshot extends DiffableSnapshot>(
  resource: DiffResource,
  before: TSnapshot[],
  after: TSnapshot[],
  normalize: (snapshot: TSnapshot) => Record<string, unknown>,
  skipReason: (snapshot: TSnapshot) => string | null = () => null,
): RestoreOperation[] {
  const beforeByKey = new Map(before.map((snapshot) => [snapshot.key, snapshot]));
  const afterByKey = new Map(after.map((snapshot) => [snapshot.key, snapshot]));
  const operations: RestoreOperation[] = [];

  for (const beforeSnapshot of before) {
    const reason = skipReason(beforeSnapshot);

    if (reason !== null) {
      operations.push({
        type: "skip",
        resource,
        key: beforeSnapshot.key,
        reason,
      });
      continue;
    }

    const afterSnapshot = afterByKey.get(beforeSnapshot.key);

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

  for (const afterSnapshot of after) {
    if (beforeByKey.has(afterSnapshot.key)) {
      continue;
    }

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

function normalizeRole(snapshot: RoleSnapshot): Record<string, unknown> {
  const { id: _id, ...normalized } = snapshot;

  return normalized;
}

function normalizeChannel(snapshot: ChannelSnapshot): Record<string, unknown> {
  const { id: _id, permissionOverwrites, ...normalized } = snapshot;

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
