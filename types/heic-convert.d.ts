declare module "heic-convert" {
  type HeicConvertInput = {
    buffer: Buffer | Uint8Array;
    format: "JPEG" | "PNG";
    quality?: number;
  };

  function convert(input: HeicConvertInput): Promise<ArrayBuffer | ArrayBuffer[]>;

  export default convert;
}
