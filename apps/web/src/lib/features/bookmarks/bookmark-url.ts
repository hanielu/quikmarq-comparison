const authorityScheme = /^[a-z][a-z\d+.-]*:\/\//i;
const schemePrefix = /^[a-z][a-z\d+.-]*:/i;
const hostPort = /^(?:localhost|(?:[a-z\d-]+\.)+[a-z]{2,}):\d+(?:[/?#]|$)/i;
const quickLinkHost = /^(?:[a-z\d_-]+\.)+[a-z]{2,}$/i;

function parseBookmarkURL(input: string): URL {
	const value = input.trim();
	if (!value || value.startsWith("//") || value.includes("\\")) {
		throw new Error("Enter a valid link.");
	}

	if (schemePrefix.test(value) && !authorityScheme.test(value) && !hostPort.test(value)) {
		throw new Error("Use an HTTP or HTTPS link.");
	}

	const candidate = authorityScheme.test(value) ? value : `https://${value}`;
	let url: URL;
	try {
		url = new URL(candidate);
	} catch {
		throw new Error("Enter a valid link.");
	}

	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new Error("Use an HTTP or HTTPS link.");
	}
	if (url.username || url.password) {
		throw new Error("Use a link without a username or password.");
	}
	if (!url.hostname) throw new Error("Enter a valid link.");

	return url;
}

/** Normalize manually entered links before saving them. Bare hosts use HTTPS. */
export function normalizeBookmarkURL(input: string): string {
	return parseBookmarkURL(input).toString();
}

/** Recognize the domain-style links that quick add should save as bookmarks. */
export function looksLikeBookmarkURL(input: string): boolean {
	const value = input.trim();
	if (!value || /\s/.test(value)) return false;

	try {
		return quickLinkHost.test(parseBookmarkURL(value).hostname);
	} catch {
		return false;
	}
}

/** Invalid saved values remain plain text instead of becoming clickable links. */
export function bookmarkDisplayLink(
	savedURL: string | null | undefined
): { href: string; hostname: string } | undefined {
	if (!savedURL) return undefined;

	try {
		const url = parseBookmarkURL(savedURL);
		return { href: url.toString(), hostname: url.hostname.replace(/^www\./i, "") };
	} catch {
		return undefined;
	}
}
