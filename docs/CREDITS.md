# Credits

Everything in the demo store is fictional: Juniper & Moss, its customers, its staff and its carriers (Northline Parcel, Harbor Post) do not exist.

## Photos

All photos are from Wikimedia Commons under open licences. Each was resized and recompressed; nothing else was changed. They stand in for a small shop's product, packing and delivery photos.

| File (`public/seed/photos/`) | Used as | Title on Commons | Author | Licence | Source |
| --- | --- | --- | --- | --- | --- |
| `monstera.jpg` | Product photo (Monstera Deliciosa) and packing photo | Monstera (22606003106).jpg | bizmac from Japan | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0) | [Commons page](https://commons.wikimedia.org/wiki/File:Monstera_(22606003106).jpg) |
| `snake-plant.jpg` | Product photo (Snake Plant) | Sansevieria trifasciata Laurentii pm 4.jpg | Peter A. Mansfeld | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0) | [Commons page](https://commons.wikimedia.org/wiki/File:Sansevieria_trifasciata_Laurentii_pm_4.jpg) |
| `fiddle-leaf-fig.jpg` | Product photo (Fiddle Leaf Fig) and packing photo | Fiddle Leaf Fig in pot.jpg | Morrisjm (author assumed by Wikimedia Commons from the uploader's copyright claim; no machine-readable author provided) | [CC BY-SA 3.0](http://creativecommons.org/licenses/by-sa/3.0/) | [Commons page](https://commons.wikimedia.org/wiki/File:Fiddle_Leaf_Fig_in_pot.jpg) |
| `pothos.jpg` | Product photo (Golden Pothos) | Epipremnum aureum (Golden Pothos).jpg | Slyronit | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) | [Commons page](https://commons.wikimedia.org/wiki/File:Epipremnum_aureum_(Golden_Pothos).jpg) |
| `succulents.jpg` | Product photo (Succulent Trio, Mini Succulent) | Potted Succulents (Unsplash).jpg | Noom Peerapong (imnoom on Unsplash) | [CC0](http://creativecommons.org/publicdomain/zero/1.0/deed.en) | [Commons page](https://commons.wikimedia.org/wiki/File:Potted_Succulents_(Unsplash).jpg) |
| `ceramic-planter.jpg` | Product photo (Speckled Ceramic Planter) | Plectranthus verticillatus in a ceramic pot.jpg | W.carter | [CC0](http://creativecommons.org/publicdomain/zero/1.0/deed.en) | [Commons page](https://commons.wikimedia.org/wiki/File:Plectranthus_verticillatus_in_a_ceramic_pot.jpg) |
| `terracotta-pots.jpg` | Product photo (Terracotta pots) | Terracotta Pots (Unsplash).jpg | Annie Spratt (anniespratt on Unsplash) | [CC0](http://creativecommons.org/publicdomain/zero/1.0/deed.en) | [Commons page](https://commons.wikimedia.org/wiki/File:Terracotta_Pots_(Unsplash).jpg) |
| `watering-can.jpg` | Product photo (Brass Watering Can) | Old metal watering can resting on a garden edge in a greenhouse.jpg | Shixart1985 | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0) | [Commons page](https://commons.wikimedia.org/wiki/File:Old_metal_watering_can_resting_on_a_garden_edge_in_a_greenhouse.jpg) |
| `calathea.jpg` | Product photo (Calathea) and packing photo | Maranta leuconeura D2501.jpg | Tangopaso | [Public domain](https://commons.wikimedia.org/wiki/File:Maranta_leuconeura_D2501.jpg#Licensing) | [Commons page](https://commons.wikimedia.org/wiki/File:Maranta_leuconeura_D2501.jpg) |
| `olive-tree.jpg` | Product photo (Potted Olive Tree) | Olive tree in jar 2016d.jpg | Øyvind Holmstad | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) | [Commons page](https://commons.wikimedia.org/wiki/File:Olive_tree_in_jar_2016d.jpg) |
| `delivery-door-1.jpg` | Carrier delivery photo (parcel at a door) | Damaged Cardboard Box Labelled Fragile.jpg | Meanwell Packaging | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0) | [Commons page](https://commons.wikimedia.org/wiki/File:Damaged_Cardboard_Box_Labelled_Fragile.jpg) |
| `delivery-door-2.jpg` | Carrier delivery photo (parcel at a door) | Fragile Parcel left outside door.jpg | Meanwell Packaging | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0) | [Commons page](https://commons.wikimedia.org/wiki/File:Fragile_Parcel_left_outside_door.jpg) |
| `delivery-unclear.jpg` | Carrier delivery photo that does not show a parcel | Front door of Jennifer's home (5804901207).jpg | in pastel from Canada | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0) | [Commons page](https://commons.wikimedia.org/wiki/File:Front_door_of_Jennifer%27s_home_(5804901207).jpg) |
| `broken-pot.jpg` | Photo sent by a buyer (damage) | BrokenClayFlowerpot.JPG | Simon Speed | [CC0](http://creativecommons.org/publicdomain/zero/1.0/deed.en) | [Commons page](https://commons.wikimedia.org/wiki/File:BrokenClayFlowerpot.JPG) |
| `wilted-plant.jpg` | Photo sent by a buyer (damage) | FittoniaAlbivenisFainted.jpg | Why can't i get a cow | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0) | [Commons page](https://commons.wikimedia.org/wiki/File:FittoniaAlbivenisFainted.jpg) |

The machine-readable list is in `docs/photo-credits.json`.

## Mascot and artwork

Marlow the capybara clerk (the SVG in `components/marlow/Marlow.tsx`, the app icon and the video cards) was drawn for this project and is original work. See `TRADEMARKS.md`.

## Voices

Narration and Marlow's lines were generated with ElevenLabs (`eleven_multilingual_v2`, premade voices) for this project. The character count is tracked in `demo/elevenlabs-usage.json`. There is no music.

## Software

- PayPal: `@paypal/paypal-server-sdk` (generated by APIMatic), `@paypal/agent-toolkit`, the PayPal JS SDK v6, the PayPal AI Toolkit skills (read while building).
- APIMatic PayPal Context Plugin skills, copied unchanged into `.claude/skills/` under the MIT licence (`.claude/skills/APIMATIC-LICENSE.txt`).
- Bryntum Scheduler 7.3.8, public trial build (`@bryntum/scheduler-trial`, `@bryntum/scheduler-react`), under Bryntum's trial terms. The trial shows a watermark.
- Next.js, React, Tailwind CSS, Vercel AI SDK, Zod, pdf-lib, Playwright, Vitest, `@vercel/blob`.
- Models served by W&B Inference: `Qwen/Qwen3.8-27B`, `google/gemma-4-31B-it`, `zai-org/GLM-5.3-Flash`.
