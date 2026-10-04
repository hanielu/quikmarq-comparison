export const groupActionsKey = Symbol("quikmarq-group-actions");

import type { Group } from "./group-ranking.ts";

export interface GroupActions {
	readonly groups: Group[];
	readonly counts: Record<string, number>;
	readonly pendingGroupIds: ReadonlySet<string>;
	readonly busy: boolean;
	create: () => void;
	rename: (id: string, name: string) => void;
	reorder: (id: string, direction: -1 | 1) => Promise<void>;
	remove: (id: string) => Promise<void>;
	share: () => Promise<void>;
	refreshWorkspace: () => Promise<void>;
	optimisticCounts: (deltas: Readonly<Record<string, number>>) => {
		commit(): Promise<void>;
		rollback(): void;
	};
}
