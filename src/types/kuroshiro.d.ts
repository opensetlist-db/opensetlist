declare module "kuroshiro" {
  interface ConvertOptions {
    to: "romaji" | "hiragana" | "katakana";
    mode?: "normal" | "spaced" | "okurigana" | "furigana";
    romajiSystem?: "nippon" | "passport" | "hepburn";
  }

  class Kuroshiro {
    init(analyzer: unknown): Promise<void>;
    convert(str: string, options: ConvertOptions): Promise<string>;
  }

  export default Kuroshiro;
}

declare module "kuroshiro-analyzer-kuromoji" {
  class KuromojiAnalyzer {
    constructor(options?: { dictPath?: string });
  }

  export default KuromojiAnalyzer;
}
