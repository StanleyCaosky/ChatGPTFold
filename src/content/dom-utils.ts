import { LONGCONV_PREFIX } from '../shared/constants';

export function asElement(node: Node): Element | null {
  if (node.nodeType === Node.ELEMENT_NODE) return node as Element;
  if (node.nodeType === Node.TEXT_NODE) return node.parentElement;
  return node.parentElement ?? null;
}

export function removeLongconvClasses(el: Element): void {
  const toRemove: string[] = [];
  for (const cls of el.classList) {
    if (cls.startsWith(LONGCONV_PREFIX)) {
      toRemove.push(cls);
    }
  }
  for (const cls of toRemove) {
    el.classList.remove(cls);
  }
}

export function isNearViewport(
  el: HTMLElement,
  margin: number,
  scrollRoot: HTMLElement
): boolean {
  const rect = el.getBoundingClientRect();
  const isDocScroller = scrollRoot === document.scrollingElement;
  if (isDocScroller) {
    return rect.top < window.innerHeight + margin && rect.bottom > -margin;
  }
  const rootRect = scrollRoot.getBoundingClientRect();
  return rect.top < rootRect.bottom + margin && rect.bottom > rootRect.top - margin;
}
