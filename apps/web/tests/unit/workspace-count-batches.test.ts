import { expect, test } from "bun:test";
import {
	WORKSPACE_COUNT_BATCH_LIMIT,
	workspaceCountLoadChunks,
} from "../../src/lib/features/workspace/workspace-count-batches.ts";

test("large workspaces load every group through bounded count batches", () => {
	const ids = Array.from(
		{ length: WORKSPACE_COUNT_BATCH_LIMIT * 2 + 1 },
		(_, index) => `group-${index}`
	);
	const chunks = workspaceCountLoadChunks(ids);

	expect(chunks.length).toBeGreaterThan(2);
	expect(
		chunks.every((chunk) => chunk.length > 0 && chunk.length <= WORKSPACE_COUNT_BATCH_LIMIT / 2)
	).toBe(true);
	expect(chunks.flat()).toEqual(ids);
	expect(workspaceCountLoadChunks([])).toEqual([]);
});
