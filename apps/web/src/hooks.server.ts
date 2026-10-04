import { createCmsClient } from "#lib/cms-client.ts";
import { sessionCookieName } from "#lib/cms-config.ts";
import type { Handle } from "@sveltejs/kit/hooks";

export const handle: Handle = async ({ event, resolve }) => {
	const token = event.cookies.get(sessionCookieName) ?? null;
	event.locals.cms = createCmsClient(async () => token, event.fetch);
	return resolve(event);
};
