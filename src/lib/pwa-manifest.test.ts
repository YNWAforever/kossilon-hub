import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const root = new URL("../../", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("public/manifest.webmanifest", root), "utf8")) as {
  name: string;
  short_name: string;
  start_url: string;
  scope: string;
  display: string;
  lang: string;
  icons: { src: string; sizes: string; purpose: string }[];
};

function pngSize(path: string): { width: number; height: number } {
  const bytes = readFileSync(path);
  // PNG signature (8) + length (4) + "IHDR" (4) + width/height (8).
  expect(bytes.subarray(1, 4).toString("ascii")).toBe("PNG");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe("installable app shell", () => {
  it("declares a standalone installable manifest", () => {
    expect(manifest.name).toBe("ComSec OS");
    expect(manifest.short_name).toBe("ComSec");
    expect(manifest.start_url).toBe("/login");
    expect(manifest.scope).toBe("/");
    expect(manifest.display).toBe("standalone");
    expect(manifest.lang).toBe("zh-HK");
  });

  it("ships the declared icons with the declared dimensions", () => {
    expect(manifest.icons.length).toBe(3);
    for (const icon of manifest.icons) {
      const path = new URL(`public${icon.src}`, root);
      expect(statSync(path).isFile()).toBe(true);
      const { width, height } = pngSize(fileURLToPath(path));
      expect(icon.sizes).toBe(`${width}x${height}`);
    }
    expect(manifest.icons.some((icon) => icon.purpose === "maskable")).toBe(true);
  });

  it("links the manifest and Apple touch icon from the root head", () => {
    const head = readFileSync(new URL("src/routes/__root.tsx", root), "utf8");
    expect(head).toContain('rel: "manifest"');
    expect(head).toContain("/manifest.webmanifest");
    expect(head).toContain('rel: "apple-touch-icon"');
    expect(head).toContain('name: "theme-color"');
  });
});
