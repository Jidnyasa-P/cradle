const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildLabelMap,
  isInteractiveElement,
  parseAttributes,
  parseInteractiveElements,
  validateAccessibleLabelsInContent,
} = require("../scripts/validate-accessible-labels");

test("parseAttributes reads quoted, unquoted, and boolean attributes", () => {
  assert.deepEqual(
    parseAttributes("id=\"save\" class='btn primary' data-active disabled"),
    {
      id: "save",
      class: "btn primary",
      "data-active": "",
      disabled: "",
    }
  );
});

test("isInteractiveElement detects native controls and ARIA roles", () => {
  assert.equal(isInteractiveElement("button", {}), true);
  assert.equal(isInteractiveElement("a", { href: "index.html" }), true);
  assert.equal(isInteractiveElement("input", { type: "text" }), true);
  assert.equal(isInteractiveElement("input", { type: "hidden" }), false);
  assert.equal(isInteractiveElement("div", { role: "button" }), true);
  assert.equal(isInteractiveElement("div", { tabindex: "0" }), true);
  assert.equal(isInteractiveElement("button", { disabled: "" }), false);
});

test("buildLabelMap collects explicit labels by for attribute", () => {
  const labels = buildLabelMap(`
    <label for="email">Email address</label>
    <input id="email" />
  `);

  assert.equal(labels.get("email"), "Email address");
});

test("parseInteractiveElements extracts interactive controls with line numbers", () => {
  const elements = parseInteractiveElements(`
    <main>
      <button type="button">Save</button>
      <a href="index.html">Home</a>
      <input id="email" />
    </main>
  `);

  assert.equal(elements.length, 3);
  assert.equal(elements[0].tagName, "button");
  assert.equal(elements[0].lineNumber, 3);
});

test("validateAccessibleLabelsInContent accepts visible text and ARIA labels", () => {
  const issues = validateAccessibleLabelsInContent(`
    <button type="button">Save</button>
    <button type="button" aria-label="Close dialog">×</button>
    <a href="index.html" title="Back to home"></a>
    <div role="button" aria-labelledby="delete-label"></div>
    <span id="delete-label">Delete item</span>
  `);

  assert.deepEqual(issues, []);
});

test("validateAccessibleLabelsInContent accepts form labels and placeholders", () => {
  const issues = validateAccessibleLabelsInContent(`
    <label for="name">Name</label>
    <input id="name" />
    <label>Search <input type="search" /></label>
    <textarea placeholder="Notes"></textarea>
    <input type="submit" value="Send" />
  `);

  assert.deepEqual(issues, []);
});

test("validateAccessibleLabelsInContent reports unnamed controls", () => {
  const issues = validateAccessibleLabelsInContent(
    `
    <button type="button">×</button>
    <a href="index.html"></a>
    <input id="missing" />
  `,
    "sample.html"
  );

  assert.equal(issues.length, 3);
  assert.deepEqual(
    issues.map(issue => `${issue.source}:${issue.line}:${issue.tagName}`),
    ["sample.html:2:button", "sample.html:3:a", "sample.html:4:input"]
  );
});
