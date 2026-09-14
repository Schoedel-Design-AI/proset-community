import { REST, Routes } from "discord.js";
import { discordCommandManifest } from "../server/modules/discord/commands";

const applicationId = process.env.DISCORD_APPLICATION_ID?.trim();
const botToken = process.env.DISCORD_BOT_TOKEN?.trim();
const guildId = process.env.DISCORD_COMMAND_GUILD_ID?.trim();

if (!applicationId || !botToken) {
  throw new Error("DISCORD_APPLICATION_ID and DISCORD_BOT_TOKEN are required");
}

const commands = discordCommandManifest();
const route = guildId
  ? Routes.applicationGuildCommands(applicationId, guildId)
  : Routes.applicationCommands(applicationId);
const scope = guildId ? `test guild ${guildId}` : "global Discord installation";

await new REST({ version: "10" }).setToken(botToken).put(route, { body: commands });
console.log(`Registered ${commands.length} Proset commands for ${scope}.`);
