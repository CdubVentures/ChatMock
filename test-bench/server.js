const express = require("express");
const cors = require("cors");
const path = require("path");
const { createConfig } = require("./src/config");
const { ChatMockClient } = require("./src/services/chatmockClient");
const extractRouter = require("./src/routes/extract");

const config = createConfig(process.env);
const app = express();

app.disable("x-powered-by");
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

app.use((err, _req, res, next) => {
  if (err instanceof SyntaxError && "body" in err) {
    return res.status(400).json({ error: "Invalid JSON request body." });
  }
  return next(err);
});

app.locals.config = config;
app.locals.chatmockClient = new ChatMockClient({
  baseUrl: config.chatmockBaseUrl,
  timeoutMs: config.chatmockTimeoutMs,
  apiKey: config.chatmockApiKey
});

app.use("/api", extractRouter);
app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "eval-bench" });
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(config.port, () => {
  console.log(`Eval Bench running on http://0.0.0.0:${config.port}`);
});
