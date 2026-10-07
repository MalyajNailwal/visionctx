# Image rendering

The renderer normalizes CRLF, expands tabs, preserves leading spaces, numbers, paths and Unicode, wraps long lines, adds optional line numbers, paginates, and encodes PNG with a local canvas library. It records dimensions, bytes, render time and a 28-pixel-patch token estimate computed from the laid-out page size rather than source bytes, so the estimate matches the pixels actually drawn. Pages are stored outside SQLite under `data/requests/<id>/images/`.

The default 1000×1000 limit is conservative for Anthropic's standard image resolution tier. The renderer also has a 16-page and 1 MiB source limit; larger eligible blocks stay as text. The provider may still resize images. The geometric estimate is never actual usage. Font availability affects glyph shape and reproducibility. Image text is lossy to the model even when the bitmap is pixel accurate; exact identifiers should stay as text.
