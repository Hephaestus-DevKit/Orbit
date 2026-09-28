/** Pure geometry shared by the browser controller and its regression tests. */
export function createPreviewGeometry() {
  function dock(width: number, preferred: number, surfaceWidth = 740) {
    const minPercent = Math.ceil(((surfaceWidth + 8) / width) * 100);
    const maxPercent = Math.floor(((width - 420) / width) * 100);
    const narrow = minPercent > maxPercent;
    const min = narrow ? 100 : minPercent;
    const max = narrow ? 100 : maxPercent;
    const percent = Math.max(
      min,
      Math.min(max, Number.isFinite(preferred) ? preferred : 54),
    );
    return { narrow, min, max, percent };
  }
  function image(
    width: number,
    height: number,
    naturalWidth: number,
    naturalHeight: number,
    original: boolean,
  ) {
    if (naturalWidth <= 0 || naturalHeight <= 0)
      return { scale: 1, width: 0, height: 0 };
    const scale = original
      ? 1
      : Math.max(
          0.01,
          Math.min(
            1,
            Math.max(0, width - 32) / naturalWidth,
            Math.max(0, height - 32) / naturalHeight,
          ),
        );
    return {
      scale,
      width: Math.floor(naturalWidth * scale),
      height: Math.floor(naturalHeight * scale),
    };
  }
  return { dock, image };
}
