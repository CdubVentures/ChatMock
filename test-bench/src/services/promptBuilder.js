const EXTRACTION_SYSTEM_PROMPT = [
  "You are a strict data extraction assistant.",
  "Extract all meaningful structured details from unstructured user input.",
  "Return valid JSON only.",
  "JSON shape must be:",
  "{",
  '  "summary": "short summary",',
  '  "items": [',
  "    { \"field\": \"name\", \"value\": \"extracted value\", \"confidence\": \"high|medium|low\" }",
  "  ]",
  "}",
  "Use null when a value is unknown.",
  "Do not add markdown code fences."
].join(" ");

function buildExtractionMessages(inputText, options = {}) {
  const normalizedText = String(inputText || "");
  const imageDataUrl = typeof options.imageDataUrl === "string" ? options.imageDataUrl.trim() : "";
  const userContent = imageDataUrl
    ? [
      { type: "text", text: normalizedText },
      { type: "image_url", image_url: { url: imageDataUrl } }
    ]
    : normalizedText;

  return [
    {
      role: "system",
      content: EXTRACTION_SYSTEM_PROMPT
    },
    {
      role: "user",
      content: userContent
    }
  ];
}

module.exports = {
  buildExtractionMessages
};
