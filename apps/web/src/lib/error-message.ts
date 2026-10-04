/** A user-facing message for an expected failure at a feature boundary. */
export function errorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	return "Something went wrong. Please try again.";
}
