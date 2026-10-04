import { cmsBackend, cmsURL } from "./cms-config.ts";
import { PayloadClient } from "./payload-client.ts";
import { RiduClient } from "./ridu-client.ts";
import type { QuikmarqClient } from "./quikmarq-client.ts";

export function createCmsClient(
	token: () => Promise<string | null>,
	fetcher: typeof fetch = fetch
): QuikmarqClient {
	return cmsBackend === "ridu"
		? new RiduClient(cmsURL, token, fetcher)
		: new PayloadClient(cmsURL, token, fetcher);
}
