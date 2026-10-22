import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

function node(tag, value = "") {
  return {
    tag,
    textContent: value,
    children: [],
    attributes: {},
    listeners: {},
    append(...children) {
      for (const child of children) child.parent = this;
      this.children.push(...children);
    },
    replaceChildren(...children) { this.children = children; },
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener(name, callback) { this.listeners[name] = callback; },
    select() {},
    remove() {
      if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this);
    },
  };
}

function descendants(root, tag) {
  const found = [];
  if (root.tag === tag) found.push(root);
  for (const child of root.children) found.push(...descendants(child, tag));
  return found;
}

function allText(root) {
  return root.textContent + root.children.map(allText).join("");
}

function render(source, options = {}) {
  const window = { setTimeout() {} };
  const body = node("body");
  const document = {
    body,
    createElement: (tag) => node(tag),
    createTextNode: (value) => node("#text", value),
    execCommand: options.execCommand || (() => false),
  };
  runInNewContext(readFileSync(new URL("../public/markdown.js", import.meta.url), "utf8"), {
    window,
    document,
    navigator: { clipboard: options.writeText ? { writeText: options.writeText } : undefined },
    URL,
  });
  const root = node("div");
  window.renderMessageMarkdown(source, root);
  root.testBody = body;
  return root;
}

test("Markdown renders code and safe links without interpreting model HTML", () => {
  const root = render("# 标题\n\n<img src=x onerror=alert(1)> **重点** [文档](https://example.com/help) [恶意](javascript:evil)\n\n```js\nconst x = 1;\n```");

  assert.equal(descendants(root, "img").length, 0);
  assert.match(allText(root), /<img src=x onerror=alert\(1\)>/);
  assert.equal(descendants(root, "strong").length, 1);
  const links = descendants(root, "a");
  assert.equal(links.length, 1);
  assert.equal(links[0].href, "https://example.com/help");
  assert.equal(links[0].rel, "noopener noreferrer");
  assert.match(allText(root), /\[恶意\]\(javascript:evil\)/);
  assert.equal(descendants(root, "pre").length, 1);
  assert.match(allText(root), /const x = 1;/);
});

test("Markdown tables render aligned columns, inline text and safe links", () => {
  const root = render("| 名称 | 数量 | 说明 |\n| :--- | ---: | :---: |\n| **苹果** | 3 | [详情](https://example.com/apple) |\n| <img src=x onerror=alert(1)> | 4 | [危险](javascript:evil) |\n\n下一段");
  const tables = descendants(root, "table");
  assert.equal(tables.length, 1);
  assert.equal(descendants(root, "thead").length, 1);
  assert.equal(descendants(root, "tbody").length, 1);
  assert.equal(descendants(root, "th").length, 3);
  assert.equal(descendants(root, "td").length, 6);
  assert.equal(descendants(root, "th")[1].className, "markdown-align-right");
  assert.equal(descendants(root, "td")[2].className, "markdown-align-center");
  assert.equal(descendants(root, "strong").length, 1);
  assert.equal(descendants(root, "img").length, 0);
  assert.match(allText(root), /<img src=x onerror=alert\(1\)>/);
  assert.equal(descendants(root, "a").length, 1);
  assert.equal(descendants(root, "a")[0].href, "https://example.com/apple");
  assert.match(allText(root), /\[危险\]\(javascript:evil\)/);
  assert.match(allText(root.children.at(-1)), /下一段/);
});

test('Numbered instructions keep their starting number after a paragraph break', () => {
  const root=render('3. 第三步\n4. 第四步\n\n继续操作：\n\n7. 第七步');
  const lists=descendants(root,'ol');
  assert.equal(lists.length,2);
  assert.equal(lists[0].attributes.start,'3');
  assert.equal(lists[1].attributes.start,'7');
});

test('A table does not consume following headings, lists or quoted paragraphs', () => {
  const table='| 名称 | 值 |\n| --- | --- |\n| 原内容 | 保留 |\n';
  for(const [following,tag] of [['# 说明 | 请保留','h3'],['3. 步骤 | 请保留','ol'],['> 提醒 | 请保留','blockquote'],['```python title="a|b.py"\nprint("请保留")\n```','pre']]){
    const root=render(table+following);
    assert.equal(descendants(root,'td').length,2);
    assert.equal(descendants(root,tag).length,1);
    assert.match(allText(root.children.at(-1)),/请保留/);
  }
});

test('Code fences accept info text and keep the full source and copy action', async () => {
  const source='print("**code only**")\nvalue = 1 | 2';
  let copied;
  const root=render('```python title="example.py"\n'+source+'\n```',{writeText:async value=>{copied=value;}});
  assert.equal(descendants(root,'pre').length,1);
  assert.equal(descendants(root,'strong').length,0);
  assert.equal(descendants(root,'code')[0].textContent,source);
  await descendants(root,'button').find(b=>b.className==='markdown-code-copy').listeners.click();
  assert.equal(copied,source);
});

test("Malformed table delimiters remain text and fences do not become tables", () => {
  const root = render("A | B\n-- | ---\n\n```md\n| A | B |\n| --- | --- |\n```");
  assert.equal(descendants(root, "table").length, 0);
  assert.match(allText(root), /A \| B/);
  assert.equal(descendants(root, "pre").length, 1);
});

test("Only long code starts collapsed and the toolbar can expand it", () => {
  const short = render(`\`\`\`js\n${Array.from({ length: 16 }, (_, i) => `line ${i}`).join("\n")}\n\`\`\``);
  assert.equal(descendants(short, "pre").length, 1);
  assert.equal(short.children[0].className, "markdown-code-block");
  assert.equal(descendants(short, "button").length, 1);

  const long = render(`\`\`\`js\n${Array.from({ length: 17 }, (_, i) => `line ${i}`).join("\n")}\n\`\`\``);
  const block = long.children[0];
  const toggle = descendants(long, "button")[0];
  assert.equal(block.className, "markdown-code-block is-collapsed");
  assert.match(toggle.textContent, /展开代码/);
  assert.equal(toggle.attributes["aria-expanded"], "false");
  toggle.listeners.click();
  assert.equal(block.className, "markdown-code-block");
  assert.equal(toggle.textContent, "收起代码");
  assert.equal(toggle.attributes["aria-expanded"], "true");
  toggle.listeners.click();
  assert.equal(block.className, "markdown-code-block is-collapsed");

  const wide = render(`\`\`\`\n${"a".repeat(1201)}\n\`\`\``);
  assert.equal(wide.children[0].className, "markdown-code-block is-collapsed");
});

test("Collapsed code copies the full text when the Clipboard API is unavailable", async () => {
  const source = Array.from({ length: 18 }, (_, i) => `line ${i}`).join("\n");
  let copied = "";
  const root = render(`\`\`\`\n${source}\n\`\`\``, {
    execCommand: (command) => {
      assert.equal(command, "copy");
      copied = root.testBody.children[0].value;
      return true;
    },
  });
  const copy = descendants(root, "button").find((button) => button.className === "markdown-code-copy");
  await copy.listeners.click();
  assert.equal(copied, source);
  assert.equal(copy.textContent, "已复制");
  assert.equal(root.testBody.children.length, 0);
});

test("Code copy falls back when the Clipboard API rejects access", async () => {
  const root = render("```\nprivate text\n```", {
    writeText: async () => { throw new Error("denied"); },
    execCommand: () => true,
  });
  const copy = descendants(root, "button")[0];
  await copy.listeners.click();
  assert.equal(copy.textContent, "已复制");
  assert.equal(root.testBody.children.length, 0);
});

test("HTML and SVG code preview only loads on request inside a locked-down frame", () => {
  for (const language of ["html", "HTM", "SVG"]) {
    const source = "<img src=https://example.com/tracker><script>alert(1)</script><form action=https://example.com/post><button>send</button></form><svg><circle r=5 /></svg>";
    const root = render(`\`\`\`${language}\n${source}\n\`\`\``);
    const block = root.children[0];
    const button = descendants(root, "button").find((item) => item.className === "markdown-code-preview-toggle");
    assert.ok(button);
    assert.equal(descendants(root, "iframe").length, 0, "model markup must not load before an explicit preview click");
    assert.equal(descendants(root, "img").length, 0, "model markup must never enter the parent DOM");

    button.listeners.click();
    const frames = descendants(root, "iframe");
    assert.equal(frames.length, 1);
    assert.equal(block.className, "markdown-code-block is-preview");
    assert.equal(button.attributes["aria-pressed"], "true");
    assert.equal(frames[0].attributes.sandbox, "");
    assert.equal(frames[0].attributes.referrerpolicy, "no-referrer");
    assert.equal(frames[0].attributes.inert, "");
    assert.match(frames[0].srcdoc, /Content-Security-Policy/);
    for (const directive of ["default-src 'none'", "script-src 'none'", "connect-src 'none'", "img-src 'none'", "form-action 'none'", "object-src 'none'", "frame-src 'none'", "base-uri 'none'"]) {
      assert.ok(frames[0].srcdoc.includes(directive), `missing ${directive}`);
    }
    assert.ok(frames[0].srcdoc.indexOf("Content-Security-Policy") < frames[0].srcdoc.indexOf(source), "CSP must precede model markup");

    button.listeners.click();
    assert.equal(descendants(root, "iframe").length, 0, "closing preview must unload untrusted content");
    assert.equal(block.className, "markdown-code-block");
    assert.equal(button.attributes["aria-pressed"], "false");
    assert.equal(descendants(root, "pre").length, 1);
  }
});

test("Non-HTML code has no preview, and preview preserves copy and collapsed state", async () => {
  const js = render("```javascript\n<div>source only</div>\n```");
  assert.equal(descendants(js, "iframe").length, 0);
  assert.equal(descendants(js, "button").filter((item) => item.className === "markdown-code-preview-toggle").length, 0);

  const source = Array.from({ length: 17 }, (_, index) => `<p>line ${index}</p>`).join("\n");
  let copied;
  const html = render(`\`\`\`html\n${source}\n\`\`\``, { writeText: async (text) => { copied = text; } });
  const block = html.children[0];
  const buttons = descendants(html, "button");
  const preview = buttons.find((item) => item.className === "markdown-code-preview-toggle");
  const copy = buttons.find((item) => item.className === "markdown-code-copy");
  assert.equal(block.className, "markdown-code-block is-collapsed");
  preview.listeners.click();
  assert.equal(block.className, "markdown-code-block is-collapsed is-preview");
  await copy.listeners.click();
  assert.equal(copied, source);
  preview.listeners.click();
  assert.equal(block.className, "markdown-code-block is-collapsed");
});

test("Preview drops source meta refresh without changing visible or copied code", async () => {
  const source = `<meta http-equiv="refresh" content="0; url=https://example.com/track?a=>b"><p>safe preview</p>`;
  let copied;
  const root = render(`\`\`\`html\n${source}\n\`\`\``, { writeText: async (value) => { copied = value; } });
  const buttons = descendants(root, "button");
  await buttons.find((button) => button.className === "markdown-code-copy").listeners.click();
  assert.equal(copied, source);
  assert.equal(descendants(root, "code")[0].textContent, source);
  buttons.find((button) => button.className === "markdown-code-preview-toggle").listeners.click();
  const frame = descendants(root, "iframe")[0];
  assert.ok(!frame.srcdoc.includes("example.com/track"));
  assert.ok(frame.srcdoc.includes("<p>safe preview</p>"));
});
