import { Button, Dialog, DialogActions, DialogContent, DialogTitle } from '@mui/material'

export type ConfirmDialogProps = {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  onConfirm: () => void | Promise<void>
  onCancel: () => void
}

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Delete',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onClose={onCancel} maxWidth="xs" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>{message}</DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>Cancel</Button>
        <Button color="error" variant="contained" onClick={() => void onConfirm()}>
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
