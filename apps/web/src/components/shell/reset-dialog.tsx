'use client';

import type * as React from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { toast } from '@/components/ui/toaster';
import { useWorkspace } from '@/lib/workspace-store';

export function ResetWorkspaceDialog({ children }: { children: React.ReactNode }) {
  const { reset } = useWorkspace();
  return (
    <Dialog>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reset demo workspace?</DialogTitle>
          <DialogDescription>
            Findings you saved, with their status changes and notes, will be discarded. Company Intelligence is not
            affected, and only your own workspace is reset.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary">Cancel</Button>
          </DialogClose>
          <DialogClose asChild>
            <Button
              variant="destructive"
              onClick={() => {
                reset();
                toast.success('Workspace reset.');
              }}
            >
              Reset workspace
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
