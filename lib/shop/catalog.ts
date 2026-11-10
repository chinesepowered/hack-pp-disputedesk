/**
 * Juniper & Moss: a fictional houseplant shop. Products, policies and carriers are invented for
 * the demo. Photos are openly licensed and credited in docs/CREDITS.md.
 */

export type Product = {
  sku: string;
  name: string;
  price: string;
  photo: string;
  blurb: string;
  /** Facts stated on the product page. These are what a "not as described" claim is checked against. */
  pageFacts: string[];
  sizeChart: boolean;
  category: "plant" | "pot" | "care";
};

export const STORE = {
  name: "Juniper & Moss",
  tagline: "Houseplants, pots and plant care",
  city: "Portland, OR",
  timezone: "America/Los_Angeles",
  supportEmail: "hello@juniperandmoss.example",
  returnAddress: {
    address_line_1: "418 Alder Row",
    admin_area_2: "Portland",
    admin_area_1: "OR",
    postal_code: "97209",
    country_code: "US",
  },
};

export const PRODUCTS: Product[] = [
  {
    sku: "JM-FIG-10",
    name: "Fiddle Leaf Fig, 10 inch floor plant",
    price: "184.00",
    photo: "/seed/photos/fiddle-leaf-fig.jpg",
    blurb: "A tall statement plant, shipped in its nursery pot with a moisture sleeve.",
    pageFacts: ["Ships in a 10 inch nursery pot", "About 3 to 4 ft tall on arrival", "Signature required on delivery"],
    sizeChart: true,
    category: "plant",
  },
  {
    sku: "JM-OLV-3F",
    name: "Potted Olive Tree, 3 ft",
    price: "240.00",
    photo: "/seed/photos/olive-tree.jpg",
    blurb: "A small indoor olive tree in a terracotta pot.",
    pageFacts: ["About 3 ft tall including the pot", "Ships in a 12 inch terracotta pot", "Signature required on delivery"],
    sizeChart: true,
    category: "plant",
  },
  {
    sku: "JM-MON-6",
    name: "Monstera Deliciosa, 6 inch pot",
    price: "48.00",
    photo: "/seed/photos/monstera.jpg",
    blurb: "The classic split-leaf plant, grown to fill a 6 inch pot.",
    pageFacts: ["6 inch nursery pot", "4 to 6 leaves on arrival", "Covered by the 14 day live arrival promise"],
    sizeChart: true,
    category: "plant",
  },
  {
    sku: "JM-SNK-6",
    name: "Snake Plant, 6 inch pot",
    price: "34.00",
    photo: "/seed/photos/snake-plant.jpg",
    blurb: "Hard to kill and happy in low light.",
    pageFacts: ["6 inch nursery pot", "About 14 inches tall"],
    sizeChart: true,
    category: "plant",
  },
  {
    sku: "JM-CAL-6",
    name: "Calathea Medallion, 6 inch pot",
    price: "42.00",
    photo: "/seed/photos/calathea.jpg",
    blurb: "Patterned leaves that fold up at night.",
    pageFacts: ["6 inch nursery pot", "Covered by the 14 day live arrival promise"],
    sizeChart: true,
    category: "plant",
  },
  {
    sku: "JM-POT-HB",
    name: "Golden Pothos, hanging basket",
    price: "28.00",
    photo: "/seed/photos/pothos.jpg",
    blurb: "A trailing plant in an 8 inch hanging basket.",
    pageFacts: ["8 inch hanging basket", "Vines about 12 inches long on arrival"],
    sizeChart: false,
    category: "plant",
  },
  {
    sku: "JM-SUC-3",
    name: "Succulent Trio",
    price: "24.00",
    photo: "/seed/photos/succulents.jpg",
    blurb: "Three small succulents in 2 inch pots.",
    pageFacts: ["Three plants in 2 inch pots", "Varieties vary by season"],
    sizeChart: false,
    category: "plant",
  },
  {
    sku: "JM-CER-8",
    name: "Speckled Ceramic Planter, 8 inch",
    price: "62.00",
    photo: "/seed/photos/ceramic-planter.jpg",
    blurb: "A hand-glazed planter with a drainage hole and saucer.",
    // Deliberately thin: this listing has no size chart and one photo, which is what the
    // prevention card picks up on.
    pageFacts: ["Listed as 8 inch", "Hand glazed, so colour varies"],
    sizeChart: false,
    category: "pot",
  },
  {
    sku: "JM-TER-3",
    name: "Terracotta Pot Set of 3",
    price: "38.00",
    photo: "/seed/photos/terracotta-pots.jpg",
    blurb: "Three classic clay pots: 4, 6 and 8 inch.",
    pageFacts: ["4, 6 and 8 inch pots", "Unglazed clay"],
    sizeChart: true,
    category: "pot",
  },
  {
    sku: "JM-CAN-1L",
    name: "Brass Watering Can, 1 litre",
    price: "56.00",
    photo: "/seed/photos/watering-can.jpg",
    blurb: "A long-spout indoor watering can.",
    pageFacts: ["Holds 1 litre", "Brass finish"],
    sizeChart: false,
    category: "care",
  },
  {
    sku: "JM-TER-4",
    name: "Terracotta Pot, 4 inch",
    price: "18.00",
    photo: "/seed/photos/terracotta-pots.jpg",
    blurb: "One classic clay pot with a drainage hole.",
    pageFacts: ["4 inch pot", "Unglazed clay"],
    sizeChart: true,
    category: "pot",
  },
  {
    sku: "JM-SUC-1",
    name: "Mini Succulent, 2 inch pot",
    price: "12.00",
    photo: "/seed/photos/succulents.jpg",
    blurb: "One small succulent, picked from this week's batch.",
    pageFacts: ["One plant in a 2 inch pot", "Ships by untracked letter post"],
    sizeChart: false,
    category: "plant",
  },
];

export function productBySku(sku: string): Product | undefined {
  return PRODUCTS.find((p) => p.sku === sku);
}

export const RETURN_POLICY = {
  title: "Returns and the live arrival promise",
  updated: "2026-09-01",
  points: [
    "Pots and plant care items can be returned unused within 30 days for a full refund.",
    "Live plants are covered by a 14 day live arrival promise: send a photo and we replace the plant or refund it.",
    "Orders over $150 ship with signature required.",
    "Return postage is paid by the customer unless the item arrived damaged or wrong.",
  ],
};

/** Fictional carriers. PayPal's carrier list is real brands only, so tracking is filed as OTHER. */
export const CARRIERS = {
  northline: { name: "Northline Parcel", prefix: "NLP", signatureService: false },
  harbor: { name: "Harbor Post", prefix: "HBP", signatureService: true },
} as const;

export type CarrierKey = keyof typeof CARRIERS;
