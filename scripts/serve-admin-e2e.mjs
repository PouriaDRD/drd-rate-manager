import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
	"public",
	"admin",
);
const BASE = "/management-test";
const PORT = Number(process.env.DRD_E2E_PORT || 4178);

const CONTENT_TYPES = Object.freeze({
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".webp": "image/webp",
});

function reply(response, status, body, headers = {}) {
	response.writeHead(status, {
		"Cache-Control": "no-store, no-cache, must-revalidate, private",
		"Pragma": "no-cache",
		"Expires": "0",
		...headers,
	});
	response.end(body);
}

function safeFilePath(requestPath) {
	let relative = requestPath.slice(BASE.length);
	if (!relative || relative === "/") relative = "/index.html";
	if (relative.startsWith("/")) relative = relative.slice(1);
	const candidate = path.resolve(ROOT, relative);
	const rootPrefix = `${ROOT}${path.sep}`;
	if (candidate !== ROOT && !candidate.startsWith(rootPrefix)) return null;
	return candidate;
}

const server = createServer(async (request, response) => {
	if (!["GET", "HEAD"].includes(request.method || "")) {
		reply(response, 405, "Method not allowed");
		return;
	}

	let pathname;
	try {
		pathname = decodeURIComponent(new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`).pathname);
	} catch {
		reply(response, 400, "Bad request");
		return;
	}

	if (pathname === BASE) {
		response.writeHead(308, {
			Location: `${BASE}/`,
			"Cache-Control": "no-store",
		});
		response.end();
		return;
	}
	if (!pathname.startsWith(`${BASE}/`)) {
		reply(response, 404, "Not found");
		return;
	}
	if (pathname.startsWith(`${BASE}/api/`)) {
		reply(
			response,
			501,
			JSON.stringify({ success: false, message: "E2E API route was not mocked." }),
			{ "Content-Type": "application/json; charset=utf-8" },
		);
		return;
	}

	const filePath = safeFilePath(pathname);
	if (!filePath) {
		reply(response, 404, "Not found");
		return;
	}

	try {
		const info = await stat(filePath);
		if (!info.isFile()) throw new Error("not_file");
		const body = request.method === "HEAD" ? "" : await readFile(filePath);
		reply(response, 200, body, {
			"Content-Type": CONTENT_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream",
		});
	} catch {
		reply(response, 404, "Not found");
	}
});

server.listen(PORT, "127.0.0.1", () => {
	console.log(`DRD Web Admin E2E fixture: http://127.0.0.1:${PORT}${BASE}/`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
	process.on(signal, () => server.close(() => process.exit(0)));
}
