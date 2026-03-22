/* eslint-disable @typescript-eslint/no-explicit-any -- react-plotly.js CJS interop; component type is dynamic */
import PlotlyDefault from 'react-plotly.js'

// `react-plotly.js` is CJS; the React component can be nested under one or more `default` keys.
export const PlotlyComponent: any =
  (PlotlyDefault as any)?.default?.default ?? (PlotlyDefault as any)?.default ?? PlotlyDefault

export function plotlyComponentOk(Plot: any): boolean {
  return typeof Plot === 'function' || (typeof Plot === 'object' && Boolean(Plot?.$$typeof))
}
