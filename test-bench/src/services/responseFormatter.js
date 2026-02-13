const { marked } = require("marked");
const sanitizeHtml = require("sanitize-html");

function escapeHtml(input) {
  const text = String(input ?? "");
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function extractAssistantText(rawCompletion) {
  const choice = rawCompletion && Array.isArray(rawCompletion.choices) ? rawCompletion.choices[0] : null;
  if (!choice || !choice.message) {
    return "";
  }

  const { content } = choice.message;
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (!part || typeof part !== "object") {
          return "";
        }
        if (typeof part.text === "string") {
          return part.text;
        }
        if (typeof part.content === "string") {
          return part.content;
        }
        return "";
      })
      .join("\n")
      .trim();
  }

  return "";
}

function parseModelJson(rawText) {
  const direct = String(rawText || "").trim();
  if (!direct) {
    return null;
  }

  try {
    return JSON.parse(direct);
  } catch (_ignored) {
    // Continue and try fenced JSON.
  }

  const match = direct.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (!match || !match[1]) {
    return null;
  }

  try {
    return JSON.parse(match[1].trim());
  } catch (_ignored) {
    return null;
  }
}

function buildRowsFromData(parsed) {
  if (Array.isArray(parsed)) {
    return parsed.filter((row) => row && typeof row === "object");
  }

  if (parsed && typeof parsed === "object") {
    if (Array.isArray(parsed.items)) {
      return parsed.items.filter((row) => row && typeof row === "object");
    }

    return [parsed];
  }

  return [];
}

function unionColumns(rows) {
  const seen = new Set();
  const columns = [];

  rows.forEach((row) => {
    Object.keys(row).forEach((key) => {
      if (!seen.has(key)) {
        seen.add(key);
        columns.push(key);
      }
    });
  });

  return columns;
}

function renderTableHtml(rows, columns) {
  if (!rows.length || !columns.length) {
    return "";
  }

  const headCells = columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("");
  const bodyRows = rows
    .map((row) => {
      const cells = columns
        .map((column) => {
          const value = row[column];
          if (value === null || value === undefined) {
            return "<td><span class=\"empty-cell\">null</span></td>";
          }
          if (typeof value === "object") {
            return `<td><code>${escapeHtml(JSON.stringify(value))}</code></td>`;
          }
          return `<td>${escapeHtml(String(value))}</td>`;
        })
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");

  return [
    "<div class=\"table-wrap\">",
    "<table class=\"result-table\">",
    `<thead><tr>${headCells}</tr></thead>`,
    `<tbody>${bodyRows}</tbody>`,
    "</table>",
    "</div>"
  ].join("");
}

function renderMarkdownHtml(markdown) {
  const rawHtml = marked.parse(markdown || "");
  return sanitizeHtml(rawHtml, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(["h1", "h2", "h3", "table", "thead", "tbody", "tr", "th", "td", "code", "pre"]),
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      th: ["align"],
      td: ["align"],
      code: ["class"]
    }
  });
}

function formatAssistantOutput(rawCompletion) {
  const assistantText = extractAssistantText(rawCompletion);
  const parsedJson = parseModelJson(assistantText);

  if (parsedJson) {
    const rows = buildRowsFromData(parsedJson);
    const columns = unionColumns(rows);
    const summary = parsedJson && typeof parsedJson === "object" ? parsedJson.summary : null;

    return {
      assistantText,
      parsedJson,
      mode: "table",
      renderedHtml:
        (summary ? `<p class="summary-text">${escapeHtml(summary)}</p>` : "") +
        renderTableHtml(rows, columns) +
        `<details class="parsed-json"><summary>Parsed JSON</summary><pre>${escapeHtml(
          JSON.stringify(parsedJson, null, 2)
        )}</pre></details>`
    };
  }

  return {
    assistantText,
    parsedJson: null,
    mode: "markdown",
    renderedHtml: renderMarkdownHtml(assistantText)
  };
}

module.exports = {
  formatAssistantOutput
};
