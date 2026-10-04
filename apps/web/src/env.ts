import { defineEnvVars } from "@sveltejs/kit/env";
import * as v from "valibot";

export const variables = defineEnvVars({
	PUBLIC_CMS_BACKEND: { public: true, static: true, schema: v.picklist(["ridu", "payload"]) },
	PUBLIC_CMS_URL: { public: true, static: true, schema: v.pipe(v.string(), v.url()) },
});
