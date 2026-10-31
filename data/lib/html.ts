// A few helpers over parse5, which parses HTML as browsers do, for the
// scrapers: find elements, read their text.
import { type DefaultTreeAdapterTypes, parse } from "parse5";

export type Element = DefaultTreeAdapterTypes.Element;
type Node =
  DefaultTreeAdapterTypes.ChildNode | DefaultTreeAdapterTypes.Document;

export function parseHtml(html: string): DefaultTreeAdapterTypes.Document {
  return parse(html);
}

function isElement(node: Node): node is Element {
  return "tagName" in node;
}

function children(node: Node): Node[] {
  return "childNodes" in node ? node.childNodes : [];
}

/** Every element under node (not node itself) for which test is true, in
 * document order. */
export function findAll(
  node: Node,
  test: string | string[] | ((element: Element) => boolean),
): Element[] {
  const matches =
    typeof test === "function"
      ? test
      : (element: Element) =>
          typeof test === "string"
            ? element.tagName === test
            : test.includes(element.tagName);
  const found: Element[] = [];
  const walk = (parent: Node) => {
    for (const child of children(parent)) {
      if (!isElement(child)) continue;
      if (matches(child)) found.push(child);
      walk(child);
    }
  };
  walk(node);
  return found;
}

export function find(
  node: Node,
  test: string | string[] | ((element: Element) => boolean),
): Element | undefined {
  return findAll(node, test)[0];
}

export function attr(element: Element, name: string): string | undefined {
  return element.attrs.find((attribute) => attribute.name === name)?.value;
}

export function hasClass(element: Element, name: string): boolean {
  return (attr(element, "class") ?? "").split(/\s+/).includes(name);
}

// Text that is not the page's text, as BeautifulSoup's get_text() leaves it out
const NOT_TEXT = new Set(["script", "style", "template", "noscript"]);

/** The text nodes under node, in document order. */
export function strings(node: Node): string[] {
  const found: string[] = [];
  const walk = (parent: Node) => {
    for (const child of children(parent)) {
      if (child.nodeName === "#text") {
        found.push((child as DefaultTreeAdapterTypes.TextNode).value);
      } else if (isElement(child) && !NOT_TEXT.has(child.tagName)) {
        walk(child);
      }
    }
  };
  walk(node);
  return found;
}

/** The node's text nodes joined with separator, as BeautifulSoup's
 * get_text(separator). */
export function text(node: Node, separator = ""): string {
  return strings(node).join(separator);
}

/** The node's text with all whitespace runs (no-break spaces too) made one
 * space, trimmed: what a reader sees. */
export function normalizedText(node: Node): string {
  return text(node, " ").replace(/\s+/g, " ").trim();
}

/** The node's text nodes, each trimmed, the empty ones left out, joined with
 * one space: BeautifulSoup's get_text(" ", strip=True). */
export function strippedText(node: Node): string {
  return strings(node)
    .map((string) => string.trim())
    .filter(Boolean)
    .join(" ");
}
