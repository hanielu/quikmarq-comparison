import { expect, test } from "bun:test";
import { PayloadClient, PayloadError } from "../../src/lib/payload-client.ts";

const metadata = {
	owner: "owner-1",
	group: "group-1",
	createdAt: "2026-10-04T10:00:00Z",
	updatedAt: "2026-10-04T10:00:00Z",
	name: "Ideas",
	rank: "rank",
	kind: "text",
	position: "0",
};

function clientFor(respond: (request: Request) => Response | Promise<Response>) {
	const requests: Request[] = [];
	const client = new PayloadClient("https://cms.example", async () => "secret-jwt", (async (
		input,
		init
	) => {
		const request = new Request(input, init);
		requests.push(request);
		return respond(request);
	}) as typeof fetch);
	return { client, requests };
}

test("native find encodes Payload where, sort, depth and pagination", async () => {
	const { client, requests } = clientFor(() =>
		Response.json({
			docs: [{ ...metadata, id: "bookmark-1", revision: 1 }],
			page: 2,
			limit: 24,
			totalDocs: 25,
			totalPages: 2,
			hasNextPage: false,
			hasPrevPage: true,
		})
	);
	const result = await client.find("bookmarks", {
		page: 2,
		limit: 24,
		sort: "-position,-createdAt",
		where: { and: [{ group: { equals: "group-1" } }, { kind: { equals: "link" } }] },
	});
	const url = new URL(requests[0].url);
	expect(url.pathname).toBe("/api/bookmarks");
	expect(url.searchParams.get("where[and][0][group][equals]")).toBe("group-1");
	expect(url.searchParams.get("where[and][1][kind][equals]")).toBe("link");
	expect(url.searchParams.get("sort")).toBe("-position,-createdAt");
	expect(url.searchParams.get("depth")).toBe("0");
	expect(requests[0].headers.get("authorization")).toBe("JWT secret-jwt");
	expect(result.pagination.totalDocs).toBe(25);
});

test("native count uses the dedicated Payload endpoint", async () => {
	const { client, requests } = clientFor(() => Response.json({ totalDocs: 7 }));
	expect(await client.count("bookmarks", { group: { equals: "group-1" } })).toBe(7);
	expect(new URL(requests[0].url).pathname).toBe("/api/bookmarks/count");
});

test("anonymous session checks do not request an unavailable CMS", async () => {
	let requests = 0;
	const client = new PayloadClient("https://cms.example", async () => null, (async () => {
		requests++;
		throw new Error("The CMS is offline");
	}) as unknown as typeof fetch);
	expect(await client.currentSession()).toBeNull();
	expect(requests).toBe(0);
});

test("writes unwrap Payload doc envelopes and send revision headers", async () => {
	const { client, requests } = clientFor(() =>
		Response.json({
			doc: { ...metadata, id: "group-1", revision: 3, name: "Renamed" },
			message: "Updated",
		})
	);
	const result = await client.update("groups", "group-1", { name: "Renamed" }, 2);
	expect(result.id).toBe("group-1");
	expect(result.revision).toBe(3);
	expect(requests[0].method).toBe("PATCH");
	expect(requests[0].headers.get("if-match")).toBe("2");
});

test("create unwraps Payload's document envelope and rejects a missing revision", async () => {
	const valid = clientFor(() =>
		Response.json({ doc: { ...metadata, id: "group-1", revision: 1 } })
	);
	expect((await valid.client.create("groups", { name: "Ideas" })).id).toBe("group-1");
	expect(valid.requests[0].method).toBe("POST");
	const invalid = clientFor(() => Response.json({ doc: { ...metadata, id: "group-1" } }));
	await expect(invalid.client.create("groups", { name: "Ideas" })).rejects.toThrow("revision");
});

test("conflicts surface a usable status and message", async () => {
	const { client } = clientFor(() =>
		Response.json({ errors: [{ message: "Revision conflict" }] }, { status: 409 })
	);
	await expect(client.update("groups", "group-1", { name: "Old" }, 1)).rejects.toMatchObject({
		status: 409,
		message: "Revision conflict",
	});
	await expect(client.update("groups", "group-1", { name: "Old" }, 1)).rejects.toBeInstanceOf(
		PayloadError
	);
});

test("uploads use Payload multipart _payload and a file", async () => {
	const { client, requests } = clientFor(() =>
		Response.json({ doc: { ...metadata, id: "asset-1" } })
	);
	const file = new File(["png"], "image.png", { type: "image/png" });
	expect((await client.upload(file, { group: "group-1", alt: "Cover" })).id).toBe("asset-1");
	const form = await requests[0].formData();
	expect(JSON.parse(String(form.get("_payload")))).toEqual({ group: "group-1", alt: "Cover" });
	expect((form.get("file") as File).name).toBe("image.png");
});

test("Payload validation issues retain field paths", async () => {
	const { client } = clientFor(() =>
		Response.json(
			{
				errors: [
					{
						message: "The following field is invalid: Name",
						data: { errors: [{ path: "name", message: "Name is required" }] },
					},
				],
			},
			{ status: 400 }
		)
	);
	await expect(client.create("groups", { name: "" })).rejects.toMatchObject({
		status: 400,
		issues: [{ path: "name", message: "Name is required" }],
	});
});

test("signed image URLs reject unknown IDs and unsafe schemes", async () => {
	const valid = clientFor(() =>
		Response.json({ urls: [{ id: "asset-1", url: "/api/assets/file/asset-1?token=x" }] })
	);
	expect(await valid.client.signedAssetURLs([{ id: "asset-1" }])).toEqual({
		"asset-1": "https://cms.example/api/assets/file/asset-1?token=x",
	});
	const unknown = clientFor(() =>
		Response.json({ urls: [{ id: "other", url: "https://files.example/image" }] })
	);
	await expect(unknown.client.signedAssetURLs([{ id: "asset-1" }])).rejects.toThrow(
		"invalid image URLs"
	);
	const unsafe = clientFor(() =>
		Response.json({ urls: [{ id: "asset-1", url: "javascript:alert(1)" }] })
	);
	await expect(unsafe.client.signedAssetURLs([{ id: "asset-1" }])).rejects.toThrow(
		"invalid image URLs"
	);
});
