import { expect, test } from "bun:test";
import {
	bookmarkDisplayLink,
	looksLikeBookmarkURL,
	normalizeBookmarkURL,
} from "../../src/lib/features/bookmarks/bookmark-url";

test("bookmark URLs normalize bare domains and accept HTTP or HTTPS", () => {
	expect(normalizeBookmarkURL(" example.com/article?q=one ")).toBe(
		"https://example.com/article?q=one"
	);
	expect(normalizeBookmarkURL("https://Example.com/path")).toBe("https://example.com/path");
	expect(normalizeBookmarkURL("http://example.com")).toBe("http://example.com/");
	expect(normalizeBookmarkURL("example.com:8080/path")).toBe("https://example.com:8080/path");
});

test("bookmark URLs reject unsupported schemes and credential-bearing links", () => {
	for (const input of [
		"ftp://example.com/file",
		"javascript:alert(1)",
		"javascript:123",
		"http:example.com",
		"//example.com/path",
		"https:\\example.com",
		"https://user:password@example.com/",
		"https://example.com@evil.test/",
		"user@example.com",
	]) {
		expect(() => normalizeBookmarkURL(input)).toThrow();
	}
});

test("quick add recognizes domain links without treating prose or unsafe URLs as links", () => {
	for (const input of [
		"example.com",
		"www.example.co.uk/path",
		"https://example.com/article",
		"example.com:8080/path",
	]) {
		expect(looksLikeBookmarkURL(input)).toBe(true);
	}
	for (const input of [
		"hello world",
		"not-a-domain",
		"https://user@example.com",
		"javascript:alert(1)",
		"ftp://example.com",
	]) {
		expect(looksLikeBookmarkURL(input)).toBe(false);
	}
});

test("saved links expose only a safe href and display hostname", () => {
	expect(bookmarkDisplayLink("www.Example.com/article")).toEqual({
		href: "https://www.example.com/article",
		hostname: "example.com",
	});
	expect(bookmarkDisplayLink("https://sub.example.com/")).toEqual({
		href: "https://sub.example.com/",
		hostname: "sub.example.com",
	});
	expect(bookmarkDisplayLink("ftp://example.com")).toBeUndefined();
	expect(bookmarkDisplayLink("https://user@example.com")).toBeUndefined();
	expect(bookmarkDisplayLink(null)).toBeUndefined();
});
