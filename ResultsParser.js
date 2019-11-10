import EventEmitter from 'events';
import Config from './Config.js';
import BrowserContext from './BrowserContext.js';

export default class ResultsParser {
  // factory method
  static async createParser(page) {
    return new ResultsParser(page);
  }

  constructor(page) {
    this.page = page;
    this.emitter = new EventEmitter();
    this.completed = false;
  }

  async exposeHelperFuncs() {
    // expose function the can be called in the browser context
    const onDocEvent = this.onDocEvent.bind(this);
    await this.page.exposeFunction('onDocEvent', onDocEvent);

    const { doConsoleLog } = ResultsParser;
    await this.page.exposeFunction('doConsoleLog', doConsoleLog);
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
        this.emitter.emit('readyToParse');
      }
    }
  }

  async getPageSpanElements(pageNumber) {
    const selector = `.page[data-page-number="${pageNumber}"] > .textLayer > span`;
    const elements = await this.page.$$eval(selector, (e) => e.map((el) => {
      const rect = el.getBoundingClientRect();
      return {
        tagName: el.tagName,
        className: el.className,
        innerText: el.innerText,
        top: rect.top,
        left: rect.left,
        bottom: rect.bottom,
        right: rect.right,
      };
    }));
    return elements;
  }

  async parsePdf() {
    // inject pdfViewerTags etc
    await this.page.evaluate(BrowserContext.injectPdfViewer);

    // inject some code into the webpage to help us out with PDFs
    await this.page.addStyleTag({ url: 'https://unpkg.com/pdfjs-dist@2.2.228/web//pdf_viewer.css' });
    await this.page.addScriptTag({ url: 'https://unpkg.com/pdfjs-dist@2.2.228/build/pdf.js' });
    await this.page.waitForFunction('pdfjsLib != undefined');

    await this.page.addScriptTag({ url: 'https://unpkg.com/pdfjs-dist@2.2.228/web/pdf_viewer.js' });
    await this.page.waitForFunction('pdfjsViewer != undefined');

    // calls loadPdfDoc in the browser context
    await this.page.evaluate(
      BrowserContext.loadPdfDoc,
      Config.pdfFile,
      Config.pdfjs.workerSrc,
    );
    // browser has control until ready to parse
    await this.readyToParseEmitted();
    // once for parsing complete and we're done
    this.parsePdfTags(this.collectElements());
  }

  async readyToParseEmitted() {
    await new Promise((resolve) => {
      this.emitter.on('readyToParse', resolve);
    });
  }

  async performParse() {
    await this.exposeHelperFuncs();
    await this.page.setViewport({ width: 1280, height: 800 });

    try {
      await this.page.goto(Config.pdfFile, { waitUntil: 'load' });
      await this.parsePdf();
    } catch (err) {
      console.log(`Caught Exception ${err.stack}`);
    }
    console.log(JSON.stringify(this.results, null, ' '));
  }

  collectElements() {
    const allElements = [];
    for (const pageElements of this.pageTags) {
      if (pageElements.length > 3 && pageElements[2].innerText === 'COUNCILLORS') {
        pageElements[1].innerText += pageElements[2].innerText;
        pageElements[1].top = Math.min(pageElements[1].top, pageElements[2].top);
        pageElements[1].left = Math.min(pageElements[1].left, pageElements[2].left);
        pageElements[1].bottom = Math.max(pageElements[1].bottom, pageElements[2].bottom);
        pageElements[1].right = Math.max(pageElements[1].right, pageElements[2].right);
        pageElements.splice(2, 1);
      }
      if (allElements.length && pageElements.length && pageElements[0].innerText !== 'Lewes District Council') {
        if (pageElements[0].innerText === 'Lewes') {
          pageElements[1].innnerText = `${pageElements[0].innerText} ${pageElements[1].innnerText}`;
          pageElements[1].top = Math.min(pageElements[1].top, pageElements[0].top);
          pageElements[1].left = Math.min(pageElements[1].left, pageElements[0].left);
          pageElements[1].bottom = Math.max(pageElements[1].bottom, pageElements[0].bottom);
          pageElements[1].right = Math.max(pageElements[1].right, pageElements[0].right);
          pageElements.shift();
          allElements.push(pageElements);
        } else {
          for (const element of pageElements) {
            element.top += 1200;
            element.bottom += 1200;
          }
          allElements[allElements.length - 1]
            = allElements[allElements.length - 1].concat(pageElements);
        }
      } else {
        allElements.push(pageElements);
      }
    }
    return allElements;
  }

  parsePdfTags(wards) {
    if (this.results === undefined) {
      this.results = [];
    }
    for (const fields of wards) {
      const wardName = fields[3].innerText;
      const ward = { wardName, candidates: [] };
      const candidateBounds = [];

      let currentCandidate = {
        name: 'unknown', knownAs: 'N/A', party: 'Independent', votes: -1, elected: false,
      };
      ward.candidates.push(currentCandidate);

      let currentBounds = { top: 1200, bottom: 0 };
      candidateBounds.push(currentBounds);

      let candidatesReady = false;
      let votesReady = false;
      let oldField = 'x';
      let oldBound = { top: null, bottom: null };
      for (const fieldBloc of fields) {
        const field = fieldBloc.innerText;
        if (votesReady) {
          const numb = field.replace('(Elected)', '').trim();
          const n = Number(numb.replace(',', ''));
          if (numb.length && !Number.isNaN(n)) {
            const mid = (fieldBloc.top + fieldBloc.bottom) / 2;
            for (let i = 0; i < candidateBounds.length; i++) {
              if (mid >= candidateBounds[i].top && mid <= candidateBounds[i].bottom) {
                ward.candidates[i].votes = n;
              }
            }
          }
          if (field.includes('(Elected')) {
            const mid = (fieldBloc.top + fieldBloc.bottom) / 2;
            for (let i = 0; i < candidateBounds.length; i++) {
              if (mid >= candidateBounds[i].top && mid <= candidateBounds[i].bottom) {
                ward.candidates[i].elected = true;
              }
            }
          }
        } else if (!candidatesReady && !votesReady) {
          candidatesReady = field.includes('E) : Elected');
        } else if (field.includes('TOTAL') || field.includes('unmarked') || field.includes('ejected')) {
          candidatesReady = false;
          votesReady = true;
        } else if (field.includes('Known as ')) {
          currentCandidate.knownAs = field.trimLeft(9);
          currentBounds.top = Math.min(currentBounds.top, fieldBloc.top);
          currentBounds.bottom = Math.max(currentBounds.bottom, fieldBloc.bottom);
        } else if (field.includes('Liberal')) {
          currentCandidate.party = 'Liberal Democrat';
          currentBounds.top = Math.min(currentBounds.top, fieldBloc.top);
          currentBounds.bottom = Math.max(currentBounds.bottom, fieldBloc.bottom);
        } else if (field.includes('Labour')) {
          currentCandidate.party = 'Labour ';
          currentBounds.top = Math.min(currentBounds.top, fieldBloc.top);
          currentBounds.bottom = Math.max(currentBounds.bottom, fieldBloc.bottom);
        } else if (field.includes('UKIP')) {
          currentCandidate.party = 'UKIP ';
          currentBounds.top = Math.min(currentBounds.top, fieldBloc.top);
          currentBounds.bottom = Math.max(currentBounds.bottom, fieldBloc.bottom);
        } else if (field.includes('Conservative')) {
          currentCandidate.party = 'Conservative ';
          currentBounds.top = Math.min(currentBounds.top, fieldBloc.top);
          currentBounds.bottom = Math.max(currentBounds.bottom, fieldBloc.bottom);
        } else if (field.includes('Green')) {
          currentCandidate.party = 'Green ';
          currentBounds.top = Math.min(currentBounds.top, fieldBloc.top);
          currentBounds.bottom = Math.max(currentBounds.bottom, fieldBloc.bottom);
        } else if (field === '-' && currentCandidate.name.includes(oldField)) {
          currentCandidate.name += field;
          currentBounds.top = Math.min(currentBounds.top, fieldBloc.top);
          currentBounds.bottom = Math.max(currentBounds.bottom, fieldBloc.bottom);
        } else if (field.toUpperCase() === field) {
          if (currentCandidate.name === 'unknown') {
            currentCandidate.name = field;
            currentBounds.top = Math.min(currentBounds.top, fieldBloc.top);
            currentBounds.bottom = Math.max(currentBounds.bottom, fieldBloc.bottom);
          } else if (
            ((fieldBloc.top + fieldBloc.bottom) / 2) >= oldBound.top &&
            ((fieldBloc.top + fieldBloc.bottom) / 2) <= oldBound.bottom &&
            currentCandidate.name.includes(oldField)) {
            currentCandidate.name += field;
            currentBounds.top = Math.min(currentBounds.top, fieldBloc.top);
            currentBounds.bottom = Math.max(currentBounds.bottom, fieldBloc.bottom);
          } else if (field.length && field !== '-') {
            currentCandidate = {
              name: field, knownAs: 'N/A', party: 'Independent', votes: -1, elected: false,
            };
            ward.candidates.push(currentCandidate);
            currentBounds = { top: fieldBloc.top, bottom: fieldBloc.bottom };
            candidateBounds.push(currentBounds);
          }
        }
        oldField = field;
        oldBound = { top: fieldBloc.top, bottom: fieldBloc.bottom };
      }
      this.results.push(ward);
    }
  }
}
