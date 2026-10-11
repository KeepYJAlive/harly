"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export function AvailabilityCalendarDialog({
  children,
  label = "Select availability",
}: {
  children: ReactNode;
  label?: string;
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" variant="outline">
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent
        className="z-[70] flex max-h-[96dvh] w-[96vw] max-w-[96vw] flex-col gap-4 sm:max-w-[1440px]"
        overlayClassName="z-[69]"
      >
        <DialogHeader>
          <DialogTitle>{label}</DialogTitle>
          <DialogDescription>
            Browse weeks and select interview times. Your selections are kept
            when you return to the interview details.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto">{children}</div>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button">Done</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
