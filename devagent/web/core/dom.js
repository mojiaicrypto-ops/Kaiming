/**
 * Small DOM helpers: build nodes, clear a region, listen once. Deliberately not a framework - the
 * design is the mock's, so what we need is honest node building plus the three update kinds the
 * architecture allows (append, replace-on-invalidate, local-only).
 */

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) {
      continue;
    }
    if (key === 'class') {
      node.className = value;
    } else if (key === 'text') {
      node.textContent = String(value);
    } else if (key === 'html') {
      node.innerHTML = value;
    } else if (key === 'dataset') {
      for (const [dataKey, dataValue] of Object.entries(value)) {
        node.dataset[dataKey] = String(dataValue);
      }
    } else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value === true) {
      node.setAttribute(key, '');
    } else {
      node.setAttribute(key, String(value));
    }
  }
  for (const child of Array.isArray(children) ? children : [children]) {
    if (child === undefined || child === null || child === false) {
      continue;
    }
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export const qs = (selector, root = document) => root.querySelector(selector);
export const qsa = (selector, root = document) => [...root.querySelectorAll(selector)];

/** Replace a region's content: the "replace-on-invalidate" update kind. */
export function replace(region, ...children) {
  if (region === null || region === undefined) {
    return;
  }
  region.replaceChildren(...children.filter((child) => child !== undefined && child !== null));
}

export function clear(region) {
  region?.replaceChildren();
}

export function on(node, event, handler, options) {
  node?.addEventListener(event, handler, options);
  return () => node?.removeEventListener(event, handler, options);
}

/** Run `handler` at most once per animation frame: coalesces a burst of stream deltas. */
export function rafSchedule(handler) {
  let scheduled = false;
  return () => {
    if (scheduled) {
      return;
    }
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      handler();
    });
  };
}

/** Human-readable relative time, used for message meta rows. */
export function relativeTime(iso) {
  if (typeof iso !== 'string' || iso === '') {
    return '';
  }
  const then = Date.parse(iso);
  if (Number.isNaN(then)) {
    return '';
  }
  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  return `${Math.round(minutes / 60)}h`;
}
