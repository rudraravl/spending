import type { PropsWithChildren } from 'react'
import { useMemo } from 'react'
import { ThemeProvider, useMediaQuery } from '@mui/material'
import { makeMuiTheme } from './muiTheme'

export default function MuiThemeProvider({ children }: PropsWithChildren) {
  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)')
  const theme = useMemo(() => makeMuiTheme(prefersDark ? 'dark' : 'light'), [prefersDark])
  return <ThemeProvider theme={theme}>{children}</ThemeProvider>
}

