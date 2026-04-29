declare global {
  // eslint-disable-next-line no-var
  var crawlAbortControllers: Map<string, AbortController>;
}

if (!global.crawlAbortControllers) {
  global.crawlAbortControllers = new Map();
}

const controllers = global.crawlAbortControllers;

export function startJobAbortController(jobId: string): AbortSignal {
  // Replace any existing controller for the same jobId.
  const controller = new AbortController();
  controllers.set(jobId, controller);
  return controller.signal;
}

export function stopJobAbortController(jobId: string): boolean {
  const controller = controllers.get(jobId);
  if (!controller) return false;
  controller.abort();
  controllers.delete(jobId);
  return true;
}

export function clearJobAbortController(jobId: string) {
  controllers.delete(jobId);
}

export function getJobAbortSignal(jobId: string): AbortSignal | undefined {
  return controllers.get(jobId)?.signal;
}

