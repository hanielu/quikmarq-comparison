export const WORKSPACE_COUNT_BATCH_LIMIT = 64;

const LOAD_CHUNK_SIZE = 32;

/** Keep each client load below the server limit while allowing any number of groups. */
export function workspaceCountLoadChunks<T>(items: readonly T[]): T[][] {
	const chunks: T[][] = [];
	for (let index = 0; index < items.length; index += LOAD_CHUNK_SIZE) {
		chunks.push(items.slice(index, index + LOAD_CHUNK_SIZE));
	}
	return chunks;
}
