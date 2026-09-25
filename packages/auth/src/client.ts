"use client";

import { createAuthClient } from "better-auth/react";
import { magicLinkClient, organizationClient, twoFactorClient } from "better-auth/client/plugins";
import { ssoClient } from "@better-auth/sso/client";

export const authClient = createAuthClient({
  plugins: [
    organizationClient(),
    twoFactorClient({
      twoFactorPage: "/verify-2fa",
    }),
    magicLinkClient(),
    ssoClient(),
  ],
});

export const { signIn, signOut, useSession, getSession } = authClient;
