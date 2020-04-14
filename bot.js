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

class TeamPicker {

   constructor() {
      // Instance variables
      this.client       = undefined;
      this.debugChannel = undefined;
      this.channelMap   = undefined;

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

   debug(message) {
      console.log(message);
      return this.debugChannel.send(message);
   }

   async shutdown() {
      await this.debug('Shutting down...');
      this.client.destroy();
      process.exit();
   }
}

class ChannelManager {

   constructor(bot, channel, commands) {
      // State "enumerator"
      this.states  = {
         idle: 0,
         queueing: 1,
      }

      // Instance variables
      this.bot       = bot;
      this.channel   = channel;
      this.commands  = commands;
      this.currState = this.states.idle;

      // Manager variables
      this.playerQueue = new Map();
      this.message     = this.getMessage();

      // Reaction variables
      this.reaQueue = "🇶";
      this.reaCancel = "❌";

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
         } else if (reaction.emoji.name == this.reaCancel) {
            this.dequeuePlayer(user);
            if (this.playerQueue.size == 0) this.state = "idle";
         }
      }
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
   }

   isState(state) {
      return this.states[state] == this.currState;
   }

   queuePlayer(user) {
      let userID = user.id;
      if (!this.playerQueue.has(userID)) {
         this.playerQueue.set(userID, user);
         this.debug(`Queueing player ${user.username}`);
         this.updateQueueMessage();
      }
   }

   dequeuePlayer(user) {
      let userID = user.id;
      if (this.playerQueue.has(userID)) {
         this.playerQueue.delete(userID);
         this.debug(`Dequeueing player ${user.username}`);
         this.updateQueueMessage();
      }
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
            playersText += `•     <@${val.id}>\n`
         })
         this.setMessage(`Queue has begun! React with ${this.reaQueue} to add yourself to the queue!\n`+
                         `To remove yourself from the queue, react with ${this.reaCancel}.\n\n`+
                         `Queued players:\n${playersText}\n`,
                         [this.reaQueue, this.reaCancel]);
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
         for (var i = reactions.length - 1; i >= 0; i--) {
            if (!msg.reactions.cache.get(reactions[i])) {
               await msg.react(reactions[i]);
            }
         }
      });
   }

   debug(message) {
      this.bot.debug(`\`${this.channel.name} manager:\`\n${message}`)
   }
}

new TeamPicker();