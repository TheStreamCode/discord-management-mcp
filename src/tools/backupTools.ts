import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  ChannelType,
  OverwriteType,
  PermissionsBitField,
  type Guild,
  type GuildChannelCreateOptions,
  type RoleCreateOptions,
  type RoleEditOptions,
} from "discord.js";
import { z } from "zod";
import { diffChannels, diffRoles } from "../backup/diff.js";
import {
  computeRestorePlanHash,
  schemaVersion,
  type ChannelSnapshot,
  type IdMap,
  type PermissionOverwriteSnapshot,
  type RestoreOperation,
  type RestorePlan,
  type RestoreWarning,
  type RoleSnapshot,
  type Snapshot,
} from "../backup/schema.js";
import { createSnapshot } from "../backup/snapshot.js";
import {
  backupDirectoryExists,
  listBackups,
  readSnapshot,
  writeSnapshot,
} from "../backup/store.js";
import { assertBackupDirInsideProject, type ServerConfig } from "../config.js";
import type { DiscordClientManager } from "../discordClient.js";
import { safeErrorMessage } from "../errors.js";
import { withExclusiveMutation, withMutationQueue } from "../mutationQueue.js";
import { errorResponse, successResponse } from "../responses.js";
import { requireConfirmation } from "../safety.js";
import {
  additiveDiscordAnnotations,
  destructiveDiscordAnnotations,
  localReadOnlyAnnotations,
  readOnlyDiscordAnnotations,
} from "../toolAnnotations.js";
import { defaultOutputToolRegistrar } from "../toolRegistration.js";
import { auditReasonSchema, backupIdInputSchema, discordSnowflakeSchema } from "../toolSchemas.js";

const snapshotCountsSchema = z.object({
  roles: z.number().int(),
  channels: z.number().int(),
  autoModRules: z.number().int(),
  scheduledEvents: z.number().int(),
  webhooks: z.number().int(),
  invites: z.number().int(),
  emojis: z.number().int(),
  stickers: z.number().int(),
  applicationCommands: z.number().int(),
});

const channelCoverageSchema = z.object({
  fetched: z.number().int(),
  cacheSize: z.number().int(),
  hiddenKeys: z.array(z.string()),
  complete: z.boolean(),
});

const snapshotCoverageSchema = z.object({
  channels: channelCoverageSchema,
});

const snapshotWarningSchema = z.object({
  section: z.string(),
  message: z.string(),
});

const restoreWarningSchema = z.object({
  code: z.string(),
  message: z.string(),
  resource: z.string().optional(),
  key: z.string().optional(),
  section: z.string().optional(),
});

const restoreOperationSchema = z.object({
  type: z.enum(["create", "update", "delete", "skip"]),
  resource: z.enum(["guild", "role", "channel", "permissionOverwrite", "autoModRule", "scheduledEvent"]),
  key: z.string(),
  before: z.unknown().optional(),
  after: z.unknown().optional(),
  changes: z.array(z.string()).optional(),
  reason: z.string().optional(),
});

const restorePlanSchema = z.object({
  schemaVersion: z.number().int(),
  sourceBackupId: z.string(),
  targetGuildId: z.string(),
  operations: z.array(restoreOperationSchema),
  warnings: z.array(restoreWarningSchema),
  idMap: z.record(z.string(), z.string()),
  planHash: z.string(),
});

const operationSummarySchema = z.object({
  create: z.number().int(),
  update: z.number().int(),
  delete: z.number().int(),
  skip: z.number().int(),
  total: z.number().int(),
});

const backupCreateOutputSchema = z.object({
  ok: z.boolean(),
  backupId: z.string().optional(),
  guildId: z.string().optional(),
  capturedAt: z.string().optional(),
  counts: snapshotCountsSchema.optional(),
  warnings: z.array(snapshotWarningSchema).optional(),
  coverage: snapshotCoverageSchema.optional(),
  error: z.string().optional(),
});

const backupListOutputSchema = z.object({
  ok: z.boolean(),
  backupIds: z.array(z.string()).optional(),
  count: z.number().int().optional(),
  backupDirectoryExists: z.boolean().optional(),
  note: z.string().optional(),
  error: z.string().optional(),
});

const backupReadOutputSchema = z.object({
  ok: z.boolean(),
  backupId: z.string().optional(),
  guildId: z.string().optional(),
  guildName: z.string().optional(),
  capturedAt: z.string().optional(),
  counts: snapshotCountsSchema.optional(),
  warnings: z.array(snapshotWarningSchema).optional(),
  coverage: snapshotCoverageSchema.optional(),
  snapshotReturned: z.boolean().optional(),
  note: z.string().optional(),
  error: z.string().optional(),
});

const backupDiffOutputSchema = z.object({
  ok: z.boolean(),
  beforeBackupId: z.string().optional(),
  afterBackupId: z.string().optional(),
  operations: z.array(restoreOperationSchema).optional(),
  summary: operationSummarySchema.optional(),
  error: z.string().optional(),
});

const restorePlanOutputSchema = z.object({
  ok: z.boolean(),
  plan: restorePlanSchema.optional(),
  summary: operationSummarySchema.optional(),
  safetyMessage: z.string().optional(),
  backupId: z.string().optional(),
  targetGuildId: z.string().optional(),
  error: z.string().optional(),
});

const restoreApplyOutputSchema = z.object({
  ok: z.boolean(),
  preRestoreBackupId: z.string().nullable().optional(),
  sourceBackupId: z.string().optional(),
  targetGuildId: z.string().optional(),
  applied: z.array(z.unknown()).optional(),
  skipped: z.array(z.unknown()).optional(),
  failed: z.unknown().optional(),
  warnings: z.array(restoreWarningSchema).optional(),
  expectedPlanHash: z.string().optional(),
  actualPlanHash: z.string().optional(),
  error: z.string().optional(),
});

export function registerBackupTools(
  server: McpServer,
  discord: DiscordClientManager,
  config: ServerConfig,
): void {
  const registerTool = withMutationQueue(defaultOutputToolRegistrar(server));

  registerTool(
    "discord_backup_create",
    {
      title: "Create Discord Backup",
      description: "Capture the current Discord guild configuration as a JSON backup snapshot.",
      inputSchema: {
        guildId: discordSnowflakeSchema.describe("Discord guild ID to snapshot."),
      },
      outputSchema: backupCreateOutputSchema,
      annotations: additiveDiscordAnnotations,
    },
    async ({ guildId }) => {
      try {
        assertBackupDirInsideProject(config.projectRoot, config.backupDir);
        const guild = await discord.getGuild(guildId);
        const snapshot = await createSnapshot(guild);
        // Re-check after the Discord round trips: a junction created while the
        // snapshot was being captured must not redirect the write.
        assertBackupDirInsideProject(config.projectRoot, config.backupDir);
        const backupId = await writeSnapshot(config.backupDir, snapshot, new Date(snapshot.capturedAt));

        return successResponse(`Created backup ${backupId} for guild ${snapshot.guild.name}.`, {
          backupId,
          guildId: snapshot.guild.id,
          capturedAt: snapshot.capturedAt,
          counts: snapshotCounts(snapshot),
          warnings: snapshot.warnings ?? [],
          coverage: snapshot.coverage,
        });
      } catch (error) {
        return errorResponse("Failed to create Discord backup.", {
          error: safeErrorMessage(error),
        });
      }
    },
  );

  registerTool(
    "discord_backup_list",
    {
      title: "List Discord Backups",
      description: "List stored Discord backup snapshot IDs, newest first.",
      inputSchema: {},
      outputSchema: backupListOutputSchema,
      annotations: localReadOnlyAnnotations,
    },
    async () => {
      try {
        assertBackupDirInsideProject(config.projectRoot, config.backupDir);
        if (!(await backupDirectoryExists(config.backupDir))) {
          return successResponse("No Discord backup directory exists yet.", {
            backupIds: [],
            count: 0,
            backupDirectoryExists: false,
            note: "The configured BACKUP_DIR does not exist yet. Run discord_backup_create to create the first backup.",
          });
        }

        const backupIds = await listBackups(config.backupDir);

        return successResponse(`Found ${backupIds.length} Discord backup(s).`, {
          backupIds,
          count: backupIds.length,
          backupDirectoryExists: true,
        });
      } catch (error) {
        return errorResponse("Failed to list Discord backups.", {
          backupIds: [],
          count: 0,
          backupDirectoryExists: false,
          error: safeErrorMessage(error),
        });
      }
    },
  );

  registerTool(
    "discord_backup_read",
    {
      title: "Read Discord Backup",
      description: "Validate a stored Discord backup and return sanitized metadata without exposing its payload.",
      inputSchema: {
        backupId: backupIdInputSchema.describe("Backup file ID returned by discord_backup_list or create."),
      },
      outputSchema: backupReadOutputSchema,
      annotations: localReadOnlyAnnotations,
    },
    async ({ backupId }) => {
      try {
        assertBackupDirInsideProject(config.projectRoot, config.backupDir);
        const snapshot = await readSnapshot(config.backupDir, backupId);

        return successResponse(`Read backup ${backupId}.`, {
          backupId,
          guildId: snapshot.guild.id,
          guildName: snapshot.guild.name,
          capturedAt: snapshot.capturedAt,
          counts: snapshotCounts(snapshot),
          warnings: snapshot.warnings ?? [],
          coverage: snapshot.coverage,
          snapshotReturned: false,
          note: "The backup payload remains local and is intentionally not returned by this tool.",
        });
      } catch (error) {
        return errorResponse(`Failed to read backup ${backupId}.`, {
          backupId,
          error: safeErrorMessage(error),
        });
      }
    },
  );

  registerTool(
    "discord_backup_diff",
    {
      title: "Diff Discord Backups",
      description: "Compare roles and channels between two stored backup snapshots.",
      inputSchema: {
        beforeBackupId: backupIdInputSchema.describe("Older or source backup ID."),
        afterBackupId: backupIdInputSchema.describe("Newer or target backup ID."),
      },
      outputSchema: backupDiffOutputSchema,
      annotations: localReadOnlyAnnotations,
    },
    async ({ beforeBackupId, afterBackupId }) => {
      try {
        assertBackupDirInsideProject(config.projectRoot, config.backupDir);
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
          error: safeErrorMessage(error),
        });
      }
    },
  );

  registerTool(
    "discord_backup_restore_plan",
    {
      title: "Plan Discord Backup Restore",
      description:
        "Create a non-mutating restore plan that compares the live guild to a stored backup and includes a stable planHash.",
      inputSchema: {
        backupId: backupIdInputSchema.describe("Backup snapshot to restore toward."),
        targetGuildId: discordSnowflakeSchema.describe("Live Discord guild ID to compare against the backup."),
      },
      outputSchema: restorePlanOutputSchema,
      annotations: readOnlyDiscordAnnotations,
    },
    async ({ backupId, targetGuildId }) => {
      try {
        assertBackupDirInsideProject(config.projectRoot, config.backupDir);
        const desired = await readSnapshot(config.backupDir, backupId);
        const currentGuild = await discord.getGuild(targetGuildId);
        const current = await createSnapshot(currentGuild);
        // Hash over the resolved guild ID so a non-canonical input cannot make
        // the plan tool and restore apply disagree on an otherwise equal plan.
        const plan = buildRestorePlan(backupId, currentGuild.id, desired, current);
        const safetyMessage =
          "Review this plan and its planHash before calling discord_backup_restore_apply with expectedPlanHash. Apply is conservative and creates a pre-restore backup first.";

        return successResponse(`Created restore plan from ${backupId} for guild ${targetGuildId}.`, {
          plan,
          summary: operationSummary(plan.operations),
          safetyMessage,
        });
      } catch (error) {
        return errorResponse("Failed to create Discord restore plan.", {
          backupId,
          targetGuildId,
          error: safeErrorMessage(error),
        });
      }
    },
  );

  registerTool(
    "discord_backup_restore_apply",
    {
      title: "Apply Discord Backup Restore",
      description:
        "Conservatively apply role/channel create/update operations from a backup. Creates a pre-restore backup first, rejects an expectedPlanHash mismatch before mutating, and deletes require includeDeletes: true.",
      inputSchema: {
        backupId: backupIdInputSchema,
        targetGuildId: discordSnowflakeSchema,
        expectedPlanHash: z.string().regex(/^[a-f0-9]{64}$/, "expected a sha256 hex digest").optional(),
        confirm: z.boolean().optional(),
        reason: auditReasonSchema,
        includeDeletes: z.boolean().optional(),
        allowCrossGuild: z.boolean().optional(),
      },
      outputSchema: restoreApplyOutputSchema,
      annotations: destructiveDiscordAnnotations,
    },
    withExclusiveMutation(async (input: {
      backupId: string;
      targetGuildId: string;
      expectedPlanHash?: string;
      confirm?: boolean;
      reason?: string;
      includeDeletes?: boolean;
      allowCrossGuild?: boolean;
    }) => {
      let preRestoreBackupId: string | null = null;
      let warnings: RestoreWarning[] = [];
      let applied: unknown[] = [];
      let skipped: unknown[] = [];

      try {
        assertBackupDirInsideProject(config.projectRoot, config.backupDir);
        requireConfirmation(input);
        const desired = await readSnapshot(config.backupDir, input.backupId);
        if (desired.guild.id !== input.targetGuildId && input.allowCrossGuild !== true) {
          throw new Error(
            `Backup guild mismatch: backup is for ${desired.guild.id}; target is ${input.targetGuildId}. Set allowCrossGuild: true to intentionally clone structure across guilds.`,
          );
        }

        const guild = await discord.getGuild(input.targetGuildId);
        const current = await createSnapshot(guild);
        // Re-check after the Discord round trips: a junction created while the
        // live snapshot was captured must not redirect the pre-restore backup.
        assertBackupDirInsideProject(config.projectRoot, config.backupDir);
        preRestoreBackupId = await writeSnapshot(
          config.backupDir,
          current,
          new Date(current.capturedAt),
        );
        const plan = buildRestorePlan(input.backupId, guild.id, desired, current);
        warnings = plan.warnings;

        if (input.expectedPlanHash !== undefined && input.expectedPlanHash !== plan.planHash) {
          return errorResponse("Restore plan hash mismatch; no Discord changes were applied.", {
            preRestoreBackupId,
            sourceBackupId: input.backupId,
            targetGuildId: guild.id,
            applied: [],
            skipped: [],
            failed: null,
            warnings,
            expectedPlanHash: input.expectedPlanHash,
            actualPlanHash: plan.planHash,
            error: `Restore plan drift detected: expected ${input.expectedPlanHash} but the freshly computed plan is ${plan.planHash}. Re-run discord_backup_restore_plan and review the new plan before applying.`,
          });
        }

        const result = await applyRestoreOperations(guild, desired, plan.operations, {
          includeDeletes: input.includeDeletes === true,
          reason: input.reason ?? "restore apply",
        });
        applied = result.applied;
        skipped = result.skipped;

        const restoreDetails = {
          preRestoreBackupId,
          sourceBackupId: input.backupId,
          targetGuildId: guild.id,
          applied,
          skipped,
          failed: result.failed ?? null,
          warnings,
        };

        if (result.failed) {
          return errorResponse("Restore stopped after an operation failed; partial progress is reported.", restoreDetails);
        }

        return successResponse("Restore apply completed with conservative safeguards.", restoreDetails);
      } catch (error) {
        return errorResponse("Failed to apply Discord restore.", {
          preRestoreBackupId,
          sourceBackupId: input.backupId,
          targetGuildId: input.targetGuildId,
          applied,
          skipped,
          failed: null,
          warnings: warnings.length > 0
            ? warnings
            : [{
                code: "NOT_RESTORED",
                message: "Restore did not reach the apply stage; this call applied no Discord changes.",
              }],
          error: safeErrorMessage(error),
        });
      }
    }),
  );
}

interface RestorePlanContext {
  sourceBackupId: string;
  targetGuildId: string;
  operations: RestoreOperation[];
  warnings: RestoreWarning[];
  idMap: IdMap;
}

function buildRestorePlan(
  backupId: string,
  targetGuildId: string,
  desired: Snapshot,
  current: Snapshot,
): RestorePlan {
  const operations = [
    ...diffRoles(current.roles, desired.roles),
    ...diffChannels(current.channels, desired.channels),
  ];
  const warnings = dedupeWarnings([
    ...restoreWarnings(desired.guild.id, targetGuildId),
    ...sourceBackupWarnings(desired),
    ...notRestoredWarnings(desired),
  ]);
  const idMap = buildIdMap(desired, current);

  const plan: RestorePlanContext = {
    sourceBackupId: backupId,
    targetGuildId,
    operations,
    warnings,
    idMap,
  };
  const planHash = computeRestorePlanHash(plan);

  return {
    schemaVersion,
    sourceBackupId: backupId,
    targetGuildId,
    operations,
    warnings,
    idMap,
    planHash,
  };
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

function sourceBackupWarnings(snapshot: Snapshot): RestoreWarning[] {
  return (snapshot.warnings ?? []).map((warning) => ({
    code: "SOURCE_BACKUP_WARNING",
    message: `${warning.section}: ${warning.message}`,
  }));
}

function notRestoredWarnings(snapshot: Snapshot): RestoreWarning[] {
  const warnings: RestoreWarning[] = [
    {
      code: "NOT_RESTORED",
      resource: "guild",
      message: "Guild settings (name, icon, moderation levels, locale, AFK settings) were captured but are not applied by this conservative restore.",
    },
  ];

  if (snapshot.autoModRules.length > 0) {
    warnings.push({
      code: "NOT_RESTORED",
      message: `${snapshot.autoModRules.length} AutoMod rule(s) were captured but are not restored; recreate them with the AutoMod tools.`,
    });
  }
  if (snapshot.scheduledEvents.length > 0) {
    warnings.push({
      code: "NOT_RESTORED",
      message: `${snapshot.scheduledEvents.length} scheduled event(s) were captured but are not restored; recreate them manually.`,
    });
  }

  const sections: Array<[string, number]> = [
    ["webhook", snapshot.webhooks?.length ?? 0],
    ["invite", snapshot.invites?.length ?? 0],
    ["emoji", snapshot.emojis?.length ?? 0],
    ["sticker", snapshot.stickers?.length ?? 0],
    ["application command", snapshot.applicationCommands?.length ?? 0],
  ];
  for (const [section, count] of sections) {
    if (count > 0) {
      warnings.push({
        code: "NOT_RESTORED",
        message: `${count} ${section}(s) were captured but are not restored by this conservative restore.`,
      });
    }
  }

  const roleIcons = snapshot.roles.filter((role) => typeof role.icon === "string" && role.icon.length > 0).length;
  if (roleIcons > 0) {
    warnings.push({
      code: "NOT_RESTORED",
      resource: "role",
      message: `${roleIcons} role icon(s) were captured, but Discord role icons cannot be recreated from a stored hash; set them manually.`,
    });
  }

  return warnings;
}

function dedupeWarnings(warnings: RestoreWarning[]): RestoreWarning[] {
  const seen = new Set<string>();
  const deduped: RestoreWarning[] = [];

  for (const warning of warnings) {
    const key = `${warning.code}:${warning.message}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(warning);
  }

  return deduped;
}

function buildIdMap(desired: Snapshot, current: Snapshot): IdMap {
  const idMap: IdMap = {};

  for (const role of desired.roles) {
    const exact = current.roles.find((candidate) => candidate.id === role.id);
    const nameMatches = current.roles.filter((candidate) => candidate.name === role.name);
    const match = exact ?? (nameMatches.length === 1 ? nameMatches[0] : undefined);
    if (match) {
      idMap[role.key] = match.id;
    }
  }

  for (const channel of desired.channels) {
    const exact = current.channels.find((candidate) => candidate.id === channel.id);
    const nameMatches = current.channels.filter(
      (candidate) => candidate.name === channel.name && candidate.type === channel.type,
    );
    const match = exact ?? (nameMatches.length === 1 ? nameMatches[0] : undefined);
    if (match) {
      idMap[channel.key] = match.id;
    }
  }

  return idMap;
}

export async function applyRestoreOperations(
  guild: Guild,
  desired: Snapshot,
  operations: RestoreOperation[],
  options: { includeDeletes: boolean; reason: string },
): Promise<{
  applied: unknown[];
  skipped: unknown[];
  failed?: { operation: RestoreOperation; error: string };
}> {
  const applied: unknown[] = [];
  const skipped: unknown[] = [];
  const roleIdByKey = new Map<string, string>();
  const channelIdByKey = new Map<string, string>();
  const liveRoles = await guild.roles.fetch().then((roles) => [...roles.values()]);
  const liveChannels = await guild.channels.fetch().then((channels) =>
    [...channels.values()].filter((channel) => channel !== null),
  );
  const knownRoleIds = new Set(liveRoles.map((role) => role.id));
  knownRoleIds.add(guild.id);

  for (const snapshot of desired.roles) {
    const exact = liveRoles.find((role) => role.id === snapshot.id);
    const nameMatches = liveRoles.filter((role) => role.name === snapshot.name);
    const matching = exact ?? (nameMatches.length === 1 ? nameMatches[0] : undefined);
    if (matching) {
      roleIdByKey.set(snapshot.key, matching.id);
    }
  }

  for (const snapshot of desired.channels) {
    const exact = liveChannels.find((channel) => channel.id === snapshot.id);
    const nameMatches = liveChannels.filter(
      (channel) => channel.name === snapshot.name && channel.type === snapshot.type,
    );
    const matching = exact ?? (nameMatches.length === 1 ? nameMatches[0] : undefined);
    if (matching) {
      channelIdByKey.set(snapshot.key, matching.id);
    }
  }

  for (const operation of operations.filter((item) => item.resource === "role")) {
    let result: Awaited<ReturnType<typeof applyRoleOperation>>;
    try {
      result = await applyRoleOperation(guild, operation, options);
    } catch (error) {
      return {
        applied,
        skipped,
        failed: { operation, error: safeErrorMessage(error) },
      };
    }
    (result.applied ? applied : skipped).push(result.detail);
    if (result.key && result.id) {
      roleIdByKey.set(result.key, result.id);
      knownRoleIds.add(result.id);
    }
  }

  const channelOperations = operations.filter((item) => item.resource === "channel");
  const sortedChannelOperations = [
    ...channelOperations.filter((item) => operationChannelType(item) === ChannelType.GuildCategory),
    ...channelOperations.filter((item) => operationChannelType(item) !== ChannelType.GuildCategory),
  ];

  for (const operation of sortedChannelOperations) {
    let result: Awaited<ReturnType<typeof applyChannelOperation>>;
    try {
      result = await applyChannelOperation(
        guild,
        operation,
        channelIdByKey,
        roleIdByKey,
        knownRoleIds,
        desired.guild.id !== guild.id,
        options,
      );
    } catch (error) {
      return {
        applied,
        skipped,
        failed: { operation, error: safeErrorMessage(error) },
      };
    }
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

  const warnings: string[] = [];
  const roleOptions: RoleEditOptions = {
    name: desiredRole.name,
    hoist: desiredRole.hoist,
    mentionable: desiredRole.mentionable,
    permissions: new PermissionsBitField(BigInt(desiredRole.permissions)),
    position: desiredRole.position,
    // A missing unicodeEmoji in a legacy backup is unknown, not "clear it".
    ...(desiredRole.unicodeEmoji === undefined ? {} : { unicodeEmoji: desiredRole.unicodeEmoji }),
    reason: options.reason,
  };

  if (desiredRole.colors) {
    roleOptions.colors = {
      primaryColor: desiredRole.colors.primary ?? 0,
      secondaryColor: desiredRole.colors.secondary,
      tertiaryColor: desiredRole.colors.tertiary,
    };
  } else {
    // Legacy v1 snapshots only carry the deprecated single color field.
    roleOptions.colors = { primaryColor: desiredRole.color };
  }

  if (typeof desiredRole.icon === "string" && desiredRole.icon.length > 0) {
    warnings.push(
      `Role icon ${desiredRole.icon} cannot be recreated from backup data (Discord stores only a hash); set it manually.`,
    );
  }

  const detail = warnings.length === 0 ? operation : { ...operation, warnings };

  if (operation.type === "create" || !role) {
    if (desiredRole.managed) {
      return { applied: false, detail: { ...detail, reason: "managed role cannot be recreated" } };
    }
    const created = await guild.roles.create(roleOptions as unknown as RoleCreateOptions);
    return { applied: true, detail, key: desiredRole.key, id: created.id };
  }

  if (role.managed || !role.editable) {
    return { applied: false, detail: { ...detail, reason: "role managed or not editable" } };
  }

  const updated = await role.edit(roleOptions);
  return { applied: true, detail, key: desiredRole.key, id: updated.id };
}

async function applyChannelOperation(
  guild: Guild,
  operation: RestoreOperation,
  channelIdByKey: Map<string, string>,
  roleIdByKey: Map<string, string>,
  knownRoleIds: Set<string>,
  crossGuild: boolean,
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

  const parent = desiredChannel.parentKey === null
    ? null
    : channelIdByKey.get(desiredChannel.parentKey);

  if (desiredChannel.parentKey !== null && parent === undefined) {
    return {
      applied: false,
      detail: { ...operation, reason: `parent channel could not be resolved: ${desiredChannel.parentKey}` },
    };
  }

  const restoredOverwrites = await restorePermissionOverwrites(
    guild,
    desiredChannel.permissionOverwrites,
    roleIdByKey,
    knownRoleIds,
    crossGuild,
  );
  const preserveExistingOverwrites =
    operation.type === "update" && restoredOverwrites.mappingBlocked;

  if (preserveExistingOverwrites) {
    restoredOverwrites.warnings.push(
      "Permission overwrites were left unchanged because a partial replacement would remove unmapped targets.",
    );
  }

  const channelOptions: Record<string, unknown> = {
    name: desiredChannel.name,
    parent,
    position: desiredChannel.position,
    topic: desiredChannel.topic ?? undefined,
    nsfw: desiredChannel.nsfw,
    rateLimitPerUser: desiredChannel.rateLimitPerUser ?? undefined,
    bitrate: desiredChannel.bitrate ?? undefined,
    userLimit: desiredChannel.userLimit ?? undefined,
    rtcRegion: desiredChannel.rtcRegion,
    permissionOverwrites: preserveExistingOverwrites ? undefined : restoredOverwrites.values,
    reason: options.reason,
  };
  const detail = restoredOverwrites.warnings.length === 0
    ? operation
    : { ...operation, warnings: restoredOverwrites.warnings };

  if (operation.type === "create" || !channel) {
    channelOptions.type = desiredChannel.type as ChannelType;
    const created = await guild.channels.create(
      channelOptions as unknown as GuildChannelCreateOptions,
    );
    return { applied: true, detail, key: desiredChannel.key, id: created.id };
  }

  if (!("edit" in channel) || typeof channel.edit !== "function") {
    return { applied: false, detail: { ...operation, reason: "channel cannot be edited" } };
  }

  if (channel.type !== desiredChannel.type) {
    const convertibleTypes = new Set([ChannelType.GuildText, ChannelType.GuildAnnouncement]);
    if (!convertibleTypes.has(channel.type) || !convertibleTypes.has(desiredChannel.type)) {
      return {
        applied: false,
        detail: { ...operation, reason: "channel type change is not supported by Discord" },
      };
    }
    channelOptions.type = desiredChannel.type;
  }

  const updated = await channel.edit(channelOptions as Parameters<typeof channel.edit>[0]);
  return { applied: true, detail, key: desiredChannel.key, id: updated.id };
}

async function restorePermissionOverwrites(
  guild: Guild,
  overwrites: PermissionOverwriteSnapshot[],
  roleIdByKey: Map<string, string>,
  knownRoleIds: Set<string>,
  crossGuild: boolean,
): Promise<{
  values: Array<{ id: string; type: OverwriteType; allow: PermissionsBitField; deny: PermissionsBitField }>;
  warnings: string[];
  mappingBlocked: boolean;
}> {
  const values: Array<{
    id: string;
    type: OverwriteType;
    allow: PermissionsBitField;
    deny: PermissionsBitField;
  }> = [];
  const warnings: string[] = [];
  let mappingBlocked = false;

  for (const overwrite of overwrites) {
    let targetId: string | undefined;

    if (overwrite.type === "role") {
      targetId = overwrite.targetKey ? roleIdByKey.get(overwrite.targetKey) : undefined;
      if (!targetId && !crossGuild && knownRoleIds.has(overwrite.id)) {
        targetId = overwrite.id;
      }
      if (!targetId) {
        mappingBlocked = true;
        warnings.push(
          `Skipped role permission overwrite ${overwrite.id}: target role cannot be mapped in the target guild.`,
        );
        continue;
      }
    } else {
      if (crossGuild) {
        mappingBlocked = true;
        warnings.push(
          `Skipped member permission overwrite ${overwrite.id}: member overwrites cannot be mapped across guilds.`,
        );
        continue;
      }

      const member = await guild.members.fetch(overwrite.id).catch(() => null);
      if (!member) {
        warnings.push(
          `Skipped member permission overwrite ${overwrite.id}: member is no longer in the target guild.`,
        );
        continue;
      }
      targetId = member.id;
    }

    values.push({
      id: targetId,
      type: overwrite.type === "role" ? OverwriteType.Role : OverwriteType.Member,
      allow: new PermissionsBitField(BigInt(overwrite.allow)),
      deny: new PermissionsBitField(BigInt(overwrite.deny)),
    });
  }

  return { values, warnings, mappingBlocked };
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
