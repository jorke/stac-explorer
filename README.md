# STAC Explorer

A React + Vite + TypeScript app for browsing STAC URLs on a MapLibre map with an Amazon Location Service (ALS) basemap. It runs in the browser with no backend.

## Run

Requires Node.js 22.12 or later.

```sh
npm install
cp .env.example .env.local   # then fill in the values below
npm run dev
```

```dotenv
VITE_ALS_API_KEY=your-amazon-location-api-key
VITE_ALS_REGION=ap-southeast-2
VITE_ALS_MAP_STYLE=Standard   # Standard, Monochrome, Hybrid, or Satellite
```

Open the Vite URL, paste a STAC URL, and choose **Explore**. Restart Vite after you change env values. Without an API key, the app shows a coordinate grid instead of a basemap.

## Create an ALS API key

The app uses Amazon Location Maps v2, so you don't need a map resource. Vite embeds `VITE_*` values in the JavaScript bundle, so create a browser key that allows only map rendering and only your site's referrers. Don't use AWS access keys here.

```sh
export AWS_REGION=ap-southeast-2

aws location create-key \
  --key-name stac-explorer \
  --description "STAC Explorer basemap" \
  --no-expiry \
  --restrictions '{
    "AllowActions": [
      "geo-maps:GetStyleDescriptor",
      "geo-maps:GetTile",
      "geo-maps:GetGlyphs",
      "geo-maps:GetSprites"
    ],
    "AllowResources": ["arn:aws:geo-maps:'"$AWS_REGION"'::provider/default"],
    "AllowReferers": ["http://127.0.0.1:5173/*", "http://localhost:5173/*"]
  }' \
  --query Key --output text
```

Copy the output into `VITE_ALS_API_KEY`. To read the key later:

```sh
aws location describe-key --key-name stac-explorer --query Key --output text
```

After you publish the site, add its CloudFront origin. `update-key` replaces the whole restrictions block, so repeat every field:

```sh
aws location update-key \
  --key-name stac-explorer \
  --restrictions '{
    "AllowActions": [
      "geo-maps:GetStyleDescriptor",
      "geo-maps:GetTile",
      "geo-maps:GetGlyphs",
      "geo-maps:GetSprites"
    ],
    "AllowResources": ["arn:aws:geo-maps:'"$AWS_REGION"'::provider/default"],
    "AllowReferers": [
      "http://127.0.0.1:5173/*",
      "http://localhost:5173/*",
      "https://dxxxxxxxxxxxxx.cloudfront.net/*"
    ]
  }'
```

To remove the key: `aws location delete-key --key-name stac-explorer`.

## Features

- Opens STAC API landing pages, static catalogs, collections, item listings, search URLs, and single items. Follows `data`, `items`, `child`, `item`, and `next` links (including POST pagination).
- Maps item footprints, collection bounds, and clickable item centroids. Static catalog metadata loads six requests at a time, and points appear as they arrive.
- Caches resolved item metadata in IndexedDB for 14 days. **Refresh locations** bypasses the cache for the current catalog.
- Shows item properties, thumbnails, asset links, and source JSON. Filters loaded results locally (no server-side search).
- Overlays a selected item's GeoTIFF asset, with an asset selector, visibility toggle, and opacity slider. A separate slider controls bounds opacity, and a toggle hides item pins.
- **Copy link** saves the catalog, loaded pages, selection, filter, camera, opacities, and visibility in the URL. Links contain no raster pixels or API key. Older `#v=2.`, `#view=`, and `?url=` links still work.

### Requirements

- STAC endpoints and raster hosts must allow CORS. Raster hosts must also support HTTP byte-range requests.
- The app doesn't authenticate to private STAC APIs or proxy requests.
- Cloud Optimized GeoTIFFs (COGs) load as 256-pixel tiles through a `cog://` MapLibre protocol, decoded and reprojected in a web worker. Other GeoTIFFs render a preview of up to 1024 pixels on the longest edge.
- The app can't overlay non-GeoTIFF formats, files without usable georeferencing, or authenticated S3 assets.

## Code structure

| Location                            | Responsibility                                                     |
| ----------------------------------- | ------------------------------------------------------------------ |
| `src/App.tsx`                       | Composes the explorer                                              |
| `src/components/`                   | Header, catalog list, inspector, dialogs, icons                    |
| `src/hooks/`                        | Catalog navigation, location-loading sessions, view sharing        |
| `src/map/`                          | Map lifecycle, spatial data, imagery loading, overlay controls     |
| `src/util/catalogState.ts`          | Navigation and background-metadata state transitions               |
| `src/util/viewLink*.ts`             | Link validation, compact encoding, backward-compatible restoration |
| `src/util/itemLocationCache.ts`     | IndexedDB cache with a fixed 14-day expiry                         |
| `src/util/cog*`, `src/util/raster*` | Raster decoding, reprojection, tile protocol, workers              |

Styles are in `src/styles.css`. Colors and map tokens are CSS variables in `src/theme.css`, which MapLibre reads through `src/util/theme.ts`.

## Check and build

```sh
npm run format:check
npm test
npm run build
npm run preview
```

Run `npm run format` to apply Prettier.

## Publish to AWS

`infra/` has Terraform for a private S3 origin behind a CloudFront distribution. See the [deployment guide](infra/README.md) for setup and the commands to publish `dist/`.
