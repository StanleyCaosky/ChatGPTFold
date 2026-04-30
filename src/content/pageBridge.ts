(() => {
  // Debug bridge is disabled by default in production.
  // To enable: set window.__LONGCONV_DEBUG_ENABLED__ = true before this script loads,
  // or use the development build which enables it automatically.
  if (!(window as any).__LONGCONV_DEBUG_ENABLED__) return;
  if ((window as any).__LONGCONV_DEBUG_BRIDGE__) return;

  (window as any).__LONGCONV_DEBUG_BRIDGE__ = {
    stats() {
      window.dispatchEvent(new CustomEvent('LONGCONV_CMD', { detail: 'stats' }));
    },
    selectors() {
      window.dispatchEvent(new CustomEvent('LONGCONV_CMD', { detail: 'selectors' }));
    },
    rescan() {
      window.dispatchEvent(new CustomEvent('LONGCONV_CMD', { detail: 'rescan' }));
    },
    clear() {
      window.dispatchEvent(new CustomEvent('LONGCONV_CMD', { detail: 'clear' }));
    },
  };

  console.debug('[LongConv] page debug bridge ready');
})();
