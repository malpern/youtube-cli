import type { Page } from "playwright";

export interface AccountSnapshot {
  signedIn: boolean;
  accountLabel: string | null;
  currentUrl: string;
  pageTitle: string;
}

export interface AccountSnapshotOptions {
  navigate?: boolean;
}

export async function captureAccountSnapshot(
  page: Page,
  youtubeBaseUrl: string,
  options: AccountSnapshotOptions = {}
): Promise<AccountSnapshot> {
  const { navigate = true } = options;

  if (navigate) {
    await page.goto(youtubeBaseUrl, { waitUntil: "domcontentloaded" }).catch(() => undefined);
  }

  await page.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => undefined);
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);

  const accountButton = page.locator("button#avatar-btn, button[aria-label*='Google Account'], button[aria-label*='Account menu']");
  const signInLink = page.getByRole("link", { name: /sign in/i });

  let signedIn = false;
  let accountLabel: string | null = null;

  if (await accountButton.count()) {
    signedIn = true;
    accountLabel = (await accountButton.first().getAttribute("aria-label")) ?? "Signed in";
  } else if (await signInLink.count()) {
    signedIn = false;
  }

  return {
    signedIn,
    accountLabel,
    currentUrl: page.url(),
    pageTitle: await page.title().catch(() => "")
  };
}

export function accountMatches(expectedAccount: string | undefined, snapshot: AccountSnapshot): boolean {
  if (!expectedAccount) {
    return true;
  }

  const haystack = snapshot.accountLabel?.toLowerCase() ?? "";
  return haystack.includes(expectedAccount.toLowerCase());
}
