// Bot version
const version = "0.0.2";

// Modules
require('dotenv').config();
const Discord = require('discord.js');
const eJson   = require("edit-json-file");

// Load Config
const defaultOptionsFile = eJson(`${__dirname}/default_options.json`);
const userOptionsFile = eJson(`${__dirname}/options.json`);
const config = {...defaultOptionsFile.toObject(), ...userOptionsFile.toObject()};

class TeamPicker {

   constructor() {
      // Setup client
      this.client = new Discord.Client({retryLimit: Infinity});
      this.client.login(`${process.env.TOKEN}`);

      // Listeners
      this.client.on('ready', () => {this.onReady()});

      // Hande exit
      process.on('SIGINT', () => {this.shutdown()});
   }

   onReady() {
      // Channels
      this.debugChannel   = this.client.channels.cache.get(config.debugChannel);
      this.channelMap     = new Map();
      for (var i = config.channels.length - 1; i >= 0; i--) {
         let channelID = config.channels[i];
         let channel = this.client.channels.cache.get(channelID);
         if (!channel) {
            this.debug(`Channel ID ${channelID} not found, aborting...`);
         }
         this.channelMap.set(channelID, new ChannelManager(this, channel));
      }

      // Channel listeners
      this.client.on('message', (msg) => {
         let channelManager = this.channelMap.get(msg.channel.id);
         if (channelManager) {channelManager.onMessage(msg);}
      });

      this.debug(`Team Picker Bot running v${version}`);
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

   constructor(bot, channel) {
      this.bot = bot;
      this.channel = channel;
   }

   onMessage(msg) {
      
   }
}

new TeamPicker();