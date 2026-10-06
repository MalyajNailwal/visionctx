# Cost model

Pricing lives in `pricing.yaml`, initially empty. Add an exact model ID with `input_per_million`, `output_per_million`, `cache_read_per_million`, and `cache_write_per_million` to calculate a final estimated cost from provider-reported usage. VisionCtx displays no dollar savings because the original request's cache split and task outcome are not known from a token-count probe. An estimate is labeled `ESTIMATED`; Anthropic usage is actual token usage, not an invoice. Prices change, so set `version` to an effective date or source identifier and update rates when models change.
