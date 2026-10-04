import { PUBLIC_CMS_BACKEND, PUBLIC_CMS_URL } from "$app/env/public";

export const cmsBackend = PUBLIC_CMS_BACKEND;
export const cmsURL = PUBLIC_CMS_URL;
export const cmsName = cmsBackend === "ridu" ? "RiduCMS" : "PayloadCMS";
export const cmsAdminURL = new URL("/admin", cmsURL).href;
// A backend change on the same app origin must not reuse another CMS's credential.
export const sessionCookieName = `quikmarq_${cmsBackend}_session`;
