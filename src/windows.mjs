export const chatDocuments = () => [document, ...[...(foundry.applications.detached?.windows?.values() ?? [])].map((w) => w.window?.document).filter(Boolean)];

export const queryAll = (selector) => chatDocuments().flatMap((doc) => [...doc.querySelectorAll(selector)]);

export const toggleBodyClass = (name, on) => {
  for (const doc of chatDocuments()) doc.body?.classList.toggle(name, on);
};

export const onEveryDocument = (bind) => {
  bind(document);
  Hooks.on('openDetachedWindow', (_id, win) => bind(win.document));
};
