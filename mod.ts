import * as path from "https://deno.land/std@0.150.0/path/mod.ts";
import * as fs from "https://deno.land/std@0.150.0/fs/mod.ts";

export interface VendorUrlsOptions {
	urls: string[];
	/**
	 * The directory to put all the vendored urls.
	 * This defaults to ${cwd}/vendor.
	 */
	outputDir?: string;
}

export async function vendorUrls({
	urls,
	outputDir = path.resolve(Deno.cwd(), "./vendor/"),
}: VendorUrlsOptions) {
	await fs.ensureDir(outputDir);

	for (const url of urls) {
		const outputPath = path.resolve(outputDir, moduleSpecifierToPath(url));

		// Check if the file has already been vendored
		let exists = false;
		try {
			const stat = await Deno.stat(outputPath);
			if (stat.isFile) {
				exists = true;
			}
		} catch (e) {
			if (!(e instanceof Deno.errors.NotFound)) {
				throw e;
			}
		}

		if (exists) continue;

		const cmd = [
			"deno",
			"vendor",
			url,
			"--output",
			outputDir,
			// Without this the command will fail if the directory already exists
			"--force",
			// Without this the users deno.json might get updated with the generated import map
			"--no-config",
		];
		const proc = Deno.run({
			cmd,
			stdout: "null",
			stdin: "null",
			stderr: "piped",
		});
		const status = await proc.status();
		if (!status.success) {
			const rawError = await proc.stderrOutput();
			const errorString = new TextDecoder().decode(rawError);

			throw new Error(
				`${errorString}

Failed to vendor files for ${url}. 'deno vendor' exited with status ${status.code}.
The output of the 'deno vendor' command is shown above.

The error occurred while running:
  ${cmd.join(" ")}`,
			);
		}
	}

	// Since we're using '--force' the import map will be overwritten.
	// This makes the import map pretty useless.
	// To avoid confusion we'll just remove it.
	const importMapPath = path.resolve(outputDir, "import_map.json");
	try {
		await Deno.remove(importMapPath);
	} catch (e) {
		if (!(e instanceof Deno.errors.NotFound)) {
			throw e;
		}
	}
}

/**
 * Converts a module specifier url to the resulting file path from the 'deno vendor' command.
 */
export function moduleSpecifierToPath(moduleSpecifier: string) {
	// This is ported from https://github.com/denoland/deno/blob/main/cli/tools/vendor/specifiers.rs
	const url = new URL(moduleSpecifier, path.toFileUrl(Deno.cwd()).href);
	let result = "";
	if (url.hostname) {
		result += sanitizeSegment(url.hostname);
	}
	if (url.port) {
		result += "_" + url.port;
	}
	const pathSegments = url.pathname.split("/")
		.filter((s) => s.length > 0)
		.map((segment) => sanitizeSegment(segment));
	return path.join(result, ...pathSegments);
}

function sanitizeSegment(text: string) {
	return Array.from(text).map((c) => isBannedSegmentChar(c) ? "_" : c).join("");
}

function isBannedSegmentChar(c: string) {
	return ["<", ">", ":", "|", "?", "*", "/", "\\"].includes(c);
}
