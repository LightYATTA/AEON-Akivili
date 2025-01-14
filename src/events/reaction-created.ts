import { Logger } from "../logger"
import { Event } from "../structures/event";
import { BaseGuildTextChannel, ChannelType, Message, WebhookClient } from "discord.js";
import { databaseManager } from "../structures/database";
import { config } from "../const";
import { rebuildMessageComponentAfterUserInteraction } from "../utils";
import { MessagesRecord } from "../types/database";
import { client } from "../structures/client";

const logger = new Logger("ReactionCreated");

export default new Event("messageReactionAdd", async (interaction, user) => {
    if (user.bot) return;
    
    const channel = interaction.message.channel as BaseGuildTextChannel;
    if (channel.type !== ChannelType.GuildText) return;
    
    const broadcastRecords = await databaseManager.getBroadcasts();
    const channelWebhook = broadcastRecords.find((broadcast) => broadcast.channelId === channel.id);
    if (!channelWebhook) return;

    let webhook;
    try {
        webhook = await client.fetchWebhook(channelWebhook.webhookId);
    } catch (error) { 
        logger.error(`Could not fetch webhooks in guild: ${interaction.message.guild?.name ?? 'Unknown'} channel: ${channel.name ?? 'Unknown'}`, error as Error)
        return;
    };
    
    if (config.nonChatWebhooks.includes(webhook.name)) return;
    
    const webhookChannelType = channelWebhook.channelType;

    await interaction.message.reactions.removeAll();

    const actionRows = interaction.message.components;

    const matchingBroadcastRecords = broadcastRecords.filter((broadcastRecord) => broadcastRecord.channelType === webhookChannelType);
    let messageUidInDb: string;
    try {
        messageUidInDb = await databaseManager.getMessageUid(interaction.message.channelId, interaction.message.id);
    } catch (error) {
        logger.error(`Could not get messages. Error: `, error as Error);
        return;
    }
    const newActionRows = await rebuildMessageComponentAfterUserInteraction(interaction.message as Message<boolean>, actionRows, { userId: user.id, userMessageId: messageUidInDb, reactionIdentifier: interaction.emoji.identifier });

    await Promise.allSettled(matchingBroadcastRecords.map(async (broadcastRecord) => {
        if (!interaction.emoji.identifier) return;
        const webhookClient = new WebhookClient({ id: broadcastRecord.webhookId, token: broadcastRecord.webhookToken });
        let messagesOnNetwork: MessagesRecord[];
        try {
            messagesOnNetwork = await databaseManager.getMessages(interaction.message.channel.id, interaction.message.id);
        } catch (error) {
            logger.error(`Could not get messages. Error: `, error as Error);
            return;
        }
        const correctMessageOnNetwork = messagesOnNetwork.find((messageOnNetwork) => messageOnNetwork.channelId === broadcastRecord.channelId);
        if (!correctMessageOnNetwork) {
            return;
        }
        
        const webhookMessage = await webhookClient.fetchMessage(correctMessageOnNetwork.channelMessageId);
        await webhookClient.editMessage(webhookMessage.id, { components: [...newActionRows[newActionRows.indexOf(newActionRows.find((actionRow) => actionRow.guildID === broadcastRecord.guildId) || newActionRows[0])].components] });
        return;
    }))
})