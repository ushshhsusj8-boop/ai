"use strict";

// Render a deliberately small Markdown subset with DOM nodes. Model output is
// untrusted text, so raw HTML is never interpreted as markup.
(function () {
  const inlinePattern = /\*\*([^*\n]+)\*\*|`([^`\n]+)`|\[([^\]\n]+)\]\(([^\s)]+)\)|\*([^*\n]+)\*/g;

  function appendInline(parent, source) {
    if (!window.plaudeMath) {appendPlainInline(parent, source);return;}
    for (const part of window.plaudeMath.segments(source)) {
      if (part.math) parent.append(window.plaudeMath.render(part));
      else appendPlainInline(parent, part.text);
    }
  }

  function appendPlainInline(parent, source) {
    let cursor = 0;
    for (const match of source.matchAll(inlinePattern)) {
      if (match.index > cursor) parent.append(document.createTextNode(source.slice(cursor, match.index)));

      let element;
      if (match[1]) {
        element = document.createElement("strong");
        element.textContent = match[1];
      } else if (match[2]) {
        element = document.createElement("code");
        element.textContent = match[2];
      } else if (match[3]) {
        try {
          const url = new URL(match[4]);
          if (url.protocol === "https:" || url.protocol === "http:") {
            element = document.createElement("a");
            element.href = url.href;
            element.target = "_blank";
            element.rel = "noopener noreferrer";
            element.textContent = match[3];
          }
        } catch {
          // An invalid or relative URL remains plain text.
        }
      } else if (match[5]) {
        element = document.createElement("em");
        element.textContent = match[5];
      }

      parent.append(element || document.createTextNode(match[0]));
      cursor = match.index + match[0].length;
    }
    if (cursor < source.length) parent.append(document.createTextNode(source.slice(cursor)));
  }

  function codeBlock(language, source) {
    const block = document.createElement("div");
    block.className = "markdown-code-block";
    const lineCount = source.split("\n").length;
    const isLong = lineCount > 16 || source.length > 1200;
    let expanded = !isLong;
    let showingPreview = false;
    const previewable = /^(?:html?|svg)$/i.test(language);
    // A meta refresh can navigate the iframe even when scripts and resources are
    // blocked, so omit meta tags from the preview while keeping the source intact.
    const previewMarkup = previewable ? source.replace(/<meta\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi, "") : "";
    function syncBlockClass() {
      block.className = `markdown-code-block${expanded ? "" : " is-collapsed"}${showingPreview ? " is-preview" : ""}`;
    }
    syncBlockClass();

    const toolbar = document.createElement("div");
    toolbar.className = "markdown-code-toolbar";
    const label = document.createElement("span");
    label.textContent = language || "代码";
    const actions = document.createElement("div");
    actions.className = "markdown-code-actions";
    if (isLong) {
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "markdown-code-toggle";
      toggle.textContent = `展开代码（${lineCount} 行）`;
      toggle.setAttribute("aria-expanded", "false");
      toggle.addEventListener("click", () => {
        expanded = !expanded;
        syncBlockClass();
        toggle.textContent = expanded ? "收起代码" : `展开代码（${lineCount} 行）`;
        toggle.setAttribute("aria-expanded", String(expanded));
      });
      actions.append(toggle);
    }
    if (/^(python|py|python3|java)$/i.test(language) && typeof window.openServerCode === 'function') {
      const run = document.createElement('button'); run.type = 'button'; run.className = 'markdown-code-run'; run.textContent = '运行';
      run.onclick = () => window.openServerCode(language, source); actions.append(run);
    }
    let preview;
    if (previewable) {
      const previewButton = document.createElement("button");
      previewButton.type = "button";
      previewButton.className = "markdown-code-preview-toggle";
      previewButton.textContent = "预览";
      previewButton.setAttribute("aria-pressed", "false");
      previewButton.addEventListener("click", () => {
        showingPreview = !showingPreview;
        syncBlockClass();
        previewButton.textContent = showingPreview ? "查看代码" : "预览";
        previewButton.setAttribute("aria-pressed", String(showingPreview));
        if (showingPreview) {
          const frame = document.createElement("iframe");
          frame.title = `${language.toUpperCase()} 静态预览`;
          frame.setAttribute("sandbox", "");
          frame.setAttribute("referrerpolicy", "no-referrer");
          frame.setAttribute("tabindex", "-1");
          frame.setAttribute("inert", "");
          frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; connect-src 'none'; img-src 'none'; media-src 'none'; font-src 'none'; frame-src 'none'; child-src 'none'; object-src 'none'; worker-src 'none'; form-action 'none'; base-uri 'none'; navigate-to 'none'; style-src 'unsafe-inline'"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>${previewMarkup}</body></html>`;
          preview.replaceChildren(frame);
        } else {
          preview.replaceChildren();
        }
      });
      actions.append(previewButton);
    }
    if (typeof window.openCodeArtifact === "function") {
      const open = document.createElement("button");
      open.type = "button";
      open.className = "markdown-code-open";
      open.textContent = previewable ? "侧栏预览" : "打开代码";
      open.addEventListener("click", () => window.openCodeArtifact(language, source));
      actions.append(open);
    }
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "markdown-code-copy";
    copy.textContent = "复制代码";
    copy.setAttribute("aria-label", "复制代码块");
    copy.addEventListener("click", async () => {
      try {
        let copied = false;
        if (navigator.clipboard?.writeText) {
          try {
            await navigator.clipboard.writeText(source);
            copied = true;
          } catch {
            // Some browsers expose the API but deny clipboard access.
          }
        }
        if (!copied) {
          const textarea = document.createElement("textarea");
          textarea.value = source;
          textarea.setAttribute("readonly", "");
          textarea.className = "clipboard-helper";
          document.body.append(textarea);
          try {
            textarea.select();
            if (!document.execCommand("copy")) throw new Error("Copy failed");
          } finally {
            textarea.remove();
          }
        }
        copy.textContent = "已复制";
        window.setTimeout(() => { copy.textContent = "复制代码"; }, 1800);
      } catch {
        copy.textContent = "复制失败";
        window.setTimeout(() => { copy.textContent = "复制代码"; }, 1800);
      }
    });
    actions.append(copy);
    toolbar.append(label, actions);

    const pre = document.createElement("pre");
    const code = document.createElement("code");
    code.textContent = source;
    pre.append(code);
    block.append(toolbar, pre);
    if (previewable) {
      preview = document.createElement("div");
      preview.className = "markdown-code-preview";
      block.append(preview);
    }
    return block;
  }

  function tableCells(line) {
    let content = line.trim();
    if (content.startsWith("|")) content = content.slice(1);
    if (content.endsWith("|") && !content.endsWith("\\|")) content = content.slice(0, -1);

    const cells = [];
    let cell = "";
    for (let index = 0; index < content.length; index += 1) {
      if (content[index] === "\\" && content[index + 1] === "|") {
        cell += "|";
        index += 1;
      } else if (content[index] === "|") {
        cells.push(cell.trim());
        cell = "";
      } else {
        cell += content[index];
      }
    }
    cells.push(cell.trim());
    return cells;
  }

  function tableAlignments(line, columnCount) {
    if (!line.includes("|")) return null;
    const cells = tableCells(line);
    if (cells.length !== columnCount || !cells.every((cell) => /^:?-{3,}:?$/.test(cell))) return null;
    return cells.map((cell) => cell.startsWith(":") && cell.endsWith(":") ? "center"
      : cell.endsWith(":") ? "right" : "left");
  }

  function tableBlock(headers, alignments, rows) {
    const wrapper = document.createElement("div");
    wrapper.className = "markdown-table-wrap";
    const table = document.createElement("table");
    const head = document.createElement("thead");
    const headingRow = document.createElement("tr");
    headers.forEach((header, index) => {
      const cell = document.createElement("th");
      cell.setAttribute("scope", "col");
      cell.className = `markdown-align-${alignments[index]}`;
      appendInline(cell, header);
      headingRow.append(cell);
    });
    head.append(headingRow);
    const body = document.createElement("tbody");
    rows.forEach((row) => {
      const tableRow = document.createElement("tr");
      headers.forEach((_, index) => {
        const cell = document.createElement("td");
        cell.className = `markdown-align-${alignments[index]}`;
        appendInline(cell, row[index] || "");
        tableRow.append(cell);
      });
      body.append(tableRow);
    });
    table.append(head, body);
    wrapper.append(table);
    if (window.plaudeTableExport) {
      const toolbar = document.createElement('div');toolbar.className='markdown-table-tools';
      const download = document.createElement('button');download.type='button';
      download.className='text-button';download.textContent='下载表格 CSV';
      download.addEventListener('click',()=>window.plaudeTableExport.download([headers,...rows.map(row=>headers.map((_,i)=>row[i]||''))]));
      toolbar.append(download);wrapper.append(toolbar);
    }
    return wrapper;
  }

  function openingFence(line) {
    const match=/^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    // Backticks in a backtick fence's info string are ambiguous Markdown.
    if (!match || match[1][0]==='`' && match[2].includes('`')) return null;
    return {marker:match[1][0],length:match[1].length,language:/^([\w.+-]+)/.exec(match[2].trim())?.[1] || ''};
  }

  function startsBlock(line) {
    return openingFence(line) || /^\s{0,3}(?:#{1,4}\s|>\s?|[-*+]\s+|\d+\.\s+)/.test(line);
  }

  function renderMessageMarkdown(source, container) {
    container.replaceChildren();
    const lines = String(source).replace(/\r\n?/g, "\n").split("\n");
    let paragraph = [];
    let list;
    let listType = "";
    let quote = [];

    function flushParagraph() {
      if (!paragraph.length) return;
      const element = document.createElement("p");
      appendInline(element, paragraph.join("\n"));
      container.append(element);
      paragraph = [];
    }

    function flushList() {
      if (list) container.append(list);
      list = undefined;
      listType = "";
    }

    function flushQuote() {
      if (!quote.length) return;
      const element = document.createElement("blockquote");
      appendInline(element, quote.join("\n"));
      container.append(element);
      quote = [];
    }

    function flushAll() {
      flushParagraph();
      flushList();
      flushQuote();
    }

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const fence = openingFence(line);
      if (fence) {
        flushAll();
        const marker = fence.marker;
        const minimumLength = fence.length;
        const codeLines = [];
        while (index + 1 < lines.length) {
          index += 1;
          if (new RegExp(`^\\s{0,3}${marker}{${minimumLength},}\\s*$`).test(lines[index])) break;
          codeLines.push(lines[index]);
        }
        container.append(codeBlock(fence.language, codeLines.join("\n")));
        continue;
      }

      const mathBlock=window.plaudeMath?.blockAt(lines,index);
      if(mathBlock){flushAll();container.append(window.plaudeMath.render(mathBlock.part));index=mathBlock.end;continue;}

      if (!line.trim()) {
        flushAll();
        continue;
      }

      if (index + 1 < lines.length && line.includes("|")) {
        const headers = tableCells(line);
        const alignments = tableAlignments(lines[index + 1], headers.length);
        if (alignments) {
          flushAll();
          const rows = [];
          let next = index + 2;
          while (next < lines.length && lines[next].trim() && lines[next].includes("|") && !startsBlock(lines[next])) {
            rows.push(tableCells(lines[next]));
            next += 1;
          }
          container.append(tableBlock(headers, alignments, rows));
          index = next - 1;
          continue;
        }
      }

      const heading = /^\s{0,3}(#{1,4})\s+(.+?)\s*$/.exec(line);
      if (heading) {
        flushAll();
        const element = document.createElement(`h${Math.min(heading[1].length + 2, 6)}`);
        appendInline(element, heading[2]);
        container.append(element);
        continue;
      }

      if (/^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
        flushAll();
        container.append(document.createElement("hr"));
        continue;
      }

      const listItem = /^\s{0,3}(?:([-*+])|(\d+\.))\s+(.+)$/.exec(line);
      if (listItem) {
        flushParagraph();
        flushQuote();
        const nextType = listItem[1] ? "ul" : "ol";
        if (list && listType !== nextType) flushList();
        if (!list) {
          list = document.createElement(nextType);
          listType = nextType;
          if(nextType==='ol'){
            const start=Number.parseInt(listItem[2],10);
            if(Number.isSafeInteger(start)&&start>=0&&start<=2147483647)list.setAttribute('start',String(start));
          }
        }
        const item = document.createElement("li");
        appendInline(item, listItem[3]);
        list.append(item);
        continue;
      }

      const quoted = /^\s{0,3}>\s?(.*)$/.exec(line);
      if (quoted) {
        flushParagraph();
        flushList();
        quote.push(quoted[1]);
        continue;
      }

      flushList();
      flushQuote();
      paragraph.push(line);
    }
    flushAll();
  }

  window.renderMessageMarkdown = renderMessageMarkdown;
})();
