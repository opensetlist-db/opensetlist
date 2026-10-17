import { describe, it, expect, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import {
  anthropicRawTranslate,
  ANTHROPIC_MODEL,
} from "@/lib/translator/anthropic";
import { TranslationTruncatedError } from "@/lib/translator/types";

// Minimal fake of client.messages.create — the helper only touches that
// one method, so a structural stub keeps the test independent of the SDK's
// transport layer.
function fakeClient(response: Partial<Anthropic.Message>) {
  const create = vi.fn().mockResolvedValue({
    content: [],
    stop_reason: "end_turn",
    usage: { input_tokens: 10, output_tokens: 20 },
    ...response,
  });
  return {
    client: { messages: { create } } as unknown as Anthropic,
    create,
  };
}

const JSON_OUT = '{"ko":"좋았다","ja":"良かった","en":"It was great"}';

describe("anthropicRawTranslate", () => {
  it("sends a cached system prompt, no thinking, and an object schema", async () => {
    const { client, create } = fakeClient({
      content: [{ type: "text", text: JSON_OUT } as Anthropic.TextBlock],
    });

    await anthropicRawTranslate(client, "좋았다", "ko", "SYSTEM");

    const [params] = create.mock.calls[0];
    expect(params.model).toBe(ANTHROPIC_MODEL);
    expect(params.system).toEqual([
      { type: "text", text: "SYSTEM", cache_control: { type: "ephemeral" } },
    ]);
    expect(params.thinking).toEqual({ type: "disabled" });
    expect(params.output_config.effort).toBe("low");
    expect(params.output_config.format.type).toBe("json_schema");
    expect(params.output_config.format.schema.required).toEqual([
      "ko",
      "ja",
      "en",
    ]);
    // Post-Opus-4.6 models 400 on any temperature other than 1.0.
    expect(params).not.toHaveProperty("temperature");
    expect(params.messages[0].content).toContain("source_locale: ko");
  });

  it("returns the joined text and usage", async () => {
    const { client } = fakeClient({
      content: [{ type: "text", text: JSON_OUT } as Anthropic.TextBlock],
    });
    const { raw, usage } = await anthropicRawTranslate(client, "x", "ko", "S");
    expect(raw).toBe(JSON_OUT);
    expect(usage.output_tokens).toBe(20);
  });

  it("honours a per-call model override", async () => {
    const { client, create } = fakeClient({
      content: [{ type: "text", text: JSON_OUT } as Anthropic.TextBlock],
    });
    await anthropicRawTranslate(
      client,
      "x",
      "ko",
      "S",
      undefined,
      "claude-sonnet-5-5",
    );
    expect(create.mock.calls[0][0].model).toBe("claude-sonnet-5-5");
    // Sonnet 5.5 400s on `disabled`; its no-thinking shape is between_tools.
    expect(create.mock.calls[0][0].thinking).toEqual({ type: "between_tools" });
  });

  it("forwards the abort signal as a request option", async () => {
    const { client, create } = fakeClient({
      content: [{ type: "text", text: JSON_OUT } as Anthropic.TextBlock],
    });
    const signal = new AbortController().signal;
    await anthropicRawTranslate(client, "x", "ko", "S", signal);
    expect(create.mock.calls[0][1]).toEqual({ signal });
  });

  it("throws TranslationTruncatedError on max_tokens", async () => {
    const { client } = fakeClient({ stop_reason: "max_tokens" });
    await expect(
      anthropicRawTranslate(client, "x", "ko", "S"),
    ).rejects.toBeInstanceOf(TranslationTruncatedError);
  });

  it("surfaces a refusal stop reason", async () => {
    const { client } = fakeClient({ stop_reason: "refusal" });
    await expect(anthropicRawTranslate(client, "x", "ko", "S")).rejects.toThrow(
      /stop_reason=refusal/,
    );
  });

  it("throws on an empty response", async () => {
    const { client } = fakeClient({ content: [] });
    await expect(anthropicRawTranslate(client, "x", "ko", "S")).rejects.toThrow(
      /empty translation/,
    );
  });
});
