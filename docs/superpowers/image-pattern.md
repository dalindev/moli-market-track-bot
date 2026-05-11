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
https://guide.starcg.net/pet/{BaseImgnum}.gif
```

Example: `https://guide.starcg.net/pet/101025.gif`
- Domain: `guide.starcg.net` (different from item icons)
- Path: `/pet/`
- Extension: `.gif`

(An earlier candidate `https://member.starcg.net/metamo/png/{N}.png` showed up in the Network tab on `market.php?type=pet` — but that was something else, not the actual pet portrait. The `guide.starcg.net/pet/` URL is the canonical one.)

## Plan scope

- Plan 1 (this implementation): items only → use the `.gif` pattern.
- Plan 2 (pets later): add the `.png` pattern when pet support is built.

## Required request headers

The Referer header is sent by the browser. For our local cache fetch, only a reasonable User-Agent is required:

```
User-Agent: Mozilla/5.0 (compatible; StarCGMarketTracker/1.0)
```
