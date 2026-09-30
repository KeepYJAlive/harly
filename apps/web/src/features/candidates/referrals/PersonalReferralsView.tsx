"use client";

import { useState, useTransition } from "react";
import { Handshake, Mail, Plus, UserRoundX } from "lucide-react";
import { useRouter } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { toast } from "@/lib/notification-island/toast";
import { formatShort } from "@/lib/date";
import {
  createPersonalReferral,
  revokePersonalReferral,
} from "./personal-actions";

type ReferralRow = {
  id: string;
  referredName: string | null;
  referredEmail: string | null;
  status: "pending" | "accepted" | "revoked" | "expired";
  createdAt: string;
  expiresAt: string | null;
  acceptedAt: string | null;
  revokedAt: string | null;
  referrerName: string;
  used: number;
  remaining: number;
};

const STATUS_VARIANT = {
  pending: "secondary",
  accepted: "default",
  revoked: "destructive",
  expired: "outline",
} as const;

export function PersonalReferralsView({
  referrals,
}: {
  referrals: ReferralRow[];
}) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(referrals.length === 0);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      const result = await createPersonalReferral({ name, email });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Referral invitation queued");
      setName("");
      setEmail("");
      setShowForm(false);
      router.refresh();
    });
  }

  function revoke(referralId: string) {
    startTransition(async () => {
      const result = await revokePersonalReferral({ referralId });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Referral revoked");
      router.refresh();
    });
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Referrals</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Invite people to your careers site. Each accepted referral can be
            applied to up to three submitted applications.
          </p>
        </div>
        <Button type="button" onClick={() => setShowForm((value) => !value)}>
          <Plus className="size-4" />
          Refer someone
        </Button>
      </div>

      {showForm ? (
        <Card>
          <CardHeader>
            <CardTitle>Refer someone</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-1.5 text-sm font-medium">
                Name
                <Input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Alex Smith"
                  autoComplete="off"
                  required
                />
              </label>
              <label className="space-y-1.5 text-sm font-medium">
                Email
                <Input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="alex@example.com"
                  autoComplete="off"
                  required
                />
              </label>
              <div className="flex justify-end gap-2 sm:col-span-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowForm(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={pending}>
                  <Mail className="size-4" />
                  {pending ? "Queueing…" : "Send referral"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {referrals.length === 0 ? (
        <div className="rounded-2xl border border-dashed p-12 text-center">
          <Handshake className="mx-auto size-8 text-muted-foreground" />
          <h2 className="mt-4 font-semibold">No personal referrals yet</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Send the first secure referral invitation above.
          </p>
        </div>
      ) : (
        <Card className="gap-0 divide-y overflow-hidden py-0">
          {referrals.map((referral) => (
            <div
              key={referral.id}
              className="flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{referral.referredName}</p>
                  <Badge variant={STATUS_VARIANT[referral.status]}>
                    {referral.status[0]?.toUpperCase()}
                    {referral.status.slice(1)}
                  </Badge>
                </div>
                <p className="mt-0.5 truncate text-sm text-muted-foreground">
                  {referral.referredEmail}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Created {formatShort(new Date(referral.createdAt))} by{" "}
                  {referral.referrerName}
                </p>
              </div>
              <div className="flex items-center gap-4 sm:text-right">
                <div>
                  <p className="text-sm font-medium">
                    {referral.used} of 3 applications used
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {referral.remaining} remaining
                  </p>
                </div>
                {referral.status === "pending" ||
                referral.status === "accepted" ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() => revoke(referral.id)}
                  >
                    <UserRoundX className="size-4" />
                    Revoke
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
