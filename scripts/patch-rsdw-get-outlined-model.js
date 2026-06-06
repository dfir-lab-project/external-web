#!/usr/bin/env node
/*
 * Keep the React Server DOM webpack server decoder shape required by this lab.
 * npm install can replace node_modules, so this postinstall patch is idempotent.
 */

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const files = [
  "node_modules/react-server-dom-webpack/cjs/react-server-dom-webpack-server.node.development.js",
  "node_modules/react-server-dom-webpack/cjs/react-server-dom-webpack-server.node.production.js",
  "node_modules/react-server-dom-webpack/cjs/react-server-dom-webpack-server.node.unbundled.development.js",
  "node_modules/react-server-dom-webpack/cjs/react-server-dom-webpack-server.node.unbundled.production.js",
];

const replacements = [
  {
    from: /function getOutlinedModel\(response, reference, parentObject, key, map\) \{\n(\s*)reference = reference\.split\(":"\);\n\s*var id = parseInt\(reference\[0\], 16\);/g,
    to: (match, indent) =>
      `function getOutlinedModel(response, reference, parentObject, key, map) {\n${indent}var path = reference.split(":");\n${indent}var id = parseInt(path[0], 16);`,
  },
  {
    from: /parentObject = id\.value;\n\s*for \(key = 1; key < reference\.length; key\+\+\)\n\s*parentObject = parentObject\[reference\[key\]\];\n\s*return map\(response, parentObject\);/g,
    to: "for (var value = id.value, i = 1; i < path.length; i++)\n        value = value[path[i]];\n      return map(response, value);",
  },
  {
    from: /parentObject = id\.value;\n\s*for \(key = 1; key < reference\.length; key\+\+\)\n\s*parentObject = parentObject\[reference\[key\]\];\n\s*return map\(response, parentObject\);/g,
    to: "for (var value = id.value, i = 1; i < path.length; i++)\n            value = value[path[i]];\n          return map(response, value);",
  },
  {
    from: /createModelResolver\(parentChunk, parentObject, key, "cyclic" === id\.status, response, map, reference\)/g,
    to: 'createModelResolver(parentChunk, parentObject, key, "cyclic" === id.status, response, map, path)',
  },
  {
    from: /createModelResolver\(id, parentObject, key, !0, response, map, reference\)/g,
    to: "createModelResolver(id, parentObject, key, !0, response, map, path)",
  },
  {
    from: /(createModelResolver\(\n\s+parentChunk,\n\s+parentObject,\n\s+key,\n\s+"cyclic" === id\.status,\n\s+response,\n\s+map,\n\s+)reference/g,
    to: "$1path",
  },
  {
    from: /(createModelResolver\(\n\s+id,\n\s+parentObject,\n\s+key,\n\s+!0,\n\s+response,\n\s+map,\n\s+)reference/g,
    to: "$1path",
  },
];

function patchFile(relativePath) {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Missing expected React Server DOM file: ${relativePath}`);
  }

  const before = fs.readFileSync(absolutePath, "utf8");
  let after = before;
  for (const replacement of replacements) {
    after = after.replace(replacement.from, replacement.to);
  }

  if (!after.includes('var path = reference.split(":");')) {
    throw new Error(`${relativePath}: getOutlinedModel does not declare path from reference`);
  }
  if (!after.includes("value = value[path[i]];")) {
    throw new Error(`${relativePath}: getOutlinedModel does not walk object paths via value[path[i]]`);
  }
  if (after.includes("parentObject = parentObject[reference[key]];")) {
    throw new Error(`${relativePath}: old reference[key] traversal is still present`);
  }
  if (/map,\n\s+reference/.test(after) || /map, reference/.test(after)) {
    throw new Error(`${relativePath}: createModelResolver still receives reference instead of path`);
  }

  if (after !== before) {
    fs.writeFileSync(absolutePath, after);
    return "patched";
  }

  return "verified";
}

const results = files.map((file) => [file, patchFile(file)]);
for (const [file, result] of results) {
  console.log(`[patch-rsdw] ${result}: ${file}`);
}
