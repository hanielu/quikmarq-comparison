import { expect, test } from "bun:test";
import {
	bookmarkMetadata,
	EndpointError,
	parseBookmarkMetadata,
	parsePublicCollection,
	parseShareStatus,
} from "../../src/lib/custom-endpoints";
import type { QuikmarqClient } from "../../src/lib/quikmarq-client";

test("metadata access failures are distinguishable from optional preview failures", async () => {
	const denied = {
		request: async () => new Response(null, { status: 401 }),
	} as unknown as QuikmarqClient;
	const unavailable = {
		request: async () => new Response(null, { status: 502 }),
	} as unknown as QuikmarqClient;

	await expect(bookmarkMetadata(denied, "https://example.com/")).rejects.toMatchObject({
		status: 401,
		message: "Your session has expired. Log in again to preview or save a link.",
	});
	await expect(bookmarkMetadata(unavailable, "https://example.com/")).rejects.toBeInstanceOf(
		EndpointError
	);
});

test("metadata and share status reject malformed endpoint responses", () => {
	expect(() => parseBookmarkMetadata({ normalizedURL: "https://example.com/", title: 42 })).toThrow(
		"Unexpected server response"
	);
	expect(() => parseBookmarkMetadata([])).toThrow("Unexpected server response");
	expect(() => parseBookmarkMetadata({ title: "A page" })).toThrow("Unexpected server response");
	expect(
		parseBookmarkMetadata({
			normalizedURL: "https://example.com/final",
			title: "A page",
			description: null,
			owner: "ignored",
		})
	).toEqual({
		normalizedURL: "https://example.com/final",
		title: "A page",
		description: undefined,
		favicon: undefined,
		previewImage: undefined,
		videoProvider: undefined,
		videoID: undefined,
	});
	expect(() => parseShareStatus({ sharingEnabled: "true", token: "x" })).toThrow(
		"Unexpected server response"
	);
	expect(() => parseShareStatus({ sharingEnabled: true })).toThrow("Unexpected server response");
	expect(parseShareStatus({ sharingEnabled: false, owner: "ignored" })).toEqual({
		sharingEnabled: false,
	});
});

test("share resolver rejects malformed documents and strips private fields", () => {
	const valid = {
		group: { id: "group-1", name: "Ideas", owner: "private" },
		docs: [
			{
				id: "bookmark-1",
				kind: "link",
				position: "one",
				title: "Example",
				caption: "Canonical bookmark caption",
				images: [
					{
						id: "image-1",
						url: "https://files.example/image.png",
						owner: "private",
					},
				],
				owner: "private",
			},
		],
		pagination: {
			page: 1,
			limit: 24,
			totalDocs: 1,
			totalPages: 1,
			hasNextPage: false,
			hasPrevPage: false,
		},
	};
	const parsed = parsePublicCollection(valid);
	expect(parsed.group).toEqual({ id: "group-1", name: "Ideas" });
	expect("owner" in parsed.docs[0]).toBe(false);
	expect(parsed.docs[0].caption).toBe("Canonical bookmark caption");
	expect(parsed.docs[0].images[0]).not.toHaveProperty("owner");
	expect(() =>
		parsePublicCollection({ ...valid, docs: [{ ...valid.docs[0], images: ["raw-id"] }] })
	).toThrow("Unexpected server response");
	expect(() =>
		parsePublicCollection({ ...valid, pagination: { ...valid.pagination, totalDocs: "1" } })
	).toThrow("Unexpected server response");
	expect(() =>
		parsePublicCollection({ ...valid, docs: [{ ...valid.docs[0], kind: "private" }] })
	).toThrow("Unexpected server response");
});
