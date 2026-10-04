/** A browser JWT lives only in memory; a first-party HTTP-only cookie restores it after reload. */
export class SessionCredential {
	#token: string | null = null;
	#pending: Promise<string | null> | null = null;
	#generation = 0;
	#signedIn: boolean;

	constructor(
		signedIn: boolean,
		private readonly readCookieToken: () => Promise<string | null>
	) {
		this.#signedIn = signedIn;
	}

	get generation() {
		return this.#generation;
	}

	reset(signedIn: boolean): number {
		this.#generation++;
		this.#token = null;
		this.#pending = null;
		this.#signedIn = signedIn;
		return this.#generation;
	}

	adopt(token: string) {
		this.reset(true);
		this.#token = token;
	}

	markSignedIn(signedIn: boolean) {
		this.#signedIn = signedIn;
		if (!signedIn) this.reset(false);
	}

	async token(): Promise<string | null> {
		if (this.#token) return this.#token;
		if (!this.#signedIn) return null;
		const generation = this.#generation;
		if (!this.#pending) {
			const pending = this.readCookieToken().finally(() => {
				if (this.#pending === pending) this.#pending = null;
			});
			this.#pending = pending;
		}
		const token = await this.#pending;
		if (generation !== this.#generation || !this.#signedIn) return null;
		this.#token = token;
		return token;
	}
}
