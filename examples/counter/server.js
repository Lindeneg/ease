// Minimal HTTP server — serves the compiled counter component.
//
// Usage: node server.js
// Then open http://localhost:3000

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { renderToHtml } from "@ease/runtime";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

// Use file:// URLs for dynamic import (required on Windows)
const componentPath = pathToFileURL(resolve("dist", "counter.js")).href;
const component = await import(componentPath);

// Read static files to serve to the browser
const runtimeJs = readFileSync(
    resolve("..", "..", "packages", "runtime", "dist", "index.js"),
    "utf-8",
);
const componentJs = readFileSync(
    resolve("dist", "counter.js"),
    "utf-8",
);

function escapeAttr(s) {
    return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

const server = createServer((req, res) => {
    if (req.url === "/") {
        // Server-side render
        const { html, state } = renderToHtml(component);
        const stateAttr = escapeAttr(JSON.stringify(state));

        const page = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Ease Counter Example</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 600px; margin: 50px auto; }
    button { font-size: 1.2rem; padding: 0.5rem 1rem; margin: 0 0.25rem; cursor: pointer; }
    h1 { color: #333; }
  </style>
</head>
<body>
  <div id="app" data-ease-state="${stateAttr}">${html}</div>

  <script type="importmap">
  { "imports": { "@ease/runtime": "/runtime.js" } }
  </script>
  <script type="module" src="/component.js"></script>
  <script type="module">
    import { hydrate } from "@ease/runtime";
    import * as component from "/component.js";
    hydrate(document.getElementById("app"), component);
  </script>
</body>
</html>`;

        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(page);
        return;
    }

    if (req.url === "/runtime.js") {
        res.writeHead(200, { "Content-Type": "application/javascript" });
        res.end(runtimeJs);
        return;
    }

    if (req.url === "/component.js") {
        res.writeHead(200, { "Content-Type": "application/javascript" });
        res.end(componentJs);
        return;
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Counter example running at http://localhost:${PORT}`);
});
