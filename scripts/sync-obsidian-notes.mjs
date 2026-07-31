import { execFileSync } from "node:child_process";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const option = (name) => {
	const index = args.indexOf(name);
	return index === -1 ? undefined : args[index + 1];
};

const sourceRoot = path.resolve(
	option("--source") ?? process.env.OBSIDIAN_VAULT_PATH ?? "../obsidian notes",
);
const outputRoot = path.resolve(option("--output") ?? "src/content/posts");
const dryRun = args.includes("--dry-run");
const ignoredDirectories = new Set([".git", ".obsidian", ".trash", "node_modules"]);

function toPosix(value) {
	return value.split(path.sep).join("/");
}

function withoutExtension(value) {
	return value.replace(/\.(md|markdown)$/i, "");
}

function toDate(value, fallback) {
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? fallback : date.toISOString().slice(0, 10);
}

function gitDate(relativePath, initial) {
	try {
		const commandArgs = initial
			? ["log", "--follow", "--diff-filter=A", "--format=%aI", "--", relativePath]
			: ["log", "-1", "--format=%aI", "--", relativePath];
		const lines = execFileSync("git", commandArgs, { cwd: sourceRoot, encoding: "utf8" })
			.trim()
			.split("\n");
		return lines[initial ? lines.length - 1 : 0] || undefined;
	} catch {
		return undefined;
	}
}

async function collectMarkdownFiles(directory, files = []) {
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		if (entry.isDirectory()) {
			if (!ignoredDirectories.has(entry.name) && !entry.name.startsWith(".")) {
				await collectMarkdownFiles(path.join(directory, entry.name), files);
			}
		} else if (entry.isFile() && /\.(md|markdown)$/i.test(entry.name)) {
			files.push(path.join(directory, entry.name));
		}
	}
	return files;
}

function splitFrontmatter(markdown) {
	if (!markdown.startsWith("---\n") && !markdown.startsWith("---\r\n")) {
		return { frontmatter: "", body: markdown };
	}
	const end = markdown.indexOf("\n---", 4);
	if (end === -1) return { frontmatter: "", body: markdown };
	const lineEnd = markdown.indexOf("\n", end + 4);
	return {
		frontmatter: markdown.slice(4, end),
		body: markdown.slice(lineEnd === -1 ? markdown.length : lineEnd + 1),
	};
}

function frontmatterValue(frontmatter, name) {
	const match = frontmatter.match(new RegExp(`^${name}:\\s*(.+)$`, "m"));
	return match?.[1]?.trim().replace(/^['\"]|['\"]$/g, "");
}

function frontmatterTags(frontmatter) {
	const raw = frontmatterValue(frontmatter, "tags");
	if (!raw) return [];
	if (raw.startsWith("[") && raw.endsWith("]")) {
		return raw.slice(1, -1).split(",").map((tag) => tag.trim().replace(/^['\"]|['\"]$/g, "")).filter(Boolean);
	}
	return [raw];
}

function titleFrom(markdown, fallback) {
	return markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? fallback;
}

function descriptionFrom(markdown) {
	const paragraph = markdown
		.replace(/```[\s\S]*?```/g, "")
		.split(/\n\s*\n/)
		.map((part) => part.replace(/^#+\s+.*$/gm, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[*_`>#-]/g, " ").replace(/\s+/g, " ").trim())
		.find((part) => part.length >= 24);
	return (paragraph ?? "来自个人 Obsidian 笔记库的公开笔记。").slice(0, 160);
}

function normalizeImageUrls(markdown) {
	return markdown.replace(
		/(https:\/\/raw\.githubusercontent\.com\/huangpenguin\/note-images\/[^\s)"']+)\?token=[^\s)"']+/g,
		"$1",
	);
}

function makeRoute(relativePath) {
	return `/posts/${encodeURI(withoutExtension(toPosix(relativePath)))}/`;
}

function convertWikiLinks(markdown, publishedByKey) {
	return markdown.replace(/(?<!!)\[\[([^\]|#]+)(?:#([^\]|]+))?(?:\|([^\]]+))?\]\]/g, (match, rawTarget, rawHeading, rawLabel) => {
		const target = rawTarget.trim().replace(/\\/g, "/");
		const candidates = publishedByKey.get(target) ?? publishedByKey.get(withoutExtension(target)) ?? [];
		if (candidates.length !== 1) return match;
		const entry = candidates[0];
		const label = rawLabel?.trim() || (rawHeading ? `${target} · ${rawHeading}` : target);
		const heading = rawHeading ? `#${encodeURIComponent(rawHeading.trim().toLowerCase().replace(/\s+/g, "-"))}` : "";
		return `[${label}](${makeRoute(entry.relativePath)}${heading})`;
	});
}

const files = await collectMarkdownFiles(sourceRoot);
const candidates = await Promise.all(files.map(async (file) => {
	const original = await readFile(file, "utf8");
	const { frontmatter, body } = splitFrontmatter(original);
	return {
		file,
		relativePath: path.relative(sourceRoot, file),
		frontmatter,
		body,
		isPublished: frontmatterValue(frontmatter, "publish") === "true",
	};
}));
const published = candidates.filter((entry) => entry.isPublished);
const publishedByKey = new Map();
for (const entry of published) {
	const normalized = toPosix(withoutExtension(entry.relativePath));
	for (const key of [normalized, path.basename(normalized)]) {
		publishedByKey.set(key, [...(publishedByKey.get(key) ?? []), entry]);
	}
}

if (!dryRun) {
	await rm(outputRoot, { recursive: true, force: true });
	await mkdir(outputRoot, { recursive: true });
}

for (const entry of published) {
	const details = await stat(entry.file);
	const fallbackTitle = path.basename(entry.relativePath, path.extname(entry.relativePath));
	const created = gitDate(entry.relativePath, true) ?? details.birthtime.toISOString();
	const updated = gitDate(entry.relativePath, false) ?? details.mtime.toISOString();
	const categoryParts = path.dirname(entry.relativePath).split(path.sep).filter((part) => part !== ".");
	const title = frontmatterValue(entry.frontmatter, "title") ?? titleFrom(entry.body, fallbackTitle);
	const description = frontmatterValue(entry.frontmatter, "description") ?? descriptionFrom(entry.body);
	const output = [
		"---",
		`title: ${JSON.stringify(title)}`,
		`published: ${toDate(frontmatterValue(entry.frontmatter, "published"), toDate(created))}`,
		`updated: ${toDate(frontmatterValue(entry.frontmatter, "updated"), toDate(updated))}`,
		`draft: ${frontmatterValue(entry.frontmatter, "draft") === "true" ? "true" : "false"}`,
		`description: ${JSON.stringify(description)}`,
		`tags: ${JSON.stringify(frontmatterTags(entry.frontmatter))}`,
		`category: ${JSON.stringify(categoryParts.join(" / ") || "未分类")}`,
		"---",
		"",
		convertWikiLinks(normalizeImageUrls(entry.body), publishedByKey),
		"",
	].join("\n");
	const destination = path.join(outputRoot, entry.relativePath.replace(/\.markdown$/i, ".md"));
	if (!dryRun) {
		await mkdir(path.dirname(destination), { recursive: true });
		await writeFile(destination, output);
	}
}

console.log(`${dryRun ? "Would synchronize" : "Synchronized"} ${published.length} published notes (${candidates.length - published.length} skipped).`);
