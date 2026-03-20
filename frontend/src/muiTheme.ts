import { createTheme } from '@mui/material/styles'
import type { ThemeOptions } from '@mui/material/styles'

export function makeMuiTheme(mode: 'light' | 'dark') {
  const options: ThemeOptions = {
    palette: {
      mode,
      primary: {
        main: mode === 'dark' ? '#c084fc' : '#aa3bff',
      },
    },
    shape: { borderRadius: 14 },
    typography: {
      fontFamily: "system-ui, 'Segoe UI', Roboto, sans-serif",
    },
  }

  return createTheme(options)
}

