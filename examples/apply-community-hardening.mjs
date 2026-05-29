#!/usr/bin/env node

import {
  AutoModerationActionType,
  AutoModerationRuleEventType,
  AutoModerationRuleKeywordPresetType,
  AutoModerationRuleTriggerType,
  ChannelType,
  PermissionFlagsBits,
} from "discord.js";
import { createSnapshot } from "../dist/backup/snapshot.js";
import { writeSnapshot } from "../dist/backup/store.js";
import { loadConfig } from "../dist/config.js";
import { DiscordClientManager } from "../dist/discordClient.js";

const guildId = process.env.HARDENING_GUILD_ID;
const confirmed = process.env.CONFIRM_HARDENING === "true";
const reason = "Community hardening example: staff logs, AutoMod, and channel hygiene";

if (!guildId) {
  throw new Error("Set HARDENING_GUILD_ID before running this example.");
}

if (!confirmed) {
  throw new Error("Set CONFIRM_HARDENING=true before running this mutating example.");
}

const staffChannels = [
  { key: "audit-log", name: "audit-log", topic: "Internal audit notes and security review references." },
  { key: "mod-log", name: "mod-log", topic: "Moderation actions and staff coordination." },
  { key: "bot-log", name: "bot-log", topic: "Bot operational logs and configuration changes." },
  { key: "automod-alerts", name: "automod-alerts", topic: "AutoMod alerts, spam signals, and raid indicators." },
  { key: "staff-notes", name: "staff-notes", topic: "Private staff notes, procedures, and follow-ups." },
];

const scamKeywords = [
  "free nitro",
  "free discord nitro",
  "nitro free",
  "steam gift",
  "airdrop",
  "wallet drain*",
  "token grab*",
  "verify your wallet",
  "discord.gg/*",
  "discord.com/invite/*",
  "dsc.gg/*",
  "bit.ly/*",
  "tinyurl.com/*",
];

const results = [];

function record(status, action, detail = {}) {
  results.push({ status, action, ...detail });
}

function findRole(guild, fragment) {
  return guild.roles.cache.find((role) => role.name.toLowerCase().includes(fragment.toLowerCase())) ?? null;
}

function findChannel(channels, fragment) {
  return channels.find((channel) => channel?.name?.toLowerCase().includes(fragment.toLowerCase())) ?? null;
}

function staffOverwrites(guild, roles) {
  const overwrites = [{ id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] }];

  for (const role of roles.filter(Boolean)) {
    overwrites.push({
      id: role.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageMessages,
      ],
    });
  }

  return overwrites;
}

async function createBackup(label, config, guild) {
  const snapshot = await createSnapshot(guild);
  const backupId = await writeSnapshot(config.backupDir, snapshot, new Date(snapshot.capturedAt));
  record("ok", `backup:${label}`, {
    backupId,
    counts: {
      roles: snapshot.roles.length,
      channels: snapshot.channels.length,
      autoModRules: snapshot.autoModRules.length,
    },
    warnings: snapshot.warnings ?? [],
  });
}

async function ensureStaffChannels(guild, roles) {
  const channels = await guild.channels.fetch();
  let category = findChannel(channels, "staff") ?? findChannel(channels, "management");

  if (!category) {
    category = await guild.channels.create({
      name: "Staff",
      type: ChannelType.GuildCategory,
      permissionOverwrites: staffOverwrites(guild, roles),
      reason,
    });
    record("ok", "category-create:staff", { id: category.id });
  }

  for (const spec of staffChannels) {
    const refreshed = await guild.channels.fetch();
    let channel = findChannel(refreshed, spec.key);

    if (!channel) {
      channel = await guild.channels.create({
        name: spec.name,
        type: ChannelType.GuildText,
        parent: category.id,
        topic: spec.topic,
        permissionOverwrites: staffOverwrites(guild, roles),
        reason,
      });
      record("ok", `channel-create:${spec.key}`, { id: channel.id });
    } else {
      await channel.edit({ topic: spec.topic, parent: category.id }, reason);
      record("ok", `channel-update:${spec.key}`, { id: channel.id });
    }
  }

  return findChannel(await guild.channels.fetch(), "automod-alerts");
}

async function ensureAutoMod(guild, alertChannel) {
  const rules = await guild.autoModerationRules.fetch();
  const actions = [
    {
      type: AutoModerationActionType.BlockMessage,
      metadata: { customMessage: "Blocked by community safety filters." },
    },
    ...(alertChannel
      ? [{ type: AutoModerationActionType.SendAlertMessage, metadata: { channel: alertChannel.id } }]
      : []),
  ];

  const scamRule = rules.find((rule) => rule.name.toLowerCase() === "anti scam & invite spam");
  const scamPayload = {
    name: "Anti Scam & Invite Spam",
    enabled: true,
    eventType: AutoModerationRuleEventType.MessageSend,
    triggerType: AutoModerationRuleTriggerType.Keyword,
    triggerMetadata: { keywordFilter: scamKeywords },
    actions,
    reason,
  };
  const scam = scamRule ? await scamRule.edit(scamPayload) : await guild.autoModerationRules.create(scamPayload);
  record("ok", scamRule ? "automod-update:scam" : "automod-create:scam", { id: scam.id });

  const flaggedRule = rules.find((rule) => rule.name.toLowerCase() === "harmful flagged content");
  const flaggedPayload = {
    name: "Harmful Flagged Content",
    enabled: true,
    eventType: AutoModerationRuleEventType.MessageSend,
    triggerType: AutoModerationRuleTriggerType.KeywordPreset,
    triggerMetadata: {
      presets: [
        AutoModerationRuleKeywordPresetType.Slurs,
        AutoModerationRuleKeywordPresetType.SexualContent,
      ],
    },
    actions,
    reason,
  };
  const flagged = flaggedRule
    ? await flaggedRule.edit(flaggedPayload)
    : await guild.autoModerationRules.create(flaggedPayload);
  record("ok", flaggedRule ? "automod-update:flagged" : "automod-create:flagged", { id: flagged.id });
}

async function main() {
  const config = loadConfig();
  const manager = new DiscordClientManager(config.discordToken, {
    enableMessageContent: config.enableMessageContent,
    enableGuildMembers: config.enableGuildMembers,
  });

  try {
    const guild = await manager.getGuild(guildId);
    await guild.roles.fetch();

    const roles = [
      findRole(guild, "admin"),
      findRole(guild, "moderator"),
      findRole(guild, "mod"),
    ];

    await createBackup("pre-hardening", config, guild);
    const alertChannel = await ensureStaffChannels(guild, roles);
    await ensureAutoMod(guild, alertChannel);
    await createBackup("post-hardening", config, guild);

    console.log(JSON.stringify({ guildId: guild.id, guildName: guild.name, results }, null, 2));
  } finally {
    await manager.destroy();
  }
}

await main();
