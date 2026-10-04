export interface PublicImage {
	id: string;
	alt?: string;
	url: string;
	thumbnailURL?: string;
	width?: number;
	height?: number;
}

export interface PublicBookmark {
	id: string;
	kind: "link" | "text" | "media";
	position: string;
	url?: string | null;
	title?: string | null;
	description?: string | null;
	favicon?: string | null;
	previewImage?: string | null;
	videoProvider?: string | null;
	videoID?: string | null;
	text?: string | null;
	caption?: string | null;
	images: PublicImage[];
}

export interface PublicCollection {
	group: { id: string; name: string };
	docs: PublicBookmark[];
	pagination: {
		page: number;
		limit: number;
		totalDocs: number;
		totalPages: number;
		hasNextPage: boolean;
		hasPrevPage: boolean;
	};
}

/**
 * Resolve a shared image URL for direct browser delivery. CMS API paths load from its origin;
 * other hosts must be credential-free HTTPS URLs such as signed object-storage links.
 */
export function publicAssetURL(path: string, cmsOrigin: string): string | undefined {
	let url: URL;
	try {
		url = new URL(path, cmsOrigin);
	} catch {
		return undefined;
	}
	if (url.origin === new URL(cmsOrigin).origin) {
		return url.pathname.startsWith("/api/") && !url.hash ? url.href : undefined;
	}
	return url.protocol === "https:" && !url.username && !url.password && !url.hash
		? url.href
		: undefined;
}
