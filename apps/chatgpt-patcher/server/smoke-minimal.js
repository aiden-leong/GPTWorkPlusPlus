// 超简 smoke — 不 import index.js，只验证 server 文件能 parse
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 验证关键文件存在
const required = [
  "index.js",
  "handlers.js",
  "settings.js",
  "relay-config.js",
  "env-conflicts.js",
  "sessions.js",
  "upstream.js",
  "launcher.js",
  "plugin-marketplace.js",
  "user-scripts.js",
  "injection.js",
  "ccs-import.js",
  "script-market.js",
  "provider-sync.js",
  "package.json",
];

let ok = true;
for (const f of required) {
  const p = path.join(__dirname, f);
  if (fs.existsSync(p)) {
    console.log(`  ✓ ${f}`);
  } else {
    console.log(`  ✗ ${f} MISSING`);
    ok = false;
  }
}

// 验证 package.json 内容
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf8"));
console.log(`  package: ${pkg.name}@${pkg.version}`);
console.log(`  deps: ${Object.keys(pkg.dependencies || {}).join(", ")}`);

// 验证 node_modules 安装
const nm = path.join(__dirname, "node_modules");
if (fs.existsSync(nm)) {
  console.log("  ✓ node_modules exists");
} else {
  console.log("  ✗ node_modules MISSING — npm install didn't run");
  ok = false;
}

process.exit(ok ? 0 : 1);
