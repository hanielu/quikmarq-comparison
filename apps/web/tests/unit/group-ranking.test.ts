import { expect, test } from "bun:test";
import { GROUP_RANK_MIDPOINT, rankBetween } from "../../src/lib/features/groups/group-ranking";

test("rank insertion either falls strictly between neighbours or reports exhaustion", () => {
	expect(rankBetween()).toBe(GROUP_RANK_MIDPOINT);
	const low = "0".repeat(32);
	const high = "z".repeat(32);
	const middle = rankBetween(low, high)!;
	expect(low < middle && middle < high).toBe(true);
	expect(rankBetween("0".repeat(31) + "a", "0".repeat(31) + "b")).toBeNull();
	let left = low;
	for (let i = 0; i < 100; i++) {
		const rank = rankBetween(left, high);
		expect(rank !== null && left < rank && rank < high).toBe(true);
		left = rank!;
	}
});
