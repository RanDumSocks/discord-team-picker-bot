const version = "0.1";

require('dotenv').config();
const Discord = require('discord.js');

class TeamPicker {

   constructor() {
      this.client = new Discord.Client({retryLimit: Infinity});
      this.client.login(`${process.env.TOKEN}`);
   }
}

new TeamPicker();