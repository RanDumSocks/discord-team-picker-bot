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
      this.managerChannel = this.client.channels.cache.get(config.channel);
      this.manager = new ChannelManager(this, this.managerChannel);

      // Channel listeners
      this.client.on('message', (msg) => {
         if(msg.channel == this.managerChannel) {this.manager.onMessage(msg);}
      });

      // Fail on invalid channels
      if (!this.debugChannel || !this.managerChannel) {
         this.debug("Invalid channel IDs given in config... exiting");
      }

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