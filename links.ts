export function xProfileLink(username: string): string {
	const clean = username.trim().replace(/^@+/, "");
	if (!clean) return username;
	const url = `https://x.com/${clean}`;
	return `\u001b]8;;${url}\u0007@${clean}\u001b]8;;\u0007`;
}
