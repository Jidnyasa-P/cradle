const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..");
const IGNORED_DIRS = new Set(["node_modules", ".git", ".vscode"]);
const TARGET_EXTS = new Set([".html"]);
const INTERACTIVE_ROLES = new Set([
  "button",
  "checkbox",
  "combobox",
  "link",
  "listbox",
  "menuitem",
  "option",
  "radio",
  "searchbox",
  "slider",
  "spinbutton",
  "switch",
  "tab",
  "textbox",
]);
const INPUT_TYPES_WITH_VALUE_NAME = new Set(["button", "submit", "reset"]);
const IGNORED_INPUT_TYPES = new Set(["hidden"]);

function toPosixPath(filePath) {
  return filePath.replace(/\\/g, "/");
}

function getFiles(dir) {
  let results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry.name)) continue;

    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      results = results.concat(getFiles(fullPath));
    } else if (
      entry.isFile() &&
      TARGET_EXTS.has(path.extname(entry.name).toLowerCase())
    ) {
      results.push(fullPath);
    }
  }

  return results;
}

function stripTags(value) {
  return value
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ");
}

function decodeEntities(value) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([a-f0-9]+);/gi, (_, code) =>
      String.fromCharCode(parseInt(code, 16))
    );
}

function normalizeText(value = "") {
  return decodeEntities(stripTags(value)).replace(/\s+/g, " ").trim();
}

function hasMeaningfulText(value) {
  return /[\p{L}\p{N}]/u.test(normalizeText(value));
}

function parseAttributes(rawAttributes = "") {
  const attributes = {};
  const attrRegex =
    /([:\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match;

  while ((match = attrRegex.exec(rawAttributes)) !== null) {
    const name = match[1].toLowerCase();
    attributes[name] = match[2] ?? match[3] ?? match[4] ?? "";
  }

  return attributes;
}

function getLineNumber(content, index) {
  return content.slice(0, index).split("\n").length;
}

function buildIdTextMap(content) {
  const idTextMap = new Map();
  const tagRegex = /<([a-z][\w:-]*)\b([^>]*)>/gi;
  let match;

  while ((match = tagRegex.exec(content)) !== null) {
    const tagName = match[1].toLowerCase();
    const rawAttributes = match[2] || "";
    const attributes = parseAttributes(rawAttributes);

    if (!attributes.id) continue;

    const endIndex = tagRegex.lastIndex;
    const innerHtml = getElementInnerHtml(content, tagName, endIndex);
    const text =
      tagName === "input" || tagName === "textarea" || tagName === "select"
        ? attributes.value || attributes.placeholder || attributes["aria-label"]
        : normalizeText(innerHtml);

    if (hasMeaningfulText(text)) {
      idTextMap.set(attributes.id, text);
    }
  }

  return idTextMap;
}

function buildLabelMap(content) {
  const labelMap = new Map();
  const labelRegex = /<label\b([^>]*)>([\s\S]*?)<\/label>/gi;
  let match;

  while ((match = labelRegex.exec(content)) !== null) {
    const attributes = parseAttributes(match[1]);
    const text = normalizeText(match[2]);

    if (attributes.for && hasMeaningfulText(text)) {
      labelMap.set(attributes.for, text);
    }
  }

  return labelMap;
}

function getLabelWrappingText(content, elementStartIndex, elementEndIndex) {
  const beforeElement = content.slice(0, elementStartIndex);
  const lastOpenLabelIndex = beforeElement.toLowerCase().lastIndexOf("<label");
  const lastCloseLabelIndex = beforeElement
    .toLowerCase()
    .lastIndexOf("</label>");

  if (lastOpenLabelIndex === -1 || lastOpenLabelIndex < lastCloseLabelIndex) {
    return "";
  }

  const closeLabelIndex = content
    .toLowerCase()
    .indexOf("</label>", elementEndIndex);

  if (closeLabelIndex === -1) return "";

  return normalizeText(
    content.slice(lastOpenLabelIndex, elementStartIndex) +
      content.slice(elementEndIndex, closeLabelIndex)
  );
}

function getElementInnerHtml(content, tagName, startIndex) {
  if (["input", "br", "hr", "img", "meta", "link"].includes(tagName)) {
    return "";
  }

  const closeTag = `</${tagName}>`;
  const closeIndex = content.toLowerCase().indexOf(closeTag, startIndex);

  if (closeIndex === -1) return "";

  return content.slice(startIndex, closeIndex);
}

function hasAccessibleName(element, context) {
  const { attributes, innerHtml, startIndex, endIndex } = element;

  if (hasMeaningfulText(attributes["aria-label"])) return true;

  if (attributes["aria-labelledby"]) {
    const ids = attributes["aria-labelledby"].split(/\s+/).filter(Boolean);
    if (ids.some(id => hasMeaningfulText(context.idTextMap.get(id)))) {
      return true;
    }
  }

  if (hasMeaningfulText(attributes.title)) return true;
  if (hasMeaningfulText(attributes.alt)) return true;

  if (attributes.id && hasMeaningfulText(context.labelMap.get(attributes.id))) {
    return true;
  }

  if (
    hasMeaningfulText(
      getLabelWrappingText(context.content, startIndex, endIndex)
    )
  ) {
    return true;
  }

  if (hasMeaningfulText(innerHtml)) return true;

  if (
    element.tagName === "input" &&
    INPUT_TYPES_WITH_VALUE_NAME.has(
      (attributes.type || "text").toLowerCase()
    ) &&
    hasMeaningfulText(attributes.value)
  ) {
    return true;
  }

  return hasMeaningfulText(attributes.placeholder);
}

function isInteractiveElement(tagName, attributes) {
  const normalizedTag = tagName.toLowerCase();

  if ("disabled" in attributes || attributes["aria-hidden"] === "true") {
    return false;
  }

  if (normalizedTag === "input") {
    const type = (attributes.type || "text").toLowerCase();
    return !IGNORED_INPUT_TYPES.has(type);
  }

  if (["button", "select", "textarea", "summary"].includes(normalizedTag)) {
    return true;
  }

  if (normalizedTag === "a") return Boolean(attributes.href);
  if (INTERACTIVE_ROLES.has((attributes.role || "").toLowerCase())) return true;
  if (attributes.tabindex && attributes.tabindex !== "-1") return true;

  return false;
}

function parseInteractiveElements(content) {
  const elements = [];
  const tagRegex = /<([a-z][\w:-]*)\b([^>]*)>/gi;
  let match;

  while ((match = tagRegex.exec(content)) !== null) {
    const tagName = match[1].toLowerCase();
    const rawAttributes = match[2] || "";
    const attributes = parseAttributes(rawAttributes);

    if (!isInteractiveElement(tagName, attributes)) continue;

    const endIndex = tagRegex.lastIndex;
    elements.push({
      tagName,
      attributes,
      innerHtml: getElementInnerHtml(content, tagName, endIndex),
      lineNumber: getLineNumber(content, match.index),
      startIndex: match.index,
      endIndex,
    });
  }

  return elements;
}

function validateAccessibleLabelsInContent(content, source = "inline") {
  const context = {
    content,
    idTextMap: buildIdTextMap(content),
    labelMap: buildLabelMap(content),
  };

  return parseInteractiveElements(content)
    .filter(element => !hasAccessibleName(element, context))
    .map(element => ({
      source,
      line: element.lineNumber,
      tagName: element.tagName,
      id: element.attributes.id || "",
      className: element.attributes.class || "",
      message: `<${element.tagName}> is missing an accessible name. Add visible text, a <label>, aria-label, aria-labelledby, title, alt, value, or placeholder.`,
    }));
}

function validateAccessibleLabels(repoRoot = REPO_ROOT) {
  return getFiles(repoRoot).flatMap(filePath => {
    const content = fs.readFileSync(filePath, "utf8");
    const source = toPosixPath(path.relative(repoRoot, filePath));
    return validateAccessibleLabelsInContent(content, source);
  });
}

function main() {
  console.log(
    "Scanning interactive elements for accessible names and labels..."
  );
  const issues = validateAccessibleLabels();

  if (issues.length > 0) {
    console.error(`\nFound ${issues.length} accessible label issue(s):\n`);

    for (const issue of issues) {
      const selector = [
        issue.id ? `#${issue.id}` : "",
        issue.className ? `.${issue.className.split(/\s+/).join(".")}` : "",
      ].join("");

      console.error(
        `  - ${issue.source}:${issue.line} <${issue.tagName}>${selector} ${issue.message}`
      );
    }

    process.exit(1);
  }

  console.log("\nAll interactive elements have accessible names.");
}

if (require.main === module) {
  main();
}

module.exports = {
  buildIdTextMap,
  buildLabelMap,
  getFiles,
  hasAccessibleName,
  isInteractiveElement,
  parseAttributes,
  parseInteractiveElements,
  validateAccessibleLabels,
  validateAccessibleLabelsInContent,
};
