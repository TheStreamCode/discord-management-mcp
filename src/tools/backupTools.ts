import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ChannelType, PermissionsBitField, type Guild } from "discord.js";
import { z } from "zod";
import type { ServerConfig } from "../config.js";
import type { DiscordClientManager } from "../discordClient.js";
import { diffChannels, diffRoles } from "../backup/diff.js";
import { createSnapshot } from "../backup/snapshot.js";
import { listBackups, readSnapshot, writeSnapshot } from "../backup/store.js";
import {
  schemaVersion,
  type ChannelSnapshot,
  type RestoreOperation,
  type RestorePlan,
  type RestoreWarning,
  type RoleSnapshot,
  type Snapshot,
} from "../backup/schema.js";
import { errorResponse, successResponse } from "../responses.js";
import { requireConfirmation } from "../safety.js";

export function registerBackupTools(
  server: McpServer,
  discord: DiscordClientManager,
  config: ServerConfig,
): void {
  server.registerTool(
    "discord_backup_create",
    {
      title: "Create Discord Backup",
      description: "Capture the current Discord guild configuration as a JSON backup snapshot.",
      inputSchema: {
        guildId: z.string().min(1).describe("Discord guild ID to snapshot."),
      },
      outputSchema: {
        backupId: z.string(),
        guildId: z.string(),
        capturedAt: z.string(),
        counts: countsSchema(),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ guildId }) => {
      try {
        const guild = await discord.getGuild(guildId);
        const snapshot = await createSnapshot(guild);
        const backupId = await writeSnapshot(config.backupDir, snapshot, new Date(snapshot.capturedAt));

        return successResponse(`Created backup ${backupId} for guild ${snapshot.guild.name}.`, {
          backupId,
          guildId: snapshot.guild.id,
          capturedAt: snapshot.capturedAt,
          counts: snapshotCounts(snapshot),
          warnings: snapshot.warnings ?? [],
        });
      } catch (error) {
        return errorResponse("Failed to create Discord backup.", {
          error: errorMessage(error),
        });
      }
    },
  );

  server.registerTool(
    "discord_backup_list",
    {
      title: "List Discord Backups",
      description: "List stored Discord backup snapshot IDs, newest first.",
      inputSchema: {},
      outputSchema: {
        backupIds: z.array(z.string()),
        count: z.number(),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      try {
        const backupIds = await listBackups(config.backupDir);

        return successResponse(`Found ${backupIds.length} Discord backup(s).`, {
          backupIds,
          count: backupIds.length,
        });
      } catch (error) {
        return errorResponse("Failed to list Discord backups.", {
          error: errorMessage(error),
        });
      }
    },
  );

  server.registerTool(
    "discord_backup_read",
    {
      title: "Read Discord Backup",
      description: "Read a stored Discord backup snapshot by backup ID.",
      inputSchema: {
        backupId: z.string().min(1).describe("Backup file ID returned by discord_backup_list or create."),
      },
      outputSchema: {
        backupId: z.string(),
        snapshot: z.unknown(),
        counts: countsSchema(),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ backupId }) => {
      try {
        const snapshot = await readSnapshot(config.backupDir, backupId);

        return successResponse(`Read backup ${backupId}.`, {
          backupId,
          snapshot,
          counts: snapshotCounts(snapshot),
          warnings: snapshot.warnings ?? [],
        });
      } catch (error) {
        return errorResponse(`Failed to read backup ${backupId}.`, {
          backupId,
          error: errorMessage(error),
        });
      }
    },
  );

  server.registerTool(
    "discord_backup_diff",
    {
      title: "Diff Discord Backups",
      description: "Compare roles and channels between two stored backup snapshots.",
      inputSchema: {
        beforeBackupId: z.string().min(1).describe("Older or source backup ID."),
        afterBackupId: z.string().min(1).describe("Newer or target backup ID."),
      },
      outputSchema: {
        beforeBackupId: z.string(),
        afterBackupId: z.string(),
        operations: z.array(z.unknown()),
        summary: summarySchema(),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ beforeBackupId, afterBackupId }) => {
      try {
        const before = await readSnapshot(config.backupDir, beforeBackupId);
        const after = await readSnapshot(config.backupDir, afterBackupId);
        const operations = [...diffRoles(before.roles, after.roles), ...diffChannels(before.channels, after.channels)];

        return successResponse(`Compared ${beforeBackupId} to ${afterBackupId}.`, {
          beforeBackupId,
          afterBackupId,
          operations,
          summary: operationSummary(operations),
        });
      } catch (error) {
        return errorResponse("Failed to diff Discord backups.", {
          beforeBackupId,
          afterBackupId,
          error: errorMessage(error),
        });
      }
    },
  );

  server.registerTool(
    "discord_backup_restore_plan",
    {
      title: "Plan Discord Backup Restore",
      description:
        "Create a non-mutating restore plan that compares the live guild to a stored backup.",
      inputSchema: {
        backupId: z.string().min(1).describe("Backup snapshot to restore toward."),
        targetGuildId: z.string().min(1).describe("Live Discord guild ID to compare against the backup."),
      },
      outputSchema: {
        plan: z.unknown(),
        summary: summarySchema(),
        safetyMessage: z.string(),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ backupId, targetGuildId }) => {
      try {
        const desired = await readSnapshot(config.backupDir, backupId);
        const currentGuild = await discord.getGuild(targetGuildId);
        const current = await createSnapshot(currentGuild);
        const operations = [
          ...diffRoles(current.roles, desired.roles),
          ...diffChannels(current.channels, desired.channels),
        ];
        const warnings = restoreWarnings(desired.guild.id, targetGuildId);
        const plan: RestorePlan = {
          schemaVersion,
          sourceBackupId: backupId,
          targetGuildId,
          operations,
          warnings,
          idMap: {},
        };
        const safetyMessage =
          "Review this plan before calling discord_backup_restore_apply. Apply is conservative and creates a pre-restore backup first.";

        return successResponse(`Created restore plan from ${backupId} for guild ${targetGuildId}.`, {
          plan,
          summary: operationSummary(operations),
          safetyMessage,
        });
      } catch (error) {
        return errorResponse("Failed to create Discord restore plan.", {
          backupId,
          targetGuildId,
          error: errorMessage(error),
        });
      }
    },
  );

  server.registerTool(
    "discord_backup_restore_apply",
    {
      title: "Apply Discord Backup Restore",
      description:
        "Conservatively apply role/channel create/update operations from a backup. Creates a pre-restore backup first. Deletes require includeDeletes: true.",
      inputSchema: {
        backupId: z.string().min(1),
        targetGuildId: z.string().min(1),
        confirm: z.boolean().optional(),
        reason: z.string().min(1).optional(),
        includeDeletes: z.boolean().optional(),
        allowCrossGuild: z.boolean().optional(),
      },
      outputSchema: {
        preRestoreBackupId: z.string(),
        sourceBackupId: z.string(),
        targetGuildId: z.string(),
        applied: z.array(z.unknown()),
        skipped: z.array(z.unknown()),
        warnings: z.array(z.unknown()),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (input) => {
      try {
        requireConfirmation(input);
        const desired = await readSnapshot(config.backupDir, input.backupId);
        if (desired.guild.id !== input.targetGuildId && input.allowCrossGuild !== true) {
          throw new Error(
            `Backup guild mismatch: backup is for ${desired.guild.id}; target is ${input.targetGuildId}. Set allowCrossGuild: true to intentionally clone structure across guilds.`,
          );
        }

        const guild = await discord.getGuild(input.targetGuildId);
        const beforeApply = await createSnapshot(guild);
        const preRestoreBackupId = await writeSnapshot(
          config.backupDir,
          beforeApply,
          new Date(beforeApply.capturedAt),
        );
        const operations = [
          ...diffRoles(beforeApply.roles, desired.roles),
          ...diffChannels(beforeApply.channels, desired.channels),
        ];
        const result = await applyRestoreOperations(guild, desired, operations, {
          includeDeletes: input.includeDeletes === true,
          reason: input.reason!,
        });

        return successResponse("Restore apply completed with conservative safeguards.", {
          preRestoreBackupId,
          sourceBackupId: input.backupId,
          targetGuildId: guild.id,
          applied: result.applied,
          skipped: result.skipped,
          warnings: [
            ...(desired.warnings ?? []).map((warning) => ({
              code: "SOURCE_BACKUP_WARNING",
              ...warning,
            })),
            {
              code: "LOSSY_RESTORE_LIMITS",
              message:
                "Discord cannot preserve recreated IDs, message history, invite codes, webhook tokens, or managed integration objects.",
            },
          ],
        });
      } catch (error) {
        return errorResponse("Failed to apply Discord restore.", {
          backupId: input.backupId,
          targetGuildId: input.targetGuildId,
          error: errorMessage(error),
        });
      }
    },
  );
}

function restoreWarnings(sourceGuildId: string, targetGuildId: string): RestoreWarning[] {
  const warnings: RestoreWarning[] = [
    {
      code: "LOSSY_RESTORE_LIMITS",
      message:
        "Discord cannot preserve recreated object IDs, message history, invite codes, webhook tokens, or every guild setting.",
    },
  ];

  if (sourceGuildId !== targetGuildId) {
    warnings.push({
      code: "GUILD_ID_MISMATCH",
      message: `Backup was captured from guild ${sourceGuildId}, but target guild is ${targetGuildId}.`,
      resource: "guild",
    });
  }

  return warnings;
}

async function applyRestoreOperations(
  guild: Guild,
  desired: Snapshot,
  operations: RestoreOperation[],
  options: { includeDeletes: boolean; reason: string },
): Promise<{ applied: unknown[]; skipped: unknown[] }> {
  const applied: unknown[] = [];
  const skipped: unknown[] = [];
  const roleIdByKey = new Map(desired.roles.map((role) => [role.key, role.id]));
  const channelIdByKey = new Map(desired.channels.map((channel) => [channel.key, channel.id]));

  for (const role of await guild.roles.fetch().then((roles) => [...roles.values()])) {
    const matching = desired.roles.find((snapshot) => snapshot.id === role.id || snapshot.name === role.name);
    if (matching) {
      roleIdByKey.set(matching.key, role.id);
    }
  }

  for (const channel of await guild.channels.fetch().then((channels) => [...channels.values()])) {
    if (!channel) {
      continue;
    }
    const matching = desired.channels.find((snapshot) => snapshot.id === channel.id || snapshot.name === channel.name);
    if (matching) {
      channelIdByKey.set(matching.key, channel.id);
    }
  }

  for (const operation of operations.filter((item) => item.resource === "role")) {
    const result = await applyRoleOperation(guild, operation, options);
    (result.applied ? applied : skipped).push(result.detail);
    if (result.key && result.id) {
      roleIdByKey.set(result.key, result.id);
    }
  }

  const channelOperations = operations.filter((item) => item.resource === "channel");
  const sortedChannelOperations = [
    ...channelOperations.filter((item) => operationChannelType(item) === ChannelType.GuildCategory),
    ...channelOperations.filter((item) => operationChannelType(item) !== ChannelType.GuildCategory),
  ];

  for (const operation of sortedChannelOperations) {
    const result = await applyChannelOperation(guild, operation, channelIdByKey, options);
    (result.applied ? applied : skipped).push(result.detail);
    if (result.key && result.id) {
      channelIdByKey.set(result.key, result.id);
    }
  }

  return { applied, skipped };
}

async function applyRoleOperation(
  guild: Guild,
  operation: RestoreOperation,
  options: { includeDeletes: boolean; reason: string },
): Promise<{ applied: boolean; detail: unknown; key?: string; id?: string }> {
  if (operation.type === "skip") {
    return { applied: false, detail: operation };
  }

  if (operation.type === "delete" && !options.includeDeletes) {
    return {
      applied: false,
      detail: { ...operation, reason: "delete skipped because includeDeletes is false" },
    };
  }

  const desiredRole = operation.type === "delete" ? undefined : asRoleSnapshot(operation.after);
  const beforeRole = operation.type === "create" ? undefined : asRoleSnapshot(operation.before);
  const roleId = beforeRole?.id ?? desiredRole?.id;
  const role = roleId ? await guild.roles.fetch(roleId).catch(() => null) : null;

  if (operation.type === "delete") {
    if (!role || role.id === guild.id || role.managed || !role.editable) {
      return { applied: false, detail: { ...operation, reason: "role missing, managed, @everyone, or not editable" } };
    }
    await role.delete(options.reason);
    return { applied: true, detail: operation };
  }

  if (!desiredRole || desiredRole.name === "@everyone") {
    return { applied: false, detail: { ...operation, reason: "@everyone restore is skipped for safety" } };
  }

  const roleOptions = {
    name: desiredRole.name,
    color: desiredRole.color,
    hoist: desiredRole.hoist,
    mentionable: desiredRole.mentionable,
    permissions: new PermissionsBitField(BigInt(desiredRole.permissions)),
    reason: options.reason,
  };

  if (operation.type === "create" || !role) {
    if (desiredRole.managed) {
      return { applied: false, detail: { ...operation, reason: "managed role cannot be recreated" } };
    }
    const created = await guild.roles.create(roleOptions);
    return { applied: true, detail: operation, key: desiredRole.key, id: created.id };
  }

  if (role.managed || !role.editable) {
    return { applied: false, detail: { ...operation, reason: "role managed or not editable" } };
  }

  const updated = await role.edit(roleOptions);
  return { applied: true, detail: operation, key: desiredRole.key, id: updated.id };
}

async function applyChannelOperation(
  guild: Guild,
  operation: RestoreOperation,
  channelIdByKey: Map<string, string>,
  options: { includeDeletes: boolean; reason: string },
): Promise<{ applied: boolean; detail: unknown; key?: string; id?: string }> {
  if (operation.type === "skip") {
    return { applied: false, detail: operation };
  }

  if (operation.type === "delete" && !options.includeDeletes) {
    return {
      applied: false,
      detail: { ...operation, reason: "delete skipped because includeDeletes is false" },
    };
  }

  const desiredChannel = operation.type === "delete" ? undefined : asChannelSnapshot(operation.after);
  const beforeChannel = operation.type === "create" ? undefined : asChannelSnapshot(operation.before);
  const channelId = beforeChannel?.id ?? desiredChannel?.id;
  const channel = channelId ? await guild.channels.fetch(channelId).catch(() => null) : null;

  if (operation.type === "delete") {
    if (!channel || !("delete" in channel) || typeof channel.delete !== "function") {
      return { applied: false, detail: { ...operation, reason: "channel missing or cannot be deleted" } };
    }
    await channel.delete(options.reason);
    return { applied: true, detail: operation };
  }

  if (!desiredChannel) {
    return { applied: false, detail: { ...operation, reason: "missing desired channel payload" } };
  }

  const parent = desiredChannel.parentKey ? channelIdByKey.get(desiredChannel.parentKey) : undefined;
  const channelOptions: Record<string, unknown> = {
    name: desiredChannel.name,
    type: desiredChannel.type as ChannelType,
    parent,
    topic: desiredChannel.topic ?? undefined,
    nsfw: desiredChannel.nsfw,
    rateLimitPerUser: desiredChannel.rateLimitPerUser ?? undefined,
    reason: options.reason,
  };

  if (operation.type === "create" || !channel) {
    const created = await guild.channels.create(channelOptions as unknown as Parameters<typeof guild.channels.create>[0]);
    return { applied: true, detail: operation, key: desiredChannel.key, id: created.id };
  }

  if (!("edit" in channel) || typeof channel.edit !== "function") {
    return { applied: false, detail: { ...operation, reason: "channel cannot be edited" } };
  }

  const updated = await channel.edit(channelOptions as Parameters<typeof channel.edit>[0]);
  return { applied: true, detail: operation, key: desiredChannel.key, id: updated.id };
}

function asRoleSnapshot(value: unknown): RoleSnapshot {
  return value as RoleSnapshot;
}

function asChannelSnapshot(value: unknown): ChannelSnapshot {
  return value as ChannelSnapshot;
}

function operationChannelType(operation: RestoreOperation): number | undefined {
  if (operation.type === "create" || operation.type === "update") {
    return asChannelSnapshot(operation.after).type;
  }
  if (operation.type === "delete") {
    return asChannelSnapshot(operation.before).type;
  }
  return undefined;
}

function countsSchema() {
  return z.object({
    roles: z.number(),
    channels: z.number(),
    autoModRules: z.number(),
    scheduledEvents: z.number(),
    webhooks: z.number(),
    invites: z.number(),
    emojis: z.number(),
    stickers: z.number(),
    applicationCommands: z.number(),
  });
}

function summarySchema() {
  return z.object({
    create: z.number(),
    update: z.number(),
    delete: z.number(),
    skip: z.number(),
    total: z.number(),
  });
}

function snapshotCounts(snapshot: {
  roles: unknown[];
  channels: unknown[];
  autoModRules: unknown[];
  scheduledEvents: unknown[];
  webhooks?: unknown[];
  invites?: unknown[];
  emojis?: unknown[];
  stickers?: unknown[];
  applicationCommands?: unknown[];
}) {
  return {
    roles: snapshot.roles.length,
    channels: snapshot.channels.length,
    autoModRules: snapshot.autoModRules.length,
    scheduledEvents: snapshot.scheduledEvents.length,
    webhooks: snapshot.webhooks?.length ?? 0,
    invites: snapshot.invites?.length ?? 0,
    emojis: snapshot.emojis?.length ?? 0,
    stickers: snapshot.stickers?.length ?? 0,
    applicationCommands: snapshot.applicationCommands?.length ?? 0,
  };
}

function operationSummary(operations: { type: string }[]) {
  const summary = { create: 0, update: 0, delete: 0, skip: 0, total: operations.length };

  for (const operation of operations) {
    if (operation.type in summary && operation.type !== "total") {
      summary[operation.type as "create" | "update" | "delete" | "skip"] += 1;
    }
  }

  return summary;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}
