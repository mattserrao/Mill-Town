import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";

/** Game version: package version + git commit, read fresh on every page load (so a `git pull` shows up). */
function versionInfo() {
  const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };
  const git = (cmd: string) => { try { return execSync(`git ${cmd}`, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { return ""; } };
  const sha = git("rev-parse --short HEAD") || "nogit";
  const build = Number(git("rev-list --count HEAD")) || 0;
  const dirty = git("status --porcelain --untracked-files=no") ? "+local changes" : "";
  const date = git("log -1 --format=%cd --date=format:%Y-%m-%d\\ %H:%M");
  return { version: pkg.version, build, sha, dirty, date, label: `v${pkg.version} build ${build} (${sha}${dirty ? " " + dirty : ""})` };
}

function versionPlugin(): Plugin {
  const banner = (v: ReturnType<typeof versionInfo>) => `\n  \x1b[33mMILL TOWN\x1b[0m  ${v.label}  ·  committed ${v.date}\n`;
  let command = "serve";
  return {
    name: "mill-town-version",
    configResolved(c) { command = c.command; },
    configureServer(server) {
      server.httpServer?.once("listening", () => console.log(banner(versionInfo())));
    },
    configurePreviewServer(server) {
      server.httpServer?.once("listening", () => console.log(banner(versionInfo())));
    },
    buildStart() { if (command === "build") console.log(banner(versionInfo())); },
    transformIndexHtml() {
      const v = versionInfo();
      return [{ tag: "script", children: `window.__MT_VERSION__=${JSON.stringify(v)};`, injectTo: "head-prepend" }];
    },
  };
}

export default defineConfig({
  plugins: [versionPlugin()],
  // GitHub Pages serves the site under /<repo>/ (set BASE_PATH in the workflow); a plain host uses /
  base: process.env.BASE_PATH ?? "/",
  build: { chunkSizeWarningLimit: 1200 },
});
