function cssValue(styles: CSSStyleDeclaration, property: string): string {
  const value = styles.getPropertyValue(property).trim()
  if (!value) throw new Error(`Missing CSS theme property: ${property}`)
  return value
}

/** MapLibre paints WebGL layers, so resolve their visual tokens from CSS. */
export function readMapTheme(element: Element) {
  const styles = getComputedStyle(element)
  const value = (property: string) => cssValue(styles, property)
  const number = (property: string) => {
    const result = Number.parseFloat(value(property))
    if (!Number.isFinite(result)) throw new Error(`Invalid numeric CSS theme property: ${property}`)
    return result
  }
  return {
    background: value('--map-background'),
    gridColor: value('--map-grid-color'),
    gridWidth: number('--map-grid-width'),
    footprintColor: value('--map-footprint-color'),
    footprintOpacity: number('--map-footprint-opacity'),
    selectedFootprintOpacity: number('--map-footprint-selected-opacity'),
    footprintWidth: number('--map-footprint-width'),
    selectedFootprintWidth: number('--map-footprint-selected-width'),
    pinColor: value('--map-pin-color'),
    selectedPinColor: value('--map-pin-selected-color'),
    pinRadius: number('--map-pin-radius'),
    selectedPinRadius: number('--map-pin-selected-radius'),
    pinStrokeColor: value('--map-pin-stroke-color'),
    pinStrokeWidth: number('--map-pin-stroke-width'),
    pinHitRadius: number('--map-pin-hit-radius'),
    pinHitOpacity: number('--map-pin-hit-opacity'),
    rasterFadeDuration: number('--map-raster-fade-duration'),
    fitPadding: number('--map-fit-padding'),
    itemFitPadding: number('--map-item-fit-padding'),
  }
}

export type MapTheme = ReturnType<typeof readMapTheme>

export function syncBrowserTheme() {
  const styles = getComputedStyle(document.documentElement)
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', cssValue(styles, '--page-background'))
  document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', styles.colorScheme)
}
