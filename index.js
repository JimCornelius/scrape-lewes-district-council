import ResultsScraper from './ResultsScraper.js';

process.on('uncaughtException', (err) => {
  if (err) {
    console.log(`Caught exception, but no error msg ${err.stack}`);
    process.exit(1);
  }
});

ResultsScraper.go();
