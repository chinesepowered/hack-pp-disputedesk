/**
 * Seed scenarios: the orders `pnpm seed` creates in the PayPal sandbox, plus the store's own
 * records for each one (carrier scans, delivery photo, customer messages, address and IP checks).
 *
 * The PayPal order carries the scenario key in custom_id, so the desk can find the store record
 * for any dispute by reading the capture back from PayPal. Nothing here is a real person,
 * business or address.
 *
 * Timeline note: a sandbox payment is only minutes old when its dispute is opened, so the
 * store's records are dated relative to the PayPal capture time (the order "was placed"
 * orderAgeDays earlier). The UI labels them as seeded store records.
 */
import type { CarrierKey } from "./catalog";

export type ShipTo = {
  fullName: string;
  addressLine1: string;
  city: string;
  state: string;
  postalCode: string;
  countryCode: "US";
};

export type CarrierEvent = { atDays: number; status: string; location: string };

export type Scenario = {
  key: string;
  sku: string;
  shipTo: ShipTo;
  customer: { priorOrders: number; accountAgeDays: number };
  /** The store's order date is this many days before the PayPal capture. */
  orderAgeDays: number;
  shipping: {
    carrier: CarrierKey | null;
    service: string;
    /** Tracking was added to the PayPal order at fulfillment (POST /v2/checkout/orders/{id}/track). */
    addToPayPal: boolean;
    events: CarrierEvent[];
    outcome: "delivered" | "in_transit" | "returned" | "untracked";
    deliveredToOrderAddress?: boolean;
    signature?: string;
    photo?: string;
  };
  risk: {
    ipRegion: string;
    ipMatchesShipTo: boolean;
    billingMatchesShipTo: boolean;
    deviceSeenBefore: boolean;
  };
  thread: { from: "customer" | "store"; atDays: number; text: string }[];
  packingPhoto?: string;
  buyerPhoto?: string;
  dispute?: {
    reason: "not_received" | "not_as_described" | "unauthorized";
    note: string;
    /**
     * The state the seed stages this dispute into (what the sandbox taught us is in
     * docs/build-log.md):
     * - inquiry (default): opened and left for the seller. Offers and messages are possible.
     * - claim: opened without tracking on the order, tracking added afterwards, then sent on to
     *   PayPal as a claim. PayPal asks the seller for evidence, so provide-evidence and (later)
     *   the sandbox settle action are available.
     * - direct_claim: "not received" on an order that already has tracking. PayPal turns it
     *   into a claim by itself and reviews it; the seller can only add supporting information
     *   or accept.
     * - ready_to_settle: like claim, and the seed also files the evidence, so the sandbox
     *   settle action shows up for whoever opens the case next.
     */
    flow?: "inquiry" | "claim" | "direct_claim" | "ready_to_settle";
  };
};

const delivered = (city: string, days = 3): CarrierEvent[] => [
  { atDays: 0.3, status: "Label created", location: "Portland, OR" },
  { atDays: 0.8, status: "Picked up", location: "Portland, OR" },
  { atDays: days - 1, status: "Arrived at local depot", location: city },
  { atDays: days - 0.3, status: "Out for delivery", location: city },
  { atDays: days, status: "Delivered", location: city },
];

export const SCENARIOS: Scenario[] = [
  {
    key: "fig-not-received",
    sku: "JM-FIG-10",
    shipTo: { fullName: "Priya Raman", addressLine1: "2217 Larkspur Ave", city: "Sacramento", state: "CA", postalCode: "95818", countryCode: "US" },
    customer: { priorOrders: 2, accountAgeDays: 410 },
    orderAgeDays: 9,
    shipping: {
      carrier: "harbor",
      service: "Signature Ground",
      addToPayPal: true,
      events: delivered("Sacramento, CA", 3),
      outcome: "delivered",
      deliveredToOrderAddress: true,
      signature: "P. Raman",
      photo: "/seed/photos/delivery-door-1.jpg",
    },
    risk: { ipRegion: "California, US", ipMatchesShipTo: true, billingMatchesShipTo: true, deviceSeenBefore: true },
    thread: [
      { from: "customer", atDays: 5, text: "Hi, my fiddle leaf fig has not turned up. Can you check on it?" },
      { from: "store", atDays: 5.1, text: "Hello Priya, the carrier shows it was delivered and signed for on the third day. Here is the tracking link and the delivery photo. Could you check with anyone else at the address?" },
      { from: "customer", atDays: 6, text: "Nobody here has it. I am going to ask PayPal for my money back." },
    ],
    packingPhoto: "/seed/photos/fiddle-leaf-fig.jpg",
    dispute: { reason: "not_received", note: "My fiddle leaf fig never arrived. The seller says it was delivered but I do not have it.", flow: "claim" },
  },
  {
    key: "planter-not-as-described",
    sku: "JM-CER-8",
    shipTo: { fullName: "Marcus Bell", addressLine1: "905 Pecan Hollow Rd", city: "Austin", state: "TX", postalCode: "78704", countryCode: "US" },
    customer: { priorOrders: 0, accountAgeDays: 12 },
    orderAgeDays: 8,
    shipping: {
      carrier: "northline",
      service: "Ground",
      addToPayPal: true,
      events: delivered("Austin, TX", 4),
      outcome: "delivered",
      deliveredToOrderAddress: true,
      photo: "/seed/photos/delivery-door-2.jpg",
    },
    risk: { ipRegion: "Texas, US", ipMatchesShipTo: true, billingMatchesShipTo: true, deviceSeenBefore: false },
    thread: [
      { from: "customer", atDays: 5, text: "The planter is a lot smaller than it looks in your photo and the glaze is more grey than cream." },
      { from: "store", atDays: 5.2, text: "Sorry about that, Marcus. It is the 8 inch size as listed, but the glaze does vary. Would a part refund work, or would you rather send it back?" },
    ],
    dispute: { reason: "not_as_described", note: "The planter is much smaller than the photo suggests and the colour is different. I want some of my money back." },
  },
  {
    key: "mini-succulent-not-received",
    sku: "JM-SUC-1",
    shipTo: { fullName: "Dana Whitlock", addressLine1: "64 Tamarack Ct", city: "Denver", state: "CO", postalCode: "80205", countryCode: "US" },
    customer: { priorOrders: 0, accountAgeDays: 3 },
    orderAgeDays: 12,
    shipping: {
      carrier: null,
      service: "Untracked letter post",
      addToPayPal: false,
      events: [],
      outcome: "untracked",
    },
    risk: { ipRegion: "Colorado, US", ipMatchesShipTo: true, billingMatchesShipTo: true, deviceSeenBefore: false },
    thread: [{ from: "customer", atDays: 11, text: "It has been over a week and the little succulent has not arrived." }],
    dispute: { reason: "not_received", note: "Ordered almost two weeks ago and nothing has arrived." },
  },
  {
    key: "olive-unauthorized",
    sku: "JM-OLV-3F",
    shipTo: { fullName: "Helen Oduya", addressLine1: "1480 Fremont Terrace", city: "Seattle", state: "WA", postalCode: "98103", countryCode: "US" },
    customer: { priorOrders: 3, accountAgeDays: 620 },
    orderAgeDays: 10,
    shipping: {
      carrier: "harbor",
      service: "Signature Ground",
      addToPayPal: true,
      events: delivered("Seattle, WA", 2),
      outcome: "delivered",
      deliveredToOrderAddress: true,
      signature: "H. Oduya",
      photo: "/seed/photos/delivery-door-2.jpg",
    },
    risk: { ipRegion: "Washington, US", ipMatchesShipTo: true, billingMatchesShipTo: true, deviceSeenBefore: true },
    thread: [],
    dispute: { reason: "unauthorized", note: "I did not make this purchase." },
  },
  {
    key: "monstera-damaged",
    sku: "JM-MON-6",
    shipTo: { fullName: "Tobias Lindqvist", addressLine1: "33 Garnet St", city: "Minneapolis", state: "MN", postalCode: "55408", countryCode: "US" },
    customer: { priorOrders: 1, accountAgeDays: 150 },
    orderAgeDays: 6,
    shipping: {
      carrier: "northline",
      service: "Ground",
      addToPayPal: true,
      events: delivered("Minneapolis, MN", 4),
      outcome: "delivered",
      deliveredToOrderAddress: true,
      photo: "/seed/photos/delivery-door-1.jpg",
    },
    risk: { ipRegion: "Minnesota, US", ipMatchesShipTo: true, billingMatchesShipTo: true, deviceSeenBefore: true },
    thread: [
      { from: "customer", atDays: 4.5, text: "The monstera arrived with two snapped stems and the leaves are limp. Photo attached." },
    ],
    packingPhoto: "/seed/photos/monstera.jpg",
    buyerPhoto: "/seed/photos/wilted-plant.jpg",
    dispute: { reason: "not_as_described", note: "The plant arrived damaged with broken stems and wilted leaves." },
  },
  {
    key: "terracotta-set-not-received",
    sku: "JM-TER-3",
    shipTo: { fullName: "Imani Carter", addressLine1: "712 Wrightwood Ln", city: "Chicago", state: "IL", postalCode: "60614", countryCode: "US" },
    customer: { priorOrders: 0, accountAgeDays: 30 },
    orderAgeDays: 9,
    shipping: {
      carrier: "northline",
      service: "Ground",
      addToPayPal: true,
      events: delivered("Chicago, IL", 5),
      outcome: "delivered",
      deliveredToOrderAddress: true,
      photo: "/seed/photos/delivery-unclear.jpg",
    },
    risk: { ipRegion: "Illinois, US", ipMatchesShipTo: true, billingMatchesShipTo: true, deviceSeenBefore: false },
    thread: [
      { from: "customer", atDays: 6, text: "Tracking says delivered but there is no box here. My building has a shared lobby." },
      { from: "store", atDays: 6.3, text: "Thanks Imani. We have asked the carrier where exactly it was left and will come back to you." },
    ],
    dispute: { reason: "not_received", note: "Tracking says delivered but I never got the pots.", flow: "claim" },
  },
  {
    key: "watering-can-returned",
    sku: "JM-CAN-1L",
    shipTo: { fullName: "Gareth Monk", addressLine1: "5 Sorrel Way", city: "Boston", state: "MA", postalCode: "02118", countryCode: "US" },
    customer: { priorOrders: 0, accountAgeDays: 8 },
    orderAgeDays: 11,
    shipping: {
      carrier: "northline",
      service: "Ground",
      addToPayPal: true,
      events: [
        { atDays: 0.4, status: "Label created", location: "Portland, OR" },
        { atDays: 1, status: "Picked up", location: "Portland, OR" },
        { atDays: 5, status: "Delivery attempted: address incomplete", location: "Boston, MA" },
        { atDays: 7, status: "Returning to sender", location: "Boston, MA" },
      ],
      outcome: "returned",
    },
    risk: { ipRegion: "Massachusetts, US", ipMatchesShipTo: true, billingMatchesShipTo: true, deviceSeenBefore: false },
    thread: [{ from: "customer", atDays: 9, text: "Where is my watering can? It should have been here days ago." }],
    dispute: { reason: "not_received", note: "The watering can never came.", flow: "direct_claim" },
  },
  {
    key: "snake-plant-unauthorized",
    sku: "JM-SNK-6",
    shipTo: { fullName: "R. Castellan", addressLine1: "2290 Juniper Flats Rd", city: "Phoenix", state: "AZ", postalCode: "85004", countryCode: "US" },
    customer: { priorOrders: 0, accountAgeDays: 0 },
    orderAgeDays: 7,
    shipping: {
      carrier: "northline",
      service: "Ground",
      addToPayPal: true,
      events: delivered("Phoenix, AZ", 3),
      outcome: "delivered",
      deliveredToOrderAddress: true,
    },
    risk: { ipRegion: "Arizona, US", ipMatchesShipTo: true, billingMatchesShipTo: false, deviceSeenBefore: false },
    thread: [],
    dispute: { reason: "unauthorized", note: "I do not recognise this payment." },
  },
  {
    key: "calathea-wrong-plant",
    sku: "JM-CAL-6",
    shipTo: { fullName: "Noor Haddad", addressLine1: "118 Sycamore Bend", city: "Atlanta", state: "GA", postalCode: "30307", countryCode: "US" },
    customer: { priorOrders: 4, accountAgeDays: 900 },
    orderAgeDays: 7,
    shipping: {
      carrier: "harbor",
      service: "Ground",
      addToPayPal: true,
      events: delivered("Atlanta, GA", 3),
      outcome: "delivered",
      deliveredToOrderAddress: true,
      photo: "/seed/photos/delivery-door-1.jpg",
    },
    risk: { ipRegion: "Georgia, US", ipMatchesShipTo: true, billingMatchesShipTo: true, deviceSeenBefore: true },
    thread: [
      { from: "customer", atDays: 4, text: "I think you sent the wrong plant. This does not look like the calathea in the listing." },
      { from: "store", atDays: 4.2, text: "Hi Noor, our packing photo shows a Calathea Medallion going into your box. New leaves come in plainer and pattern up over a few weeks. Happy to take it back if you would rather." },
    ],
    packingPhoto: "/seed/photos/calathea.jpg",
    dispute: { reason: "not_as_described", note: "The plant I received is not the one shown in the listing.", flow: "claim" },
  },
  {
    key: "succulents-not-received",
    sku: "JM-SUC-3",
    shipTo: { fullName: "Lucia Ferreira", addressLine1: "4410 Ibis St", city: "San Diego", state: "CA", postalCode: "92104", countryCode: "US" },
    customer: { priorOrders: 1, accountAgeDays: 95 },
    orderAgeDays: 8,
    shipping: {
      carrier: "harbor",
      service: "Ground",
      addToPayPal: true,
      events: delivered("San Diego, CA", 3),
      outcome: "delivered",
      deliveredToOrderAddress: true,
      photo: "/seed/photos/delivery-door-2.jpg",
    },
    risk: { ipRegion: "California, US", ipMatchesShipTo: true, billingMatchesShipTo: true, deviceSeenBefore: true },
    thread: [{ from: "customer", atDays: 6, text: "My succulents are marked delivered but I cannot find them." }],
    dispute: { reason: "not_received", note: "Marked as delivered but I have not received it.", flow: "ready_to_settle" },
  },
  {
    key: "pothos-not-as-described",
    sku: "JM-POT-HB",
    shipTo: { fullName: "Wendell Park", addressLine1: "77 Calhoun Mews", city: "Nashville", state: "TN", postalCode: "37206", countryCode: "US" },
    customer: { priorOrders: 0, accountAgeDays: 20 },
    orderAgeDays: 6,
    shipping: {
      carrier: "northline",
      service: "Ground",
      addToPayPal: true,
      events: delivered("Nashville, TN", 4),
      outcome: "delivered",
      deliveredToOrderAddress: true,
    },
    risk: { ipRegion: "Tennessee, US", ipMatchesShipTo: true, billingMatchesShipTo: true, deviceSeenBefore: false },
    thread: [{ from: "customer", atDays: 5, text: "The vines are tiny, nothing like 12 inches. Quite disappointed." }],
    dispute: { reason: "not_as_described", note: "The plant is far smaller than described on the product page." },
  },
  {
    key: "terracotta-pot-not-received",
    sku: "JM-TER-4",
    shipTo: { fullName: "Asha Venkat", addressLine1: "19 Dayton Row", city: "Madison", state: "WI", postalCode: "53703", countryCode: "US" },
    customer: { priorOrders: 0, accountAgeDays: 45 },
    orderAgeDays: 9,
    shipping: {
      carrier: "northline",
      service: "Ground",
      addToPayPal: true,
      events: delivered("Madison, WI", 5),
      outcome: "delivered",
      deliveredToOrderAddress: true,
    },
    risk: { ipRegion: "Wisconsin, US", ipMatchesShipTo: true, billingMatchesShipTo: true, deviceSeenBefore: false },
    thread: [],
    dispute: { reason: "not_received", note: "Never received my order.", flow: "direct_claim" },
  },
  {
    key: "planter-colour-not-as-described",
    sku: "JM-CER-8",
    shipTo: { fullName: "Beatrix Nolan", addressLine1: "301 Person St", city: "Raleigh", state: "NC", postalCode: "27601", countryCode: "US" },
    customer: { priorOrders: 1, accountAgeDays: 200 },
    orderAgeDays: 7,
    shipping: {
      carrier: "harbor",
      service: "Ground",
      addToPayPal: true,
      events: delivered("Raleigh, NC", 3),
      outcome: "delivered",
      deliveredToOrderAddress: true,
      photo: "/seed/photos/delivery-door-1.jpg",
    },
    risk: { ipRegion: "North Carolina, US", ipMatchesShipTo: true, billingMatchesShipTo: true, deviceSeenBefore: true },
    thread: [{ from: "customer", atDays: 4, text: "The speckled planter looks nothing like the picture. Mine is nearly plain grey." }],
    buyerPhoto: "/seed/photos/broken-pot.jpg",
    dispute: { reason: "not_as_described", note: "Colour and finish are not as shown. It also arrived with a crack." },
  },
  {
    key: "snake-plant-happy",
    sku: "JM-SNK-6",
    shipTo: { fullName: "Colm Ashby", addressLine1: "8 Hawthorne Pl", city: "Portland", state: "OR", postalCode: "97214", countryCode: "US" },
    customer: { priorOrders: 5, accountAgeDays: 1100 },
    orderAgeDays: 5,
    shipping: {
      carrier: "harbor",
      service: "Ground",
      addToPayPal: true,
      events: delivered("Portland, OR", 1),
      outcome: "delivered",
      deliveredToOrderAddress: true,
      photo: "/seed/photos/delivery-door-2.jpg",
    },
    risk: { ipRegion: "Oregon, US", ipMatchesShipTo: true, billingMatchesShipTo: true, deviceSeenBefore: true },
    thread: [{ from: "customer", atDays: 2, text: "Arrived in perfect shape. Thank you!" }],
  },
];

/**
 * Orders placed on the demo store page carry custom_id "web:<sku>". They get a plain, well
 * documented fulfillment record so a dispute opened on one still has store evidence to show.
 */
function webOrderScenario(sku: string): Scenario {
  return {
    key: `web:${sku}`,
    sku,
    shipTo: { fullName: "", addressLine1: "", city: "", state: "", postalCode: "", countryCode: "US" },
    customer: { priorOrders: 0, accountAgeDays: 0 },
    orderAgeDays: 6,
    shipping: {
      carrier: "harbor",
      service: "Ground",
      addToPayPal: true,
      events: delivered("the destination city", 3),
      outcome: "delivered",
      deliveredToOrderAddress: true,
      photo: "/seed/photos/delivery-door-1.jpg",
    },
    risk: { ipRegion: "the buyer's region", ipMatchesShipTo: true, billingMatchesShipTo: true, deviceSeenBefore: false },
    thread: [],
  };
}

export function scenarioByKey(key: string | undefined | null): Scenario | undefined {
  if (!key) return undefined;
  if (key.startsWith("web:")) return webOrderScenario(key.slice(4));
  return SCENARIOS.find((s) => s.key === key);
}
