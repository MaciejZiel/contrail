// Collects the licence texts of everything that ends up in the browser bundle (maplibre-gl and its runtime
// dependencies) into public/licenses/NOTICES.txt, which the app links from its credits, so the copyright
// and licence notices that minification strips travel with the distributed copy.
// `node scripts/collect-licenses.mjs --rows` prints the matching rows for 3rdparty_licenses.md.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const nm = resolve(root, "node_modules");
const roots = Object.keys(JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).dependencies ?? {});

const seen = new Map();
function visit(name) {
  if (seen.has(name)) return;
  const dir = resolve(nm, name);
  const pj = resolve(dir, "package.json");
  if (!existsSync(pj)) return;
  const pkg = JSON.parse(readFileSync(pj, "utf8"));
  seen.set(name, { dir, pkg });
  for (const dep of Object.keys(pkg.dependencies ?? {})) visit(dep);
}
roots.forEach(visit);
// type-only packages are not part of the bundle
for (const name of [...seen.keys()]) if (name.startsWith("@types/")) seen.delete(name);

const licenseOf = (pkg) => (typeof pkg.license === "string" ? pkg.license : (pkg.license?.type ?? "UNKNOWN"));
const repoOf = (pkg) => {
  const r = typeof pkg.repository === "string" ? pkg.repository : (pkg.repository?.url ?? "");
  return r.replace(/^git\+/, "").replace(/\.git$/, "").replace(/^git:\/\//, "https://").replace(/^github:/, "https://github.com/") ||
    `https://www.npmjs.com/package/${pkg.name}`;
};

const names = [...seen.keys()].sort();
if (process.argv.includes("--rows")) {
  for (const n of names) {
    const { pkg } = seen.get(n);
    const repo = repoOf(pkg);
    console.log(`| https://www.npmjs.com/package/${pkg.name}/v/${pkg.version} | ${pkg.name} (bundled in the web app) | ${licenseOf(pkg)} | ${repo} |`);
  }
} else {
  let out = "Third-party software bundled in this web application\n\n";
  for (const n of names) {
    const { dir, pkg } = seen.get(n);
    out += `${"=".repeat(78)}\n${pkg.name} ${pkg.version} (${licenseOf(pkg)})\n${repoOf(pkg)}\n${"=".repeat(78)}\n`;
    const files = readdirSync(dir).filter((f) => /^(licen[sc]e|copying|notice)/i.test(f));
    out += files.length ? files.map((f) => readFileSync(resolve(dir, f), "utf8").trim()).join("\n\n") : "(no licence file shipped in the package; see the repository above)";
    out += "\n\n";
  }
  mkdirSync(resolve(root, "public/licenses"), { recursive: true });
  writeFileSync(resolve(root, "public/licenses/NOTICES.txt"), out);
  console.log(`${names.length} packages -> public/licenses/NOTICES.txt`);
}
