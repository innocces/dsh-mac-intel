import controlHtml from "./ui/control.html" with { type: "text" };
import controlCss from "./ui/control.css" with { type: "text" };
import controlJs from "./ui/control.js" with { type: "text" };
import dshMarkSvg from "../assets/dsh-mark.svg" with { type: "text" };
import ofmIconSvg from "../assets/ofm-icon.svg" with { type: "text" };
import montserratRegularBase64 from "../assets/fonts/montserrat-regular.woff2.base64" with {
  type: "text",
};
import montserratMediumBase64 from "../assets/fonts/montserrat-medium.woff2.base64" with {
  type: "text",
};

/** One file embedded in the compiled desktop application. */
export interface EmbeddedAsset {
  path: string;
  type: string;
  content: string | Uint8Array<ArrayBuffer>;
}

/** Decode a base64 import into the exact bytes of an embedded font. */
function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/** All control-center files embedded into the Deno Desktop executable. */
export const UI_ASSETS: Record<string, EmbeddedAsset> = {
  "/": { path: "/", type: "text/html; charset=utf-8", content: controlHtml },
  "/control/": { path: "/control/", type: "text/html; charset=utf-8", content: controlHtml },
  "/control/control.css": {
    path: "/control/control.css",
    type: "text/css; charset=utf-8",
    content: controlCss,
  },
  "/control/control.js": {
    path: "/control/control.js",
    type: "text/javascript; charset=utf-8",
    content: controlJs,
  },
  "/assets/dsh-mark.svg": {
    path: "/assets/dsh-mark.svg",
    type: "image/svg+xml",
    content: dshMarkSvg,
  },
  "/assets/ofm-icon.svg": {
    path: "/assets/ofm-icon.svg",
    type: "image/svg+xml",
    content: ofmIconSvg,
  },
  "/assets/fonts/montserrat-regular.woff2": {
    path: "/assets/fonts/montserrat-regular.woff2",
    type: "font/woff2",
    content: decodeBase64(montserratRegularBase64),
  },
  "/assets/fonts/montserrat-medium.woff2": {
    path: "/assets/fonts/montserrat-medium.woff2",
    type: "font/woff2",
    content: decodeBase64(montserratMediumBase64),
  },
};
