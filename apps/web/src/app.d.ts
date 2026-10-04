import type { QuikmarqClient } from "#lib/quikmarq-client.ts";

declare global {
	namespace App {
		interface Locals {
			cms: QuikmarqClient;
		}
		interface PageData {
			theme?: "system" | "light" | "dark";
		}
	}
}

export {};
