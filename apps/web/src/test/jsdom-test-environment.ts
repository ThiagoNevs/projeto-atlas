import { JSDOM } from 'jsdom';

const domGlobalNames = [
  'window',
  'document',
  'navigator',
  'Window',
  'Document',
  'HTMLElement',
  'Element',
  'Node',
  'Text',
  'Event',
  'MouseEvent',
  'MutationObserver',
  'getComputedStyle',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'IS_REACT_ACT_ENVIRONMENT',
] as const;

type DomGlobalName = (typeof domGlobalNames)[number];

export interface JsdomTestEnvironment {
  container: HTMLDivElement;
  window: JSDOM['window'];
  cleanup: () => void;
}

export function createJsdomTestEnvironment(): JsdomTestEnvironment {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    pretendToBeVisual: true,
    url: 'http://localhost/',
  });
  const previousDescriptors = new Map<DomGlobalName, PropertyDescriptor | undefined>();

  const install = (name: DomGlobalName, value: unknown): void => {
    previousDescriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, {
      configurable: true,
      writable: true,
      value,
    });
  };

  install('window', dom.window);
  install('document', dom.window.document);
  install('navigator', dom.window.navigator);
  install('Window', dom.window.Window);
  install('Document', dom.window.Document);
  install('HTMLElement', dom.window.HTMLElement);
  install('Element', dom.window.Element);
  install('Node', dom.window.Node);
  install('Text', dom.window.Text);
  install('Event', dom.window.Event);
  install('MouseEvent', dom.window.MouseEvent);
  install('MutationObserver', dom.window.MutationObserver);
  install('getComputedStyle', dom.window.getComputedStyle.bind(dom.window));
  install('requestAnimationFrame', dom.window.requestAnimationFrame.bind(dom.window));
  install('cancelAnimationFrame', dom.window.cancelAnimationFrame.bind(dom.window));
  install('IS_REACT_ACT_ENVIRONMENT', true);

  const container = dom.window.document.createElement('div');
  dom.window.document.body.append(container);

  return {
    container,
    window: dom.window,
    cleanup: () => {
      container.remove();
      dom.window.close();

      for (const name of [...domGlobalNames].reverse()) {
        const previousDescriptor = previousDescriptors.get(name);
        if (previousDescriptor) Object.defineProperty(globalThis, name, previousDescriptor);
        else Reflect.deleteProperty(globalThis, name);
      }
    },
  };
}
