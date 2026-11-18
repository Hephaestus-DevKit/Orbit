const CAT_HEAD_PATH =
  "M13 19 11.5 10.5l8.1 4.4a15.6 15.6 0 0 1 8.8 0l8.1-4.4L35 19c2.6 2.5 4 5.8 4 9.5 0 7.6-6.2 12.2-15 12.2S9 36.1 9 28.5c0-3.7 1.4-7 4-9.5Z";
const CAT_FACE_PATH = "M23.9 28.8v2.3m-2.5.8c1.5 1.4 3.7 1.4 5.2 0";
const CAT_EYE_RADIUS = 1.35;

/** Render the reusable, CSS-themed Orbit cat mark. */
export function renderOrbitMark(className: string): string {
  return `<svg class="orbit-mark ${className}" viewBox="0 0 48 48" fill="none" aria-hidden="true" focusable="false">
    <path class="orbit-cat-head" d="${CAT_HEAD_PATH}" />
    <circle class="orbit-cat-eye" cx="18.5" cy="26.6" r="${CAT_EYE_RADIUS}" />
    <circle class="orbit-cat-eye" cx="29.5" cy="26.6" r="${CAT_EYE_RADIUS}" />
    <path class="orbit-cat-face" d="${CAT_FACE_PATH}" />
    <circle class="orbit-cat-satellite" cx="37" cy="12" r="2.2" />
  </svg>`;
}

/** Standalone favicon asset using the same cat geometry and brand colors. */
export const WEB_UI_FAVICON_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" fill="none">
  <path d="${CAT_HEAD_PATH}" stroke="#587481" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
  <circle cx="18.5" cy="26.6" r="${CAT_EYE_RADIUS}" fill="#587481" />
  <circle cx="29.5" cy="26.6" r="${CAT_EYE_RADIUS}" fill="#587481" />
  <path d="${CAT_FACE_PATH}" stroke="#587481" stroke-width="1.35" stroke-linecap="round" />
  <circle cx="37" cy="12" r="2.2" fill="#d97972" />
</svg>`;
