# Brand assets and reference artwork

## Exact supplied logo exports embedded by the application

- `falchion-xeniaa-logo.webp` — exact 300×150 transparent WebP export from the uploaded Falchion Xeniaa logo pack; used on the application shell, login, invitation activation and illustrative template preview.
- `myfx-pos.webp` — exact supplied transparent WebP export from the MyFX POS logo pack; used in Settings as the line-of-business logo.
- `fx-digitech.webp` — exact supplied transparent WebP export from the FX Digitech logo pack; used in Settings as the line-of-business logo.
- `fx-coworks.webp` — exact supplied transparent WebP export from the Coworks logo pack; used in Settings as the line-of-business logo.

## Supplied invoice-template logo variants

- `invoice-logos/myfx-pos.jpg` — compact rendering of the supplied **vertical** MyFX POS logo used by the invoice sample.
- `invoice-logos/fx-digitech.jpg` — compact rendering of the supplied horizontal FX Digitech logo used by its invoice sample.
- `invoice-logos/fx-coworks.jpg` — compact rendering of the supplied stacked FX Coworks logo used by its invoice sample.

The PDF renderer and brand-first invoice composer prefer these sample-matched variants, then fall back to the configured brand logo and legacy logo assets. These files are logo artwork only; no customer invoice/sample with example financial details is published.

## Reconstructed-only assets

- `falchion-xeniaa-logo.svg`, `myfx-pos.svg`, `fx-digitech.svg` and `fx-coworks.svg` — editable vector reconstructions retained as design references, not used in place of the exact supplied WebPs in the live logo gallery.
- `templates/myfx-pos-sample.svg`, `templates/digitech-sample.svg`, `templates/coworks-sample.svg` — invoice-layout reconstructions informed by the supplied invoice samples, not pixel copies of them and not active templates or issued documents.

The supplied design guide specifies Gold `#DCAF51`, Saffron Red `#931314`, Charcoal `#111111`, Platinum `#F4F4F5` and White `#FFFFFF`, with Sansation for display headings and Open Sans for UI/body text. The current CSS requests those font families from Google Fonts with system fallbacks; production owners must approve external font delivery or provide licensed self-hosted fonts.

Raw invoice samples are deliberately **not** stored in `public/`: they contain example business/customer and financial details. Never place production invoices, account numbers, tax identifiers, customer data or signed company configuration in this public directory.
