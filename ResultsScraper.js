import puppeteer from 'puppeteer';
import Config from './Config.js';
import ResultsParser from './ResultsParser.js';

export default class ResultsScraper {
  constructor() {
    console.log('Created Scraper');
  }

  static async go() {
    await (new ResultsScraper()).start();
  }

  async initPuppeteer() {
    console.log('Launching puppeteer');
    this.browser = await puppeteer.launch(Config.puppeteerConfig);
    let myPage = 'undefine';
    [myPage] = await this.browser.pages();
    return myPage;
  }

  async start() {
    this.page = await this.initPuppeteer();
    const parser = await ResultsParser.createParser(this.page);
    await parser.performParse();
    await this.cleanUp();
    console.log('All done. End.');
  }

  async cleanUp() {
    await this.browser.close();
  }
}
