import type { LayoutServerLoad } from "./$types";
import { AUTH_DEPENDENCY } from "#lib/auth-dependency.ts";

export const load: LayoutServerLoad = async ({ cookies, locals, depends }) => {
	depends(AUTH_DEPENDENCY);
	const preference = cookies.get("quikmarq_theme");
	const theme: "system" | "light" | "dark" =
		preference === "dark" || preference === "light" ? preference : "system";
	// Verified once per request; the snapshot never contains the session token.
	return { theme, session: await locals.cms.currentSession() };
};
