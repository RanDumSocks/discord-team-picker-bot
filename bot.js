// Bot version
const version = "0.0.3";

// Modules
require('dotenv').config();
const Discord = require('discord.js');
const eJson   = require("edit-json-file");
const fs      = require("fs");

// Load Config
const defaultOptionsFile = eJson(`${__dirname}/default_options.json`);
const userOptionsFile = eJson(`${__dirname}/options.json`);
const config = {...defaultOptionsFile.toObject(), ...userOptionsFile.toObject()};

// General functions
function getRandomKey(collection) {
   let keys = Array.from(collection.keys());
   return keys[Math.floor(Math.random() * keys.length)];
}

class TeamPicker {

   constructor() {
      // Instance variables
      this.client       = undefined;
      this.debugChannel = undefined;
      this.channelMap   = undefined;

      this.roomID       = 0;

      // Create required folders
      if (!fs.existsSync('managerCommands')) fs.mkdirSync('managerCommands');

      // Setup client
      this.client = new Discord.Client({retryLimit: Infinity});
      this.client.login(`${process.env.TOKEN}`);

      // Listeners
      this.client.on('ready', () => {this.onReady()});
      this.client.on('message', (msg) => {this.onMessage(msg)});
      this.client.on('messageReactionAdd', (reaction, user) => {this.onReact(reaction, user)});

      // Hande exit
      process.on('SIGINT', () => {this.shutdown()});
   }

   loadFolderModules(filename) {
      var normalizedPath = require("path").join(__dirname, filename);
      var commandMap = [];

      // Build command map
      require("fs").readdirSync(normalizedPath).forEach( (file) => {
         // Get command module & name
         var cmd = require(`./${filename}/` + file);
         var cmdName = file.slice(0, file.length - 3);

         // Add command to bot
         commandMap.push([cmdName, cmd]);
         cmd.data = new Object();
         cmd.bot = this;
      });

      return commandMap;
   }

   onReady() {
      var managerCommands = this.loadFolderModules("managerCommands");

      // Channels
      this.debugChannel   = this.client.channels.cache.get(config.debugChannel);
      this.channelMap     = new Map();
      for (var i = config.channels.length - 1; i >= 0; i--) {
         let channelID = config.channels[i];
         let channel = this.client.channels.cache.get(channelID);
         if (!channel) {
            this.debug(`Channel ID ${channelID} not found, aborting...`);
         }
         this.channelMap.set(channelID, new ChannelManager(this, channel, managerCommands));
      }

      this.debug(`Team Picker Bot running v${version}`);
   }

   onMessage(msg) {
      if (msg.author.id != this.client.user.id) {
         let channelManager = this.channelMap.get(msg.channel.id);
         if (channelManager) channelManager.onMessage(msg);
      }
   }

   onReact(reaction, user) {
      if (reaction.message.author.id != this.client.user.id) {
         let channelManager = this.channelMap.get(reaction.message.channel.id);
         if (channelManager) channelManager.onReact(reaction, user);
      }
   }

   getNextRoomID() {
      this.roomID += 1;
      return this.roomID;
   }

   debug(message) {
      console.log(message);
      return this.debugChannel.send(message);
   }

   shutdown() {
      this.debug('Shutting down...');
      this.channelMap.forEach( (val, key, map) => {
         val.destroy();
      });
      //this.client.destroy();
      //process.exit();
   }
}

class ChannelManager {

   constructor(bot, channel, commands) {
      // State "enumerator"
      this.states  = {
         idle: 0,
         queueing: 1,
         picking: 2
      }

      // Instance variables
      this.bot       = bot;
      this.channel   = channel;
      this.commands  = commands;
      this.currState = this.states.idle;

      // Manager variables
      this.playerQueue = new Map();
      this.message     = this.getMessage();
      this.captains    = [];
      this.currCaptain = undefined;
      this.teamA       = [];
      this.teamB       = [];
      this.matches     = [];

      // Reaction variables
      this.reaQueue = "🇶";
      this.reaCancel = "❌";
      this.reaNums = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];

      this.update();

      // Remove reactions if they exist
      this.getMessage().then( msg => {
         msg.reactions.removeAll();
      });
   }

   onMessage(msg) {
      if (msg.deletable) msg.delete();
      if (msg.author.id != this.bot.client.user.id) {
         if (msg.content[0] == config.commandPrefix) {
            this.parseCommand(msg.content.slice(1, msg.content.length), msg);
         }
      }
   }

   onReact(reaction, user) {
      if (user.bot) return;
      reaction.users.remove(user)
      if (this.isState("idle")) {
         this.state = "queueing";
         this.queuePlayer(user);
      } else if (this.isState("queueing")){
         if (reaction.emoji.name == this.reaQueue) {
            this.queuePlayer(user);
            if (this.playerQueue.size == config.queueSize) this.state = "picking";
         } else if (reaction.emoji.name == this.reaCancel) {
            this.dequeuePlayer(user);
            if (this.playerQueue.size == 0) this.state = "idle";
         }
      } else if (this.isState("picking")) {
         var player = this.getPlayerFromEmoji(reaction.emoji.name);
         if (player && user == this.currCaptain) {
            if (this.teamA.includes(user)) {
               this.currCaptain = this.captains[1];
               this.teamA.push(player);
            } else {
               this.currCaptain = this.captains[0];
               this.teamB.push(player);
            }
            this.dequeuePlayer(player);
         }
         if (this.playerQueue.size == 0) {
            this.matches.push(new Match(this.teamA, this.teamB, this));
            this.teamA = [];
            this.teamB = [];
            this.state = "idle";
         }
      }
      this.updateQueueMessage();
   }

   update() {
      setTimeout(() => {
         this.update();
      }, config.messageUpdateInterval);
      this.updateQueueMessage();
   }

   parseCommand(command, msgState) {
      const argv = command.split(' ');

      for (var i = 0; i < this.commands.length; i += 1) {
         if (argv[0] == this.commands[i][0]) {
            var cmd = this.commands[i][1];
            cmd.run(argv, msgState, this);
            break;
         }
      }
   }

   set state(state) {
      this.debug(`Switching to state \`${state}\``);
      this.currState = this.states[state];
      if (this.isState("picking")) {

         var captainUser = this.playerQueue.get(getRandomKey(this.playerQueue));
         this.captains[0] = captainUser;
         this.dequeuePlayer(captainUser);
         this.teamA.push(captainUser);

         captainUser = this.playerQueue.get(getRandomKey(this.playerQueue));
         this.captains[1] = captainUser;
         this.dequeuePlayer(captainUser);
         this.teamB.push(captainUser);

         var playerNum = 0
         this.playerQueue.forEach( (val, key, map) => {
            val.playerEmoji = this.reaNums[playerNum];
            playerNum += 1;
         });

         this.currCaptain = this.captains[0];
      }
      this.updateQueueMessage();
   }

   isState(state) {
      return this.states[state] == this.currState;
   }

   queuePlayer(user) {
      let userID = user.id;
      if (!this.playerQueue.has(userID)) {
         this.playerQueue.set(userID, user);
         this.debug(`Queueing player ${user.username}`);
      }
   }

   dequeuePlayer(user) {
      let userID = user.id;
      if (this.playerQueue.has(userID)) {
         this.playerQueue.delete(userID);
         this.debug(`Dequeueing player ${user.username}`);
      }
   }

   getPlayerFromEmoji(emojiName) {
      var player = undefined;
      this.playerQueue.forEach( (val, key, map) => {
         if (val.playerEmoji == emojiName) player = val;
      });
      return player;
   }

   async getMessage() {
      if (this.message == undefined) {
         var message = await this.channel.messages.fetch({limit: 1});
         message = message.values().next().value
         var reaFilter = () => true;
         if (message && message.author.bot) {
            var collector = message.createReactionCollector(reaFilter);
            collector.on('collect', (reaction, user) => this.onReact(reaction, user));
            return message;
         } else {
            message = await this.channel.send(`Generating queue controls...`);
            var collector = message.createReactionCollector(reaFilter);
            collector.on('collect', (reaction, user) => this.onReact(reaction, user));
            return message;
         }
      } else {
         return this.message;
      }
   }

   updateQueueMessage() {
      if (this.isState("idle")) {
         this.setMessage(`Welcome to the queue! React with ${this.reaQueue} to start up a queue!`,
                         [this.reaQueue]);
      } else if (this.isState("queueing")) {
         var playersText = "";
         this.playerQueue.forEach( (val, key, map) => {
            playersText += `•     ${val}\n`
         });
         this.setMessage(`Queue has begun! React with ${this.reaQueue} to add yourself to the queue!\n`+
                         `To remove yourself from the queue, react with ${this.reaCancel}.\n\n`+
                         `Queued players:\n${playersText}\n`,
                         [this.reaQueue, this.reaCancel]);
      } else if (this.isState("picking")) {
         var playersText = "";
         var playerEmojis = [];
         var teamAString = "";
         var teamBString = "";
         this.playerQueue.forEach( (val, key, map) => {
            playersText += `${val.playerEmoji}: ${val}\n`;
            playerEmojis.push(val.playerEmoji);
         });
         for (var i = 0; i < this.teamA.length; i++) {
            teamAString += `•     ${this.teamA[i]}\n`
         }
         for (var i = 0; i < this.teamB.length; i++) {
            teamBString += `•     ${this.teamB[i]}\n`
         }
         this.setMessage(`Team captains have been picked, congrats ${this.captains[0]} and ${this.captains[1]}!\n`+
                         `When it's your turn to pick, react with the emoji next to the player's name to place them on your team.\n\n`+
                         `${this.currCaptain}, please select your player!\n`+
                         `${playersText}\n\n`+
                         `Team A:\n${teamAString}\n`+
                         `Team B:\n${teamBString}\n`,
                         playerEmojis);
      }
   }

   async setMessage(message, reactions) {
      var msg = await this.getMessage();
      msg.edit(message).then( async _ => {
         msg.reactions.cache.forEach( (val, key, map) => {
            if (!reactions.includes(key)) {
               val.remove();
            }
         })
         for (var i = 0; i < reactions.length; i++) {
            if (reactions[i] && !msg.reactions.cache.get(reactions[i])) {
               await msg.react(reactions[i]);
            }
         }
      });
   }

   async sendDM(user, msg) {
       var dm = await user.createDM();
       var msg = await dm.send(msg);
       dm.delete();
   }

   getNextRoomID() {
      return this.bot.getNextRoomID();
   }

   debug(message) {
      this.bot.debug(`\`${this.channel.name} manager:\`\n${message}`)
   }

   destroy() {
      for (var i = 0; i < this.matches.length; i++) {
         this.matches[i].destroy();
      }
   }
}

class Match {

   constructor(teamA, teamB, manager) {
      this.teamA    = teamA;
      this.teamB    = teamB;
      this.manager  = manager;
      this.ID       = manager.getNextRoomID();
      this.guild    = manager.channel.guild;
      this.roomName = `Room ${this.ID}`;
      this.roleName = `Match ${this.ID}`;

      this.matchChannel = undefined;
      this.genChannel   = undefined;
      this.teamARole    = undefined;
      this.teamBRole    = undefined;
      this.teamAVoice   = undefined;
      this.teamBVoice   = undefined;

      this.sendTeamList();
      this.createRoom();
   }

   sendTeamList() {
      var teamAPlayers = "";
      var teamBPlayers = "";
      for (var i = 0; i < this.teamA.length; i++) {
         teamAPlayers += `•     ${this.teamA[i]}\n`
      }
      for (var i = 0; i < this.teamB.length; i++) {
         teamBPlayers += `•     ${this.teamB[i]}\n`
      }
      for (var i = 0; i < this.teamA.length; i++) {
         this.teamA[i]
         this.manager.sendDM(this.teamA[i], `Here are your team members:\n`+
                                            `${teamAPlayers}\n`);
      }
      for (var i = 0; i < this.teamB.length; i++) {
         this.teamB[i]
         this.manager.sendDM(this.teamB[i], `Here are your team members:\n`+
                                            `${teamBPlayers}\n`);
      }
   }

   async createRoom() {
      this.teamARole = await this.guild.roles.create({
         data: {
            name: this.roleName + " A",
         }
      });
      this.teamBRole = await this.guild.roles.create({
         data: {
            name: this.roleName + " B",
         }
      });

      this.matchChannel = await this.guild.channels.create(this.roomName, {
         type: "category",
         permissionOverwrites: [{
            id: this.guild.roles.everyone,
            deny: Discord.Permissions.FLAGS.VIEW_CHANNEL,
         }, {
            id: this.manager.bot.client.user,
            allow: Discord.Permissions.FLAGS.VIEW_CHANNEL
         }]
      });
      this.genChannel = await this.guild.channels.create("Lobby", {
         parent: this.matchChannel,
         permissionOverwrites: [{
            id: this.teamARole,
            allow: Discord.Permissions.FLAGS.VIEW_CHANNEL
         }, {
            id: this.teamBRole,
            allow: Discord.Permissions.FLAGS.VIEW_CHANNEL
         },{
            id: this.guild.roles.everyone,
            deny: Discord.Permissions.FLAGS.VIEW_CHANNEL,
         },{
            id: this.manager.bot.client.user,
            allow: Discord.Permissions.FLAGS.VIEW_CHANNEL
         }]
      });

      this.teamAVoice = await this.guild.channels.create("Team A", {
         type: "voice",
         parent: this.matchChannel,
         permissionOverwrites: [{
            id: this.teamARole,
            allow: Discord.Permissions.FLAGS.VIEW_CHANNEL
         },{
            id: this.guild.roles.everyone,
            deny: Discord.Permissions.FLAGS.VIEW_CHANNEL,
         },{
            id: this.manager.bot.client.user,
            allow: Discord.Permissions.FLAGS.VIEW_CHANNEL
         }]
      });

      this.teamBVoice = await this.guild.channels.create("Team B", {
         type: "voice",
         parent: this.matchChannel,
         permissionOverwrites: [{
            id: this.teamBRole,
            allow: Discord.Permissions.FLAGS.VIEW_CHANNEL
         },{
            id: this.guild.roles.everyone,
            deny: Discord.Permissions.FLAGS.VIEW_CHANNEL,
         },{
            id: this.manager.bot.client.user,
            allow: Discord.Permissions.FLAGS.VIEW_CHANNEL
         }]
      });

      for (var i = 0; i < this.teamA.length; i++) {
         this.guild.member(this.teamA[i]).roles.add(this.teamARole);
      }
      for (var i = 0; i < this.teamB.length; i++) {
         this.guild.member(this.teamB[i]).roles.add(this.teamBRole);
      }
   }

   async destroy() {
      await this.genChannel.delete();
      await this.teamARole.delete();
      await this.teamBRole.delete();
      await this.teamBVoice.delete();
      await this.teamAVoice.delete();
      await this.matchChannel.delete();
   }
}

new TeamPicker();