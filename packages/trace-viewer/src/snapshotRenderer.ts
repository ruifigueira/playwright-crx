/**
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type { FrameSnapshot, NodeSnapshot, RenderedFrameSnapshot, ResourceSnapshot } from '@trace/snapshot';

export class SnapshotRenderer {
  private _snapshots: FrameSnapshot[];
  private _index: number;
  readonly snapshotName: string | undefined;
  private _resources: ResourceSnapshot[];
  private _snapshot: FrameSnapshot;
  private _callId: string;

  constructor(resources: ResourceSnapshot[], snapshots: FrameSnapshot[], index: number) {
    this._resources = resources;
    this._snapshots = snapshots;
    this._index = index;
    this._snapshot = snapshots[index];
    this._callId = snapshots[index].callId;
    this.snapshotName = snapshots[index].snapshotName;
  }

  snapshot(): FrameSnapshot {
    return this._snapshots[this._index];
  }

  viewport(): { width: number, height: number } {
    return this._snapshots[this._index].viewport;
  }

  render(): RenderedFrameSnapshot {
    const visit = (n: NodeSnapshot, snapshotIndex: number, parentTag: string | undefined, parentAttrs: [string, string][] | undefined): string => {
      // Text node.
      if (typeof n === 'string') {
        const text = escapeText(n);
        // Best-effort Electron support: rewrite custom protocol in url() links in stylesheets.
        // Old snapshotter was sending lower-case.
        if (parentTag === 'STYLE' || parentTag === 'style')
          return rewriteURLsInStyleSheetForCustomProtocol(text);
        return text;
      }

      if (!(n as any)._string) {
        if (Array.isArray(n[0])) {
          // Node reference.
          const referenceIndex = snapshotIndex - n[0][0];
          if (referenceIndex >= 0 && referenceIndex <= snapshotIndex) {
            const nodes = snapshotNodes(this._snapshots[referenceIndex]);
            const nodeIndex = n[0][1];
            if (nodeIndex >= 0 && nodeIndex < nodes.length)
              (n as any)._string = visit(nodes[nodeIndex], referenceIndex, parentTag, parentAttrs);
          }
        } else if (typeof n[0] === 'string') {
          // Element node.
          const builder: string[] = [];
          builder.push('<', n[0]);
          const attrs = Object.entries(n[1] || {});
          const kCurrentSrcAttribute = '__playwright_current_src__';
          const isFrame = n[0] === 'IFRAME' || n[0] === 'FRAME';
          const isAnchor = n[0] === 'A';
          const isImg = n[0] === 'IMG';
          const isImgWithCurrentSrc = isImg && attrs.some(a => a[0] === kCurrentSrcAttribute);
          const isSourceInsidePictureWithCurrentSrc = n[0] === 'SOURCE' && parentTag === 'PICTURE' && parentAttrs?.some(a => a[0] === kCurrentSrcAttribute);
          for (const [attr, value] of attrs) {
            let attrName = attr;
            if (isFrame && attr.toLowerCase() === 'src') {
              // Never set relative URLs as <iframe src> - they start fetching frames immediately.
              attrName = '__playwright_src__';
            }
            if (isImg && attr === kCurrentSrcAttribute) {
              // Render currentSrc for images, so that trace viewer does not accidentally
              // resolve srcset to a different source.
              attrName = 'src';
            }
            if (['src', 'srcset'].includes(attr.toLowerCase()) && (isImgWithCurrentSrc || isSourceInsidePictureWithCurrentSrc)) {
              // Disable actual <img src>, <img srcset>, <source src> and <source srcset> if
              // we will be using the currentSrc instead.
              attrName = '_' + attrName;
            }
            let attrValue = value;
            if (isAnchor && attr.toLowerCase() === 'href')
              attrValue = 'link://' + value;
            else if (attr.toLowerCase() === 'href' || attr.toLowerCase() === 'src' || attr === kCurrentSrcAttribute)
              attrValue = rewriteURLForCustomProtocol(value);
            builder.push(' ', attrName, '="', escapeAttribute(attrValue), '"');
          }
          builder.push('>');
          for (let i = 2; i < n.length; i++)
            builder.push(visit(n[i], snapshotIndex, n[0], attrs));
          if (!autoClosing.has(n[0]))
            builder.push('</', n[0], '>');
          (n as any)._string = builder.join('');
        } else {
          // Why are we here? Let's not throw, just in case.
          (n as any)._string = '';
        }
      }
      return (n as any)._string;
    };

    const snapshot = this._snapshot;
    let html = visit(snapshot.html, this._index, undefined, undefined);
    if (!html)
      return { html: '', pageId: snapshot.pageId, frameId: snapshot.frameId, index: this._index };

    // Hide the document in order to prevent flickering. We will unhide once script has processed shadow.
    const prefix = snapshot.doctype ? `<!DOCTYPE ${snapshot.doctype}>` : '';
    html = prefix + [
      '<style>*,*::before,*::after { visibility: hidden }</style>',
      `<script>${snapshotScript(this._callId, this.snapshotName)}</script>`
    ].join('') + html;

    return { html, pageId: snapshot.pageId, frameId: snapshot.frameId, index: this._index };
  }

  resourceByUrl(url: string, method: string): ResourceSnapshot | undefined {
    const snapshot = this._snapshot;
    let sameFrameResource: ResourceSnapshot | undefined;
    let otherFrameResource: ResourceSnapshot | undefined;

    for (const resource of this._resources) {
      // Only use resources that received response before the snapshot.
      // Note that both snapshot time and request time are taken in the same Node process.
      if (typeof resource._monotonicTime === 'number' && resource._monotonicTime >= snapshot.timestamp)
        break;
      if (resource.response.status === 304) {
        // "Not Modified" responses are issued when browser requests the same resource
        // multiple times, meanwhile indicating that it has the response cached.
        //
        // When rendering the snapshot, browser most likely will not have the resource cached,
        // so we should respond with the real content instead, picking the last response that
        // is not 304.
        continue;
      }
      if (resource.request.url === url && resource.request.method === method) {
        // Pick the last resource with matching url - most likely it was used
        // at the time of snapshot, not the earlier aborted resource with the same url.
        if (resource._frameref === snapshot.frameId)
          sameFrameResource = resource;
        else
          otherFrameResource = resource;
      }
    }

    // First try locating exact resource belonging to this frame,
    // then fall back to resource with this URL to account for memory cache.
    let result = sameFrameResource ?? otherFrameResource;
    if (result && method.toUpperCase() === 'GET') {
      // Patch override if necessary.
      for (const o of snapshot.resourceOverrides) {
        if (url === o.url && o.sha1) {
          result = {
            ...result,
            response: {
              ...result.response,
              content: {
                ...result.response.content,
                _sha1: o.sha1,
              }
            },
          };
          break;
        }
      }
    }

    return result;
  }
}

const autoClosing = new Set(['AREA', 'BASE', 'BR', 'COL', 'COMMAND', 'EMBED', 'HR', 'IMG', 'INPUT', 'KEYGEN', 'LINK', 'MENUITEM', 'META', 'PARAM', 'SOURCE', 'TRACK', 'WBR']);
const escaped = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' };

function escapeAttribute(s: string): string {
  return s.replace(/[&<>"']/ug, char => (escaped as any)[char]);
}
function escapeText(s: string): string {
  return s.replace(/[&<]/ug, char => (escaped as any)[char]);
}

function snapshotNodes(snapshot: FrameSnapshot): NodeSnapshot[] {
  if (!(snapshot as any)._nodes) {
    const nodes: NodeSnapshot[] = [];
    const visit = (n: NodeSnapshot) => {
      if (typeof n === 'string') {
        nodes.push(n);
      } else if (typeof n[0] === 'string') {
        for (let i = 2; i < n.length; i++)
          visit(n[i]);
        nodes.push(n);
      }
    };
    visit(snapshot.html);
    (snapshot as any)._nodes = nodes;
  }
  return (snapshot as any)._nodes;
}

function snapshotScript(...targetIds: (string | undefined)[]) {
  function applyPlaywrightAttributes(unwrapPopoutUrl: (url: string) => string, ...targetIds: (string | undefined)[]) {
    const scrollTops: Element[] = [];
    const scrollLefts: Element[] = [];
    const targetElements: Element[] = [];

    const visit = (root: Document | ShadowRoot) => {
      // Collect all scrolled elements for later use.
      for (const e of root.querySelectorAll(`[__playwright_scroll_top_]`))
        scrollTops.push(e);
      for (const e of root.querySelectorAll(`[__playwright_scroll_left_]`))
        scrollLefts.push(e);

      for (const element of root.querySelectorAll(`[__playwright_value_]`)) {
        (element as HTMLInputElement | HTMLTextAreaElement).value = element.getAttribute('__playwright_value_')!;
        element.removeAttribute('__playwright_value_');
      }
      for (const element of root.querySelectorAll(`[__playwright_checked_]`)) {
        (element as HTMLInputElement).checked = element.getAttribute('__playwright_checked_') === 'true';
        element.removeAttribute('__playwright_checked_');
      }
      for (const element of root.querySelectorAll(`[__playwright_selected_]`)) {
        (element as HTMLOptionElement).selected = element.getAttribute('__playwright_selected_') === 'true';
        element.removeAttribute('__playwright_selected_');
      }

      for (const targetId of targetIds) {
        for (const target of root.querySelectorAll(`[__playwright_target__="${targetId}"]`)) {
          const style = (target as HTMLElement).style;
          style.outline = '2px solid #006ab1';
          style.backgroundColor = '#6fa8dc7f';
          targetElements.push(target);
        }
      }

      for (const iframe of root.querySelectorAll('iframe, frame')) {
        const src = iframe.getAttribute('__playwright_src__');
        if (!src) {
          iframe.setAttribute('src', 'data:text/html,<body style="background: #ddd"></body>');
        } else {
          // Retain query parameters to inherit name=, time=, showPoint= and other values from parent.
          const url = new URL(unwrapPopoutUrl(window.location.href));
          // We can be loading iframe from within iframe, reset base to be absolute.
          const index = url.pathname.lastIndexOf('/snapshot/');
          if (index !== -1)
            url.pathname = url.pathname.substring(0, index + 1);
          url.pathname += src.substring(1);
          iframe.setAttribute('src', url.toString());
        }
      }

      {
        const body = root.querySelector(`body[__playwright_custom_elements__]`);
        if (body && window.customElements) {
          const customElements = (body.getAttribute('__playwright_custom_elements__') || '').split(',');
          for (const elementName of customElements)
            window.customElements.define(elementName, class extends HTMLElement {});
        }
      }

      for (const element of root.querySelectorAll(`template[__playwright_shadow_root_]`)) {
        const template = element as HTMLTemplateElement;
        const shadowRoot = template.parentElement!.attachShadow({ mode: 'open' });
        shadowRoot.appendChild(template.content);
        template.remove();
        visit(shadowRoot);
      }

      if ('adoptedStyleSheets' in (root as any)) {
        const adoptedSheets: CSSStyleSheet[] = [...(root as any).adoptedStyleSheets];
        for (const element of root.querySelectorAll(`template[__playwright_style_sheet_]`)) {
          const template = element as HTMLTemplateElement;
          const sheet = new CSSStyleSheet();
          (sheet as any).replaceSync(template.getAttribute('__playwright_style_sheet_'));
          adoptedSheets.push(sheet);
        }
        (root as any).adoptedStyleSheets = adoptedSheets;
      }
    };

    const onLoad = () => {
      window.removeEventListener('load', onLoad);
      for (const element of scrollTops) {
        element.scrollTop = +element.getAttribute('__playwright_scroll_top_')!;
        element.removeAttribute('__playwright_scroll_top_');
      }
      for (const element of scrollLefts) {
        element.scrollLeft = +element.getAttribute('__playwright_scroll_left_')!;
        element.removeAttribute('__playwright_scroll_left_');
      }

      document.styleSheets[0].disabled = true;

      const search = new URL(window.location.href).searchParams;
      if (search.get('showPoint')) {
        for (const target of targetElements) {
          const pointElement = document.createElement('x-pw-pointer');
          pointElement.style.position = 'fixed';
          pointElement.style.backgroundColor = '#f44336';
          pointElement.style.width = '20px';
          pointElement.style.height = '20px';
          pointElement.style.borderRadius = '10px';
          pointElement.style.margin = '-10px 0 0 -10px';
          pointElement.style.zIndex = '2147483646';
          const box = target.getBoundingClientRect();
          pointElement.style.left = (box.left + box.width / 2) + 'px';
          pointElement.style.top = (box.top + box.height / 2) + 'px';
          document.documentElement.appendChild(pointElement);
        }
      }
    };

    const onDOMContentLoaded = () => visit(document);

    window.addEventListener('load', onLoad);
    window.addEventListener('DOMContentLoaded', onDOMContentLoaded);
  }

  return `\n(${applyPlaywrightAttributes.toString()})(${unwrapPopoutUrl.toString()}${targetIds.map(id => `, "${id}"`).join('')})`;
}


/**
 * Best-effort Electron support: rewrite custom protocol in DOM.
 * vscode-file://vscode-app/ -> https://pw-vscode-file--vscode-app/
 */
const schemas = ['about:', 'blob:', 'data:', 'file:', 'ftp:', 'http:', 'https:', 'mailto:', 'sftp:', 'ws:', 'wss:'];
const kLegacyBlobPrefix = 'http://playwright.bloburl/#';

export function rewriteURLForCustomProtocol(href: string): string {
  // Legacy support, we used to prepend this to blobs, strip it away.
  if (href.startsWith(kLegacyBlobPrefix))
    href = href.substring(kLegacyBlobPrefix.length);

  try {
    const url = new URL(href);
    // Sanitize URL.
    if (url.protocol === 'javascript:' || url.protocol === 'vbscript:')
      return 'javascript:void(0)';

    // Pass through if possible.
    const isBlob = url.protocol === 'blob:';
    if (!isBlob && schemas.includes(url.protocol))
      return href;

    // Rewrite blob and custom schemas.
    const prefix = 'pw-' + url.protocol.slice(0, url.protocol.length - 1);
    url.protocol = 'https:';
    url.hostname = url.hostname ? `${prefix}--${url.hostname}` : prefix;
    return url.toString();
  } catch {
    return href;
  }
}

/**
 * Best-effort Electron support: rewrite custom protocol in inline stylesheets.
 * vscode-file://vscode-app/ -> https://pw-vscode-file--vscode-app/
 */
const urlInCSSRegex = /url\(['"]?([\w-]+:)\/\//ig;

function rewriteURLsInStyleSheetForCustomProtocol(text: string): string {
  return text.replace(urlInCSSRegex, (match: string, protocol: string) => {
    const isBlob = protocol === 'blob:';
    if (!isBlob && schemas.includes(protocol))
      return match;
    return match.replace(protocol + '//', `https://pw-${protocol.slice(0, -1)}--`);
  });
}

// <base>/snapshot.html?r=<snapshotUrl> is used for "pop out snapshot" feature.
export function unwrapPopoutUrl(url: string) {
  const u = new URL(url);
  if (u.pathname.endsWith('/snapshot.html'))
    return u.searchParams.get('r')!;
  return url;
}
