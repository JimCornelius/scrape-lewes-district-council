export default class Config {
  static pdfjs = {
    workerSrc: 'https://unpkg.com/pdfjs-dist@2.2.228/build/pdf.worker.js',
  }

  static puppeteerConfig = { headless: false };

  static pdfFile = 'https://www.lewes-eastbourne.gov.uk/_resources/assets/inline/full/0/280352.pdf';

  static selectors = {
    title: '.doc-ti',
    table: {
      code: '.tbl-cod',
      num: '.tbl-num',
      txt: '.tbl-txt',
    },
  }
}
