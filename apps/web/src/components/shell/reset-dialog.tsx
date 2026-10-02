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
import { describeFailure } from '@/lib/api';
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
            Your analyses and the findings you saved, with their status changes and notes, are discarded and the demo
            examples are restored. Company Intelligence is not affected, and only your own workspace is reset.
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
                reset()
                  .then(() => toast.success('Workspace reset.', { description: 'Restored to the demo seed.' }))
                  .catch((err) => toast.error('The workspace was not reset', { description: describeFailure(err) }));
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
