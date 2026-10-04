import { expect, test } from "bun:test";
import { SessionCredential } from "../../src/lib/features/account/session-credential.ts";

test("concurrent requests share one cookie read", async () => {
	let reads = 0;
	const credential = new SessionCredential(true, async () => {
		reads++;
		return "jwt-1";
	});
	expect(await Promise.all([credential.token(), credential.token()])).toEqual(["jwt-1", "jwt-1"]);
	expect(reads).toBe(1);
	expect(await credential.token()).toBe("jwt-1");
	expect(reads).toBe(1);
});

test("an old cookie read cannot restore a token after sign-out or account switch", async () => {
	let complete: (token: string) => void = () => undefined;
	const credential = new SessionCredential(
		true,
		() =>
			new Promise((resolve) => {
				complete = resolve;
			})
	);
	const stale = credential.token();
	credential.reset(false);
	complete("old-jwt");
	expect(await stale).toBeNull();
	expect(await credential.token()).toBeNull();
	credential.adopt("new-jwt");
	expect(await credential.token()).toBe("new-jwt");
});

test("a fresh read remains owned when an earlier request settles later", async () => {
	const complete: Array<(token: string) => void> = [];
	const credential = new SessionCredential(
		true,
		() => new Promise((resolve) => complete.push(resolve))
	);
	const first = credential.token();
	credential.reset(true);
	const second = credential.token();
	complete[0]("old-jwt");
	expect(await first).toBeNull();
	complete[1]("new-jwt");
	expect(await second).toBe("new-jwt");
	expect(await credential.token()).toBe("new-jwt");
});
