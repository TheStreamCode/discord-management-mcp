import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  PermissionFlagsBits,
  PermissionsBitField,
  type Role,
  type RoleResolvable,
} from "discord.js";
import { z } from "zod";
import type { ServerConfig } from "../config.js";
import type { DiscordClientManager } from "../discordClient.js";
import { errorResponse, successResponse } from "../responses.js";
import { requireConfirmation, requireDestructiveBackupForGuild } from "../safety.js";

const confirmSchema = {
  confirm: z.boolean().optional(),
  reason: z.string().min(1).optional(),
};

const roleMutationResultSchema = {
  ok: z.boolean(),
  action: z.string(),
  guildId: z.string().optional(),
  roleId: z.string().optional(),
  userId: z.string().optional(),
  name: z.string().optional(),
  updated: z.record(z.string(), z.unknown()).optional(),
  positions: z.array(z.object({ roleId: z.string(), position: z.number() })).optional(),
  error: z.string().optional(),
};

function parsePermissions(permissionNames?: string[]): PermissionsBitField | undefined {
  if (!permissionNames) {
    return undefined;
  }

  return new PermissionsBitField(permissionNames.map((name) => PermissionFlagsBits[name as keyof typeof PermissionFlagsBits]));
}

function isPermissionName(name: string): name is keyof typeof PermissionFlagsBits {
  return Object.hasOwn(PermissionFlagsBits, name);
}

function validatePermissionNames(permissionNames?: string[]): void {
  if (!permissionNames) {
    return;
  }

  const invalid = permissionNames.filter((name) => !isPermissionName(name));
  if (invalid.length > 0) {
    throw new Error(`Invalid Discord permission name(s): ${invalid.join(", ")}`);
  }
}

function compactObject<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Partial<T>;
}

async function requireManageRoles(discord: DiscordClientManager, guildId: string): Promise<void> {
  const guild = await discord.getGuild(guildId);
  const me = await guild.members.fetchMe();
  if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
    throw new Error("Bot requires ManageRoles for role mutations.");
  }
}

async function getEditableRole(discord: DiscordClientManager, guildId: string, roleId: string): Promise<Role> {
  const guild = await discord.getGuild(guildId);
  const role = await guild.roles.fetch(roleId).catch(() => null);
  if (!role) {
    throw new Error(`Discord role not found or inaccessible: ${roleId}`);
  }

  if (role.managed) {
    throw new Error(`Managed integration roles cannot be edited: ${roleId}`);
  }

  if (!role.editable) {
    throw new Error(`Bot cannot edit role due to permissions or hierarchy: ${roleId}`);
  }

  return role;
}

export function registerRoleTools(
  server: McpServer,
  discord: DiscordClientManager,
  config: ServerConfig,
): void {
  server.registerTool(
    "discord_create_role",
    {
      title: "Create Discord role",
      description: "Create a Discord role.",
      inputSchema: {
        guildId: z.string(),
        name: z.string().min(1),
        color: z.number().int().min(0).max(0xffffff).optional(),
        hoist: z.boolean().optional(),
        mentionable: z.boolean().optional(),
        permissions: z.array(z.string()).optional(),
        ...confirmSchema,
      },
      outputSchema: roleMutationResultSchema,
      annotations: { destructiveHint: false, idempotentHint: false },
    },
    async (input) => {
      try {
        requireConfirmation(input);
        validatePermissionNames(input.permissions);
        await requireManageRoles(discord, input.guildId);
        const guild = await discord.getGuild(input.guildId);
        const role = await guild.roles.create({
          name: input.name,
          color: input.color,
          hoist: input.hoist,
          mentionable: input.mentionable,
          permissions: parsePermissions(input.permissions),
          reason: input.reason,
        });

        return successResponse("Role created.", {
          ok: true,
          action: "discord_create_role",
          guildId: guild.id,
          roleId: role.id,
          name: role.name,
        });
      } catch (error) {
        return errorResponse("Failed to create role.", {
          ok: false,
          action: "discord_create_role",
          guildId: input.guildId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  );

  server.registerTool(
    "discord_update_role",
    {
      title: "Update Discord role",
      description: "Update editable Discord role fields.",
      inputSchema: {
        guildId: z.string(),
        roleId: z.string(),
        name: z.string().min(1).optional(),
        color: z.number().int().min(0).max(0xffffff).optional(),
        hoist: z.boolean().optional(),
        mentionable: z.boolean().optional(),
        permissions: z.array(z.string()).optional(),
        ...confirmSchema,
      },
      outputSchema: roleMutationResultSchema,
      annotations: { destructiveHint: true, idempotentHint: false },
    },
    async (input) => {
      try {
        requireConfirmation(input);
        validatePermissionNames(input.permissions);
        const role = await getEditableRole(discord, input.guildId, input.roleId);
        const updates = compactObject({
          name: input.name,
          color: input.color,
          hoist: input.hoist,
          mentionable: input.mentionable,
          permissions: parsePermissions(input.permissions),
          reason: input.reason,
        });

        const updated = await role.edit(updates);
        return successResponse("Role updated.", {
          ok: true,
          action: "discord_update_role",
          guildId: input.guildId,
          roleId: updated.id,
          name: updated.name,
          updated: {
            name: input.name,
            color: input.color,
            hoist: input.hoist,
            mentionable: input.mentionable,
            permissions: input.permissions,
          },
        });
      } catch (error) {
        return errorResponse("Failed to update role.", {
          ok: false,
          action: "discord_update_role",
          guildId: input.guildId,
          roleId: input.roleId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  );

  server.registerTool(
    "discord_delete_role",
    {
      title: "Delete Discord role",
      description: "Delete a Discord role after confirmation and backup acknowledgement.",
      inputSchema: {
        guildId: z.string(),
        roleId: z.string(),
        backupId: z.string().nullable().optional(),
        allowWithoutBackup: z.boolean().optional(),
        ...confirmSchema,
      },
      outputSchema: roleMutationResultSchema,
      annotations: { destructiveHint: true, idempotentHint: false },
    },
    async (input) => {
      try {
        requireConfirmation(input);
        await requireDestructiveBackupForGuild(input, config.backupDir, input.guildId);
        const role = await getEditableRole(discord, input.guildId, input.roleId);
        const roleName = role.name;
        await role.delete(input.reason);

        return successResponse("Role deleted.", {
          ok: true,
          action: "discord_delete_role",
          guildId: input.guildId,
          roleId: input.roleId,
          name: roleName,
        });
      } catch (error) {
        return errorResponse("Failed to delete role.", {
          ok: false,
          action: "discord_delete_role",
          guildId: input.guildId,
          roleId: input.roleId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  );

  server.registerTool(
    "discord_assign_role",
    {
      title: "Assign Discord role",
      description: "Assign a role to a guild member.",
      inputSchema: {
        guildId: z.string(),
        userId: z.string(),
        roleId: z.string(),
        ...confirmSchema,
      },
      outputSchema: roleMutationResultSchema,
      annotations: { destructiveHint: false, idempotentHint: false },
    },
    async (input) => {
      try {
        requireConfirmation(input);
        const role = await getEditableRole(discord, input.guildId, input.roleId);
        const guild = await discord.getGuild(input.guildId);
        const member = await guild.members.fetch(input.userId);
        await member.roles.add(role, input.reason);

        return successResponse("Role assigned.", {
          ok: true,
          action: "discord_assign_role",
          guildId: input.guildId,
          roleId: role.id,
          userId: member.id,
          name: role.name,
        });
      } catch (error) {
        return errorResponse("Failed to assign role.", {
          ok: false,
          action: "discord_assign_role",
          guildId: input.guildId,
          roleId: input.roleId,
          userId: input.userId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  );

  server.registerTool(
    "discord_remove_role",
    {
      title: "Remove Discord role",
      description: "Remove a role from a guild member.",
      inputSchema: {
        guildId: z.string(),
        userId: z.string(),
        roleId: z.string(),
        ...confirmSchema,
      },
      outputSchema: roleMutationResultSchema,
      annotations: { destructiveHint: false, idempotentHint: false },
    },
    async (input) => {
      try {
        requireConfirmation(input);
        const role = await getEditableRole(discord, input.guildId, input.roleId);
        const guild = await discord.getGuild(input.guildId);
        const member = await guild.members.fetch(input.userId);
        await member.roles.remove(role, input.reason);

        return successResponse("Role removed.", {
          ok: true,
          action: "discord_remove_role",
          guildId: input.guildId,
          roleId: role.id,
          userId: member.id,
          name: role.name,
        });
      } catch (error) {
        return errorResponse("Failed to remove role.", {
          ok: false,
          action: "discord_remove_role",
          guildId: input.guildId,
          roleId: input.roleId,
          userId: input.userId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  );

  server.registerTool(
    "discord_reorder_roles",
    {
      title: "Reorder Discord roles",
      description: "Set role positions within a guild.",
      inputSchema: {
        guildId: z.string(),
        positions: z.array(z.object({ roleId: z.string(), position: z.number().int().min(0) })).min(1),
        ...confirmSchema,
      },
      outputSchema: roleMutationResultSchema,
      annotations: { destructiveHint: true, idempotentHint: false },
    },
    async (input) => {
      try {
        requireConfirmation(input);
        await requireManageRoles(discord, input.guildId);
        const guild = await discord.getGuild(input.guildId);
        const roles = await Promise.all(
          input.positions.map(async (position) => {
            const role = await guild.roles.fetch(position.roleId);
            if (!role) {
              throw new Error(`Discord role not found or inaccessible: ${position.roleId}`);
            }
            if (role.managed || !role.editable) {
              throw new Error(`Bot cannot reorder role due to permissions, management, or hierarchy: ${position.roleId}`);
            }
            return { role: position.roleId as RoleResolvable, position: position.position };
          }),
        );

        await guild.roles.setPositions(roles);

        return successResponse("Roles reordered.", {
          ok: true,
          action: "discord_reorder_roles",
          guildId: input.guildId,
          positions: input.positions,
        });
      } catch (error) {
        return errorResponse("Failed to reorder roles.", {
          ok: false,
          action: "discord_reorder_roles",
          guildId: input.guildId,
          positions: input.positions,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  );
}
