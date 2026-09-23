export const PDFJS_WORKER_URL = "/api/pdfjs-worker";

export function configurePdfWorker(pdfjs: { GlobalWorkerOptions: { workerSrc: string } }) {
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
  }
}
