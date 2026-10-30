import { readFile } from "node:fs/promises";
import { URL } from "node:url";

const projectRoot = new URL("../", import.meta.url);
const packageJson = JSON.parse(await readFile(new URL("package.json", projectRoot), "utf8"));
const changelog = await readFile(new URL("CHANGELOG.md", projectRoot), "utf8");
const citation = await readFile(new URL("CITATION.cff", projectRoot), "utf8");
const serverJson = JSON.parse(await readFile(new URL("server.json", projectRoot), "utf8"));
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

if (serverJson.version !== packageJson.version) {
  throw new Error(`server.json declares version ${serverJson.version}, package.json declares ${packageJson.version}.`);
}

if (packageJson.mcpName !== serverJson.name) {
  throw new Error(
    `package.json mcpName (${String(packageJson.mcpName)}) must equal server.json name (${String(serverJson.name)}).`,
  );
}

const npmPackage = Array.isArray(serverJson.packages)
  ? serverJson.packages.find((entry) => entry?.registryType === "npm")
  : undefined;

if (!npmPackage) {
  throw new Error("server.json must declare an npm package entry.");
}

if (npmPackage.identifier !== packageJson.name) {
  throw new Error(
    `server.json npm identifier (${String(npmPackage.identifier)}) must equal package name (${packageJson.name}).`,
  );
}

if (npmPackage.version !== packageJson.version) {
  throw new Error(
    `server.json npm version (${String(npmPackage.version)}) must equal package version (${packageJson.version}).`,
  );
}

if (npmPackage.transport?.type !== "stdio") {
  throw new Error("server.json npm package transport must be stdio.");
}

const tokenVariable = Array.isArray(npmPackage.environmentVariables)
  ? npmPackage.environmentVariables.find((entry) => entry?.name === "DISCORD_TOKEN")
  : undefined;

if (!tokenVariable || tokenVariable.isRequired !== true || tokenVariable.isSecret !== true) {
  throw new Error("server.json must declare DISCORD_TOKEN as a required secret environment variable.");
}

console.log(`Release metadata is consistent for ${expectedTag}.`);
