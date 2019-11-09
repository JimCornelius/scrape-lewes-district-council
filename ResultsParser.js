
import Config from './Config.js';
import BrowserContext from './BrowserContext.js';

export default class ResultsParser {
  // constructor() {
  //   // don't overuse constructor, save for initiate function
  // }

  async exposeHelperFuncs(page) {
    // expose function the can be called in the browser context
    const onDocEvent = this.onDocEvent.bind(this);
    await page.exposeFunction('onDocEvent', onDocEvent);

    const { doConsoleLog } = ResultsParser;
    await page.exposeFunction('doConsoleLog', doConsoleLog);
  }

  static doConsoleLog(val) {
    console.log(val);
  }

  onDocEvent(event, val) {
    this.onDocEventAsync(event, val);
  }

  async onDocEventAsync(event, val) {
    if (event === 'pagecount') {
      // this is a custom event, created when the callback of the
      // loadingTask.promise is called.
      //
      // On a large document there will pages where the text layer is not loaded into the DOM.
      // A <loadingIcon> element will exist in place of the span tags
      // As each loadingIcon is scrolled into view pdfJSLib populates the textLayer.
      // We can then extract the tags to allow the page to be parsed.
      //
      // Scrolling a page out of view will remove the spans in the textlayer,
      // so the tags must be captured while the page is in view.
      // The container holds 2 pages at any one time on a normal scaled view.
      //
      // Only scroll new pages into view after current textlayer tags are captured

      this.pageTags = new Array(val).fill(null);
    } else if (event === 'textlayerrendered') {
      // text layer for page 'val' is now in the DOM and can be parsed
      // capture the span tags in the current page
      this.pageTags[val - 1] = await this.getPageSpanElements(val);

      // find the next unrendered page and scroll it into view
      const nextPage = 1 + this.pageTags.indexOf(null);

      // keep at it while there are pages yet to render
      if (nextPage) {
        await this.page.evaluate(BrowserContext.scrollPageIntoView, nextPage);
      } else {
        // All pages rendered, we can now parse the whole PDF
        // emit a message to pass control back to func parsePdf awaiting
        this.storage.emitter.emit('readyToParse');
      }
    }
  }

  async getPageSpanElements(pageNumber) {
    const selector = `.page[data-page-number="${pageNumber}"] > .textLayer > span`;
    const elements = await this.page.$$eval(selector, (e) => e.map((el) => ({
      tagName: el.tagName,
      className: el.className,
      innerText: el.innerText,
    })));
    return elements;
  }

  async parsePdf(celexDoc, page) {
    this.page = page;

    // inject pdfViewerTags etc
    await page.evaluate(BrowserContext.injectPdfViewer);

    // inject some code into the webpage to help us out with PDFs
    await page.addStyleTag({ url: 'https://unpkg.com/pdfjs-dist@2.2.228/web//pdf_viewer.css' });
    await page.addScriptTag({ url: 'https://unpkg.com/pdfjs-dist@2.2.228/build/pdf.js' });
    await page.waitForFunction('pdfjsLib != undefined');

    await page.addScriptTag({ url: 'https://unpkg.com/pdfjs-dist@2.2.228/web/pdf_viewer.js' });
    await page.waitForFunction('pdfjsViewer != undefined');

    // calls loadPdfDoc in the browser context
    await page.evaluate(
      BrowserContext.loadPdfDoc,
      Config.pdfFile,
      this.storage.Config.pdfjs.workerSrc,
    );
    // browser has control until ready to parse
    await this.readyToParseEmitted();
    // wait for parsing to complete and we're done for this page
    await this.parsePdfTags(this.collectElements());
  }

  async readyToParseEmitted() {
    await new Promise((resolve) => {
      this.storage.emitter.on('readyToParse', resolve);
    });
  }
}
