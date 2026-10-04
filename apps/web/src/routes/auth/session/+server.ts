import { json, type RequestHandler } from "@sveltejs/kit";
import { sessionCookieName } from "#lib/cms-config.ts";
import { createCmsClient } from "#lib/cms-client.ts";

const cookieName = sessionCookieName;

function sameOrigin(request: Request, url: URL): boolean {
	return request.headers.get("origin") === url.origin;
}

function tokenLifetime(token: string, expiresAt?: string): number {
	if (expiresAt)
		return Math.max(
			0,
			Math.min(60 * 60 * 24 * 7, Math.floor((Date.parse(expiresAt) - Date.now()) / 1000))
		);
	try {
		const encoded = token.split(".")[1];
		const claims: unknown = JSON.parse(atob(encoded.replace(/-/g, "+").replace(/_/g, "/")));
		if (
			typeof claims === "object" &&
			claims !== null &&
			"exp" in claims &&
			typeof claims.exp === "number"
		)
			return Math.max(0, Math.min(60 * 60 * 24 * 7, Math.floor(claims.exp - Date.now() / 1000)));
	} catch {
		// A validated opaque token still receives a conservative cookie lifetime.
	}
	return 60 * 60;
}

export const GET: RequestHandler = async ({ cookies }) => {
	const token = cookies.get(cookieName);
	return json(token ? { token } : {}, { headers: { "cache-control": "private, no-store" } });
};

export const POST: RequestHandler = async ({ request, cookies, url, fetch }) => {
	if (!sameOrigin(request, url))
		return json({ message: "Invalid request origin." }, { status: 403 });
	const raw = await request.text();
	if (raw.length > 8192) return json({ message: "Session request is too large." }, { status: 413 });
	let body: unknown;
	try {
		body = JSON.parse(raw);
	} catch {
		return json({ message: "Invalid session request." }, { status: 400 });
	}
	const token =
		typeof body === "object" && body !== null && "token" in body && typeof body.token === "string"
			? body.token
			: "";
	if (!token || token.length > 4096)
		return json({ message: "A valid session token is required." }, { status: 400 });
	const client = createCmsClient(async () => token, fetch);
	const session = await client.currentSession();
	if (!session) return json({ message: "The session is invalid." }, { status: 401 });
	cookies.set(cookieName, token, {
		path: "/",
		httpOnly: true,
		sameSite: "lax",
		secure: url.protocol === "https:",
		maxAge: tokenLifetime(token, session.expiresAt),
	});
	return json({ user: session.user }, { headers: { "cache-control": "private, no-store" } });
};

export const DELETE: RequestHandler = async ({ cookies, request, url }) => {
	if (!sameOrigin(request, url))
		return json({ message: "Invalid request origin." }, { status: 403 });
	cookies.delete(cookieName, { path: "/" });
	return json({ ok: true }, { headers: { "cache-control": "private, no-store" } });
};
