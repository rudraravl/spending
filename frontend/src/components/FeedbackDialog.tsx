import { Button, Dialog, DialogActions, DialogContent, DialogTitle } from '@mui/material'

export type FeedbackDialogProps = {
  open: boolean
  title: string
  message: string
  onClose: () => void
  actionLabel?: string
}

export default function FeedbackDialog({
  open,
  title,
  message,
  onClose,
  actionLabel = 'OK',
}: FeedbackDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>{message}</DialogContent>
      <DialogActions>
        <Button onClick={onClose} variant="contained">
          {actionLabel}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

