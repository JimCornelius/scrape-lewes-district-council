/* global pdfjsLib, pdfjsViewer */

export default class BrowserContext {
  static loadPdfDoc(url, workerSrc) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

    const pdfViewer = new pdfjsViewer.PDFViewer({
      container: document.getElementById('viewerContainer'),
      textLayerFactory: new pdfjsViewer.DefaultTextLayerFactory(),
    });

    const loadingTask = pdfjsLib.getDocument({ url });
    loadingTask.promise.then((pdfDocument) => {
      window.onDocEvent('pagecount', pdfDocument.numPages);
      pdfViewer.setDocument(pdfDocument);
    });
  }

  static injectPdfViewer() {
    document.addEventListener('textlayerrendered', (event) => {
      window.onDocEvent('textlayerrendered', event.detail.pageNumber);
    });

    // don't need existing body, replace it with the PdfViewer
    document.body.innerHTML = '';
    const pdfContainer = document.createElement('div');
    const viewer = document.createElement('div');
    document.body.appendChild(pdfContainer);
    pdfContainer.appendChild(viewer);
    pdfContainer.style = 'overflow: auto;position: absolute;width: 100%;height: 100%';
    pdfContainer.id = 'viewerContainer';

    viewer.id = 'viewer';
    viewer.className = 'pdfViewer';
  }

  static scrollPageIntoView(curPage) {
    const loadingIconTag = document.querySelector(`.page[data-page-number="${curPage}"] > .loadingIcon`);
    if (loadingIconTag) {
      loadingIconTag.scrollIntoView();
    }
  }

  // remainder of functions used for gatherer

  static getCelexRecords(searchText) {
    return [...[...document.querySelectorAll('.SearchResult')]
      .filter((a) => a.innerText.search(new RegExp(searchText, 'i')) !== -1)]
      .map((b) => ({
        celexID: [...b.querySelectorAll('dt')]
          .filter((c) => c.innerText === 'CELEX number: ').length
          ? [...b.querySelectorAll('dt')]
            .filter((c) => c.innerText === 'CELEX number: ')[0].nextSibling.innerText : undefined,
        date: [...b.querySelectorAll('dt')]
          .filter((c) => c.innerText === 'Date of document: ')[0].nextSibling.innerText,
      }));
  }

  static getResultsTotal() {
    return [...document.querySelectorAll('.checkbox > label > strong')][2].innerText;
  }

  static getNextButtonUrl() {
    const nextButtons = [...document.querySelectorAll('[title="Next Page"]')];
    if (nextButtons.length) {
      return nextButtons[0].href;
    }
    return undefined;
  }
}
