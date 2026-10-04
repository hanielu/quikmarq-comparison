import { expect, test } from "bun:test";
import { bookmarkListURL } from "../../src/lib/features/bookmarks/bookmark-query";

test("private bookmark URLs preserve filter order and reset to the first page", () => {
	const route = { groupId: "groups_123" };

	expect(bookmarkListURL(route, "", "")).toBe("/app/groups_123");
	expect(bookmarkListURL(route, " blue notes ", "text", 3)).toBe(
		"/app/groups_123?q=blue+notes&kind=text&page=3"
	);
	expect(bookmarkListURL(route, " blue notes ", "text")).toBe(
		"/app/groups_123?q=blue+notes&kind=text"
	);
	expect(bookmarkListURL(route, "   ", "", 1)).toBe("/app/groups_123");
});

test("shared bookmark URLs encode tokens and use the same filters", () => {
	expect(bookmarkListURL({ shareToken: "a/b ?" }, " image ", "media", 2)).toBe(
		"/share/a%2Fb%20%3F?q=image&kind=media&page=2"
	);
});

test("query and page values stay within the server limits", () => {
	const route = { groupId: "groups_123" };

	expect(bookmarkListURL(route, "x".repeat(121), "", 10001)).toBe(
		`/app/groups_123?q=${"x".repeat(120)}&page=10000`
	);
	expect(bookmarkListURL(route, "", "", 0)).toBe("/app/groups_123");
	expect(bookmarkListURL(route, "", "", 1.5)).toBe("/app/groups_123");
});
