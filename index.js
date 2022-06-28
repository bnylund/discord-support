// DATABASE
const Sequelize = require('sequelize')
const _Ticket = require('./models/Ticket')

const sequelize = new Sequelize('database', 'user', 'password', {
  host: 'localhost',
  dialect: 'sqlite',
  logging: false,
  // SQLite only
  storage: 'database.sqlite',
})

const Tickets = sequelize.define('tickets', _Ticket)

// DISCORD
const { Client, Intents, MessageActionRow, MessageButton, MessageEmbed } = require('discord.js')
require('dotenv').config()

if (!process.env.SUPPORT_CHANNEL) {
  console.log('No mount channel specified!')
  process.exit(2)
}

if (!process.env.DISCORD_GUILD) {
  console.log('No guild specified!')
  process.exit(2)
}

if (!process.env.DISCORD_TOKEN) {
  console.log('No bot token specified!')
  process.exit(1)
}

if (!process.env.TICKET_CATEGORY) {
  console.log('No tickets category specified!')
  process.exit(2)
}

if (!process.env.SUPPORT_ROLES) {
  console.log('No support roles specified!')
  process.exit(2)
}

const client = new Client({
  intents: [
    Intents.FLAGS.DIRECT_MESSAGES,
    Intents.FLAGS.DIRECT_MESSAGE_REACTIONS,
    Intents.FLAGS.DIRECT_MESSAGE_TYPING,
    Intents.FLAGS.GUILDS,
    Intents.FLAGS.GUILD_MESSAGES,
    Intents.FLAGS.GUILD_MEMBERS,
    Intents.FLAGS.GUILD_BANS,
    Intents.FLAGS.GUILD_EMOJIS_AND_STICKERS,
    Intents.FLAGS.GUILD_MESSAGE_REACTIONS,
    Intents.FLAGS.GUILD_MESSAGE_TYPING,
  ],
})

client.once('ready', async () => {
  await Tickets.sync(process.env.NODE_ENV === 'development' ? { force: true } : {})

  console.log('Setting up channel...')
  const channel = await client.channels.fetch(process.env.SUPPORT_CHANNEL)
  await channel.bulkDelete(await channel.messages.fetch(), true)

  const row = new MessageActionRow().addComponents(
    new MessageButton()
      .setCustomId('open_ticket')
      .setLabel('Open Ticket')
      .setStyle('SECONDARY')
      .setEmoji(process.env.SEND_EMOJI),
  )

  const embed = new MessageEmbed()
    .setColor('#7a0019')
    .setTitle('UMN Support')
    .setDescription(
      'Need to file an anonymous report against another user in the discord, or just need to get in touch with Operations? Click on the button below to open up a support ticket and you will be put in touch with the Operations team.',
    )

  await channel.send({
    embeds: [embed],
    components: [row],
  })

  console.log('Done! Ready for tickets!')
})

function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[array[i], array[j]] = [array[j], array[i]]
  }
}

// Open/close tickets
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return

  //console.log(interaction)
  if (interaction.customId === 'open_ticket') {
    if (await Tickets.findOne({ where: { user_id: interaction.user.id, status: 'OPEN' } })) {
      return interaction.reply({
        ephemeral: true,
        content: 'You already have an open ticket!',
      })
    }

    // Open a new ticket
    try {
      // Create channel
      const id = (await Tickets.findAll()).length + 1
      const channel = await interaction.guild.channels.create(`ticket-${id}`, { parent: process.env.TICKET_CATEGORY })

      // Create the ticket
      const ticket = await Tickets.create({
        user_id: interaction.user.id,
        channel: channel.id,
        status: 'OPEN',
        _id: `${id}`,
      })

      // Send user message
      interaction.user.send({
        embeds: [
          new MessageEmbed()
            .setColor('#00BC06')
            .setTitle(`Ticket #${ticket._id} Opened`)
            .setDescription(
              'What would you like to talk to us about? Type in your message below and it will be relayed to the Operations team.\n\nNOTE: For security purposes, this is **ANONYMOUS**, and two randomly selected Operations members will be assigned to your case.',
            ),
        ],
      })

      // Send channel message, assigning ops
      const row = new MessageActionRow().addComponents(
        new MessageButton().setCustomId('close_ticket').setLabel('Close Ticket').setStyle('DANGER'),
      )

      await interaction.guild.members.fetch()

      const roles = process.env.SUPPORT_ROLES.split(',')

      const ops = []
      for (let i = 0; i < roles.length; i++)
        ops.push(...interaction.guild.roles.cache.get(roles.at(i)).members.map((v, k) => k))

      shuffleArray(ops)
      const assignees = ops.slice(0, 2)

      const embed = new MessageEmbed()
        .setColor('#00BC06')
        .setTitle('Ticket Opened')
        .setDescription(
          `\nID: ${ticket._id}\n\nAssignees: ${assignees
            .map((v) => `<@!${v}>`)
            .join(' ')}\n\nWaiting for the user to type their message.`,
        )

      await channel.send({
        embeds: [embed],
        components: [row],
        content: `${assignees.map((v) => `<@!${v}>`).join(' ')}`,
      })

      // Final reply
      return interaction.reply({
        ephemeral: true,
        content: `Ticket created! Check your DMs to send a message. [ID: ${id}]`,
      })
    } catch (err) {
      console.log(err)
      return interaction.reply({
        content: 'An error occurred.',
        ephemeral: true,
      })
    }
  } else if (interaction.customId === 'close_ticket') {
    // Close ticket associated with the channel
    const ticket = await Tickets.findOne({ where: { channel: interaction.channel.id, status: 'OPEN' } })
    if (ticket) {
      const embed = new MessageEmbed().setColor('#E34040').setTitle(`Ticket #${ticket._id} Closed`)
      await (await client.users.cache.get(ticket.user_id).createDM()).send({ embeds: [embed] })
      await interaction.channel.send({ embeds: [embed] })

      if (process.env.ARCHIVE_CATEGORY) await interaction.channel.setParent(process.env.ARCHIVE_CATEGORY)
      else {
        await interaction.channel.send({ content: 'No archive category specified, deleting channel in 30 seconds.' })
        setTimeout(async () => {
          await interaction.channel.delete()
        }, 1000 * 30)
      }
      await Tickets.update({ status: 'CLOSED' }, { where: { channel: interaction.channel.id, status: 'OPEN' } })
      await interaction.reply({ content: 'Ticket closed.', ephemeral: true })
    }
  }
})

// Replicate typing status
client.on('typingStart', async (typing) => {
  if (!typing.inGuild() && !typing.user.bot) {
    // Member typing
    const ticket = await Tickets.findOne({ where: { user_id: typing.user.id, status: 'OPEN' } })
    if (ticket) {
      await client.channels.cache.get(ticket.channel).sendTyping()
    }
  } else if (!typing.user.bot) {
    // Staff typing
    const ticket = await Tickets.findOne({ where: { channel: typing.channel.id, status: 'OPEN' } })
    if (ticket) {
      await (await client.users.cache.get(ticket.user_id).createDM()).sendTyping()
    }
  }
})

// Relay messages
client.on('messageCreate', async (msg) => {
  if (!msg.inGuild() && !msg.author.bot) {
    // Relay user message
    const ticket = await Tickets.findOne({ where: { user_id: msg.author.id, status: 'OPEN' } })
    if (ticket) {
      const channel = await client.channels.cache.get(ticket.channel)
      channel.send({ content: `**Member:** ${msg.content}` })
      msg.react('✉')
    }
  } else if (!msg.author.bot) {
    // Relay op message
    const ticket = await Tickets.findOne({ where: { channel: msg.channel.id, status: 'OPEN' } })
    if (ticket) {
      await (await client.users.cache.get(ticket.user_id).createDM()).send({ content: `**Staff:** ${msg.content}` })
      msg.react('✉')
    }
  }
})

client.login(process.env.DISCORD_TOKEN)
