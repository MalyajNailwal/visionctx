# Token accounting

The proxy records `usage` returned by Anthropic in JSON responses and SSE `message_start` / `message_delta` events. These are labeled `ACTUAL`. The context classifier's UTF-8 bytes divided by four and the renderer's patch count are `ESTIMATED`; neither is a measured baseline. Set `measurement.counterfactual_tokens: true` to make an optional nonblocking token-count request for the original body when a request is transformed and an API key is present. That count is still a provider estimate, and a count failure leaves the field empty. A valid savings claim also needs cache-adjusted cost and task accuracy.

Cache reads and writes are stored when present in provider usage. Missing values display as unavailable rather than zero. Output tokens from a transformed run are not a baseline for a separate run.
