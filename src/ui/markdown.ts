// Minimal markdown -> HTML: headings, bold/italic, inline code, fenced code blocks, lists, links.
// Deliberately small (no dependency) — enough to render the mock model's `plain` scenario output
// (headings, a bullet list, a fenced ```ts block) legibly. Not a general-purpose renderer.
function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function inline(text: string): string {
  let out = escapeHtml(text);
  out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" rel="noopener">$1</a>');
  return out;
}

export function renderMarkdown(source: string): string {
  const lines = source.split("\n");
  const html: string[] = [];
  let inCodeBlock = false;
  let codeLang = "";
  let codeLines: string[] = [];
  let inList = false;

  const closeList = () => {
    if (inList) {
      html.push("</ul>");
      inList = false;
    }
  };

  for (const line of lines) {
    const fence = /^```(\w*)\s*$/.exec(line);
    if (fence) {
      if (!inCodeBlock) {
        closeList();
        inCodeBlock = true;
        codeLang = fence[1] ?? "";
        codeLines = [];
      } else {
        html.push(`<pre class="code-block" data-lang="${escapeHtml(codeLang)}"><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
        inCodeBlock = false;
      }
      continue;
    }
    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      closeList();
      const level = heading[1]!.length;
      html.push(`<h${level}>${inline(heading[2]!)}</h${level}>`);
      continue;
    }
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      if (!inList) {
        html.push("<ul>");
        inList = true;
      }
      html.push(`<li>${inline(bullet[1]!)}</li>`);
      continue;
    }
    closeList();
    if (line.trim().length === 0) continue;
    html.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  if (inCodeBlock) html.push(`<pre class="code-block"><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
  return html.join("\n");
}
