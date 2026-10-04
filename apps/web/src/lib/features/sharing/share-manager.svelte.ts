import { mutateShare, shareStatus, type ShareStatus } from "#lib/custom-endpoints.ts";
import { errorMessage } from "#lib/error-message.ts";
import type { QuikmarqClient } from "#lib/quikmarq-client.ts";

interface ShareInputs {
	readonly client: QuikmarqClient;
	readonly selectedId: string | undefined;
	readonly refreshWorkspace: () => Promise<void>;
}

export class ShareManager {
	#dialogOpen = $state(false);
	#groupId = $state<string | null>(null);
	#status = $state.raw<ShareStatus | null>(null);
	#loading = $state(false);
	#busy = $state(false);
	#message = $state("");
	#request = 0;

	constructor(private readonly inputs: ShareInputs) {}

	get dialogOpen() {
		return this.#dialogOpen;
	}

	set dialogOpen(open: boolean) {
		this.#dialogOpen = open;
		if (!open) this.#request++;
	}

	get status() {
		return this.#status;
	}

	get loading() {
		return this.#loading;
	}

	get busy() {
		return this.#busy;
	}

	get message() {
		return this.#message;
	}

	get url() {
		if (!this.#status?.token || typeof location === "undefined") return "";
		return `${location.origin}/share/${encodeURIComponent(this.#status.token)}`;
	}

	syncSelected(selectedId: string | undefined) {
		if (this.#groupId === null || this.#groupId === selectedId) return;

		this.#request++;
		this.#groupId = null;
		this.#status = null;
		this.#dialogOpen = false;
		this.#loading = false;
		this.#message = "";
	}

	open = async () => {
		const groupId = this.inputs.selectedId;
		if (!groupId) return;

		const request = ++this.#request;
		this.#groupId = groupId;
		this.#status = null;
		this.#message = "";
		this.#loading = true;
		this.#dialogOpen = true;

		try {
			const status = await shareStatus(this.inputs.client, groupId);
			if (this.#current(request, groupId)) this.#status = status;
		} catch (error) {
			if (this.#current(request, groupId)) this.#message = errorMessage(error);
		} finally {
			if (this.#current(request, groupId)) this.#loading = false;
		}
	};

	change = async (method: "POST" | "DELETE", rotate = false) => {
		const groupId = this.#groupId;
		if (!groupId || !this.#currentGroup(groupId) || this.#busy) return;

		this.#busy = true;
		this.#message = "";

		let status: ShareStatus;
		try {
			status = await mutateShare(this.inputs.client, groupId, method, rotate);
		} catch (error) {
			if (this.#dialogOpen && this.#groupId === groupId && this.#currentGroup(groupId)) {
				this.#message = errorMessage(error);
			}
			this.#busy = false;
			return;
		}

		// A dialog reopened during this mutation may have read the old status.
		// Invalidate that read and apply the mutation's authoritative response.
		if (this.#groupId === groupId && this.#currentGroup(groupId)) {
			this.#request++;
			this.#status = status;
			this.#loading = false;
		}

		try {
			await this.inputs.refreshWorkspace();
		} catch {
			if (this.#dialogOpen && this.#groupId === groupId && this.#currentGroup(groupId)) {
				this.#message =
					"Sharing updated, but the workspace could not refresh. Reload to see the latest settings.";
			}
		} finally {
			this.#busy = false;
		}
	};

	copy = async () => {
		const url = this.url;
		const groupId = this.#groupId;
		const request = this.#request;
		if (!url || !groupId) return;

		try {
			await navigator.clipboard.writeText(url);
			if (this.#current(request, groupId) && this.url === url) this.#message = "Share link copied.";
		} catch (error) {
			if (this.#current(request, groupId) && this.url === url) this.#message = errorMessage(error);
		}
	};

	#currentGroup(groupId: string) {
		return this.inputs.selectedId === groupId;
	}

	#current(request: number, groupId: string) {
		return (
			this.#request === request &&
			this.#dialogOpen &&
			this.#groupId === groupId &&
			this.#currentGroup(groupId)
		);
	}
}
