import type { Group } from "../../quikmarq-client.ts";

export type { Group };

const rankDigits = "0123456789abcdefghijklmnopqrstuvwxyz";
const rankWidth = 32;
const rankLimit = 36n ** BigInt(rankWidth) - 1n;
export const GROUP_RANK_MIDPOINT = `h${"z".repeat(rankWidth - 1)}`;

function rankValue(rank: string): bigint {
	if (!/^[0-9a-z]{32}$/.test(rank)) throw new Error("Invalid group rank. Refresh this collection.");
	let value = 0n;
	for (const digit of rank) value = value * 36n + BigInt(rankDigits.indexOf(digit));
	return value;
}

function rankString(value: bigint): string {
	let result = "";
	for (let index = 0; index < rankWidth; index++) {
		result = rankDigits[Number(value % 36n)] + result;
		value /= 36n;
	}
	return result;
}

/** Fixed-width keys allow a group reorder with a single versioned document update. */
export function rankBetween(lower?: string, upper?: string): string | null {
	const low = lower === undefined ? -1n : rankValue(lower);
	const high = upper === undefined ? rankLimit : rankValue(upper);
	if (low >= high) throw new Error("Invalid rank interval");
	if (high - low <= 1n) return null;
	return rankString((low + high) / 2n);
}

export function nextRank(last?: string): string {
	const rank = rankBetween(last);
	if (rank === null)
		throw new Error("This collection needs its order refreshed before adding more items.");
	return rank;
}
