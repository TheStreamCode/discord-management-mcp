import { readFile } from "node:fs/promises";
import { URL } from "node:url";

const projectRoot = new URL("../", import.meta.url);
const packageJson = JSON.parse(await readFile(new URL("package.json", projectRoot), "utf8"));
const changelog = await readFile(new URL("CHANGELOG.md", projectRoot), "utf8");
const citation = await readFile(new URL("CITATION.cff", projectRoot), "utf8");
const releaseTag = process.env.RELEASE_TAG ?? process.env.GITHUB_REF_NAME ?? process.argv[2];
const expectedTag = `v${packageJson.version}`;

if (!releaseTag) {
  throw new Error(`Release tag is required. Run: npm run release:check -- ${expectedTag}`);
}

if (releaseTag !== expectedTag) {
  throw new Error(`Release tag ${releaseTag} does not match package version ${packageJson.version}.`);
}

if (!changelog.includes(`## ${packageJson.version}`)) {
  throw new Error(`CHANGELOG.md does not contain a section for ${packageJson.version}.`);
}

if (!citation.includes(`version: "${packageJson.version}"`)) {
  throw new Error(`CITATION.cff does not declare version ${packageJson.version}.`);
}

console.log(`Release metadata is consistent for ${expectedTag}.`);
