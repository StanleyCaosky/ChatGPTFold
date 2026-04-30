import { STYLE_ELEMENT_ID } from '../shared/constants';
import contentCss from '../styles/content.css?inline';

export function injectStyles(): void {
  if (document.getElementById(STYLE_ELEMENT_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ELEMENT_ID;
  style.textContent = contentCss;
  document.head.appendChild(style);
}

export function removeStyles(): void {
  document.getElementById(STYLE_ELEMENT_ID)?.remove();
}
