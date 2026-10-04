import { expect, test } from "bun:test";
import { PayloadClient } from "../../src/lib/payload-client.ts";
import { RiduClient } from "../../src/lib/ridu-client.ts";
import { CmsError } from "../../src/lib/quikmarq-client.ts";
import { mutateShare } from "../../src/lib/custom-endpoints.ts";

const metadata = {
	id: "bookmark-1",
	owner: "owner-1",
	group: "group-1",
	createdAt: "2026-10-04T10:00:00Z",
	updatedAt: "2026-10-04T10:00:00Z",
};
const bookmark = { ...metadata, kind: "text", position: "0", text: "A note" };
const group = {
	...metadata,
	id: "group-1",
	name: "Ideas",
	rank: "hzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz",
};
const pagination = {
	page: 2,
	limit: 24,
	totalDocs: 25,
	totalPages: 2,
	hasNextPage: false,
	hasPrevPage: true,
};
const user = { id: "owner-1", email: "owner@example.test", displayName: "Owner" };
const session = { id: "session-1", collection: "users", user, expiresAt: "2026-10-05T10:00:00Z" };

for (const backend of ["ridu", "payload"] as const) {
	function clientFor(
		respond: (request: Request) => Response | Promise<Response>,
		token: string | null = "test-token"
	) {
		const requests: Request[] = [];
		const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
			const request = new Request(input, init);
			requests.push(request);
			return respond(request);
		}) as typeof fetch;
		const client =
			backend === "ridu"
				? new RiduClient("https://cms.example", async () => token, fetcher)
				: new PayloadClient("https://cms.example", async () => token, fetcher);
		return { client, requests };
	}

	test(`${backend}: native list presents the same bookmark snapshot`, async () => {
		const native = {
			...bookmark,
			owner: { id: "owner-1" },
			group: { id: "group-1" },
			...(backend === "ridu" ? { _revision: 3, _status: "published" } : { revision: 3 }),
		};
		const { client, requests } = clientFor(() =>
			Response.json(
				backend === "ridu" ? { docs: [native], pagination } : { docs: [native], ...pagination }
			)
		);
		const result = await client.find("bookmarks", {
			page: 2,
			limit: 24,
			depth: 1,
			sort: "-position,-createdAt",
			where: { group: { equals: "group-1" } },
		});
		expect(result.docs[0]).toMatchObject({ ...bookmark, revision: 3 });
		expect(result.docs[0]).not.toHaveProperty("_revision");
		expect(result.pagination).toEqual(pagination);
		const request = requests[0];
		const url = new URL(request.url);
		expect(url.pathname).toBe(backend === "ridu" ? "/api/collections/bookmarks" : "/api/bookmarks");
		expect(request.headers.get("authorization")).toBe(
			`${backend === "ridu" ? "Session" : "JWT"} test-token`
		);
		if (backend === "ridu") {
			expect(url.searchParams.has("depth")).toBe(false);
			expect(url.searchParams.getAll("sort")).toEqual(["-position", "-createdAt"]);
			expect(JSON.parse(url.searchParams.get("populate") ?? "")).toEqual({ images: true });
			expect(JSON.parse(url.searchParams.get("where") ?? "")).toEqual({
				group: { equals: "group-1" },
			});
		} else {
			expect(url.searchParams.get("depth")).toBe("1");
			expect(url.searchParams.get("sort")).toBe("-position,-createdAt");
			expect(url.searchParams.get("where[group][equals]")).toBe("group-1");
		}
	});

	test(`${backend}: edits keep the native lifecycle and revision guard`, async () => {
		const { client, requests } = clientFor(() =>
			Response.json({
				doc: { ...group, ...(backend === "ridu" ? { _revision: 4 } : { revision: 4 }) },
			})
		);
		const saved = await client.update("groups", "group-1", { name: "Renamed" }, 3);
		expect(saved.revision).toBe(4);
		expect(requests[0].headers.get("if-match")).toBe(backend === "ridu" ? '"3"' : "3");
		expect(requests[0].method).toBe(backend === "ridu" ? "POST" : "PATCH");
		expect(new URL(requests[0].url).pathname).toBe(
			backend === "ridu" ? "/api/collections/groups/group-1/publish" : "/api/groups/group-1"
		);
		expect(await requests[0].json()).toMatchObject({ name: "Renamed" });
	});

	test(`${backend}: conflict status and validation paths survive the adapter`, async () => {
		const { client } = clientFor(() =>
			Response.json(
				backend === "ridu"
					? {
							error: {
								code: "conflict",
								status: 409,
								message: "Stale revision",
								issues: [{ code: "conflict", path: "name", message: "Refresh this group" }],
							},
						}
					: {
							errors: [
								{
									message: "Stale revision",
									data: { errors: [{ path: "name", message: "Refresh this group" }] },
								},
							],
						},
				{ status: 409 }
			)
		);
		await expect(client.update("groups", "group-1", { name: "Old" }, 1)).rejects.toBeInstanceOf(
			CmsError
		);
		await expect(client.update("groups", "group-1", { name: "Old" }, 1)).rejects.toMatchObject({
			status: 409,
			message: "Stale revision",
			issues: [{ path: "name", message: "Refresh this group" }],
		});
	});

	test(`${backend}: token login and session checks use the native auth API`, async () => {
		const { client, requests } = clientFor((request) =>
			Response.json(
				new URL(request.url).pathname.endsWith("/login")
					? backend === "ridu"
						? { token: "issued-token", session }
						: { token: "issued-token", user }
					: backend === "ridu"
						? { session }
						: { user }
			)
		);
		expect(await client.login("owner@example.test", "password")).toEqual({
			token: "issued-token",
			user,
		});
		expect((await client.currentSession())?.user).toEqual(user);
		expect(new URL(requests[0].url).pathname).toBe(
			backend === "ridu" ? "/api/auth/users/login" : "/api/users/login"
		);
		const login = await requests[0].json();
		expect(login).toMatchObject({ email: "owner@example.test", password: "password" });
		if (backend === "ridu") expect(login.transport).toBe("token");
	});

	test(`${backend}: anonymous SSR does not contact an unavailable CMS`, async () => {
		const { client, requests } = clientFor(() => {
			throw new Error("CMS offline");
		}, null);
		expect(await client.currentSession()).toBeNull();
		expect(requests).toHaveLength(0);
	});

	test(`${backend}: sharing uses the native group endpoint`, async () => {
		const { client, requests } = clientFor(() =>
			Response.json({ sharingEnabled: true, token: "share-token" })
		);
		expect(await mutateShare(client, "group-1", "POST", true)).toEqual({
			sharingEnabled: true,
			token: "share-token",
		});
		expect(new URL(requests[0].url).pathname).toBe(
			backend === "ridu" ? "/api/collections/groups/group-1/share" : "/api/groups/group-1/share"
		);
		expect(await requests[0].json()).toEqual({ rotate: true });
	});
}
