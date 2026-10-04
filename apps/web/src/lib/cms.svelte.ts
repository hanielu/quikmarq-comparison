import { cmsBackend } from "./cms-config.ts";
import { createCmsClient } from "./cms-client.ts";
import { goto, invalidate } from "$app/navigation";
import { getContext, setContext } from "svelte";
import { AUTH_DEPENDENCY } from "./auth-dependency.ts";
import { SessionCredential } from "./features/account/session-credential.ts";
import { CmsError, type QuikmarqClient, type Session } from "./quikmarq-client.ts";

async function readSessionToken(): Promise<string | null> {
	const response = await fetch("/auth/session", { cache: "no-store" });
	if (!response.ok) return null;
	const body: unknown = await response.json();
	return typeof body === "object" &&
		body !== null &&
		"token" in body &&
		typeof body.token === "string"
		? body.token
		: null;
}

export class BrowserCmsClient {
	#credential: SessionCredential;
	readonly api: QuikmarqClient;
	#channel: BroadcastChannel | null = null;
	session = $state.raw<Session | null>(null);

	constructor(initialSession: Session | null) {
		const credential = new SessionCredential(initialSession !== null, readSessionToken);
		this.api = createCmsClient(() => credential.token());
		this.#credential = credential;
		this.session = initialSession;
	}

	acceptSession(session: Session | null) {
		if (this.session?.user.id !== session?.user.id) this.#credential.reset(session !== null);
		else this.#credential.markSignedIn(session !== null);
		this.session = session;
	}

	activate() {
		if (this.#channel || typeof BroadcastChannel === "undefined") return;
		this.#channel = new BroadcastChannel(`quikmarq-${cmsBackend}-auth`);
		this.#channel.onmessage = (event: MessageEvent<unknown>) => {
			if (
				typeof event.data !== "object" ||
				event.data === null ||
				!("type" in event.data) ||
				event.data.type !== "changed"
			)
				return;
			this.#refreshFromCookie().catch(() => undefined);
		};
	}

	dispose() {
		this.#channel?.close();
		this.#channel = null;
	}

	async #refreshFromCookie() {
		const generation = this.#credential.reset(true);
		const session = await this.api.currentSession();
		if (generation !== this.#credential.generation) return;
		this.#credential.markSignedIn(session !== null);
		this.session = session;
		await invalidate(AUTH_DEPENDENCY);
		if (!session && location.pathname.startsWith("/app")) {
			await goto(`/login?next=${encodeURIComponent(location.pathname + location.search)}`);
		}
	}

	async signIn(email: string, password: string): Promise<void> {
		const login = await this.api.login(email, password);
		const response = await fetch("/auth/session", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ token: login.token }),
		});
		if (!response.ok) throw new CmsError("Could not establish your session.", response.status);
		this.#credential.adopt(login.token);
		this.session = { user: login.user };
		this.#channel?.postMessage({ type: "changed" });
	}

	async signOut(): Promise<void> {
		await this.api.logout();
		const response = await fetch("/auth/session", { method: "DELETE" });
		if (!response.ok) throw new CmsError("Could not clear your local session.", response.status);
		this.#credential.reset(false);
		this.session = null;
		this.#channel?.postMessage({ type: "changed" });
	}
}

const clientKey = Symbol("quikmarq-cms-client");

export function provideCmsClient(session: Session | null): BrowserCmsClient {
	const client = new BrowserCmsClient(session);
	setContext(clientKey, client);
	return client;
}

export function useCmsClient(): BrowserCmsClient {
	const client = getContext<BrowserCmsClient>(clientKey);
	if (!client) throw new Error("The content client is unavailable.");
	return client;
}
