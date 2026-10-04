import type {
	Collection,
	Document,
	Asset,
	Session,
	Page,
	Pagination,
	Where,
	QuikmarqClient,
} from "./quikmarq-client.ts";
import { CmsError } from "./quikmarq-client.ts";
import { quikmarqDocument, quikmarqUser } from "./quikmarq-documents.ts";

export class PayloadError extends CmsError {
	constructor(
		message: string,
		status: number,
		issues: ReadonlyArray<{ path?: string; message: string }> = []
	) {
		super(message, status, issues);
		this.name = "PayloadError";
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function addWhere(search: URLSearchParams, where: Where, prefix = "where") {
	if ("and" in where && Array.isArray(where.and)) {
		where.and.forEach((part, index) => addWhere(search, part, `${prefix}[and][${index}]`));
		return;
	}
	if ("or" in where && Array.isArray(where.or)) {
		where.or.forEach((part, index) => addWhere(search, part, `${prefix}[or][${index}]`));
		return;
	}
	for (const [field, operators] of Object.entries(where)) {
		if (!isRecord(operators)) continue;
		for (const [operator, value] of Object.entries(operators)) {
			if (value !== undefined) search.set(`${prefix}[${field}][${operator}]`, String(value));
		}
	}
}

function pagination(value: Record<string, unknown>): Pagination {
	const page = Number(value.page);
	const limit = Number(value.limit);
	const totalDocs = Number(value.totalDocs);
	const totalPages = Number(value.totalPages);
	if (![page, limit, totalDocs, totalPages].every(Number.isSafeInteger))
		throw new Error("Payload returned an invalid page.");
	return {
		page,
		limit,
		totalDocs,
		totalPages,
		hasNextPage: value.hasNextPage === true,
		hasPrevPage: value.hasPrevPage === true,
	};
}

function document<Slug extends Collection>(collection: Slug, value: unknown): Document<Slug> {
	if (!isRecord(value) || !isRecord(value.doc) || typeof value.doc.id !== "string")
		throw new Error("Payload returned an invalid document.");
	if (collection !== "assets" && !Number.isSafeInteger(value.doc.revision))
		throw new Error("Payload returned a document without a valid revision.");
	return quikmarqDocument(collection, value.doc);
}

function issuesFrom(errors: unknown[]): Array<{ path?: string; message: string }> {
	return errors.flatMap((error) => {
		if (!isRecord(error)) return [];
		const data = isRecord(error.data) ? error.data : null;
		const entries = data && Array.isArray(data.errors) ? data.errors : [];
		return entries.flatMap((entry) => {
			if (!isRecord(entry) || typeof entry.message !== "string") return [];
			return [
				{
					...(typeof entry.path === "string" ? { path: entry.path } : {}),
					message: entry.message,
				},
			];
		});
	});
}

export class PayloadClient implements QuikmarqClient {
	constructor(
		readonly baseURL: string,
		private readonly token: () => Promise<string | null>,
		private readonly fetcher: typeof fetch = fetch
	) {}

	groupSharePath(id: string) {
		return `/api/groups/${encodeURIComponent(id)}/share`;
	}

	async request(path: string, init: RequestInit = {}): Promise<Response> {
		const headers = new Headers(init.headers);
		const token = await this.token();
		if (token) headers.set("authorization", `JWT ${token}`);
		return this.fetcher(new URL(path, this.baseURL), {
			...init,
			headers,
			credentials: "omit",
			cache: "no-store",
		});
	}

	private async json<T>(path: string, init: RequestInit = {}): Promise<T> {
		const response = await this.request(path, init);
		let body: unknown;
		try {
			body = await response.json();
		} catch {
			throw new PayloadError("The content service returned an invalid response.", response.status);
		}
		if (!response.ok) {
			const errors = isRecord(body) && Array.isArray(body.errors) ? body.errors : [];
			const first = errors.find(isRecord);
			const issues = issuesFrom(errors);
			const message =
				(first && typeof first.message === "string" && first.message) ||
				(isRecord(body) && typeof body.message === "string" && body.message) ||
				issues[0]?.message ||
				(response.status === 409
					? "This item changed elsewhere. Refresh and try again."
					: "The request could not be completed.");
			throw new PayloadError(message, response.status, issues);
		}
		return body as T;
	}

	async find<Slug extends Collection>(
		collection: Slug,
		options: { page?: number; limit?: number; sort?: string; where?: Where; depth?: number } = {}
	): Promise<Page<Document<Slug>>> {
		const search = new URLSearchParams({ depth: String(options.depth ?? 0) });
		if (options.page !== undefined) search.set("page", String(options.page));
		if (options.limit !== undefined) search.set("limit", String(options.limit));
		if (options.sort) search.set("sort", options.sort);
		if (options.where) addWhere(search, options.where);
		const body = await this.json<unknown>(`/api/${collection}?${search}`);
		if (!isRecord(body) || !Array.isArray(body.docs))
			throw new Error("Payload returned an invalid document page.");
		return {
			docs: body.docs.map((doc) => document(collection, { doc })),
			pagination: pagination(body),
		};
	}

	async findByID<Slug extends Collection>(collection: Slug, id: string): Promise<Document<Slug>> {
		const doc = await this.json<unknown>(`/api/${collection}/${encodeURIComponent(id)}?depth=0`);
		return document(collection, { doc });
	}

	async count(collection: Collection, where: Where): Promise<number> {
		const search = new URLSearchParams();
		addWhere(search, where);
		const result = await this.json<unknown>(`/api/${collection}/count?${search}`);
		if (!isRecord(result) || !Number.isSafeInteger(result.totalDocs))
			throw new Error("Payload returned an invalid count.");
		return result.totalDocs as number;
	}

	async create<Slug extends Collection>(
		collection: Slug,
		data: Partial<Document<Slug>>
	): Promise<Document<Slug>> {
		const result = await this.json<unknown>(`/api/${collection}?depth=0`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(data),
		});
		return document(collection, result);
	}

	async update<Slug extends Collection>(
		collection: Slug,
		id: string,
		data: Partial<Document<Slug>>,
		revision: number
	): Promise<Document<Slug>> {
		const result = await this.json<unknown>(
			`/api/${collection}/${encodeURIComponent(id)}?depth=0`,
			{
				method: "PATCH",
				headers: { "content-type": "application/json", "if-match": String(revision) },
				body: JSON.stringify(data),
			}
		);
		return document(collection, result);
	}

	async delete(collection: Collection, id: string, revision?: number): Promise<void> {
		await this.json(`/api/${collection}/${encodeURIComponent(id)}`, {
			method: "DELETE",
			headers: revision === undefined ? undefined : { "if-match": String(revision) },
		});
	}

	async upload(file: File, data: { group: string; alt: string }): Promise<Asset> {
		const body = new FormData();
		body.append("_payload", JSON.stringify(data));
		body.append("file", file);
		const result = await this.json<unknown>("/api/assets?depth=0", { method: "POST", body });
		return document("assets", result);
	}

	async duplicateAsset(id: string, data: { group: string; alt?: string }): Promise<Asset> {
		const doc = await this.json<unknown>(`/api/assets/${encodeURIComponent(id)}/duplicate`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(data),
		});
		return document("assets", { doc });
	}

	async signedAssetURLs(
		items: Array<{ id: string; size?: "thumb" }>
	): Promise<Record<string, string>> {
		if (items.length === 0) return {};
		if (items.length > 100) throw new Error("Too many images requested at once.");
		const result = await this.json<unknown>("/api/assets/signed-urls", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ items }),
		});
		if (!isRecord(result) || !Array.isArray(result.urls) || result.urls.length > items.length)
			throw new Error("Payload returned invalid image URLs.");
		const requested = new Set(items.map(({ id }) => id));
		const urls: Record<string, string> = {};
		for (const entry of result.urls) {
			if (
				!isRecord(entry) ||
				typeof entry.id !== "string" ||
				typeof entry.url !== "string" ||
				!requested.has(entry.id) ||
				entry.id in urls
			)
				throw new Error("Payload returned invalid image URLs.");
			let url: URL;
			try {
				url = new URL(entry.url, this.baseURL);
			} catch {
				throw new Error("Payload returned invalid image URLs.");
			}
			const sameOrigin = url.origin === new URL(this.baseURL).origin;
			if (
				url.username ||
				url.password ||
				url.hash ||
				!(sameOrigin ? url.pathname.startsWith("/api/assets/") : url.protocol === "https:")
			)
				throw new Error("Payload returned invalid image URLs.");
			urls[entry.id] = url.href;
		}
		return urls;
	}

	async currentSession(): Promise<Session | null> {
		if (!(await this.token())) return null;
		const response = await this.request("/api/users/me?depth=0");
		if (response.status === 401 || response.status === 403) return null;
		if (!response.ok) throw new PayloadError("Could not verify your session.", response.status);
		let body: unknown;
		try {
			body = await response.json();
		} catch {
			throw new Error("Payload returned an invalid session response.");
		}
		if (isRecord(body) && body.user === null) return null;
		if (
			!isRecord(body) ||
			!isRecord(body.user) ||
			typeof body.user.id !== "string" ||
			typeof body.user.email !== "string" ||
			typeof body.user.displayName !== "string"
		)
			throw new Error("Payload returned an invalid session response.");
		return { user: quikmarqUser(body.user) };
	}

	async createUser(data: { email: string; password: string; displayName: string }): Promise<void> {
		await this.json("/api/users", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(data),
		});
	}

	async login(email: string, password: string): Promise<{ token: string; user: Session["user"] }> {
		const result = await this.json<unknown>("/api/users/login", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ email, password }),
		});
		if (
			!isRecord(result) ||
			typeof result.token !== "string" ||
			!isRecord(result.user) ||
			typeof result.user.id !== "string" ||
			typeof result.user.email !== "string" ||
			typeof result.user.displayName !== "string"
		)
			throw new Error("Payload returned an invalid login response.");
		return { token: result.token, user: quikmarqUser(result.user) };
	}

	async logout(): Promise<void> {
		await this.json("/api/users/logout", { method: "POST" });
	}
}
