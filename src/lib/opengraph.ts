import { container, text } from "@takumi-rs/helpers";
import { render } from "takumi-js";

const WIDTH = 1200;
const HEIGHT = 630;

const imageTree = container({
  children: [
    container({
      style: {
        backgroundColor: "#d7ff3f",
        height: 12,
        left: 64,
        position: "absolute",
        top: 0,
        width: 220,
      },
    }),
    container({
      children: [
        container({
          style: {
            backgroundColor: "#d7ff3f",
            borderRadius: 999,
            height: 24,
            width: 24,
          },
        }),
        text("X-LOOKUP", {
          color: "#d7ff3f",
          fontFamily: "monospace",
          fontSize: 26,
          fontWeight: 700,
          letterSpacing: 4,
        }),
      ],
      style: {
        alignItems: "center",
        display: "flex",
        flexDirection: "row",
        gap: 16,
      },
    }),
    container({
      children: [
        text("A sharper lens\nfor the public web.", {
          color: "#f4f7fb",
          fontFamily: "monospace",
          fontSize: 68,
          fontWeight: 700,
          lineHeight: 1.08,
          whiteSpace: "pre",
        }),
        text(
          "Read X/Twitter content as compact Markdown or JSON.\nNo login. No API key. Just the signal.",
          {
            color: "#8d96a5",
            fontFamily: "monospace",
            fontSize: 25,
            lineHeight: 1.35,
            whiteSpace: "pre",
          }
        ),
      ],
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 22,
        maxWidth: 980,
      },
    }),
    container({
      children: [
        text("x-lookup.mynameistito.com", {
          color: "#d0d6e0",
          fontFamily: "monospace",
          fontSize: 22,
        }),
        text("PUBLIC DATA / PRIVATE FOCUS", {
          color: "#687181",
          fontFamily: "monospace",
          fontSize: 18,
          letterSpacing: 2,
        }),
      ],
      style: {
        alignItems: "center",
        display: "flex",
        flexDirection: "row",
        justifyContent: "space-between",
      },
    }),
  ],
  style: {
    backgroundColor: "#08090a",
    color: "#d0d6e0",
    display: "flex",
    flexDirection: "column",
    height: HEIGHT,
    justifyContent: "space-between",
    padding: 64,
    position: "relative",
    width: WIDTH,
  },
});

/** Render the static 1200x630 share card with Takumi's Worker WASM backend. */
export const renderOpenGraphImage = async (): Promise<Uint8Array> =>
  new Uint8Array(
    await render(imageTree, { format: "png", height: HEIGHT, width: WIDTH })
  );
