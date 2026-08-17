# Orbit model providers

This package owns model-family behavior and HTTP wire protocols. Its central
rule is simple: **the model decides semantic policy; the configured provider
decides transport and credentials**.

That separation lets a DeepSeek model hosted by TokenDance or another gateway
receive the same reasoning, tool-history, context, and cache treatment as the
official service without rewriting the gateway's model ID or protocol.

## Request path

```text
configured profile + selected model
               │
               ├─ ModelAdaptation ──> family capabilities and thinking policy
               │
               └─ ProviderFactory ──> selected wire transport
                                          │
                              CanonicalRequest
                                          │
                    Chat / Responses / Anthropic serialization
                                          │
                          bounded HTTP and validated SSE
```

| Configured transport    | DeepSeek-family model                                | Other model                         |
| ----------------------- | ---------------------------------------------------- | ----------------------------------- |
| Official `deepseek`     | Chat, Responses, or Anthropic official contract      | Rejected when not officially mapped |
| `openai-compatible`     | DeepSeek semantics over the configured OpenAI API    | Generic OpenAI-compatible semantics |
| `anthropic-compatible`  | DeepSeek semantics over the configured Anthropic API | Generic Anthropic semantics         |
| Native OpenAI/Anthropic | Same model-family resolver if explicitly selected    | Native provider behavior            |

Compatible gateways retain their exact namespaced model ID. Only the official
DeepSeek endpoint maps stable Orbit aliases to official request model names.
Unknown models stay on a conservative generic path and can use explicit
capability overrides from configuration.

Vision-capable models may declare per-model `maxImages` and `maxImageBytes`
overrides. Orbit validates those limits before starting a turn so oversized
media never reaches the provider transport.

`ModelAwareProvider` composes the two paths for generic OpenAI-compatible
profiles: it selects DeepSeek semantics at request time from the model ID, so
TokenDance or another gateway does not need a provider name containing
"deepseek". Generic models continue through the gateway's ordinary adapter;
the selected DeepSeek transport still preserves the gateway base URL and exact
model ID.

## Source ownership

| Directory or file       | Owns                                                                  |
| ----------------------- | --------------------------------------------------------------------- |
| `ModelAdaptation.ts`    | endpoint-independent model-family detection and thinking policy       |
| `request/`              | deterministic tools/schema/message input canonicalization             |
| `transport/`            | shared transport lifecycle helpers, never model semantics             |
| `openai-compatible/`    | Chat Completions, Responses dispatch, completion, and embedding wire  |
| `anthropic-compatible/` | Messages API request/stream mapping                                   |
| `deepseek/`             | official product routing and DeepSeek-specific protocol serialization |
| `openai/`, `anthropic/` | native provider identities built on compatible transports             |
| `ollama/`               | local Ollama identity and defaults                                    |

`deepseek/DeepSeekOpenAIProvider.ts` is a deprecated source-level alias kept
only for compatibility. New code imports `OpenAICompatibleProvider` from the
package root or `openai-compatible/` internally.

## Invariants

- Constructors are side-effect free. `initialize()` performs idempotent,
  best-effort connection preheating.
- Every external response and stream frame is bounded and schema-validated.
- Tool definitions are recursively canonicalized and lexically ordered before
  any wire serializer sees them.
- Model-family behavior never depends only on a hostname or provider label.
- Official endpoint restrictions do not leak into third-party gateway model
  namespaces.
- Abort, timeout, retry ownership, sanitized errors, request IDs, and provider
  usage metadata survive every transport.
- Cache telemetry describes provider-reported usage; it never manufactures a
  primer request or a synthetic hit rate.

## Verification

From the repository root:

```bash
pnpm test:deepseek
pnpm test:anthropic
pnpm --filter @orbit-build/model-providers build
pnpm verify
```

Real provider probes consume API quota and should be run only through securely
stored credentials, for example `orbit doctor --probe --deepseek --strict`.
