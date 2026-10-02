// Bounded local upstream characterization, never a production/provider probe.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const mammothRequire = createRequire(require.resolve("mammoth"));
const sizes = [2000, 4000, 8000, 16000, 32000];
const repetitions = 3;

if (process.argv[2] === "--worker") {
  const count = Number(process.argv[3]);
  if (!sizes.includes(count)) throw new Error("Unsupported bounded attribute count");
  const { DOMParser } = mammothRequire("@xmldom/xmldom");
  const xml = `<r ${Array.from({ length: count }, (_, i) => `a${i}="x"`).join(" ")}/>`;
  const started = performance.now();
  const document = new DOMParser().parseFromString(xml, "text/xml");
  const milliseconds = performance.now() - started;
  if (document.documentElement.attributes.length !== count)
    throw new Error("Parser did not retain every attribute");
  process.stdout.write(JSON.stringify({ count, bytes: Buffer.byteLength(xml), milliseconds }));
} else {
  if (process.argv.length !== 2)
    throw new Error("Usage: node scripts/benchmark-xml-attributes.mjs");
  const measurements = sizes.map((count) => {
    const samples = Array.from({ length: repetitions }, () => {
      const result = spawnSync(
        process.execPath,
        [fileURLToPath(import.meta.url), "--worker", count],
        {
          encoding: "utf8",
          timeout: 15000,
          maxBuffer: 65536,
          windowsHide: true,
        },
      );
      if (result.error || result.status !== 0)
        throw new Error(`Bounded parser worker failed: ${result.error?.code ?? result.stderr}`);
      return JSON.parse(result.stdout);
    });
    const times = samples.map((sample) => sample.milliseconds).sort((a, b) => a - b);
    return { attributes: count, bytes: samples[0].bytes, samples_ms: times, median_ms: times[1] };
  });
  console.log(
    JSON.stringify(
      {
        scope: "LOCAL ONLY synthetic well-formed XML; not scanner/provider acceptance",
        advisory: "https://github.com/advisories/GHSA-8344-3jmq-59r6",
        observed_at: new Date().toISOString(),
        node: process.version,
        parser_version: mammothRequire("@xmldom/xmldom/package.json").version,
        repetitions,
        timeout_per_worker_ms: 15000,
        measurements,
      },
      null,
      2,
    ),
  );
}
