# Image URL Pattern (discovered 2026-05-10)

Discovered via browser devtools Network tab while browsing `https://member.starcg.net/market.php`.

## Items

```
https://member.starcg.net/metamo/item/{ITEM_BASEIMAGENUMBER}.gif
```

Example: `https://member.starcg.net/metamo/item/21500.gif`
- Path: `/metamo/item/`
- Extension: `.gif`

## Pets

```
https://member.starcg.net/metamo/png/{BaseImgnum}.png
```

Example: `https://member.starcg.net/metamo/png/30075.png` (referer was `market.php?type=pet`)
- Path: `/metamo/png/`
- Extension: `.png`

## Plan scope

- Plan 1 (this implementation): items only → use the `.gif` pattern.
- Plan 2 (pets later): add the `.png` pattern when pet support is built.

## Required request headers

The Referer header is sent by the browser. For our local cache fetch, only a reasonable User-Agent is required:

```
User-Agent: Mozilla/5.0 (compatible; StarCGMarketTracker/1.0)
```
